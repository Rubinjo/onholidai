import { startApplication, stopApplication } from "../../server/application";
import { createPlanningSession, planningCookie } from "../../server/auth/planning-session";
import { SetupDraftRepository } from "../../server/db/setup-draft-repository";
import { RunRepository } from "../../server/agent-client/run-repository";
import { createIsolatedTestDatabase, type IsolatedTestDatabase } from "./database";
import { validSetupPayload } from "./guest-setup";

export async function guestApiFixture() {
  const fixture = await createIsolatedTestDatabase();
  const application = startApplication({ NODE_ENV: "test", PROVIDER_MODE: "deterministic",
    DATABASE_URL: fixture.connectionString, BETTER_AUTH_URL: "http://planning.test" });
  const { session, credential } = await createPlanningSession(fixture.database);
  const drafts = new SetupDraftRepository(fixture.database, { accountUserId: null, guestSessionId: session.id });
  const { draft } = await drafts.allocate(crypto.randomUUID());
  const saved = await drafts.save(draft.draftId, { requestId: crypto.randomUUID(), expectedRevision: 1,
    currentStep: "review", payload: validSetupPayload() });
  const trip = await drafts.submit(draft.draftId, { expectedRevision: saved.revision });
  const owner = await fixture.database.selectFrom("trips").select("ownerUserId").where("id", "=", trip.tripId).executeTakeFirstOrThrow();
  const run = await new RunRepository(fixture.database).reserve({ userId: owner.ownerUserId, tripId: trip.tripId,
    requestId: trip.researchRequestId, baseTripVersion: 1, purpose: "initial_estimate", message: "Synthetic estimate" });
  return { fixture, application, session, credential, draft, trip, run,
    request(path: string, cookie = credential, body?: unknown) {
      return new Request(`http://planning.test${path}`, { method: body === undefined ? "GET" : "POST", headers: {
        cookie: planningCookie(cookie, false).split(";")[0], origin: "http://planning.test", "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    },
    async cleanup() { await stopApplication(); await fixture.cleanup(); } };
}
export type GuestApiFixture = Awaited<ReturnType<typeof guestApiFixture>>;
export async function unrelatedGuest(fixture: IsolatedTestDatabase) {
  return (await createPlanningSession(fixture.database)).credential;
}
