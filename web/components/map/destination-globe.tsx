"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as LibreMap, GeoJSONSource } from "maplibre-gl";
import type { TripSnapshot } from "@/domain/trip/schema";
import type { PlaceCandidate } from "@/domain/trip/destination";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function DestinationGlobe({ destinations, candidates = [], onCountry, onCity }: {
  destinations: TripSnapshot["destinations"]; candidates?: readonly PlaceCandidate[];
  onCountry: (code: string, name: string) => void; onCity?: (place: PlaceCandidate) => void;
}) {
  const container = useRef<HTMLDivElement>(null), map = useRef<LibreMap | null>(null);
  const [failed, setFailed] = useState(false), [loaded, setLoaded] = useState(false), [retry, setRetry] = useState(0);
  const actions = useRef({ onCountry, onCity, candidates });
  const selections = useRef(destinations);
  useEffect(() => { actions.current = { onCountry, onCity, candidates }; selections.current = destinations; }, [onCountry, onCity, candidates, destinations]);
  const updateSources = useCallback(() => {
    const instance = map.current;
    if (!instance?.getSource("cities")) return;
    const places = [...selections.current.filter((entry) => entry.location).map((entry) => ({ placeId: entry.id, name: entry.name, location: entry.location })),
      ...actions.current.candidates.filter((entry) => entry.kind === "city" && entry.location)];
    (instance.getSource("cities") as GeoJSONSource).setData({ type: "FeatureCollection", features: places.map((place) => ({
      type: "Feature", properties: { placeId: place.placeId, name: place.name },
      geometry: { type: "Point", coordinates: [place.location!.longitude, place.location!.latitude] } })) });
    instance.setFilter("selected", ["in", ["coalesce", ["get", "ISO_A2_EH"], ["get", "ISO_A2"]],
      ["literal", [...new Set(selections.current.map((entry) => entry.countryCode))]]]);
  }, []);
  useEffect(() => {
    let stopped = false, observer: ResizeObserver | undefined;
    if (!container.current) return;
    void import("maplibre-gl").then((library) => {
      if (stopped || !container.current) return;
      library.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      const instance = new library.Map({ container: container.current, center: [20, 25], zoom: 0.7,
        attributionControl: false, style: { version: 8, sources: {}, layers: [
          { id: "ocean", type: "background", paint: { "background-color": "#deedf0" } }] } });
      map.current = instance;
      instance.getCanvas().setAttribute("tabindex", "-1");
      instance.on("error", () => { if (!stopped) { setFailed(true); setLoaded(false); } });
      instance.on("load", () => {
        if (stopped) return;
        instance.setProjection({ type: "globe" });
        instance.addSource("countries", { type: "geojson", data: "/maps/countries.geojson" });
        instance.addLayer({ id: "countries", type: "fill", source: "countries", paint: { "fill-color": "#f7f8f6", "fill-outline-color": "#708078" } });
        instance.addLayer({ id: "selected", type: "fill", source: "countries", paint: { "fill-color": "#a9d4bf" }, filter: ["==", ["get", "ISO_A2"], ""] });
        instance.addSource("cities", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        instance.addLayer({ id: "cities", type: "circle", source: "cities", paint: { "circle-radius": 6, "circle-color": "#12664f", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
        updateSources(); setLoaded(true);
      });
      instance.on("click", (event) => {
        if (!instance.getLayer("countries")) return;
        const city = instance.queryRenderedFeatures(event.point, { layers: ["cities"] })[0];
        const place = actions.current.candidates.find((candidate) => candidate.placeId === city?.properties?.placeId);
        if (place && actions.current.onCity) { actions.current.onCity(place); return; }
        const country = instance.queryRenderedFeatures(event.point, { layers: ["countries"] })[0]?.properties;
        const code: unknown = country?.ISO_A2_EH ?? country?.ISO_A2, name: unknown = country?.NAME_EN ?? country?.NAME;
        if (typeof code === "string" && /^[A-Z]{2}$/.test(code) && typeof name === "string") actions.current.onCountry(code, name);
      });
      observer = new ResizeObserver(() => instance.resize()); observer.observe(container.current);
      // No automatic rotation, entrance camera or delayed controls, including reduced motion.
    }).catch(() => { if (!stopped) setFailed(true); });
    return () => { stopped = true; observer?.disconnect(); map.current?.remove(); map.current = null; };
  // Sources update separately; selections never recreate the map instance.
  }, [retry, updateSources]);
  useEffect(() => { if (loaded) updateSources(); }, [destinations, candidates, loaded, updateSources]);
  return <section className="destination-globe" aria-label="Globe destination picker">
    {!loaded && !failed && <Skeleton className="globe-skeleton" />}
    <div ref={container} className="destination-globe__canvas" aria-hidden="true" />
    {failed && <div role="status"><p>The globe is unavailable. Search and the ordered list below work independently.</p>
      <Button variant="outline" onClick={() => { setFailed(false); setLoaded(false); setRetry((value) => value + 1); }}>Retry globe</Button></div>}
    <p>Made with Natural Earth. Choose a country, then confirm a resolved destination. City points match the search results and route list; this is a planning diagram.</p>
  </section>;
}
