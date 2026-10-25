import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Workspace } from "../../components/trip-workspace/workspace";
import { Conversation } from "../../components/agent/conversation";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { useTrip } from "../../components/trip-workspace/use-trip";
import { useTripEvents } from "../../components/trip-workspace/use-trip-events";

const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../components/trip-setup/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../components/trip-setup/http")>()),
  planningJson: api.read,
  planningError: () => "Safe conflict",
}));
afterEach(() => {
  cleanup();
  api.read.mockReset();
  vi.unstubAllGlobals();
});

function initialTrip() {
  return {
    tripId: "10000000-0000-4000-8000-000000000090",
    version: 1,
    lifecycleState: "draft",
    updatedAt: "2030-01-01T00:00:00Z",
    snapshot: projectCustomerSnapshot(createSyntheticTripSnapshot()),
  };
}

describe("committed workspace convergence", () => {
  it("starts research once automatically and asks material questions in chat", async () => {
    const initial = initialTrip();
    const run = {
      id: "10000000-0000-4000-8000-000000000080",
      status: "awaiting_clarification",
      result: {
        kind: "clarification",
        clarification: {
          id: "10000000-0000-4000-8000-000000000083",
          question: "Which sourced room can accommodate the whole party?",
        },
      },
    };
    api.read.mockImplementation((path: string, body?: unknown) => {
      if (path.endsWith("/agent-runs") && body) return Promise.resolve(run);
      if (path.includes("/agent-runs/")) return Promise.resolve(run);
      if (path.includes("/versions") || path.includes("/conversations"))
        return Promise.resolve({ items: [], nextCursor: null, nextBeforeVersion: null });
      return Promise.resolve(initial);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onCommit = vi.fn();
    const requestId = "10000000-0000-4000-8000-000000000081";
    const view = render(
      <QueryClientProvider client={client}>
        <Conversation
          trip={initial}
          initialRunId={null}
          onCommit={onCommit}
          initialResearchRequestId={requestId}
        />
      </QueryClientProvider>,
    );
    await screen.findByText(run.result.clarification.question);
    const submissions = api.read.mock.calls.filter(
      ([path, body]) => path.endsWith("/agent-runs") && body,
    );
    expect(submissions).toHaveLength(1);
    expect(submissions[0][1]).toMatchObject({
      requestId,
      baseTripVersion: 1,
      purpose: "initial_estimate",
      applicationPolicy: "automatic",
    });
    expect(JSON.stringify(submissions[0][1])).not.toMatch(/supplierOfferId|finalCustomerMinor/);
    expect(onCommit).not.toHaveBeenCalled();
    expect(initial.version).toBe(1);
    expect(
      screen.queryByRole("button", { name: /Research estimate|Research route options/ }),
    ).toBeNull();
    view.rerender(
      <QueryClientProvider client={client}>
        <Conversation
          trip={{ ...initial, version: 2 }}
          initialRunId={null}
          initialResearchRequestId={requestId}
          onCommit={onCommit}
        />
      </QueryClientProvider>,
    );
    expect(
      api.read.mock.calls.filter(([path, body]) => path.endsWith("/agent-runs") && body),
    ).toHaveLength(1);
    view.unmount();
    client.clear();
  });

  it("retries an uncertain automatic submission with its original identity and base version", async () => {
    const initial = initialTrip();
    const commands: unknown[] = [];
    api.read.mockImplementation(async (path: string, body?: unknown) => {
      if (path.endsWith("/agent-runs") && body) {
        commands.push(body);
        if (commands.length === 1) throw new Error("Network unavailable");
        return { id: crypto.randomUUID(), status: "completed", result: { kind: "answer" } };
      }
      if (path.includes("/agent-runs/"))
        return { id: path.split("/").at(-1), status: "completed", result: { kind: "answer" } };
      if (path.includes("/versions") || path.includes("/conversations"))
        return { items: [], nextCursor: null, nextBeforeVersion: null };
      return { ...initial, version: commands.length ? 2 : 1 };
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <Conversation
          trip={initial}
          initialRunId={null}
          onCommit={vi.fn()}
          initialResearchRequestId={crypto.randomUUID()}
        />
      </QueryClientProvider>,
    );
    await screen.findByText("Safe conflict");
    fireEvent.click(screen.getByRole("button", { name: "Retry trip update" }));
    await waitFor(() => expect(commands).toHaveLength(2));
    expect(commands[0]).toEqual(commands[1]);
    expect(commands[1]).toMatchObject({ baseTripVersion: 1, applicationPolicy: "automatic" });
    view.unmount();
    client.clear();
  });

  it("automatically estimates an empty draft without a setup request", async () => {
    const initial = initialTrip();
    initial.snapshot.components = [];
    initial.snapshot.itineraryDays = [];
    api.read.mockImplementation(async (path: string, body?: unknown) => {
      if (path.endsWith("/agent-runs") && body)
        return { id: crypto.randomUUID(), status: "completed", result: { kind: "answer" } };
      if (path.includes("/agent-runs/"))
        return { id: path.split("/").at(-1), status: "completed", result: { kind: "answer" } };
      if (path.includes("/versions") || path.includes("/conversations"))
        return { items: [], nextCursor: null, nextBeforeVersion: null };
      return initial;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <Conversation trip={initial} initialRunId={null} onCommit={vi.fn()} />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(
        api.read.mock.calls.filter(([path, body]) => path.endsWith("/agent-runs") && body),
      ).toHaveLength(1),
    );
    expect(
      api.read.mock.calls.find(([path, body]) => path.endsWith("/agent-runs") && body)?.[1],
    ).toMatchObject({ purpose: "initial_estimate", applicationPolicy: "automatic" });
    view.unmount();
    client.clear();
  });

  it("uses a fresh identity after an acknowledged failed initial run", async () => {
    const initial = initialTrip();
    const requestId = crypto.randomUUID();
    const commands: unknown[] = [];
    api.read.mockImplementation(async (path: string, body?: unknown) => {
      if (path.endsWith("/agent-runs") && body) {
        commands.push(body);
        return { id: crypto.randomUUID(), status: "failed", result: null };
      }
      if (path.includes("/agent-runs/"))
        return { id: path.split("/").at(-1), status: "failed", result: null };
      if (path.includes("/versions") || path.includes("/conversations"))
        return { items: [], nextCursor: null, nextBeforeVersion: null };
      return initial;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <Conversation
          trip={initial}
          initialRunId={null}
          initialResearchRequestId={requestId}
          onCommit={vi.fn()}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Retry trip update" }));
    await waitFor(() => expect(commands).toHaveLength(2));
    expect(commands[0]).toMatchObject({ requestId });
    expect(commands[1]).not.toMatchObject({ requestId });
    view.unmount();
    client.clear();
  });

  it("resumes an existing run without starting duplicate research", async () => {
    const initial = initialTrip();
    initial.snapshot.components = [];
    initial.snapshot.itineraryDays = [];
    const runId = crypto.randomUUID();
    api.read.mockImplementation(async (path: string) => {
      if (path.includes("/agent-runs/"))
        return { id: runId, status: "completed", result: { kind: "answer" } };
      return { items: [], nextCursor: null, nextBeforeVersion: null };
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <Conversation
          trip={initial}
          initialRunId={runId}
          initialResearchRequestId={crypto.randomUUID()}
          onCommit={vi.fn()}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(api.read).toHaveBeenCalledWith(`/api/v1/agent-runs/${runId}`));
    expect(api.read.mock.calls.some(([path, body]) => path.endsWith("/agent-runs") && body)).toBe(
      false,
    );
    view.unmount();
    client.clear();
  });

  it.each(["existing plan", "restored version", "finalized trip"])(
    "does not automatically replace an %s",
    async (scenario) => {
      const initial = initialTrip();
      if (scenario !== "existing plan") initial.snapshot.itineraryDays = [];
      if (scenario === "restored version") initial.version = 2;
      if (scenario === "finalized trip") initial.lifecycleState = "finalized";
      api.read.mockResolvedValue({ items: [], nextCursor: null, nextBeforeVersion: null });
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const view = render(
        <QueryClientProvider client={client}>
          <Conversation trip={initial} initialRunId={null} onCommit={vi.fn()} />
        </QueryClientProvider>,
      );
      await waitFor(() => expect(api.read).toHaveBeenCalled());
      expect(api.read.mock.calls.some(([path, body]) => path.endsWith("/agent-runs") && body)).toBe(
        false,
      );
      view.unmount();
      client.clear();
    },
  );

  it("rejects another trip's response without replacing accepted cached state", async () => {
    const initial = initialTrip();
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } } });
    api.read.mockResolvedValue({
      ...initial,
      tripId: "10000000-0000-4000-8000-000000000091",
      version: 99,
    });
    const hook = renderHook(() => useTrip(initial), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(hook.result.current.error).toBeInstanceOf(Error));
    expect(hook.result.current.data).toEqual(initial);
    hook.unmount();
    client.clear();
  });

  it("aborts a pending trip read on unmount even if transport ignores cancellation", async () => {
    const initial = initialTrip();
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
    let signal: AbortSignal | undefined;
    let finish!: (value: unknown) => void;
    api.read.mockImplementation(
      (_path: string, _body: unknown, _method: unknown, cancellation?: AbortSignal) => {
        signal = cancellation;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    const hook = renderHook(() => useTrip(initial), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(api.read).toHaveBeenCalled());
    hook.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(initial));
    client.clear();
  });

  it("does not invalidate a trip from a queued event after unmount", () => {
    let committed!: () => void;
    const close = vi.fn();
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener(_name: string, listener: () => void) {
          committed = listener;
        }
        close = close;
      },
    );
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    const hook = renderHook(() => useTripEvents(initialTrip().tripId), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    hook.unmount();
    committed();
    expect(close).toHaveBeenCalledOnce();
    expect(invalidate).not.toHaveBeenCalled();
    client.clear();
  });

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
    expect(screen.queryByRole("region", { name: "Compare supplier options" })).toBeNull();
    expect(api.read.mock.calls.some(([path]) => path.includes("/planning-offers"))).toBe(false);
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
