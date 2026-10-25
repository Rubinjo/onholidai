// @vitest-environment node
import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  deriveProviderReadiness,
  loadServerConfig,
  loadWorkerConfig,
  SUPPLIER_PROVIDER_IDS,
} from "../../server/config";

const productionEnvironment = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://onholidai_web:secret@db:5432/onholidai",
  BETTER_AUTH_SECRET: "explicit-production-auth-secret-000000",
  BETTER_AUTH_URL: "https://onholidai.example",
  SERVICE_TOKEN_SECRET: "explicit-service-signing-secret-000000",
  PRICING_DIAGNOSTIC_SECRET: "explicit-pricing-signing-secret-000000",
} as const;

describe("deployment configuration validation", () => {
  const workerEnvironment = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://onholidai_worker@postgres:5432/onholidai",
    TEMPORAL_ADDRESS: "temporal:7233",
    PROVIDER_MODE: "deterministic",
  };

  it("accepts the production Compose worker environment without web configuration", () => {
    expect(loadWorkerConfig(workerEnvironment)).toEqual({
      ...workerEnvironment,
      VIATOR_ENVIRONMENT: "sandbox",
      NUITEE_ENVIRONMENT: "sandbox",
      SUPPLIER_PROVIDERS: {},
    });
    expect(() => loadServerConfig(workerEnvironment)).toThrow("BETTER_AUTH_SECRET");
  });

  it.each(["DATABASE_URL", "TEMPORAL_ADDRESS"])("requires explicit production worker %s", (key) => {
    for (const value of [undefined, "", `synthetic-${key.toLowerCase()}`]) {
      expect(() => loadWorkerConfig({ ...workerEnvironment, [key]: value })).toThrow(key);
    }
  });

  it.each([
    ["NODE_ENV", "invalid"],
    ["DATABASE_URL", "not-a-url"],
    ["TEMPORAL_ADDRESS", " "],
    ["PROVIDER_MODE", "invalid"],
    ["VIATOR_ENVIRONMENT", "invalid"],
    ["NUITEE_ENVIRONMENT", "invalid"],
    ["SUPPLIER_PROVIDERS", "not-json"],
  ])("rejects invalid worker %s", (key, value) => {
    expect(() => loadWorkerConfig({ ...workerEnvironment, [key]: value })).toThrow();
  });

  it("does not parse or retain unused web credentials in worker configuration", () => {
    expect(
      loadWorkerConfig({
        ...workerEnvironment,
        BETTER_AUTH_SECRET: "unused",
        BETTER_AUTH_URL: "unused",
        SERVICE_TOKEN_SECRET: "unused",
        PRICING_DIAGNOSTIC_SECRET: "unused",
      }),
    ).toEqual(loadWorkerConfig(workerEnvironment));
  });

  it("preserves supplier secret separation in worker configuration", () => {
    for (const transactionSecretRef of ["DUFFEL_READ_SECRET", "DUFFEL_WRITE_SECRET"]) {
      expect(() =>
        loadWorkerConfig({
          ...workerEnvironment,
          DUFFEL_READ_SECRET: "same-provider-key",
          DUFFEL_WRITE_SECRET: "same-provider-key",
          SUPPLIER_PROVIDERS: JSON.stringify({
            duffel: { readSecretRef: "DUFFEL_READ_SECRET", transactionSecretRef },
          }),
        }),
      ).toThrow("separate");
    }
  });

  it("requires explicit opt-in to a booking-only demo without changing provider readiness", () => {
    expect(loadServerConfig({}).BOOKING_DEMO_ENABLED).toBe(false);
    expect(loadServerConfig({ BOOKING_DEMO_ENABLED: "false" }).BOOKING_DEMO_ENABLED).toBe(false);
    const normal = loadServerConfig({});
    const demo = loadServerConfig({ BOOKING_DEMO_ENABLED: "true" });
    expect(demo.BOOKING_DEMO_ENABLED).toBe(true);
    expect(deriveProviderReadiness(demo, {})).toEqual(deriveProviderReadiness(normal, {}));
    expect(() => loadServerConfig({ BOOKING_DEMO_ENABLED: "yes" })).toThrow();
  });

  it.each(["true", "false"])(
    "allows explicit discovery-only reassignment without worker authority when demo is %s",
    (demo) => {
      const verified = {
        support: "supported",
        access: "verified",
        evidenceRef: "synthetic-discovery-role-regression",
        verifiedAt: "2030-01-01T00:00:00Z",
      };
      const environment = {
        PROVIDER_MODE: "live",
        BOOKING_DEMO_ENABLED: demo,
        DUFFEL_READ_SECRET: "synthetic-unused-discovery-canary",
        DUFFEL_TRANSACTION_SECRET: "synthetic-reassigned-discovery-canary",
        SUPPLIER_PROVIDERS: JSON.stringify({
          duffel: {
            readSecretRef: "DUFFEL_TRANSACTION_SECRET",
            products: {
              flight: {
                operations: {
                  search: verified,
                  detail: verified,
                  book: verified,
                  status: verified,
                  idempotency: verified,
                  cancel: verified,
                  reschedule: verified,
                },
              },
            },
          },
        }),
      };
      const config = loadServerConfig(environment);
      expect(config.SUPPLIER_PROVIDERS.duffel?.readSecretRef).toBe("DUFFEL_TRANSACTION_SECRET");
      expect(config.SUPPLIER_PROVIDERS.duffel?.transactionSecretRef).toBeUndefined();
      const web = deriveProviderReadiness(config, environment);
      const worker = deriveProviderReadiness(config, environment, "worker");
      expect(web.duffel.products.flight.operations.search.access).toBe("verified");
      expect(worker.duffel.products.flight.operations.search.access).toBe("unconfigured");
      for (const operation of ["book", "status", "idempotency", "cancel", "reschedule"] as const) {
        expect(worker.duffel.products.flight.operations[operation].access).toBe("unconfigured");
        expect(web.duffel.products.flight.operations[operation].access).toBe("unconfigured");
      }
      expect(JSON.stringify([web, worker])).not.toMatch(/canary|DUFFEL_|SecretRef/);
    },
  );

  it("accepts the confirmed single-line supplier configuration without activating live access", () => {
    const environment = {
      PROVIDER_MODE: "deterministic",
      NUITEE_ENVIRONMENT: "sandbox",
      SUPPLIER_PROVIDERS:
        '{"duffel":{"readSecretRef":"DUFFEL_READ_SECRET","transactionSecretRef":"DUFFEL_TRANSACTION_SECRET","products":{"flight":{"operations":{"search":{"support":"supported","access":"configured_unverified"}}}}},"nuitee":{"readSecretRef":"NUITEE_SECRET","transactionSecretRef":"NUITEE_SECRET","products":{"accommodation":{"operations":{"search":{"support":"supported","access":"configured_unverified","environment":"sandbox"},"detail":{"support":"supported","access":"configured_unverified","environment":"sandbox"}}}}},"viator":{"readSecretRef":"VIATOR_SECRET","transactionSecretRef":"VIATOR_SECRET","products":{"activity":{"operations":{"search":{"support":"supported","access":"configured_unverified"}}}}}}',
    };
    const config = loadServerConfig(environment);
    expect(config.PROVIDER_MODE).toBe("deterministic");
    const readiness = deriveProviderReadiness(config, environment);
    for (const product of [
      readiness.duffel.products.flight,
      readiness.nuitee.products.accommodation,
      readiness.viator.products.activity,
    ]) {
      expect(product.operations.search.access).not.toBe("verified");
    }
    expect(readiness.nuitee.products.accommodation.operations.revalidation.access).toBe("blocked");
    expect(readiness.nuitee.products.accommodation.operations.book.access).toBe("blocked");
  });

  it("accepts a shared Nuitee key without activating other products or worker writes", () => {
    const environment = {
      PROVIDER_MODE: "live",
      NUITEE_ENVIRONMENT: "sandbox",
      NUITEE_SECRET: "synthetic-nuitee-shared-canary",
      SUPPLIER_PROVIDERS: JSON.stringify({
        nuitee: {
          readSecretRef: "NUITEE_SECRET",
          transactionSecretRef: "NUITEE_SECRET",
          products: {
            accommodation: {
              operations: {
                search: {
                  support: "supported",
                  access: "verified",
                  environment: "sandbox",
                  evidenceRef: "synthetic-hotel-approval",
                  verifiedAt: "2026-10-23T00:00:00Z",
                },
              },
            },
          },
        },
      }),
    };
    const config = loadServerConfig(environment);
    expect(config).toHaveProperty("NUITEE_ENVIRONMENT", "sandbox");
    const web = deriveProviderReadiness(config, environment);
    const worker = deriveProviderReadiness(config, environment, "worker");
    expect(web).toHaveProperty(
      "nuitee.products.accommodation.operations.search.access",
      "verified",
    );
    expect(web).toHaveProperty("nuitee.products.accommodation.operations.book.access", "blocked");
    expect(worker).toHaveProperty(
      "nuitee.products.accommodation.operations.search.access",
      "unconfigured",
    );
    expect(worker).toHaveProperty(
      "nuitee.products.accommodation.operations.book.access",
      "blocked",
    );
    expect(web).not.toHaveProperty("nuitee.products.flight");
    expect(web).not.toHaveProperty("nuitee.products.activity");
    expect(JSON.stringify([web, worker])).not.toMatch(/canary|NUITEE_SECRET|SecretRef/);
    expect(
      deriveProviderReadiness(
        loadServerConfig({ ...environment, NUITEE_ENVIRONMENT: "production" }),
        environment,
      ),
    ).toHaveProperty(
      "nuitee.products.accommodation.operations.search.access",
      "configured_unverified",
    );
    expect(() => loadServerConfig({ NUITEE_ENVIRONMENT: "invalid" })).toThrow();
    for (const product of ["flight", "activity"]) {
      expect(() =>
        loadServerConfig({
          SUPPLIER_PROVIDERS: JSON.stringify({
            nuitee: { products: { [product]: { operations: {} } } },
          }),
        }),
      ).toThrow();
    }
  });

  it("does not activate new Duffel stay operations from historical verified declarations", () => {
    const verified = {
      support: "supported",
      access: "verified",
      evidenceRef: "synthetic-historical-stays",
      verifiedAt: "2026-10-21T00:00:00Z",
    };
    const environment = {
      PROVIDER_MODE: "live",
      DUFFEL_READ_SECRET: "synthetic-flight-read",
      DUFFEL_WRITE_SECRET: "synthetic-worker-write",
      SUPPLIER_PROVIDERS: JSON.stringify({
        duffel: {
          readSecretRef: "DUFFEL_READ_SECRET",
          transactionSecretRef: "DUFFEL_WRITE_SECRET",
          products: {
            flight: { operations: { search: verified } },
            accommodation: {
              operations: {
                search: verified,
                detail: verified,
                revalidation: verified,
                book: verified,
                status: verified,
              },
            },
          },
        },
      }),
    };
    const config = loadServerConfig(environment);
    const web = deriveProviderReadiness(config, environment);
    const worker = deriveProviderReadiness(config, environment, "worker");
    expect(web.duffel.products.flight.operations.search.access).toBe("verified");
    for (const operation of ["search", "detail", "revalidation", "book"] as const) {
      expect(web.duffel.products.accommodation.operations[operation].support).toBe("unsupported");
      expect(worker.duffel.products.accommodation.operations[operation].access).toBe("blocked");
    }
    expect(worker.duffel.products.accommodation.operations.status.access).toBe("verified");
  });

  it("requires explicit, non-synthetic production authentication, database and signing credentials", () => {
    for (const key of [
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "SERVICE_TOKEN_SECRET",
      "PRICING_DIAGNOSTIC_SECRET",
    ] as const) {
      const environment: Record<string, string | undefined> = {
        ...productionEnvironment,
        [key]: undefined,
      };
      expect(() => loadServerConfig(environment), key).toThrow(key);
      expect(
        () =>
          loadServerConfig({ ...productionEnvironment, [key]: `synthetic-${key.toLowerCase()}` }),
        key,
      ).toThrow(key);
    }
    expect(loadServerConfig({ ...productionEnvironment }).NODE_ENV).toBe("production");
  });

  it("keeps live startup available without pretending missing supplier access is ready", () => {
    const config = loadServerConfig({ PROVIDER_MODE: "live" });
    expect(config.PROVIDER_MODE).toBe("live");
    expect(
      deriveProviderReadiness(config, {}).duffel.products.flight.operations.search.access,
    ).toBe("unconfigured");
    expect(loadServerConfig({ PROVIDER_MODE: "deterministic" }).PROVIDER_MODE).toBe(
      "deterministic",
    );
  });

  it("separates provider/operation access and never treats credentials alone as verification", () => {
    const environment = {
      PROVIDER_MODE: "live",
      DUFFEL_READ_SECRET: "synthetic-private-canary",
      SUPPLIER_PROVIDERS: JSON.stringify({
        duffel: {
          readSecretRef: "DUFFEL_READ_SECRET",
          transactionSecretRef: "DUFFEL_TRANSACTION_SECRET",
          operations: {
            search: { support: "supported", access: "verified" },
            detail: { support: "unsupported", access: "blocked" },
          },
        },
      }),
    };
    const readiness = deriveProviderReadiness(loadServerConfig(environment), environment);
    expect(readiness.duffel.products.flight.operations.search.access).toBe("configured_unverified");
    expect(readiness.duffel.products.flight.operations.detail.support).toBe("unsupported");
    expect(readiness.viator.products.activity.operations.search.access).toBe("unconfigured");
    expect(readiness.duffel.products.flight.operations.book.access).toBe("unconfigured");
    expect(JSON.stringify(readiness)).not.toMatch(
      /synthetic-private-canary|DUFFEL_READ_SECRET|DUFFEL_TRANSACTION_SECRET/,
    );
    expect(() =>
      loadServerConfig({
        SUPPLIER_PROVIDERS: JSON.stringify({
          duffel: {
            readSecretRef: "SHARED_SECRET",
            transactionSecretRef: "SHARED_SECRET",
          },
        }),
      }),
    ).toThrow();
  });

  it("does not grant web transaction access from a worker-only secret", () => {
    const environment = {
      PROVIDER_MODE: "live",
      DUFFEL_TRANSACTION_SECRET: "synthetic-worker-canary",
      SUPPLIER_PROVIDERS: JSON.stringify({
        duffel: {
          transactionSecretRef: "DUFFEL_TRANSACTION_SECRET",
          operations: {
            book: {
              support: "supported",
              access: "verified",
              evidenceRef: "synthetic-write-approval",
              verifiedAt: "2026-10-18T00:00:00Z",
            },
          },
        },
      }),
    };
    const config = loadServerConfig(environment);
    expect(
      deriveProviderReadiness(config, environment, "web").duffel.products.flight.operations.book
        .access,
    ).toBe("unconfigured");
    expect(
      deriveProviderReadiness(config, environment, "worker").duffel.products.flight.operations.book
        .access,
    ).toBe("verified");
    expect(
      deriveProviderReadiness(config, environment, "worker").duffel.products.flight.operations
        .search.access,
    ).toBe("unconfigured");
  });

  it("accepts one Viator secret reference in both trusted processes without granting booking entitlement", () => {
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
                search: {
                  support: "supported",
                  access: "verified",
                  evidenceRef: "synthetic-read-approval",
                  verifiedAt: "2026-10-19T00:00:00Z",
                },
                book: { support: "unknown", access: "unconfigured" },
              },
            },
          },
        },
      }),
    };
    const config = loadServerConfig(environment);
    const web = deriveProviderReadiness(config, environment, "web");
    const worker = deriveProviderReadiness(config, environment, "worker");
    expect(web.viator.products.activity.operations.search.access).toBe("verified");
    expect(web.viator.products.activity.operations.book.access).toBe("unconfigured");
    expect(worker.viator.products.activity.operations.book).toMatchObject({
      support: "unknown",
      access: "blocked",
    });
    expect(worker.viator.products.activity.operations.search.access).toBe("unconfigured");
    expect(JSON.stringify([web, worker])).not.toMatch(
      /synthetic-shared-canary|VIATOR_SECRET|SecretRef/,
    );
  });

  it("verifies Viator writes only with worker access and independent operation evidence", () => {
    const environment = {
      PROVIDER_MODE: "live",
      VIATOR_SECRET: "synthetic-shared-canary",
      SUPPLIER_PROVIDERS: JSON.stringify({
        viator: {
          accessTier: "merchant",
          readSecretRef: "VIATOR_SECRET",
          transactionSecretRef: "VIATOR_SECRET",
          products: {
            activity: {
              operations: {
                search: {
                  support: "supported",
                  access: "verified",
                  evidenceRef: "synthetic-read-approval",
                  verifiedAt: "2026-10-19T00:00:00Z",
                },
                book: {
                  support: "supported",
                  access: "verified",
                  evidenceRef: "synthetic-booking-approval",
                  verifiedAt: "2026-10-19T00:00:00Z",
                  environment: "sandbox",
                },
              },
            },
          },
        },
      }),
    };
    const config = loadServerConfig(environment);
    expect(
      deriveProviderReadiness(config, environment, "web").viator.products.activity.operations.book
        .access,
    ).toBe("unconfigured");
    expect(
      deriveProviderReadiness(config, environment, "worker").viator.products.activity.operations
        .book.access,
    ).toBe("verified");
    expect(
      deriveProviderReadiness(config, { ...environment, VIATOR_SECRET: undefined }, "worker").viator
        .products.activity.operations.book.access,
    ).toBe("unconfigured");
  });

  it.each(["flight"] as const)(
    "isolates Duffel %s readiness and does not inherit legacy flight evidence into Stays",
    (product) => {
      const environment = {
        PROVIDER_MODE: "live",
        DUFFEL_READ_SECRET: "synthetic-read-canary",
        SUPPLIER_PROVIDERS: JSON.stringify({
          duffel: {
            readSecretRef: "DUFFEL_READ_SECRET",
            products: {
              [product]: {
                operations: {
                  search: {
                    support: "supported",
                    access: "verified",
                    evidenceRef: `synthetic-${product}-approval`,
                    verifiedAt: "2026-10-19T00:00:00Z",
                  },
                },
              },
            },
          },
        }),
      };
      const readiness = deriveProviderReadiness(loadServerConfig(environment), environment);
      const other = product === "flight" ? "accommodation" : "flight";
      expect(readiness.duffel.products[product].operations.search.access).toBe("verified");
      expect(readiness.duffel.products[other].operations.search).toMatchObject({
        support: "unsupported",
        access: "blocked",
      });
      const legacyEnvironment = {
        ...environment,
        SUPPLIER_PROVIDERS: JSON.stringify({
          duffel: {
            readSecretRef: "DUFFEL_READ_SECRET",
            operations: {
              search: {
                support: "supported",
                access: "verified",
                evidenceRef: "synthetic-flight-only",
                verifiedAt: "2026-10-19T00:00:00Z",
              },
            },
          },
        }),
      };
      const legacy = deriveProviderReadiness(
        loadServerConfig(legacyEnvironment),
        legacyEnvironment,
      );
      expect(legacy.duffel.products.flight.operations.search.access).toBe("verified");
      expect(legacy.duffel.products.accommodation.operations.search.access).not.toBe("verified");
    },
  );

  it("does not let provider-level evidence override a blocked product declaration", () => {
    const environment = {
      PROVIDER_MODE: "live",
      DUFFEL_READ_SECRET: "synthetic-read-canary",
      SUPPLIER_PROVIDERS: JSON.stringify({
        duffel: {
          readSecretRef: "DUFFEL_READ_SECRET",
          operations: {
            search: {
              support: "supported",
              access: "verified",
              evidenceRef: "synthetic-old-approval",
              verifiedAt: "2026-10-19T00:00:00Z",
            },
          },
          products: {
            flight: { operations: { search: { support: "supported", access: "blocked" } } },
          },
        },
      }),
    };
    expect(
      deriveProviderReadiness(loadServerConfig(environment), environment).duffel.products.flight
        .operations.search.access,
    ).toBe("blocked");
  });

  it("rejects a Duffel write key disguised by a different secret reference", () => {
    expect(() =>
      loadServerConfig({
        DUFFEL_READ_SECRET: "synthetic-same-key",
        DUFFEL_WRITE_SECRET: "synthetic-same-key",
        SUPPLIER_PROVIDERS: JSON.stringify({
          duffel: {
            readSecretRef: "DUFFEL_READ_SECRET",
            transactionSecretRef: "DUFFEL_WRITE_SECRET",
          },
        }),
      }),
    ).toThrow("separate");
  });

  it("keeps a dedicated search-permitted Duffel token separate from worker authority", () => {
    const environment = {
      PROVIDER_MODE: "live",
      DUFFEL_READ_SECRET: "duffel_test_synthetic_dedicated_discovery_rw",
      DUFFEL_TRANSACTION_SECRET: "duffel_test_synthetic_worker_rw",
      SUPPLIER_PROVIDERS: JSON.stringify({
        duffel: {
          readSecretRef: "DUFFEL_READ_SECRET",
          transactionSecretRef: "DUFFEL_TRANSACTION_SECRET",
          products: {
            flight: {
              operations: {
                search: { support: "supported", access: "configured_unverified" },
              },
            },
          },
        },
      }),
    };
    const config = loadServerConfig(environment);
    const web = deriveProviderReadiness(config, environment, "web").duffel.products.flight;
    const worker = deriveProviderReadiness(config, environment, "worker").duffel.products.flight;
    expect(web.operations.search.access).toBe("configured_unverified");
    expect(web.operations.book.access).toBe("unconfigured");
    expect(worker.operations.search.access).toBe("unconfigured");
    expect(worker.operations.book.access).not.toBe("verified");
    expect(JSON.stringify([web, worker])).not.toMatch(/dedicated_discovery_rw|worker_rw/);
  });

  it("keeps only current providers in readiness and rejects invalid product declarations", () => {
    expect(SUPPLIER_PROVIDER_IDS).toEqual(["duffel", "nuitee", "viator"]);
    expect(Object.keys(deriveProviderReadiness(loadServerConfig({}), {}))).toEqual([
      "duffel",
      "nuitee",
      "viator",
    ]);
    for (const providers of [
      { duffel: { products: { activity: { operations: {} } } } },
      { viator: { products: { flight: { operations: {} } } } },
      { trainline: {} },
      { booking: {} },
      { getyourguide: {} },
    ]) {
      expect(() => loadServerConfig({ SUPPLIER_PROVIDERS: JSON.stringify(providers) })).toThrow();
    }
  });

  it("keeps deterministic readiness unverified even when live evidence is supplied", () => {
    const environment = {
      PROVIDER_MODE: "deterministic",
      DUFFEL_WRITE_SECRET: "synthetic-write-canary",
      SUPPLIER_PROVIDERS: JSON.stringify({
        duffel: {
          transactionSecretRef: "DUFFEL_WRITE_SECRET",
          products: {
            accommodation: {
              operations: {
                book: {
                  support: "supported",
                  access: "verified",
                  evidenceRef: "synthetic-live-evidence",
                  verifiedAt: "2026-10-19T00:00:00Z",
                },
              },
            },
          },
        },
      }),
    };
    const readiness = deriveProviderReadiness(loadServerConfig(environment), environment, "worker");
    expect(readiness.duffel.products.accommodation.operations.book.access).not.toBe("verified");
    expect(readiness.duffel.products.accommodation.operations.book.verifiedAt).toBeNull();
  });

  it("requires independently signed diagnostics and keeps configuration off the browser boundary", async () => {
    expect(() =>
      loadServerConfig({
        SERVICE_TOKEN_SECRET: "shared-signing-secret-000000000000",
        PRICING_DIAGNOSTIC_SECRET: "shared-signing-secret-000000000000",
      }),
    ).toThrow("independent signing secret");
    const source = await readFile(new URL("../../server/config.ts", import.meta.url), "utf8");
    expect(source.startsWith('import "server-only";')).toBe(true);
    expect(source).not.toContain("NEXT_PUBLIC");
  });
});
