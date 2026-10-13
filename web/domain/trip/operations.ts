import { proposalOperationSchema } from "./proposal";
import { tripSnapshotSchema, type TripSnapshot } from "./schema";
import { ProblemError } from "@/server/errors";

// RFC-6901 paths, with an intentionally small draft-only operation vocabulary.
export function applyDraftOperations(base: TripSnapshot, raw: readonly unknown[], validate = true): TripSnapshot {
  if (raw.length < 1 || raw.length > 32) throw new Error("Expected 1–32 operations");
  const candidate = structuredClone(base);
  for (const input of raw) {
    const operation = proposalOperationSchema.parse(input);
    const parts = operation.target.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
    if (parts.some((part) => ["__proto__", "constructor", "prototype", "price", "bookingStatus"].includes(part))) throw new Error("Protected path");
    let parent: unknown = candidate;
    for (const part of parts.slice(0, -1)) {
      if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, part)) throw new Error("Unknown draft path");
      parent = (parent as Record<string, unknown>)[part];
    }
    if (!parent || typeof parent !== "object") throw new Error("Invalid draft path");
    const key = parts.at(-1)!;
    if (Array.isArray(parent)) {
      const index = key === "-" ? parent.length : Number(key);
      if (!Number.isInteger(index) || index < 0 || index > parent.length) throw new Error("Invalid array position");
      if (operation.operation === "add") parent.splice(index, 0, structuredClone(operation.value));
      else {
        if (index >= parent.length) throw new Error("Unknown array position");
        if (operation.operation === "remove") parent.splice(index, 1);
        else if (operation.operation === "replace") parent[index] = structuredClone(operation.value);
        else throw new Error("Reorder must address an array field");
      }
    } else {
      const object = parent as Record<string, unknown>;
      if (!Object.hasOwn(object, key)) throw new Error("Unknown draft field");
      if (operation.operation === "remove") delete object[key];
      else if (operation.operation === "reorder") {
        const list = object[key];
        if (!Array.isArray(list) || !Array.isArray(operation.value) || operation.value.length !== list.length) throw new Error("Invalid reorder");
        const ids = operation.value;
        if (new Set(ids).size !== list.length) throw new Error("Duplicate reorder identity");
        object[key] = ids.map((id) => {
          const entry = list.find((item: unknown) => item !== null && typeof item === "object" && (item as Record<string, unknown>).id === id) as unknown;
          if (!entry) throw new Error("Unknown reorder identity");
          return key === "destinations" ? { ...(entry as Record<string, unknown>), routePosition: ids.indexOf(id) } : entry;
        });
      } else object[key] = structuredClone(operation.value);
    }
  }
  if (candidate.components.some((component) => component.bookingStatus !== "unbooked")) {
    throw new ProblemError({ title: "Draft operations cannot modify bookings", status: 409, code: "protected_booking" });
  }
  return validate ? tripSnapshotSchema.parse(candidate) : candidate;
}
