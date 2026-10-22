import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";

import { BookingBoundary } from "../../components/auth/booking-boundary";

it("does not expose enabled POST controls before their client handlers hydrate", () => {
  const markup = renderToString(<BookingBoundary tripId="00000000-0000-4000-8000-000000000001" />);
  const container = document.createElement("div");
  container.innerHTML = markup;
  expect(container.querySelectorAll("button:disabled")).toHaveLength(2);
  expect(container.querySelector("[aria-busy=true]")).toBeTruthy();
  expect(container.textContent).toContain("Opening account options");
});
