import { z } from "zod";

import { identifier, secret } from "./read-http";
import catalogue from "../geo-catalogue.json" with { type: "json" };

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
            iata_country_code: z.string().nullish(),
            city_name: z.string().max(120).nullish(),
            airports: z
              .array(
                z
                  .object({
                    iata_code: z.string().regex(IATA),
                    iata_country_code: z.string().nullish(),
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
  resolve(term: string, signal: AbortSignal, countryCode?: string): Promise<string | null>;
}

/** A nearby airport is a gateway candidate, never proof of a ground transfer or flight. */
export function nearbyAirport(place: {
  countryCode: string;
  location?: { latitude: number; longitude: number } | null;
}): string | null {
  const location = place.location;
  if (!location) return null;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const candidates = catalogue.places
    .filter(
      (airport) =>
        airport.kind === "airport" &&
        airport.airportClass === "large" &&
        airport.countryCode === place.countryCode &&
        airport.airportCode,
    )
    .map((airport) => {
      const latitude = radians(airport.location.latitude - location.latitude);
      const longitude = radians(airport.location.longitude - location.longitude);
      const arc =
        Math.sin(latitude / 2) ** 2 +
        Math.cos(radians(location.latitude)) *
          Math.cos(radians(airport.location.latitude)) *
          Math.sin(longitude / 2) ** 2;
      return { airport, km: 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, arc))) };
    })
    .filter((candidate) => candidate.km <= 150)
    .sort((left, right) => left.km - right.km);
  return candidates[0]?.airport.airportCode ?? null;
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
    async resolve(term, signal, countryCode) {
      const query = term.trim().slice(0, 200);
      const key = `${countryCode ?? ""}|${query.toLocaleLowerCase("en")}`;
      if (!query) return null;
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
          if (countryCode && suggestion.iata_country_code !== countryCode) continue;
          // A city entry carries a metro code (for example TYO) plus its airports;
          // an offer request leg needs the airport the traveller actually reaches.
          const candidate =
            suggestion.airports?.find(
              (airport) =>
                airport.iata_code && (!countryCode || airport.iata_country_code === countryCode),
            )?.iata_code ?? suggestion.iata_code;
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
