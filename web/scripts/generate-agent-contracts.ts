import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import prettier from "prettier";

export interface Schema {
  [key: string]: unknown;
  $ref?: string;
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  allOf?: Schema[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  items?: Schema;
  pattern?: string;
  format?: string;
  default?: unknown;
}

const supportedKeywords = new Set([
  "$ref",
  "title",
  "description",
  "type",
  "enum",
  "const",
  "anyOf",
  "oneOf",
  "allOf",
  "discriminator",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "pattern",
  "format",
  "default",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
  "uniqueItems",
  "contains",
  "x-json-bound",
  "x-equal-fields",
  "x-not-future-fields",
  "x-nonblank",
  "x-protected-target",
]);
const ruleKeys = new Set([
  "allOf",
  "minLength",
  "maxLength",
  "minProperties",
  "maxProperties",
  "uniqueItems",
  "contains",
  "x-json-bound",
  "x-equal-fields",
  "x-not-future-fields",
  "x-nonblank",
  "x-protected-target",
]);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const quote = (value: unknown): string => {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Contract values must be JSON serializable");
  return encoded;
};

function referenceName(reference: string): string {
  if (!/^#\/(components\/schemas|\$defs)\/[A-Za-z_$][A-Za-z0-9_$]*$/.test(reference))
    throw new Error(`Unsupported schema reference: ${reference}`);
  return reference.split("/").at(-1)!;
}

function dependencies(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((child) => dependencies(child, result));
  else if (record(value)) {
    if (typeof value.$ref === "string") result.add(referenceName(value.$ref));
    Object.values(value).forEach((child) => dependencies(child, result));
  }
  return result;
}

function rules(schema: Schema): Record<string, unknown> {
  const result = Object.fromEntries(Object.entries(schema).filter(([key]) => ruleKeys.has(key)));
  const allowed = new Set([
    "const",
    "enum",
    "type",
    "properties",
    "required",
    "contains",
    "uniqueItems",
    "allOf",
    "if",
    "then",
    "else",
    "minProperties",
    "maxProperties",
    ...ruleKeys,
  ]);
  const check = (rule: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(rule)) {
      if (!allowed.has(key)) throw new Error(`Unsupported conditional rule: ${key}`);
      if (["if", "then", "else", "contains"].includes(key)) {
        if (!record(value)) throw new Error("Invalid conditional schema");
        check(value);
      } else if (key === "properties") {
        if (!record(value)) throw new Error("Invalid conditional properties");
        for (const child of Object.values(value)) {
          if (!record(child)) throw new Error("Invalid conditional property");
          check(child);
        }
      } else if (key === "allOf") {
        if (!Array.isArray(value)) throw new Error("Invalid conditional composition");
        for (const child of value) {
          if (!record(child)) throw new Error("Invalid conditional clause");
          check(child);
        }
      }
    }
  };
  check(result);
  return result;
}

function wireType(schema: Schema): string {
  if (schema.$ref) return referenceName(schema.$ref);
  if (Object.hasOwn(schema, "const")) return quote(schema.const);
  if (schema.enum) return schema.enum.map(quote).join(" | ");
  const union = schema.anyOf ?? schema.oneOf;
  if (union) return union.map((branch) => `(${wireType(branch)})`).join(" | ");
  if (Array.isArray(schema.type))
    return schema.type.map((type) => wireType({ ...schema, type })).join(" | ");
  switch (schema.type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return `Array<${wireType(schema.items ?? {})}>`;
    case "object": {
      if (!schema.properties)
        return `Record<string, ${typeof schema.additionalProperties === "object" ? wireType(schema.additionalProperties) : "unknown"}>`;
      return `{ ${Object.entries(schema.properties)
        .map(
          ([name, field]) =>
            `${quote(name)}${schema.required?.includes(name) ? "" : "?"}: ${wireType(field)};`,
        )
        .join(" ")} }`;
    }
    default:
      return "unknown";
  }
}

function validator(schema: Schema): string {
  for (const key of Object.keys(schema))
    if (!supportedKeywords.has(key)) throw new Error(`Unsupported schema keyword: ${key}`);
  let expression: string;
  if (schema.$ref) {
    const referenceKeys = new Set(["$ref", "title", "description", "default", ...ruleKeys]);
    for (const key of Object.keys(schema))
      if (!referenceKeys.has(key)) throw new Error(`Unsupported reference refinement: ${key}`);
    expression = `${referenceName(schema.$ref)}Schema`;
  } else if (Object.hasOwn(schema, "const")) expression = `z.literal(${quote(schema.const)})`;
  else if (schema.enum) {
    if (schema.enum.length === 0) throw new Error("Empty enum");
    expression = schema.enum.every((value) => typeof value === "string")
      ? `z.enum(${quote(schema.enum)})`
      : schema.enum.length === 1
        ? `z.literal(${quote(schema.enum[0])})`
        : `z.union([${schema.enum.map((value) => `z.literal(${quote(value)})`).join(", ")}])`;
  } else {
    const union = schema.anyOf ?? schema.oneOf;
    if (union)
      expression =
        union.length === 1 ? validator(union[0]) : `z.union([${union.map(validator).join(", ")}])`;
    else if (Array.isArray(schema.type))
      expression = `z.union([${schema.type.map((type) => validator({ ...schema, type, default: undefined })).join(", ")}])`;
    else
      switch (schema.type) {
        case "string":
          if (schema.format && !["uuid", "date-time"].includes(schema.format))
            throw new Error(`Unsupported string format: ${schema.format}`);
          expression =
            schema.format === "uuid"
              ? "z.uuid()"
              : schema.format === "date-time"
                ? "z.iso.datetime({ offset: true })"
                : "z.string()";
          if (schema.pattern) expression += `.regex(new RegExp(${quote(schema.pattern)}))`;
          break;
        case "integer":
        case "number":
          expression = schema.type === "integer" ? "z.number().int()" : "z.number()";
          if (typeof schema.minimum === "number") expression += `.min(${schema.minimum})`;
          if (typeof schema.maximum === "number") expression += `.max(${schema.maximum})`;
          if (typeof schema.exclusiveMinimum === "number")
            expression += `.gt(${schema.exclusiveMinimum})`;
          if (typeof schema.exclusiveMaximum === "number")
            expression += `.lt(${schema.exclusiveMaximum})`;
          break;
        case "boolean":
          expression = "z.boolean()";
          break;
        case "null":
          expression = "z.null()";
          break;
        case "array":
          expression = `z.array(${validator(schema.items ?? {})})`;
          if (typeof schema.minItems === "number") expression += `.min(${schema.minItems})`;
          if (typeof schema.maxItems === "number") expression += `.max(${schema.maxItems})`;
          break;
        case "object":
          if (!schema.properties)
            expression = `z.record(z.string(), ${typeof schema.additionalProperties === "object" ? validator(schema.additionalProperties) : "z.unknown()"})`;
          else {
            const fields = Object.entries(schema.properties).map(
              ([name, field]) =>
                `${quote(name)}: ${validator(field)}${!schema.required?.includes(name) && !Object.hasOwn(field, "default") ? ".optional()" : ""}`,
            );
            expression = `z.object({ ${fields.join(", ")} })`;
            if (schema.additionalProperties === false) expression += ".strict()";
            else if (typeof schema.additionalProperties === "object")
              expression += `.catchall(${validator(schema.additionalProperties)})`;
            else expression += ".passthrough()";
          }
          break;
        default:
          expression = "z.unknown()";
      }
  }
  const extra = rules(schema);
  if (Object.hasOwn(extra, "x-json-bound")) {
    // Check depth/bytes before traversing the recursive JsonValue validator.
    const before = { "x-json-bound": extra["x-json-bound"] };
    expression = `z.unknown().superRefine((value, context) => validateContractRules(value, ${quote(before)}, protectedKeys, context)).pipe(${expression})`;
    delete extra["x-json-bound"];
  }
  if (Object.keys(extra).length > 0)
    expression += `.superRefine((value, context) => validateContractRules(value, ${quote(extra)}, protectedKeys, context))`;
  if (Object.hasOwn(schema, "default") && schema.default !== undefined)
    expression += `.default(${quote(schema.default)})`;
  return expression;
}

export function generateAgentContracts(
  openapi: unknown,
  tools: unknown,
): { types: string; zod: string } {
  if (
    !record(openapi) ||
    !record(openapi.components) ||
    !record(openapi.components.schemas) ||
    !record(tools) ||
    !record(tools.$defs)
  )
    throw new Error("Expected exported Pydantic contract documents");
  const schemas = { ...openapi.components.schemas } as Record<string, Schema>;
  const normalize = (schema: unknown) =>
    JSON.stringify(schema)
      .replaceAll("#/components/schemas/", "#/schema/")
      .replaceAll("#/$defs/", "#/schema/");
  for (const [name, schema] of Object.entries(tools.$defs)) {
    if (schemas[name] && normalize(schemas[name]) !== normalize(schema))
      throw new Error(`Conflicting schema: ${name}`);
    schemas[name] = schema as Schema;
  }
  const protectedKeys = openapi["x-protected-draft-keys"];
  if (
    !Array.isArray(protectedKeys) ||
    protectedKeys.some((key) => typeof key !== "string") ||
    quote(protectedKeys) !== quote(tools["x-protected-draft-keys"])
  )
    throw new Error("Protected draft keys drifted");
  const names = Object.keys(schemas).sort();
  const ordered: string[] = [];
  const active = new Set<string>();
  const completed = new Set<string>();
  const visit = (name: string): void => {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) || !schemas[name])
      throw new Error(`Unresolved schema: ${name}`);
    if (completed.has(name)) return;
    if (active.has(name)) throw new Error(`Unsupported schema cycle: ${name}`);
    active.add(name);
    for (const reference of [...dependencies(schemas[name])].sort()) {
      if (reference === name && name === "JsonValue") continue;
      visit(reference);
    }
    active.delete(name);
    completed.add(name);
    ordered.push(name);
  };
  names.forEach(visit);
  const header = "// Generated by web/scripts/generate-agent-contracts.ts. Do not edit.\n";
  const types =
    header +
    names.map((name) => `export type ${name} = ${wireType(schemas[name])};`).join("\n") +
    "\n";
  const imports = `${header}import { z } from "zod";\nimport type { ${names.join(", ")} } from "./generated";\nimport { validateContractRules } from "./validation";\nconst protectedKeys = ${quote(protectedKeys)} as const;\n`;
  const zod =
    imports +
    ordered
      .map((name) => {
        const expression = validator(schemas[name]);
        return `export const ${name}Schema: z.ZodType<${name}> = ${name === "JsonValue" ? `z.lazy(() => ${expression})` : expression};`;
      })
      .join("\n") +
    "\n";
  return { types, zod };
}

export async function main(root: string, check: boolean): Promise<void> {
  const generated = generateAgentContracts(
    JSON.parse(await readFile(resolve(root, "contracts/agent-api/openapi.yaml"), "utf8")),
    JSON.parse(await readFile(resolve(root, "contracts/agent-api/tools.schema.json"), "utf8")),
  );
  for (const [name, content] of [
    ["generated.ts", generated.types],
    ["generated.zod.ts", generated.zod],
  ]) {
    const path = resolve(root, "contracts/agent-api", name);
    const config = await prettier.resolveConfig(path);
    const formatted = await prettier.format(content, { ...config, filepath: path });
    if (check) {
      if ((await readFile(path, "utf8")).replaceAll("\r\n", "\n") !== formatted)
        throw new Error(`Agent contract drift: ${name}`);
    } else await writeFile(path, formatted, "utf8");
  }
}

if (
  typeof process !== "undefined" &&
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main(
    resolve(fileURLToPath(new URL("../..", import.meta.url))),
    process.argv.includes("--check"),
  );
}
