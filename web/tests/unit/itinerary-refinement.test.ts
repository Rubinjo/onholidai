// @vitest-environment node
import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { previewFinalization } from "../../domain/trip/finalization-proposal";
import { tripSnapshotSchema } from "../../domain/trip/schema";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

function withActivity(title: string) {
  const snapshot = createSyntheticTripSnapshot();
  const day = snapshot.itineraryDays[0];
  return {
    ...snapshot,
    itineraryDays: [
      {
        ...day,
        items: [
          ...day.items,
          {
            id: randomUUID(),
            type: "activity" as const,
            title,
            start: `${day.date}T19:00`,
            end: `${day.date}T20:30`,
            startOffset: "+01:00",
            endOffset: "+01:00",
            location: null,
            componentId: null,
            constraintChecks: [],
            constraintEvidence: [],
            status: "planned" as const,
            travelSegment: null,
            priority: "strong" as const,
            verificationStatus: "unverified" as const,
            timingEvidence: [],
            durationUpperBoundMinutes: null,
            feasibilityPolicyVersion: "1" as const,
            practicalNotes: ["Supplier start time and tickets remain unverified."],
          },
        ],
      },
    ],
  };
}

describe("day-plan-only refinement review", () => {
  it("accepts an added activity and keeps it unverified without repricing components", () => {
    const base = createSyntheticTripSnapshot();
    const proposed = withActivity("Traditional Geisha Show");
    const review = previewFinalization(base, [
      { operation: "replace", target: "/itineraryDays", value: proposed.itineraryDays },
    ]);
    const added = review.snapshot.itineraryDays[0].items.find(
      (item) => item.title === "Traditional Geisha Show",
    );
    expect(added).toMatchObject({ componentId: null, verificationStatus: "unverified" });
    expect(review.snapshot.components.map((entry) => entry.id)).toEqual(
      base.components.map((entry) => entry.id),
    );
    expect(review.priceImpact.deltaMinor).toBe(0);
    expect(review.affectedFacts).toEqual(["itineraryDays", "feasibility"]);
    expect(review.warnings.some((warning) => /overlapping/i.test(warning))).toBe(false);
    expect(tripSnapshotSchema.safeParse(review.snapshot).success).toBe(true);
    expect(JSON.stringify(review.previewSnapshot)).not.toMatch(/supplierAmount|platformMargin/);
  });

  it("still refuses supplier or price changes in a day-plan review", () => {
    const base = createSyntheticTripSnapshot();
    expect(() =>
      previewFinalization(base, [
        { operation: "replace", target: "/components", value: base.components },
      ]),
    ).toThrow();
  });
});
