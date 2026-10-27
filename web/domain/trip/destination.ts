import { z } from "zod";

import { destinationSchema, geographyPointSchema, timezoneSchema } from "./schema";

export { destinationSchema };
export const placeCandidateSchema = z
  .object({
    placeId: z.string().trim().min(1).max(256),
    kind: z.enum(["country", "city", "place", "airport"]),
    name: z.string().trim().min(1).max(120),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    timezone: timezoneSchema,
    airportCode: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    location: geographyPointSchema.nullable(),
    // Trusted supplier identities resolved for this place (for example an IATA
    // code or a Viator destination ID). Absent when the lookup could not prove one.
    providerPlaceIds: z
      .record(z.string().trim().min(1).max(80), z.string().trim().min(1).max(256))
      .optional(),
  })
  .strict()
  .superRefine((place, context) => {
    if ((place.kind === "airport") !== (place.airportCode !== null)) {
      context.addIssue({
        code: "custom",
        path: ["airportCode"],
        message: "Only airports require an airport code",
      });
    }
  });
export const placeLookupInputSchema = z
  .object({
    query: z.string().trim().max(200),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    kind: z.enum(["country", "city", "airport", "place"]).optional(),
  })
  .strict()
  .refine(
    (input) => input.query.length > 0 || (input.kind === "city" && Boolean(input.countryCode)),
    "Enter a search or select a country for cities",
  );
export type PlaceCandidate = z.infer<typeof placeCandidateSchema>;
export interface PlaceLookupProvider {
  search(
    input: z.infer<typeof placeLookupInputSchema>,
    signal: AbortSignal,
  ): Promise<readonly PlaceCandidate[]>;
}

export async function lookupPlaces(provider: PlaceLookupProvider, rawInput: unknown) {
  const input = placeLookupInputSchema.parse(rawInput);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let found: readonly PlaceCandidate[];
  try {
    found = await Promise.race([
      provider.search(input, controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Place lookup deadline"));
        }, 8000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  const candidates = z
    .array(placeCandidateSchema)
    .max(20)
    .parse(found)
    .filter(
      (candidate) =>
        (!input.countryCode || candidate.countryCode === input.countryCode) &&
        (!input.kind || candidate.kind === input.kind),
    );
  if (new Set(candidates.map((candidate) => candidate.placeId)).size !== candidates.length) {
    throw new Error("Place provider returned duplicate identities");
  }
  return { candidates, ambiguous: candidates.length > 1 };
}

export function resolvePlace(
  candidates: readonly PlaceCandidate[],
  selectedPlaceId?: string,
): PlaceCandidate {
  const matches = candidates.filter((candidate) => candidate.placeId === selectedPlaceId);
  if (matches.length !== 1) throw new Error("Select one resolved geographic identity");
  return placeCandidateSchema.parse(matches[0]);
}
