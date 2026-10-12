import "server-only";

import { Pool } from "pg";

import { createAuth } from "@/server/auth/auth";
import { loadServerConfig } from "@/server/config";
import { createDatabase } from "@/server/db/database";
import { createPlaceLookupProvider } from "@/server/supply/places";

// This is the process composition root. Domain services receive its dependencies
// explicitly; only Next.js entry points read the registered application.
export function createApplication(environment: Record<string, string | undefined>) {
  const config = loadServerConfig(environment);
  const database = createDatabase({ connectionString: config.DATABASE_URL });
  const authPool = new Pool({
    application_name: "onholidai-auth", connectionString: config.DATABASE_URL, max: 10,
  });
  let shutdownPromise: Promise<void> | undefined;
  try {
    const auth = createAuth(config, authPool);
    return {
      config, database, auth, places: createPlaceLookupProvider(config.PROVIDER_MODE),
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
  return runtime.onholidaiApplication;
}

export function getApplication(): Application {
  if (!runtime.onholidaiApplication) throw new Error("Application startup has not completed");
  return runtime.onholidaiApplication;
}

export async function stopApplication(): Promise<void> {
  const current = runtime.onholidaiApplication;
  delete runtime.onholidaiApplication;
  await current?.shutdown();
}
