import { randomUUID } from "node:crypto";

import { CORRELATION_ID_HEADER, isValidCorrelationId } from "./telemetry";
import { containsSensitiveText } from "../lib/privacy";

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  correlationId: string;
  currentRevision?: number;
  nextPath?: string;
  fieldErrors?: readonly { path: string; message: string }[];
}

export interface ProblemErrorOptions {
  type?: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  retryAfterSeconds?: number;
  currentRevision?: number;
  nextPath?: `/trips/${string}`;
  fieldErrors?: readonly { path: string; message: string }[];
}

// Bundlers may inline this module into more than one server chunk, which gives
// each copy its own class identity. The symbol registry is realm-wide, so a
// brand survives that duplication where `instanceof` does not.
const problemBrand = Symbol.for("onholidai.problem-error");

export function isProblemError(error: unknown): error is ProblemError {
  return (
    typeof error === "object" &&
    error !== null &&
    ((error as Record<symbol, unknown>)[problemBrand] === true || error instanceof ProblemError)
  );
}

export class ProblemError extends Error {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail?: string;
  readonly retryAfterSeconds?: number;
  readonly currentRevision?: number;
  readonly nextPath?: string;
  readonly fieldErrors?: readonly { path: string; message: string }[];

  constructor({
    type = "about:blank",
    title,
    status,
    code,
    detail,
    retryAfterSeconds,
    currentRevision,
    nextPath,
    fieldErrors,
  }: ProblemErrorOptions) {
    super(title);
    this.name = "ProblemError";
    this.type = type;
    this.title = title;
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.retryAfterSeconds = retryAfterSeconds;
    this.currentRevision = currentRevision;
    this.nextPath = nextPath;
    this.fieldErrors = fieldErrors;
    (this as unknown as Record<symbol, unknown>)[problemBrand] = true;
  }
}

const internalProblem = {
  type: "https://onholidai.example/problems/internal-error",
  title: "An unexpected error occurred",
  status: 500,
  code: "internal_error",
} as const;

export function safeProblemOf(error: unknown): ProblemError | typeof internalProblem {
  return isProblemError(error) &&
    ![
      error.type,
      error.title,
      error.code,
      error.detail ?? "",
      error.nextPath ?? "",
      ...(error.fieldErrors ?? []).flatMap((field) => [field.path, field.message]),
    ].some(containsSensitiveText)
    ? error
    : internalProblem;
}

export function problemResponse(error: unknown, correlationId: string): Response {
  const safeCorrelationId = isValidCorrelationId(correlationId) ? correlationId : randomUUID();
  const safeProblem = safeProblemOf(error);
  const body: Problem = {
    type: safeProblem.type,
    title: safeProblem.title,
    status: safeProblem.status,
    code: safeProblem.code,
    ...(isProblemError(safeProblem) && safeProblem.detail ? { detail: safeProblem.detail } : {}),
    correlationId: safeCorrelationId,
    ...(isProblemError(safeProblem) && safeProblem.currentRevision !== undefined
      ? { currentRevision: safeProblem.currentRevision }
      : {}),
    ...(isProblemError(safeProblem) && safeProblem.nextPath
      ? { nextPath: safeProblem.nextPath }
      : {}),
    ...(isProblemError(safeProblem) && safeProblem.fieldErrors
      ? { fieldErrors: safeProblem.fieldErrors }
      : {}),
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/problem+json",
    [CORRELATION_ID_HEADER]: safeCorrelationId,
  };
  if (isProblemError(safeProblem) && safeProblem.retryAfterSeconds !== undefined) {
    headers["Retry-After"] = String(Math.max(1, Math.ceil(safeProblem.retryAfterSeconds)));
  }

  return Response.json(body, { status: body.status, headers });
}

// Safe, non-disclosing problem codes shared by guest planning, drafts and linking.
export const planningProblems = {
  resourceNotFound: () =>
    new ProblemError({
      title: "Resource not found",
      status: 404,
      code: "resource_not_found",
    }),
  guestSessionUnavailable: () =>
    new ProblemError({
      title: "Planning session unavailable",
      status: 401,
      code: "guest_session_unavailable",
    }),
  draftRevisionConflict: (currentRevision?: number) =>
    new ProblemError({
      title: "Draft revision conflict",
      status: 409,
      code: "draft_revision_conflict",
      currentRevision,
    }),
  draftAlreadySubmitted: (tripId?: string) =>
    new ProblemError({
      title: "Draft already submitted",
      status: 409,
      code: "draft_already_submitted",
      ...(tripId ? { nextPath: `/trips/${tripId}` as const } : {}),
    }),
  bookingIntentExpired: () =>
    new ProblemError({
      title: "Booking intent expired",
      status: 410,
      code: "booking_intent_expired",
    }),
  guestResearchLimited: (retryAfterSeconds: number) =>
    new ProblemError({
      title: "Guest research limit reached",
      status: 429,
      code: "guest_research_limited",
      retryAfterSeconds,
    }),
  planningRunAccessRevoked: () =>
    new ProblemError({
      title: "Planning run access revoked",
      status: 403,
      code: "planning_run_access_revoked",
    }),
  authenticationRequired: () =>
    new ProblemError({
      title: "Authentication required",
      status: 401,
      code: "authentication_required",
    }),
} as const;
