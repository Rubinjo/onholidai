import { z } from "zod";

import { decodeTripSnapshot, publicTripPriceSchema, tripSnapshotSchema, travelComponentSchema, tripWarningSchema } from "./schema";

const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const publicComponent = (index: 0 | 1 | 2 | 3 | 4) => travelComponentSchema.options[index].extend({ price: publicTripPriceSchema });
export const customerSnapshotSchema = z.object({ ...tripSnapshotSchema.shape,
  departureOrigin: tripSnapshotSchema.shape.departureOrigin.nullable(),
  components: z.array(z.union([publicComponent(0), publicComponent(1), publicComponent(2), publicComponent(3), publicComponent(4)])).max(32),
  price: publicTripPriceSchema,
  warnings: z.array(tripWarningSchema).max(96),
}).strict().superRefine((snapshot, context) => {
  // Validate aggregate relationships without introducing internal costs into the public contract.
  const money = (minorUnits: number) => ({ currency: snapshot.price.currency, minorUnits });
  const components = snapshot.components.map((component) => ({ ...component, price: {
    supplierAmount: { currency: component.price.currency,
      minorUnits: component.price.finalCustomerMinor - (component.price.taxesMinor ?? 0) - (component.price.feesMinor ?? 0) },
    platformMargin: { currency: component.price.currency, minorUnits: 0 },
    customerPayableTaxes: { currency: component.price.currency, minorUnits: component.price.taxesMinor ?? 0 },
    customerPayableFees: { currency: component.price.currency, minorUnits: component.price.feesMinor ?? 0 },
    finalCustomerAmount: { currency: component.price.currency, minorUnits: component.price.finalCustomerMinor },
    source: "public_projection", status: component.price.status,
    checkedAt: component.price.checkedAt, expiresAt: component.price.expiresAt ?? null,
  } }));
  const internal = { ...snapshot, components, warnings: snapshot.warnings.slice(0, 64),
    price: { currency: snapshot.price.currency,
      supplierTotal: money(snapshot.price.finalCustomerMinor - (snapshot.price.taxesMinor ?? 0) - (snapshot.price.feesMinor ?? 0)),
      platformMarginTotal: money(0), customerPayableTaxesTotal: money(snapshot.price.taxesMinor ?? 0),
      customerPayableFeesTotal: money(snapshot.price.feesMinor ?? 0), finalCustomerTotal: money(snapshot.price.finalCustomerMinor),
      status: snapshot.price.status, checkedAt: snapshot.price.checkedAt, conversionDisclosures: [] } };
  try { decodeTripSnapshot(snapshot.departureOrigin === null ? 0 : 1, internal); }
  catch { context.addIssue({ code: "custom", message: "Public snapshot aggregate facts are inconsistent" }); }
});

const protectedKeys = new Set(["supplierAmount", "supplierTotal", "supplierMinor", "marginMinor", "platformMargin", "platformMarginTotal",
  "bookingStatus", "authorization", "payment", "__proto__", "prototype", "constructor"]);
function containsProtectedValue(value: unknown, depth = 0): boolean {
  if (depth > 32) return true;
  if (Array.isArray(value)) return value.some((entry) => containsProtectedValue(entry, depth + 1));
  if (value && typeof value === "object") return Object.entries(value).some(([key, entry]) =>
    (protectedKeys.has(key) && !(key === "bookingStatus" && entry === "unbooked")) || containsProtectedValue(entry, depth + 1));
  return false;
}

// Persisted as JSONB. Parsed domain objects can carry own keys whose value is
// undefined; JSON serialization drops those keys, so they are tolerated here.
const jsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(),
  z.null(), z.undefined(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]));

export const proposalOperationSchema = z.object({
  operation: z.enum(["add", "replace", "remove", "reorder"]),
  target: text(500).regex(/^\/(departureOrigin|availabilityWindows|duration|travellerParty|preferences|constraints|destinations|itineraryDays|components)(\/[^/]+)*$/)
    .refine((target) => !target.split("/").some((part) => protectedKeys.has(part)), "Protected operation target"),
  value: jsonValueSchema,
}).strict().superRefine((operation, context) => {
  if (containsProtectedValue(operation.value)) context.addIssue({ code: "custom", path: ["value"], message: "Proposal values contain protected state" });
});

export const changeProposalSchema = z.object({
  id: z.uuid(), tripId: z.uuid(), agentRunId: z.uuid(), initiatingRequestId: z.uuid(),
  purpose: z.enum(["initial_estimate", "refinement", "finalization"]),
  baseTripVersion: z.number().int().positive(), operations: z.array(proposalOperationSchema).min(1).max(32),
  affectedFacts: z.array(text(200)).min(1).max(64), rationale: text(4000),
  tradeoffs: z.array(text(1000)).max(32).optional(), ambiguities: z.array(text(1000)).max(20).optional(),
  status: z.enum(["proposed", "needs_clarification", "accepted", "applied", "rejected", "stale"]),
  createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  previewSnapshot: customerSnapshotSchema.optional(),
  priceImpact: z.object({ currency: z.string().regex(/^[A-Z]{3}$/), beforeMinor: z.number().int().nonnegative(), afterMinor: z.number().int().nonnegative(), deltaMinor: z.number().int() }).strict().optional(),
  scheduleImpact: z.object({ before: z.array(z.object({ id: z.uuid(), nights: z.number().int().nonnegative(), arrivalDate: z.iso.date().nullable(), departureDate: z.iso.date().nullable() }).strict()).max(8), after: z.array(z.object({ id: z.uuid(), nights: z.number().int().nonnegative(), arrivalDate: z.iso.date().nullable(), departureDate: z.iso.date().nullable() }).strict()).max(8) }).strict().optional(),
  estimatedCostRange: z.object({ currency: z.string().regex(/^[A-Z]{3}$/),
    minimumMinor: z.number().int().nonnegative(), maximumMinor: z.number().int().nonnegative() }).strict().optional(),
  styleCompatibility: text(2000).optional(), constraintSummary: z.array(text(1000)).max(64).optional(),
  warnings: z.array(text(1000)).max(64).optional(),
}).strict().superRefine((proposal, context) => {
  if (["refinement", "finalization"].includes(proposal.purpose) && (!proposal.previewSnapshot || !proposal.priceImpact || !proposal.scheduleImpact)) {
    context.addIssue({ code: "custom", message: "Refinements require a trusted preview with price and schedule impacts" });
  }
  if (Date.parse(proposal.expiresAt) <= Date.parse(proposal.createdAt)) {
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "Expiry must follow creation" });
  }
  if (proposal.purpose === "initial_estimate" && (!proposal.previewSnapshot?.departureOrigin || !proposal.estimatedCostRange
    || !proposal.styleCompatibility || !proposal.constraintSummary || !proposal.warnings)) {
    context.addIssue({ code: "custom", message: "Initial estimates require a reviewable preview, cost range, style, constraints and warnings" });
  }
  if (proposal.purpose === "initial_estimate" && proposal.previewSnapshot
    && (proposal.previewSnapshot.price.status !== "estimated"
      || proposal.previewSnapshot.components.some((component) => component.bookingStatus !== "unbooked"
        || ["live", "confirmed"].includes(component.price.status)))) {
    context.addIssue({ code: "custom", path: ["previewSnapshot"], message: "Initial estimates cannot imply live or confirmed bookings" });
  }
  const range = proposal.estimatedCostRange;
  if (range && (range.maximumMinor < range.minimumMinor || (proposal.previewSnapshot
    && (range.currency !== proposal.previewSnapshot.price.currency
      || proposal.previewSnapshot.price.finalCustomerMinor < range.minimumMinor
      || proposal.previewSnapshot.price.finalCustomerMinor > range.maximumMinor)))) {
    context.addIssue({ code: "custom", path: ["estimatedCostRange"], message: "Cost range must include the preview total in the same currency" });
  }
});

export type ChangeProposal = z.infer<typeof changeProposalSchema>;
