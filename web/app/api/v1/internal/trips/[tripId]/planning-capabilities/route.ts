import { internalPlanningApiResponse } from "@/server/api";
import { researchCapabilities } from "@/server/supply/planning-research";
import { internalResearchActor } from "@/server/supply/research-api";

export async function GET(request: Request, route: { params: Promise<{ tripId: string }> }) {
  return internalPlanningApiResponse(request, async (application) => {
    const { tripId } = await route.params;
    return researchCapabilities(application.database, application.planningProviders, application.providerReadiness,
      internalResearchActor(application, request, tripId), new URL(request.url).searchParams.get("componentTypes")?.split(","));
  }, { outsideTransaction: true });
}
