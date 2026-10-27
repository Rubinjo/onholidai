// @vitest-environment node
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { deriveBookingCoverage } from "../../domain/trip/booking-coverage";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { proposalOperationSchema } from "../../domain/trip/proposal";
import { reviewNow, wholeTripReviewFixture } from "../fixtures/whole-trip-review";

function review(fixture = wholeTripReviewFixture()) {
  return deriveBookingCoverage(fixture.snapshot, {
    tripVersion: 2,
    evidence: fixture.evidence,
    now: reviewNow,
  });
}

describe("complete trip booking coverage", () => {
  it("keeps accepted legacy classification unknown and cannot manufacture verified disposition in a proposal", () => {
    const fixture = wholeTripReviewFixture();
    const item = fixture.snapshot.itineraryDays[0].items[3];
    expect(item.bookingDisposition).toBeUndefined();
    const proposed = {
      ...item,
      bookingDisposition: "unknown",
      bookingDispositionEvidence: {
        source: "Recorded source awaiting verification",
        verificationStatus: "unverified",
        checkedAt: reviewNow.toISOString(),
      },
    };
    const operation = { operation: "replace", target: "/itineraryDays/0/items/3", value: proposed };
    expect(proposalOperationSchema.safeParse(operation).success).toBe(true);
    expect(
      proposalOperationSchema.safeParse({
        ...operation,
        value: {
          ...proposed,
          bookingDisposition: "not_required",
          bookingDispositionEvidence: {
            ...proposed.bookingDispositionEvidence,
            verificationStatus: "verified",
          },
        },
      }).success,
    ).toBe(false);
    expect(
      proposalOperationSchema.safeParse({
        operation: "replace",
        target: "/itineraryDays/0/items/3/bookingDispositionEvidence/verificationStatus",
        value: "verified",
      }).success,
    ).toBe(false);
    item.bookingDisposition = "unknown";
    item.bookingDispositionEvidence = {
      source: "access_token=private",
      verificationStatus: "unverified",
      checkedAt: reviewNow.toISOString(),
    };
    const projected = projectCustomerSnapshot(fixture.snapshot, reviewNow);
    expect(projected.itineraryDays[0].items[3].bookingDisposition).toBe("unknown");
    expect(projected.itineraryDays[0].items[3].bookingDispositionEvidence?.source).toBe(
      "[REDACTED]",
    );
  });

  it("covers supported flights, Nuitee stay and Viator activity without deferred providers", () => {
    const report = review();
    expect(report.issues).toEqual([]);
    expect(report.eligible).toBe(true);
    expect(report.entries).toHaveLength(4);
    expect(report.toBookComponentIds).toHaveLength(4);
    expect(report.remainingPayable).toEqual({ currency: "GBP", minorUnits: 40000 });
  });

  it.each(["transport:outbound", "transport:return", "accommodation:", "activity:"])(
    "derives %s even when its component is absent",
    (requirement) => {
      const fixture = wholeTripReviewFixture();
      const missing = fixture.evidence.find((entry) =>
        entry.requirementIds.some((id) => id.startsWith(requirement)),
      )!;
      fixture.snapshot.components = fixture.snapshot.components.filter(
        (entry) => entry.id !== missing.componentId,
      );
      const report = review(fixture);
      expect(report.eligible).toBe(false);
      expect(
        report.entries.find((entry) => entry.requirementId.startsWith(requirement))?.state,
      ).toBe("missing");
    },
  );

  it.each(["finalTermsVerified", "taxesFeesKnown", "bookingSupported"] as const)(
    "does not acknowledge %s into eligibility",
    (field) => {
      const fixture = wholeTripReviewFixture();
      fixture.evidence[2][field] = false;
      expect(review(fixture).eligible).toBe(false);
    },
  );

  it("does not treat fresh Nuitee rates or disabled payment SDK as final terms", () => {
    const fixture = wholeTripReviewFixture();
    fixture.evidence[2].finalTermsVerified = false;
    const report = review(fixture);
    expect(report.eligible).toBe(false);
    expect(report.issues.some((issue) => issue.code === "booking_final_terms_unverified")).toBe(
      true,
    );
  });

  it("blocks missing opaque traveller/payment readiness and incorrect room-party coverage", () => {
    for (const mutate of [
      (fixture: ReturnType<typeof wholeTripReviewFixture>) => {
        fixture.evidence[2].travellerReadiness = null;
      },
      (fixture: ReturnType<typeof wholeTripReviewFixture>) => {
        fixture.evidence[2].paymentReadiness = null;
      },
      (fixture: ReturnType<typeof wholeTripReviewFixture>) => {
        fixture.evidence[2].occupancy!.adults = 1;
      },
      (fixture: ReturnType<typeof wholeTripReviewFixture>) => {
        fixture.evidence[2].travellerIds.pop();
      },
    ]) {
      const fixture = wholeTripReviewFixture();
      mutate(fixture);
      expect(review(fixture).eligible).toBe(false);
    }
  });

  it("retains unknown legacy activity cost rather than inferring a free activity", () => {
    const fixture = wholeTripReviewFixture();
    fixture.snapshot.itineraryDays[0].items.find((item) => item.type === "activity")!.componentId =
      null;
    fixture.snapshot.components = fixture.snapshot.components.filter(
      (entry) => entry.type !== "activity",
    );
    const report = review(fixture);
    expect(report.eligible).toBe(false);
    expect(report.entries.find((entry) => entry.kind === "activity")?.state).toBe(
      "covered_unverified",
    );
  });

  it("ignores polling timestamps but binds prices, mappings, party and source evidence", () => {
    const fixture = wholeTripReviewFixture();
    const first = review(fixture);
    fixture.evidence.forEach((entry) => {
      entry.checkedAt = new Date(reviewNow.getTime() - 1000).toISOString();
    });
    expect(review(fixture).fingerprint).toBe(first.fingerprint);
    fixture.evidence[0].inventoryId += "-changed";
    expect(review(fixture).fingerprint).not.toBe(first.fingerprint);
    expect(
      deriveBookingCoverage(fixture.snapshot, {
        tripVersion: 3,
        evidence: fixture.evidence,
        now: reviewNow,
      }).fingerprint,
    ).not.toBe(first.fingerprint);
  });

  it("blocks expired, mixed-currency and mismatched provider evidence", () => {
    for (const values of [
      { expiresAt: reviewNow.toISOString() },
      { currency: "EUR" },
      { provider: "booking" },
    ]) {
      const fixture = wholeTripReviewFixture();
      Object.assign(fixture.evidence[2], values);
      expect(review(fixture).eligible).toBe(false);
    }
  });

  it("does not accept evidence whose claimed check time is still in the future", () => {
    const fixture = wholeTripReviewFixture();
    fixture.evidence[0].checkedAt = new Date(reviewNow.getTime() + 60_000).toISOString();
    expect(review(fixture).eligible).toBe(false);
    expect(review(fixture).issues.some((issue) => issue.code === "booking_evidence_future")).toBe(
      true,
    );
  });

  it("does not promote confirmed labels without durable commitment evidence", () => {
    const fixture = wholeTripReviewFixture();
    fixture.snapshot.components.forEach((component) => {
      component.bookingStatus = "confirmed";
    });
    expect(review(fixture).eligible).toBe(false);
    fixture.evidence.forEach((entry) => {
      entry.confirmationId = `recorded-${entry.componentId}`;
      entry.expiresAt = null;
    });
    const report = review(fixture);
    expect(report.issues).toEqual([]);
    expect(report.complete).toBe(true);
    expect(report.eligible).toBe(false);
    expect(report.toBookComponentIds).toEqual([]);
    expect(report.remainingPayable.minorUnits).toBe(0);
    expect(report.entries.every((entry) => entry.state === "confirmed")).toBe(true);
  });

  it("checks actual conflicts rather than accepting an acknowledged planning result", () => {
    const fixture = wholeTripReviewFixture();
    fixture.snapshot.itineraryDays[0].items[3].start = "2030-01-02T14:30";
    const report = review(fixture);
    expect(report.eligible).toBe(false);
    expect(report.issues.some((issue) => issue.code === "overlap")).toBe(true);
  });

  it("derives missing intercity legs and every missing stay night independently of components", () => {
    const fixture = wholeTripReviewFixture();
    const before = fixture.snapshot.destinations[0];
    const after = {
      ...before,
      id: randomUUID(),
      name: "Recorded second city",
      providerPlaceIds: { recorded: "recorded-second-city" },
      routePosition: 1,
      arrivalDate: before.departureDate,
      plannedNights: 0,
    };
    fixture.snapshot.destinations.push(after);
    expect(
      review(fixture).entries.find((entry) =>
        entry.requirementId.startsWith("transport:intercity:"),
      )?.state,
    ).toBe("missing");
    before.departureDate = "2030-01-04";
    before.plannedNights = 2;
    expect(
      review(fixture).entries.find(
        (entry) => entry.requirementId === `accommodation:${before.id}:2030-01-03`,
      )?.state,
    ).toBe("missing");
  });

  it("requires trusted explicit evidence before treating a free activity as not required", () => {
    const fixture = wholeTripReviewFixture();
    const visit = fixture.snapshot.itineraryDays[0].items.find((item) => item.type === "activity")!;
    fixture.snapshot.components = fixture.snapshot.components.filter(
      (entry) => entry.id !== visit.componentId,
    );
    fixture.evidence = fixture.evidence.filter((entry) => entry.componentId !== visit.componentId);
    visit.componentId = null;
    visit.bookingDisposition = "not_required";
    visit.bookingDispositionEvidence = {
      source: "recorded-free-admission",
      verificationStatus: "verified",
      checkedAt: reviewNow.toISOString(),
    };
    expect(review(fixture).eligible).toBe(false);
    const report = deriveBookingCoverage(fixture.snapshot, {
      tripVersion: 2,
      evidence: fixture.evidence,
      now: reviewNow,
      verifiedDispositions: [
        {
          itemId: visit.id,
          source: "recorded-free-admission",
          reference: "recorded-free-ticket-policy",
          version: "1",
          fingerprint: "c".repeat(64),
        },
      ],
    });
    expect(report.issues).toEqual([]);
    expect(report.eligible).toBe(true);
    expect(report.entries.find((entry) => entry.kind === "activity")?.state).toBe("not_required");
  });

  it("does not waive required rail when supported planning was allowed to continue", () => {
    const fixture = wholeTripReviewFixture();
    fixture.snapshot.constraints.push({
      id: randomUUID(),
      category: "transport",
      statement: "Rail is required between destinations",
      priority: "required",
      source: { kind: "setup_text", referenceId: null },
      status: "active",
      confirmedByUser: true,
    });
    const report = review(fixture);
    expect(report.eligible).toBe(false);
    expect(
      report.entries.find((entry) => entry.requirementId.startsWith("transport:constraint:"))
        ?.state,
    ).toBe("missing");
  });

  it("does not infer a bookable transfer from its type or a provider deferral", () => {
    const fixture = wholeTripReviewFixture();
    fixture.snapshot.itineraryDays[0].items[0].travelSegment!.mode = "transfer";
    const report = review(fixture);
    expect(report.eligible).toBe(false);
    expect(report.issues.some((issue) => issue.code === "booking_transport_mismatch")).toBe(true);
  });

  it("counts a round-trip bundle once while covering both actual scheduled legs", () => {
    const fixture = wholeTripReviewFixture();
    const [outbound, inbound] = fixture.snapshot.components;
    const returnItem = fixture.snapshot.itineraryDays[1].items.at(-1)!;
    outbound.serviceEnd = inbound.serviceEnd;
    outbound.price.supplierAmount!.minorUnits += inbound.price.supplierAmount!.minorUnits;
    outbound.price.finalCustomerAmount.minorUnits += inbound.price.finalCustomerAmount.minorUnits;
    outbound.itineraryItemIds.push(returnItem.id);
    returnItem.componentId = outbound.id;
    fixture.snapshot.components = fixture.snapshot.components.filter(
      (entry) => entry.id !== inbound.id,
    );
    fixture.evidence[0].serviceEnd = inbound.serviceEnd;
    fixture.evidence[0].finalCustomerMinor = outbound.price.finalCustomerAmount.minorUnits;
    fixture.evidence[0].requirementIds.push("transport:return");
    fixture.evidence = fixture.evidence.filter((entry) => entry.componentId !== inbound.id);
    const report = review(fixture);
    expect(report.issues).toEqual([]);
    expect(report.eligible).toBe(true);
    expect(report.toBookComponentIds).toHaveLength(3);
    expect(report.remainingPayable.minorUnits).toBe(40000);
  });

  it("does not hide unknown payable totals behind a successful-looking zero", () => {
    const fixture = wholeTripReviewFixture();
    fixture.evidence = [];
    const report = review(fixture);
    expect(report.eligible).toBe(false);
    expect(report.remainingPayable.minorUnits).toBeNull();
  });
});
