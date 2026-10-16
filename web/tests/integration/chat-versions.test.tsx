import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { Conversation } from "../../components/agent/conversation";
import { PriceBar } from "../../components/trip-workspace/price-bar";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";

const api = vi.hoisted(() => ({ json: vi.fn() }));
vi.mock("../../components/trip-setup/http", async (original) => ({
  ...await original<typeof import("../../components/trip-setup/http")>(), planningJson: api.json,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const trip = { tripId: "10000000-0000-4000-8000-000000000090", version: 3, lifecycleState: "draft", updatedAt: "2030-01-01T00:00:00Z", snapshot: projectCustomerSnapshot(createSyntheticTripSnapshot()) };
it("restores the version identified in chat without Accept or a full trip preview", async () => {
  const committed = vi.fn();
  api.json.mockImplementation(async (path: string, command?: unknown) => {
    if (path.includes("/versions")) return { items: [{ version: 1, previousVersion: null, summary: ["Trip created."], createdAt: "2030-01-01T00:00:00Z", restorable: true, restoreReason: null, runId: null }], nextBeforeVersion: null };
    if (path.includes("/conversations")) return { items: [], nextCursor: null };
    if (path.endsWith("/commands/undo")) { expect(command).toMatchObject({ restoreVersion: 1, expectedVersion: 3 }); return { ...trip, version: 4 }; }
    return trip;
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Conversation trip={trip} initialRunId={null} onCommit={committed} /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Restore trip to version 1" }));
  await waitFor(() => expect(committed).toHaveBeenCalledWith(expect.objectContaining({ version: 4 })));
  expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();
  expect(screen.queryByText(trip.snapshot.destinations[0].name)).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent(/Restored version 1/);
});
it("offers Book trip for a draft as navigation, without authorizing booking", () => {
  render(<PriceBar trip={trip} />);
  expect(screen.getByRole("link", { name: "Book trip" })).toHaveAttribute("href", `/trips/${trip.tripId}/booking`);
  expect(api.json).not.toHaveBeenCalled();
});
it("loads older checkpoints and shows a committed summary only once", async () => {
  const runId = "10000000-0000-4000-8000-000000000091";
  api.json.mockImplementation(async (path: string) => {
    if (path.includes("/versions")) return path.includes("beforeVersion=2")
      ? { items: [{ version: 1, previousVersion: null, summary: ["Trip created."], createdAt: "2030-01-01T00:00:00Z", restorable: true, restoreReason: null, runId: null }], nextBeforeVersion: null }
      : { items: [{ version: 2, previousVersion: 1, summary: ["Travel style updated."], createdAt: "2030-01-02T00:00:00Z", restorable: true, restoreReason: null, runId }], nextBeforeVersion: 2 };
    return { items: [{ messages: [{ id: "10000000-0000-4000-8000-000000000092", role: "assistant", content: "Travel style updated.", tripVersion: 2, agentRunId: runId, createdAt: "2030-01-02T00:00:00Z" }] }] };
  });
  render(<QueryClientProvider client={new QueryClient()}><Conversation trip={trip} initialRunId={null} onCommit={vi.fn()} /></QueryClientProvider>);
  await screen.findByRole("button", { name: "Restore trip to version 2" });
  expect(screen.getAllByText("Travel style updated.")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Load earlier trip versions" }));
  await screen.findByRole("button", { name: "Restore trip to version 1" });
});
it("replays the same restore request after an uncertain network response", async () => {
  const commands: unknown[] = [];
  api.json.mockImplementation(async (path: string, command?: unknown) => {
    if (path.includes("/versions")) return { items: [{ version: 1, previousVersion: null, summary: ["Trip created."], createdAt: "2030-01-01T00:00:00Z", restorable: true, restoreReason: null, runId: null }], nextBeforeVersion: null };
    if (path.includes("/conversations")) return { items: [] };
    commands.push(command);
    if (commands.length === 1) throw new Error("Network unavailable");
    return { ...trip, version: 4 };
  });
  const committed = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}><Conversation trip={trip} initialRunId={null} onCommit={committed} /></QueryClientProvider>);
  const restore = await screen.findByRole("button", { name: "Restore trip to version 1" });
  fireEvent.click(restore);
  await waitFor(() => expect(restore).toBeEnabled());
  fireEvent.click(restore);
  await waitFor(() => expect(committed).toHaveBeenCalled());
  expect(commands).toHaveLength(2); expect(commands[0]).toEqual(commands[1]);
});
