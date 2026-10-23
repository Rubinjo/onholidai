import { bookingApiResponse, browserUser } from "@/server/api";
import {
  projectBookingTransactionRow,
  projectPublicBookingTransaction,
} from "@/domain/booking/schema";
import { ProblemError } from "@/server/errors";

export async function GET(
  request: Request,
  context: { params: Promise<{ bookingId: string }> },
): Promise<Response> {
  return bookingApiResponse(request, async (application) => {
    const user = await browserUser(application, request);
    const { bookingId } = await context.params;
    const record = await application.database
      .selectFrom("bookingTransactions")
      .selectAll()
      .where("id", "=", bookingId)
      .where("ownerUserId", "=", user.id)
      .executeTakeFirst();
    if (!record)
      throw new ProblemError({
        title: "Booking not found",
        status: 404,
        code: "booking_not_found",
      });
    const booking = projectBookingTransactionRow(record);
    const attempts = await application.database
      .selectFrom("bookingComponentAttempts")
      .select("componentId")
      .where("transactionId", "=", booking.id)
      .where("status", "!=", "claimed")
      .execute();
    return {
      ...projectPublicBookingTransaction(
        booking,
        new Set(attempts.map((entry) => entry.componentId)),
      ),
      currentTripVersion: record.lastObservedTripVersion,
    };
  });
}
