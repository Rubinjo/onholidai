"use client";
import { useEffect, useRef, useState } from "react";
import type { TripSnapshot } from "@/domain/trip/schema";
type Segment = NonNullable<TripSnapshot["itineraryDays"][number]["items"][number]["travelSegment"]>;
const noSegments: Segment[] = [];
export function EstimateMap({ destinations, segments = noSegments }: { destinations: TripSnapshot["destinations"]; segments?: Segment[] }) {
  const [visible, setVisible] = useState(false), [failed, setFailed] = useState(false), container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!visible || !container.current) return;
    let stopped = false;
    let map: import("maplibre-gl").Map | undefined;
    void import("maplibre-gl").then((library) => {
      if (stopped || !container.current) return;
      map = new library.Map({ container: container.current, style: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#e7eff5" } }] }, center: [0, 20], zoom: 1, attributionControl: false });
      map.on("error", () => { if (!stopped) setFailed(true); });
      const points = destinations.flatMap((destination) => destination.location ? [[destination.location.longitude, destination.location.latitude] as [number, number]] : []);
      map.on("load", () => {
        if (!map || stopped) return;
        map.addSource("countries", { type: "geojson", data: "/maps/countries.geojson" });
        map.addLayer({ id: "countries", type: "fill", source: "countries", paint: { "fill-color": "#f6f3ed", "fill-outline-color": "#667782" } });
        map.addLayer({ id: "selected-countries", type: "fill", source: "countries", filter: ["in", ["coalesce", ["get", "ISO_A2_EH"], ["get", "ISO_A2"]], ["literal", [...new Set(destinations.map((entry) => entry.countryCode))]]], paint: { "fill-color": "#d2e5cc", "fill-outline-color": "#345230" } });
        for (const destination of destinations) if (destination.location) {
          const label = document.createElement("span"); label.textContent = `${destination.routePosition + 1}. ${destination.name}`; label.className = "map-label";
          new library.Marker({ element: label }).setLngLat([destination.location.longitude, destination.location.latitude]).addTo(map);
        }
        if (points.length > 1) {
          map.addSource("route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points } } });
          map.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": "#164f71", "line-width": 3 } });
          const bounds = points.reduce((box, point) => box.extend(point), new library.LngLatBounds(points[0], points[0]));
          map.fitBounds(bounds, { padding: 50, animate: false });
        }
        for (const [index, segment] of segments.entries()) if (segment.routeGeometry && segment.routeGeometry.length > 1) {
          map.addSource(`segment-${index}`, { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: segment.routeGeometry.map((point) => [point.longitude, point.latitude]) } } });
          map.addLayer({ id: `segment-${index}`, type: "line", source: `segment-${index}`, paint: { "line-color": "#8b3d21", "line-width": 4, "line-dasharray": segment.verificationStatus === "verified" ? [1, 0] : [2, 2] } });
        }
      });
    }).catch(() => { if (!stopped) setFailed(true); });
    return () => { stopped = true; map?.remove(); };
  }, [visible, destinations, segments]);
  return <section aria-label="Optional route map"><button type="button" onClick={() => { setFailed(false); setVisible(!visible); }}>{visible ? "Hide route map" : "Show optional route map"}</button>
    {visible && <><div ref={container} aria-hidden="true" style={{ height: 300 }} /><p>Made with Natural Earth. Selected countries and numbered destinations match the route list. Connecting lines are a planning diagram; sourced segments, when available, retain their verification status.</p></>}
    {failed && <p role="status">Map unavailable. Use the route list; hide and reopen the map to retry.</p>}
  </section>;
}
