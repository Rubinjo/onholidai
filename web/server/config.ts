import "server-only";

import { z } from "zod";

const serverConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PROVIDER_MODE: z.enum(["deterministic", "live"]).default("deterministic"),
    DATABASE_URL: z
      .url()
      .default("postgresql://onholidai_web:onholidai@localhost:5432/onholidai"),
    BETTER_AUTH_SECRET: z.string().min(32).default("synthetic-development-secret-000000"),
    BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
    AGENT_BASE_URL: z.url().default("http://localhost:8000"),
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
  return serverConfigSchema.parse(environment);
}
