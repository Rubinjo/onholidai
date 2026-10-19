// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createViatorHttpClient } from "../../server/supply/providers/viator-http";
import type { SupplyReadQuery } from "../../server/supply/read";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

vi.mock("server-only", () => ({}));
function query(): SupplyReadQuery {
  const trip = createSyntheticTripSnapshot();
  return { componentTypes: ["activity"], currency: "GBP", departureOrigin: null,
    destinationIds: [trip.destinations[0].id], startDate: "2030-05-01", endDate: "2030-05-01",
    travellerParty: { adults: 2, children: [] } };
}
const product = { productCode: "SYNTHETIC1", title: "Synthetic activity",
  pricing: { currency: "GBP", summary: { fromPrice: 12.03 }, partnerNetFromPrice: "private-price-marker" },
  bookingQuestions: ["private-marker"], supplier: { email: "private@example.invalid" } };
function setup() {
  const transport = vi.fn(async () => new Response(JSON.stringify({ products: [product] })));
  const client = createViatorHttpClient({ apiKey: "synthetic-single-upstream-key", fetch: transport,
    resolveDestination: () => "1234", resolvePaxMix: () => [{ ageBand: "ADULT", numberOfTravelers: 2 }] });
  return { client, transport };
}
describe("Viator synthetic HTTP wire", () => {
  it("uses only a fixed read-only search with the single upstream key", async () => {
    const { client, transport } = setup();
    const hits = await client.search(query(), new AbortController().signal);
    expect(hits[0]).toMatchObject({ supplierMinor: null, taxesMinor: null, feesMinor: null,
      serviceStart: null, serviceEnd: null, expiresAt: null, terms: null, details: null });
    expect(JSON.parse(hits[0].planningDetails.fareConditions!)).toMatchObject({
      fromPriceMinor: 1203, availability: "content_only", priceBasis: "from_price_not_party_total" });
    expect(JSON.stringify(hits)).not.toMatch(/private|upstream-key/);
    const call = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api.viator.com/partner/products/search");
    expect(call[1]).toMatchObject({ method: "POST", headers: { "exp-api-key": "synthetic-single-upstream-key",
      Accept: "application/json;version=2.0" }, redirect: "error" });
    expect(JSON.parse(call[1].body as string)).toEqual({ filtering: {
      destination: "1234", startDate: "2030-05-01", endDate: "2030-05-01" },
    pagination: { start: 1, count: 32 }, currency: "GBP" });
    expect(Object.keys(client).sort()).toEqual(["detail", "revalidate", "search"]);
  });
  it("reads product detail and availability without bookings, cart, holds or raw economics", async () => {
    const { client, transport } = setup();
    const signal = new AbortController().signal;
    await client.search(query(), signal);
    transport.mockImplementation(async () => new Response(JSON.stringify(product)));
    expect(JSON.parse((await client.detail("SYNTHETIC1", query(), signal)).planningDetails.fareConditions!).availability).toBe("content_only");
    transport.mockImplementation(async (...args: unknown[]) => new Response(JSON.stringify(String(args[0]).endsWith("/availability/check")
      ? { productCode: "SYNTHETIC1", travelDate: "2030-05-01", currency: "GBP",
        bookableItems: [{ available: true, productOptionCode: "OPTION1", startTime: "10:00",
          totalPrice: { price: { recommendedRetailPrice: 24.06, partnerNetPrice: 18.04, bookingFee: 0.99 } } }] }
      : product)));
    const hit = await client.revalidate("SYNTHETIC1", query(), signal);
    expect(JSON.parse(hit.planningDetails.fareConditions!)).toMatchObject({ recommendedRetailMinor: 2406, productOptionCode: "OPTION1",
      availability: "available_not_reserved", mandatoryFeesMinor: null });
    expect(hit.supplierMinor).toBeNull();
    expect(JSON.stringify(hit)).not.toMatch(/partnerNetPrice|bookingFee|private/);
    const calls = transport.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      "POST https://api.viator.com/partner/products/search",
      "GET https://api.viator.com/partner/products/SYNTHETIC1",
      "GET https://api.viator.com/partner/products/SYNTHETIC1",
      "POST https://api.viator.com/partner/availability/check",
    ]);
    expect(JSON.parse(calls[3][1].body as string)).toEqual({ productCode: "SYNTHETIC1",
      travelDate: "2030-05-01", currency: "GBP", paxMix: [{ ageBand: "ADULT", numberOfTravelers: 2 }] });
  });
  it("rejects arbitrary products, operation injection and scope changes before HTTP", async () => {
    const { client, transport } = setup();
    const signal = new AbortController().signal;
    await expect(client.detail("../bookings/book", query(), signal)).rejects.toMatchObject({ status: "unsupported" });
    await expect(client.detail("UNGRANTED", query(), signal)).rejects.toMatchObject({ status: "unsupported" });
    await client.search(query(), signal);
    await expect(client.revalidate("SYNTHETIC1", { ...query(), endDate: "2030-05-02" }, signal))
      .rejects.toMatchObject({ status: "unsupported" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("fails closed rather than guessing age bands or choosing an activity day", async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify({ products: [product] })));
    const client = createViatorHttpClient({ apiKey: "synthetic-key", fetch: transport, resolveDestination: () => "1234" });
    await client.search(query(), new AbortController().signal);
    await expect(client.revalidate("SYNTHETIC1", query(), new AbortController().signal))
      .rejects.toMatchObject({ status: "unsupported" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("supports only the explicitly selected approved sandbox base", async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify({ products: [] })));
    const client = createViatorHttpClient({ apiKey: "synthetic-key", fetch: transport,
      environment: "sandbox", resolveDestination: () => "1234" });
    await expect(client.search(query(), new AbortController().signal)).resolves.toEqual([]);
    expect((transport.mock.calls[0] as unknown as [string])[0]).toBe("https://api.sandbox.viator.com/partner/products/search");
  });
});
