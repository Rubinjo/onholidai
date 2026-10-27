// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("explicit application composition", () => {
  it("composes a reassigned discovery-only credential in web but no planning or booking authority in worker", async () => {
    const { createApplication } = await import("../../server/application");
    const { createWorkerApplication } = await import("../../server/worker-application");
    const environment = {
      TEMPORAL_ADDRESS: "localhost:7233",
      PROVIDER_MODE: "live",
      BOOKING_DEMO_ENABLED: "true",
      DUFFEL_TRANSACTION_SECRET: "synthetic-reassigned-read-role-canary",
      SUPPLIER_PROVIDERS: JSON.stringify({
        duffel: {
          readSecretRef: "DUFFEL_TRANSACTION_SECRET",
          products: {
            flight: {
              operations: {
                search: {
                  support: "supported",
                  access: "verified",
                  evidenceRef: "synthetic-discovery-only-approval",
                  verifiedAt: "2030-01-01T00:00:00Z",
                },
              },
            },
          },
        },
      }),
    };
    const transport = vi.fn<typeof fetch>();
    const web = createApplication(environment, { supplierMappings: { fetch: transport } });
    const worker = createWorkerApplication(environment);
    try {
      expect(web.planningProviders).toHaveLength(1);
      expect(web.planningProviders[0].capabilities).toMatchObject({
        provider: "duffel",
        mode: "live",
        search: ["flight"],
        readOnly: true,
      });
      expect(worker).not.toHaveProperty("planningProviders");
      for (const operation of ["book", "status", "idempotency", "cancel", "reschedule"] as const)
        expect(worker.providerReadiness.duffel.products.flight.operations[operation].access).toBe(
          "unconfigured",
        );
      expect(transport).not.toHaveBeenCalled();
    } finally {
      await Promise.all([web.shutdown(), worker.shutdown()]);
    }
  });

  it.each(["deterministic", "live"] as const)(
    "keeps only the current product matrix in %s roots even when legacy access was declared verified",
    async (mode) => {
      const { createApplication } = await import("../../server/application");
      const { createReadAdapter } = await import("../../server/supply/providers/adapter");
      const search = vi.fn(async () => []);
      const current = [
        createReadAdapter("duffel", "flight", { search }),
        createReadAdapter("nuitee", "accommodation", { search }),
        createReadAdapter("viator", "activity", { search }),
      ];
      const inactive = [
        createReadAdapter("duffel", "accommodation", { search }),
        createReadAdapter("nuitee", "flight", { search }),
        createReadAdapter("nuitee", "activity", { search }),
        createReadAdapter("booking.com", "accommodation", { search }),
      ];
      const verified = {
        support: "supported",
        access: "verified",
        evidenceRef: "synthetic-only",
        verifiedAt: "2030-01-01T00:00:00Z",
        environment: "sandbox",
      };
      const application = createApplication(
        {
          PROVIDER_MODE: mode,
          DUFFEL_READ_SECRET: "synthetic-duffel-key",
          NUITEE_SECRET: "synthetic-nuitee-key",
          VIATOR_SECRET: "synthetic-viator-key",
          SUPPLIER_PROVIDERS: JSON.stringify({
            duffel: {
              readSecretRef: "DUFFEL_READ_SECRET",
              products: {
                flight: { operations: { search: verified } },
                accommodation: { operations: { search: verified } },
              },
            },
            nuitee: {
              readSecretRef: "NUITEE_SECRET",
              products: {
                accommodation: { operations: { search: verified } },
              },
            },
            viator: {
              readSecretRef: "VIATOR_SECRET",
              products: {
                activity: { operations: { search: verified } },
              },
            },
          }),
        },
        { planningProviders: [...current, ...inactive] },
      );
      try {
        expect(application.planningProviders).toEqual(current);
        expect(search).not.toHaveBeenCalled();
      } finally {
        await application.shutdown();
      }
    },
  );
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
    const { createWorkerApplication } = await import("../../server/worker-application");
    const verified = {
      support: "supported",
      access: "verified",
      evidenceRef: "synthetic-worker-approval",
      verifiedAt: "2026-10-19T00:00:00Z",
    };
    const application = createWorkerApplication({
      TEMPORAL_ADDRESS: "localhost:7233",
      PROVIDER_MODE: "live",
      VIATOR_SECRET: "synthetic-shared-canary",
      SUPPLIER_PROVIDERS: JSON.stringify({
        viator: {
          accessTier: "merchant",
          readSecretRef: "VIATOR_SECRET",
          transactionSecretRef: "VIATOR_SECRET",
          products: {
            activity: {
              operations: { search: verified, book: { ...verified, environment: "sandbox" } },
            },
          },
        },
      }),
    });
    try {
      expect(application).not.toHaveProperty("planningProviders");
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

  it("composes real read clients from read secrets only and fails closed when a supplier is unreachable", async () => {
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
        NUITEE_SECRET: "synthetic-nuitee-read",
        VIATOR_SECRET: "synthetic-viator-read",
        SUPPLIER_PROVIDERS: JSON.stringify({
          duffel: {
            readSecretRef: "DUFFEL_READ_SECRET",
            transactionSecretRef: "DUFFEL_TRANSACTION_SECRET",
            products: { flight: { operations: { search: verified } } },
          },
          nuitee: {
            readSecretRef: "NUITEE_SECRET",
            transactionSecretRef: "NUITEE_SECRET",
            products: {
              accommodation: { operations: { search: { ...verified, environment: "sandbox" } } },
            },
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
        [["flight"], ["accommodation"], ["activity"]],
      );
      expect(application.config.VIATOR_ENVIRONMENT).toBe("sandbox");
      const snapshot = createSyntheticTripSnapshot();
      const result = await searchPlanningOffers(
        application.planningProviders,
        {
          componentTypes: ["flight", "accommodation", "activity", "rail"],
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
      // Trusted identities are resolved inside the composition root (Duffel place
      // suggestions, LiteAPI place data), so a missing injected mapping no longer
      // blocks a source by itself. An unreachable supplier still fails closed.
      expect(result.outcomes.map((source) => source.status)).toEqual([
        "unsupported",
        "error",
        "unsupported",
        "unsupported",
      ]);
      expect(transport.mock.calls.length).toBeGreaterThan(0);
      expect(
        transport.mock.calls.every(([url]) =>
          /^https:\/\/(api\.duffel\.com|api\.liteapi\.travel|api\.sandbox\.viator\.com)\//.test(
            String(url),
          ),
        ),
      ).toBe(true);
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
