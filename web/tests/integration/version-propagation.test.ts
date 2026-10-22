// @vitest-environment node
import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { researchDraftImpact } from "../../domain/trip/edit";
import { tripSnapshotSchema } from "../../domain/trip/schema";
import { createPlanningProviders } from "../../server/supply/providers";

vi.mock("server-only", () => ({}));

describe("frozen refinements validate as coherent authoritative candidates", () => {
  it("recalculates every corpus operation with integer totals and preserved required constraints", async () => {
    const corpus = JSON.parse(await readFile("tests/fixtures/evaluation-corpus.json", "utf8")) as {
      unambiguousRequests: {
        id: string;
        input: { version: number; snapshot: unknown };
        expected: { operations: unknown[] };
      }[];
    };
    for (const scenario of corpus.unambiguousRequests) {
      const base = tripSnapshotSchema.parse(scenario.input.snapshot),
        before = structuredClone(base);
      const review = await researchDraftImpact(
        base,
        scenario.input.version,
        scenario.expected.operations,
        createPlanningProviders("deterministic"),
      );
      expect(base, scenario.id).toEqual(before);
      expect(review.snapshot.price.finalCustomerTotal.minorUnits, scenario.id).toBe(
        review.snapshot.components.reduce(
          (sum, entry) => sum + entry.price.finalCustomerAmount.minorUnits,
          0,
        ),
      );
      for (const constraint of before.constraints)
        expect(review.snapshot.constraints, scenario.id).toContainEqual(constraint);
      expect(JSON.stringify(review.previewSnapshot), scenario.id).not.toMatch(
        /supplierAmount|platformMargin/,
      );
      expect(review.affectedFacts, scenario.id).toContain("price");
    }
  }, 30000);
});
