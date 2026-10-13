import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const CORPUS_VERSION = "1.1.0";
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
    input: estimateInput(caseNumber),
    expected: {
      outcome: "proposal",
      originConfirmed: true,
      requiredConstraintDisposition: "unverified_source_evidence_disclosed",
      durationDays: 5 + (caseNumber % 5),
      timeLimitSeconds: 30,
      operationTargets: ["/destinations", "/components", "/itineraryDays"],
      availabilityUnchanged: true,
      automaticallyApplied: false,
    },
  };
});

function estimateInput(caseNumber) {
  const uuid = (offset) => `a0000000-a000-4000-8000-a${String(caseNumber * 10 + offset).padStart(11, "0")}`;
  const currency = "EUR", zero = { currency, minorUnits: 0 };
  const names = caseNumber % 3 === 0 ? ["Lisbon", "Porto"] : ["Lisbon"];
  return { version: 1, snapshot: {
    departureOrigin: { kind: "city", placeId: caseNumber % 2 ? "synthetic-manchester" : "synthetic-london",
      name: caseNumber % 2 ? "Manchester" : "London", countryCode: "GB", timezone: "Europe/London",
      airportCode: null, confirmedByUser: true },
    availabilityWindows: [
      { id: uuid(1), startDate: "2030-05-10", endDate: "2030-05-30", preference: "preferred", timezone: "Europe/London" },
      { id: uuid(2), startDate: "2030-06-10", endDate: "2030-06-30", preference: "flexible", timezone: "Europe/London" }],
    duration: { minimumDays: 5, idealDays: 5 + caseNumber % 5, maximumDays: 10 },
    travellerParty: { adults: 1 + caseNumber % 3, children: caseNumber % 5 === 0 ? [{ id: uuid(3), ageAtTripStart: 10 }] : [] },
    preferences: { pace: 20 + caseNumber % 70, spend: 30 + caseNumber % 60, discovery: 40 + caseNumber % 50, independence: 50, setting: 60 },
    constraints: [{ id: uuid(4), category: "schedule", statement: "No activities before 10:00", priority: "required",
      source: { kind: "setup_text", referenceId: null }, status: "unverified", confirmedByUser: true }],
    destinations: names.map((name, index) => ({ id: uuid(5 + index), kind: "city", name, countryCode: "PT",
      providerPlaceIds: { synthetic: `synthetic-${name.toLowerCase()}` }, location: null, routePosition: index,
      arrivalDate: null, departureDate: null, plannedNights: 0 })),
    itineraryDays: [], components: [], warnings: [],
    price: { currency, supplierTotal: zero, platformMarginTotal: zero, customerPayableTaxesTotal: zero,
      customerPayableFeesTotal: zero, finalCustomerTotal: zero, status: "estimated", checkedAt: "2029-01-01T00:00:00Z", conversionDisclosures: [] }
  } };
}

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
      reviewedReason: "US1 revision: replace non-executable estimate shorthand with complete synthetic trip snapshots, source-evidence expectations and the required 30-second deadline. Refinement/itinerary placeholder repair remains pending T128; these are not scored as evidence.",
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
