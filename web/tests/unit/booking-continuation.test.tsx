import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BookingContinuation } from "../../components/auth/booking-continuation";
const state = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("../../components/trip-setup/http", async (original) => ({ ...await original<typeof import("../../components/trip-setup/http")>(), planningJson: state.request }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("records the explicit link and leaves subsequent navigation under the traveller's control", async () => {
  state.request.mockResolvedValue({ nextPath: "/trips/current/booking" });
  render(<BookingContinuation intentId={crypto.randomUUID()} returnPath="/trips/current" />);
  fireEvent.click(screen.getByRole("button", { name: "Link this trip and continue" }));
  await screen.findByRole("heading", { name: "Your trip is linked to your account" });
  expect(screen.getByRole("link", { name: "Review booking terms" })).toHaveAttribute("href", "/trips/current/booking");
  expect(state.refresh).not.toHaveBeenCalled();
  expect(state.request).toHaveBeenCalledTimes(1);
});
