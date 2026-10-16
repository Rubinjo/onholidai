import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Workspace } from "../../components/trip-workspace/workspace";
import { PriceBar } from "../../components/trip-workspace/price-bar";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import type { TripEnvelope } from "../../components/trip-workspace/use-trip";

const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
snapshot.price = { currency: "GBP", finalCustomerMinor: 128500, taxesMinor: 8500, feesMinor: 0, status: "estimated", checkedAt: "2030-01-01T12:00:00Z" };
snapshot.components = [{ id: "10000000-0000-4000-8000-000000000081", type: "flight", provider: "synthetic", supplierOfferId: "illustrative-flight", itineraryItemIds: [], travellerIds: [], offerStatus: "available", serviceStart: "2030-05-01T08:00:00Z", serviceEnd: "2030-05-01T10:00:00Z", bookingRequirements: [], cancellationTerms: "Illustrative terms, review before booking", checkedAt: "2030-01-01T12:00:00Z", expiresAt: null, bookingStatus: "unbooked", details: { legs: ["Illustrative journey"], baggage: [] }, price: snapshot.price }];
const trip: TripEnvelope = { tripId: "10000000-0000-4000-8000-000000000080", version: 2, lifecycleState: "draft", updatedAt: "2030-01-01T12:00:00Z", snapshot };
it("renders customer totals, unknown taxes and currency precision without internal pricing", () => {
  const html = renderToStaticMarkup(<PriceBar trip={trip} />);
  expect(html).toContain("£1,285.00"); expect(html).toContain("£85.00");
  expect(html).not.toContain("supplierTotal"); expect(html).not.toContain("platformMargin");
  const unknown = renderToStaticMarkup(<PriceBar trip={{ ...trip, snapshot: { ...snapshot, price: { ...snapshot.price, currency: "JPY", taxesMinor: undefined } } }} />);
  expect(unknown).toContain("¥128,500"); expect(unknown).toContain("To be confirmed");
});
it("renders consistent workspace sections, a labelled composer and guarded actions", () => {
  const html = renderToStaticMarkup(<Workspace initialTrip={trip} initialRunId={null} />);
  expect(html).toContain("assistant-chat__composer"); expect(html).toContain("Ask your travel assistant");
  expect(html).toContain("Trip details"); expect(html).toContain("Version history");
  expect(html).toContain("Finalize your trip to enable booking"); expect(html).not.toContain("Review live booking terms");
  // Opt-in synthetic artifact for browser layout/focus verification; no private data.
  if (process.env.WORKSPACE_VISUAL_HTML) {
    const output = resolve(process.cwd(), ".tmp/workspace-preview.html");
    mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, html);
  }
});
