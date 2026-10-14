import { z } from "zod";

import { type Application, getApplication } from "./application";
import { getSession } from "./auth/auth";
import { AuthorizationError, requireSession } from "./auth/authorize";
import { type ServiceScope, verifyServiceToken, ServiceTokenError } from "./agent-client/credentials";
import { ProblemError, problemResponse } from "./errors";
import { getOrCreateCorrelationId } from "./telemetry";
import { emitOperationSpan, routeTemplate } from "./telemetry-exporter";

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
    const status = options.status ?? 200;
    emitRequestSpan(request, correlationId, startedAt, status);
    return Response.json(result, { status,
      headers: { "Cache-Control": "private, no-store", "x-correlation-id": correlationId } });
  } catch (error) {
    const safe = error instanceof z.ZodError || error instanceof SyntaxError
      ? new ProblemError({ title: "Invalid request", status: 422, code: "validation_error" })
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

export async function browserUser(application: Application, request: Request, dependencies = defaultDependencies) {
  // Mutating browser requests must come from the configured application origin.
  if (!["GET", "HEAD"].includes(request.method)
    && request.headers.get("origin") !== new URL(application.config.BETTER_AUTH_URL).origin) {
    throw new AuthorizationError("FORBIDDEN");
  }
  return requireSession(await dependencies.session(application.auth, request.headers)).user;
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

