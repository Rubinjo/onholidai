// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Pool, type PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import { loadMigrationFiles, migrate } from "../../server/db/migrate";
import { decodeTripSnapshot } from "../../domain/trip/schema";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import {
  wholeTripReviewFixture,
  wholeTripTermsFixture,
  reviewNow,
} from "../fixtures/whole-trip-review";
import { bookingTermsV1Schema, hashBookingTerms } from "../../domain/booking/authorization";
import { seedReviewedWholeTrip } from "../helpers/booking";
import { authorizeBooking } from "../../domain/booking/authorize";
import { startBooking } from "../../domain/booking/start";
import { readBookingReview } from "../../domain/booking/revalidate";
import { createBookingActivities } from "../../server/workflows/book-activities";
import { TransactionProviderRegistry } from "../../server/supply/transactions";
import { BookingRepository } from "../../server/db/booking-repository";
import { inTransaction } from "../../server/db/transaction";
import {
  createIsolatedTestDatabase,
  hasIsolatedDatabaseConfiguration,
  type IsolatedTestDatabase,
} from "../helpers/database";

vi.mock("server-only", () => ({}));

describe("migration discovery", () => {
  it("rejects a gap before connecting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onholidai-migrations-"));
    try {
      await writeFile(join(directory, "002_gap.sql"), "SELECT 1;\n");
      await expect(loadMigrationFiles(directory)).rejects.toThrow("Expected migration version 1");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("keeps legacy snapshots readable while requiring explicit origin before new flight estimates", () => {
    const legacy = createSyntheticTripSnapshot();
    delete (legacy as Partial<typeof legacy>).departureOrigin;
    const decoded = decodeTripSnapshot(0, legacy);
    expect(decoded.compatibility).toBe("legacy");
    expect(decoded.requiresDepartureOrigin).toBe(true);
    expect(decoded.snapshot.destinations[0]?.name).toBe("Lisbon");
  });

  it("retains proposal and transaction basis migrations as additive schema history", async () => {
    const migrations = await loadMigrationFiles();
    expect(migrations.map((entry) => entry.version)).toEqual(
      migrations.map((_entry, index) => index + 1),
    );
    expect(migrations.find((entry) => entry.version === 7)?.sql).toContain("change_proposals");
    expect(migrations.find((entry) => entry.version === 8)?.sql).toContain(
      "execution_basis jsonb NOT NULL",
    );
    expect(migrations.find((entry) => entry.version === 8)?.sql).toContain(
      "booking_provider_callbacks",
    );
    expect(migrations.find((entry) => entry.version === 9)?.sql).toContain("privacy_legal_holds");
    expect(migrations.find((entry) => entry.version === 11)?.sql).toContain("planning_principals");
    expect(migrations.find((entry) => entry.version === 12)?.sql).toContain(
      "planning_access_revoked_at",
    );
    expect(migrations.find((entry) => entry.version === 13)?.sql).toContain("DEFAULT 'manual'");
    expect(migrations.find((entry) => entry.version === 13)?.sql).toContain(
      "run application policy is immutable",
    );
    expect(migrations.find((entry) => entry.version === 16)?.sql).toContain("provider_evidence");
    expect(migrations.find((entry) => entry.version === 17)?.sql).toContain(
      "outbox_booking_workflow_identity",
    );
  });
});

if (process.env.CI && !hasIsolatedDatabaseConfiguration()) {
  throw new Error("CI must provision isolated PostgreSQL test credentials");
}

describe.skipIf(!hasIsolatedDatabaseConfiguration())("PostgreSQL migration compatibility", () => {
  let fixture: IsolatedTestDatabase;
  let tripId: string;

  beforeEach(async () => {
    fixture = await createIsolatedTestDatabase();
    tripId = randomUUID();
    await query(fixture.connectionString, async (client) => {
      await client.query(`INSERT INTO app."user" (id, name, email)
        VALUES ('synthetic-owner', 'Synthetic owner', 'owner@example.invalid')`);
      await client.query(
        `INSERT INTO app.trips (id, owner_user_id, title, currency)
        VALUES ($1, 'synthetic-owner', 'Synthetic trip', 'GBP')`,
        [tripId],
      );
    });
  }, 30_000);

  afterEach(async () => {
    await fixture?.cleanup();
  });

  async function query<T>(url: string, action: (client: PoolClient) => Promise<T>): Promise<T> {
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      const client = await pool.connect();
      try {
        return await action(client);
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  }

  it.each([
    "booking.revalidation.requested",
    "booking.reschedule.revalidation.requested",
    "booking.transaction.requested",
  ])(
    "persists separate %s workflows at one trip version without permitting duplicate intents",
    async (eventType) => {
      const insert = (workflowId: string, type = eventType) =>
        fixture.database
          .insertInto("outboxEvents")
          .values({
            id: randomUUID(),
            eventType: type,
            eventVersion: 1,
            aggregateType: "trip",
            aggregateId: tripId,
            aggregateVersion: 1,
            payload: { workflowId },
            leaseExpiresAt: null,
            deliveredAt: null,
            lastErrorCategory: null,
          })
          .execute();
      await insert("recorded-workflow-one");
      await insert("recorded-workflow-two");
      await expect(insert("recorded-workflow-one")).rejects.toMatchObject({ code: "23505" });
      await insert("recorded-trip-one", "trip.version.committed");
      await expect(insert("recorded-trip-two", "trip.version.committed")).rejects.toMatchObject({
        code: "23505",
      });
      for (const workflowId of [null, 123, "", "   ", "x".repeat(257), undefined]) {
        await expect(
          fixture.database
            .insertInto("outboxEvents")
            .values({
              id: randomUUID(),
              eventType,
              eventVersion: 1,
              aggregateType: "trip",
              aggregateId: tripId,
              aggregateVersion: 1,
              payload: workflowId === undefined ? {} : { workflowId },
              leaseExpiresAt: null,
              deliveredAt: null,
              lastErrorCategory: null,
            })
            .execute(),
        ).rejects.toMatchObject({ code: "23514" });
      }
    },
  );

  async function insertVersion(inverse: unknown, reason: string | null, version = 1) {
    return query(fixture.connectionString, (client) =>
      client.query(
        `INSERT INTO app.trip_versions
      (trip_id, version, previous_version, schema_version, snapshot, initiating_actor,
       initiating_request_id, change_summary, inverse_operation, non_reversible_reason)
      VALUES ($1, $2, $3, 1, '{}', 'user', $4, '["created"]', $5::jsonb, $6)`,
        [
          tripId,
          version,
          version === 1 ? null : version - 1,
          randomUUID(),
          inverse === null ? null : JSON.stringify(inverse),
          reason,
        ],
      ),
    );
  }

  it("preserves legacy account IDs and enforces opaque guest ownership constraints", async () => {
    await query(fixture.connectionString, async (client) => {
      const principal = await client.query(
        "SELECT id, account_user_id FROM app.planning_principals WHERE id = 'synthetic-owner'",
      );
      expect(principal.rows).toEqual([
        { id: "synthetic-owner", account_user_id: "synthetic-owner" },
      ]);
      const sessionId = randomUUID();
      await expect(
        client.query(
          `INSERT INTO app.guest_planning_sessions
        (id, credential_digest, created_at, last_activity_at, expires_at)
        VALUES ($1, 'plaintext', now(), now(), now() + interval '30 days')`,
          [sessionId],
        ),
      ).rejects.toThrow();
      await client.query(
        `INSERT INTO app.guest_planning_sessions
        (id, credential_digest, created_at, last_activity_at, expires_at)
        VALUES ($1, $2, now(), now(), now() + interval '30 days')`,
        [sessionId, "a".repeat(64)],
      );
      await expect(
        client.query(
          `INSERT INTO app.planning_principals
        (id, account_user_id, guest_session_id, origin_kind, is_default)
        VALUES ($1, 'synthetic-owner', $2, 'guest', false)`,
          [randomUUID(), sessionId],
        ),
      ).rejects.toThrow();
    });
  });

  it("reruns safely and rejects changed applied migration checksums", async () => {
    await expect(migrate(fixture.migrationConnectionString)).resolves.toEqual([]);
    const directory = await mkdtemp(join(tmpdir(), "onholidai-migrations-"));
    try {
      const migrations = await loadMigrationFiles();
      for (const migration of migrations) {
        await writeFile(
          join(directory, migration.filename),
          migration.sql + (migration.version === 1 ? "\n-- changed applied history\n" : ""),
        );
      }
      await expect(migrate(fixture.migrationConnectionString, directory)).rejects.toThrow(
        "does not match",
      );
      await expect(migrate(fixture.migrationConnectionString)).resolves.toEqual([]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("stores fresh v2 metadata and prevents mutation of final review, authorization identity and execution basis", async () => {
    const seeded = await seedReviewedWholeTrip(fixture.database);
    const authorization = await authorizeBooking(
      fixture.database,
      seeded.userId,
      seeded.tripId,
      seeded.request,
      reviewNow,
      seeded.prerequisites,
    );
    const booking = await startBooking(
      fixture.database,
      seeded.userId,
      seeded.tripId,
      { requestId: randomUUID(), authorizationId: authorization.id },
      { now: reviewNow, prerequisites: seeded.prerequisites },
    );
    expect(
      await fixture.database
        .selectFrom("bookingAuthorizations")
        .select(["termsVersion", "continuationOf", "rootAttemptId"])
        .where("id", "=", authorization.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ termsVersion: 2, continuationOf: null, rootAttemptId: null });
    expect(
      await fixture.database
        .selectFrom("bookingTransactions")
        .select(["termsVersion", "continuationOf", "rootAttemptId"])
        .where("id", "=", booking.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ termsVersion: 2, continuationOf: null, rootAttemptId: null });
    await expect(
      fixture.database
        .updateTable("bookingRevalidations")
        .set({ termsHash: "f".repeat(64) })
        .where("workflowId", "=", seeded.workflowId)
        .execute(),
    ).rejects.toThrow("completed booking revalidation terms are immutable");
    await expect(
      fixture.database
        .updateTable("bookingAuthorizations")
        .set({ requestId: randomUUID() })
        .where("id", "=", authorization.id)
        .execute(),
    ).rejects.toThrow("booking authorization terms are immutable");
    await expect(
      fixture.database
        .updateTable("bookingTransactions")
        .set({ executionBasis: { ...booking.executionBasis, termsHash: "f".repeat(64) } })
        .where("id", "=", booking.id)
        .execute(),
    ).rejects.toThrow("booking execution basis is immutable");
  }, 30_000);

  it("binds immutable continuation lineage to a parent and root belonging to the same account and trip", async () => {
    const seed = await seedReviewedWholeTrip(fixture.database);
    const authorization = await authorizeBooking(
      fixture.database,
      seed.userId,
      seed.tripId,
      seed.request,
      reviewNow,
      seed.prerequisites,
    );
    const started = await startBooking(
      fixture.database,
      seed.userId,
      seed.tripId,
      {
        requestId: randomUUID(),
        authorizationId: authorization.id,
      },
      { prerequisites: seed.prerequisites, now: reviewNow },
    );
    const other = await seedReviewedWholeTrip(fixture.database);
    const otherAuthorization = await authorizeBooking(
      fixture.database,
      other.userId,
      other.tripId,
      other.request,
      reviewNow,
      other.prerequisites,
    );
    const otherAttempt = await startBooking(
      fixture.database,
      other.userId,
      other.tripId,
      {
        requestId: randomUUID(),
        authorizationId: otherAuthorization.id,
      },
      { prerequisites: other.prerequisites, now: reviewNow },
    );
    const save = (parentId: string, rootId: string) =>
      inTransaction(fixture.database, async (transaction) => {
        const terms = { ...seed.terms, continuationOf: parentId, rootAttemptId: rootId };
        await new BookingRepository(transaction).insertAuthorization(
          {
            id: randomUUID(),
            tripId: seed.tripId,
            userId: seed.userId,
            tripVersion: seed.tripVersion,
            operation: "book_trip",
            componentId: null,
            terms,
            termsHash: hashBookingTerms(terms),
            acknowledgedNonReversibleActions: [],
            status: "authorized",
            reason: null,
            authorizedAt: reviewNow.toISOString(),
            expiresAt: started.executionBasis.expiresAt,
          },
          { requestId: randomUUID(), requestFingerprint: "e".repeat(64) },
        );
      });
    await expect(save(otherAttempt.id, otherAttempt.id)).rejects.toThrow("lineage is invalid");
    await expect(save(started.id, otherAttempt.id)).rejects.toThrow("lineage is invalid");
    await expect(save(started.id, started.id)).resolves.toBeUndefined();
  }, 30_000);

  it("upgrades migration 014 v1 authorization, confirmation and reconciliation evidence without rehashing it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onholidai-pre-whole-trip-"));
    let prior: IsolatedTestDatabase | undefined;
    try {
      for (const migration of (await loadMigrationFiles()).filter((entry) => entry.version < 15))
        await writeFile(join(directory, migration.filename), migration.sql);
      prior = await createIsolatedTestDatabase({ migrationsDirectory: directory });
      const recorded = wholeTripReviewFixture(),
        raw = wholeTripTermsFixture(recorded);
      const terms = bookingTermsV1Schema.parse({
        departureOrigin: raw.departureOrigin,
        travellerParty: raw.travellerParty,
        components: raw.components.map((entry) => ({
          componentId: entry.componentId,
          supplierOfferId: entry.supplierOfferId,
          inventoryId: entry.inventoryId,
          serviceStart: entry.serviceStart,
          serviceEnd: entry.serviceEnd,
          travellerIds: entry.travellerIds,
          finalCustomerMinor: entry.finalCustomerMinor,
          taxesMinor: entry.taxesMinor,
          feesMinor: entry.feesMinor,
          currency: entry.currency,
          cancellationTerms: entry.cancellationTerms,
          expiresAt: entry.expiresAt,
          nonReversible: false,
        })),
        totalPrice: raw.totalPrice,
        nonReversibleActions: [],
      });

      const hash = hashBookingTerms(terms),
        authorizationId = randomUUID(),
        transactionId = randomUUID();
      const basis = {
        ownerUserId: "synthetic-owner",
        operation: "book_trip",
        authorizationId,
        startingTripVersion: 1,
        terms,
        termsHash: hash,
        expiresAt: terms.components[0].expiresAt,
      };
      await query(prior.connectionString, async (client) => {
        await client.query(
          `INSERT INTO app."user" (id,name,email) VALUES ('synthetic-owner','Recorded owner','recorded@example.invalid')`,
        );
        await client.query(
          `INSERT INTO app.trips (id,owner_user_id,title,currency) VALUES ($1,'synthetic-owner','Recorded v1','GBP')`,
          [tripId],
        );
        await client.query(
          `INSERT INTO app.trip_versions
          (trip_id,version,schema_version,snapshot,initiating_actor,initiating_request_id,change_summary,non_reversible_reason)
          VALUES ($1,1,1,$2::jsonb,'user',$3,'["historical"]','Historical creation')`,
          [tripId, JSON.stringify(recorded.snapshot), randomUUID()],
        );
        await client.query(
          `INSERT INTO app.booking_authorizations
          (id,trip_id,owner_user_id,trip_version,operation,terms,terms_hash,status,authorized_at,expires_at)
          VALUES ($1,$2,'synthetic-owner',1,'book_trip',$3::jsonb,$4,'consumed',$5,$6)`,
          [
            authorizationId,
            tripId,
            JSON.stringify(terms),
            hash,
            reviewNow,
            terms.components[0].expiresAt,
          ],
        );
        await client.query(
          `INSERT INTO app.booking_transactions
          (id,trip_id,owner_user_id,authorization_id,operation,workflow_id,request_id,status,components,execution_basis,last_observed_trip_version,execution_status)
          VALUES ($1,$2,'synthetic-owner',$3,'book_trip',$4,$5,'requested',$6::jsonb,$7::jsonb,1,'active')`,
          [
            transactionId,
            tripId,
            authorizationId,
            `historical-${transactionId}`,
            randomUUID(),
            JSON.stringify(
              terms.components.map((entry) => ({
                componentId: entry.componentId,
                status: "authorized",
                providerReference: null,
                safeReason: null,
              })),
            ),
            JSON.stringify(basis),
          ],
        );
        await client.query(
          `INSERT INTO app.booking_confirmations
          (id,transaction_id,trip_id,component_id,provider_reference,terms,confirmed_at)
          VALUES ($1,$2,$3,$4,'recorded-confirmation',$5::jsonb,$6)`,
          [
            randomUUID(),
            transactionId,
            tripId,
            terms.components[0].componentId,
            JSON.stringify(terms.components[0]),
            reviewNow,
          ],
        );
      });
      await expect(migrate(prior.migrationConnectionString)).resolves.toEqual([
        "015_whole_trip_terms.sql",
        "016_booking_attempt_guards.sql",
        "017_booking_outbox_intents.sql",
      ]);
      const saved = await prior.database
        .selectFrom("bookingAuthorizations")
        .selectAll()
        .where("id", "=", authorizationId)
        .executeTakeFirstOrThrow();
      expect(saved.termsVersion).toBe(1);
      expect(saved.requestId).toBeNull();
      expect(saved.terms).toEqual(terms);
      expect(saved.termsHash).toBe(hash);
      expect(hashBookingTerms(bookingTermsV1Schema.parse(saved.terms))).toBe(hash);
      expect(
        (
          await prior.database
            .selectFrom("bookingTransactions")
            .select("executionBasis")
            .where("id", "=", transactionId)
            .executeTakeFirstOrThrow()
        ).executionBasis,
      ).toEqual(basis);
      const providers = new TransactionProviderRegistry(),
        execute = vi.fn();
      providers.register({
        provider: "duffel",
        capabilities: {
          book: false,
          status: true,
          cancel: false,
          reschedule: false,
          idempotency: true,
        },
        execute,
        getStatus: async () => ({
          status: "confirmed",
          providerReference: "recorded-confirmation",
          evidenceId: "recorded-status",
          confirmedTerms: terms.components[0],
        }),
      });
      expect(
        await createBookingActivities(prior.database, providers).reconcileProviderStatus(
          transactionId,
          terms.components[0].componentId,
        ),
      ).toMatchObject({ status: "confirmed", providerReference: "recorded-confirmation" });
      const safe = await readBookingReview(prior.database, "synthetic-owner", tripId, reviewNow);
      expect(safe.latestAttempt?.termsVersion).toBe(1);
      expect(safe.confirmedCommitments).toHaveLength(1);
      expect(execute).not.toHaveBeenCalled();
      expect(await migrate(prior.migrationConnectionString)).toEqual([]);
    } finally {
      await prior?.cleanup();
      await rm(directory, { force: true, recursive: true });
    }
  }, 30_000);

  it("upgrades valid historical evidence without rewriting snapshots", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onholidai-prior-migrations-"));
    let prior: IsolatedTestDatabase | undefined;
    try {
      const migrations = await loadMigrationFiles();
      for (const migration of migrations.filter((item) => item.version < 3)) {
        await writeFile(join(directory, migration.filename), migration.sql);
      }
      prior = await createIsolatedTestDatabase({ migrationsDirectory: directory });
      await query(prior.connectionString, async (client) => {
        await client.query(`INSERT INTO app."user" (id, name, email)
          VALUES ('synthetic-owner', 'Synthetic owner', 'owner@example.invalid')`);
        await client.query(
          `INSERT INTO app.trips (id, owner_user_id, title, currency)
          VALUES ($1, 'synthetic-owner', 'Historical synthetic trip', 'GBP')`,
          [tripId],
        );
        await client.query(
          `INSERT INTO app.trip_versions
          (trip_id, version, schema_version, snapshot, initiating_actor,
           initiating_request_id, change_summary, non_reversible_reason)
          VALUES ($1, 1, 1, '{"historical":true}', 'user', $2, '["created"]', 'Initial creation')`,
          [tripId, randomUUID()],
        );
      });
      const before = await prior.database.selectFrom("tripVersions").selectAll().execute();
      const pending = (await loadMigrationFiles())
        .filter((item) => item.version >= 3)
        .map((item) => item.filename);
      await expect(migrate(prior.migrationConnectionString)).resolves.toEqual(pending);
      expect(await prior.database.selectFrom("tripVersions").selectAll().execute()).toEqual(before);
    } finally {
      await prior?.cleanup();
      await rm(directory, { force: true, recursive: true });
    }
  }, 30_000);

  it("fails the corrective migration atomically for missing historical evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onholidai-prior-migrations-"));
    let prior: IsolatedTestDatabase | undefined;
    try {
      for (const migration of (await loadMigrationFiles()).filter((item) => item.version < 3)) {
        await writeFile(join(directory, migration.filename), migration.sql);
      }
      prior = await createIsolatedTestDatabase({ migrationsDirectory: directory });
      await query(prior.connectionString, async (client) => {
        await client.query(`INSERT INTO app."user" (id, name, email)
          VALUES ('synthetic-owner', 'Synthetic owner', 'owner@example.invalid')`);
        await client.query(
          `INSERT INTO app.trips (id, owner_user_id, title, currency)
          VALUES ($1, 'synthetic-owner', 'Historical synthetic trip', 'GBP')`,
          [tripId],
        );
        // Migration 002 permits this through SQL's three-valued CHECK logic.
        await client.query(
          `INSERT INTO app.trip_versions
          (trip_id, version, schema_version, snapshot, initiating_actor,
           initiating_request_id, change_summary)
          VALUES ($1, 1, 1, '{}', 'user', $2, '["created"]')`,
          [tripId, randomUUID()],
        );
      });
      const before = await prior.database.selectFrom("tripVersions").selectAll().execute();
      await expect(migrate(prior.migrationConnectionString)).rejects.toMatchObject({
        code: "23514",
      });
      expect(await prior.database.selectFrom("tripVersions").selectAll().execute()).toEqual(before);
      await query(prior.migrationConnectionString, async (client) => {
        const history = await client.query<{ version: number }>(
          "SELECT version FROM onholidai_migrations.applied_migrations ORDER BY version",
        );
        expect(history.rows).toEqual([{ version: 1 }, { version: 2 }]);
      });
    } finally {
      await prior?.cleanup();
      await rm(directory, { force: true, recursive: true });
    }
  }, 30_000);

  it("round-trips SRID 4326 spatial data and rejects incorrect SRIDs", async () => {
    await query(fixture.connectionString, async (client) => {
      await client.query(
        `INSERT INTO app.spatial_places (entity_type, entity_id, location)
        VALUES ('synthetic', $1, ST_GeogFromText('SRID=4326;POINT(-9.1393 38.7223)'))`,
        [tripId],
      );
      const place = await client.query<{ srid: number }>(
        "SELECT ST_SRID(location::geometry) AS srid FROM app.spatial_places",
      );
      expect(place.rows).toEqual([{ srid: 4326 }]);
      await expect(
        client.query(
          `INSERT INTO app.spatial_places (entity_type, entity_id, location)
        VALUES ('wrong-srid', $1, ST_SetSRID(ST_Point(0, 0), 3857)::geography)`,
          [tripId],
        ),
      ).rejects.toThrow();
      const indexes = await client.query<{ count: string }>(`SELECT count(*) FROM pg_indexes
        WHERE schemaname = 'app' AND tablename IN ('spatial_places', 'spatial_routes')
        AND indexdef ILIKE '%USING gist%'`);
      expect(indexes.rows[0]?.count).toBe("2");
    });
  });

  it.each([
    [null, null],
    [null, ""],
    [null, " \t\n"],
    [{ operation: "replace", target: "/preferences/pace", value: 50 }, "Both present"],
    [[], null],
    [{}, null],
    [{ operation: "book", target: "/components", value: null }, null],
    [{ operation: "replace", target: "/forbidden", value: null }, null],
    [{ operation: "replace", target: null, value: null }, null],
    [{ operation: "replace", target: "/preferences", value: null, extra: true }, null],
  ])("rejects invalid reversibility evidence %#", async (inverse, reason) => {
    await expect(insertVersion(inverse, reason as string | null)).rejects.toMatchObject({
      code: "23514",
      constraint: "trip_versions_reversibility_evidence",
    });
    const count = await fixture.database
      .selectFrom("tripVersions")
      .select((builder) => builder.fn.countAll().as("count"))
      .executeTakeFirstOrThrow();
    expect(Number(count.count)).toBe(0);
  });

  it("accepts either a valid inverse or a disclosed reason", async () => {
    await insertVersion(null, "Initial creation");
    await insertVersion({ operation: "replace", target: "/preferences/pace", value: 50 }, null, 2);
    expect(
      await fixture.database
        .selectFrom("tripVersions")
        .select("version")
        .orderBy("version")
        .execute(),
    ).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it("enforces lifecycle and immutable idempotency identity at the SQL boundary", async () => {
    await query(fixture.connectionString, async (client) => {
      await expect(
        client.query("UPDATE app.trips SET lifecycle_state = 'invented' WHERE id = $1", [tripId]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          `INSERT INTO app.idempotency_records
        (scope, idempotency_key, request_fingerprint, state, expires_at)
        VALUES ('synthetic', 'invalid', $1, 'invented', now() + interval '1 day')`,
          ["a".repeat(64)],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query(
        `INSERT INTO app.idempotency_records
        (scope, idempotency_key, request_fingerprint, state, expires_at)
        VALUES ('synthetic', 'valid', $1, 'in_progress', now() + interval '1 day')`,
        ["a".repeat(64)],
      );
      await expect(
        client.query(
          `UPDATE app.idempotency_records SET request_fingerprint = $1
        WHERE scope = 'synthetic'`,
          ["b".repeat(64)],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        client.query(`UPDATE app.idempotency_records SET state = 'completed'
        WHERE scope = 'synthetic'`),
      ).rejects.toMatchObject({ code: "23514" });
      const identity = await client.query<{ state: string; request_fingerprint: string }>(
        "SELECT state, request_fingerprint FROM app.idempotency_records WHERE scope = 'synthetic'",
      );
      expect(identity.rows).toEqual([
        { state: "in_progress", request_fingerprint: "a".repeat(64) },
      ]);
    });
  });

  it("protects immutable history and audit even from the migration owner", async () => {
    await insertVersion(null, "Initial creation");
    await query(fixture.connectionString, (client) =>
      client.query(
        `INSERT INTO app.audit_events
      (id, actor_type, actor_id, action, target_type, target_id, request_id, outcome)
      VALUES ($1, 'user', 'synthetic-owner', 'synthetic.test', 'trip', $2, $3, 'succeeded')`,
        [randomUUID(), tripId, randomUUID()],
      ),
    );
    for (const table of ["trip_versions", "audit_events"]) {
      const assignment = table === "trip_versions" ? "schema_version = 2" : "outcome = 'failed'";
      for (const statement of [
        `UPDATE app.${table} SET ${assignment}`,
        `DELETE FROM app.${table}`,
      ]) {
        await expect(
          query(fixture.migrationConnectionString, (client) => client.query(statement)),
        ).rejects.toMatchObject({ code: "55000" });
      }
    }
  });

  it("isolates nonprivileged web/worker roles from migrations and public access", async () => {
    for (const url of [fixture.connectionString, fixture.workerConnectionString]) {
      await query(url, async (client) => {
        const role = await client.query<{ rolsuper: boolean; rolcreatedb: boolean }>(
          "SELECT rolsuper, rolcreatedb FROM pg_roles WHERE rolname = current_user",
        );
        expect(role.rows[0]).toEqual({ rolsuper: false, rolcreatedb: false });
        await client.query("SELECT * FROM app.trips");
        await expect(client.query("CREATE TABLE app.forbidden (id integer)")).rejects.toMatchObject(
          { code: "42501" },
        );
        await expect(
          client.query("SELECT * FROM onholidai_migrations.applied_migrations"),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(client.query("DELETE FROM app.trip_versions")).rejects.toMatchObject({
          code: "42501",
        });
      });
      await expect(migrate(url)).rejects.toThrow("Migrations must run as onholidai_migration");
    }
    await query(fixture.adminConnectionString, async (client) => {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL ROLE onholidai_test_untrusted");
        await expect(client.query("SELECT * FROM app.trips")).rejects.toMatchObject({
          code: "42501",
        });
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });
});
