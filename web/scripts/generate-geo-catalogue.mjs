// Builds the bundled geography catalogue used by live place lookup for country
// quick-picks and airport results. Sources are public datasets; regenerate with
// `pnpm --filter @onholidai/web geo:catalogue`.
import { inflateRawSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const CITIES_URL = "https://download.geonames.org/export/dump/cities5000.zip";
const AIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const CITIES_PER_COUNTRY = 12;
const outputPath = resolve(process.cwd(), "server/supply/geo-catalogue.json");

// GeoNames city feature codes that describe a settlement rather than a suburb,
// abandoned site or farm. PPLX (section of a populated place) is excluded so
// quick-picks stay recognisable cities.
const settlementCodes = new Set([
  "PPLC",
  "PPLA",
  "PPLA2",
  "PPLA3",
  "PPLA4",
  "PPLA5",
  "PPL",
  "PPLG",
  "PPLS",
  "PPLL",
]);

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Dataset download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

// Minimal single-entry reader for the deflate-compressed zip GeoNames publishes.
function readZipEntry(archive) {
  const minimumEocd = 22;
  let eocd = -1;
  for (let offset = archive.length - minimumEocd; offset >= 0; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("Zip end of central directory not found");
  const entries = archive.readUInt16LE(eocd + 10);
  if (entries !== 1) throw new Error(`Expected a single zip entry, found ${entries}`);
  const directory = archive.readUInt32LE(eocd + 16);
  if (archive.readUInt32LE(directory) !== 0x02014b50) throw new Error("Zip directory is invalid");
  const compression = archive.readUInt16LE(directory + 10);
  const compressedSize = archive.readUInt32LE(directory + 20);
  const nameLength = archive.readUInt16LE(directory + 28);
  const extraLength = archive.readUInt16LE(directory + 30);
  const commentLength = archive.readUInt16LE(directory + 32);
  const localOffset = archive.readUInt32LE(directory + 42);
  if (archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Zip local header invalid");
  const dataStart =
    localOffset +
    30 +
    archive.readUInt16LE(localOffset + 26) +
    archive.readUInt16LE(localOffset + 28);
  const data = archive.subarray(dataStart, dataStart + compressedSize);
  if (compression === 0) return data.toString("utf8");
  if (compression !== 8) throw new Error(`Unsupported zip compression method ${compression}`);
  void nameLength;
  void extraLength;
  void commentLength;
  return inflateRawSync(data).toString("utf8");
}

function coordinate(value, limit) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) return null;
  return Math.round(parsed * 10_000) / 10_000;
}

function distanceSquared(latitude, longitude, otherLatitude, otherLongitude) {
  const scale = Math.cos((latitude * Math.PI) / 180);
  const latitudeDelta = latitude - otherLatitude;
  const longitudeDelta = (longitude - otherLongitude) * scale;
  return latitudeDelta * latitudeDelta + longitudeDelta * longitudeDelta;
}

function citiesFromDump(text) {
  const cities = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const columns = line.split("\t");
    if (columns.length < 19) continue;
    const [id, name, , , latitude, longitude, featureClass, featureCode, countryCode] = columns;
    const timezone = columns[17];
    const population = Number.parseInt(columns[14], 10);
    if (featureClass !== "P" || !settlementCodes.has(featureCode)) continue;
    if (!/^[A-Z]{2}$/.test(countryCode) || !timezone) continue;
    const location = {
      latitude: coordinate(latitude, 90),
      longitude: coordinate(longitude, 180),
    };
    if (location.latitude === null || location.longitude === null) continue;
    if (!Number.isFinite(population) || population <= 0) continue;
    cities.push({
      placeId: `geonames:${id}`,
      kind: "city",
      name: name.trim().slice(0, 120),
      countryCode,
      timezone,
      airportCode: null,
      location,
      rank: population,
    });
  }
  return cities;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") field += character;
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows;
  return data.map((entry) =>
    Object.fromEntries(header.map((column, index) => [column, entry[index] ?? ""])),
  );
}

function airportsFromCsv(text, cities) {
  const byCountry = new Map();
  for (const city of cities) {
    const bucket = byCountry.get(city.countryCode) ?? [];
    bucket.push(city);
    byCountry.set(city.countryCode, bucket);
  }
  const airports = [];
  for (const port of parseCsv(text)) {
    if (!["large_airport", "medium_airport"].includes(port.type)) continue;
    if (port.scheduled_service !== "yes" || port.iata_code.length !== 3) continue;
    const countryCode = port.iso_country;
    if (!/^[A-Z]{2}$/.test(countryCode)) continue;
    const location = {
      latitude: coordinate(port.latitude_deg, 90),
      longitude: coordinate(port.longitude_deg, 180),
    };
    if (location.latitude === null || location.longitude === null) continue;
    const name = port.name.trim().slice(0, 120);
    if (!name) continue;
    // OurAirports carries no timezone column; the nearest same-country
    // settlement from GeoNames supplies one, which is correct for every airport
    // inside a single national timezone and off only for the rare exceptions.
    let nearest = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const city of byCountry.get(countryCode) ?? []) {
      const distance = distanceSquared(
        location.latitude,
        location.longitude,
        city.location.latitude,
        city.location.longitude,
      );
      if (distance < nearestDistance) {
        nearest = city;
        nearestDistance = distance;
      }
    }
    if (!nearest) continue;
    airports.push({
      placeId: `ourairports:${port.id}`,
      kind: "airport",
      name,
      countryCode,
      timezone: nearest.timezone,
      airportCode: port.iata_code,
      location,
      city: port.municipality.trim().slice(0, 120),
      rank: port.type === "large_airport" ? nearest.rank : Math.floor(nearest.rank / 4),
    });
  }
  return airports;
}

const [archive, airportsCsv] = await Promise.all([download(CITIES_URL), download(AIRPORTS_URL)]);
const cities = citiesFromDump(readZipEntry(archive));
const byCountry = new Map();
for (const city of cities) {
  const bucket = byCountry.get(city.countryCode) ?? [];
  bucket.push(city);
  byCountry.set(city.countryCode, bucket);
}
const selectedCities = [];
for (const bucket of byCountry.values()) {
  selectedCities.push(
    ...bucket.sort((first, second) => second.rank - first.rank).slice(0, CITIES_PER_COUNTRY),
  );
}
const airports = airportsFromCsv(airportsCsv.toString("utf8"), cities);
const places = [...selectedCities, ...airports].sort(
  (first, second) =>
    first.countryCode.localeCompare(second.countryCode) ||
    first.kind.localeCompare(second.kind) ||
    second.rank - first.rank ||
    first.name.localeCompare(second.name),
);

const generated = `{
  "version": 1,
  "attribution": {
    "cities": "GeoNames cities5000, licensed under CC BY 4.0 (https://www.geonames.org/)",
    "airports": "OurAirports, public domain (https://ourairports.com/data/)"
  },
  "places": [
${places.map((place) => `    ${JSON.stringify(place)}`).join(",\n")}
  ]
}
`;

await writeFile(outputPath, generated, "utf8");
console.log(
  `Wrote ${places.length} places (${selectedCities.length} cities, ${airports.length} airports) to ${outputPath}`,
);
