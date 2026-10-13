import { browserUser } from "@/server/api";
import { getApplication } from "@/server/application";
import { readTrip } from "@/domain/trip/read";
import { problemResponse } from "@/server/errors";
import { getOrCreateCorrelationId } from "@/server/telemetry";
import { z } from "zod";
export async function GET(request: Request, route: { params: Promise<{ tripId: string }> }) {
  try {
    const application = getApplication(), user = await browserUser(application, request), tripId = (await route.params).tripId;
    await readTrip(application.database, user.id, tripId);
    const after = z.coerce.number().int().nonnegative().parse(request.headers.get("last-event-id") ?? "0");
    const events = await application.database.selectFrom("outboxEvents").select(["aggregateVersion", "payload"])
      .where("aggregateId", "=", tripId).where("eventType", "=", "trip.version.committed").where("eventVersion", "=", 1).where("aggregateVersion", ">", after).orderBy("aggregateVersion").limit(100).execute();
    return new Response("retry: 1000\n\n" + events.map((event) => `id: ${event.aggregateVersion}\nevent: trip.version.committed\ndata: ${JSON.stringify({ tripId, version: event.aggregateVersion, reloadRequired: true })}\n\n`).join(""),
      { headers: { "Content-Type": "text/event-stream", "Cache-Control": "private, no-store" } });
  } catch (error) { return problemResponse(error, getOrCreateCorrelationId(request.headers)); }
}
