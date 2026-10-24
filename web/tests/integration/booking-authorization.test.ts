// @vitest-environment node
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";
import { sql } from "kysely";

import { TransactionProviderRegistry } from "../../server/supply/transactions";
import { withEphemeralPaymentToken } from "../../server/supply/payment";
import {
  assertAuthorizationTerms,
  bookingTermsSchema,
  hashBookingTerms,
} from "../../domain/booking/authorization";
import { startBooking } from "../../domain/booking/start";
import { authorizeBooking } from "../../domain/booking/authorize";
import { startBookingRevalidation } from "../../domain/booking/revalidate";
import { readBookingReview } from "../../domain/booking/revalidate";
import { applyBookingOutcome } from "../../domain/booking/apply-outcomes";
import { commitTripMutation } from "../../domain/trip/commit";
import { seedAuthorizedBooking, seedReviewedWholeTrip } from "../helpers/booking";
import { reviewNow } from "../fixtures/whole-trip-review";
import { createBookingActivities } from "../../server/workflows/book-activities";
import { createRevalidationActivities } from "../../server/workflows/revalidate-activities";
import { hasIsolatedDatabaseConfiguration, withIsolatedTestDatabase } from "../helpers/database";
import { readTrustedBookingPrerequisites } from "../../server/supply/payment";
import { bookingTermsV2Schema } from "../../domain/booking/authorization";
import { BookingRepository } from "../../server/db/booking-repository";
import { inTransaction } from "../../server/db/transaction";

vi.mock("server-only", () => ({}));
vi.mock("../../server/workflows/client", () => ({ startWorkflow: vi.fn(async () => undefined) }));

const describeWithDatabase = hasIsolatedDatabaseConfiguration() ? describe : describe.skip;

describe("booking execution boundary", () => {
  it("does not expose unconfigured provider writes as supported capabilities", () => {
    const providers = new TransactionProviderRegistry();
    expect(() => providers.require("duffel", "book_trip")).toThrow(/not configured/);
  });

  it("clears the in-memory token buffer after provider use", async () => {
    const token = new Uint8Array(32).fill(7);
    await withEphemeralPaymentToken(token, async (active) =>
      expect(active.some((byte) => byte !== 0)).toBe(true),
    );
    expect(token.every((byte) => byte === 0)).toBe(true);
  });
  it("erases invalid ephemeral tokens and bounds an unresponsive trusted source", async () => {
    const token = new Uint8Array(3).fill(7);
    await expect(withEphemeralPaymentToken(token, async () => undefined)).rejects.toThrow(
      "Invalid ephemeral",
    );
    expect([...token]).toEqual([0, 0, 0]);
    const abort = new AbortController();
    const pending = readTrustedBookingPrerequisites(
      { read: () => new Promise(() => undefined) },
      {
        ownerUserId: "recorded",
        tripId: crypto.randomUUID(),
        tripVersion: 2,
        componentId: crypto.randomUUID(),
        provider: "nuitee",
        inventoryId: "recorded",
        travellerIds: [],
      },
      abort.signal,
    );
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: "booking_prerequisites_unavailable" });
  });
});

describeWithDatabase("whole-trip continuation authority", () => {
  it("allows fresh review after an expired undispatched claim without treating a local stop as a supplier commitment", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedAuthorizedBooking(database);
      const activities = createBookingActivities(database, new TransactionProviderRegistry());
      const componentId = seeded.transaction!.components[0].componentId;
      const claim = await activities.claimProviderWrite(seeded.transaction!.id, componentId);
      expect(claim.allowed).toBe(true);
      await database
        .updateTable("bookingTransactions")
        .set({
          executionStatus: "expired",
        })
        .where("id", "=", seeded.transaction!.id)
        .execute();
      await activities.recordBookingOutcome(seeded.transaction!.id, {
        componentId,
        status: "action_required",
        providerReference: null,
        safeReason: "Authorization expired before dispatch.",
      });
      const trip = await database
        .selectFrom("trips")
        .select("currentVersion")
        .where("id", "=", seeded.tripId)
        .executeTakeFirstOrThrow();
      const version = await database
        .selectFrom("tripVersions")
        .select("snapshot")
        .where("tripId", "=", seeded.tripId)
        .where("version", "=", trip.currentVersion)
        .executeTakeFirstOrThrow();
      expect(
        version.snapshot.components.find((component) => component.id === componentId)
          ?.bookingStatus,
      ).toBe("unbooked");
      expect(
        await database
          .selectFrom("bookingWriteClaims")
          .select("attemptId")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toEqual([]);
      const request = { requestId: crypto.randomUUID(), expectedVersion: trip.currentVersion };
      await expect(
        startBookingRevalidation(database, seeded.userId, seeded.tripId, request),
      ).resolves.toMatchObject({ status: "accepted" });
      const attempt = await activities.loadBookingTransaction(seeded.transaction!.id);
      expect(attempt.components[0].status).toBe("action_required");
    });
  }, 30_000);

  it.each(["failed", "unknown"] as const)(
    "projects an authenticated %s booking outcome without losing its durable recovery meaning",
    async (status) => {
      await withIsolatedTestDatabase(async ({ database }) => {
        const seeded = await seedAuthorizedBooking(database);
        const providers = new TransactionProviderRegistry();
        providers.register({
          provider: "duffel",
          capabilities: {
            book: true,
            status: false,
            cancel: false,
            reschedule: false,
            idempotency: false,
          },
          execute: async () => ({ status, safeReason: "Recorded provider outcome." }),
        });
        const activities = createBookingActivities(database, providers);
        const componentId = seeded.transaction!.components[0].componentId;
        const claim = await activities.claimProviderWrite(seeded.transaction!.id, componentId);
        await activities.executeProviderWrite(
          seeded.transaction!.id,
          componentId,
          claim.idempotencyKey,
          claim.requestFingerprint,
        );
        const trip = await database
          .selectFrom("trips")
          .select("currentVersion")
          .where("id", "=", seeded.tripId)
          .executeTakeFirstOrThrow();
        const version = await database
          .selectFrom("tripVersions")
          .select("snapshot")
          .where("tripId", "=", seeded.tripId)
          .where("version", "=", trip.currentVersion)
          .executeTakeFirstOrThrow();
        expect(
          version.snapshot.components.find((component) => component.id === componentId)
            ?.bookingStatus,
        ).toBe(status === "failed" ? "unbooked" : "unknown");
        const booking = await activities.loadBookingTransaction(seeded.transaction!.id);
        expect(
          booking.components.find((component) => component.componentId === componentId)?.status,
        ).toBe(status);
        const claims = await database
          .selectFrom("bookingWriteClaims")
          .select("attemptId")
          .where("tripId", "=", seeded.tripId)
          .execute();
        expect(claims).toHaveLength(status === "failed" ? 0 : 1);
      });
    },
    30_000,
  );

  it("derives parent/root from durable history and authorizes only the complete remainder", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const now = new Date();
      const seeded = await seedReviewedWholeTrip(database, undefined, "completed", undefined, now);
      const authorization = await authorizeBooking(
        database,
        seeded.userId,
        seeded.tripId,
        seeded.request,
        now,
        seeded.prerequisites,
      );
      const parent = await startBooking(
        database,
        seeded.userId,
        seeded.tripId,
        {
          requestId: crypto.randomUUID(),
          authorizationId: authorization.id,
        },
        { now, prerequisites: seeded.prerequisites },
      );
      const commitment = seeded.terms.components[0];
      await database
        .insertInto("bookingConfirmations")
        .values({
          id: crypto.randomUUID(),
          transactionId: parent.id,
          tripId: seeded.tripId,
          componentId: commitment.componentId,
          providerReference: "recorded-existing-flight",
          terms: commitment,
          confirmedAt: now,
        })
        .execute();
      await applyBookingOutcome(
        database,
        parent.id,
        {
          componentId: commitment.componentId,
          status: "confirmed",
          providerReference: "recorded-existing-flight",
          safeReason: null,
        },
        now,
      );
      const execute = vi.fn();
      const revalidated: string[] = [];
      const providers = new TransactionProviderRegistry();
      for (const provider of ["duffel", "nuitee", "viator"] as const) {
        providers.register({
          provider,
          capabilities: {
            book: true,
            status: true,
            cancel: false,
            reschedule: false,
            idempotency: false,
            revalidation: "read_only_final_terms",
          },
          execute,
          revalidate: async ({ componentId }) => {
            revalidated.push(componentId);
            return {
              outcome: "unchanged",
              terms: structuredClone(
                seeded.terms.components.find((component) => component.componentId === componentId)!,
              ),
            };
          },
        });
      }
      const review = await startBookingRevalidation(database, seeded.userId, seeded.tripId, {
        requestId: crypto.randomUUID(),
        expectedVersion: 3,
      });
      const result = await createRevalidationActivities(database, providers, {
        prerequisites: seeded.prerequisites,
        now: () => now,
      }).revalidateBooking({
        workflowId: review.workflowId,
        tripId: seeded.tripId,
        ownerUserId: seeded.userId,
        tripVersion: 3,
      });
      expect(result.status).toBe("completed");
      const terms = bookingTermsV2Schema.parse(result.terms);
      expect(terms.continuationOf).toBe(parent.id);
      expect(terms.rootAttemptId).toBe(parent.id);
      expect(terms.totalPrice.minorUnits).toBe(30000);
      expect(terms.coverage.toBookComponentIds).not.toContain(commitment.componentId);
      expect(revalidated).not.toContain(commitment.componentId);
      expect(revalidated).toHaveLength(3);
      const input = {
        ...seeded.request,
        requestId: crypto.randomUUID(),
        tripVersion: 3,
        termsHash: result.termsHash,
      };
      const consents = await Promise.all(
        [
          input,
          {
            ...input,
            requestId: crypto.randomUUID(),
          },
        ].map((request) =>
          authorizeBooking(
            database,
            seeded.userId,
            seeded.tripId,
            request,
            now,
            seeded.prerequisites,
          ),
        ),
      );
      const starts = await Promise.allSettled(
        consents.map((consent) =>
          startBooking(
            database,
            seeded.userId,
            seeded.tripId,
            {
              requestId: crypto.randomUUID(),
              authorizationId: consent.id,
            },
            { now, prerequisites: seeded.prerequisites },
          ),
        ),
      );
      expect(starts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const winner = starts.find((result) => result.status === "fulfilled");
      if (winner?.status !== "fulfilled") throw new Error("A complete continuation must start");
      const child = winner.value;
      const loser = starts.find((result) => result.status === "rejected");
      expect(loser?.status === "rejected" && loser.reason).toMatchObject({
        code: "booking_continuation_changed",
      });
      expect(child.components.map((component) => component.componentId).sort()).toEqual(
        terms.coverage.toBookComponentIds.toSorted(),
      );
      expect(child.executionBasis.terms).toMatchObject({
        continuationOf: parent.id,
        rootAttemptId: parent.id,
      });
      expect(child.executionStatus).toBe("invalidated");
      expect(execute).not.toHaveBeenCalled();
      const restored = await readBookingReview(database, seeded.userId, seeded.tripId, now);
      expect(restored.history).toHaveLength(2);
      expect(restored.latestAttempt?.id).toBe(child.id);
      expect(restored.confirmedCommitments).toHaveLength(1);
      expect(await database.selectFrom("bookingComponentAttempts").select("id").execute()).toEqual(
        [],
      );
      await expect(
        authorizeBooking(
          database,
          seeded.userId,
          seeded.tripId,
          {
            ...input,
            requestId: crypto.randomUUID(),
          },
          now,
          seeded.prerequisites,
        ),
      ).rejects.toMatchObject({
        code: "booking_continuation_changed",
      });
      const nextReview = await startBookingRevalidation(database, seeded.userId, seeded.tripId, {
        requestId: crypto.randomUUID(),
        expectedVersion: 3,
      });
      const next = await createRevalidationActivities(database, providers, {
        prerequisites: seeded.prerequisites,
        now: () => now,
      }).revalidateBooking({
        workflowId: nextReview.workflowId,
        tripId: seeded.tripId,
        ownerUserId: seeded.userId,
        tripVersion: 3,
      });
      expect(next.status).toBe("completed");
      expect(next.terms).toMatchObject({
        continuationOf: child.id,
        rootAttemptId: parent.id,
        totalPrice: { currency: "GBP", minorUnits: 30000 },
      });
      expect(execute).not.toHaveBeenCalled();
    });
  }, 30_000);

  it.each(["active", "unknown"] as const)(
    "blocks a fresh whole-trip review while a prior %s action is unresolved",
    async (state) => {
      await withIsolatedTestDatabase(async ({ database }) => {
        const seeded = await seedAuthorizedBooking(database);
        if (state === "unknown") {
          const providers = new TransactionProviderRegistry();
          providers.register({
            provider: "duffel",
            capabilities: {
              book: true,
              status: false,
              cancel: false,
              reschedule: false,
              idempotency: false,
            },
            execute: async () => ({ status: "unknown", safeReason: "Possible commit." }),
          });
          const activities = createBookingActivities(database, providers);
          const componentId = seeded.transaction!.components[0].componentId;
          const claim = await activities.claimProviderWrite(seeded.transaction!.id, componentId);
          await activities.executeProviderWrite(
            seeded.transaction!.id,
            componentId,
            claim.idempotencyKey,
            claim.requestFingerprint,
          );
        }
        await expect(
          startBookingRevalidation(database, seeded.userId, seeded.tripId, {
            requestId: crypto.randomUUID(),
            expectedVersion: (
              await database
                .selectFrom("trips")
                .select("currentVersion")
                .where("id", "=", seeded.tripId)
                .executeTakeFirstOrThrow()
            ).currentVersion,
          }),
        ).rejects.toMatchObject({ code: "booking_continuation_blocked" });
      });
    },
    30_000,
  );

  it("rejects materially altered saved v2 commitments, including service and included charges", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const now = new Date();
      const seeded = await seedReviewedWholeTrip(database, undefined, "completed", undefined, now);
      const consent = await authorizeBooking(
        database,
        seeded.userId,
        seeded.tripId,
        seeded.request,
        now,
        seeded.prerequisites,
      );
      const parent = await startBooking(
        database,
        seeded.userId,
        seeded.tripId,
        {
          requestId: crypto.randomUUID(),
          authorizationId: consent.id,
        },
        { now, prerequisites: seeded.prerequisites },
      );
      const original = seeded.terms.components[0];
      const confirmationId = crypto.randomUUID();
      await database
        .insertInto("bookingConfirmations")
        .values({
          id: confirmationId,
          transactionId: parent.id,
          tripId: seeded.tripId,
          componentId: original.componentId,
          providerReference: "recorded-commitment",
          terms: original,
          confirmedAt: now,
        })
        .execute();
      const confirmed = {
        ...original,
        disposition: "already_confirmed" as const,
        confirmationId,
      };
      const replacements = [
        { ...confirmed, service: { ...confirmed.service, baggage: ["Altered baggage"] } },
        { ...confirmed, service: { ...confirmed.service, refundTerms: "Altered refund terms" } },
        { ...confirmed, service: { ...confirmed.service, changeTerms: "Altered change terms" } },
        { ...confirmed, taxesMinor: confirmed.taxesMinor + 1 },
        { ...confirmed, feesMinor: confirmed.feesMinor + 1 },
        { ...confirmed, nonReversible: !confirmed.nonReversible },
      ];
      for (const replacement of replacements) {
        await expect(
          inTransaction(database, (transaction) =>
            new BookingRepository(transaction).assertConfirmedBasis(seeded.tripId, {
              ...seeded.terms,
              components: [replacement],
            }),
          ),
        ).rejects.toMatchObject({ code: "booking_commitment_mismatch" });
      }
      for (const components of [[], [original]]) {
        await expect(
          inTransaction(database, (transaction) =>
            new BookingRepository(transaction).assertConfirmedBasis(seeded.tripId, {
              ...seeded.terms,
              components,
            }),
          ),
        ).rejects.toMatchObject({ code: "booking_commitment_mismatch" });
      }
    });
  }, 30_000);
});

describe("exact-term authorization invalidation", () => {
  const base = {
    departureOrigin: {
      kind: "airport" as const,
      placeId: "airport:lhr",
      name: "London Heathrow",
      countryCode: "GB",
      timezone: "Europe/London",
      airportCode: "LHR",
    },
    travellerParty: { adults: 1, children: [] },
    components: [
      {
        componentId: "10000000-0000-4000-8000-000000000001",
        supplierOfferId: "offer-1",
        inventoryId: "inventory-1",
        serviceStart: "2030-05-01T10:00:00Z",
        serviceEnd: "2030-05-01T12:00:00Z",
        travellerIds: ["11000000-0000-4000-8000-000000000001"],
        finalCustomerMinor: 12500,
        taxesMinor: 1500,
        feesMinor: 500,
        currency: "GBP",
        cancellationTerms: "Refundable until 24 hours before service",
        expiresAt: "2030-04-30T10:00:00Z",
        nonReversible: false,
      },
    ],
    totalPrice: { currency: "GBP", minorUnits: 12500 },
    nonReversibleActions: [],
  };
  const materialMutations: Record<string, (terms: typeof base) => unknown> = {
    departureOrigin: () => ({
      ...base,
      departureOrigin: {
        ...base.departureOrigin,
        placeId: "airport:ams",
        name: "Amsterdam Schiphol",
        countryCode: "NL",
        timezone: "Europe/Amsterdam",
        airportCode: "AMS",
      },
    }),
    price: () => ({
      ...base,
      components: [{ ...base.components[0], finalCustomerMinor: 13000, taxesMinor: 2000 }],
      totalPrice: { currency: "GBP", minorUnits: 13000 },
    }),
    dates: () => ({
      ...base,
      components: [{ ...base.components[0], serviceStart: "2030-05-02T10:00:00Z" }],
    }),
    travellers: () => ({
      ...base,
      components: [
        { ...base.components[0], travellerIds: ["11000000-0000-4000-8000-000000000002"] },
      ],
    }),
    inventory: () => ({
      ...base,
      components: [{ ...base.components[0], inventoryId: "inventory-2" }],
    }),
    components: () => ({
      ...base,
      components: [
        ...base.components,
        {
          ...base.components[0],
          componentId: "10000000-0000-4000-8000-000000000009",
          supplierOfferId: "offer-2",
        },
      ],
      totalPrice: { currency: "GBP", minorUnits: 25000 },
    }),
    cancellationTerms: () => ({
      ...base,
      components: [{ ...base.components[0], cancellationTerms: "Non-refundable" }],
    }),
    origin: () => ({
      ...base,
      departureOrigin: { ...base.departureOrigin, placeId: "airport:lgw", airportCode: "LGW" },
    }),
  };

  it.each(Object.keys(materialMutations))(
    "changing %s invalidates the authorized terms hash",
    (field) => {
      const authorized = bookingTermsSchema.parse(base),
        authorizedHash = hashBookingTerms(authorized);
      const changed = bookingTermsSchema.parse(materialMutations[field](base));
      expect(hashBookingTerms(changed)).not.toBe(authorizedHash);
      expect(() =>
        assertAuthorizationTerms({
          authorization: {
            id: "20000000-0000-4000-8000-000000000001",
            tripId: "30000000-0000-4000-8000-000000000001",
            userId: "user-1",
            tripVersion: 8,
            operation: "book_trip",
            componentId: null,
            terms: changed,
            termsHash: authorizedHash,
            acknowledgedNonReversibleActions: [],
            status: "authorized",
            reason: null,
            authorizedAt: "2030-04-29T10:00:00Z",
            expiresAt: "2030-04-30T10:00:00Z",
          },
          ownerUserId: "user-1",
          tripVersion: 8,
          operation: "book_trip",
          componentId: null,
          now: new Date("2030-04-29T12:00:00Z"),
        }),
      ).toThrow(/hash is invalid/);
    },
  );

  it("requires acknowledgement of every non-reversible action", () => {
    const nonReversible = {
      ...base,
      components: [{ ...base.components[0], nonReversible: true }],
      nonReversibleActions: [base.components[0].componentId],
    };
    expect(
      bookingTermsSchema.safeParse({ ...nonReversible, nonReversibleActions: [] }).success,
    ).toBe(false);
    expect(bookingTermsSchema.parse(nonReversible).nonReversibleActions).toEqual([
      base.components[0].componentId,
    ]);
  });
});

describeWithDatabase("durable booking authorization scope", () => {
  it("rechecks expiry after trusted reads before recording consent or a start", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedReviewedWholeTrip(database);
      const clock = vi.spyOn(Date, "now").mockReturnValue(reviewNow.getTime());
      const delayed = {
        read: async (input: Parameters<typeof seeded.prerequisites.read>[0]) => {
          const readiness = await seeded.prerequisites.read(input);
          clock.mockReturnValue(reviewNow.getTime() + 300_001);
          return readiness;
        },
      };
      try {
        await expect(
          authorizeBooking(
            database,
            seeded.userId,
            seeded.tripId,
            seeded.request,
            reviewNow,
            delayed,
          ),
        ).rejects.toMatchObject({ code: "booking_terms_stale" });
        expect(
          await database.selectFrom("bookingAuthorizations").select("id").execute(),
        ).toHaveLength(0);
        clock.mockReturnValue(reviewNow.getTime());
        const consent = await authorizeBooking(
          database,
          seeded.userId,
          seeded.tripId,
          seeded.request,
          reviewNow,
          seeded.prerequisites,
        );
        await expect(
          startBooking(
            database,
            seeded.userId,
            seeded.tripId,
            {
              requestId: crypto.randomUUID(),
              authorizationId: consent.id,
            },
            { now: reviewNow, prerequisites: delayed },
          ),
        ).rejects.toMatchObject({ code: "booking_authorization_stale" });
        expect(
          await database.selectFrom("bookingTransactions").select("id").execute(),
        ).toHaveLength(0);
      } finally {
        clock.mockRestore();
      }
    });
  }, 30_000);

  it("persists unknown/failed instead of stranding a review when final property facts are inconsistent", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedReviewedWholeTrip(database, undefined, "accepted"),
        providers = new TransactionProviderRegistry();
      for (const provider of ["duffel", "nuitee", "viator"] as const)
        providers.register({
          provider,
          capabilities: {
            book: true,
            status: false,
            cancel: false,
            reschedule: false,
            idempotency: true,
            revalidation: "read_only_final_terms",
          },
          execute: vi.fn(),
          revalidate: async ({ componentId }) => {
            const terms = structuredClone(
              seeded.terms.components.find((entry) => entry.componentId === componentId)!,
            );
            if (provider === "nuitee") terms.service.propertyId = null;
            return { outcome: "unchanged", terms };
          },
        });
      const result = await createRevalidationActivities(database, providers, {
        now: () => reviewNow,
        prerequisites: seeded.prerequisites,
      }).revalidateBooking({ ...seeded, ownerUserId: seeded.userId });
      expect(result.status).toBe("failed");
      expect(result.terms).toBeNull();
      expect(result.coverage?.eligible).toBe(false);
      expect(
        result.outcomes.find(
          (entry) => entry.componentId === seeded.terms.components[2].componentId,
        )?.outcome,
      ).toBe("unknown");
      expect(
        (
          await database
            .selectFrom("bookingRevalidations")
            .select("status")
            .where("workflowId", "=", seeded.workflowId)
            .executeTakeFirstOrThrow()
        ).status,
      ).toBe("failed");
    });
  }, 30_000);

  it("binds the full recomputed coverage report, not a copied fingerprint", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedReviewedWholeTrip(database);
      const candidate = structuredClone(seeded.terms);
      candidate.coverage.entries[0].sourceRefs.push("forged requirement mapping");
      const terms = bookingTermsV2Schema.parse(candidate);
      await database
        .insertInto("bookingRevalidations")
        .values({
          workflowId: crypto.randomUUID(),
          tripId: seeded.tripId,
          ownerUserId: seeded.userId,
          requestId: crypto.randomUUID(),
          requestFingerprint: "f".repeat(64),
          tripVersion: 2,
          status: "completed",
          outcomes: sql<unknown[]>`'[]'::jsonb`,
          terms,
          termsHash: hashBookingTerms(terms),
          coverage: terms.coverage,
          expiresAt: new Date(terms.components[0].expiresAt),
          createdAt: new Date(reviewNow.getTime() + 1),
          updatedAt: new Date(reviewNow.getTime() + 1),
        })
        .execute();
      await expect(
        authorizeBooking(
          database,
          seeded.userId,
          seeded.tripId,
          { ...seeded.request, termsHash: hashBookingTerms(terms) },
          reviewNow,
          seeded.prerequisites,
        ),
      ).rejects.toMatchObject({ code: "booking_coverage_changed" });
      expect(
        await database.selectFrom("bookingAuthorizations").select("id").execute(),
      ).toHaveLength(0);
    });
  }, 30_000);

  it("invalidates unused consent after fresh changed terms and leaves old immutable evidence intact", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedReviewedWholeTrip(database);
      const original = await authorizeBooking(
        database,
        seeded.userId,
        seeded.tripId,
        seeded.request,
        reviewNow,
        seeded.prerequisites,
      );
      const workflowId = crypto.randomUUID();
      await database
        .insertInto("bookingRevalidations")
        .values({
          workflowId,
          tripId: seeded.tripId,
          ownerUserId: seeded.userId,
          requestId: crypto.randomUUID(),
          requestFingerprint: "f".repeat(64),
          tripVersion: 2,
          status: "accepted",
          outcomes: sql<unknown[]>`'[]'::jsonb`,
          terms: null,
          termsHash: null,
          expiresAt: null,
          createdAt: new Date(reviewNow.getTime() + 1),
          updatedAt: new Date(reviewNow.getTime() + 1),
        })
        .execute();
      const providers = new TransactionProviderRegistry(),
        execute = vi.fn();
      for (const provider of ["duffel", "nuitee", "viator"] as const)
        providers.register({
          provider,
          capabilities: {
            book: true,
            status: false,
            cancel: false,
            reschedule: false,
            idempotency: true,
            revalidation: "read_only_final_terms",
          },
          execute,
          revalidate: async ({ componentId }) => {
            const terms = structuredClone(
              seeded.terms.components.find((entry) => entry.componentId === componentId)!,
            );
            terms.finalCustomerMinor += 100;
            terms.evidence.finalCustomerMinor += 100;
            return { outcome: "changed", terms };
          },
        });
      const activities = createRevalidationActivities(database, providers, {
        now: () => new Date(reviewNow.getTime() + 2),
        prerequisites: seeded.prerequisites,
      });
      const input = {
        workflowId,
        tripId: seeded.tripId,
        ownerUserId: seeded.userId,
        tripVersion: 2,
      };
      const [first, replay] = await Promise.all([
        activities.revalidateBooking(input),
        activities.revalidateBooking(input),
      ]);
      expect(first).toEqual(replay);
      expect(first.status).toBe("completed");
      expect(first.termsHash).not.toBe(original.termsHash);
      const old = await database
        .selectFrom("bookingAuthorizations")
        .selectAll()
        .where("id", "=", original.id)
        .executeTakeFirstOrThrow();
      expect(old.status).toBe("invalidated");
      expect(old.termsHash).toBe(original.termsHash);
      expect(old.terms).toEqual(seeded.terms);
      await expect(
        startBooking(
          database,
          seeded.userId,
          seeded.tripId,
          {
            requestId: crypto.randomUUID(),
            authorizationId: original.id,
          },
          { now: reviewNow, prerequisites: seeded.prerequisites },
        ),
      ).rejects.toMatchObject({ code: "booking_authorization_stale" });
      expect(execute).not.toHaveBeenCalled();
      expect(await database.selectFrom("bookingTransactions").select("id").execute()).toHaveLength(
        0,
      );
    });
  }, 30_000);

  it("does not let a late older worker hide a newer accepted review", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedReviewedWholeTrip(database, undefined, "accepted"),
        newer = crypto.randomUUID();
      await database
        .insertInto("bookingRevalidations")
        .values({
          workflowId: newer,
          tripId: seeded.tripId,
          ownerUserId: seeded.userId,
          requestId: crypto.randomUUID(),
          requestFingerprint: "f".repeat(64),
          tripVersion: 2,
          status: "accepted",
          outcomes: sql<unknown[]>`'[]'::jsonb`,
          terms: null,
          termsHash: null,
          expiresAt: null,
          createdAt: new Date(reviewNow.getTime() + 1),
          updatedAt: new Date(reviewNow.getTime() + 1),
        })
        .execute();
      await createRevalidationActivities(database, new TransactionProviderRegistry(), {
        now: () => new Date(reviewNow.getTime() + 2),
      }).revalidateBooking({
        workflowId: seeded.workflowId,
        tripId: seeded.tripId,
        ownerUserId: seeded.userId,
        tripVersion: 2,
      });
      const restored = await readBookingReview(database, seeded.userId, seeded.tripId, reviewNow);
      expect(restored.review?.workflowId).toBe(newer);
      expect(restored.review?.status).toBe("accepted");
      expect(restored.authorization).toBeNull();
    });
  }, 30_000);

  it("prevents planning edits and snapshot restore from rewriting a historical provider commitment", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedAuthorizedBooking(database),
        componentId = seeded.transaction!.components[0].componentId;
      const confirmed = await applyBookingOutcome(database, seeded.transaction!.id, {
        componentId,
        status: "confirmed",
        providerReference: "recorded-confirmation",
        safeReason: null,
      });
      const current = await database
        .selectFrom("tripVersions")
        .select("snapshot")
        .where("tripId", "=", seeded.tripId)
        .where("version", "=", confirmed.version)
        .executeTakeFirstOrThrow();
      for (const restore of [false, true]) {
        const snapshot = structuredClone(current.snapshot);
        const component = snapshot.components.find((entry) => entry.id === componentId)!;
        if (restore) component.bookingStatus = "unbooked";
        else component.supplierOfferId = "forged replacement";
        const requestId = crypto.randomUUID();
        await expect(
          commitTripMutation(database, {
            tripId: seeded.tripId,
            ownerUserId: seeded.userId,
            expectedVersion: confirmed.version,
            requestId,
            idempotencyKey: requestId,
            requestFingerprint: createHash("sha256").update(requestId).digest("hex"),
            snapshot,
            initiatingActor: "user",
            proposalId: null,
            changeSummary: ["planning edit"],
            inverseOperation: { operation: "replace", target: "/", value: current.snapshot },
            nonReversibleReason: null,
            outboxEventId: crypto.randomUUID(),
            auditEventId: crypto.randomUUID(),
          }),
        ).rejects.toMatchObject({ code: "booking_commitment_immutable" });
      }
    });
  }, 30_000);

  it("persists complete read-only v2 review and price changes without any provider execution", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedReviewedWholeTrip(database, undefined, "accepted");
      const providers = new TransactionProviderRegistry(),
        execute = vi.fn();
      for (const provider of ["duffel", "nuitee", "viator"] as const) {
        providers.register({
          provider,
          capabilities: {
            book: true,
            status: true,
            cancel: false,
            reschedule: false,
            idempotency: false,
            revalidation: "read_only_final_terms",
          },
          execute,
          revalidate: async ({ componentId }) => {
            const terms = structuredClone(
              seeded.terms.components.find((entry) => entry.componentId === componentId)!,
            );
            if (terms.componentId === seeded.terms.components[0].componentId) {
              terms.finalCustomerMinor += 500;
              terms.evidence.finalCustomerMinor += 500;
            }
            return { outcome: "changed", terms };
          },
        });
      }
      const result = await createRevalidationActivities(database, providers, {
        now: () => reviewNow,
        prerequisites: seeded.prerequisites,
      }).revalidateBooking({
        workflowId: seeded.workflowId,
        tripId: seeded.tripId,
        ownerUserId: seeded.userId,
        tripVersion: 2,
      });
      expect(result.status).toBe("completed");
      expect(result.terms?.totalPrice.minorUnits).toBe(40500);
      expect(result.coverage?.eligible).toBe(true);
      expect(execute).not.toHaveBeenCalled();
      expect(
        await database
          .selectFrom("bookingAuthorizations")
          .select("id")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toEqual([]);
      expect(
        await database
          .selectFrom("bookingTransactions")
          .select("id")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toEqual([]);
    });
  }, 30_000);

  it("does not use a Nuitee rates-only/unverified prebook path, and exceptions remain unknown", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedReviewedWholeTrip(database, undefined, "accepted");
      const providers = new TransactionProviderRegistry(),
        prebookOrRates = vi.fn(),
        execute = vi.fn();
      providers.register({
        provider: "nuitee",
        capabilities: {
          book: true,
          status: false,
          cancel: false,
          reschedule: false,
          idempotency: false,
          revalidation: "unknown",
        },
        execute,
        revalidate: prebookOrRates,
      });
      providers.register({
        provider: "duffel",
        capabilities: {
          book: true,
          status: true,
          cancel: false,
          reschedule: false,
          idempotency: true,
          revalidation: "read_only_final_terms",
        },
        execute,
        revalidate: async () => {
          throw new Error("Synthetic protected provider failure");
        },
      });
      const result = await createRevalidationActivities(database, providers, {
        now: () => reviewNow,
        prerequisites: seeded.prerequisites,
      }).revalidateBooking({
        workflowId: seeded.workflowId,
        tripId: seeded.tripId,
        ownerUserId: seeded.userId,
        tripVersion: 2,
      });
      expect(result.status).toBe("failed");
      expect(result.terms).toBeNull();
      expect(result.outcomes.every((entry) => entry.outcome === "unknown")).toBe(true);
      expect(prebookOrRates).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("Synthetic protected provider failure");
    });
  }, 30_000);

  it("creates and replays exactly one full-trip authorization/start, with consequential v2 dispatch disabled", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedReviewedWholeTrip(database);
      const authorize = (request = seeded.request) =>
        authorizeBooking(
          database,
          seeded.userId,
          seeded.tripId,
          request,
          reviewNow,
          seeded.prerequisites,
        );
      const [first, replay] = await Promise.all([authorize(), authorize()]);
      expect(replay).toEqual(first);
      await expect(
        authorize({ ...seeded.request, termsHash: "b".repeat(64) }),
      ).rejects.toMatchObject({ code: "idempotency_fingerprint_conflict" });
      const input = { requestId: crypto.randomUUID(), authorizationId: first.id };
      const options = { now: reviewNow, prerequisites: seeded.prerequisites };
      const started = await startBooking(database, seeded.userId, seeded.tripId, input, options);
      expect(await startBooking(database, seeded.userId, seeded.tripId, input, options)).toEqual(
        started,
      );
      expect(started.components).toHaveLength(4);
      expect(started.executionStatus).toBe("invalidated");
      const execute = vi.fn();
      const providers = new TransactionProviderRegistry();
      providers.register({
        provider: "duffel",
        capabilities: {
          book: true,
          status: true,
          cancel: false,
          reschedule: false,
          idempotency: true,
        },
        execute,
      });
      const activities = createBookingActivities(database, providers);
      await expect(
        activities.executeProviderWrite(
          started.id,
          started.components[0].componentId,
          "blocked",
          "a".repeat(64),
        ),
      ).rejects.toThrow(/not activated/);
      expect(execute).not.toHaveBeenCalled();
      expect(
        await database
          .selectFrom("bookingAuthorizations")
          .select("id")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toHaveLength(1);
      expect(
        await database
          .selectFrom("bookingTransactions")
          .select("id")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toHaveLength(1);
      expect(
        await database
          .selectFrom("bookingComponentAttempts")
          .select("id")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toEqual([]);
    });
  }, 30_000);

  it("independently rejects persisted complete-looking terms when a required return leg is absent", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedReviewedWholeTrip(database, (snapshot) => {
        const missing = snapshot.components.find(
          (entry) => entry.planningDetails?.flightDirection === "return",
        )!;
        snapshot.components = snapshot.components.filter((entry) => entry.id !== missing.id);
        snapshot.itineraryDays.forEach((day) =>
          day.items.forEach((item) => {
            if (item.componentId === missing.id) item.componentId = null;
          }),
        );
        snapshot.price.supplierTotal.minorUnits -= missing.price.supplierAmount.minorUnits;
        snapshot.price.finalCustomerTotal.minorUnits -=
          missing.price.finalCustomerAmount.minorUnits;
      });
      await expect(
        authorizeBooking(
          database,
          seeded.userId,
          seeded.tripId,
          seeded.request,
          reviewNow,
          seeded.prerequisites,
        ),
      ).rejects.toMatchObject({ code: "booking_coverage_changed" });
      expect(
        await database
          .selectFrom("bookingAuthorizations")
          .select("id")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toEqual([]);
      expect(
        await database
          .selectFrom("bookingTransactions")
          .select("id")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toEqual([]);
    });
  }, 30_000);

  it("blocks absent or changed trusted readiness and rechecks actual expiry at start", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedReviewedWholeTrip(database);
      await expect(
        authorizeBooking(database, seeded.userId, seeded.tripId, seeded.request, reviewNow),
      ).rejects.toMatchObject({ code: "booking_prerequisites_missing" });
      const authorization = await authorizeBooking(
        database,
        seeded.userId,
        seeded.tripId,
        seeded.request,
        reviewNow,
        seeded.prerequisites,
      );
      const input = { requestId: crypto.randomUUID(), authorizationId: authorization.id };
      await expect(
        startBooking(database, seeded.userId, seeded.tripId, input, {
          now: reviewNow,
          prerequisites: { read: async () => ({ travellers: null, payment: null }) },
        }),
      ).rejects.toMatchObject({ code: "booking_prerequisites_changed" });
      await expect(
        startBooking(database, seeded.userId, seeded.tripId, input, {
          now: new Date(reviewNow.getTime() + 300_000),
          prerequisites: seeded.prerequisites,
        }),
      ).rejects.toMatchObject({ code: "booking_authorization_stale" });
      expect(
        await database
          .selectFrom("bookingTransactions")
          .select("id")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toEqual([]);
    });
  }, 30_000);

  it("preserves historical v1 evidence but rejects a new whole-trip start under it", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedAuthorizedBooking(database, { startTransaction: false });
      await expect(
        startBooking(database, seeded.userId, seeded.tripId, {
          requestId: crypto.randomUUID(),
          authorizationId: seeded.authorizationId,
        }),
      ).rejects.toMatchObject({ code: "booking_legacy_review_required" });
      expect(
        await database
          .selectFrom("bookingAuthorizations")
          .select("termsHash")
          .where("id", "=", seeded.authorizationId)
          .executeTakeFirstOrThrow(),
      ).toEqual({ termsHash: hashBookingTerms(seeded.terms) });
    });
  }, 30_000);

  it("requires fresh authorization after accepting a changed departure alternative", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedAuthorizedBooking(database, { startTransaction: false });
      const previousOrigin = seeded.snapshot.departureOrigin!;
      const selectedOrigin = {
        ...previousOrigin,
        placeId: "airport:ams",
        name: "Amsterdam Schiphol",
        countryCode: "NL",
        timezone: "Europe/Amsterdam",
        airportCode: "AMS",
      };
      const requestId = crypto.randomUUID();
      const nextSnapshot = {
        ...seeded.snapshot,
        departureOrigin: selectedOrigin,
        departureOrigins: [previousOrigin, selectedOrigin],
      };
      const next = await commitTripMutation(database, {
        tripId: seeded.tripId,
        ownerUserId: seeded.userId,
        expectedVersion: seeded.tripVersion,
        lifecycleState: "finalized",
        requestId,
        idempotencyKey: `accepted-origin:${requestId}`,
        requestFingerprint: createHash("sha256").update(requestId).digest("hex"),
        snapshot: nextSnapshot,
        initiatingActor: "user",
        proposalId: null,
        changeSummary: ["accepted_departure_alternative"],
        inverseOperation: { operation: "replace", target: "/", value: seeded.snapshot },
        nonReversibleReason: null,
        outboxEventId: crypto.randomUUID(),
        auditEventId: crypto.randomUUID(),
      });

      await expect(
        startBooking(database, seeded.userId, seeded.tripId, {
          requestId: crypto.randomUUID(),
          authorizationId: seeded.authorizationId,
        }),
      ).rejects.toMatchObject({ status: 409, code: "booking_authorization_stale" });
      await expect(
        startBookingRevalidation(database, seeded.userId, seeded.tripId, {
          requestId: crypto.randomUUID(),
          expectedVersion: seeded.tripVersion,
        }),
      ).rejects.toMatchObject({ status: 409, code: "booking_trip_not_available" });
      expect(
        await startBookingRevalidation(database, seeded.userId, seeded.tripId, {
          requestId: crypto.randomUUID(),
          expectedVersion: next.version,
        }),
      ).toMatchObject({ status: "accepted" });
      expect(
        await database
          .selectFrom("bookingTransactions")
          .select("id")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toEqual([]);
    });
  }, 30_000);

  it("rejects an expired authorization before any provider write or transaction row", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedAuthorizedBooking(database, {
        expiresInMs: -60_000,
        startTransaction: false,
      });
      await expect(
        startBooking(database, seeded.userId, seeded.tripId, {
          requestId: crypto.randomUUID(),
          authorizationId: seeded.authorizationId,
        }),
      ).rejects.toMatchObject({ status: 409, code: "booking_authorization_stale" });
      expect(
        await database
          .selectFrom("bookingTransactions")
          .select("id")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toEqual([]);
      const authorization = await database
        .selectFrom("bookingAuthorizations")
        .select("status")
        .where("id", "=", seeded.authorizationId)
        .executeTakeFirstOrThrow();
      expect(authorization.status).toBe("authorized");
    });
  }, 30_000);

  it("refuses a second start for the same consumed authorization without a new provider write", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedAuthorizedBooking(database);
      const replay = await startBooking(database, seeded.userId, seeded.tripId, {
        requestId: crypto.randomUUID(),
        authorizationId: seeded.authorizationId,
      });
      expect(replay.id).toBe(seeded.transaction!.id);
      expect(
        await database
          .selectFrom("bookingTransactions")
          .select("id")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toHaveLength(1);
      expect(
        await database
          .selectFrom("bookingWriteClaims")
          .select("componentId")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toEqual([]);
    });
  }, 30_000);
});
