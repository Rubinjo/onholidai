import { describe, expect, it } from "vitest";

import { ProblemError, problemResponse } from "../../server/errors";
import {
  CORRELATION_ID_HEADER,
  allowlistedTelemetryAttributes,
  createPropagationHeaders,
  getOrCreateCorrelationId,
} from "../../server/telemetry";

describe("correlation propagation", () => {
  it("preserves valid correlation and W3C trace headers", () => {
    const incoming = new Headers({
      [CORRELATION_ID_HEADER]: "request-123",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=value",
      authorization: "Bearer secret",
    });

    const outgoing = createPropagationHeaders(incoming);

    expect(outgoing.get(CORRELATION_ID_HEADER)).toBe("request-123");
    expect(outgoing.get("traceparent")).toBe(incoming.get("traceparent"));
    expect(outgoing.get("tracestate")).toBe("vendor=value");
    expect(outgoing.has("authorization")).toBe(false);
  });

  it("replaces malformed correlation IDs", () => {
    const generated = "generated-456";

    expect(
      getOrCreateCorrelationId(
        new Headers({ [CORRELATION_ID_HEADER]: "bad value" }),
        () => generated,
      ),
    ).toBe(generated);
  });

  it("does not propagate supplier secrets hidden inside trace metadata", () => {
    const outgoing = createPropagationHeaders(new Headers({
      [CORRELATION_ID_HEADER]: "passport-991199",
      tracestate: "vendor=api%4bey-private-canary",
    }));
    expect(outgoing.get(CORRELATION_ID_HEADER)).not.toBe("passport-991199");
    expect(outgoing.has("tracestate")).toBe(false);
  });
});

describe("telemetry attribute allowlist", () => {
  it("retains bounded operational attributes and drops sensitive or arbitrary data", () => {
    expect(
      allowlistedTelemetryAttributes({
        "service.name": "onholidai-web",
        "http.request.method": "POST",
        "http.response.status_code": 202,
        "onholidai.correlation_id": "request-123",
        "onholidai.outcome": "accepted",
        "gen_ai.prompt": "Book for Alice using card 4111111111111111",
        "gen_ai.completion": "Supplier cost is 950; margin is 20%",
        authorization: "Bearer secret",
        travellerEmail: "alice@example.test",
        supplierAmount: 950,
        margin: 0.2,
      }),
    ).toEqual({
      "service.name": "onholidai-web",
      "http.request.method": "POST",
      "http.response.status_code": 202,
      "onholidai.correlation_id": "request-123",
      "onholidai.outcome": "accepted",
    });
  });

  it("rejects unsafe values even when they use an allowlisted key", () => {
    expect(
      allowlistedTelemetryAttributes({
        "onholidai.provider": "supplier\nauthorization=secret",
        "http.response.status_code": "two hundred",
      }),
    ).toEqual({});
  });

  it("rejects encoded supplier secrets and economics inside operational tokens", () => {
    expect(allowlistedTelemetryAttributes({
      "onholidai.provider": "supplier_cost_991199",
      "onholidai.operation": "https://provider.example/secret/883388",
      "onholidai.outcome": "passport-991199",
      "onholidai.duration_ms": 12,
    })).toEqual({ "onholidai.duration_ms": 12 });
  });
});

describe("RFC problem responses", () => {
  it("does not trust sensitive strings inside explicitly typed problems", async () => {
    const response = problemResponse(new ProblemError({
      title: "Provider failed: supplier_cost=991199",
      status: 502,
      code: "supplier_failure",
      detail: "https://provider.example/offer?api%4bey=883388",
      fieldErrors: [{ path: "passport_991199", message: "Bearer private-canary" }],
    }), "request-safe");
    const body = JSON.stringify(await response.json());
    expect(body).not.toMatch(/991199|883388|private-canary/);
    expect(body).toContain("request-safe");
  });

  it("returns explicitly safe problem details and the correlation header", async () => {
    const response = problemResponse(
      new ProblemError({
        type: "https://onholidai.example/problems/stale-version",
        title: "Trip version changed",
        status: 409,
        code: "stale_version",
        detail: "Reload the trip and try again.",
      }),
      "request-123",
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(response.headers.get(CORRELATION_ID_HEADER)).toBe("request-123");
    expect(await response.json()).toEqual({
      type: "https://onholidai.example/problems/stale-version",
      title: "Trip version changed",
      status: 409,
      code: "stale_version",
      detail: "Reload the trip and try again.",
      correlationId: "request-123",
    });
  });

  it("never serializes unexpected exception messages, causes, or stacks", async () => {
    const secret = "Bearer production-token";
    const response = problemResponse(
      new Error(`Provider failed with ${secret}`, { cause: { traveller: "Alice" } }),
      "request-500",
    );
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(body).not.toContain(secret);
    expect(body).not.toContain("Alice");
    expect(body).not.toContain("stack");
    expect(body).toContain("internal_error");
    expect(body).toContain("request-500");
  });
});