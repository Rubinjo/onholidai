import {
  createDuffelReadProvider,
  createDuffelFlightsHttpClient,
  type DuffelFlightsHttpOptions,
} from "./duffel-read";
import { createDuffelAirportResolver, nearbyAirport } from "./duffel-airports";
import {
  createNuiteeReadProvider,
  createNuiteeHttpClient,
  type NuiteeHttpOptions,
} from "./nuitee-read";
import {
  createViatorReadProvider,
  createViatorHttpClient,
  type ViatorHttpOptions,
} from "./viator-read";
import { syntheticReadClient } from "./synthetic";
import { providerAttemptTimeoutMs } from "../deadlines";
import { createViatorDestinationDirectory } from "../viator-destinations";

import type { SupplyReadProvider, SupplyReadQuery } from "../read";
import type { ServerConfig } from "@/server/config";

export interface PlanningProviderMappings {
  fetch?: typeof fetch;
  flightDestination?: DuffelFlightsHttpOptions["resolveDestination"];
  flightOrigin?: DuffelFlightsHttpOptions["resolveOrigin"];
  staySearch?: NuiteeHttpOptions["resolveSearch"];
  activityDestination?: ViatorHttpOptions["resolveDestination"];
  activityPaxMix?: ViatorHttpOptions["resolvePaxMix"];
}

const IATA = /^[A-Z]{3}$/;

/**
 * Nuitee reads rates for a supplier place, so the destination name and country are
 * handed over for resolution. Guest nationality is not collected during setup;
 * the confirmed departure country is the only trusted residence fact available.
 */
function defaultStaySearch(query: SupplyReadQuery) {
  const destination = query.destinations?.find((place) => place.id === query.destinationIds[0]);
  const guestNationality = query.departureOrigin?.countryCode;
  if (!destination || query.destinationIds.length !== 1 || !guestNationality) return null;
  return {
    guestNationality,
    occupancies: [
      {
        adults: query.travellerParty.adults,
        children: query.travellerParty.children.map((child) => child.ageAtTripStart),
      },
    ],
    placeName: destination.name,
    countryCode: destination.countryCode,
  };
}

export function createConfiguredPlanningProviders(
  config: ServerConfig,
  environment: Readonly<Record<string, string | undefined>>,
  mappings: PlanningProviderMappings = {},
): readonly SupplyReadProvider[] {
  if (config.PROVIDER_MODE === "deterministic") return createPlanningProviders("deterministic");
  const providers: SupplyReadProvider[] = [];
  const duffelRef = config.SUPPLIER_PROVIDERS.duffel?.readSecretRef;
  const duffelToken = duffelRef ? environment[duffelRef]?.trim() : undefined;
  if (duffelToken) {
    // Duffel is authoritative about which airports it serves, so a country or city
    // selection resolves to a real gateway instead of a locally guessed one.
    const airports = createDuffelAirportResolver({ readToken: duffelToken, fetch: mappings.fetch });
    const storedGateway = (
      place: { providerPlaceIds?: Readonly<Record<string, string>> } | undefined,
    ) => {
      const stored = place?.providerPlaceIds?.["duffel:flight"];
      return stored && IATA.test(stored) ? stored : null;
    };
    providers.push(
      createDuffelReadProvider(
        createDuffelFlightsHttpClient({
          readToken: duffelToken,
          fetch: mappings.fetch,
          resolveDestination:
            mappings.flightDestination ??
            (async (id, query, signal) => {
              const place = query.destinations?.find((entry) => entry.id === id);
              if (!place) return null;
              return (
                storedGateway(place) ??
                (await airports.resolve(
                  place.name,
                  signal ?? AbortSignal.timeout(3000),
                  place.countryCode,
                )) ??
                nearbyAirport(place)
              );
            }),
          resolveOrigin:
            mappings.flightOrigin ??
            (async (query, signal) => {
              const origin = query.departureOrigin;
              if (!origin) return null;
              if (origin.airportCode) return origin.airportCode;
              return (
                (await airports.resolve(
                  origin.name,
                  signal ?? AbortSignal.timeout(3000),
                  origin.countryCode,
                )) ?? nearbyAirport(origin)
              );
            }),
        }),
      ),
    );
  }
  const nuiteeRef = config.SUPPLIER_PROVIDERS.nuitee?.readSecretRef;
  const nuiteeKey = nuiteeRef ? environment[nuiteeRef]?.trim() : undefined;
  if (nuiteeKey)
    providers.push(
      createNuiteeReadProvider(
        createNuiteeHttpClient({
          apiKey: nuiteeKey,
          environment: config.NUITEE_ENVIRONMENT,
          fetch: mappings.fetch,
          resolveSearch: mappings.staySearch ?? defaultStaySearch,
        }),
      ),
    );
  const viatorRef = config.SUPPLIER_PROVIDERS.viator?.readSecretRef;
  const viatorKey = viatorRef ? environment[viatorRef]?.trim() : undefined;
  if (viatorKey) {
    // Viator product search needs its own numeric destination id. A stored selection is
    // preferred; otherwise the supplier's published catalogue resolves the named place,
    // because its freetext destination search currently fails for every query.
    const destinations = createViatorDestinationDirectory({
      apiKey: viatorKey,
      environment: config.VIATOR_ENVIRONMENT,
      fetch: mappings.fetch,
    });
    providers.push(
      createViatorReadProvider(
        createViatorHttpClient({
          apiKey: viatorKey,
          environment: config.VIATOR_ENVIRONMENT,
          fetch: mappings.fetch,
          timeoutMs: providerAttemptTimeoutMs("viator"),
          resolveDestination:
            mappings.activityDestination ??
            (async (id, query, signal) => {
              const place = query.destinations?.find((entry) => entry.id === id);
              const stored = place?.providerPlaceIds?.["viator:destination"];
              if (stored && /^\d{1,12}$/.test(stored)) return [stored];
              if (!place) return null;
              const matches = await destinations.candidates(place.name, signal);
              return matches.map((match) => match.id);
            }),
          resolvePaxMix: mappings.activityPaxMix,
        }),
      ),
    );
  }
  return providers.map((provider) => ({
    ...provider,
    capabilities: { ...provider.capabilities, mode: "live" },
  }));
}

export function createPlanningProviders(
  mode: "deterministic" | "live",
  live: readonly SupplyReadProvider[] = [],
): readonly SupplyReadProvider[] {
  if (mode === "live") return live; // Commercial HTTP/SDK clients must be explicitly injected; no fake live success.
  return [
    createDuffelReadProvider(syntheticReadClient("flight")),
    createNuiteeReadProvider(syntheticReadClient("accommodation")),
    createViatorReadProvider(syntheticReadClient("activity")),
  ].map((provider): SupplyReadProvider => ({
    ...provider,
    capabilities: { ...provider.capabilities, mode: "deterministic" },
  }));
}
