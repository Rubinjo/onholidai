import { createHash, randomBytes, randomUUID } from "node:crypto";

import { sql, type Kysely, type Selectable } from "kysely";

import { inTransaction } from "@/server/db/transaction";

import type { Database } from "@/server/db/database";
import type { GuestPlanningSessionTable } from "@/server/db/types";

export const PLANNING_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
export function digestPlanningCredential(credential: string): string {
  return createHash("sha256").update(credential).digest("hex");
}
export function validPlanningSession(
  session: Pick<Selectable<GuestPlanningSessionTable>, "expiresAt" | "revokedAt">,
  now: Date,
): boolean {
  return session.revokedAt === null && session.expiresAt > now;
}
export function planningCookie(credential: string, production: boolean): string {
  const name = production ? "__Host-onholidai-planning" : "onholidai-planning-dev";
  return `${name}=${credential}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PLANNING_IDLE_MS / 1000}${production ? "; Secure" : ""}`;
}
export function planningCredential(headers: Headers, production: boolean): string | null {
  const name = production ? "__Host-onholidai-planning" : "onholidai-planning-dev";
  const value = headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export async function readPlanningSession(
  database: Kysely<Database>,
  credential: string | null,
  now = new Date(),
) {
  if (!credential) return null;
  const session = await database
    .selectFrom("guestPlanningSessions")
    .selectAll()
    .where("credentialDigest", "=", digestPlanningCredential(credential))
    .executeTakeFirst();
  return session && validPlanningSession(session, now) ? session : null;
}
export async function renewPlanningSession(
  database: Kysely<Database>,
  credential: string,
  now = new Date(),
) {
  return inTransaction(database, async (transaction) => {
    const row = await transaction
      .selectFrom("guestPlanningSessions")
      .selectAll()
      .where("credentialDigest", "=", digestPlanningCredential(credential))
      .forUpdate()
      .executeTakeFirst();
    if (!row || !validPlanningSession(row, now)) return null;
    // Requests capture their timestamp before waiting for this row lock. Their
    // lock order may differ from arrival order; an older request must neither
    // move activity backwards nor shorten a newer request's idle window.
    return transaction
      .updateTable("guestPlanningSessions")
      .set({
        lastActivityAt: sql<Date>`GREATEST(${now}, last_activity_at)`,
        expiresAt: sql<Date>`GREATEST(${new Date(now.getTime() + PLANNING_IDLE_MS)}, expires_at)`,
      })
      .where("id", "=", row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}
export async function createPlanningSession(
  database: Kysely<Database>,
  options: { now?: () => Date; random?: () => Buffer } = {},
) {
  const now = (options.now ?? (() => new Date()))();
  const bytes = (options.random ?? (() => randomBytes(32)))();
  if (bytes.length !== 32) throw new RangeError("Planning credentials require 32 random bytes");
  const credential = bytes.toString("base64url");
  const row = await database
    .insertInto("guestPlanningSessions")
    .values({
      id: randomUUID(),
      credentialDigest: digestPlanningCredential(credential),
      createdAt: now,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + PLANNING_IDLE_MS),
      revokedAt: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { session: row, credential };
}
export async function revokePlanningSession(
  database: Kysely<Database>,
  credential: string,
  now = new Date(),
): Promise<void> {
  await database
    .updateTable("guestPlanningSessions")
    .set({ revokedAt: now })
    .where("credentialDigest", "=", digestPlanningCredential(credential))
    .where("revokedAt", "is", null)
    .execute();
}
