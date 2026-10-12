// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("explicit application composition", () => {
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
    await expect(application.database.selectFrom("trips").select("id").execute())
      .rejects.toThrow();
  });

  it("requires explicit startup and releases the registered application on shutdown", async () => {
    const { getApplication, startApplication, stopApplication } = await import("../../server/application");
    await stopApplication();
    expect(() => getApplication()).toThrow("Application startup has not completed");
    const application = startApplication({ PROVIDER_MODE: "deterministic" });
    try {
      expect(getApplication()).toBe(application);
      expect(startApplication({ PROVIDER_MODE: "invalid" })).toBe(application);
    } finally { await stopApplication(); }
    expect(() => getApplication()).toThrow("Application startup has not completed");
  });
});
