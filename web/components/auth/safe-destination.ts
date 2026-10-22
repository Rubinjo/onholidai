export function safeAuthDestination(intentId?: string, redirectTo?: string): string {
  if (
    intentId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(intentId)
  )
    return `/auth/continue?intentId=${intentId}`;
  if (!redirectTo?.startsWith("/") || redirectTo.startsWith("//") || redirectTo.includes("\\"))
    return "/";
  try {
    const url = new URL(redirectTo, "https://onholidai.invalid");
    return url.origin === "https://onholidai.invalid"
      ? `${url.pathname}${url.search}${url.hash}`
      : "/";
  } catch {
    return "/";
  }
}
