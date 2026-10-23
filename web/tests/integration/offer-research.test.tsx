import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("sends only an opaque selected reference to the existing proposal flow", async () => {
    const scenario = supplyCases.offerCases.find(
      (entry) => entry.id === "public-nuitee-multi-room-discovery",
    );
    if (!scenario) throw new Error("Nuitee fixture missing");
    const offer = publicPlanningOfferSchema.parse({
      ...scenario.value,
      offerRef: "10000000-0000-4000-8000-000000000072",
      revision: 2,
    });
    http.request.mockResolvedValue({ offers: [offer], outcomes: [], tripVersion: 1 });
    const select = vi.fn();
    const initial = trip();
    render(<OfferResearch trip={initial} onSelect={select} />);
    fireEvent.click(await screen.findByRole("button", { name: "Use accommodation in draft" }));
    expect(select).toHaveBeenCalledWith({ offerRef: offer.offerRef, revision: 2 });
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(initial.version).toBe(1);
    expect(screen.getByRole("status").textContent).toMatch(/chat|proposal/i);
  });
  it("labels mismatched-version research as stale without displaying it", async () => {
    http.request.mockResolvedValue({
      offers: [],
      tripVersion: 2,
      outcomes: [
        {
          componentType: "accommodation",
          status: "available",
          safeReason: "Wrong-version evidence",
        },
      ],
    });
    render(<OfferResearch trip={trip()} />);
    expect(await screen.findByText(/research is stale/i)).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/Wrong-version evidence/)).toBeNull();
  });

  it("cancels initial research and ignores its late result after a new same-version search", async () => {
    let finish!: (value: unknown) => void;
    let initialSignal: AbortSignal | undefined;
    let reads = 0;
    http.request.mockImplementation(
      (path: string, _body: unknown, _method: unknown, signal?: AbortSignal) => {
        if (path.endsWith("/agent-runs"))
          return Promise.resolve({
            id: "10000000-0000-4000-8000-000000000080",
            status: "completed",
          });
        if (++reads === 1) {
          initialSignal = signal;
          return new Promise((resolve) => {
            finish = resolve;
          });
        }
        return Promise.resolve({
          offers: [],
          tripVersion: 1,
          outcomes: [
            {
              componentType: "activity",
              status: "no_matches",
              safeReason: "Current search evidence",
            },
          ],
        });
      },
    );
    render(<OfferResearch trip={trip()} />);
    fireEvent.click(screen.getByRole("button", { name: "Find supplier options" }));
    expect(await screen.findByText(/Current search evidence/)).toBeTruthy();
    expect(initialSignal?.aborted).toBe(true);
    await act(async () =>
      finish({
        offers: [],
        tripVersion: 1,
        outcomes: [
          {
            componentType: "activity",
            status: "no_matches",
            safeReason: "Late superseded evidence",
          },
        ],
      }),
    );
    expect(screen.queryByText(/Late superseded evidence/)).toBeNull();
    expect(screen.getByText(/Current search evidence/)).toBeTruthy();
  });

  it("keeps Nuitee stay evidence separate from failed flights and unsupported final revalidation", async () => {
    const scenario = supplyCases.offerCases.find(
      (entry) => entry.id === "public-nuitee-multi-room-discovery",
    );
    if (!scenario) throw new Error("Nuitee shared offer fixture is missing");
    const offer = publicPlanningOfferSchema.parse({
      ...scenario.value,
      offerRef: "10000000-0000-4000-8000-000000000072",
      revision: 1,
    });
    const accepted = trip();
    const before = structuredClone(accepted);
    http.request.mockImplementation(async (path: string) =>
      path.includes("/revalidations")
        ? { outcome: "unsupported", offer, differences: [] }
        : {
            offers: [offer],
            outcomes: [
              {
                provider: "duffel",
                componentType: "flight",
                status: "access_blocked",
                safeReason: "Flight access is not verified.",
              },
            ],
            tripVersion: 1,
          },
    );
    render(<OfferResearch trip={accepted} />);
    expect(
      screen.getByText(/Flights from Duffel; stays from Nuitee; activities from Viator/),
    ).toBeTruthy();
    expect(await screen.findByText(/Flight access is not verified/)).toBeTruthy();
    expect(screen.getByText(/Customer total: \u00a3230\.40/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recheck accommodation availability" }));
    expect(await screen.findByText(/Source check: unsupported/)).toBeTruthy();
    expect(accepted).toEqual(before);
    expect(
      http.request.mock.calls.every(([path]) => String(path).includes("/planning-offers")),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: /book|accept|reserve/i })).toBeNull();
  });

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
    const pending: { finish: (value: unknown) => void; signal: AbortSignal | undefined }[] = [];
    http.request.mockImplementation(
      (_path: string, _body: unknown, _method: unknown, signal?: AbortSignal) =>
        new Promise((resolve) => {
          pending.push({ finish: resolve, signal });
        }),
    );
    const initial = trip();
    const view = render(<OfferResearch trip={initial} />);
    view.rerender(<OfferResearch trip={{ ...initial, version: 2 }} />);
    expect(pending[0].signal?.aborted).toBe(true);
    await act(async () => {
      pending[1].finish({ offers: [], tripVersion: 2, outcomes: [] });
      pending[0].finish({
        offers: [],
        tripVersion: 1,
        outcomes: [
          { componentType: "rail", status: "unsupported", safeReason: "Old-version evidence" },
        ],
      });
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
