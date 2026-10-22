import { projectCustomerSnapshot } from "@/domain/pricing/projections";
import { runConflict } from "@/server/agent-client/run-repository";

import { applyDraftOperations } from "./operations";
import { evaluateFeasibility } from "./feasibility";
import { tripSnapshotSchema, type TripSnapshot } from "./schema";

export function previewFinalization(base: TripSnapshot, operations: readonly unknown[]) {
  // This flow changes daily planning only. Trusted components/prices/terms stay
  // web-owned; LLM assertions cannot become verified supplier evidence.
  if (operations.some((entry) => (entry as { target?: string }).target !== "/itineraryDays"))
    runConflict();
  const candidate = applyDraftOperations(base, operations, false);
  candidate.itineraryDays = tripSnapshotSchema.shape.itineraryDays.parse(candidate.itineraryDays);
  candidate.itineraryDays = candidate.itineraryDays.map((day) => ({
    ...day,
    items: day.items.map((item) => ({
      ...item,
      status: item.status === "cancelled" ? ("cancelled" as const) : ("planned" as const),
      verificationStatus: "unverified" as const,
      constraintEvidence: [],
      transitionFromPrevious: undefined,
      travelSegment: item.travelSegment
        ? {
            ...item.travelSegment,
            verificationStatus: "unverified" as const,
            providerArrivalMinutes: undefined,
            connectionMinimumMinutes: null,
          }
        : null,
    })),
  }));
  candidate.components = candidate.components.map((component) => ({
    ...component,
    itineraryItemIds: candidate.itineraryDays.flatMap((day) =>
      day.items.filter((item) => item.componentId === component.id).map((item) => item.id),
    ),
  }));
  const snapshot = tripSnapshotSchema.parse(candidate),
    report = evaluateFeasibility(snapshot);
  const schedule = base.destinations.map((entry) => ({
    id: entry.id,
    nights: entry.plannedNights,
    arrivalDate: entry.arrivalDate,
    departureDate: entry.departureDate,
  }));
  return {
    snapshot,
    previewSnapshot: projectCustomerSnapshot(snapshot),
    affectedFacts: ["itineraryDays", "feasibility"],
    priceImpact: {
      currency: base.price.currency,
      beforeMinor: base.price.finalCustomerTotal.minorUnits,
      afterMinor: snapshot.price.finalCustomerTotal.minorUnits,
      deltaMinor: 0,
    },
    scheduleImpact: { before: schedule, after: schedule },
    warnings: [
      ...report.blocking.map((entry) => "Blocking: " + entry.message),
      ...report.unverified.map((entry) => "Unverified: " + entry.message),
      ...report.exceptions.map((entry) => "Exception: " + entry.message),
    ].slice(0, 64),
  };
}
