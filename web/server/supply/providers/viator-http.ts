import { SUPPLIER_ATTEMPTS } from "../deadlines";
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
  type WireHit,
} from "./read-http";

import type { ReadOfferClient } from "./adapter";

export interface ViatorPaxMix {
  ageBand: "ADULT" | "SENIOR" | "YOUTH" | "CHILD" | "INFANT" | "TRAVELER";
  numberOfTravelers: number;
}
export interface ViatorHttpOptions extends ReadHttpOptions {
  apiKey: string;
  environment?: "production" | "sandbox";
  /**
   * Trusted destination identity lookup. A single id, or ranked candidates where a
   * narrower place failed at the supplier and its parent country is a legitimate
   * wider coverage area.
   */
  resolveDestination: (
    destinationId: string,
    query: SupplyReadQuery,
    signal?: AbortSignal,
  ) => string | readonly string[] | null | undefined | Promise<string | readonly string[] | null>;
  /** Must establish the exact product age bands from trusted traveller facts, not guess adult ages. */
  resolvePaxMix?: (
    query: SupplyReadQuery,
    product: Readonly<Record<string, unknown>>,
  ) => readonly ViatorPaxMix[] | null;
}

// Official OpenAPI: https://docs.viator.com/partner-api/technical/
// Products/search, products/{product-code}, availability/check are the complete operation set.
export function createViatorHttpClient(options: ViatorHttpOptions) {
  if (
    options.environment !== undefined &&
    !["production", "sandbox"].includes(options.environment)
  ) {
    throw new SupplyReadError("unsupported");
  }
  const http = { ...options, attempts: options.attempts ?? SUPPLIER_ATTEMPTS };
  const base =
    options.environment === "sandbox"
      ? "https://api.sandbox.viator.com/partner"
      : "https://api.viator.com/partner";
  const headers = {
    "exp-api-key": secret(options.apiKey),
    Accept: "application/json;version=2.0",
    "Content-Type": "application/json;version=2.0",
    "Accept-Language": "en",
  };
  const grants = new Map<string, string>();
  const code = (value: unknown) => identifier(value, /^[A-Za-z0-9_-]{1,100}$/);
  const numberFact = (value: unknown, maximum: number, integer = true): number | null => {
    if (value == null) return null;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > maximum ||
      (integer && !Number.isSafeInteger(value))
    )
      throw new SupplyReadError("error");
    return value;
  };

  function mapProduct(value: unknown, query: SupplyReadQuery): WireHit {
    const product = record(value);
    const hit = emptyHit(code(product.productCode), query.currency, checkedAt(options));
    hit.availability = "unknown";
    hit.supplierReferences = { productCode: hit.offerId };
    hit.details = {
      title: text(product.title),
      productCode: hit.offerId,
      productOptionCode: null,
      availability: "content_only",
      priceBasis: "from_price_not_party_total",
    };
    if (product.pricing != null) {
      const pricing = record(product.pricing);
      if (pricing.currency !== query.currency) throw new SupplyReadError("unsupported");
      const summary = record(pricing.summary);
      hit.details.fromPriceMinor = decimalMinor(summary.fromPrice, query.currency);
    }
    hit.details.productOptions =
      product.productOptions == null
        ? null
        : list(product.productOptions, 16).map((value) => {
            const option = record(value);
            return {
              optionCode: code(option.productOptionCode),
              description: text(option.description, 160),
            };
          });
    hit.details.bookingQuestionCount =
      product.bookingQuestions == null ? null : list(product.bookingQuestions, 64).length;
    hit.details.bookingPrerequisites = "trusted_answers_unverified";
    hit.details.confirmationType = text(product.confirmationType, 80);
    if (product.pricingInfo != null) {
      hit.details.ageBands = list(record(product.pricingInfo).ageBands, 16).map((value) => {
        const band = record(value);
        return {
          ageBand: text(band.ageBand, 20),
          startAge: numberFact(band.startAge, 120),
          endAge: numberFact(band.endAge, 120),
        };
      });
    }
    hit.details.cancellationPolicy =
      product.cancellationPolicy == null
        ? null
        : (() => {
            const policy = record(product.cancellationPolicy);
            return {
              type: text(policy.type, 40),
              refundEligibility:
                policy.refundEligibility == null
                  ? null
                  : list(policy.refundEligibility, 16).map((value) => {
                      const window = record(value);
                      return {
                        dayRangeMin: numberFact(window.dayRangeMin, 100_000),
                        dayRangeMax: numberFact(window.dayRangeMax, 100_000),
                        percentageRefundable: numberFact(window.percentageRefundable, 100, false),
                      };
                    }),
            };
          })();
    // A content summary's "from" price is not current party/date pricing or eligibility evidence.
    return hit;
  }

  function authorize(offerId: string, query: SupplyReadQuery) {
    code(offerId);
    if (grants.get(offerId) !== queryKey(query)) throw new SupplyReadError("unsupported");
  }

  async function getProduct(offerId: string, query: SupplyReadQuery, signal: AbortSignal) {
    authorize(offerId, query);
    const url = `${base}/products/${offerId}`;
    const product = record(await readJson(http, [`GET ${url}`], headers)(url, "GET", signal));
    if (product.productCode !== offerId) throw new SupplyReadError("error");
    return product;
  }

  return {
    capabilities: {
      search: "supported",
      detail: "supported",
      revalidation: options.resolvePaxMix ? "supported" : "unsupported",
    } satisfies NonNullable<ReadOfferClient["capabilities"]>,
    search: (input: SupplyReadQuery, signal: AbortSignal) =>
      safeMapping(async () => {
        const query = validateQuery(input);
        if (query.destinationIds.length !== 1)
          throw new SupplyReadError("unsupported", undefined, {
            retryable: false,
            detail: "multiple_destinations",
          });
        const requested = options.resolveDestination(query.destinationIds[0], query, signal);
        // A synchronous resolver must not yield the event loop: cancellation relies on
        // the transport being invoked before the caller's abort is observed.
        const resolved =
          requested && typeof (requested as Promise<unknown>).then === "function"
            ? await (requested as Promise<string | readonly string[] | null>)
            : (requested as string | readonly string[] | null | undefined);
        const candidates = (Array.isArray(resolved) ? resolved : [resolved])
          .filter((value): value is string => typeof value === "string")
          .map((value) => identifier(value, /^\d{1,12}$/))
          .filter((value, index, all) => all.indexOf(value) === index)
          .slice(0, 2);
        if (!candidates.length)
          throw new SupplyReadError("unsupported", undefined, {
            retryable: false,
            detail: "destination_unresolved",
          });
        const url = `${base}/products/search`;
        const search = async (destination: string) => {
          const response = record(
            await readJson(http, [`POST ${url}`], headers)(url, "POST", signal, {
              filtering: { destination, startDate: query.startDate, endDate: query.endDate },
              pagination: { start: 1, count: 32 },
              currency: query.currency,
            }),
          );
          const products = list(response.products);
          const hits: WireHit[] = [];
          let rejected = 0;
          let firstRejection: SupplyReadError | null = null;
          // One unusable product record is a partial supplier response, not a failed
          // search: keep every product that maps cleanly and disclose the shortfall.
          for (const product of products.slice(0, 32)) {
            try {
              hits.push(mapProduct(product, query));
            } catch (error) {
              if (!isSupplyReadError(error)) throw error;
              rejected += 1;
              firstRejection = firstRejection ?? error;
            }
          }
          if (!hits.length && rejected) throw firstRejection ?? new SupplyReadError("error");
          return hits;
        };
        let failure: unknown;
        for (const destination of candidates) {
          try {
            const hits = await search(destination);
            for (const hit of hits) {
              if (grants.size >= 256) grants.delete(grants.keys().next().value!);
              grants.set(hit.offerId, queryKey(query));
            }
            return hits.map((hit) => discoveryHit(hit, "Viator"));
          } catch (error) {
            failure = error;
            const transient = isSupplyReadError(error) && error.retryable && !signal.aborted;
            if (!transient) throw error;
          }
        }
        throw isSupplyReadError(failure) ? failure : new SupplyReadError("error");
      }),
    detail: (offerId: string, query: SupplyReadQuery, signal: AbortSignal) =>
      safeMapping(async () => {
        const product = await getProduct(offerId, query, signal);
        return discoveryHit(mapProduct(product, query), "Viator");
      }),
    revalidate: (offerId: string, query: SupplyReadQuery, signal: AbortSignal) =>
      safeMapping(async () => {
        authorize(offerId, query);
        // A multi-day research range does not authorize silently choosing an activity date.
        if (query.startDate !== query.endDate || !options.resolvePaxMix)
          throw new SupplyReadError("unsupported");
        const product = await getProduct(offerId, query, signal);
        const mix = options.resolvePaxMix(query, product);
        if (
          !mix ||
          mix.length < 1 ||
          mix.length > 6 ||
          mix.some(
            (pax) =>
              !["ADULT", "SENIOR", "YOUTH", "CHILD", "INFANT", "TRAVELER"].includes(pax.ageBand) ||
              !Number.isInteger(pax.numberOfTravelers) ||
              pax.numberOfTravelers < 1 ||
              pax.numberOfTravelers > 16,
          ) ||
          new Set(mix.map((pax) => pax.ageBand)).size !== mix.length ||
          mix.reduce((sum, pax) => sum + pax.numberOfTravelers, 0) !==
            query.travellerParty.adults + query.travellerParty.children.length
        )
          throw new SupplyReadError("unsupported");
        const url = `${base}/availability/check`;
        const response = record(
          await readJson(http, [`POST ${url}`], headers)(url, "POST", signal, {
            productCode: offerId,
            travelDate: query.startDate,
            currency: query.currency,
            paxMix: mix.map((pax) => ({
              ageBand: pax.ageBand,
              numberOfTravelers: pax.numberOfTravelers,
            })),
          }),
        );
        if (
          response.productCode !== offerId ||
          response.travelDate !== query.startDate ||
          response.currency !== query.currency
        )
          throw new SupplyReadError("error");
        const items = list(response.bookableItems, 256).map(record);
        if (items.some((item) => typeof item.available !== "boolean"))
          throw new SupplyReadError("error");
        const available = items.filter((item) => item.available === true);
        const hit = mapProduct(product, query);
        hit.availability =
          available.length === 0 ? "unavailable" : available.length === 1 ? "available" : "unknown";
        hit.supplierReferences = { productCode: offerId };
        const bookableOptions = available.map((item) => {
          const extras = item.extraChargesSummary == null ? null : record(item.extraChargesSummary);
          return {
            optionCode: item.productOptionCode == null ? null : code(item.productOptionCode),
            startTime: text(item.startTime, 5),
            recommendedRetailMinor: decimalMinor(
              record(record(item.totalPrice).price).recommendedRetailPrice,
              query.currency,
            ),
            retailIncludingExtrasMinor:
              extras === null
                ? null
                : decimalMinor(record(extras.price).recommendedRetailPrice, query.currency),
            mandatoryFeesMinor:
              extras === null
                ? null
                : decimalMinor(record(extras.mandatory).totalExtraCharges, query.currency),
          };
        });
        const tax = response.tax == null ? null : record(response.tax);
        const taxFact = (value: unknown): boolean | null => {
          if (value == null) return null;
          if (typeof value !== "boolean") throw new SupplyReadError("error");
          return value;
        };
        const selected = bookableOptions.length === 1 ? bookableOptions[0] : null;
        if (selected?.optionCode) hit.supplierReferences.optionCode = selected.optionCode;
        hit.details = {
          ...hit.details,
          productOptionCode: selected?.optionCode ?? null,
          travelDate: query.startDate,
          startTime: selected?.startTime ?? null,
          availability:
            available.length === 0
              ? "unavailable"
              : selected
                ? "available_not_reserved"
                : "option_selection_unresolved",
          recommendedRetailMinor: selected?.recommendedRetailMinor ?? null,
          retailIncludingExtrasMinor: selected?.retailIncludingExtrasMinor ?? null,
          bookableOptions,
          taxFacts:
            tax === null
              ? null
              : { taxable: taxFact(tax.isTaxable), exempt: taxFact(tax.isExempt) },
          pricingParty: mix.map((pax) => ({
            ageBand: pax.ageBand,
            numberOfTravelers: pax.numberOfTravelers,
          })),
          priceBasis: "recommended_retail_not_approved_customer_total",
          mandatoryFeesMinor: selected?.mandatoryFeesMinor ?? null,
        };
        // Inclusive retail already includes destination extras; never add them again.
        // Tax flags do not establish tax amounts or the merchant's approved customer total.
        return discoveryHit(hit, "Viator");
      }),
  };
}
