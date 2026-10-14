import { describe, expect, it } from "vitest";
import { principalAllows } from "../../server/auth/planning-actor";

describe("current planning principal binding", () => {
  it("requires current account binding after linking even with original guest proof", () => {
    const linked = { accountUserId: "account", guestSessionId: null };
    expect(principalAllows(linked, { accountUserId: "account", guestSessionId: "old-session" })).toBe(true);
    expect(principalAllows(linked, { accountUserId: "other", guestSessionId: "old-session" })).toBe(false);
    expect(principalAllows(linked, { accountUserId: null, guestSessionId: "old-session" })).toBe(false);
  });
  it("does not let authentication alone claim an unlinked guest resource", () => {
    const guest = { accountUserId: null, guestSessionId: "session" };
    expect(principalAllows(guest, { accountUserId: "account", guestSessionId: null })).toBe(false);
    expect(principalAllows(guest, { accountUserId: null, guestSessionId: "other" })).toBe(false);
    expect(principalAllows(guest, { accountUserId: "account", guestSessionId: "session" })).toBe(true);
  });
});
