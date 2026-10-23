// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hasIsolatedDatabaseConfiguration } from "../helpers/database";
import {
  guestApiFixture,
  registerFixtureAccount,
  type GuestApiFixture,
} from "../helpers/guest-api";
import { previewEdit, applyEdit } from "../../domain/trip/edit";
import { createBookingIntent } from "../../server/auth/booking-intent";
import { POST as intent } from "../../app/api/v1/booking-intents/route";
import { POST as link } from "../../app/api/v1/booking-intents/[intentId]/link/route";
import { GET as reviewState, POST as start } from "../../app/api/v1/trips/[tripId]/bookings/route";
import { POST as authorize } from "../../app/api/v1/trips/[tripId]/booking/authorizations/route";
import {
  bookingReviewStateSchema,
  publicAuthorizationSchema,
  publicBookingTransactionSchema,
} from "../../domain/booking/public";
import { seedReviewedWholeTrip } from "../helpers/booking";
import {
  bookingIntentRequestSchema,
  linkRequestSchema,
  bookingContinuationPath,
} from "../../server/auth/booking-intent";
import { safeAuthDestination } from "../../components/auth/safe-destination";

vi.mock("server-only", () => ({}));
describe("booking-only authentication contract", () => {
  it("accepts only fixed review intent and rejects browser-selected consent or redirects", () => {
    const input = { requestId: crypto.randomUUID(), tripId: crypto.randomUUID() };
    expect(bookingIntentRequestSchema.parse(input)).toEqual(input);
    expect(
      bookingIntentRequestSchema.safeParse({
        ...input,
        action: "pay",
        returnTo: "https://attacker.invalid",
      }).success,
    ).toBe(false);
    expect(
      linkRequestSchema.safeParse({ requestId: crypto.randomUUID(), authorizeBooking: true })
        .success,
    ).toBe(false);
  });
  it("derives current continuation and keeps intent ahead of ordinary safe redirects", () => {
    const id = crypto.randomUUID();
    expect(bookingContinuationPath(id, "draft").nextPath).toBe(`/trips/${id}/booking`);
    expect(bookingContinuationPath(id, "cancelled").nextPath).toBe(`/trips/${id}`);
    expect(bookingContinuationPath(id, "finalized").nextPath).toBe(`/trips/${id}/booking`);
    expect(safeAuthDestination(id, "//attacker.invalid")).toBe(`/auth/continue?intentId=${id}`);
    for (const unsafe of ["//attacker.invalid", "https://attacker.invalid", "/\\attacker.invalid"])
      expect(safeAuthDestination(undefined, unsafe)).toBe("/");
  });
});

describe.skipIf(!hasIsolatedDatabaseConfiguration())("booking authentication HTTP boundary", () => {
  let state: GuestApiFixture;
  beforeEach(async () => {
    state = await guestApiFixture();
    const owner = state.run.ownerUserId,
      input = {
        requestId: crypto.randomUUID(),
        expectedVersion: 1,
        operations: [{ operation: "replace", target: "/preferences/pace", value: 60 }],
      };
    const review = await previewEdit(
      state.fixture.database,
      owner,
      state.trip.tripId,
      input,
      state.application.planningProviders,
    );
    await applyEdit(state.fixture.database, owner, state.trip.tripId, {
      ...input,
      impactFingerprint: review.impactFingerprint,
    });
    // Leave the trip a draft: Book trip admits review before readiness/finalization.
  }, 120000);
  afterEach(async () => {
    await state?.cleanup();
  });
  it("creates/replays an intent, links the same trip and rejects the former guest credential", async () => {
    const input = { requestId: crypto.randomUUID(), tripId: state.trip.tripId };
    const created = await intent(state.request("/api/v1/booking-intents", state.credential, input));
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("private, no-store");
    const body = (await created.json()) as { intentId: string };
    expect(
      (await intent(state.request("/api/v1/booking-intents", state.credential, input))).status,
    ).toBe(200);
    const route = { params: Promise.resolve({ intentId: body.intentId }) },
      command = { requestId: crypto.randomUUID() };
    expect(
      (
        await link(
          state.request(`/api/v1/booking-intents/${body.intentId}/link`, state.credential, command),
          route,
        )
      ).status,
    ).toBe(401);
    const account = await registerFixtureAccount(state);
    const request = state.request(
      `/api/v1/booking-intents/${body.intentId}/link`,
      state.credential,
      command,
    );
    request.headers.set("cookie", `${request.headers.get("cookie")}; ${account.cookie}`);
    const linked = await link(request, route);
    expect(linked.status).toBe(200);
    expect(await linked.json()).toMatchObject({
      tripId: state.trip.tripId,
      version: 2,
      nextPath: `/trips/${state.trip.tripId}/booking`,
    });
    const replay = state.request(`/api/v1/booking-intents/${body.intentId}/link`, "", command);
    replay.headers.set("cookie", account.cookie);
    expect(await (await link(replay, route)).json()).toMatchObject({
      tripId: state.trip.tripId,
      replayed: true,
    });
    expect(
      (await intent(state.request("/api/v1/booking-intents", state.credential, input))).status,
    ).toBe(404);
    expect(
      await state.fixture.database.selectFrom("bookingAuthorizations").selectAll().execute(),
    ).toHaveLength(0);
    expect(
      await state.fixture.database.selectFrom("bookingTransactions").selectAll().execute(),
    ).toHaveLength(0);
  });
  it("denies foreign origins and proves ownership before disclosing expiry", async () => {
    const input = { requestId: crypto.randomUUID(), tripId: state.trip.tripId },
      request = state.request("/api/v1/booking-intents", state.credential, input);
    request.headers.set("origin", "https://attacker.invalid");
    expect((await intent(request)).status).toBe(403);
    const old = await createBookingIntent(
      state.fixture.database,
      { accountUserId: null, guestSessionId: state.session.id },
      input,
      new Date(Date.now() - 31 * 60000),
    );
    expect("intentId" in old).toBe(true);
    expect(
      (await intent(state.request("/api/v1/booking-intents", state.credential, input))).status,
    ).toBe(410);
    expect((await intent(state.request("/api/v1/booking-intents", "", input))).status).toBe(404);
  });

  it("restores only an account owner's safe durable state without GET side effects", async () => {
    const account = await registerFixtureAccount(state);
    const seeded = await seedReviewedWholeTrip(
      state.fixture.database,
      undefined,
      "completed",
      account.id,
      new Date(),
    );
    const route = { params: Promise.resolve({ tripId: seeded.tripId }) };
    expect(
      (await reviewState(state.request(`/api/v1/trips/${seeded.tripId}/bookings`), route)).status,
    ).toBe(401);
    const request = () => {
      const input = state.request(`/api/v1/trips/${seeded.tripId}/bookings`, "");
      input.headers.set("cookie", account.cookie);
      return input;
    };
    const before = await state.fixture.database
      .selectFrom("outboxEvents")
      .select("id")
      .orderBy("id")
      .execute();
    const first = await reviewState(request(), route);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    const safe = bookingReviewStateSchema.parse(await first.json());
    expect(safe.coverage.eligible).toBe(true);
    expect(safe.review?.terms?.components).toHaveLength(4);
    expect(
      bookingReviewStateSchema.parse(await (await reviewState(request(), route)).json()),
    ).toEqual(safe);
    expect(
      await state.fixture.database.selectFrom("outboxEvents").select("id").orderBy("id").execute(),
    ).toEqual(before);
    expect(
      await state.fixture.database.selectFrom("bookingTransactions").select("id").execute(),
    ).toHaveLength(0);
    expect(JSON.stringify(safe)).not.toMatch(
      /supplierOfferId|inventoryId|paymentReadiness|travellerReadiness|supplierAmount|recorded-payment/,
    );
    const other = await registerFixtureAccount(state),
      foreign = request();
    foreign.headers.set("cookie", other.cookie);
    expect((await reviewState(foreign, route)).status).toBe(404);
    expect(
      (await reviewState(request(), { params: Promise.resolve({ tripId: crypto.randomUUID() }) }))
        .status,
    ).toBe(404);
  }, 30_000);

  it("records and replays one exact account-authorized v2 start with safe HTTP DTOs", async () => {
    const account = await registerFixtureAccount(state);
    const seeded = await seedReviewedWholeTrip(
      state.fixture.database,
      undefined,
      "completed",
      account.id,
      new Date(),
    );
    state.application.bookingPrerequisites = seeded.prerequisites;
    const route = { params: Promise.resolve({ tripId: seeded.tripId }) };
    const request = (path: string, body: unknown, cookie = account.cookie) => {
      const result = state.request(path, "", body);
      result.headers.set("cookie", cookie);
      return result;
    };
    const consentPath = `/api/v1/trips/${seeded.tripId}/booking/authorizations`;
    expect(
      (await authorize(state.request(consentPath, state.credential, seeded.request), route)).status,
    ).toBe(401);
    const response = await authorize(request(consentPath, seeded.request), route);
    expect(response.status).toBe(201);
    const receipt = publicAuthorizationSchema.parse(await response.json());
    expect(
      publicAuthorizationSchema.parse(
        await (await authorize(request(consentPath, seeded.request), route)).json(),
      ),
    ).toEqual(receipt);
    expect(
      (
        await authorize(
          request(consentPath, {
            ...seeded.request,
            requestId: crypto.randomUUID(),
            selectedComponentIds: [seeded.terms.components[0].componentId],
          }),
          route,
        )
      ).status,
    ).toBe(422);
    const input = { requestId: crypto.randomUUID(), authorizationId: receipt.id },
      path = `/api/v1/trips/${seeded.tripId}/bookings`;
    const started = await start(request(path, input), route);
    expect(started.status).toBe(202);
    const booking = publicBookingTransactionSchema.parse(await started.json());
    expect(
      publicBookingTransactionSchema.parse(await (await start(request(path, input), route)).json()),
    ).toEqual(booking);
    expect(booking.components).toHaveLength(4);
    expect(booking.executionStatus).toBe("invalidated");
    expect(
      await state.fixture.database.selectFrom("bookingAuthorizations").select("id").execute(),
    ).toHaveLength(1);
    expect(
      await state.fixture.database.selectFrom("bookingTransactions").select("id").execute(),
    ).toHaveLength(1);
    expect(
      await state.fixture.database.selectFrom("bookingComponentAttempts").select("id").execute(),
    ).toHaveLength(0);
    const other = await registerFixtureAccount(state);
    expect((await start(request(path, input, other.cookie), route)).status).toBe(404);
  }, 30_000);
});
