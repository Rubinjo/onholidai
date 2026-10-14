import { z } from "zod";

import { type Application, getApplication } from "./application";
import { getSession } from "./auth/auth";
import { type PlanningActor, resolvePlanningActor } from "./auth/planning-actor";
import { AuthorizationError, requireSession } from "./auth/authorize";
import { planningCredential, readPlanningSession } from "./auth/planning-session";
import { type ServiceScope, verifyServiceToken, ServiceTokenError } from "./agent-client/credentials";
import { ProblemError, problemResponse } from "./errors";
import { getOrCreateCorrelationId } from "./telemetry";
import { emitOperationSpan, routeTemplate } from "./telemetry-exporter";
import { inTransaction } from "./db/transaction";
import { lockPlanningAccess, lockPlanningTrip } from "./db/planning-access";
import { resourceActor, lockServiceGrant } from "./auth/planning-resource";
import { planningNotFound } from "./auth/planning-actor";
import { renewPlanningSession, planningCookie } from "./auth/planning-session";
import { resolveBookingActor } from "./auth/planning-actor";
import { lockBookingTrip } from "./auth/booking-access";

export interface ApiDependencies {
  application: () => Application;
  session: typeof getSession;
}
const defaultDependencies: ApiDependencies = { application: getApplication, session: getSession };

function traceIdentity(request: Request): { traceId?: string; spanId?: string } {
  const traceparent = request.headers.get("traceparent")?.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/);
  return traceparent ? { traceId: traceparent[1], spanId: traceparent[2] } : {};
}

function emitRequestSpan(request: Request, correlationId: string, startedAt: Date, status: number): void {
  void emitOperationSpan({
    name: "http.server.request",
    startedAt,
    endedAt: new Date(),
    ...traceIdentity(request),
    outcome: status >= 500 ? "error" : "success",
    attributes: {
      "http.request.method": request.method,
      "http.route": routeTemplate(new URL(request.url).pathname),
      "http.response.status_code": status,
      "onholidai.correlation_id": correlationId,
      "onholidai.duration_ms": Date.now() - startedAt.getTime(),
      "onholidai.outcome": status >= 500 ? "error" : "success",
      "service.name": "onholidai-web",
    },
  });
}

export async function apiResponse(request: Request, action: (application: Application) => Promise<unknown>,
  options: { status?: number; dependencies?: ApiDependencies } = {}): Promise<Response> {
  const correlationId = getOrCreateCorrelationId(request.headers);
  const startedAt = new Date();
  try {
    const result = await action((options.dependencies ?? defaultDependencies).application());
    if (result instanceof Response) {
      result.headers.set("Cache-Control", "private, no-store");
      result.headers.set("x-correlation-id", correlationId);
      emitRequestSpan(request, correlationId, startedAt, result.status);
      return result;
    }
    const status = options.status ?? 200;
    emitRequestSpan(request, correlationId, startedAt, status);
    return Response.json(result, { status,
      headers: { "Cache-Control": "private, no-store", "x-correlation-id": correlationId } });
  } catch (error) {
    const safe = error instanceof z.ZodError || error instanceof SyntaxError
      ? new ProblemError({ title: "Invalid request", status: 422, code: "validation_error",
        ...(error instanceof z.ZodError ? { fieldErrors: error.issues.slice(0, 12).map((issue) => ({
          path: issue.path.some((part) => /supplier|margin|credential|password|payment/i.test(String(part))) ? "request" : issue.path.map(String).join(".").slice(0, 128) || "request",
          message: "Check this value and retry." })) } : {}) })
      : error instanceof AuthorizationError || error instanceof ServiceTokenError
        ? new ProblemError({ title: "Access denied", status: error instanceof AuthorizationError ? error.status : 401,
          code: error instanceof AuthorizationError ? error.code.toLowerCase() : "invalid_service_token" })
        : error;
    const response = problemResponse(safe, correlationId);
    response.headers.set("Cache-Control", "private, no-store");
    emitRequestSpan(request, correlationId, startedAt, response.status);
    return response;
  }
}

// Mutating browser requests must come from the configured application origin.
export function assertSameOrigin(application: Application, request: Request): void {
  if (!["GET", "HEAD"].includes(request.method)
    && request.headers.get("origin") !== new URL(application.config.BETTER_AUTH_URL).origin) {
    throw new AuthorizationError("FORBIDDEN");
  }
}

export async function browserUser(application: Application, request: Request, dependencies = defaultDependencies) {
  assertSameOrigin(application, request);
  return requireSession(await dependencies.session(application.auth, request.headers)).user;
}

export interface PlanningIdentity {
  accountUserId: string | null;
  guestSessionId: string | null;
}

export interface PlanningRequestContext {
  credential: string | null;
  identity: PlanningIdentity;
  production: boolean;
}

// Resolves the caller's current proof without requiring an account: a registered
// session and/or a live guest planning cookie. Identifiers in the request never
// authorize; this context must be proven against the resource principal.
export async function planningContext(application: Application, request: Request,
  dependencies = defaultDependencies): Promise<PlanningRequestContext> {
  const production = application.config.NODE_ENV === "production";
  const credential = planningCredential(request.headers, production);
  const [session, guestSession] = await Promise.all([
    dependencies.session(application.auth, request.headers),
    credential ? readPlanningSession(application.database, credential) : Promise.resolve(null),
  ]);
  return { credential, production,
    identity: { accountUserId: session?.user.id ?? null, guestSessionId: guestSession?.id ?? null } };
}

export async function requirePlanningActor(application: Application, request: Request, planningOwnerId: string,
  dependencies = defaultDependencies): Promise<PlanningActor> {
  assertSameOrigin(application, request);
  const { identity } = await planningContext(application, request, dependencies);
  return resolvePlanningActor(application.database, planningOwnerId, identity);
}

function planningReference(request: Request): { kind: "trip" | "run"; id: string } {
  const match = new URL(request.url).pathname.match(/^\/api\/v1\/(trips|agent-runs)\/([^/]+)(?:\/|$)/);
  if (!match) planningNotFound();
  return { kind: match[1] === "trips" ? "trip" : "run", id: z.uuid().parse(match[2]) };
}

export function draftApiResponse(request: Request, action: (application: Application) => Promise<unknown>) {
  return apiResponse(request, async (application) => {
    const result = await action(application);
    const response = result instanceof Response ? result : Response.json(result);
    const context = await planningContext(application, request);
    if (context.credential && await renewPlanningSession(application.database, context.credential)) {
      response.headers.set("Set-Cookie", planningCookie(context.credential, context.production));
    }
    return response;
  });
}
export async function planningUser(application: Application, request: Request) {
  assertSameOrigin(application, request);
  const reference = planningReference(request);
  const actor = await resourceActor(application.database, (await planningContext(application, request)).identity, reference.kind, reference.id);
  return { id: actor.planningOwnerId, actor };
}
export function planningApiResponse(request: Request, action: (application: Application) => Promise<unknown>, options: { status?: number } = {}) {
  return apiResponse(request, async (application) => {
    const { actor } = await planningUser(application, request);
    const result = await inTransaction(application.database, async (transaction) => {
      await lockPlanningAccess(transaction, actor);
      const reference = planningReference(request);
      const tripId = reference.kind === "trip" ? reference.id : (await transaction.selectFrom("agentRuns").select("tripId")
        .where("id", "=", reference.id).executeTakeFirstOrThrow()).tripId;
      await lockPlanningTrip(transaction, actor.planningOwnerId, tripId);
      return action({ ...application, database: transaction });
    });
    const response = result instanceof Response ? result : Response.json(result, { status: options.status ?? 200 });
    if (actor.kind === "guest") {
      const context = await planningContext(application, request);
      if (context.credential && await renewPlanningSession(application.database, context.credential)) {
        response.headers.set("Set-Cookie", planningCookie(context.credential, context.production));
      }
    }
    return response;
  });
}

// Route-level scope/context verification remains in each handler. This outer
// transaction additionally checks the live run grant before any private delivery.
export function internalPlanningApiResponse(request: Request, action: (application: Application) => Promise<unknown>) {
  return apiResponse(request, async (application) => {
    const authorization = request.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
    if (!token || token.length > 4096) throw new ServiceTokenError("Missing token");
    let untrusted: { userId: string; tripId: string; requestId: string; baseTripVersion: number };
    try {
      untrusted = z.object({ userId: z.uuid(), tripId: z.uuid(), requestId: z.uuid(), baseTripVersion: z.number().int().positive() })
        .passthrough().parse(JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")));
    } catch { throw new ServiceTokenError("Invalid token"); }
    const context = verifyServiceToken(token, { secret: application.config.SERVICE_TOKEN_SECRET, expectedAudience: "web",
      expectedContext: untrusted, requiredScopes: [] });
    return inTransaction(application.database, async (transaction) => {
      await lockServiceGrant(transaction, context);
      return action({ ...application, database: transaction });
    });
  });
}

export function bookingApiResponse(request: Request, action: (application: Application) => Promise<unknown>, options: { status?: number } = {}) {
  return apiResponse(request, async (application) => {
    const user = await browserUser(application, request);
    const path = new URL(request.url).pathname;
    let tripId: string;
    const trip = path.match(/^\/api\/v1\/trips\/([^/]+)\//), booking = path.match(/^\/api\/v1\/bookings\/([^/]+)/);
    if (trip) tripId = z.uuid().parse(trip[1]);
    else if (booking) {
      const record = await application.database.selectFrom("bookingTransactions").select("tripId")
        .where("id", "=", z.uuid().parse(booking[1])).where("ownerUserId", "=", user.id).executeTakeFirst();
      if (!record) planningNotFound(); tripId = record.tripId;
    } else {
      const workflow = path.match(/^\/api\/v1\/booking\/revalidations\/([^/]+)/);
      if (!workflow) planningNotFound();
      const record = await application.database.selectFrom("bookingRevalidations").select("tripId")
        .where("workflowId", "=", decodeURIComponent(workflow[1])).where("ownerUserId", "=", user.id).executeTakeFirst();
      if (!record) planningNotFound(); tripId = record.tripId;
    }
    const actor = await resolveBookingActor(application.database, tripId, user.id);
    if (request.method === "GET") return inTransaction(application.database, async (transaction) => {
      await lockBookingTrip(transaction, actor, tripId);
      return action({ ...application, database: transaction });
    });
    // Domain writes recheck this relation under their own transaction; dispatch
    // remains outside it so workers only see durable booking records.
    return action(application);
  }, options);
}

export async function requestJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    throw new ProblemError({ title: "JSON body required", status: 415, code: "unsupported_media_type" });
  }
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing body");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > 262_144) {
        await reader.cancel();
        throw new ProblemError({ title: "Request body too large", status: 413, code: "body_too_large" });
      }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export function internalActor(application: Application, request: Request, tripId: string,
  baseTripVersion: number, scope: ServiceScope, diagnostic = false) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new ServiceTokenError("Missing token");
  const context = { tripId, baseTripVersion, userId: z.uuid().parse(request.headers.get("x-user-id")),
    requestId: z.uuid().parse(request.headers.get("x-request-id")) };
  return verifyServiceToken(authorization.slice(7), {
    secret: diagnostic ? application.config.PRICING_DIAGNOSTIC_SECRET : application.config.SERVICE_TOKEN_SECRET,
    expectedAudience: "web", expectedContext: context, requiredScopes: [scope],
  });
}

