import { applyEdit } from "@/domain/trip/edit";
import { planningApiResponse, planningUser, requestJson } from "@/server/api";
export async function POST(request: Request, route: { params: Promise<{ tripId: string }> }) {
  return planningApiResponse(request, async (application) => applyEdit(application.database, (await planningUser(application, request)).id, (await route.params).tripId, await requestJson(request)));
}
