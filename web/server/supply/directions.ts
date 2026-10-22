import { travelSegmentSchema, type TripSnapshot } from "@/domain/trip/schema";
import { offsetMatches } from "@/domain/trip/feasibility-policy";
import { planningDetailsSchema, type PlanningDetails } from "@/domain/trip/itinerary";

export interface DirectionsReader {
  directions(query: {
    originPlaceId: string;
    destinationPlaceId: string;
    departure: string;
    mode: string;
  }): Promise<unknown>;
}
export async function readDirections(
  reader: DirectionsReader,
  query: Parameters<DirectionsReader["directions"]>[0],
) {
  const segment = travelSegmentSchema.parse(await reader.directions(query));
  if (
    segment.origin.placeId !== query.originPlaceId ||
    segment.destination.placeId !== query.destinationPlaceId ||
    segment.plannedDeparture !== query.departure ||
    segment.mode !== query.mode ||
    !offsetMatches(segment.plannedDeparture, segment.origin.timezone) ||
    !offsetMatches(segment.plannedArrival, segment.destination.timezone)
  )
    throw new Error("Invalid directions evidence");
  return segment;
}

export function componentDetails(component: TripSnapshot["components"][number]): PlanningDetails {
  if (component.planningDetails) return planningDetailsSchema.parse(component.planningDetails);
  return planningDetailsSchema.parse({
    locationName: null,
    timezone: null,
    airportNames: [],
    airlines: [],
    flightDirection: null,
    durationMinutes: component.type === "activity" ? component.details.durationMinutes : null,
    layovers: [],
    fareConditions: null,
    accommodationType: null,
    travelFromStayMinutes: null,
    eligibility: "unverified",
    accessibility: "unverified",
    availability: "unverified",
    constraintEvidence: [],
    source: component.provider,
    checkedAt: component.checkedAt,
    unavailableFacts: [
      "Detailed supplier facts unavailable",
      "Eligibility",
      "Accessibility",
      "Availability",
      "Travel from stay",
    ],
  });
}
