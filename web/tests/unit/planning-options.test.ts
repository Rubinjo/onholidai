import { describe, expect, it } from "vitest";
import { tripSnapshotSchema } from "../../domain/trip/schema";
import { applyDraftOperations } from "../../domain/trip/operations";
import { emptySetupDraft, setupDraftPayloadSchema } from "../../components/trip-setup/draft-schema";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

describe("route policy and alternative departures", () => {
  it("retains manual/AI policy and all confirmed alternatives in a partial draft", () => {
    const origin = createSyntheticTripSnapshot().departureOrigin;
    const draft = setupDraftPayloadSchema.parse({ ...emptySetupDraft(), destinationOrder: "ai", departureOrigins: [origin] });
    expect(draft).toMatchObject({ destinationOrder: "ai", departureOrigins: [origin] });
  });
  it("reads legacy snapshots without adding facts to immutable history", () => {
    const snapshot = createSyntheticTripSnapshot();
    expect(tripSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });
  it("allows a reviewed policy change on a legacy snapshot and rejects invalid policies", () => {
    const snapshot = createSyntheticTripSnapshot();
    expect(applyDraftOperations(snapshot, [{ operation: "add", target: "/destinationOrder", value: "ai" }]).destinationOrder).toBe("ai");
    expect(() => applyDraftOperations(snapshot, [{ operation: "add", target: "/destinationOrder", value: "random" }])).toThrow();
  });
  it("rejects duplicate, unconfirmed or unrelated selected departure alternatives", () => {
    const snapshot = createSyntheticTripSnapshot(), origin = snapshot.departureOrigin;
    expect(tripSnapshotSchema.safeParse({ ...snapshot, departureOrigins: [origin, origin] }).success).toBe(false);
    expect(tripSnapshotSchema.safeParse({ ...snapshot, departureOrigins: [{ ...origin, confirmedByUser: false }] }).success).toBe(false);
    expect(tripSnapshotSchema.safeParse({ ...snapshot, departureOrigins: [{ ...origin, placeId: "other" }] }).success).toBe(false);
  });
});
