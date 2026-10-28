// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createViatorHttpClient } from "../../server/supply/providers/viator-http";
import { decimalMinor, readJson, record } from "../../server/supply/providers/read-http";
import { SupplyReadError, type SupplyReadQuery } from "../../server/supply/read";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

vi.mock("server-only", () => ({}));
function query(): SupplyReadQuery {
  const trip = createSyntheticTripSnapshot();
  return {
    componentTypes: ["activity"],
    currency: "GBP",
    departureOrigin: null,
    destinationIds: [trip.destinations[0].id],
    startDate: "2030-05-01",
    endDate: "2030-05-01",
    travellerParty: { adults: 2, children: [] },
  };
}
function client(transport: typeof fetch, timeoutMs = 8000) {
  return createViatorHttpClient({
    apiKey: "synthetic-private-key",
    fetch: transport,
    timeoutMs,
    resolveDestination: () => "1234",
  });
}
describe("bounded read HTTP and decimal mapping", () => {
  it("enforces exact endpoint AND method allowlists before invoking fetch", async () => {
    const allowed = [
      "POST https://api.duffel.com/air/offer_requests?return_offers=false",
      "GET https://api.duffel.com/air/offers?offer_request_id=orq_synthetic1&limit=32&sort=total_amount",
      "GET https://api.duffel.com/air/offers/off_synthetic1",
      "POST https://api.duffel.com/stays/search",
      "POST https://api.duffel.com/stays/search_results/srr_synthetic1/actions/fetch_all_rates",
      "POST https://api.viator.com/partner/products/search",
      "GET https://api.viator.com/partner/products/SYNTHETIC1",
      "POST https://api.viator.com/partner/availability/check",
    ];
    const transport = vi.fn(async () => new Response("{}"));
    const request = readJson({ fetch: transport }, allowed, {});
    const signal = new AbortController().signal;
    for (const operation of allowed) {
      const [method, url] = operation.split(" ") as ["GET" | "POST", string];
      await expect(request(url, method, signal)).resolves.toEqual({});
      await expect(request(url, method === "GET" ? "POST" : "GET", signal)).rejects.toMatchObject({
        status: "unsupported",
      });
      await expect(request(`${url}&extra=1`, method, signal)).rejects.toMatchObject({
        status: "unsupported",
      });
    }
    for (const url of [
      "https://api.duffel.com/air/orders",
      "https://api.duffel.com/stays/quotes",
      "https://api.duffel.com/stays/bookings",
      ...[
        "bookings/hold",
        "bookings/book",
        "bookings/cart/hold",
        "bookings/cart/book",
        "bookings/cancel",
        "bookings/amend",
      ].map((path) => `https://api.viator.com/partner/${path}`),
      "https://unapproved.invalid/partner/products/search",
      "http://api.viator.com/partner/products/search",
      "https://api.viator.com.evil.invalid/partner/products/search",
    ]) {
      await expect(request(url, "POST", signal)).rejects.toMatchObject({ status: "unsupported" });
    }
    expect(transport).toHaveBeenCalledTimes(allowed.length);
  });
  it.each(["success", "http_failure", "malformed", "abort", "deadline"] as const)(
    "removes caller and response-stream abort listeners after %s",
    async (outcome) => {
      const caller = new AbortController();
      const addCaller = vi.spyOn(caller.signal, "addEventListener");
      const removeCaller = vi.spyOn(caller.signal, "removeEventListener");
      let addInternal: ReturnType<typeof vi.spyOn> | undefined;
      let removeInternal: ReturnType<typeof vi.spyOn> | undefined;
      const transport: typeof fetch = vi.fn(async (_url, init) => {
        const internal = init!.signal!;
        addInternal = vi.spyOn(internal, "addEventListener");
        removeInternal = vi.spyOn(internal, "removeEventListener");
        if (outcome === "http_failure") return new Response("not forwarded", { status: 403 });
        if (outcome === "malformed") return new Response("{bad");
        if (outcome === "abort" || outcome === "deadline") {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"products":['));
                if (outcome === "abort") queueMicrotask(() => caller.abort());
              },
            }),
          );
        }
        return new Response('{"products":[]}');
      });
      const result = client(transport, outcome === "deadline" ? 5 : 8000).search(
        query(),
        caller.signal,
      );
      if (outcome === "success") await expect(result).resolves.toEqual([]);
      else await expect(result).rejects.toBeInstanceOf(SupplyReadError);
      // Stream cancellation/read cleanup completes in the same microtask turn.
      await Promise.resolve();
      for (const [event, listener] of addCaller.mock.calls) {
        if (event === "abort") expect(removeCaller).toHaveBeenCalledWith("abort", listener);
      }
      for (const [event, listener] of addInternal?.mock.calls ?? []) {
        if (event === "abort") expect(removeInternal).toHaveBeenCalledWith("abort", listener);
      }
      expect(addCaller.mock.calls.length).toBeGreaterThan(0);
      // Every transient listener (attempts and backoff waits) is removed again.
      expect(removeCaller.mock.calls.length).toBe(addCaller.mock.calls.length);
    },
  );
  it.each([
    ["0.29", "GBP", 29],
    ["100", "JPY", 100],
    ["1.234", "KWD", 1234],
    [0.29, "GBP", 29],
    ["12.0300", "GBP", 1203],
  ])("scales %s %s without float multiplication", (amount, currency, expected) => {
    expect(decimalMinor(amount, currency as string)).toBe(expected);
  });
  it.each(["-1", "0.001", "1e3", "NaN", "9007199254740992", "1.2x"])(
    "rejects invalid, fractional-minor or unsafe amounts %s",
    (amount) => {
      expect(() => decimalMinor(amount, "GBP")).toThrow(SupplyReadError);
    },
  );
  it.each([
    [401, "access_blocked"],
    [403, "access_blocked"],
    [429, "rate_limited"],
    [500, "error"],
  ])("sanitizes HTTP %s without leaking supplier response bodies", async (status, expected) => {
    const transport = vi.fn(
      async () =>
        new Response("synthetic-private-upstream-body", {
          status: status as number,
          headers: { "retry-after": "12" },
        }),
    );
    try {
      await client(transport).search(query(), new AbortController().signal);
      expect.fail("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(SupplyReadError);
      expect(error).toMatchObject({
        status: expected,
        retryAfterMs: status === 429 ? 12000 : null,
      });
      expect(String(error)).not.toMatch(/synthetic-private/);
    }
  });
  it("bounds declared and streamed bodies, and sanitizes malformed JSON", async () => {
    for (const response of [
      new Response("{}", { headers: { "content-length": "1048577" } }),
      new Response("x".repeat(1_048_577)),
      new Response("{malformed synthetic-private"),
      new Response(JSON.stringify({ products: "not-an-array" })),
    ]) {
      await expect(
        client(vi.fn(async () => response)).search(query(), new AbortController().signal),
      ).rejects.toMatchObject({ name: "SupplyReadError", status: "error" });
    }
  });
  it("preserves the original JSON money token instead of silently rounding numeric wire amounts", async () => {
    const valid =
      '{"products":[{"productCode":"SYNTHETIC1","pricing":{"currency":"GBP","summary":{"fromPrice":90071992547409.91}}}]}';
    const transport = vi.fn(async () => new Response(valid));
    const hit = (await client(transport).search(query(), new AbortController().signal))[0];
    expect(JSON.parse(hit.planningDetails.fareConditions!).fromPriceMinor).toBe(9007199254740991);
    const fractionalMinor = valid.replace("90071992547409.91", "0.290000000000000000001");
    await expect(
      client(vi.fn(async () => new Response(fractionalMinor))).search(
        query(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: "error" });
  });
  it("preserves exact mandatory-extra charge tokens for downstream integer scaling", async () => {
    const transport = vi.fn(
      async () => new Response('{"totalExtraCharges":0.290000000000000000001}'),
    );
    const payload = await readJson({ fetch: transport }, ["GET https://approved.invalid/read"], {})(
      "https://approved.invalid/read",
      "GET",
      new AbortController().signal,
    );
    expect(payload).toEqual({ totalExtraCharges: "0.290000000000000000001" });
    expect(() => decimalMinor(record(payload).totalExtraCharges, "GBP")).toThrow(SupplyReadError);
  });
  it("propagates cancellation and applies its own deadline even to an uncooperative injected fetch", async () => {
    const abortController = new AbortController();
    let seenSignal: AbortSignal | null = null;
    const transport: typeof fetch = vi.fn(async (_url, init) => {
      seenSignal = init?.signal as AbortSignal;
      return await new Promise<Response>(() => {});
    });
    const pending = client(transport).search(query(), abortController.signal);
    abortController.abort();
    await expect(pending).rejects.toMatchObject({ status: "error" });
    expect((seenSignal as AbortSignal | null)?.aborted).toBe(true);
    await expect(
      client(transport, 5).search(query(), new AbortController().signal),
    ).rejects.toMatchObject({ status: "error" });
  });
  it("bounds stalled response bodies as well as response headers", async () => {
    let cancelled = false;
    const transport = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"products":['));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    );
    await expect(
      client(transport, 5).search(query(), new AbortController().signal),
    ).rejects.toMatchObject({ status: "error" });
    expect(cancelled).toBe(true);
  });
  it("never sends a pre-aborted request and redacts transport errors", async () => {
    const transport = vi.fn(async () => {
      throw new Error("synthetic-private-key https://unsafe.invalid");
    });
    const controller = new AbortController();
    controller.abort();
    await expect(client(transport).search(query(), controller.signal)).rejects.toMatchObject({
      status: "error",
    });
    expect(transport).not.toHaveBeenCalled();
    await expect(client(transport).search(query(), new AbortController().signal)).rejects.toThrow(
      "The supplier search failed or returned invalid evidence; inventory is unknown.",
    );
  });
  it("retries a transient supplier failure and returns the recovered page", async () => {
    let calls = 0;
    const transport = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response("busy", { status: 503 });
      return Response.json({ products: [] });
    });
    const payload = await client(transport).search(query(), new AbortController().signal);
    expect(payload).toEqual([]);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("stops after the attempt budget when a supplier keeps failing", async () => {
    const transport = vi.fn(async () => new Response("busy", { status: 500 }));
    await expect(
      client(transport).search(query(), new AbortController().signal),
    ).rejects.toMatchObject({ status: "error" });
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it("does not retry a definitive rejection", async () => {
    const transport = vi.fn(async () => new Response("denied", { status: 403 }));
    await expect(
      client(transport).search(query(), new AbortController().signal),
    ).rejects.toMatchObject({ status: "access_blocked" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("honours a rate limit retry window without exceeding the attempt budget", async () => {
    let calls = 0;
    const transport = vi.fn(async () => {
      calls += 1;
      if (calls === 1)
        return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
      return Response.json({ products: [] });
    });
    await expect(client(transport).search(query(), new AbortController().signal)).resolves.toEqual(
      [],
    );
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("keeps usable products when a page contains one unusable record", async () => {
    const transport = vi.fn(async () =>
      Response.json({
        products: [
          {
            productCode: "SYNTHETIC1",
            title: "Sourced activity",
            pricing: { currency: "GBP", summary: { fromPrice: "12.34" } },
          },
          { title: "Missing a product code" },
        ],
      }),
    );
    const payload = await client(transport).search(query(), new AbortController().signal);
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({ offerId: "SYNTHETIC1", currency: "GBP" });
  });
});
