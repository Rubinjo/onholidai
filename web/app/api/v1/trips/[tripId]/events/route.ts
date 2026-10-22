import { z } from "zod";

import { planningApiResponse, planningUser } from "@/server/api";

export async function GET(request: Request, route: { params: Promise<{ tripId: string }> }) {
  return planningApiResponse(request, async (application) => {
    await planningUser(application, request);
    const tripId = (await route.params).tripId;
    const after = z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(request.headers.get("last-event-id") ?? "0");
    const events = await application.database
      .selectFrom("outboxEvents")
      .select(["aggregateVersion", "payload"])
      .where("aggregateId", "=", tripId)
      .where("eventType", "=", "trip.version.committed")
      .where("eventVersion", "=", 1)
      .where("aggregateVersion", ">", after)
      .orderBy("aggregateVersion")
      .limit(100)
      .execute();
    return new Response(
      "retry: 1000\n\n" +
        events
          .map(
            (event) =>
              `id: ${event.aggregateVersion}\nevent: trip.version.committed\ndata: ${JSON.stringify({ tripId, version: event.aggregateVersion, reloadRequired: true })}\n\n`,
          )
          .join(""),
      { headers: { "Content-Type": "text/event-stream", "Cache-Control": "private, no-store" } },
    );
  });
}
