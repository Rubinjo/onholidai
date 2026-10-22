// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("explicit application composition", () => {
  it("enables only ready live search adapters while preserving unrelated application reads", async () => {
    const { createApplication } = await import("../../server/application");
    const { createDuffelReadProvider } = await import("../../server/supply/providers/duffel-read");
    const provider = createDuffelReadProvider({ search: async () => [] });
    const blocked = createApplication({ PROVIDER_MODE: "live" }, { planningProviders: [provider] });
    try {
      expect(blocked.planningProviders).toEqual([]);
      expect(blocked.database).toBeDefined();
    } finally {
      await blocked.shutdown();
    }
    const ready = createApplication(
      {
        PROVIDER_MODE: "live",
        DUFFEL_READ_SECRET: "synthetic-private-canary",
        SUPPLIER_PROVIDERS: JSON.stringify({
          duffel: {
            readSecretRef: "DUFFEL_READ_SECRET",
            operations: {
              search: {
                support: "supported",
                access: "verified",
                evidenceRef: "synthetic-read-approval",
                verifiedAt: "2026-10-18T00:00:00Z",
              },
            },
          },
        }),
      },
      { planningProviders: [provider] },
    );
    try {
      expect(ready.planningProviders).toEqual([provider]);
      expect(ready.providerReadiness.viator.products.activity.operations.search.access).toBe(
        "unconfigured",
      );
    } finally {
      await ready.shutdown();
    }
  });

  it("gates each product independently and excludes deferred or replaced live suppliers", async () => {
    const { createApplication } = await import("../../server/application");
    const { createReadAdapter } = await import("../../server/supply/providers/adapter");
    const flight = createReadAdapter("duffel", "flight", { search: async () => [] });
    const stay = createReadAdapter("duffel", "accommodation", { search: async () => [] });
    const activity = createReadAdapter("viator", "activity", { search: async () => [] });
    const legacy = [
      createReadAdapter("booking.com", "accommodation", { search: async () => [] }),
      createReadAdapter("trainline", "rail", { search: async () => [] }),
      createReadAdapter("getyourguide", "activity", { search: async () => [] }),
    ];
    const verified = {
      support: "supported",
      access: "verified",
      evidenceRef: "synthetic-product-approval",
      verifiedAt: "2026-10-19T00:00:00Z",
    };
    const application = createApplication(
      {
        PROVIDER_MODE: "live",
        DUFFEL_READ_SECRET: "synthetic-flight-read",
        VIATOR_SECRET: "synthetic-activity-read",
        SUPPLIER_PROVIDERS: JSON.stringify({
          duffel: {
            readSecretRef: "DUFFEL_READ_SECRET",
            products: {
              flight: { operations: { search: verified } },
              accommodation: {
                operations: { search: { support: "supported", access: "blocked" } },
              },
            },
          },
          viator: {
            readSecretRef: "VIATOR_SECRET",
            transactionSecretRef: "VIATOR_SECRET",
            products: { activity: { operations: { search: verified } } },
          },
        }),
      },
      { planningProviders: [flight, stay, activity, ...legacy] },
    );
    try {
      expect(application.planningProviders.map((provider) => provider.capabilities)).toEqual([
        flight.capabilities,
        activity.capabilities,
      ]);
      expect(
        application.providerReadiness.duffel.products.accommodation.operations.search.access,
      ).toBe("blocked");
    } finally {
      await application.shutdown();
    }
  });

  it("prevents an adapter advertising multiple products from bypassing a blocked product", async () => {
    const { createApplication } = await import("../../server/application");
    const { createReadAdapter } = await import("../../server/supply/providers/adapter");
    const provider = createReadAdapter("duffel", "flight", { search: async () => [] });
    provider.capabilities.search.push("accommodation");
    const application = createApplication(
      {
        PROVIDER_MODE: "live",
        DUFFEL_READ_SECRET: "synthetic-flight-read",
        SUPPLIER_PROVIDERS: JSON.stringify({
          duffel: {
            readSecretRef: "DUFFEL_READ_SECRET",
            products: {
              flight: {
                operations: {
                  search: {
                    support: "supported",
                    access: "verified",
                    evidenceRef: "synthetic-flight-only",
                    verifiedAt: "2026-10-19T00:00:00Z",
                  },
                },
              },
            },
          },
        }),
      },
      { planningProviders: [provider] },
    );
    try {
      expect(application.planningProviders).toEqual([]);
    } finally {
      await application.shutdown();
    }
  });

  it("composes worker readiness without enabling web research or revealing credentials", async () => {
    const { createApplication } = await import("../../server/application");
    const { createReadAdapter } = await import("../../server/supply/providers/adapter");
    const verified = {
      support: "supported",
      access: "verified",
      evidenceRef: "synthetic-worker-approval",
      verifiedAt: "2026-10-19T00:00:00Z",
    };
    const application = createApplication(
      {
        PROVIDER_MODE: "live",
        VIATOR_SECRET: "synthetic-shared-canary",
        SUPPLIER_PROVIDERS: JSON.stringify({
          viator: {
            readSecretRef: "VIATOR_SECRET",
            transactionSecretRef: "VIATOR_SECRET",
            products: { activity: { operations: { search: verified, book: verified } } },
          },
        }),
      },
      {
        audience: "worker",
        planningProviders: [createReadAdapter("viator", "activity", { search: async () => [] })],
      },
    );
    try {
      expect(application.planningProviders).toEqual([]);
      expect(application.providerReadiness.viator.products.activity.operations.book.access).toBe(
        "verified",
      );
      expect(application.providerReadiness.viator.products.activity.operations.search.access).toBe(
        "unconfigured",
      );
      expect(JSON.stringify(application.providerReadiness)).not.toMatch(
        /synthetic-shared-canary|VIATOR_SECRET/,
      );
    } finally {
      await application.shutdown();
    }
  });

  it("composes real read clients from read secrets only and fails closed without trusted location mappings", async () => {
    const { createApplication } = await import("../../server/application");
    const { searchPlanningOffers } = await import("../../server/supply/read");
    const { createSyntheticTripSnapshot } = await import("../fixtures/trips");
    const verified = {
      support: "supported",
      access: "verified",
      evidenceRef: "synthetic-read-approval",
      verifiedAt: "2026-10-19T00:00:00Z",
    };
    const transport = vi.fn<typeof fetch>();
    const application = createApplication(
      {
        PROVIDER_MODE: "live",
        DUFFEL_READ_SECRET: "synthetic-duffel-read",
        DUFFEL_TRANSACTION_SECRET: "synthetic-never-used-write",
        VIATOR_SECRET: "synthetic-viator-read",
        SUPPLIER_PROVIDERS: JSON.stringify({
          duffel: {
            readSecretRef: "DUFFEL_READ_SECRET",
            transactionSecretRef: "DUFFEL_TRANSACTION_SECRET",
            products: { flight: { operations: { search: verified } } },
          },
          viator: {
            readSecretRef: "VIATOR_SECRET",
            products: { activity: { operations: { search: verified } } },
          },
        }),
      },
      { supplierMappings: { fetch: transport } },
    );
    try {
      expect(application.planningProviders.map((provider) => provider.capabilities.search)).toEqual(
        [["flight"], ["activity"]],
      );
      expect(application.config.VIATOR_ENVIRONMENT).toBe("sandbox");
      const snapshot = createSyntheticTripSnapshot();
      const result = await searchPlanningOffers(
        application.planningProviders,
        {
          componentTypes: ["flight", "activity", "rail"],
          departureOrigin: snapshot.departureOrigin,
          destinationIds: snapshot.destinations.map((place) => place.id),
          destinations: snapshot.destinations,
          currency: "GBP",
          startDate: "2030-05-01",
          endDate: "2030-05-08",
          travellerParty: snapshot.travellerParty,
        },
        new Date(),
        { readiness: application.providerReadiness },
      );
      expect(result.offers).toEqual([]);
      expect(result.outcomes.map((source) => source.status)).toEqual([
        "unsupported",
        "unsupported",
        "unsupported",
      ]);
      expect(transport).not.toHaveBeenCalled();
      expect(JSON.stringify(application.planningProviders)).not.toMatch(
        /synthetic-duffel-read|synthetic-never-used-write|synthetic-viator-read/,
      );
    } finally {
      await application.shutdown();
    }
  });

  it("requires explicit production identity and independently signed diagnostics", async () => {
    const { loadServerConfig } = await import("../../server/config");
    expect(() => loadServerConfig({ NODE_ENV: "production" })).toThrow("DATABASE_URL");
    expect(() =>
      loadServerConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://local/db",
        BETTER_AUTH_SECRET: "synthetic-development-secret-000000",
      }),
    ).toThrow("BETTER_AUTH_SECRET");
    const local = loadServerConfig({ NODE_ENV: "test" });
    expect(local.SERVICE_TOKEN_SECRET).not.toBe(local.PRICING_DIAGNOSTIC_SECRET);
  });
  it("can import factories without evaluating environment configuration", async () => {
    vi.stubEnv("PROVIDER_MODE", "invalid");
    try {
      const { loadServerConfig } = await import("../../server/config");
      await import("../../server/db/database");
      await import("../../server/auth/auth");
      expect(() => loadServerConfig({ PROVIDER_MODE: "invalid" })).toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("closes owned resources once, including concurrent shutdown", async () => {
    const { createApplication } = await import("../../server/application");
    const application = createApplication({ PROVIDER_MODE: "deterministic" });
    await Promise.all([application.shutdown(), application.shutdown()]);
    await application.shutdown();
    await expect(application.database.selectFrom("trips").select("id").execute()).rejects.toThrow();
  });

  it("requires explicit startup and releases the registered application on shutdown", async () => {
    const { getApplication, startApplication, stopApplication } =
      await import("../../server/application");
    await stopApplication();
    expect(() => getApplication()).toThrow("Application startup has not completed");
    const application = startApplication({ PROVIDER_MODE: "deterministic" });
    try {
      expect(getApplication()).toBe(application);
      expect(startApplication({ PROVIDER_MODE: "invalid" })).toBe(application);
    } finally {
      await stopApplication();
    }
    expect(() => getApplication()).toThrow("Application startup has not completed");
  });
});
