import "server-only";

import { CamelCasePlugin, type ColumnType, type Generated, Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

import type { TripCoreDatabase } from "@/server/db/types";

declare const geographyPoint4326Brand: unique symbol;
declare const geographyRoute4326Brand: unique symbol;

export type GeographyPoint4326 = string & {
  readonly [geographyPoint4326Brand]: true;
};

export type GeographyRoute4326 = string & {
  readonly [geographyRoute4326Brand]: true;
};

type GeographyColumn<Value> = ColumnType<Value, string, string>;

export interface SpatialPlaceTable {
  entityType: string;
  entityId: string;
  location: GeographyColumn<GeographyPoint4326>;
  createdAt: Generated<Date>;
}

export interface SpatialRouteTable {
  entityType: string;
  entityId: string;
  route: GeographyColumn<GeographyRoute4326>;
  createdAt: Generated<Date>;
}

export interface Database extends TripCoreDatabase {
  spatialPlaces: SpatialPlaceTable;
  spatialRoutes: SpatialRouteTable;
}

export interface DatabaseConnectionOptions {
  connectionString: string;
  applicationName?: string;
  maxConnections?: number;
}

export function createDatabase({
  connectionString,
  applicationName = "onholidai-web",
  maxConnections = 10,
}: DatabaseConnectionOptions): Kysely<Database> {
  const pool = new Pool({
    application_name: applicationName,
    connectionString,
    max: maxConnections,
  });

  const connection = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin()],
  }).withSchema("app");

  let closing: Promise<void> | undefined;
  // Kysely initializes its driver lazily, so destroying an instance that has not
  // run a query would leave the owned pool open. Release the pool explicitly.
  connection.destroy = () => (closing ??= pool.end());

  return connection;
}
