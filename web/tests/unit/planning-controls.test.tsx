import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { Destinations } from "../../components/trip-setup/destinations";
import { DurationSlider } from "../../components/trip-setup/duration-slider";
import { PartyPreferences } from "../../components/trip-setup/party-preferences";
import { displayPreference, storedPreference } from "../../components/trip-setup/preference-scale";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import type { TripSnapshot } from "../../domain/trip/schema";
const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../components/trip-setup/http", () => ({ planningJson: api.read, planningError: () => "Search unavailable. Retry." }));
vi.mock("../../components/map/destination-picker", () => ({ DestinationPicker: ({ onCountry, candidates = [] }: { candidates?: { placeId: string; name: string }[]; onCountry?: (code: string, name: string) => void }) => <><button type="button" onClick={() => onCountry?.("JP", "Japan")}>Japan on globe</button><span data-testid="map-candidates">{candidates.map((place) => place.name).join(", ")}</span></> }));
afterEach(() => { cleanup(); api.read.mockReset(); });
const japan = { placeId: "jp", kind: "country", name: "Japan", countryCode: "JP", timezone: "Asia/Tokyo", airportCode: null, location: null };
const tokyo = { ...japan, placeId: "tokyo", kind: "city", name: "Tokyo", location: { latitude: 35, longitude: 139 } };
function Route() {
  const [destinations, setDestinations] = useState<TripSnapshot["destinations"]>([]), [order, setOrder] = useState<"manual" | "ai">("manual");
  const [origins, setOrigins] = useState<NonNullable<TripSnapshot["departureOrigins"]>>([]);
  return <><output data-testid="selected-origins">{JSON.stringify(origins)}</output><Destinations globe origin={origins[0] ?? null}
    origins={origins} onOrigin={(origin) => setOrigins(origin ? [origin] : [])} onOrigins={setOrigins}
    destinations={destinations} onDestinations={setDestinations} order={order} onOrder={setOrder} /></>;
}
describe("observable planning controls", () => {
  it("retains confirmed departure coordinates from the resolved place", async () => {
    const departure = { ...tokyo, kind: "airport" as const, placeId: "airport:tokyo", airportCode: "HND" };
    api.read.mockResolvedValue({ candidates: [departure] });
    render(<Route />);
    const search = screen.getByRole("combobox", { name: "Departure search" });
    fireEvent.change(search, { target: { value: "Tokyo" } }); fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /Tokyo/ }));
    expect(JSON.parse(screen.getByTestId("selected-origins").textContent!)).toMatchObject([
      { placeId: "airport:tokyo", countryCode: "JP", timezone: "Asia/Tokyo", location: { latitude: 35, longitude: 139 } },
    ]);
  });
  it("selects a country directly and replaces it with a searched city; reset retains the mode", async () => {
    api.read.mockImplementation((path: string) => Promise.resolve({ candidates: path.includes("kind=country") ? [japan] : [tokyo] }));
    render(<Route />);
    fireEvent.click(screen.getByRole("button", { name: "Japan on globe" }));
    await screen.findByRole("button", { name: "Remove Japan" });
    const search = screen.getByRole("combobox", { name: "Destination search" });
    fireEvent.change(search, { target: { value: "Tokyo" } }); fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /Tokyo/ }));
    expect(screen.queryByRole("button", { name: "Remove Japan" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Tokyo" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Let AI arrange" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset destinations" }));
    expect(screen.getByRole("button", { name: "Let AI arrange" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Remove Tokyo" })).toBeNull();
    expect(screen.getAllByRole("status").some((status) => status.textContent === "Destinations cleared.")).toBe(true);
  });
  it("keeps a failed search usable and ignores an obsolete response", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.read.mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockRejectedValue(new Error());
    render(<Route />); const search = screen.getByRole("combobox", { name: "Destination search" });
    fireEvent.change(search, { target: { value: "Japan" } }); fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.change(search, { target: { value: "Tokyo" } }); resolve({ candidates: [japan] });
    await waitFor(() => expect(screen.queryByRole("option")).toBeNull());
    fireEvent.keyDown(search, { key: "Enter" }); await screen.findByText("Search unavailable. Retry.");
  });
  it("keeps the three duration handles ordered when a boundary crosses another", () => {
    const onChange = vi.fn(); render(<DurationSlider value={{ minimumDays: 5, idealDays: 7, maximumDays: 9 }} onChange={onChange} />);
    fireEvent.change(screen.getByRole("slider", { name: "Minimum days" }), { target: { value: "12" } });
    expect(onChange).toHaveBeenLastCalledWith({ minimumDays: 12, idealDays: 12, maximumDays: 12 });
    expect(screen.getAllByRole("slider")).toHaveLength(3);
  });
  it("does not restore a removed city when a prior country lookup completes", async () => {
    const finish: ((value: unknown) => void)[] = [];
    api.read.mockResolvedValueOnce({ candidates: [tokyo] }).mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
    render(<Route />);
    const search = screen.getByRole("combobox", { name: "Destination search" });
    fireEvent.change(search, { target: { value: "Tokyo" } }); fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /Tokyo/ }));
    fireEvent.click(screen.getByRole("button", { name: "Japan on globe" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Tokyo" }));
    await act(async () => { for (const resolve of finish) resolve({ candidates: [japan] }); });
    expect(screen.queryByRole("button", { name: "Remove Tokyo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove Japan" })).toBeNull();
  });
  it("does not restore globe candidates when a search completes after reset", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.read.mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<Route />);
    const search = screen.getByRole("combobox", { name: "Destination search" });
    fireEvent.change(search, { target: { value: "Tokyo" } }); fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Reset destinations" }));
    await act(async () => resolve({ candidates: [tokyo] }));
    expect(screen.getByTestId("map-candidates")).toHaveTextContent("");
    expect(screen.queryByRole("option")).toBeNull();
  });
  it("displays a 1–10 scale and preserves every legacy preference on round trip", () => {
    const snapshot = createSyntheticTripSnapshot(); const change = vi.fn();
    render(<PartyPreferences party={snapshot.travellerParty} preferences={snapshot.preferences} onParty={() => {}} onPreferences={change} mode="preferences" />);
    for (const slider of screen.getAllByRole("slider")) { expect(slider).toHaveAttribute("min", "1"); expect(slider).toHaveAttribute("max", "10"); }
    expect(change).not.toHaveBeenCalled();
    for (let value = 0; value <= 100; value++) expect(storedPreference(displayPreference(value))).toBe(value);
  });
});
