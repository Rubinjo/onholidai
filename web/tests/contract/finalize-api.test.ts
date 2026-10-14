// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { finalizeCommandSchema } from "../../domain/trip/finalize";
import { itineraryDaySchema, tripSnapshotSchema } from "../../domain/trip/schema";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

describe("finalization contracts", () => {
  it("requires exact version and explicit disclosure acceptance, excludes booking capabilities", () => {
    const command = { requestId: "20000000-0000-4000-8000-000000000001", expectedVersion: 2, acknowledgeUnverified: true, reviewFingerprint: "a".repeat(64) };
    expect(finalizeCommandSchema.parse(command)).toEqual(command);
    for (const invalid of [{ ...command, expectedVersion: 0 }, { ...command, book: true }, { requestId: command.requestId }]) {
      expect(finalizeCommandSchema.safeParse(invalid).success).toBe(false);
    }
  });
  it("keeps historical days readable and customer pricing estimated and private", () => {
    const snapshot = createSyntheticTripSnapshot();
    expect(itineraryDaySchema.safeParse(snapshot.itineraryDays[0]).success).toBe(true);
    expect(tripSnapshotSchema.safeParse(snapshot).success).toBe(true);
    const publicSnapshot = projectCustomerSnapshot(snapshot);
    expect(publicSnapshot.price.status).toBe("estimated");
    expect(JSON.stringify(publicSnapshot)).not.toMatch(/supplierAmount|platformMargin/);
  });
});
