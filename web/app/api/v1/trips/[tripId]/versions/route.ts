import { planningApiResponse, planningUser } from "@/server/api";
import { readVersionHistory } from "@/server/db/version-history";
import { z } from "zod";
export async function GET(request: Request, route: { params: Promise<{ tripId: string }> }) {
  return planningApiResponse(request, async (application) => readVersionHistory(application.database, (await planningUser(application, request)).id, (await route.params).tripId, z.coerce.number().int().nonnegative().parse(new URL(request.url).searchParams.get("afterVersion") ?? "0")));
}
