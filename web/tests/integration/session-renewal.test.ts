// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  createPlanningSession,
  renewPlanningSession,
  revokePlanningSession,
  PLANNING_IDLE_MS,
} from "../../server/auth/planning-session";
import { hasIsolatedDatabaseConfiguration, withIsolatedTestDatabase } from "../helpers/database";

describe.skipIf(!hasIsolatedDatabaseConfiguration())("overlapping guest session renewal", () => {
  it("does not move activity/expiry backwards when an older request acquires the lock last, or revive expired/revoked authority", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const now = new Date(),
        created = await createPlanningSession(database, { now: () => now });
      const newer = new Date(now.getTime() + 2000),
        older = new Date(now.getTime() + 1000);
      await renewPlanningSession(database, created.credential, newer);
      // Deterministically reproduce lock order opposite to request timestamp order.
      const renewed = await renewPlanningSession(database, created.credential, older);
      expect(renewed?.lastActivityAt).toEqual(newer);
      expect(renewed?.expiresAt).toEqual(new Date(newer.getTime() + PLANNING_IDLE_MS));
      expect(
        await renewPlanningSession(
          database,
          created.credential,
          new Date(newer.getTime() + PLANNING_IDLE_MS + 1),
        ),
      ).toBeNull();
      await revokePlanningSession(database, created.credential, newer);
      expect(await renewPlanningSession(database, created.credential, newer)).toBeNull();
    });
  });
});
