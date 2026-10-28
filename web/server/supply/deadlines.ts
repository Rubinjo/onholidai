// Supplier latency is dominated by supplier-side queue time, not our own work: a live
// Duffel offer request routinely takes five to nine seconds and a Viator product search
// can take forty. Budgets are therefore stated once here and shared by the reader, the
// research request and the agent client so a source is never cut off mid-flight by a
// bound that a different layer assumed was generous.

/** A single supplier HTTP attempt. Retries get their own attempt budget. */
export const SUPPLIER_ATTEMPT_TIMEOUT_MS = 20_000;
/**
 * Per-provider attempt ceiling. Viator answers a single product search in 8-40
 * seconds, so a shared twenty-second attempt would always abort a healthy read.
 */
export const PROVIDER_ATTEMPT_TIMEOUT_MS: Readonly<Record<string, number>> = {
  viator: 50_000,
};
/** Attempts per supplier request, including the first. */
export const SUPPLIER_ATTEMPTS = 3;
/** Exponential backoff for transient failures, before jitter. */
export const SUPPLIER_RETRY_BASE_MS = 500;
export const SUPPLIER_RETRY_MAX_MS = 6_000;
/** A hard ceiling for any single attempt, whatever a caller asks for. */
export const SUPPLIER_ATTEMPT_CEILING_MS = 60_000;

/**
 * Total wall clock for one product search, covering every call the provider needs
 * (place resolution, search, paging). Duffel needs two sequential calls after a
 * place lookup; Viator serves a single very slow search.
 */
const providerSearchBudgets: Readonly<Record<string, number>> = {
  duffel: 35_000,
  nuitee: 30_000,
  viator: 50_000,
};
export const DEFAULT_PROVIDER_SEARCH_BUDGET_MS = 30_000;

export function providerSearchBudgetMs(provider: string): number {
  return providerSearchBudgets[provider] ?? DEFAULT_PROVIDER_SEARCH_BUDGET_MS;
}

export function providerAttemptTimeoutMs(provider: string): number {
  return PROVIDER_ATTEMPT_TIMEOUT_MS[provider] ?? SUPPLIER_ATTEMPT_TIMEOUT_MS;
}

/**
 * Wall clock for a whole research request. Providers run in parallel, so this only
 * has to exceed the slowest provider budget plus persistence overhead.
 */
export const RESEARCH_BUDGET_MS = 65_000;

/** Exponential backoff with jitter; a supplier Retry-After wins when it is longer. */
export function retryDelayMs(attempt: number, retryAfterMs?: number | null): number {
  const exponential = Math.min(SUPPLIER_RETRY_MAX_MS, SUPPLIER_RETRY_BASE_MS * 2 ** (attempt - 1));
  const jittered = exponential * (0.75 + Math.random() * 0.5);
  return Math.round(Math.max(retryAfterMs ?? 0, jittered));
}
