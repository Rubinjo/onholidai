import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { MarketingNavigation } from "../../components/marketing/navigation";
import { signOutAction } from "../../server/auth/actions";

const state = vi.hoisted(() => ({
  auth: {},
  headers: new Headers(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => state.headers }));
vi.mock("next/navigation", () => ({ redirect: state.redirect }));
vi.mock("../../server/application", () => ({
  getApplication: () => ({ auth: state.auth }),
}));
vi.mock("../../server/auth/auth", () => ({
  getSession: state.getSession,
  signOut: state.signOut,
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("offers home and account entry points that return guests to the same trip", async () => {
  state.getSession.mockResolvedValue(null);
  const returnPath = "/trips/00000000-0000-4000-8000-000000000001";
  render(await MarketingNavigation({ returnPath }));
  expect(state.getSession).toHaveBeenCalledWith(state.auth, state.headers);
  expect(screen.getByRole("link", { name: "OnHolidai home" })).toHaveAttribute("href", "/");
  expect(screen.getByRole("link", { name: /^Home$/ })).toHaveAttribute("href", "/");
  expect(screen.getByRole("link", { name: "Start planning" })).toHaveAttribute(
    "href",
    "/trips/new",
  );
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    `/sign-in?redirectTo=${encodeURIComponent(returnPath)}`,
  );
  expect(screen.getByRole("link", { name: "Free sign-up" })).toHaveAttribute(
    "href",
    `/sign-up?redirectTo=${encodeURIComponent(returnPath)}`,
  );
  expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
});

it("preserves the home page's default authentication destinations", async () => {
  state.getSession.mockResolvedValue(null);
  render(await MarketingNavigation());
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
  expect(screen.getByRole("link", { name: "Free sign-up" })).toHaveAttribute("href", "/sign-up");
});

it("offers account and sign-out controls instead of guest actions when signed in", async () => {
  state.getSession.mockResolvedValue({ user: { id: "account-user" } });
  render(await MarketingNavigation());
  expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/sign-in");
  expect(screen.getByRole("button", { name: "Sign out" }).closest("form")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Free sign-up" })).not.toBeInTheDocument();
});

it("signs out using the current request before redirecting to sign-in", async () => {
  state.signOut.mockResolvedValue({ success: true });
  await signOutAction();
  expect(state.signOut).toHaveBeenCalledWith(state.auth, state.headers);
  expect(state.redirect).toHaveBeenCalledWith("/sign-in");
  expect(state.signOut.mock.invocationCallOrder[0]).toBeLessThan(
    state.redirect.mock.invocationCallOrder[0],
  );
});

it("does not redirect or pretend sign-out succeeded when authentication fails", async () => {
  state.signOut.mockRejectedValue(new Error("Authentication unavailable"));
  await expect(signOutAction()).rejects.toThrow("Authentication unavailable");
  expect(state.redirect).not.toHaveBeenCalled();
});
