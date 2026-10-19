import { afterEach, describe, expect, it, vi } from "vitest";
import { createReadAdapter } from "../../server/supply/providers/adapter";
import { createPlanningProviders } from "../../server/supply/providers";
import { createDuffelReadProvider } from "../../server/supply/providers/duffel-read";
import { syntheticReadClient } from "../../server/supply/providers/synthetic";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { searchPlanningOffers, SupplyReadError, type SupplyReadProvider, type SupplyReadQuery } from "../../server/supply/read";
import { planningOfferSchema, projectPublicPlanningOffer, publicPlanningOfferSchema } from "../../server/supply/offers";
import { deriveProviderReadiness, loadServerConfig } from "../../server/config";
vi.mock("server-only", () => ({}));
describe("injected planning suppliers", () => {
  it("maps deterministic quotes without granting supplier write capabilities", async () => {
    const trip = createSyntheticTripSnapshot();
    const providers = [createDuffelReadProvider(syntheticReadClient("flight")), createReadAdapter("duffel", "accommodation", syntheticReadClient("accommodation"))];
    const result = await searchPlanningOffers(providers, { componentTypes: ["flight", "accommodation"], currency: "GBP",
      departureOrigin: trip.departureOrigin, destinationIds: trip.destinations.map((destination) => destination.id),
      startDate: "2030-05-01", endDate: "2030-05-08", travellerParty: { adults: 2, children: [] } });
    expect(result.offers).toHaveLength(3);
    expect(result.offers.filter((offer) => offer.component.type === "flight").map((offer) => offer.selectionGroup)).toEqual(["flight:outbound", "flight:return"]);
    expect(result.offers.every((offer) => offer.component.bookingStatus === "unbooked" && offer.accessibility === "unverified")).toBe(true);
    expect(providers.every((provider) => provider.capabilities.readOnly)).toBe(true);
    expect(result.offers[0].component.price.finalCustomerAmount?.minorUnits).toBeGreaterThan(0);
    const publicOffer = projectPublicPlanningOffer(result.offers[0]);
    expect(publicPlanningOfferSchema.safeParse(publicOffer).success).toBe(true);
    expect(publicOffer.component.price.finalCustomerMinor).toBeGreaterThan(0);
    expect(JSON.stringify(publicOffer)).not.toMatch(/supplierAmount|platformMargin/);
    expect(publicPlanningOfferSchema.safeParse({ ...publicOffer, rawSupplierPayload: {} }).success).toBe(false);
    expect(publicPlanningOfferSchema.safeParse({ ...publicOffer,
      component: { ...publicOffer.component, price: result.offers[0].component.price } }).success).toBe(false);
  });

  describe("truthful bounded supplier search outcomes", () => {
    afterEach(() => vi.useRealTimers());

    function query(componentTypes: SupplyReadQuery["componentTypes"] = ["flight", "accommodation", "activity", "rail"]): SupplyReadQuery {
      const trip = createSyntheticTripSnapshot();
      return { componentTypes, currency: "GBP", departureOrigin: trip.departureOrigin,
        destinationIds: trip.destinations.map((destination) => destination.id),
        startDate: "2030-05-01", endDate: "2030-05-08", travellerParty: trip.travellerParty };
    }

    function provider(name: string, type: "flight" | "accommodation" | "activity"): SupplyReadProvider {
      return createReadAdapter(name, type, syntheticReadClient(type));
    }

    it("distinguishes no matches, absent access and deferred rail without inventing a rail provider", async () => {
      const result = await searchPlanningOffers([{
        capabilities: { provider: "duffel", search: ["flight"], readOnly: true }, search: async () => [],
      }], query());
      expect(result.offers).toEqual([]);
      expect(result.outcomes).toEqual([
        expect.objectContaining({ provider: "duffel", componentType: "flight", status: "no_matches", retryable: false }),
        expect.objectContaining({ provider: "duffel", componentType: "accommodation", status: "unconfigured" }),
        expect.objectContaining({ provider: "viator", componentType: "activity", status: "unconfigured" }),
        expect.objectContaining({ provider: null, componentType: "rail", status: "unsupported", retryable: false }),
      ]);
      expect(result.outcomes.every((outcome) => outcome.safeReason.length > 0)).toBe(true);
    });

    it("never calls rail inventory adapters, including rail-only requests", async () => {
      let railReads = 0;
      const rail: SupplyReadProvider = {
        capabilities: { provider: "trainline", search: ["rail"], readOnly: true },
        search: async () => { railReads += 1; throw new Error("Deferred rail must not be called"); },
      };
      for (const componentTypes of [["rail"], ["flight", "rail"]] satisfies SupplyReadQuery["componentTypes"][]) {
        const result = await searchPlanningOffers([provider("duffel", "flight"), rail], query(componentTypes));
        expect(result.outcomes.find((outcome) => outcome.componentType === "rail"))
          .toMatchObject({ provider: null, status: "unsupported" });
        expect(result.offers.every((offer) => offer.component.type === "flight")).toBe(true);
      }
      expect(railReads).toBe(0);
    });

    it("composes only current products in demonstration mode, without deferred credentials or fake live fallbacks", async () => {
      const providers = createPlanningProviders("deterministic");
      expect(providers.map((source) => [source.capabilities.provider, source.capabilities.search]))
        .toEqual([["duffel", ["flight"]], ["duffel", ["accommodation"]], ["viator", ["activity"]]]);
      const result = await searchPlanningOffers(providers, query());
      expect(result.offers).toHaveLength(4);
      expect(result.outcomes.filter((source) => source.status === "available")
        .every((source) => source.mode === "deterministic")).toBe(true);
      const live = await searchPlanningOffers(createPlanningProviders("live"), query());
      expect(live.offers).toEqual([]);
      expect(live.outcomes.map((source) => source.status)).toEqual(["unconfigured", "unconfigured", "unconfigured", "unsupported"]);
      expect(live.outcomes.some((source) => source.status === "available")).toBe(false);
    });

    it.each(["booking", "booking.com", "trainline", "getyourguide"])(
      "does not use deferred/replaced %s inventory as an active fallback or relabel it",
      async (name) => {
        let reads = 0;
        const source: SupplyReadProvider = {
          capabilities: { provider: name, search: ["flight", "accommodation", "activity", "rail"], readOnly: true },
          search: async () => { reads += 1; return []; },
        };
        const result = await searchPlanningOffers([source], query());
        expect(reads).toBe(0);
        expect(result.offers).toEqual([]);
        expect(result.outcomes.map((entry) => entry.status))
          .toEqual(["unconfigured", "unconfigured", "unconfigured", "unsupported"]);
        expect(result.outcomes.some((entry) => entry.provider === name)).toBe(false);
      },
    );

    it("isolates Duffel products, preserves Viator results and never mutates caller state or invokes writes", async () => {
      let writes = 0;
      const request = query();
      const before = structuredClone(request);
      const flight = provider("duffel", "flight");
      const stay: SupplyReadProvider = {
        capabilities: { provider: "duffel", search: ["accommodation"], readOnly: true },
        search: async (input) => {
          input.destinationIds.length = 0;
          throw new SupplyReadError("access_blocked");
        },
      };
      const activity = { ...provider("viator", "activity"), execute: () => { writes += 1; } };
      const result = await searchPlanningOffers([flight, stay, activity], request);
      expect(result.offers.map((offer) => offer.component.type)).toContain("flight");
      expect(result.offers.map((offer) => offer.component.type)).toContain("activity");
      expect(result.outcomes.filter((outcome) => outcome.provider === "duffel"))
        .toEqual([expect.objectContaining({ componentType: "flight", status: "available" }),
          expect.objectContaining({ componentType: "accommodation", status: "access_blocked" })]);
      expect(request).toEqual(before);
      expect(writes).toBe(0);
    });

    it("uses product readiness even when composition omits blocked or unverified live adapters", async () => {
      const environment = { PROVIDER_MODE: "live", DUFFEL_READ_SECRET: "synthetic-read-canary",
        VIATOR_SECRET: "synthetic-shared-canary", SUPPLIER_PROVIDERS: JSON.stringify({
          duffel: { readSecretRef: "DUFFEL_READ_SECRET", products: {
            flight: { operations: { search: { support: "supported", access: "verified",
              evidenceRef: "synthetic-approved-flight", verifiedAt: "2026-10-19T00:00:00Z" } } },
            accommodation: { operations: { search: { support: "supported", access: "blocked" } } },
          } },
          viator: { readSecretRef: "VIATOR_SECRET", products: { activity: {
            operations: { search: { support: "supported" } },
          } } },
        }) };
      const readiness = deriveProviderReadiness(loadServerConfig(environment), environment);
      const result = await searchPlanningOffers([provider("duffel", "flight")], query(), new Date(), { readiness });
      expect(result.outcomes.map((source) => source.status))
        .toEqual(["available", "access_blocked", "access_blocked", "unsupported"]);
      expect(result.outcomes.filter((source) => source.provider !== null).every((source) => source.mode === "live")).toBe(true);
      expect(JSON.stringify(result.outcomes)).not.toMatch(/canary|SecretRef|synthetic-approved-flight/);
    });

    it.each(["unconfigured", "access_blocked", "unsupported", "rate_limited", "error"] as const)(
      "returns a safe explicit %s outcome without raw provider error text or uncontrolled retry",
      async (status) => {
        let reads = 0;
        const source: SupplyReadProvider = {
          capabilities: { provider: "viator", search: ["activity"], readOnly: true },
          search: async () => {
            reads += 1;
            const error = new SupplyReadError(status, status === "rate_limited" ? 2_000 : undefined);
            error.message = "secret raw supplier response passport commission";
            throw error;
          },
        };
        const result = await searchPlanningOffers([source], query(["activity"]));
        expect(result.offers).toEqual([]);
        expect(result.outcomes[0]).toMatchObject({ provider: "viator", componentType: "activity", status,
          retryAfterMs: status === "rate_limited" ? 2_000 : null });
        expect(JSON.stringify(result)).not.toMatch(/secret|passport|commission|raw supplier/);
        expect(reads).toBe(1);
      },
    );

    it("does not misclassify arbitrary upstream error objects as trusted rate-limit guidance", async () => {
      const result = await searchPlanningOffers([{
        capabilities: { provider: "viator", search: ["activity"], readOnly: true },
        search: async () => { throw { status: "rate_limited", retryAfterMs: -1, message: "secret" }; },
      }], query(["activity"]));
      expect(result.outcomes[0]).toMatchObject({ status: "error", retryAfterMs: null });
      expect(JSON.stringify(result)).not.toContain("secret");
    });

    it("bounds and deduplicates fairly by product even when one adapter serves multiple products", async () => {
      const sharedOfferId = "synthetic-shared-offer";
      const multi: SupplyReadProvider = {
        capabilities: { provider: "duffel", search: ["flight", "accommodation"], readOnly: true },
        search: async (input, signal) => {
          const type = input.componentTypes[0];
          if (type !== "flight" && type !== "accommodation") throw new Error("Unexpected query");
          const offers = await provider("duffel", type).search(input, signal);
          const first = planningOfferSchema.parse(offers[0]);
          return Array.from({ length: 32 }, () => ({ ...first, component: { ...first.component, supplierOfferId: sharedOfferId } }));
        },
      };
      const result = await searchPlanningOffers([multi, provider("viator", "activity")], query());
      expect(result.offers).toHaveLength(3);
      expect(new Set(result.offers.map((offer) => offer.component.type)))
        .toEqual(new Set(["flight", "accommodation", "activity"]));
      expect(result.outcomes.filter((outcome) => outcome.provider === "duffel")).toHaveLength(2);
    });

    it("deduplicates before truncating so repeated flight hits cannot starve distinct offers", async () => {
      const source = provider("duffel", "flight");
      const found = await source.search(query(["flight"]), new AbortController().signal);
      const first = found[0];
      const result = await searchPlanningOffers([{ ...source, search: async () =>
        [...Array.from({ length: 31 }, () => first), found[1]] }], query(["flight"]));
      expect(result.offers).toHaveLength(2);
      expect(new Set(result.offers.map((offer) => offer.selectionGroup))).toEqual(new Set(["flight:outbound", "flight:return"]));
    });

    it("returns exactly 32 unique offers with fair product allocation when all three products fill the budget", async () => {
      const providers = [provider("duffel", "flight"), provider("duffel", "accommodation"), provider("viator", "activity")]
        .map((source): SupplyReadProvider => ({ ...source, search: async (input, signal) => {
          const first = planningOfferSchema.parse((await source.search(input, signal))[0]);
          return Array.from({ length: 32 }, (_, index) => ({ ...first,
            component: { ...first.component, supplierOfferId: `${first.component.type}-${index}` } }));
        } }));
      const result = await searchPlanningOffers(providers, query());
      expect(result.offers).toHaveLength(32);
      expect(Object.fromEntries(["flight", "accommodation", "activity"].map((type) =>
        [type, result.offers.filter((offer) => offer.component.type === type).length])))
        .toEqual({ flight: 11, accommodation: 11, activity: 10 });
      expect(new Set(result.offers.map((offer) => `${offer.component.provider}:${offer.component.type}:${offer.component.supplierOfferId}`)).size).toBe(32);
    });

    it("rejects malformed or wrong-source results without discarding successful siblings", async () => {
      const wrongSource = provider("different-provider", "flight");
      const result = await searchPlanningOffers([{
        ...wrongSource, capabilities: { ...wrongSource.capabilities, provider: "duffel" },
      }, provider("duffel", "accommodation"), {
        capabilities: { provider: "viator", search: ["activity"], readOnly: true },
        search: async () => Array.from({ length: 33 }, () => ({})),
      }], query());
      expect(result.outcomes.filter((outcome) => outcome.status === "error")).toHaveLength(2);
      expect(result.offers).toHaveLength(1);
      expect(result.offers[0].component.type).toBe("accommodation");
    });

    it("aborts a slow source at 8 seconds, preserves quick results and ignores late completion", async () => {
      vi.useFakeTimers();
      const activity = provider("viator", "activity");
      const request = query(["flight", "activity"]);
      let capturedSignal: AbortSignal | undefined;
      let finish: ((offers: readonly unknown[]) => void) | undefined;
      const flight: SupplyReadProvider = {
        capabilities: { provider: "duffel", search: ["flight"], readOnly: true },
        search: (_query, signal) => {
          capturedSignal = signal;
          return new Promise((resolve) => { finish = resolve; });
        },
      };
      const pending = searchPlanningOffers([flight, activity], request);
      await vi.advanceTimersByTimeAsync(8_000);
      const result = await pending;
      expect(result.outcomes[0]).toMatchObject({ status: "deadline", componentType: "flight" });
      expect(capturedSignal?.aborted).toBe(true);
      expect(result.offers).toHaveLength(1);
      finish?.(await provider("duffel", "flight").search(request, new AbortController().signal));
      await vi.runAllTimersAsync();
      expect(result.offers).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("propagates request cancellation and never starts a pre-cancelled search", async () => {
      const abort = new AbortController();
      abort.abort();
      let reads = 0;
      const source: SupplyReadProvider = {
        capabilities: { provider: "viator", search: ["activity"], readOnly: true },
        search: async () => { reads += 1; return []; },
      };
      const result = await searchPlanningOffers([source], query(["activity"]), new Date(), { signal: abort.signal });
      expect(reads).toBe(0);
      expect(result.outcomes[0]).toMatchObject({ status: "deadline", retryable: false });
    });

    it("cancels in-flight reads promptly, propagates abort and removes pending source timers", async () => {
      vi.useFakeTimers();
      const abort = new AbortController();
      const signals: AbortSignal[] = [];
      const sources = ["flight", "accommodation"].map((type): SupplyReadProvider => ({
        capabilities: { provider: "duffel", search: [type === "flight" ? "flight" : "accommodation"], readOnly: true },
        search: (_input, signal) => { signals.push(signal); return new Promise(() => {}); },
      }));
      const pending = searchPlanningOffers(sources, query(["flight", "accommodation"]), new Date(), { signal: abort.signal });
      await vi.advanceTimersByTimeAsync(25);
      abort.abort();
      const result = await pending;
      expect(signals).toHaveLength(2);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      expect(result.outcomes.every((source) => source.status === "deadline" && !source.retryable)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("rejects duplicate query selections and ambiguous duplicate product adapters before provider calls", async () => {
      let reads = 0;
      const source: SupplyReadProvider = {
        capabilities: { provider: "viator", search: ["activity"], readOnly: true },
        search: async () => { reads += 1; return []; },
      };
      await expect(searchPlanningOffers([source], query(["activity", "activity"]))).rejects.toThrow();
      await expect(searchPlanningOffers([source, source], query(["activity"]))).rejects.toThrow();
      expect(reads).toBe(0);
    });
  });
  it("fails closed for rate limits and credentials without leaking vendor errors", async () => {
    const trip = createSyntheticTripSnapshot();
    const provider = createDuffelReadProvider({ search: async () => { throw new Error("429 secret credential"); } });
    const result = await searchPlanningOffers([provider], { componentTypes: ["flight"], currency: "GBP",
      departureOrigin: trip.departureOrigin, destinationIds: trip.destinations.map((destination) => destination.id),
      startDate: "2030-05-01", endDate: "2030-05-08", travellerParty: trip.travellerParty });
    expect(result.offers).toEqual([]); expect(JSON.stringify(result)).not.toContain("secret");
  });
});
