import "server-only";

import { Pool } from "pg";

import { createAuth } from "@/server/auth/auth";
import { deriveProviderReadiness, loadServerConfig, type ProductReadiness } from "@/server/config";
import { createDatabase } from "@/server/db/database";
import { configureSpanSink, createOtlpHttpSink } from "@/server/telemetry-exporter";
import { createPlaceLookupProvider } from "@/server/supply/places";
import { createConfiguredPlanningProviders, type PlanningProviderMappings } from "@/server/supply/providers";
import type { SupplyReadProvider } from "@/server/supply/read";
import type { PlaceLookupProvider } from "@/domain/trip/destination";

// This is the process composition root. Domain services receive its dependencies
// explicitly; only Next.js entry points read the registered application.
export function createApplication(environment: Record<string, string | undefined>, dependencies: {
  planningProviders?: readonly SupplyReadProvider[]; places?: PlaceLookupProvider; audience?: "web" | "worker";
  supplierMappings?: PlanningProviderMappings;
} = {}) {
  const config = loadServerConfig(environment);
  const audience = dependencies.audience ?? "web";
  const providerReadiness = deriveProviderReadiness(config, environment, audience);
  const planningProviders = (audience === "worker" ? []
    : dependencies.planningProviders ?? createConfiguredPlanningProviders(config, environment, providerReadiness, dependencies.supplierMappings))
    .filter((provider) => {
      if (config.PROVIDER_MODE === "deterministic") return true;
      return provider.capabilities.readOnly && provider.capabilities.search.length > 0
        && provider.capabilities.search.every((type) => {
          let product: ProductReadiness | undefined;
          if (provider.capabilities.provider === "duffel" && (type === "flight" || type === "accommodation")) {
            product = providerReadiness.duffel.products[type];
          } else if (provider.capabilities.provider === "viator" && type === "activity") {
            product = providerReadiness.viator.products.activity;
          }
          return product?.operations.search.support === "supported" && product.operations.search.access === "verified";
        });
    });
  const database = createDatabase({ connectionString: config.DATABASE_URL });
  const authPool = new Pool({
    application_name: "onholidai-auth", connectionString: config.DATABASE_URL, max: 10,
  });
  let shutdownPromise: Promise<void> | undefined;
  try {
    const auth = createAuth(config, authPool);
    return {
      config, database, auth, providerReadiness, places: dependencies.places ?? createPlaceLookupProvider(config.PROVIDER_MODE),
      planningProviders,
      shutdown(): Promise<void> {
        shutdownPromise ??= Promise.allSettled([database.destroy(), authPool.end()]).then((results) => {
          const failures = results.filter((result) => result.status === "rejected");
          if (failures.length > 0) throw new AggregateError(
            failures.map((result) => result.reason), "Application shutdown failed",
          );
        });
        return shutdownPromise;
      },
    };
  } catch (error) {
    void Promise.allSettled([database.destroy(), authPool.end()]);
    throw error;
  }
}

export type Application = ReturnType<typeof createApplication>;

// Next.js compiles instrumentation and routes into separate entry bundles.
// Register the runtime explicitly on the process so those bundles share resources.
const runtime = globalThis as typeof globalThis & { onholidaiApplication?: Application };

export function startApplication(environment: Record<string, string | undefined>): Application {
  runtime.onholidaiApplication ??= createApplication(environment);
  const { config } = runtime.onholidaiApplication;
  // Explicit telemetry startup: without a configured collector endpoint no span ever leaves the
  // process, and the sink reuses the reviewed allowlist before serialization.
  configureSpanSink(config.OTEL_EXPORTER_OTLP_ENDPOINT
    ? createOtlpHttpSink({
      endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
      resource: { "service.name": "onholidai-web", "service.version": "1", "deployment.environment.name": config.NODE_ENV },
    })
    : null);
  return runtime.onholidaiApplication;
}

export function getApplication(): Application {
  if (!runtime.onholidaiApplication) throw new Error("Application startup has not completed");
  return runtime.onholidaiApplication;
}

export async function stopApplication(): Promise<void> {
  const current = runtime.onholidaiApplication;
  delete runtime.onholidaiApplication;
  configureSpanSink(null);
  await current?.shutdown();
}
