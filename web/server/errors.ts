import { randomUUID } from "node:crypto";

import { CORRELATION_ID_HEADER, isValidCorrelationId } from "./telemetry";

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  correlationId: string;
}

export interface ProblemErrorOptions {
  type?: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  retryAfterSeconds?: number;
}

export class ProblemError extends Error {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail?: string;
  readonly retryAfterSeconds?: number;

  constructor({
    type = "about:blank",
    title,
    status,
    code,
    detail,
    retryAfterSeconds,
  }: ProblemErrorOptions) {
    super(title);
    this.name = "ProblemError";
    this.type = type;
    this.title = title;
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const internalProblem = {
  type: "https://onholidai.example/problems/internal-error",
  title: "An unexpected error occurred",
  status: 500,
  code: "internal_error",
} as const;

export function problemResponse(error: unknown, correlationId: string): Response {
  const safeCorrelationId = isValidCorrelationId(correlationId)
    ? correlationId
    : randomUUID();
  const safeProblem = error instanceof ProblemError ? error : internalProblem;
  const body: Problem = {
    type: safeProblem.type,
    title: safeProblem.title,
    status: safeProblem.status,
    code: safeProblem.code,
    ...(safeProblem instanceof ProblemError && safeProblem.detail
      ? { detail: safeProblem.detail }
      : {}),
    correlationId: safeCorrelationId,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/problem+json",
    [CORRELATION_ID_HEADER]: safeCorrelationId,
  };
  if (safeProblem instanceof ProblemError && safeProblem.retryAfterSeconds !== undefined) {
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
  draftRevisionConflict: () =>
    new ProblemError({
      title: "Draft revision conflict",
      status: 409,
      code: "draft_revision_conflict",
    }),
  draftAlreadySubmitted: () =>
    new ProblemError({
      title: "Draft already submitted",
      status: 409,
      code: "draft_already_submitted",
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