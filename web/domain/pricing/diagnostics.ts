import { sql, type Kysely } from "kysely";

import { readOwnedTripVersion } from "@/domain/trip/read";
import { decodeTripSnapshot } from "@/domain/trip/schema";
import { AuthorizationError } from "@/server/auth/authorize";
import type { Database } from "@/server/db/database";
import { resolveBookingActor } from "@/server/auth/planning-actor";

export async function readPricingDiagnostic(database: Kysely<Database>, userId: string, tripId: string, version: number) {
  const role = await sql<{ internalTeamRole: string | null }>`SELECT internal_team_role AS "internalTeamRole"
    FROM app."user" WHERE id = ${userId}`.execute(database);
  if (!["pricing_auditor", "administrator"].includes(role.rows[0]?.internalTeamRole ?? "")) {
    throw new AuthorizationError("FORBIDDEN");
  }
  const actor = await resolveBookingActor(database, tripId, userId);
  const stored = await readOwnedTripVersion(database, actor.planningOwnerId, tripId, version);
  const snapshot = decodeTripSnapshot(stored.schemaVersion, stored.snapshot).snapshot;
  return { tripId, tripVersion: version, currency: snapshot.price.currency,
    components: snapshot.components.map((component) => ({ componentId: component.id,
      supplierMinor: component.price.supplierAmount.minorUnits, marginMinor: component.price.platformMargin.minorUnits,
      taxesMinor: component.price.customerPayableTaxes.minorUnits, feesMinor: component.price.customerPayableFees.minorUnits,
      finalCustomerMinor: component.price.finalCustomerAmount.minorUnits })),
    totals: { supplierMinor: snapshot.price.supplierTotal.minorUnits, marginMinor: snapshot.price.platformMarginTotal.minorUnits,
      taxesMinor: snapshot.price.customerPayableTaxesTotal.minorUnits, feesMinor: snapshot.price.customerPayableFeesTotal.minorUnits,
      finalCustomerMinor: snapshot.price.finalCustomerTotal.minorUnits }, calculatedAt: snapshot.price.checkedAt };
}
