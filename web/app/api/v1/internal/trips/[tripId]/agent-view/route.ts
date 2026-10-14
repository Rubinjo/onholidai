import { z } from "zod";

import { agentViewDetailSchema, readAgentTrip } from "@/domain/trip/read";
import { internalPlanningApiResponse, internalActor } from "@/server/api";

export async function GET(request: Request, context: { params: Promise<{ tripId: string }> }): Promise<Response> {
  return internalPlanningApiResponse(request, async (application) => {
    const tripId = (await context.params).tripId;
    const query = new URL(request.url).searchParams;
    const baseTripVersion = z.coerce.number().int().positive().parse(query.get("baseTripVersion"));
    const detail = agentViewDetailSchema.parse(query.get("detail"));
    const actor = internalActor(application, request, tripId, baseTripVersion, "trip:read");
    return readAgentTrip(application.database, actor.userId, tripId, baseTripVersion, detail);
  });
}
