import { draftApiResponse, assertSameOrigin, planningContext, requestJson } from "@/server/api";
import { SetupDraftRepository } from "@/server/db/setup-draft-repository";
type Route = { params: Promise<{ draftId: string }> };
export async function GET(request: Request, route: Route) {
  return draftApiResponse(request, async (application) => new SetupDraftRepository(application.database,
    (await planningContext(application, request)).identity).read((await route.params).draftId));
}
export async function PATCH(request: Request, route: Route) {
  return draftApiResponse(request, async (application) => {
    assertSameOrigin(application, request);
    return new SetupDraftRepository(application.database, (await planningContext(application, request)).identity)
      .save((await route.params).draftId, await requestJson(request));
  });
}
