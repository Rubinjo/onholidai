import { randomUUID } from "node:crypto";

import { containsSensitiveText } from "../lib/privacy";

export const CORRELATION_ID_HEADER = "x-correlation-id";

type TelemetryAttribute = boolean | number | string;
type AttributeValidator = (value: unknown) => value is TelemetryAttribute;

const correlationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const boundedTokenPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const errorTypePattern = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const httpMethodPattern = /^[A-Z]{3,12}$/;
const routePattern = /^\/[A-Za-z0-9._/:[\]-]{0,255}$/;
const traceparentPattern = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

function isBoundedToken(value: unknown): value is string {
  return typeof value === "string" && boundedTokenPattern.test(value);
}

function isErrorType(value: unknown): value is string {
  return typeof value === "string" && errorTypePattern.test(value);
}

function isHttpMethod(value: unknown): value is string {
  return typeof value === "string" && httpMethodPattern.test(value);
}

function isHttpStatus(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRoute(value: unknown): value is string {
  return typeof value === "string" && routePattern.test(value);
}

const attributeValidators = {
  "deployment.environment.name": isBoundedToken,
  "error.type": isErrorType,
  "http.request.method": isHttpMethod,
  "http.response.status_code": isHttpStatus,
  "http.route": isRoute,
  "onholidai.correlation_id": isBoundedToken,
  "onholidai.duration_ms": isNonNegativeNumber,
  "onholidai.error.category": isErrorType,
  "onholidai.operation": isBoundedToken,
  "onholidai.outcome": isBoundedToken,
  "onholidai.provider": isBoundedToken,
  "onholidai.request_id": isBoundedToken,
  "onholidai.retry_count": isNonNegativeNumber,
  "onholidai.run_id": isBoundedToken,
  "onholidai.trip_id": isBoundedToken,
  "onholidai.workflow_id": isBoundedToken,
  "service.name": isBoundedToken,
  "service.version": isBoundedToken,
  "url.route": isRoute,
} satisfies Readonly<Record<string, AttributeValidator>>;

export const TELEMETRY_ATTRIBUTE_KEYS = Object.freeze(Object.keys(attributeValidators));

export function isValidCorrelationId(value: string | null): value is string {
  return value !== null && correlationIdPattern.test(value) && !containsSensitiveText(value);
}

export function getOrCreateCorrelationId(
  headers: Headers,
  generate: () => string = randomUUID,
): string {
  const supplied = headers.get(CORRELATION_ID_HEADER);
  return isValidCorrelationId(supplied) ? supplied : generate();
}

function isValidTracestate(value: string): boolean {
  return value.length <= 512 && /^[\x20-\x7e]+$/.test(value) && !containsSensitiveText(value);
}

export function createPropagationHeaders(incoming: Headers): Headers {
  const outgoing = new Headers({
    [CORRELATION_ID_HEADER]: getOrCreateCorrelationId(incoming),
  });
  const traceparent = incoming.get("traceparent");
  const tracestate = incoming.get("tracestate");

  if (traceparent && traceparentPattern.test(traceparent)) {
    outgoing.set("traceparent", traceparent);
  }
  if (tracestate && isValidTracestate(tracestate)) {
    outgoing.set("tracestate", tracestate);
  }

  return outgoing;
}

export function allowlistedTelemetryAttributes(
  attributes: Readonly<Record<string, unknown>>,
): Record<string, TelemetryAttribute> {
  const allowed: Record<string, TelemetryAttribute> = {};

  for (const [key, value] of Object.entries(attributes)) {
    const validator = attributeValidators[key as keyof typeof attributeValidators];
    if (validator?.(value) && (typeof value !== "string" || !containsSensitiveText(value))) {
      allowed[key] = value;
    }
  }

  return allowed;
}
