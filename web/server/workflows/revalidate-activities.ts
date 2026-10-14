import "server-only";
import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { BookingTerms } from "@/domain/booking/authorization";
import { bookingTermsSchema, hashBookingTerms } from "@/domain/booking/authorization";
import { tripSnapshotSchema, type TripSnapshot } from "@/domain/trip/schema";
import type { Database } from "@/server/db/database";
import { providerForComponent, type TransactionProviderRegistry } from "@/server/supply/transactions";
import type { BookingWorkflowActivities, ComponentRescheduleWorkflowInput, RevalidationWorkflowInput, RevalidationWorkflowResult } from "./booking-contract";

export function createRevalidationActivities(database: Kysely<Database>, providers: TransactionProviderRegistry) {
  // Booking terms carry only the origin facts a customer authorizes; the snapshot
  // additionally records that the traveller confirmed it.
  function bookingOrigin(origin: NonNullable<TripSnapshot["departureOrigin"]>): BookingTerms["departureOrigin"] {
    return { kind: origin.kind, placeId: origin.placeId, name: origin.name, countryCode: origin.countryCode,
      timezone: origin.timezone, airportCode: origin.airportCode };
  }
  return {
    async revalidateBooking(input: RevalidationWorkflowInput): Promise<RevalidationWorkflowResult> {
      const record = await database.selectFrom("bookingRevalidations").selectAll()
        .where("workflowId", "=", input.workflowId).where("tripId", "=", input.tripId)
        .where("ownerUserId", "=", input.ownerUserId).executeTakeFirst();
      if (!record || record.tripVersion !== input.tripVersion) throw new Error("Revalidation identity is invalid");
      if (record.status === "completed" || record.status === "failed") {
        return { workflowId: input.workflowId, status: record.status,
          outcomes: record.outcomes as RevalidationWorkflowResult["outcomes"],
          terms: record.terms ? bookingTermsSchema.parse(record.terms) : null,
          termsHash: record.termsHash, expiresAt: record.expiresAt?.toISOString() ?? null };
      }
      const trip = await database.selectFrom("trips").selectAll().where("id", "=", input.tripId)
        .where("ownerUserId", "=", input.ownerUserId).executeTakeFirst();
      const version = await database.selectFrom("tripVersions").select(["snapshot", "version"])
        .where("tripId", "=", input.tripId).where("version", "=", input.tripVersion).executeTakeFirst();
      if (!trip || !version || trip.currentVersion !== input.tripVersion) throw new Error("Trip changed before live revalidation");
      const snapshot = tripSnapshotSchema.parse(version.snapshot);
      const checkedAt = new Date();
      if (!snapshot.departureOrigin?.confirmedByUser) throw new Error("Confirmed departure origin is required before booking revalidation");
      const results = await Promise.all(snapshot.components.map(async (component) => {
        try {
          const provider = providers.get(providerForComponent(component.type));
          if (!provider?.revalidate) return { component, outcome: "unknown" as const, safeReason: "Live availability could not be checked." };
          const checked = await provider.revalidate({ componentId: component.id, supplierOfferId: component.supplierOfferId,
            serviceStart: component.serviceStart, serviceEnd: component.serviceEnd, travellerIds: component.travellerIds });
          if (checked.terms && (checked.terms.componentId !== component.id
            || JSON.stringify([...checked.terms.travellerIds].sort()) !== JSON.stringify([...component.travellerIds].sort())
            || checked.terms.currency !== snapshot.price.currency)) {
            return { component, outcome: "unknown" as const, safeReason: "Supplier terms did not match the selected travellers or trip currency." };
          }
          return { component, ...checked };
        } catch {
          return { component, outcome: "unavailable" as const, safeReason: "The supplier could not verify this component." };
        }
      }));
      const outcomes = results.map(({ component, outcome, safeReason }) => ({ componentId: component.id, outcome,
        terms: outcome === "unchanged" || outcome === "changed" ? results.find((entry) => entry.component.id === component.id)?.terms ?? null : null,
        ...(safeReason ? { safeReason: safeReason.slice(0, 500) } : {}) }));
      const allHaveTerms = results.every((result) => (result.outcome === "unchanged" || result.outcome === "changed") && result.terms);
      let terms: BookingTerms | null = null;
      let termsHash: string | null = null;
      let expiresAt: string | null = null;
      if (allHaveTerms) {
        const componentTerms = results.map((result) => result.terms!);
        const currency = snapshot.price.currency;
        const normalized = componentTerms;
        const total = normalized.reduce((sum, term) => sum + term.finalCustomerMinor, 0);
        const expires = Math.min(...normalized.map((term) => Date.parse(term.expiresAt)));
        terms = bookingTermsSchema.parse({ departureOrigin: bookingOrigin(snapshot.departureOrigin),
          travellerParty: snapshot.travellerParty, components: normalized,
          totalPrice: { currency, minorUnits: total },
          nonReversibleActions: normalized.filter((term) => term.nonReversible).map((term) => term.componentId) });
        termsHash = hashBookingTerms(terms);
        expiresAt = new Date(expires).toISOString();
      }
      const status = allHaveTerms && expiresAt && Date.parse(expiresAt) > checkedAt.getTime() ? "completed" : "failed";
      const finalOutcomes = outcomes.map(({ componentId, outcome, safeReason }) => ({ componentId, outcome,
      ...(safeReason ? { safeReason } : {}) }));
      const result: RevalidationWorkflowResult = { workflowId: input.workflowId, status, outcomes: finalOutcomes,
        terms: status === "completed" ? terms : null, termsHash: status === "completed" ? termsHash : null,
        expiresAt: status === "completed" ? expiresAt : null };
      await database.updateTable("bookingRevalidations").set({ status: result.status, outcomes: sql<unknown[]>`${JSON.stringify(result.outcomes)}::jsonb`,
        terms: result.terms, termsHash: result.termsHash, expiresAt: result.expiresAt ? new Date(result.expiresAt) : null,
        updatedAt: checkedAt }).where("workflowId", "=", input.workflowId).execute();
      await database.insertInto("auditEvents").values({ id: randomUUID(), actorType: "service", actorId: "booking-worker",
        action: "booking.revalidation.completed", targetType: "trip", targetId: input.tripId,
        requestId: record.requestId, traceId: null, outcome: status === "completed" ? "succeeded" : "failed",
        metadata: { workflowId: input.workflowId, outcomeCount: result.outcomes.length, termsHash: result.termsHash },
        occurredAt: checkedAt }).execute();
      return result;
    },

    async revalidateComponentReschedule(input: ComponentRescheduleWorkflowInput): Promise<RevalidationWorkflowResult> {
      const record = await database.selectFrom("bookingRevalidations").selectAll()
        .where("workflowId", "=", input.workflowId).where("tripId", "=", input.tripId)
        .where("ownerUserId", "=", input.ownerUserId).executeTakeFirst();
      const booking = await database.selectFrom("bookingTransactions").select(["id", "tripId", "ownerUserId", "components"])
        .where("id", "=", input.bookingId).where("tripId", "=", input.tripId)
        .where("ownerUserId", "=", input.ownerUserId).executeTakeFirst();
      const trip = await database.selectFrom("trips").select(["currentVersion", "ownerUserId"])
        .where("id", "=", input.tripId).executeTakeFirst();
      const version = await database.selectFrom("tripVersions").select(["snapshot"])
        .where("tripId", "=", input.tripId).where("version", "=", input.tripVersion).executeTakeFirst();
      const confirmed = await database.selectFrom("bookingConfirmations").select(["componentId"])
        .where("transactionId", "=", input.bookingId).where("componentId", "=", input.componentId).executeTakeFirst();
      if (!record || !booking || !trip || trip.ownerUserId !== input.ownerUserId || !version
        || trip.currentVersion !== input.tripVersion || !confirmed) throw new Error("Reschedule identity or current confirmed component is invalid");
      if (record.status === "completed" || record.status === "failed") {
        return { workflowId: input.workflowId, status: record.status,
          outcomes: record.outcomes as RevalidationWorkflowResult["outcomes"],
          terms: record.terms ? bookingTermsSchema.parse(record.terms) : null,
          termsHash: record.termsHash, expiresAt: record.expiresAt?.toISOString() ?? null };
      }
      const originalState = (booking.components as Array<{ componentId: string; status: string }>).find((item) => item.componentId === input.componentId);
      if (originalState?.status !== "confirmed") throw new Error("Only a confirmed component can be rescheduled");
      const snapshot = tripSnapshotSchema.parse(version.snapshot);
      const component = snapshot.components.find((item) => item.id === input.componentId);
      if (!component) throw new Error("Confirmed component is absent from current trip");
      const result = await providers.get(providerForComponent(component.type))?.revalidate?.({
        componentId: component.id, supplierOfferId: component.supplierOfferId, serviceStart: component.serviceStart,
        serviceEnd: component.serviceEnd, travellerIds: component.travellerIds,
        requestedChange: input.requestedChange,
      });
      const checkedAt = new Date();
      const requestedTerms = result?.terms;
      let terms: BookingTerms | null = null, termsHash: string | null = null, expiresAt: string | null = null;
      const valid = Boolean(result && (result.outcome === "changed" || result.outcome === "unchanged") && requestedTerms
        && requestedTerms.componentId === component.id
        && requestedTerms.currency === snapshot.price.currency
        && JSON.stringify([...requestedTerms.travellerIds].sort()) === JSON.stringify([...(input.requestedChange.travellerIds ?? component.travellerIds)].sort())
        && (!input.requestedChange.serviceStart || requestedTerms.serviceStart === input.requestedChange.serviceStart)
        && (!input.requestedChange.serviceEnd || requestedTerms.serviceEnd === input.requestedChange.serviceEnd));
      const outcomes = [{ componentId: component.id,
        outcome: valid ? result!.outcome : result?.outcome === "unavailable" ? "unavailable" as const : "unknown" as const,
        ...(result?.safeReason ? { safeReason: result.safeReason.slice(0, 500) } : {}) }];
      if (valid && requestedTerms) {
        terms = bookingTermsSchema.parse({ departureOrigin: bookingOrigin(snapshot.departureOrigin),
          travellerParty: snapshot.travellerParty,
          components: [requestedTerms], totalPrice: { currency: requestedTerms.currency, minorUnits: requestedTerms.finalCustomerMinor },
          nonReversibleActions: requestedTerms.nonReversible ? [requestedTerms.componentId] : [] });
        termsHash = hashBookingTerms(terms);
        expiresAt = requestedTerms.expiresAt;
      }
      const status = terms && expiresAt && Date.parse(expiresAt) > checkedAt.getTime() ? "completed" : "failed";
      const response: RevalidationWorkflowResult = { workflowId: input.workflowId, status, outcomes,
        terms: status === "completed" ? terms : null, termsHash: status === "completed" ? termsHash : null,
        expiresAt: status === "completed" ? expiresAt : null };
      await database.updateTable("bookingRevalidations").set({ status: response.status, outcomes: sql<unknown[]>`${JSON.stringify(response.outcomes)}::jsonb`,
        terms: response.terms, termsHash: response.termsHash,
        expiresAt: response.expiresAt ? new Date(response.expiresAt) : null, updatedAt: checkedAt })
        .where("workflowId", "=", input.workflowId).execute();
      return response;
    },
  } satisfies Pick<BookingWorkflowActivities, "revalidateBooking" | "revalidateComponentReschedule">;
}
