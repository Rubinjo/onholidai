"use client";
import { useId, useRef, useState } from "react";
import { z } from "zod";
import { placeCandidateSchema, type PlaceCandidate } from "@/domain/trip/destination";
import type { TripSnapshot } from "@/domain/trip/schema";
import { planningError, planningJson } from "./http";
import { DestinationPicker } from "@/components/map/destination-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
type Destination = TripSnapshot["destinations"][number];
type Origin = TripSnapshot["departureOrigin"];
export function selectDestination(list: Destination[], place: PlaceCandidate, replaceId?: string): Destination[] {
  if (list.some((entry) => entry.id !== replaceId && Object.values(entry.providerPlaceIds).includes(place.placeId))) throw new Error("That destination is already on your route.");
  if (!replaceId && list.length >= 8) throw new Error("Choose at most eight destinations.");
  const previous = replaceId ? list.find((entry) => entry.id === replaceId) : undefined;
  if (replaceId && !previous) throw new Error("Select the destination to replace again.");
  const destination: Destination = { id: previous?.id ?? crypto.randomUUID(), kind: place.kind === "airport" ? "place" : place.kind,
    name: place.name, countryCode: place.countryCode, timezone: place.timezone, providerPlaceIds: { lookup: place.placeId },
    location: place.location, routePosition: previous?.routePosition ?? list.length, arrivalDate: null, departureDate: null, plannedNights: 0 };
  return previous ? list.map((entry) => entry.id === replaceId ? destination : entry) : [...list, destination];
}
export function Destinations({ origin, destinations, onOrigin, onDestinations, mode = "both", globe = false }: {
  origin: Origin | null; destinations: Destination[]; onOrigin: (origin: Origin) => void;
  onDestinations: (destinations: Destination[]) => void; mode?: "both" | "destinations" | "origin"; globe?: boolean;
}) {
  const id = useId(), searchRef = useRef<HTMLInputElement>(null), request = useRef(0);
  const [query, setQuery] = useState(""), [departureQuery, setDepartureQuery] = useState("");
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([]), [origins, setOrigins] = useState<PlaceCandidate[]>([]);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [replaceId, setReplaceId] = useState<string>();
  const [country, setCountry] = useState<{ code: string; name: string } | null>(null), [countryCandidates, setCountryCandidates] = useState<PlaceCandidate[]>([]);
  const responseSchema = z.object({ candidates: z.array(placeCandidateSchema), ambiguous: z.boolean() }).passthrough();
  function ambiguous(place: PlaceCandidate, list: readonly PlaceCandidate[]) {
    return list.some((other) => other.placeId !== place.placeId && other.name === place.name && other.countryCode === place.countryCode
      && other.timezone === place.timezone && other.kind === place.kind);
  }
  function locationHint(place: PlaceCandidate, list: readonly PlaceCandidate[]) {
    if (!ambiguous(place, list)) return "";
    return place.location ? `; coordinates ${place.location.latitude}, ${place.location.longitude}` : "; refine the search to distinguish these matches";
  }
  async function search(departure: boolean) {
    const sequence = ++request.current; setError(""); setBusy(true);
    try {
      const result = responseSchema.parse(await planningJson(`/api/v1/places?query=${encodeURIComponent(departure ? departureQuery : query)}`));
      if (sequence !== request.current) return;
      if (departure) setOrigins(result.candidates.filter((place) => place.kind === "airport" || place.kind === "city"));
      else setCandidates(result.candidates.filter((place) => place.kind !== "airport"));
      if (!result.candidates.length) setError("No matches. Try another name and choose a specific place.");
    } catch (failure) { if (sequence === request.current) setError(planningError(failure)); }
    finally { if (sequence === request.current) setBusy(false); }
  }
  async function openCountry(code: string, name: string) {
    setCountry({ code, name }); setCountryCandidates([]); setError("");
    const sequence = ++request.current; setBusy(true);
    try {
      const [countries, cities] = await Promise.all([
        planningJson(`/api/v1/places?query=${encodeURIComponent(name)}&countryCode=${code}&kind=country`),
        planningJson(`/api/v1/places?query=&countryCode=${code}&kind=city`)]);
      if (sequence === request.current) setCountryCandidates([...responseSchema.parse(countries).candidates, ...responseSchema.parse(cities).candidates]);
    } catch (failure) { if (sequence === request.current) setError(planningError(failure)); }
    finally { if (sequence === request.current) setBusy(false); }
  }
  function choose(place: PlaceCandidate) {
    try { onDestinations(selectDestination(destinations, place, replaceId)); setReplaceId(undefined); setError(""); setCandidates([]); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Choose another destination."); }
  }
  function move(index: number, offset: number) {
    const list = [...destinations], [item] = list.splice(index, 1); list.splice(index + offset, 0, item);
    onDestinations(list.map((entry, position) => ({ ...entry, routePosition: position })));
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-destination-id="${item.id}"] button:not(:disabled)`)?.focus());
  }
  function remove(destination: Destination) {
    onDestinations(destinations.filter((entry) => entry.id !== destination.id).map((entry, routePosition) => ({ ...entry, routePosition })));
    if (replaceId === destination.id) setReplaceId(undefined);
    requestAnimationFrame(() => searchRef.current?.focus());
  }
  return <div className="destination-controls">
    {mode !== "destinations" && <fieldset><legend>Confirm your departure</legend>
      <label htmlFor={`${id}-departure`}>Departure search</label>
      <Input data-setup-field="departureOrigin" id={`${id}-departure`} value={departureQuery} maxLength={200} onChange={(event) => setDepartureQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(true); } }} />
      <Button disabled={busy || !departureQuery.trim()} onClick={() => void search(true)}>Search departure</Button>
      <ul>{origins.map((place) => <li key={place.placeId}><Button variant="outline" onClick={() => {
        onOrigin({ kind: place.kind === "airport" ? "airport" : "city", placeId: place.placeId, name: place.name,
          countryCode: place.countryCode, timezone: place.timezone, airportCode: place.airportCode, confirmedByUser: true }); setOrigins([]);
      }}>Confirm departure from {place.name}, {place.countryCode} ({place.timezone})</Button></li>)}</ul>
      <p>{origin ? `Confirmed departure: ${origin.name}. Return to this origin; airport alternatives need review.` : "Choose and confirm a city or airport. Your origin is never inferred."}</p>
    </fieldset>}
    {mode !== "origin" && <><DestinationPicker destinations={destinations}
      {...(globe ? { onCountry: (code: string, name: string) => void openCountry(code, name), onCity: choose,
        candidates: countryCandidates.filter((entry) => entry.kind === "city") } : {})} />
      <fieldset><legend>Build your route</legend>
        <label htmlFor={`${id}-destination`}>Destination search</label>
        <Input data-setup-field="destinations" ref={searchRef} id={`${id}-destination`} value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(false); } }} />
        <Button disabled={busy || !query.trim()} onClick={() => void search(false)}>Search destinations</Button>
        <p>Choose up to eight destinations. A country and its cities can both be part of your route.</p>
        {replaceId && <p role="status">Choose a replacement for {destinations.find((entry) => entry.id === replaceId)?.name}.
          <Button variant="ghost" onClick={() => setReplaceId(undefined)}>Cancel replacement</Button></p>}
        <ul aria-label="Destination candidates">{candidates.map((place) => <li key={place.placeId}><Button variant="outline"
          disabled={(!replaceId && destinations.length >= 8) || (ambiguous(place, candidates) && !place.location)} onClick={() => choose(place)}>
          {replaceId ? "Replace with" : "Add"} {place.name}, {place.countryCode} ({place.kind}, {place.timezone}{locationHint(place, candidates)})
        </Button></li>)}</ul>
        <ol aria-label="Selected destinations" className="destination-list">{destinations.map((destination, index) => <li key={destination.id} data-destination-id={destination.id}>
          <span className="destination-list__name">{destination.name}, {destination.countryCode}</span>
          <div><Button variant="ghost" aria-label={`Move ${destination.name} earlier`} disabled={index === 0} onClick={() => move(index, -1)}>Earlier</Button>
          <Button variant="ghost" aria-label={`Move ${destination.name} later`} disabled={index === destinations.length - 1} onClick={() => move(index, 1)}>Later</Button>
          <Button variant="outline" aria-label={`Replace ${destination.name}`} onClick={() => { setReplaceId(destination.id); searchRef.current?.focus(); }}>Replace</Button>
          <Button variant="ghost" aria-label={`Remove ${destination.name}`} onClick={() => remove(destination)}>Remove</Button></div>
          {!destination.location && <small>Shown in your route list; map coordinates unavailable.</small>}
        </li>)}</ol>
      </fieldset>
      <Sheet open={country !== null} onOpenChange={(open) => { if (!open) { request.current++; setBusy(false); setCountry(null); } }}>
        <SheetContent><SheetTitle>{country?.name ?? "Choose destinations"}</SheetTitle>
          <SheetDescription>Confirm the country or choose resolved cities. Search and route-list controls offer the same actions.</SheetDescription>
          {busy && <p role="status">Finding destinations…</p>}
          {!busy && !countryCandidates.length && <p>No resolved destinations are available here. Close this panel and search by name.</p>}
          <ul>{countryCandidates.map((place) => <li key={place.placeId}><Button variant="outline" disabled={ambiguous(place, countryCandidates) && !place.location} onClick={() => choose(place)}>
            {replaceId ? "Replace with" : "Add"} {place.name} ({place.kind}, {place.timezone}{locationHint(place, countryCandidates)})
          </Button></li>)}</ul>
          <p role="status">{error}</p>
        </SheetContent>
      </Sheet></>}
    <p role="status" aria-live="polite">{error || (busy ? "Searching…" : "")}</p>
  </div>;
}
