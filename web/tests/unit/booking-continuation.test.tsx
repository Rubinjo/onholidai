import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { BookingContinuation } from "../../components/auth/booking-continuation";
import { BookingStatus } from "../../components/booking/status";
import { BookingConsole } from "../../components/booking/booking-console";
import { publicWholeTripReviewFixture, reviewNow } from "../fixtures/whole-trip-review";

const state = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("../../components/trip-setup/http", async (original) => ({
  ...(await original<typeof import("../../components/trip-setup/http")>()),
  planningJson: state.request,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("records the explicit link and leaves subsequent navigation under the traveller's control", async () => {
  state.request.mockResolvedValue({ nextPath: "/trips/current/booking" });
  render(<BookingContinuation intentId={crypto.randomUUID()} returnPath="/trips/current" />);
  fireEvent.click(screen.getByRole("button", { name: "Link this trip and continue" }));
  await screen.findByRole("heading", { name: "Your trip is linked to your account" });
  expect(screen.getByRole("link", { name: "Review booking terms" })).toHaveAttribute(
    "href",
    "/trips/current/booking",
  );
  expect(state.refresh).not.toHaveBeenCalled();
  expect(state.request).toHaveBeenCalledTimes(1);
});

function recoveryStatus() {
  return {
    id: crypto.randomUUID(),
    tripId: crypto.randomUUID(),
    authorizationId: crypto.randomUUID(),
    operation: "book_trip",
    status: "action_required",
    executionStatus: "invalidated",
    tripVersion: 2,
    currentTripVersion: 3,
    termsHash: "a".repeat(64),
    termsVersion: 2,
    continuationOf: null,
    rootAttemptId: null,
    requestId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    components: [
      {
        componentId: crypto.randomUUID(),
        status: "confirmed",
        providerReference: "saved-stay",
        safeReason: null,
      },
      {
        componentId: crypto.randomUUID(),
        status: "unknown",
        providerReference: null,
        safeReason: "Supplier response timed out.",
      },
      {
        componentId: crypto.randomUUID(),
        status: "not_attempted",
        providerReference: null,
        safeReason: null,
      },
    ],
  };
}

it("distinguishes partial success, uncertainty and unattempted services without denying existing bookings", async () => {
  const status = recoveryStatus();
  state.request.mockImplementation((path: string) =>
    path.includes("/bookings/") ? Promise.resolve(status) : new Promise(() => undefined),
  );
  render(<BookingStatus bookingId={status.id} tripComponents={[]} allowComponentActions={false} />);
  await screen.findByText(/saved-stay/);
  expect(screen.queryByText(/No services were attempted/)).not.toBeInTheDocument();
  expect(screen.getByText(/Some services need attention/)).toBeVisible();
  expect(screen.getByText(/Outcome uncertain/)).toBeVisible();
  expect(screen.getByText(/Not attempted; no booking was sent/)).toBeVisible();
  expect(screen.getByText(/Quote booking attempt/)).toHaveTextContent(status.id);
  expect(
    screen.queryByRole("button", { name: /retry booking|book selected/i }),
  ).not.toBeInTheDocument();
});

it("retries a status read exactly once without restarting the booking", async () => {
  const status = recoveryStatus();
  state.request
    .mockRejectedValueOnce(new Error("temporary status failure"))
    .mockImplementation((path: string) =>
      path.includes("/bookings/") ? Promise.resolve(status) : new Promise(() => undefined),
    );
  render(<BookingStatus bookingId={status.id} tripComponents={[]} allowComponentActions={false} />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry status" }));
  await screen.findByText(/saved-stay/);
  expect(
    state.request.mock.calls.filter(([path]) => path === `/api/v1/bookings/${status.id}`),
  ).toHaveLength(2);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

function completeRecoveryReview() {
  const fixture = publicWholeTripReviewFixture();
  const committedId = fixture.booking.components[0].componentId;
  fixture.booking.components[0] = {
    componentId: committedId,
    status: "confirmed",
    providerReference: "saved-flight",
    safeReason: null,
  };
  fixture.booking.components[1].status = "failed";
  fixture.booking.status = "partially_confirmed";
  fixture.state.latestAttempt = fixture.booking;
  fixture.state.history = [fixture.booking];
  const review = fixture.state.review!;
  const terms = review.terms!;
  terms.continuationOf = fixture.booking.id;
  terms.rootAttemptId = fixture.booking.id;
  terms.components[0].disposition = "already_confirmed";
  terms.totalPrice.minorUnits = 30000;
  fixture.state.coverage.toBookComponentIds = fixture.state.coverage.toBookComponentIds.filter(
    (id) => id !== committedId,
  );
  fixture.state.coverage.confirmedComponentIds = [committedId];
  fixture.state.coverage.remainingPayable.minorUnits = 30000;
  for (const entry of fixture.state.coverage.entries) {
    if (entry.componentIds.includes(committedId)) entry.state = "confirmed";
  }
  terms.coverage = fixture.state.coverage;
  review.coverage = fixture.state.coverage;
  state.request.mockImplementation(async (path: string, body?: unknown) => {
    if (path.endsWith("/booking/revalidations")) {
      if (!body) throw new Error("Review requires an explicit request");
      fixture.state.review!.status = "accepted";
      return { workflowId: crypto.randomUUID(), status: "accepted" };
    }
    if (path === `/api/v1/bookings/${fixture.booking.id}`)
      return { ...fixture.booking, currentTripVersion: 2 };
    if (path === `/api/v1/trips/${fixture.trip.tripId}`) return fixture.trip;
    return fixture.state;
  });
  vi.spyOn(Date, "now").mockReturnValue(reviewNow.getTime());
  return fixture;
}

it("restores the complete remaining review beside prior progress, without offering a component checkout", async () => {
  const fixture = completeRecoveryReview();
  render(
    <BookingConsole
      tripId={fixture.trip.tripId}
      tripVersion={2}
      components={fixture.trip.snapshot.components}
    />,
  );
  await screen.findByText(/saved-flight/);
  expect(screen.getByText("Remaining payable: £300.00")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Authorize and start whole-trip booking" }),
  ).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: /book selected|buy component|retry booking/i }),
  ).not.toBeInTheDocument();
  expect(state.request.mock.calls.every((call) => call[1] === undefined)).toBe(true);
});

it("requests one whole-trip recovery review without authorizing or retrying a service", async () => {
  const fixture = completeRecoveryReview();
  fixture.state.review!.terms!.continuationOf = null;
  fixture.state.review!.terms!.rootAttemptId = null;
  render(
    <BookingConsole
      tripId={fixture.trip.tripId}
      tripVersion={2}
      components={fixture.trip.snapshot.components}
    />,
  );
  const review = await screen.findByRole("button", { name: "Review remaining whole trip" });
  review.focus();
  expect(
    screen.queryByRole("button", { name: "Authorize and start whole-trip booking" }),
  ).not.toBeInTheDocument();
  fireEvent.click(review);
  await screen.findByText("Checking live price and availability…");
  const writes = state.request.mock.calls.filter((call) => call[1] !== undefined);
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toBe(`/api/v1/trips/${fixture.trip.tripId}/booking/revalidations`);
  expect(writes[0][1]).toEqual({ requestId: expect.any(String), expectedVersion: 2 });
});

it("withholds continuation and consent while a prior result is uncertain", async () => {
  const fixture = completeRecoveryReview();
  fixture.booking.components[1].status = "unknown";
  fixture.booking.status = "action_required";
  render(
    <BookingConsole
      tripId={fixture.trip.tripId}
      tripVersion={2}
      components={fixture.trip.snapshot.components}
    />,
  );
  await screen.findByText(/Outcome uncertain/);
  expect(
    screen.queryByRole("button", { name: "Review remaining whole trip" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Authorize and start whole-trip booking" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/Quote booking attempt/)).toHaveTextContent(fixture.booking.id);
  expect(state.request.mock.calls.every((call) => call[1] === undefined)).toBe(true);
});
