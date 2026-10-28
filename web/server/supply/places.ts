import { z } from "zod";

import {
  type PlaceCandidate,
  type PlaceLookupProvider,
  placeCandidateSchema,
} from "@/domain/trip/destination";
import { ProblemError } from "@/server/errors";
import { timezoneSchema } from "@/domain/trip/schema";

import catalogue from "./geo-catalogue.json" with { type: "json" };

const syntheticPlaces: readonly PlaceCandidate[] = [
  {
    placeId: "synthetic-portugal-mainland",
    kind: "country",
    name: "Portugal (mainland)",
    countryCode: "PT",
    timezone: "Europe/Lisbon",
    airportCode: null,
    location: null,
  },
  {
    placeId: "synthetic-portugal-azores",
    kind: "country",
    name: "Portugal (Azores)",
    countryCode: "PT",
    timezone: "Atlantic/Azores",
    airportCode: null,
    location: null,
  },
  {
    placeId: "synthetic-lisbon",
    kind: "city",
    name: "Lisbon",
    countryCode: "PT",
    timezone: "Europe/Lisbon",
    airportCode: null,
    location: { latitude: 38.7223, longitude: -9.1393 },
  },
  {
    placeId: "synthetic-coimbra",
    kind: "city",
    name: "Coimbra",
    countryCode: "PT",
    timezone: "Europe/Lisbon",
    airportCode: null,
    location: { latitude: 40.2033, longitude: -8.4103 },
  },
  {
    placeId: "synthetic-porto",
    kind: "city",
    name: "Porto",
    countryCode: "PT",
    timezone: "Europe/Lisbon",
    airportCode: null,
    location: { latitude: 41.1579, longitude: -8.6291 },
  },
  {
    placeId: "synthetic-amsterdam",
    kind: "city",
    name: "Amsterdam",
    countryCode: "NL",
    timezone: "Europe/Amsterdam",
    airportCode: null,
    location: { latitude: 52.3676, longitude: 4.9041 },
  },
  {
    placeId: "synthetic-ams",
    kind: "airport",
    name: "Amsterdam Schiphol",
    countryCode: "NL",
    timezone: "Europe/Amsterdam",
    airportCode: "AMS",
    location: { latitude: 52.3105, longitude: 4.7683 },
  },
  {
    placeId: "synthetic-japan",
    kind: "country",
    name: "Japan",
    countryCode: "JP",
    timezone: "Asia/Tokyo",
    airportCode: null,
    location: null,
  },
  {
    placeId: "synthetic-south-korea",
    kind: "country",
    name: "South Korea",
    countryCode: "KR",
    timezone: "Asia/Seoul",
    airportCode: null,
    location: null,
  },
  {
    placeId: "synthetic-tokyo",
    kind: "city",
    name: "Tokyo",
    countryCode: "JP",
    timezone: "Asia/Tokyo",
    airportCode: null,
    location: { latitude: 35.6762, longitude: 139.6503 },
  },
  {
    placeId: "synthetic-kyoto",
    kind: "city",
    name: "Kyoto",
    countryCode: "JP",
    timezone: "Asia/Tokyo",
    airportCode: null,
    location: { latitude: 35.0116, longitude: 135.7681 },
  },
  {
    placeId: "synthetic-seoul",
    kind: "city",
    name: "Seoul",
    countryCode: "KR",
    timezone: "Asia/Seoul",
    airportCode: null,
    location: { latitude: 37.5665, longitude: 126.978 },
  },
];

interface CataloguePlace {
  placeId: string;
  kind: "city" | "airport";
  name: string;
  countryCode: string;
  timezone: string;
  airportCode: string | null;
  location: { latitude: number; longitude: number };
  city?: string;
  rank: number;
}

// Bundled settlement and airport reference data (scripts/generate-geo-catalogue.mjs).
// Country quick-picks and IATA-coded departures come from here: text search has
// no airport code field, and it cannot list the cities of a country on request.
const cataloguePlaces: readonly CataloguePlace[] =
  (catalogue as unknown as { places?: CataloguePlace[] }).places ?? [];

const GOOGLE_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const GOOGLE_TIME_ZONE_URL = "https://maps.googleapis.com/maps/api/timezone/json";
const GOOGLE_PLACE_FIELDS = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.types",
  "places.addressComponents",
].join(",");
const REMOTE_CANDIDATE_LIMIT = 8;
const TIMEZONE_LOOKUP_LIMIT = 6;
const CANDIDATE_LIMIT = 20;
const UPSTREAM_TIMEOUT_MS = 6000;
const UPSTREAM_RESPONSE_LIMIT = 256_000;
const TIMEZONE_CACHE_LIMIT = 1000;

export interface PlaceLookupDependencies {
  apiKey?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

function placeLookupUnavailable(): ProblemError {
  return new ProblemError({
    status: 503,
    code: "place_lookup_unavailable",
    title: "Place lookup is currently unavailable",
  });
}

function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

type LookupInput = Parameters<PlaceLookupProvider["search"]>[0];

function toCandidate(place: {
  placeId: string;
  kind: PlaceCandidate["kind"];
  name: string;
  countryCode: string;
  timezone: string;
  airportCode: string | null;
  location: PlaceCandidate["location"];
}): PlaceCandidate | null {
  const parsed = placeCandidateSchema.safeParse({ ...place, name: place.name.slice(0, 120) });
  return parsed.success ? parsed.data : null;
}

function matchSynthetic(input: LookupInput): readonly PlaceCandidate[] {
  const query = normalized(input.query);
  return syntheticPlaces
    .filter(
      (place) =>
        normalized(place.name).includes(query) &&
        (!input.countryCode || place.countryCode === input.countryCode) &&
        (!input.kind || place.kind === input.kind),
    )
    .slice(0, CANDIDATE_LIMIT);
}

function matchCatalogue(input: LookupInput): PlaceCandidate[] {
  const query = normalized(input.query);
  const scored: { place: CataloguePlace; score: number }[] = [];
  for (const place of cataloguePlaces) {
    if (input.countryCode && place.countryCode !== input.countryCode) continue;
    if (input.kind && place.kind !== input.kind) continue;
    const name = normalized(place.name);
    const city = place.city ? normalized(place.city) : "";
    const code = place.airportCode ? normalized(place.airportCode) : "";
    let score = 0;
    if (query.length === 0) score = 1;
    else if (code === query) score = 5;
    else if (name === query || city === query) score = 4;
    else if (name.startsWith(query) || city.startsWith(query)) score = 3;
    else if (name.includes(query) || city.includes(query)) score = 2;
    if (score > 0) scored.push({ place, score });
  }
  return scored
    .sort(
      (first, second) =>
        second.score - first.score ||
        second.place.rank - first.place.rank ||
        first.place.name.localeCompare(second.place.name),
    )
    .slice(0, CANDIDATE_LIMIT)
    .flatMap(({ place }) => {
      const value = catalogueCandidate(place);
      return value ? [value] : [];
    });
}

function catalogueCandidate(place: CataloguePlace): PlaceCandidate | null {
  return toCandidate({
    placeId: place.placeId,
    kind: place.kind,
    name: place.name,
    countryCode: place.countryCode,
    timezone: place.timezone,
    airportCode: place.airportCode,
    location: place.location,
  });
}

// Keep automatic routes readable: a second stop in the same metropolitan area adds
// nights without adding a destination the traveller would recognise as new.
const CITY_SUGGESTION_SEPARATION_KM = 80;

function cityDistanceKm(first: PlaceCandidate, second: PlaceCandidate): number {
  if (!first.location || !second.location) return Number.POSITIVE_INFINITY;
  const radians = Math.PI / 180;
  const latitude = ((first.location.latitude + second.location.latitude) / 2) * radians;
  const latitudeDelta = (first.location.latitude - second.location.latitude) * radians;
  const longitudeDelta =
    (first.location.longitude - second.location.longitude) * radians * Math.cos(latitude);
  return 6371.0088 * Math.sqrt(latitudeDelta ** 2 + longitudeDelta ** 2);
}

/** Ordered city candidates for a country, reusing the bundled/synthetic place data. */
export function countryCityCandidates(
  countryCode: string,
  mode: "deterministic" | "live",
  limit: number,
): readonly PlaceCandidate[] {
  if (limit <= 0) return [];
  const available =
    mode === "deterministic"
      ? syntheticPlaces.filter(
          (place) => place.kind === "city" && place.countryCode === countryCode,
        )
      : cataloguePlaces
          .filter((place) => place.kind === "city" && place.countryCode === countryCode)
          .sort((first, second) => second.rank - first.rank)
          .flatMap((place) => {
            const candidate = catalogueCandidate(place);
            return candidate ? [candidate] : [];
          });
  const remaining = [...available];
  const selected: PlaceCandidate[] = [];
  while (selected.length < limit && remaining.length) {
    const index = remaining.findIndex((place) =>
      selected.every((chosen) => cityDistanceKm(place, chosen) >= CITY_SUGGESTION_SEPARATION_KM),
    );
    selected.push(...remaining.splice(index >= 0 ? index : 0, 1));
  }
  return selected;
}

const timezoneCache = new Map<string, string | null>();

function rememberTimezone(key: string, value: string | null): string | null {
  if (timezoneCache.size >= TIMEZONE_CACHE_LIMIT) {
    const oldest = timezoneCache.keys().next();
    if (!oldest.done) timezoneCache.delete(oldest.value);
  }
  timezoneCache.set(key, value);
  return value;
}

function nearestCatalogueTimezone(
  location: PlaceCandidate["location"],
  countryCode: string,
): string | null {
  if (!location) return null;
  const scale = Math.cos((location.latitude * Math.PI) / 180);
  let timezone: string | null = null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const place of cataloguePlaces) {
    if (place.countryCode !== countryCode) continue;
    const latitudeDelta = place.location.latitude - location.latitude;
    const longitudeDelta = (place.location.longitude - location.longitude) * scale;
    const distance = latitudeDelta * latitudeDelta + longitudeDelta * longitudeDelta;
    if (distance < nearest) {
      nearest = distance;
      timezone = place.timezone;
    }
  }
  return timezone;
}

// Text search identifies airports but carries no IATA code, so a nearby bundled
// airport supplies the identity the place contract requires.
function nearestAirport(
  location: NonNullable<PlaceCandidate["location"]>,
  countryCode: string,
): CataloguePlace | null {
  const scale = Math.cos((location.latitude * Math.PI) / 180);
  let nearest: CataloguePlace | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const place of cataloguePlaces) {
    if (place.kind !== "airport" || place.countryCode !== countryCode) continue;
    const latitudeKm = (place.location.latitude - location.latitude) * 111.32;
    const longitudeKm = (place.location.longitude - location.longitude) * 111.32 * scale;
    const distance = Math.hypot(latitudeKm, longitudeKm);
    if (distance < nearestDistance) {
      nearest = place;
      nearestDistance = distance;
    }
  }
  return nearest && nearestDistance <= 3 ? nearest : null;
}

interface Upstream {
  apiKey: string;
  request: typeof fetch;
  now: () => Date;
  timeoutMs: number;
}

async function boundedJson(
  url: string,
  init: RequestInit,
  upstream: Upstream,
  signal: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), upstream.timeoutMs);
  const forward = () => controller.abort();
  signal.addEventListener("abort", forward, { once: true });
  try {
    const response = await upstream.request(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`Upstream lookup failed with ${response.status}`);
    const body = await response.text();
    if (body.length > UPSTREAM_RESPONSE_LIMIT) throw new Error("Upstream response too large");
    return JSON.parse(body) as unknown;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", forward);
  }
}

const timezoneResponseSchema = z.object({
  status: z.string(),
  timeZoneId: z.string().optional(),
});

async function googleTimezone(
  location: NonNullable<PlaceCandidate["location"]>,
  upstream: Upstream,
  signal: AbortSignal,
): Promise<string | null> {
  const key = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
  const cached = timezoneCache.get(key);
  if (cached !== undefined) return cached;
  const url = new URL(GOOGLE_TIME_ZONE_URL);
  url.searchParams.set("location", `${location.latitude},${location.longitude}`);
  url.searchParams.set("timestamp", String(Math.floor(upstream.now().getTime() / 1000)));
  url.searchParams.set("key", upstream.apiKey);
  try {
    const payload = timezoneResponseSchema.parse(
      await boundedJson(url.toString(), { method: "GET" }, upstream, signal),
    );
    const timezone = timezoneSchema.safeParse(payload.timeZoneId);
    return rememberTimezone(key, timezone.success ? timezone.data : null);
  } catch {
    return rememberTimezone(key, null);
  }
}

const googleSearchSchema = z.object({
  places: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        displayName: z.object({ text: z.string().min(1) }).optional(),
        location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
        types: z.array(z.string()).optional(),
        addressComponents: z
          .array(z.object({ shortText: z.string().optional(), types: z.array(z.string()) }))
          .optional(),
      }),
    )
    .max(REMOTE_CANDIDATE_LIMIT)
    .optional(),
});

type GooglePlace = NonNullable<z.infer<typeof googleSearchSchema>["places"]>[number];

interface Draft {
  placeId: string;
  kind: "country" | "city" | "place" | "airport";
  name: string;
  countryCode: string;
  location: PlaceCandidate["location"];
}

function classify(place: GooglePlace): Draft | null {
  const countryCode = place.addressComponents
    ?.find((component) => component.types.includes("country"))
    ?.shortText?.toUpperCase();
  if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) return null;
  const name = place.displayName?.text.trim();
  if (!name) return null;
  const types = new Set(place.types ?? []);
  const location =
    place.location &&
    Number.isFinite(place.location.latitude) &&
    Number.isFinite(place.location.longitude)
      ? { latitude: place.location.latitude, longitude: place.location.longitude }
      : null;
  if (!location && !types.has("country")) return null;
  const kind =
    types.has("airport") || types.has("international_airport")
      ? "airport"
      : types.has("country")
        ? "country"
        : // Every address carries a locality component, so only the place type
          // itself tells a settlement apart from a station or other point of interest.
          types.has("locality") || types.has("postal_town")
          ? "city"
          : "place";
  return { placeId: `google:${place.id}`, kind, name, countryCode, location };
}

async function searchGoogle(
  input: LookupInput,
  upstream: Upstream,
  signal: AbortSignal,
): Promise<PlaceCandidate[] | null> {
  let payload: unknown;
  try {
    payload = await boundedJson(
      GOOGLE_TEXT_SEARCH_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": upstream.apiKey,
          "X-Goog-FieldMask": GOOGLE_PLACE_FIELDS,
        },
        body: JSON.stringify({
          textQuery: input.query,
          pageSize: REMOTE_CANDIDATE_LIMIT,
          languageCode: "en",
          ...(input.countryCode ? { regionCode: input.countryCode } : {}),
        }),
      },
      upstream,
      signal,
    );
  } catch {
    return null;
  }
  const parsed = googleSearchSchema.safeParse(payload);
  if (!parsed.success) return null;
  const drafts = (parsed.data.places ?? []).flatMap((place) => {
    const draft = classify(place);
    return draft &&
      (!input.countryCode || draft.countryCode === input.countryCode) &&
      (!input.kind || draft.kind === input.kind)
      ? [draft]
      : [];
  });
  const resolved = await Promise.all(
    drafts.map(async (draft, index) => {
      if (draft.kind === "airport") {
        const bundled = draft.location ? nearestAirport(draft.location, draft.countryCode) : null;
        return bundled ? catalogueCandidate(bundled) : null;
      }
      const timezone =
        (index < TIMEZONE_LOOKUP_LIMIT && draft.location
          ? await googleTimezone(draft.location, upstream, signal)
          : null) ?? nearestCatalogueTimezone(draft.location, draft.countryCode);
      if (!timezone) return null;
      return toCandidate({
        placeId: draft.placeId,
        kind: draft.kind,
        name: draft.name,
        countryCode: draft.countryCode,
        timezone,
        airportCode: null,
        location: draft.location,
      });
    }),
  );
  return resolved.flatMap((place) => (place ? [place] : []));
}

function merge(
  remote: readonly PlaceCandidate[],
  local: readonly PlaceCandidate[],
): readonly PlaceCandidate[] {
  const merged: PlaceCandidate[] = [];
  const identities = new Set<string>();
  const named = new Set<string>();
  for (const place of [...remote, ...local]) {
    const identity = `${normalized(place.name)}|${place.countryCode}|${place.kind}`;
    if (identities.has(place.placeId) || named.has(identity)) continue;
    identities.add(place.placeId);
    named.add(identity);
    merged.push(place);
  }
  return merged.slice(0, CANDIDATE_LIMIT);
}

export function createPlaceLookupProvider(
  mode: "deterministic" | "live",
  dependencies: PlaceLookupDependencies = {},
): PlaceLookupProvider {
  if (mode === "deterministic") return { search: async (input) => matchSynthetic(input) };
  const apiKey = dependencies.apiKey?.trim();
  const upstream: Upstream | null = apiKey
    ? {
        apiKey,
        request: dependencies.fetch ?? fetch,
        now: dependencies.now ?? (() => new Date()),
        timeoutMs: dependencies.timeoutMs ?? UPSTREAM_TIMEOUT_MS,
      }
    : null;
  return {
    async search(input, signal) {
      if (!upstream) throw placeLookupUnavailable();
      const local = matchCatalogue(input);
      const remote = input.query.trim() ? await searchGoogle(input, upstream, signal) : [];
      if (remote === null && local.length === 0) throw placeLookupUnavailable();
      return merge(remote ?? [], local);
    },
  };
}
