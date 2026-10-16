import { readFile } from "node:fs/promises";
import { join } from "node:path";
type Geometry = { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
type Countries = { features: { geometry: Geometry }[] };
// Orthographic projection of the same Natural Earth data used by the planning globe.
function point(longitude: number, latitude: number): [number, number, number] {
  const lon = (longitude - 25) * Math.PI / 180, lat = latitude * Math.PI / 180, tilt = 30 * Math.PI / 180;
  return [260 + 214 * Math.cos(lat) * Math.sin(lon), 250 - 214 * (Math.cos(tilt) * Math.sin(lat) - Math.sin(tilt) * Math.cos(lat) * Math.cos(lon)), Math.sin(tilt) * Math.sin(lat) + Math.cos(tilt) * Math.cos(lat) * Math.cos(lon)];
}
export async function JourneyGlobe() {
  const countries = JSON.parse(await readFile(join(process.cwd(), "public/maps/countries.geojson"), "utf8")) as Countries;
  const paths = countries.features.flatMap(({ geometry }) => (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates).flatMap((polygon) => {
    const projected = polygon[0].map(([lon, lat]) => point(lon, lat));
    if (!projected.some((entry) => entry[2] > 0)) return [];
    return [projected.filter((entry) => entry[2] >= 0).map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + "Z"];
  }));
  const places = [{ name: "Lisbon", coordinates: [-9.14, 38.72] }, { name: "Rome", coordinates: [12.5, 41.9] }, { name: "Istanbul", coordinates: [28.98, 41.01] }];
  const positions = places.map((place) => point(place.coordinates[0], place.coordinates[1]));
  return <figure className="journey-globe"><svg viewBox="0 0 520 500" role="img" aria-labelledby="journey-globe-title journey-globe-description">
    <title id="journey-globe-title">One holiday, shaped around you</title><desc id="journey-globe-description">Illustrative AI-planned journey from Lisbon to Rome and Istanbul. A traveller asks for a nice coffee stop in Lisbon, food discoveries in Rome, and one more night in Istanbul. Each preference is connected to its destination.</desc>
    <defs><clipPath id="journey-earth"><circle cx="260" cy="250" r="214"/></clipPath><radialGradient id="journey-sea" cx="35%" cy="25%"><stop stopColor="#f0f8fb"/><stop offset="1" stopColor="#b7d9e1"/></radialGradient></defs>
    <circle cx="260" cy="250" r="231" fill="none" stroke="#bdd5d9" strokeDasharray="2 9"/><circle cx="260" cy="250" r="214" fill="url(#journey-sea)"/>
    <g clipPath="url(#journey-earth)">{paths.map((path, index) => <path key={index} d={path} fill="#e6eee5" stroke="#91aa9b" strokeWidth=".6"/>)}
      <ellipse cx="260" cy="250" rx="214" ry="62" fill="none" stroke="#87aeb9" strokeWidth=".6"/><ellipse cx="260" cy="250" rx="89" ry="214" fill="none" stroke="#87aeb9" strokeWidth=".6"/>
    </g>
    <path d={`M${positions[0][0]},${positions[0][1]} Q${(positions[0][0] + positions[1][0]) / 2},${positions[1][1] - 45} ${positions[1][0]},${positions[1][1]} Q${(positions[1][0] + positions[2][0]) / 2},${positions[2][1] - 35} ${positions[2][0]},${positions[2][1]}`} stroke="#12664f" strokeWidth="2.5" strokeDasharray="4 5" fill="none"/>
    {positions.map(([x, y], index) => <g key={places[index].name}><circle cx={x} cy={y} r="12" fill="#fff"/><circle cx={x} cy={y} r="6" fill="#12664f"/><text x={x} y={y + 29} textAnchor="middle" fill="#084c3a" fontSize="13" fontWeight="700">{places[index].name}</text></g>)}
    <g className="journey-globe__bubble"><path d={`M115 157 L${positions[0][0]} ${positions[0][1]}`} stroke="#708078" fill="none"/><rect x="14" y="60" width="206" height="100" rx="16" fill="white"/><text x="29" y="86" fontSize="12" fill="#4f5c56">Lisbon</text><text x="29" y="111" fontSize="16" fill="#19211e"><tspan x="29">“Look for a nice</tspan><tspan x="29" dy="23"> coffee stop”</tspan></text></g>
    <g className="journey-globe__bubble"><path d={`M290 85 L${positions[1][0]} ${positions[1][1]}`} stroke="#708078" fill="none"/><rect x="255" y="19" width="224" height="68" rx="16" fill="#12664f"/><text x="270" y="45" fontSize="12" fill="white">Rome</text><text x="270" y="67" fontSize="15" fill="white">“Let’s follow the food.”</text></g>
    <g className="journey-globe__bubble"><path d={`M398 283 L${positions[2][0]} ${positions[2][1]}`} stroke="#708078" fill="none"/><rect x="297" y="283" width="214" height="100" rx="16" fill="white"/><text x="312" y="309" fontSize="12" fill="#4f5c56">Istanbul</text><text x="312" y="334" fontSize="16" fill="#19211e"><tspan x="312">“Can we add</tspan><tspan x="312" dy="23"> one more night?”</tspan></text></g>
  </svg><figcaption>Illustrative journey · Natural Earth map data. Your preferences shape every stop.</figcaption></figure>;
}
