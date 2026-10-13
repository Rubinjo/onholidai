import { z } from "zod";

import { travelComponentSchema } from "@/domain/trip/schema";

export const planningOfferSchema = z.object({
  selectionGroup: z.string().trim().min(1).max(120).optional(),
  component: travelComponentSchema,
  eligibility: z.object({ status: z.enum(["eligible", "ineligible", "unverified"]),
    minimumAge: z.number().int().nonnegative().nullable(), maximumAge: z.number().int().nonnegative().nullable() }).strict(),
  occupancy: z.object({ maximumAdults: z.number().int().positive().nullable(),
    maximumChildren: z.number().int().nonnegative().nullable() }).strict(),
  accessibility: z.enum(["verified", "unverified", "unsupported"]),
  attribution: z.object({ provider: z.string().trim().min(1).max(120),
    sourceUrl: z.url().nullable() }).strict(),
  unverifiedFacts: z.array(z.enum(["eligibility", "occupancy", "accessibility", "terms", "details"])).max(5),
}).strict().superRefine((offer, context) => {
  if (offer.component.bookingStatus !== "unbooked"
    || !["estimated", "quoted", "expired"].includes(offer.component.price.status)) {
    context.addIssue({ code: "custom", path: ["component"], message: "Planning search cannot imply a booking or live confirmation" });
  }
  if (offer.attribution.provider !== offer.component.provider) {
    context.addIssue({ code: "custom", path: ["attribution"], message: "Offer source attribution must match its provider" });
  }
  if (offer.eligibility.minimumAge !== null && offer.eligibility.maximumAge !== null
    && offer.eligibility.maximumAge < offer.eligibility.minimumAge) {
    context.addIssue({ code: "custom", path: ["eligibility"], message: "Eligibility age bounds must be ordered" });
  }
});

export type PlanningOffer = z.infer<typeof planningOfferSchema>;
export function normalizePlanningOffer(rawOffer: unknown, now = new Date()): PlanningOffer {
  const offer = planningOfferSchema.parse(rawOffer);
  const unverified = new Set(offer.unverifiedFacts);
  if (offer.eligibility.status === "unverified") unverified.add("eligibility");
  if (offer.occupancy.maximumAdults === null || offer.occupancy.maximumChildren === null) unverified.add("occupancy");
  if (offer.accessibility === "unverified") unverified.add("accessibility");
  const expiry = [offer.component.expiresAt, offer.component.price.expiresAt]
    .filter((value): value is string => value !== null);
  const expired = offer.component.offerStatus === "expired" || offer.component.price.status === "expired"
    || expiry.some((value) => Date.parse(value) <= now.getTime());
  return planningOfferSchema.parse({ ...offer, unverifiedFacts: [...unverified],
    component: { ...offer.component, offerStatus: expired ? "expired" : offer.component.offerStatus,
      price: { ...offer.component.price, status: expired ? "expired" : offer.component.price.status } } });
}
