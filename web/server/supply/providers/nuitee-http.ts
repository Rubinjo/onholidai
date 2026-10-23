import { z } from "zod";

import { SupplyReadError, type SupplyReadQuery } from "../read";
import {
  checkedAt,
  decimalMinor,
  discoveryHit,
  emptyHit,
  identifier,
  list,
  queryKey,
  readJson,
  record,
  safeMapping,
  secret,
  text,
  validateQuery,
  type ReadHttpOptions,
} from "./read-http";

import type { ReadOfferClient } from "./adapter";

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const searchSchema = z
  .object({
    guestNationality: z.string().regex(/^[A-Z]{2}$/),
    occupancies: z
      .array(
        z
          .object({
            adults: z.number().int().min(1).max(16),
            children: z.array(z.number().int().min(0).max(17)).max(16),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    hotelIds: z.array(idSchema).min(1).max(32).optional(),
    placeId: idSchema.optional(),
    sessionId: idSchema.optional(),
  })
  .strict()
  .refine((value) => Boolean(value.hotelIds) !== Boolean(value.placeId));
export interface NuiteeHttpOptions extends ReadHttpOptions {
  apiKey: string;
  environment: "sandbox" | "production";
  resolveSearch: (query: SupplyReadQuery) => z.input<typeof searchSchema> | null;
}

// https://docs.liteapi.travel/docs/hotel-rates-api-json-data-structure
// Prebook creates a checkout session and is deliberately not a read capability.
export function createNuiteeHttpClient(options: NuiteeHttpOptions) {
  if (!["sandbox", "production"].includes(options.environment))
    throw new SupplyReadError("unsupported");
  const key = secret(options.apiKey);
  if (key.startsWith("sand_") && options.environment !== "sandbox") {
    throw new SupplyReadError("access_blocked");
  }
  const headers = {
    "X-API-Key": key,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const ratesUrl = "https://api.liteapi.travel/v3.0/hotels/rates";
  const http = {
    ...options,
    timeoutMs: Math.min(6000, options.timeoutMs ?? 6000),
    decimalFields: ["amount"],
  };
  const grants = new Map<string, { query: string; hotelId: string }>();
  const add = (left: number, right: number) => {
    const result = left + right;
    if (!Number.isSafeInteger(result)) throw new SupplyReadError("error");
    return result;
  };
  function amount(raw: unknown, currency: string) {
    const value = record(raw);
    if (value.currency !== currency) throw new SupplyReadError("unsupported");
    return decimalMinor(value.amount, currency);
  }
  function total(raw: unknown, currency: string) {
    const values = list(raw, 1);
    if (values.length !== 1) throw new SupplyReadError("error");
    return amount(values[0], currency);
  }
  function selection(query: SupplyReadQuery) {
    const parsed = searchSchema.safeParse(options.resolveSearch(query));
    if (!parsed.success || query.destinationIds.length !== 1 || query.endDate <= query.startDate)
      throw new SupplyReadError("access_blocked");
    const value = parsed.data;
    const adults = value.occupancies.reduce((sum, room) => sum + room.adults, 0);
    const ages = value.occupancies.flatMap((room) => room.children).sort((a, b) => a - b);
    const expected = query.travellerParty.children
      .map((child) => child.ageAtTripStart)
      .sort((a, b) => a - b);
    if (adults !== query.travellerParty.adults || JSON.stringify(ages) !== JSON.stringify(expected))
      throw new SupplyReadError("access_blocked");
    return value;
  }
  function mapOffer(
    hotelId: string,
    raw: unknown,
    query: SupplyReadQuery,
    input: z.infer<typeof searchSchema>,
    content?: Record<string, unknown>,
  ) {
    const offer = record(raw);
    const offerId = identifier(offer.offerId, /^[A-Za-z0-9_-]{1,256}$/);
    const hit = emptyHit(offerId, query.currency, checkedAt(options));
    const rates = list(offer.rates, 16);
    if (rates.length !== input.occupancies.length) throw new SupplyReadError("error");
    const seen = new Set<number>();
    let retailTotal = 0;
    let dueAtProperty = 0;
    let chargesKnown = true;
    const rateIds: string[] = [];
    const roomIds: string[] = [];
    const roomFacts = rates.map((rawRate) => {
      const rate = record(rawRate);
      const occupancy = z.number().int().min(1).max(rates.length).parse(rate.occupancyNumber);
      if (seen.has(occupancy)) throw new SupplyReadError("error");
      seen.add(occupancy);
      const requested = input.occupancies[occupancy - 1];
      if (rate.adultCount !== requested.adults || rate.childCount !== requested.children.length)
        throw new SupplyReadError("error");
      if (requested.children.length || rate.childrenAges !== undefined) {
        const ages = z.array(z.number().int().min(0).max(17)).max(16).parse(rate.childrenAges);
        if (
          JSON.stringify([...ages].sort((a, b) => a - b)) !==
          JSON.stringify([...requested.children].sort((a, b) => a - b))
        )
          throw new SupplyReadError("error");
      }
      rateIds.push(identifier(rate.rateId, /^[A-Za-z0-9_-]{1,256}$/));
      if (rate.mappedRoomId != null) roomIds.push(identifier(String(rate.mappedRoomId)));
      const retail = record(rate.retailRate);
      retailTotal = add(retailTotal, total(retail.total, query.currency));
      if (retail.taxesAndFees === undefined) chargesKnown = false;
      const charges =
        retail.taxesAndFees == null
          ? null
          : list(retail.taxesAndFees, 16).map((rawCharge) => {
              const charge = record(rawCharge);
              if (typeof charge.included !== "boolean") throw new SupplyReadError("error");
              const currency = identifier(charge.currency, /^[A-Z]{3}$/);
              const minor = decimalMinor(charge.amount, currency);
              if (!charge.included) {
                if (currency === query.currency) dueAtProperty = add(dueAtProperty, minor);
                else chargesKnown = false;
              }
              return {
                included: charge.included,
                minor,
                currency,
                description: text(charge.description, 100),
              };
            });
      const policy = rate.cancellationPolicies == null ? null : record(rate.cancellationPolicies);
      const cancellation =
        policy?.cancelPolicyInfos == null
          ? null
          : list(policy.cancelPolicyInfos, 8).map((rawWindow) => {
              const window = record(rawWindow);
              const currency = identifier(window.currency, /^[A-Z]{3}$/);
              return {
                time: text(window.cancelTime, 80),
                timezone: text(window.timezone, 80),
                type: text(window.type, 40),
                currency,
                minor: window.type === "amount" ? decimalMinor(window.amount, currency) : null,
              };
            });
      return {
        occupancy,
        adults: rate.adultCount,
        children: rate.childCount,
        childAges: requested.children,
        roomName: text(rate.name, 100),
        meal: text(rate.boardName ?? rate.boardType, 100),
        remarks: text(rate.remarks, 200),
        hotelRemarks:
          policy?.hotelRemarks == null
            ? null
            : list(policy.hotelRemarks, 8).map((remark) => text(remark, 200)),
        charges,
        refundable: text(policy?.refundableTag, 20),
        cancellation,
      };
    });
    const declaredTotal = total(offer.offerRetailRate, query.currency);
    if (declaredTotal !== retailTotal) throw new SupplyReadError("error");
    hit.customerMinor =
      offer.suggestedSellingPrice == null ||
      !chargesKnown ||
      offer.rateType === "package" ||
      offer.loyaltyMembershipIdRequired === true
        ? null
        : add(total(offer.suggestedSellingPrice, query.currency), dueAtProperty);
    hit.availability = "available";
    const supplierReferences = {
      accommodationId: hotelId,
      rateIds,
      roomIds,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    };
    hit.supplierReferences = supplierReferences;
    hit.details = {
      name: text(content?.name),
      checkInDate: query.startDate,
      checkOutDate: query.endDate,
      roomFacts,
      priceBasis: "selected_offer_not_prebooked",
      dueAtPropertyMinor: chargesKnown ? dueAtProperty : null,
      rateType: text(offer.rateType, 40),
      membershipRequired:
        typeof offer.loyaltyMembershipIdRequired === "boolean"
          ? offer.loyaltyMembershipIdRequired
          : null,
      paymentSchedule: text(offer.paymentSchedule, 40),
      paymentTypes:
        offer.paymentTypes == null
          ? null
          : list(offer.paymentTypes, 8).map((type) => text(type, 80)),
    };
    const result = discoveryHit(hit, "Nuitee hotel rates; final checkout terms unverified");
    return {
      ...result,
      supplierReferences,
      planningDetails: {
        ...result.planningDetails,
        accommodationType: text(content?.hotelType, 200),
      },
    };
  }
  async function getRates(
    query: SupplyReadQuery,
    input: z.infer<typeof searchSchema>,
    signal: AbortSignal,
    hotelId?: string,
  ) {
    const { hotelIds, placeId, ...facts } = input;
    const body = {
      ...facts,
      ...(hotelId ? { hotelIds: [hotelId] } : hotelIds ? { hotelIds } : { placeId }),
      checkin: query.startDate,
      checkout: query.endDate,
      currency: query.currency,
      timeout: 6,
      limit: 32,
      maxRatesPerHotel: hotelId ? 16 : 1,
      roomMapping: true,
    };
    const response = record(
      await readJson(http, [`POST ${ratesUrl}`], headers)(ratesUrl, "POST", signal, body),
    );
    return list(response.data, 32);
  }
  return {
    capabilities: {
      search: "supported",
      detail: "supported",
      revalidation: "unsupported",
    } satisfies NonNullable<ReadOfferClient["capabilities"]>,
    search: (raw: SupplyReadQuery, signal: AbortSignal) =>
      safeMapping(async () => {
        const query = validateQuery(raw);
        const input = selection(query);
        const hotels = await getRates(query, input, signal);
        const hits: ReturnType<typeof mapOffer>[] = [];
        const offerHotels = new Map<string, string>();
        for (const rawHotel of hotels) {
          const hotel = record(rawHotel);
          const hotelId = identifier(hotel.hotelId);
          if (input.hotelIds && !input.hotelIds.includes(hotelId))
            throw new SupplyReadError("error");
          for (const offer of list(hotel.roomTypes, 32)) {
            const hit = mapOffer(hotelId, offer, query, input);
            const previousHotel = offerHotels.get(hit.offerId);
            if (previousHotel && previousHotel !== hotelId) throw new SupplyReadError("error");
            offerHotels.set(hit.offerId, hotelId);
            if (hits.length < 32) hits.push(hit);
          }
        }
        for (const hit of hits) {
          if (grants.size >= 4096) {
            const oldest = grants.keys().next();
            if (!oldest.done) grants.delete(oldest.value);
          }
          grants.set(`${queryKey(query)}:${hit.offerId}`, {
            query: queryKey(query),
            hotelId: hit.supplierReferences.accommodationId,
          });
        }
        return hits;
      }),
    detail: (offerId: string, raw: SupplyReadQuery, signal: AbortSignal) =>
      safeMapping(async () => {
        const query = validateQuery(raw);
        const grant = grants.get(`${queryKey(query)}:${offerId}`);
        if (!grant || grant.query !== queryKey(query)) throw new SupplyReadError("unsupported");
        const input = selection(query);
        const url = `https://api.liteapi.travel/v3.0/data/hotel?hotelId=${encodeURIComponent(grant.hotelId)}`;
        const content = record(
          record(await readJson(http, [`GET ${url}`], headers)(url, "GET", signal)).data,
        );
        if (content.id !== grant.hotelId) throw new SupplyReadError("error");
        const hotels = await getRates(query, input, signal, grant.hotelId);
        for (const rawHotel of hotels) {
          const hotel = record(rawHotel);
          if (hotel.hotelId !== grant.hotelId) throw new SupplyReadError("error");
          for (const rawOffer of list(hotel.roomTypes, 32)) {
            if (record(rawOffer).offerId === offerId)
              return mapOffer(grant.hotelId, rawOffer, query, input, content);
          }
        }
        throw new SupplyReadError("unsupported");
      }),
  };
}
