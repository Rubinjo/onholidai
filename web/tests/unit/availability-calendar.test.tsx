import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { TripSnapshot } from "../../domain/trip/schema";
import { Availability } from "../../components/trip-setup/availability";
vi.mock("react-day-picker", () => ({ DayPicker: ({ onDayClick, footer }: { onDayClick: (day: Date) => void; footer: string }) => <div>{[1, 3, 5, 10, 11, 15].map((day) => <button type="button" key={day} onClick={() => onDayClick(new Date(2030, 4, day))}>May {day}</button>)}<p role="status">{footer}</p></div> }));
afterEach(cleanup);
function Calendar() {
  const [windows, update] = useState<TripSnapshot["availabilityWindows"]>([{ id: "00000000-0000-4000-8000-000000000001", startDate: "2030-05-01", endDate: "2030-05-05", timezone: "Pacific/Auckland", preference: "preferred" }]);
  return <><Availability windows={windows} onWindows={update} duration={{ minimumDays: 1, idealDays: 3, maximumDays: 5 }} onDuration={() => {}} /><output data-testid="windows">{JSON.stringify(windows)}</output></>;
}
it("keeps incomplete selection local, reverses endpoints and preserves separate overlapping/adjacent alternatives", () => {
  render(<Calendar />);
  const values = () => JSON.parse(screen.getByTestId("windows").textContent!) as TripSnapshot["availabilityWindows"];
  const original = values()[0];
  fireEvent.click(screen.getByRole("button", { name: "May 10" })); expect(values()).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "May 3" }));
  expect(values()[0]).toEqual(original);
  expect(values()[1]).toMatchObject({ startDate: "2030-05-03", endDate: "2030-05-10", preference: "flexible", timezone: "Pacific/Auckland" });
  fireEvent.click(screen.getByRole("button", { name: "May 11" })); fireEvent.click(screen.getByRole("button", { name: "May 15" }));
  expect(values()).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "May 3" })); fireEvent.click(screen.getByRole("button", { name: "May 10" })); expect(values()).toHaveLength(3);
  fireEvent.click(screen.getAllByText("11 May 2030 – 15 May 2030")[0]);
  fireEvent.click(screen.getByRole("button", { name: "Remove window 3" })); expect(values()).toHaveLength(2);
});
