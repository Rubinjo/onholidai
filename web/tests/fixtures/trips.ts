import { tripSnapshotSchema, type TripSnapshot } from "../../domain/trip/schema";

const availabilityWindowId = "10000000-0000-4000-8000-000000000001";
const constraintId = "10000000-0000-4000-8000-000000000002";
const destinationId = "10000000-0000-4000-8000-000000000003";
const itineraryItemIds = [
  "10000000-0000-4000-8000-000000000004",
  "10000000-0000-4000-8000-000000000005",
  "10000000-0000-4000-8000-000000000006",
] as const;

export const syntheticTripSnapshot: Readonly<TripSnapshot> = tripSnapshotSchema.parse({
  departureOrigin: {
    kind: "airport",
    placeId: "synthetic-place-gb-lhr",
    name: "Synthetic London Airport",
    countryCode: "GB",
    timezone: "Europe/London",
    airportCode: "LHR",
    confirmedByUser: true,
  },
  availabilityWindows: [
    {
      id: availabilityWindowId,
      startDate: "2030-05-01",
      endDate: "2030-05-10",
      preference: "preferred",
      timezone: "Europe/Lisbon",
    },
  ],
  duration: { minimumDays: 5, idealDays: 7, maximumDays: 8 },
  travellerParty: { adults: 2, children: [] },
  preferences: {
    pace: 50,
    spend: 45,
    discovery: 70,
    independence: 60,
    setting: 40,
  },
  constraints: [
    {
      id: constraintId,
      category: "dietary",
      statement: "Synthetic vegetarian meal requirement",
      priority: "required",
      source: { kind: "setup_text", referenceId: null },
      status: "active",
      confirmedByUser: true,
    },
  ],
  destinations: [
    {
      id: destinationId,
      kind: "city",
      name: "Lisbon",
      countryCode: "PT",
      providerPlaceIds: { synthetic: "synthetic-place-pt-lis" },
      location: { latitude: 38.7223, longitude: -9.1393 },
      routePosition: 0,
      arrivalDate: "2030-05-01",
      departureDate: "2030-05-08",
      plannedNights: 7,
    },
  ],
  itineraryDays: [
    {
      date: "2030-05-02",
      destinationId,
      timezone: "Europe/Lisbon",
      paceAssessment: 50,
      items: [
        {
          id: itineraryItemIds[0],
          type: "meal",
          start: "2030-05-02T08:00",
          end: "2030-05-02T08:45",
          location: null,
          componentId: null,
          constraintChecks: [constraintId],
          status: "planned",
          travelSegment: null,
        },
        {
          id: itineraryItemIds[1],
          type: "activity",
          start: "2030-05-02T10:00",
          end: "2030-05-02T12:00",
          location: { latitude: 38.7139, longitude: -9.1335 },
          componentId: null,
          constraintChecks: [],
          status: "planned",
          travelSegment: null,
        },
        {
          id: itineraryItemIds[2],
          type: "free_time",
          start: "2030-05-02T15:00",
          end: "2030-05-02T16:00",
          location: null,
          componentId: null,
          constraintChecks: [],
          status: "planned",
          travelSegment: null,
        },
      ],
    },
  ],
  components: [],
  price: {
    currency: "GBP",
    supplierTotal: { currency: "GBP", minorUnits: 0 },
    platformMarginTotal: { currency: "GBP", minorUnits: 0 },
    customerPayableTaxesTotal: { currency: "GBP", minorUnits: 0 },
    customerPayableFeesTotal: { currency: "GBP", minorUnits: 0 },
    finalCustomerTotal: { currency: "GBP", minorUnits: 0 },
    status: "estimated",
    checkedAt: "2029-11-01T12:00:00Z",
    conversionDisclosures: [],
  },
  warnings: [],
});

export function createSyntheticTripSnapshot(): TripSnapshot {
  return structuredClone(syntheticTripSnapshot);
}
