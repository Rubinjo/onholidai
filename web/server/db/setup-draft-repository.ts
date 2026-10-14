import { createHash, randomUUID } from "node:crypto";
import type { Kysely, Selectable } from "kysely";
import { z } from "zod";
import { emptySetupDraft } from "@/components/trip-setup/draft-schema";
import { canonicalJson } from "@/domain/trip/commit";
import { createTrip } from "@/domain/trip/create";
import { resolvePlanningActor, planningNotFound, type PlanningIdentity } from "@/server/auth/planning-actor";
import { validPlanningSession } from "@/server/auth/planning-session";
import { planningProblems } from "@/server/errors";
import type { Database } from "./database";
import type { SetupDraftTable } from "./types";
import { allocateWizardPrincipal, defaultAccountPrincipal } from "./planning-principal-repository";
import { IdempotencyRepository } from "./idempotency-repository";
import { lockPlanningAccess, lockSetupDraft } from "./planning-access";
import { saveSetupDraftSchema, setupDraftEnvelopeSchema, submitSetupDraftSchema } from "./planning-schema";
import { inTransaction } from "./transaction";

function envelope(row: Selectable<SetupDraftTable>) {
  return setupDraftEnvelopeSchema.parse({ draftId: row.id, revision: row.revision, currentStep: row.currentStep,
    payload: row.payload, submittedTripId: row.submittedTripId, updatedAt: row.updatedAt.toISOString() });
}
const fingerprint = (input: unknown) => createHash("sha256").update(canonicalJson(input)).digest("hex");
export class SetupDraftRepository {
  constructor(private readonly database: Kysely<Database>, private readonly identity: PlanningIdentity,
    private readonly now: () => Date = () => new Date()) {}
  async allocate(requestId: string) {
    z.uuid().parse(requestId);
    return inTransaction(this.database, async (transaction) => {
      const authority = this.identity.accountUserId
        ? { accountUserId: this.identity.accountUserId, guestSessionId: null }
        : { accountUserId: null, guestSessionId: this.identity.guestSessionId };
      if (!authority.accountUserId && !authority.guestSessionId) throw planningProblems.guestSessionUnavailable();
      if (authority.guestSessionId) {
        const session = await transaction.selectFrom("guestPlanningSessions").selectAll()
          .where("id", "=", authority.guestSessionId).forUpdate().executeTakeFirst();
        if (!session || !validPlanningSession(session, this.now())) throw planningProblems.guestSessionUnavailable();
      } else {
        const id = await defaultAccountPrincipal(transaction, authority.accountUserId!);
        await transaction.selectFrom("planningPrincipals").select("id").where("id", "=", id).forUpdate().executeTakeFirstOrThrow();
      }
      const scope = `setup:allocate:${authority.accountUserId ? "account" : "guest"}:${authority.accountUserId ?? authority.guestSessionId}`;
      const receipts = new IdempotencyRepository(transaction), hash = fingerprint({ requestId });
      const claim = await receipts.claim({ scope, key: requestId, requestFingerprint: hash,
        expiresAt: new Date(this.now().getTime() + 30 * 86400000) });
      if (claim.kind === "replay") {
        const draftId = z.uuid().parse(claim.result.draftId);
        return { draft: await new SetupDraftRepository(transaction, this.identity, this.now).read(draftId), replayed: true };
      }
      const owner = await allocateWizardPrincipal(transaction, authority), now = this.now();
      const row = await transaction.insertInto("setupDrafts").values({ id: randomUUID(), planningOwnerId: owner,
        revision: 1, currentStep: "destinations", payload: emptySetupDraft(), schemaVersion: 1,
        creationRequestId: randomUUID(), researchRequestId: randomUUID(), submittedTripId: null,
        createdAt: now, updatedAt: now }).returningAll().executeTakeFirstOrThrow();
      await receipts.complete(scope, requestId, hash, { draftId: row.id });
      return { draft: envelope(row), replayed: false };
    });
  }
  private async access(draftId: string) {
    z.uuid().parse(draftId);
    const reference = await this.database.selectFrom("setupDrafts").select("planningOwnerId").where("id", "=", draftId).executeTakeFirst();
    if (!reference) planningNotFound();
    return resolvePlanningActor(this.database, reference.planningOwnerId, this.identity);
  }
  async read(draftId: string) {
    const actor = await this.access(draftId);
    return inTransaction(this.database, async (transaction) => {
      await lockPlanningAccess(transaction, actor, this.now());
      return envelope(await lockSetupDraft(transaction, actor.planningOwnerId, draftId));
    });
  }
  async save(draftId: string, raw: unknown) {
    const actor = await this.access(draftId), input = saveSetupDraftSchema.parse(raw);
    return inTransaction(this.database, async (transaction) => {
      await lockPlanningAccess(transaction, actor, this.now());
      const draft = await lockSetupDraft(transaction, actor.planningOwnerId, draftId);
      const receipts = new IdempotencyRepository(transaction), hash = fingerprint(input), scope = `setup:${draftId}:save`;
      const claim = await receipts.claim({ scope, key: input.requestId, requestFingerprint: hash,
        expiresAt: new Date(this.now().getTime() + 30 * 86400000) });
      if (claim.kind === "replay") return setupDraftEnvelopeSchema.parse(claim.result);
      if (draft.submittedTripId) throw planningProblems.draftAlreadySubmitted(draft.submittedTripId);
      if (draft.revision !== input.expectedRevision) throw planningProblems.draftRevisionConflict(draft.revision);
      const saved = envelope(await transaction.updateTable("setupDrafts").set({ payload: input.payload,
        currentStep: input.currentStep, revision: draft.revision + 1, updatedAt: this.now() })
        .where("id", "=", draftId).returningAll().executeTakeFirstOrThrow());
      await receipts.complete(scope, input.requestId, hash, saved);
      return saved;
    });
  }
  async submit(draftId: string, raw: unknown) {
    const actor = await this.access(draftId), input = submitSetupDraftSchema.parse(raw);
    return inTransaction(this.database, async (transaction) => {
      await lockPlanningAccess(transaction, actor, this.now());
      const draft = await lockSetupDraft(transaction, actor.planningOwnerId, draftId);
      if (draft.submittedTripId) return { tripId: draft.submittedTripId, version: 1,
        researchRequestId: draft.researchRequestId, nextPath: `/trips/${draft.submittedTripId}`, replayed: true };
      if (draft.revision !== input.expectedRevision) throw planningProblems.draftRevisionConflict(draft.revision);
      const { title, currency, ...facts } = draft.payload;
      const trip = await createTrip(transaction, actor.planningOwnerId, { requestId: draft.creationRequestId, title, currency,
        snapshot: { ...facts, itineraryDays: [], components: [], warnings: [], price: { currency,
          finalCustomerMinor: 0, taxesMinor: 0, feesMinor: 0, status: "estimated", checkedAt: this.now().toISOString() } } });
      await transaction.updateTable("setupDrafts").set({ submittedTripId: trip.tripId,
        revision: draft.revision + 1, updatedAt: this.now() }).where("id", "=", draftId).execute();
      return { tripId: trip.tripId, version: trip.version, researchRequestId: draft.researchRequestId,
        nextPath: `/trips/${trip.tripId}`, replayed: false };
    });
  }
}
