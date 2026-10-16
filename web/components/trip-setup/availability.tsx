"use client";
import type { TripSnapshot } from "@/domain/trip/schema";
import { useEffect, useMemo, useState } from "react";
import { DayButton, DayPicker, type DayButtonProps } from "react-day-picker";
import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { DurationSlider } from "./duration-slider";
import { addAvailability, availableDays, completeWindow, fitDuration, normalizeAvailability, subtractAvailability, type AvailabilityValue } from "./availability-values";

// Defined outside Availability so day buttons retain DOM identity and keyboard focus.
function CalendarDay({ day, modifiers, ...props }: DayButtonProps) {
  const selectedWindow = Object.keys(modifiers).find((key) => key.startsWith("availability_") && modifiers[key]);
  const windowName = selectedWindow ? `, availability window ${Number(selectedWindow.slice(13)) + 1}` : "";
  return <DayButton day={day} modifiers={modifiers} {...props} aria-label={`${props["aria-label"] ?? format(day.date, "d MMM yyyy")}${windowName}`} data-calendar-date={format(day.date, "yyyy-MM-dd")} />;
}
export function Availability({ windows, duration, onChange, timezone = "UTC" }: {
  windows: TripSnapshot["availabilityWindows"]; duration: TripSnapshot["duration"];
  onChange: (value: AvailabilityValue) => void; timezone?: string;
}) {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [start, setStart] = useState<string | null>(null);
  const [removal, setRemoval] = useState<{ start: string; base: AvailabilityValue } | null>(null);
  const [notice, setNotice] = useState(""), [error, setError] = useState("");
  const normalized = useMemo(() => {
    try { return { windows: normalizeAvailability(windows), error: "" }; }
    catch (failure) { return { windows, error: failure instanceof Error ? failure.message : "Review overlapping availability windows." }; }
  }, [windows]);
  const limit = availableDays(normalized.windows);
  const fitted = fitDuration(duration, normalized.windows);
  useEffect(() => {
    if (JSON.stringify(windows) !== JSON.stringify(normalized.windows) || duration.minimumDays !== fitted.minimumDays || duration.idealDays !== fitted.idealDays || duration.maximumDays !== fitted.maximumDays) {
      onChange({ windows: normalized.windows, duration: fitted });
    }
  }, [duration.minimumDays, duration.idealDays, duration.maximumDays, fitted.minimumDays, fitted.idealDays, fitted.maximumDays, fitted, normalized, windows, onChange]);
  function commit(next: TripSnapshot["availabilityWindows"], previous = duration) {
    onChange({ windows: next, duration: fitDuration(previous, next) });
  }
  function remove(date: string) {
    setStart(null); setError("");
    try {
      const base = removal?.base ?? { windows, duration };
      commit(subtractAvailability(base.windows, removal?.start ?? date, date), base.duration);
      setNotice(removal ? "Selected dates removed." : "Day removed. Choose another date to remove a range, or press Escape to finish.");
      setRemoval(removal ? null : { start: date, base });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to remove these dates."); }
  }
  function choose(day: Date) {
    const date = format(day, "yyyy-MM-dd");
    if (mode === "remove") { remove(date); return; }
    setRemoval(null); setError("");
    if (!start) { setStart(date); setNotice(""); return; }
    try {
      const [startDate, endDate] = [start, date].sort();
      const next = addAvailability(windows, { id: crypto.randomUUID(), startDate, endDate,
        timezone: windows[0]?.timezone ?? timezone, preference: windows.some(completeWindow) ? "flexible" : "preferred" });
      commit(next); setStart(null); setNotice("Dates added. Overlapping windows are combined; preferred status is retained.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to add these dates."); }
  }
  const modifiers = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`window_${index}`, (day: Date) => {
    const date = format(day, "yyyy-MM-dd");
    return windows.some((window, position) => position % 5 === index && completeWindow(window) && date >= window.startDate && date <= window.endDate);
  }]));
  return <fieldset className="planning-card availability-section" data-setup-field="availabilityWindows" tabIndex={-1}><legend>Dates and duration</legend>
    <p className="planning-card__intro">Choose the days you could get away. Set a window as preferred or keep it flexible.</p>
    <div className="calendar-toolbar"><div className="calendar-toolbar__modes" role="group" aria-label="Calendar action">
      <Button variant={mode === "add" ? "default" : "ghost"} aria-pressed={mode === "add"} onClick={() => { setMode("add"); setStart(null); setRemoval(null); }}>Add dates</Button>
      <Button variant={mode === "remove" ? "default" : "ghost"} aria-pressed={mode === "remove"} onClick={() => { setMode("remove"); setStart(null); setRemoval(null); }}>Remove dates</Button>
    </div><Button variant="outline" onClick={() => { setStart(null); setRemoval(null); setError(""); commit([]); setNotice("Calendar cleared. Select new dates to continue."); }}>Reset calendar</Button></div>
    <div className="availability-calendar" onKeyDown={(event) => { if (event.key === "Escape") { setStart(null); setRemoval(null); setNotice("Selection finished."); } }}
      onContextMenu={(event) => {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-calendar-date]") : null;
        if (target?.dataset.calendarDate) { event.preventDefault(); remove(target.dataset.calendarDate); }
      }}>
      <DayPicker mode={undefined} captionLayout="dropdown" startMonth={new Date(1900, 0)} endMonth={new Date(2200, 11)} components={{ DayButton: CalendarDay }} defaultMonth={windows.find(completeWindow)?.startDate ? parseISO(windows.find(completeWindow)!.startDate) : undefined}
        onDayClick={choose} modifiers={{ ...modifiers, ...Object.fromEntries(windows.map((window, index) => [`availability_${index}`, (day: Date) => {
          const date = format(day, "yyyy-MM-dd"); return completeWindow(window) && date >= window.startDate && date <= window.endDate;
        }])), range_start: start ? parseISO(start) : removal ? parseISO(removal.start) : [] }}
        modifiersClassNames={Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`window_${index}`, `calendar-window--${index}`]))}
        footer={start ? `Start: ${format(parseISO(start), "d MMM yyyy")}. Choose an end date.` : removal ? `Removal starts ${format(parseISO(removal.start), "d MMM yyyy")}. Choose another date to remove a range. Escape finishes.` : mode === "remove" ? "Choose a day to remove, then another to remove a range." : "Choose a start and end date. Right click to remove a day or range."} />
    </div>
    <ol className="availability-windows" aria-label="Availability windows">{windows.map((window, index) => <li className={`availability-window calendar-window--${index % 5}`} key={window.id}>
      <span className="availability-window__dates">{completeWindow(window) ? `${format(parseISO(window.startDate), "d MMM yyyy")} – ${format(parseISO(window.endDate), "d MMM yyyy")}` : "Choose dates on the calendar"}</span>
      <label><span className="sr-only">Date preference {index + 1}</span><select value={window.preference} onChange={(event) => {
        setRemoval(null); commit(windows.map((entry) => entry.id === window.id ? { ...entry, preference: event.target.value === "preferred" ? "preferred" : "flexible" } : entry));
      }}><option value="preferred">Preferred</option><option value="flexible">Flexible</option></select></label>
    </li>)}</ol>
    {!windows.length && <p className="calendar-empty">No dates selected yet. Choose your first window above.</p>}
    <p role="status" className="calendar-feedback">{notice}</p>{(error || normalized.error) && <p role="alert">{error || normalized.error}</p>}
    <DurationSlider value={duration} onChange={(next) => { setRemoval(null); onChange({ windows, duration: next }); }} limit={limit} />
  </fieldset>;
}
