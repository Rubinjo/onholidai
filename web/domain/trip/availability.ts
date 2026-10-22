import { z } from "zod";

import { availabilityWindowSchema, durationPreferenceSchema } from "./schema";

export { availabilityWindowSchema, durationPreferenceSchema };
export type AvailabilityWindow = z.infer<typeof availabilityWindowSchema>;
export type DurationPreference = z.infer<typeof durationPreferenceSchema>;
export type OptimizationWindow = Omit<AvailabilityWindow, "id">;

// Optimization never writes back to the traveller's original windows.
export function normalizeAvailabilityWindows(
  input: readonly AvailabilityWindow[],
): OptimizationWindow[] {
  const windows = input
    .map((window) => availabilityWindowSchema.parse(window))
    .sort(
      (a, b) =>
        a.timezone.localeCompare(b.timezone) ||
        a.preference.localeCompare(b.preference) ||
        a.startDate.localeCompare(b.startDate),
    );
  const result: OptimizationWindow[] = [];
  for (const window of windows) {
    const previous = result.at(-1);
    if (
      previous &&
      previous.timezone === window.timezone &&
      previous.preference === window.preference &&
      window.startDate <= previous.endDate
    ) {
      previous.endDate = previous.endDate > window.endDate ? previous.endDate : window.endDate;
    } else {
      result.push({
        startDate: window.startDate,
        endDate: window.endDate,
        timezone: window.timezone,
        preference: window.preference,
      });
    }
  }
  return result;
}
