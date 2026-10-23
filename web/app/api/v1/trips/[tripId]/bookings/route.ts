import { bookingApiResponse, browserUser, requestJson } from "@/server/api";
import { startBooking } from "@/domain/booking/start";
import { readBookingReview } from "@/domain/booking/revalidate";
import { projectPublicBookingTransaction } from "@/domain/booking/schema";

type Route = { params: Promise<{ tripId: string }> };
export async function GET(request: Request, route: Route): Promise<Response> {
  return bookingApiResponse(request, async (application) => {
    const user = await browserUser(application, request);
    return readBookingReview(application.database, user.id, (await route.params).tripId);
  });
}
export async function POST(request: Request, route: Route): Promise<Response> {
  return bookingApiResponse(
    request,
    async (application) => {
      const user = await browserUser(application, request);
      const booking = await startBooking(
        application.database,
        user.id,
        (await route.params).tripId,
        await requestJson(request),
        { prerequisites: application.bookingPrerequisites },
      );
      return projectPublicBookingTransaction(booking);
    },
    { status: 202 },
  );
}
