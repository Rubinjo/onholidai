import { apiResponse, requestJson } from "@/server/api";
import { refreshResearchOffer, offerReferenceSchema } from "@/server/supply/planning-research";
import { browserResearchActor } from "@/server/supply/research-api";

export async function POST(
  request: Request,
  route: { params: Promise<{ tripId: string; offerRef: string }> },
) {
  return apiResponse(request, async (application) => {
    const { tripId, offerRef } = await route.params;
    const body = offerReferenceSchema.omit({ offerRef: true }).parse(await requestJson(request));
    return refreshResearchOffer(
      application.database,
      application.planningProviders,
      await browserResearchActor(application, request, tripId),
      { ...body, offerRef },
      "revalidation",
      { signal: request.signal, readiness: application.providerReadiness },
    );
  });
}
