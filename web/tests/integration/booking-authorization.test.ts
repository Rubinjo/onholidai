// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { TransactionProviderRegistry } from "../../server/supply/transactions";
import { withEphemeralPaymentToken } from "../../server/supply/payment";
import { assertAuthorizationTerms, bookingTermsSchema, hashBookingTerms } from "../../domain/booking/authorization";
import { startBooking } from "../../domain/booking/start";
import { seedAuthorizedBooking } from "../helpers/booking";
import { hasIsolatedDatabaseConfiguration, withIsolatedTestDatabase } from "../helpers/database";

vi.mock("server-only", () => ({}));

const describeWithDatabase = hasIsolatedDatabaseConfiguration() ? describe : describe.skip;

describe("booking execution boundary", () => {
  it("does not expose unconfigured provider writes as supported capabilities", () => {
    const providers = new TransactionProviderRegistry();
    expect(() => providers.require("duffel", "book_trip")).toThrow(/not configured/);
  });

  it("clears the in-memory token buffer after provider use", async () => {
    const token = new Uint8Array(32).fill(7);
    await withEphemeralPaymentToken(token, async (active) => expect(active.some((byte) => byte !== 0)).toBe(true));
    expect(token.every((byte) => byte === 0)).toBe(true);
  });
});

describe("exact-term authorization invalidation", () => {
  const base = {
    departureOrigin: { kind: "airport" as const, placeId: "airport:lhr", name: "London Heathrow",
      countryCode: "GB", timezone: "Europe/London", airportCode: "LHR" },
    travellerParty: { adults: 1, children: [] },
    components: [{ componentId: "10000000-0000-4000-8000-000000000001", supplierOfferId: "offer-1",
      inventoryId: "inventory-1", serviceStart: "2030-05-01T10:00:00Z", serviceEnd: "2030-05-01T12:00:00Z",
      travellerIds: ["11000000-0000-4000-8000-000000000001"], finalCustomerMinor: 12500, taxesMinor: 1500,
      feesMinor: 500, currency: "GBP", cancellationTerms: "Refundable until 24 hours before service",
      expiresAt: "2030-04-30T10:00:00Z", nonReversible: false }],
    totalPrice: { currency: "GBP", minorUnits: 12500 }, nonReversibleActions: [],
  };
  const materialMutations: Record<string, (terms: typeof base) => unknown> = {
    price: () => ({ ...base, components: [{ ...base.components[0], finalCustomerMinor: 13000, taxesMinor: 2000 }],
      totalPrice: { currency: "GBP", minorUnits: 13000 } }),
    dates: () => ({ ...base, components: [{ ...base.components[0], serviceStart: "2030-05-02T10:00:00Z" }] }),
    travellers: () => ({ ...base, components: [{ ...base.components[0], travellerIds: ["11000000-0000-4000-8000-000000000002"] }] }),
    inventory: () => ({ ...base, components: [{ ...base.components[0], inventoryId: "inventory-2" }] }),
    components: () => ({ ...base, components: [...base.components, { ...base.components[0],
      componentId: "10000000-0000-4000-8000-000000000009", supplierOfferId: "offer-2" }],
      totalPrice: { currency: "GBP", minorUnits: 25000 } }),
    cancellationTerms: () => ({ ...base, components: [{ ...base.components[0], cancellationTerms: "Non-refundable" }] }),
    origin: () => ({ ...base, departureOrigin: { ...base.departureOrigin, placeId: "airport:lgw", airportCode: "LGW" } }),
  };

  it.each(Object.keys(materialMutations))("changing %s invalidates the authorized terms hash", (field) => {
    const authorized = bookingTermsSchema.parse(base), authorizedHash = hashBookingTerms(authorized);
    const changed = bookingTermsSchema.parse(materialMutations[field](base));
    expect(hashBookingTerms(changed)).not.toBe(authorizedHash);
    expect(() => assertAuthorizationTerms({
      authorization: { id: "20000000-0000-4000-8000-000000000001", tripId: "30000000-0000-4000-8000-000000000001",
        userId: "user-1", tripVersion: 8, operation: "book_trip", componentId: null, terms: changed,
        termsHash: authorizedHash, acknowledgedNonReversibleActions: [], status: "authorized", reason: null,
        authorizedAt: "2030-04-29T10:00:00Z", expiresAt: "2030-04-30T10:00:00Z" },
      ownerUserId: "user-1", tripVersion: 8, operation: "book_trip", componentId: null,
      now: new Date("2030-04-29T12:00:00Z"),
    })).toThrow(/hash is invalid/);
  });

  it("requires acknowledgement of every non-reversible action", () => {
    const nonReversible = { ...base, components: [{ ...base.components[0], nonReversible: true }],
      nonReversibleActions: [base.components[0].componentId] };
    expect(bookingTermsSchema.safeParse({ ...nonReversible, nonReversibleActions: [] }).success).toBe(false);
    expect(bookingTermsSchema.parse(nonReversible).nonReversibleActions).toEqual([base.components[0].componentId]);
  });
});

describeWithDatabase("durable booking authorization scope", () => {
  it("rejects an expired authorization before any provider write or transaction row", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedAuthorizedBooking(database, { expiresInMs: -60_000, startTransaction: false });
      await expect(startBooking(database, seeded.userId, seeded.tripId, { requestId: crypto.randomUUID(),
        authorizationId: seeded.authorizationId })).rejects.toMatchObject({ status: 409, code: "booking_authorization_stale" });
      expect(await database.selectFrom("bookingTransactions").select("id").where("tripId", "=", seeded.tripId).execute()).toEqual([]);
      const authorization = await database.selectFrom("bookingAuthorizations").select("status")
        .where("id", "=", seeded.authorizationId).executeTakeFirstOrThrow();
      expect(authorization.status).toBe("authorized");
    });
  }, 30_000);

  it("refuses a second start for the same consumed authorization without a new provider write", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedAuthorizedBooking(database);
      const replay = await startBooking(database, seeded.userId, seeded.tripId, { requestId: crypto.randomUUID(),
        authorizationId: seeded.authorizationId });
      expect(replay.id).toBe(seeded.transaction!.id);
      expect(await database.selectFrom("bookingTransactions").select("id").where("tripId", "=", seeded.tripId).execute()).toHaveLength(1);
      expect(await database.selectFrom("bookingWriteClaims").select("componentId").where("tripId", "=", seeded.tripId).execute()).toEqual([]);
    });
  }, 30_000);
});
