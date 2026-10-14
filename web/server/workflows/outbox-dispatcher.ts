import "server-only";
import { z } from "zod";
import { OutboxRepository, deliverOutboxBatch, type ClaimedOutboxEvent, type OutboxPublisher } from "@/server/db/outbox";
import type { Kysely } from "kysely";
import type { Database } from "@/server/db/database";
import { startWorkflow } from "./client";

const revalidationPayload = z.object({ workflowId: z.string().min(1), tripId: z.uuid(), ownerUserId: z.string().min(1), tripVersion: z.number().int().positive() }).passthrough();
const reschedulePayload = revalidationPayload.extend({ bookingId: z.uuid(), componentId: z.uuid(), requestedChange: z.record(z.string(), z.unknown()) });
const bookingPayload = z.object({ transactionId: z.uuid(), workflowId: z.string().min(1) }).passthrough();

// Only booking events are claimed here. Trip-state events (`trip.version.committed`) are consumed
// by the trip event stream and must never be failed or retried by the booking dispatcher.
export const BOOKING_OUTBOX_EVENT_TYPES = Object.freeze([
  "booking.revalidation.requested",
  "booking.reschedule.revalidation.requested",
  "booking.transaction.requested",
] as const);

function payload(event: ClaimedOutboxEvent): Record<string, unknown> { return event.payload as Record<string, unknown>; }

function alreadyStarted(error: unknown): boolean {
  return error instanceof Error && /already started|workflowexecutionalreadystarted/i.test(`${error.name} ${error.message}`);
}

export class BookingOutboxPublisher implements OutboxPublisher {
  async publish(event: ClaimedOutboxEvent): Promise<void> {
    const data = payload(event);
    try {
      if (event.eventType === "booking.revalidation.requested") {
        const input = revalidationPayload.parse(data);
        await startWorkflow("revalidateBooking", input.workflowId, process.env.TEMPORAL_BOOKING_TASK_QUEUE ?? "onholidai-booking", input);
      } else if (event.eventType === "booking.reschedule.revalidation.requested") {
        const input = reschedulePayload.parse(data);
        await startWorkflow("revalidateComponentReschedule", input.workflowId, process.env.TEMPORAL_BOOKING_TASK_QUEUE ?? "onholidai-booking", input);
      } else if (event.eventType === "booking.transaction.requested") {
        const input = bookingPayload.parse(data);
        await startWorkflow("bookTrip", input.workflowId, process.env.TEMPORAL_BOOKING_TASK_QUEUE ?? "onholidai-booking", { transactionId: input.transactionId });
      } else {
        throw new Error("Unsupported booking outbox event");
      }
    } catch (error) {
      if (!alreadyStarted(error)) throw error;
    }
  }
}

export async function dispatchBookingOutboxBatch(database: Kysely<Database>) {
  return deliverOutboxBatch(new OutboxRepository(database), new BookingOutboxPublisher(), {
    batchSize: 20,
    leaseMilliseconds: 30_000,
    eventTypes: BOOKING_OUTBOX_EVENT_TYPES,
  });
}

export async function runBookingOutboxDispatcher(database: Kysely<Database>, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    await dispatchBookingOutboxBatch(database);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1000);
      const onAbort = () => { clearTimeout(timer); resolve(); };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }
}
