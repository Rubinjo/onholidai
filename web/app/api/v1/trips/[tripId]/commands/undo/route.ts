import { undoDraft } from "@/domain/trip/undo";
import { planningApiResponse, planningUser, requestJson } from "@/server/api";
export async function POST(request: Request, route: { params: Promise<{ tripId: string }> }) {
  return planningApiResponse(request, async (application) => undoDraft(application.database, (await planningUser(application, request)).id, (await route.params).tripId, await requestJson(request)));
}
