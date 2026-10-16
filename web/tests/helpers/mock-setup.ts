import type { Page } from "@playwright/test";
import { emptySetupDraft } from "../../components/trip-setup/draft-schema";
import type { PlaceCandidate } from "../../domain/trip/destination";
export async function mockSetup(page: Page) {
  let draft = { draftId: "10000000-0000-4000-8000-000000000099", revision: 1, currentStep: "destinations", payload: emptySetupDraft(), submittedTripId: null, updatedAt: new Date().toISOString() };
  const places: PlaceCandidate[] = [
    { placeId: "jp", kind: "country", name: "Japan", countryCode: "JP", timezone: "Asia/Tokyo", airportCode: null, location: null },
    { placeId: "tokyo", kind: "city", name: "Tokyo", countryCode: "JP", timezone: "Asia/Tokyo", airportCode: null, location: { latitude: 35.68, longitude: 139.65 } },
    { placeId: "kyoto", kind: "city", name: "Kyoto", countryCode: "JP", timezone: "Asia/Tokyo", airportCode: null, location: { latitude: 35.01, longitude: 135.77 } },
    { placeId: "ams", kind: "city", name: "Amsterdam", countryCode: "NL", timezone: "Europe/Amsterdam", airportCode: null, location: { latitude: 52.36, longitude: 4.9 } },
    { placeId: "london", kind: "city", name: "London", countryCode: "GB", timezone: "Europe/London", airportCode: null, location: { latitude: 51.51, longitude: -.13 } },
  ];
  await page.route("**/api/v1/planning-session", (route) => route.fulfill({ json: { kind: "guest", expiresAt: new Date(Date.now() + 86400000).toISOString() } }));
  await page.route("**/api/v1/setup-drafts**", async (route) => {
    if (route.request().method() === "PATCH") {
      const input = route.request().postDataJSON() as { expectedRevision: number; currentStep: string; payload: typeof draft.payload };
      if (input.expectedRevision !== draft.revision) { await route.fulfill({ status: 409, json: { title: "Draft changed", code: "draft_revision_conflict" } }); return; }
      draft = { ...draft, revision: draft.revision + 1, currentStep: input.currentStep, payload: input.payload };
    }
    await route.fulfill({ json: draft });
  });
  await page.route("**/api/v1/places?**", (route) => {
    const query = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: { candidates: places.filter((place) => place.name.toLowerCase().includes((query.get("query") ?? "").toLowerCase()) && (!query.get("kind") || place.kind === query.get("kind")) && (!query.get("countryCode") || place.countryCode === query.get("countryCode"))), ambiguous: false } });
  });
  return { draft: () => draft };
}
