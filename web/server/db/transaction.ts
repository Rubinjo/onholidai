import type { Kysely, Transaction } from "kysely";
import type { Database } from "./database";

// Domain primitives compose inside one existing transaction; never open nested transactions.
export function inTransaction<T>(
  database: Kysely<Database>,
  action: (transaction: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return database.isTransaction
    ? action(database as Transaction<Database>)
    : database.transaction().execute(action);
}
