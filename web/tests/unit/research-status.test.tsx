import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

import { Conversation } from "../../components/agent/conversation";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../components/trip-setup/http", async (original) => ({
  ...(await original<typeof import("../../components/trip-setup/http")>()),
  planningJson: api.request,
}));
afterEach(() => {
  cleanup();
  api.request.mockReset();
});

const incompleteResearch = {
  outcomes: [
    {
      provider: "duffel",
      componentType: "flight",
      status: "available",
      mode: "live",
      safeReason: "Search returned planning offers; inventory is not reserved.",
      retryable: false,
      retryAfterMs: null,
      unverifiedCount: 3,
      reused: false,
    },
    {
      provider: "viator",
      componentType: "activity",
      status: "deadline",
      mode: "live",
      safeReason: "The search deadline elapsed before current inventory could be established.",
      retryable: true,
      retryAfterMs: null,
      unverifiedCount: 0,
      reused: false,
    },
  ],
  retryableComponentTypes: ["activity"],
  incomplete: true,
};

async function renderWithResearch(failure: { category: string; message: string } | null = null) {
  const trip = {
    tripId: crypto.randomUUID(),
    version: 1,
    lifecycleState: "draft",
    updatedAt: new Date().toISOString(),
    snapshot: projectCustomerSnapshot(createSyntheticTripSnapshot()),
  };
  const runId = crypto.randomUUID();
  api.request.mockImplementation((path: string, body?: unknown) => {
    if (path.endsWith("/conversations")) return Promise.resolve({ items: [] });
    if (path.includes("/agent-runs") && !body)
      return Promise.resolve({
        id: runId,
        status: failure ? "failed" : "completed",
        research: incompleteResearch,
        failure,
        result: failure ? null : { kind: "answer", message: "Supplier activity research failed." },
      });
    if (path.includes("/agent-runs"))
      return Promise.resolve({ id: runId, status: "queued", result: null });
    return Promise.resolve(trip);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <Conversation trip={trip} initialRunId={runId} onCommit={() => {}} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(client.isFetching()).toBe(0));
  return {
    client,
    sentBodies: () =>
      api.request.mock.calls
        .filter(([, body]) => Boolean(body))
        .map(([, body]) => body as Record<string, unknown>),
  };
}

it("explains every incomplete supplier product instead of a generic failure", async () => {
  const { client } = await renderWithResearch();
  expect(screen.getByRole("heading", { name: "Research status" })).toBeVisible();
  const region = screen.getByRole("region", { name: "Research status" });
  expect(region).toHaveTextContent("Activity");
  expect(region).toHaveTextContent("deadline");
  expect(region).not.toHaveTextContent("Flight");
  client.clear();
});

it("retries only the failed products and keeps the reviewed settings", async () => {
  const { client, sentBodies } = await renderWithResearch();
  fireEvent.click(screen.getByRole("button", { name: "Retry Activity research" }));
  await waitFor(() => expect(sentBodies()).toHaveLength(1));
  const [sent] = sentBodies();
  expect(sent.message).toContain("Estimate my reviewed settings and update my draft trip.");
  expect(sent.message).toContain("Retry supplier research for: activity.");
  expect(sent).toMatchObject({ purpose: "initial_estimate", baseTripVersion: 1 });
  client.clear();
});

it("shows the actionable failure reason for a failed run", async () => {
  const { client } = await renderWithResearch({
    category: "deadline",
    message:
      "Supplier research did not finish in time. Retry to refresh the steps that were still running; your reviewed settings and draft are unchanged.",
  });
  expect(screen.getByRole("status")).toHaveTextContent("did not finish in time");
  expect(screen.getByRole("button", { name: "Retry trip update" })).toBeVisible();
  client.clear();
});
