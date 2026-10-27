import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createReadAdapter } from "../../server/supply/providers/adapter";
import { syntheticReadClient } from "../../server/supply/providers/synthetic";
import { normalizePlanningOffer } from "../../server/supply/offers";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import {
  DeterministicProviderDouble,
  DeterministicClock,
  syntheticOffers,
  TimeoutAfterCommitError,
} from "../fixtures/providers";

import type { SupplyReadQuery } from "../../server/supply/read";

describe("deterministic provider fixtures", () => {
  afterEach(() => vi.useRealTimers());

  function readQuery(): SupplyReadQuery {
    const trip = createSyntheticTripSnapshot();
    return {
      componentTypes: ["accommodation"],
      currency: "GBP",
      departureOrigin: trip.departureOrigin,
      destinationIds: trip.destinations.map((destination) => destination.id),
      startDate: "2030-05-01",
      endDate: "2030-05-08",
      travellerParty: {
        adults: 2,
        children: [{ id: "10000000-0000-4000-8000-000000000011", ageAtTripStart: 9 }],
      },
    };
  }

  it.each(["hotel", "apartment", "villa", "hostel"])(
    "keeps explicit demonstration %s property evidence stable through search, detail and revalidation",
    async (accommodationType) => {
      vi.useFakeTimers();
      vi.setSystemTime("2030-01-01T00:00:00Z");
      const source = createReadAdapter(
        "nuitee",
        "accommodation",
        syntheticReadClient("accommodation", { accommodationType }),
      );
      const query = readQuery(),
        signal = new AbortController().signal;
      const first = normalizePlanningOffer((await source.search(query, signal))[0]);
      expect(first.component.planningDetails).toMatchObject({
        accommodationType,
        eligibility: "unverified",
        accessibility: "unverified",
        checkedAt: "2030-01-01T00:00:00.000Z",
      });
      expect(first.component.expiresAt).toBe("2030-01-01T00:15:00.000Z");
      vi.advanceTimersByTime(1_000);
      for (const method of [source.detail!, source.revalidate!]) {
        const current = normalizePlanningOffer(
          await method(first.component.supplierOfferId, query, signal),
        );
        expect(current.component.planningDetails?.accommodationType).toBe(accommodationType);
        expect(current.component.travellerIds).toEqual(first.component.travellerIds);
        expect(current.component.checkedAt).toBe("2030-01-01T00:00:01.000Z");
        expect(current.component.bookingStatus).toBe("unbooked");
        expect(current.eligibility.status).toBe("unverified");
      }
      expect(
        normalizePlanningOffer(first, new Date("2030-01-01T00:16:00Z")).component.offerStatus,
      ).toBe("expired");
    },
  );

  it("keeps anonymous adult slots stable across products and searches without inventing service-date age eligibility", async () => {
    const query = readQuery(),
      signal = new AbortController().signal;
    const raw = z
      .array(z.record(z.string(), z.unknown()))
      .parse(await syntheticReadClient("activity").search(query, signal))[0];
    const activity = createReadAdapter("viator", "activity", {
      search: async () => [
        { ...raw, minimumAge: 10, maximumAge: 15, serviceStart: null, serviceEnd: null },
      ],
    });
    const first = normalizePlanningOffer((await activity.search(query, signal))[0]);
    const stay = createReadAdapter("nuitee", "accommodation", syntheticReadClient("accommodation"));
    const nextQuery = { ...query, startDate: "2030-05-02", endDate: "2030-05-09" };
    const second = normalizePlanningOffer((await stay.search(nextQuery, signal))[0]);
    expect(first.component.travellerIds).toEqual(second.component.travellerIds);
    expect(first.component.travellerIds).toHaveLength(3);
    expect(new Set(first.component.travellerIds).size).toBe(3);
    expect(first.eligibility.status).toBe("unverified");
    expect(first.unverifiedFacts).toEqual(expect.arrayContaining(["eligibility", "dates"]));
    expect(first.component.serviceStart).toBeNull();
    expect(first.component.serviceEnd).toBeNull();
  });

  it("keeps explicit research modes read-only and records clock-bound evidence", () => {
    const clock = new DeterministicClock("2030-01-01T00:00:00Z");
    const provider = new DeterministicProviderDouble(clock.now);
    expect(provider.search().offers).toHaveLength(3);
    expect(provider.detail("offer-available-001").status).toBe("available");
    expect(provider.revalidate("offer-changed-001").status).toBe("changed");
    clock.advance(1_000);
    expect(provider.search("rate_limited")).toMatchObject({
      status: "rate_limited",
      offers: [],
      checkedAt: "2030-01-01T00:00:01.000Z",
    });
    expect(provider.search("no_matches").offers).toEqual([]);
    expect(provider.counters).toMatchObject({
      search: 3,
      detail: 1,
      revalidation: 1,
      writeAttempts: 0,
      writes: 0,
    });
  });

  it("replays timeout-after-commit as a duplicate before and after a simulated process crash", () => {
    const original = new DeterministicProviderDouble();
    expect(() =>
      original.commit("crash-request", "offer-available-001", "timeout_after_commit"),
    ).toThrow(TimeoutAfterCommitError);
    for (const provider of [
      original,
      new DeterministicProviderDouble(undefined, original.snapshot()),
    ]) {
      expect(provider.commit("crash-request", "offer-available-001")).toEqual([
        expect.objectContaining({
          requestId: "crash-request",
          status: "confirmed",
          duplicate: true,
        }),
      ]);
      expect(provider.counters.writes).toBe(1);
      expect(provider.commit("partial-request", "offer-unavailable-001")[0].status).toBe(
        "rejected",
      );
    }
  });

  it("includes stable changed and unavailable offers", () => {
    expect(syntheticOffers.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "offer-available-001", status: "available" },
      { id: "offer-changed-001", status: "changed" },
      { id: "offer-unavailable-001", status: "unavailable" },
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
