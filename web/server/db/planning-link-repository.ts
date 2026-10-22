import type { Kysely } from "kysely";
import type { Database } from "./database";

export class PlanningLinkRepository {
  constructor(private readonly database: Kysely<Database>) {}
  receipt(planningOwnerId: string) {
    return this.database
      .selectFrom("planningAccountLinks")
      .selectAll()
      .where("planningOwnerId", "=", planningOwnerId)
      .executeTakeFirst();
  }
  intent(intentId: string) {
    return this.database
      .selectFrom("bookingIntents")
      .selectAll()
      .where("id", "=", intentId)
      .executeTakeFirst();
  }
}
