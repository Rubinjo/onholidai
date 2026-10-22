import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { PriceBar } from "../../components/trip-workspace/price-bar";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";

afterEach(cleanup);
it("shows the exact guest notice only while signed out and avoids a false zero estimate", () => {
  const trip = {
    tripId: crypto.randomUUID(),
    version: 1,
    lifecycleState: "draft",
    updatedAt: new Date().toISOString(),
    snapshot: projectCustomerSnapshot(createSyntheticTripSnapshot()),
  };
  const view = render(<PriceBar trip={trip} authenticated={false} />);
  const notice =
    "You can plan your visit without creating an account. To review your booking, simply create a free account and confirm the current terms.";
  expect(screen.getByText(notice)).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Your estimate is being planned" })).toBeTruthy();
  view.rerender(<PriceBar trip={trip} authenticated />);
  expect(screen.queryByText(notice)).toBeNull();
});
