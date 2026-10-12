// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { createTripRequestSchema, initialTripSnapshot } from "../../domain/trip/create";
import { changeProposalSchema } from "../../domain/trip/proposal";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

vi.mock("server-only", () => ({}));

export function initialRequest() {
  const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
  snapshot.itineraryDays = [];
  return { requestId: randomUUID(), title: "Synthetic trip", currency: "GBP", snapshot };
}

describe("initial trip contracts", () => {
  it("initializes a validated full snapshot with an explicit pending estimated price", () => {
    const snapshot = initialTripSnapshot(initialRequest(), new Date("2030-01-01T00:00:00Z"));
    expect(snapshot.components).toEqual([]);
    expect(snapshot.itineraryDays).toEqual([]);
    expect(snapshot.price.finalCustomerTotal.minorUnits).toBe(0);
    expect(snapshot.warnings.map((warning) => warning.code)).toContain("estimate_pending");
  });

  it("rejects currency mismatch, forged pricing, inconsistent duration and missing origin", () => {
    const input = initialRequest();
    expect(createTripRequestSchema.safeParse({ ...input, currency: "EUR" }).success).toBe(false);
    expect(createTripRequestSchema.safeParse({ ...input, snapshot: {
      ...input.snapshot, price: { ...input.snapshot.price, supplierTotal: 991234 },
    } }).success).toBe(false);
    expect(() => initialTripSnapshot({ ...input, snapshot: {
      ...input.snapshot, duration: { minimumDays: 1, idealDays: 3, maximumDays: 50 },
    } }, new Date())).toThrow();
    expect(createTripRequestSchema.safeParse({ ...input, snapshot: {
      ...input.snapshot, departureOrigin: null,
    } }).success).toBe(false);
  });

  it("rejects proposal transaction paths, pricing fields and unreviewable initial estimates", () => {
    const proposal = { id: randomUUID(), tripId: randomUUID(), agentRunId: randomUUID(),
      initiatingRequestId: randomUUID(), purpose: "refinement", baseTripVersion: 1,
      operations: [{ operation: "replace", target: "/preferences/pace", value: 60 }],
      affectedFacts: ["pace"], rationale: "A slower pace", status: "proposed",
      createdAt: "2030-01-01T00:00:00Z", expiresAt: "2030-01-01T00:10:00Z" };
    expect(changeProposalSchema.safeParse(proposal).success).toBe(true);
    for (const target of ["/bookings", "/price", "/components/0/bookingStatus", "/preferences/__proto__"]) {
      expect(changeProposalSchema.safeParse({ ...proposal, operations: [{ operation: "replace", target, value: {} }] }).success).toBe(false);
    }
    expect(changeProposalSchema.safeParse({ ...proposal, operations: [{ operation: "replace",
      target: "/components", value: [{ price: { supplierAmount: 999 } }] }] }).success).toBe(false);
    expect(changeProposalSchema.safeParse({ ...proposal, purpose: "initial_estimate" }).success).toBe(false);
    expect(changeProposalSchema.safeParse({ ...proposal, expiresAt: proposal.createdAt }).success).toBe(false);
  });
});
