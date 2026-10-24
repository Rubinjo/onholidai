import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import BookingPage from "../../app/trips/[tripId]/booking/page";
import { publicWholeTripReviewFixture } from "../fixtures/whole-trip-review";
import { ProblemError } from "../../server/errors";

const state = vi.hoisted(() => ({
  demo: false,
  actor: vi.fn(),
  trip: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: state.redirect }));
vi.mock("../../server/application", () => ({
  getApplication: () => ({
    config: {
      BETTER_AUTH_URL: "https://example.invalid",
      BOOKING_DEMO_ENABLED: state.demo,
    },
    database: {},
  }),
}));
vi.mock("../../server/api", () => ({ planningContext: async () => ({ identity: {} }) }));
vi.mock("../../server/auth/planning-resource", () => ({ resourceActor: state.actor }));
vi.mock("../../server/db/planning-access", () => ({
  lockPlanningAccess: async () => undefined,
  lockPlanningTrip: async () => undefined,
}));
vi.mock("../../server/db/transaction", () => ({
  inTransaction: async (_database: unknown, run: (transaction: unknown) => Promise<unknown>) =>
    run({}),
}));
vi.mock("../../domain/trip/read", () => ({ readTrip: state.trip }));
vi.mock("../../components/auth/booking-boundary", () => ({
  BookingBoundary: () => <p>Real booking sign-in boundary</p>,
}));
beforeEach(() => {
  state.demo = false;
  state.trip.mockResolvedValue(publicWholeTripReviewFixture().trip);
  state.actor.mockResolvedValue({ kind: "guest", planningOwnerId: "synthetic-owner" });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("keeps the real guest sign-in boundary when demo is disabled", async () => {
  const { trip } = publicWholeTripReviewFixture();
  render(await BookingPage({ params: Promise.resolve({ tripId: trip.tripId }) }));
  expect(screen.getByText("Real booking sign-in boundary")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Booking demo" })).not.toBeInTheDocument();
});

it("allows an authorized guest to preview booking without linking an account", async () => {
  state.demo = true;
  const { trip } = publicWholeTripReviewFixture();
  render(await BookingPage({ params: Promise.resolve({ tripId: trip.tripId }) }));
  expect(screen.getByRole("heading", { name: "Booking demo" })).toBeVisible();
  expect(screen.queryByText("Real booking sign-in boundary")).not.toBeInTheDocument();
  expect(state.actor).toHaveBeenCalled();
});

it.each([false, true])("does not bypass trip ownership when demo is %s", async (enabled) => {
  state.demo = enabled;
  state.actor.mockRejectedValue(
    new ProblemError({
      status: 404,
      code: "trip-not-found",
      title: "Trip unavailable",
      detail: "Trip not found.",
    }),
  );
  const { trip } = publicWholeTripReviewFixture();
  render(await BookingPage({ params: Promise.resolve({ tripId: trip.tripId }) }));
  expect(screen.getByRole("heading", { name: "Private plan unavailable" })).toBeVisible();
  expect(state.trip).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Book this trip" })).not.toBeInTheDocument();
});

it("does not turn demo opt-in into access to a cancelled trip", async () => {
  state.demo = true;
  const { trip } = publicWholeTripReviewFixture();
  state.trip.mockResolvedValue({ ...trip, lifecycleState: "cancelled" });
  state.redirect.mockImplementation(() => {
    throw new Error("Synthetic redirect");
  });
  await expect(BookingPage({ params: Promise.resolve({ tripId: trip.tripId }) })).rejects.toThrow(
    "Synthetic redirect",
  );
  expect(state.redirect).toHaveBeenCalledWith(`/trips/${trip.tripId}`);
});
