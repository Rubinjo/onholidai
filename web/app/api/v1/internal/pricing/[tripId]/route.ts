import { z } from "zod";

import { readPricingDiagnostic } from "@/domain/pricing/diagnostics";
import { apiResponse, internalActor } from "@/server/api";

export async function GET(request: Request, context: { params: Promise<{ tripId: string }> }): Promise<Response> {
  return apiResponse(request, async (application) => {
    const tripId = (await context.params).tripId;
    const query = new URL(request.url).searchParams;
    const version = z.coerce.number().int().positive().parse(query.get("version") ?? request.headers.get("x-base-trip-version"));
    const actor = internalActor(application, request, tripId, version, "pricing:read", true);
    return readPricingDiagnostic(application.database, actor.userId, tripId, version);
  });
}
