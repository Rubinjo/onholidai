import "server-only";
import { createHash } from "node:crypto";

import { z } from "zod";

import { canonicalBookingJson } from "@/domain/booking/authorization";
import { currentProviderByType } from "@/server/supply/read";

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

export interface ProviderStatusContext {
  componentId: string;
  providerReference: string | null;
  terms: BookingTerms["components"][number];
}

export function providerRequestFingerprint(
  request: Pick<ProviderWriteRequest, "operation" | "terms">,
): string {
  return createHash("sha256")
    .update(canonicalBookingJson({ operation: request.operation, terms: request.terms }))
    .digest("hex");
}

export interface ProviderTransactionAdapter {
  provider: "duffel" | "nuitee" | "viator" | "booking" | "getyourguide" | "trainline";
  capabilities: {
    book: boolean;
    status: boolean;
    cancel: boolean;
    reschedule: boolean;
    idempotency: boolean;
    revalidation?: "read_only_final_terms" | "unsupported" | "unknown";
  };
  execute(request: ProviderWriteRequest): Promise<TransactionOutcome>;
  getStatus?(idempotencyKey: string, context?: ProviderStatusContext): Promise<TransactionOutcome>;
  cancel?(request: ProviderWriteRequest): Promise<TransactionOutcome>;
  reschedule?(request: ProviderWriteRequest): Promise<TransactionOutcome>;
  revalidate?(request: {
    componentId: string;
    supplierOfferId: string;
    serviceStart: string;
    serviceEnd: string;
    travellerIds: string[];
    signal?: AbortSignal;
    requestedChange?: {
      serviceStart?: string;
      serviceEnd?: string;
      supplierOfferId?: string;
      travellerIds?: string[];
    };
  }): Promise<{
    outcome: "unchanged" | "changed" | "unavailable" | "unknown";
    terms?: BookingTerms["components"][number];
    safeReason?: string;
  }>;
}

export interface ProviderTransactionClient {
  capabilities: ProviderTransactionAdapter["capabilities"];
  execute(request: ProviderWriteRequest): Promise<unknown>;
  getStatus?(idempotencyKey: string, context?: ProviderStatusContext): Promise<unknown>;
  cancel?(request: ProviderWriteRequest): Promise<unknown>;
  reschedule?(request: ProviderWriteRequest): Promise<unknown>;
  revalidate?(
    request: Parameters<NonNullable<ProviderTransactionAdapter["revalidate"]>>[0],
  ): ReturnType<NonNullable<ProviderTransactionAdapter["revalidate"]>>;
}

const rawOutcomeSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("confirmed"),
      providerReference: z.string().min(1).max(512),
      evidenceId: z.string().min(1).max(256),
      confirmedTerms: z.unknown(),
    })
    .strict(),
  z.object({ status: z.literal("failed") }).strict(),
  z.object({ status: z.literal("unknown") }).strict(),
  z.object({ status: z.literal("action_required") }).strict(),
]);

export function normalizeTransactionOutcome(raw: unknown): TransactionOutcome {
  const parsed = rawOutcomeSchema.safeParse(raw);
  if (!parsed.success)
    return { status: "unknown", safeReason: "Provider response needs status reconciliation." };
  if (parsed.data.status === "confirmed")
    return {
      status: "confirmed",
      providerReference: parsed.data.providerReference,
      evidenceId: parsed.data.evidenceId,
      confirmedTerms: parsed.data.confirmedTerms,
    };
  if (parsed.data.status === "failed")
    return { status: "failed", safeReason: "The provider could not complete this action." };
  if (parsed.data.status === "action_required")
    return { status: "action_required", safeReason: "The provider requires manual review." };
  return { status: "unknown", safeReason: "Provider status is not yet known." };
}

export function createProviderTransactionAdapter(
  provider: ProviderTransactionAdapter["provider"],
  client: ProviderTransactionClient,
): ProviderTransactionAdapter {
  return {
    provider,
    capabilities: client.capabilities,
    execute: async (request) => normalizeTransactionOutcome(await client.execute(request)),
    ...(client.getStatus
      ? {
          getStatus: async (key: string, context?: ProviderStatusContext) =>
            normalizeTransactionOutcome(
              await (context ? client.getStatus!(key, context) : client.getStatus!(key)),
            ),
        }
      : {}),
    ...(client.cancel
      ? {
          cancel: async (request: ProviderWriteRequest) =>
            normalizeTransactionOutcome(await client.cancel!(request)),
        }
      : {}),
    ...(client.reschedule
      ? {
          reschedule: async (request: ProviderWriteRequest) =>
            normalizeTransactionOutcome(await client.reschedule!(request)),
        }
      : {}),
    ...(client.revalidate ? { revalidate: client.revalidate.bind(client) } : {}),
  };
}

export class TransactionProviderRegistry {
  private readonly providers = new Map<
    ProviderTransactionAdapter["provider"],
    ProviderTransactionAdapter
  >();

  register(adapter: ProviderTransactionAdapter): void {
    this.providers.set(adapter.provider, adapter);
  }

  get(provider: ProviderTransactionAdapter["provider"]): ProviderTransactionAdapter | undefined {
    return this.providers.get(provider);
  }

  requireStatus(provider: ProviderTransactionAdapter["provider"]): ProviderTransactionAdapter {
    const adapter = this.providers.get(provider);
    if (!adapter?.capabilities.status || !adapter.getStatus)
      throw new Error(`Transaction provider ${provider} requires manual status confirmation`);
    return adapter;
  }

  requireCurrent(
    component: { provider: string; type: string },
    operation: BookingOperation,
  ): ProviderTransactionAdapter {
    const active = Object.entries(currentProviderByType).some(
      ([type, provider]) =>
        component.type === type && provider !== null && component.provider === provider,
    );
    if (!active)
      throw new Error(`Transaction product ${component.provider}/${component.type} is not active`);
    return this.require(providerForComponent(component.type, component.provider), operation);
  }

  require(
    provider: ProviderTransactionAdapter["provider"],
    operation: BookingOperation,
  ): ProviderTransactionAdapter {
    const adapter = this.providers.get(provider);
    if (!adapter) throw new Error(`Transaction provider ${provider} is not configured`);
    const capability =
      operation === "book_trip"
        ? "book"
        : operation === "cancel_component"
          ? "cancel"
          : "reschedule";
    if (!adapter.capabilities[capability])
      throw new Error(`Transaction provider ${provider} does not support ${operation}`);
    if (operation === "cancel_component" && !adapter.cancel)
      throw new Error(`Transaction provider ${provider} has no cancellation implementation`);
    if (operation === "reschedule_component" && !adapter.reschedule)
      throw new Error(`Transaction provider ${provider} has no rescheduling implementation`);
    return adapter;
  }
}

export function providerForComponent(
  type: string,
  provenance: string,
): ProviderTransactionAdapter["provider"] {
  const provider = z
    .enum(["duffel", "nuitee", "viator", "booking", "getyourguide", "trainline"])
    .parse(provenance);
  const products: Record<ProviderTransactionAdapter["provider"], readonly string[]> = {
    duffel: ["flight", "accommodation"],
    nuitee: ["accommodation", "flight", "activity"],
    viator: ["activity"],
    booking: ["accommodation"],
    getyourguide: ["activity"],
    trainline: ["rail"],
  };
  if (!products[provider].includes(type))
    throw new Error(`Unsupported transactional product: ${provider}/${type}`);
  return provider;
}
