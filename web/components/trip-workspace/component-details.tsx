import type { CustomerSnapshot } from "@/domain/pricing/projections";

type Component = CustomerSnapshot["components"][number];
const facts = (values: string[] | undefined) =>
  values?.length ? values.join("; ") : "Unavailable";
export function ComponentDetails({
  components,
  version,
}: {
  components: Component[];
  version: number;
}) {
  return (
    <section data-trip-version={version} aria-label="Component details">
      <h2>Component details</h2>
      {components.map((component) => (
        <details key={component.id}>
          <summary>
            {component.type} — {component.price.status}; {component.bookingStatus}
          </summary>
          <p>
            {component.serviceStart} to {component.serviceEnd}. Timezone:{" "}
            {component.planningDetails?.timezone ?? "Unavailable; timestamps include offsets"}.
          </p>
          <p>
            Location: {component.planningDetails?.locationName ?? "Unavailable"}. Provider:{" "}
            {component.provider}.
          </p>
          <p>
            {component.price.status} price: {component.price.finalCustomerMinor} minor units{" "}
            {component.price.currency}; taxes {component.price.taxesMinor ?? "unavailable"}, fees{" "}
            {component.price.feesMinor ?? "unavailable"}. Checked {component.checkedAt}; expires{" "}
            {component.expiresAt ?? "unavailable"}.
          </p>
          {component.type === "flight" && (
            <>
              <p>
                Outbound/return: {component.planningDetails?.flightDirection ?? "Unavailable"}; legs{" "}
                {facts(component.details?.legs)}.
              </p>
              <p>
                Airports: {facts(component.planningDetails?.airportNames)}. Airlines:{" "}
                {facts(component.planningDetails?.airlines)}.
              </p>
              <p>
                Layovers: {facts(component.planningDetails?.layovers)}. Baggage:{" "}
                {facts(component.details?.baggage)}. Fare conditions:{" "}
                {component.planningDetails?.fareConditions ?? "Unavailable"}.
              </p>
            </>
          )}
          {component.type === "accommodation" && (
            <>
              <p>
                Stay type: {component.planningDetails?.accommodationType ?? "Unavailable"};
                occupancy: {component.details?.occupancy ?? "Unavailable"}.
              </p>
              <p>Amenities: {facts(component.details?.amenities)}.</p>
            </>
          )}
          {component.type === "activity" && (
            <p>
              Activity duration {component.details?.durationMinutes ?? "Unavailable"} minutes.
              Directions: {component.details?.directions ?? "Unavailable"}
            </p>
          )}
          {component.type === "rail" && (
            <p>
              {component.details?.originStation ?? "Unavailable"} →{" "}
              {component.details?.destinationStation ?? "Unavailable"};{" "}
              {component.details?.route ?? "Unavailable"}
            </p>
          )}
          {component.type === "transfer" && (
            <p>
              {component.details?.origin ?? "Unavailable"} →{" "}
              {component.details?.destination ?? "Unavailable"};{" "}
              {component.details?.route ?? "Unavailable"}
            </p>
          )}
          <p>
            Duration: {component.planningDetails?.durationMinutes ?? "Unavailable"} minutes. Travel
            from stay: {component.planningDetails?.travelFromStayMinutes ?? "Unavailable"} minutes.
          </p>
          <p>Cancellation: {component.cancellationTerms}</p>
          <p>Booking requirements: {facts(component.bookingRequirements)}</p>
          <p>
            Eligibility {component.planningDetails?.eligibility ?? "unverified"}; accessibility{" "}
            {component.planningDetails?.accessibility ?? "unverified"}; availability{" "}
            {component.planningDetails?.availability ?? "unverified"}.
          </p>
          <p>
            Unavailable facts: {facts(component.planningDetails?.unavailableFacts)}. Planning
            details checked {component.planningDetails?.checkedAt ?? "unavailable"}; source{" "}
            {component.planningDetails?.source ?? component.provider}.
          </p>
        </details>
      ))}
    </section>
  );
}
