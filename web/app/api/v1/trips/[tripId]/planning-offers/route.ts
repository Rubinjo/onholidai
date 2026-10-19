import { apiResponse } from "@/server/api";
import { listResearch } from "@/server/supply/planning-research";
import { browserResearchActor } from "@/server/supply/research-api";

export async function GET(request: Request, route: { params: Promise<{ tripId: string }> }) {
  return apiResponse(request, async (application) => {
    const { tripId } = await route.params;
    return listResearch(application.database, await browserResearchActor(application, request, tripId));
  });
}
