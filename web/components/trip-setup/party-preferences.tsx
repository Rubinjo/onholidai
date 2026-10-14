"use client";
import type { TripSnapshot } from "@/domain/trip/schema";
export function PartyPreferences({ party, preferences, onParty, onPreferences, mode = "both" }: {
  party: TripSnapshot["travellerParty"]; preferences: TripSnapshot["preferences"];
  onParty: (party: TripSnapshot["travellerParty"]) => void; onPreferences: (preferences: TripSnapshot["preferences"]) => void;
  mode?: "both" | "party" | "preferences";
}) {
  return <fieldset><legend>Travellers and travel style</legend>
    {mode !== "preferences" && <>
    <label>Adults<input data-setup-field="travellerParty.adults" type="number" required min={1} max={10} value={party.adults < 1 ? "" : party.adults} onChange={(event) => onParty({ ...party, adults: Number(event.target.value) })} /></label>
    {party.children.map((child, index) => <div key={child.id}><label>Child {index + 1} age at trip start<input data-setup-field={`travellerParty.children.${index}.ageAtTripStart`} type="number" min={0} max={17} required value={child.ageAtTripStart < 0 ? "" : child.ageAtTripStart} onChange={(event) => onParty({ ...party, children: party.children.map((entry) => entry.id === child.id ? { ...entry, ageAtTripStart: event.target.value === "" ? -1 : Number(event.target.value) } : entry) })} /></label>
      <button type="button" onClick={() => onParty({ ...party, children: party.children.filter((entry) => entry.id !== child.id) })}>Remove child {index + 1}</button></div>)}
    <button type="button" disabled={party.adults + party.children.length >= 10} onClick={() => onParty({ ...party, children: [...party.children, { id: crypto.randomUUID(), ageAtTripStart: -1 }] })}>Add child</button>
    <p>Maximum ten travellers. No names, passports or payment details are needed for planning.</p>
    </>}
    {mode !== "party" && (["pace", "spend", "discovery", "independence", "setting"] as const).map((key) => <label key={key}>
      {{ pace: "Pace: relaxed to full days", spend: "Spend: budget to premium", discovery: "Discovery: familiar to adventurous", independence: "Independence: guided to self-directed", setting: "Setting: nature to city" }[key]}<input type="range" min={0} max={100} step={1} value={preferences[key]} aria-valuetext={`${preferences[key]} of 100; 50 is neutral`} onChange={(event) => onPreferences({ ...preferences, [key]: Number(event.target.value) })} /><output>{preferences[key]}/100 (50 neutral)</output>
    </label>)}
  </fieldset>;
}
