import { qualifiedInstant } from "@/domain/trip/feasibility-policy";

import { SupplyReadError, type SupplyReadQuery } from "../read";
import {
  checkedAt,
  decimalMinor,
  discoveryHit,
  emptyHit,
  identifier,
  instant,
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

export interface DuffelFlightsHttpOptions extends ReadHttpOptions {
  readToken: string;
  /** Trusted place lookup, not an API URL or a model-supplied supplier identifier. */
  resolveDestination: (destinationId: string, query: SupplyReadQuery) => string | null;
}

// Official contracts: https://duffel.com/docs/api/v2/offer-requests and /offers.
// POST offer_requests performs search; no Orders, payment or hold endpoint is reachable.
export function createDuffelFlightsHttpClient(options: DuffelFlightsHttpOptions) {
  const headers = {
    Authorization: `Bearer ${secret(options.readToken)}`,
    "Duffel-Version": "v2",
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const searchUrl = "https://api.duffel.com/air/offer_requests?return_offers=true";
  const grants = new Map<string, string>();

  function serviceInstant(value: unknown, airport: Record<string, unknown>): string | null {
    const explicit = instant(value);
    if (explicit) return explicit;
    if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(value)) return null;
    const timezone = text(airport.time_zone, 120);
    const qualified = timezone ? qualifiedInstant(value, timezone) : null;
    return qualified === null ? null : new Date(qualified).toISOString();
  }

  function mapOffer(value: unknown, query: SupplyReadQuery) {
    const offer = record(value);
    const id = identifier(offer.id, /^off_[A-Za-z0-9]{1,120}$/);
    if (
      offer.total_currency !== query.currency ||
      offer.base_currency !== query.currency ||
      offer.tax_currency !== query.currency
    )
      throw new SupplyReadError("unsupported");
    const total = decimalMinor(offer.total_amount, query.currency);
    const base = decimalMinor(offer.base_amount, query.currency);
    const tax = decimalMinor(offer.tax_amount, query.currency);
    if (base + tax !== total || !Number.isSafeInteger(base + tax))
      throw new SupplyReadError("error");
    const slices = list(offer.slices, 8);
    if (!slices.length) throw new SupplyReadError("error");
    const segments = slices.flatMap((slice) => list(record(slice).segments, 16));
    if (!segments.length) throw new SupplyReadError("error");
    const hit = emptyHit(id, query.currency, checkedAt(options));
    hit.supplierMinor = base;
    hit.taxesMinor = tax;
    // The offer total does not establish service choices or payment surcharges.
    hit.feesMinor = null;
    hit.expiresAt = instant(offer.expires_at);
    hit.serviceStart = serviceInstant(
      record(segments[0]).departing_at,
      record(record(segments[0]).origin),
    );
    hit.serviceEnd = serviceInstant(
      record(segments.at(-1)).arriving_at,
      record(record(segments.at(-1)).destination),
    );
    const payment = offer.payment_requirements == null ? null : record(offer.payment_requirements);
    const passengerFares = segments.some((segment) => record(segment).passengers == null)
      ? null
      : segments.flatMap((segment, segmentIndex) =>
          list(record(segment).passengers, 16).map((value, passengerIndex) => {
            const passenger = record(value);
            const baggage =
              passenger.baggages == null
                ? null
                : list(passenger.baggages, 16).map((value) => {
                    const bag = record(value);
                    if (
                      !Number.isSafeInteger(bag.quantity) ||
                      Number(bag.quantity) < 0 ||
                      Number(bag.quantity) > 32
                    )
                      throw new SupplyReadError("error");
                    return {
                      type: identifier(bag.type, /^(checked|carry_on)$/),
                      quantity: Number(bag.quantity),
                    };
                  });
            return {
              segmentIndex,
              passengerIndex,
              cabinClass: text(passenger.cabin_class, 40),
              fareBasisCode: text(passenger.fare_basis_code, 80),
              baggage,
            };
          }),
        );
    hit.details = {
      segmentCount: segments.length,
      sliceCount: slices.length,
      originAirportCode: text(record(record(segments[0]).origin).iata_code, 3),
      destinationAirportCode: text(record(record(segments.at(-1)).destination).iata_code, 3),
      availability: "search_offer_not_reserved",
      fareBrands: slices.map((slice) => text(record(slice).fare_brand_name, 80)),
      passengerFares,
      extraCostsVerified: false,
      additionalServicesAvailable:
        offer.available_services == null ? null : list(offer.available_services, 256).length > 0,
      identityDocumentsRequired:
        typeof offer.passenger_identity_documents_required === "boolean"
          ? offer.passenger_identity_documents_required
          : null,
      paymentRequirements: {
        requiresInstantPayment:
          typeof payment?.requires_instant_payment === "boolean"
            ? payment.requires_instant_payment
            : null,
        paymentRequiredBy: instant(payment?.payment_required_by),
        priceGuaranteeExpiresAt: instant(payment?.price_guarantee_expires_at),
      },
    };
    const refund = offer.conditions && record(offer.conditions).refund_before_departure;
    if (refund && typeof record(refund).allowed === "boolean") {
      hit.details.refundBeforeDepartureAllowed = record(refund).allowed as boolean;
    }
    return discoveryHit(hit, "Duffel Flights");
  }

  const current = (offerId: string, query: SupplyReadQuery, signal: AbortSignal) =>
    safeMapping(async () => {
      identifier(offerId, /^off_[A-Za-z0-9]{1,120}$/);
      if (grants.get(offerId) !== queryKey(query)) throw new SupplyReadError("unsupported");
      const url = `https://api.duffel.com/air/offers/${offerId}`;
      const response = record(await readJson(options, [`GET ${url}`], headers)(url, "GET", signal));
      const hit = mapOffer(response.data, query);
      if (hit.offerId !== offerId) throw new SupplyReadError("error");
      return hit;
    });

  return {
    search: (input: SupplyReadQuery, signal: AbortSignal) =>
      safeMapping(async () => {
        const query = validateQuery(input);
        if (query.destinationIds.length !== 1 || !query.departureOrigin?.airportCode)
          throw new SupplyReadError("unsupported");
        const origin = identifier(query.departureOrigin.airportCode, /^[A-Z]{3}$/);
        const destination = identifier(
          options.resolveDestination(query.destinationIds[0], query),
          /^[A-Z]{3}$/,
        );
        if (origin === destination) throw new SupplyReadError("unsupported");
        const passengers = [
          ...Array.from({ length: query.travellerParty.adults }, () => ({ type: "adult" })),
          ...query.travellerParty.children.map((child) => ({ age: child.ageAtTripStart })),
        ];
        const response = record(
          await readJson(options, [`POST ${searchUrl}`], headers)(searchUrl, "POST", signal, {
            data: {
              slices: [
                { origin, destination, departure_date: query.startDate },
                { origin: destination, destination: origin, departure_date: query.endDate },
              ],
              passengers,
            },
          }),
        );
        const hits = list(record(response.data).offers)
          .slice(0, 32)
          .map((offer) => mapOffer(offer, query));
        for (const hit of hits) {
          if (grants.size >= 256) grants.delete(grants.keys().next().value!);
          grants.set(hit.offerId, queryKey(query));
        }
        return hits;
      }),
    detail: current,
    revalidate: current,
  };
}

export const createDuffelHttpClient = createDuffelFlightsHttpClient;
