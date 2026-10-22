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
  kind: string;
  input: unknown;
  expectedCode: string;
  expected: { disclosed: boolean; finalizationBlocked: boolean; disposition: string };
}

interface EvaluationCorpus {
  metadata: { corpusVersion: string; policyVersion: string; seed: string; corpusHash: string };
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
  const report = evaluateFeasibility(snapshot);
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
    const deviations = scored
      .filter(
        ({ entry, outcomes }) =>
          JSON.stringify(outcomes) !== JSON.stringify(entry.expectedItemResults),
      )
      .map(({ entry, outcomes }) => ({
        id: entry.id,
        expected: entry.expectedItemResults,
        scored: outcomes,
      }));
    expect(deviations).toEqual([]);
  });

  it("blocks and discloses every frozen hard-conflict case", async () => {
    const corpus = await readCorpus();
    const results = corpus.hardConflicts.map((entry) => {
      // The policy also guards stored/legacy state, so it is evaluated on the raw case input.
      const report = evaluateFeasibility(entry.input as TripSnapshot);
      return {
        id: entry.id,
        kind: entry.kind,
        expectedCode: entry.expectedCode,
        codes: report.blocking.map((issue) => issue.code),
        disclosed: report.blocking.every((issue) => issue.message.trim().length > 0),
        storable: tripSnapshotSchema.safeParse(entry.input).success,
      };
    });

    expect(corpus.hardConflicts).toHaveLength(20);
    expect(results.every((result) => result.codes.includes(result.expectedCode))).toBe(true);
    expect(results.every((result) => result.disclosed)).toBe(true);
    // finalizeTrip never commits a version while any blocking issue exists.
    expect(results.every((result) => result.codes.length > 0)).toBe(true);
    // Every conflict, including the date-window violation, is a storable snapshot that the
    // policy reports rather than one the schema rejects before review.
    expect(results.every((result) => result.storable)).toBe(true);
  });
});
