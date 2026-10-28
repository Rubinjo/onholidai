import { z } from "zod";

import { MAX_SUPPLIER_ID_LENGTH } from "@/domain/trip/schema";

import { SUPPLIER_ATTEMPT_TIMEOUT_MS, SUPPLIER_ATTEMPTS } from "../deadlines";
import { SupplyReadError, isSupplyReadError, type SupplyReadQuery } from "../read";
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
const opaqueIdPattern = new RegExp(`^[A-Za-z0-9_+/=-]{1,${MAX_SUPPLIER_ID_LENGTH}}$`);
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
    // A named destination is resolved to a supplier place before rates are read.
    placeName: z.string().trim().min(1).max(120).optional(),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    sessionId: idSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      [value.hotelIds, value.placeId, value.placeName].filter((item) => item !== undefined)
        .length === 1,
  )
  .refine((value) => value.placeName === undefined || value.countryCode !== undefined);
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
  const placesUrl = "https://api.liteapi.travel/v3.0/data/places";
  const http = {
    ...options,
    // Rate reads page several hotels and occasionally wait on supplier inventory; the
    // shared attempt budget is the real ceiling, so keep this aligned with it.
    timeoutMs: Math.min(
      SUPPLIER_ATTEMPT_TIMEOUT_MS,
      options.timeoutMs ?? SUPPLIER_ATTEMPT_TIMEOUT_MS,
    ),
    attempts: options.attempts ?? SUPPLIER_ATTEMPTS,
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
  function offerMoney(raw: unknown) {
    if (!Array.isArray(raw)) return record(raw);
    const values = list(raw, 1);
    if (values.length !== 1) throw new SupplyReadError("error");
    return record(values[0]);
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
    hotel?: Record<string, unknown>,
  ) {
    const offer = record(raw);
    const offerId = identifier(offer.offerId, opaqueIdPattern);
    const hit = emptyHit(offerId, query.currency, checkedAt(options));
    const rates = list(offer.rates, 16);
    if (rates.length !== input.occupancies.length) throw new SupplyReadError("error");
    const seen = new Set<number>();
    let retailTotal = 0;
    let dueAtProperty = 0;
    let includedCharges = 0;
    let excludedCharges = 0;
    let capacity = 0;
    let capacityKnown = true;
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
      rateIds.push(identifier(rate.rateId, opaqueIdPattern));
      if (rate.mappedRoomId != null) roomIds.push(identifier(String(rate.mappedRoomId)));
      const occupancyCap = rate.maxOccupancy;
      if (
        typeof occupancyCap === "number" &&
        Number.isInteger(occupancyCap) &&
        occupancyCap > 0 &&
        occupancyCap <= 64
      )
        capacity = add(capacity, occupancyCap);
      else capacityKnown = false;
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
              if (currency === query.currency) {
                if (charge.included) includedCharges = add(includedCharges, minor);
                else {
                  dueAtProperty = add(dueAtProperty, minor);
                  excludedCharges = add(excludedCharges, minor);
                }
              } else if (charge.included) {
                // Unconvertible included tax leaves the tax line unknown.
                chargesKnown = false;
              } else {
                chargesKnown = false;
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
    const declaredTotal = amount(offerMoney(offer.offerRetailRate), query.currency);
    if (declaredTotal !== retailTotal) throw new SupplyReadError("error");
    const sellingPrice =
      offer.suggestedSellingPrice == null ? null : offerMoney(offer.suggestedSellingPrice);
    // Enriched public totals can already include property charges; do not add them twice.
    const sellingChargesUnknown = dueAtProperty > 0 && sellingPrice?.source != null;
    // The payable total is what the traveller is quoted: the supplier selling price
    // (or the retail total) plus any charge paid at the property. Charge lines that
    // are not established stay null in the price so the breakdown remains unverified.
    // A membership-restricted rate cannot be bought by an unverified traveller, so it
    // carries no public total; every other rate publishes the payable total.
    hit.customerMinor =
      offer.loyaltyMembershipIdRequired === true
        ? null
        : sellingPrice === null
          ? add(retailTotal, sellingChargesUnknown ? 0 : dueAtProperty)
          : add(amount(sellingPrice, query.currency), sellingChargesUnknown ? 0 : dueAtProperty);
    hit.taxesMinor = chargesKnown ? includedCharges : null;
    hit.feesMinor = chargesKnown ? excludedCharges : null;
    hit.availability = "available";
    const supplierReferences = {
      accommodationId: hotelId,
      rateIds,
      roomIds,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    };
    hit.supplierReferences = supplierReferences;
    // Room capacity is a sourced fact, so the party bounds it implies are stated rather
    // than left unknown: children consume the remaining beds and vice versa.
    const guests = input.occupancies.reduce(
      (sum, occupancy) => sum + occupancy.adults + occupancy.children.length,
      0,
    );
    const partyChildren = input.occupancies.reduce(
      (sum, occupancy) => sum + occupancy.children.length,
      0,
    );
    const partyAdults = guests - partyChildren;
    hit.maximumAdults =
      capacityKnown && capacity >= partyChildren ? capacity - partyChildren : null;
    hit.maximumChildren = capacityKnown && capacity >= partyAdults ? capacity - partyAdults : null;
    // The stay window is the authoritative service period; clock times stay unverified.
    hit.serviceStart = `${query.startDate}T00:00:00Z`;
    hit.serviceEnd = `${query.endDate}T00:00:00Z`;
    hit.details = {
      name: text(content?.name) ?? text(hotel?.name),
      // LiteAPI includes hotel data for filter searches; keep only the public
      // location facts the traveller needs to recognise the property.
      address: text(content?.address, 240) ?? text(hotel?.address, 240),
      city: text(content?.city, 120) ?? text(hotel?.city_name, 120),
      country:
        text(content?.country, 120) ?? text(hotel?.country, 120) ?? text(hotel?.country_code, 120),
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
  const placeCache = new Map<string, string>();

  // LiteAPI identifies cities by its own place id, so a named destination is
  // resolved once instead of storing a supplier id the traveller could never verify.
  async function placeFor(name: string, countryCode: string, signal: AbortSignal): Promise<string> {
    const key = `${countryCode}|${name.toLocaleLowerCase("en")}`;
    const cached = placeCache.get(key);
    if (cached) return cached;
    const url = `${placesUrl}?${new URLSearchParams({ textQuery: name, countryCode })}`;
    const response = record(await readJson(http, [`GET ${url}`], headers)(url, "GET", signal));
    const places = list(response.data, 20).map(record);
    const match =
      places.find(
        (place) =>
          text(place.displayName, 120)?.toLocaleLowerCase("en") === name.toLocaleLowerCase("en"),
      ) ?? places[0];
    const placeId = identifier(match?.placeId, /^[A-Za-z0-9_-]{1,256}$/);
    if (placeCache.size >= 200) placeCache.delete(placeCache.keys().next().value!);
    placeCache.set(key, placeId);
    return placeId;
  }

  async function getRates(
    query: SupplyReadQuery,
    input: z.infer<typeof searchSchema>,
    signal: AbortSignal,
    hotelId?: string,
  ) {
    const { hotelIds, placeId, placeName, countryCode, ...facts } = input;
    void countryCode;
    const resolvedPlaceId =
      placeId ?? (placeName ? await placeFor(placeName, input.countryCode!, signal) : undefined);
    const body = {
      ...facts,
      ...(hotelId
        ? { hotelIds: [hotelId] }
        : hotelIds
          ? { hotelIds }
          : { placeId: resolvedPlaceId, includeHotelData: true }),
      checkin: query.startDate,
      checkout: query.endDate,
      currency: query.currency,
      // Supplier-side wait for rate completeness, in seconds. The previous six
      // seconds dropped rates that the supplier could still have priced.
      timeout: 10,
      limit: 32,
      maxRatesPerHotel: hotelId ? 16 : 1,
      roomMapping: true,
    };
    const response = record(
      await readJson(http, [`POST ${ratesUrl}`], headers)(ratesUrl, "POST", signal, body),
    );
    // Filter searches include the hotel name and address alongside the dated rates.
    const metadata = new Map(
      (Array.isArray(response.hotels) ? list(response.hotels, 64) : []).flatMap((raw) => {
        const hotel = record(raw);
        const id = text(hotel.id, 256);
        return id ? [[id, hotel] as const] : [];
      }),
    );
    return { rates: list(response.data, 32), metadata };
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
        const { rates: hotels, metadata } = await getRates(query, input, signal);
        const hits: ReturnType<typeof mapOffer>[] = [];
        const offerHotels = new Map<string, string>();
        // A multi-hotel page can contain one rate whose own totals disagree (a
        // supplier rounding artefact). Drop that offer instead of discarding the
        // whole page, and never substitute a guessed price for it.
        let rejected: SupplyReadError | null = null;
        for (const rawHotel of hotels) {
          const hotel = record(rawHotel);
          const hotelId = identifier(hotel.hotelId);
          if (input.hotelIds && !input.hotelIds.includes(hotelId))
            throw new SupplyReadError("error");
          for (const offer of list(hotel.roomTypes, 32)) {
            let hit: ReturnType<typeof mapOffer>;
            try {
              hit = mapOffer(hotelId, offer, query, input, undefined, metadata.get(hotelId));
            } catch (error) {
              if (!isSupplyReadError(error)) throw error;
              rejected = rejected ?? error;
              continue;
            }
            const previousHotel = offerHotels.get(hit.offerId);
            if (previousHotel && previousHotel !== hotelId) throw new SupplyReadError("error");
            offerHotels.set(hit.offerId, hotelId);
            if (hits.length < 32) hits.push(hit);
          }
        }
        if (!hits.length && rejected) throw rejected;
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
        for (const rawHotel of hotels.rates) {
          const hotel = record(rawHotel);
          if (hotel.hotelId !== grant.hotelId) throw new SupplyReadError("error");
          for (const rawOffer of list(hotel.roomTypes, 32)) {
            if (record(rawOffer).offerId === offerId)
              return mapOffer(
                grant.hotelId,
                rawOffer,
                query,
                input,
                content,
                hotels.metadata.get(grant.hotelId),
              );
          }
        }
        throw new SupplyReadError("unsupported");
      }),
  };
}
