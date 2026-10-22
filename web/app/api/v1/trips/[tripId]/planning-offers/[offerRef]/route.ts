import { apiResponse } from "@/server/api";
import { refreshResearchOffer } from "@/server/supply/planning-research";
import { browserResearchActor, requestedOffer } from "@/server/supply/research-api";

export async function GET(
  request: Request,
  route: { params: Promise<{ tripId: string; offerRef: string }> },
) {
  return apiResponse(request, async (application) => {
    const { tripId, offerRef } = await route.params;
    return refreshResearchOffer(
      application.database,
      application.planningProviders,
      await browserResearchActor(application, request, tripId),
      requestedOffer(request, offerRef),
      "detail",
      { readiness: application.providerReadiness, signal: request.signal },
    );
  });
}
