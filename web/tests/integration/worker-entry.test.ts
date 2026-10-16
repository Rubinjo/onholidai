// @vitest-environment node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hasIsolatedDatabaseConfiguration, withIsolatedTestDatabase } from "../helpers/database";
import { withTemporalTestEnvironment } from "../helpers/temporal";

const describeWithDatabase = hasIsolatedDatabaseConfiguration() ? describe : describe.skip;
describeWithDatabase("standalone booking worker", () => {
  it("registers the preload hooks and starts the actual entrypoint against isolated services", async () => {
    await withIsolatedTestDatabase(async (database) => withTemporalTestEnvironment(async (temporal) => {
      const child = spawn(process.execPath, ["--conditions=react-server", "--experimental-transform-types", "--import", "./server/workflows/alias-loader.mjs", "server/workflows/worker-entry.ts"], {
        cwd: fileURLToPath(new URL("../../", import.meta.url)), windowsHide: true,
        env: { ...process.env, NODE_ENV: "test", PROVIDER_MODE: "deterministic", DATABASE_URL: database.workerConnectionString, TEMPORAL_ADDRESS: temporal.address, TEMPORAL_BOOKING_TASK_QUEUE: "standalone-entry-test" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`Worker did not start: ${output}`)), 30000);
          const read = (chunk: Buffer) => {
            output += chunk.toString();
            if (/state.*RUNNING/.test(output)) { clearTimeout(timer); resolve(); }
          };
          child.stdout.on("data", read); child.stderr.on("data", read);
          child.once("error", (error) => { clearTimeout(timer); reject(error); });
          child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Worker exited ${code}: ${output}`)); });
        });
        expect(output).not.toMatch(/Application startup has not completed|ERR_MODULE_NOT_FOUND/);
      } finally {
        if (child.exitCode === null) {
          const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
          child.kill("SIGTERM"); await exited;
        }
      }
    }));
  }, 60000);
});
