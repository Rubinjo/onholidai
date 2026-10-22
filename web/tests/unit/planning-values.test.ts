import { describe, expect, it } from "vitest";

import { normalizeAvailabilityWindows } from "../../domain/trip/availability";
import { lookupPlaces, resolvePlace } from "../../domain/trip/destination";
import { addMoney } from "../../domain/pricing/money";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

describe("planning values", () => {
  it("merges overlapping optimization windows without changing traveller preferences", () => {
    const original = createSyntheticTripSnapshot().availabilityWindows;
    const windows = [
      ...original,
      {
        ...original[0],
        id: "10000000-0000-4000-8000-000000000010",
        startDate: "2030-05-08",
        endDate: "2030-05-12",
      },
    ];
    expect(normalizeAvailabilityWindows(windows)).toEqual([
      {
        startDate: "2030-05-01",
        endDate: "2030-05-12",
        timezone: "Europe/Lisbon",
        preference: "preferred",
      },
    ]);
    expect(windows[0].endDate).toBe("2030-05-10");
  });

  it("keeps different timezones and flexible alternatives separate", () => {
    const window = createSyntheticTripSnapshot().availabilityWindows[0];
    expect(
      normalizeAvailabilityWindows([
        window,
        { ...window, preference: "flexible" },
        { ...window, timezone: "Europe/Amsterdam" },
      ]),
    ).toHaveLength(3);
  });

  it("requires selection when a geographic name has multiple identities", async () => {
    const provider = {
      search: async () => [
        {
          placeId: "paris-fr",
          kind: "city" as const,
          name: "Paris",
          countryCode: "FR",
          timezone: "Europe/Paris",
          airportCode: null,
          location: null,
        },
        {
          placeId: "paris-us",
          kind: "city" as const,
          name: "Paris",
          countryCode: "US",
          timezone: "America/Chicago",
          airportCode: null,
          location: null,
        },
      ],
    };
    const result = await lookupPlaces(provider, { query: "Paris" });
    expect(result.ambiguous).toBe(true);
    expect(() => resolvePlace(result.candidates, "paris-us")).not.toThrow();
    expect(() => resolvePlace(result.candidates, "unknown")).toThrow();
    expect(() => resolvePlace(result.candidates)).toThrow();
  });

  it("rejects mixed currencies and integer overflow", () => {
    expect(
      addMoney({ currency: "GBP", minorUnits: 20 }, { currency: "GBP", minorUnits: 30 }),
    ).toEqual({ currency: "GBP", minorUnits: 50 });
    expect(() =>
      addMoney({ currency: "GBP", minorUnits: 20 }, { currency: "EUR", minorUnits: 30 }),
    ).toThrow();
    expect(() =>
      addMoney(
        { currency: "GBP", minorUnits: Number.MAX_SAFE_INTEGER },
        { currency: "GBP", minorUnits: 1 },
      ),
    ).toThrow();
  });

  it("projects the public price and rejects unknown nested fields before projection", () => {
    const snapshot = createSyntheticTripSnapshot();
    const customer = projectCustomerSnapshot(snapshot);
    expect(customer.price).toMatchObject({
      currency: "GBP",
      finalCustomerMinor: 0,
      status: "estimated",
    });
    expect(JSON.stringify(customer)).not.toMatch(/supplierTotal|platformMarginTotal/);
    expect(() =>
      projectCustomerSnapshot({ ...snapshot, injected: { supplierAmount: 98765 } }),
    ).toThrow();
    expect(snapshot.price).toHaveProperty("supplierTotal");
  });
});
