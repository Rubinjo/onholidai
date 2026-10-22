import { z } from "zod";

import { planningApiResponse, planningUser } from "@/server/api";
import { ConversationRepository } from "@/server/db/conversation-repository";

export async function GET(request: Request, route: { params: Promise<{ tripId: string }> }) {
  return planningApiResponse(request, async (application) => {
    const userId = (await planningUser(application, request)).id,
      tripId = (await route.params).tripId;
    const params = new URL(request.url).searchParams;
    const beforeMessage = z.uuid().nullable().parse(params.get("beforeMessage"));
    const messages = await new ConversationRepository(application.database).messages(
      userId,
      tripId,
      200,
      beforeMessage ?? undefined,
    );
    if (params.get("timeline") === "true")
      return {
        items: [...new Set(messages.map((message) => message.conversationId))].map((id) => ({
          id,
          messages: messages
            .filter((message) => message.conversationId === id)
            .map((entry) => ({
              id: entry.id,
              role: entry.role,
              content: entry.redactedContent,
              tripVersion: entry.tripVersion,
              agentRunId: entry.runId,
              createdAt: entry.occurredAt,
            })),
        })),
        nextMessageCursor: messages.length === 200 ? messages[0].id : null,
      };
    const after = z.uuid().nullable().parse(params.get("after"));
    let query = application.database
      .selectFrom("conversations")
      .selectAll()
      .where("ownerUserId", "=", userId)
      .where("tripId", "=", tripId)
      .orderBy("id")
      .limit(21);
    if (after) query = query.where("id", ">", after);
    const rows = await query.execute();
    return {
      items: rows.slice(0, 20).map((row) => ({
        id: row.id,
        tripId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        messages: messages
          .filter((entry) => entry.conversationId === row.id)
          .map((entry) => ({
            id: entry.id,
            role: entry.role,
            content: entry.redactedContent,
            tripVersion: entry.tripVersion,
            agentRunId: entry.runId,
            createdAt: entry.occurredAt,
          })),
      })),
      nextCursor: rows.length > 20 ? rows[19].id : null,
    };
  });
}
