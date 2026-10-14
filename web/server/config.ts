import "server-only";

import { z } from "zod";

const serverConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PROVIDER_MODE: z.enum(["deterministic", "live"]).default("deterministic"),
    GUEST_MAX_ACTIVE_RUNS: z.coerce.number().int().min(1).max(20).default(2),
    GUEST_MAX_RUNS_PER_HOUR: z.coerce.number().int().min(1).max(100).default(10),
    GUEST_MAX_SESSIONS_PER_HOUR: z.coerce.number().int().min(1).max(200).default(20),
    GUEST_NETWORK_SECRET: z.string().min(32).optional(),
    GUEST_TRUST_PROXY_IP: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
    DATABASE_URL: z
      .url()
      .default("postgresql://onholidai_web:onholidai@localhost:5432/onholidai"),
    BETTER_AUTH_SECRET: z.string().min(32).default("synthetic-development-secret-000000"),
    BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
    AGENT_BASE_URL: z.url().default("http://localhost:8000"),
    SERVICE_TOKEN_SECRET: z.string().min(32).default("synthetic-local-service-secret-000000000"),
    PRICING_DIAGNOSTIC_SECRET: z.string().min(32).default("synthetic-local-pricing-secret-000000000"),
    TEMPORAL_ADDRESS: z.string().default("localhost:7233"),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    TRAVEL_PROVIDER_API_KEY: z.string().optional(),
  })
  .superRefine((config, context) => {
    if (config.PROVIDER_MODE === "live" && !config.TRAVEL_PROVIDER_API_KEY) {
      context.addIssue({
        code: "custom",
        path: ["TRAVEL_PROVIDER_API_KEY"],
        message: "Required when PROVIDER_MODE is live",
      });
    }
  });

export type ServerConfig = z.infer<typeof serverConfigSchema>;

export function loadServerConfig(environment: Record<string, string | undefined>): ServerConfig {
  if (environment.NODE_ENV === "production") {
    for (const key of ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "SERVICE_TOKEN_SECRET", "PRICING_DIAGNOSTIC_SECRET"] as const) {
      if (!environment[key] || environment[key]?.startsWith("synthetic")) {
        throw new Error(`Production requires explicit ${key}`);
      }
    }
  }
  const config = serverConfigSchema.parse(environment);
  if (config.SERVICE_TOKEN_SECRET === config.PRICING_DIAGNOSTIC_SECRET) {
    throw new Error("Pricing diagnostics require an independent signing secret");
  }
  return config;
}
