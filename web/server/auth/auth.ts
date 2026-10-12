import "server-only";

import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { PostgresDialect } from "kysely";
import { headers } from "next/headers";
import { Pool } from "pg";

import { serverConfig } from "@/server/config";

const authPool = new Pool({
  application_name: "onholidai-auth",
  connectionString: serverConfig.DATABASE_URL,
  max: 10,
});

export const auth = betterAuth({
  appName: "Onholidai",
  baseURL: serverConfig.BETTER_AUTH_URL,
  secret: serverConfig.BETTER_AUTH_SECRET,
  trustedOrigins: [serverConfig.BETTER_AUTH_URL],
  database: {
    casing: "snake",
    dialect: new PostgresDialect({ pool: authPool }),
    schemaName: "app",
    type: "postgres",
  },
  advanced: {
    database: {
      generateId: "uuid",
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      locale: {
        defaultValue: "en-GB",
        required: true,
        type: "string",
      },
      defaultCurrency: {
        defaultValue: "GBP",
        required: true,
        type: "string",
      },
      internalTeamRole: {
        input: false,
        required: false,
        type: "string",
      },
    },
  },
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
export type AuthUser = AuthSession["user"];

export async function getSession(): Promise<AuthSession | null> {
  return auth.api.getSession({ headers: await headers() });
}

export async function signInWithEmail(email: string, password: string) {
  return auth.api.signInEmail({
    body: { email, password },
    headers: await headers(),
  });
}

export async function signOut() {
  return auth.api.signOut({ headers: await headers() });
}