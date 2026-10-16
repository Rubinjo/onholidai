import { createHmac, timingSafeEqual } from "node:crypto";

export const SERVICE_TOKEN_DEFAULT_TTL_SECONDS = 60;
export const SERVICE_TOKEN_MAX_TTL_SECONDS = 300;

export type ServiceAudience = "agent" | "web";
export type ServiceScope =
  | "context:read"
  | "proposal:create"
  | "pricing:read"
  | "run:write"
  | "trip:read";

export interface ServiceTokenContext {
  readonly userId: string;
  readonly tripId: string;
  readonly requestId: string;
  readonly baseTripVersion: number;
}

export interface ServiceTokenClaims extends ServiceTokenContext {
  readonly aud: ServiceAudience;
  readonly exp: number;
  readonly iat: number;
  readonly scopes: readonly ServiceScope[];
}

interface CreateServiceTokenOptions extends ServiceTokenContext {
  readonly audience: ServiceAudience;
  readonly scopes: readonly ServiceScope[];
  readonly secret: string;
  readonly ttlSeconds?: number;
  readonly issuedAt?: number;
}

interface VerifyServiceTokenOptions {
  readonly secret: string;
  readonly expectedAudience: ServiceAudience;
  readonly expectedContext: ServiceTokenContext;
  readonly requiredScopes: readonly ServiceScope[];
  readonly now?: number;
}

const AUDIENCE_SCOPES: Readonly<
  Record<ServiceAudience, ReadonlySet<ServiceScope>>
> = {
  agent: new Set(["trip:read", "context:read", "proposal:create"]),
  web: new Set(["run:write", "trip:read", "context:read", "proposal:create", "pricing:read"]),
};

const CLAIM_KEYS = new Set([
  "aud",
  "exp",
  "iat",
  "userId",
  "tripId",
  "requestId",
  "baseTripVersion",
  "scopes",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export class ServiceTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceTokenError";
  }
}

export function createServiceToken(options: CreateServiceTokenOptions): string {
  validateSecret(options.secret);
  validateContext(options);

  const issuedAt = options.issuedAt ?? Math.floor(Date.now() / 1000);
  const ttlSeconds = options.ttlSeconds ?? SERVICE_TOKEN_DEFAULT_TTL_SECONDS;
  validateEpochSeconds(issuedAt, "issuedAt");
  validateTtl(ttlSeconds);
  const scopes = validateScopes(options.scopes, options.audience);

  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson({
    aud: options.audience,
    exp: issuedAt + ttlSeconds,
    iat: issuedAt,
    userId: options.userId,
    tripId: options.tripId,
    requestId: options.requestId,
    baseTripVersion: options.baseTripVersion,
    scopes,
  });
  const signingInput = `${header}.${payload}`;
  const signature = sign(signingInput, options.secret);

  return `${signingInput}.${signature}`;
}

// Match the Python callback transport's bounded issuance margin. Validators stay
// strict; actual validity is one second shorter, never extended by clock leeway.
export function createAgentServiceToken(options: Omit<CreateServiceTokenOptions, "audience" | "issuedAt">): string {
  return createServiceToken({ ...options, audience: "agent", issuedAt: Math.floor(Date.now() / 1000) - 1 });
}

export function createServiceAuthorization(
  options: CreateServiceTokenOptions,
): Readonly<{ authorization: `Bearer ${string}` }> {
  return Object.freeze({
    authorization: `Bearer ${createServiceToken(options)}`,
  });
}

export function verifyServiceToken(
  token: string,
  options: VerifyServiceTokenOptions,
): ServiceTokenClaims {
  validateSecret(options.secret);
  if (token.length === 0 || token.length > 4096) {
    throw new ServiceTokenError("Service token has an invalid length");
  }

  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new ServiceTokenError("Service token must have three segments");
  }
  const [headerSegment, payloadSegment, signatureSegment] = segments;
  if (!headerSegment || !payloadSegment || !signatureSegment) {
    throw new ServiceTokenError("Service token contains an empty segment");
  }

  const expectedSignature = signBytes(
    `${headerSegment}.${payloadSegment}`,
    options.secret,
  );
  const suppliedSignature = decodeSegment(signatureSegment);
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new ServiceTokenError("Service token signature is invalid");
  }

  const header = decodeJsonObject(headerSegment, "header");
  if (
    Object.keys(header).length !== 2 ||
    header.alg !== "HS256" ||
    header.typ !== "JWT"
  ) {
    throw new ServiceTokenError("Service token header is invalid");
  }

  const claims = parseClaims(decodeJsonObject(payloadSegment, "payload"));
  const now = options.now ?? Math.floor(Date.now() / 1000);
  validateEpochSeconds(now, "now");
  if (claims.aud !== options.expectedAudience) {
    throw new ServiceTokenError("Service token audience is invalid");
  }
  if (claims.exp <= now) {
    throw new ServiceTokenError("Service token has expired");
  }
  if (claims.iat > now) {
    throw new ServiceTokenError("Service token is not yet valid");
  }
  if (
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > SERVICE_TOKEN_MAX_TTL_SECONDS
  ) {
    throw new ServiceTokenError("Service token lifetime is invalid");
  }
  validateContext(options.expectedContext);
  for (const key of [
    "userId",
    "tripId",
    "requestId",
    "baseTripVersion",
  ] as const) {
    if (claims[key] !== options.expectedContext[key]) {
      throw new ServiceTokenError(`Service token ${key} context is invalid`);
    }
  }

  // An empty requirement is meaningful: signature, audience and context are still
  // proven here, and the handler enforces its own scope through internalActor.
  const requiredScopes = options.requiredScopes.length === 0 ? [] : validateScopes(
    options.requiredScopes,
    options.expectedAudience,
  );
  if (requiredScopes.some((scope) => !claims.scopes.includes(scope))) {
    throw new ServiceTokenError("Service token scope is insufficient");
  }

  return claims;
}

function parseClaims(value: Record<string, unknown>): ServiceTokenClaims {
  const keys = Object.keys(value);
  if (keys.length !== CLAIM_KEYS.size || keys.some((key) => !CLAIM_KEYS.has(key))) {
    throw new ServiceTokenError("Service token claims are invalid");
  }
  if (value.aud !== "agent" && value.aud !== "web") {
    throw new ServiceTokenError("Service token audience is invalid");
  }
  validateEpochSeconds(value.exp, "exp");
  validateEpochSeconds(value.iat, "iat");
  const context = {
    userId: value.userId,
    tripId: value.tripId,
    requestId: value.requestId,
    baseTripVersion: value.baseTripVersion,
  };
  validateContext(context);
  const scopes = validateScopes(value.scopes, value.aud);

  return {
    aud: value.aud,
    exp: value.exp,
    iat: value.iat,
    ...context,
    scopes,
  };
}

function validateContext(value: unknown): asserts value is ServiceTokenContext {
  if (!isObject(value)) {
    throw new ServiceTokenError("Service token context is invalid");
  }
  for (const key of ["userId", "tripId", "requestId"] as const) {
    if (typeof value[key] !== "string" || !UUID_PATTERN.test(value[key])) {
      throw new ServiceTokenError(`Service token ${key} must be a UUID`);
    }
  }
  if (
    typeof value.baseTripVersion !== "number" ||
    !Number.isSafeInteger(value.baseTripVersion) ||
    value.baseTripVersion < 1
  ) {
    throw new ServiceTokenError(
      "Service token baseTripVersion must be a positive integer",
    );
  }
}

function validateScopes(
  value: unknown,
  audience: ServiceAudience,
): ServiceScope[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ServiceTokenError("Service token scopes must not be empty");
  }
  const allowedScopes = AUDIENCE_SCOPES[audience];
  const scopes: ServiceScope[] = [];
  for (const scope of value) {
    if (typeof scope !== "string" || !allowedScopes.has(scope as ServiceScope)) {
      throw new ServiceTokenError("Service token contains an unknown scope");
    }
    if (scopes.includes(scope as ServiceScope)) {
      throw new ServiceTokenError("Service token scopes must be unique");
    }
    scopes.push(scope as ServiceScope);
  }
  return scopes;
}

function validateSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new ServiceTokenError("Service token secret must be at least 32 bytes");
  }
}

function validateTtl(ttlSeconds: number): void {
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < 1 ||
    ttlSeconds > SERVICE_TOKEN_MAX_TTL_SECONDS
  ) {
    throw new ServiceTokenError(
      `Service token TTL must be between 1 and ${SERVICE_TOKEN_MAX_TTL_SECONDS} seconds`,
    );
  }
}

function validateEpochSeconds(
  value: unknown,
  name: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ServiceTokenError(`Service token ${name} must be epoch seconds`);
  }
}

function encodeJson(value: object): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJsonObject(segment: string, name: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(decodeSegment(segment).toString("utf8"));
    if (!isObject(value)) {
      throw new ServiceTokenError(`Service token ${name} must be an object`);
    }
    return value;
  } catch (error) {
    if (error instanceof ServiceTokenError) {
      throw error;
    }
    throw new ServiceTokenError(`Service token ${name} is invalid JSON`);
  }
}

function decodeSegment(segment: string): Buffer {
  if (!BASE64URL_PATTERN.test(segment)) {
    throw new ServiceTokenError("Service token encoding is invalid");
  }
  const decoded = Buffer.from(segment, "base64url");
  if (decoded.toString("base64url") !== segment) {
    throw new ServiceTokenError("Service token encoding is not canonical");
  }
  return decoded;
}

function sign(signingInput: string, secret: string): string {
  return signBytes(signingInput, secret).toString("base64url");
}

function signBytes(signingInput: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(signingInput, "ascii").digest();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
