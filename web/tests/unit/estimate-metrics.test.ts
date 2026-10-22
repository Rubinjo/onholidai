import { describe, expect, it } from "vitest";

import { measureEstimates } from "../../server/metrics/estimate";
import { currencySchema } from "../../domain/trip/schema";

describe("estimate evidence", () => {
  it("retains failed requests in the deadline denominator and excludes only clarification waits", () => {
    expect(
      measureEstimates([
        {
          outcome: "proposed",
          elapsedMs: 60000,
          clarificationWaitMs: 59000,
          requiredCount: 2,
          accountedCount: 2,
        },
        {
          outcome: "failed",
          elapsedMs: 30001,
          clarificationWaitMs: 0,
          requiredCount: 1,
          accountedCount: 0,
        },
      ]),
    ).toEqual({
      denominator: 2,
      p95Ms: 30001,
      withinBudgetCount: 1,
      requiredCount: 3,
      accountedCount: 2,
    });
    expect(() => measureEstimates([])).toThrow();
  });
  it("rejects syntactically plausible but unrecognized currencies", () => {
    expect(currencySchema.safeParse("XYZ").success).toBe(false);
    expect(currencySchema.safeParse("EUR").success).toBe(true);
  });
});
