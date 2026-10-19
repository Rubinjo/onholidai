import { internalPlanningApiResponse } from "@/server/api";
import { refreshResearchOffer } from "@/server/supply/planning-research";
import { internalResearchActor, requestedOffer } from "@/server/supply/research-api";

export async function GET(request: Request, route: { params: Promise<{ tripId: string; offerRef: string }> }) {
  return internalPlanningApiResponse(request, async (application) => {
    const { tripId, offerRef } = await route.params;
    return refreshResearchOffer(application.database, application.planningProviders,
      internalResearchActor(application, request, tripId), requestedOffer(request, offerRef), "detail",
      { readiness: application.providerReadiness, signal: request.signal });
  }, { outsideTransaction: true });
}
