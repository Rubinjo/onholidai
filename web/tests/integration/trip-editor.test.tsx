import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TripEditor } from "../../components/trip-workspace/trip-editor";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

const api = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("../../components/trip-setup/http", () => ({
  planningJson: api.preview,
  planningError: () => "Safe failure",
}));
afterEach(() => {
  cleanup();
  api.preview.mockReset();
});

function envelope() {
  return {
    tripId: "10000000-0000-4000-8000-000000000090",
    version: 2,
    lifecycleState: "draft",
    updatedAt: "2030-01-01T00:00:00Z",
    snapshot: projectCustomerSnapshot(createSyntheticTripSnapshot()),
  };
}

const paceInput = () => screen.getByLabelText<HTMLInputElement>("Pace: relaxed to full days");

describe("trip editor impact review", () => {
  it("shows discard only for unsaved changes and restores saved values without a request", () => {
    render(<TripEditor trip={envelope()} onCommit={() => {}} />);
    expect(screen.queryByRole("button", { name: "Discard changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reload current trip details" })).toBeNull();
    const pace = paceInput();
    const savedValue = pace.value;
    fireEvent.change(pace, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(pace.value).toBe(savedValue);
    expect(screen.queryByRole("button", { name: "Discard changes" })).toBeNull();
    expect(api.preview).not.toHaveBeenCalled();
  });

  it("hides discard when a changed value is manually restored", () => {
    const trip = envelope();
    trip.snapshot.preferences.pace = 100;
    render(<TripEditor trip={trip} onCommit={() => {}} />);
    const pace = paceInput();
    const savedValue = pace.value;
    fireEvent.change(pace, { target: { value: "7" } });
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeTruthy();
    fireEvent.change(pace, { target: { value: savedValue } });
    expect(screen.queryByRole("button", { name: "Discard changes" })).toBeNull();
  });

  it("discards to the latest saved version after a background update", () => {
    const trip = envelope();
    const { rerender } = render(<TripEditor trip={trip} onCommit={() => {}} />);
    fireEvent.change(paceInput(), { target: { value: "7" } });
    const latest = {
      ...trip,
      version: 3,
      snapshot: { ...trip.snapshot, preferences: { ...trip.snapshot.preferences, pace: 100 } },
    };
    rerender(<TripEditor trip={latest} onCommit={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(paceInput().value).toBe("10");
    expect(screen.queryByRole("button", { name: "Discard changes" })).toBeNull();
    expect(screen.queryByText(/The trip changed while you were editing/)).toBeNull();
    expect(api.preview).not.toHaveBeenCalled();
  });

  it("updates a clean form on a newer saved version without showing discard", () => {
    const trip = envelope();
    const { rerender } = render(<TripEditor trip={trip} onCommit={() => {}} />);
    const latest = {
      ...trip,
      version: 3,
      snapshot: { ...trip.snapshot, preferences: { ...trip.snapshot.preferences, pace: 100 } },
    };
    rerender(<TripEditor trip={latest} onCommit={() => {}} />);
    expect(paceInput().value).toBe("10");
    expect(screen.queryByRole("button", { name: "Discard changes" })).toBeNull();
    expect(screen.queryByText(/The trip changed while you were editing/)).toBeNull();
  });

  it("hides apply for a clean form instead of sending an empty request", () => {
    render(<TripEditor trip={envelope()} onCommit={() => {}} />);
    expect(screen.queryByRole("button", { name: "Apply changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review edit impacts" })).toBeNull();
    expect(api.preview).not.toHaveBeenCalled();
  });

  it("immediately saves only changed settings without an impact preview", async () => {
    const trip = envelope();
    const saved = {
      ...trip,
      version: 3,
      snapshot: { ...trip.snapshot, preferences: { ...trip.snapshot.preferences, pace: 67 } },
    };
    api.preview.mockResolvedValue(saved);
    const onCommit = vi.fn();
    render(<TripEditor trip={trip} onCommit={onCommit} />);
    fireEvent.change(paceInput(), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith(saved));
    expect(api.preview).toHaveBeenCalledTimes(1);
    const [path, input] = api.preview.mock.calls[0] as [
      string,
      { operations: { target: string; value: unknown }[] },
    ];
    expect(path).toBe("/api/v1/trips/10000000-0000-4000-8000-000000000090/commands/edit");
    expect(input.operations).toHaveLength(1);
    expect(input.operations[0].target).toBe("/preferences");
    expect((input.operations[0].value as { pace: number }).pace).toBe(67);
    expect(input).not.toHaveProperty("impactFingerprint");
    expect(screen.queryByRole("button", { name: "Apply changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard changes" })).toBeNull();
  });

  it("preserves edits after a failed save and reuses the request when retried", async () => {
    api.preview.mockRejectedValue(new Error("Unavailable"));
    render(<TripEditor trip={envelope()} onCommit={() => {}} />);
    fireEvent.change(paceInput(), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    expect(await screen.findByText("Safe failure")).toBeTruthy();
    const original = api.preview.mock.calls[0][1];
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(2));
    expect(api.preview.mock.calls[1][1]).toEqual(original);
    expect(paceInput().value).toBe("7");
  });
});
