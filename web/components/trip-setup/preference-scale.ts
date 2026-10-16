// Presentation only: accepted snapshots and quote selection keep their 0-100 meaning.
// Round only the presentation. Untouched legacy values remain in parent state.
export const displayPreference = (value: number): number => Math.max(1, Math.min(10, Math.round(1 + value * 9 / 100)));
export const storedPreference = (value: number): number => Math.max(0, Math.min(100, Math.round((value - 1) * 100 / 9)));
