// @vitest-environment node
import { expect, it, vi } from "vitest";

import { publicRun } from "../../server/agent-client/results";

import type { Kysely } from "kysely";
import type { Database } from "../../server/db/database";

const saved = vi.hoisted(() => ({ read: vi.fn(), proposal: vi.fn() }));
vi.mock("../../server/agent-client/run-repository", () => ({
  RunRepository: class {
    read = saved.read;
  },
}));
vi.mock("../../server/db/proposal-repository", () => ({
  ProposalRepository: class {
    read = saved.proposal;
  },
}));

it.each([true, false])(
  "returns only the durable automatic outcome, not a complete proposed trip (applied=%s)",
  async (applied) => {
    saved.read.mockResolvedValue({
      id: "run",
      ownerUserId: "owner",
      tripId: "trip",
      status: "proposed",
      result: {
        kind: "proposal",
        proposal: {
          id: "proposal",
          previewSnapshot: { secret: "full snapshot must not be delivered" },
        },
      },
    });
    // A read-only double intentionally offers no update/insert methods.
    const database = {
      selectFrom: (table: string) => {
        const query = {
          select: () => query,
          where: () => query,
          executeTakeFirstOrThrow: async () => ({ applicationPolicy: "automatic" }),
          executeTakeFirst: async () =>
            table === "tripVersions" && applied
              ? { changeSummary: ["Kyoto stay extended by one night."] }
              : undefined,
        };
        return query;
      },
    } as unknown as Kysely<Database>;
    const result = await publicRun(database, "owner", "run");
    expect(result.result).toEqual({
      kind: "answer",
      message: applied
        ? "Kyoto stay extended by one night."
        : expect.stringContaining("did not change"),
    });
    expect(JSON.stringify(result)).not.toMatch(/previewSnapshot|secret|ownerUserId/);
    expect(saved.proposal).not.toHaveBeenCalled();
  },
);
