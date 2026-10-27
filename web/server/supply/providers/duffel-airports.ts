import { z } from "zod";

import { identifier, secret } from "./read-http";

const IATA = /^[A-Z]{3}$/;
const SUGGESTIONS_URL = "https://api.duffel.com/places/suggestions";
const CACHE_MS = 10 * 60_000;
const CACHE_LIMIT = 200;
const RESPONSE_LIMIT = 131_072;

const suggestionsSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            type: z.string().max(40),
            iata_code: z.string().regex(IATA).nullish(),
            city_name: z.string().max(120).nullish(),
            airports: z
              .array(
                z
                  .object({
                    iata_code: z.string().regex(IATA),
                    city_name: z.string().max(120).nullish(),
                  })
                  .passthrough(),
              )
              .max(16)
              .nullish(),
          })
          .passthrough(),
      )
      .max(32),
  })
  .passthrough();

export interface DuffelAirportResolverOptions {
  /** Dedicated discovery token; the lookup never books or holds inventory. */
  readToken: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

export interface DuffelAirportResolver {
  /**
   * Resolves the gateway airport Duffel itself serves for a traveller-facing
   * place name. Supplier-ranked results are authoritative for reachability, so a
   * country or city name resolves without inventing an airport.
   */
  resolve(term: string, signal: AbortSignal): Promise<string | null>;
}

// Official contract: https://duffel.com/docs/api/v2/places
// Suggestions are read-only place data; no offer request or order is created.
export function createDuffelAirportResolver(
  options: DuffelAirportResolverOptions,
): DuffelAirportResolver {
  const authorization = `Bearer ${secret(options.readToken)}`;
  const now = options.now ?? Date.now;
  const timeout = Math.min(3000, Math.max(250, options.timeoutMs ?? 2000));
  const cache = new Map<string, { at: number; airportCode: string | null }>();

  return {
    async resolve(term, signal) {
      const query = term.trim().slice(0, 200);
      const key = query.toLocaleLowerCase("en");
      if (!key) return null;
      const cached = cache.get(key);
      if (cached && now() - cached.at < CACHE_MS) return cached.airportCode;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const cancel = () => controller.abort();
      signal.addEventListener("abort", cancel, { once: true });
      let airportCode: string | null = null;
      try {
        const response = await (options.fetch ?? fetch)(
          `${SUGGESTIONS_URL}?query=${encodeURIComponent(query)}`,
          {
            method: "GET",
            headers: {
              Authorization: authorization,
              "Duffel-Version": "v2",
              Accept: "application/json",
            },
            signal: controller.signal,
            redirect: "error",
            credentials: "omit",
            cache: "no-store",
          },
        );
        if (!response.ok) return null;
        const body = await response.text();
        if (body.length > RESPONSE_LIMIT) return null;
        const parsed = suggestionsSchema.safeParse(JSON.parse(body) as unknown);
        if (!parsed.success) return null;
        for (const suggestion of parsed.data.data) {
          // A city entry carries a metro code (for example TYO) plus its airports;
          // an offer request leg needs the airport the traveller actually reaches.
          const candidate =
            suggestion.airports?.find((airport) => airport.iata_code)?.iata_code ??
            suggestion.iata_code;
          if (candidate) {
            airportCode = identifier(candidate, IATA);
            break;
          }
        }
        return airportCode;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        if (airportCode) {
          if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
          cache.set(key, { at: now(), airportCode });
        }
      }
    },
  };
}
