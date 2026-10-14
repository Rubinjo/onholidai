import "server-only";

import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { CamelCasePlugin, Kysely, PostgresDialect } from "kysely";
import type { Pool } from "pg";

import type { ServerConfig } from "@/server/config";

export function createAuth(config: ServerConfig, pool: Pool) {
  return betterAuth({
    appName: "Onholidai",
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.BETTER_AUTH_URL],
    database: {
      // The auth tables use snake_case columns; the plugin must rename the
      // identifiers the adapter sends so its schema check and queries match.
      db: new Kysely({
        dialect: new PostgresDialect({ pool }),
        plugins: [new CamelCasePlugin()],
      }),
      schemaName: "app",
      type: "postgres",
    },
    advanced: {
      database: {
        // The auth id columns are plain text without a database default, so the
        // application must generate the identifier. Ask for UUIDs explicitly.
        generateId: () => crypto.randomUUID(),
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
}

export type ApplicationAuth = ReturnType<typeof createAuth>;
export type AuthSession = ApplicationAuth["$Infer"]["Session"];
export type AuthUser = AuthSession["user"];

export async function getSession(auth: ApplicationAuth, requestHeaders: Headers): Promise<AuthSession | null> {
  return auth.api.getSession({ headers: requestHeaders });
}

export async function signInWithEmail(auth: ApplicationAuth, email: string, password: string, requestHeaders: Headers) {
  return auth.api.signInEmail({
    body: { email, password },
    headers: requestHeaders,
  });
}

export async function signOut(auth: ApplicationAuth, requestHeaders: Headers) {
  return auth.api.signOut({ headers: requestHeaders });
}

export async function signUpWithEmail(auth: ApplicationAuth, name: string, email: string, password: string, requestHeaders: Headers) {
  return auth.api.signUpEmail({ body: { name, email, password, locale: "en-GB", defaultCurrency: "GBP" }, headers: requestHeaders });
}
