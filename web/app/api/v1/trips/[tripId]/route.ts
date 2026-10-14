import { readTrip } from "@/domain/trip/read";
import { planningApiResponse, planningUser } from "@/server/api";

export async function GET(request: Request, context: { params: Promise<{ tripId: string }> }): Promise<Response> {
  return planningApiResponse(request, async (application) => {
    const user = await planningUser(application, request);
    return readTrip(application.database, user.id, (await context.params).tripId);
  });
}
