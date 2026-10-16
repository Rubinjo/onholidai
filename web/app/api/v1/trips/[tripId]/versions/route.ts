import { planningApiResponse, planningUser } from "@/server/api";
import { readVersionHistory } from "@/server/db/version-history";
import { z } from "zod";
import { readChatVersions } from "@/server/db/chat-versions";
export async function GET(request: Request, route: { params: Promise<{ tripId: string }> }) {
  return planningApiResponse(request, async (application) => {
    const user = await planningUser(application, request), { tripId } = await route.params, params = new URL(request.url).searchParams;
    if (params.get("compact") === "true") return readChatVersions(application.database, user.id, tripId,
      params.has("beforeVersion") ? z.coerce.number().int().positive().parse(params.get("beforeVersion")) : undefined);
    return readVersionHistory(application.database, user.id, tripId, z.coerce.number().int().nonnegative().parse(params.get("afterVersion") ?? "0"));
  });
}
