import { SupplyReadError, type SupplyReadQuery } from "../read";
import { checkedAt, decimalMinor, discoveryHit, emptyHit, identifier, instant, list, queryKey, readJson, record,
  safeMapping, secret, text, validateQuery, type ReadHttpOptions, type WireHit } from "./read-http";

export interface DuffelStaysHttpOptions extends ReadHttpOptions {
  readToken: string;
  /** Independently established Stays read-key access; Flights access is insufficient. */
  accessApproved?: boolean;
  resolveSearch: (query: SupplyReadQuery) => {
    latitude: number; longitude: number; radiusKm: number; rooms: number;
  } | null;
}

// https://duffel.com/docs/guides/getting-started-with-stays
// Quote creation is intentionally excluded: no-hold semantics/read-key permission are unestablished.
export function createDuffelStaysHttpClient(options: DuffelStaysHttpOptions) {
  const headers = { Authorization: `Bearer ${secret(options.readToken)}`, "Duffel-Version": "v2",
    Accept: "application/json", "Content-Type": "application/json" };
  const url = "https://api.duffel.com/stays/search";
  const grants = new Map<string, string>();

  function mapResult(value: unknown, query: SupplyReadQuery): WireHit {
    const result = record(value);
    const accommodation = record(result.accommodation);
    if (result.check_in_date !== query.startDate || result.check_out_date !== query.endDate) throw new SupplyReadError("error");
    const hit = emptyHit(identifier(result.id, /^srr_[A-Za-z0-9]{1,120}$/), query.currency, checkedAt(options));
    if (result.cheapest_rate_currency !== query.currency) throw new SupplyReadError("unsupported");
    hit.expiresAt = instant(result.expires_at);
    hit.supplierReferences = { accommodationId: identifier(accommodation.id, /^acc_[A-Za-z0-9]{1,120}$/),
      searchResultId: hit.offerId };
    hit.details = {
      accommodationId: identifier(accommodation.id, /^acc_[A-Za-z0-9]{1,120}$/),
      name: text(accommodation.name), propertyType: null, roomId: null, rateId: null, quoteId: null,
      checkInDate: result.check_in_date === query.startDate ? query.startDate : null,
      checkOutDate: result.check_out_date === query.endDate ? query.endDate : null,
      priceFromMinor: decimalMinor(result.cheapest_rate_total_amount, query.currency),
      mandatoryFeesMinor: null, depositMinor: null, dueAtPropertyMinor: null,
      availability: "search_result_not_quoted",
    };
    if (result.cheapest_rate_due_at_accommodation_amount != null) {
      if (result.cheapest_rate_due_at_accommodation_currency !== query.currency) throw new SupplyReadError("unsupported");
      hit.details.dueAtPropertyMinor = decimalMinor(result.cheapest_rate_due_at_accommodation_amount, query.currency);
    }
    // Search can contain incomplete/inaccurate room/rate data. Only fetch_all_rates is detail evidence.
    return hit;
  }

  return {
    search: (input: SupplyReadQuery, signal: AbortSignal) => safeMapping(async () => {
      if (options.accessApproved !== true) throw new SupplyReadError("access_blocked");
      const query = validateQuery(input);
      const location = options.resolveSearch(query);
      if (!location || query.destinationIds.length !== 1 || query.endDate <= query.startDate
        || !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90
        || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180
        || !Number.isFinite(location.radiusKm) || location.radiusKm <= 0 || location.radiusKm > 50
        || !Number.isInteger(location.rooms) || location.rooms < 1 || location.rooms > 8) throw new SupplyReadError("unsupported");
      const response = record(await readJson(options, [`POST ${url}`], headers)(url, "POST", signal, {
        data: { rooms: location.rooms, location: { radius: location.radiusKm,
          geographic_coordinates: { latitude: location.latitude, longitude: location.longitude } },
        guests: [...Array.from({ length: query.travellerParty.adults }, () => ({ type: "adult" })),
          ...query.travellerParty.children.map((child) => ({ type: "child", age: child.ageAtTripStart }))],
        check_in_date: query.startDate, check_out_date: query.endDate },
      }));
      const hits = list(record(response.data).results).slice(0, 32).map((result) => mapResult(result, query));
      for (const hit of hits) {
        if (grants.size >= 256) grants.delete(grants.keys().next().value!);
        grants.set(hit.offerId, queryKey(query));
      }
      return hits.map((hit) => discoveryHit(hit, "Duffel Stays"));
    }),
    detail: (offerId: string, query: SupplyReadQuery, signal: AbortSignal) => safeMapping(async () => {
      if (options.accessApproved !== true) throw new SupplyReadError("access_blocked");
      identifier(offerId, /^srr_[A-Za-z0-9]{1,120}$/);
      if (grants.get(offerId) !== queryKey(query)) throw new SupplyReadError("unsupported");
      const detailUrl = `https://api.duffel.com/stays/search_results/${offerId}/actions/fetch_all_rates`;
      const response = record(await readJson(options, [`POST ${detailUrl}`], headers)(detailUrl, "POST", signal));
      const result = record(response.data);
      const hit = mapResult(result, query);
      if (hit.offerId !== offerId) throw new SupplyReadError("error");
      hit.details.rooms = list(record(result.accommodation).rooms, 128).slice(0, 16).map((value) => {
        const room = record(value);
        return { name: text(room.name), roomId: null, rates: list(room.rates, 128).slice(0, 16).map((value) => {
          const rate = record(value);
          if (rate.total_currency !== query.currency) throw new SupplyReadError("unsupported");
          const amount = (field: string, currencyField: string) => {
            if (rate[field] == null) return null;
            if (rate[currencyField] !== query.currency) throw new SupplyReadError("unsupported");
            return decimalMinor(rate[field], query.currency);
          };
          return { rateId: identifier(rate.id, /^rat_[A-Za-z0-9]{1,120}$/), quoteId: null,
            name: text(rate.name), totalMinor: decimalMinor(rate.total_amount, query.currency),
            taxesMinor: amount("tax_amount", "tax_currency"), feesMinor: amount("fee_amount", "fee_currency"),
            dueAtPropertyMinor: amount("due_at_accommodation_amount", "due_at_accommodation_currency"),
            depositMinor: null, expiresAt: instant(rate.expires_at), boardType: text(rate.board_type, 80),
            paymentType: text(rate.payment_type, 80) };
        }) };
      });
      const rooms = hit.details.rooms as { rates: { rateId: string }[] }[];
      if (rooms.length === 1 && rooms[0].rates.length === 1) hit.supplierReferences!.rateId = rooms[0].rates[0].rateId;
      return discoveryHit(hit, "Duffel Stays");
    }),
    revalidate: async (...args: [string, SupplyReadQuery, AbortSignal]): Promise<never> => {
      void args;
      throw new SupplyReadError("unsupported");
    },
  };
}
