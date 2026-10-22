// @vitest-environment node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import prettier from "prettier";
import { describe, expect, it } from "vitest";

import * as validators from "../../../contracts/agent-api/generated.zod";
import cases from "../../../contracts/agent-api/validation-cases.json";
import { generateAgentContracts } from "../../scripts/generate-agent-contracts";
import { contractRulesSatisfied } from "../../../contracts/agent-api/validation";

import type { z } from "zod";

describe("generated agent contract behavior", () => {
  it("accepts scoped historical summaries but rejects future-version provenance", () => {
    const request = cases.cases.find((scenario) => scenario.name === "first-run")!.value;
    const context = {
      tripSummary: { version: 3 },
      contextBudget: { maximumTokens: 12000 },
      conversationSummary: { sourceTripVersion: 2 },
    };
    expect(validators.CreateAgentRunRequestSchema.safeParse({ ...request, context }).success).toBe(
      true,
    );
    expect(
      validators.CreateAgentRunRequestSchema.safeParse({
        ...request,
        context: {
          ...context,
          conversationSummary: { sourceTripVersion: 4 },
        },
      }).success,
    ).toBe(false);
  });
  it("rejects deeply nested JSON before recursive validation or serialization can exhaust the stack", () => {
    let value: unknown = null;
    for (let depth = 0; depth < 10000; depth += 1) value = { child: value };
    expect(contractRulesSatisfied(value, { "x-json-bound": { bytes: 65536, depth: 16 } }, [])).toBe(
      false,
    );
    expect(
      validators.DraftOperationSchema.safeParse({
        operation: "replace",
        target: "/preferences",
        value,
      }).success,
    ).toBe(false);
  });
  it("counts Unicode characters consistently with Pydantic", () => {
    const request = cases.cases.find((scenario) => scenario.name === "first-run")!.value;
    expect(
      validators.CreateAgentRunRequestSchema.safeParse({ ...request, message: "🙂".repeat(12000) })
        .success,
    ).toBe(true);
    expect(
      validators.CreateAgentRunRequestSchema.safeParse({ ...request, message: "🙂".repeat(12001) })
        .success,
    ).toBe(false);
  });
  for (const scenario of cases.cases) {
    it(scenario.name, () => {
      const validator = (validators as Record<string, z.ZodType<unknown>>)[
        `${scenario.model}Schema`
      ];
      expect(validator).toBeDefined();
      expect(validator.safeParse(scenario.value).success).toBe(scenario.valid);
    });
  }

  it("reproduces committed types and validators deterministically", async () => {
    const root = new URL("../../../contracts/agent-api/", import.meta.url);
    const generated = generateAgentContracts(
      JSON.parse(await readFile(new URL("openapi.yaml", root), "utf8")),
      JSON.parse(await readFile(new URL("tools.schema.json", root), "utf8")),
    );
    for (const [name, content] of [
      ["generated.ts", generated.types],
      ["generated.zod.ts", generated.zod],
    ]) {
      const path = new URL(name, root);
      const formatted = await prettier.format(content, {
        ...(await prettier.resolveConfig(path)),
        filepath: fileURLToPath(path),
      });
      expect(formatted).toBe((await readFile(path, "utf8")).replaceAll("\r\n", "\n"));
    }
  });

  it("fails closed on unsupported schema rules instead of emitting permissive validators", () => {
    const tools = { $defs: {}, "x-protected-draft-keys": [] };
    expect(() =>
      generateAgentContracts(
        {
          components: { schemas: { Broken: { type: "string", inventedRule: true } } },
          "x-protected-draft-keys": [],
        },
        tools,
      ),
    ).toThrow("Unsupported schema keyword");
    expect(() =>
      generateAgentContracts(
        {
          components: {
            schemas: {
              Broken: {
                type: "object",
                properties: {},
                additionalProperties: false,
                allOf: [{ if: { type: "object" }, then: { inventedRule: true } }],
              },
            },
          },
          "x-protected-draft-keys": [],
        },
        tools,
      ),
    ).toThrow("Unsupported conditional rule");
  });
});
