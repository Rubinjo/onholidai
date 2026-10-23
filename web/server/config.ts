import "server-only";

import { z } from "zod";

export const SUPPLIER_PROVIDER_IDS = ["duffel", "nuitee", "viator"] as const;
export const SUPPLIER_OPERATIONS = [
  "search",
  "detail",
  "revalidation",
  "book",
  "status",
  "idempotency",
  "cancel",
  "reschedule",
] as const;
export type SupplierProviderId = (typeof SUPPLIER_PROVIDER_IDS)[number];
export type SupplierOperation = (typeof SUPPLIER_OPERATIONS)[number];
export type SupplierProduct = "flight" | "accommodation" | "activity";

const operationConfigSchema = z
  .object({
    support: z.enum(["supported", "unsupported", "unknown"]).default("unknown"),
    access: z
      .enum(["unconfigured", "configured_unverified", "verified", "blocked"])
      .default("unconfigured"),
    evidenceRef: z.string().trim().min(1).max(256).nullable().default(null),
    verifiedAt: z.iso.datetime().nullable().default(null),
    environment: z.enum(["sandbox", "production"]).optional(),
  })
  .strict();
const secretReferenceSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/);
const operationsConfigSchema = z.partialRecord(z.enum(SUPPLIER_OPERATIONS), operationConfigSchema);
const productConfigSchema = z.object({ operations: operationsConfigSchema.default({}) }).strict();
const providerConfigFields = {
  readSecretRef: secretReferenceSchema.optional(),
  transactionSecretRef: secretReferenceSchema.optional(),
  operations: operationsConfigSchema.default({}),
};
const duffelConfigSchema = z
  .object({
    ...providerConfigFields,
    products: z
      .object({
        flight: productConfigSchema.optional(),
        accommodation: productConfigSchema.optional(),
      })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((provider, context) => {
    if (provider.readSecretRef && provider.readSecretRef === provider.transactionSecretRef) {
      context.addIssue({
        code: "custom",
        path: ["transactionSecretRef"],
        message: "Duffel read and transaction secret references must be separate",
      });
    }
  });
const viatorConfigSchema = z
  .object({
    ...providerConfigFields,
    products: z.object({ activity: productConfigSchema.optional() }).strict().default({}),
  })
  .strict();
const nuiteeConfigSchema = z
  .object({
    ...providerConfigFields,
    products: z.object({ accommodation: productConfigSchema.optional() }).strict().default({}),
  })
  .strict();
const providersConfigSchema = z
  .preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    },
    z
      .object({
        duffel: duffelConfigSchema.optional(),
        nuitee: nuiteeConfigSchema.optional(),
        viator: viatorConfigSchema.optional(),
      })
      .strict(),
  )
  .default({});

const serverConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PROVIDER_MODE: z.enum(["deterministic", "live"]).default("deterministic"),
  VIATOR_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  NUITEE_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  GUEST_MAX_ACTIVE_RUNS: z.coerce.number().int().min(1).max(20).default(2),
  GUEST_MAX_RUNS_PER_HOUR: z.coerce.number().int().min(1).max(100).default(10),
  GUEST_MAX_SESSIONS_PER_HOUR: z.coerce.number().int().min(1).max(200).default(20),
  GUEST_NETWORK_SECRET: z.string().min(32).optional(),
  GUEST_TRUST_PROXY_IP: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  DATABASE_URL: z.url().default("postgresql://onholidai_web:onholidai@localhost:5432/onholidai"),
  BETTER_AUTH_SECRET: z.string().min(32).default("synthetic-development-secret-000000"),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  AGENT_BASE_URL: z.url().default("http://localhost:8000"),
  SERVICE_TOKEN_SECRET: z.string().min(32).default("synthetic-local-service-secret-000000000"),
  PRICING_DIAGNOSTIC_SECRET: z.string().min(32).default("synthetic-local-pricing-secret-000000000"),
  TEMPORAL_ADDRESS: z.string().default("localhost:7233"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  SUPPLIER_PROVIDERS: providersConfigSchema,
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

export interface ProviderOperationReadiness {
  support: z.infer<typeof operationConfigSchema>["support"];
  access: z.infer<typeof operationConfigSchema>["access"];
  verifiedAt: string | null;
  safeReason: string;
}
export interface ProductReadiness {
  operations: Record<SupplierOperation, ProviderOperationReadiness>;
}
export interface ProviderReadiness<Product extends SupplierProduct> {
  provider: SupplierProviderId;
  mode: ServerConfig["PROVIDER_MODE"];
  products: Record<Product, ProductReadiness>;
}
export interface SupplierReadiness {
  duffel: ProviderReadiness<"flight" | "accommodation">;
  nuitee: ProviderReadiness<"accommodation">;
  viator: ProviderReadiness<"activity">;
}

export function deriveProviderReadiness(
  config: ServerConfig,
  environment: Readonly<Record<string, string | undefined>>,
  audience: "web" | "worker" = "web",
): SupplierReadiness {
  function productReadiness(
    declaration: { readSecretRef?: string; transactionSecretRef?: string } | undefined,
    declaredOperations: z.infer<typeof operationsConfigSchema> | undefined,
    evidenceEnvironment?: ServerConfig["NUITEE_ENVIRONMENT"],
    legacyStays = false,
  ): ProductReadiness {
    const operations = Object.fromEntries(
      SUPPLIER_OPERATIONS.map((operation) => {
        const declared = declaredOperations?.[operation];
        const read = ["search", "detail", "revalidation"].includes(operation);
        if (
          (legacyStays && operation !== "status") ||
          (evidenceEnvironment &&
            ["revalidation", "book", "cancel", "reschedule"].includes(operation))
        ) {
          return [
            operation,
            {
              support: "unsupported",
              access: "blocked",
              verifiedAt: null,
              safeReason: legacyStays
                ? "Duffel stays is inactive; saved evidence and approved status reads remain available."
                : "Final stay revalidation and transactions require an established safe exact-terms path.",
            } satisfies ProviderOperationReadiness,
          ];
        }
        const secretReference = read
          ? declaration?.readSecretRef
          : declaration?.transactionSecretRef;
        const configured =
          (read ? audience === "web" : audience === "worker") &&
          Boolean(secretReference && environment[secretReference]?.trim());
        const demonstrationSearch =
          config.PROVIDER_MODE === "deterministic" && operation === "search";
        const support = demonstrationSearch ? "supported" : (declared?.support ?? "unknown");
        let access: ProviderOperationReadiness["access"] = "unconfigured";
        if (demonstrationSearch && audience === "web") access = "configured_unverified";
        else if (declared?.access === "blocked") access = "blocked";
        else if (configured) {
          access =
            support !== "supported"
              ? "blocked"
              : config.PROVIDER_MODE === "live" &&
                  declared?.access === "verified" &&
                  (!evidenceEnvironment || declared.environment === evidenceEnvironment) &&
                  declared.evidenceRef &&
                  declared.verifiedAt
                ? "verified"
                : "configured_unverified";
        }
        return [
          operation,
          {
            support,
            access,
            verifiedAt: access === "verified" ? (declared?.verifiedAt ?? null) : null,
            safeReason:
              config.PROVIDER_MODE === "deterministic"
                ? "Demonstration mode; live access is not verified."
                : access === "verified"
                  ? "Operation access has recorded verification evidence."
                  : access === "unconfigured"
                    ? "Operation credentials are unavailable in this process."
                    : access === "blocked"
                      ? "Operation access or support is blocked."
                      : "Operation access requires verification evidence.",
          } satisfies ProviderOperationReadiness,
        ];
      }),
    ) as Record<SupplierOperation, ProviderOperationReadiness>;
    return { operations };
  }
  const { duffel, nuitee, viator } = config.SUPPLIER_PROVIDERS;
  return {
    duffel: {
      provider: "duffel",
      mode: config.PROVIDER_MODE,
      products: {
        // Existing provider-level Duffel declarations describe Flights, never Stays.
        flight: productReadiness(duffel, duffel?.products.flight?.operations ?? duffel?.operations),
        accommodation: productReadiness(
          duffel,
          duffel?.products.accommodation?.operations,
          undefined,
          true,
        ),
      },
    },
    nuitee: {
      provider: "nuitee",
      mode: config.PROVIDER_MODE,
      products: {
        accommodation: productReadiness(
          nuitee,
          nuitee?.products.accommodation?.operations ?? nuitee?.operations,
          config.NUITEE_ENVIRONMENT,
        ),
      },
    },
    viator: {
      provider: "viator",
      mode: config.PROVIDER_MODE,
      products: {
        activity: productReadiness(
          viator,
          viator?.products.activity?.operations ?? viator?.operations,
        ),
      },
    },
  };
}

export function loadServerConfig(environment: Record<string, string | undefined>): ServerConfig {
  if (environment.NODE_ENV === "production") {
    for (const key of [
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "SERVICE_TOKEN_SECRET",
      "PRICING_DIAGNOSTIC_SECRET",
    ] as const) {
      if (!environment[key] || environment[key]?.startsWith("synthetic")) {
        throw new Error(`Production requires explicit ${key}`);
      }
    }
  }
  const config = serverConfigSchema.parse(environment);
  const duffel = config.SUPPLIER_PROVIDERS.duffel;
  const duffelReadKey = duffel?.readSecretRef
    ? environment[duffel.readSecretRef]?.trim()
    : undefined;
  const duffelWriteKey = duffel?.transactionSecretRef
    ? environment[duffel.transactionSecretRef]?.trim()
    : undefined;
  if (duffelReadKey && duffelWriteKey && duffelReadKey === duffelWriteKey) {
    throw new Error("Duffel read and transaction keys must be separate");
  }
  if (config.SERVICE_TOKEN_SECRET === config.PRICING_DIAGNOSTIC_SECRET) {
    throw new Error("Pricing diagnostics require an independent signing secret");
  }
  return config;
}
