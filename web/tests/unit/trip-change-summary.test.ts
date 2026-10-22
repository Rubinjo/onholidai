import { describe, expect, it } from "vitest";

import { summarizeTripChanges } from "../../domain/trip/change-summary";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

describe("committed trip change summaries", () => {
  it("describes changed facts without repeating unchanged itinerary or supplier costs", () => {
    const before = createSyntheticTripSnapshot(),
      after = structuredClone(before);
    after.travellerParty.adults = 3;
    after.preferences.pace = 70;
    const summary = summarizeTripChanges(before, after).join(" ");
    expect(summary).toContain("3 adults");
    expect(summary).toContain("Travel style updated");
    expect(summary).not.toContain(before.destinations[0].name);
    expect(summary).not.toMatch(/supplier|margin/i);
  });
  it("reports no material change honestly and bounds long multi-field summaries", () => {
    const before = createSyntheticTripSnapshot();
    expect(summarizeTripChanges(before, structuredClone(before))).toEqual([
      "No trip details changed.",
    ]);
    const after = structuredClone(before);
    after.destinations[0].name = "X".repeat(120);
    after.travellerParty.adults = 4;
    after.preferences.pace = 80;
    after.duration.idealDays += 1;
    expect(summarizeTripChanges(before, after).join(" ").length).toBeLessThanOrEqual(1200);
  });
});
