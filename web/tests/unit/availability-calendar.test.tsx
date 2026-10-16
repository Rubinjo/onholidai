import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { Availability } from "../../components/trip-setup/availability";
import type { AvailabilityValue } from "../../components/trip-setup/availability-values";
afterEach(cleanup);
function Calendar() {
  const [value, update] = useState<AvailabilityValue>({ windows: [{ id: crypto.randomUUID(), startDate: "2030-05-01", endDate: "2030-05-05", timezone: "Pacific/Auckland", preference: "preferred" }], duration: { minimumDays: 1, idealDays: 3, maximumDays: 5 } });
  return <><Availability {...value} onChange={update} /><output data-testid="windows">{JSON.stringify(value.windows)}</output></>;
}
const choose = (date: string) => fireEvent.click(document.querySelector(`[data-calendar-date="${date}"]`)!);
it("keeps incomplete selection local, reverses endpoints, merges overlaps and preserves adjacent alternatives", () => {
  render(<Calendar />);
  const values = () => JSON.parse(screen.getByTestId("windows").textContent!) as AvailabilityValue["windows"];
  choose("2030-05-10"); expect(values()).toHaveLength(1);
  choose("2030-05-03"); expect(values()).toHaveLength(1);
  expect(values()[0]).toMatchObject({ startDate: "2030-05-01", endDate: "2030-05-10", preference: "preferred", timezone: "Pacific/Auckland" });
  choose("2030-05-11"); choose("2030-05-15"); expect(values()).toHaveLength(2);
  choose("2030-05-03"); choose("2030-05-10"); expect(values()).toHaveLength(2);
});
it("cycles five shades and uses text plus preference labels to identify windows", () => {
  const windows = Array.from({ length: 6 }, (_, index) => ({ id: String(index), startDate: `2030-05-${String(index * 3 + 1).padStart(2, "0")}`, endDate: `2030-05-${String(index * 3 + 2).padStart(2, "0")}`, timezone: "UTC", preference: "flexible" as const }));
  render(<Availability windows={windows} duration={{ minimumDays: 1, idealDays: 1, maximumDays: 2 }} onChange={() => {}} />);
  const rows = screen.getByRole("list", { name: "Availability windows" }).querySelectorAll("li");
  expect(rows).toHaveLength(6);
  expect(rows[0]).toHaveClass("calendar-window--0"); expect(rows[5]).toHaveClass("calendar-window--0");
  expect(rows[4]).toHaveClass("calendar-window--4");
  for (let index = 1; index <= 6; index++) expect(screen.getByLabelText(`Date preference ${index}`)).toBeTruthy();
});
