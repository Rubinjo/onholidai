import type { SetupDraftPayload } from "./draft-schema";
import { displayPreference } from "./preference-scale";
function rows(payload: SetupDraftPayload): Record<string, string> {
  const duration = payload.duration, party = payload.travellerParty;
  return {
    Title: payload.title || "Untitled", Currency: payload.currency,
    Route: payload.destinations.map((entry) => `${entry.name}, ${entry.countryCode} (${entry.timezone ?? "timezone needs review"})`).join("; ") || "No destinations",
    Departure: payload.departureOrigin ? `${payload.departureOrigin.name}, ${payload.departureOrigin.countryCode}; ${payload.departureOrigin.confirmedByUser ? "confirmed" : "not confirmed"}` : "Not entered",
    Dates: payload.availabilityWindows.map((window) => `${window.preference}: ${window.startDate || "missing start"} to ${window.endDate || "missing end"} (${window.timezone})`).join("; ") || "No dates",
    Duration: `${duration.minimumDays ?? "missing minimum"} / ${duration.idealDays ?? "missing ideal"} / ${duration.maximumDays ?? "missing maximum"} days`,
    Travellers: `${party.adults ?? "missing adult count"} adults; child ages ${party.children.map((child) => child.ageAtTripStart ?? "missing").join(", ") || "none"}`,
    "Travel style": Object.entries(payload.preferences).map(([dimension, value]) => `${dimension}: ${displayPreference(value)}/10`).join("; "),
    "Order policy": payload.destinationOrder ?? "manual",
    "Departure alternatives": (payload.departureOrigins ?? []).map((origin) => `${origin.name} (${origin.timezone})`).join("; "),
    Requirements: payload.constraints.map((constraint) => `${constraint.category}, ${constraint.priority}: ${constraint.statement || "missing wording"} (${constraint.status}, ${constraint.source.kind.replaceAll("_", " ")})`).join("; ") || "No requirements",
  };
}
export function DraftComparison({ saved, local }: { saved: SetupDraftPayload; local: SetupDraftPayload }) {
  const savedRows = rows(saved), localRows = rows(local), changed = Object.keys(savedRows).filter((key) => savedRows[key] !== localRows[key]);
  return changed.length ? <dl className="draft-comparison">{changed.map((key) => <div key={key}><dt>{key}</dt>
    <dd><strong>Saved:</strong> {savedRows[key]}</dd><dd><strong>Your local entry:</strong> {localRows[key]}</dd></div>)}</dl>
    : <p>The visible settings match. Reloading still updates the saved revision before another edit.</p>;
}
