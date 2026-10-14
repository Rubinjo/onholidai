// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { hasIsolatedDatabaseConfiguration, withIsolatedTestDatabase } from "../helpers/database";
import { seedAuthorizedBooking } from "../helpers/booking";
import { allocateWizardPrincipal } from "../../server/db/planning-principal-repository";
import { resolveBookingActor } from "../../server/auth/planning-actor";
import { startBooking } from "../../domain/booking/start";
vi.mock("server-only", () => ({}));
vi.mock("../../server/workflows/client", () => ({ startWorkflow: vi.fn(async () => undefined) }));
describe.skipIf(!hasIsolatedDatabaseConfiguration())("registered booking identity differs from principal", () => {
  it("retains account consent and execution basis while resolving trip through a dedicated principal", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seed = await seedAuthorizedBooking(database, { startTransaction: false });
      const principal = await allocateWizardPrincipal(database, { accountUserId: seed.userId, guestSessionId: null });
      await database.updateTable("trips").set({ ownerUserId: principal }).where("id", "=", seed.tripId).execute();
      const actor = await resolveBookingActor(database, seed.tripId, seed.userId);
      expect(actor).toEqual({ accountUserId: seed.userId, planningOwnerId: principal });
      const booking = await startBooking(database, actor, seed.tripId, { requestId: randomUUID(), authorizationId: seed.authorizationId });
      expect(booking.executionBasis.ownerUserId).toBe(seed.userId);
      expect((await database.selectFrom("bookingTransactions").select("ownerUserId").where("id", "=", booking.id).executeTakeFirstOrThrow()).ownerUserId).toBe(seed.userId);
      await expect(resolveBookingActor(database, seed.tripId, randomUUID())).rejects.toMatchObject({ status: 404 });
    });
  });
});
