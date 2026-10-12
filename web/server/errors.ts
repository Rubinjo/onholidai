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
}

export class ProblemError extends Error {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail?: string;

  constructor({
    type = "about:blank",
    title,
    status,
    code,
    detail,
  }: ProblemErrorOptions) {
    super(title);
    this.name = "ProblemError";
    this.type = type;
    this.title = title;
    this.status = status;
    this.code = code;
    this.detail = detail;
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

  return Response.json(body, {
    status: body.status,
    headers: {
      "Content-Type": "application/problem+json",
      [CORRELATION_ID_HEADER]: safeCorrelationId,
    },
  });
}