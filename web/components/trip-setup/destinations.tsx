"use client";
import { useRef, useState } from "react";
import { z } from "zod";

import { placeCandidateSchema, type PlaceCandidate } from "@/domain/trip/destination";
import { DestinationPicker } from "@/components/map/destination-picker";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";

import { planningError, planningJson } from "./http";
import { PlaceSearch } from "./place-search";

import type { TripSnapshot } from "@/domain/trip/schema";

type Destination = TripSnapshot["destinations"][number];
type Origin = TripSnapshot["departureOrigin"];
export function selectDestination(
  list: Destination[],
  place: PlaceCandidate,
  replaceId?: string,
): Destination[] {
  if (
    list.some(
      (entry) =>
        entry.id !== replaceId && Object.values(entry.providerPlaceIds).includes(place.placeId),
    )
  )
    throw new Error("That destination is already on your route.");
  const country =
    place.kind === "city"
      ? list.find((entry) => entry.kind === "country" && entry.countryCode === place.countryCode)
      : undefined;
  const previous = list.find((entry) => entry.id === (replaceId ?? country?.id));
  if (replaceId && !previous) throw new Error("Choose the destination to replace again.");
  if (!previous && list.length >= 8) throw new Error("Choose at most eight destinations.");
  const destination: Destination = {
    id: previous?.id ?? crypto.randomUUID(),
    kind: place.kind === "airport" ? "place" : place.kind,
    name: place.name,
    countryCode: place.countryCode,
    timezone: place.timezone,
    providerPlaceIds: {
      lookup: place.placeId,
      ...place.providerPlaceIds,
      ...(place.kind === "airport" && place.airportCode
        ? { "duffel:flight": place.airportCode }
        : {}),
    },
    location: place.location,
    routePosition: previous?.routePosition ?? list.length,
    arrivalDate: null,
    departureDate: null,
    plannedNights: 0,
  };
  const result = previous
    ? list.map((entry) => (entry.id === previous.id ? destination : entry))
    : [...list, destination];
  return result
    .filter(
      (entry) =>
        !(
          place.kind === "city" &&
          entry.kind === "country" &&
          entry.countryCode === place.countryCode
        ),
    )
    .map((entry, routePosition) => ({ ...entry, routePosition }));
}
export function Destinations({
  origin,
  origins,
  destinations,
  onOrigin,
  onOrigins,
  onDestinations,
  order = "manual",
  onOrder,
  mode = "both",
  globe = false,
  mapVisible = true,
}: {
  origin: Origin | null;
  origins?: Origin[];
  destinations: Destination[];
  onOrigin: (origin: Origin | null) => void;
  onOrigins?: (origins: Origin[]) => void;
  onDestinations: (destinations: Destination[]) => void;
  order?: "manual" | "ai";
  onOrder?: (order: "manual" | "ai") => void;
  mode?: "both" | "destinations" | "origin";
  globe?: boolean;
  mapVisible?: boolean;
}) {
  const request = useRef(0),
    drag = useRef<number | null>(null);
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [replaceId, setReplaceId] = useState<string>();
  const [searchKey, setSearchKey] = useState(0),
    [countryChoices, setCountryChoices] = useState<PlaceCandidate[]>([]),
    [moving, setMoving] = useState("");
  const departures = origins?.length ? origins : origin ? [origin] : [];
  function choose(place: PlaceCandidate) {
    request.current++;
    setBusy(false);
    setCountryChoices([]);
    try {
      onDestinations(selectDestination(destinations, place, replaceId));
      setReplaceId(undefined);
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Choose another destination.");
    }
  }
  async function openCountry(code: string, name: string) {
    const sequence = ++request.current;
    setBusy(true);
    setError("");
    setCountryChoices([]);
    setCandidates([]);
    try {
      const schema = z.object({ candidates: z.array(placeCandidateSchema) }).passthrough();
      const [country, cities] = await Promise.all([
        planningJson(
          `/api/v1/places?query=${encodeURIComponent(name)}&countryCode=${code}&kind=country`,
        ),
        planningJson(`/api/v1/places?query=&countryCode=${code}&kind=city`),
      ]);
      if (sequence !== request.current) return;
      const choices = schema.parse(country).candidates;
      setCandidates(schema.parse(cities).candidates);
      if (choices.length === 1) choose(choices[0]);
      else {
        setCountryChoices(choices);
        setError(
          choices.length
            ? "Choose the country region and timezone below."
            : "This country could not be resolved. Search for a destination.",
        );
      }
    } catch (failure) {
      if (sequence === request.current) setError(planningError(failure));
    } finally {
      if (sequence === request.current) setBusy(false);
    }
  }
  function move(index: number, target: number) {
    if (target < 0 || target >= destinations.length || order !== "manual") return;
    request.current++;
    setBusy(false);
    const list = [...destinations],
      [item] = list.splice(index, 1);
    list.splice(target, 0, item);
    onDestinations(list.map((entry, routePosition) => ({ ...entry, routePosition })));
    setMoving(`${item.name} moved to stop ${target + 1}.`);
  }
  function reset() {
    request.current++;
    setBusy(false);
    setCandidates([]);
    setCountryChoices([]);
    setReplaceId(undefined);
    setError("");
    setMoving("Destinations cleared.");
    setSearchKey((value) => value + 1);
    onDestinations([]);
  }
  return (
    <div className="destination-controls">
      {mode !== "destinations" && (
        <fieldset>
          <legend>Departure alternatives</legend>
          <p>
            Add up to eight starting points. AI compares alternatives for everyone travelling
            together; you review its recommendation.
          </p>
          <PlaceSearch
            departure
            onSelect={(place) => {
              if (departures.some((entry) => entry.placeId === place.placeId)) {
                setError("That departure is already selected.");
                return;
              }
              if (departures.length >= 8) {
                setError("Choose at most eight departure alternatives.");
                return;
              }
              const next: Origin = {
                kind: place.kind === "airport" ? "airport" : "city",
                placeId: place.placeId,
                name: place.name,
                countryCode: place.countryCode,
                timezone: place.timezone,
                airportCode: place.airportCode,
                location: place.location,
                confirmedByUser: true,
              };
              if (onOrigins) onOrigins([...departures, next]);
              else onOrigin(next);
              setError("");
            }}
          />
          <ul className="departure-cards">
            {departures.map((place) => (
              <li key={place.placeId}>
                <strong>{place.name}</strong>
                <span>
                  {place.countryCode} · {place.timezone}
                </span>
                <Button
                  variant="ghost"
                  aria-label={`Remove departure ${place.name}`}
                  onClick={() => {
                    const remaining = departures.filter((entry) => entry.placeId !== place.placeId);
                    if (onOrigins) onOrigins(remaining);
                    else if (origin?.placeId === place.placeId) onOrigin(remaining[0] ?? null);
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <p>
            {departures.length
              ? "Each location is confirmed for research. You will review the recommended departure and return."
              : "Choose and confirm a city or airport. Your location is never inferred."}
          </p>
        </fieldset>
      )}
      {mode !== "origin" && (
        <>
          <div className="globe-interface">
            <div className="globe-interface__search">
              <PlaceSearch key={searchKey} onSelect={choose} onResults={setCandidates} />
            </div>
            {mapVisible && (
              <DestinationPicker
                destinations={destinations}
                {...(globe
                  ? {
                      onCountry: (code: string, name: string) => void openCountry(code, name),
                      onCity: choose,
                      candidates,
                    }
                  : {})}
              />
            )}
            <Button className="globe-interface__reset" variant="outline" onClick={reset}>
              Reset destinations
            </Button>
          </div>
          {countryChoices.length > 0 && (
            <div aria-label="Country regions">
              {countryChoices.map((place) => (
                <Button
                  key={place.placeId}
                  variant="outline"
                  onClick={() => {
                    choose(place);
                    setCountryChoices([]);
                  }}
                >
                  {place.name} · {place.timezone}
                </Button>
              ))}
            </div>
          )}
          <div className="route-order">
            <div>
              <h2>Your journey</h2>
              <p>
                {order === "manual"
                  ? "Drag stops into your preferred order."
                  : "AI will propose an order for you to review."}
              </p>
            </div>
            <div className="route-order__toggle" role="group" aria-label="Destination order">
              <Button
                aria-pressed={order === "manual"}
                variant={order === "manual" ? "default" : "outline"}
                onClick={() => onOrder?.("manual")}
              >
                My order
              </Button>
              <Button
                aria-pressed={order === "ai"}
                variant={order === "ai" ? "default" : "outline"}
                onClick={() => onOrder?.("ai")}
              >
                Let AI arrange
              </Button>
              <InfoTooltip label="About destination order">
                My order keeps destinations in the order you choose. Let AI arrange lets AI compare
                destination orders to find the most optimal route and best available pricing for
                your dates and preferences, balancing travel time and cost. You review the proposal;
                prices and savings are not guaranteed.
              </InfoTooltip>
            </div>
          </div>
          {replaceId && (
            <p role="status">
              Search for a replacement for{" "}
              {destinations.find((entry) => entry.id === replaceId)?.name}.{" "}
              <Button variant="ghost" onClick={() => setReplaceId(undefined)}>
                Cancel replacement
              </Button>
            </p>
          )}
          <ol
            aria-label="Selected destinations"
            className={`destination-list route-cards route-cards--${order}`}
          >
            {destinations.map((destination, index) => (
              <li
                key={destination.id}
                data-destination-id={destination.id}
                data-route-index={index}
              >
                <button
                  type="button"
                  className="route-cards__handle"
                  disabled={order !== "manual"}
                  aria-label={`Reorder ${destination.name}; use arrow keys`}
                  style={{ touchAction: "none" }}
                  onKeyDown={(event) => {
                    if (["ArrowUp", "ArrowDown"].includes(event.key)) {
                      event.preventDefault();
                      move(index, index + (event.key === "ArrowUp" ? -1 : 1));
                    }
                  }}
                  onPointerDown={(event) => {
                    drag.current = index;
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerUp={(event) => {
                    const target = document
                      .elementsFromPoint(event.clientX, event.clientY)
                      .find((element) => element.closest("[data-route-index]"))
                      ?.closest<HTMLElement>("[data-route-index]");
                    if (drag.current !== null && target)
                      move(drag.current, Number(target.dataset.routeIndex));
                    drag.current = null;
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                  }}
                >
                  {order === "manual" ? "⠿" : "✦"}
                  <span className="sr-only">Stop </span>
                  {index + 1}
                </button>
                <div className="route-cards__body">
                  <strong>{destination.name}</strong>
                  <span>
                    {destination.countryCode} · {destination.kind}
                  </span>
                  {!destination.location && (
                    <small>Country highlighted; precise marker unavailable.</small>
                  )}
                  <div className="route-cards__actions">
                    <Button
                      variant="ghost"
                      aria-label={`Move ${destination.name} earlier`}
                      disabled={order !== "manual" || index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      Earlier
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Move ${destination.name} later`}
                      disabled={order !== "manual" || index === destinations.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      Later
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Replace ${destination.name}`}
                      onClick={() => {
                        request.current++;
                        setBusy(false);
                        setCountryChoices([]);
                        setReplaceId(destination.id);
                      }}
                    >
                      Replace
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Remove ${destination.name}`}
                      onClick={() => {
                        request.current++;
                        setBusy(false);
                        setCountryChoices([]);
                        onDestinations(
                          destinations
                            .filter((entry) => entry.id !== destination.id)
                            .map((entry, routePosition) => ({ ...entry, routePosition })),
                        );
                        setReplaceId(undefined);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {!destinations.length && (
            <p className="route-empty">
              A country, a city, somewhere you’ve always wanted to go. Choose your first stop above.
            </p>
          )}
          <p>Choose up to eight destinations. Selecting a city replaces its whole-country stop.</p>
        </>
      )}
      <p role="status" aria-live="polite">
        {error || (busy ? "Finding country and cities…" : moving)}
      </p>
    </div>
  );
}
