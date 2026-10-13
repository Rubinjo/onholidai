import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupplyReadProvider, SupplyReadQuery } from "../read";
import { normalizePlanningOffer } from "../offers";
import { currencySchema, travelComponentSchema } from "@/domain/trip/schema";

// Provider-specific SDK/HTTP clients translate wire payloads to this narrow, read-only port.
// No supplier credential, reservation method or arbitrary URL crosses the port.
export interface ReadOfferClient { search(query: SupplyReadQuery, signal: AbortSignal): Promise<unknown> }
const hitSchema = z.object({ selectionGroup: z.string().min(1).max(120).optional(), currency: currencySchema, offerId: z.string().min(1).max(256), supplierMinor: z.number().int().nonnegative(),
  taxesMinor: z.number().int().nonnegative(), feesMinor: z.number().int().nonnegative(),
  checkedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), terms: z.string().min(1).max(2000).nullable(),
  details: z.record(z.string(), z.json()), minimumAge: z.number().int().nonnegative().nullable(),
  maximumAge: z.number().int().nonnegative().nullable(), maximumAdults: z.number().int().positive().nullable(),
  maximumChildren: z.number().int().nonnegative().nullable(), accessibilityVerified: z.boolean().nullable() }).strict();
export function createReadAdapter(provider: string, type: "flight" | "accommodation" | "activity" | "rail",
  client: ReadOfferClient): SupplyReadProvider {
  return { capabilities: { provider, search: [type], readOnly: true }, async search(query, signal) {
    const hits = z.array(hitSchema).max(32).parse(await client.search(query, signal));
    return hits.map((hit) => {
      if (hit.currency !== query.currency) throw new Error("A sourced currency conversion is required");
      const money = (minorUnits: number) => ({ currency: query.currency, minorUnits });
      const margin = 0; // No invented commercial margin policy; live clients must supply approved facts.
      const ages = query.travellerParty.children.map((child) => child.ageAtTripStart);
      const ineligible = (hit.maximumAdults !== null && query.travellerParty.adults > hit.maximumAdults)
        || (hit.maximumChildren !== null && ages.length > hit.maximumChildren)
        || ages.some((age) => (hit.minimumAge !== null && age < hit.minimumAge) || (hit.maximumAge !== null && age > hit.maximumAge));
      const component = travelComponentSchema.parse({ id: randomUUID(), itineraryItemIds: [], provider, supplierOfferId: hit.offerId,
        type, offerStatus: "available", serviceStart: `${query.startDate}T12:00:00Z`, serviceEnd: `${query.endDate}T12:00:00Z`,
        travellerIds: [...Array.from({ length: query.travellerParty.adults }, () => randomUUID()), ...query.travellerParty.children.map((child) => child.id)],
        bookingRequirements: ["Traveller identities and current eligibility must be verified before booking"],
        cancellationTerms: hit.terms ?? "Unverified cancellation terms", checkedAt: hit.checkedAt, expiresAt: hit.expiresAt,
        bookingStatus: "unbooked", details: hit.details, price: { supplierAmount: money(hit.supplierMinor), platformMargin: money(margin),
          customerPayableTaxes: money(hit.taxesMinor), customerPayableFees: money(hit.feesMinor),
          finalCustomerAmount: money(hit.supplierMinor + margin + hit.taxesMinor + hit.feesMinor),
          status: "estimated", source: provider, checkedAt: hit.checkedAt, expiresAt: hit.expiresAt } });
      return normalizePlanningOffer({ component, selectionGroup: hit.selectionGroup ?? `${type}:whole_query`, eligibility: { status: ineligible ? "ineligible" : "unverified",
        minimumAge: hit.minimumAge, maximumAge: hit.maximumAge }, occupancy: { maximumAdults: hit.maximumAdults, maximumChildren: hit.maximumChildren },
        accessibility: hit.accessibilityVerified === true ? "verified" : hit.accessibilityVerified === false ? "unsupported" : "unverified",
        attribution: { provider, sourceUrl: null }, unverifiedFacts: hit.terms === null ? ["terms"] : [] });
    }).filter((offer) => offer.eligibility.status !== "ineligible");
  } };
}
