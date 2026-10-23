import type { RefinementCtx } from "zod";

type Rule = Record<string, unknown>;
const object = (value: unknown): value is Rule =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function field(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split(".")) {
    if (!object(current) || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function matches(value: unknown, rule: Rule): boolean {
  if (Object.hasOwn(rule, "const") && value !== rule.const) return false;
  if (Array.isArray(rule.enum) && !rule.enum.includes(value)) return false;
  if (rule.type !== undefined) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (
      !types.some((type) =>
        type === "null"
          ? value === null
          : type === "array"
            ? Array.isArray(value)
            : type === "object"
              ? object(value)
              : type === "integer"
                ? Number.isSafeInteger(value)
                : typeof value === type,
      )
    )
      return false;
  }
  if (object(value)) {
    if (
      Array.isArray(rule.required) &&
      rule.required.some((key) => typeof key !== "string" || !Object.hasOwn(value, key))
    )
      return false;
    if (
      object(rule.properties) &&
      Object.entries(rule.properties).some(
        ([key, child]) => Object.hasOwn(value, key) && object(child) && !matches(value[key], child),
      )
    )
      return false;
    if (typeof rule.maxProperties === "number" && Object.keys(value).length > rule.maxProperties)
      return false;
    if (typeof rule.minProperties === "number" && Object.keys(value).length < rule.minProperties)
      return false;
  }
  if (typeof value === "string") {
    const length = Array.from(value).length;
    if (typeof rule.minLength === "number" && length < rule.minLength) return false;
    if (typeof rule.maxLength === "number" && length > rule.maxLength) return false;
  }
  if (Array.isArray(value)) {
    if (object(rule.contains) && !value.some((item) => matches(item, rule.contains as Rule)))
      return false;
    if (
      rule.uniqueItems &&
      new Set(value.map((item) => JSON.stringify(item))).size !== value.length
    )
      return false;
  }
  if (
    Array.isArray(rule.allOf) &&
    rule.allOf.some((clause) => !object(clause) || !matches(value, clause))
  )
    return false;
  if (object(rule.if)) {
    const branch = matches(value, rule.if) ? rule.then : rule.else;
    if (object(branch) && !matches(value, branch)) return false;
  }
  return true;
}

export function contractRulesSatisfied(
  value: unknown,
  rules: Rule,
  protectedKeys: readonly string[],
): boolean {
  const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");
  const protectedNames = new Set(protectedKeys.map(normalizeKey));
  if (!matches(value, rules)) return false;
  const uniqueKey = rules["x-unique-by"];
  if (
    typeof uniqueKey === "string" &&
    Array.isArray(value) &&
    new Set(value.map((item) => JSON.stringify(field(item, uniqueKey)))).size !== value.length
  )
    return false;
  if (Array.isArray(rules["x-equal-fields"])) {
    for (const pair of rules["x-equal-fields"]) {
      if (
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        pair.some((path) => typeof path !== "string")
      )
        return false;
      const left = field(value, pair[0]);
      if (left !== undefined && left !== null && left !== field(value, pair[1])) return false;
    }
  }
  if (Array.isArray(rules["x-not-future-fields"])) {
    for (const pair of rules["x-not-future-fields"]) {
      if (
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        pair.some((path) => typeof path !== "string")
      )
        return false;
      const left = field(value, pair[0]);
      const right = field(value, pair[1]);
      if (
        left !== undefined &&
        left !== null &&
        (typeof left !== "number" || typeof right !== "number" || left > right)
      )
        return false;
    }
  }
  if (rules["x-nonblank"] && typeof value === "string" && !value.trim()) return false;
  if (
    rules["x-protected-target"] &&
    typeof value === "string" &&
    value.split("/").some((part) => protectedNames.has(normalizeKey(part)))
  )
    return false;
  const bound = rules["x-json-bound"];
  if (object(bound)) {
    if (typeof bound.bytes !== "number" || typeof bound.depth !== "number") return false;
    const visit = (item: unknown, depth: number): boolean => {
      if (depth > (bound.depth as number)) return false;
      if (Array.isArray(item)) return item.every((child) => visit(child, depth + 1));
      if (object(item))
        return Object.entries(item).every(
          ([key, child]) =>
            (!protectedNames.has(normalizeKey(key)) ||
              (key === "bookingStatus" &&
                (child === "unbooked" || bound.allowBookingStatus === true))) &&
            visit(child, depth + 1),
        );
      return true;
    };
    if (!visit(value, 0)) return false;
    const encoded = JSON.stringify(value);
    if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > bound.bytes)
      return false;
  }
  return true;
}

export function validateContractRules(
  value: unknown,
  rules: Rule,
  protectedKeys: readonly string[],
  context: RefinementCtx,
): void {
  if (!contractRulesSatisfied(value, rules, protectedKeys)) {
    context.addIssue({
      code: "custom",
      message: "Contract identity, state or context bounds are inconsistent",
    });
  }
}
