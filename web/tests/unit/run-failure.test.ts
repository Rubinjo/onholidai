// @vitest-environment node
import { expect, it, vi } from "vitest";

import { publicRun } from "../../server/agent-client/results";
import { failureCategory } from "../../server/agent-client/run-repository";

import type { AgentEvent } from "../../../contracts/agent-api/generated";
import type { Kysely } from "kysely";
import type { Database } from "../../server/db/database";

const saved = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../../server/agent-client/run-repository", async (original) => ({
  ...(await original<typeof import("../../server/agent-client/run-repository")>()),
  RunRepository: class {
    read = saved.read;
  },
}));

it.each([
  ["estimate_deadline", "deadline"],
  ["source_unavailable", "source_unavailable"],
  ["invalid_result", "invalid_result"],
  ["estimate_unavailable", "agent_error"],
  [null, "agent_error"],
] as const)("stores %s as the %s category", (safeErrorCode, expected) => {
  expect(failureCategory({ type: "failed", safeErrorCode } as AgentEvent)).toBe(expected);
});

it.each([
  ["invalid_result", "could not be validated"],
  ["agent_error", "unexpected error"],
] as const)("explains a stored %s failure truthfully", async (category, copy) => {
  saved.read.mockResolvedValue({
    id: "run",
    ownerUserId: "owner",
    tripId: "trip",
    status: "failed",
    result: null,
    interruptionReason: null,
  });
  // A read-only double intentionally offers no update/insert methods.
  const database = {
    selectFrom: () => {
      const query = {
        select: () => query,
        where: () => query,
        executeTakeFirstOrThrow: async () => ({ applicationPolicy: "automatic" }),
        executeTakeFirst: async () => ({ errorCategory: category, researchResult: null }),
      };
      return query;
    },
  } as unknown as Kysely<Database>;
  const result = await publicRun(database, "owner", "run");
  expect(result.failure).toEqual({ category, message: expect.stringContaining(copy) });
});
