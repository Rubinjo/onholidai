import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StatusAnnouncer } from "../../components/ui/status-announcer";

afterEach(cleanup);

describe("StatusAnnouncer", () => {
  it("uses a polite atomic live region and updates its text", () => {
    const { rerender } = render(<StatusAnnouncer message="Searching offers" />);
    const region = screen.getByRole("status");

    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "true");
    expect(region).toHaveClass("sr-only");
    expect(region).toHaveTextContent("Searching offers");

    rerender(<StatusAnnouncer message="Offers ready" />);
    expect(region).toHaveTextContent("Offers ready");

    rerender(<StatusAnnouncer message={null} />);
    expect(region).toBeEmptyDOMElement();
  });

  it("renders announcement content as text", () => {
    const { container } = render(<StatusAnnouncer message={'<script>alert("unsafe")</script>'} />);

    expect(screen.getByRole("status")).toHaveTextContent('<script>alert("unsafe")</script>');
    expect(container.querySelector("script")).not.toBeInTheDocument();
  });
});
