import { afterEach, expect, it, vi } from "vitest";

import { planningJson, PlanningRequestError } from "../../components/trip-setup/http";

afterEach(() => vi.unstubAllGlobals());

it.each(["seconds", "date"])("preserves Retry-After guidance (%s)", async (format) => {
  const retryAfter = format === "seconds" ? "30" : new Date(Date.now() + 30_000).toUTCString();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { code: "guest_research_limited" },
          { status: 429, headers: { "Retry-After": retryAfter } },
        ),
      ),
  );
  const failure = await planningJson("/api/v1/trips/example/agent-runs", {}).catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(PlanningRequestError);
  expect(failure).toMatchObject({ status: 429, code: "guest_research_limited" });
  expect((failure as PlanningRequestError).retryAfterSeconds).toBeGreaterThan(0);
  expect((failure as PlanningRequestError).retryAfterSeconds).toBeLessThanOrEqual(30);
});
