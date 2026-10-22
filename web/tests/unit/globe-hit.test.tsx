import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { DestinationGlobe } from "../../components/map/destination-globe";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

const runtime = vi.hoisted(() => ({
  click: null as null | (() => void),
  cityId: "selected" as string | null,
}));
vi.mock("maplibre-gl", () => ({
  setWorkerUrl() {},
  Map: class {
    constructor(public options: { container: HTMLElement }) {}
    on(event: string, ...args: unknown[]) {
      const handler = args.at(-1) as () => void;
      if (event === "load") queueMicrotask(handler);
      if (event === "click") runtime.click = handler;
    }
    setProjection() {}
    addSource() {}
    addLayer() {}
    setFilter() {}
    resize() {}
    remove() {}
    getSource() {
      return { setData() {} };
    }
    getLayer() {
      return true;
    }
    getCanvas() {
      return document.createElement("canvas");
    }
    queryRenderedFeatures(_point: unknown, options: { layers: string[] }) {
      return options.layers.includes("cities")
        ? runtime.cityId
          ? [{ properties: { placeId: runtime.cityId } }]
          : []
        : [{ properties: { ISO_A2_EH: "JP", NAME_EN: "Japan" } }];
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
  runtime.click = null;
});
it("handles selected and candidate city hits before the country underneath", async () => {
  const country = vi.fn(),
    city = vi.fn(),
    selected = {
      ...createSyntheticTripSnapshot().destinations[0],
      providerPlaceIds: { lookup: "selected" },
    };
  const candidate = {
    placeId: "selected",
    kind: "city" as const,
    name: "Tokyo",
    countryCode: "JP",
    timezone: "Asia/Tokyo",
    airportCode: null,
    location: { latitude: 35, longitude: 139 },
  };
  const view = render(
    <DestinationGlobe
      destinations={[selected]}
      candidates={[]}
      onCountry={country}
      onCity={city}
    />,
  );
  await waitFor(() => expect(runtime.click).toBeTruthy());
  // MapLibre supplies the event; the fake rendered feature gives the canonical ID.
  const click = () =>
    (runtime.click as unknown as (event: { point: { x: number; y: number } }) => void)({
      point: { x: 0, y: 0 },
    });
  act(click);
  expect(country).not.toHaveBeenCalled();
  expect(city).not.toHaveBeenCalled();
  view.rerender(
    <DestinationGlobe
      destinations={[selected]}
      candidates={[candidate]}
      onCountry={country}
      onCity={city}
    />,
  );
  act(click);
  expect(city).toHaveBeenCalledWith(candidate);
  expect(country).not.toHaveBeenCalled();
  runtime.cityId = null;
  act(click);
  expect(country).toHaveBeenCalledWith("JP", "Japan");
});
it("selects a city through its label and removes labels when the globe unmounts", async () => {
  const city = vi.fn();
  const candidate = {
    placeId: "tokyo",
    kind: "city" as const,
    name: "Tokyo",
    countryCode: "JP",
    timezone: "Asia/Tokyo",
    airportCode: null,
    location: { latitude: 35, longitude: 139 },
  };
  const view = render(
    <DestinationGlobe
      destinations={[]}
      candidates={[candidate]}
      onCountry={() => {}}
      onCity={city}
    />,
  );
  await waitFor(() => expect(view.container.querySelector("button.globe-city")).toBeTruthy());
  fireEvent.click(view.container.querySelector(".globe-city")!);
  expect(city).toHaveBeenCalledWith(candidate);
  view.unmount();
  expect(document.querySelector("button.globe-city")).toBeNull();
});
