import type { ReadOfferClient } from "./adapter";
export function syntheticReadClient(type: "flight" | "accommodation" | "activity" | "rail"): ReadOfferClient {
  return { async search(query, signal) {
    if (signal.aborted) throw new Error("deadline");
    const days = Math.max(1, (Date.parse(query.endDate) - Date.parse(query.startDate)) / 86400000);
    const people = query.travellerParty.adults + query.travellerParty.children.length;
    const details = type === "flight" ? { legs: [`Synthetic outbound from ${query.departureOrigin?.name}; return to same origin`], baggage: [] }
      : type === "accommodation" ? { occupancy: `Synthetic lodging for ${people} travellers`, amenities: [] }
      : type === "activity" ? { durationMinutes: 120, directions: "Synthetic activity; location and travel time unverified" }
      : { originStation: "Synthetic departure station", destinationStation: "Synthetic arrival station", route: "Synthetic route" };
    const rate = type === "flight" ? people * 60000 : type === "accommodation" ? days * 14000 : type === "activity" ? people * 4000 : people * 6000;
    const now = new Date();
    return [{ currency: query.currency, offerId: `synthetic-${type}-${query.startDate}`, supplierMinor: rate, taxesMinor: Math.round(rate * 0.1), feesMinor: 0,
      checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 900000).toISOString(),
      terms: null, details, minimumAge: null, maximumAge: null, maximumAdults: null, maximumChildren: null, accessibilityVerified: null }];
  } };
}
