#!/usr/bin/env node
/**
 * Seeds the authenticated US2 acceptance fixture against a running local stack.
 *
 * Creates (or reuses) a synthetic account, writes a Playwright storage state,
 * creates a Tokyo/Kyoto draft from the US1 setup inputs, runs one
 * `initial_estimate` research request, explicitly accepts the resulting
 * proposal, and prints the US1_STORAGE_STATE and US2_TRIP_ID values the
 * refinement suites expect.
 *
 * Usage:
 *   node scripts/seed-us2-fixture.mjs [--base-url http://localhost:3000]
 *     [--email synthetic-us2@example.invalid] [--password <synthetic password>]
 *     [--state <path>] [--timeout-seconds 120]
 *
 * Requires the migrated stack to be running (see specs/001-ai-trip-agent/quickstart.md).
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function parseArguments(argv) {
  const options = {
    baseUrl: process.env.PLAYWRIGHT_BASE_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    email: "synthetic-us2@example.invalid",
    password: "synthetic-us2-password-000000000",
    state: ".playwright/us2-storage-state.json",
    timeoutSeconds: 120,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const [name, inline] = argv[index].split("=");
    const value = inline ?? argv[++index];
    if (name === "--base-url") options.baseUrl = value;
    else if (name === "--email") options.email = value;
    else if (name === "--password") options.password = value;
    else if (name === "--state") options.state = value;
    else if (name === "--timeout-seconds") options.timeoutSeconds = Number(value);
    else throw new Error(`Unknown argument: ${name}`);
  }
  options.baseUrl = options.baseUrl.replace(/\/$/, "");
  return options;
}

function cookiesFrom(response, baseUrl) {
  const host = new URL(baseUrl).hostname;
  return (response.headers.getSetCookie?.() ?? []).map((raw) => {
    const [pair, ...attributes] = raw.split(";").map((part) => part.trim());
    const separator = pair.indexOf("=");
    const attribute = (key) =>
      attributes.find((entry) => entry.toLowerCase().startsWith(`${key}=`))?.split("=").slice(1).join("=");
    const expires = attribute("expires");
    return {
      name: pair.slice(0, separator),
      value: pair.slice(separator + 1),
      domain: host,
      path: attribute("path") ?? "/",
      expires: expires ? Math.floor(new Date(expires).getTime() / 1000) : -1,
      httpOnly: attributes.some((entry) => entry.toLowerCase() === "httponly"),
      secure: attributes.some((entry) => entry.toLowerCase() === "secure"),
      sameSite: attribute("samesite") ?? "Lax",
    };
  });
}

function createClient(baseUrl) {
  let cookieHeader = "";
  return {
    setCookies(cookies) {
      cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    },
    async call(path, body, expected = [200]) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", origin: baseUrl, ...(cookieHeader ? { cookie: cookieHeader } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      if (!expected.includes(response.status)) {
        throw new Error(`${path} returned ${response.status}: ${text.slice(0, 400)}`);
      }
      return { response, payload };
    },
  };
}

function buildDraft(requestId) {
  const destination = (name, countryCode, latitude, longitude, routePosition, arrivalDate, departureDate, plannedNights) => ({
    id: randomUUID(), kind: "city", name, countryCode, providerPlaceIds: {},
    location: { latitude, longitude }, routePosition, arrivalDate, departureDate, plannedNights,
  });
  return {
    requestId,
    title: "Tokyo and Kyoto living trip",
    currency: "GBP",
    snapshot: {
      departureOrigin: {
        kind: "airport", placeId: "synthetic-place-gb-lhr", name: "London Heathrow",
        countryCode: "GB", timezone: "Europe/London", airportCode: "LHR", confirmedByUser: true,
      },
      availabilityWindows: [
        { id: randomUUID(), startDate: "2030-05-01", endDate: "2030-05-14", preference: "preferred", timezone: "Asia/Tokyo" },
      ],
      duration: { minimumDays: 5, idealDays: 9, maximumDays: 12 },
      travellerParty: { adults: 2, children: [] },
      preferences: { pace: 50, spend: 45, discovery: 70, independence: 60, setting: 40 },
      constraints: [
        { id: randomUUID(), category: "dietary", statement: "Synthetic vegetarian meal requirement",
          priority: "required", source: { kind: "setup_text", referenceId: null }, status: "active", confirmedByUser: true },
      ],
      destinations: [
        destination("Tokyo", "JP", 35.6762, 139.6503, 0, "2030-05-01", "2030-05-06", 5),
        destination("Kyoto", "JP", 35.0116, 135.7681, 1, "2030-05-06", "2030-05-10", 4),
      ],
      itineraryDays: [],
      components: [],
      price: {
        currency: "GBP", finalCustomerMinor: 0, taxesMinor: 0, feesMinor: 0,
        status: "estimated", checkedAt: new Date().toISOString(),
      },
      warnings: [],
    },
  };
}

const options = parseArguments(process.argv.slice(2));
const client = createClient(options.baseUrl);
process.stdout.write(`Creating or signing in the synthetic account ${options.email}...\n`);

const signUp = await fetch(`${options.baseUrl}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: options.baseUrl },
  body: JSON.stringify({ email: options.email, password: options.password, name: "Synthetic US2" }),
});
let authentication = signUp;
if (!signUp.ok) {
  process.stdout.write(`Sign-up returned ${signUp.status}; signing in instead.\n`);
  authentication = (await client.call("/api/auth/sign-in/email", {
    email: options.email, password: options.password,
  })).response;
}
const cookies = cookiesFrom(authentication, options.baseUrl);
if (cookies.length === 0) throw new Error("Authentication returned no session cookie");
client.setCookies(cookies);

const statePath = resolve(options.state);
await mkdir(dirname(statePath), { recursive: true });
await writeFile(statePath, `${JSON.stringify({ cookies, origins: [] }, null, 2)}\n`);
process.stdout.write(`Wrote storage state to ${statePath}\n`);

const trip = (await client.call("/api/v1/trips", buildDraft(randomUUID()), [201])).payload;
process.stdout.write(`Created trip ${trip.tripId} at version ${trip.version}\n`);

const run = (await client.call(`/api/v1/trips/${trip.tripId}/agent-runs`, {
  requestId: randomUUID(),
  baseTripVersion: trip.version,
  conversationId: null,
  purpose: "initial_estimate",
  message: "Research a new estimate for my current reviewed settings; do not apply it.",
}, [202])).payload;
process.stdout.write(`Reserved research run ${run.id}; waiting for the reviewed proposal...\n`);

const deadline = Date.now() + options.timeoutSeconds * 1000;
let proposal = null;
let clarification = null;
while (Date.now() < deadline) {
  const status = (await client.call(`/api/v1/agent-runs/${run.id}`)).payload;
  proposal ??= status.result?.proposal ?? null;
  clarification ??= status.result?.clarification ?? null;
  if (proposal || clarification) break;
  if (["failed", "cancelled"].includes(status.status)) {
    throw new Error(`Research run ${status.status}: ${JSON.stringify(status).slice(0, 400)}`);
  }
  await new Promise((done) => setTimeout(done, 1000));
}
if (clarification) {
  throw new Error(`Research asked for clarification instead of proposing: ${clarification.question}`);
}
if (!proposal) throw new Error(`No proposal within ${options.timeoutSeconds}s`);

const accepted = (await client.call(`/api/v1/trips/${trip.tripId}/proposals/${proposal.id}/accept`, {
  requestId: randomUUID(),
  expectedVersion: proposal.baseTripVersion,
})).payload;
process.stdout.write(`Accepted the estimate; the trip is now at version ${accepted.version} with ${accepted.snapshot.components.length} components.\n\n`);
process.stdout.write("Export these before running the refinement suites:\n\n");
process.stdout.write(`  US1_STORAGE_STATE=${statePath}\n`);
process.stdout.write(`  US2_TRIP_ID=${trip.tripId}\n`);
process.stdout.write("\nThe refinement scenarios mutate this trip, so seed a fresh one per run.\n");
