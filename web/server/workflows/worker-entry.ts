import "server-only";
import { getApplication } from "@/server/application";
import { TransactionProviderRegistry } from "@/server/supply/transactions";
import { runBookingWorker } from "@/workers/booking/index";

const application = getApplication();
await runBookingWorker(application.database, new TransactionProviderRegistry());
