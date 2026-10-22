import type { TripEnvelope } from "./use-trip";

export function ItineraryList({ trip }: { trip: TripEnvelope }) {
  // tabIndex keeps the scrollable fallback reachable for keyboard users on short viewports.
  return (
    <section
      data-trip-version={trip.version}
      className="trip-workspace__route-list"
      tabIndex={0}
      aria-label="Accessible route"
    >
      <h2>Route and itinerary</h2>
      <p>
        Version {trip.version}. Departure and return: {trip.snapshot.departureOrigin?.name}.
      </p>
      <ol>
        {trip.snapshot.destinations.map((entry) => (
          <li key={entry.id}>
            {entry.name}, {entry.countryCode}: {entry.plannedNights} nights,{" "}
            {entry.arrivalDate ?? "unscheduled"} to {entry.departureDate ?? "unscheduled"}
          </li>
        ))}
      </ol>
      <ul>
        {trip.snapshot.components.map((entry) => (
          <li key={entry.id}>
            {entry.type}: {entry.serviceStart} to {entry.serviceEnd}; {entry.price.status},{" "}
            {entry.price.finalCustomerMinor} minor units {entry.price.currency}.
          </li>
        ))}
      </ul>
      <h3>Availability</h3>
      <ul>
        {trip.snapshot.availabilityWindows.map((entry) => (
          <li key={entry.id}>
            {entry.preference}: {entry.startDate} to {entry.endDate}
          </li>
        ))}
      </ul>
      <ul>
        {trip.snapshot.itineraryDays.flatMap((day) =>
          day.items
            .filter((item) => item.travelSegment)
            .map((item) => (
              <li key={item.id}>
                {item.travelSegment!.mode}: {item.travelSegment!.origin.name} to{" "}
                {item.travelSegment!.destination.name}; {item.travelSegment!.durationMinutes}{" "}
                minutes. {item.travelSegment!.directionsSummary} (
                {item.travelSegment!.verificationStatus})
              </li>
            )),
        )}
      </ul>
      <ul>
        {trip.snapshot.warnings.map((entry) => (
          <li key={entry.code}>
            {entry.severity}: {entry.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
