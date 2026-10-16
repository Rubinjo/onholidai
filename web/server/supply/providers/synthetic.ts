import type { ReadOfferClient } from "./adapter";
import { createHash } from "node:crypto";
import { canonicalJson } from "@/domain/canonical-json";
export function syntheticReadClient(type: "flight" | "accommodation" | "activity" | "rail"): ReadOfferClient {
  return { async search(query, signal) {
    if (signal.aborted) throw new Error("deadline");
    const days = Math.max(1, (Date.parse(query.endDate) - Date.parse(query.startDate)) / 86400000);
    const people = query.travellerParty.adults + query.travellerParty.children.length;
    const context = createHash("sha256").update(canonicalJson(query)).digest("hex").slice(0, 16);
    const details = type === "flight" ? { legs: [`Synthetic outbound from ${query.departureOrigin?.name}; return to same origin`], baggage: [] }
      : type === "accommodation" ? { occupancy: `Synthetic lodging for ${people} travellers`, amenities: [] }
      : type === "activity" ? { durationMinutes: 120, directions: "Synthetic activity; location and travel time unverified" }
      : { originStation: "Synthetic departure station", destinationStation: "Synthetic arrival station", route: "Synthetic route" };
    const rate = type === "flight" ? people * 60000 : type === "accommodation" ? days * 14000 : type === "activity" ? people * 4000 : people * 6000;
    const now = new Date();
    const instant = (offset: number, hour: number, minute = 0) => new Date(Date.parse(query.startDate + "T00:00:00Z")
      + offset * 86400000 + hour * 3600000 + minute * 60000).toISOString();
    const intervals = type === "flight"
      ? [{ start: instant(0, 3), end: instant(0, 9), group: "flight:outbound" },
        { start: instant(days, 3), end: instant(days, 9), group: "flight:return" }]
      : type === "accommodation" ? [{ start: instant(0, 15), end: instant(days, 10), group: "accommodation:whole_query" }]
      : type === "activity" ? [{ start: instant(Math.min(1, days), 11), end: instant(Math.min(1, days), 13), group: "activity:whole_query" }]
      : [{ start: instant(Math.floor(days / 2), 7), end: instant(Math.floor(days / 2), 8, 30), group: "rail:whole_query" }];
    return intervals.map((interval) => ({ currency: query.currency, offerId: `synthetic-${type}-${query.startDate}-${interval.group}-${context}`,
      selectionGroup: interval.group, serviceStart: interval.start, serviceEnd: interval.end,
      supplierMinor: rate / intervals.length, taxesMinor: Math.round(rate / intervals.length * 0.1), feesMinor: 0,
      checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 900000).toISOString(),
      terms: null, details: type === "flight" ? { ...details, legs: [`Synthetic ${interval.group.split(":")[1]} flight; airport and carrier facts unverified`] } : details,
      minimumAge: null, maximumAge: null, maximumAdults: null, maximumChildren: null, accessibilityVerified: null }));
  } };
}
