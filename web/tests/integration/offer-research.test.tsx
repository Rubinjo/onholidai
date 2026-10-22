import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OfferResearch } from "../../components/trip-workspace/offer-research";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import supplyCases from "../../../contracts/supply/validation-cases.json";
import { publicPlanningOfferSchema } from "../../server/supply/offers";

const http = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../components/trip-setup/http", () => ({
  planningJson: http.request,
  planningError: () => "Research unavailable. Your saved trip is unchanged.",
}));
afterEach(() => {
  cleanup();
  http.request.mockReset();
});
const trip = () => ({
  tripId: "10000000-0000-4000-8000-000000000090",
  version: 1,
  lifecycleState: "draft",
  updatedAt: "2030-01-01T00:00:00Z",
  snapshot: projectCustomerSnapshot(createSyntheticTripSnapshot()),
});
describe("read-only workspace research", () => {
  it("starts an ordinary read-only run and distinguishes unsupported rail from no matches", async () => {
    http.request.mockImplementation(async (path: string, body?: unknown) => {
      if (path.endsWith("/agent-runs")) {
        expect(body).toMatchObject({ purpose: "supplier_research", baseTripVersion: 1 });
        return { id: "10000000-0000-4000-8000-000000000080", status: "completed" };
      }
      return {
        offers: [],
        tripVersion: 1,
        outcomes: [
          {
            provider: null,
            componentType: "rail",
            status: "unsupported",
            safeReason: "Rail inventory is deferred.",
          },
          {
            provider: "duffel",
            componentType: "flight",
            status: "no_matches",
            safeReason: "No matching flights.",
          },
        ],
      };
    });
    render(<OfferResearch trip={trip()} />);
    fireEvent.click(screen.getByRole("button", { name: "Find supplier options" }));
    await waitFor(() =>
      expect(http.request.mock.calls.some(([path]) => String(path).endsWith("/agent-runs"))).toBe(
        true,
      ),
    );
    expect(await screen.findByText(/Rail inventory is deferred/)).toBeTruthy();
    expect(screen.getByText(/No matching flights/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Book/ })).toBeNull();
  });
  it("preserves accepted state on errors and ignores late responses for a prior version", async () => {
    let finish: ((value: unknown) => void) | undefined;
    http.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const initial = trip();
    const view = render(<OfferResearch trip={initial} />);
    view.rerender(<OfferResearch trip={{ ...initial, version: 2 }} />);
    finish?.({
      offers: [],
      tripVersion: 1,
      outcomes: [
        { componentType: "rail", status: "unsupported", safeReason: "Old-version evidence" },
      ],
    });
    await waitFor(() => expect(screen.queryByText(/Old-version evidence/)).toBeNull());
    expect(initial.version).toBe(1);
    expect(initial.snapshot.components).toHaveLength(0);
  });
  it("inspects and revalidates revisions without accepting them or claiming unknown facts are confirmed", async () => {
    const offerRef = "10000000-0000-4000-8000-000000000070";
    const offer = publicPlanningOfferSchema.parse({
      ...supplyCases.offerCases[0].value,
      offerRef,
      revision: 1,
    });
    http.request.mockImplementation(async (path: string) => {
      if (path.includes("/revalidations"))
        return { outcome: "unknown", offer: { ...offer, revision: 2 } };
      if (path.includes(`/${offerRef}?`))
        return {
          outcome: "changed",
          offer: { ...offer, revision: 2 },
          differences: ["Supplier material facts changed."],
        };
      return { offers: [offer], outcomes: [], tripVersion: 1 };
    });
    const accepted = trip();
    render(<OfferResearch trip={accepted} />);
    fireEvent.click(await screen.findByRole("button", { name: "Inspect flight details" }));
    expect(await screen.findByText(/Source check: changed/)).toBeTruthy();
    expect(screen.getByText(/Customer total: \u00a3120\.00/)).toBeTruthy();
    expect(screen.getByText(/Supplier material facts changed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recheck flight availability" }));
    expect(await screen.findByText(/Source check: unknown/)).toBeTruthy();
    expect(http.request.mock.calls.at(-1)?.[1]).toEqual({ revision: 2 });
    expect(accepted.snapshot.components).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /book|accept|reserve/i })).toBeNull();
    expect(screen.getAllByText(/Demonstration only/).length).toBeGreaterThan(0);
  });

  it("reports supplier failures and rejects a response older than the selected revision", async () => {
    const offerRef = "10000000-0000-4000-8000-000000000071";
    const offer = publicPlanningOfferSchema.parse({
      ...supplyCases.offerCases[0].value,
      offerRef,
      revision: 2,
    });
    http.request.mockImplementation(async (path: string) =>
      path.includes("/revalidations")
        ? { outcome: "unchanged", offer: { ...offer, revision: 1 } }
        : { offers: [offer], outcomes: [], tripVersion: 1 },
    );
    render(<OfferResearch trip={trip()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Recheck flight availability" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/revision 2/)).toBeTruthy();
    expect(screen.queryByText(/Source check: unchanged/)).toBeNull();
    expect(screen.getByRole("button", { name: "Retry research" })).toBeTruthy();
  });
});
