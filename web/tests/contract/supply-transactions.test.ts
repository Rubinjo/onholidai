// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeTransactionOutcome } from "../../server/supply/transactions";
import { createDuffelTransactionAdapter } from "../../server/supply/providers/duffel-transactions";
import { createBookingTransactionAdapter } from "../../server/supply/providers/booking-transactions";
import { createGetYourGuideTransactionAdapter } from "../../server/supply/providers/getyourguide-transactions";
import { createTrainlineTransactionAdapter } from "../../server/supply/providers/trainline-transactions";

describe("transaction supply contracts", () => {
  it.each([
    ["duffel", createDuffelTransactionAdapter], ["booking", createBookingTransactionAdapter],
    ["getyourguide", createGetYourGuideTransactionAdapter], ["trainline", createTrainlineTransactionAdapter],
  ] as const)("binds %s to declared capabilities and normalizes provider outcomes", async (_name, create) => {
    const adapter = create({ capabilities: { book: true, status: true, cancel: false, reschedule: false, idempotency: true },
      execute: async () => ({ status: "confirmed", providerReference: "synthetic-reference", evidenceId: "evidence-1",
        confirmedTerms: { componentId: "10000000-0000-4000-8000-000000000001" } }),
      getStatus: async () => ({ status: "unknown" }) });
    expect(adapter.capabilities.idempotency).toBe(true);
    expect(await adapter.execute({ operation: "book_trip", componentId: "10000000-0000-4000-8000-000000000001",
      supplierOfferId: "synthetic-offer", inventoryId: "synthetic-inventory", idempotencyKey: "stable-key",
      requestFingerprint: "a".repeat(64), terms: { componentId: "10000000-0000-4000-8000-000000000001",
        supplierOfferId: "synthetic-offer", inventoryId: "synthetic-inventory", serviceStart: "2030-01-01T10:00:00Z",
        serviceEnd: "2030-01-01T11:00:00Z", travellerIds: ["11000000-0000-4000-8000-000000000001"],
        finalCustomerMinor: 100, taxesMinor: 0, feesMinor: 0, currency: "GBP", cancellationTerms: "Synthetic terms",
        expiresAt: "2030-01-01T09:00:00Z", nonReversible: false } })).toMatchObject({ status: "confirmed", evidenceId: "evidence-1" });
    expect(await adapter.getStatus?.("stable-key")).toMatchObject({ status: "unknown" });
  });

  it("treats contradictory or incomplete confirmations as unknown and omits raw supplier errors", () => {
    expect(normalizeTransactionOutcome({ status: "confirmed", providerReference: "", evidenceId: null,
      confirmedTerms: {}, error: "private supplier response" })).toEqual({ status: "unknown", safeReason: "Provider response needs status reconciliation." });
    expect(normalizeTransactionOutcome({ status: "failed", detail: "private supplier response" }))
      .toEqual({ status: "unknown", safeReason: "Provider response needs status reconciliation." });
    expect(normalizeTransactionOutcome({ status: "failed" })).toEqual({ status: "failed", safeReason: "The provider could not complete this action." });
  });
});
