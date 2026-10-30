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
import { reviewNow } from "../fixtures/whole-trip-review";
import { hashBookingTerms } from "../../domain/booking/authorization";
import { seedReviewedWholeTrip } from "../helpers/booking";
import { authorizeBooking } from "../../domain/booking/authorize";
import { startBooking } from "../../domain/booking/start";
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

  it("checksums migrations independently of checkout line endings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onholidai-migrations-"));
    try {
      await writeFile(join(directory, "001_lf.sql"), "SELECT 1;\nSELECT 2;\n");
      await writeFile(join(directory, "002_crlf.sql"), "SELECT 1;\r\nSELECT 2;\r\n");
      const migrations = await loadMigrationFiles(directory);
      expect(migrations[0]?.checksum).toBe(migrations[1]?.checksum);
      expect(migrations[0]?.legacyChecksums).toEqual([]);
      // History written before checksums were normalised recorded the CRLF bytes.
      expect(migrations[1]?.legacyChecksums).toHaveLength(1);
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

  it("contains one consolidated clean-start schema baseline", async () => {
    const migrations = await loadMigrationFiles();
    expect(migrations.map((entry) => entry.filename)).toEqual(["001_initial_schema.sql"]);
    const sql = migrations[0]?.sql ?? "";
    for (const statement of [
      "CREATE TABLE app.change_proposals",
      "execution_basis jsonb NOT NULL",
      "booking_provider_callbacks",
      "privacy_legal_holds",
      "planning_principals",
      "planning_access_revoked_at",
      "DEFAULT 'manual'",
      "run application policy is immutable",
      "provider_evidence",
      "outbox_booking_workflow_identity",
    ]) {
      expect(sql).toContain(statement);
    }
  });
});

if (process.env.CI && !hasIsolatedDatabaseConfiguration()) {
  throw new Error("CI must provision isolated PostgreSQL test credentials");
}

describe.skipIf(!hasIsolatedDatabaseConfiguration())("PostgreSQL database schema", () => {
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

  it("rejects changed baseline SQL", async () => {
    await expect(migrate(fixture.migrationConnectionString)).resolves.toEqual([]);
    const directory = await mkdtemp(join(tmpdir(), "onholidai-migrations-"));
    try {
      const migrations = await loadMigrationFiles();
      for (const migration of migrations) {
        await writeFile(
          join(directory, migration.filename),
          migration.sql + "\n-- changed applied history\n",
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

  it("rejects databases recorded under the previous migration history", async () => {
    const admin = new Pool({ connectionString: fixture.adminConnectionString, max: 1 });
    try {
      await admin.query(
        `UPDATE onholidai_migrations.applied_migrations
         SET name = '001_foundation'
         WHERE version = 1`,
      );
    } finally {
      await admin.end();
    }
    await expect(migrate(fixture.migrationConnectionString)).rejects.toThrow("does not match");
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
