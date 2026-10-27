// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createDuffelAirportResolver } from "../../server/supply/providers/duffel-airports";

const suggestion = (value: unknown) => Response.json({ data: [value] });

describe("Duffel gateway airport resolution", () => {
  it("resolves a country to the airport Duffel ranks first for that country", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      suggestion({
        type: "airport",
        iata_code: "AMS",
        city_name: "Amsterdam",
        airports: [],
      }),
    );
    const resolver = createDuffelAirportResolver({
      readToken: "synthetic-duffel-read",
      fetch,
    });
    await expect(resolver.resolve("Netherlands", new AbortController().signal)).resolves.toBe(
      "AMS",
    );
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.duffel.com/places/suggestions?query=Netherlands");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
    expect(init.credentials).toBe("omit");
    expect(JSON.stringify(init.headers)).toContain("Duffel-Version");
  });

  it("uses a city's first airport instead of its metro code", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      suggestion({
        type: "city",
        city_name: null,
        iata_code: "TYO",
        airports: [
          { iata_code: "HND", city_name: "Tokyo" },
          { iata_code: "NRT", city_name: "Tokyo" },
        ],
      }),
    );
    const resolver = createDuffelAirportResolver({ readToken: "synthetic", fetch });
    await expect(resolver.resolve("Japan", new AbortController().signal)).resolves.toBe("HND");
  });

  it("caches a resolution and reuses it for the same term", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      suggestion({ type: "airport", iata_code: "HND", city_name: "Tokyo" }),
    );
    const resolver = createDuffelAirportResolver({ readToken: "synthetic", fetch });
    await resolver.resolve("Tokyo", new AbortController().signal);
    await resolver.resolve("  tokyo ", new AbortController().signal);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("never invents an airport for failed, malformed or empty lookups", async () => {
    for (const reply of [
      () => Response.json({ errors: [] }, { status: 500 }),
      () => new Response("not json", { status: 200 }),
      () => Response.json({ data: [] }),
      () => Response.json({ data: [{ type: "airport", iata_code: "hnd" }] }),
      () => {
        throw new TypeError("network down");
      },
    ]) {
      const resolver = createDuffelAirportResolver({
        readToken: "synthetic",
        fetch: vi.fn<typeof globalThis.fetch>(async () => reply()),
      });
      await expect(resolver.resolve("Japan", new AbortController().signal)).resolves.toBeNull();
    }
  });
});
