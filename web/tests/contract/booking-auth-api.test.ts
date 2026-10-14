import { describe, expect, it } from "vitest";
import { bookingIntentRequestSchema, linkRequestSchema, bookingContinuationPath } from "../../server/auth/booking-intent";
import { safeAuthDestination } from "../../components/auth/safe-destination";
describe("booking-only authentication contract", () => {
  it("accepts only fixed review intent and rejects browser-selected consent or redirects", () => {
    const input = { requestId: crypto.randomUUID(), tripId: crypto.randomUUID() };
    expect(bookingIntentRequestSchema.parse(input)).toEqual(input);
    expect(bookingIntentRequestSchema.safeParse({ ...input, action: "pay", returnTo: "https://attacker.invalid" }).success).toBe(false);
    expect(linkRequestSchema.safeParse({ requestId: crypto.randomUUID(), authorizeBooking: true }).success).toBe(false);
  });
  it("derives current continuation and keeps intent ahead of ordinary safe redirects", () => {
    const id = crypto.randomUUID();
    expect(bookingContinuationPath(id, "draft").nextPath).toBe(`/trips/${id}`);
    expect(bookingContinuationPath(id, "finalized").nextPath).toBe(`/trips/${id}/booking`);
    expect(safeAuthDestination(id, "//attacker.invalid")).toBe(`/auth/continue?intentId=${id}`);
    for (const unsafe of ["//attacker.invalid", "https://attacker.invalid", "/\\attacker.invalid"]) expect(safeAuthDestination(undefined, unsafe)).toBe("/");
  });
});
