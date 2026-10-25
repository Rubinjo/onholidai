// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";

import { POST } from "../../app/api/v1/trips/[tripId]/agent-runs/route";
import { ProblemError } from "../../server/errors";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  reserve: vi.fn(),
  publicRun: vi.fn(),
  application: { database: {}, config: { GUEST_MAX_ACTIVE_RUNS: 2, GUEST_MAX_RUNS_PER_HOUR: 10 } },
}));
vi.mock("server-only", () => ({}));
vi.mock("../../server/application", () => ({ getApplication: () => mocks.application }));
vi.mock("../../server/api", async (original) => ({
  ...(await original<typeof import("../../server/api")>()),
  planningUser: async () => ({ actor: {}, id: "10000000-0000-4000-8000-000000000001" }),
}));
vi.mock("../../server/db/transaction", () => ({
  inTransaction: async (database: unknown, action: (value: unknown) => unknown) => action(database),
}));
vi.mock("../../server/db/planning-access", () => ({ lockPlanningAccess: vi.fn() }));
vi.mock("../../server/agent-client/run-repository", () => ({
  RunRepository: class {
    reserve = mocks.reserve;
  },
}));
vi.mock("../../server/agent-client/client", () => ({ dispatchEstimate: mocks.dispatch }));
vi.mock("../../server/agent-client/results", () => ({ publicRun: mocks.publicRun }));
afterEach(() => vi.resetAllMocks());

it.each(["outage", "rate limit", "acknowledged"])(
  "handles %s at the run boundary",
  async (scenario) => {
    const run = { id: crypto.randomUUID(), status: "queued" };
    mocks.reserve.mockResolvedValue(run);
    mocks.publicRun.mockResolvedValue(run);
    if (scenario === "outage")
      mocks.dispatch.mockRejectedValue(
        new ProblemError({
          title: "Research service unavailable",
          status: 503,
          code: "agent_unavailable",
        }),
      );
    if (scenario === "rate limit")
      mocks.reserve.mockRejectedValue(
        new ProblemError({
          title: "Guest research limit reached",
          status: 429,
          code: "guest_research_limited",
          retryAfterSeconds: 30,
        }),
      );
    const response = await POST(
      new Request("http://localhost/api/v1/trips/example/agent-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          baseTripVersion: 1,
          message: "Estimate my trip",
          purpose: "initial_estimate",
        }),
      }),
      { params: Promise.resolve({ tripId: crypto.randomUUID() }) },
    );
    expect(mocks.dispatch).toHaveBeenCalledTimes(scenario === "rate limit" ? 0 : 1);
    expect(response.status).toBe(
      scenario === "outage" ? 503 : scenario === "rate limit" ? 429 : 202,
    );
    if (scenario === "acknowledged") {
      expect(await response.json()).toEqual(run);
      expect(mocks.publicRun).toHaveBeenCalledOnce();
    } else {
      expect(await response.json()).toMatchObject({
        code: scenario === "outage" ? "agent_unavailable" : "guest_research_limited",
      });
      expect(mocks.publicRun).not.toHaveBeenCalled();
    }
    if (scenario === "rate limit") expect(response.headers.get("Retry-After")).toBe("30");
  },
);
