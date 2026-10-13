import { describe, expect, it } from "vitest";
import { applyDraftOperations } from "../../domain/trip/operations";
import { priceEstimate } from "../../domain/trip/apply-estimate";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
describe("estimate proposal boundary", () => {
  it("does not mutate the base and rejects protected or unknown offer identities", () => {
    const base = createSyntheticTripSnapshot(), before = structuredClone(base);
    const changed = applyDraftOperations(base, [{ operation: "replace", target: "/preferences/pace", value: 30 }]);
    expect(changed.preferences.pace).toBe(30); expect(base).toEqual(before);
    expect(() => applyDraftOperations(base, [{ operation: "replace", target: "/price", value: {} }])).toThrow();
    expect(() => priceEstimate(base, [{ operation: "replace", target: "/components", value: [{ id: "unknown" }] }], [], new Date())).toThrow();
  });
});
