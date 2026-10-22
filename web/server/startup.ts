import "server-only";
import { startApplication, stopApplication } from "./application";

export function registerNodeStartup(environment: Record<string, string | undefined>): void {
  startApplication(environment);
  const shutdown = () => {
    process.off("SIGTERM", shutdown);
    process.off("SIGINT", shutdown);
    void stopApplication().catch(() => {
      process.stderr.write("Application resource shutdown failed\n");
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
