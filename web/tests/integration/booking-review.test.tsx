import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { BookingReview } from "../../components/booking/booking-review";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";

const api = vi.hoisted(() => ({ json: vi.fn() }));
vi.mock("../../components/trip-setup/http", async (original) => ({
  ...(await original<typeof import("../../components/trip-setup/http")>()),
  planningJson: api.json,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const trip = {
  tripId: "10000000-0000-4000-8000-000000000090",
  version: 2,
  lifecycleState: "draft",
  updatedAt: "2030-01-01T00:00:00Z",
  snapshot: projectCustomerSnapshot(createSyntheticTripSnapshot()),
};
const report = {
  policyVersion: "1",
  blocking: [],
  unverified: [{ code: "timing", message: "Timing needs verification.", relatedIds: [] }],
  exceptions: [],
  suggestions: [],
  totalItems: 1,
  verifiedItems: 0,
};
it("does not change a draft on entry and requires actual acknowledgement before live review", async () => {
  api.json.mockImplementation(async (_path: string, command?: unknown) =>
    command
      ? { ...trip, version: 3, lifecycleState: "finalized" }
      : { version: 2, report, reviewFingerprint: "a".repeat(64) },
  );
  render(<BookingReview initialTrip={trip} />);
  const next = await screen.findByRole("button", { name: "Continue to live terms" });
  expect(next).toBeDisabled();
  expect(api.json.mock.calls.every((call) => call[1] === undefined)).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(next);
  await screen.findByRole("button", { name: "Revalidate availability and price" });
  expect(api.json).toHaveBeenCalledWith(
    expect.stringContaining("/commands/finalize"),
    expect.objectContaining({ expectedVersion: 2, acknowledgeUnverified: true }),
  );
  expect(
    api.json.mock.calls.some((call) => /authorizations|transactions|revalidations/.test(call[0])),
  ).toBe(false);
});
it("shows blocking conflicts and cannot proceed", async () => {
  api.json.mockResolvedValue({
    version: 2,
    report: {
      ...report,
      blocking: [{ code: "overlap", message: "Travel times overlap.", relatedIds: [] }],
    },
    reviewFingerprint: "a".repeat(64),
  });
  render(<BookingReview initialTrip={trip} />);
  await screen.findByText("Travel times overlap.");
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("button", { name: "Continue to live terms" })).toBeDisabled();
  await waitFor(() => expect(api.json).toHaveBeenCalledTimes(1));
});
