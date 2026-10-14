import { internalPlanningApiResponse, internalActor, requestJson } from "@/server/api";
import { z } from "zod";
import { ConversationRepository } from "@/server/db/conversation-repository";
import { readTrip } from "@/domain/trip/read";
export async function POST(request: Request) {
  return internalPlanningApiResponse(request, async (application) => {
    const tripId = z.uuid().parse(request.headers.get("x-trip-id")), base = z.coerce.number().int().positive().parse(request.headers.get("x-base-trip-version"));
    const actor = internalActor(application, request, tripId, base, "context:read");
    await readTrip(application.database, actor.userId, tripId, { expectedVersion: base });
    return new ConversationRepository(application.database).search(actor.userId, tripId, await requestJson(request));
  });
}
