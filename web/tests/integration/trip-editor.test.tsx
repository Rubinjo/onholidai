import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TripEditor } from "../../components/trip-workspace/trip-editor";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

const api = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("../../components/trip-setup/http", () => ({ planningJson: api.preview, planningError: () => "Safe failure" }));
afterEach(() => { cleanup(); api.preview.mockReset(); });

function envelope() {
  return { tripId: "10000000-0000-4000-8000-000000000090", version: 2, lifecycleState: "draft",
    updatedAt: "2030-01-01T00:00:00Z", snapshot: projectCustomerSnapshot(createSyntheticTripSnapshot()) };
}

describe("trip editor impact review", () => {
  it("explains an unchanged draft instead of sending an empty review request", async () => {
    render(<TripEditor trip={envelope()} onCommit={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Review edit impacts" }));
    expect(await screen.findByText(/No settings have changed/)).toBeTruthy();
    await waitFor(() => expect(api.preview).not.toHaveBeenCalled());
  });

  it("reviews only the settings that changed", async () => {
    api.preview.mockResolvedValue({ impactFingerprint: "a".repeat(64), affectedFacts: ["preferences"], priceImpact: null, scheduleImpact: null, operations: [], warnings: [] });
    render(<TripEditor trip={envelope()} onCommit={() => {}} />);
    fireEvent.change(screen.getByLabelText("Pace", { exact: false }), { target: { value: "6.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Review edit impacts" }));
    await waitFor(() => expect(api.preview).toHaveBeenCalled());
    const [path, input] = api.preview.mock.calls[0] as [string, { operations: { target: string; value: unknown }[] }];
    expect(path).toBe("/api/v1/trips/10000000-0000-4000-8000-000000000090/commands/edit-preview");
    expect(input.operations).toHaveLength(1);
    expect(input.operations[0].target).toBe("/preferences");
    expect((input.operations[0].value as { pace: number }).pace).toBe(60);
  });
});
