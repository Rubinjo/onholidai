import { SupplyReadError, type SupplyReadQuery } from "../read";
import { checkedAt, decimalMinor, discoveryHit, emptyHit, identifier, list, queryKey, readJson, record, safeMapping,
  secret, text, validateQuery, type ReadHttpOptions, type WireHit } from "./read-http";

export interface ViatorPaxMix {
  ageBand: "ADULT" | "SENIOR" | "YOUTH" | "CHILD" | "INFANT" | "TRAVELER";
  numberOfTravelers: number;
}
export interface ViatorHttpOptions extends ReadHttpOptions {
  apiKey: string;
  environment?: "production" | "sandbox";
  resolveDestination: (destinationId: string, query: SupplyReadQuery) => string | null;
  /** Must establish the exact product age bands from trusted traveller facts, not guess adult ages. */
  resolvePaxMix?: (query: SupplyReadQuery, product: Readonly<Record<string, unknown>>) => readonly ViatorPaxMix[] | null;
}

// Official OpenAPI: https://docs.viator.com/partner-api/technical/
// Products/search, products/{product-code}, availability/check are the complete operation set.
export function createViatorHttpClient(options: ViatorHttpOptions) {
  if (options.environment !== undefined && !["production", "sandbox"].includes(options.environment)) {
    throw new SupplyReadError("unsupported");
  }
  const base = options.environment === "sandbox" ? "https://api.sandbox.viator.com/partner" : "https://api.viator.com/partner";
  const headers = { "exp-api-key": secret(options.apiKey), Accept: "application/json;version=2.0",
    "Content-Type": "application/json;version=2.0", "Accept-Language": "en" };
  const grants = new Map<string, string>();
  const code = (value: unknown) => identifier(value, /^[A-Za-z0-9_-]{1,100}$/);

  function mapProduct(value: unknown, query: SupplyReadQuery): WireHit {
    const product = record(value);
    const hit = emptyHit(code(product.productCode), query.currency, checkedAt(options));
    hit.supplierReferences = { productCode: hit.offerId };
    hit.details = { title: text(product.title), productCode: hit.offerId, productOptionCode: null,
      availability: "content_only", priceBasis: "from_price_not_party_total" };
    if (product.pricing != null) {
      const pricing = record(product.pricing);
      if (pricing.currency !== query.currency) throw new SupplyReadError("unsupported");
      const summary = record(pricing.summary);
      hit.details.fromPriceMinor = decimalMinor(summary.fromPrice, query.currency);
    }
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
    const product = record(await readJson(options, [`GET ${url}`], headers)(url, "GET", signal));
    if (product.productCode !== offerId) throw new SupplyReadError("error");
    return product;
  }

  return {
    search: (input: SupplyReadQuery, signal: AbortSignal) => safeMapping(async () => {
      const query = validateQuery(input);
      if (query.destinationIds.length !== 1) throw new SupplyReadError("unsupported");
      const destination = identifier(options.resolveDestination(query.destinationIds[0], query), /^\d{1,12}$/);
      const url = `${base}/products/search`;
      const response = record(await readJson(options, [`POST ${url}`], headers)(url, "POST", signal, {
        filtering: { destination, startDate: query.startDate, endDate: query.endDate },
        pagination: { start: 1, count: 32 }, currency: query.currency,
      }));
      const hits = list(response.products).slice(0, 32).map((product) => mapProduct(product, query));
      for (const hit of hits) {
        if (grants.size >= 256) grants.delete(grants.keys().next().value!);
        grants.set(hit.offerId, queryKey(query));
      }
      return hits.map((hit) => discoveryHit(hit, "Viator"));
    }),
    detail: (offerId: string, query: SupplyReadQuery, signal: AbortSignal) => safeMapping(async () => {
      const product = await getProduct(offerId, query, signal);
      // Product detail pricingInfo defines age bands, not a current price.
      const hit = emptyHit(offerId, query.currency, checkedAt(options));
      hit.supplierReferences = { productCode: offerId };
      hit.details = { title: text(product.title), productCode: offerId, availability: "content_only",
        confirmationType: text(product.confirmationType, 80) };
      if (product.pricingInfo != null) {
        hit.details.ageBands = list(record(product.pricingInfo).ageBands, 16).map((value) => {
          const band = record(value);
          const age = (value: unknown) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 120 ? Number(value) : null;
          return { ageBand: text(band.ageBand, 20), startAge: age(band.startAge), endAge: age(band.endAge) };
        });
      }
      return discoveryHit(hit, "Viator");
    }),
    revalidate: (offerId: string, query: SupplyReadQuery, signal: AbortSignal) => safeMapping(async () => {
      authorize(offerId, query);
      // A multi-day research range does not authorize silently choosing an activity date.
      if (query.startDate !== query.endDate || !options.resolvePaxMix) throw new SupplyReadError("unsupported");
      const product = await getProduct(offerId, query, signal);
      const mix = options.resolvePaxMix(query, product);
      if (!mix || mix.length < 1 || mix.length > 6 || mix.some((pax) =>
        !["ADULT", "SENIOR", "YOUTH", "CHILD", "INFANT", "TRAVELER"].includes(pax.ageBand)
        || !Number.isInteger(pax.numberOfTravelers) || pax.numberOfTravelers < 1 || pax.numberOfTravelers > 16)
        || new Set(mix.map((pax) => pax.ageBand)).size !== mix.length
        || mix.reduce((sum, pax) => sum + pax.numberOfTravelers, 0)
          !== query.travellerParty.adults + query.travellerParty.children.length) throw new SupplyReadError("unsupported");
      const url = `${base}/availability/check`;
      const response = record(await readJson(options, [`POST ${url}`], headers)(url, "POST", signal, {
        productCode: offerId, travelDate: query.startDate, currency: query.currency,
        paxMix: mix.map((pax) => ({ ageBand: pax.ageBand, numberOfTravelers: pax.numberOfTravelers })),
      }));
      if (response.productCode !== offerId || response.travelDate !== query.startDate
        || response.currency !== query.currency) throw new SupplyReadError("error");
      const items = list(response.bookableItems, 256).map(record);
      if (items.some((item) => typeof item.available !== "boolean")) throw new SupplyReadError("error");
      const available = items.filter((item) => item.available === true);
      if (available.length !== 1) throw new SupplyReadError("unsupported");
      const item = available[0];
      const hit = emptyHit(offerId, query.currency, checkedAt(options));
      hit.supplierReferences = { productCode: offerId,
        ...(item.productOptionCode == null ? {} : { optionCode: code(item.productOptionCode) }) };
      const retail = decimalMinor(record(record(item.totalPrice).price).recommendedRetailPrice, query.currency);
      hit.details = { title: text(product.title), productCode: offerId,
        productOptionCode: item.productOptionCode == null ? null : code(item.productOptionCode),
        travelDate: query.startDate, startTime: text(item.startTime, 5),
        availability: "available_not_reserved", recommendedRetailMinor: retail,
        priceBasis: "recommended_retail_not_approved_customer_total", mandatoryFeesMinor: null };
      // Supplier economics and raw payloads are never forwarded. Extra charges, tax and the
      // merchant's approved customer-price policy remain prerequisites for a complete total.
      return discoveryHit(hit, "Viator");
    }),
  };
}
