import "server-only";

import { deriveProviderReadiness, loadWorkerConfig } from "@/server/config";
import { createDatabase } from "@/server/db/database";

import type { TrustedBookingPrerequisiteReader } from "@/server/supply/payment";

export function createWorkerApplication(
  environment: Record<string, string | undefined>,
  dependencies: {
    bookingPrerequisites?: TrustedBookingPrerequisiteReader;
  } = {},
) {
  const config = loadWorkerConfig(environment);
  const providerReadiness = deriveProviderReadiness(config, environment, "worker");
  const database = createDatabase({
    connectionString: config.DATABASE_URL,
    applicationName: "onholidai-booking-worker",
  });
  let shutdownPromise: Promise<void> | undefined;
  return {
    config,
    database,
    providerReadiness,
    bookingPrerequisites: dependencies.bookingPrerequisites,
    shutdown(): Promise<void> {
      return (shutdownPromise ??= database.destroy());
    },
  };
}
