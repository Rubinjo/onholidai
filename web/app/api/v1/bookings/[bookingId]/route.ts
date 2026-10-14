import { bookingApiResponse, browserUser } from "@/server/api";
import { projectBookingTransactionRow } from "@/domain/booking/schema";
import { ProblemError } from "@/server/errors";

export async function GET(request: Request, context: { params: Promise<{ bookingId: string }> }): Promise<Response> {
  return bookingApiResponse(request, async (application) => {
    const user = await browserUser(application, request);
    const { bookingId } = await context.params;
    const record = await application.database.selectFrom("bookingTransactions").selectAll()
      .where("id", "=", bookingId).where("ownerUserId", "=", user.id).executeTakeFirst();
    if (!record) throw new ProblemError({ title: "Booking not found", status: 404, code: "booking_not_found" });
    const booking = projectBookingTransactionRow(record);
    return { ...booking, currentTripVersion: record.lastObservedTripVersion,
      executionBasis: { tripVersion: booking.executionBasis.startingTripVersion,
        termsHash: booking.executionBasis.termsHash, expiresAt: booking.executionBasis.expiresAt } };
  });
}
