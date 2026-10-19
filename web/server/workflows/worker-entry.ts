import "server-only";
import { createApplication } from "@/server/application";
import { TransactionProviderRegistry } from "@/server/supply/transactions";
import { runBookingWorker } from "@/workers/booking/index";

// This process does not execute Next.js instrumentation. Compose its dependencies
// explicitly and close the pools if startup fails or the worker shuts down.
const application = createApplication(process.env, { audience: "worker" });
try {
  await runBookingWorker(application.database, new TransactionProviderRegistry());
} finally {
  await application.shutdown();
}
