import "server-only";
import { createWorkerApplication } from "@/server/worker-application";
import { TransactionProviderRegistry } from "@/server/supply/transactions";
import { runBookingWorker } from "@/workers/booking/index";

// This process does not execute Next.js instrumentation. Compose its dependencies
// explicitly and close its database pool if startup fails or the worker shuts down.
const application = createWorkerApplication(process.env);
try {
  await runBookingWorker(application.database, new TransactionProviderRegistry(), {
    prerequisites: application.bookingPrerequisites,
  });
} finally {
  await application.shutdown();
}
