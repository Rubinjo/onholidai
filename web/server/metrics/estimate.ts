export interface EstimateMeasurement {
  outcome: "proposed" | "failed" | "clarification";
  elapsedMs: number;
  clarificationWaitMs: number;
  requiredCount: number;
  accountedCount: number;
}
export function measureEstimates(samples: readonly EstimateMeasurement[]) {
  if (!samples.length)
    throw new Error("Estimate measurement requires a failure-inclusive denominator");
  const durations = samples
    .map((sample) => {
      if (
        !Number.isFinite(sample.elapsedMs) ||
        !Number.isFinite(sample.clarificationWaitMs) ||
        sample.clarificationWaitMs < 0 ||
        sample.elapsedMs < sample.clarificationWaitMs ||
        sample.requiredCount < 0 ||
        sample.accountedCount < 0 ||
        sample.accountedCount > sample.requiredCount
      )
        throw new Error("Invalid estimate measurement");
      return sample.elapsedMs - sample.clarificationWaitMs;
    })
    .sort((left, right) => left - right);
  return {
    denominator: samples.length,
    p95Ms: durations[Math.ceil(durations.length * 0.95) - 1],
    withinBudgetCount: samples.filter(
      (sample) =>
        sample.outcome === "proposed" && sample.elapsedMs - sample.clarificationWaitMs <= 30000,
    ).length,
    requiredCount: samples.reduce((count, sample) => count + sample.requiredCount, 0),
    accountedCount: samples.reduce((count, sample) => count + sample.accountedCount, 0),
  };
}
