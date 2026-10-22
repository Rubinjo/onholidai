import { internalPlanningApiResponse, requestJson } from "@/server/api";
import { offerReferenceSchema, refreshResearchOffer } from "@/server/supply/planning-research";
import { internalResearchActor } from "@/server/supply/research-api";

export async function POST(
  request: Request,
  route: { params: Promise<{ tripId: string; offerRef: string }> },
) {
  return internalPlanningApiResponse(
    request,
    async (application) => {
      const { tripId, offerRef } = await route.params;
      const body = offerReferenceSchema.omit({ offerRef: true }).parse(await requestJson(request));
      return refreshResearchOffer(
        application.database,
        application.planningProviders,
        internalResearchActor(application, request, tripId),
        { ...body, offerRef },
        "revalidation",
        { signal: request.signal, readiness: application.providerReadiness },
      );
    },
    { outsideTransaction: true },
  );
}
