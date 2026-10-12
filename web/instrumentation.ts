export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startApplication, stopApplication } = await import("./server/application");
  startApplication(process.env);
  const shutdown = () => {
    process.off("SIGTERM", shutdown);
    process.off("SIGINT", shutdown);
    void stopApplication().catch(() => {
      // Never emit configuration or driver error payloads during shutdown.
      process.stderr.write("Application resource shutdown failed\n");
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
