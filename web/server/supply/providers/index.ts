import { createDuffelReadProvider } from "./duffel-read";
import { createBookingReadProvider } from "./booking-read";
import { createGetYourGuideReadProvider } from "./getyourguide-read";
import { createTrainlineReadProvider } from "./trainline-read";
import { syntheticReadClient } from "./synthetic";
import type { SupplyReadProvider } from "../read";
export function createPlanningProviders(mode: "deterministic" | "live", live: readonly SupplyReadProvider[] = []): readonly SupplyReadProvider[] {
  if (mode === "live") return live; // Commercial HTTP/SDK clients must be explicitly injected; no fake live success.
  return [createDuffelReadProvider(syntheticReadClient("flight")), createBookingReadProvider(syntheticReadClient("accommodation")),
    createGetYourGuideReadProvider(syntheticReadClient("activity")), createTrainlineReadProvider(syntheticReadClient("rail"))];
}
