export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerNodeStartup } = await import("./server/startup");
  registerNodeStartup(process.env);
}
