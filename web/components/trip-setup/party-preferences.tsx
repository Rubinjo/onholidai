"use client";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";

import { displayPreference, storedPreference } from "./preference-scale";

import type { TripSnapshot } from "@/domain/trip/schema";

const travelStyles = {
  pace: {
    label: "Pace: relaxed to full days",
    help: "Lower values guide AI toward fewer activities, more downtime and gentler daily schedules. Higher values allow fuller days with more sightseeing. Travel time and rest still need to fit.",
  },
  spend: {
    label: "Spend: budget to premium",
    help: "Lower values guide AI toward value-focused stays, transport and activities. Higher values favour comfort and premium options. This is a preference, not a fixed budget or a price guarantee; add any spending limit as a requirement.",
  },
  discovery: {
    label: "Discovery: familiar to adventurous",
    help: "Lower values guide AI toward familiar experiences and well-known sights. Higher values encourage less familiar places, local discoveries and more adventurous activities, while respecting your requirements.",
  },
  independence: {
    label: "Independence: guided to self-directed",
    help: "Lower values guide AI toward guided tours and organised experiences. Higher values favour independent exploration and self-directed activities, with more of the day left for you to navigate.",
  },
  setting: {
    label: "Setting: nature to city",
    help: "Lower values guide AI toward natural landscapes, outdoor activities and quieter surroundings. Higher values favour urban stays, cultural sights and city activities. AI balances this preference with your selected destinations.",
  },
} as const;

export function PartyPreferences({
  party,
  preferences,
  onParty,
  onPreferences,
  mode = "both",
}: {
  party: TripSnapshot["travellerParty"];
  preferences: TripSnapshot["preferences"];
  onParty: (party: TripSnapshot["travellerParty"]) => void;
  onPreferences: (preferences: TripSnapshot["preferences"]) => void;
  mode?: "both" | "party" | "preferences";
}) {
  const id = useId();
  return (
    <fieldset className="planning-card party-preferences">
      <legend>Travellers and travel style</legend>
      {mode !== "preferences" && (
        <>
          <label>
            Adults
            <input
              data-setup-field="travellerParty.adults"
              type="number"
              required
              min={1}
              max={10}
              value={party.adults < 1 ? "" : party.adults}
              onChange={(event) => onParty({ ...party, adults: Number(event.target.value) })}
            />
          </label>
          {party.children.map((child, index) => (
            <div className="party-child" key={child.id}>
              <label>
                Child {index + 1} age at trip start
                <input
                  data-setup-field={`travellerParty.children.${index}.ageAtTripStart`}
                  type="number"
                  min={0}
                  max={17}
                  required
                  value={child.ageAtTripStart < 0 ? "" : child.ageAtTripStart}
                  onChange={(event) =>
                    onParty({
                      ...party,
                      children: party.children.map((entry) =>
                        entry.id === child.id
                          ? {
                              ...entry,
                              ageAtTripStart:
                                event.target.value === "" ? -1 : Number(event.target.value),
                            }
                          : entry,
                      ),
                    })
                  }
                />
              </label>
              <Button
                variant="ghost"
                className="button-remove"
                onClick={() => {
                  onParty({
                    ...party,
                    children: party.children.filter((entry) => entry.id !== child.id),
                  });
                  requestAnimationFrame(() =>
                    document.querySelector<HTMLButtonElement>("[data-add-child]")?.focus(),
                  );
                }}
              >
                Remove child {index + 1}
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            data-add-child
            onClick={() =>
              onParty({
                ...party,
                children: [...party.children, { id: crypto.randomUUID(), ageAtTripStart: -1 }],
              })
            }
            disabled={party.adults + party.children.length >= 10}
          >
            Add child
          </Button>
          <p>
            Maximum ten travellers. No names, passports or payment details are needed for planning.
          </p>
        </>
      )}
      {mode !== "party" &&
        (["pace", "spend", "discovery", "independence", "setting"] as const).map((key) => (
          <div className="preference-control" key={key}>
            <div className="preference-control__heading">
              <label htmlFor={`${id}-${key}`}>{travelStyles[key].label}</label>
              <InfoTooltip label={`About ${key}`}>{travelStyles[key].help}</InfoTooltip>
            </div>
            <input
              id={`${id}-${key}`}
              type="range"
              min={1}
              max={10}
              step={1}
              value={displayPreference(preferences[key])}
              aria-valuetext={`${displayPreference(preferences[key])} of 10`}
              onChange={(event) =>
                onPreferences({
                  ...preferences,
                  [key]: storedPreference(Number(event.target.value)),
                })
              }
            />
            <output aria-hidden="true">{displayPreference(preferences[key])}/10</output>
          </div>
        ))}
    </fieldset>
  );
}
