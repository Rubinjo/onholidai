import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AccessibleField } from "../../components/ui/accessible-field";

afterEach(cleanup);

describe("AccessibleField", () => {
  it("labels its control and connects help and error text", () => {
    render(
      <AccessibleField
        description="Enter a city or airport code."
        error="Choose a departure airport."
        label="Departure airport"
        required
      >
        <input name="departureAirport" />
      </AccessibleField>,
    );

    const control = screen.getByRole("textbox", { name: "Departure airport" });

    expect(control).toBeRequired();
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAccessibleDescription(
      "Enter a city or airport code. Error: Choose a departure airport.",
    );
    expect(screen.getByText("Error: Choose a departure airport.")).toBeVisible();
  });

  it("preserves control identifiers and existing descriptions", () => {
    render(
      <>
        <span id="format-help">Use three letters.</span>
        <AccessibleField description="For example, LHR." label="Airport code">
          <input aria-describedby="format-help" id="airport-code" />
        </AccessibleField>
      </>,
    );

    const control = screen.getByLabelText("Airport code");

    expect(control).toHaveAttribute("id", "airport-code");
    expect(control).toHaveAccessibleDescription("Use three letters. For example, LHR.");
  });
});