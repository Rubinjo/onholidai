// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createDuffelFlightsHttpClient } from "../../server/supply/providers/duffel-http";
import { createDuffelReadProvider } from "../../server/supply/providers/duffel-read";
import type { SupplyReadQuery } from "../../server/supply/read";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

vi.mock("server-only", () => ({}));
const now = () => new Date("2030-01-01T00:00:00Z");
function query(): SupplyReadQuery {
  const trip = createSyntheticTripSnapshot();
  return { componentTypes: ["flight"], currency: "GBP", departureOrigin: { ...trip.departureOrigin, airportCode: "LHR" },
    destinationIds: [trip.destinations[0].id], startDate: "2030-05-01", endDate: "2030-05-08",
    travellerParty: { adults: 2, children: [] } };
}
function offer() {
  return { id: "off_synthetic1", base_currency: "GBP", total_currency: "GBP", tax_currency: "GBP",
    base_amount: "100.10", tax_amount: "20.20", total_amount: "120.30", expires_at: "2030-01-01T00:15:00Z",
    slices: [{ segments: [{ departing_at: "2030-05-01T10:00:00", arriving_at: "2030-05-01T14:00:00",
      origin: { iata_code: "LHR" }, destination: { iata_code: "JFK" } }] }],
    conditions: { refund_before_departure: { allowed: false } }, client_key: "synthetic-private-marker" };
}
function setup(payload: unknown = { data: { offers: [offer()] } }) {
  const transport = vi.fn(async () => new Response(JSON.stringify(payload)));
  const client = createDuffelFlightsHttpClient({ readToken: "synthetic-read-key", fetch: transport, now,
    resolveDestination: () => "JFK" });
  return { client, transport };
}
describe("Duffel Flights synthetic HTTP wire", () => {
  it("constructs only documented round-trip search fields and exact minor amounts", async () => {
    const { client, transport } = setup();
    const hits = await client.search(query(), new AbortController().signal);
    expect(hits[0]).toMatchObject({ offerId: "off_synthetic1", supplierMinor: 10010, taxesMinor: 2020,
      feesMinor: null, checkedAt: now().toISOString(), expiresAt: "2030-01-01T00:15:00.000Z",
      serviceStart: null, serviceEnd: null, terms: null });
    expect(JSON.stringify(hits)).not.toContain("synthetic-private-marker");
    const call = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api.duffel.com/air/offer_requests?return_offers=true");
    expect(call[1]).toMatchObject({ method: "POST", redirect: "error", credentials: "omit",
      headers: { Authorization: "Bearer synthetic-read-key", "Duffel-Version": "v2" } });
    expect(JSON.parse(call[1].body as string)).toEqual({ data: { slices: [
      { origin: "LHR", destination: "JFK", departure_date: "2030-05-01" },
      { origin: "JFK", destination: "LHR", departure_date: "2030-05-08" }], passengers: [{ type: "adult" }, { type: "adult" }] } });
  });
  it("maps into the existing adapter without fabricating local timestamps", async () => {
    const { client } = setup();
    const hits = await createDuffelReadProvider(client).search(query(), new AbortController().signal);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ component: { serviceStart: null, serviceEnd: null } });
  });
  it("preserves sourced fare/baggage and payment prerequisites without assuming zero additional fees", async () => {
    const payload = { ...offer(), passenger_identity_documents_required: true,
      payment_requirements: { requires_instant_payment: false, payment_required_by: "2030-01-01T00:10:00Z",
        price_guarantee_expires_at: "2030-01-01T00:08:00Z" },
      available_services: [{ id: "ase_synthetic1", total_amount: "private-service-price" }],
      slices: [{ fare_brand_name: "Synthetic Economy", segments: [{
        departing_at: "2030-05-01T10:00:00", arriving_at: "2030-05-01T14:00:00",
        origin: { iata_code: "LHR" }, destination: { iata_code: "JFK" },
        passengers: [{ passenger_id: "private-passenger-reference", cabin_class: "economy", fare_basis_code: "SYNTHETIC",
          baggages: [{ type: "checked", quantity: 1 }, { type: "carry_on", quantity: 0 }] }],
      }] }] };
    const { client } = setup({ data: { offers: [payload] } });
    const hit = (await client.search(query(), new AbortController().signal))[0];
    expect(hit.feesMinor).toBeNull();
    const facts = JSON.parse(hit.planningDetails.fareConditions!);
    expect(facts).toMatchObject({ fareBrands: ["Synthetic Economy"], additionalServicesAvailable: true,
      extraCostsVerified: false, identityDocumentsRequired: true, paymentRequirements: { requiresInstantPayment: false,
        paymentRequiredBy: "2030-01-01T00:10:00.000Z", priceGuaranteeExpiresAt: "2030-01-01T00:08:00.000Z" },
      passengerFares: [{ segmentIndex: 0, passengerIndex: 0, cabinClass: "economy", fareBasisCode: "SYNTHETIC",
        baggage: [{ type: "checked", quantity: 1 }, { type: "carry_on", quantity: 0 }] }] });
    expect(JSON.stringify(hit)).not.toMatch(/private-|client_key|passenger_id/);
  });
  it("qualifies local times only with the source airport timezone and leaves ambiguous times unknown", async () => {
    const source = offer();
    const segment = source.slices[0].segments[0];
    const payload = { ...source, slices: [{ segments: [{ ...segment,
      origin: { ...segment.origin, time_zone: "Europe/London" },
      destination: { ...segment.destination, time_zone: "America/New_York" },
    }] }] };
    const { client, transport } = setup({ data: { offers: [payload] } });
    const signal = new AbortController().signal;
    const hit = (await client.search(query(), signal))[0];
    expect(hit.serviceStart).toBe("2030-05-01T09:00:00.000Z");
    expect(hit.serviceEnd).toBe("2030-05-01T18:00:00.000Z");
    const changed = { ...payload, base_amount: "110.10", total_amount: "130.30",
      slices: [{ segments: [{ ...payload.slices[0].segments[0], departing_at: "2030-10-27T01:30:00" }] }] };
    transport.mockImplementation(async () => new Response(JSON.stringify({ data: changed })));
    const current = await client.revalidate("off_synthetic1", query(), signal);
    expect(current.supplierMinor).toBe(11010);
    expect(current.serviceStart).toBeNull();
    expect(current.expiresAt).toBe(hit.expiresAt);
  });
  it("retrieves and revalidates only previously searched, same-query offers", async () => {
    const { client, transport } = setup();
    const signal = new AbortController().signal;
    await expect(client.detail("off_ungranted", query(), signal)).rejects.toMatchObject({ status: "unsupported" });
    await client.search(query(), signal);
    transport.mockImplementation(async () => new Response(JSON.stringify({ data: offer() })));
    await expect(client.detail("off_synthetic1", query(), signal)).resolves.toMatchObject({ supplierMinor: 10010 });
    await expect(client.revalidate("off_synthetic1", { ...query(), endDate: "2030-05-09" }, signal))
      .rejects.toMatchObject({ status: "unsupported" });
    const call = transport.mock.calls[1] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api.duffel.com/air/offers/off_synthetic1");
    expect(call[1].method).toBe("GET");
    expect(Object.keys(client).sort()).toEqual(["detail", "revalidate", "search"]);
    await expect(client.detail("../orders", query(), signal)).rejects.toMatchObject({ status: "unsupported" });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it.each([
    { total_amount: "120.31" }, { tax_amount: "-2.00" }, { total_currency: "USD" },
    { total_amount: "9007199254740992.00" }, { slices: "invalid" },
  ])("fails safely for inconsistent/malformed price or route evidence %j", async (change) => {
    const { client } = setup({ data: { offers: [{ ...offer(), ...change }] } });
    await expect(client.search(query(), new AbortController().signal)).rejects.toHaveProperty("name", "SupplyReadError");
  });
  it("does not forward unresolved destinations, extra query fields or missing origins", async () => {
    const { client, transport } = setup();
    const signal = new AbortController().signal;
    await expect(client.search({ ...query(), url: "https://invalid.test" } as SupplyReadQuery, signal))
      .rejects.toMatchObject({ status: "unsupported" });
    await expect(client.search({ ...query(), departureOrigin: null }, signal)).rejects.toMatchObject({ status: "unsupported" });
    expect(transport).not.toHaveBeenCalled();
  });
});
