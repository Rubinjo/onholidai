// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { deriveProviderReadiness, loadServerConfig } from "../../server/config";
import { createReadAdapter } from "../../server/supply/providers/adapter";
import { syntheticReadClient } from "../../server/supply/providers/synthetic";
import { searchPlanningOffers, type SupplyReadQuery } from "../../server/supply/read";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

describe("supplier product readiness contract", () => {
  it.each(["unknown", "affiliate_basic", "affiliate_full", "affiliate_full_booking"] as const)(
    "blocks Viator merchant actions for %s access despite asserted operation verification",
    (accessTier) => {
      const verified = {
        support: "supported",
        access: "verified",
        evidenceRef: "synthetic-operation-approval",
        verifiedAt: "2026-10-24T10:00:00Z",
        environment: "sandbox",
      };
      const environment = {
        PROVIDER_MODE: "live",
        VIATOR_ENVIRONMENT: "sandbox",
        VIATOR_SECRET: "synthetic-private-key-canary",
        SUPPLIER_PROVIDERS: JSON.stringify({
          viator: {
            accessTier,
            readSecretRef: "VIATOR_SECRET",
            transactionSecretRef: "VIATOR_SECRET",
            products: {
              activity: {
                operations: Object.fromEntries(
                  ["search", "book", "status", "cancel", "reschedule", "idempotency"].map(
                    (operation) => [operation, verified],
                  ),
                ),
              },
            },
          },
        }),
      };
      const config = loadServerConfig(environment);
      const web = deriveProviderReadiness(config, environment, "web").viator.products.activity;
      const worker = deriveProviderReadiness(config, environment, "worker").viator.products
        .activity;
      expect(web.operations.search.access).toBe("verified");
      for (const operation of ["book", "cancel", "reschedule", "idempotency"] as const) {
        expect(worker.operations[operation]).toMatchObject({
          support: "supported",
          access: "blocked",
          verifiedAt: null,
        });
        expect(worker.operations[operation].safeReason).toMatch(/merchant/i);
      }
      expect(worker.operations.status.access).toBe(
        accessTier === "affiliate_full_booking" ? "verified" : "blocked",
      );
      expect(JSON.stringify([web, worker])).not.toMatch(
        /private-key-canary|SecretRef|VIATOR_SECRET/,
      );
    },
  );

  it.each([
    ["sandbox", "sandbox", "verified"],
    ["production", "sandbox", "configured_unverified"],
    ["sandbox", undefined, "configured_unverified"],
  ] as const)(
    "requires matching environment evidence for Viator merchant operations (%#)",
    (configured, evidence, expected) => {
      const verified = {
        support: "supported",
        access: "verified",
        evidenceRef: "synthetic-operation-approval",
        verifiedAt: "2026-10-24T10:00:00Z",
        ...(evidence ? { environment: evidence } : {}),
      };
      const environment = {
        PROVIDER_MODE: "live",
        VIATOR_ENVIRONMENT: configured,
        VIATOR_SECRET: "synthetic-private-key-canary",
        SUPPLIER_PROVIDERS: JSON.stringify({
          viator: {
            accessTier: "merchant",
            transactionSecretRef: "VIATOR_SECRET",
            products: { activity: { operations: { book: verified, status: verified } } },
          },
        }),
      };
      const config = loadServerConfig(environment);
      const worker = deriveProviderReadiness(config, environment, "worker").viator.products
        .activity;
      for (const operation of ["book", "status"] as const) {
        expect(worker.operations[operation].access).toBe(expected);
        expect(worker.operations[operation].verifiedAt).toBe(
          expected === "verified" ? verified.verifiedAt : null,
        );
      }
      expect(
        deriveProviderReadiness(config, { ...environment, VIATOR_SECRET: undefined }, "worker")
          .viator.products.activity.operations.book.access,
      ).toBe("unconfigured");
    },
  );

  it("treats an omitted Viator tier as unknown rather than merchant entitlement", () => {
    const environment = {
      PROVIDER_MODE: "live",
      VIATOR_SECRET: "synthetic-key",
      SUPPLIER_PROVIDERS: JSON.stringify({
        viator: {
          transactionSecretRef: "VIATOR_SECRET",
          operations: {
            book: {
              support: "supported",
              access: "verified",
              evidenceRef: "synthetic-operation-approval",
              verifiedAt: "2026-10-24T10:00:00Z",
              environment: "sandbox",
            },
          },
        },
      }),
    };
    const config = loadServerConfig(environment);
    expect(config.SUPPLIER_PROVIDERS.viator?.accessTier).toBe("unknown");
    expect(
      deriveProviderReadiness(config, environment, "worker").viator.products.activity.operations
        .book.access,
    ).toBe("blocked");
  });

  it.each(["missing_evidence", "unsupported", "blocked", "deterministic"] as const)(
    "does not let merchant tier bypass %s readiness",
    (fault) => {
      const environment = {
        PROVIDER_MODE: fault === "deterministic" ? "deterministic" : "live",
        VIATOR_SECRET: "synthetic-private-key",
        SUPPLIER_PROVIDERS: JSON.stringify({
          viator: {
            accessTier: "merchant",
            transactionSecretRef: "VIATOR_SECRET",
            products: {
              activity: {
                operations: {
                  book: {
                    support: fault === "unsupported" ? "unsupported" : "supported",
                    access: fault === "blocked" ? "blocked" : "verified",
                    environment: "sandbox",
                    ...(fault === "missing_evidence"
                      ? {}
                      : {
                          evidenceRef: "synthetic-operation-approval",
                          verifiedAt: "2026-10-24T10:00:00Z",
                        }),
                  },
                },
              },
            },
          },
        }),
      };
      const readiness = deriveProviderReadiness(
        loadServerConfig(environment),
        environment,
        "worker",
      ).viator.products.activity.operations.book;
      expect(readiness.access).not.toBe("verified");
      expect(readiness.verifiedAt).toBeNull();
    },
  );

  it.each(["flight", "accommodation"] as const)(
    "retains other products when %s access is blocked and publishes no upstream secrets",
    (blockedProduct) => {
      const otherProduct = blockedProduct === "flight" ? "accommodation" : "flight";
      const verified = {
        support: "supported",
        access: "verified",
        evidenceRef: "synthetic-approved-read",
        verifiedAt: "2026-10-19T00:00:00Z",
      };
      const environment = {
        PROVIDER_MODE: "live",
        DUFFEL_READ_SECRET: "synthetic-read-canary",
        VIATOR_SECRET: "synthetic-shared-canary",
        SUPPLIER_PROVIDERS: JSON.stringify({
          duffel: {
            readSecretRef: "DUFFEL_READ_SECRET",
            products: {
              flight: {
                operations: {
                  search:
                    blockedProduct === "flight"
                      ? { support: "supported", access: "blocked" }
                      : verified,
                },
              },
            },
          },
          nuitee: {
            readSecretRef: "NUITEE_SECRET",
            transactionSecretRef: "NUITEE_SECRET",
            products: {
              accommodation: {
                operations: {
                  search:
                    blockedProduct === "accommodation"
                      ? { support: "supported", access: "blocked" }
                      : { ...verified, environment: "sandbox" },
                },
              },
            },
          },
          viator: {
            readSecretRef: "VIATOR_SECRET",
            transactionSecretRef: "VIATOR_SECRET",
            products: { activity: { operations: { search: verified } } },
          },
        }),
      };
      const configured = { ...environment, NUITEE_SECRET: "synthetic-hotel-canary" };
      const readiness = deriveProviderReadiness(loadServerConfig(configured), configured);
      const products = {
        flight: readiness.duffel.products.flight,
        accommodation: readiness.nuitee.products.accommodation,
      };
      expect(products[blockedProduct].operations.search.access).toBe("blocked");
      expect(products[otherProduct].operations.search.access).toBe("verified");
      expect(readiness.viator.products.activity.operations.search.access).toBe("verified");
      expect(readiness.viator.products.activity.operations.book.access).toBe("unconfigured");
      expect(Object.keys(readiness)).toEqual(["duffel", "nuitee", "viator"]);
      expect(JSON.stringify(readiness)).not.toMatch(
        /canary|SecretRef|DUFFEL_READ_SECRET|VIATOR_SECRET|synthetic-approved-read/,
      );
    },
  );

  it("preserves unsupported/unknown facts separately from configured or verified access", () => {
    const environment = {
      PROVIDER_MODE: "live",
      VIATOR_SECRET: "synthetic-shared-canary",
      SUPPLIER_PROVIDERS: JSON.stringify({
        viator: {
          readSecretRef: "VIATOR_SECRET",
          transactionSecretRef: "VIATOR_SECRET",
          products: {
            activity: {
              operations: {
                search: { support: "supported", access: "verified" },
                detail: { support: "unsupported", access: "blocked" },
              },
            },
          },
        },
      }),
    };
    const operations = deriveProviderReadiness(loadServerConfig(environment), environment).viator
      .products.activity.operations;
    expect(operations.search).toMatchObject({
      support: "supported",
      access: "configured_unverified",
      verifiedAt: null,
    });
    expect(operations.detail).toMatchObject({
      support: "unsupported",
      access: "blocked",
      verifiedAt: null,
    });
    expect(operations.revalidation).toMatchObject({
      support: "unknown",
      access: "blocked",
      verifiedAt: null,
    });
  });

  it.each(["unconfigured", "configured_unverified", "blocked"] as const)(
    "does not execute a configured live source with %s product access",
    async (access) => {
      const environment = {
        PROVIDER_MODE: "live",
        VIATOR_SECRET: "synthetic-shared-canary",
        SUPPLIER_PROVIDERS: JSON.stringify({
          viator: {
            readSecretRef: "VIATOR_SECRET",
            products: { activity: { operations: { search: { support: "supported", access } } } },
          },
        }),
      };
      const readiness = deriveProviderReadiness(loadServerConfig(environment), environment);
      const search = vi.fn(async () => []);
      const trip = createSyntheticTripSnapshot();
      const query: SupplyReadQuery = {
        componentTypes: ["activity"],
        currency: "GBP",
        departureOrigin: null,
        destinationIds: trip.destinations.map((destination) => destination.id),
        startDate: "2030-05-01",
        endDate: "2030-05-08",
        travellerParty: trip.travellerParty,
      };
      const result = await searchPlanningOffers(
        [
          {
            capabilities: {
              provider: "viator",
              search: ["activity"],
              readOnly: true,
              mode: "live",
            },
            search,
          },
        ],
        query,
        new Date(),
        { readiness },
      );
      expect(search).not.toHaveBeenCalled();
      expect(result.outcomes[0]).toMatchObject({
        provider: "viator",
        componentType: "activity",
        status: "access_blocked",
      });
    },
  );

  it("rejects activity offers attributed to another active product's provider", async () => {
    const trip = createSyntheticTripSnapshot();
    const query: SupplyReadQuery = {
      componentTypes: ["activity"],
      currency: "GBP",
      departureOrigin: null,
      destinationIds: trip.destinations.map((destination) => destination.id),
      startDate: "2030-05-01",
      endDate: "2030-05-08",
      travellerParty: trip.travellerParty,
    };
    const wrongProduct = createReadAdapter("duffel", "activity", syntheticReadClient("activity"));
    const search = vi.spyOn(wrongProduct, "search");
    const result = await searchPlanningOffers([wrongProduct], query);
    expect(search).not.toHaveBeenCalled();
    expect(result.offers).toEqual([]);
    expect(result.outcomes[0]).toMatchObject({
      provider: "viator",
      componentType: "activity",
      status: "unconfigured",
    });
  });

  it.each(["unsupported", "unknown"] as const)(
    "does not invoke an adapter whose own search support is %s",
    async (support) => {
      const trip = createSyntheticTripSnapshot();
      const search = vi.fn(async () => []);
      const source = createReadAdapter("viator", "activity", {
        search,
        capabilities: {
          search: support,
          detail: "unsupported",
          revalidation: "unsupported",
        },
      });
      const result = await searchPlanningOffers([source], {
        componentTypes: ["activity"],
        currency: "GBP",
        departureOrigin: null,
        destinationIds: trip.destinations.map((destination) => destination.id),
        startDate: "2030-05-01",
        endDate: "2030-05-08",
        travellerParty: trip.travellerParty,
      });
      expect(search).not.toHaveBeenCalled();
      expect(result.outcomes[0]).toMatchObject({
        status: support === "unsupported" ? "unsupported" : "access_blocked",
      });
    },
  );
});
