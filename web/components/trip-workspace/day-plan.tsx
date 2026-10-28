import { displayPreference } from "@/components/trip-setup/preference-scale";

import { componentDuration, supplierText } from "./component-facts";

import type { CustomerSnapshot } from "@/domain/pricing/projections";

type Day = CustomerSnapshot["itineraryDays"][number];
type Item = Day["items"][number];
type ItemType = Item["type"];

const typeLabels: Record<ItemType, string> = {
  activity: "Activity",
  meal: "Meal",
  free_time: "Free time",
  travel: "Travel",
  note: "Note",
};

const modeLabels: Record<NonNullable<Item["travelSegment"]>["mode"], string> = {
  walk: "Walk",
  public_transport: "Public transport",
  bus: "Bus",
  drive: "Drive",
  flight: "Flight",
  rail: "Train",
  transfer: "Transfer",
  ferry: "Ferry",
  other: "Travel",
};

const icons: Record<ItemType, string> = {
  activity: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z",
  meal: "M12 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  free_time:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1 1M18 18l1 1M19 5l-1 1M6 18l-1 1",
  travel: "m3 10 7 2 4 8 2-1-2-7 6-7-1-2-8 6-7-1Z",
  note: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 8h.01M11 12h1v5",
};

const statusLabels: Record<Item["status"], string | null> = {
  proposed: "Proposed",
  planned: null,
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

function clock(value: string): string {
  return value.slice(11, 16);
}

// Departure and arrival are shown at each airport's own clock, so a flight that lands
// on a later local date says so instead of repeating an unqualified time of day.
function arrivalDay(value: string, departure: string): string {
  const start = Date.parse(`${departure.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  const days = Math.round((end - start) / 86_400_000);
  return days > 0 ? ` (+${days})` : "";
}

function dayHeading(value: string): string {
  // Day plans carry local wall-clock times, so the date is formatted without a zone shift.
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function summary(item: Item): { title: string; facts: string[] } {
  const segment = item.travelSegment;
  if (segment) {
    const origin = supplierText(segment.origin.name);
    const destination = supplierText(segment.destination.name);
    const facts = [modeLabels[segment.mode], componentDuration(segment.durationMinutes)];
    if (segment.durationUpperBoundMinutes)
      facts.push(`up to ${componentDuration(segment.durationUpperBoundMinutes)}`);
    facts.push(`departs ${clock(segment.plannedDeparture)}`);
    facts.push(
      `arrives ${clock(segment.plannedArrival)}${arrivalDay(
        segment.plannedArrival,
        segment.plannedDeparture,
      )}`,
    );
    return {
      title: origin && destination ? `${origin} → ${destination}` : modeLabels[segment.mode],
      facts,
    };
  }
  const label = typeLabels[item.type];
  const title = supplierText(item.title) ?? label;
  const minutes = Math.round((Date.parse(item.end) - Date.parse(item.start)) / 60_000);
  const facts = title === label ? [] : [label];
  if (minutes > 0) facts.push(componentDuration(minutes));
  return { title, facts };
}

// Supplier caveats are worth keeping but not worth reading on every block, so they sit
// behind the same disclosure the flight and stay cards use for practical details.
function notesFor(item: Item): string[] {
  const notes: string[] = [];
  const guidance = supplierText(item.travelSegment?.departureGuidance);
  if (guidance) notes.push(guidance);
  const transition = item.transitionFromPrevious;
  if (transition) {
    const minutes = transition.durationUpperBoundMinutes ?? transition.durationMinutes;
    if (minutes > 0) notes.push(`Allow ${componentDuration(minutes)} from the previous stop.`);
  }
  for (const note of item.practicalNotes ?? []) {
    const text = supplierText(note);
    if (text) notes.push(text);
  }
  return notes;
}

function DayPlanItem({ item }: { item: Item }) {
  const { title, facts } = summary(item);
  const status = statusLabels[item.status];
  const notes = notesFor(item);
  return (
    <li className={`day-plan__item day-plan__item--${item.type}`}>
      <p className="day-plan__time">
        <time dateTime={item.start}>{clock(item.start)}</time>
        <span className="day-plan__time-end">{clock(item.end)}</span>
      </p>
      <span className="day-plan__icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={icons[item.type]} />
        </svg>
      </span>
      <div className="day-plan__body">
        <h4 className="day-plan__title">{title}</h4>
        {facts.length > 0 && <p className="day-plan__facts">{facts.join(", ")}</p>}
        {item.verificationStatus === "failed" && (
          <p className="day-plan__warning">Needs review before booking</p>
        )}
        {status && (
          <p
            className={
              item.status === "cancelled"
                ? "day-plan__status day-plan__status--cancelled"
                : "day-plan__status"
            }
          >
            {status}
          </p>
        )}
        {notes.length > 0 && (
          <details className="day-plan__more">
            <summary>Good to know</summary>
            <ul className="day-plan__notes">
              {notes.map((note, index) => (
                <li key={`${index}-${note}`}>{note}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </li>
  );
}

export function DayPlan({
  days,
  destinations = [],
  version,
}: {
  days: CustomerSnapshot["itineraryDays"];
  destinations?: CustomerSnapshot["destinations"];
  version?: number;
}) {
  const places = new Map(destinations.map((place) => [place.id, place.name]));
  return (
    <section
      aria-label="Day-by-day itinerary"
      {...(version ? { "data-trip-version": version } : {})}
    >
      <h2>Day-by-day itinerary</h2>
      {!days.length && <p>Prepare a detailed itinerary to review each day of the route.</p>}
      {days.length > 0 && <p className="day-plan__hint">Times are local to each stop.</p>}
      <div className="day-plan__days">
        {days.map((day, index) => {
          const notes = (day.practicalNotes ?? []).flatMap((note) => {
            const text = supplierText(note);
            return text ? [text] : [];
          });
          const place = places.get(day.destinationId);
          return (
            <article key={day.date} className="day-plan__day">
              <header className="day-plan__header">
                <span className="day-plan__index" aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <h3>{dayHeading(day.date)}</h3>
                  {place && <p className="day-plan__place">{place}</p>}
                </div>
                <span className="day-plan__pace">
                  Pace {displayPreference(day.paceAssessment)}/10
                </span>
              </header>
              {day.mandatoryTravelException && (
                <p className="day-plan__exception" role="note">
                  {day.mandatoryTravelException}
                </p>
              )}
              {day.items.length > 0 ? (
                <ol className="day-plan__timeline">
                  {day.items.map((item) => (
                    <DayPlanItem key={item.id} item={item} />
                  ))}
                </ol>
              ) : (
                <p className="day-plan__empty">Nothing scheduled.</p>
              )}
              {notes.length > 0 && (
                <ul className="day-plan__notes day-plan__notes--day">
                  {notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
