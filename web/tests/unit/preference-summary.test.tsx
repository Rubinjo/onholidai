import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { DayPlan } from "../../components/trip-workspace/day-plan";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";

afterEach(cleanup);
it("uses the same 1–10 pace scale in daily-plan summaries without rewriting the stored assessment", () => {
  const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
  const days = snapshot.itineraryDays.map((day) => ({ ...day, paceAssessment: 50 }));
  expect(days.length).toBeGreaterThan(0);
  render(<DayPlan days={days} />);
  expect(screen.getAllByText(/Pace preference 6\/10/).length).toBe(days.length);
  expect(days.every((day) => day.paceAssessment === 50)).toBe(true);
});
