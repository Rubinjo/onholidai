import { currencySchema } from "@/domain/trip/schema";

import { SupplyReadError, supplyReadQuerySchema, type SupplyReadQuery } from "../read";

import type { PlanningDetails } from "@/domain/trip/itinerary";

export interface ReadHttpOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
  decimalFields?: readonly string[];
}

export interface WireHit {
  availability?: "available" | "unavailable" | "unknown";
  offerId: string;
  currency: string;
  supplierMinor: number | null;
  customerMinor?: number | null;
  taxesMinor: number | null;
  feesMinor: number | null;
  serviceStart: string | null;
  serviceEnd: string | null;
  checkedAt: string;
  expiresAt: string | null;
  terms: string | null;
  details: Record<string, string | number | boolean | null | object>;
  planningDetails?: PlanningDetails;
  supplierReferences?: {
    accommodationId?: string;
    searchResultId?: string;
    rateId?: string;
    productCode?: string;
    optionCode?: string;
    roomIds?: string[];
    rateIds?: string[];
    sessionId?: string;
  };
  minimumAge: number | null;
  maximumAge: number | null;
  maximumAdults: number | null;
  maximumChildren: number | null;
  accessibilityVerified: boolean | null;
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SupplyReadError("error");
  return value as Record<string, unknown>;
}

export function list(value: unknown, limit = 1000): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new SupplyReadError("error");
  return value;
}

export function identifier(value: unknown, pattern = /^[A-Za-z0-9_-]{1,128}$/): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new SupplyReadError("unsupported");
  return value;
}

export function text(value: unknown, max = 240): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !/[<>\u0000-\u001f]/.test(value)
    ? value
    : null;
}

export function instant(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
  )
    return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

// Decimal text is scaled with integers; floating-point multiplication is never used.
export function decimalMinor(value: unknown, currency: string): number {
  if (!currencySchema.safeParse(currency).success) throw new SupplyReadError("error");
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits;
  if (digits === undefined || digits > 4) throw new SupplyReadError("unsupported");
  const source = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof source !== "string" || !/^\d{1,16}(?:\.\d{1,8})?$/.test(source))
    throw new SupplyReadError("error");
  const [whole, fraction = ""] = source.split(".");
  if (fraction.slice(digits).replace(/0/g, "")) throw new SupplyReadError("error");
  const amount =
    BigInt(whole) * 10n ** BigInt(digits) +
    BigInt(fraction.slice(0, digits).padEnd(digits, "0") || "0");
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new SupplyReadError("error");
  return Number(amount);
}

export function validateQuery(query: SupplyReadQuery): SupplyReadQuery {
  const parsed = supplyReadQuerySchema.safeParse(query);
  if (
    !parsed.success ||
    parsed.data.travellerParty.adults + parsed.data.travellerParty.children.length > 16
  ) {
    throw new SupplyReadError("unsupported");
  }
  return parsed.data;
}

export function emptyHit(offerId: string, currency: string, checkedAt: string): WireHit {
  return {
    offerId,
    currency,
    checkedAt,
    supplierMinor: null,
    taxesMinor: null,
    feesMinor: null,
    serviceStart: null,
    serviceEnd: null,
    expiresAt: null,
    terms: null,
    details: {},
    minimumAge: null,
    maximumAge: null,
    maximumAdults: null,
    maximumChildren: null,
    accessibilityVerified: null,
  };
}

/** Keep bounded source pricing/availability conditions without inventing complete component details. */
export function discoveryHit(hit: WireHit, source: string) {
  const facts = JSON.stringify(hit.details);
  if (facts.length > 2000) throw new SupplyReadError("unsupported");
  return {
    ...hit,
    details: null,
    planningDetails: {
      locationName: text(hit.details.name ?? hit.details.title, 500),
      timezone: null,
      airportNames: [],
      airlines: [],
      flightDirection: null,
      durationMinutes: null,
      layovers: [],
      fareConditions: facts,
      accommodationType: null,
      travelFromStayMinutes: null,
      eligibility: "unverified",
      accessibility: "unverified",
      availability: "unverified",
      constraintEvidence: [],
      source,
      checkedAt: hit.checkedAt,
      unavailableFacts: ["Complete service details", "Complete mandatory costs and material terms"],
    } satisfies PlanningDetails,
  };
}

export function secret(value: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 2048 ||
    /[\s\u0000-\u001f]/.test(value)
  ) {
    throw new SupplyReadError("unconfigured");
  }
  return value;
}

export function checkedAt(options: ReadHttpOptions): string {
  try {
    return (options.now?.() ?? new Date()).toISOString();
  } catch {
    throw new SupplyReadError("error");
  }
}

export function queryKey(query: SupplyReadQuery): string {
  return JSON.stringify(validateQuery(query));
}

export async function safeMapping<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw error instanceof SupplyReadError ? error : new SupplyReadError("error");
  }
}

// Callers supply only closed, internally constructed operations, never a browser/model URL.
export function readJson(
  options: ReadHttpOptions,
  allowed: readonly string[],
  headers: Record<string, string>,
) {
  const timeout = Math.min(8000, Math.max(1, options.timeoutMs ?? 8000));
  return async (
    url: string,
    method: "GET" | "POST",
    signal: AbortSignal,
    body?: unknown,
  ): Promise<unknown> => {
    if (!allowed.some((entry) => entry === `${method} ${url}`))
      throw new SupplyReadError("unsupported");
    if (signal.aborted) throw new SupplyReadError("error");
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload && Buffer.byteLength(payload) > 16_384) throw new SupplyReadError("unsupported");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (() => void) | undefined;
    const abort = () => {
      controller.abort();
      rejectAbort?.();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const work = async () => {
        const response = await (options.fetch ?? fetch)(url, {
          method,
          headers,
          body: payload,
          signal: controller.signal,
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
        });
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => {});
          throw new SupplyReadError("error");
        }
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          if (response.status === 401 || response.status === 403)
            throw new SupplyReadError("access_blocked");
          if (response.status === 429) {
            const raw = response.headers.get("retry-after");
            const seconds = raw && /^\d{1,5}$/.test(raw) ? Number(raw) : null;
            throw new SupplyReadError(
              "rate_limited",
              seconds === null ? undefined : Math.min(86_400_000, seconds * 1000),
            );
          }
          throw new SupplyReadError("error");
        }
        const declared = response.headers.get("content-length");
        if (declared && (!/^\d+$/.test(declared) || Number(declared) > 1_048_576)) {
          void response.body?.cancel().catch(() => {});
          throw new SupplyReadError("error");
        }
        if (!response.body) throw new SupplyReadError("error");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        const cancel = () => {
          void reader.cancel().catch(() => {});
        };
        controller.signal.addEventListener("abort", cancel, { once: true });
        try {
          while (true) {
            const chunk = await reader.read();
            if (controller.signal.aborted) throw new SupplyReadError("error");
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 1_048_576) {
              cancel();
              throw new SupplyReadError("error");
            }
            chunks.push(chunk.value);
          }
          return JSON.parse(
            Buffer.concat(chunks).toString("utf8"),
            (key: string, value: unknown, context?: { source?: string }) => {
              if (
                typeof value === "number" &&
                [
                  "fromPrice",
                  "recommendedRetailPrice",
                  "totalExtraCharges",
                  ...(options.decimalFields ?? []),
                ].includes(key)
              ) {
                // Modern JSON.parse exposes the original numeric token, avoiding precision
                // loss before decimal scaling. Older runtimes must not guess lost digits.
                if (!context?.source) throw new SupplyReadError("unsupported");
                return context.source;
              }
              return value;
            },
          ) as unknown;
        } finally {
          controller.signal.removeEventListener("abort", cancel);
          reader.releaseLock();
        }
      };
      return await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          rejectAbort = () => reject(new SupplyReadError("error"));
          timer = setTimeout(abort, timeout);
          if (signal.aborted) abort();
        }),
      ]);
    } catch (error) {
      // Provider error bodies, URLs, headers and transport exception messages are not public evidence.
      throw error instanceof SupplyReadError ? error : new SupplyReadError("error");
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  };
}
