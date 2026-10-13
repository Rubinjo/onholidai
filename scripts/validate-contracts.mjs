import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import SwaggerParser from "@apidevtools/swagger-parser";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "specs", "001-ai-trip-agent", "contracts");
const promotedRoot = path.join(root, "contracts");

const sourceAgent = path.join(sourceRoot, "agent-api.openapi.yaml");
const sourceTools = path.join(sourceRoot, "agent-tools.schema.json");
const sourceWeb = path.join(sourceRoot, "web-api.openapi.yaml");
const sourceSupply = path.join(sourceRoot, "travel-supply.md");
const promotedAgent = path.join(promotedRoot, "agent-api", "openapi.yaml");
const promotedTools = path.join(promotedRoot, "agent-api", "tools.schema.json");
const promotedWeb = path.join(promotedRoot, "trip-domain", "web-api.openapi.yaml");
const promotedSupply = path.join(promotedRoot, "supply", "README.md");

const [sourceAgentApi, sourceWebApi, promotedAgentApi, promotedWebApi] = await Promise.all(
  [sourceAgent, sourceWeb, promotedAgent, promotedWeb].map((document) =>
    SwaggerParser.validate(document),
  ),
);

const requiredOperations = new Map([
  ["/places", "get"],
  ["/agent-runs/{runId}/clarifications", "post"],
  ["/trips/{tripId}/conversations", "get"],
  ["/trips/{tripId}/versions", "get"],
  ["/trips/{tripId}/proposals/{proposalId}/reject", "post"],
  ["/trips/{tripId}/commands/edit-preview", "post"],
  ["/booking/revalidations/{workflowId}", "get"],
  ["/bookings/{bookingId}/components/{componentId}/recovery", "post"],
  ["/bookings/{bookingId}/components/{componentId}/cancellations", "post"],
  ["/bookings/{bookingId}/components/{componentId}/reschedule-authorizations", "post"],
  ["/bookings/{bookingId}/components/{componentId}/reschedules", "post"],
  ["/internal/pricing/{tripId}", "get"],
]);

for (const [document, api] of [
  [sourceWeb, sourceWebApi],
  [promotedWeb, promotedWebApi],
]) {
  for (const [route, method] of requiredOperations) {
    assert(api.paths?.[route]?.[method], `${document} is missing ${method.toUpperCase()} ${route}`);
  }
}

const read = async (file) => (await readFile(file, "utf8")).replaceAll("\r\n", "\n");
const [sourceAgentText, promotedAgentText] = await Promise.all([
  read(sourceAgent),
  read(promotedAgent),
]);
assert.equal(promotedAgentText, sourceAgentText, "promoted agent OpenAPI has drifted");

const [sourceToolsText, promotedToolsText] = await Promise.all([
  read(sourceTools),
  read(promotedTools),
]);
const sourceToolsSchema = JSON.parse(sourceToolsText);
JSON.parse(promotedToolsText);
assert.equal(promotedToolsText, sourceToolsText, "promoted tool schema has drifted");

function resolveJsonPointer(document, reference) {
  assert(reference.startsWith("#/"), `unsupported tool schema reference ${reference}`);
  return reference
    .slice(2)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((value, token) => value?.[token], document);
}

function checkJsonSchemaReferences(value, location = "tool schema") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkJsonSchemaReferences(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.$ref === "string") {
    assert(
      resolveJsonPointer(sourceToolsSchema, value.$ref) !== undefined,
      `${location} has unresolved reference ${value.$ref}`,
    );
  }
  for (const [key, child] of Object.entries(value)) {
    checkJsonSchemaReferences(child, `${location}.${key}`);
  }
}

checkJsonSchemaReferences(sourceToolsSchema);

const operationPatterns = [
  sourceAgentApi.components.schemas.DraftOperation.properties.target.pattern,
  sourceWebApi.components.schemas.DraftOperation.properties.target.pattern,
  sourceToolsSchema.$defs.DraftOperation.properties.target.pattern,
];
assert.equal(new Set(operationPatterns).size, 1, "draft-operation allowlists have drifted");
assert(operationPatterns[0].includes("departureOrigin"), "departureOrigin is not allowlisted");

const webAgentRunRequired = new Set(sourceWebApi.components.schemas.AgentRun.required);
for (const field of [
  "requestId",
  "conversationId",
  "purpose",
  "baseTripVersion",
  "leaseExpiresAt",
  "lastDurableProgressAt",
  "interruptionReason",
]) {
  assert(webAgentRunRequired.has(field), `public AgentRun is missing required ${field}`);
}

const agentRunRequired = new Set(sourceAgentApi.components.schemas.AgentRun.required);
for (const field of ["requestId", "leaseExpiresAt", "lastDurableProgressAt", "interruptionReason"]) {
  assert(agentRunRequired.has(field), `internal AgentRun is missing required ${field}`);
}

for (const route of [
  "/internal/agent-runs/{runId}/events/{cursor}",
  "/internal/agent-runs/{runId}/result",
]) {
  const callback = sourceWebApi.paths[route];
  assert(callback.put, `${route} must be a PUT callback`);
  assert.equal(callback.post, undefined, `${route} must not expose POST`);
  assert.equal(callback.put["x-required-scope"], "run:write", `${route} scope drifted`);
  assert.equal(callback.put["x-run-binding"], true, `${route} lost run binding`);
  assert(callback.put.responses["200"], `${route} must return durable replay receipts`);
  assert(callback.put.responses["409"], `${route} must reject gaps and fingerprint conflicts`);
}

for (const schemaName of ["PersistAgentEventRequest", "PersistAgentResultRequest"]) {
  const required = new Set(sourceWebApi.components.schemas[schemaName].required);
  for (const field of ["requestId", "userId", "tripId", "baseTripVersion"]) {
    assert(required.has(field), `${schemaName} is missing scoped identity ${field}`);
  }
}

const estimateRequirement = sourceWebApi.components.schemas.ChangeProposal.allOf?.find(
  (branch) => branch.if?.properties?.purpose?.const === "initial_estimate",
);
for (const field of [
  "previewSnapshot",
  "estimatedCostRange",
  "styleCompatibility",
  "constraintSummary",
  "warnings",
]) {
  assert(
    estimateRequirement?.then?.required?.includes(field),
    `initial estimate review is missing required ${field}`,
  );
}

function checkClosedComposition(value, location = "contract", visited = new WeakSet()) {
  if (!value || typeof value !== "object" || visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkClosedComposition(item, `${location}[${index}]`, visited));
    return;
  }
  if (!value || typeof value !== "object") return;

  if (value.additionalProperties === false && Array.isArray(value.allOf)) {
    const declared = new Set(Object.keys(value.properties ?? {}));
    const branches = value.allOf.flatMap((branch) => [branch, branch.then, branch.else]);
    for (const branch of branches) {
      for (const property of Object.keys(branch?.properties ?? {})) {
        assert(
          declared.has(property),
          `${location} closes the object but introduces ${property} through allOf`,
        );
      }
    }
  }

  for (const [key, child] of Object.entries(value)) {
    checkClosedComposition(child, `${location}.${key}`, visited);
  }
}

checkClosedComposition(sourceAgentApi, "source agent OpenAPI");
checkClosedComposition(sourceWebApi, "source web OpenAPI");

const offersPath = path.join(promotedRoot, "supply", "offers-v1.schema.json");
const offersSchema = JSON.parse(await read(offersPath));
const componentReference = offersSchema.properties.component.allOf[0].$ref;
const [componentFile, componentPointer] = componentReference.split("#");
const componentDocument = JSON.parse(await read(path.resolve(path.dirname(offersPath), componentFile)));
assert(resolveJsonPointer(componentDocument, `#${componentPointer}`), "Planning offers must resolve their component schema");
checkClosedComposition(offersSchema, "planning offer schema");

const [sourceWebText, promotedWebText] = await Promise.all([
  read(sourceWeb),
  read(promotedWeb),
]);
assert.equal(
  promotedWebText,
  sourceWebText.replaceAll("./agent-api.openapi.yaml", "../agent-api/openapi.yaml"),
  "promoted web OpenAPI has drifted or has incorrect agent references",
);

const [sourceSupplyText, promotedSupplyText] = await Promise.all([
  read(sourceSupply),
  read(promotedSupply),
]);
assert.equal(promotedSupplyText, sourceSupplyText, "promoted supply contract has drifted");

console.log("Validated source and promoted contracts, references, operations, and drift.");
