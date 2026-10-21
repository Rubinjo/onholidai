// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { deriveProviderReadiness, loadServerConfig } from "../../server/config";
import { createReadAdapter } from "../../server/supply/providers/adapter";
import { syntheticReadClient } from "../../server/supply/providers/synthetic";
import { searchPlanningOffers, type SupplyReadQuery } from "../../server/supply/read";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

describe("supplier product readiness contract", () => {
  it.each(["flight", "accommodation"] as const)(
    "retains other products when Duffel %s access is blocked and publishes no upstream secrets",
    (blockedProduct) => {
      const otherProduct = blockedProduct === "flight" ? "accommodation" : "flight";
      const verified = { support: "supported", access: "verified", evidenceRef: "synthetic-approved-read",
        verifiedAt: "2026-10-19T00:00:00Z" };
      const environment = { PROVIDER_MODE: "live", DUFFEL_READ_SECRET: "synthetic-read-canary",
        VIATOR_SECRET: "synthetic-shared-canary", SUPPLIER_PROVIDERS: JSON.stringify({
          duffel: { readSecretRef: "DUFFEL_READ_SECRET", products: {
            [blockedProduct]: { operations: { search: { support: "supported", access: "blocked" } } },
            [otherProduct]: { operations: { search: verified } },
          } },
          viator: { readSecretRef: "VIATOR_SECRET", transactionSecretRef: "VIATOR_SECRET",
            products: { activity: { operations: { search: verified } } } },
        }) };
      const readiness = deriveProviderReadiness(loadServerConfig(environment), environment);
      expect(readiness.duffel.products[blockedProduct].operations.search.access).toBe("blocked");
      expect(readiness.duffel.products[otherProduct].operations.search.access).toBe("verified");
      expect(readiness.viator.products.activity.operations.search.access).toBe("verified");
      expect(readiness.viator.products.activity.operations.book.access).toBe("unconfigured");
      expect(Object.keys(readiness)).toEqual(["duffel", "viator"]);
      expect(JSON.stringify(readiness)).not.toMatch(/canary|SecretRef|DUFFEL_READ_SECRET|VIATOR_SECRET|synthetic-approved-read/);
    },
  );

  it("preserves unsupported/unknown facts separately from configured or verified access", () => {
    const environment = { PROVIDER_MODE: "live", VIATOR_SECRET: "synthetic-shared-canary",
      SUPPLIER_PROVIDERS: JSON.stringify({ viator: {
        readSecretRef: "VIATOR_SECRET", transactionSecretRef: "VIATOR_SECRET",
        products: { activity: { operations: {
          search: { support: "supported", access: "verified" },
          detail: { support: "unsupported", access: "blocked" },
        } } },
      } }) };
    const operations = deriveProviderReadiness(loadServerConfig(environment), environment).viator.products.activity.operations;
    expect(operations.search).toMatchObject({ support: "supported", access: "configured_unverified", verifiedAt: null });
    expect(operations.detail).toMatchObject({ support: "unsupported", access: "blocked", verifiedAt: null });
    expect(operations.revalidation).toMatchObject({ support: "unknown", access: "blocked", verifiedAt: null });
  });

  it.each(["unconfigured", "configured_unverified", "blocked"] as const)(
    "does not execute a configured live source with %s product access",
    async (access) => {
      const environment = { PROVIDER_MODE: "live", VIATOR_SECRET: "synthetic-shared-canary",
        SUPPLIER_PROVIDERS: JSON.stringify({ viator: { readSecretRef: "VIATOR_SECRET",
          products: { activity: { operations: { search: { support: "supported", access } } } } } }) };
      const readiness = deriveProviderReadiness(loadServerConfig(environment), environment);
      const search = vi.fn(async () => []);
      const trip = createSyntheticTripSnapshot();
      const query: SupplyReadQuery = { componentTypes: ["activity"], currency: "GBP", departureOrigin: null,
        destinationIds: trip.destinations.map((destination) => destination.id), startDate: "2030-05-01",
        endDate: "2030-05-08", travellerParty: trip.travellerParty };
      const result = await searchPlanningOffers([{
        capabilities: { provider: "viator", search: ["activity"], readOnly: true, mode: "live" }, search,
      }], query, new Date(), { readiness });
      expect(search).not.toHaveBeenCalled();
      expect(result.outcomes[0]).toMatchObject({ provider: "viator", componentType: "activity", status: "access_blocked" });
    },
  );

  it("rejects activity offers attributed to another active product's provider", async () => {
    const trip = createSyntheticTripSnapshot();
    const query: SupplyReadQuery = { componentTypes: ["activity"], currency: "GBP", departureOrigin: null,
      destinationIds: trip.destinations.map((destination) => destination.id), startDate: "2030-05-01",
      endDate: "2030-05-08", travellerParty: trip.travellerParty };
    const wrongProduct = createReadAdapter("duffel", "activity", syntheticReadClient("activity"));
    const search = vi.spyOn(wrongProduct, "search");
    const result = await searchPlanningOffers([wrongProduct], query);
    expect(search).not.toHaveBeenCalled();
    expect(result.offers).toEqual([]);
    expect(result.outcomes[0]).toMatchObject({ provider: "viator", componentType: "activity", status: "unconfigured" });
  });

  it.each(["unsupported", "unknown"] as const)(
    "does not invoke an adapter whose own search support is %s",
    async (support) => {
      const trip = createSyntheticTripSnapshot();
      const search = vi.fn(async () => []);
      const source = createReadAdapter("viator", "activity", { search, capabilities: {
        search: support, detail: "unsupported", revalidation: "unsupported",
      } });
      const result = await searchPlanningOffers([source], { componentTypes: ["activity"], currency: "GBP",
        departureOrigin: null, destinationIds: trip.destinations.map((destination) => destination.id),
        startDate: "2030-05-01", endDate: "2030-05-08", travellerParty: trip.travellerParty });
      expect(search).not.toHaveBeenCalled();
      expect(result.outcomes[0]).toMatchObject({ status: support === "unsupported" ? "unsupported" : "access_blocked" });
    },
  );
});
