import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
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

  it.each(["hotel", "apartment", "villa", "hostel"])(
    "preserves sourced %s property facts without filling unknown dates, costs or terms",
    async (accommodationType) => {
      const trip = createSyntheticTripSnapshot();
      const query: SupplyReadQuery = { componentTypes: ["accommodation"], currency: "GBP", departureOrigin: null,
        destinationIds: trip.destinations.map((destination) => destination.id), startDate: "2030-05-01",
        endDate: "2030-05-08", travellerParty: trip.travellerParty };
      const queryBefore = structuredClone(query);
      const synthetic = await syntheticReadClient("accommodation").search(query, new AbortController().signal);
      const hit = z.array(z.record(z.string(), z.unknown())).parse(synthetic)[0];
      const execute = vi.fn();
      const client = {
        search: async () => [{ ...hit, serviceStart: null, serviceEnd: null, supplierMinor: null,
          taxesMinor: null, feesMinor: null, terms: null, details: null,
          planningDetails: { locationName: null, timezone: null, airportNames: [], airlines: [], flightDirection: null,
            durationMinutes: null, layovers: [], fareConditions: null, accommodationType, travelFromStayMinutes: null,
            eligibility: "unverified", accessibility: "unverified", availability: "unverified",
            constraintEvidence: [], source: "Synthetic property evidence", checkedAt: hit.checkedAt, unavailableFacts: [] } }],
        execute,
      };
      const source = createReadAdapter("duffel", "accommodation", client);
      const result = await searchPlanningOffers([source], query);
      expect(result.outcomes[0]).toMatchObject({ provider: "duffel", componentType: "accommodation", status: "available" });
      const offer = projectPublicPlanningOffer(result.offers[0]);
      expect(offer.component).toMatchObject({ provider: "duffel", type: "accommodation", serviceStart: null, serviceEnd: null,
        cancellationTerms: null, details: null, planningDetails: { accommodationType },
        price: { finalCustomerMinor: null, taxesMinor: null, feesMinor: null }, bookingStatus: "unbooked" });
      expect(offer.unverifiedFacts).toEqual(expect.arrayContaining(["dates", "price", "taxes", "fees", "terms", "details"]));
      expect(execute).not.toHaveBeenCalled();
      expect(query).toEqual(queryBefore);
    },
  );

  it("removes nested supplier privacy canaries without exposing credentials or protected economics", async () => {
    const trip = createSyntheticTripSnapshot();
    const query: SupplyReadQuery = { componentTypes: ["accommodation"], currency: "GBP", departureOrigin: null,
      destinationIds: trip.destinations.map((destination) => destination.id), startDate: "2030-05-01",
      endDate: "2030-05-08", travellerParty: trip.travellerParty };
    const hit = z.array(z.record(z.string(), z.unknown())).parse(
      await syntheticReadClient("accommodation").search(query, new AbortController().signal))[0];
    const source = createReadAdapter("duffel", "accommodation", { search: async () => [{ ...hit,
      terms: "api_key=synthetic-credential-canary",
      details: { occupancy: "supplier_amount=synthetic-economics-canary",
        amenities: ["passport_number=synthetic-identity-canary", "card_number=synthetic-payment-canary"] },
    }] });
    const result = await searchPlanningOffers([source], query);
    expect(result.offers).toHaveLength(1);
    const offer = projectPublicPlanningOffer(result.offers[0]);
    expect(publicPlanningOfferSchema.safeParse(offer).success).toBe(true);
    expect(JSON.stringify(offer)).not.toMatch(/synthetic-(?:credential|economics|identity|payment)-canary|supplierAmount|platformMargin/);
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
        vi.useFakeTimers();
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
        const pending = searchPlanningOffers([source], query(["activity"]));
        await vi.advanceTimersByTimeAsync(2_000);
        const result = await pending;
        expect(result.offers).toEqual([]);
        expect(result.outcomes[0]).toMatchObject({ provider: "viator", componentType: "activity", status,
          retryAfterMs: status === "rate_limited" ? 2_000 : null });
        expect(JSON.stringify(result)).not.toMatch(/secret|passport|commission|raw supplier/);
        expect(reads).toBe(status === "rate_limited" ? 2 : 1);
        expect(vi.getTimerCount()).toBe(0);
      },
    );

    it("retries once only after trusted rate guidance, inside the original eight-second source budget", async () => {
      vi.useFakeTimers();
      const source = provider("viator", "activity");
      const search = vi.fn(source.search).mockRejectedValueOnce(new SupplyReadError("rate_limited", 2_000));
      const pending = searchPlanningOffers([{ ...source, search }], query(["activity"]));
      await vi.advanceTimersByTimeAsync(1_999);
      expect(search).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      const result = await pending;
      expect(search).toHaveBeenCalledTimes(2);
      expect(result.outcomes[0].status).toBe("available");
      expect(result.offers).toHaveLength(1);
      expect(search.mock.calls[0][1]).toBe(search.mock.calls[1][1]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([null, 8_000, 20_000])("does not retry absent or non-fitting rate guidance (%s ms)", async (retryAfterMs) => {
      vi.useFakeTimers();
      const search = vi.fn(async () => { throw new SupplyReadError("rate_limited", retryAfterMs ?? undefined); });
      const pending = searchPlanningOffers([{
        capabilities: { provider: "viator", search: ["activity"], readOnly: true }, search,
      }], query(["activity"]));
      await vi.runAllTimersAsync();
      expect((await pending).outcomes[0]).toMatchObject({ status: "rate_limited", retryAfterMs });
      expect(search).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("does not reset the source deadline for a rate-directed retry", async () => {
      vi.useFakeTimers();
      const signals: AbortSignal[] = [];
      const search = vi.fn(async (_query: SupplyReadQuery, signal: AbortSignal): Promise<readonly unknown[]> => {
        signals.push(signal);
        if (signals.length === 1) throw new SupplyReadError("rate_limited", 2_000);
        return new Promise(() => {});
      });
      const pending = searchPlanningOffers([{
        capabilities: { provider: "viator", search: ["activity"], readOnly: true }, search,
      }], query(["activity"]));
      await vi.advanceTimersByTimeAsync(7_999);
      expect(search).toHaveBeenCalledTimes(2);
      expect(signals[1].aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect((await pending).outcomes[0].status).toBe("deadline");
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("cancels a rate-limit wait without a second supplier call or leaked listeners", async () => {
      vi.useFakeTimers();
      const abort = new AbortController();
      const search = vi.fn(async () => { throw new SupplyReadError("rate_limited", 2_000); });
      const pending = searchPlanningOffers([{
        capabilities: { provider: "viator", search: ["activity"], readOnly: true }, search,
      }], query(["activity"]), new Date(), { signal: abort.signal });
      await vi.advanceTimersByTimeAsync(1_000);
      abort.abort();
      expect((await pending).outcomes[0]).toMatchObject({ status: "deadline", retryable: false });
      await vi.runAllTimersAsync();
      expect(search).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

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

    it("does not starve return-leg requirements behind many outbound offers", async () => {
      const sources = [provider("duffel", "flight"), provider("duffel", "accommodation"), provider("viator", "activity")]
        .map((source): SupplyReadProvider => ({ ...source, search: async (input, signal) => {
          const first = planningOfferSchema.parse((await source.search(input, signal))[0]);
          return Array.from({ length: 32 }, (_, index) => ({ ...first,
            selectionGroup: first.component.type === "flight" && index === 31 ? "flight:return" : first.selectionGroup,
            component: { ...first.component, supplierOfferId: `${first.component.type}-${index}` } }));
        } }));
      const result = await searchPlanningOffers(sources, query());
      expect(result.offers).toHaveLength(32);
      expect(result.offers.filter((offer) => offer.component.type === "flight").map((offer) => offer.selectionGroup))
        .toContain("flight:return");
      expect(result.offers[3].selectionGroup).toBe("flight:return");
    });

    it("allocates by product rather than giving extra flight adapters a second budget share", async () => {
      const sources = [provider("duffel", "flight"), provider("synthetic-flights", "flight"),
        provider("duffel", "accommodation"), provider("viator", "activity")]
        .map((source): SupplyReadProvider => ({ ...source, search: async (input, signal) => {
          const first = planningOfferSchema.parse((await source.search(input, signal))[0]);
          return Array.from({ length: 32 }, (_, index) => ({ ...first,
            component: { ...first.component, supplierOfferId: `${first.component.type}-${index}` } }));
        } }));
      const result = await searchPlanningOffers(sources, query());
      expect(result.offers).toHaveLength(32);
      expect(Object.fromEntries(["flight", "accommodation", "activity"].map((type) =>
        [type, result.offers.filter((offer) => offer.component.type === type).length])))
        .toEqual({ flight: 11, accommodation: 11, activity: 10 });
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
