import type { TripEnvelope } from "./use-trip";
export function PriceBar({ trip }: { trip: TripEnvelope }) {
  const price = trip.snapshot.price, format = new Intl.NumberFormat("en", { style: "currency", currency: price.currency });
  return <footer className="trip-price-bar" data-trip-version={trip.version} aria-label="Current total and booking"><h2>{price.status === "expired" ? "Expired estimate" : "Estimated total"}: {format.format(price.finalCustomerMinor / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2))}</h2>
    <p>Version {trip.version}; checked {price.checkedAt}. Taxes {price.taxesMinor ?? 0}; fees {price.feesMinor ?? 0} minor units {price.currency}. Terms and availability need revalidation.</p>
    {trip.lifecycleState === "finalized" || trip.lifecycleState === "partially_booked"
      ? <a className="button" href={`/trips/${trip.tripId}/booking`}>Review live booking terms</a>
      : <button type="button" disabled>Finalize your trip to enable booking</button>}</footer>;
}
