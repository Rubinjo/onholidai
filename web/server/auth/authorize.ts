import "server-only";

import type { AuthSession, AuthUser } from "@/server/auth/auth";

export const INTERNAL_TEAM_ROLES = ["support", "operations", "admin"] as const;

export type InternalTeamRole = (typeof INTERNAL_TEAM_ROLES)[number];
export type AuthorizationUser = Pick<AuthUser, "id"> & {
  internalTeamRole?: unknown;
};
export type AuthorizationSession = Pick<AuthSession, "session"> & {
  user: AuthorizationUser;
};

export class AuthorizationError extends Error {
  readonly code: "UNAUTHENTICATED" | "FORBIDDEN";
  readonly status: 401 | 403;

  constructor(code: "UNAUTHENTICATED" | "FORBIDDEN") {
    super(code === "UNAUTHENTICATED" ? "Authentication required" : "Access denied");
    this.name = "AuthorizationError";
    this.code = code;
    this.status = code === "UNAUTHENTICATED" ? 401 : 403;
  }
}

export function isInternalTeamRole(value: unknown): value is InternalTeamRole {
  return INTERNAL_TEAM_ROLES.some((role) => role === value);
}

export function hasInternalTeamRole(
  user: AuthorizationUser,
  allowedRoles: readonly InternalTeamRole[],
): boolean {
  return (
    isInternalTeamRole(user.internalTeamRole) &&
    allowedRoles.includes(user.internalTeamRole)
  );
}

export function isOwner(user: AuthorizationUser, ownerUserId: string): boolean {
  return user.id === ownerUserId;
}

export function requireSession(
  session: AuthorizationSession | null,
): AuthorizationSession {
  if (!session) {
    throw new AuthorizationError("UNAUTHENTICATED");
  }

  return session;
}

export function requireInternalTeamRole(
  session: AuthorizationSession | null,
  allowedRoles: readonly InternalTeamRole[],
): AuthorizationUser {
  const user = requireSession(session).user;
  if (!hasInternalTeamRole(user, allowedRoles)) {
    throw new AuthorizationError("FORBIDDEN");
  }

  return user;
}

export function requireOwnerOrInternalTeamRole(
  session: AuthorizationSession | null,
  ownerUserId: string,
  allowedRoles: readonly InternalTeamRole[] = [],
): AuthorizationUser {
  const user = requireSession(session).user;
  if (!isOwner(user, ownerUserId) && !hasInternalTeamRole(user, allowedRoles)) {
    throw new AuthorizationError("FORBIDDEN");
  }

  return user;
}