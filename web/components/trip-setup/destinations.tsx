"use client";
import { useId, useState } from "react";
import { z } from "zod";
import { placeCandidateSchema, type PlaceCandidate } from "@/domain/trip/destination";
import type { TripSnapshot } from "@/domain/trip/schema";
import { planningError, planningJson } from "./http";
type Destination = TripSnapshot["destinations"][number];
type Origin = TripSnapshot["departureOrigin"];
export function Destinations({ origin, destinations, onOrigin, onDestinations }: {
  origin: Origin | null; destinations: Destination[]; onOrigin: (origin: Origin) => void; onDestinations: (destinations: Destination[]) => void;
}) {
  const id = useId(), [query, setQuery] = useState(""), [departureQuery, setDepartureQuery] = useState("");
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([]), [origins, setOrigins] = useState<PlaceCandidate[]>([]);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function search(departure: boolean) {
    setError(""); setBusy(true);
    try {
      const result = z.object({ candidates: z.array(placeCandidateSchema), ambiguous: z.boolean() }).parse(
        await planningJson(`/api/v1/places?query=${encodeURIComponent(departure ? departureQuery : query)}`));
      if (departure) setOrigins(result.candidates.filter((place) => place.kind === "airport" || place.kind === "city"));
      else setCandidates(result.candidates.filter((place) => place.kind !== "airport"));
      if (result.candidates.length === 0) setError("No matches. Change the search and choose a specific place.");
    } catch (failure) { setError(planningError(failure)); } finally { setBusy(false); }
  }
  function move(index: number, offset: number) {
    const list = [...destinations], [item] = list.splice(index, 1); list.splice(index + offset, 0, item);
    onDestinations(list.map((destination, position) => ({ ...destination, routePosition: position })));
  }
  return <fieldset><legend>Departure and destinations</legend>
    <label htmlFor={`${id}-departure`}>Departure search</label><input id={`${id}-departure`} value={departureQuery} maxLength={200} onChange={(event) => setDepartureQuery(event.target.value)} />
    <button type="button" disabled={busy || !departureQuery.trim()} onClick={() => void search(true)}>Search departure</button>
    <ul>{origins.map((place) => <li key={place.placeId}><button type="button" onClick={() => {
      onOrigin({ kind: place.kind === "airport" ? "airport" : "city", placeId: place.placeId, name: place.name,
        countryCode: place.countryCode, timezone: place.timezone, airportCode: place.airportCode, confirmedByUser: true });
      setOrigins([]);
    }}>Confirm departure from {place.name}, {place.countryCode} ({place.timezone})</button></li>)}</ul>
    <p>{origin ? `Confirmed departure: ${origin.name}, ${origin.countryCode}. Return to this origin. Airport alternatives require review.` : "Choose and confirm a specific city or airport. Origin is never inferred."}</p>
    <label htmlFor={`${id}-destination`}>Destination search</label><input id={`${id}-destination`} value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} />
    <button type="button" disabled={busy || !query.trim()} onClick={() => void search(false)}>Search destinations</button>
    <ul>{candidates.map((place) => <li key={place.placeId}><button type="button" disabled={destinations.length >= 8} onClick={() => {
      if (destinations.some((destination) => Object.values(destination.providerPlaceIds).includes(place.placeId))) return;
      onDestinations([...destinations, { id: crypto.randomUUID(), kind: place.kind === "airport" ? "place" : place.kind,
        name: place.name, countryCode: place.countryCode, providerPlaceIds: { lookup: place.placeId }, location: place.location,
        routePosition: destinations.length, arrivalDate: null, departureDate: null, plannedNights: 0 }]);
      setCandidates([]);
    }}>Add {place.name}, {place.countryCode} ({place.kind})</button></li>)}</ul>
    <ol aria-label="Selected destinations">{destinations.map((destination, index) => <li key={destination.id}>
      {destination.name}, {destination.countryCode}
      <button type="button" aria-label={`Move ${destination.name} earlier`} disabled={index === 0} onClick={() => move(index, -1)}>Earlier</button>
      <button type="button" aria-label={`Move ${destination.name} later`} disabled={index === destinations.length - 1} onClick={() => move(index, 1)}>Later</button>
      <button type="button" aria-label={`Remove ${destination.name}`} onClick={() => onDestinations(destinations.filter((entry) => entry.id !== destination.id).map((entry, position) => ({ ...entry, routePosition: position })))}>Remove</button>
    </li>)}</ol><p role="status">{error}</p>
  </fieldset>;
}
