import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { TripSnapshot } from "../../domain/trip/schema";
import { Availability } from "../../components/trip-setup/availability";
import { addAvailability, subtractAvailability, availableDays, fitDuration } from "../../components/trip-setup/availability-values";

afterEach(cleanup);
const window = (startDate = "2030-05-01", endDate = "2030-05-05", id = "first"): TripSnapshot["availabilityWindows"][number] => ({ id, startDate, endDate, timezone: "Pacific/Auckland", preference: "preferred" });
function Calendar() {
  const [value, update] = useState({ windows: [window()], duration: { minimumDays: 1, idealDays: 3, maximumDays: 5 } });
  return <><Availability {...value} onChange={update} /><output data-testid="value">{JSON.stringify(value)}</output></>;
}
const values = () => JSON.parse(screen.getByTestId("value").textContent!) as { windows: TripSnapshot["availabilityWindows"]; duration: TripSnapshot["duration"] };
const day = (date: string) => document.querySelector<HTMLButtonElement>(`[data-calendar-date="${date}"]`)!;

it("merges overlaps transitively, preserves preferred metadata and keeps adjacent windows separate", () => {
  const result = addAvailability([window(), { ...window("2030-05-08", "2030-05-10", "second"), preference: "flexible" }], window("2030-05-04", "2030-05-09", "new"));
  expect(result).toEqual([window("2030-05-01", "2030-05-10")]);
  expect(addAvailability(result, window("2030-05-11", "2030-05-12", "adjacent"))).toHaveLength(2);
  expect(() => addAvailability(result, { ...window(), timezone: "Europe/Amsterdam" })).toThrow(/timezones/);
});
it("subtracts days and ranges, retaining IDs and metadata, and removes an entire window", () => {
  const split = subtractAvailability([window()], "2030-05-03", "2030-05-03");
  expect(split[0]).toEqual(window("2030-05-01", "2030-05-02"));
  expect(split[1]).toMatchObject({ startDate: "2030-05-04", endDate: "2030-05-05", timezone: "Pacific/Auckland", preference: "preferred" });
  expect(split[1].id).not.toBe(split[0].id);
  expect(subtractAvailability(split, "2030-05-05", "2030-05-01")).toEqual([]);
  expect(subtractAvailability([window()], "2030-06-01", "2030-06-02")).toEqual([window()]);
  const many = Array.from({ length: 32 }, (_, index) => window("2030-05-01", "2030-05-05", String(index)));
  expect(() => subtractAvailability(many, "2030-05-03", "2030-05-03")).toThrow(/32/);
});
it("caps against the longest individual inclusive window and handles empty and DST dates", () => {
  const windows = [window(), window("2030-06-01", "2030-06-03", "second")];
  expect(availableDays(windows)).toBe(5);
  expect(availableDays([window("2030-03-30", "2030-04-01")])).toBe(3);
  expect(fitDuration({ minimumDays: 7, idealDays: 9, maximumDays: 30 }, windows)).toEqual({ minimumDays: 5, idealDays: 5, maximumDays: 5 });
  expect(fitDuration({ minimumDays: 1, idealDays: 3, maximumDays: 5 }, [])).toEqual({ minimumDays: 0, idealDays: 0, maximumDays: 0 });
});
it("right click removes one day, the second endpoint removes a range, and reset clears pending gestures", () => {
  render(<Calendar />);
  fireEvent.contextMenu(day("2030-05-02"));
  expect(values().windows.map((entry) => [entry.startDate, entry.endDate])).toEqual([["2030-05-01", "2030-05-01"], ["2030-05-03", "2030-05-05"]]);
  fireEvent.contextMenu(day("2030-05-04"));
  expect(values().windows.map((entry) => [entry.startDate, entry.endDate])).toEqual([["2030-05-01", "2030-05-01"], ["2030-05-05", "2030-05-05"]]);
  fireEvent.click(screen.getByRole("button", { name: "Reset calendar" }));
  expect(values()).toEqual({ windows: [], duration: { minimumDays: 0, idealDays: 0, maximumDays: 0 } });
  fireEvent.click(day("2030-05-03")); expect(values().windows).toEqual([]);
  fireEvent.click(day("2030-05-05")); expect(values().windows).toHaveLength(1);
  expect(values().duration.maximumDays).toBe(3);
});
it("offers keyboard/touch removal and inline preference selection with no pop-out editors", () => {
  render(<Calendar />);
  expect(screen.queryByLabelText("Start date 1")).toBeNull();
  fireEvent.change(screen.getByLabelText("Date preference 1"), { target: { value: "flexible" } });
  expect(values().windows[0].preference).toBe("flexible");
  fireEvent.click(screen.getByRole("button", { name: "Remove dates" }));
  fireEvent.click(day("2030-05-01")); fireEvent.click(day("2030-05-05"));
  expect(values().windows).toEqual([]);
});
it("normalizes editable legacy overlaps and oversized duration in one update without changing source history", () => {
  const windows = [window(), window("2030-05-04", "2030-05-10", "second")], onChange = vi.fn();
  render(<Availability windows={windows} duration={{ minimumDays: 12, idealDays: 20, maximumDays: 30 }} onChange={onChange} />);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith({ windows: [window("2030-05-01", "2030-05-10")], duration: { minimumDays: 10, idealDays: 10, maximumDays: 10 } });
  expect(windows).toHaveLength(2); expect(windows[0].endDate).toBe("2030-05-05");
});
