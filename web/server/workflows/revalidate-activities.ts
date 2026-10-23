import "server-only";
import { randomUUID } from "node:crypto";

import { sql, type Kysely } from "kysely";

import { resolveBookingActor } from "@/server/auth/planning-actor";
import { lockBookingTrip } from "@/server/auth/booking-access";
import { inTransaction } from "@/server/db/transaction";
import { invalidateChangedWholeTripReview } from "@/domain/booking/invalidate";
import {
  readTrustedBookingDispositions,
  readTrustedBookingPrerequisites,
} from "@/server/supply/payment";
import {
  bookingComponentTermsSchema,
  bookingTermsSchema,
  bookingTermsV2ComponentSchema,
  hashBookingTerms,
} from "@/domain/booking/authorization";
import {
  bookingCoverageReportSchema,
  deriveBookingCoverage,
  opaqueReadinessSchema,
} from "@/domain/trip/booking-coverage";
import { readWithRateLimitRetry } from "@/server/supply/read";
import { tripSnapshotSchema, type TripSnapshot } from "@/domain/trip/schema";
import {
  providerForComponent,
  type TransactionProviderRegistry,
} from "@/server/supply/transactions";

import type { Database } from "@/server/db/database";
import type { BookingTerms } from "@/domain/booking/authorization";
import type { TrustedBookingPrerequisiteReader } from "@/server/supply/payment";
import type {
  BookingWorkflowActivities,
  ComponentRescheduleWorkflowInput,
  RevalidationWorkflowInput,
  RevalidationWorkflowResult,
} from "./booking-contract";

export function createRevalidationActivities(
  database: Kysely<Database>,
  providers: TransactionProviderRegistry,
  options: { prerequisites?: TrustedBookingPrerequisiteReader; now?: () => Date } = {},
) {
  // Booking terms carry only the origin facts a customer authorizes; the snapshot
  // additionally records that the traveller confirmed it.
  function bookingOrigin(
    origin: NonNullable<TripSnapshot["departureOrigin"]>,
  ): BookingTerms["departureOrigin"] {
    return {
      kind: origin.kind,
      placeId: origin.placeId,
      name: origin.name,
      countryCode: origin.countryCode,
      timezone: origin.timezone,
      airportCode: origin.airportCode,
    };
  }
  return {
    async revalidateBooking(input: RevalidationWorkflowInput): Promise<RevalidationWorkflowResult> {
      const actor = await resolveBookingActor(database, input.tripId, input.ownerUserId);
      const record = await database
        .selectFrom("bookingRevalidations")
        .selectAll()
        .where("workflowId", "=", input.workflowId)
        .where("tripId", "=", input.tripId)
        .where("ownerUserId", "=", input.ownerUserId)
        .executeTakeFirst();
      if (!record || record.tripVersion !== input.tripVersion)
        throw new Error("Revalidation identity is invalid");
      if (record.status === "completed" || record.status === "failed") {
        return {
          workflowId: input.workflowId,
          status: record.status,
          outcomes: record.outcomes as RevalidationWorkflowResult["outcomes"],
          terms: record.terms ? bookingTermsSchema.parse(record.terms) : null,
          termsHash: record.termsHash,
          expiresAt: record.expiresAt?.toISOString() ?? null,
          ...(record.coverage
            ? { coverage: bookingCoverageReportSchema.parse(record.coverage) }
            : {}),
        };
      }
      const trip = await database
        .selectFrom("trips")
        .selectAll()
        .where("id", "=", input.tripId)
        .where("ownerUserId", "=", actor.planningOwnerId)
        .executeTakeFirst();
      const version = await database
        .selectFrom("tripVersions")
        .select(["snapshot", "version"])
        .where("tripId", "=", input.tripId)
        .where("version", "=", input.tripVersion)
        .executeTakeFirst();
      if (!trip || !version || trip.currentVersion !== input.tripVersion)
        throw new Error("Trip changed before live revalidation");
      const snapshot = tripSnapshotSchema.parse(version.snapshot);
      const checkedAt = (options.now ?? (() => new Date()))();
      if (!snapshot.departureOrigin?.confirmedByUser)
        throw new Error("Confirmed departure origin is required before booking revalidation");
      let dispositionEvidence: Awaited<ReturnType<typeof readTrustedBookingDispositions>> = [];
      let classificationUnavailable = false;
      try {
        dispositionEvidence = await readTrustedBookingDispositions(options.prerequisites, input);
      } catch {
        classificationUnavailable = true;
      }
      const initialCoverage = deriveBookingCoverage(snapshot, {
        tripVersion: input.tripVersion,
        now: checkedAt,
        verifiedDispositions: dispositionEvidence,
      });
      const results = await Promise.all(
        snapshot.components.map(async (component) => {
          try {
            if (component.bookingStatus === "confirmed") {
              const saved = await database
                .selectFrom("bookingConfirmations")
                .selectAll()
                .where("tripId", "=", input.tripId)
                .where("componentId", "=", component.id)
                .orderBy("confirmedAt", "desc")
                .limit(1)
                .executeTakeFirst();
              if (!saved)
                return {
                  component,
                  outcome: "unknown" as const,
                  safeReason: "A durable matching confirmation is required.",
                };
              const previous = bookingComponentTermsSchema.parse(saved.terms);
              const destination = snapshot.destinations.find(
                (entry) => entry.name === component.planningDetails?.locationName,
              );
              const evidence = {
                ...("evidence" in previous ? previous.evidence : {}),
                componentId: component.id,
                provider: component.provider,
                supplierOfferId: previous.supplierOfferId,
                inventoryId: previous.inventoryId,
                serviceStart: previous.serviceStart,
                serviceEnd: previous.serviceEnd,
                travellerIds: previous.travellerIds,
                finalCustomerMinor: previous.finalCustomerMinor,
                currency: previous.currency,
                requirementIds: initialCoverage.entries
                  .filter((entry) => entry.componentIds.includes(component.id))
                  .map((entry) => entry.requirementId),
                destinationId: destination?.id ?? null,
                checkedAt: saved.confirmedAt.toISOString(),
                expiresAt: null,
                finalTermsVerified: false,
                taxesFeesKnown: false,
                eligibility: "unverified",
                availability: "unverified",
                accessibility: "unverified",
                constraintEvidence:
                  "evidence" in previous ? previous.evidence.constraintEvidence : [],
                bookingSupported: false,
                occupancy: "evidence" in previous ? previous.evidence.occupancy : null,
                travellerReadiness: null,
                paymentReadiness: null,
                confirmationId: saved.id,
              };
              const terms = bookingTermsV2ComponentSchema.parse({
                ...previous,
                provider: component.provider,
                attribution: { provider: component.provider, sourceUrl: null },
                disposition: "already_confirmed",
                confirmationId: saved.id,
                evidence,
                service:
                  "service" in previous
                    ? previous.service
                    : {
                        type: component.type,
                        title:
                          component.planningDetails?.locationName ?? `${component.type} commitment`,
                        timezone: component.planningDetails?.timezone ?? null,
                        propertyId: null,
                        propertyType: null,
                        roomIds: [],
                        fare: null,
                        baggage: component.type === "flight" ? component.details.baggage : [],
                        refundTerms: null,
                        changeTerms: null,
                        taxFeeInclusion: null,
                        occupancy: null,
                      },
              });
              return { component, outcome: "unchanged" as const, terms };
            }
            const expected =
              component.type === "flight"
                ? "duffel"
                : component.type === "accommodation"
                  ? "nuitee"
                  : component.type === "activity"
                    ? "viator"
                    : null;
            const provider =
              expected && component.provider === expected ? providers.get(expected) : undefined;
            if (
              !provider?.revalidate ||
              provider.capabilities.revalidation !== "read_only_final_terms" ||
              !provider.capabilities.book
            )
              return {
                component,
                outcome: "unknown" as const,
                safeReason: "An approved side-effect-free final-terms check is unavailable.",
              };
            if (!options.prerequisites)
              return {
                component,
                outcome: "unknown" as const,
                safeReason: "Approved trusted traveller and payment sources are not ready.",
              };
            const signal = AbortSignal.timeout(8_000);
            let stop: (() => void) | undefined;
            const deadline = new Promise<never>((_resolve, reject) => {
              stop = () => reject(new Error("Booking read deadline elapsed"));
              signal.addEventListener("abort", stop, { once: true });
            });
            const request = {
              componentId: component.id,
              supplierOfferId: component.supplierOfferId,
              serviceStart: component.serviceStart,
              serviceEnd: component.serviceEnd,
              travellerIds: component.travellerIds,
              signal,
            };
            let checked: Awaited<ReturnType<NonNullable<typeof provider.revalidate>>>;
            try {
              checked = await Promise.race([
                readWithRateLimitRetry(
                  () => provider.revalidate!(request),
                  signal,
                  Date.now() + 8_000,
                ),
                deadline,
              ]);
            } finally {
              if (stop) signal.removeEventListener("abort", stop);
            }
            const parsed = bookingTermsV2ComponentSchema.safeParse(checked.terms);
            if (!parsed.success)
              return {
                component,
                outcome:
                  checked.outcome === "unavailable"
                    ? ("unavailable" as const)
                    : ("unknown" as const),
                safeReason: "Complete safe final checkout terms could not be established.",
              };
            const readiness = await readTrustedBookingPrerequisites(
              options.prerequisites,
              {
                ownerUserId: input.ownerUserId,
                tripId: input.tripId,
                tripVersion: input.tripVersion,
                componentId: component.id,
                provider: parsed.data.provider,
                inventoryId: parsed.data.inventoryId,
                travellerIds: component.travellerIds,
              },
              signal,
            );
            const terms = {
              ...parsed.data,
              evidence: {
                ...parsed.data.evidence,
                travellerReadiness: opaqueReadinessSchema.nullable().parse(readiness.travellers),
                paymentReadiness: opaqueReadinessSchema.nullable().parse(readiness.payment),
              },
            };
            if (
              terms.componentId !== component.id ||
              JSON.stringify([...terms.travellerIds].sort()) !==
                JSON.stringify([...component.travellerIds].sort()) ||
              terms.currency !== snapshot.price.currency ||
              terms.provider !== expected
            ) {
              return {
                component,
                outcome: "unknown" as const,
                safeReason:
                  "Supplier terms did not match the selected travellers or trip currency.",
              };
            }
            return { component, outcome: checked.outcome, terms };
          } catch {
            return {
              component,
              outcome: "unknown" as const,
              safeReason: "The supplier could not verify this component.",
            };
          }
        }),
      );
      const outcomes = results.map(({ component, outcome, safeReason }) => ({
        componentId: component.id,
        outcome,
        terms:
          outcome === "unchanged" || outcome === "changed"
            ? (results.find((entry) => entry.component.id === component.id)?.terms ?? null)
            : null,
        ...(safeReason ? { safeReason: safeReason.slice(0, 500) } : {}),
      }));
      const allHaveTerms = results.every(
        (result) =>
          (result.outcome === "unchanged" || result.outcome === "changed") && result.terms,
      );
      let terms: BookingTerms | null = null;
      let termsHash: string | null = null;
      let expiresAt: string | null = null;
      const componentTerms = results.flatMap((result) => (result.terms ? [result.terms] : []));
      const finishedAt = (options.now ?? (() => new Date()))();
      let coverage = deriveBookingCoverage(snapshot, {
        tripVersion: input.tripVersion,
        now: finishedAt,
        evidence: componentTerms.map((term) => term.evidence),
        verifiedDispositions: dispositionEvidence,
      });
      if (classificationUnavailable)
        coverage = {
          ...coverage,
          eligible: false,
          issues: [
            ...coverage.issues,
            {
              code: "booking_classification_unknown",
              message: "Approved booking classification evidence is unavailable.",
              relatedIds: [],
            },
          ],
        };
      if (allHaveTerms && coverage.eligible) {
        const currency = snapshot.price.currency;
        const normalized = componentTerms;
        const toBook = normalized.filter((term) => term.disposition === "to_book");
        const total = toBook.reduce((sum, term) => sum + term.finalCustomerMinor, 0);
        const expires = Math.min(...toBook.map((term) => Date.parse(term.expiresAt)));
        const parsed = bookingTermsSchema.safeParse({
          schemaVersion: 2,
          tripVersion: input.tripVersion,
          coverage,
          continuationOf: null,
          rootAttemptId: null,
          dispositionEvidence,
          departureOrigin: bookingOrigin(snapshot.departureOrigin),
          travellerParty: snapshot.travellerParty,
          components: normalized,
          totalPrice: { currency, minorUnits: total },
          nonReversibleActions: toBook
            .filter((term) => term.nonReversible)
            .map((term) => term.componentId),
        });
        if (parsed.success) {
          terms = parsed.data;
          termsHash = hashBookingTerms(terms);
          expiresAt = new Date(expires).toISOString();
        } else {
          coverage = {
            ...coverage,
            eligible: false,
            issues: [
              ...coverage.issues,
              {
                code: "booking_final_terms_unknown",
                message: "Complete consistent final booking terms could not be verified.",
                relatedIds: normalized.map((term) => term.componentId),
              },
            ],
          };
        }
      }
      const status =
        coverage.eligible &&
        allHaveTerms &&
        expiresAt &&
        Date.parse(expiresAt) > finishedAt.getTime()
          ? "completed"
          : "failed";
      const finalOutcomes = outcomes.map(({ componentId, outcome, safeReason }) => ({
        componentId,
        outcome,
        ...(safeReason ? { safeReason } : {}),
      }));
      const result: RevalidationWorkflowResult = {
        workflowId: input.workflowId,
        status,
        outcomes: finalOutcomes,
        terms: status === "completed" ? terms : null,
        termsHash: status === "completed" ? termsHash : null,
        expiresAt: status === "completed" ? expiresAt : null,
        coverage,
      };
      return inTransaction(database, async (transaction) => {
        const current = await lockBookingTrip(transaction, actor, input.tripId);
        const locked = await transaction
          .selectFrom("bookingRevalidations")
          .selectAll()
          .where("workflowId", "=", input.workflowId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (locked.status === "completed" || locked.status === "failed")
          return {
            workflowId: input.workflowId,
            status: locked.status,
            outcomes: locked.outcomes as RevalidationWorkflowResult["outcomes"],
            terms: locked.terms ? bookingTermsSchema.parse(locked.terms) : null,
            termsHash: locked.termsHash,
            expiresAt: locked.expiresAt?.toISOString() ?? null,
            coverage: locked.coverage
              ? bookingCoverageReportSchema.parse(locked.coverage)
              : coverage,
          };
        const latest = await transaction
          .selectFrom("bookingRevalidations")
          .select("workflowId")
          .where("tripId", "=", input.tripId)
          .where("ownerUserId", "=", input.ownerUserId)
          .where("tripVersion", "=", input.tripVersion)
          .orderBy("createdAt", "desc")
          .orderBy("workflowId", "desc")
          .limit(1)
          .executeTakeFirst();
        if (
          !current ||
          current.currentVersion !== input.tripVersion ||
          latest?.workflowId !== input.workflowId
        ) {
          result.status = "failed";
          result.terms = null;
          result.termsHash = null;
          result.expiresAt = null;
          result.coverage = {
            ...coverage,
            eligible: false,
            issues: [
              ...coverage.issues,
              {
                code: "booking_review_changed",
                message: "The trip or its current review changed. Review the complete trip again.",
                relatedIds: [],
              },
            ],
          };
        }
        await transaction
          .updateTable("bookingRevalidations")
          .set({
            status: result.status,
            outcomes: sql<unknown[]>`${JSON.stringify(result.outcomes)}::jsonb`,
            terms: result.terms,
            termsHash: result.termsHash,
            expiresAt: result.expiresAt ? new Date(result.expiresAt) : null,
            coverage: result.coverage,
            updatedAt: finishedAt,
          })
          .where("workflowId", "=", input.workflowId)
          .execute();
        if (latest?.workflowId === input.workflowId)
          await invalidateChangedWholeTripReview(transaction, input.tripId, result.termsHash);
        await transaction
          .insertInto("auditEvents")
          .values({
            id: randomUUID(),
            actorType: "service",
            actorId: "booking-worker",
            action: "booking.revalidation.completed",
            targetType: "trip",
            targetId: input.tripId,
            requestId: record.requestId,
            traceId: null,
            outcome: result.status === "completed" ? "succeeded" : "failed",
            metadata: {
              workflowId: input.workflowId,
              outcomeCount: result.outcomes.length,
              termsHash: result.termsHash,
            },
            occurredAt: finishedAt,
          })
          .execute();
        return result;
      });
    },

    async revalidateComponentReschedule(
      input: ComponentRescheduleWorkflowInput,
    ): Promise<RevalidationWorkflowResult> {
      const actor = await resolveBookingActor(database, input.tripId, input.ownerUserId);
      const record = await database
        .selectFrom("bookingRevalidations")
        .selectAll()
        .where("workflowId", "=", input.workflowId)
        .where("tripId", "=", input.tripId)
        .where("ownerUserId", "=", input.ownerUserId)
        .executeTakeFirst();
      const booking = await database
        .selectFrom("bookingTransactions")
        .select(["id", "tripId", "ownerUserId", "components"])
        .where("id", "=", input.bookingId)
        .where("tripId", "=", input.tripId)
        .where("ownerUserId", "=", input.ownerUserId)
        .executeTakeFirst();
      const trip = await database
        .selectFrom("trips")
        .select(["currentVersion", "ownerUserId"])
        .where("id", "=", input.tripId)
        .executeTakeFirst();
      const version = await database
        .selectFrom("tripVersions")
        .select(["snapshot"])
        .where("tripId", "=", input.tripId)
        .where("version", "=", input.tripVersion)
        .executeTakeFirst();
      const confirmed = await database
        .selectFrom("bookingConfirmations")
        .select(["componentId"])
        .where("transactionId", "=", input.bookingId)
        .where("componentId", "=", input.componentId)
        .executeTakeFirst();
      if (
        !record ||
        !booking ||
        !trip ||
        trip.ownerUserId !== actor.planningOwnerId ||
        !version ||
        trip.currentVersion !== input.tripVersion ||
        !confirmed
      )
        throw new Error("Reschedule identity or current confirmed component is invalid");
      if (record.status === "completed" || record.status === "failed") {
        return {
          workflowId: input.workflowId,
          status: record.status,
          outcomes: record.outcomes as RevalidationWorkflowResult["outcomes"],
          terms: record.terms ? bookingTermsSchema.parse(record.terms) : null,
          termsHash: record.termsHash,
          expiresAt: record.expiresAt?.toISOString() ?? null,
        };
      }
      const originalState = (
        booking.components as Array<{ componentId: string; status: string }>
      ).find((item) => item.componentId === input.componentId);
      if (originalState?.status !== "confirmed")
        throw new Error("Only a confirmed component can be rescheduled");
      const snapshot = tripSnapshotSchema.parse(version.snapshot);
      const component = snapshot.components.find((item) => item.id === input.componentId);
      if (!component) throw new Error("Confirmed component is absent from current trip");
      const result = await providers.get(providerForComponent(component.type))?.revalidate?.({
        componentId: component.id,
        supplierOfferId: component.supplierOfferId,
        serviceStart: component.serviceStart,
        serviceEnd: component.serviceEnd,
        travellerIds: component.travellerIds,
        requestedChange: input.requestedChange,
      });
      const checkedAt = new Date();
      const requestedTerms = result?.terms;
      let terms: BookingTerms | null = null,
        termsHash: string | null = null,
        expiresAt: string | null = null;
      const valid = Boolean(
        result &&
        (result.outcome === "changed" || result.outcome === "unchanged") &&
        requestedTerms &&
        requestedTerms.componentId === component.id &&
        requestedTerms.currency === snapshot.price.currency &&
        JSON.stringify([...requestedTerms.travellerIds].sort()) ===
          JSON.stringify(
            [...(input.requestedChange.travellerIds ?? component.travellerIds)].sort(),
          ) &&
        (!input.requestedChange.serviceStart ||
          requestedTerms.serviceStart === input.requestedChange.serviceStart) &&
        (!input.requestedChange.serviceEnd ||
          requestedTerms.serviceEnd === input.requestedChange.serviceEnd),
      );
      const outcomes = [
        {
          componentId: component.id,
          outcome: valid
            ? result!.outcome
            : result?.outcome === "unavailable"
              ? ("unavailable" as const)
              : ("unknown" as const),
          ...(result?.safeReason ? { safeReason: result.safeReason.slice(0, 500) } : {}),
        },
      ];
      if (valid && requestedTerms) {
        terms = bookingTermsSchema.parse({
          departureOrigin: bookingOrigin(snapshot.departureOrigin),
          travellerParty: snapshot.travellerParty,
          components: [requestedTerms],
          totalPrice: {
            currency: requestedTerms.currency,
            minorUnits: requestedTerms.finalCustomerMinor,
          },
          nonReversibleActions: requestedTerms.nonReversible ? [requestedTerms.componentId] : [],
        });
        termsHash = hashBookingTerms(terms);
        expiresAt = requestedTerms.expiresAt;
      }
      const status =
        terms && expiresAt && Date.parse(expiresAt) > checkedAt.getTime() ? "completed" : "failed";
      const response: RevalidationWorkflowResult = {
        workflowId: input.workflowId,
        status,
        outcomes,
        terms: status === "completed" ? terms : null,
        termsHash: status === "completed" ? termsHash : null,
        expiresAt: status === "completed" ? expiresAt : null,
      };
      await database
        .updateTable("bookingRevalidations")
        .set({
          status: response.status,
          outcomes: sql<unknown[]>`${JSON.stringify(response.outcomes)}::jsonb`,
          terms: response.terms,
          termsHash: response.termsHash,
          expiresAt: response.expiresAt ? new Date(response.expiresAt) : null,
          updatedAt: checkedAt,
        })
        .where("workflowId", "=", input.workflowId)
        .execute();
      return response;
    },
  } satisfies Pick<
    BookingWorkflowActivities,
    "revalidateBooking" | "revalidateComponentReschedule"
  >;
}
