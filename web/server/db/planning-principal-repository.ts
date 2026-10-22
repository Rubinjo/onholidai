import { randomUUID } from "node:crypto";

import { inTransaction } from "./transaction";

import type { Kysely } from "kysely";
import type { Database } from "./database";
import type { PlanningIdentity } from "@/server/auth/planning-actor";

export async function defaultAccountPrincipal(
  database: Kysely<Database>,
  accountUserId: string,
): Promise<string> {
  await database
    .insertInto("planningPrincipals")
    .values({
      id: accountUserId,
      accountUserId,
      guestSessionId: null,
      originKind: "account",
      isDefault: true,
      linkedAt: null,
    })
    .onConflict((conflict) => conflict.column("id").doNothing())
    .execute();
  return accountUserId;
}
export async function allocateWizardPrincipal(
  database: Kysely<Database>,
  identity: PlanningIdentity,
): Promise<string> {
  return inTransaction(database, async (transaction) => {
    if ((identity.accountUserId !== null) === (identity.guestSessionId !== null))
      throw new Error("Exactly one wizard authority is required");
    const id = randomUUID();
    await transaction
      .insertInto("planningPrincipals")
      .values({
        id,
        accountUserId: identity.accountUserId,
        guestSessionId: identity.guestSessionId,
        originKind: identity.accountUserId ? "account" : "guest",
        isDefault: false,
        linkedAt: null,
      })
      .execute();
    return id;
  });
}
