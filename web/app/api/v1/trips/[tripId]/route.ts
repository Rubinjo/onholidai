import { readTrip } from "@/domain/trip/read";
import { apiResponse, browserUser } from "@/server/api";

export async function GET(request: Request, context: { params: Promise<{ tripId: string }> }): Promise<Response> {
  return apiResponse(request, async (application) => {
    const user = await browserUser(application, request);
    return readTrip(application.database, user.id, (await context.params).tripId);
  });
}
