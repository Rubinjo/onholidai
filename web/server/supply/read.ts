import { z } from "zod";

import { canonicalJson } from "@/domain/canonical-json";
import {
  currencySchema,
  departureOriginSchema,
  destinationSchema,
  travellerPartySchema,
} from "@/domain/trip/schema";
import { containsSensitiveText } from "@/lib/privacy";

import { normalizePlanningOffer, type PlanningOffer } from "./offers";

import type { ProviderOperationReadiness, SupplierReadiness } from "@/server/config";

const componentTypeSchema = z.enum(["flight", "accommodation", "activity", "rail", "transfer"]);
type ComponentType = z.infer<typeof componentTypeSchema>;

export const supplyReadQuerySchema = z
  .object({
    componentTypes: z.array(componentTypeSchema).min(1).max(5),
    currency: currencySchema,
    departureOrigin: departureOriginSchema.nullable(),
    destinationIds: z.array(z.uuid()).min(1).max(8),
    destinations: z.array(destinationSchema).max(8).optional(),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    travellerParty: travellerPartySchema,
  })
  .strict()
  .superRefine((query, context) => {
    if (query.endDate < query.startDate)
      context.addIssue({ code: "custom", path: ["endDate"], message: "Dates must be ordered" });
    if (query.componentTypes.includes("flight") && query.departureOrigin === null) {
      context.addIssue({
        code: "custom",
        path: ["departureOrigin"],
        message: "Confirm departure origin before flight research",
      });
    }
    for (const field of ["componentTypes", "destinationIds"] as const) {
      if (new Set(query[field]).size !== query[field].length) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Research selections must be unique",
        });
      }
    }
  });

export const readCapabilitiesSchema = z
  .object({
    provider: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]{0,119}$/)
      .refine((value) => !containsSensitiveText(value)),
    search: z
      .array(componentTypeSchema)
      .min(1)
      .max(5)
      .refine((types) => new Set(types).size === types.length),
    readOnly: z.literal(true),
    mode: z.enum(["deterministic", "live"]).optional(),
    operations: z
      .object({
        search: z.enum(["supported", "unsupported", "unknown"]),
        detail: z.enum(["supported", "unsupported", "unknown"]),
        revalidation: z.enum(["supported", "unsupported", "unknown"]),
      })
      .strict()
      .optional(),
  })
  .strict();
export type SupplyReadQuery = z.infer<typeof supplyReadQuerySchema>;
export interface SupplyReadProvider {
  capabilities: z.infer<typeof readCapabilitiesSchema>;
  search(query: SupplyReadQuery, signal: AbortSignal): Promise<readonly unknown[]>;
  detail?(offerId: string, query: SupplyReadQuery, signal: AbortSignal): Promise<unknown>;
  revalidate?(offerId: string, query: SupplyReadQuery, signal: AbortSignal): Promise<unknown>;
}

const failureStatusSchema = z.enum([
  "unconfigured",
  "access_blocked",
  "unsupported",
  "rate_limited",
  "error",
]);
type FailureStatus = z.infer<typeof failureStatusSchema>;
type SearchStatus = FailureStatus | "available" | "no_matches" | "deadline";

const safeReasons: Record<SearchStatus, string> = {
  available: "Search returned planning offers; inventory is not reserved.",
  no_matches: "Search completed without matching inventory.",
  unconfigured: "The current supplier product is not configured for search.",
  access_blocked: "Search access or a required supplier prerequisite is blocked.",
  unsupported: "This supplier operation or requested coverage is unsupported.",
  rate_limited: "The supplier rate limit prevented current inventory verification.",
  deadline: "The search deadline elapsed before current inventory could be established.",
  error: "The supplier search failed or returned invalid evidence; inventory is unknown.",
};

export class SupplyReadError extends Error {
  readonly status: FailureStatus;
  readonly retryAfterMs: number | null;

  constructor(status: FailureStatus, retryAfterMs?: number) {
    super(safeReasons[status]);
    this.name = "SupplyReadError";
    this.status = failureStatusSchema.parse(status);
    this.retryAfterMs =
      status === "rate_limited" && retryAfterMs !== undefined
        ? z.number().int().min(0).max(86_400_000).parse(retryAfterMs)
        : null;
  }
}

export interface SupplyReadOutcome {
  provider: string | null;
  componentType: ComponentType;
  mode: "deterministic" | "live" | "unknown";
  status: SearchStatus;
  safeReason: string;
  retryable: boolean;
  retryAfterMs: number | null;
  unverifiedCount: number;
}
export interface SupplyReadResult {
  offers: PlanningOffer[];
  outcomes: SupplyReadOutcome[];
}
interface SupplyReadOptions {
  signal?: AbortSignal;
  readiness?: SupplierReadiness;
}

function outcome(
  provider: string | null,
  componentType: ComponentType,
  status: SearchStatus,
  mode: SupplyReadOutcome["mode"] = "unknown",
): SupplyReadOutcome {
  return {
    provider,
    componentType,
    mode,
    status,
    safeReason: safeReasons[status],
    retryable: ["rate_limited", "deadline", "error"].includes(status),
    retryAfterMs: null,
    unverifiedCount: 0,
  };
}

function offerIdentity(offer: PlanningOffer): string {
  const component = offer.component;
  return canonicalJson([
    component.provider,
    component.type,
    component.supplierOfferId,
    offer.selectionGroup ?? null,
    component.serviceStart,
    component.serviceEnd,
    component.details,
    component.planningDetails ?? null,
  ]);
}

export async function readWithRateLimitRetry<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<T> {
  if (signal.aborted) throw new SupplyReadError("error");
  try {
    return await operation();
  } catch (error) {
    if (
      !(error instanceof SupplyReadError) ||
      error.status !== "rate_limited" ||
      error.retryAfterMs === null ||
      signal.aborted ||
      error.retryAfterMs >= deadlineAt - Date.now()
    )
      throw error;
    const retryAfterMs = error.retryAfterMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop: (() => void) | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        stop = () => reject(new SupplyReadError("error"));
        signal.addEventListener("abort", stop, { once: true });
        timer = setTimeout(resolve, retryAfterMs);
        if (signal.aborted) stop();
      });
    } finally {
      clearTimeout(timer);
      if (stop) signal.removeEventListener("abort", stop);
    }
    if (signal.aborted || Date.now() >= deadlineAt) throw error;
    return operation();
  }
}

async function boundedSearch(
  provider: SupplyReadProvider,
  query: SupplyReadQuery,
  type: ComponentType,
  now: Date,
  signal?: AbortSignal,
  mode = provider.capabilities.mode,
): Promise<{ offers: PlanningOffer[]; outcome: SupplyReadOutcome }> {
  const sourceOutcome = outcome(provider.capabilities.provider, type, "deadline", mode);
  if (provider.capabilities.operations?.search === "unsupported") {
    return { offers: [], outcome: outcome(sourceOutcome.provider, type, "unsupported", mode) };
  }
  if (provider.capabilities.operations?.search === "unknown") {
    return { offers: [], outcome: outcome(sourceOutcome.provider, type, "access_blocked", mode) };
  }
  if (signal?.aborted) {
    return {
      offers: [],
      outcome: {
        ...sourceOutcome,
        retryable: false,
        safeReason: "Research was cancelled before search.",
      },
    };
  }
  const controller = new AbortController();
  const deadlineAt = Date.now() + 8_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    const stop = () => {
      reject(new Error("Search interrupted"));
      controller.abort();
    };
    timer = setTimeout(stop, 8_000);
    cancel = stop;
    signal?.addEventListener("abort", stop, { once: true });
  });
  try {
    const rawOffers = await Promise.race([
      readWithRateLimitRetry(
        () =>
          provider.search({ ...structuredClone(query), componentTypes: [type] }, controller.signal),
        controller.signal,
        deadlineAt,
      ),
      deadline,
    ]);
    if (signal?.aborted || controller.signal.aborted) throw new Error("Search interrupted");
    if (!Array.isArray(rawOffers) || rawOffers.length > 32)
      throw new Error("Offer response is too large or invalid");
    const normalized = rawOffers.map((offer) => normalizePlanningOffer(offer, now));
    if (
      normalized.some(
        (offer) =>
          offer.component.provider !== provider.capabilities.provider ||
          offer.component.type !== type ||
          (offer.component.price.finalCustomerAmount?.currency ??
            offer.component.price.currency) !== query.currency,
      )
    ) {
      throw new Error("Offer context does not match research");
    }
    const offers = [...new Map(normalized.map((offer) => [offerIdentity(offer), offer])).values()];
    return {
      offers,
      outcome: {
        ...outcome(
          sourceOutcome.provider,
          type,
          offers.length ? "available" : "no_matches",
          sourceOutcome.mode,
        ),
        unverifiedCount: offers.reduce((count, offer) => count + offer.unverifiedFacts.length, 0),
      },
    };
  } catch (error) {
    if (signal?.aborted) {
      return {
        offers: [],
        outcome: {
          ...sourceOutcome,
          retryable: false,
          safeReason: "Research was cancelled before search completed.",
        },
      };
    }
    const status = controller.signal.aborted
      ? "deadline"
      : error instanceof SupplyReadError
        ? error.status
        : "error";
    return {
      offers: [],
      outcome: {
        ...outcome(sourceOutcome.provider, type, status, sourceOutcome.mode),
        retryAfterMs: error instanceof SupplyReadError ? error.retryAfterMs : null,
      },
    };
  } finally {
    clearTimeout(timer);
    if (cancel) signal?.removeEventListener("abort", cancel);
  }
}

const deferredProviders = new Set(["booking", "booking.com", "trainline", "getyourguide"]);
const currentProviderByType = {
  flight: "duffel",
  accommodation: "duffel",
  activity: "viator",
  rail: null,
  transfer: null,
} as const;

export function productReadiness(
  readiness: SupplierReadiness | undefined,
  type: ComponentType,
  operation: "search" | "detail" | "revalidation",
) {
  if (!readiness) return undefined;
  if (type === "flight" || type === "accommodation") {
    return {
      mode: readiness.duffel.mode,
      operation: readiness.duffel.products[type].operations[operation],
    };
  }
  if (type === "activity")
    return {
      mode: readiness.viator.mode,
      operation: readiness.viator.products.activity.operations[operation],
    };
}

function readinessFailure(
  operation: ProviderOperationReadiness,
  mode: "deterministic" | "live",
): FailureStatus | null {
  if (operation.support === "unsupported") return "unsupported";
  if (operation.access === "unconfigured") return "unconfigured";
  if (
    operation.support !== "supported" ||
    operation.access === "blocked" ||
    (mode === "live" && operation.access !== "verified")
  )
    return "access_blocked";
  return null;
}

export async function searchPlanningOffers(
  providers: readonly SupplyReadProvider[],
  rawQuery: unknown,
  now = new Date(),
  { signal, readiness }: SupplyReadOptions = {},
): Promise<SupplyReadResult> {
  const query = supplyReadQuerySchema.parse(rawQuery);
  if (providers.length > 4)
    throw new Error("At most four planning provider adapters are supported");
  const registered = new Set<string>();
  for (const provider of providers) {
    const capabilities = readCapabilitiesSchema.parse(provider.capabilities);
    for (const type of capabilities.search) {
      const key = `${capabilities.provider}:${type}`;
      if (registered.has(key)) throw new Error("Duplicate planning provider product");
      registered.add(key);
    }
  }
  type SourceResult = { offers: PlanningOffer[]; outcome: SupplyReadOutcome };
  const sources = query.componentTypes.flatMap(
    (type): Array<SourceResult | Promise<SourceResult>> => {
      if (type === "rail") {
        return [
          {
            offers: [],
            outcome: {
              ...outcome(null, type, "unsupported"),
              safeReason:
                "Rail inventory is deferred; no current rail supplier or replacement is available.",
            },
          },
        ];
      }
      const declared = productReadiness(readiness, type, "search");
      const blocked = declared ? readinessFailure(declared.operation, declared.mode) : null;
      if (blocked)
        return [
          {
            offers: [],
            outcome: outcome(currentProviderByType[type], type, blocked, declared?.mode),
          },
        ];
      const selected = providers.filter(
        (provider) =>
          !deferredProviders.has(provider.capabilities.provider) &&
          (!["duffel", "viator"].includes(provider.capabilities.provider) ||
            provider.capabilities.provider === currentProviderByType[type]) &&
          provider.capabilities.search.includes(type),
      );
      if (!selected.length) {
        return [
          {
            offers: [],
            outcome: outcome(
              currentProviderByType[type],
              type,
              currentProviderByType[type] === null ? "unsupported" : "unconfigured",
              declared?.mode,
            ),
          },
        ];
      }
      return selected.map((provider) =>
        boundedSearch(
          provider,
          query,
          type,
          now,
          signal,
          declared?.mode ?? provider.capabilities.mode,
        ),
      );
    },
  );
  const results = await Promise.all(sources);
  const offers: PlanningOffer[] = [];
  const seen = new Set<string>();
  const products = new Map<ComponentType, Map<string, PlanningOffer[]>>();
  for (const result of results) {
    const groups = products.get(result.outcome.componentType) ?? new Map<string, PlanningOffer[]>();
    products.set(result.outcome.componentType, groups);
    for (const offer of result.offers) {
      const identity = offerIdentity(offer);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const group = offer.selectionGroup ?? "";
      const candidates = groups.get(group) ?? [];
      candidates.push(offer);
      groups.set(group, candidates);
    }
  }
  // Round-robin requirements within each product, then products within the shared budget.
  const lanes = [...products.values()].map((groups) => {
    const lane: PlanningOffer[] = [];
    for (let index = 0; index < 32; index += 1) {
      for (const candidates of groups.values()) {
        if (candidates[index]) lane.push(candidates[index]);
      }
    }
    return lane;
  });
  for (let index = 0; index < 32 && offers.length < 32; index += 1) {
    for (const lane of lanes) {
      if (lane[index] && offers.length < 32) offers.push(lane[index]);
    }
  }
  return { offers, outcomes: results.map((result) => result.outcome) };
}
