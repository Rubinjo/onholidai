import { describe, expect, it } from "vitest";

import {
  DeterministicProviderDouble,
  DeterministicClock,
  syntheticOffers,
  TimeoutAfterCommitError,
} from "../fixtures/providers";

describe("deterministic provider fixtures", () => {
  it("keeps explicit research modes read-only and records clock-bound evidence", () => {
    const clock = new DeterministicClock("2030-01-01T00:00:00Z");
    const provider = new DeterministicProviderDouble(clock.now);
    expect(provider.search().offers).toHaveLength(3);
    expect(provider.detail("offer-available-001").status).toBe("available");
    expect(provider.revalidate("offer-changed-001").status).toBe("changed");
    clock.advance(1_000);
    expect(provider.search("rate_limited")).toMatchObject({
      status: "rate_limited", offers: [], checkedAt: "2030-01-01T00:00:01.000Z",
    });
    expect(provider.search("no_matches").offers).toEqual([]);
    expect(provider.counters).toMatchObject({ search: 3, detail: 1, revalidation: 1, writeAttempts: 0, writes: 0 });
  });

  it("restores committed provider truth across a simulated process crash", () => {
    const original = new DeterministicProviderDouble();
    expect(() => original.commit("crash-request", "offer-available-001", "timeout_after_commit"))
      .toThrow(TimeoutAfterCommitError);
    const restored = new DeterministicProviderDouble(undefined, original.snapshot());
    expect(restored.commit("crash-request", "offer-available-001")[0].duplicate).toBe(true);
    expect(restored.counters.writes).toBe(1);
    expect(restored.commit("partial-request", "offer-unavailable-001")[0].status).toBe("rejected");
  });

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