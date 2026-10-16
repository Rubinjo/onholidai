"use client";
import type { TripSnapshot } from "@/domain/trip/schema";
import { displayPreference, storedPreference } from "./preference-scale";
import { Button } from "@/components/ui/button";
export function PartyPreferences({ party, preferences, onParty, onPreferences, mode = "both" }: {
  party: TripSnapshot["travellerParty"]; preferences: TripSnapshot["preferences"];
  onParty: (party: TripSnapshot["travellerParty"]) => void; onPreferences: (preferences: TripSnapshot["preferences"]) => void;
  mode?: "both" | "party" | "preferences";
}) {
  return <fieldset className="planning-card party-preferences"><legend>Travellers and travel style</legend>
    {mode !== "preferences" && <>
    <label>Adults<input data-setup-field="travellerParty.adults" type="number" required min={1} max={10} value={party.adults < 1 ? "" : party.adults} onChange={(event) => onParty({ ...party, adults: Number(event.target.value) })} /></label>
    {party.children.map((child, index) => <div className="party-child" key={child.id}><label>Child {index + 1} age at trip start<input data-setup-field={`travellerParty.children.${index}.ageAtTripStart`} type="number" min={0} max={17} required value={child.ageAtTripStart < 0 ? "" : child.ageAtTripStart} onChange={(event) => onParty({ ...party, children: party.children.map((entry) => entry.id === child.id ? { ...entry, ageAtTripStart: event.target.value === "" ? -1 : Number(event.target.value) } : entry) })} /></label>
      <Button variant="ghost" className="button-remove" onClick={() => { onParty({ ...party, children: party.children.filter((entry) => entry.id !== child.id) }); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-add-child]')?.focus()); }}>Remove child {index + 1}</Button></div>)}
    <Button variant="secondary" data-add-child onClick={() => onParty({ ...party, children: [...party.children, { id: crypto.randomUUID(), ageAtTripStart: -1 }] })} disabled={party.adults + party.children.length >= 10}>Add child</Button>
    <p>Maximum ten travellers. No names, passports or payment details are needed for planning.</p>
    </>}
    {mode !== "party" && (["pace", "spend", "discovery", "independence", "setting"] as const).map((key) => <label className="preference-control" key={key}>
      {{ pace: "Pace: relaxed to full days", spend: "Spend: budget to premium", discovery: "Discovery: familiar to adventurous", independence: "Independence: guided to self-directed", setting: "Setting: nature to city" }[key]}<input type="range" min={1} max={10} step={1} value={displayPreference(preferences[key])} aria-valuetext={`${displayPreference(preferences[key])} of 10`} onChange={(event) => onPreferences({ ...preferences, [key]: storedPreference(Number(event.target.value)) })} /><output aria-hidden="true">{displayPreference(preferences[key])}/10</output>
    </label>)}
  </fieldset>;
}
