"use client";
import type { TripSnapshot } from "@/domain/trip/schema";
import type { CSSProperties } from "react";
type Duration = TripSnapshot["duration"];
export function DurationSlider({ value, onChange, limit = 365 }: { value: Duration; onChange: (value: Duration) => void; limit?: number }) {
  const maximum = Math.min(365, Math.max(1, limit));
  const percentage = (days: number): number => maximum === 1 ? 0 : (Math.min(maximum, Math.max(1, days)) - 1) / (maximum - 1) * 100;
  const rangeStyle = { "--range-start": `${percentage(value.minimumDays)}%`, "--range-end": `${percentage(value.maximumDays)}%` } as CSSProperties;
  function update(key: keyof Duration, next: number) {
    const current = { minimumDays: Math.min(maximum, value.minimumDays || 1), idealDays: Math.min(maximum, value.idealDays || 7), maximumDays: Math.min(maximum, value.maximumDays || 14) };
    current[key] = next;
    if (key === "minimumDays") { current.idealDays = Math.max(next, current.idealDays); current.maximumDays = Math.max(current.idealDays, current.maximumDays); }
    if (key === "idealDays") { current.minimumDays = Math.min(next, current.minimumDays); current.maximumDays = Math.max(next, current.maximumDays); }
    if (key === "maximumDays") { current.idealDays = Math.min(next, current.idealDays); current.minimumDays = Math.min(current.idealDays, current.minimumDays); }
    onChange(current);
  }
  return <fieldset className="duration-slider"><legend>How long would you like to travel?</legend><div className="duration-slider__values">{(["minimumDays", "idealDays", "maximumDays"] as const).map((key, index) => <span key={key}><span>{["Minimum", "Ideal", "Maximum"][index]}</span><strong>{value[key] || "—"}<small> days</small></strong></span>)}</div>
    <div className="duration-slider__track" style={rangeStyle}><span className="duration-slider__selection" aria-hidden="true" />{(["minimumDays", "idealDays", "maximumDays"] as const).map((key, index) => <input key={key} type="range" min={1} max={maximum} step={1} disabled={limit < 1}
      data-setup-field={`duration.${key}`} aria-label={["Minimum days", "Ideal days", "Maximum days"][index]} aria-valuetext={value[key] ? `${value[key]} days` : "Not selected"}
      className={`duration-slider__handle duration-slider__handle--${index}`} value={Math.min(maximum, value[key] || Math.min([1, 7, 14][index], maximum))} onChange={(event) => update(key, Number(event.target.value))} />)}</div>
    <p>Use each handle or arrow keys. Moving a handle keeps minimum ≤ ideal ≤ maximum. Maximum must fit a complete availability window.</p>
  </fieldset>;
}
