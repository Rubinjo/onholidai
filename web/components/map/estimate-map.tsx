"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";

import type { GeoJSONSource, Map as LibreMap, Marker } from "maplibre-gl";
import type { TripSnapshot } from "@/domain/trip/schema";

type Segment = NonNullable<TripSnapshot["itineraryDays"][number]["items"][number]["travelSegment"]>;
const noSegments: Segment[] = [];
const noActivities: Record<string, string[]> = {};
const workerUrl = "/maplibre/maplibre-gl-worker.mjs";
const modes: Record<Segment["mode"], string> = {
  flight: "✈ Plane",
  rail: "▰ Train",
  bus: "▣ Bus",
  public_transport: "Public transport (mode not specified)",
  drive: "▱ Car",
  transfer: "▱ Transfer",
  walk: "Walk",
  ferry: "Ferry",
  other: "Transport not specified",
};
export function EstimateMap({
  destinations,
  segments = noSegments,
  activities = noActivities,
  fill = false,
}: {
  destinations: TripSnapshot["destinations"];
  segments?: Segment[];
  activities?: Record<string, string[]>;
  fill?: boolean;
}) {
  const [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  const container = useRef<HTMLDivElement>(null),
    map = useRef<LibreMap | null>(null),
    markers = useRef<Marker[]>([]);
  const markerFactory = useRef<((element: HTMLElement) => Marker) | null>(null);
  const viewport = useRef("");
  const countryCenters = useRef(new Map<string, [number, number]>());
  const current = useRef({ destinations, segments, activities });
  const update = useCallback(() => {
    const instance = map.current;
    if (!instance?.getSource("route")) return;
    const data = current.current;
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
    const points = data.destinations.flatMap((place) =>
      place.location
        ? [[place.location.longitude, place.location.latitude] as [number, number]]
        : [],
    );
    (instance.getSource("route") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features:
        points.length > 1
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: points },
              },
            ]
          : [],
    });
    (instance.getSource("segments") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: data.segments.flatMap((segment) =>
        segment.routeGeometry && segment.routeGeometry.length > 1
          ? [
              {
                type: "Feature" as const,
                properties: { mode: segment.mode, verified: segment.verificationStatus },
                geometry: {
                  type: "LineString" as const,
                  coordinates: segment.routeGeometry.map((point) => [
                    point.longitude,
                    point.latitude,
                  ]),
                },
              },
            ]
          : [],
      ),
    });
    instance.setFilter("selected-countries", [
      "in",
      ["coalesce", ["get", "ISO_A2_EH"], ["get", "ISO_A2"]],
      ["literal", [...new Set(data.destinations.map((place) => place.countryCode))]],
    ]);
    for (const place of data.destinations)
      if (place.location) {
        const label = document.createElement("div");
        label.className = "map-stop";
        const name = document.createElement("strong");
        name.textContent = `${place.routePosition + 1}. ${place.name}`;
        const stay = document.createElement("span");
        stay.textContent = place.plannedNights
          ? `${place.plannedNights} nights`
          : "Stay to be planned";
        const activity = document.createElement("small");
        activity.textContent =
          data.activities[place.id]?.slice(0, 2).join(" · ") || "Activities to be planned";
        label.append(name, stay, activity);
        const marker = markerFactory
          .current?.(label)
          .setLngLat([place.location.longitude, place.location.latitude])
          .addTo(instance);
        if (marker) markers.current.push(marker);
      }
    for (const segment of data.segments)
      if (segment.routeGeometry?.length) {
        const midpoint = segment.routeGeometry[Math.floor(segment.routeGeometry.length / 2)];
        const label = document.createElement("span");
        label.className = "map-transport";
        label.textContent = modes[segment.mode];
        label.title = `${segment.origin.name} to ${segment.destination.name}; ${segment.verificationStatus}`;
        const marker = markerFactory
          .current?.(label)
          .setLngLat([midpoint.longitude, midpoint.latitude])
          .addTo(instance);
        if (marker) markers.current.push(marker);
      }
    // Country selections do not have stop coordinates. Use the basemap's label
    // position for the camera only, without inventing route points or markers.
    const cameraPoints = data.destinations.flatMap((place): [number, number][] => {
      if (place.location) return [[place.location.longitude, place.location.latitude]];
      const center = countryCenters.current.get(place.countryCode);
      return center ? [center] : [];
    });
    const nextViewport = JSON.stringify(cameraPoints);
    if (viewport.current === nextViewport) return;
    viewport.current = nextViewport;
    if (cameraPoints.length > 1) {
      const west = Math.min(...cameraPoints.map((point) => point[0])),
        east = Math.max(...cameraPoints.map((point) => point[0]));
      const south = Math.min(...cameraPoints.map((point) => point[1])),
        north = Math.max(...cameraPoints.map((point) => point[1]));
      instance.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 75, maxZoom: 5, animate: false },
      );
    } else if (cameraPoints[0]) instance.jumpTo({ center: cameraPoints[0], zoom: 3 });
  }, []);
  useEffect(() => {
    current.current = { destinations, segments, activities };
    update();
  }, [destinations, segments, activities, update]);
  useEffect(() => {
    let stopped = false,
      observer: ResizeObserver | undefined;
    void import("maplibre-gl")
      .then((library) => {
        if (stopped || !container.current) return;
        library.setWorkerUrl(workerUrl);
        const firstLocation = current.current.destinations.find(
          (place) => place.location,
        )?.location;
        const instance = new library.Map({
          container: container.current,
          style: {
            version: 8,
            sources: {},
            layers: [
              { id: "background", type: "background", paint: { "background-color": "#deedf0" } },
            ],
          },
          center: firstLocation ? [firstLocation.longitude, firstLocation.latitude] : [20, 25],
          zoom: firstLocation ? 3 : 1,
          attributionControl: false,
        });
        map.current = instance;
        viewport.current = "";
        instance.getCanvas().tabIndex = -1;
        instance.on("error", () => {
          if (!stopped) setFailed(true);
        });
        instance.on("load", () => {
          if (stopped) return;
          instance.setProjection({ type: "globe" });
          instance.addSource("countries", { type: "geojson", data: "/maps/countries.geojson" });
          instance.addLayer({
            id: "countries",
            type: "fill",
            source: "countries",
            paint: { "fill-color": "#f7f8f6", "fill-outline-color": "#708078" },
          });
          instance.addLayer({
            id: "selected-countries",
            type: "fill",
            source: "countries",
            paint: { "fill-color": "#a9d4bf" },
          });
          for (const name of ["route", "segments"])
            instance.addSource(name, {
              type: "geojson",
              data: { type: "FeatureCollection", features: [] },
            });
          instance.addLayer({
            id: "route",
            type: "line",
            source: "route",
            paint: { "line-color": "#12664f", "line-width": 2, "line-dasharray": [2, 3] },
          });
          instance.addLayer({
            id: "transport",
            type: "line",
            source: "segments",
            paint: {
              "line-color": [
                "match",
                ["get", "mode"],
                "flight",
                "#164f71",
                "rail",
                "#12664f",
                "drive",
                "#785519",
                "bus",
                "#674d89",
                "public_transport",
                "#674d89",
                "#4f5c56",
              ],
              "line-width": 4,
              "line-dasharray": [
                "case",
                ["==", ["get", "verified"], "verified"],
                ["literal", [1, 0]],
                ["literal", [2, 2]],
              ],
            },
          });
          markerFactory.current = (element) => new library.Marker({ element });
          update();
          void (instance.getSource("countries") as GeoJSONSource)
            .getData()
            .then((data) => {
              if (stopped) return;
              if (data.type !== "FeatureCollection") throw new Error("Invalid country basemap");
              for (const { properties } of data.features) {
                const code: unknown = properties?.ISO_A2_EH ?? properties?.ISO_A2,
                  longitude: unknown = properties?.LABEL_X,
                  latitude: unknown = properties?.LABEL_Y;
                if (
                  typeof code === "string" &&
                  typeof longitude === "number" &&
                  typeof latitude === "number"
                )
                  countryCenters.current.set(code, [longitude, latitude]);
              }
              update();
            })
            .catch(() => {
              if (!stopped) setFailed(true);
            });
        });
        observer = new ResizeObserver(() => instance.resize());
        observer.observe(container.current);
      })
      .catch(() => {
        if (!stopped) setFailed(true);
      });
    return () => {
      stopped = true;
      observer?.disconnect();
      markers.current.forEach((marker) => marker.remove());
      map.current?.remove();
      map.current = null;
    };
  }, [retry, update]);
  return (
    <section
      aria-label="Route map"
      className={fill ? "map-section map-section--fill" : "map-section"}
    >
      <div ref={container} className="map-section__canvas" aria-hidden="true" />
      <p>
        Made with Natural Earth. Dotted connections illustrate the journey. Transport labels and
        sourced paths retain their verification status.
      </p>
      <ul className="map-leg-key" aria-label="Transport between destinations">
        {segments.map((segment, index) => (
          <li key={index}>
            {modes[segment.mode]}: {segment.origin.name} to {segment.destination.name} ·{" "}
            {segment.durationMinutes} min · {segment.verificationStatus}
            {!segment.routeGeometry?.length && " · route geometry unavailable"}
          </li>
        ))}
      </ul>
      {!segments.length && (
        <div role="status">
          <p>Transport between stops is not yet specified.</p>
          {destinations.length > 1 && (
            <>
              <ul aria-label="Unpriced transport options">
                {destinations.slice(1).map((destination, index) => (
                  <li key={destination.id}>
                    {destinations[index].name} to {destination.name}:{" "}
                    {destinations[index].countryCode === destination.countryCode
                      ? "consider a train or rental car. Search and booking are not supported yet."
                      : "transport options, schedules and costs still need research."}
                  </li>
                ))}
              </ul>
              <p>
                These journeys, airport transfers and any return to your flight gateway are not
                included in the estimate. Check schedules and costs separately.
              </p>
            </>
          )}
        </div>
      )}
      {failed && (
        <div role="status">
          Map unavailable. Your route details remain accessible.
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setRetry((value) => value + 1);
            }}
          >
            Retry route map
          </button>
        </div>
      )}
    </section>
  );
}
