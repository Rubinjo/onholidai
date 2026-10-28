import { z } from "zod";

import { retryDelayMs } from "./deadlines";

// Viator's freetext destination search currently answers HTTP 500 for every
// DESTINATIONS query, while the published destination catalogue is served reliably
// (about 1.2 MB, cached here). Reads therefore resolve supplier place identity from
// the catalogue instead of guessing an id or dropping activity coverage entirely.

const catalogEntrySchema = z
  .object({
    destinationId: z.number().int().positive().max(2_147_483_647),
    name: z.string().trim().min(1).max(200),
    type: z.string().trim().min(1).max(40),
    parentDestinationId: z.number().int().positive().max(2_147_483_647).nullish(),
  })
  .passthrough();
const catalogSchema = z
  .object({ destinations: z.array(catalogEntrySchema).min(1).max(20_000) })
  .passthrough();

export interface ViatorDestinationMatch {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
}

export interface ViatorDestinationDirectory {
  /**
   * Ranked supplier destination ids for a traveller-facing place name: the exact
   * match first, then its parent country when the match is a city. Never throws and
   * never invents an identity; an unmatched name yields no candidates.
   */
  candidates(term: string, signal?: AbortSignal): Promise<readonly ViatorDestinationMatch[]>;
}

export interface ViatorDestinationOptions {
  apiKey: string;
  environment: "sandbox" | "production";
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

const CACHE_MS = 30 * 60_000;
const CATALOG_RESPONSE_LIMIT = 8 * 1_048_576;
const CATALOG_ATTEMPTS = 2;
const MAX_MATCHES = 8;

const normalizeName = (value: string) => value.trim().toLocaleLowerCase("en");

export function createViatorDestinationDirectory(
  options: ViatorDestinationOptions,
): ViatorDestinationDirectory {
  const endpoint =
    options.environment === "sandbox"
      ? "https://api.sandbox.viator.com/partner/destinations"
      : "https://api.viator.com/partner/destinations";
  const now = options.now ?? Date.now;
  const timeout = Math.min(15_000, Math.max(1_000, options.timeoutMs ?? 10_000));
  let cached: { at: number; entries: z.infer<typeof catalogEntrySchema>[] } | null = null;
  let inFlight: Promise<z.infer<typeof catalogEntrySchema>[]> | null = null;

  async function fetchCatalog(signal?: AbortSignal): Promise<z.infer<typeof catalogEntrySchema>[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await (options.fetch ?? fetch)(endpoint, {
        method: "GET",
        headers: {
          "exp-api-key": options.apiKey,
          Accept: "application/json;version=2.0",
          "Accept-Language": "en",
        },
        signal: controller.signal,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      });
      if (!response.ok) return [];
      const body = await response.text();
      if (body.length > CATALOG_RESPONSE_LIMIT) return [];
      const parsed = catalogSchema.safeParse(JSON.parse(body) as unknown);
      return parsed.success ? parsed.data.destinations : [];
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }

  async function catalog(signal?: AbortSignal): Promise<z.infer<typeof catalogEntrySchema>[]> {
    if (cached && now() - cached.at < CACHE_MS) return cached.entries;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      for (let attemptNumber = 1; attemptNumber <= CATALOG_ATTEMPTS; attemptNumber += 1) {
        const entries = await fetchCatalog(signal);
        if (entries.length) {
          cached = { at: now(), entries };
          return entries;
        }
        if (attemptNumber === CATALOG_ATTEMPTS || signal?.aborted) return [];
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attemptNumber)));
      }
      return [];
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    async candidates(term, signal) {
      const key = normalizeName(term);
      if (!key) return [];
      const entries = await catalog(signal);
      if (!entries.length) return [];
      const matches = entries
        .filter((entry) => normalizeName(entry.name) === key)
        .slice(0, MAX_MATCHES)
        .map((entry) => ({
          id: String(entry.destinationId),
          name: entry.name,
          type: entry.type.toLocaleUpperCase("en"),
          parentId: entry.parentDestinationId ? String(entry.parentDestinationId) : null,
        }));
      if (!matches.length) return [];
      const byId = new Map(entries.map((entry) => [String(entry.destinationId), entry]));
      const ranked: ViatorDestinationMatch[] = [];
      const seen = new Set<string>();
      for (const match of matches) {
        if (seen.has(match.id)) continue;
        seen.add(match.id);
        ranked.push(match);
      }
      // A city search can fail inside the supplier while the same country succeeds;
      // the country is a legitimate, larger coverage area for the named place.
      for (const match of matches) {
        if (match.type !== "CITY" || !match.parentId) continue;
        const parent = byId.get(match.parentId);
        if (!parent || seen.has(String(parent.destinationId))) continue;
        seen.add(String(parent.destinationId));
        ranked.push({
          id: String(parent.destinationId),
          name: parent.name,
          type: parent.type.toLocaleUpperCase("en"),
          parentId: null,
        });
      }
      return ranked;
    },
  };
}

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
