import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { EstimateMap } from "../../components/map/estimate-map";
import { travelSegmentSchema } from "../../domain/trip/schema";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

const runtime = vi.hoisted(() => ({
  created: vi.fn(),
  data: vi.fn(),
  fitBounds: vi.fn(),
  jumpTo: vi.fn(),
  countries: vi.fn(
    (): Promise<{
      type: "FeatureCollection";
      features: { properties: Record<string, unknown> }[];
    }> => Promise.resolve({ type: "FeatureCollection", features: [] }),
  ),
}));
vi.mock("maplibre-gl", () => ({
  setWorkerUrl() {},
  Map: class {
    constructor(public options: { container: HTMLElement }) {
      runtime.created(options);
    }
    sources = new Set<string>();
    on(event: string, handler: () => void) {
      if (event === "load") queueMicrotask(handler);
    }
    setProjection() {}
    addLayer() {}
    setFilter() {}
    fitBounds = runtime.fitBounds;
    jumpTo = runtime.jumpTo;
    resize() {}
    remove() {}
    addSource(name: string) {
      this.sources.add(name);
    }
    getSource(name: string) {
      return this.sources.has(name)
        ? { setData: (data: unknown) => runtime.data(name, data), getData: runtime.countries }
        : undefined;
    }
    getCanvas() {
      return document.createElement("canvas");
    }
  },
  Marker: class {
    constructor(public options: { element: HTMLElement }) {}
    setLngLat() {
      return this;
    }
    addTo(map: { options: { container: HTMLElement } }) {
      map.options.container.append(this.options.element);
      return this;
    }
    remove() {
      this.options.element.remove();
    }
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  runtime.countries.mockResolvedValue({ type: "FeatureCollection", features: [] });
});
it("starts centered on the selected stop and focuses an AI-generated route on the same map", async () => {
  const places = createSyntheticTripSnapshot().destinations;
  const view = render(<EstimateMap destinations={places} />);
  await waitFor(() =>
    expect(runtime.jumpTo).toHaveBeenCalledWith({ center: [-9.1393, 38.7223], zoom: 3 }),
  );
  expect(runtime.created).toHaveBeenCalledWith(
    expect.objectContaining({ center: [-9.1393, 38.7223], zoom: 3 }),
  );
  view.rerender(
    <EstimateMap
      destinations={[
        ...places,
        {
          ...places[0],
          id: crypto.randomUUID(),
          name: "Porto",
          routePosition: 1,
          location: { latitude: 41.1579, longitude: -8.6291 },
        },
      ]}
    />,
  );
  await waitFor(() =>
    expect(runtime.fitBounds).toHaveBeenCalledWith(
      [
        [-9.1393, 38.7223],
        [-8.6291, 41.1579],
      ],
      { padding: 75, maxZoom: 5, animate: false },
    ),
  );
  expect(runtime.created).toHaveBeenCalledTimes(1);
});
it("centers country-only selections once basemap data loads without inventing stops", async () => {
  let finish: (data: Awaited<ReturnType<typeof runtime.countries>>) => void = () => {};
  runtime.countries.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const country = {
    ...createSyntheticTripSnapshot().destinations[0],
    kind: "country" as const,
    name: "Japan",
    countryCode: "JP",
    location: null,
  };
  render(<EstimateMap destinations={[country]} />);
  await waitFor(() => expect(runtime.countries).toHaveBeenCalled());
  expect(runtime.jumpTo).not.toHaveBeenCalled();
  await act(async () =>
    finish({
      type: "FeatureCollection",
      features: [{ properties: { ISO_A2_EH: "JP", LABEL_X: 138, LABEL_Y: 37 } }],
    }),
  );
  expect(runtime.jumpTo).toHaveBeenCalledWith({ center: [138, 37], zoom: 3 });
  expect(runtime.data).toHaveBeenCalledWith("route", {
    type: "FeatureCollection",
    features: [],
  });
  expect(document.querySelector(".map-stop")).toBeNull();
  expect(runtime.jumpTo).toHaveBeenCalledTimes(1);
});
it("fits all selected destinations on initial load, using coordinates before country labels", async () => {
  const places = createSyntheticTripSnapshot().destinations;
  runtime.countries.mockResolvedValue({
    type: "FeatureCollection",
    features: [
      { properties: { ISO_A2_EH: "PT", LABEL_X: -8, LABEL_Y: 40 } },
      { properties: { ISO_A2_EH: "JP", LABEL_X: 138, LABEL_Y: 37 } },
    ],
  });
  render(
    <EstimateMap
      destinations={[
        ...places,
        {
          ...places[0],
          id: crypto.randomUUID(),
          kind: "country",
          name: "Japan",
          countryCode: "JP",
          routePosition: 1,
          location: null,
        },
      ]}
    />,
  );
  await waitFor(() =>
    expect(runtime.fitBounds).toHaveBeenCalledWith(
      [
        [-9.1393, 37],
        [138, 38.7223],
      ],
      { padding: 75, maxZoom: 5, animate: false },
    ),
  );
});
it("focuses destinations arriving after an initially empty trip loads", async () => {
  const view = render(<EstimateMap destinations={[]} />);
  await waitFor(() => expect(runtime.created).toHaveBeenCalledTimes(1));
  expect(runtime.jumpTo).not.toHaveBeenCalled();
  view.rerender(<EstimateMap destinations={createSyntheticTripSnapshot().destinations} />);
  await waitFor(() => expect(runtime.jumpTo).toHaveBeenCalledTimes(1));
});
it("shows the map recovery control if basemap data cannot be read", async () => {
  runtime.countries.mockRejectedValueOnce(new Error("Basemap unavailable"));
  render(<EstimateMap destinations={createSyntheticTripSnapshot().destinations} />);
  expect(await screen.findByRole("button", { name: "Retry route map" })).toBeTruthy();
});
it("updates the same map with accepted stays/activities and mixed authoritative transport, without inventing missing geometry", async () => {
  const places = createSyntheticTripSnapshot().destinations;
  const endpoint = {
    placeId: "test",
    name: "Lisbon",
    timezone: "Europe/Lisbon",
    location: { latitude: 38.7, longitude: -9.1 },
  };
  const segments = (["flight", "rail", "bus", "drive", "public_transport", "other"] as const).map(
    (mode) =>
      travelSegmentSchema.parse({
        mode,
        origin: endpoint,
        destination: { ...endpoint, name: "Porto" },
        plannedDeparture: "2030-05-01T10:00:00Z",
        plannedArrival: "2030-05-01T12:00:00Z",
        durationMinutes: 120,
        durationUpperBoundMinutes: null,
        routeGeometry: null,
        directionsSummary: "Review route",
        source: "Synthetic test",
        freshnessAt: "2030-01-01T00:00:00Z",
        timingEvidence: [],
        verificationStatus: "unverified",
        feasibilityPolicyVersion: "1",
      }),
  );
  const view = render(
    <EstimateMap
      destinations={places}
      segments={segments}
      activities={{ [places[0].id]: ["Riverside walk"] }}
    />,
  );
  await waitFor(() => expect(runtime.created).toHaveBeenCalledTimes(1));
  await screen.findByText("Riverside walk");
  const key = screen.getByRole("list", { name: "Transport between destinations" });
  for (const label of [
    "Plane",
    "Train",
    "Bus",
    "Car",
    "mode not specified",
    "Transport not specified",
  ])
    expect(key).toHaveTextContent(label);
  expect(key).toHaveTextContent("route geometry unavailable");
  view.rerender(
    <EstimateMap
      destinations={places.map((place) => ({ ...place, plannedNights: 9 }))}
      segments={segments}
      activities={{ [places[0].id]: ["Museum visit"] }}
    />,
  );
  await screen.findByText("Museum visit");
  expect(screen.getByText("9 nights")).toBeTruthy();
  expect(runtime.created).toHaveBeenCalledTimes(1);
  expect(runtime.jumpTo).toHaveBeenCalledTimes(1);
  expect(runtime.data).toHaveBeenCalledWith("segments", {
    type: "FeatureCollection",
    features: [],
  });
});
