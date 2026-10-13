export class PlanningRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}
export async function planningJson(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result: unknown = await response.json();
  if (!response.ok) {
    const code = typeof result === "object" && result && "code" in result && typeof result.code === "string" ? result.code : "request_failed";
    throw new PlanningRequestError(response.status, code);
  }
  return result;
}
export function planningError(error: unknown): string {
  if (error instanceof PlanningRequestError && error.status === 401) return "Please sign in, then retry. Your inputs are preserved.";
  if (error instanceof PlanningRequestError && error.status === 409) return "This estimate is stale, expired, or conflicts with current state. Reload and request a new estimate.";
  return "Unable to complete the request. Check your inputs and retry; your saved trip has not been silently changed.";
}
