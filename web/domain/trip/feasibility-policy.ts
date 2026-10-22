export const FEASIBILITY_POLICY = Object.freeze({
  version: "1" as const,
  transitionMinutes: 15,
  stationMinutes: 30,
  domesticAirportMinutes: 120,
  internationalAirportMinutes: 180,
  connectionCushionMinutes: 30,
  overnightRestMinutes: 540,
  mealMinutes: 45,
  mealCount: 2,
  freeMinutes: 60,
  occupiedMinutes: 600,
});

export function paceMinutes(pace: number): number {
  return pace <= 33 ? 240 : pace <= 66 ? 360 : 480;
}
export function requiredArrivalMinutes(mode: string, international = false, provider = 0): number {
  return Math.max(
    provider,
    mode === "flight" ? (international ? 180 : 120) : ["rail", "ferry"].includes(mode) ? 30 : 0,
  );
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function localAt(instant: number, timezone: string): string {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

// Try offsets on both sides of a transition. Round-trip checks detect both gaps
// and repeated local times; an explicit matching offset resolves the latter.
export function qualifiedInstant(local: string, timezone: string, offset?: string): number | null {
  const normalized = local.length === 16 ? local + ":00" : local.slice(0, 19);
  const approximate = Date.parse(normalized + "Z");
  if (!Number.isFinite(approximate)) return null;
  try {
    if (offset) {
      const instant = Date.parse(normalized + offset);
      return Number.isFinite(instant) && localAt(instant, timezone) === normalized ? instant : null;
    }
    const offsets = new Set(
      [-36, 0, 36].map((hours) => {
        const instant = approximate + hours * 3600000;
        return Date.parse(localAt(instant, timezone) + "Z") - instant;
      }),
    );
    const candidates = [...offsets]
      .map((difference) => approximate - difference)
      .filter((instant) => localAt(instant, timezone) === normalized);
    return candidates.length === 1 ? candidates[0] : null;
  } catch {
    return null;
  }
}

export function offsetMatches(qualified: string, timezone: string): boolean {
  const offset = qualified.endsWith("Z") ? "+00:00" : qualified.slice(-6);
  return qualifiedInstant(qualified.slice(0, 19), timezone, offset) === Date.parse(qualified);
}
