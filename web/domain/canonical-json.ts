// Stable, dependency-free serialization used for fingerprints and for comparing
// payloads round-tripped through storage. Postgres jsonb does not preserve object
// key order, so plain JSON.stringify cannot be used for equality.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Mutation values must be JSON serializable");
  return encoded;
}
