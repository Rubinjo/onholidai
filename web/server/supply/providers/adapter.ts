import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { canonicalJson } from "@/domain/canonical-json";
import { currencySchema, MAX_SUPPLIER_ID_LENGTH } from "@/domain/trip/schema";
import { planningDetailsSchema } from "@/domain/trip/itinerary";

import { normalizePlanningOffer } from "../offers";

import type { SupplyReadProvider, SupplyReadQuery } from "../read";
import type { PlanningOffer } from "../offers";

// Provider-specific SDK/HTTP clients translate wire payloads to this narrow, read-only port.
// No supplier credential, reservation method or arbitrary URL crosses the port.
export interface ReadOfferClient {
  capabilities?: NonNullable<SupplyReadProvider["capabilities"]["operations"]>;
  search(query: SupplyReadQuery, signal: AbortSignal): Promise<unknown>;
  detail?(offerId: string, query: SupplyReadQuery, signal: AbortSignal): Promise<unknown>;
  revalidate?(offerId: string, query: SupplyReadQuery, signal: AbortSignal): Promise<unknown>;
}
const hitSchema = z
  .object({
    selectionGroup: z.string().min(1).max(120).optional(),
    termsUnverified: z.boolean().optional(),
    currency: currencySchema,
    offerId: z.string().min(1).max(MAX_SUPPLIER_ID_LENGTH),
    supplierMinor: z.number().int().nonnegative().nullable(),
    customerMinor: z.number().int().nonnegative().safe().nullable().optional(),
    availability: z.enum(["available", "unavailable", "unknown"]).optional(),
    serviceStart: z.iso.datetime({ offset: true }).nullable().optional(),
    serviceEnd: z.iso.datetime({ offset: true }).nullable().optional(),
    planningDetails: planningDetailsSchema.optional(),
    taxesMinor: z.number().int().nonnegative().nullable(),
    feesMinor: z.number().int().nonnegative().nullable(),
    checkedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable(),
    terms: z.string().min(1).max(2000).nullable(),
    supplierReferences: z
      .object({
        accommodationId: z.string().max(256).optional(),
        searchResultId: z.string().max(256).optional(),
        roomId: z.string().max(256).optional(),
        rateId: z.string().max(MAX_SUPPLIER_ID_LENGTH).optional(),
        quoteId: z.string().max(256).optional(),
        productCode: z.string().max(256).optional(),
        optionCode: z.string().max(256).optional(),
        availabilityId: z.string().max(256).optional(),
        roomIds: z.array(z.string().max(256)).max(16).optional(),
        rateIds: z.array(z.string().max(MAX_SUPPLIER_ID_LENGTH)).max(16).optional(),
        sessionId: z.string().max(256).optional(),
      })
      .strict()
      .optional(),
    details: z.record(z.string(), z.json()).nullable(),
    minimumAge: z.number().int().nonnegative().nullable(),
    maximumAge: z.number().int().nonnegative().nullable(),
    maximumAdults: z.number().int().positive().nullable(),
    maximumChildren: z.number().int().nonnegative().nullable(),
    accessibilityVerified: z.boolean().nullable(),
  })
  .strict();
export function createReadAdapter(
  provider: string,
  type: "flight" | "accommodation" | "activity" | "rail",
  client: ReadOfferClient,
): SupplyReadProvider {
  function normalize(raw: unknown, query: SupplyReadQuery) {
    const hit = hitSchema.parse(raw);
    if (hit.currency !== query.currency)
      throw new Error("A sourced currency conversion is required");
    const money = (minorUnits: number | null) =>
      minorUnits === null ? null : { currency: query.currency, minorUnits };
    const margin = 0; // No invented commercial margin policy; live clients must supply approved facts.
    const ages = query.travellerParty.children.map((child) => child.ageAtTripStart);
    const ineligible =
      (hit.maximumAdults !== null && query.travellerParty.adults > hit.maximumAdults) ||
      (hit.maximumChildren !== null && ages.length > hit.maximumChildren);
    const component = {
      id: randomUUID(),
      itineraryItemIds: [],
      provider,
      supplierOfferId: hit.offerId,
      type,
      offerStatus: hit.availability === "unavailable" ? "unavailable" : "available",
      serviceStart: hit.serviceStart ?? null,
      serviceEnd: hit.serviceEnd ?? null,
      planningDetails: hit.planningDetails,
      travellerIds: [
        ...Array.from({ length: query.travellerParty.adults }, (_, slot) => {
          const hash = createHash("sha256")
            .update(canonicalJson([query.travellerParty, slot]))
            .digest("hex");
          return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
        }),
        ...query.travellerParty.children.map((child) => child.id),
      ],
      bookingRequirements: [
        "Traveller identities and current eligibility must be verified before booking",
      ],
      cancellationTerms: hit.terms,
      checkedAt: hit.checkedAt,
      expiresAt: hit.expiresAt,
      bookingStatus: "unbooked",
      details: hit.details,
      price: {
        currency: query.currency,
        supplierAmount: money(hit.supplierMinor),
        platformMargin: hit.customerMinor === undefined ? money(margin) : null,
        customerPayableTaxes: money(hit.taxesMinor),
        customerPayableFees: money(hit.feesMinor),
        finalCustomerAmount: money(
          hit.customerMinor !== undefined
            ? hit.customerMinor
            : hit.supplierMinor === null || hit.taxesMinor === null || hit.feesMinor === null
              ? null
              : hit.supplierMinor + margin + hit.taxesMinor + hit.feesMinor,
        ),
        status: "estimated",
        source: provider,
        checkedAt: hit.checkedAt,
        expiresAt: hit.expiresAt,
      },
    };
    return normalizePlanningOffer({
      component,
      supplierReferences: hit.supplierReferences,
      ...(hit.availability
        ? {
            evidence: {
              status: "estimated",
              availability: hit.availability,
              checkedAt: hit.checkedAt,
              expiresAt: hit.expiresAt,
            },
          }
        : {}),
      selectionGroup: hit.selectionGroup ?? `${type}:whole_query`,
      eligibility: {
        status: ineligible ? "ineligible" : "unverified",
        minimumAge: hit.minimumAge,
        maximumAge: hit.maximumAge,
      },
      occupancy: { maximumAdults: hit.maximumAdults, maximumChildren: hit.maximumChildren },
      accessibility:
        hit.accessibilityVerified === true
          ? "verified"
          : hit.accessibilityVerified === false
            ? "unsupported"
            : "unverified",
      attribution: { provider, sourceUrl: null },
      unverifiedFacts: hit.terms === null || hit.termsUnverified === true ? ["terms"] : [],
    });
  }
  return {
    capabilities: {
      provider,
      search: [type],
      readOnly: true,
      operations: client.capabilities ?? {
        search: "supported",
        detail: client.detail ? "supported" : "unsupported",
        revalidation: client.revalidate ? "supported" : "unsupported",
      },
    },
    async search(query, signal) {
      const raw = await client.search(query, signal);
      if (!Array.isArray(raw) || raw.length > 32)
        throw new Error("Supplier offer page is invalid or too large");
      const offers: PlanningOffer[] = [];
      let rejected = 0;
      // One malformed record is a partial supplier outage; the rest of the page is
      // still valid evidence and must not be discarded with it.
      for (const entry of raw) {
        try {
          offers.push(normalize(entry, query));
        } catch {
          rejected += 1;
        }
      }
      if (!offers.length && rejected) throw new Error("No usable supplier offers");
      return offers.filter((offer) => offer.eligibility.status !== "ineligible");
    },
    ...(client.detail
      ? {
          detail: async (offerId: string, query: SupplyReadQuery, signal: AbortSignal) =>
            normalize(await client.detail!(offerId, query, signal), query),
        }
      : {}),
    ...(client.revalidate
      ? {
          revalidate: async (offerId: string, query: SupplyReadQuery, signal: AbortSignal) =>
            normalize(await client.revalidate!(offerId, query, signal), query),
        }
      : {}),
  };
}
