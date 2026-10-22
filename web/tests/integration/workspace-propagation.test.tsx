import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Workspace } from "../../components/trip-workspace/workspace";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../components/trip-setup/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../components/trip-setup/http")>()),
  planningJson: api.read,
  planningError: () => "Safe conflict",
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("committed workspace convergence", () => {
  it("updates every pane within two seconds through polling when events/maps are unavailable, and ignores an older read", async () => {
    class NoEvents {
      addEventListener() {}
      close() {}
    }
    vi.stubGlobal("EventSource", NoEvents);
    const initial = {
      tripId: "10000000-0000-4000-8000-000000000090",
      version: 1,
      lifecycleState: "draft",
      updatedAt: "2030-01-01T00:00:00Z",
      snapshot: projectCustomerSnapshot(createSyntheticTripSnapshot()),
    };
    const childId = "10000000-0000-4000-8000-000000000099";
    initial.snapshot.travellerParty.children = [{ id: childId, ageAtTripStart: 12 }];
    let latest = initial;
    api.read.mockImplementation((path: string) => {
      if (path.includes("/versions"))
        return Promise.resolve({ items: [], nextBeforeVersion: null });
      if (path.includes("/conversations")) return Promise.resolve({ items: [], nextCursor: null });
      return Promise.resolve(latest);
    });
    const view = render(<Workspace initialTrip={initial} initialRunId={null} />);
    await waitFor(() => expect(api.read).toHaveBeenCalled());
    const started = performance.now();
    latest = {
      ...initial,
      version: 2,
      snapshot: {
        ...initial.snapshot,
        travellerParty: { adults: 3, children: [{ id: childId, ageAtTripStart: 14 }] },
      },
    };
    await waitFor(
      () => {
        const versions = [...view.container.querySelectorAll("[data-trip-version]")].map(
          (element) => element.getAttribute("data-trip-version"),
        );
        expect(versions.length).toBeGreaterThanOrEqual(5);
        expect(new Set(versions)).toEqual(new Set(["2"]));
      },
      { timeout: 2000 },
    );
    expect(performance.now() - started).toBeLessThan(2000);
    expect(screen.getByLabelText("Adults", { exact: true })).toHaveValue(3);
    // A subsequent accepted version must not overwrite a traveller's dirty field.
    fireEvent.change(screen.getByLabelText("Adults", { exact: true }), { target: { value: "4" } });
    latest = { ...latest, version: 3 };
    await waitFor(
      () => expect(screen.getByText(/The trip changed while you were editing/)).toBeTruthy(),
      { timeout: 2000 },
    );
    expect(screen.getByLabelText("Adults", { exact: true })).toHaveValue(4);
    latest = initial;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(
      [...view.container.querySelectorAll("[data-trip-version]")].every(
        (element) => element.getAttribute("data-trip-version") === "3",
      ),
    ).toBe(true);
  });
});
