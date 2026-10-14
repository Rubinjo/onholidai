// @vitest-environment node
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyProviderCallback } from "../../server/supply/callbacks";

describe("provider callback authentication", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts only an HMAC signature for the exact provider payload", () => {
    const raw = JSON.stringify({ providerEventId: "evt-1", outcome: "unknown" });
    vi.stubEnv("DUFFEL_CALLBACK_SECRET", "synthetic-callback-secret");
    const signature = `sha256=${createHmac("sha256", "synthetic-callback-secret").update(raw).digest("hex")}`;
    expect(verifyProviderCallback("duffel", raw, signature)).toBe(true);
    expect(verifyProviderCallback("duffel", raw + " ", signature)).toBe(false);
    expect(verifyProviderCallback("booking", raw, signature)).toBe(false);
  });

  it("rejects callbacks when provider credentials are not configured", () => {
    vi.stubEnv("DUFFEL_CALLBACK_SECRET", "");
    expect(verifyProviderCallback("duffel", "{}", "sha256=invalid")).toBe(false);
  });
});
