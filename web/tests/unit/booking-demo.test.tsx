import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { BookingReview } from "../../components/booking/booking-review";
import { publicWholeTripReviewFixture } from "../fixtures/whole-trip-review";

const api = vi.hoisted(() => ({ json: vi.fn() }));
vi.mock("../../components/trip-setup/http", async (original) => ({
  ...(await original<typeof import("../../components/trip-setup/http")>()),
  planningJson: api.json,
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it.each(["draft", "finalized"])(
  "simulates a %s trip entirely in the browser without mounting live booking effects",
  async (lifecycleState) => {
    vi.useFakeTimers();
    const fetch = vi.fn();
    const stream = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("EventSource", stream);
    const { trip } = publicWholeTripReviewFixture();
    trip.lifecycleState = lifecycleState;
    const original = structuredClone(trip);
    render(<BookingReview initialTrip={trip} demoMode />);
    expect(screen.getByRole("heading", { name: "Booking demo" })).toBeVisible();
    expect(screen.getByText(/No reservations or payments will be made/)).toBeVisible();
    expect(screen.getByText("Illustrative total")).toBeVisible();
    const book = screen.getByRole("button", { name: "Book this trip" });
    expect(book).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I understand this is a demo/ }));
    fireEvent.click(book);
    expect(screen.getByRole("status")).toHaveTextContent("Preparing your demo confirmation");
    expect(screen.queryByRole("button", { name: "Book this trip" })).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(2_000));
    const complete = screen.getByRole("heading", { name: "Demo booking complete" });
    expect(complete).toHaveFocus();
    expect(screen.getByText(/No real reservation was made/)).toBeVisible();
    expect(screen.getByText(/Your saved trip is unchanged/)).toBeVisible();
    expect(screen.getByText(/^DEMO-/)).toBeVisible();
    expect(api.json).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(trip).toEqual(original);
  },
);

it("resets the local preview without persisting confirmation or consent", async () => {
  vi.useFakeTimers();
  const { trip } = publicWholeTripReviewFixture();
  const view = render(<BookingReview initialTrip={trip} demoMode />);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Book this trip" }));
  await act(async () => vi.advanceTimersByTime(2_000));
  fireEvent.click(screen.getByRole("button", { name: "Preview again" }));
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Book this trip" })).toBeDisabled();
  expect(screen.getByRole("heading", { name: "Review booking" })).toHaveFocus();
  view.unmount();
  render(<BookingReview initialTrip={trip} demoMode />);
  expect(screen.queryByRole("heading", { name: "Demo booking complete" })).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(api.json).not.toHaveBeenCalled();
});

it("cleans up simulated processing when the page is left", () => {
  vi.useFakeTimers();
  const { trip } = publicWholeTripReviewFixture();
  const view = render(<BookingReview initialTrip={trip} demoMode />);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Book this trip" }));
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  expect(api.json).not.toHaveBeenCalled();
});

it("resets the simulation when the trip identity or version changes", () => {
  vi.useFakeTimers();
  const { trip } = publicWholeTripReviewFixture();
  const view = render(<BookingReview initialTrip={trip} demoMode />);
  fireEvent.click(screen.getByRole("checkbox"));
  const book = screen.getByRole("button", { name: "Book this trip" });
  fireEvent.click(book);
  fireEvent.click(book);
  view.rerender(<BookingReview initialTrip={{ ...trip, version: trip.version + 1 }} demoMode />);
  act(() => vi.advanceTimersByTime(2_000));
  expect(screen.queryByRole("heading", { name: "Demo booking complete" })).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Book this trip" })).toBeDisabled();
  expect(api.json).not.toHaveBeenCalled();
});

it("repeated clicks produce only one local confirmation and cannot submit a real booking", async () => {
  vi.useFakeTimers();
  const { trip } = publicWholeTripReviewFixture();
  render(<BookingReview initialTrip={trip} demoMode />);
  fireEvent.click(screen.getByRole("checkbox"));
  const book = screen.getByRole("button", { name: "Book this trip" });
  fireEvent.click(book);
  fireEvent.click(book);
  await act(async () => vi.advanceTimersByTime(5_000));
  expect(screen.getAllByRole("heading", { name: "Demo booking complete" })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Book this trip" })).not.toBeInTheDocument();
  expect(api.json).not.toHaveBeenCalled();
});

it("supports an itinerary-only preview without fabricating supplier services", async () => {
  vi.useFakeTimers();
  const { trip } = publicWholeTripReviewFixture();
  trip.snapshot.components = [];
  render(<BookingReview initialTrip={trip} demoMode />);
  expect(screen.getByText(/No supplier services have been selected/)).toBeVisible();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Book this trip" }));
  await act(async () => vi.advanceTimersByTime(2_000));
  expect(screen.getByRole("heading", { name: "Demo booking complete" })).toBeVisible();
  expect(api.json).not.toHaveBeenCalled();
});

it("does not offer a booking preview for an empty trip", () => {
  const { trip } = publicWholeTripReviewFixture();
  trip.snapshot.destinations = [];
  trip.snapshot.components = [];
  render(<BookingReview initialTrip={trip} demoMode />);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("button", { name: "Book this trip" })).toBeDisabled();
  expect(screen.getByText(/Add a destination/)).toBeVisible();
  expect(api.json).not.toHaveBeenCalled();
});
