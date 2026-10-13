import { createHash } from "node:crypto";
import { canonicalJson } from "./commit";
import { applyDraftOperations } from "./operations";
import { tripSnapshotSchema, type TripSnapshot } from "./schema";
import { projectCustomerSnapshot } from "@/domain/pricing/projections";
import { ProblemError } from "@/server/errors";

export function previewDraftEdit(base: TripSnapshot, version: number, operations: readonly unknown[]) {
  if (base.components.some((component) => component.bookingStatus !== "unbooked")) {
    throw new ProblemError({ title: "Booked components require a separate workflow", status: 409, code: "protected_booking" });
  }
  const candidate = applyDraftOperations(base, operations, false);
  const changed = Object.keys(base).filter((key) => canonicalJson(base[key as keyof TripSnapshot]) !== canonicalJson(candidate[key as keyof TripSnapshot]));
  const scheduleChanged = changed.some((key) => ["destinations", "duration", "availabilityWindows"].includes(key));
  if (scheduleChanged) {
    const routedExplicitly = operations.some((entry) => (entry as { target?: string }).target === "/destinations")
      && candidate.destinations.every((destination) => destination.arrivalDate && destination.departureDate)
      && !changed.includes("duration") && !changed.includes("availabilityWindows");
    if (!routedExplicitly) {
      const window = candidate.availabilityWindows.find((entry) => entry.preference === "preferred") ?? candidate.availabilityWindows[0];
      let cursor = Date.parse(window.startDate + "T00:00:00Z");
      const nights = Math.floor((candidate.duration.idealDays - 1) / candidate.destinations.length), extra = (candidate.duration.idealDays - 1) % candidate.destinations.length;
      candidate.destinations = candidate.destinations.map((destination, index) => {
        const count = nights + (index < extra ? 1 : 0), arrivalDate = new Date(cursor).toISOString().slice(0, 10);
        cursor += count * 86400000;
        return { ...destination, routePosition: index, arrivalDate, departureDate: new Date(cursor).toISOString().slice(0, 10), plannedNights: count };
      });
    }
    candidate.itineraryDays = [];
  }
  const researchRequired = changed.some((key) => ["departureOrigin", "destinations", "duration", "availabilityWindows", "travellerParty", "preferences", "constraints", "components"].includes(key));
  if (researchRequired) {
    candidate.itineraryDays = [];
    candidate.components = candidate.components.map((component) => ({ ...component, itineraryItemIds: [], offerStatus: "expired", price: { ...component.price, status: "expired" } }));
    candidate.price.status = "expired";
  }
  const snapshot = tripSnapshotSchema.parse(candidate);
  const affectedFacts = [...new Set([...changed, ...(researchRequired ? ["route", "transport", "accommodation", "activities", "availability", "feasibility", "price"] : [])])];
  if (!affectedFacts.length) throw new ProblemError({ title: "No draft changes", status: 422, code: "empty_edit" });
  const fingerprint = createHash("sha256").update(canonicalJson({ version, operations, base, snapshot })).digest("hex");
  return { snapshot, fingerprint, affectedFacts, researchRequired, previewSnapshot: projectCustomerSnapshot(snapshot),
    priceImpact: { currency: base.price.currency, beforeMinor: base.price.finalCustomerTotal.minorUnits, afterMinor: snapshot.price.finalCustomerTotal.minorUnits, deltaMinor: 0 },
    scheduleImpact: { before: base.destinations.map((entry) => ({ id: entry.id, nights: entry.plannedNights, arrivalDate: entry.arrivalDate, departureDate: entry.departureDate })),
      after: snapshot.destinations.map((entry) => ({ id: entry.id, nights: entry.plannedNights, arrivalDate: entry.arrivalDate, departureDate: entry.departureDate })) },
    warnings: researchRequired ? ["Affected offers and daily recommendations require fresh read-only research. Old prices are expired until research completes.", "Eligibility, accessibility and feasibility remain unverified; no booking is available."] : [] };
}
