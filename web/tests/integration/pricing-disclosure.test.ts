import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { projectAgentSnapshot, projectCustomerSnapshot } from "../../domain/pricing/projections";
import { allowlistedTelemetryAttributes } from "../../server/telemetry";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EstimateSummary } from "../../components/trip-workspace/estimate-summary";
import { changeProposalSchema, customerSnapshotSchema } from "../../domain/trip/proposal";
import { publicEventEnvelope } from "../../server/agent-client/results";
describe("US1 privacy projections", () => {
  it("projects public cache and render input without internal costs or raw telemetry", () => {
    const snapshot = createSyntheticTripSnapshot();
    const amount = (minorUnits: number) => ({ currency: "GBP", minorUnits });
    snapshot.components = [{ id: "10000000-0000-4000-8000-000000000022", type: "flight", itineraryItemIds: [],
      provider: "synthetic", supplierOfferId: "synthetic-flight", offerStatus: "available", serviceStart: "2030-05-01T12:00:00Z",
      serviceEnd: "2030-05-02T12:00:00Z", travellerIds: ["10000000-0000-4000-8000-000000000023"],
      bookingRequirements: [], cancellationTerms: "Unverified", checkedAt: "2030-01-01T00:00:00Z", expiresAt: null,
      bookingStatus: "unbooked", details: { legs: ["Synthetic outbound", "supplier_cost=991199"], baggage: ["https://provider.example/offer?platform%4dargin=883388"] },
      planningDetails: { locationName: "Synthetic airport", timezone: "Europe/Lisbon", airportNames: [], airlines: [],
        flightDirection: "outbound", durationMinutes: 120, layovers: [], fareConditions: "supplier_cost=991199",
        accommodationType: null, travelFromStayMinutes: null, eligibility: "unverified", accessibility: "unverified",
        availability: "unverified", constraintEvidence: [], source: "https://provider.example/?api%4bey=883388",
        checkedAt: "2030-01-01T00:00:00Z", unavailableFacts: ["passport-991199"] }, price: {
        supplierAmount: amount(991199), platformMargin: amount(883388), customerPayableTaxes: amount(123), customerPayableFees: amount(45),
        finalCustomerAmount: amount(1874755), status: "estimated", source: "synthetic", checkedAt: "2030-01-01T00:00:00Z", expiresAt: null } }];
    snapshot.price = { ...snapshot.price, supplierTotal: amount(991199), platformMarginTotal: amount(883388), customerPayableTaxesTotal: amount(123),
      customerPayableFeesTotal: amount(45), finalCustomerTotal: amount(1874755) };
    const publicSnapshot = projectCustomerSnapshot(snapshot);
    const cache = JSON.stringify(publicSnapshot);
    expect(cache).not.toMatch(/supplierAmount|supplierTotal|platformMargin|marginMinor/);
    expect(cache).not.toMatch(/991199|883388/);
    expect(cache).toContain("Synthetic outbound");
    expect(cache).toContain("Synthetic airport");
    expect(JSON.stringify(projectAgentSnapshot(snapshot))).not.toMatch(/991199|883388/);
    expect(snapshot.components[0].planningDetails?.fareConditions).toBe("supplier_cost=991199");
    expect(cache).toContain("finalCustomerMinor");
    const trip = { tripId: "10000000-0000-4000-8000-000000000021", version: 1, lifecycleState: "draft", updatedAt: "2030-01-01T00:00:00Z", snapshot: customerSnapshotSchema.parse(publicSnapshot) };
    const html = renderToStaticMarkup(createElement(EstimateSummary, { initialTrip: trip, initialProposal: null, initialRunId: null }));
    expect(html).not.toMatch(/991199|883388|supplierAmount|platformMargin/);
    expect(html).toContain("Estimated total");
    const event = publicEventEnvelope({ version: "1", runId: trip.tripId, cursor: 1, type: "progress", stage: "researching", message: "Researching", occurredAt: trip.updatedAt });
    expect(event.payload).toMatchObject({ stage: "researching" });
    const proposal = changeProposalSchema.parse({ id: "10000000-0000-4000-8000-000000000031", tripId: trip.tripId,
      agentRunId: trip.tripId, initiatingRequestId: "10000000-0000-4000-8000-000000000032", purpose: "initial_estimate",
      baseTripVersion: 1, operations: [{ operation: "replace", target: "/components", value: publicSnapshot.components }],
      affectedFacts: ["estimated_price"], rationale: "Synthetic priced preview", tradeoffs: [], warnings: ["Unverified availability"],
      status: "proposed", createdAt: "2029-01-01T00:00:00Z", expiresAt: "2030-01-01T00:00:00Z",
      previewSnapshot: publicSnapshot, estimatedCostRange: { currency: "GBP", minimumMinor: 1800000, maximumMinor: 2000000 },
      styleCompatibility: "Synthetic neutral style", constraintSummary: ["Dietary requirement is unverified"] });
    const pricedEvent = publicEventEnvelope({ version: "1", runId: trip.tripId, cursor: 2, occurredAt: trip.updatedAt, type: "proposal",
      proposal: { id: proposal.id, initiatingRequestId: proposal.initiatingRequestId, purpose: "initial_estimate", baseTripVersion: 1,
        operations: proposal.operations, affectedFacts: proposal.affectedFacts, rationale: proposal.rationale, tradeoffs: [], warnings: [], expiresAt: proposal.expiresAt } }, proposal);
    expect(JSON.stringify(pricedEvent)).not.toMatch(/991199|883388|supplierAmount|platformMargin/);
    expect(JSON.stringify(pricedEvent)).toContain("1874755");
    expect(allowlistedTelemetryAttributes({ prompt: "supplier 991199 margin 883388", "onholidai.duration_ms": 100 }))
      .toEqual({ "onholidai.duration_ms": 100 });
  });
});
