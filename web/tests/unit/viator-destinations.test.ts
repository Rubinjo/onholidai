// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  createViatorDestinationDirectory,
  resolveViatorDestinationId,
} from "../../server/supply/viator-destinations";

function respond(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => Response.json(body, { status }));
}

describe("Viator destination identity lookup", () => {
  it("posts the documented free-text destination search and returns supplier identities", async () => {
    const request = respond({
      destinations: {
        totalCount: 2,
        results: [
          { id: 334, name: "Tokyo", parentDestinationId: 23404 },
          { id: 50157, name: "Tokyo Prefecture", parentDestinationId: 16 },
        ],
      },
    });
    const directory = createViatorDestinationDirectory({
      apiKey: "synthetic-viator-key",
      environment: "sandbox",
      fetch: request,
    });
    const matches = await directory.lookup("Tokyo", new AbortController().signal);
    expect(matches).toEqual([
      { id: "334", name: "Tokyo" },
      { id: "50157", name: "Tokyo Prefecture" },
    ]);
    const [url, init] = request.mock.calls[0];
    expect(String(url)).toBe("https://api.sandbox.viator.com/partner/search/freetext");
    expect(JSON.parse(String(init!.body))).toEqual({
      searchTerm: "Tokyo",
      currency: "EUR",
      searchTypes: [{ searchType: "DESTINATIONS", pagination: { start: 1, count: 10 } }],
    });
    const headers = new Headers(init!.headers);
    expect(headers.get("exp-api-key")).toBe("synthetic-viator-key");
    expect(headers.get("accept")).toBe("application/json;version=2.0");
  });

  it("caches one lookup per term and degrades to no matches", async () => {
    const ok = respond({ destinations: { results: [{ id: 334, name: "Tokyo" }] } });
    const directory = createViatorDestinationDirectory({
      apiKey: "synthetic-viator-key",
      environment: "sandbox",
      fetch: ok,
    });
    const signal = new AbortController().signal;
    await directory.lookup("Tokyo", signal);
    await directory.lookup("  tokyo  ", signal);
    expect(ok).toHaveBeenCalledTimes(1);

    const malformed = respond({ destinations: "invalid" });
    const broken = createViatorDestinationDirectory({
      apiKey: "synthetic-viator-key",
      environment: "sandbox",
      fetch: malformed,
    });
    await expect(broken.lookup("Paris", signal)).resolves.toEqual([]);

    const denied = vi.fn<typeof fetch>(async () => new Response("denied", { status: 403 }));
    const blocked = createViatorDestinationDirectory({
      apiKey: "synthetic-viator-key",
      environment: "sandbox",
      fetch: denied,
    });
    await expect(blocked.lookup("Rome", signal)).resolves.toEqual([]);
  });
});

describe("resolving a supplier destination identity", () => {
  it("returns an id only for a unique exact name match", () => {
    expect(resolveViatorDestinationId("Tokyo", [{ id: "334", name: "TOKYO" }])).toBe("334");
    expect(
      resolveViatorDestinationId("Tokyo", [
        { id: "1", name: "Tokyo" },
        { id: "2", name: "Tokyo" },
      ]),
    ).toBeNull();
    expect(resolveViatorDestinationId("Tokyo", [{ id: "9", name: "Kyoto" }])).toBeNull();
  });
});
