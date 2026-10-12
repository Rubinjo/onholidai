import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createServiceAuthorization,
  createServiceToken,
  type ServiceTokenContext,
  verifyServiceToken,
} from "../../server/agent-client/credentials";

interface TokenFixture {
  secret: string;
  issuedAt: number;
  ttlSeconds: number;
  audience: "agent";
  context: ServiceTokenContext;
  scopes: ["trip:read", "context:read", "proposal:create"];
  expectedToken: string;
}

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), "../contracts/agent-api/service-token.fixture.json"),
    "utf8",
  ),
) as TokenFixture;

function fixtureToken(): string {
  return createServiceToken({
    secret: fixture.secret,
    audience: fixture.audience,
    ...fixture.context,
    scopes: fixture.scopes,
    ttlSeconds: fixture.ttlSeconds,
    issuedAt: fixture.issuedAt,
  });
}

function signUnsafe(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  );
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${header}.${encodedPayload}`;
  const signature = createHmac("sha256", fixture.secret)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

const verifyOptions = {
  secret: fixture.secret,
  expectedAudience: fixture.audience,
  expectedContext: fixture.context,
  requiredScopes: ["trip:read"] as const,
  now: fixture.issuedAt + 1,
};

describe("internal service credentials", () => {
  it("round-trips the deterministic cross-language fixture", () => {
    const token = fixtureToken();
    const claims = verifyServiceToken(token, verifyOptions);

    expect(token).toBe(fixture.expectedToken);
    expect(claims).toMatchObject({
      aud: "agent",
      ...fixture.context,
      scopes: fixture.scopes,
    });
  });

  it("rejects tampering, expiry, and the wrong audience", () => {
    const token = fixtureToken();
    const replacement = token.endsWith("A") ? "B" : "A";

    expect(() => verifyServiceToken(`${token.slice(0, -1)}${replacement}`, verifyOptions)).toThrow(
      "signature",
    );
    expect(() =>
      verifyServiceToken(token, { ...verifyOptions, now: fixture.issuedAt + fixture.ttlSeconds }),
    ).toThrow("expired");
    expect(() =>
      verifyServiceToken(token, {
        ...verifyOptions,
        expectedAudience: "web",
        requiredScopes: ["run:write"],
      }),
    ).toThrow("audience");
  });

  it("rejects unknown, missing, and insufficient scopes by default", () => {
    const claims = {
      aud: fixture.audience,
      exp: fixture.issuedAt + fixture.ttlSeconds,
      iat: fixture.issuedAt,
      ...fixture.context,
    };

    expect(() => verifyServiceToken(signUnsafe({ ...claims, scopes: ["admin"] }), verifyOptions)).toThrow(
      "unknown scope",
    );
    expect(() => verifyServiceToken(signUnsafe(claims), verifyOptions)).toThrow("claims");
    const limitedToken = createServiceToken({
      secret: fixture.secret,
      audience: fixture.audience,
      ...fixture.context,
      scopes: ["trip:read"],
      ttlSeconds: fixture.ttlSeconds,
      issuedAt: fixture.issuedAt,
    });
    expect(() =>
      verifyServiceToken(limitedToken, {
        ...verifyOptions,
        requiredScopes: ["context:read"],
      }),
    ).toThrow("insufficient");
  });

  it("binds every context field and creates no browser cookie header", () => {
    expect(() =>
      verifyServiceToken(fixtureToken(), {
        ...verifyOptions,
        expectedContext: { ...fixture.context, baseTripVersion: 8 },
      }),
    ).toThrow("baseTripVersion context");

    const authorization = createServiceAuthorization({
      secret: fixture.secret,
      audience: fixture.audience,
      ...fixture.context,
      scopes: fixture.scopes,
      issuedAt: fixture.issuedAt,
    });
    expect(Object.keys(authorization)).toEqual(["authorization"]);
    expect(authorization.authorization).toMatch(/^Bearer /);
    expect(authorization).not.toHaveProperty("cookie");
  });

  it("enforces the five-minute lifetime bound", () => {
    expect(() =>
      createServiceToken({
        secret: fixture.secret,
        audience: fixture.audience,
        ...fixture.context,
        scopes: fixture.scopes,
        ttlSeconds: 301,
      }),
    ).toThrow("between 1 and 300");
  });
});