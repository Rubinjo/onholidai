import { apiResponse, browserUser } from "@/server/api";
import { publicRun } from "@/server/agent-client/results";
export async function GET(request: Request, route: { params: Promise<{ runId: string }> }) {
  return apiResponse(request, async (application) => publicRun(application.database,
    (await browserUser(application, request)).id, (await route.params).runId));
}
