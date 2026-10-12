import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const CORPUS_VERSION = "1.0.0";
const POLICY_VERSION = "1";
const SEED = "onholidai-evaluation-v1-seed-20261011";
const estimateCategories = [
  "origin",
  "date_flexibility",
  "party_eligibility",
  "style",
  "required_constraints",
];
const refinementGroups = [
  "destinations",
  "dates_duration",
  "travellers",
  "preferences",
  "constraints",
];

function id(prefix, value) {
  return `${prefix}-${String(value).padStart(3, "0")}`;
}

function dateForDay(index) {
  const date = new Date(Date.UTC(2030, 4, 1 + index));
  return date.toISOString().slice(0, 10);
}

const estimates = Array.from({ length: 100 }, (_, index) => {
  const caseNumber = index + 1;
  const primaryCategory = estimateCategories[index % estimateCategories.length];
  const secondaryCategory = estimateCategories[(index + 2) % estimateCategories.length];

  return {
    id: id("estimate", caseNumber),
    categories: [primaryCategory, secondaryCategory],
    input: {
      origin: caseNumber % 2 === 0 ? "GB-LON" : "GB-MAN",
      destinations: caseNumber % 3 === 0 ? ["PT-LIS", "PT-OPO"] : ["PT-LIS"],
      startDate: `2030-0${(caseNumber % 8) + 1}-10`,
      flexibilityDays: caseNumber % 4,
      durationDays: 5 + (caseNumber % 5),
      adults: 1 + (caseNumber % 3),
      childAges: caseNumber % 5 === 0 ? [10] : [],
      style: [
        20 + (caseNumber % 70),
        30 + (caseNumber % 60),
        40 + (caseNumber % 50),
        50,
        60,
      ],
      requiredConstraint: `synthetic-required-constraint-${(caseNumber % 10) + 1}`,
    },
    expected: {
      outcome: "proposal",
      originConfirmed: true,
      requiredConstraintDisposition: "accounted_for",
      durationDays: 5 + (caseNumber % 5),
      timeLimitSeconds: 60,
    },
  };
});

const unambiguousRequests = refinementGroups.flatMap((group) =>
  Array.from({ length: 20 }, (_, index) => ({
    id: `${group}-${String(index + 1).padStart(2, "0")}`,
    group,
    request: `Apply synthetic ${group} refinement ${index + 1}`,
    expected: {
      clarificationRequired: false,
      operation: `replace_${group}`,
      target: `synthetic-${group}-target-${index + 1}`,
    },
  })),
);

const ambiguities = Array.from({ length: 20 }, (_, index) => {
  const group = refinementGroups[index % refinementGroups.length];
  return {
    id: id("ambiguity", index + 1),
    group,
    request: `Use the other synthetic ${group} option ${Math.floor(index / 5) + 1}`,
    expected: {
      clarificationRequired: true,
      focus: group,
      reason: "multiple_material_interpretations",
    },
  };
});

const itineraryDays = Array.from({ length: 100 }, (_, dayIndex) => {
  const date = dateForDay(dayIndex);
  const hasPolicyFailure = dayIndex < 20;
  const items = Array.from({ length: 5 }, (_, itemIndex) => ({
    id: `${id("day", dayIndex + 1)}-item-${itemIndex + 1}`,
    type: ["meal", "activity", "free_time", "activity", "meal"][itemIndex],
    startLocal: [`08:00`, `09:00`, `12:00`, `13:00`, `18:00`][itemIndex],
    endLocal: [`08:45`, `11:00`, `13:00`, `15:00`, `18:45`][itemIndex],
    expectedPolicyResult:
      hasPolicyFailure && itemIndex === 3 ? "fail" : "pass",
    evidence:
      hasPolicyFailure && itemIndex === 3
        ? "synthetic activity exceeds predetermined pace allowance"
        : "synthetic timing evidence v1",
  }));

  return {
    id: id("day", dayIndex + 1),
    date,
    timezone: "Europe/Lisbon",
    pace: 50,
    items,
    expectedPassingItems: hasPolicyFailure ? 4 : 5,
  };
});

const hardConflicts = Array.from({ length: 20 }, (_, index) => ({
  id: id("hard-conflict", index + 1),
  kind: [
    "impossible_connection",
    "required_accessibility_unavailable",
    "traveller_ineligible",
    "date_window_violation",
    "required_constraint_conflict",
  ][index % 5],
  input: `Synthetic hard conflict ${index + 1}`,
  expected: {
    disclosed: true,
    finalizationBlocked: true,
    disposition: "requires_resolution",
  },
}));

const payload = {
  estimates,
  unambiguousRequests,
  ambiguities,
  itineraryDays,
  hardConflicts,
};
const corpusHash = `sha256:${createHash("sha256")
  .update(JSON.stringify(payload))
  .digest("hex")}`;
const corpus = {
  metadata: {
    corpusVersion: CORPUS_VERSION,
    policyVersion: POLICY_VERSION,
    seed: SEED,
    corpusHash,
    generationCommand: "corepack pnpm --dir web corpus:generate",
    evaluationCommand: "corepack pnpm --dir web test -- evaluation-corpus",
    providerConfiguration: "synthetic-provider-v1",
    modelConfiguration: "deterministic-predetermined-outcomes-v1",
    denominators: {
      estimates: 100,
      unambiguousRequests: 100,
      ambiguities: 20,
      itineraryDays: 100,
      itineraryItems: 500,
      hardConflicts: 20,
    },
    changeControl: {
      reviewedReasonRequired: true,
      reviewedReason: "Initial T018 evaluation policy v1 corpus freeze.",
      policy:
        "Every revision must record a reviewed reason and run a fresh complete evaluation.",
    },
  },
  ...payload,
};
const generated = `${JSON.stringify(corpus, null, 2)}\n`;
const outputs = [
  resolve(process.cwd(), "tests/fixtures/evaluation-corpus.json"),
  resolve(process.cwd(), "../agent/tests/fixtures/evaluation-corpus.json"),
];

if (process.argv.includes("--check")) {
  for (const output of outputs) {
    assert.equal(
      await readFile(output, "utf8"),
      generated,
      `${output} has drifted; run the corpus generator`,
    );
  }
  console.log(`Validated evaluation corpus ${CORPUS_VERSION} (${corpusHash}).`);
} else {
  await Promise.all(outputs.map((output) => writeFile(output, generated, "utf8")));
  console.log(`Wrote identical evaluation corpora (${corpusHash}).`);
}