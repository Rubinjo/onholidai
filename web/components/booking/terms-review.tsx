import type { PublicBookingTerms } from "@/domain/booking/authorization";
import type { CustomerSnapshot } from "@/domain/pricing/projections";

export function bookingComponentLabel(component: CustomerSnapshot["components"][number]): string {
  const details = component.planningDetails;
  if (component.type === "flight")
    return `${details?.flightDirection === "return" ? "Return" : details?.flightDirection === "outbound" ? "Outbound" : "Flight"}${details?.flightDirection && details.flightDirection !== "multi_city" ? " flight" : ""}${details?.airportNames.length ? `: ${details.airportNames.join(" to ")}` : ""}`;
  return `${component.type === "accommodation" ? (details?.accommodationType ?? "Stay") : component.type === "activity" ? "Activity" : component.type === "rail" ? "Rail" : "Transfer"}${details?.locationName ? `: ${details.locationName}` : ""}`;
}

export function TermsReview({
  terms,
  outcomes,
  estimates = [],
}: {
  terms: PublicBookingTerms;
  outcomes: Array<{ componentId: string; outcome: string; safeReason?: string }>;
  estimates?: CustomerSnapshot["components"];
}) {
  const format = (amount: number, currency = terms.totalPrice.currency) => {
    const money = new Intl.NumberFormat("en", { style: "currency", currency });
    return money.format(amount / 10 ** (money.resolvedOptions().maximumFractionDigits ?? 2));
  };
  return (
    <section aria-labelledby="booking-terms-heading">
      <h2 id="booking-terms-heading">Live booking terms</h2>
      <p>
        These prices and availability were checked for booking. Review the exact terms before
        authorizing.
      </p>
      <ul>
        {terms.components.map((component) => {
          const outcome = outcomes.find((entry) => entry.componentId === component.componentId);
          const estimate = estimates.find((entry) => entry.id === component.componentId);
          const confirmed = component.disposition === "already_confirmed";
          const label =
            component.service?.title ??
            (estimate ? bookingComponentLabel(estimate) : "Saved service");
          return (
            <li key={component.componentId}>
              <h3>{label}</h3>
              <p>
                {component.provider ?? estimate?.provider ?? "Saved provider"}:{" "}
                {confirmed
                  ? "Already confirmed; not a new charge"
                  : "Included in the complete booking"}
              </p>
              <p>
                {component.serviceStart} to {component.serviceEnd}
                {component.service?.timezone
                  ? ` (${component.service.timezone})`
                  : "; timezone not recorded"}
              </p>
              <p>
                {component.travellerIds.length} traveller(s);{" "}
                {format(component.finalCustomerMinor, component.currency)}
              </p>
              {estimate &&
                !confirmed &&
                (estimate.price.finalCustomerMinor !== component.finalCustomerMinor ||
                  estimate.price.currency !== component.currency) && (
                  <p role="status">
                    Changed from accepted estimate{" "}
                    {format(estimate.price.finalCustomerMinor, estimate.price.currency)} to current
                    price {format(component.finalCustomerMinor, component.currency)}.
                  </p>
                )}
              {component.service?.occupancy && (
                <p>
                  {component.service.occupancy.rooms} room(s), {component.service.occupancy.adults}{" "}
                  adult(s)
                  {component.service.occupancy.childAges.length
                    ? `, children aged ${component.service.occupancy.childAges.join(", ")}`
                    : ""}
                  .
                </p>
              )}
              {component.service?.propertyId && (
                <p>
                  Property: {label}; {component.service.propertyType}. Selected room references:{" "}
                  {component.service.roomIds.join(", ")}.
                </p>
              )}
              {component.service?.fare && <p>Fare: {component.service.fare}</p>}
              {component.service?.type === "flight" && (
                <p>
                  Baggage:{" "}
                  {component.service.baggage.join("; ") ||
                    "No included baggage under these verified terms"}
                </p>
              )}
              <p>
                Included taxes {format(component.taxesMinor, component.currency)}; included fees{" "}
                {format(component.feesMinor, component.currency)}. These are not added again.
              </p>
              {component.service?.taxFeeInclusion && <p>{component.service.taxFeeInclusion}</p>}
              <p>Cancellation: {component.cancellationTerms}</p>
              {component.service && (
                <>
                  <p>
                    Refunds:{" "}
                    {component.service.refundTerms ?? "Not recorded in the saved confirmation"}
                  </p>
                  <p>
                    Changes:{" "}
                    {component.service.changeTerms ?? "Not recorded in the saved confirmation"}
                  </p>
                </>
              )}
              {!confirmed && <p>Valid until {component.expiresAt}.</p>}
              {outcome && outcome.outcome !== "unchanged" && (
                <p role="status">
                  {outcome.outcome}: {outcome.safeReason ?? "Review this changed availability."}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p>
        <strong>
          {terms.schemaVersion === 2 ? "Remaining payable" : "Historical total"}:{" "}
          {format(terms.totalPrice.minorUnits)}
        </strong>
      </p>
      {terms.nonReversibleActions.length > 0 && (
        <div>
          <h3>Non-reversible actions</h3>
          <ul>
            {terms.nonReversibleActions.map((id) => (
              <li key={id}>
                {terms.components.find((component) => component.componentId === id)?.service
                  ?.title ?? "The listed service"}{" "}
                cannot be reversed under these terms.
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
