import { applyEdit } from "@/domain/trip/edit";
import { apiResponse, browserUser, requestJson } from "@/server/api";
export async function POST(request: Request, route: { params: Promise<{ tripId: string }> }) {
  return apiResponse(request, async (application) => applyEdit(application.database, (await browserUser(application, request)).id, (await route.params).tripId, await requestJson(request)));
}
