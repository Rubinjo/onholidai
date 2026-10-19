import { z } from "zod";

import { componentBaseFields, componentPriceFields, moneySchema, currencySchema, travelComponentSchema } from "../../domain/trip/schema.ts";
import { publicComponentSchema, projectPublicComponent } from "../../domain/pricing/projections.ts";
import { publicSupplierText } from "../../lib/privacy.ts";

const discoveryPriceSchema = z.object({ ...componentPriceFields, currency: currencySchema.optional(),
  supplierAmount: moneySchema.nullable(), platformMargin: moneySchema.nullable(),
  customerPayableTaxes: moneySchema.nullable(), customerPayableFees: moneySchema.nullable(), finalCustomerAmount: moneySchema.nullable(),
}).strict();
function discoveryComponent<T extends z.ZodRawShape & { details: z.ZodType }>(option: z.ZodObject<T>) {
  return option.extend({ serviceStart: componentBaseFields.serviceStart.nullable(), serviceEnd: componentBaseFields.serviceEnd.nullable(),
    cancellationTerms: componentBaseFields.cancellationTerms.nullable(), details: z.nullable<T["details"]>(option.shape.details), price: discoveryPriceSchema });
}
const planningOfferFields = {
  offerRef: z.uuid().optional(),
  revision: z.number().int().positive().optional(),
  sourceMode: z.enum(["deterministic", "live", "unknown"]).default("unknown"),
  queryFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  partyFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  evidence: z.object({
    status: z.enum(["estimated", "quoted", "live_revalidated", "expired"]),
    availability: z.enum(["available", "unavailable", "unknown"]),
    checkedAt: componentBaseFields.checkedAt.nullable(),
    expiresAt: componentBaseFields.expiresAt,
  }).strict().optional(),
  supplierReferences: z.object({
    accommodationId: z.string().max(256).optional(), searchResultId: z.string().max(256).optional(),
    roomId: z.string().max(256).optional(), rateId: z.string().max(256).optional(), quoteId: z.string().max(256).optional(),
    productCode: z.string().max(256).optional(), optionCode: z.string().max(256).optional(),
    availabilityId: z.string().max(256).optional(),
  }).strict().optional(),
  selectionGroup: z.string().trim().min(1).max(120).optional(),
  component: z.discriminatedUnion("type", [
    discoveryComponent(travelComponentSchema.options[0]), discoveryComponent(travelComponentSchema.options[1]),
    discoveryComponent(travelComponentSchema.options[2]), discoveryComponent(travelComponentSchema.options[3]),
    discoveryComponent(travelComponentSchema.options[4]),
  ]),
  eligibility: z.object({ status: z.enum(["eligible", "ineligible", "unverified"]),
    minimumAge: z.number().int().nonnegative().nullable(), maximumAge: z.number().int().nonnegative().nullable() }).strict(),
  occupancy: z.object({ maximumAdults: z.number().int().positive().nullable(),
    maximumChildren: z.number().int().nonnegative().nullable() }).strict(),
  accessibility: z.enum(["verified", "unverified", "unsupported"]),
  attribution: z.object({ provider: componentBaseFields.provider,
    sourceUrl: z.url().nullable() }).strict(),
  unverifiedFacts: z.array(z.enum(["eligibility", "occupancy", "accessibility", "terms", "details", "dates", "price", "taxes", "fees"])).max(9),
};

export const planningOfferSchema = z.object(planningOfferFields).strict().superRefine((offer, context) => {
  if (offer.component.bookingStatus !== "unbooked"
    || !["estimated", "quoted", "expired"].includes(offer.component.price.status)) {
    context.addIssue({ code: "custom", path: ["component"], message: "Planning search cannot imply a booking or live confirmation" });
  }
  if (offer.attribution.provider !== offer.component.provider) {
    context.addIssue({ code: "custom", path: ["attribution"], message: "Offer source attribution must match its provider" });
  }
  const component = offer.component;
  if (component.serviceStart !== null && component.serviceEnd !== null
    && Date.parse(component.serviceEnd) <= Date.parse(component.serviceStart)) {
    context.addIssue({ code: "custom", path: ["component", "serviceEnd"], message: "Service dates must be ordered" });
  }
  const amounts = [component.price.supplierAmount, component.price.platformMargin,
    component.price.customerPayableTaxes, component.price.customerPayableFees, component.price.finalCustomerAmount];
  const known = amounts.filter((amount) => amount !== null);
  if ((!known.length && !component.price.currency)
    || known.some((amount) => amount.currency !== (component.price.currency ?? known[0].currency))) {
    context.addIssue({ code: "custom", path: ["component", "price"], message: "Price currencies must match" });
  }
  if (offer.evidence?.status === "live_revalidated" && (offer.sourceMode !== "live" || !offer.evidence.checkedAt)) {
    context.addIssue({ code: "custom", path: ["evidence"], message: "Live revalidation requires current live source evidence" });
  }
  if (amounts.every((amount) => amount !== null) && component.price.finalCustomerAmount !== null
    && amounts.slice(0, 4).reduce((sum, amount) => sum + (amount?.minorUnits ?? 0), 0) !== component.price.finalCustomerAmount.minorUnits) {
    context.addIssue({ code: "custom", path: ["component", "price"], message: "Price parts must equal the total" });
  }
  if (offer.eligibility.minimumAge !== null && offer.eligibility.maximumAge !== null
    && offer.eligibility.maximumAge < offer.eligibility.minimumAge) {
    context.addIssue({ code: "custom", path: ["eligibility"], message: "Eligibility age bounds must be ordered" });
  }
});

export type PlanningOffer = z.infer<typeof planningOfferSchema>;
export type CompletePlanningOffer = Omit<PlanningOffer, "component"> & { component: z.infer<typeof travelComponentSchema> };
export function materializePlanningOffer(raw: unknown): CompletePlanningOffer {
  const offer = normalizePlanningOffer(raw);
  const { currency: _currency, ...price } = offer.component.price; void _currency;
  return { ...offer, component: travelComponentSchema.parse({ ...offer.component, price }) };
}
export function isCompletePlanningOffer(offer: PlanningOffer): offer is CompletePlanningOffer {
  const { currency: _currency, ...price } = offer.component.price; void _currency;
  return travelComponentSchema.safeParse({ ...offer.component, price }).success;
}
const publicDiscoveryPriceSchema = z.object({
  currency: currencySchema, finalCustomerMinor: z.number().int().nonnegative().nullable(),
  taxesMinor: z.number().int().nonnegative().nullable(), feesMinor: z.number().int().nonnegative().nullable(),
  status: componentPriceFields.status, checkedAt: componentPriceFields.checkedAt, expiresAt: componentPriceFields.expiresAt,
}).strict();
function publicDiscoveryComponent<T extends z.ZodRawShape & { details: z.ZodType }>(option: z.ZodObject<T>) {
  return option.extend({ serviceStart: componentBaseFields.serviceStart.nullable(), serviceEnd: componentBaseFields.serviceEnd.nullable(),
    cancellationTerms: componentBaseFields.cancellationTerms.nullable(), details: z.nullable<T["details"]>(option.shape.details), price: publicDiscoveryPriceSchema });
}
export const publicPlanningOfferSchema = z.object({
  ...planningOfferFields,
  component: z.discriminatedUnion("type", [
    publicDiscoveryComponent(publicComponentSchema.options[0]), publicDiscoveryComponent(publicComponentSchema.options[1]),
    publicDiscoveryComponent(publicComponentSchema.options[2]), publicDiscoveryComponent(publicComponentSchema.options[3]),
    publicDiscoveryComponent(publicComponentSchema.options[4]),
  ]),
}).strict();
export type PublicPlanningOffer = z.infer<typeof publicPlanningOfferSchema>;

export function projectPublicPlanningOffer(rawOffer: unknown, now = new Date()): PublicPlanningOffer {
  const offer = normalizePlanningOffer(rawOffer, now);
  const sourceUrl = offer.attribution.sourceUrl === null ? null : new URL(offer.attribution.sourceUrl);
  const safeUrl = sourceUrl !== null && ["https:", "http:"].includes(sourceUrl.protocol)
    && sourceUrl.username === "" && sourceUrl.password === ""
    && publicSupplierText(sourceUrl.href) === sourceUrl.href ? sourceUrl.href : null;
  return publicPlanningOfferSchema.parse({
    ...offer,
    ...(offer.supplierReferences ? { supplierReferences: safeFacts(offer.supplierReferences) } : {}),
    ...(offer.selectionGroup ? { selectionGroup: publicSupplierText(offer.selectionGroup) } : {}),
    component: projectDiscoveryComponent(offer),
    eligibility: offer.eligibility,
    occupancy: offer.occupancy,
    accessibility: offer.accessibility,
    attribution: { provider: publicSupplierText(offer.attribution.provider), sourceUrl: safeUrl },
    unverifiedFacts: offer.unverifiedFacts,
  });
}

function safeFacts(value: unknown): unknown {
  if (typeof value === "string") return publicSupplierText(value);
  if (Array.isArray(value)) return value.map(safeFacts);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeFacts(item)]));
  return value;
}
function projectDiscoveryComponent(offer: PlanningOffer) {
  if (isCompletePlanningOffer(offer)) return projectPublicComponent(offer.component);
  const { price, ...component } = offer.component;
  const currency = price.finalCustomerAmount?.currency ?? price.currency ?? price.supplierAmount?.currency
    ?? price.customerPayableTaxes?.currency ?? price.customerPayableFees?.currency;
  return { ...safeComponentFacts(component), price: { currency,
    finalCustomerMinor: price.finalCustomerAmount?.minorUnits ?? null,
    taxesMinor: price.customerPayableTaxes?.minorUnits ?? null, feesMinor: price.customerPayableFees?.minorUnits ?? null,
    status: price.status, checkedAt: price.checkedAt, expiresAt: price.expiresAt } };
}
function safeComponentFacts(component: Omit<PlanningOffer["component"], "price">): Record<string, unknown> {
  return { ...component, provider: publicSupplierText(component.provider), supplierOfferId: publicSupplierText(component.supplierOfferId),
    cancellationTerms: component.cancellationTerms === null ? null : publicSupplierText(component.cancellationTerms),
    bookingRequirements: component.bookingRequirements.map(publicSupplierText),
    details: safeFacts(component.details), ...(component.planningDetails ? { planningDetails: safeFacts(component.planningDetails) } : {}) };
}

export function normalizePlanningOffer(rawOffer: unknown, now = new Date()): PlanningOffer {
  const offer = planningOfferSchema.parse(rawOffer);
  const unverified = new Set(offer.unverifiedFacts);
  if (offer.eligibility.status === "unverified") unverified.add("eligibility");
  if (offer.occupancy.maximumAdults === null || offer.occupancy.maximumChildren === null) unverified.add("occupancy");
  if (offer.accessibility === "unverified") unverified.add("accessibility");
  if (offer.component.serviceStart === null || offer.component.serviceEnd === null) unverified.add("dates");
  if (offer.component.details === null) unverified.add("details");
  if (offer.component.cancellationTerms === null) unverified.add("terms");
  if (offer.component.price.finalCustomerAmount === null) unverified.add("price");
  if (offer.component.price.customerPayableTaxes === null) unverified.add("taxes");
  if (offer.component.price.customerPayableFees === null) unverified.add("fees");
  const expiry = [offer.component.expiresAt, offer.component.price.expiresAt]
    .filter((value): value is string => value !== null);
  const expired = offer.component.offerStatus === "expired" || offer.component.price.status === "expired"
    || expiry.some((value) => Date.parse(value) <= now.getTime());
  return planningOfferSchema.parse({ ...offer, unverifiedFacts: [...unverified],
    ...(offer.evidence ? { evidence: { ...offer.evidence, status: expired ? "expired" : offer.evidence.status } } : {}),
    component: { ...offer.component, offerStatus: expired ? "expired" : offer.component.offerStatus,
      price: { ...offer.component.price, status: expired ? "expired" : offer.component.price.status } } });
}
