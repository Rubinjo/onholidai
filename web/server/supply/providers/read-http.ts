import { currencySchema } from "@/domain/trip/schema";

import {
  retryDelayMs,
  SUPPLIER_ATTEMPT_CEILING_MS,
  SUPPLIER_ATTEMPT_TIMEOUT_MS,
  SUPPLIER_ATTEMPTS,
} from "../deadlines";
import {
  SupplyReadError,
  isSupplyReadError,
  supplyReadQuerySchema,
  type SupplyReadQuery,
} from "../read";

import type { PlanningDetails } from "@/domain/trip/itinerary";

export interface ReadHttpOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /**
   * Attempts per request. Reads opt in to retrying transient supplier failures;
   * transaction clients keep the default of one, because a booking call must never be
   * replayed automatically.
   */
  attempts?: number;
  now?: () => Date;
  decimalFields?: readonly string[];
}

export interface WireHit {
  availability?: "available" | "unavailable" | "unknown";
  /** True when the supplier published no terms and the reader supplied only an absence notice. */
  termsUnverified?: boolean;
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
  // A busy multi-passenger fare matrix is larger than the bounded advisory text. The
  // excess is truncated and disclosed instead of discarding otherwise valid inventory.
  const truncated = facts.length > 2000;
  const bounded = truncated ? `${facts.slice(0, 1900)}…[truncated]` : facts;
  return {
    ...hit,
    details: null,
    // Suppliers that publish no terms still need an explicit, non-claiming statement so
    // a draft can carry the line without inventing refundability. termsUnverified keeps
    // the "terms unknown" signal the adapter records.
    terms:
      hit.terms ??
      `${source}: cancellation and change terms are not established by this read; ` +
        "verify them before any purchase.",
    termsUnverified: hit.terms === null || hit.termsUnverified === true,
    planningDetails: {
      locationName: text(hit.details.name ?? hit.details.title, 500),
      timezone: null,
      airportNames: [],
      airlines: [],
      flightDirection: null,
      durationMinutes: null,
      layovers: [],
      fareConditions: bounded,
      accommodationType: null,
      travelFromStayMinutes: null,
      eligibility: "unverified",
      accessibility: "unverified",
      availability: "unverified",
      constraintEvidence: [],
      source,
      checkedAt: hit.checkedAt,
      unavailableFacts: [
        "Complete service details",
        "Complete mandatory costs and material terms",
        ...(truncated ? ["Source fare detail exceeded the bounded record"] : []),
      ],
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
    throw isSupplyReadError(error) ? error : new SupplyReadError("error");
  }
}

/** Exponential backoff with jitter; a supplier Retry-After wins when it is longer. */
function abortableSleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(
        new SupplyReadError("error", undefined, { retryable: false, detail: "caller_aborted" }),
      );
      return;
    }
    const stop = () => {
      clearTimeout(timer);
      reject(
        new SupplyReadError("error", undefined, { retryable: false, detail: "caller_aborted" }),
      );
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal.addEventListener("abort", stop, { once: true });
  });
}

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  if (/^\d{1,5}$/.test(raw)) return Math.min(86_400_000, Number(raw) * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.min(86_400_000, Math.max(0, at - Date.now())) : null;
}

/** Statuses where another identical attempt can realistically succeed. */
function transientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

// Callers supply only closed, internally constructed operations, never a browser/model URL.
export function readJson(
  options: ReadHttpOptions,
  allowed: readonly string[],
  headers: Record<string, string>,
) {
  const timeout = Math.min(
    SUPPLIER_ATTEMPT_CEILING_MS,
    Math.max(1, options.timeoutMs ?? SUPPLIER_ATTEMPT_TIMEOUT_MS),
  );
  const attempts = Math.min(SUPPLIER_ATTEMPTS, Math.max(1, options.attempts ?? 1));

  async function attempt(
    url: string,
    method: "GET" | "POST",
    payload: string | undefined,
    signal: AbortSignal,
    controller: AbortController,
  ): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (() => void) | undefined;
    const abort = () => {
      controller.abort();
      rejectAbort?.();
    };
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
        throw new SupplyReadError("error", undefined, {
          retryable: false,
          detail: "attempt_aborted",
        });
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        if (response.status === 401 || response.status === 403)
          throw new SupplyReadError("access_blocked", undefined, {
            retryable: false,
            detail: `http_${response.status}`,
          });
        if (response.status === 429)
          throw new SupplyReadError("rate_limited", retryAfterMs(response) ?? undefined, {
            retryable: true,
            detail: "http_429",
          });
        throw new SupplyReadError("error", undefined, {
          retryable: transientStatus(response.status),
          detail: `http_${response.status}`,
        });
      }
      const declared = response.headers.get("content-length");
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > 1_048_576)) {
        void response.body?.cancel().catch(() => {});
        throw new SupplyReadError("error", undefined, {
          retryable: false,
          detail: "response_too_large",
        });
      }
      if (!response.body)
        throw new SupplyReadError("error", undefined, { retryable: false, detail: "empty_body" });
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
          if (controller.signal.aborted)
            throw new SupplyReadError("error", undefined, {
              retryable: false,
              detail: "attempt_aborted",
            });
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 1_048_576) {
            cancel();
            throw new SupplyReadError("error", undefined, {
              retryable: false,
              detail: "response_too_large",
            });
          }
          chunks.push(chunk.value);
        }
        const body = Buffer.concat(chunks).toString("utf8");
        try {
          return JSON.parse(body, (key: string, value: unknown, context?: { source?: string }) => {
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
              if (!context?.source)
                throw new SupplyReadError("unsupported", undefined, {
                  retryable: false,
                  detail: "lossy_decimal",
                });
              return context.source;
            }
            return value;
          }) as unknown;
        } catch (error) {
          // A malformed supplier body is not a transient transport failure.
          if (isSupplyReadError(error)) throw error;
          throw new SupplyReadError("error", undefined, {
            retryable: false,
            detail: "malformed_response",
          });
        }
      } finally {
        controller.signal.removeEventListener("abort", cancel);
        reader.releaseLock();
      }
    };
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          rejectAbort = () =>
            reject(
              new SupplyReadError("error", undefined, {
                retryable: true,
                detail: "attempt_timeout",
              }),
            );
          timer = setTimeout(abort, timeout);
          if (signal.aborted) abort();
        }),
      ]);
    } catch (error) {
      // Provider error bodies, URLs, headers and transport exception messages are not public evidence.
      if (isSupplyReadError(error)) throw error;
      throw new SupplyReadError("error", undefined, {
        retryable: !controller.signal.aborted,
        detail: "transport_error",
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return async (
    url: string,
    method: "GET" | "POST",
    signal: AbortSignal,
    body?: unknown,
  ): Promise<unknown> => {
    if (!allowed.some((entry) => entry === `${method} ${url}`))
      throw new SupplyReadError("unsupported", undefined, {
        retryable: false,
        detail: "endpoint_not_allowed",
      });
    if (signal.aborted)
      throw new SupplyReadError("error", undefined, {
        retryable: false,
        detail: "caller_aborted",
      });
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload && Buffer.byteLength(payload) > 16_384)
      throw new SupplyReadError("unsupported", undefined, {
        retryable: false,
        detail: "request_too_large",
      });
    // One caller listener governs every attempt, so retries never leak listeners.
    let active: AbortController | null = null;
    const abortActive = () => active?.abort();
    signal.addEventListener("abort", abortActive, { once: true });
    try {
      let failure: SupplyReadError | null = null;
      for (let attemptNumber = 1; attemptNumber <= attempts; attemptNumber += 1) {
        const controller = new AbortController();
        active = controller;
        try {
          return await attempt(url, method, payload, signal, controller);
        } catch (error) {
          const current = isSupplyReadError(error)
            ? error
            : new SupplyReadError("error", undefined, { detail: "transport_error" });
          failure = current;
          if (!current.retryable || signal.aborted || attemptNumber === attempts) throw current;
          await abortableSleep(retryDelayMs(attemptNumber, current.retryAfterMs), signal);
          if (signal.aborted) throw current;
        } finally {
          active = null;
        }
      }
      throw failure ?? new SupplyReadError("error");
    } finally {
      signal.removeEventListener("abort", abortActive);
    }
  };
}
