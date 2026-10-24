// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  normalizeTransactionOutcome,
  providerForComponent,
  TransactionProviderRegistry,
  createProviderTransactionAdapter,
} from "../../server/supply/transactions";
import { createDuffelTransactionAdapter } from "../../server/supply/providers/duffel-transactions";
import { createBookingTransactionAdapter } from "../../server/supply/providers/booking-transactions";
import { createGetYourGuideTransactionAdapter } from "../../server/supply/providers/getyourguide-transactions";
import { createTrainlineTransactionAdapter } from "../../server/supply/providers/trainline-transactions";

vi.mock("server-only", () => ({}));

describe("transaction supply contracts", () => {
  it.each([
    ["duffel", "flight", true],
    ["nuitee", "accommodation", true],
    ["viator", "activity", true],
    ["duffel", "accommodation", false],
    ["nuitee", "flight", false],
    ["nuitee", "activity", false],
    ["booking", "accommodation", false],
    ["getyourguide", "activity", false],
    ["trainline", "rail", false],
    ["booking", "transfer", false],
  ] as const)(
    "routes immutable %s/%s provenance without fallback (current=%s)",
    (provider, type, current) => {
      const registry = new TransactionProviderRegistry();
      registry.register(
        createProviderTransactionAdapter(provider, {
          capabilities: {
            book: true,
            status: true,
            cancel: false,
            reschedule: false,
            idempotency: false,
          },
          execute: async () => ({ status: "unknown" }),
          getStatus: async () => ({ status: "unknown" }),
        }),
      );
      if (current)
        expect(registry.requireCurrent({ provider, type }, "book_trip").provider).toBe(provider);
      else
        expect(() => registry.requireCurrent({ provider, type }, "book_trip")).toThrow(
          "is not active",
        );
      expect(registry.requireStatus(provider).provider).toBe(provider);
    },
  );

  it("does not infer a supplier from component type or relabel incompatible provenance", () => {
    expect(() => providerForComponent("transfer", "booking")).toThrow();
    expect(() => providerForComponent("flight", "synthetic")).toThrow();
    expect(() => providerForComponent("flight", "viator")).toThrow();
    expect(providerForComponent("accommodation", "nuitee")).toBe("nuitee");
    expect(providerForComponent("accommodation", "duffel")).toBe("duffel");
  });
  it("allows authenticated status reconciliation when fresh booking capability is disabled", async () => {
    const registry = new TransactionProviderRegistry();
    registry.register(
      createDuffelTransactionAdapter({
        capabilities: {
          book: false,
          status: true,
          cancel: false,
          reschedule: false,
          idempotency: false,
        },
        execute: async () => {
          throw new Error("Booking is disabled");
        },
        getStatus: async () => ({ status: "unknown" }),
      }),
    );
    const adapter = registry.requireStatus("duffel");
    expect(await adapter.getStatus!("existing-attempt")).toMatchObject({ status: "unknown" });
    expect(() => registry.require("duffel", "book_trip")).toThrow();
  });
  it.each([
    ["duffel", createDuffelTransactionAdapter],
    ["booking", createBookingTransactionAdapter],
    ["getyourguide", createGetYourGuideTransactionAdapter],
    ["trainline", createTrainlineTransactionAdapter],
  ] as const)(
    "binds %s to declared capabilities and normalizes provider outcomes",
    async (_name, create) => {
      const adapter = create({
        capabilities: {
          book: true,
          status: true,
          cancel: false,
          reschedule: false,
          idempotency: true,
        },
        execute: async () => ({
          status: "confirmed",
          providerReference: "synthetic-reference",
          evidenceId: "evidence-1",
          confirmedTerms: { componentId: "10000000-0000-4000-8000-000000000001" },
        }),
        getStatus: async () => ({ status: "unknown" }),
      });
      expect(adapter.capabilities.idempotency).toBe(true);
      expect(
        await adapter.execute({
          operation: "book_trip",
          componentId: "10000000-0000-4000-8000-000000000001",
          supplierOfferId: "synthetic-offer",
          inventoryId: "synthetic-inventory",
          idempotencyKey: "stable-key",
          requestFingerprint: "a".repeat(64),
          terms: {
            componentId: "10000000-0000-4000-8000-000000000001",
            supplierOfferId: "synthetic-offer",
            inventoryId: "synthetic-inventory",
            serviceStart: "2030-01-01T10:00:00Z",
            serviceEnd: "2030-01-01T11:00:00Z",
            travellerIds: ["11000000-0000-4000-8000-000000000001"],
            finalCustomerMinor: 100,
            taxesMinor: 0,
            feesMinor: 0,
            currency: "GBP",
            cancellationTerms: "Synthetic terms",
            expiresAt: "2030-01-01T09:00:00Z",
            nonReversible: false,
          },
        }),
      ).toMatchObject({ status: "confirmed", evidenceId: "evidence-1" });
      expect(await adapter.getStatus?.("stable-key")).toMatchObject({ status: "unknown" });
    },
  );

  it("treats contradictory or incomplete confirmations as unknown and omits raw supplier errors", () => {
    expect(
      normalizeTransactionOutcome({
        status: "confirmed",
        providerReference: "",
        evidenceId: null,
        confirmedTerms: {},
        error: "private supplier response",
      }),
    ).toEqual({ status: "unknown", safeReason: "Provider response needs status reconciliation." });
    expect(
      normalizeTransactionOutcome({ status: "failed", detail: "private supplier response" }),
    ).toEqual({ status: "unknown", safeReason: "Provider response needs status reconciliation." });
    expect(normalizeTransactionOutcome({ status: "failed" })).toEqual({
      status: "failed",
      safeReason: "The provider could not complete this action.",
    });
  });
});
