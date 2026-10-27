// @vitest-environment node
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { evaluateFeasibility } from "../../domain/trip/feasibility";
import { tripSnapshotSchema, type TripSnapshot } from "../../domain/trip/schema";

interface ItineraryCase {
  id: string;
  input: unknown;
  expectedPassingItems: number;
  expectedItemResults: Array<"pass" | "fail">;
}

interface HardConflictCase {
  id: string;
  input: unknown;
  expectedCode: string;
}

interface EvaluationCorpus {
  itineraryDays: ItineraryCase[];
  hardConflicts: HardConflictCase[];
}

async function readCorpus(): Promise<EvaluationCorpus> {
  return JSON.parse(
    await readFile(join(process.cwd(), "tests/fixtures/evaluation-corpus.json"), "utf8"),
  ) as EvaluationCorpus;
}

// An item passes when the feasibility policy raises no blocking issue against it.
function scoreItems(snapshot: TripSnapshot) {
  const report = evaluateFeasibility(snapshot, new Date("2029-01-01T00:00:00Z"));
  const failed = new Set(report.blocking.flatMap((issue) => issue.relatedIds));
  const items = snapshot.itineraryDays.flatMap((day) => day.items);
  return {
    report,
    items,
    outcomes: items.map((item) => (failed.has(item.id) ? "fail" : "pass") as "pass" | "fail"),
  };
}

describe("finalization evaluation corpus", () => {
  it("scores the frozen 100-day/500-item corpus at or above the SC-007 threshold", async () => {
    const corpus = await readCorpus();
    const scored = corpus.itineraryDays.map((entry) => ({
      entry,
      ...scoreItems(tripSnapshotSchema.parse(entry.input)),
    }));
    const totalItems = scored.reduce((total, entry) => total + entry.items.length, 0);
    const passingItems = scored.reduce(
      (total, entry) => total + entry.outcomes.filter((outcome) => outcome === "pass").length,
      0,
    );

    expect(corpus.itineraryDays).toHaveLength(100);
    expect(totalItems).toBe(500);
    expect(passingItems).toBeGreaterThanOrEqual(475);

    // The frozen per-item labels are the reviewed oracle for this corpus revision.
    for (const { entry, items, outcomes, report } of scored) {
      expect(outcomes, entry.id).toEqual(entry.expectedItemResults);
      expect(report.totalItems, entry.id).toBe(items.length);
      expect(report.verifiedItems, entry.id).toBe(entry.expectedPassingItems);
    }
    expect(
      scored.reduce((total, { report }) => total + report.verifiedItems, 0),
    ).toBeGreaterThanOrEqual(475);
  });

  it("blocks and discloses every frozen hard-conflict case", async () => {
    const corpus = await readCorpus();
    expect(corpus.hardConflicts).toHaveLength(20);
    for (const entry of corpus.hardConflicts) {
      // The policy also guards stored/legacy state, so it is evaluated on the raw case input.
      const report = evaluateFeasibility(entry.input as TripSnapshot);
      expect(
        report.blocking.map((issue) => issue.code),
        entry.id,
      ).toContain(entry.expectedCode);
      for (const issue of report.blocking) {
        expect(issue.message.trim(), entry.id).not.toBe("");
      }
      expect(tripSnapshotSchema.safeParse(entry.input).success, entry.id).toBe(true);
    }
  });
});
