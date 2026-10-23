import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { assertGeneratedArtifact } from "./generated-artifact.mjs";
import {
  CURRENT_TRIP_SNAPSHOT_SCHEMA_VERSION,
  tripSnapshotSchema,
  itineraryDaySchema,
} from "../domain/trip/schema.ts";
import { planningOfferSchema, publicPlanningOfferSchema } from "../server/supply/offers.ts";
import {
  bookingCoverageReportSchema,
  bookingReviewStateSchema,
  publicAuthorizationSchema,
  publicBookingTransactionSchema,
  publicBookingTermsSchema,
  publicWholeTripTermsSchema,
  revalidationViewSchema,
  publicBookingStatusSchema,
} from "../domain/booking/public.ts";

const outputPath = resolve(process.cwd(), "../contracts/trip-domain/snapshot-v1.schema.json");
const generated = `${JSON.stringify(
  {
    $id: "https://onholidai.local/contracts/trip-domain/snapshot-v1.schema.json",
    title: "TripSnapshot v1",
    description: `Complete immutable trip snapshot for schemaVersion ${CURRENT_TRIP_SNAPSHOT_SCHEMA_VERSION}.`,
    ...z.toJSONSchema(tripSnapshotSchema, { target: "draft-2020-12" }),
  },
  null,
  2,
)}\n`;

if (process.argv.includes("--check")) {
  const committed = await readFile(outputPath, "utf8");
  assertGeneratedArtifact(
    committed,
    generated,
    "snapshot-v1.schema.json has drifted; run pnpm snapshot:contract",
  );
  console.log("Validated TripSnapshot v1 contract drift.");
} else {
  await writeFile(outputPath, generated, "utf8");
  console.log(`Wrote ${outputPath}`);
}

const itineraryPath = resolve(process.cwd(), "../contracts/trip-domain/itinerary-v1.schema.json");
const itinerary = `${JSON.stringify(
  {
    $id: "https://onholidai.local/contracts/trip-domain/itinerary-v1.schema.json",
    title: "Itinerary v1",
    description:
      "Timezone-qualified daily planning and reproducible feasibility policy v1 evidence.",
    ...z.toJSONSchema(z.array(itineraryDaySchema).max(366), { target: "draft-2020-12" }),
  },
  null,
  2,
)}\n`;
if (process.argv.includes("--check")) {
  assertGeneratedArtifact(
    await readFile(itineraryPath, "utf8"),
    itinerary,
    "itinerary-v1.schema.json has drifted",
  );
} else {
  await writeFile(itineraryPath, itinerary, "utf8");
}

const publicOffersPath = resolve(process.cwd(), "../contracts/supply/public-offers-v1.schema.json");
const publicOffers = `${JSON.stringify(
  {
    $id: "https://onholidai.local/contracts/supply/public-offers-v1.schema.json",
    title: "Public Planning Offer v1",
    description:
      "Customer/agent supply projection with customer pricing only; generated from canonical Zod fields.",
    ...z.toJSONSchema(publicPlanningOfferSchema, { target: "draft-2020-12" }),
  },
  null,
  2,
)}\n`;
if (process.argv.includes("--check")) {
  assertGeneratedArtifact(
    await readFile(publicOffersPath, "utf8"),
    publicOffers,
    "public-offers-v1.schema.json has drifted",
  );
} else {
  await writeFile(publicOffersPath, publicOffers, "utf8");
}

const offersPath = resolve(process.cwd(), "../contracts/supply/offers-v1.schema.json");
const offers = `${JSON.stringify(
  {
    $id: "https://onholidai.local/contracts/supply/offers-v1.schema.json",
    title: "Planning Offer v1",
    description:
      "Internal discovery evidence, including unknown facts and immutable references; accepted components remain strict.",
    ...z.toJSONSchema(planningOfferSchema, { target: "draft-2020-12" }),
  },
  null,
  2,
)}\n`;
if (process.argv.includes("--check")) {
  assertGeneratedArtifact(
    await readFile(offersPath, "utf8"),
    offers,
    "offers-v1.schema.json has drifted",
  );
} else {
  await writeFile(offersPath, offers, "utf8");
}

const bookingPath = resolve(
  process.cwd(),
  "../contracts/trip-domain/booking-review-v2.schema.json",
);
const booking = `${JSON.stringify(
  {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://onholidai.local/contracts/trip-domain/booking-review-v2.schema.json",
    title: "Customer whole-trip booking review",
    description:
      "Public v1/v2 review, coverage and durable state. Exact material equality, trusted evidence and expiry are independently enforced server-side.",
    $defs: Object.fromEntries(
      Object.entries({
        BookingCoverageReport: bookingCoverageReportSchema,
        BookingReviewState: bookingReviewStateSchema,
        PublicBookingTerms: publicBookingTermsSchema,
        PublicWholeTripTerms: publicWholeTripTermsSchema,
        PublicBookingAuthorization: publicAuthorizationSchema,
        PublicBookingTransaction: publicBookingTransactionSchema,
        PublicRevalidationReview: revalidationViewSchema,
        PublicBookingStatus: publicBookingStatusSchema,
      }).map(([name, schema]) => [name, z.toJSONSchema(schema, { target: "draft-2020-12" })]),
    ),
  },
  null,
  2,
)}\n`;
if (process.argv.includes("--check")) {
  assertGeneratedArtifact(
    await readFile(bookingPath, "utf8"),
    booking,
    "booking-review-v2.schema.json has drifted",
  );
} else {
  await writeFile(bookingPath, booking, "utf8");
}
