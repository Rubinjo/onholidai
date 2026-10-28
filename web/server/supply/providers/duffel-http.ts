import { qualifiedInstant, serviceDate } from "@/domain/trip/feasibility-policy";

import { SUPPLIER_ATTEMPTS } from "../deadlines";
import { SupplyReadError, isSupplyReadError, type SupplyReadQuery } from "../read";
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
  /** Dedicated discovery token with offer-request creation permission, never the worker token. */
  readToken: string;
  /** Trusted place lookup, not an API URL or a model-supplied supplier identifier. */
  resolveDestination: (
    destinationId: string,
    query: SupplyReadQuery,
    signal?: AbortSignal,
  ) => string | null | Promise<string | null>;
  /** Trusted origin lookup used when the departure is a city without an IATA code. */
  resolveOrigin?: (
    query: SupplyReadQuery,
    signal?: AbortSignal,
  ) => string | null | Promise<string | null>;
}

// Official contracts: https://duffel.com/docs/api/v2/offer-requests and /offers.
// POST offer_requests performs search; no Orders, payment or hold endpoint is reachable.
export function createDuffelFlightsHttpClient(options: DuffelFlightsHttpOptions) {
  // Discovery reads opt in to bounded retries; transaction clients never do.
  const http: DuffelFlightsHttpOptions = {
    ...options,
    attempts: options.attempts ?? SUPPLIER_ATTEMPTS,
  };
  const headers = {
    Authorization: `Bearer ${secret(options.readToken)}`,
    "Duffel-Version": "v2",
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const searchUrl = "https://api.duffel.com/air/offer_requests?return_offers=false";
  // Requesting every offer in the offer request exceeds the bounded response size
  // for busy routes, so offers are read from one sorted, bounded page instead.
  const OFFER_PAGE_LIMIT = 32;
  const offersPageUrl = (offerRequestId: string) =>
    `https://api.duffel.com/air/offers?offer_request_id=${encodeURIComponent(offerRequestId)}&limit=${OFFER_PAGE_LIMIT}&sort=total_amount`;
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
    // The offer total does not establish service choices or payment surcharges, so the
    // fee line stays unknown while the payable total Duffel reports is authoritative.
    hit.feesMinor = null;
    hit.customerMinor = total;
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
      route: slices.map((slice) => {
        const legs = list(record(slice).segments, 16).map(record);
        return {
          origin: text(record(legs[0]?.origin).iata_code, 3),
          destination: text(record(legs.at(-1)?.destination).iata_code, 3),
        };
      }),
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
      const response = record(await readJson(http, [`GET ${url}`], headers)(url, "GET", signal));
      const hit = mapOffer(response.data, query);
      if (hit.offerId !== offerId) throw new SupplyReadError("error");
      return hit;
    });

  return {
    search: (input: SupplyReadQuery, signal: AbortSignal) =>
      safeMapping(async () => {
        const query = validateQuery(input);
        // A country or city selection carries no IATA code; the trusted resolver
        // supplies the gateway Duffel actually serves so the search is never floated
        // at an invented airport.
        const origin =
          query.departureOrigin?.airportCode ??
          (query.departureOrigin ? await options.resolveOrigin?.(query, signal) : null);
        if (!query.departureOrigin || !origin) throw new SupplyReadError("unsupported");
        const destination = identifier(
          await options.resolveDestination(query.destinationIds[0], query, signal),
          /^[A-Z]{3}$/,
        );
        if (origin === destination) throw new SupplyReadError("unsupported");
        const lastId = query.destinationIds.at(-1)!;
        const lastGateway =
          lastId === query.destinationIds[0]
            ? destination
            : await options.resolveDestination(lastId, query, signal);
        const returnGateways = [...new Set([destination, lastGateway])].filter(
          (code): code is string => Boolean(code && /^[A-Z]{3}$/.test(code) && code !== origin),
        );
        const passengers = [
          ...Array.from({ length: query.travellerParty.adults }, () => ({ type: "adult" })),
          ...query.travellerParty.children.map((child) => ({ age: child.ageAtTripStart })),
        ];
        const searchRoute = async (
          returnGateway: string,
          returnDate = query.endDate,
        ): Promise<ReturnType<typeof mapOffer>[]> => {
          const response = record(
            await readJson(http, [`POST ${searchUrl}`], headers)(searchUrl, "POST", signal, {
              data: {
                slices: [
                  { origin, destination, departure_date: query.startDate },
                  { origin: returnGateway, destination: origin, departure_date: returnDate },
                ],
                passengers,
              },
            }),
          );
          const offerRequestId = identifier(record(response.data).id, /^orq_[A-Za-z0-9]{1,64}$/);
          const pageUrl = offersPageUrl(offerRequestId);
          const page = record(
            await readJson(http, [`GET ${pageUrl}`], headers)(pageUrl, "GET", signal),
          );
          const hits: ReturnType<typeof mapOffer>[] = [];
          let rejected = 0;
          let firstRejection: SupplyReadError | null = null;
          // One unusable fare record must not discard an entire route's inventory.
          for (const offer of list(page.data, OFFER_PAGE_LIMIT)) {
            try {
              hits.push(mapOffer(offer, query));
            } catch (error) {
              if (!isSupplyReadError(error)) throw error;
              rejected += 1;
              firstRejection = firstRejection ?? error;
            }
          }
          // When no fare is usable, the page's own rejection reason is the honest status
          // (for example an unsupported currency) instead of a generic failure.
          if (!hits.length && rejected) throw firstRejection ?? new SupplyReadError("error");
          const timezone = query.departureOrigin?.timezone;
          const withinWindow = hits.filter(
            (hit) =>
              (!hit.serviceStart || serviceDate(hit.serviceStart, timezone) >= query.startDate) &&
              (!hit.serviceEnd || serviceDate(hit.serviceEnd, timezone) <= query.endDate),
          );
          // A last-day departure may land home the next day. Try the preceding
          // departure date once rather than proposing travel outside the reviewed window.
          if (!withinWindow.length && hits.length && returnDate === query.endDate) {
            const earlier = new Date(Date.parse(returnDate) - 86_400_000)
              .toISOString()
              .slice(0, 10);
            if (earlier > query.startDate) return searchRoute(returnGateway, earlier);
          }
          return withinWindow;
        };
        const routes = await Promise.allSettled(
          returnGateways.map((gateway) => searchRoute(gateway)),
        );
        const successful = routes.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        for (const result of routes) {
          if (result.status !== "rejected") continue;
          console.warn(
            JSON.stringify({
              event: "supplier_flight_route_failed",
              provider: "duffel",
              status: isSupplyReadError(result.reason) ? result.reason.status : "error",
              detail: isSupplyReadError(result.reason) ? result.reason.detail : "unexpected_error",
            }),
          );
        }
        if (!successful.some((hits) => hits.length)) {
          const failure = routes.find((result) => result.status === "rejected");
          if (failure?.status === "rejected") throw failure.reason;
        }
        // Keep both route shapes in the bounded page; they are competing total fares.
        const hits: ReturnType<typeof mapOffer>[] = [];
        for (let index = 0; index < OFFER_PAGE_LIMIT && hits.length < OFFER_PAGE_LIMIT; index += 1)
          for (const route of successful)
            if (route[index] && hits.length < OFFER_PAGE_LIMIT) hits.push(route[index]);
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
