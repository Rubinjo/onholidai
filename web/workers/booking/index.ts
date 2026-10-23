import "server-only";

import { fileURLToPath } from "node:url";

import { NativeConnection, Worker } from "@temporalio/worker";

import { createBookingActivities } from "@/server/workflows/activities";
import { TransactionProviderRegistry } from "@/server/supply/transactions";
import { runBookingOutboxDispatcher } from "@/server/workflows/outbox-dispatcher";

import type { Kysely } from "kysely";
import type { Database } from "@/server/db/database";

export async function runBookingWorker(
  database: Kysely<Database>,
  providers: TransactionProviderRegistry,
  options: Parameters<typeof createBookingActivities>[2] = {},
): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS;
  if (!address) throw new Error("TEMPORAL_ADDRESS is required to run the booking worker");
  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
    taskQueue: process.env.TEMPORAL_BOOKING_TASK_QUEUE ?? "onholidai-booking",
    workflowsPath: fileURLToPath(new URL("../../server/workflows/index.ts", import.meta.url)),
    activities: createBookingActivities(database, providers, options),
  });
  const abort = new AbortController();
  let closePromise: Promise<void> | undefined;
  const close = () =>
    (closePromise ??= (async () => {
      abort.abort();
      await worker.shutdown();
      await connection.close();
    })());
  const onSignal = () => {
    void close();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    await Promise.all([worker.run(), runBookingOutboxDispatcher(database, abort.signal)]);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await close();
  }
}
