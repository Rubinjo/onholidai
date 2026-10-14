import { z } from "zod";
import { apiResponse, planningUser, requestJson } from "@/server/api";
import { inTransaction } from "@/server/db/transaction";
import { lockPlanningAccess } from "@/server/db/planning-access";
import { RunRepository } from "@/server/agent-client/run-repository";
import { dispatchEstimate } from "@/server/agent-client/client";
import { publicRun } from "@/server/agent-client/results";
const command = z.object({ requestId: z.uuid(), baseTripVersion: z.number().int().positive(),
  conversationId: z.uuid().nullable().optional(), message: z.string().trim().min(1).max(12000), purpose: z.enum(["initial_estimate", "refinement", "finalization"]) }).strict();
export async function POST(request: Request, route: { params: Promise<{ tripId: string }> }) {
  return apiResponse(request, async (application) => {
    const { actor, id } = await planningUser(application, request), { tripId } = await route.params;
    const input = command.parse(await requestJson(request));
    const run = await inTransaction(application.database, async (transaction) => {
      await lockPlanningAccess(transaction, actor);
      return new RunRepository(transaction, () => new Date(), { active: application.config.GUEST_MAX_ACTIVE_RUNS,
        hourly: application.config.GUEST_MAX_RUNS_PER_HOUR }).reserve({ userId: id, tripId,
        requestId: input.requestId, baseTripVersion: input.baseTripVersion, message: input.message, purpose: input.purpose });
    });
    try { await dispatchEstimate(application, run, input.message); } catch { /* Durable reservation is replayable. */ }
    return inTransaction(application.database, async (transaction) => {
      await lockPlanningAccess(transaction, actor);
      return publicRun(transaction, id, run.id);
    });
  }, { status: 202 });
}
