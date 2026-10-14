import "server-only";

import { randomUUID } from "node:crypto";

import { allowlistedTelemetryAttributes, TELEMETRY_ATTRIBUTE_KEYS } from "./telemetry";

// Only reviewed span and span-event names may leave the process. Anything else is dropped before an
// exporter sees it, so a future call site cannot leak a name that embeds personal or supplier data.
export const ALLOWED_SPAN_NAMES: readonly string[] = Object.freeze([
  "http.server.request",
  "agent.run.dispatch",
  "provider.callback",
  "trip.commit",
  "booking.workflow",
]);
export const ALLOWED_SPAN_EVENT_NAMES: readonly string[] = Object.freeze(["exception"]);
export const RESOURCE_ATTRIBUTE_KEYS: readonly string[] = Object.freeze([
  "deployment.environment.name",
  "service.name",
  "service.version",
]);

export interface OperationSpanEvent {
  name: string;
  at: Date;
  attributes?: Readonly<Record<string, unknown>>;
}
export interface OperationSpan {
  name: string;
  startedAt: Date;
  endedAt: Date;
  traceId?: string;
  spanId?: string;
  outcome?: "success" | "error";
  attributes?: Readonly<Record<string, unknown>>;
  events?: readonly OperationSpanEvent[];
}
export interface SanitizedSpan {
  traceId: string;
  spanId: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  statusCode: 1 | 2;
  attributes: Record<string, string | number | boolean>;
  events: Array<{ name: string; timeUnixNano: string; attributes: Record<string, string | number | boolean> }>;
}
export interface SpanSink {
  export(spans: readonly SanitizedSpan[]): Promise<void>;
}

const hexPattern = /^[0-9a-f]+$/;

function nanoseconds(at: Date): string {
  return (BigInt(at.getTime()) * 1_000_000n).toString();
}

function identity(value: string | undefined, bytes: number): string {
  if (value && value.length === bytes * 2 && hexPattern.test(value)) return value;
  return randomUUID().replaceAll("-", "").slice(0, bytes * 2);
}

// Collapses concrete path segments (UUIDs and opaque ids) so a span never carries a raw trip,
// booking or traveller identifier in its route attribute.
export function routeTemplate(pathname: string): string {
  const template = pathname
    .split("/")
    .map((segment) =>
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(segment)
        ? ":id"
        : segment,
    )
    .join("/");
  return template.length <= 256 ? template : "/:route";
}

export function sanitizeOperationSpan(span: OperationSpan): SanitizedSpan | null {
  if (!ALLOWED_SPAN_NAMES.includes(span.name)) return null;
  const events = (span.events ?? [])
    .filter((event) => ALLOWED_SPAN_EVENT_NAMES.includes(event.name))
    .map((event) => ({
      name: event.name,
      timeUnixNano: nanoseconds(event.at),
      attributes: allowlistedTelemetryAttributes(event.attributes ?? {}),
    }));
  return {
    traceId: identity(span.traceId, 16),
    spanId: identity(span.spanId, 8),
    name: span.name,
    startTimeUnixNano: nanoseconds(span.startedAt),
    endTimeUnixNano: nanoseconds(span.endedAt),
    statusCode: span.outcome === "error" ? 2 : 1,
    attributes: allowlistedTelemetryAttributes(span.attributes ?? {}),
    events,
  };
}

type AttributeValue = string | number | boolean;
type AttributeInput = Readonly<Record<string, AttributeValue>>;

function otlpValue(value: AttributeValue): Record<string, unknown> {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  return { stringValue: value };
}

function otlpAttributes(attributes: AttributeInput): Array<{ key: string; value: Record<string, unknown> }> {
  return Object.entries(attributes).map(([key, value]) => ({ key, value: otlpValue(value) }));
}

export function buildOtlpTracePayload(
  spans: readonly SanitizedSpan[],
  resource: AttributeInput = {},
): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: { attributes: otlpAttributes(resource) },
        scopeSpans: [
          {
            scope: { name: "onholidai", version: "1" },
            spans: spans.map((span) => ({
              traceId: span.traceId,
              spanId: span.spanId,
              name: span.name,
              startTimeUnixNano: span.startTimeUnixNano,
              endTimeUnixNano: span.endTimeUnixNano,
              attributes: otlpAttributes(span.attributes),
              events: span.events.map((event) => ({
                name: event.name,
                timeUnixNano: event.timeUnixNano,
                attributes: otlpAttributes(event.attributes),
              })),
              status: { code: span.statusCode },
            })),
          },
        ],
      },
    ],
  };
}

export interface OtlpHttpSinkOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
  resource?: AttributeInput;
}

// A dependency-free OTLP/HTTP JSON exporter. The collector applies the same allowlist again, so a
// sanitization regression here is caught by both the sink tests and the collector transform.
export function createOtlpHttpSink(options: OtlpHttpSinkOptions): SpanSink {
  const base = options.endpoint.replace(/\/+$/, "");
  const url = `${base}/v1/traces`;
  const send = options.fetchImpl ?? fetch;

  return {
    async export(spans) {
      const sanitized = spans.filter((span): span is SanitizedSpan => Boolean(span));
      if (sanitized.length === 0) return;
      const body = JSON.stringify(buildOtlpTracePayload(sanitized, options.resource ?? {}));
      await send(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    },
  };
}

let configuredSink: SpanSink | null = null;

export function configureSpanSink(sink: SpanSink | null): void {
  configuredSink = sink;
}

export function currentSpanSink(): SpanSink | null {
  return configuredSink;
}

// Emission never throws into the caller: telemetry must not change request behaviour.
export async function emitOperationSpan(span: OperationSpan): Promise<void> {
  const sink = configuredSink;
  if (!sink) return;
  const sanitized = sanitizeOperationSpan(span);
  if (!sanitized) return;
  try {
    await sink.export([sanitized]);
  } catch {
    // Export failures are intentionally swallowed; a telemetry outage is not a request failure.
  }
}

// The attributes a span may export are exactly the reviewed allowlist minus the resource-scoped keys.
export function spanAttributeKeys(): readonly string[] {
  return TELEMETRY_ATTRIBUTE_KEYS.filter((key) => !RESOURCE_ATTRIBUTE_KEYS.includes(key));
}
