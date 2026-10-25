// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../server/application", () => {
  throw new Error("Worker must not import web application composition");
});
vi.mock("../../server/auth/auth", () => {
  throw new Error("Worker must not import authentication");
});
vi.mock("../../server/supply/providers", () => {
  throw new Error("Worker must not import planning providers");
});
vi.mock("../../server/db/database", () => ({
  createDatabase: vi.fn(() => ({ destroy: vi.fn(async () => {}) })),
}));
vi.mock("../../workers/booking/index", () => ({
  runBookingWorker: vi.fn(async () => {}),
}));

import { createDatabase } from "../../server/db/database";
import { createWorkerApplication } from "../../server/worker-application";
import { runBookingWorker } from "../../workers/booking/index";

const environment = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://onholidai_worker@postgres:5432/onholidai",
  TEMPORAL_ADDRESS: "temporal:7233",
  PROVIDER_MODE: "deterministic",
};

describe("standalone worker composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates only a worker database without web services or secrets", async () => {
    const prerequisites = { read: vi.fn(async () => ({ travellers: null, payment: null })) };
    const application = createWorkerApplication(environment, {
      bookingPrerequisites: prerequisites,
    });
    expect(createDatabase).toHaveBeenCalledExactlyOnceWith({
      connectionString: environment.DATABASE_URL,
      applicationName: "onholidai-booking-worker",
    });
    expect(application.bookingPrerequisites).toBe(prerequisites);
    expect(application).not.toHaveProperty("auth");
    expect(application).not.toHaveProperty("places");
    expect(application).not.toHaveProperty("planningProviders");
    expect(application.config).not.toHaveProperty("BETTER_AUTH_SECRET");
    await Promise.all([application.shutdown(), application.shutdown()]);
    await application.shutdown();
    expect(application.database.destroy).toHaveBeenCalledTimes(1);
  });

  it("validates configuration before allocating resources", () => {
    expect(() => createWorkerApplication({ ...environment, DATABASE_URL: undefined })).toThrow(
      "DATABASE_URL",
    );
    expect(createDatabase).not.toHaveBeenCalled();
  });

  it("surfaces shutdown failures without attempting duplicate cleanup", async () => {
    const application = createWorkerApplication(environment);
    const error = new Error("Database cleanup failed");
    vi.mocked(application.database.destroy).mockRejectedValueOnce(error);
    await expect(application.shutdown()).rejects.toBe(error);
    await expect(application.shutdown()).rejects.toBe(error);
    expect(application.database.destroy).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "runs the production entrypoint and closes its database (worker failure: %s)",
    async (fails) => {
      for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
      for (const key of [
        "BETTER_AUTH_SECRET",
        "BETTER_AUTH_URL",
        "SERVICE_TOKEN_SECRET",
        "PRICING_DIAGNOSTIC_SECRET",
        "SUPPLIER_PROVIDERS",
      ])
        vi.stubEnv(key, undefined);
      vi.resetModules();
      const error = new Error("Temporal startup failed");
      if (fails) vi.mocked(runBookingWorker).mockRejectedValueOnce(error);
      const started = import("../../server/workflows/worker-entry");
      if (fails) await expect(started).rejects.toBe(error);
      else await started;
      expect(runBookingWorker).toHaveBeenCalledTimes(1);
      const database = vi.mocked(createDatabase).mock.results[0].value;
      expect(runBookingWorker).toHaveBeenCalledWith(database, expect.anything(), {
        prerequisites: undefined,
      });
      expect(database.destroy).toHaveBeenCalledTimes(1);
    },
  );
});
