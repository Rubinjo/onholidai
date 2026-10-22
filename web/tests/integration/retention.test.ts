// @vitest-environment node
import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";
import { sql } from "kysely";

vi.mock("server-only", () => ({}));

import {
  addCalendarMonths,
  authorizeRetentionDeletion,
  evaluateRetentionReview,
  expireRawConversationMessages,
  rawConversationExpiry,
} from "../../server/privacy/retention";
import { hasIsolatedDatabaseConfiguration, withIsolatedTestDatabase } from "../helpers/database";

describe("privacy retention policy boundary", () => {
  it("expires raw conversation content 90 days after it was written", () => {
    expect(rawConversationExpiry(new Date("2026-01-01T00:00:00Z")).toISOString()).toBe(
      "2026-04-01T00:00:00.000Z",
    );
  });

  it("uses calendar months and clamps month-end dates", () => {
    expect(addCalendarMonths(new Date("2024-02-29T12:30:00Z"), 24).toISOString()).toBe(
      "2026-02-28T12:30:00.000Z",
    );
  });

  it("holds immutable transaction evidence until a policy review approves a retention action", () => {
    const lastActivityAt = new Date("2024-01-31T00:00:00Z");
    const due = evaluateRetentionReview({
      tripId: "trip",
      ownerUserId: "owner",
      lastActivityAt,
      now: new Date("2026-02-01T00:00:00Z"),
      legalHoldActive: false,
    });
    expect(due.status).toBe("review_required");
    expect(due.protectedCategories).toEqual([
      "trip_versions",
      "booking_records",
      "authorizations",
      "audit_evidence",
    ]);
    expect(
      evaluateRetentionReview({
        tripId: "trip",
        ownerUserId: "owner",
        lastActivityAt,
        now: new Date("2030-01-01T00:00:00Z"),
        legalHoldActive: true,
      }).status,
    ).toBe("legal_hold");
  });

  it("refuses record deletion when no business policy is configured", async () => {
    await expect(
      authorizeRetentionDeletion(undefined, {
        tripId: "trip",
        ownerUserId: "owner",
        categories: ["trip_versions"],
        reviewedAt: new Date(),
      }),
    ).rejects.toThrow("retention_business_policy_not_configured");
  });
});

const describeWithDatabase = hasIsolatedDatabaseConfiguration() ? describe : describe.skip;
describeWithDatabase("conversation retention persistence", () => {
  it("scrubs expired message bodies in a bounded batch while preserving message identity", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const tripId = randomUUID(),
        conversationId = randomUUID(),
        messageId = randomUUID();
      const ownerUserId = `retention-${randomUUID()}`;
      const createdAt = new Date("2025-01-01T00:00:00Z");
      const now = new Date("2026-01-01T00:00:00Z");
      await sql`INSERT INTO app."user" (id, name, email) VALUES (${ownerUserId}, 'Synthetic retention owner', ${`${ownerUserId}@example.invalid`})`.execute(
        database,
      );
      await sql`INSERT INTO app.trips (id, owner_user_id, title, currency, created_at, updated_at, last_activity_at)
        VALUES (${tripId}::uuid, ${ownerUserId}, 'Synthetic retention trip', 'GBP', ${createdAt}, ${createdAt}, ${createdAt})`.execute(
        database,
      );
      await database
        .insertInto("conversations")
        .values({
          id: conversationId,
          tripId,
          ownerUserId,
          createdAt,
          updatedAt: createdAt,
          retentionExpiresAt: new Date("2025-04-01T00:00:00Z"),
        })
        .execute();
      await database
        .insertInto("conversationMessages")
        .values({
          id: messageId,
          conversationId,
          role: "user",
          content: { kind: "research_request", text: "Synthetic private conversation text" },
          tripVersion: null,
          agentRunId: null,
          createdAt,
          retentionExpiresAt: new Date("2025-04-01T00:00:00Z"),
        })
        .execute();

      await expect(expireRawConversationMessages(database, now, 1)).resolves.toBe(1);
      const message = await database
        .selectFrom("conversationMessages")
        .selectAll()
        .where("id", "=", messageId)
        .executeTakeFirstOrThrow();
      expect(message.content).toEqual({ kind: "expired" });
      await expect(expireRawConversationMessages(database, now, 1)).resolves.toBe(0);
    });
  });
});
