import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Kysely } from "kysely";
import type { Database } from "./database";
import { readTrip } from "@/domain/trip/read";
import { ConversationSummarySchema, RetrieveRelevantContextInputSchema } from "@contracts/agent-api/generated.zod";

export function redactConversation(text: string): string {
  return text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[number]")
    .replace(/\b(?:sk-|Bearer\s+)[A-Za-z0-9_-]+/gi, "[credential]")
    .replace(/\b(api[_ -]?key|password|passport|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 12000);
}

export class ConversationRepository {
  constructor(private readonly database: Kysely<Database>) {}
  async messages(userId: string, tripId: string, limit = 200) {
    await readTrip(this.database, userId, tripId);
    const rows = await this.database.selectFrom("conversationMessages").innerJoin("conversations", "conversations.id", "conversationMessages.conversationId")
      .selectAll("conversationMessages").where("conversations.ownerUserId", "=", userId).where("conversations.tripId", "=", tripId)
      .where("conversationMessages.retentionExpiresAt", ">", new Date()).orderBy("conversationMessages.createdAt", "desc").orderBy("conversationMessages.id", "desc").limit(limit).execute();
    return rows.reverse().map((row) => ({ id: row.id, conversationId: row.conversationId, role: row.role, tripVersion: row.tripVersion, runId: row.agentRunId,
      occurredAt: row.createdAt.toISOString(), redactedContent: redactConversation(typeof row.content.text === "string" ? row.content.text : String(row.content.kind ?? "Saved planning message")) }));
  }
  async context(userId: string, tripId: string, version: number) {
    const messages = await this.messages(userId, tripId, 1000), current = await readTrip(this.database, userId, tripId, { expectedVersion: version });
    const proposals = await this.database.selectFrom("changeProposals").selectAll().where("tripId", "=", tripId).orderBy("createdAt", "desc").limit(64).execute();
    const questions = await this.database.selectFrom("agentRuns").select("result").where("tripId", "=", tripId).where("ownerUserId", "=", userId).where("status", "=", "awaiting_clarification").orderBy("startedAt", "desc").limit(20).execute();
    const summary = ConversationSummarySchema.parse({ sourceTripVersion: version,
      constraints: current.snapshot.constraints.filter((entry) => entry.status !== "removed").map((entry) => entry.statement),
      preferences: Object.entries(current.snapshot.preferences).map(([key, value]) => `${key}: ${value}`),
      decisions: proposals.filter((entry) => entry.status === "applied").map((entry) => redactConversation(entry.proposal.rationale).slice(0, 1000)),
      rejectedOptions: proposals.filter((entry) => entry.status === "rejected").map((entry) => redactConversation(`${entry.proposal.id}: ${entry.proposal.rationale}`).slice(0, 1000)),
      openQuestions: questions.flatMap((entry) => {
        const clarification = entry.result?.clarification as { question?: string } | undefined;
        return clarification?.question ? [redactConversation(clarification.question).slice(0, 1000)] : [];
      }) });
    const recent = [] as { id: string; role: "user" | "assistant" | "system"; redactedContent: string; occurredAt: string }[];
    let bytes = 0;
    for (const entry of messages.slice(-20).reverse()) {
      const size = Buffer.byteLength(entry.redactedContent);
      if (bytes + size > 8000) break;
      bytes += size;
      recent.unshift({ id: entry.id, role: entry.role, redactedContent: entry.redactedContent, occurredAt: entry.occurredAt });
    }
    if (messages.length >= 100 || messages.reduce((sum, entry) => sum + Buffer.byteLength(entry.redactedContent), 0) >= 16800) {
      const conversation = await this.database.selectFrom("conversations").select("id").where("ownerUserId", "=", userId).where("tripId", "=", tripId).orderBy("createdAt", "desc").executeTakeFirst();
      if (conversation) {
        const own = await this.database.selectFrom("conversationMessages").select("id").where("conversationId", "=", conversation.id).orderBy("createdAt").execute();
        if (own.length) await this.database.transaction().execute(async (transaction) => {
          await transaction.selectFrom("conversations").select("id").where("id", "=", conversation.id).forUpdate().execute();
          const latest = await transaction.selectFrom("conversationSummaries").select("summaryVersion").where("conversationId", "=", conversation.id).orderBy("summaryVersion", "desc").executeTakeFirst();
          await transaction.insertInto("conversationSummaries").values({ id: randomUUID(), conversationId: conversation.id, summaryVersion: (latest?.summaryVersion ?? 0) + 1, content: { ...summary },
            firstMessageId: own[0].id, lastMessageId: own.at(-1)!.id, sourceTripVersion: version, tokenEstimate: Buffer.byteLength(JSON.stringify(summary)) }).execute();
        });
      }
    }
    return { conversationSummary: summary, recentMessages: recent };
  }
  async search(userId: string, tripId: string, raw: unknown) {
    const input = RetrieveRelevantContextInputSchema.parse(raw);
    const messages = await this.messages(userId, tripId, 1000);
    const words = input.query.toLocaleLowerCase().split(/\s+/).filter((word) => word.length > 2);
    const proposals = await this.database.selectFrom("changeProposals").selectAll().where("tripId", "=", tripId).where("status", "=", "rejected").orderBy("createdAt", "desc").limit(64).execute();
    const rejected = proposals.filter((entry) => (!input.before || entry.createdAt.toISOString() < input.before) && (words.includes("rejected") || words.some((word) => entry.proposal.rationale.toLocaleLowerCase().includes(word))))
      .map((entry) => ({ id: entry.id, source: "rejected_proposal", sourceTripVersion: entry.baseTripVersion, occurredAt: entry.createdAt.toISOString(), redactedContent: redactConversation(entry.proposal.rationale).slice(0, 1000), destinations: entry.proposal.previewSnapshot?.destinations ?? [], authoritative: false }));
    const matched = messages.filter((entry) => (!input.before || entry.occurredAt < input.before) && (words.some((word) => entry.redactedContent.toLocaleLowerCase().includes(word)) || (input.entityIds ?? []).some((id) => entry.redactedContent.includes(id))))
      .slice(-input.limit).map((entry) => ({ ...entry, redactedContent: entry.redactedContent.slice(0, 500), source: "conversation_message", authoritative: false }));
    const items = [...rejected, ...matched].slice(0, input.limit);
    while (Buffer.byteLength(JSON.stringify(items)) > 15000) items.pop();
    return { items };
  }
}

export const historyQuerySchema = z.object({ beforeVersion: z.coerce.number().int().positive().optional() });
