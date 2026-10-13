import { z } from "zod";

import { currencySchema, departureOriginSchema, travellerPartySchema } from "@/domain/trip/schema";
import { normalizePlanningOffer, type PlanningOffer } from "./offers";

const componentTypeSchema = z.enum(["flight", "accommodation", "activity", "rail", "transfer"]);
export const supplyReadQuerySchema = z.object({
  componentTypes: z.array(componentTypeSchema).min(1).max(5), currency: currencySchema,
  departureOrigin: departureOriginSchema.nullable(), destinationIds: z.array(z.uuid()).min(1).max(8),
  startDate: z.iso.date(), endDate: z.iso.date(), travellerParty: travellerPartySchema,
}).strict().superRefine((query, context) => {
  if (query.endDate < query.startDate) context.addIssue({ code: "custom", path: ["endDate"], message: "Dates must be ordered" });
  if (query.componentTypes.includes("flight") && query.departureOrigin === null) {
    context.addIssue({ code: "custom", path: ["departureOrigin"], message: "Confirm departure origin before flight research" });
  }
});

export const readCapabilitiesSchema = z.object({ provider: z.string().trim().min(1).max(120),
  search: z.array(componentTypeSchema).min(1).max(5), readOnly: z.literal(true) }).strict();
export type SupplyReadQuery = z.infer<typeof supplyReadQuerySchema>;
export interface SupplyReadProvider {
  capabilities: z.infer<typeof readCapabilitiesSchema>;
  search(query: SupplyReadQuery, signal: AbortSignal): Promise<readonly unknown[]>;
}
export interface SupplyReadResult {
  offers: PlanningOffer[];
  outcomes: { provider: string; status: "available" | "unavailable" | "deadline"; unverifiedCount: number }[];
}

async function boundedSearch(provider: SupplyReadProvider, query: SupplyReadQuery, now: Date) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("deadline")); }, 8_000);
  });
  try {
    const rawOffers = await Promise.race([provider.search(structuredClone(query), controller.signal), timeout]);
    if (rawOffers.length > 32) throw new Error("Offer response is too large");
    const offers = rawOffers.map((offer) => normalizePlanningOffer(offer, now));
    if (offers.some((offer) => offer.component.provider !== provider.capabilities.provider
      || !query.componentTypes.includes(offer.component.type)
      || !provider.capabilities.search.includes(offer.component.type)
      || offer.component.price.finalCustomerAmount.currency !== query.currency)) {
      throw new Error("Offer context does not match research");
    }
    return { offers, outcome: { provider: provider.capabilities.provider, status: "available" as const,
      unverifiedCount: offers.filter((offer) => offer.unverifiedFacts.length > 0).length } };
  } catch {
    return { offers: [], outcome: { provider: provider.capabilities.provider,
      status: controller.signal.aborted ? "deadline" as const : "unavailable" as const, unverifiedCount: 0 } };
  } finally { clearTimeout(timer); }
}

export async function searchPlanningOffers(providers: readonly SupplyReadProvider[], rawQuery: unknown,
  now = new Date()): Promise<SupplyReadResult> {
  const query = supplyReadQuerySchema.parse(rawQuery);
  if (providers.length > 4) throw new Error("At most four planning provider adapters are supported");
  providers.forEach((provider) => readCapabilitiesSchema.parse(provider.capabilities));
  const selected = providers.filter((provider) => provider.capabilities.search.some((type) => query.componentTypes.includes(type)));
  const results = await Promise.all(selected.map((provider) => boundedSearch(provider, query, now)));
  // Share the bounded context across suppliers, rather than letting flight alternatives
  // consume every slot and hide available stays/activities/rail quotes.
  const offers: PlanningOffer[] = [];
  for (let index = 0; index < 32 && offers.length < 32; index += 1) {
    for (const result of results) if (result.offers[index] && offers.length < 32) offers.push(result.offers[index]);
  }
  const unique = [...new Map(offers.map((offer) => [`${offer.component.provider}:${offer.component.supplierOfferId}`, offer])).values()];
  return { offers: unique.slice(0, 32), outcomes: results.map((result) => result.outcome) };
}
