import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { BookingReview } from "../../components/booking/booking-review";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { publicWholeTripReviewFixture, reviewNow } from "../fixtures/whole-trip-review";
import { BookingConsole } from "../../components/booking/booking-console";
import { AuthorizationForm } from "../../components/booking/authorization-form";

const api = vi.hoisted(() => ({ json: vi.fn() }));
vi.mock("../../components/trip-setup/http", async (original) => ({
  ...(await original<typeof import("../../components/trip-setup/http")>()),
  planningJson: api.json,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shows all services, providers, exact current prices and estimate changes without subset controls", async () => {
  const fixture = publicWholeTripReviewFixture();
  fixture.trip.snapshot.components[0].price.finalCustomerMinor -= 500;
  api.json.mockResolvedValue(fixture.state);
  render(<BookingReview initialTrip={fixture.trip} />);
  await screen.findByRole("heading", { name: "Live booking terms" });
  expect(screen.getAllByText(/duffel/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/nuitee/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/viator/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Changed from accepted estimate/)).toHaveTextContent(
    "£95.00 to current price £100.00",
  );
  expect(screen.getByText("Remaining payable: £400.00")).toBeVisible();
  expect(screen.getByText(/Selected room references/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Authorize and start whole-trip booking" }),
  ).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: /book selected|buy component/i }),
  ).not.toBeInTheDocument();
  expect(api.json.mock.calls.every((call) => call[1] === undefined)).toBe(true);
});

it("uses the current clock and repeated polling cannot renew an expired review", async () => {
  const fixture = publicWholeTripReviewFixture();
  let clock = reviewNow.getTime();
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  api.json.mockResolvedValue(fixture.state);
  render(
    <BookingConsole
      tripId={fixture.trip.tripId}
      tripVersion={2}
      components={fixture.trip.snapshot.components}
    />,
  );
  await screen.findByRole("button", { name: "Authorize and start whole-trip booking" });
  clock += 300_001;
  await screen.findByText(/These booking terms expired/, {}, { timeout: 3000 });
  expect(
    screen.queryByRole("button", { name: "Authorize and start whole-trip booking" }),
  ).not.toBeInTheDocument();
  await waitFor(() => expect(api.json.mock.calls.length).toBeGreaterThanOrEqual(2), {
    timeout: 3000,
  });
  expect(api.json.mock.calls.every((call) => call[1] === undefined)).toBe(true);
});

it("invalidates local consent when a committed trip event arrives", async () => {
  const fixture = publicWholeTripReviewFixture();
  class Stream extends EventTarget {
    static instance: Stream;
    constructor() {
      super();
      Stream.instance = this;
    }
    close() {}
  }
  vi.stubGlobal("EventSource", Stream);
  api.json.mockResolvedValue(fixture.state);
  render(
    <BookingConsole
      tripId={fixture.trip.tripId}
      tripVersion={2}
      components={fixture.trip.snapshot.components}
    />,
  );
  await screen.findByRole("button", { name: "Authorize and start whole-trip booking" });
  act(() =>
    Stream.instance.dispatchEvent(
      new MessageEvent("trip.version.committed", {
        data: JSON.stringify({ tripId: fixture.trip.tripId, version: 2, reloadRequired: true }),
      }),
    ),
  );
  expect(
    screen.getByRole("button", { name: "Authorize and start whole-trip booking" }),
  ).toBeEnabled();
  act(() =>
    Stream.instance.dispatchEvent(
      new MessageEvent("trip.version.committed", {
        data: JSON.stringify({ tripId: fixture.trip.tripId, version: 3, reloadRequired: true }),
      }),
    ),
  );
  expect(screen.getByText(/Your trip changed/)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Authorize and start whole-trip booking" }),
  ).not.toBeInTheDocument();
});

it("restores a durable attempt even when terms expired and never starts another on reload", async () => {
  const fixture = publicWholeTripReviewFixture();
  fixture.state.latestAttempt = fixture.booking;
  vi.spyOn(Date, "now").mockReturnValue(reviewNow.getTime() + 300_001);
  api.json.mockImplementation(async (path: string) =>
    path.endsWith(`/bookings/${fixture.booking.id}`)
      ? { ...fixture.booking, currentTripVersion: 2 }
      : path === `/api/v1/trips/${fixture.trip.tripId}`
        ? fixture.trip
        : fixture.state,
  );
  render(
    <BookingConsole
      tripId={fixture.trip.tripId}
      tripVersion={2}
      components={fixture.trip.snapshot.components}
    />,
  );
  await screen.findByText(/No services were attempted/);
  expect(screen.getByText(/These booking terms expired/)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Authorize and start whole-trip booking" }),
  ).not.toBeInTheDocument();
  expect(api.json.mock.calls.every((call) => call[1] === undefined)).toBe(true);
});

it("reuses authorization and start identity after an uncertain response", async () => {
  const fixture = publicWholeTripReviewFixture(),
    onStarted = vi.fn();
  let starts = 0;
  api.json.mockImplementation(async (path: string) => {
    if (path.endsWith("/authorizations")) return fixture.authorization;
    if (++starts === 1) throw new Error("Synthetic uncertain response");
    return fixture.booking;
  });
  render(
    <AuthorizationForm
      tripId={fixture.trip.tripId}
      tripVersion={2}
      terms={fixture.state.review!.terms!}
      termsHash={fixture.authorization.termsHash}
      expiresAt={fixture.authorization.expiresAt}
      onStarted={onStarted}
    />,
  );
  const submit = screen.getByRole("button", { name: "Authorize and start whole-trip booking" });
  fireEvent.click(submit);
  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveFocus();
  fireEvent.click(submit);
  await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
  const authorizations = api.json.mock.calls.filter((call) => call[0].endsWith("/authorizations"));
  const started = api.json.mock.calls.filter((call) => call[0].endsWith("/bookings"));
  expect(authorizations).toHaveLength(1);
  expect(started).toHaveLength(2);
  expect(started[0][1]).toEqual(started[1][1]);
  expect(authorizations[0][1]).toMatchObject({
    operation: "book_trip",
    componentId: null,
    acknowledgedNonReversibleActions: [],
  });
});

it("requires the exact non-reversible acknowledgement set and blocks expiry during submit", async () => {
  const fixture = publicWholeTripReviewFixture();
  let clock = reviewNow.getTime();
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const terms = fixture.state.review!.terms!;
  terms.nonReversibleActions = [terms.components[0].componentId];
  api.json.mockImplementation(async () => {
    clock += 300_001;
    return fixture.authorization;
  });
  render(
    <AuthorizationForm
      tripId={fixture.trip.tripId}
      tripVersion={2}
      terms={terms}
      termsHash={fixture.authorization.termsHash}
      expiresAt={fixture.authorization.expiresAt}
      onStarted={vi.fn()}
    />,
  );
  const submit = screen.getByRole("button", { name: "Authorize and start whole-trip booking" });
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(submit);
  await screen.findByRole("alert");
  expect(api.json).toHaveBeenCalledTimes(1);
  expect(api.json.mock.calls[0][1].acknowledgedNonReversibleActions).toEqual(
    terms.nonReversibleActions,
  );
});

it("cannot acknowledge failed or incomplete reviews into eligibility", async () => {
  const fixture = publicWholeTripReviewFixture();
  fixture.state.review!.status = "failed";
  fixture.state.coverage.eligible = false;
  fixture.state.coverage.issues.push({
    code: "booking_unknown",
    message: "Final room costs are unknown.",
    relatedIds: [],
  });
  api.json.mockResolvedValue(fixture.state);
  render(
    <BookingConsole
      tripId={fixture.trip.tripId}
      tripVersion={2}
      components={fixture.trip.snapshot.components}
    />,
  );
  await screen.findByText("Final room costs are unknown.");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Authorize and start whole-trip booking" }),
  ).not.toBeInTheDocument();
});
it("shows safe service-specific blockers when final terms cannot be established", async () => {
  const fixture = publicWholeTripReviewFixture();
  const stay = fixture.trip.snapshot.components.find(
    (component) => component.type === "accommodation",
  )!;
  fixture.state.review!.status = "failed";
  fixture.state.review!.terms = null;
  fixture.state.review!.outcomes = [
    {
      componentId: stay.id,
      outcome: "unknown",
      safeReason: "Nuitee final checkout terms and trusted payment readiness are unverified.",
    },
  ];
  fixture.state.coverage.eligible = false;
  api.json.mockResolvedValue(fixture.state);
  render(
    <BookingConsole
      tripId={fixture.trip.tripId}
      tripVersion={2}
      components={fixture.trip.snapshot.components}
    />,
  );
  const blockers = await screen.findByRole("region", { name: "Services needing verification" });
  expect(blockers).toHaveTextContent("nuitee");
  expect(blockers).toHaveTextContent(
    "Nuitee final checkout terms and trusted payment readiness are unverified.",
  );
  expect(
    screen.queryByRole("button", { name: "Authorize and start whole-trip booking" }),
  ).not.toBeInTheDocument();
});

it("focuses a revalidation submission error and does not clear it during background restoration", async () => {
  const fixture = publicWholeTripReviewFixture();
  api.json.mockImplementation(async (_path: string, command?: unknown) => {
    if (command) throw new Error("Final terms could not be requested. Retry safely.");
    return fixture.state;
  });
  render(
    <BookingConsole
      tripId={fixture.trip.tripId}
      tripVersion={2}
      components={fixture.trip.snapshot.components}
    />,
  );
  const revalidate = await screen.findByRole("button", {
    name: "Revalidate availability and price",
  });
  await waitFor(() => expect(revalidate).toBeEnabled());
  fireEvent.click(revalidate);
  const error = await screen.findByRole("alert");
  expect(error).toHaveTextContent("Unable to complete the request.");
  expect(error).toHaveFocus();
  revalidate.focus();
  await waitFor(() => expect(api.json.mock.calls.length).toBeGreaterThanOrEqual(3), {
    timeout: 3000,
  });
  expect(error).toBeVisible();
  expect(revalidate).toHaveFocus();
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

it("shows the complete accepted route and party, including missing booking requirements", async () => {
  api.json.mockResolvedValue({
    version: 2,
    report: {
      ...report,
      blocking: [
        { code: "missing_components", message: "Prepare required components.", relatedIds: [] },
      ],
    },
    reviewFingerprint: "a".repeat(64),
  });
  render(<BookingReview initialTrip={trip} />);
  expect(await screen.findByRole("heading", { name: "Your whole trip" })).toBeInTheDocument();
  expect(screen.getByText(/Synthetic London Airport/)).toBeInTheDocument();
  expect(screen.getByText(/Lisbon/)).toBeInTheDocument();
  expect(screen.getByText(/2 adults/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /book selected|buy component/i }),
  ).not.toBeInTheDocument();
  expect(api.json.mock.calls.some((call) => call[1] !== undefined)).toBe(false);
});
