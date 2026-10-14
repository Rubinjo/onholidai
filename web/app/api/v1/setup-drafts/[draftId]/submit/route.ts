import { draftApiResponse, assertSameOrigin, planningContext, requestJson } from "@/server/api";
import { SetupDraftRepository } from "@/server/db/setup-draft-repository";
export async function POST(request: Request, route: { params: Promise<{ draftId: string }> }) {
  return draftApiResponse(request, async (application) => {
    assertSameOrigin(application, request);
    const result = await new SetupDraftRepository(application.database, (await planningContext(application, request)).identity)
      .submit((await route.params).draftId, await requestJson(request));
    return Response.json(result, { status: result.replayed ? 200 : 201 });
  });
}
