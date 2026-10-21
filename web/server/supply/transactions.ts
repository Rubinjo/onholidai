import "server-only";
import { z } from "zod";

import type { BookingOperation, BookingTerms } from "@/domain/booking/authorization";

export type TransactionOutcome =
  | { status: "confirmed"; providerReference: string; confirmedTerms: unknown; evidenceId: string }
  | { status: "failed"; safeReason: string }
  | { status: "unknown"; safeReason: string }
  | { status: "action_required"; safeReason: string };

export interface ProviderWriteRequest {
  operation: BookingOperation;
  componentId: string;
  supplierOfferId: string;
  inventoryId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  terms: BookingTerms["components"][number];
  paymentToken?: Uint8Array;
}

export interface ProviderTransactionAdapter {
  provider: "duffel" | "viator" | "booking" | "getyourguide" | "trainline";
  capabilities: { book: boolean; status: boolean; cancel: boolean; reschedule: boolean; idempotency: boolean };
  execute(request: ProviderWriteRequest): Promise<TransactionOutcome>;
  getStatus?(idempotencyKey: string): Promise<TransactionOutcome>;
  cancel?(request: ProviderWriteRequest): Promise<TransactionOutcome>;
  reschedule?(request: ProviderWriteRequest): Promise<TransactionOutcome>;
  revalidate?(request: { componentId: string; supplierOfferId: string; serviceStart: string; serviceEnd: string;
    travellerIds: string[]; requestedChange?: { serviceStart?: string; serviceEnd?: string; supplierOfferId?: string; travellerIds?: string[] } }): Promise<{ outcome: "unchanged" | "changed" | "unavailable" | "unknown";
    terms?: BookingTerms["components"][number]; safeReason?: string }>;
}

export interface ProviderTransactionClient {
  capabilities: ProviderTransactionAdapter["capabilities"];
  execute(request: ProviderWriteRequest): Promise<unknown>;
  getStatus?(idempotencyKey: string): Promise<unknown>;
  cancel?(request: ProviderWriteRequest): Promise<unknown>;
  reschedule?(request: ProviderWriteRequest): Promise<unknown>;
  revalidate?(request: Parameters<NonNullable<ProviderTransactionAdapter["revalidate"]>>[0]): ReturnType<NonNullable<ProviderTransactionAdapter["revalidate"]>>;
}

const rawOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("confirmed"), providerReference: z.string().min(1).max(512), evidenceId: z.string().min(1).max(256), confirmedTerms: z.unknown() }).strict(),
  z.object({ status: z.literal("failed") }).strict(),
  z.object({ status: z.literal("unknown") }).strict(),
  z.object({ status: z.literal("action_required") }).strict(),
]);

export function normalizeTransactionOutcome(raw: unknown): TransactionOutcome {
  const parsed = rawOutcomeSchema.safeParse(raw);
  if (!parsed.success) return { status: "unknown", safeReason: "Provider response needs status reconciliation." };
  if (parsed.data.status === "confirmed") return {
    status: "confirmed", providerReference: parsed.data.providerReference,
    evidenceId: parsed.data.evidenceId, confirmedTerms: parsed.data.confirmedTerms,
  };
  if (parsed.data.status === "failed") return { status: "failed", safeReason: "The provider could not complete this action." };
  if (parsed.data.status === "action_required") return { status: "action_required", safeReason: "The provider requires manual review." };
  return { status: "unknown", safeReason: "Provider status is not yet known." };
}

export function createProviderTransactionAdapter(
  provider: ProviderTransactionAdapter["provider"], client: ProviderTransactionClient,
): ProviderTransactionAdapter {
  return {
    provider, capabilities: client.capabilities,
    execute: async (request) => normalizeTransactionOutcome(await client.execute(request)),
    ...(client.getStatus ? { getStatus: async (key: string) => normalizeTransactionOutcome(await client.getStatus!(key)) } : {}),
    ...(client.cancel ? { cancel: async (request: ProviderWriteRequest) => normalizeTransactionOutcome(await client.cancel!(request)) } : {}),
    ...(client.reschedule ? { reschedule: async (request: ProviderWriteRequest) => normalizeTransactionOutcome(await client.reschedule!(request)) } : {}),
    ...(client.revalidate ? { revalidate: client.revalidate.bind(client) } : {}),
  };
}

export class TransactionProviderRegistry {
  private readonly providers = new Map<ProviderTransactionAdapter["provider"], ProviderTransactionAdapter>();

  register(adapter: ProviderTransactionAdapter): void {
    this.providers.set(adapter.provider, adapter);
  }

  get(provider: ProviderTransactionAdapter["provider"]): ProviderTransactionAdapter | undefined {
    return this.providers.get(provider);
  }

  require(provider: ProviderTransactionAdapter["provider"], operation: BookingOperation): ProviderTransactionAdapter {
    const adapter = this.providers.get(provider);
    if (!adapter) throw new Error(`Transaction provider ${provider} is not configured`);
    const capability = operation === "book_trip" ? "book" : operation === "cancel_component" ? "cancel" : "reschedule";
    if (!adapter.capabilities[capability]) throw new Error(`Transaction provider ${provider} does not support ${operation}`);
    if (operation === "cancel_component" && !adapter.cancel) throw new Error(`Transaction provider ${provider} has no cancellation implementation`);
    if (operation === "reschedule_component" && !adapter.reschedule) throw new Error(`Transaction provider ${provider} has no rescheduling implementation`);
    return adapter;
  }
}

export function providerForComponent(type: string): ProviderTransactionAdapter["provider"] {
  switch (type) {
    case "flight": return "duffel";
    case "accommodation": return "booking";
    case "activity": return "getyourguide";
    case "rail": return "trainline";
    case "transfer": return "booking";
    default: throw new Error(`Unsupported transactional component type: ${type}`);
  }
}
