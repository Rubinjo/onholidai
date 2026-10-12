import { describe, expect, it } from "vitest";

import {
  DeterministicProviderDouble,
  syntheticOffers,
  TimeoutAfterCommitError,
} from "../fixtures/providers";

describe("deterministic provider fixtures", () => {
  it("includes stable changed and unavailable offers", () => {
    expect(syntheticOffers.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "offer-available-001", status: "available" },
      { id: "offer-changed-001", status: "changed" },
      { id: "offer-unavailable-001", status: "unavailable" },
    ]);
  });

  it("records a timeout-after-commit and replays it as a duplicate", () => {
    const provider = new DeterministicProviderDouble();

    expect(() =>
      provider.commit("request-timeout-001", "offer-available-001", "timeout_after_commit"),
    ).toThrow(TimeoutAfterCommitError);

    expect(provider.commit("request-timeout-001", "offer-available-001")).toEqual([
      expect.objectContaining({
        requestId: "request-timeout-001",
        status: "confirmed",
        duplicate: true,
      }),
    ]);
  });

  it("emits predetermined duplicate and contradictory outcomes", () => {
    const duplicateProvider = new DeterministicProviderDouble();
    const contradictoryProvider = new DeterministicProviderDouble();

    expect(
      duplicateProvider.commit("request-duplicate-001", "offer-changed-001", "duplicate"),
    ).toMatchObject([{ status: "confirmed", duplicate: false }, { duplicate: true }]);
    expect(
      contradictoryProvider.commit(
        "request-contradictory-001",
        "offer-available-001",
        "contradictory",
      ),
    ).toMatchObject([{ status: "confirmed" }, { status: "rejected" }]);
  });
});