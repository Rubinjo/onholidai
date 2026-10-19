import { apiResponse } from "@/server/api";
import { researchCapabilities } from "@/server/supply/planning-research";
import { browserResearchActor } from "@/server/supply/research-api";

export async function GET(request: Request, route: { params: Promise<{ tripId: string }> }) {
  return apiResponse(request, async (application) => {
    const { tripId } = await route.params;
    return researchCapabilities(application.database, application.planningProviders, application.providerReadiness,
      await browserResearchActor(application, request, tripId), new URL(request.url).searchParams.get("componentTypes")?.split(","));
  });
}
