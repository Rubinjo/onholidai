// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ALLOWED_SPAN_NAMES,
  RESOURCE_ATTRIBUTE_KEYS,
  createOtlpHttpSink,
  routeTemplate,
  sanitizeOperationSpan,
  spanAttributeKeys,
} from "../../server/telemetry-exporter";

const startedAt = new Date("2026-10-14T12:00:00.000Z");
const endedAt = new Date("2026-10-14T12:00:00.250Z");
const nanos = (at: Date) => (BigInt(at.getTime()) * 1_000_000n).toString();

describe("operation span sanitization", () => {
  it("keeps only allowlisted span names, event names and bounded attributes", () => {
    const span = sanitizeOperationSpan({
      name: "http.server.request",
      startedAt,
      endedAt,
      attributes: {
        "http.request.method": "POST",
        "http.response.status_code": 202,
        "onholidai.correlation_id": "request-123",
        "onholidai.duration_ms": 250,
        "gen_ai.prompt": "Book for Alice using card 4111111111111111",
        travellerEmail: "alice@example.test",
        supplierAmount: 950,
        margin: 0.2,
      },
      events: [
        { name: "exception", at: endedAt, attributes: { "error.type": "provider_error", "gen_ai.completion": "secret" } },
        { name: "sensitive.event", at: endedAt, attributes: { "error.type": "provider_error" } },
      ],
    });

    expect(span?.name).toBe("http.server.request");
    expect(span?.attributes).toEqual({
      "http.request.method": "POST",
      "http.response.status_code": 202,
      "onholidai.correlation_id": "request-123",
      "onholidai.duration_ms": 250,
    });
    // Only the reviewed event name survives, with only its allowlisted attributes.
    expect(span?.events).toEqual([
      { name: "exception", timeUnixNano: nanos(endedAt), attributes: { "error.type": "provider_error" } },
    ]);
    expect(span?.startTimeUnixNano).toBe(nanos(startedAt));
    expect(sanitizeOperationSpan({ name: "traveller.private.operation", startedAt, endedAt })).toBeNull();
  });

  it("collapses identifiers out of route attributes", () => {
    expect(routeTemplate("/api/v1/trips/faf03598-006d-474b-9234-ed6d81f60faa/bookings"))
      .toBe("/api/v1/trips/:id/bookings");
    expect(routeTemplate("/api/v1/trips")).toBe("/api/v1/trips");
  });
});

describe("OTLP sink privacy", () => {
  it("never serializes excluded data into the exported payload", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const sink = createOtlpHttpSink({
      endpoint: "http://collector:4318/",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resource: { "service.name": "onholidai-web", "deployment.environment.name": "test", "service.version": "1" },
    });
    const sanitized = sanitizeOperationSpan({
      name: "provider.callback",
      startedAt,
      endedAt,
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      outcome: "error",
      attributes: { "onholidai.outcome": "failed", authorization: "Bearer topsecret", supplierAmount: 4242, "gen_ai.prompt": "Alice" },
    });
    expect(sanitized).not.toBeNull();

    await sink.export([sanitized!]);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://collector:4318/v1/traces");
    const body = String(init.body);
    for (const secret of ["Bearer topsecret", "supplierAmount", "gen_ai.prompt", "Alice", "4242"]) {
      expect(body).not.toContain(secret);
    }
    const payload = JSON.parse(body) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ name: string; status: { code: number } }> }> }> };
    const exported = payload.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
    expect(exported.name).toBe("provider.callback");
    expect(exported.status.code).toBe(2);
  });

  it("drops spans whose name is not reviewed before serialization", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const sink = createOtlpHttpSink({ endpoint: "http://collector:4318", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(sanitizeOperationSpan({ name: "unreviewed.operation", startedAt, endedAt })).toBeNull();
    await sink.export([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("collector allowlist drift", () => {
  it("keeps the collector span allowlist identical to the reviewed attribute list", async () => {
    const yaml = await readFile(new URL("../../../infra/observability/otel-collector.yaml", import.meta.url), "utf8");
    const spanSection = yaml.slice(yaml.indexOf("context: span"), yaml.indexOf("context: spanevent"));
    const listed = spanSection.match(/keep_keys\(attributes, \[([^\]]+)\]\)/)?.[1]
      .split(",")
      .map((key) => key.trim().replaceAll('"', ""))
      .sort();
    expect(listed).toEqual([...spanAttributeKeys()].sort());
    expect(RESOURCE_ATTRIBUTE_KEYS).toEqual(["deployment.environment.name", "service.name", "service.version"]);
    expect(ALLOWED_SPAN_NAMES).toContain("http.server.request");
  });
});
