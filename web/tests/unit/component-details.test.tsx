import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { ComponentDetails } from "../../components/trip-workspace/component-details";
import {
  componentDate,
  componentDuration,
  componentMoney,
  type Component,
  type ComponentDestination,
} from "../../components/trip-workspace/component-facts";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

afterEach(cleanup);

const base = {
  id: "10000000-0000-4000-8000-000000000081",
  provider: "Example supplier",
  supplierOfferId: "internal-offer",
  itineraryItemIds: [],
  travellerIds: [],
  offerStatus: "available",
  serviceStart: "2030-05-01T08:00:00+01:00",
  serviceEnd: "2030-05-01T10:00:00+02:00",
  bookingRequirements: ["Bring a valid passport"],
  cancellationTerms: "Check cancellation fees before booking",
  checkedAt: "2030-01-01T12:00:00Z",
  expiresAt: null,
  bookingStatus: "unbooked",
  price: {
    currency: "GBP",
    finalCustomerMinor: 12850,
    taxesMinor: null,
    feesMinor: 0,
    status: "estimated",
    checkedAt: "2030-01-01T12:00:00Z",
  },
} as const;
const planning = {
  locationName: null,
  timezone: null,
  airportNames: [],
  airlines: [],
  flightDirection: null,
  durationMinutes: 120,
  layovers: [],
  fareConditions: null,
  accommodationType: null,
  travelFromStayMinutes: 0,
  eligibility: "unverified",
  accessibility: "failed",
  availability: "verified",
  constraintEvidence: [],
  source: "Example source",
  checkedAt: "2030-01-01T12:00:00Z",
  unavailableFacts: ["Final baggage allowance"],
} as const;

function flight(fareConditions: string | null): Component {
  return {
    ...base,
    itineraryItemIds: [],
    travellerIds: [],
    bookingRequirements: [...base.bookingRequirements],
    type: "flight",
    details: null,
    planningDetails: {
      ...planning,
      airportNames: [],
      airlines: [],
      layovers: [],
      constraintEvidence: [],
      unavailableFacts: [...planning.unavailableFacts],
      fareConditions,
    },
  };
}

describe("traveler-friendly component details", () => {
  it("keeps every slice and connecting airport in the flight route", () => {
    const connecting = flight(
      JSON.stringify({
        originAirportCode: "AMS",
        destinationAirportCode: "AMS",
        route: [
          { origin: "AMS", destination: "HND", airports: ["AMS", "FRA", "HND"] },
          { origin: "HND", destination: "AMS", airports: ["HND", "AMS"] },
        ],
      }),
    );
    const { unmount } = render(<ComponentDetails components={[connecting]} version={1} />);
    const card = screen.getByRole("article", { name: "Flight: AMS → FRA → HND → AMS" });
    expect(within(card).getByRole("heading", { name: "AMS → FRA → HND → AMS" })).toBeVisible();
    unmount();
    const legacySlices = flight(
      JSON.stringify({
        originAirportCode: "AMS",
        destinationAirportCode: "AMS",
        route: [
          { origin: "AMS", destination: "HND" },
          { origin: "HND", destination: "AMS" },
        ],
      }),
    );
    render(<ComponentDetails components={[legacySlices]} version={1} />);
    expect(
      within(screen.getByRole("article", { name: "Flight: AMS → HND → AMS" })).getByRole(
        "heading",
        { name: "AMS → HND → AMS" },
      ),
    ).toBeVisible();
  });

  it("lists both flown journeys instead of only the departure flight", () => {
    const roundTrip: Component = {
      ...flight(null),
      serviceStart: "2026-10-31T23:00:00Z",
      serviceEnd: "2026-11-07T08:30:00Z",
      planningDetails: {
        ...flight(null).planningDetails!,
        flightDirection: "return",
        durationMinutes: null,
        flightJourneys: [
          {
            direction: "outbound",
            origin: "LHR",
            destination: "HND",
            originTimezone: "Europe/London",
            destinationTimezone: "Asia/Tokyo",
            departingAt: "2026-10-31T23:00:00Z",
            arrivingAt: "2026-11-01T08:30:00Z",
            legs: ["LHR → HND"],
          },
          {
            direction: "return",
            origin: "HND",
            destination: "LHR",
            originTimezone: "Asia/Tokyo",
            destinationTimezone: "Europe/London",
            departingAt: "2026-11-07T00:00:00Z",
            arrivingAt: "2026-11-07T08:30:00Z",
            legs: ["HND → LHR"],
          },
        ],
      },
    };
    render(<ComponentDetails components={[roundTrip]} version={1} />);
    const card = screen.getByRole("article", { name: /^Flight:/ });
    expect(within(card).getByRole("heading", { name: "Outbound flight" })).toBeVisible();
    expect(within(card).getByRole("heading", { name: "Return flight" })).toBeVisible();
    expect(within(card).getByText("31 Oct 2026, 23:00")).toBeVisible();
    expect(within(card).getByText("1 Nov 2026, 17:30")).toBeVisible();
    expect(within(card).getByText("9 hr 30 min")).toBeVisible();
    expect(within(card).getByText("8 hr 30 min")).toBeVisible();
    expect(within(card).getByText("First flight departs")).toBeVisible();
    expect(within(card).getByText("Last flight arrives")).toBeVisible();
  });

  it("shows the stay address or the sourced city and country", () => {
    const source = flight(
      JSON.stringify({
        address: "1-1 Chiyoda",
        city: "Tokyo",
        country: "Japan",
        roomFacts: [{ roomName: "Twin room" }],
      }),
    );
    const stay: Component = {
      ...source,
      id: "stay-with-location",
      type: "accommodation",
      details: { occupancy: "2 adults", amenities: [] },
      planningDetails: { ...source.planningDetails!, locationName: "Palace Hotel" },
    };
    render(<ComponentDetails components={[stay]} version={1} />);
    const card = screen.getByRole("article", { name: "Stay: Palace Hotel" });
    expect(within(card).getByText("Location")).toBeVisible();
    expect(within(card).getByText("1-1 Chiyoda, Tokyo, Japan")).toBeVisible();
  });

  it("falls back to the scheduled destination when the supplier has no address", () => {
    const source = flight(JSON.stringify({ roomFacts: [{ roomName: "Twin room" }] }));
    const stay: Component = {
      ...source,
      id: "stay-without-location",
      type: "accommodation",
      details: { occupancy: "2 adults", amenities: [] },
      serviceStart: "2030-05-01T00:00:00Z",
      serviceEnd: "2030-05-05T00:00:00Z",
      planningDetails: { ...source.planningDetails!, locationName: "Riverside Hotel" },
    };
    const destinations: ComponentDestination[] = [
      {
        id: "10000000-0000-4000-8000-000000000099",
        kind: "city",
        name: "Tokyo",
        countryCode: "JP",
        timezone: "Asia/Tokyo",
        providerPlaceIds: {},
        location: null,
        routePosition: 0,
        arrivalDate: "2030-05-01",
        departureDate: "2030-05-05",
        plannedNights: 4,
      },
    ];
    render(<ComponentDetails components={[stay]} destinations={destinations} version={1} />);
    const card = screen.getByRole("article", { name: "Stay: Riverside Hotel" });
    expect(within(card).getByText("Location")).toBeVisible();
    expect(within(card).getByText("Tokyo, JP")).toBeVisible();
  });

  it("turns saved supplier JSON into selected facts without exposing internal fields", () => {
    const component = flight(
      JSON.stringify({
        originAirportCode: "LHR",
        destinationAirportCode: "LIS",
        fareBrands: ["Economy Light", "Economy Light"],
        passengerFares: [{ cabinClass: "premium_economy", fareBasisCode: "PRIVATE-FARE-CODE" }],
        identityDocumentsRequired: true,
        refundBeforeDepartureAllowed: false,
        extraCostsVerified: false,
        supplierOfferId: "PRIVATE-SUPPLIER-ID",
        unexpected: { deeplyNested: "NOT-FOR-DISPLAY" },
      }),
    );
    render(<ComponentDetails components={[component]} version={4} />);
    expect(screen.getByRole("region", { name: "Component details" })).toHaveAttribute(
      "data-trip-version",
      "4",
    );
    const card = screen.getByRole("article", { name: "Flight: LHR → LIS" });
    expect(within(card).getByRole("heading", { name: "LHR → LIS" })).toBeVisible();
    expect(within(card).getByText("£128.50")).toBeVisible();
    expect(within(card).getByText("Not booked")).toBeVisible();
    expect(within(card).getByText("Economy Light")).toBeVisible();
    expect(within(card).getByText("premium economy")).toBeVisible();
    expect(within(card).getByText("Not allowed")).toBeVisible();
    expect(within(card).getByText("0 min")).toBeVisible();
    expect(card.textContent).not.toMatch(
      /PRIVATE|NOT-FOR-DISPLAY|fareBrands|passengerFares|minor units|internal-offer/,
    );
    const disclosure = within(card).getByText("Booking and practical details");
    expect(disclosure.parentElement).not.toHaveAttribute("open");
    fireEvent.click(disclosure);
    expect(disclosure.parentElement).toHaveAttribute("open");
    expect(within(card).getByText("Bring a valid passport")).toBeVisible();
    expect(within(card).getByText("Not met; review before booking")).toBeVisible();
    expect(within(card).getByText("Verified")).toBeVisible();
    expect(within(card).getByText("£0.00")).toBeVisible();
  });

  it.each(['{"originAirportCode":"LHR",…[truncated]', '{"unknown":"hidden"}', '["hidden"]'])(
    "discloses incomplete or unsupported supplier details without printing JSON: %s",
    (value) => {
      const { container } = render(<ComponentDetails components={[flight(value)]} version={1} />);
      expect(container.textContent).not.toContain("hidden");
      expect(container.textContent).not.toContain("originAirportCode");
      expect(container.textContent).not.toContain("[truncated]");
      expect(container.textContent).toMatch(
        /Verify them before booking|Confirm availability and final terms/,
      );
    },
  );

  it("keeps ordinary fare prose and flight-specific practical details", () => {
    const component = flight("Changes allowed for a fee");
    if (component.type !== "flight") throw new Error("Expected flight fixture");
    component.details = { legs: ["London to Lisbon"], baggage: ["One cabin bag"] };
    const html = renderToStaticMarkup(<ComponentDetails components={[component]} version={1} />);
    expect(html).toContain("Changes allowed for a fee");
    expect(html).toContain("London to Lisbon");
    expect(html).toContain("One cabin bag");
    expect(html).not.toContain("Full service details are still to be confirmed");
  });

  it("renders stays, experiences, rail and transfers with appropriate details", () => {
    const shared = flight(null);
    const components: Component[] = [
      {
        ...shared,
        id: "stay",
        type: "accommodation",
        details: { occupancy: "2 adults", amenities: ["Wi-Fi", "Pool"] },
        planningDetails: {
          ...shared.planningDetails!,
          locationName: "Riverside Hotel",
          fareConditions: JSON.stringify({
            roomFacts: [{ roomName: "Twin room", meal: "Breakfast included" }],
            dueAtPropertyMinor: 2500,
            membershipRequired: true,
            rateId: "HIDDEN-RATE",
          }),
        },
      },
      {
        ...shared,
        id: "activity",
        type: "activity",
        details: { durationMinutes: 90, directions: "Meet at the main entrance" },
        planningDetails: {
          ...shared.planningDetails!,
          durationMinutes: null,
          fareConditions:
            '{"startTime":"09:30","productOptions":[{"description":"Guided city walk","optionCode":"HIDDEN-OPTION"}]}',
        },
      },
      {
        ...shared,
        id: "rail",
        type: "rail",
        details: { originStation: "Lisbon", destinationStation: "Porto", route: "Coastal service" },
      },
      {
        ...shared,
        id: "transfer",
        type: "transfer",
        details: { origin: "Airport", destination: "Hotel", route: "Private car" },
      },
    ];
    const html = renderToStaticMarkup(<ComponentDetails components={components} version={1} />);
    for (const text of [
      "Riverside Hotel",
      "Check-in",
      "Check-out",
      "Twin room",
      "Breakfast included",
      "£25.00",
      "2 adults",
      "Wi-Fi",
      "Meet at the main entrance",
      "1 hr 30 min",
      "Guided city walk",
      "Lisbon → Porto",
      "Airport → Hotel",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("HIDDEN");
    expect(html).not.toContain("roomFacts");
  });

  it("handles empty trips, legacy components, expiry and structured terms explicitly", () => {
    const { rerender } = render(<ComponentDetails components={[]} version={1} />);
    expect(screen.getByText(/will appear here once your trip is planned/)).toBeVisible();
    const component = flight(null);
    delete component.planningDetails;
    component.price.status = "expired";
    component.cancellationTerms = '{"internalPolicy":"hidden"}';
    rerender(<ComponentDetails components={[component]} version={2} />);
    expect(screen.getByText("Price needs refreshing before booking")).toBeVisible();
    expect(screen.getByText("Expired price")).toBeVisible();
    fireEvent.click(screen.getByText("Booking and practical details"));
    expect(
      screen.getByText("Cancellation and change terms need confirmation before booking."),
    ).toBeVisible();
    expect(screen.queryByText(/internalPolicy/)).not.toBeInTheDocument();
  });

  it("keeps existing synthetic trip components renderable", () => {
    const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
    expect(() =>
      renderToStaticMarkup(<ComponentDetails components={snapshot.components} version={1} />),
    ).not.toThrow();
  });

  it("formats currency precision, duration and local times independently of browser timezone", () => {
    expect(componentMoney(12850, "JPY")).toBe("¥12,850");
    expect(componentMoney(12850, "KWD")).toContain("12.850");
    expect(componentDuration(60)).toBe("1 hr");
    expect(componentDuration(0)).toBe("0 min");
    expect(componentDate("2030-05-01T08:00:00+02:00")).toBe("1 May 2030, 08:00 (UTC+02:00)");
    expect(componentDate("2030-05-01T08:00:00+02:00", "Europe/London")).toBe("1 May 2030, 07:00");
    expect(componentDate("2030-05-01T00:00:00Z", null, true)).toBe("1 May 2030");
    const component = flight(null);
    component.planningDetails!.timezone = "invalid-zone";
    expect(() =>
      renderToStaticMarkup(<ComponentDetails components={[component]} version={1} />),
    ).not.toThrow();
  });
});
