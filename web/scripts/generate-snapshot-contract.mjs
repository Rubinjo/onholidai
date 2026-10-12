import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import {
  CURRENT_TRIP_SNAPSHOT_SCHEMA_VERSION,
  tripSnapshotSchema,
} from "../domain/trip/schema.ts";

const outputPath = resolve(process.cwd(), "../contracts/trip-domain/snapshot-v1.schema.json");
const generated = `${JSON.stringify(
  {
    $id: "https://onholidai.local/contracts/trip-domain/snapshot-v1.schema.json",
    title: "TripSnapshot v1",
    description: `Complete immutable trip snapshot for schemaVersion ${CURRENT_TRIP_SNAPSHOT_SCHEMA_VERSION}.`,
    ...z.toJSONSchema(tripSnapshotSchema, { target: "draft-2020-12" }),
  },
  null,
  2,
)}\n`;

if (process.argv.includes("--check")) {
  const committed = await readFile(outputPath, "utf8");
  assert.equal(committed, generated, "snapshot-v1.schema.json has drifted; run pnpm snapshot:contract");
  console.log("Validated TripSnapshot v1 contract drift.");
} else {
  await writeFile(outputPath, generated, "utf8");
  console.log(`Wrote ${outputPath}`);
}