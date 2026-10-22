"use client";
import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";

import { placeCandidateSchema, type PlaceCandidate } from "@/domain/trip/destination";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import { planningError, planningJson } from "./http";

const resultsSchema = z.object({ candidates: z.array(placeCandidateSchema) }).passthrough();
export function PlaceSearch({
  departure = false,
  onSelect,
  onResults,
}: {
  departure?: boolean;
  onSelect: (place: PlaceCandidate) => void;
  onResults?: (places: PlaceCandidate[]) => void;
}) {
  const id = useId(),
    sequence = useRef(0),
    input = useRef<HTMLInputElement>(null),
    list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<PlaceCandidate[]>([]),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  function close() {
    sequence.current++;
    setBusy(false);
    setOpen(false);
  }
  async function search() {
    if (!query.trim()) return;
    const current = ++sequence.current;
    setBusy(true);
    setOpen(true);
    setError("");
    setResults([]);
    try {
      const result = resultsSchema.parse(
        await planningJson(`/api/v1/places?query=${encodeURIComponent(query)}`),
      );
      if (sequence.current !== current) return;
      const places = result.candidates.filter((place) =>
        departure ? ["city", "airport"].includes(place.kind) : place.kind !== "airport",
      );
      setResults(places);
      onResults?.(places);
      if (!places.length) setError("No destinations found. Try another name.");
    } catch (failure) {
      if (sequence.current === current) setError(planningError(failure));
    } finally {
      if (sequence.current === current) setBusy(false);
    }
  }
  return (
    <div
      className="place-search"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          close();
          input.current?.focus();
        }
        if (["ArrowDown", "ArrowUp"].includes(event.key)) {
          const options = [
            ...(list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
          ];
          if (!options.length) return;
          event.preventDefault();
          const position = options.indexOf(document.activeElement as HTMLButtonElement);
          options[
            (position + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length
          ]?.focus();
        }
      }}
    >
      <div className="place-search__input">
        <Input
          id={id}
          ref={input}
          role="combobox"
          aria-label={departure ? "Departure search" : "Destination search"}
          data-setup-field={departure ? "departureOrigin" : "destinations"}
          aria-expanded={open}
          aria-controls={`${id}-results`}
          aria-autocomplete="list"
          placeholder={departure ? "Search for a departure location" : "Search for a destination"}
          value={query}
          maxLength={200}
          onChange={(event) => {
            close();
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void search();
            }
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={departure ? "Find departure locations" : "Find destinations"}
          disabled={busy || !query.trim()}
          onClick={() => void search()}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 5 5" />
          </svg>
        </Button>
      </div>
      {open && (
        <div className="place-search__dropdown">
          <p role="status">{busy ? "Searching…" : error}</p>
          <ul
            ref={list}
            id={`${id}-results`}
            role="listbox"
            aria-label={departure ? "Departure matches" : "Destination matches"}
          >
            {results.map((place) => (
              <li key={place.placeId} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  disabled={
                    !place.location &&
                    results.some(
                      (other) =>
                        other.placeId !== place.placeId &&
                        other.name === place.name &&
                        other.countryCode === place.countryCode &&
                        other.kind === place.kind &&
                        other.timezone === place.timezone,
                    )
                  }
                  onClick={() => {
                    onSelect(place);
                    close();
                    setQuery("");
                    input.current?.focus();
                  }}
                >
                  <strong>{place.name}</strong>
                  <span>
                    {place.countryCode} · {place.kind} · {place.timezone}
                    {place.location
                      ? ` · ${place.location.latitude}, ${place.location.longitude}`
                      : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            onClick={() => {
              close();
              input.current?.focus();
            }}
          >
            Close results
          </Button>
        </div>
      )}
    </div>
  );
}
