export function createItineraryCases(estimateInput, dateForDay) {
  const uuid = (value) => "d0000000-d000-4000-8000-d" + String(value).padStart(11, "0");
  function snapshotFor(index) {
    const snapshot = structuredClone(estimateInput(1).snapshot), date = dateForDay(index);
    snapshot.availabilityWindows = [{ id: uuid(9001), startDate: date, endDate: date, preference: "preferred", timezone: "Europe/Lisbon" }];
    snapshot.duration = { minimumDays: 1, idealDays: 1, maximumDays: 1 };
    snapshot.constraints = [];
    snapshot.preferences.pace = 50;
    snapshot.destinations = [{ ...snapshot.destinations[0], id: uuid(9002), timezone: "Europe/Lisbon", arrivalDate: date, departureDate: date, plannedNights: 0 }];
    snapshot.components = [];
    const items = ["meal", "activity", "free_time", "activity", "meal"].map((type, item) => ({
      id: uuid(index * 10 + item + 1), type,
      start: date + "T" + ["08:00", "10:00", "13:00", "14:00", "18:00"][item],
      end: date + "T" + ["08:45", "12:00", "14:00", "16:00", "18:45"][item],
      startOffset: "+01:00", endOffset: "+01:00", location: { latitude: 38.7223, longitude: -9.1393 },
      componentId: null, constraintChecks: [], constraintEvidence: [], status: "planned", travelSegment: null,
      priority: "preference", durationUpperBoundMinutes: item === 3 && index < 20 ? 180 : null,
      timingEvidence: ["Deterministic supplier timing fixture v1"], verificationStatus: "verified", feasibilityPolicyVersion: "1"
    }));
    snapshot.itineraryDays = [{ date, destinationId: uuid(9002), timezone: "Europe/Lisbon", paceAssessment: 50, items }];
    return snapshot;
  }
  const itineraryDays = Array.from({ length: 100 }, (_, index) => ({
    id: "day-" + String(index + 1).padStart(3, "0"), input: snapshotFor(index),
    expectedPassingItems: index < 20 ? 4 : 5,
    expectedItemResults: ["pass", "pass", "pass", index < 20 ? "fail" : "pass", "pass"]
  }));
  const hardConflicts = Array.from({ length: 20 }, (_, index) => {
    const input = snapshotFor(index + 20), day = input.itineraryDays[0], item = day.items[1];
    const kind = ["impossible_connection", "required_accessibility_unavailable", "traveller_ineligible", "date_window_violation", "required_constraint_conflict"][index % 5];
    if (kind === "date_window_violation") {
      // The single planned day is fewer than the accepted minimum duration while the window could
      // hold it: a storable snapshot whose date/duration conflict the policy reports (spec.md line 99).
      input.availabilityWindows[0].endDate = dateForDay(index + 24);
      input.duration = { minimumDays: 3, idealDays: 4, maximumDays: 5 };
    }
    if (kind === "required_constraint_conflict" || kind === "required_accessibility_unavailable") {
      const constraint = { id: uuid(9500 + index), category: kind === "required_accessibility_unavailable" ? "accessibility" : "schedule",
        statement: kind === "required_accessibility_unavailable" ? "Step-free access required" : "No activities before 11:00",
        priority: "required", source: { kind: "setup_text", referenceId: null }, status: kind === "required_constraint_conflict" ? "conflicting" : "active", confirmedByUser: true };
      input.constraints = [constraint];
      item.constraintEvidence = [{ constraintId: constraint.id, status: "failed", source: "Deterministic unavailable access fixture", checkedAt: "2029-01-01T00:00:00Z" }];
    }
    if (kind === "traveller_ineligible") {
      item.componentId = uuid(9700 + index);
      const zero = { currency: input.price.currency, minorUnits: 0 };
      input.components = [{ id: item.componentId, type: "activity", itineraryItemIds: [item.id], provider: "synthetic", supplierOfferId: "synthetic-ineligible",
        offerStatus: "available", serviceStart: item.start + ":00+01:00", serviceEnd: item.end + ":00+01:00", travellerIds: [uuid(9800)],
        bookingRequirements: [], cancellationTerms: "Synthetic terms", checkedAt: "2029-01-01T00:00:00Z", expiresAt: null, bookingStatus: "unbooked",
        details: { durationMinutes: 120, directions: "Synthetic directions" },
        price: { supplierAmount: zero, platformMargin: zero, customerPayableTaxes: zero, customerPayableFees: zero, finalCustomerAmount: zero,
          status: "estimated", source: "synthetic", checkedAt: "2029-01-01T00:00:00Z", expiresAt: null },
        planningDetails: { locationName: "Synthetic venue", timezone: "Europe/Lisbon", airportNames: [], airlines: [], flightDirection: null,
          durationMinutes: 120, layovers: [], fareConditions: null, accommodationType: null, travelFromStayMinutes: 0,
          eligibility: "failed", accessibility: "verified", availability: "verified", constraintEvidence: [], source: "Synthetic age restriction fixture",
          checkedAt: "2029-01-01T00:00:00Z", unavailableFacts: [] }
      }];
    }
    if (kind === "impossible_connection") {
      const place = { placeId: "synthetic-station", name: "Synthetic station", timezone: "Europe/Lisbon", location: item.location };
      const segment = (departure, arrival) => ({ mode: "rail", origin: place, destination: place, plannedDeparture: day.date + "T" + departure + ":00+01:00",
        plannedArrival: day.date + "T" + arrival + ":00+01:00", durationMinutes: 30, durationUpperBoundMinutes: 30,
        routeGeometry: null, directionsSummary: "Synthetic rail direction", source: "Synthetic published timetable", freshnessAt: "2029-01-01T00:00:00Z",
        timingEvidence: ["Synthetic timetable v1"], verificationStatus: "verified", feasibilityPolicyVersion: "1" });
      const prior = { ...day.items[0], type: "travel", start: day.date + "T08:00", end: day.date + "T09:00", travelSegment: segment("08:30", "09:00") };
      item.type = "travel"; item.start = day.date + "T09:00"; item.end = day.date + "T10:00";
      item.travelSegment = { ...segment("09:30", "10:00"), connectionFromItemId: prior.id, connectionMinimumMinutes: 30 };
      day.items[0] = prior;
    }
    return { id: "hard-conflict-" + String(index + 1).padStart(3, "0"), kind, input,
      expected: { disclosed: true, finalizationBlocked: true, disposition: "requires_resolution" },
      expectedCode: { impossible_connection: "impossible_connection", required_accessibility_unavailable: "required_constraint", traveller_ineligible: "component_unavailable",
        date_window_violation: "date_duration", required_constraint_conflict: "constraint_conflict" }[kind] };
  });
  return { itineraryDays, hardConflicts };
}
