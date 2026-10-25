// @vitest-environment node
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";
import { expect, it, vi } from "vitest";

import { dispatchEstimate } from "../../server/agent-client/client";
import { createApplication } from "../../server/application";

import type { AgentRun } from "../../../contracts/agent-api/generated";
import type { Database } from "../../server/db/database";

vi.mock("server-only", () => ({}));
vi.mock("../../server/auth/auth", () => ({ createAuth: vi.fn() }));
vi.mock("../../server/auth/planning-resource", () => ({ lockServiceGrant: vi.fn() }));
vi.mock("../../domain/trip/read", () => ({
  readAgentTrip: async (_database: unknown, _owner: string, tripId: string, version: number) => ({
    tripId,
    version,
  }),
}));

it.each([
  "acknowledged",
  "connection failure",
  "timeout",
  "HTTP failure",
  "invalid JSON",
  "invalid shape",
  "wrong identity",
  "already running",
])("dispatches reserved work and handles %s explicitly", async (scenario) => {
  const root = createApplication({ NODE_ENV: "test", AGENT_BASE_URL: "http://agent:8000" });
  const database = new Kysely<Database>({
    dialect: {
      createDriver: () => new DummyDriver(),
      createAdapter: () => new PostgresAdapter(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (db) => new PostgresIntrospector(db),
    },
    plugins: [
      {
        transformQuery: ({ node }) => node,
        transformResult: async () => ({ rows: [{ content: {} }] }),
      },
    ],
  });
  const run: AgentRun & { ownerUserId: string } = {
    id: crypto.randomUUID(),
    ownerUserId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    tripId: crypto.randomUUID(),
    conversationId: crypto.randomUUID(),
    baseTripVersion: 1,
    purpose: "initial_estimate",
    status: scenario === "already running" ? "running" : "queued",
    nextEventCursor: 0,
    createdAt: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + 90_000).toISOString(),
    lastDurableProgressAt: null,
    completedAt: null,
    interruptionReason: null,
    result: null,
  };
  const transport = vi.fn<typeof fetch>(async () => {
    if (scenario === "connection failure") throw new TypeError("private network details");
    if (scenario === "timeout") throw new DOMException("private timeout details", "TimeoutError");
    if (scenario === "HTTP failure")
      return new Response("private upstream details", { status: 500 });
    if (scenario === "invalid JSON") return new Response("<html>not an acknowledgement</html>");
    if (scenario === "invalid shape") return Response.json({});
    const { ownerUserId: _owner, ...acknowledgement } = run;
    void _owner;
    return Response.json({
      ...acknowledgement,
      ...(scenario === "wrong identity" ? { tripId: crypto.randomUUID() } : {}),
    });
  });
  try {
    const result = dispatchEstimate({ ...root, database }, run, "Estimate my trip", transport);
    if (["acknowledged", "already running"].includes(scenario))
      await expect(result).resolves.toBeUndefined();
    else
      await expect(result).rejects.toMatchObject(
        ["connection failure", "timeout", "HTTP failure"].includes(scenario)
          ? { status: 503, code: "agent_unavailable" }
          : { status: 502, code: "invalid_agent_response" },
      );
    expect(transport).toHaveBeenCalledTimes(scenario === "already running" ? 0 : 1);
    if (scenario !== "already running") {
      const [url, options] = transport.mock.calls[0];
      expect(String(url)).toBe("http://agent:8000/internal/v1/agent-runs");
      expect(options?.method).toBe("POST");
      expect(JSON.parse(String(options?.body))).toMatchObject({
        requestId: run.requestId,
        actor: { tripId: run.tripId, baseTripVersion: 1 },
        message: "Estimate my trip",
      });
    }
  } finally {
    await Promise.all([root.shutdown(), database.destroy()]);
  }
});
