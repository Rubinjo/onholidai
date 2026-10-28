import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { DayPlan } from "../../components/trip-workspace/day-plan";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

import type { CustomerSnapshot } from "../../domain/pricing/projections";

type Item = CustomerSnapshot["itineraryDays"][number]["items"][number];

afterEach(cleanup);

const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
const baseDay = snapshot.itineraryDays[0];

const baseItem: Item = {
  id: "10000000-0000-4000-8000-000000000010",
  type: "activity",
  start: "2030-05-02T10:00:00",
  end: "2030-05-02T12:00:00",
  location: { latitude: 38.7139, longitude: -9.1335 },
  componentId: null,
  constraintChecks: [],
  status: "planned",
  travelSegment: null,
};

function travel(id: string): Item {
  return {
    ...baseItem,
    id,
    type: "travel",
    start: "2030-05-02T06:00:00",
    end: "2030-05-02T11:35:00",
    title: "flight — accepted estimated component",
    travelSegment: {
      mode: "flight",
      origin: {
        placeId: "place-lhr",
        name: "London Heathrow",
        timezone: "Europe/London",
        location: null,
      },
      destination: {
        placeId: "place-lis",
        name: "Lisbon Airport",
        timezone: "Europe/Lisbon",
        location: null,
      },
      plannedDeparture: "2030-05-02T09:00:00+01:00",
      plannedArrival: "2030-05-02T11:35:00+01:00",
      durationMinutes: 155,
      durationUpperBoundMinutes: null,
      routeGeometry: null,
      directionsSummary: "Directions unavailable; verify terminals, route and travel from stay.",
      source: "duffel",
      freshnessAt: "2030-04-01T00:00:00Z",
      timingEvidence: [],
      verificationStatus: "unverified",
      feasibilityPolicyVersion: "1",
      international: true,
      departureGuidance: "Arrive 180 minutes before an international flight.",
    },
  };
}

it("shows each plan with its clock, stop and readable facts", () => {
  render(<DayPlan days={[baseDay]} destinations={snapshot.destinations} />);
  expect(screen.getByText("Lisbon")).toBeTruthy();
  expect(screen.getByText("08:00")).toBeTruthy();
  expect(screen.getByText("08:45")).toBeTruthy();
  expect(screen.getByRole("heading", { level: 4, name: "Meal" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 4, name: "Free time" })).toBeTruthy();
});

it("describes travel by its route and duration instead of internal titles", () => {
  render(<DayPlan days={[{ ...baseDay, items: [travel(baseItem.id)] }]} />);
  expect(
    screen.getByRole("heading", { level: 4, name: "London Heathrow → Lisbon Airport" }),
  ).toBeTruthy();
  expect(screen.getByText("Flight, 2 hr 35 min, departs 09:00, arrives 11:35")).toBeTruthy();
  expect(screen.getByText("Arrive 180 minutes before an international flight.")).toBeTruthy();
  expect(screen.queryByText(/accepted estimated component/)).toBeNull();
  expect(screen.queryByText(/verify terminals/)).toBeNull();
});

it("marks a flight that lands on a later local day", () => {
  const overnight = travel(baseItem.id);
  overnight.travelSegment = {
    ...overnight.travelSegment!,
    plannedDeparture: "2030-05-02T23:00:00+01:00",
    plannedArrival: "2030-05-03T08:30:00+09:00",
    durationMinutes: 570,
  };
  render(<DayPlan days={[{ ...baseDay, items: [overnight] }]} />);
  expect(screen.getByText("Flight, 9 hr 30 min, departs 23:00, arrives 08:30 (+1)")).toBeTruthy();
});

it("keeps internal evidence out of the traveller view", () => {
  const { container } = render(<DayPlan days={[baseDay]} destinations={snapshot.destinations} />);
  const text = container.textContent ?? "";
  expect(text).not.toContain("38.7139");
  expect(text).not.toContain("unverified");
  expect(text).not.toContain("component");
});

it("keeps supplier caveats available without crowding the schedule", () => {
  const note = "Verify opening times and local directions.";
  render(
    <DayPlan
      days={[
        {
          ...baseDay,
          items: [{ ...baseItem, practicalNotes: [note] }],
        },
      ]}
    />,
  );
  const disclosure = screen.getByText("Good to know").closest("details");
  expect(disclosure?.open).toBe(false);
  expect(within(disclosure as HTMLElement).getByText(note)).toBeTruthy();
});
