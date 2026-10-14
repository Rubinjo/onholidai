"use client";
import type { TripSnapshot } from "@/domain/trip/schema";
export function Constraints({ constraints, onChange }: { constraints: TripSnapshot["constraints"]; onChange: (constraints: TripSnapshot["constraints"]) => void }) {
  const categories = ["accessibility", "dietary", "schedule", "lodging", "budget", "occasion", "transport", "other"] as const;
  return <fieldset><legend>Reviewable requirements</legend><p>Enter one requirement per row, correct its wording and choose its priority. Unknown facts remain unverified.</p>
    {constraints.map((constraint, index) => <fieldset key={constraint.id}><legend>Requirement {index + 1}</legend>
      <label>Requirement wording {index + 1}<textarea data-setup-field={`constraints.${index}.statement`} required maxLength={1000} value={constraint.statement} onChange={(event) => onChange(constraints.map((entry) => entry.id === constraint.id ? { ...entry, statement: event.target.value } : entry))} /></label>
      <label>Category {index + 1}<select value={constraint.category} onChange={(event) => onChange(constraints.map((entry) => entry.id === constraint.id ? { ...entry, category: categories.find((category) => category === event.target.value) ?? "other" } : entry))}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
      <label>Priority {index + 1}<select value={constraint.priority} onChange={(event) => onChange(constraints.map((entry) => entry.id === constraint.id ? { ...entry, priority: event.target.value === "required" ? "required" : event.target.value === "strong" ? "strong" : "preference" } : entry))}><option value="required">Required — non-negotiable</option><option value="strong">Strong preference</option><option value="preference">Preference</option></select></label>
      <p>Status: {constraint.status}. Source: traveller setup. Material conflicts will be shown in review.</p>
      <button type="button" onClick={() => onChange(constraints.filter((entry) => entry.id !== constraint.id))}>Remove requirement {index + 1}</button>
    </fieldset>)}
    <button type="button" disabled={constraints.length >= 64} onClick={() => onChange([...constraints, { id: crypto.randomUUID(), category: "other", statement: "", priority: "required", source: { kind: "setup_text", referenceId: null }, status: "unverified", confirmedByUser: true }])}>Add requirement</button>
  </fieldset>;
}
