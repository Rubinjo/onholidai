import { apiResponse, assertSameOrigin, planningContext, requestJson } from "@/server/api";
import { createBookingIntent } from "@/server/auth/booking-intent";
export async function POST(request: Request) {
  return apiResponse(request, async (application) => {
    assertSameOrigin(application, request);
    const result = await createBookingIntent(application.database, (await planningContext(application, request)).identity, await requestJson(request));
    if (!("intentId" in result)) return result;
    const { replayed, ...body } = result;
    return Response.json(body, { status: replayed ? 200 : 201 });
  });
}
