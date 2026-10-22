import { planningApiResponse, planningUser } from "@/server/api";
import { publicRun } from "@/server/agent-client/results";

export async function GET(request: Request, route: { params: Promise<{ runId: string }> }) {
  return planningApiResponse(request, async (application) =>
    publicRun(
      application.database,
      (await planningUser(application, request)).id,
      (await route.params).runId,
    ),
  );
}
