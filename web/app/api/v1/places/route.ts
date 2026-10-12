import { lookupPlaces } from "@/domain/trip/destination";
import { apiResponse, browserUser } from "@/server/api";

export async function GET(request: Request): Promise<Response> {
  return apiResponse(request, async (application) => {
    await browserUser(application, request);
    const query = new URL(request.url).searchParams;
    const places = await lookupPlaces(application.places, { query: query.get("query"),
      ...(query.has("countryCode") ? { countryCode: query.get("countryCode") } : {}) });
    return { ...places, source: application.config.PROVIDER_MODE === "deterministic" ? "synthetic" : "provider" };
  });
}
