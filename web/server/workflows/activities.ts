import "server-only";
import type { Kysely } from "kysely";
import type { Database } from "@/server/db/database";
import { TransactionProviderRegistry } from "@/server/supply/transactions";
import { createBookingActivities as createExecutionActivities } from "./book-activities";
import { createRevalidationActivities } from "./revalidate-activities";
import type { BookingWorkflowActivities } from "./booking-contract";

export type BookingActivityImplementations = BookingWorkflowActivities;

// Provider clients and database access stay in activities, outside deterministic workflow history.
export function createBookingActivities(database: Kysely<Database>, providers: TransactionProviderRegistry): BookingActivityImplementations {
  return { ...createRevalidationActivities(database, providers), ...createExecutionActivities(database, providers) };
}
