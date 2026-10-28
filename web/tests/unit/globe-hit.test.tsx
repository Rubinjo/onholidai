import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";

import { DestinationGlobe } from "../../components/map/destination-globe";
import { Destinations } from "../../components/trip-setup/destinations";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

import type { PlaceCandidate } from "../../domain/trip/destination";
import type { TripSnapshot } from "../../domain/trip/schema";

const runtime = vi.hoisted(() => ({
  click: null as null | (() => void),
  cityId: "selected" as string | null,
  jumpTo: vi.fn(),
  countries: vi.fn(),
  read: vi.fn(),
}));
vi.mock("../../components/trip-setup/http", () => ({
  planningJson: runtime.read,
  planningError: () => "Search unavailable. Retry.",
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
    jumpTo = runtime.jumpTo;
    resize() {}
    remove() {}
    getSource() {
      return { setData() {}, getData: runtime.countries };
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
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  runtime.click = null;
  runtime.cityId = "selected";
  vi.resetAllMocks();
  vi.unstubAllGlobals();
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

const tokyo: PlaceCandidate = {
  placeId: "tokyo",
  kind: "city",
  name: "Tokyo",
  countryCode: "JP",
  timezone: "Asia/Tokyo",
  airportCode: null,
  location: { latitude: 35, longitude: 139 },
  providerPlaceIds: { "viator:destination": "334" },
};

function SearchableGlobe() {
  const [destinations, setDestinations] = useState<TripSnapshot["destinations"]>([]);
  return (
    <Destinations
      globe
      mode="destinations"
      origin={null}
      onOrigin={() => {}}
      destinations={destinations}
      onDestinations={setDestinations}
    />
  );
}

async function selectSearchResult(place: PlaceCandidate) {
  runtime.read.mockResolvedValue({ candidates: [place] });
  const search = screen.getByRole("combobox", { name: "Destination search" });
  fireEvent.change(search, { target: { value: place.name } });
  fireEvent.keyDown(search, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(place.name) }));
}

it("centers successful search selections and replacements, but not results or route edits", async () => {
  render(<SearchableGlobe />);
  await waitFor(() => expect(runtime.click).toBeTruthy());
  expect(runtime.jumpTo).not.toHaveBeenCalled();
  runtime.read.mockResolvedValue({ candidates: [tokyo] });
  const search = screen.getByRole("combobox", { name: "Destination search" });
  fireEvent.change(search, { target: { value: "Tokyo" } });
  fireEvent.keyDown(search, { key: "Enter" });
  const option = await screen.findByRole("option", { name: /Tokyo/ });
  expect(runtime.jumpTo).not.toHaveBeenCalled();
  fireEvent.click(option);
  await waitFor(() => expect(runtime.jumpTo).toHaveBeenCalledWith({ center: [139, 35] }));

  const kyoto = {
    ...tokyo,
    placeId: "kyoto",
    name: "Kyoto",
    location: { longitude: 135.7681, latitude: 35.0116 },
  };
  await selectSearchResult(kyoto);
  await waitFor(() =>
    expect(runtime.jumpTo).toHaveBeenLastCalledWith({ center: [135.7681, 35.0116] }),
  );
  expect(runtime.jumpTo).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Move Kyoto earlier" }));
  expect(runtime.jumpTo).toHaveBeenCalledTimes(2);
  await selectSearchResult(tokyo);
  expect(screen.getByRole("status")).toHaveTextContent("already on your route");
  expect(runtime.jumpTo).toHaveBeenCalledTimes(2);

  fireEvent.click(screen.getByRole("button", { name: "Replace Kyoto" }));
  await selectSearchResult({
    ...kyoto,
    placeId: "osaka",
    name: "Osaka",
    location: {
      longitude: 135.5023,
      latitude: 34.6937,
    },
  });
  await waitFor(() =>
    expect(runtime.jumpTo).toHaveBeenLastCalledWith({ center: [135.5023, 34.6937] }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove Osaka" }));
  fireEvent.click(screen.getByRole("button", { name: "Reset destinations" }));
  expect(runtime.jumpTo).toHaveBeenCalledTimes(3);
});

it("centers a search selection made before the globe loads", async () => {
  render(<DestinationGlobe destinations={[]} focusedPlace={tokyo} onCountry={() => {}} />);
  await waitFor(() => expect(runtime.jumpTo).toHaveBeenCalledWith({ center: [139, 35] }));
  expect(runtime.jumpTo).toHaveBeenCalledTimes(1);
});

it("centers coordinate-less countries using basemap labels without adding city markers", async () => {
  runtime.countries.mockResolvedValue({
    type: "FeatureCollection",
    features: [{ properties: { ISO_A2_EH: "JP", LABEL_X: 138, LABEL_Y: 37 } }],
  });
  const view = render(<SearchableGlobe />);
  await selectSearchResult({ ...tokyo, kind: "country", name: "Japan", location: null });
  await waitFor(() => expect(runtime.jumpTo).toHaveBeenCalledWith({ center: [138, 37] }));
  expect(view.container.querySelector(".globe-city")).toBeNull();
});

it("ignores an obsolete country camera target when a newer selection is made", async () => {
  let finish: (data: unknown) => void = () => {};
  runtime.countries.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(
    <DestinationGlobe
      destinations={[]}
      focusedPlace={{ ...tokyo, kind: "country", location: null }}
      onCountry={() => {}}
    />,
  );
  await waitFor(() => expect(runtime.countries).toHaveBeenCalled());
  view.rerender(<DestinationGlobe destinations={[]} focusedPlace={tokyo} onCountry={() => {}} />);
  expect(runtime.jumpTo).toHaveBeenCalledWith({ center: [139, 35] });
  await act(async () =>
    finish({
      type: "FeatureCollection",
      features: [{ properties: { ISO_A2_EH: "JP", LABEL_X: 138, LABEL_Y: 37 } }],
    }),
  );
  expect(runtime.jumpTo).toHaveBeenCalledTimes(1);
});
