// @vitest-environment node
import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  deriveProviderReadiness,
  loadServerConfig,
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

  it.each(["flight", "accommodation"] as const)(
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
        support: "unknown",
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

  it("keeps only current providers in readiness and rejects invalid product declarations", () => {
    expect(SUPPLIER_PROVIDER_IDS).toEqual(["duffel", "viator"]);
    expect(Object.keys(deriveProviderReadiness(loadServerConfig({}), {}))).toEqual([
      "duffel",
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
