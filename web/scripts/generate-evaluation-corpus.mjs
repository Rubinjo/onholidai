import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createItineraryCases } from "./itinerary-corpus.mjs";
import { assertGeneratedArtifact } from "./generated-artifact.mjs";

const CORPUS_VERSION = "1.4.0";
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

function refinementInput(index) {
  const input = estimateInput(index + 1), snapshot = input.snapshot;
  snapshot.duration = { minimumDays: 5, idealDays: 7, maximumDays: 20 };
  snapshot.preferences = { pace: 50, spend: 50, discovery: 50, independence: 50, setting: 50 };
  snapshot.travellerParty = { adults: 2, children: [] };
  snapshot.destinations = ["Tokyo", "Kyoto"].map((name, position) => ({
    id: `b0000000-b000-4000-8000-b${String(index * 10 + position).padStart(11, "0")}`, kind: "city", name,
    countryCode: "JP", providerPlaceIds: { synthetic: `synthetic-${name}` }, location: null, routePosition: position,
    arrivalDate: position === 0 ? "2030-05-10" : "2030-05-13", departureDate: position === 0 ? "2030-05-13" : "2030-05-16", plannedNights: 3,
  }));
  return { ...input, version: 2 };
}

function constraintIdentity(requestId, statement) {
  const namespace = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
  const bytes = createHash("sha1").update(namespace).update(requestId + statement).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

const unambiguousRequests = refinementGroups.flatMap((group, groupIndex) =>
  Array.from({ length: 20 }, (_, index) => {
    const caseNumber = groupIndex * 20 + index, input = refinementInput(caseNumber);
    const requestId = `c0000000-c000-4000-8000-c${String(caseNumber).padStart(11, "0")}`;
    let request, operation;
    if (group === "destinations") {
      const extra = 1 + index % 3, routed = structuredClone(input.snapshot.destinations);
      routed[1].plannedNights += extra;
      routed[1].departureDate = dateForDay(15 + extra);
      request = `Add ${extra} nights in Kyoto`;
      operation = { operation: "replace", target: "/destinations", value: routed };
    } else if (group === "dates_duration") {
      const days = 8 + index % 5;
      request = `Set ideal duration to ${days} days`;
      operation = { operation: "replace", target: "/duration/idealDays", value: days };
    } else if (group === "travellers") {
      const adults = 3 + index % 5;
      request = `Set party to ${adults} adults`;
      operation = { operation: "replace", target: "/travellerParty/adults", value: adults };
    } else if (group === "preferences") {
      const dimension = ["pace", "spend", "discovery", "independence", "setting"][index % 5], value = 20 + index;
      request = `Set ${dimension} to ${value}`;
      operation = { operation: "replace", target: `/preferences/${dimension}`, value };
    } else {
      const category = ["schedule", "dietary", "lodging", "transport", "other"][index % 5];
      const statement = ["No activities before 10:00", "Vegetarian meals required", "No more than two hotel changes", "Use rail for intercity travel", "Include a rest day"][index % 5];
      request = `Add a required ${category} constraint: ${statement}`;
      operation = { operation: "add", target: "/constraints/-", value: { id: constraintIdentity(requestId, statement), category, statement, priority: "required", source: { kind: "conversation_message", referenceId: requestId }, status: "unverified", confirmedByUser: true } };
    }
    return { id: `${group}-${String(index + 1).padStart(2, "0")}`, group, requestId, input, request,
      expected: { clarificationRequired: false, operations: [operation], automaticallyApplied: false, constraintsPreserved: true } };
  }),
);

const ambiguities = Array.from({ length: 20 }, (_, index) => {
  const group = refinementGroups[index % refinementGroups.length];
  return {
    id: id("ambiguity", index + 1),
    group,
    input: refinementInput(index),
    request: ["Add two nights there", "Use the other dates", "Change the travellers", "Make it different", "Use the previous requirement"][index % 5],
    expected: {
      clarificationRequired: true,
      focus: group,
      reason: "multiple_material_interpretations",
    },
  };
});

const { itineraryDays, hardConflicts } = createItineraryCases(estimateInput, dateForDay);
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
      reviewedReason: "US3 revision 1.4.0: repair the four date-window hard-conflict inputs so each is a storable snapshot whose availability window starts after the planned day, letting the feasibility policy (code date_duration) rather than the snapshot schema reject it. Preserve estimate/refinement cases, seed and denominators; a complete evaluation remains required before acceptance.",
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
    assertGeneratedArtifact(
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
