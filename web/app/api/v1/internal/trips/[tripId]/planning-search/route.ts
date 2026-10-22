import { z } from "zod";

import { internalPlanningApiResponse, internalActor, requestJson } from "@/server/api";
import { searchResearch } from "@/server/supply/planning-research";

export async function POST(request: Request, route: { params: Promise<{ tripId: string }> }) {
  return internalPlanningApiResponse(
    request,
    async (application) => {
      const { tripId } = await route.params;
      const base = z.coerce
        .number()
        .int()
        .positive()
        .parse(request.headers.get("x-base-trip-version"));
      const actor = internalActor(application, request, tripId, base, "trip:read");
      return searchResearch(
        application.database,
        application.planningProviders,
        actor,
        await requestJson(request),
        { signal: request.signal, readiness: application.providerReadiness },
      );
    },
    { outsideTransaction: true },
  );
}
