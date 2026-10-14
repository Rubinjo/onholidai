import { z } from "zod";
import { apiResponse, assertSameOrigin, planningContext, requestJson } from "@/server/api";
import { createPlanningSession, planningCookie, renewPlanningSession } from "@/server/auth/planning-session";
import { inTransaction } from "@/server/db/transaction";
import { networkDigest, reserveBootstrap } from "@/server/metrics/guest-planning";
export async function POST(request: Request) {
  return apiResponse(request, async (application) => {
    assertSameOrigin(application, request);
    z.object({ requestId: z.uuid() }).strict().parse(await requestJson(request));
    const context = await planningContext(application, request);
    if (context.identity.accountUserId) return { kind: "account" };
    const renewed = context.credential ? await renewPlanningSession(application.database, context.credential) : null;
    const result = renewed ? { session: renewed, credential: context.credential! } : await inTransaction(application.database, async (transaction) => {
      // The deployment's trusted proxy must overwrite this header. Without it,
      // all unknown callers share one conservative bucket; never trust forwarded lists.
      const network = application.config.GUEST_TRUST_PROXY_IP ? request.headers.get("x-real-ip")?.slice(0, 128) ?? "unknown-network" : "unknown-network";
      await reserveBootstrap(transaction, networkDigest(network, application.config.GUEST_NETWORK_SECRET ?? application.config.BETTER_AUTH_SECRET), application.config.GUEST_MAX_SESSIONS_PER_HOUR);
      return createPlanningSession(transaction);
    });
    return Response.json({ kind: "guest", expiresAt: result.session.expiresAt.toISOString() },
      { headers: { "Set-Cookie": planningCookie(result.credential, context.production) } });
  });
}
