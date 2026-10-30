import { migrationStatus, type MigrationStatus } from "@/server/db/migrate";

export const dynamic = "force-dynamic";

type HealthMigrations =
  | MigrationStatus
  | {
      readable: false;
      problem: "unreachable";
      applied: number;
      expected: number;
      pending: readonly [];
      current: boolean;
    };

async function migrations(): Promise<HealthMigrations | null> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  try {
    return await migrationStatus(connectionString);
  } catch {
    return {
      readable: false,
      problem: "unreachable",
      applied: 0,
      expected: 0,
      pending: [],
      current: false,
    };
  }
}

export async function GET(): Promise<Response> {
  const status = await migrations();
  // A database behind this checkout rejects writes its own code now issues, so the
  // service reports itself unusable instead of failing one planning run at a time.
  const degraded =
    status?.problem === "behind" ||
    status?.problem === "history_mismatch" ||
    status?.problem === "unreachable";
  return Response.json(
    { status: degraded ? "degraded" : "ok", service: "web", migrations: status },
    { status: degraded ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
