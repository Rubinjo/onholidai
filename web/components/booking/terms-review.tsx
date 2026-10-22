import type { PublicBookingTerms } from "@/domain/booking/authorization";

export function TermsReview({
  terms,
  outcomes,
}: {
  terms: PublicBookingTerms;
  outcomes: Array<{ componentId: string; outcome: string; safeReason?: string }>;
}) {
  const money = new Intl.NumberFormat("en", {
    style: "currency",
    currency: terms.totalPrice.currency,
  });
  const digits =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: terms.totalPrice.currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
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
          return (
            <li key={component.componentId}>
              <h3>
                {component.serviceStart} – {component.serviceEnd}
              </h3>
              <p>
                {component.travellerIds.length} traveller(s);{" "}
                {money.format(component.finalCustomerMinor / 10 ** digits)}
              </p>
              <p>
                Taxes {money.format(component.taxesMinor / 10 ** digits)}; fees{" "}
                {money.format(component.feesMinor / 10 ** digits)}
              </p>
              <p>Cancellation: {component.cancellationTerms}</p>
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
        <strong>Live total: {money.format(terms.totalPrice.minorUnits / 10 ** digits)}</strong>
      </p>
      {terms.nonReversibleActions.length > 0 && (
        <div>
          <h3>Non-reversible actions</h3>
          <ul>
            {terms.nonReversibleActions.map((id) => (
              <li key={id}>Component {id} cannot be reversed under these terms.</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
