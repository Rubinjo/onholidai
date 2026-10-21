// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createPlanningProviders } from "../../server/supply/providers";
import { createReadAdapter } from "../../server/supply/providers/adapter";
import { syntheticReadClient } from "../../server/supply/providers/synthetic";
import { normalizePlanningOffer, projectPublicPlanningOffer } from "../../server/supply/offers";
import { searchPlanningOffers, type SupplyReadProvider, type SupplyReadQuery } from "../../server/supply/read";
import { createProviderTransactionAdapter, TransactionProviderRegistry } from "../../server/supply/transactions";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

vi.mock("server-only", () => ({}));

function query(componentTypes: SupplyReadQuery["componentTypes"]): SupplyReadQuery {
  const trip = createSyntheticTripSnapshot();
  return { componentTypes, currency: "GBP", departureOrigin: trip.departureOrigin,
    destinationIds: trip.destinations.map((destination) => destination.id),
    startDate: "2030-05-01", endDate: "2030-05-08", travellerParty: trip.travellerParty };
}

describe("deferred and replaced supplier compatibility", () => {
  it.each(["booking", "booking.com", "trainline", "getyourguide"])(
    "does not invoke %s as fallback for rail-only or mixed current searches",
    async (provider) => {
      const search = vi.fn(async () => []);
      const legacy: SupplyReadProvider = { capabilities: {
        provider, search: ["flight", "accommodation", "activity", "rail"], readOnly: true,
      }, search };
      const current = createPlanningProviders("deterministic");
      const mixed = await searchPlanningOffers([...current, legacy], query(["flight", "accommodation", "activity", "rail"]));
      expect(new Set(mixed.offers.map((offer) => `${offer.component.provider}:${offer.component.type}`)))
        .toEqual(new Set(["duffel:flight", "duffel:accommodation", "viator:activity"]));
      expect(mixed.outcomes.at(-1)).toMatchObject({ provider: null, componentType: "rail", status: "unsupported" });
      const rail = await searchPlanningOffers([legacy], query(["rail"]));
      expect(rail.offers).toEqual([]);
      expect(rail.outcomes).toEqual([expect.objectContaining({
        provider: null, componentType: "rail", status: "unsupported", retryable: false,
      })]);
      expect(search).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["booking", "accommodation"], ["booking.com", "accommodation"],
    ["trainline", "rail"], ["getyourguide", "activity"],
  ] as const)("preserves saved %s provenance without promoting it to current live evidence", async (provider, type) => {
    const source = createReadAdapter(provider, type, syntheticReadClient(type));
    const saved = normalizePlanningOffer((await source.search(query([type]), new AbortController().signal))[0]);
    const before = structuredClone(saved);
    const projected = projectPublicPlanningOffer(saved);
    expect(projected.component.provider).toBe(provider);
    expect(projected.attribution.provider).toBe(provider);
    expect(projected.component.supplierOfferId).toBe(saved.component.supplierOfferId);
    expect(projected.component.bookingStatus).toBe("unbooked");
    expect(projected.sourceMode).toBe("unknown");
    expect(projected.evidence).toBeUndefined();
    expect(saved).toEqual(before);
  });

  it.each(["booking", "trainline", "getyourguide"] as const)(
    "retains an injected legacy %s status reader and its existing confirmation without issuing a new write",
    async (provider) => {
      const execute = vi.fn(async () => ({ status: "failed" }));
      const confirmation = { status: "confirmed", providerReference: `synthetic-legacy-${provider}`,
        evidenceId: `synthetic-evidence-${provider}`, confirmedTerms: { originalProvider: provider } };
      const getStatus = vi.fn(async () => confirmation);
      const registry = new TransactionProviderRegistry();
      registry.register(createProviderTransactionAdapter(provider, {
        capabilities: { book: false, status: true, idempotency: false, cancel: false, reschedule: false },
        execute, getStatus,
      }));
      expect(await registry.get(provider)?.getStatus?.("synthetic-existing-action")).toEqual(confirmation);
      expect(getStatus).toHaveBeenCalledExactlyOnceWith("synthetic-existing-action");
      expect(execute).not.toHaveBeenCalled();
      expect(() => registry.require(provider, "book_trip")).toThrow("does not support");
    },
  );
});
