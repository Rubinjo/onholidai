"use client";
import type { TripSnapshot } from "@/domain/trip/schema";
export function Availability({ windows, duration, onWindows, onDuration }: {
  windows: TripSnapshot["availabilityWindows"]; duration: TripSnapshot["duration"];
  onWindows: (windows: TripSnapshot["availabilityWindows"]) => void; onDuration: (duration: TripSnapshot["duration"]) => void;
}) {
  return <fieldset><legend>Dates and duration</legend><p>Preferred dates remain unchanged. Flexible dates are alternatives for explicit review.</p>
    {windows.map((window, index) => <fieldset key={window.id}><legend>Availability window {index + 1}</legend>
      <label>Start date {index + 1}<input type="date" required value={window.startDate} onChange={(event) => onWindows(windows.map((entry) => entry.id === window.id ? { ...entry, startDate: event.target.value } : entry))} /></label>
      <label>End date {index + 1}<input type="date" required value={window.endDate} onChange={(event) => onWindows(windows.map((entry) => entry.id === window.id ? { ...entry, endDate: event.target.value } : entry))} /></label>
      <label>Availability timezone {index + 1}<input required value={window.timezone} onChange={(event) => onWindows(windows.map((entry) => entry.id === window.id ? { ...entry, timezone: event.target.value } : entry))} /></label>
      <label>Date preference {index + 1}<select value={window.preference} onChange={(event) => onWindows(windows.map((entry) => entry.id === window.id ? { ...entry, preference: event.target.value === "preferred" ? "preferred" : "flexible" } : entry))}><option value="preferred">Preferred</option><option value="flexible">Flexible</option></select></label>
      <button type="button" disabled={windows.length === 1} onClick={() => onWindows(windows.filter((entry) => entry.id !== window.id))}>Remove window {index + 1}</button>
    </fieldset>)}
    <button type="button" disabled={windows.length >= 32} onClick={() => onWindows([...windows, { id: crypto.randomUUID(), startDate: "", endDate: "", preference: "flexible", timezone: windows[0].timezone }])}>Add availability window</button>
    {(["minimumDays", "idealDays", "maximumDays"] as const).map((key) => <label key={key}>{key === "minimumDays" ? "Minimum days" : key === "idealDays" ? "Ideal days" : "Maximum days"}
      <input type="number" min={1} max={365} required value={duration[key]} onChange={(event) => onDuration({ ...duration, [key]: Number(event.target.value) })} /></label>)}
    <p>Minimum ≤ ideal ≤ maximum. Maximum must fit at least one complete availability window.</p>
  </fieldset>;
}
