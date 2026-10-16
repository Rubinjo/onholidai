import type { TripEnvelope } from "./use-trip";
import { Button } from "@/components/ui/button";
export function PriceBar({ trip, authenticated = false }: { trip: TripEnvelope; authenticated?: boolean }) {
  const price = trip.snapshot.price, format = new Intl.NumberFormat("en", { style: "currency", currency: price.currency });
  const money = (minor: number): string => format.format(minor / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
  const ready = trip.snapshot.components.length > 0;
  // The grid places this bar inside <main>, which would otherwise strip the
  // contentinfo landmark from a nested <footer>; the role is set explicitly.
  return <footer className="trip-price-bar" role="contentinfo" data-trip-version={trip.version} aria-label="Current total and booking">
    <div className="trip-price-bar__estimate"><h2>{!ready ? "Your estimate is being planned" : price.status === "expired" ? "Expired estimate" : "Estimated total"}</h2>
      {ready && <strong className="trip-price-bar__total">{money(price.finalCustomerMinor)}</strong>}
      <p>Version {trip.version} · {ready ? <>Checked <time dateTime={price.checkedAt}>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(price.checkedAt))}</time></> : "Research in progress"}</p>
      {ready && <dl className="trip-price-bar__breakdown"><div><dt>Taxes</dt><dd>{price.taxesMinor == null ? "To be confirmed" : money(price.taxesMinor)}</dd></div><div><dt>Fees</dt><dd>{price.feesMinor == null ? "To be confirmed" : money(price.feesMinor)}</dd></div></dl>}
    </div><div className="trip-price-bar__booking"><p>Terms and availability need revalidation.</p>
    {trip.lifecycleState === "finalized" || trip.lifecycleState === "partially_booked" || trip.lifecycleState === "booked"
      ? <Button asChild><a href={`/trips/${trip.tripId}/booking`}>Review live booking terms</a></Button>
      : <Button disabled>Finalize your trip to enable booking</Button>}</div>{!authenticated && <p className="trip-price-bar__notice">You can plan your visit without creating an account. To review your booking, simply create a free account and confirm the current terms.</p>}</footer>;
}
