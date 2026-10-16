"use client";
import type { TripSnapshot } from "@/domain/trip/schema";
import { useState } from "react";
import { DayPicker } from "react-day-picker";
import { format, parseISO, isWithinInterval } from "date-fns";
import { DurationSlider } from "./duration-slider";
export function Availability({ windows, duration, onWindows, onDuration }: {
  windows: TripSnapshot["availabilityWindows"]; duration: TripSnapshot["duration"];
  onWindows: (windows: TripSnapshot["availabilityWindows"]) => void; onDuration: (duration: TripSnapshot["duration"]) => void;
}) {
  const [start, setStart] = useState<Date | null>(null);
  function choose(day: Date) {
    if (!start) { setStart(day); return; }
    const from = day < start ? day : start, to = day < start ? start : day;
    const startDate = format(from, "yyyy-MM-dd"), endDate = format(to, "yyyy-MM-dd");
    if (windows.some((window) => window.startDate === startDate && window.endDate === endDate)) { setStart(null); return; }
    const empty = windows.findIndex((window) => !window.startDate || !window.endDate);
    const next = { id: crypto.randomUUID(), startDate, endDate, timezone: windows[0]?.timezone ?? "UTC", preference: windows.length ? "flexible" as const : "preferred" as const };
    if (empty >= 0) onWindows(windows.map((window, index) => index === empty ? { ...window, startDate, endDate } : window));
    else if (windows.length < 32) onWindows([...windows, next]);
    setStart(null);
  }
  return <fieldset><legend>Dates and duration</legend><p>Preferred dates remain unchanged. Flexible dates are alternatives for explicit review.</p>
    <div className="availability-calendar"><DayPicker mode={undefined} defaultMonth={windows[0]?.startDate ? parseISO(windows[0].startDate) : undefined} onDayClick={choose}
      modifiers={{ selected: (day) => windows.some((window) => Boolean(window.startDate && window.endDate && window.endDate >= window.startDate) && isWithinInterval(day, { start: parseISO(window.startDate), end: parseISO(window.endDate) })), range_start: start ?? [] }}
      footer={start ? `Start: ${format(start, "d MMM yyyy")}. Choose an end date.` : "Select a start and end date for each range. Overlapping ranges remain separate alternatives."} /></div>
    {windows.map((window, index) => <details className="availability-window" key={window.id}><summary>{window.startDate && window.endDate ? `${format(parseISO(window.startDate), "d MMM yyyy")} – ${format(parseISO(window.endDate), "d MMM yyyy")}` : `Choose dates for window ${index + 1}`} <span>{window.preference}</span></summary><fieldset><legend className="sr-only">Availability window {index + 1}</legend>
      <label>Start date {index + 1}<input data-setup-field={`availabilityWindows.${index}.startDate`} type="date" required value={window.startDate} onChange={(event) => onWindows(windows.map((entry) => entry.id === window.id ? { ...entry, startDate: event.target.value } : entry))} /></label>
      <label>End date {index + 1}<input data-setup-field={`availabilityWindows.${index}.endDate`} type="date" required value={window.endDate} onChange={(event) => onWindows(windows.map((entry) => entry.id === window.id ? { ...entry, endDate: event.target.value } : entry))} /></label>
      <label>Availability timezone {index + 1}<input data-setup-field={`availabilityWindows.${index}.timezone`} required value={window.timezone} onChange={(event) => onWindows(windows.map((entry) => entry.id === window.id ? { ...entry, timezone: event.target.value } : entry))} /></label>
      <label>Date preference {index + 1}<select value={window.preference} onChange={(event) => onWindows(windows.map((entry) => entry.id === window.id ? { ...entry, preference: event.target.value === "preferred" ? "preferred" : "flexible" } : entry))}><option value="preferred">Preferred</option><option value="flexible">Flexible</option></select></label>
      <button type="button" onClick={() => onWindows(windows.filter((entry) => entry.id !== window.id))}>Remove window {index + 1}</button>
    </fieldset></details>)}
    <button type="button" disabled={windows.length >= 32} onClick={() => onWindows([...windows, { id: crypto.randomUUID(), startDate: "", endDate: "", preference: "flexible", timezone: windows[0]?.timezone ?? "UTC" }])}>Add availability window</button>
    <DurationSlider value={duration} onChange={onDuration} limit={Math.max(30, ...windows.filter((window) => window.startDate && window.endDate).map((window) => (Date.parse(window.endDate) - Date.parse(window.startDate)) / 86400000 + 1))} />
  </fieldset>;
}
