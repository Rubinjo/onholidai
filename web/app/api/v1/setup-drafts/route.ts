import { z } from "zod";
import { draftApiResponse, assertSameOrigin, planningContext, requestJson } from "@/server/api";
import { SetupDraftRepository } from "@/server/db/setup-draft-repository";
export async function POST(request: Request) {
  return draftApiResponse(request, async (application) => {
    assertSameOrigin(application, request);
    const { requestId } = z.object({ requestId: z.uuid() }).strict().parse(await requestJson(request));
    const { identity } = await planningContext(application, request);
    const result = await new SetupDraftRepository(application.database, identity).allocate(requestId);
    return Response.json(result.draft, { status: result.replayed ? 200 : 201 });
  });
}
