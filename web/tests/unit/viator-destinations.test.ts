// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  createViatorDestinationDirectory,
  resolveViatorDestinationId,
} from "../../server/supply/viator-destinations";

function respond(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => Response.json(body, { status }));
}

const catalog = {
  destinations: [
    { destinationId: 16, name: "Japan", type: "COUNTRY", parentDestinationId: 2 },
    { destinationId: 334, name: "Tokyo", type: "CITY", parentDestinationId: 16 },
    { destinationId: 50157, name: "Tokyo Prefecture", type: "REGION", parentDestinationId: 16 },
    { destinationId: 8, name: "Rome", type: "CITY", parentDestinationId: 5 },
  ],
};

describe("Viator destination identity lookup", () => {
  it("reads the published catalogue instead of the failing free-text destination search", async () => {
    const request = respond(catalog);
    const directory = createViatorDestinationDirectory({
      apiKey: "synthetic-viator-key",
      environment: "sandbox",
      fetch: request,
    });
    const matches = await directory.candidates("Tokyo");
    expect(matches).toEqual([
      { id: "334", name: "Tokyo", type: "CITY", parentId: "16" },
      { id: "16", name: "Japan", type: "COUNTRY", parentId: null },
    ]);
    const [url, init] = request.mock.calls[0];
    expect(String(url)).toBe("https://api.sandbox.viator.com/partner/destinations");
    expect(init?.method).toBe("GET");
    const headers = new Headers(init!.headers);
    expect(headers.get("exp-api-key")).toBe("synthetic-viator-key");
    expect(headers.get("accept")).toBe("application/json;version=2.0");
  });

  it("reads the catalogue once and degrades to no matches", async () => {
    const ok = respond(catalog);
    const directory = createViatorDestinationDirectory({
      apiKey: "synthetic-viator-key",
      environment: "sandbox",
      fetch: ok,
    });
    await directory.candidates("Japan");
    await directory.candidates("  japan  ");
    expect(ok).toHaveBeenCalledTimes(1);

    const malformed = respond({ destinations: "invalid" });
    const broken = createViatorDestinationDirectory({
      apiKey: "synthetic-viator-key",
      environment: "sandbox",
      fetch: malformed,
    });
    await expect(broken.candidates("Paris")).resolves.toEqual([]);

    const denied = vi.fn<typeof fetch>(async () => new Response("denied", { status: 403 }));
    const blocked = createViatorDestinationDirectory({
      apiKey: "synthetic-viator-key",
      environment: "sandbox",
      fetch: denied,
    });
    await expect(blocked.candidates("Rome")).resolves.toEqual([]);

    const throttled = vi.fn<typeof fetch>(
      async () => new Response("slow down", { status: 429, headers: { "retry-after": "0" } }),
    );
    const limited = createViatorDestinationDirectory({
      apiKey: "synthetic-viator-key",
      environment: "sandbox",
      fetch: throttled,
    });
    await expect(limited.candidates("Rome")).resolves.toEqual([]);
  });
});

describe("resolving a supplier destination identity", () => {
  it("returns an id only for a unique exact name match", () => {
    expect(
      resolveViatorDestinationId("Tokyo", [
        { id: "334", name: "TOKYO", type: "CITY", parentId: "16" },
      ]),
    ).toBe("334");
    expect(
      resolveViatorDestinationId("Tokyo", [
        { id: "1", name: "Tokyo", type: "CITY", parentId: null },
        { id: "2", name: "Tokyo", type: "CITY", parentId: null },
      ]),
    ).toBeNull();
    expect(
      resolveViatorDestinationId("Tokyo", [
        { id: "9", name: "Kyoto", type: "CITY", parentId: null },
      ]),
    ).toBeNull();
  });
});
