import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { Conversation } from "../../components/agent/conversation";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../components/trip-setup/http", async (original) => ({ ...await original<typeof import("../../components/trip-setup/http")>(), planningJson: api.request }));
afterEach(() => { cleanup(); api.request.mockReset(); });
it("preserves a new composer draft while an earlier message is being sent", async () => {
  const trip = { tripId: crypto.randomUUID(), version: 1, lifecycleState: "draft", updatedAt: new Date().toISOString(), snapshot: projectCustomerSnapshot(createSyntheticTripSnapshot()) };
  let finish: (value: unknown) => void = () => {};
  api.request.mockImplementation((path: string, body?: unknown) => {
    if (body) return new Promise((resolve) => { finish = resolve; });
    if (path.endsWith("/conversations")) return Promise.resolve({ items: [] });
    if (path.includes("/agent-runs/")) return Promise.resolve({ id: path.split("/").at(-1), status: "completed", result: { kind: "answer", message: "Review your options." } });
    return Promise.resolve(trip);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><Conversation trip={trip} initialRunId={crypto.randomUUID()} onCommit={() => {}} /></QueryClientProvider>);
  const input = screen.getByRole("textbox", { name: "Ask your travel assistant" });
  fireEvent.change(input, { target: { value: "First question" } }); fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(api.request.mock.calls.some(([, body]) => Boolean(body))).toBe(true));
  fireEvent.change(input, { target: { value: "Next question" } });
  await act(async () => finish({ id: crypto.randomUUID(), status: "completed", result: { kind: "answer", message: "Review your options." } }));
  expect(input).toHaveValue("Next question");
  expect(api.request.mock.calls.find(([, body]) => Boolean(body))?.[1]).toMatchObject({ message: "First question" });
  client.clear();
});
