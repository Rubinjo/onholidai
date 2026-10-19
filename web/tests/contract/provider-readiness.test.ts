// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { deriveProviderReadiness, loadServerConfig } from "../../server/config";

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
});
