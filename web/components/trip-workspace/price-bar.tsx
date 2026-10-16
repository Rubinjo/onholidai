import type { TripEnvelope } from "./use-trip";
export function PriceBar({ trip, authenticated = false }: { trip: TripEnvelope; authenticated?: boolean }) {
  const price = trip.snapshot.price, format = new Intl.NumberFormat("en", { style: "currency", currency: price.currency });
  // The grid places this bar inside <main>, which would otherwise strip the
  // contentinfo landmark from a nested <footer>; the role is set explicitly.
  return <footer className="trip-price-bar" role="contentinfo" data-trip-version={trip.version} aria-label="Current total and booking"><h2>{!trip.snapshot.components.length ? "Your estimate is being planned" : `${price.status === "expired" ? "Expired estimate" : "Estimated total"}: ${format.format(price.finalCustomerMinor / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2))}`}</h2>
    <p>Version {trip.version}; checked {price.checkedAt}. Taxes {price.taxesMinor ?? 0}; fees {price.feesMinor ?? 0} minor units {price.currency}. Terms and availability need revalidation.</p>
    {trip.lifecycleState === "finalized" || trip.lifecycleState === "partially_booked" || trip.lifecycleState === "booked"
      ? <a className="button" href={`/trips/${trip.tripId}/booking`}>Review live booking terms</a>
      : <button type="button" disabled>Finalize your trip to enable booking</button>}{!authenticated && <p>You can plan your visit without creating an account. To review your booking, simply create a free account and confirm the current terms.</p>}</footer>;
}
