import { apiResponse, assertSameOrigin, planningContext, requestJson } from "@/server/api";
import { createBookingIntent } from "@/server/auth/booking-intent";
export async function POST(request: Request) {
  return apiResponse(request, async (application) => {
    assertSameOrigin(application, request);
    return createBookingIntent(application.database, (await planningContext(application, request)).identity, await requestJson(request));
  });
}
