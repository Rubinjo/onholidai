import "server-only";
import { z } from "zod";

import { ProblemError } from "@/server/errors";
import { startBooking } from "@/domain/booking/start";
import { resolveBookingActor } from "@/server/auth/planning-actor";

import type { Database } from "@/server/db/database";
import type { Kysely } from "kysely";

const componentCommand = z.object({ requestId: z.uuid(), authorizationId: z.uuid() }).strict();

async function executeComponentOperation(
  database: Kysely<Database>,
  userId: string,
  bookingId: string,
  componentId: string,
  raw: unknown,
  operation: "cancel_component" | "reschedule_component",
) {
  const input = componentCommand.parse(raw);
  const booking = await database
    .selectFrom("bookingTransactions")
    .selectAll()
    .where("id", "=", bookingId)
    .where("ownerUserId", "=", userId)
    .executeTakeFirst();
  if (!booking)
    throw new ProblemError({ title: "Booking not found", status: 404, code: "booking_not_found" });
  const actor = await resolveBookingActor(database, booking.tripId, userId);
  const confirmed = booking.components.some((component) => {
    const item = component as { componentId?: unknown; status?: unknown };
    return item.componentId === componentId && item.status === "confirmed";
  });
  if (!confirmed)
    throw new ProblemError({
      title: "Only a confirmed component can be changed",
      status: 409,
      code: "booking_component_not_confirmed",
    });
  const authorization = await database
    .selectFrom("bookingAuthorizations")
    .select(["operation", "componentId", "tripId"])
    .where("id", "=", input.authorizationId)
    .where("ownerUserId", "=", userId)
    .executeTakeFirst();
  if (
    !authorization ||
    authorization.operation !== operation ||
    authorization.componentId !== componentId ||
    authorization.tripId !== booking.tripId
  ) {
    throw new ProblemError({
      title: "A separate authorization for this component is required",
      status: 409,
      code: "booking_operation_authorization_required",
    });
  }
  return startBooking(database, actor, booking.tripId, input);
}

export function cancelBookingComponent(
  database: Kysely<Database>,
  userId: string,
  bookingId: string,
  componentId: string,
  raw: unknown,
) {
  return executeComponentOperation(
    database,
    userId,
    bookingId,
    componentId,
    raw,
    "cancel_component",
  );
}

export function rescheduleBookingComponent(
  database: Kysely<Database>,
  userId: string,
  bookingId: string,
  componentId: string,
  raw: unknown,
) {
  return executeComponentOperation(
    database,
    userId,
    bookingId,
    componentId,
    raw,
    "reschedule_component",
  );
}
