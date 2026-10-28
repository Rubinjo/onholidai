import { timezoneSchema } from "@/domain/trip/schema";

import {
  componentDate,
  componentDuration,
  componentMoney,
  sourceFacts,
  supplierText,
  type Component,
  type ComponentDestination,
  type TravelFact,
} from "./component-facts";

import type { FlightJourney } from "@/domain/trip/itinerary";

const typeLabels: Record<Component["type"], string> = {
  flight: "Flight",
  accommodation: "Stay",
  activity: "Activity",
  rail: "Train",
  transfer: "Transfer",
};
const bookingLabels: Record<Component["bookingStatus"], string> = {
  unbooked: "Not booked",
  pending: "Booking in progress",
  confirmed: "Booked",
  cancelled: "Cancelled",
  unknown: "Booking status to confirm",
  action_required: "Action needed",
};
const priceLabels: Record<Component["price"]["status"], string> = {
  estimated: "Estimated price",
  quoted: "Quoted price",
  live: "Current price",
  confirmed: "Confirmed price",
  expired: "Expired price",
};
const icons: Record<Component["type"], string> = {
  flight: "m3 10 7 2 4 8 2-1-2-7 6-7-1-2-8 6-7-1Z",
  accommodation: "M3 20V4h12v16M15 10h6v10M7 8h4M7 12h4M7 16h4M1 20h22",
  activity: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z",
  rail: "M6 17 4 21m14-4 2 4M6 3h12v14H6ZM6 10h12M9 14h.01M15 14h.01",
  transfer: "m5 7 2-4h10l2 4M3 7h18v10H3ZM6 17v4m12-4v4M6 12h.01M18 12h.01",
};

function TextList({ title, values }: { title: string; values: (string | null)[] }) {
  const readable = values.flatMap((value) => {
    const text = supplierText(value);
    return text ? [text] : [];
  });
  if (!readable.length) return null;
  return (
    <div className="component-card__notes">
      <h4>{title}</h4>
      <ul>
        {readable.map((value, index) => (
          <li key={index}>{value}</li>
        ))}
      </ul>
    </div>
  );
}

function stayDestination(
  component: Component,
  destinations: ComponentDestination[],
): string | null {
  if (component.type !== "accommodation" || !destinations.length) return null;
  const start = component.serviceStart.slice(0, 10);
  const end = component.serviceEnd.slice(0, 10);
  const scheduled = destinations.filter(
    (place) => place.arrivalDate !== null && place.departureDate !== null,
  );
  const span = (place: ComponentDestination) =>
    Date.parse(place.departureDate!) - Date.parse(place.arrivalDate!);
  const contained = scheduled.filter(
    (place) => place.arrivalDate! <= start && place.departureDate! >= end,
  );
  const overlapping = scheduled.filter(
    (place) => place.arrivalDate! <= end && place.departureDate! >= start,
  );
  const match =
    [...contained, ...overlapping].sort((first, second) => span(first) - span(second))[0] ??
    (destinations.length === 1 ? destinations[0] : undefined);
  return match ? `${match.name}, ${match.countryCode}` : null;
}

const journeyLabels: Record<FlightJourney["direction"], string> = {
  outbound: "Outbound flight",
  return: "Return flight",
  multi_city: "Multi-city flight",
};

function journeyTimezone(value: string | null): string | null {
  return value && timezoneSchema.safeParse(value).success ? value : null;
}

// One fare can cover both directions, so each flown journey is listed with the local
// clock at its own airports instead of repeating the fare's whole-trip window.
function FlightJourneys({ journeys }: { journeys: FlightJourney[] }) {
  return (
    <ol className="component-card__journeys" aria-label="Flights in this fare">
      {journeys.map((journey, index) => {
        const minutes = Math.round(
          (Date.parse(journey.arrivingAt) - Date.parse(journey.departingAt)) / 60_000,
        );
        return (
          <li key={`${journey.direction}-${index}`}>
            <h4>{journeyLabels[journey.direction]}</h4>
            <p className="component-card__route">
              {journey.origin} → {journey.destination}
            </p>
            <dl className="component-card__schedule">
              <div>
                <dt>Departs</dt>
                <dd>
                  <time dateTime={journey.departingAt}>
                    {componentDate(journey.departingAt, journeyTimezone(journey.originTimezone))}
                  </time>
                </dd>
              </div>
              <div>
                <dt>Arrives</dt>
                <dd>
                  <time dateTime={journey.arrivingAt}>
                    {componentDate(
                      journey.arrivingAt,
                      journeyTimezone(journey.destinationTimezone),
                    )}
                  </time>
                </dd>
              </div>
            </dl>
            <p className="component-card__facts">{componentDuration(minutes)}</p>
            {journey.legs.length > 1 && (
              <p className="component-card__route">Connects via {journey.legs.join(", ")}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ComponentCard({
  component,
  destinations,
}: {
  component: Component;
  destinations: ComponentDestination[];
}) {
  const planning = component.planningDetails;
  const timezone =
    planning?.timezone && timezoneSchema.safeParse(planning.timezone).success
      ? planning.timezone
      : null;
  const source = sourceFacts(component, stayDestination(component, destinations));
  const facts: TravelFact[] = [];
  const add = (label: string, value: unknown) => {
    const text = supplierText(value);
    if (text) facts.push({ label, value: text });
  };
  let route = source.route;
  if (component.type === "flight") {
    if (!route && planning?.airportNames.length)
      route = planning.airportNames.map(supplierText).filter(Boolean).join(" → ");
    add(
      "Journey",
      planning?.flightDirection === "multi_city"
        ? "Multi-city"
        : planning?.flightDirection === "return"
          ? "Return"
          : planning?.flightDirection === "outbound"
            ? "Outbound"
            : null,
    );
    add("Airline", planning?.airlines.map(supplierText).filter(Boolean).join(", "));
  }
  if (component.type === "accommodation") {
    add("Stay type", planning?.accommodationType);
    add("Guests", component.details?.occupancy);
  }
  if (component.type === "rail" && component.details) {
    const origin = supplierText(component.details.originStation);
    const destination = supplierText(component.details.destinationStation);
    if (origin && destination) route = `${origin} → ${destination}`;
    add("Route", component.details.route);
  }
  if (component.type === "transfer" && component.details) {
    const origin = supplierText(component.details.origin);
    const destination = supplierText(component.details.destination);
    if (origin && destination) route = `${origin} → ${destination}`;
    add("Route", component.details.route);
  }
  const duration =
    planning?.durationMinutes ??
    (component.type === "activity" ? component.details?.durationMinutes : null);
  if (duration != null) add("Duration", componentDuration(duration));
  if (planning?.travelFromStayMinutes != null)
    add("From your stay", componentDuration(planning.travelFromStayMinutes));
  facts.push(...source.facts);
  const title = supplierText(planning?.locationName) ?? route ?? typeLabels[component.type];
  const money = (minor: number) => componentMoney(minor, component.price.currency);
  const datesOnly = component.type === "accommodation" && component.details === null;
  const journeys = component.type === "flight" ? (planning?.flightJourneys ?? []) : [];
  const dateLabels =
    component.type === "accommodation"
      ? ["Check-in", "Check-out"]
      : journeys.length > 1
        ? ["First flight departs", "Last flight arrives"]
        : component.type === "flight" || component.type === "rail" || component.type === "transfer"
          ? ["Departure", "Arrival"]
          : ["Starts", "Ends"];
  const warning =
    component.offerStatus === "unavailable"
      ? "No longer available"
      : component.offerStatus === "expired" || component.price.status === "expired"
        ? "Price needs refreshing before booking"
        : component.offerStatus === "changed"
          ? "Offer changed; review before booking"
          : null;
  return (
    <article className="component-card" aria-label={`${typeLabels[component.type]}: ${title}`}>
      <header className="component-card__header">
        <span className="component-card__icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={icons[component.type]} />
          </svg>
        </span>
        <div>
          <span className="component-card__type">{typeLabels[component.type]}</span>
          <h3>{title}</h3>
          {route && route !== title && <p className="component-card__route">{route}</p>}
        </div>
        <div className="component-card__price">
          <strong>{money(component.price.finalCustomerMinor)}</strong>
          <span>{priceLabels[component.price.status]}</span>
        </div>
      </header>
      <div className="component-card__statuses">
        <span className="component-card__badge">{bookingLabels[component.bookingStatus]}</span>
        {warning && <span className="component-card__warning">{warning}</span>}
      </div>
      <dl className="component-card__schedule">
        {[component.serviceStart, component.serviceEnd].map((date, index) => (
          <div key={index}>
            <dt>{dateLabels[index]}</dt>
            <dd>
              <time dateTime={date}>{componentDate(date, timezone, datesOnly)}</time>
            </dd>
          </div>
        ))}
      </dl>
      {datesOnly ? (
        <p className="component-card__timezone">Check-in and check-out times to be confirmed.</p>
      ) : (
        <p className="component-card__timezone">
          {timezone
            ? `Times in ${timezone}`
            : "Times use the supplier's UTC offsets. Local timezone to be confirmed."}
        </p>
      )}
      {journeys.length > 0 && <FlightJourneys journeys={journeys} />}
      {facts.length > 0 && (
        <dl className="component-card__facts">
          {facts.map((fact, index) => (
            <div key={index}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {(source.notice || !component.details) && (
        <p className="component-card__notice">
          {source.notice ?? "Full service details are still to be confirmed."}
        </p>
      )}
      <details className="component-card__practical">
        <summary>Booking and practical details</summary>
        {component.type === "flight" && (
          <>
            <TextList title="Flight legs" values={component.details?.legs ?? []} />
            <TextList title="Baggage" values={component.details?.baggage ?? []} />
            <TextList title="Layovers" values={planning?.layovers ?? []} />
            {!component.details?.baggage.length && <p>Baggage allowance to be confirmed.</p>}
          </>
        )}
        {component.type === "accommodation" && (
          <TextList title="Amenities" values={component.details?.amenities ?? []} />
        )}
        {component.type === "activity" && (
          <TextList title="Getting there" values={[component.details?.directions ?? null]} />
        )}
        <TextList title="Fare conditions" values={[planning?.fareConditions ?? null]} />
        <TextList title="Before you book" values={component.bookingRequirements} />
        <div className="component-card__notes">
          <h4>Cancellation and changes</h4>
          <p>
            {supplierText(component.cancellationTerms) ??
              "Cancellation and change terms need confirmation before booking."}
          </p>
        </div>
        <dl className="component-card__facts">
          <div>
            <dt>Taxes</dt>
            <dd>
              {component.price.taxesMinor == null
                ? "To be confirmed"
                : money(component.price.taxesMinor)}
            </dd>
          </div>
          <div>
            <dt>Fees</dt>
            <dd>
              {component.price.feesMinor == null
                ? "To be confirmed"
                : money(component.price.feesMinor)}
            </dd>
          </div>
          {(["eligibility", "accessibility", "availability"] as const).map((field) => (
            <div key={field}>
              <dt>
                {field === "eligibility"
                  ? "Traveller eligibility"
                  : field === "accessibility"
                    ? "Accessibility"
                    : "Availability"}
              </dt>
              <dd>
                {planning?.[field] === "verified"
                  ? "Verified"
                  : planning?.[field] === "failed"
                    ? "Not met; review before booking"
                    : "To be confirmed"}
              </dd>
            </div>
          ))}
        </dl>
        <TextList title="Still to confirm" values={planning?.unavailableFacts ?? []} />
        <p className="component-card__notice">
          Provided by {supplierText(component.provider) ?? "travel supplier"}. Price checked{" "}
          {componentDate(component.price.checkedAt)}.
          {component.price.expiresAt && (
            <> Valid until {componentDate(component.price.expiresAt)}.</>
          )}
        </p>
      </details>
    </article>
  );
}

export function ComponentDetails({
  components,
  destinations = [],
  version,
}: {
  components: Component[];
  destinations?: ComponentDestination[];
  version: number;
}) {
  return (
    <section
      className="component-details"
      data-trip-version={version}
      aria-label="Component details"
    >
      <h2>Component details</h2>
      {!components.length && (
        <p>Your flights, stays and activities will appear here once your trip is planned.</p>
      )}
      <div className="component-details__list">
        {components.map((component) => (
          <ComponentCard key={component.id} component={component} destinations={destinations} />
        ))}
      </div>
    </section>
  );
}
