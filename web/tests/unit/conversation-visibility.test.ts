// @vitest-environment node
import {
  CamelCasePlugin,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";
import { expect, it, vi } from "vitest";

import { ConversationRepository } from "../../server/db/conversation-repository";

import type { Database } from "../../server/db/database";

vi.mock("../../domain/trip/read", () => ({ readTrip: vi.fn() }));
vi.mock("../../server/privacy/retention", () => ({
  expireRawConversationMessages: vi.fn(),
}));

it("excludes internal supplier messages before pagination while retaining chat without a run", async () => {
  const queries: { sql: string; parameters: readonly unknown[] }[] = [];
  const database = new Kysely<Database>({
    dialect: {
      createDriver: () => new DummyDriver(),
      createAdapter: () => new PostgresAdapter(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (db) => new PostgresIntrospector(db),
    },
    plugins: [new CamelCasePlugin()],
    log(event) {
      if (event.level === "query") queries.push(event.query);
    },
  });
  try {
    await new ConversationRepository(database).messages(
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
      200,
    );
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain(
      'left join "agent_runs" on "agent_runs"."id" = "conversation_messages"."agent_run_id"',
    );
    expect(queries[0].sql).toMatch(
      /where .*and \("agent_runs"\."purpose" is null or "agent_runs"\."purpose" != \$\d+\) order by .*limit/,
    );
    expect(queries[0].parameters).toContain("supplier_research");
  } finally {
    await database.destroy();
  }
});
