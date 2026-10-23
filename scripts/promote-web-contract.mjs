import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const source = resolve("specs/001-ai-trip-agent/contracts/web-api.openapi.yaml");
const target = resolve("contracts/trip-domain/web-api.openapi.yaml");
const promoted = (await readFile(source, "utf8"))
  .replaceAll("./agent-api.openapi.yaml", "../agent-api/openapi.yaml")
  .replaceAll(
    "../../../contracts/trip-domain/booking-review-v2.schema.json",
    "./booking-review-v2.schema.json",
  )
  .replaceAll("\r\n", "\n");
if (process.argv.includes("--check"))
  assert.equal((await readFile(target, "utf8")).replaceAll("\r\n", "\n"), promoted);
else await writeFile(target, promoted, "utf8");
