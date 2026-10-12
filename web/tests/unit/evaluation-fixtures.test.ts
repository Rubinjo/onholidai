import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { tripSnapshotSchema } from "../../domain/trip/schema";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { hasIsolatedDatabaseConfiguration } from "../helpers/database";
import {
  createTemporalTestEnvironment,
  withTemporalTestEnvironment,
} from "../helpers/temporal";

const corpusPath = join(process.cwd(), "tests/fixtures/evaluation-corpus.json");
const agentCorpusPath = join(
  process.cwd(),
  "../agent/tests/fixtures/evaluation-corpus.json",
);
const payloadKeys = [
  "estimates",
  "unambiguousRequests",
  "ambiguities",
  "itineraryDays",
  "hardConflicts",
] as const;

interface EvaluationCorpus {
  metadata: {
    corpusVersion: string;
    policyVersion: string;
    seed: string;
    corpusHash: string;
    changeControl: {
      reviewedReasonRequired: boolean;
      reviewedReason: string;
    };
  };
  estimates: Array<{ categories: string[] }>;
  unambiguousRequests: Array<{ group: string }>;
  ambiguities: unknown[];
  itineraryDays: Array<{ items: unknown[] }>;
  hardConflicts: unknown[];
}

async function readCorpus(): Promise<EvaluationCorpus> {
  return JSON.parse(await readFile(corpusPath, "utf8")) as EvaluationCorpus;
}

describe("evaluation policy v1 fixtures", () => {
  it("keeps byte-identical corpora with a reproducible payload hash", async () => {
    const webCorpus = await readFile(corpusPath, "utf8");
    const agentCorpus = await readFile(agentCorpusPath, "utf8");
    const corpus = JSON.parse(webCorpus) as EvaluationCorpus & Record<string, unknown>;
    const payload = Object.fromEntries(payloadKeys.map((key) => [key, corpus[key]]));
    const hash = `sha256:${createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex")}`;

    expect(webCorpus).toBe(agentCorpus);
    expect(corpus.metadata).toMatchObject({
      corpusVersion: "1.0.0",
      policyVersion: "1",
      seed: "onholidai-evaluation-v1-seed-20261011",
      corpusHash: hash,
      changeControl: {
        reviewedReasonRequired: true,
        reviewedReason: expect.stringMatching(/\S/),
      },
    });
  });

  it("contains every exact denominator and required category coverage", async () => {
    const corpus = await readCorpus();
    const itemCount = corpus.itineraryDays.reduce(
      (total, day) => total + day.items.length,
      0,
    );

    expect(corpus.estimates).toHaveLength(100);
    for (const category of [
      "origin",
      "date_flexibility",
      "party_eligibility",
      "style",
      "required_constraints",
    ]) {
      expect(
        corpus.estimates.filter(({ categories }) => categories.includes(category)),
      ).toHaveLength(40);
    }
    expect(corpus.unambiguousRequests).toHaveLength(100);
    for (const group of [
      "destinations",
      "dates_duration",
      "travellers",
      "preferences",
      "constraints",
    ]) {
      expect(corpus.unambiguousRequests.filter((request) => request.group === group)).toHaveLength(20);
    }
    expect(corpus.ambiguities).toHaveLength(20);
    expect(corpus.itineraryDays).toHaveLength(100);
    expect(itemCount).toBe(500);
    expect(corpus.hardConflicts).toHaveLength(20);
  });

  it("contains no customer or payment data", async () => {
    const serialized = await readFile(corpusPath, "utf8");

    expect(serialized).not.toMatch(/\b(?:email|phone|passport|payment|cardNumber|cvv)\b/i);
    expect(serialized).not.toMatch(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    expect(serialized).not.toMatch(/(?:\d[ -]*?){13,19}/);
  });

  it("provides valid isolated trip data and side-effect-free helper imports", () => {
    expect(tripSnapshotSchema.parse(createSyntheticTripSnapshot())).toBeDefined();
    expect(typeof hasIsolatedDatabaseConfiguration()).toBe("boolean");
    expect(createTemporalTestEnvironment).toBeTypeOf("function");
    expect(withTemporalTestEnvironment).toBeTypeOf("function");
  });
});