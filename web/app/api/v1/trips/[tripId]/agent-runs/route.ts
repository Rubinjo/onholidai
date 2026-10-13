import { z } from "zod";
import { apiResponse, browserUser, requestJson } from "@/server/api";
import { RunRepository } from "@/server/agent-client/run-repository";
import { dispatchEstimate } from "@/server/agent-client/client";
import { publicRun } from "@/server/agent-client/results";
const command = z.object({ requestId: z.uuid(), baseTripVersion: z.number().int().positive(),
  conversationId: z.uuid().nullable().optional(), message: z.string().trim().min(1).max(12000), purpose: z.enum(["initial_estimate", "refinement"]) }).strict();
export async function POST(request: Request, route: { params: Promise<{ tripId: string }> }) {
  return apiResponse(request, async (application) => {
    const user = await browserUser(application, request), { tripId } = await route.params;
    const input = command.parse(await requestJson(request));
    const run = await new RunRepository(application.database).reserve({ userId: user.id, tripId,
      requestId: input.requestId, baseTripVersion: input.baseTripVersion, message: input.message, purpose: input.purpose });
    // Reservation persists even if dispatch is uncertain. Same-request retries never rerun a running job.
    try { await dispatchEstimate(application, run, input.message); }
    catch { /* Keep the known durable reservation visible; interruption never retries research implicitly. */ }
    return publicRun(application.database, user.id, run.id);
  }, { status: 202 });
}
