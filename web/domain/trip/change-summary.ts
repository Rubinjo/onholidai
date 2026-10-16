import { canonicalJson } from "@/domain/canonical-json";
import type { TripSnapshot } from "./schema";

// Summarize committed facts, not the model's intended operations. Never project costs.
export function summarizeTripChanges(before: TripSnapshot, after: TripSnapshot): string[] {
  const changes: string[] = [];
  const changed = (a: unknown, b: unknown): boolean => canonicalJson(a ?? null) !== canonicalJson(b ?? null);
  const route = (snapshot: TripSnapshot): string => snapshot.destinations.map((stop) => stop.name).join(" → ").slice(0, 150);
  if (changed(before.destinations.map((stop) => [stop.id, stop.name]), after.destinations.map((stop) => [stop.id, stop.name]))) changes.push(`Route updated: ${route(after)}.`);
  else if (changed(before.destinations, after.destinations)) changes.push(`Stay dates or nights updated: ${after.destinations.filter((stop, index) => changed(before.destinations[index], stop)).map((stop) => `${stop.name}: ${stop.plannedNights} nights${stop.arrivalDate ? ` (${stop.arrivalDate}–${stop.departureDate})` : ""}`).join("; ")}.`);
  if (changed(before.departureOrigin, after.departureOrigin)) changes.push(`Departure changed to ${after.departureOrigin.name}.`);
  if (changed(before.departureOrigins, after.departureOrigins)) changes.push("Departure alternatives updated.");
  if (changed(before.destinationOrder, after.destinationOrder)) changes.push(`Route ordering changed to ${after.destinationOrder ?? "manual"}.`);
  if (changed(before.availabilityWindows, after.availabilityWindows)) changes.push("Available travel dates updated.");
  if (changed(before.duration, after.duration)) changes.push(`Duration updated: ${after.duration.minimumDays}–${after.duration.maximumDays} days, ideally ${after.duration.idealDays}.`);
  if (changed(before.travellerParty, after.travellerParty)) changes.push(`Travellers updated: ${after.travellerParty.adults} adults, ${after.travellerParty.children.length} children.`);
  if (changed(before.preferences, after.preferences)) changes.push("Travel style updated.");
  if (changed(before.constraints, after.constraints)) changes.push("Trip requirements updated.");
  if (changed(before.itineraryDays, after.itineraryDays)) changes.push(`Daily plans updated across ${after.itineraryDays.length} days.`);
  if (changed(before.components, after.components)) changes.push("Transport, stays or activities refreshed; nothing booked.");
  const price = after.price.finalCustomerTotal, previous = before.price.finalCustomerTotal;
  if (changed(price, previous)) {
    const format = new Intl.NumberFormat("en", { style: "currency", currency: price.currency });
    const units = 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2);
    changes.push(previous.currency === price.currency
      ? `Estimated total: ${format.format(previous.minorUnits / units)} → ${format.format(price.minorUnits / units)}.`
      : `Estimated total: ${format.format(price.minorUnits / units)}; currency changed.`);
  }
  if (changed(before.warnings, after.warnings)) changes.push("Planning caveats updated; review trip details before booking.");
  return changes.length ? changes.map((line) => line.slice(0, 256)).slice(0, 5).concat(changes.length > 5 ? ["Other planning details changed; see the saved trip."] : []) : ["No trip details changed."];
}
