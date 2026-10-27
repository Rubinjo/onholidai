import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { Destinations } from "../../components/trip-setup/destinations";
import { DurationSlider } from "../../components/trip-setup/duration-slider";
import { PartyPreferences } from "../../components/trip-setup/party-preferences";
import { displayPreference, storedPreference } from "../../components/trip-setup/preference-scale";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { emptySetupDraft } from "../../components/trip-setup/draft-schema";

import type { TripSnapshot } from "../../domain/trip/schema";

const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../components/trip-setup/http", () => ({
  planningJson: api.read,
  planningError: () => "Search unavailable. Retry.",
}));
vi.mock("../../components/map/destination-picker", () => ({
  DestinationPicker: ({
    onCountry,
    candidates = [],
  }: {
    candidates?: { placeId: string; name: string }[];
    onCountry?: (code: string, name: string) => void;
  }) => (
    <>
      <button type="button" onClick={() => onCountry?.("JP", "Japan")}>
        Japan on globe
      </button>
      <span data-testid="map-candidates">{candidates.map((place) => place.name).join(", ")}</span>
    </>
  ),
}));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  api.read.mockReset();
  vi.unstubAllGlobals();
});
const japan = {
  placeId: "jp",
  kind: "country",
  name: "Japan",
  countryCode: "JP",
  timezone: "Asia/Tokyo",
  airportCode: null,
  location: null,
};
const tokyo = {
  ...japan,
  placeId: "tokyo",
  kind: "city",
  name: "Tokyo",
  location: { latitude: 35, longitude: 139 },
};
function Route() {
  const [destinations, setDestinations] = useState<TripSnapshot["destinations"]>([]),
    [order, setOrder] = useState<"manual" | "ai">("manual");
  const [origins, setOrigins] = useState<NonNullable<TripSnapshot["departureOrigins"]>>([]);
  return (
    <>
      <output data-testid="selected-origins">{JSON.stringify(origins)}</output>
      <Destinations
        globe
        origin={origins[0] ?? null}
        origins={origins}
        onOrigin={(origin) => setOrigins(origin ? [origin] : [])}
        onOrigins={setOrigins}
        destinations={destinations}
        onDestinations={setDestinations}
        order={order}
        onOrder={setOrder}
      />
    </>
  );
}
describe("observable planning controls", () => {
  it("explains both order modes in a single tooltip without changing the selected mode", async () => {
    render(<Route />);
    const manual = screen.getByRole("button", { name: "My order" });
    const ai = screen.getByRole("button", { name: "Let AI arrange" });
    expect(screen.getAllByRole("button", { name: /^About / })).toHaveLength(1);
    act(() => screen.getByRole("button", { name: "About destination order" }).focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "My order keeps destinations in the order you choose",
    );
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "most optimal route and best available pricing",
    );
    expect(manual).toHaveAttribute("aria-pressed", "true");
    expect(ai).toHaveAttribute("aria-pressed", "false");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });
  it("explains every travel style and leaves slider labels and preferences intact", async () => {
    const snapshot = createSyntheticTripSnapshot(),
      change = vi.fn();
    render(
      <PartyPreferences
        party={snapshot.travellerParty}
        preferences={snapshot.preferences}
        onParty={() => {}}
        onPreferences={change}
        mode="preferences"
      />,
    );
    for (const [key, label, explanation] of [
      ["pace", "Pace: relaxed to full days", "fewer activities"],
      ["spend", "Spend: budget to premium", "not a fixed budget"],
      ["discovery", "Discovery: familiar to adventurous", "local discoveries"],
      ["independence", "Independence: guided to self-directed", "guided tours"],
      ["setting", "Setting: nature to city", "natural landscapes"],
    ]) {
      expect(screen.getByRole("slider", { name: label })).toBeTruthy();
      act(() => screen.getByRole("button", { name: `About ${key}` }).focus());
      expect(await screen.findByRole("tooltip")).toHaveTextContent(explanation);
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    }
    expect(change).not.toHaveBeenCalled();
  });
  it("retains confirmed departure coordinates from the resolved place", async () => {
    const departure = {
      ...tokyo,
      kind: "airport" as const,
      placeId: "airport:tokyo",
      airportCode: "HND",
    };
    api.read.mockResolvedValue({ candidates: [departure] });
    render(<Route />);
    const search = screen.getByRole("combobox", { name: "Departure search" });
    fireEvent.change(search, { target: { value: "Tokyo" } });
    fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /Tokyo/ }));
    expect(JSON.parse(screen.getByTestId("selected-origins").textContent!)).toMatchObject([
      {
        placeId: "airport:tokyo",
        countryCode: "JP",
        timezone: "Asia/Tokyo",
        location: { latitude: 35, longitude: 139 },
      },
    ]);
  });
  it("selects a country directly and replaces it with a searched city; reset retains the mode", async () => {
    api.read.mockImplementation((path: string) =>
      Promise.resolve({ candidates: path.includes("kind=country") ? [japan] : [tokyo] }),
    );
    render(<Route />);
    fireEvent.click(screen.getByRole("button", { name: "Japan on globe" }));
    await screen.findByRole("button", { name: "Remove Japan" });
    const search = screen.getByRole("combobox", { name: "Destination search" });
    fireEvent.change(search, { target: { value: "Tokyo" } });
    fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /Tokyo/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove Tokyo" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Remove Japan" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Let AI arrange" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset destinations" }));
    expect(screen.getByRole("button", { name: "Let AI arrange" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByRole("button", { name: "Remove Tokyo" })).toBeNull();
    expect(
      screen
        .getAllByRole("status")
        .some((status) => status.textContent === "Destinations cleared."),
    ).toBe(true);
  });
  it("keeps a failed search usable and ignores an obsolete response", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.read
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockRejectedValue(new Error());
    render(<Route />);
    const search = screen.getByRole("combobox", { name: "Destination search" });
    fireEvent.change(search, { target: { value: "Japan" } });
    fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.change(search, { target: { value: "Tokyo" } });
    resolve({ candidates: [japan] });
    await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
    fireEvent.keyDown(search, { key: "Enter" });
    await screen.findByText("Search unavailable. Retry.");
  });
  it("keeps the three duration handles ordered when a boundary crosses another", () => {
    const onChange = vi.fn();
    render(
      <DurationSlider
        value={{ minimumDays: 5, idealDays: 7, maximumDays: 9 }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole("slider", { name: "Minimum days" }), {
      target: { value: "12" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ minimumDays: 12, idealDays: 12, maximumDays: 12 });
    expect(screen.getAllByRole("slider")).toHaveLength(3);
  });
  it("does not restore a removed city when a prior country lookup completes", async () => {
    const finish: ((value: unknown) => void)[] = [];
    api.read
      .mockResolvedValueOnce({ candidates: [tokyo] })
      .mockResolvedValueOnce({ destinationId: null })
      .mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
    render(<Route />);
    const search = screen.getByRole("combobox", { name: "Destination search" });
    fireEvent.change(search, { target: { value: "Tokyo" } });
    fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /Tokyo/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove Tokyo" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Japan on globe" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Tokyo" }));
    await act(async () => {
      for (const resolve of finish) resolve({ candidates: [japan] });
    });
    expect(screen.queryByRole("button", { name: "Remove Tokyo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove Japan" })).toBeNull();
  });
  it("does not restore globe candidates when a search completes after reset", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.read.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(<Route />);
    const search = screen.getByRole("combobox", { name: "Destination search" });
    fireEvent.change(search, { target: { value: "Tokyo" } });
    fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Reset destinations" }));
    await act(async () => resolve({ candidates: [tokyo] }));
    expect(screen.getByTestId("map-candidates")).toHaveTextContent("");
    expect(screen.queryByRole("option")).toBeNull();
  });
  it("displays a 1–10 scale and preserves every legacy preference on round trip", () => {
    const snapshot = createSyntheticTripSnapshot();
    const change = vi.fn();
    render(
      <PartyPreferences
        party={snapshot.travellerParty}
        preferences={snapshot.preferences}
        onParty={() => {}}
        onPreferences={change}
        mode="preferences"
      />,
    );
    for (const slider of screen.getAllByRole("slider")) {
      expect(slider).toHaveAttribute("min", "1");
      expect(slider).toHaveAttribute("max", "10");
    }
    expect(change).not.toHaveBeenCalled();
    for (const slider of screen.getAllByRole("slider")) expect(slider).toHaveAttribute("step", "1");
    for (let value = 1; value <= 10; value++)
      expect(displayPreference(storedPreference(value))).toBe(value);
    for (let value = 0; value <= 100; value++)
      expect(Number.isInteger(displayPreference(value))).toBe(true);
  });
  it("starts fresh sliders at five and edits only the chosen legacy preference", () => {
    const fresh = emptySetupDraft();
    expect(Object.values(fresh.preferences).map(displayPreference)).toEqual([5, 5, 5, 5, 5]);
    const snapshot = createSyntheticTripSnapshot(),
      change = vi.fn();
    const preferences = { pace: 53, spend: 11, discovery: 78, independence: 99, setting: 0 };
    const view = render(
      <PartyPreferences
        party={snapshot.travellerParty}
        preferences={preferences}
        onParty={() => {}}
        onPreferences={change}
        mode="preferences"
      />,
    );
    view.rerender(
      <PartyPreferences
        party={snapshot.travellerParty}
        preferences={preferences}
        onParty={() => {}}
        onPreferences={change}
        mode="preferences"
      />,
    );
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("slider", { name: /^Pace: relaxed to full days/ }), {
      target: { value: "7" },
    });
    expect(change).toHaveBeenCalledWith({ ...preferences, pace: storedPreference(7) });
    expect(preferences.pace).toBe(53);
  });
});
