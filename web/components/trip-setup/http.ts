export class PlanningRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "PlanningRequestError";
  }
}
export async function planningJson(
  path: string,
  body?: unknown,
  method?: "POST" | "PATCH",
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    cache: "no-store",
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const code =
      typeof result === "object" && result && "code" in result && typeof result.code === "string"
        ? result.code
        : "request_failed";
    const retryAfter = response.headers.get("Retry-After");
    const seconds = retryAfter
      ? /^\d+$/.test(retryAfter)
        ? Number(retryAfter)
        : Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000)
      : NaN;
    throw new PlanningRequestError(
      response.status,
      code,
      Number.isFinite(seconds) ? Math.max(0, seconds) : undefined,
    );
  }
  return result;
}
export function planningError(error: unknown): string {
  if (error instanceof PlanningRequestError && error.code === "booking_intent_expired")
    return "This booking continuation expired. Return to planning and open a new continuation; your saved trip is preserved.";
  if (error instanceof PlanningRequestError && error.code === "authentication_required")
    return "Sign in to continue this booking review. Guest planning remains available.";
  if (error instanceof PlanningRequestError && [401, 404].includes(error.status))
    return "Access to this private plan is unavailable or expired. Guest recovery needs the same browser with an active session. Your unsaved inputs remain here.";
  if (error instanceof PlanningRequestError && error.status === 429)
    return "Research is temporarily limited. Wait before retrying and answer any pending questions in your other trips; no account or subscription is needed.";
  if (error instanceof PlanningRequestError && error.code === "agent_unavailable")
    return "The research service could not confirm your request. Retry the same update; your saved trip and message are preserved.";
  if (error instanceof PlanningRequestError && error.code === "draft_revision_conflict")
    return "Another tab saved changes. Compare the saved draft before replacing anything. Your local edits are preserved.";
  if (error instanceof PlanningRequestError && error.status === 409)
    return "This estimate is stale, expired, or conflicts with current state. Reload and request a new estimate.";
  return "Unable to complete the request. Check your inputs and retry; your saved trip has not been silently changed.";
}
