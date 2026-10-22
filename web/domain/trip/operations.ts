import { ProblemError } from "@/server/errors";

import { proposalOperationSchema } from "./proposal";
import { tripSnapshotSchema, type TripSnapshot } from "./schema";

function invalidOperation(): never {
  throw new ProblemError({
    title: "Invalid draft operation",
    status: 422,
    code: "invalid_draft_operation",
  });
}

// RFC-6901 paths, with an intentionally small draft-only operation vocabulary.
export function applyDraftOperations(
  base: TripSnapshot,
  raw: readonly unknown[],
  validate = true,
): TripSnapshot {
  if (raw.length < 1 || raw.length > 32) invalidOperation();
  const candidate = structuredClone(base);
  if (base.components.some((component) => component.bookingStatus !== "unbooked")) {
    throw new ProblemError({
      title: "Draft operations cannot modify bookings",
      status: 409,
      code: "protected_booking",
    });
  }
  for (const input of raw) {
    const operation = proposalOperationSchema.parse(input);
    const parts = operation.target
      .slice(1)
      .split("/")
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
    if (
      parts.some((part) =>
        ["__proto__", "constructor", "prototype", "price", "bookingStatus"].includes(part),
      )
    )
      invalidOperation();
    let parent: unknown = candidate;
    for (const part of parts.slice(0, -1)) {
      if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, part)) invalidOperation();
      parent = (parent as Record<string, unknown>)[part];
    }
    if (!parent || typeof parent !== "object") invalidOperation();
    const key = parts.at(-1)!;
    if (Array.isArray(parent)) {
      if (key !== "-" && !/^(0|[1-9][0-9]*)$/.test(key)) invalidOperation();
      if (key === "-" && operation.operation !== "add") invalidOperation();
      const index = key === "-" ? parent.length : Number(key);
      if (!Number.isInteger(index) || index < 0 || index > parent.length) invalidOperation();
      if (operation.operation === "add") parent.splice(index, 0, structuredClone(operation.value));
      else {
        if (index >= parent.length) invalidOperation();
        if (operation.operation === "remove") parent.splice(index, 1);
        else if (operation.operation === "replace")
          parent[index] = structuredClone(operation.value);
        else invalidOperation();
      }
    } else {
      const object = parent as Record<string, unknown>;
      if (
        !Object.hasOwn(object, key) &&
        !(operation.operation === "add" && ["destinationOrder", "departureOrigins"].includes(key))
      )
        invalidOperation();
      if (operation.operation === "remove") delete object[key];
      else if (operation.operation === "reorder") {
        const list = object[key];
        if (
          !Array.isArray(list) ||
          !Array.isArray(operation.value) ||
          operation.value.length !== list.length
        )
          invalidOperation();
        const ids = operation.value;
        if (new Set(ids).size !== list.length) invalidOperation();
        object[key] = ids.map((id) => {
          const entry = list.find(
            (item: unknown) =>
              item !== null &&
              typeof item === "object" &&
              (item as Record<string, unknown>).id === id,
          ) as unknown;
          if (!entry) invalidOperation();
          return key === "destinations"
            ? { ...(entry as Record<string, unknown>), routePosition: ids.indexOf(id) }
            : entry;
        });
      } else object[key] = structuredClone(operation.value);
    }
  }
  if (candidate.components.some((component) => component.bookingStatus !== "unbooked")) {
    throw new ProblemError({
      title: "Draft operations cannot modify bookings",
      status: 409,
      code: "protected_booking",
    });
  }
  return validate ? tripSnapshotSchema.parse(candidate) : candidate;
}
