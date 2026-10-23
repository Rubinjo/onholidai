import { createHash } from "node:crypto";

import { z } from "zod";

import {
  BOOKING_COVERAGE_POLICY,
  bookingOccupancySchema,
  type BookingCoverageReport,
} from "../booking/public";
import { evaluateFeasibility } from "./feasibility";
import { constraintEvidenceSchema, verificationSchema } from "./itinerary";

import type { TripSnapshot } from "./schema";

export {
  BOOKING_COVERAGE_POLICY,
  bookingCoverageEntrySchema,
  bookingCoverageReportSchema,
  type BookingCoverageReport,
} from "../booking/public";
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const opaqueReadinessSchema = z
  .object({
    reference: z.string().min(1).max(256),
    version: z.string().min(1).max(120),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const verifiedBookingDispositionSchema = opaqueReadinessSchema
  .extend({
    itemId: z.uuid(),
    source: z.string().min(1).max(500),
  })
  .strict();

// Only trusted server reads or durable confirmations can supply this evidence.
// Accepted planning labels and client acknowledgements are not substitutes.
export const bookingCoverageEvidenceSchema = z
  .object({
    componentId: z.uuid(),
    provider: z.string().min(1).max(120),
    supplierOfferId: z.string().min(1).max(256),
    inventoryId: z.string().min(1).max(256),
    serviceStart: z.iso.datetime({ offset: true }),
    serviceEnd: z.iso.datetime({ offset: true }),
    travellerIds: z.array(z.uuid()).min(1).max(10),
    requirementIds: z.array(z.string().min(1).max(256)).min(1).max(768),
    destinationId: z.uuid().nullable(),
    finalCustomerMinor: money,
    currency: z.string().regex(/^[A-Z]{3}$/),
    checkedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
    finalTermsVerified: z.boolean(),
    taxesFeesKnown: z.boolean(),
    eligibility: verificationSchema,
    availability: verificationSchema,
    accessibility: verificationSchema,
    constraintEvidence: z.array(constraintEvidenceSchema).max(64),
    bookingSupported: z.boolean(),
    occupancy: bookingOccupancySchema,
    travellerReadiness: opaqueReadinessSchema.nullable(),
    paymentReadiness: opaqueReadinessSchema.nullable(),
    confirmationId: z.string().min(1).max(256).nullable(),
  })
  .strict();
export type BookingCoverageEvidence = z.infer<typeof bookingCoverageEvidenceSchema>;
type Entry = BookingCoverageReport["entries"][number];
type Issue = Entry["issues"][number];
type Component = TripSnapshot["components"][number];
type Item = TripSnapshot["itineraryDays"][number]["items"][number];
type Requirement = Pick<Entry, "requirementId" | "kind" | "sourceRefs"> & {
  componentIds: string[];
  destinationId?: string;
  night?: string;
  item?: Item;
  unknownClassification?: boolean;
  notRequired?: boolean;
  constraintId?: string;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(
        ([key, entry]) =>
          entry !== undefined && !["checkedAt", "freshnessAt", "updatedAt"].includes(key),
      )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function sameSet(left: string[], right: string[]): boolean {
  return (
    new Set(left).size === left.length && stable([...left].sort()) === stable([...right].sort())
  );
}
function localDate(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}
function issue(code: string, message: string, relatedIds: string[] = []): Issue {
  return { code, message, relatedIds };
}
const supportedProducts: Record<string, string> = {
  flight: "duffel",
  accommodation: "nuitee",
  activity: "viator",
};

export function deriveBookingCoverage(
  snapshot: TripSnapshot,
  input: {
    tripVersion: number;
    evidence?: readonly BookingCoverageEvidence[];
    now?: Date;
    verifiedDispositions?: readonly z.infer<typeof verifiedBookingDispositionSchema>[];
  },
): BookingCoverageReport {
  const now = input.now ?? new Date();
  const evidence = (input.evidence ?? []).map((entry) =>
    bookingCoverageEvidenceSchema.parse(entry),
  );
  const evidenceById = new Map(evidence.map((entry) => [entry.componentId, entry]));
  const componentsById = new Map(snapshot.components.map((entry) => [entry.id, entry]));
  const items = snapshot.itineraryDays.flatMap((day) =>
    day.items.filter((item) => item.status !== "cancelled").map((item) => ({ day, item })),
  );
  const destinations = [...snapshot.destinations].sort((a, b) => a.routePosition - b.routePosition);
  const requirements: Requirement[] = [];
  const issues: Issue[] = [];
  if (evidenceById.size !== evidence.length)
    issues.push(issue("booking_evidence_duplicate", "Resolve conflicting component evidence."));
  if (!snapshot.departureOrigin?.confirmedByUser)
    issues.push(
      issue("booking_origin_unconfirmed", "Confirm the departure origin before booking."),
    );
  if (destinations.some((entry) => !entry.arrivalDate || !entry.departureDate))
    issues.push(issue("booking_route_unscheduled", "Schedule every destination before booking."));
  const aliases = (destination: (typeof destinations)[number]) => [
    destination.id,
    ...Object.values(destination.providerPlaceIds),
  ];
  const routeItems = new Set<string>();
  function leg(
    id: string,
    from: string[],
    to: string[],
    date: string | null,
    sourceRefs: string[],
    returning: boolean,
  ) {
    const linked = items.filter(({ item }) => {
      const segment = item.travelSegment;
      return (
        segment &&
        from.includes(segment.origin.placeId) &&
        to.includes(segment.destination.placeId) &&
        (returning ? segment.plannedDeparture : segment.plannedArrival).slice(0, 10) === date
      );
    });
    linked.forEach(({ item }) => routeItems.add(item.id));
    requirements.push({
      requirementId: id,
      kind: "transport",
      sourceRefs,
      componentIds: [
        ...new Set(linked.flatMap(({ item }) => (item.componentId ? [item.componentId] : []))),
      ],
      ...(linked.length === 1 ? { item: linked[0].item } : {}),
    });
  }
  const first = destinations[0],
    last = destinations.at(-1);
  if (first && snapshot.departureOrigin) {
    leg(
      "transport:outbound",
      [snapshot.departureOrigin.placeId],
      aliases(first),
      first.arrivalDate,
      ["departureOrigin", `destinations/${first.id}`],
      false,
    );
    if (last)
      leg(
        "transport:return",
        aliases(last),
        [snapshot.departureOrigin.placeId],
        last.departureDate,
        [`destinations/${last.id}`, "departureOrigin"],
        true,
      );
  }
  for (let index = 1; index < destinations.length; index++) {
    const before = destinations[index - 1],
      after = destinations[index];
    leg(
      `transport:intercity:${before.id}:${after.id}`,
      aliases(before),
      aliases(after),
      after.arrivalDate,
      [`destinations/${before.id}`, `destinations/${after.id}`],
      false,
    );
  }
  for (const destination of destinations) {
    if (!destination.arrivalDate || !destination.departureDate) continue;
    const start = Date.parse(destination.arrivalDate),
      end = Date.parse(destination.departureDate);
    for (let date = start; date < end; date += 86_400_000) {
      const night = new Date(date).toISOString().slice(0, 10);
      const ids = snapshot.components
        .filter(
          (component) =>
            component.type === "accommodation" &&
            localDate(component.serviceStart, destination.timezone ?? "UTC") <= night &&
            localDate(component.serviceEnd, destination.timezone ?? "UTC") > night &&
            (evidenceById.get(component.id)?.destinationId === destination.id ||
              component.planningDetails?.locationName === destination.name),
        )
        .map((component) => component.id);
      requirements.push({
        requirementId: `accommodation:${destination.id}:${night}`,
        kind: "accommodation",
        sourceRefs: [`destinations/${destination.id}`, `night/${night}`],
        componentIds: ids,
        destinationId: destination.id,
        night,
      });
    }
  }
  for (const { item } of items) {
    const requiredTransport =
      item.type === "travel" &&
      item.travelSegment &&
      !["walk", "drive"].includes(item.travelSegment.mode);
    if (requiredTransport && routeItems.has(item.id)) continue;
    if (item.type !== "activity" && !requiredTransport) continue;
    const component = item.componentId ? componentsById.get(item.componentId) : undefined;
    const disposition = input.verifiedDispositions?.find(
      (entry) =>
        entry.itemId === item.id &&
        entry.source === item.bookingDispositionEvidence?.source &&
        entry.reference &&
        entry.version &&
        /^[a-f0-9]{64}$/.test(entry.fingerprint),
    );
    const notRequired =
      !component &&
      item.bookingDisposition === "not_required" &&
      item.bookingDispositionEvidence?.verificationStatus === "verified" &&
      Boolean(disposition);
    requirements.push({
      requirementId: `${requiredTransport ? "transport:item" : "activity"}:${item.id}`,
      kind: requiredTransport ? "transport" : "activity",
      sourceRefs: [`itineraryItems/${item.id}`],
      componentIds: item.componentId ? [item.componentId] : [],
      item,
      notRequired,
      unknownClassification:
        !item.componentId && !notRequired && item.bookingDisposition !== "required",
    });
  }
  for (const constraint of snapshot.constraints.filter(
    (entry) =>
      entry.status !== "removed" &&
      entry.priority === "required" &&
      /\b(rail|train)\b/i.test(entry.statement),
  )) {
    requirements.push({
      requirementId: `transport:constraint:${constraint.id}`,
      kind: "transport",
      sourceRefs: [`constraints/${constraint.id}`],
      constraintId: constraint.id,
      componentIds: snapshot.components
        .filter(
          (component) =>
            component.type === "rail" &&
            evidenceById
              .get(component.id)
              ?.constraintEvidence.some(
                (entry) => entry.constraintId === constraint.id && entry.status === "verified",
              ),
        )
        .map((component) => component.id),
    });
  }
  function componentIssues(
    component: Component,
    proof: BookingCoverageEvidence | undefined,
  ): Issue[] {
    const ids = [component.id],
      result: Issue[] = [];
    const add = (code: string, message: string) => result.push(issue(code, message, ids));
    if (!proof)
      return [
        issue("booking_evidence_missing", "Current trusted booking evidence is unavailable.", ids),
      ];
    if (
      proof.provider !== component.provider ||
      proof.supplierOfferId !== component.supplierOfferId ||
      proof.serviceStart !== component.serviceStart ||
      proof.serviceEnd !== component.serviceEnd ||
      !sameSet(proof.travellerIds, component.travellerIds)
    )
      add("booking_evidence_mismatch", "Booking evidence does not match the accepted component.");
    if (component.bookingStatus !== "confirmed" && proof.currency !== snapshot.price.currency)
      add("booking_currency_mismatch", "Resolve customer payment currency before booking.");
    const confirmed = component.bookingStatus === "confirmed" && Boolean(proof.confirmationId);
    if (component.bookingStatus === "confirmed" && !confirmed)
      add("booking_confirmation_unproven", "A durable matching confirmation is required.");
    if (!confirmed && component.bookingStatus !== "unbooked")
      add(
        "booking_commitment_unresolved",
        "Resolve the existing booking outcome before any new action.",
      );
    if (!confirmed) {
      if (Date.parse(proof.checkedAt) > now.getTime())
        add("booking_evidence_future", "Booking evidence has an unverified future check time.");
      if (supportedProducts[component.type] !== component.provider || !proof.bookingSupported)
        add(
          "booking_product_unsupported",
          "This required product is not available for authorized booking.",
        );
      if (!proof.expiresAt || Date.parse(proof.expiresAt) <= now.getTime())
        add("booking_evidence_expired", "Current booking evidence has expired.");
      if (!proof.finalTermsVerified)
        add("booking_final_terms_unverified", "Safe final checkout terms have not been verified.");
      if (!proof.taxesFeesKnown)
        add(
          "booking_mandatory_costs_unknown",
          "Verify all mandatory customer taxes, fees and property charges.",
        );
      if (proof.eligibility !== "verified" || proof.availability !== "verified")
        add("booking_eligibility_unverified", "Verify availability and traveller eligibility.");
      if (!proof.travellerReadiness)
        add("booking_travellers_not_ready", "Trusted traveller details are not ready for booking.");
      if (!proof.paymentReadiness)
        add("booking_payment_not_ready", "An approved trusted payment source is not ready.");
    }
    for (const constraint of snapshot.constraints.filter(
      (entry) =>
        entry.priority === "required" &&
        entry.status !== "removed" &&
        (["accessibility", "schedule", "other"].includes(entry.category) ||
          (entry.category === "lodging" && component.type === "accommodation") ||
          (entry.category === "transport" &&
            ["flight", "rail", "transfer"].includes(component.type)) ||
          (entry.category === "dietary" && component.type === "activity")),
    )) {
      if (
        proof.constraintEvidence.find((entry) => entry.constraintId === constraint.id)?.status !==
          "verified" ||
        (constraint.category === "accessibility" && proof.accessibility !== "verified")
      )
        add(
          "booking_constraint_unverified",
          "A required booking constraint has not been verified.",
        );
    }
    return result;
  }
  const entries: Entry[] = requirements.map((requirement) => {
    const base = {
      requirementId: requirement.requirementId,
      kind: requirement.kind,
      sourceRefs: requirement.sourceRefs,
      componentIds: [...new Set(requirement.componentIds)].sort(),
    };
    if (requirement.notRequired) return { ...base, state: "not_required", issues: [] };
    if (requirement.unknownClassification)
      return {
        ...base,
        state: "covered_unverified",
        issues: [
          issue(
            "booking_classification_unknown",
            "Establish whether this accepted activity or transfer needs booking.",
            requirement.item ? [requirement.item.id] : [],
          ),
        ],
      };
    const candidates = base.componentIds
      .map((id) => componentsById.get(id))
      .filter((entry) => entry !== undefined);
    if (!candidates.length)
      return {
        ...base,
        state: "missing",
        issues: [
          issue(
            "booking_requirement_missing",
            "A required trip service is missing.",
            base.componentIds,
          ),
        ],
      };
    const entryIssues = candidates.flatMap((component) =>
      componentIssues(component, evidenceById.get(component.id)),
    );
    for (const component of candidates) {
      const proof = evidenceById.get(component.id);
      if (proof && !proof.requirementIds.includes(requirement.requirementId))
        entryIssues.push(
          issue(
            "booking_mapping_unverified",
            "Verify this component against the full required service.",
            [component.id],
          ),
        );
      if (
        requirement.kind === "accommodation" &&
        proof?.destinationId !== requirement.destinationId
      )
        entryIssues.push(
          issue("booking_stay_location_unverified", "Verify the property's accepted destination.", [
            component.id,
          ]),
        );
      if (requirement.item?.travelSegment && component.type !== requirement.item.travelSegment.mode)
        entryIssues.push(
          issue(
            "booking_transport_mismatch",
            "The component does not match the required transport mode.",
            [component.id],
          ),
        );
      if (requirement.kind === "activity" && component.type !== "activity")
        entryIssues.push(
          issue(
            "booking_activity_mismatch",
            "The component does not match the required activity.",
            [component.id],
          ),
        );
    }
    const proofs = candidates.map((component) => evidenceById.get(component.id));
    const partyIds = proofs.flatMap((proof) => proof?.travellerIds ?? []);
    const requiredPartyCount =
      snapshot.travellerParty.adults + snapshot.travellerParty.children.length;
    if (
      new Set(partyIds).size !== requiredPartyCount ||
      new Set(partyIds).size !== partyIds.length ||
      snapshot.travellerParty.children.some((child) => !partyIds.includes(child.id))
    )
      entryIssues.push(
        issue(
          "booking_party_incomplete",
          "Cover each member of the accepted party exactly once.",
          base.componentIds,
        ),
      );
    if (requirement.kind === "accommodation") {
      const occupancies = proofs.map((proof) => {
        if (!proof?.confirmationId) return proof?.occupancy;
        return (
          proof.occupancy ?? {
            adults: proof.travellerIds.filter(
              (id) => !snapshot.travellerParty.children.some((child) => child.id === id),
            ).length,
            childAges: snapshot.travellerParty.children
              .filter((child) => proof.travellerIds.includes(child.id))
              .map((child) => child.ageAtTripStart),
          }
        );
      });
      const children = occupancies.flatMap((entry) => entry?.childAges ?? []).sort((a, b) => a - b);
      if (
        occupancies.some((entry) => !entry) ||
        occupancies.reduce((sum, entry) => sum + (entry?.adults ?? 0), 0) !==
          snapshot.travellerParty.adults ||
        stable(children) !==
          stable(
            snapshot.travellerParty.children
              .map((child) => child.ageAtTripStart)
              .sort((a, b) => a - b),
          )
      )
        entryIssues.push(
          issue(
            "booking_room_party_incomplete",
            "Verify all rooms, adults and child ages for every required night.",
            base.componentIds,
          ),
        );
    }
    return {
      ...base,
      state: entryIssues.length
        ? "blocked"
        : candidates.every((component) => component.bookingStatus === "confirmed")
          ? "confirmed"
          : "eligible_unbooked",
      issues: entryIssues,
    };
  });
  const usedIds = new Set(entries.flatMap((entry) => entry.componentIds));
  for (const component of snapshot.components)
    if (!usedIds.has(component.id))
      issues.push(
        issue(
          "booking_component_unmapped",
          "Resolve an accepted component not mapped to a trip requirement.",
          [component.id],
        ),
      );
  // The planning oracle rejects commitments and multi-service bundles by design.
  // For booking, validate their individual scheduled services without mutating the trip.
  const bundledIds = new Set(
    snapshot.components
      .filter(
        (component) => items.filter(({ item }) => item.componentId === component.id).length > 1,
      )
      .map((component) => component.id),
  );
  const feasibilitySnapshot: TripSnapshot = {
    ...snapshot,
    itineraryDays: snapshot.itineraryDays.map((day) => ({
      ...day,
      items: day.items.map((item) =>
        item.componentId && bundledIds.has(item.componentId)
          ? { ...item, componentId: item.id }
          : item,
      ),
    })),
    components: snapshot.components.flatMap((component) => {
      const scheduled = items.filter(({ item }) => item.componentId === component.id);
      const projection = { ...component, bookingStatus: "unbooked" as const };
      if (scheduled.length <= 1) return [projection];
      return scheduled.map(({ item, day }) => ({
        ...projection,
        id: item.id,
        serviceStart:
          item.travelSegment?.plannedDeparture ?? `${item.start}${item.startOffset ?? "+00:00"}`,
        serviceEnd:
          item.travelSegment?.plannedArrival ?? `${item.end}${item.endOffset ?? "+00:00"}`,
        itineraryItemIds: [item.id],
        planningDetails: component.planningDetails
          ? { ...component.planningDetails, timezone: day.timezone }
          : undefined,
      }));
    }),
  };
  const feasibility = evaluateFeasibility(feasibilitySnapshot, now);
  issues.push(
    ...feasibility.blocking,
    ...feasibility.unverified.filter(
      (entry) =>
        !["offer_freshness", "component_details", "component_constraint"].includes(entry.code),
    ),
  );
  issues.push(...entries.flatMap((entry) => entry.issues));
  const toBookComponentIds = snapshot.components
    .filter((entry) => entry.bookingStatus !== "confirmed" && usedIds.has(entry.id))
    .map((entry) => entry.id)
    .sort();
  const confirmedComponentIds = snapshot.components
    .filter(
      (entry) => entry.bookingStatus === "confirmed" && evidenceById.get(entry.id)?.confirmationId,
    )
    .map((entry) => entry.id)
    .sort();
  const minorUnits = toBookComponentIds.reduce(
    (sum, id) => sum + (evidenceById.get(id)?.finalCustomerMinor ?? 0),
    0,
  );
  const payableKnown =
    toBookComponentIds.every((id) => {
      const proof = evidenceById.get(id);
      return proof && proof.taxesFeesKnown && proof.currency === snapshot.price.currency;
    }) && Number.isSafeInteger(minorUnits);
  if (!Number.isSafeInteger(minorUnits))
    issues.push(issue("booking_total_unsafe", "The payable total cannot be represented exactly."));
  const complete =
    entries.length > 0 &&
    issues.length === 0 &&
    entries.every((entry) =>
      ["eligible_unbooked", "confirmed", "not_required"].includes(entry.state),
    );
  const fingerprint = createHash("sha256")
    .update(
      stable({
        policyVersion: BOOKING_COVERAGE_POLICY,
        tripVersion: input.tripVersion,
        departureOrigin: snapshot.departureOrigin,
        party: snapshot.travellerParty,
        destinations: snapshot.destinations,
        constraints: snapshot.constraints,
        itineraryDays: snapshot.itineraryDays,
        components: snapshot.components.map(({ price, ...component }) => ({
          ...component,
          customerMoney: {
            finalCustomerAmount: price.finalCustomerAmount,
            customerPayableTaxes: price.customerPayableTaxes,
            customerPayableFees: price.customerPayableFees,
          },
        })),
        evidence: [...evidence].sort((a, b) => a.componentId.localeCompare(b.componentId)),
        dispositions: input.verifiedDispositions ?? [],
        entries,
        issues,
      }),
    )
    .digest("hex");
  return {
    policyVersion: BOOKING_COVERAGE_POLICY,
    tripVersion: input.tripVersion,
    fingerprint,
    entries,
    issues,
    complete,
    eligible: complete && toBookComponentIds.length > 0,
    toBookComponentIds,
    confirmedComponentIds,
    remainingPayable: {
      currency: snapshot.price.currency,
      minorUnits: payableKnown ? minorUnits : null,
    },
  };
}
