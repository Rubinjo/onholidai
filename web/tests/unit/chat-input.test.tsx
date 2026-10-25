import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

import { Conversation } from "../../components/agent/conversation";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { PlanningRequestError } from "../../components/trip-setup/http";

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../components/trip-setup/http", async (original) => ({
  ...(await original<typeof import("../../components/trip-setup/http")>()),
  planningJson: api.request,
}));
afterEach(() => {
  cleanup();
  api.request.mockReset();
});
async function renderComposer(status = "completed", lifecycleState = "draft") {
  const trip = {
    tripId: crypto.randomUUID(),
    version: 1,
    lifecycleState,
    updatedAt: new Date().toISOString(),
    snapshot: projectCustomerSnapshot(createSyntheticTripSnapshot()),
  };
  const runId = crypto.randomUUID();
  api.request.mockImplementation((path: string, body?: unknown) => {
    if (path.endsWith("/conversations")) return Promise.resolve({ items: [] });
    if (path.includes("/agent-runs"))
      return Promise.resolve({
        id: runId,
        status: body ? "completed" : status,
        result: { kind: "answer", message: "Review your options." },
      });
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
    input: screen.getByRole("textbox", { name: "Ask your travel assistant" }),
    sends: () => api.request.mock.calls.filter(([, body]) => Boolean(body)),
  };
}
it("sends the composer message on Enter through the form", async () => {
  const { client, input, sends } = await renderComposer();
  fireEvent.change(input, { target: { value: "More time in Kyoto\nand Tokyo" } });
  expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
  await waitFor(() => expect(sends()).toHaveLength(1));
  expect(sends()[0][1]).toMatchObject({ message: "More time in Kyoto\nand Tokyo" });
  await waitFor(() => expect(input).toHaveValue(""));
  client.clear();
});
it.each([
  { name: "Shift+Enter", key: { shiftKey: true }, allowsDefault: true },
  { name: "IME composition", key: { isComposing: true }, allowsDefault: true },
  { name: "a held Enter key", key: { repeat: true }, allowsDefault: false },
])("does not send on $name", async ({ key, allowsDefault }) => {
  const { client, input, sends } = await renderComposer();
  fireEvent.change(input, { target: { value: "Keep this draft" } });
  expect(fireEvent.keyDown(input, { key: "Enter", ...key })).toBe(allowsDefault);
  expect(sends()).toHaveLength(0);
  expect(input).toHaveValue("Keep this draft");
  client.clear();
});
it.each([
  { status: "completed", lifecycle: "draft", message: "   " },
  { status: "running", lifecycle: "draft", message: "Wait for research" },
  { status: "queued", lifecycle: "draft", message: "Wait for research" },
  { status: "completed", lifecycle: "booked", message: "Already booked" },
])(
  "does not bypass disabled sending: $status / $lifecycle / '$message'",
  async ({ status, lifecycle, message }) => {
    const { client, input, sends } = await renderComposer(status, lifecycle);
    fireEvent.change(input, { target: { value: message } });
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.submit(input.closest("form")!);
    expect(sends()).toHaveLength(0);
    client.clear();
  },
);
it("preserves a new composer draft while an earlier message is being sent", async () => {
  const trip = {
    tripId: crypto.randomUUID(),
    version: 1,
    lifecycleState: "draft",
    updatedAt: new Date().toISOString(),
    snapshot: projectCustomerSnapshot(createSyntheticTripSnapshot()),
  };
  let finish: (value: unknown) => void = () => {};
  api.request.mockImplementation((path: string, body?: unknown) => {
    if (body)
      return new Promise((resolve) => {
        finish = resolve;
      });
    if (path.endsWith("/conversations")) return Promise.resolve({ items: [] });
    if (path.includes("/agent-runs/"))
      return Promise.resolve({
        id: path.split("/").at(-1),
        status: "completed",
        result: { kind: "answer", message: "Review your options." },
      });
    return Promise.resolve(trip);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <Conversation trip={trip} initialRunId={crypto.randomUUID()} onCommit={() => {}} />
    </QueryClientProvider>,
  );
  const input = screen.getByRole("textbox", { name: "Ask your travel assistant" });
  fireEvent.change(input, { target: { value: "First question" } });
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(api.request.mock.calls.some(([, body]) => Boolean(body))).toBe(true));
  fireEvent.change(input, { target: { value: "Next question" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(api.request.mock.calls.filter(([, body]) => Boolean(body))).toHaveLength(1);
  await act(async () =>
    finish({
      id: crypto.randomUUID(),
      status: "completed",
      result: { kind: "answer", message: "Review your options." },
    }),
  );
  expect(input).toHaveValue("Next question");
  expect(api.request.mock.calls.find(([, body]) => Boolean(body))?.[1]).toMatchObject({
    message: "First question",
  });
  client.clear();
});

it("sends the edited message after a rejected reservation instead of replaying the old one", async () => {
  const { client, input, sends } = await renderComposer();
  const original = api.request.getMockImplementation()!;
  api.request.mockImplementation((path: string, body?: unknown) =>
    body
      ? Promise.reject(new PlanningRequestError(429, "guest_research_limited"))
      : original(path, body),
  );
  fireEvent.change(input, { target: { value: "First question" } });
  fireEvent.submit(input.closest("form")!);
  await screen.findByText(/Research is temporarily limited/);
  api.request.mockImplementation(original);
  fireEvent.change(input, { target: { value: "A different question" } });
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(sends()).toHaveLength(2));
  expect(sends()[1][1]).toMatchObject({ message: "A different question" });
  expect(sends()[1][1].requestId).not.toBe(sends()[0][1].requestId);
  await waitFor(() => expect(input).toHaveValue(""));
  client.clear();
});

it("requires replay of an uncertain request before sending a different message", async () => {
  const { client, input, sends } = await renderComposer();
  const original = api.request.getMockImplementation()!;
  api.request.mockImplementation((path: string, body?: unknown) =>
    body
      ? Promise.reject(new PlanningRequestError(503, "agent_unavailable"))
      : original(path, body),
  );
  fireEvent.change(input, { target: { value: "First question" } });
  fireEvent.submit(input.closest("form")!);
  await screen.findByRole("button", { name: "Retry trip update" });
  fireEvent.change(input, { target: { value: "Next question" } });
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  api.request.mockImplementation(original);
  fireEvent.click(screen.getByRole("button", { name: "Retry trip update" }));
  await waitFor(() => expect(sends()).toHaveLength(2));
  expect(sends()[1][1]).toEqual(sends()[0][1]);
  await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled());
  expect(input).toHaveValue("Next question");
  client.clear();
});

it("honors Retry-After without discarding the chat draft", async () => {
  const { client, input, sends } = await renderComposer();
  const original = api.request.getMockImplementation()!;
  api.request.mockImplementation((path: string, body?: unknown) =>
    body
      ? Promise.reject(new PlanningRequestError(429, "guest_research_limited", 1))
      : original(path, body),
  );
  fireEvent.change(input, { target: { value: "Keep my question" } });
  fireEvent.submit(input.closest("form")!);
  await screen.findByText(/Research is temporarily limited/);
  expect(screen.getByRole("button", { name: /Retry trip update/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  fireEvent.submit(input.closest("form")!);
  expect(sends()).toHaveLength(1);
  await waitFor(
    () => expect(screen.getByRole("button", { name: "Retry trip update" })).toBeEnabled(),
    { timeout: 2000 },
  );
  expect(input).toHaveValue("Keep my question");
  client.clear();
});
