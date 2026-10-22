import {
  createDuffelReadProvider,
  createDuffelFlightsHttpClient,
  type DuffelFlightsHttpOptions,
} from "./duffel-read";
import {
  createDuffelStaysReadProvider,
  createDuffelStaysHttpClient,
  type DuffelStaysHttpOptions,
} from "./duffel-stays-read";
import {
  createViatorReadProvider,
  createViatorHttpClient,
  type ViatorHttpOptions,
} from "./viator-read";
import { syntheticReadClient } from "./synthetic";

import type { SupplyReadProvider } from "../read";
import type { ServerConfig, SupplierReadiness } from "@/server/config";

export interface PlanningProviderMappings {
  fetch?: typeof fetch;
  flightDestination?: DuffelFlightsHttpOptions["resolveDestination"];
  staySearch?: DuffelStaysHttpOptions["resolveSearch"];
  activityDestination?: ViatorHttpOptions["resolveDestination"];
  activityPaxMix?: ViatorHttpOptions["resolvePaxMix"];
}

export function createConfiguredPlanningProviders(
  config: ServerConfig,
  environment: Readonly<Record<string, string | undefined>>,
  readiness: SupplierReadiness,
  mappings: PlanningProviderMappings = {},
): readonly SupplyReadProvider[] {
  if (config.PROVIDER_MODE === "deterministic") return createPlanningProviders("deterministic");
  const providers: SupplyReadProvider[] = [];
  const duffelRef = config.SUPPLIER_PROVIDERS.duffel?.readSecretRef;
  const duffelToken = duffelRef ? environment[duffelRef]?.trim() : undefined;
  if (duffelToken) {
    providers.push(
      createDuffelReadProvider(
        createDuffelFlightsHttpClient({
          readToken: duffelToken,
          fetch: mappings.fetch,
          resolveDestination:
            mappings.flightDestination ??
            ((id, query) =>
              query.destinations?.find((place) => place.id === id)?.providerPlaceIds[
                "duffel:flight"
              ] ?? null),
        }),
      ),
    );
    providers.push(
      createDuffelStaysReadProvider(
        createDuffelStaysHttpClient({
          readToken: duffelToken,
          fetch: mappings.fetch,
          accessApproved:
            readiness.duffel.products.accommodation.operations.search.access === "verified",
          resolveSearch: mappings.staySearch ?? (() => null),
        }),
      ),
    );
  }
  const viatorRef = config.SUPPLIER_PROVIDERS.viator?.readSecretRef;
  const viatorKey = viatorRef ? environment[viatorRef]?.trim() : undefined;
  if (viatorKey)
    providers.push(
      createViatorReadProvider(
        createViatorHttpClient({
          apiKey: viatorKey,
          environment: config.VIATOR_ENVIRONMENT,
          fetch: mappings.fetch,
          resolveDestination:
            mappings.activityDestination ??
            ((id, query) =>
              query.destinations?.find((place) => place.id === id)?.providerPlaceIds[
                "viator:destination"
              ] ?? null),
          resolvePaxMix: mappings.activityPaxMix,
        }),
      ),
    );
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
    createDuffelStaysReadProvider(syntheticReadClient("accommodation")),
    createViatorReadProvider(syntheticReadClient("activity")),
  ].map((provider): SupplyReadProvider => ({
    ...provider,
    capabilities: { ...provider.capabilities, mode: "deterministic" },
  }));
}
