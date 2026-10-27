import { z } from "zod";

const destinationResultsSchema = z
  .object({
    destinations: z
      .object({
        results: z
          .array(
            z
              .object({
                id: z.number().int().positive().max(2_147_483_647),
                name: z.string().trim().min(1).max(200),
              })
              .passthrough(),
          )
          .max(20),
      })
      .passthrough(),
  })
  .passthrough();

export interface ViatorDestinationMatch {
  id: string;
  name: string;
}

export interface ViatorDestinationDirectory {
  /** Best-effort Viator destination lookup; never throws and never blocks planning. */
  lookup(term: string, signal: AbortSignal): Promise<readonly ViatorDestinationMatch[]>;
}

export interface ViatorDestinationOptions {
  apiKey: string;
  environment: "sandbox" | "production";
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

const CACHE_MS = 10 * 60_000;
const CACHE_LIMIT = 200;

// Free-text search requires a currency, but destination identity and naming do not
// depend on it; this value is never used to price anything.
const LOOKUP_CURRENCY = "EUR";

export function createViatorDestinationDirectory(
  options: ViatorDestinationOptions,
): ViatorDestinationDirectory {
  const endpoint =
    options.environment === "sandbox"
      ? "https://api.sandbox.viator.com/partner/search/freetext"
      : "https://api.viator.com/partner/search/freetext";
  const now = options.now ?? Date.now;
  const timeout = Math.min(2500, Math.max(250, options.timeoutMs ?? 2000));
  const cache = new Map<string, { at: number; matches: readonly ViatorDestinationMatch[] }>();

  return {
    async lookup(term, signal) {
      const key = term.trim().toLocaleLowerCase("en");
      if (!key) return [];
      const cached = cache.get(key);
      if (cached && now() - cached.at < CACHE_MS) return cached.matches;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const cancel = () => controller.abort();
      signal.addEventListener("abort", cancel, { once: true });
      try {
        const response = await (options.fetch ?? fetch)(endpoint, {
          method: "POST",
          headers: {
            "exp-api-key": options.apiKey,
            Accept: "application/json;version=2.0",
            "Content-Type": "application/json;version=2.0",
            "Accept-Language": "en",
          },
          body: JSON.stringify({
            searchTerm: term.trim().slice(0, 200),
            currency: LOOKUP_CURRENCY,
            searchTypes: [{ searchType: "DESTINATIONS", pagination: { start: 1, count: 10 } }],
          }),
          signal: controller.signal,
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
        });
        if (!response.ok) return [];
        const parsed = destinationResultsSchema.safeParse(await response.json());
        if (!parsed.success) return [];
        const matches = parsed.data.destinations.results.map((result) => ({
          id: String(result.id),
          name: result.name,
        }));
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
        cache.set(key, { at: now(), matches });
        return matches;
      } catch {
        return [];
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
      }
    },
  };
}

const normalizeName = (value: string) => value.trim().toLocaleLowerCase("en");

/**
 * Returns a Viator destination ID only when the supplier returns exactly one
 * destination with the same name. Ambiguous or unmatched names stay unmapped so
 * planning reports unsupported coverage instead of guessing a supplier identity.
 */
export function resolveViatorDestinationId(
  name: string,
  matches: readonly ViatorDestinationMatch[],
): string | null {
  const key = normalizeName(name);
  const exact = matches.filter((match) => normalizeName(match.name) === key);
  return exact.length === 1 ? exact[0].id : null;
}
