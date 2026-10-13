"use client";
import { useEffect, useRef, useState } from "react";
import type { TripSnapshot } from "@/domain/trip/schema";
export function EstimateMap({ destinations }: { destinations: TripSnapshot["destinations"] }) {
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
        for (const destination of destinations) if (destination.location) {
          const label = document.createElement("span"); label.textContent = destination.name; label.className = "map-label";
          new library.Marker({ element: label }).setLngLat([destination.location.longitude, destination.location.latitude]).addTo(map);
        }
        if (points.length > 1) {
          map.addSource("route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points } } });
          map.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": "#164f71", "line-width": 3 } });
          const bounds = points.reduce((box, point) => box.extend(point), new library.LngLatBounds(points[0], points[0]));
          map.fitBounds(bounds, { padding: 50, animate: false });
        }
      });
    }).catch(() => { if (!stopped) setFailed(true); });
    return () => { stopped = true; map?.remove(); };
  }, [visible, destinations]);
  return <section aria-label="Optional route map"><button type="button" onClick={() => { setFailed(false); setVisible(!visible); }}>{visible ? "Hide route map" : "Show optional route map"}</button>
    {visible && <><div ref={container} aria-hidden="true" style={{ height: 300 }} /><p>Diagram of selected places, not verified roads or transport directions. The ordered route list contains the same destinations.</p></>}
    {failed && <p role="status">Map unavailable. Use the route list; hide and reopen the map to retry.</p>}
  </section>;
}
