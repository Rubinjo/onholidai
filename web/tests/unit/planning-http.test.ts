import { afterEach, expect, it, vi } from "vitest";

import { planningJson, PlanningRequestError } from "../../components/trip-setup/http";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(["30", "Tue, 01 Jan 2030 00:00:30 GMT"])(
  "preserves Retry-After guidance (%s)",
  async (retryAfter) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
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
    const request = planningJson("/api/v1/trips/example/agent-runs", {});
    await expect(request).rejects.toBeInstanceOf(PlanningRequestError);
    await expect(request).rejects.toMatchObject({
      status: 429,
      code: "guest_research_limited",
      retryAfterSeconds: 30,
    });
  },
);
