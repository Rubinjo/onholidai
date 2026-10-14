// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadServerConfig } from "../../server/config";

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
    for (const key of ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "SERVICE_TOKEN_SECRET", "PRICING_DIAGNOSTIC_SECRET"] as const) {
      const environment: Record<string, string | undefined> = { ...productionEnvironment, [key]: undefined };
      expect(() => loadServerConfig(environment), key).toThrow(key);
      expect(() => loadServerConfig({ ...productionEnvironment, [key]: `synthetic-${key.toLowerCase()}` }), key).toThrow(key);
    }
    expect(loadServerConfig({ ...productionEnvironment }).NODE_ENV).toBe("production");
  });

  it("requires an explicit live integration credential whenever live providers are configured", () => {
    expect(() => loadServerConfig({ PROVIDER_MODE: "live" })).toThrow("TRAVEL_PROVIDER_API_KEY");
    expect(loadServerConfig({ PROVIDER_MODE: "live", TRAVEL_PROVIDER_API_KEY: "explicit-live-provider-key" }).PROVIDER_MODE).toBe("live");
    expect(loadServerConfig({ PROVIDER_MODE: "deterministic" }).PROVIDER_MODE).toBe("deterministic");
  });

  it("requires independently signed diagnostics and keeps configuration off the browser boundary", async () => {
    expect(() => loadServerConfig({ SERVICE_TOKEN_SECRET: "shared-signing-secret-000000000000",
      PRICING_DIAGNOSTIC_SECRET: "shared-signing-secret-000000000000" })).toThrow("independent signing secret");
    const source = await readFile(new URL("../../server/config.ts", import.meta.url), "utf8");
    expect(source.startsWith('import "server-only";')).toBe(true);
    expect(source).not.toContain("NEXT_PUBLIC");
  });
});
