import { sql, type Kysely } from "kysely";

import { readOwnedTripVersion } from "@/domain/trip/read";
import { decodeTripSnapshot } from "@/domain/trip/schema";
import { AuthorizationError } from "@/server/auth/authorize";
import { resolveBookingActor } from "@/server/auth/planning-actor";

import type { Database } from "@/server/db/database";

export async function readPricingDiagnostic(
  database: Kysely<Database>,
  userId: string,
  tripId: string,
  version: number,
) {
  const role = await sql<{
    internalTeamRole: string | null;
  }>`SELECT internal_team_role AS "internalTeamRole"
    FROM app."user" WHERE id = ${userId}`.execute(database);
  if (!["pricing_auditor", "administrator"].includes(role.rows[0]?.internalTeamRole ?? "")) {
    throw new AuthorizationError("FORBIDDEN");
  }
  const actor = await resolveBookingActor(database, tripId, userId);
  const stored = await readOwnedTripVersion(database, actor.planningOwnerId, tripId, version);
  const snapshot = decodeTripSnapshot(stored.schemaVersion, stored.snapshot).snapshot;
  return {
    tripId,
    tripVersion: version,
    currency: snapshot.price.currency,
    components: snapshot.components.map((component) => ({
      componentId: component.id,
      // null means the supplier did not establish that part; it is never reported as zero.
      supplierMinor: component.price.supplierAmount?.minorUnits ?? null,
      marginMinor: component.price.platformMargin?.minorUnits ?? null,
      taxesMinor: component.price.customerPayableTaxes?.minorUnits ?? null,
      feesMinor: component.price.customerPayableFees?.minorUnits ?? null,
      finalCustomerMinor: component.price.finalCustomerAmount.minorUnits,
    })),
    totals: {
      supplierMinor: snapshot.price.supplierTotal?.minorUnits ?? null,
      marginMinor: snapshot.price.platformMarginTotal?.minorUnits ?? null,
      taxesMinor: snapshot.price.customerPayableTaxesTotal?.minorUnits ?? null,
      feesMinor: snapshot.price.customerPayableFeesTotal?.minorUnits ?? null,
      finalCustomerMinor: snapshot.price.finalCustomerTotal.minorUnits,
    },
    calculatedAt: snapshot.price.checkedAt,
  };
}
