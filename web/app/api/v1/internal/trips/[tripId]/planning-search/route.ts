import { inTransaction } from "@/server/db/transaction";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { internalPlanningApiResponse, internalActor, requestJson } from "@/server/api";
import { searchPlanningOffers } from "@/server/supply/read";
import { readOwnedTripVersion } from "@/domain/trip/read";
import { projectCustomerSnapshot } from "@/domain/pricing/projections";
import { RunRepository, runConflict } from "@/server/agent-client/run-repository";
const querySchema = z.object({ startDate: z.iso.date(), endDate: z.iso.date(), destinationIds: z.array(z.uuid()).min(1).max(8) }).strict();
export async function POST(request: Request, route: { params: Promise<{ tripId: string }> }) {
  return internalPlanningApiResponse(request, async (application) => {
    const { tripId } = await route.params;
    const base = z.coerce.number().int().positive().parse(request.headers.get("x-base-trip-version"));
    const actor = internalActor(application, request, tripId, base, "trip:read");
    const query = querySchema.parse(await requestJson(request));
    const runRow = await application.database.selectFrom("agentRuns").select("id").where("ownerUserId", "=", actor.userId)
      .where("requestId", "=", actor.requestId).where("tripId", "=", tripId).executeTakeFirst();
    if (!runRow) runConflict();
    const run = await new RunRepository(application.database).read(actor.userId, runRow.id);
    if (run.baseTripVersion !== base || !["queued", "running"].includes(run.status)) runConflict();
    const trip = await readOwnedTripVersion(application.database, actor.userId, tripId, base), snapshot = trip.snapshot;
    if (trip.currentVersion !== base || !query.destinationIds.every((id) => snapshot.destinations.some((destination) => destination.id === id))
      || !snapshot.availabilityWindows.some((window) => window.startDate <= query.startDate && window.endDate >= query.endDate)) runConflict();
    const started = performance.now();
    const result = await searchPlanningOffers(application.planningProviders, { ...query, componentTypes: ["flight", "accommodation", "activity", "rail"],
      currency: snapshot.price.currency, departureOrigin: snapshot.departureOrigin, travellerParty: snapshot.travellerParty });
    await inTransaction(application.database, async (transaction) => {
      for (const offer of result.offers) await transaction.insertInto("planningOfferRecords").values({ runId: run.id,
        componentId: offer.component.id, offer: { ...offer }, query: { ...query, currency: snapshot.price.currency,
          departureOrigin: snapshot.departureOrigin, travellerParty: snapshot.travellerParty } }).execute();
      await transaction.insertInto("auditEvents").values({ id: randomUUID(), actorType: "service", actorId: actor.userId,
        action: "estimate.source.search", targetType: "agent_run", targetId: run.id, requestId: actor.requestId,
        traceId: null, outcome: result.offers.length ? "succeeded" : "failed",
        metadata: { durationMs: performance.now() - started, sourceCount: result.outcomes.length,
          availableCount: result.outcomes.filter((outcome) => outcome.status === "available").length,
          deadlineCount: result.outcomes.filter((outcome) => outcome.status === "deadline").length } }).execute();
    });
    const publicPrice = (offer: typeof result.offers[number]) => {
      // Reuse the recursive authoritative projection with a coherent one-component total.
      const component = offer.component, price = component.price;
      const projected = projectCustomerSnapshot({ ...snapshot, components: [component], itineraryDays: [], price: {
        currency: snapshot.price.currency, supplierTotal: price.supplierAmount, platformMarginTotal: price.platformMargin,
        customerPayableTaxesTotal: price.customerPayableTaxes, customerPayableFeesTotal: price.customerPayableFees,
        finalCustomerTotal: price.finalCustomerAmount, status: "estimated", checkedAt: price.checkedAt, conversionDisclosures: [] } });
      return { ...offer, component: projected.components[0] };
    };
    return { offers: result.offers.map(publicPrice), outcomes: result.outcomes };
  });
}
