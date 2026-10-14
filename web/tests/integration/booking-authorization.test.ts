// @vitest-environment node
import { describe, expect, it } from "vitest";
import { TransactionProviderRegistry } from "../../server/supply/transactions";
import { withEphemeralPaymentToken } from "../../server/supply/payment";

describe("booking execution boundary", () => {
  it("does not expose unconfigured provider writes as supported capabilities", () => {
    const providers = new TransactionProviderRegistry();
    expect(() => providers.require("duffel", "book_trip")).toThrow(/not configured/);
  });

  it("clears the in-memory token buffer after provider use", async () => {
    const token = new Uint8Array(32).fill(7);
    await withEphemeralPaymentToken(token, async (active) => expect(active.some((byte) => byte !== 0)).toBe(true));
    expect(token.every((byte) => byte === 0)).toBe(true);
  });
});
