import { createTrip } from "@/domain/trip/create";
import { apiResponse, browserUser, requestJson } from "@/server/api";

export async function POST(request: Request): Promise<Response> {
  return apiResponse(
    request,
    async (application) => {
      const user = await browserUser(application, request);
      return createTrip(application.database, user.id, await requestJson(request));
    },
    { status: 201 },
  );
}
