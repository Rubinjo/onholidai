// Presentation only: accepted snapshots and quote selection keep their 0-100 meaning.
// Midpoint 5.5 preserves the existing neutral 50 exactly; integer stops remain available.
export const displayPreference = (value: number): number => Math.round((1 + value * 9 / 100) * 100) / 100;
export const storedPreference = (value: number): number => Math.max(0, Math.min(100, Math.round((value - 1) * 100 / 9)));
