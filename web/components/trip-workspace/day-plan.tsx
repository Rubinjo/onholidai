import { displayPreference } from "@/components/trip-setup/preference-scale";

import type { CustomerSnapshot } from "@/domain/pricing/projections";

export function DayPlan({
  days,
  version,
}: {
  days: CustomerSnapshot["itineraryDays"];
  version?: number;
}) {
  return (
    <section
      aria-label="Day-by-day itinerary"
      {...(version ? { "data-trip-version": version } : {})}
    >
      <h2>Day-by-day itinerary</h2>
      {!days.length && (
        <p>Prepare a detailed itinerary to review morning, afternoon and evening plans.</p>
      )}
      {days.map((day) => (
        <article key={day.date}>
          <h3>
            {day.date} — {day.timezone}
          </h3>
          <p>
            Pace preference {displayPreference(day.paceAssessment)}/10. All times are local to{" "}
            {day.timezone} unless an offset is shown.
          </p>
          {day.mandatoryTravelException && (
            <p role="note">Travel-day exception: {day.mandatoryTravelException}</p>
          )}
          {[
            { title: "Morning", start: 0, end: 12 },
            { title: "Afternoon", start: 12, end: 18 },
            { title: "Evening", start: 18, end: 24 },
          ].map((period) => {
            const items = day.items.filter(
              (item) =>
                Number(item.start.slice(11, 13)) >= period.start &&
                Number(item.start.slice(11, 13)) < period.end,
            );
            return (
              <section key={period.title} aria-label={`${day.date} ${period.title}`}>
                <h4>{period.title}</h4>
                {!items.length && <p>No scheduled items.</p>}
                <ol>
                  {items.map((item) => (
                    <li key={item.id}>
                      <p>
                        {item.start.slice(11)}
                        {item.startOffset}–{item.end.slice(11)}
                        {item.endOffset}: {item.title ?? item.type}; {item.status},{" "}
                        {item.verificationStatus ?? "unverified"}.
                      </p>
                      {item.location ? (
                        <p>
                          Location: {item.location.latitude}, {item.location.longitude}
                        </p>
                      ) : (
                        <p>Location unavailable.</p>
                      )}
                      {item.componentId && <p>Estimated component: {item.componentId}</p>}
                      {item.travelSegment && (
                        <>
                          <p>
                            {item.travelSegment.mode}: {item.travelSegment.origin.name} →{" "}
                            {item.travelSegment.destination.name}
                          </p>
                          <p>
                            Departure {item.travelSegment.plannedDeparture} (
                            {item.travelSegment.origin.timezone}); arrival{" "}
                            {item.travelSegment.plannedArrival} (
                            {item.travelSegment.destination.timezone}).
                          </p>
                          <p>
                            Duration {item.travelSegment.durationMinutes} minutes; upper bound{" "}
                            {item.travelSegment.durationUpperBoundMinutes ?? "unavailable"}.{" "}
                            {item.travelSegment.directionsSummary}
                          </p>
                          <p>
                            {item.travelSegment.departureGuidance ??
                              "Departure guidance unavailable; verify terminal/station arrival requirements."}
                          </p>
                          <p>
                            Source {item.travelSegment.source}, checked{" "}
                            {item.travelSegment.freshnessAt};{" "}
                            {item.travelSegment.verificationStatus}.
                          </p>
                        </>
                      )}
                      {item.transitionFromPrevious && (
                        <p>
                          Travel from previous location:{" "}
                          {item.transitionFromPrevious.durationUpperBoundMinutes ??
                            item.transitionFromPrevious.durationMinutes}{" "}
                          minutes plus 15-minute transition;{" "}
                          {item.transitionFromPrevious.verificationStatus}.
                        </p>
                      )}
                      <ul>
                        {item.practicalNotes?.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              </section>
            );
          })}
          <ul>
            {day.practicalNotes?.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}
