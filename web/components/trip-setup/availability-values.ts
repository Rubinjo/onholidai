import type { TripSnapshot } from "@/domain/trip/schema";

type Window = TripSnapshot["availabilityWindows"][number];
type Duration = TripSnapshot["duration"];
export type AvailabilityValue = { windows: Window[]; duration: Duration };
export const completeWindow = (window: Window): boolean => Boolean(window.startDate && window.endDate && window.endDate >= window.startDate);
export const availableDays = (windows: Window[]): number => Math.min(365, Math.max(0, ...windows.filter(completeWindow).map((window) =>
  (Date.parse(window.endDate) - Date.parse(window.startDate)) / 86400000 + 1)));

export function fitDuration(value: Duration, windows: Window[]): Duration {
  const limit = availableDays(windows);
  if (!limit) return { minimumDays: 0, idealDays: 0, maximumDays: 0 };
  const minimumDays = Math.min(limit, Math.max(1, value.minimumDays || 1));
  const idealDays = Math.min(limit, Math.max(minimumDays, value.idealDays || 7));
  return { minimumDays, idealDays, maximumDays: Math.min(limit, Math.max(idealDays, value.maximumDays || 14)) };
}

// ISO calendar dates are compared without converting them to the browser timezone.
const shiftDay = (date: string, delta: number): string => new Date(Date.parse(date) + delta * 86400000).toISOString().slice(0, 10);
function bounded(windows: Window[]): Window[] {
  if (windows.length > 32) throw new Error("You can select up to 32 availability windows. Remove another window first.");
  return windows;
}
export function normalizeAvailability(windows: Window[], candidateId?: string): Window[] {
  const ordered = windows.filter(completeWindow).slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
  const result: Window[] = [];
  for (const window of ordered) {
    const previous = result.at(-1);
    if (!previous || window.startDate > previous.endDate) { result.push({ ...window }); continue; }
    if (window.timezone !== previous.timezone) throw new Error("These overlapping windows use different timezones. Remove the conflicting dates before combining them.");
    // Prefer an existing identity over the new candidate and preserve preferred intent.
    const id = previous.id === candidateId ? window.id : previous.id;
    result[result.length - 1] = { ...previous, id, endDate: window.endDate > previous.endDate ? window.endDate : previous.endDate,
      preference: previous.preference === "preferred" || window.preference === "preferred" ? "preferred" : "flexible" };
  }
  return bounded([...result, ...windows.filter((window) => !completeWindow(window))]);
}
export function addAvailability(windows: Window[], candidate: Window): Window[] {
  return normalizeAvailability([...windows.filter(completeWindow), candidate], candidate.id);
}
export function subtractAvailability(windows: Window[], first: string, second: string): Window[] {
  const [from, to] = [first, second].sort();
  return bounded(windows.flatMap((window) => {
    if (!completeWindow(window) || window.endDate < from || window.startDate > to) return [window];
    const left = window.startDate < from ? { ...window, endDate: shiftDay(from, -1) } : null;
    const right = window.endDate > to ? { ...window, id: left ? crypto.randomUUID() : window.id, startDate: shiftDay(to, 1) } : null;
    return [...(left ? [left] : []), ...(right ? [right] : [])];
  }));
}
