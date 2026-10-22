import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { EstimateMap } from "../../components/map/estimate-map";
import { travelSegmentSchema } from "../../domain/trip/schema";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

const runtime = vi.hoisted(() => ({ created: vi.fn(), data: vi.fn() }));
vi.mock("maplibre-gl", () => ({
  setWorkerUrl() {},
  Map: class {
    constructor(public options: { container: HTMLElement }) {
      runtime.created();
    }
    sources = new Set<string>();
    on(event: string, handler: () => void) {
      if (event === "load") queueMicrotask(handler);
    }
    setProjection() {}
    addLayer() {}
    setFilter() {}
    fitBounds() {}
    jumpTo() {}
    resize() {}
    remove() {}
    addSource(name: string) {
      this.sources.add(name);
    }
    getSource(name: string) {
      return this.sources.has(name)
        ? { setData: (data: unknown) => runtime.data(name, data) }
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
  expect(runtime.data).toHaveBeenCalledWith("segments", {
    type: "FeatureCollection",
    features: [],
  });
});
