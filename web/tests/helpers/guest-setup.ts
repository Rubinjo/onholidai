import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { emptySetupDraft } from "../../components/trip-setup/draft-schema";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
export function validSetupPayload() {
  const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
  return { ...emptySetupDraft(), title: "Synthetic guest holiday", currency: "GBP",
    departureOrigin: snapshot.departureOrigin ?? null, destinations: snapshot.destinations,
    availabilityWindows: snapshot.availabilityWindows, duration: snapshot.duration,
    travellerParty: snapshot.travellerParty, preferences: snapshot.preferences, constraints: snapshot.constraints };
}
