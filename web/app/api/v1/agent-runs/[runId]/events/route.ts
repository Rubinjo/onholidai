import { z } from "zod";

import { planningApiResponse, planningUser } from "@/server/api";
import { publicEvents } from "@/server/agent-client/results";

export async function GET(request: Request, route: { params: Promise<{ runId: string }> }) {
  let events: Awaited<ReturnType<typeof publicEvents>> = [];
  const checked = await planningApiResponse(request, async (application) => {
    const cursor = z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(
        request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after") ?? 0,
      );
    events = await publicEvents(
      application.database,
      (await planningUser(application, request)).id,
      (await route.params).runId,
      cursor,
    );
    return null;
  });
  if (!checked.ok) return checked;
  // A finite replay response reconnects using Last-Event-ID; polling is equally authoritative.
  const data = events
    .map((event) => `id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
  const headers = new Headers(checked.headers);
  headers.set("Content-Type", "text/event-stream");
  return new Response(data || ": keep-alive\n\n", { headers });
}
