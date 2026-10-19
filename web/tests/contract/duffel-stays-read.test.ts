// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createDuffelStaysHttpClient } from "../../server/supply/providers/duffel-stays-http";
import type { SupplyReadQuery } from "../../server/supply/read";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

vi.mock("server-only", () => ({}));
function query(): SupplyReadQuery {
  const trip = createSyntheticTripSnapshot();
  return { componentTypes: ["accommodation"], currency: "GBP", departureOrigin: null,
    destinationIds: [trip.destinations[0].id], startDate: "2030-05-01", endDate: "2030-05-08",
    travellerParty: { adults: 2, children: [] } };
}
function result() {
  return { id: "srr_synthetic1", cheapest_rate_currency: "GBP", cheapest_rate_total_amount: "150.05",
    check_in_date: "2030-05-01", check_out_date: "2030-05-08", expires_at: "2030-01-01T00:15:00Z",
    accommodation: { id: "acc_synthetic1", name: "Synthetic accommodation",
      email: "private@example.invalid", rooms: [{ name: "Synthetic room", rates: [{
        id: "rat_synthetic1", name: "Synthetic rate", total_currency: "GBP", total_amount: "150.05",
        tax_currency: "GBP", tax_amount: "10.05", fee_currency: "GBP", fee_amount: "3.00",
        due_at_accommodation_currency: "GBP", due_at_accommodation_amount: "5.00",
        estimated_commission_amount: "private-marker", board_type: "room_only", payment_type: "pay_now",
      }] }] } };
}
function setup(accessApproved = true) {
  const transport = vi.fn(async () => new Response(JSON.stringify({ data: { results: [result()] } })));
  const client = createDuffelStaysHttpClient({ readToken: "synthetic-read-key", accessApproved, fetch: transport,
    resolveSearch: () => ({ latitude: 51.5, longitude: -0.12, radiusKm: 5, rooms: 1 }) });
  return { client, transport };
}
describe("Duffel Stays synthetic HTTP wire", () => {
  it("requires independently approved Stays access and never attempts a quote", async () => {
    const { client, transport } = setup(false);
    await expect(client.search(query(), new AbortController().signal)).rejects.toMatchObject({ status: "access_blocked" });
    await expect(client.revalidate("srr_synthetic1", query(), new AbortController().signal))
      .rejects.toMatchObject({ status: "unsupported" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("constructs a fixed search and preserves unknown property/cost/date facts", async () => {
    const { client, transport } = setup();
    const hits = await client.search(query(), new AbortController().signal);
    expect(hits[0]).toMatchObject({ supplierMinor: null, taxesMinor: null, feesMinor: null, serviceStart: null,
      serviceEnd: null, terms: null, details: null,
      supplierReferences: { accommodationId: "acc_synthetic1", searchResultId: "srr_synthetic1" } });
    expect(JSON.parse(hits[0].planningDetails.fareConditions!)).toMatchObject({ propertyType: null, roomId: null, rateId: null,
      quoteId: null, priceFromMinor: 15005, mandatoryFeesMinor: null, dueAtPropertyMinor: null, depositMinor: null });
    expect(JSON.stringify(hits)).not.toMatch(/private@example|private-marker/);
    const call = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api.duffel.com/stays/search");
    expect(JSON.parse(call[1].body as string)).toEqual({ data: { rooms: 1,
      location: { radius: 5, geographic_coordinates: { latitude: 51.5, longitude: -0.12 } },
      guests: [{ type: "adult" }, { type: "adult" }], check_in_date: "2030-05-01", check_out_date: "2030-05-08" } });
  });
  it("retrieves actual rate IDs/cost facts without inventing room IDs, quotes or deposits", async () => {
    const { client, transport } = setup();
    const signal = new AbortController().signal;
    await client.search(query(), signal);
    transport.mockImplementation(async () => new Response(JSON.stringify({ data: result() })));
    const hit = await client.detail("srr_synthetic1", query(), signal);
    expect(JSON.parse(hit.planningDetails.fareConditions!).rooms).toEqual([{ name: "Synthetic room", roomId: null, rates: [{
      rateId: "rat_synthetic1", quoteId: null, name: "Synthetic rate", totalMinor: 15005, taxesMinor: 1005,
      feesMinor: 300, dueAtPropertyMinor: 500, depositMinor: null, expiresAt: null,
      boardType: "room_only", paymentType: "pay_now",
    }] }]);
    const call = transport.mock.calls[1] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api.duffel.com/stays/search_results/srr_synthetic1/actions/fetch_all_rates");
    expect(call[1].method).toBe("POST");
    expect(JSON.stringify(hit)).not.toContain("private-marker");
    await expect(client.detail("srr_other", query(), signal)).rejects.toMatchObject({ status: "unsupported" });
    await expect(client.revalidate("srr_synthetic1", query(), signal)).rejects.toMatchObject({ status: "unsupported" });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("does not infer a property type from a hotel-like name or an advertised rating", async () => {
    const { client, transport } = setup();
    const row = result();
    row.accommodation.name = "Hotel-like synthetic title";
    transport.mockImplementation(async () => new Response(JSON.stringify({ data: { results: [row] } })));
    const hit = (await client.search(query(), new AbortController().signal))[0];
    expect(JSON.parse(hit.planningDetails.fareConditions!).propertyType).toBeNull();
  });
});
