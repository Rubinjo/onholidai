// Queued/running work must renew this lease or it becomes failed/interrupted.
export const AGENT_LEASE_MS = 90_000;
// A clarification suspends the lease until the user resumes it. Bound that
// suspension so one abandoned question cannot hold concurrency indefinitely.
export const CLARIFICATION_IDLE_MS = 24 * 60 * 60 * 1000;
