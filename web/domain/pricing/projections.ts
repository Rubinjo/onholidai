import { z } from "zod";

import {
  decodeTripSnapshot,
  publicTripPriceSchema,
  travelComponentSchema,
  tripSnapshotSchema,
  type TripSnapshot,
  type LegacyTripSnapshot,
} from "../trip/schema.ts";
import { publicSupplierText } from "../../lib/privacy.ts";

type Component = TripSnapshot["components"][number];
type PublicComponent<Value = Component> = Value extends Component
  ? Omit<Value, "price"> & { price: PublicPrice }
  : never;
export type PublicPrice = z.infer<typeof publicTripPriceSchema>;
export const publicComponentSchema = z.discriminatedUnion("type", [
  travelComponentSchema.options[0].extend({ price: publicTripPriceSchema }),
  travelComponentSchema.options[1].extend({ price: publicTripPriceSchema }),
  travelComponentSchema.options[2].extend({ price: publicTripPriceSchema }),
  travelComponentSchema.options[3].extend({ price: publicTripPriceSchema }),
  travelComponentSchema.options[4].extend({ price: publicTripPriceSchema }),
]);
export type CustomerSnapshot = Omit<TripSnapshot, "components" | "price" | "departureOrigin"> & {
  departureOrigin: TripSnapshot["departureOrigin"] | null;
  components: PublicComponent[];
  price: PublicPrice;
};

export function projectPublicComponent(component: Component, now = new Date()): PublicComponent {
  return {
    ...(component.bookingDisposition ? { bookingDisposition: component.bookingDisposition } : {}),
    ...(component.bookingDispositionEvidence
      ? {
          bookingDispositionEvidence: {
            ...component.bookingDispositionEvidence,
            source: publicSupplierText(component.bookingDispositionEvidence.source),
          },
        }
      : {}),
    id: component.id,
    itineraryItemIds: component.itineraryItemIds,
    provider: publicSupplierText(component.provider),
    supplierOfferId: publicSupplierText(component.supplierOfferId),
    type: component.type,
    offerStatus: component.offerStatus,
    serviceStart: component.serviceStart,
    serviceEnd: component.serviceEnd,
    travellerIds: component.travellerIds,
    bookingRequirements: component.bookingRequirements.map(publicSupplierText),
    cancellationTerms: publicSupplierText(component.cancellationTerms),
    checkedAt: component.checkedAt,
    expiresAt: component.expiresAt,
    bookingStatus: component.bookingStatus,
    details:
      component.type === "flight"
        ? {
            legs: component.details.legs.map(publicSupplierText),
            baggage: component.details.baggage.map(publicSupplierText),
          }
        : component.type === "accommodation"
          ? {
              occupancy: publicSupplierText(component.details.occupancy),
              amenities: component.details.amenities.map(publicSupplierText),
            }
          : component.type === "activity"
            ? {
                durationMinutes: component.details.durationMinutes,
                directions: publicSupplierText(component.details.directions),
              }
            : component.type === "rail"
              ? {
                  originStation: publicSupplierText(component.details.originStation),
                  destinationStation: publicSupplierText(component.details.destinationStation),
                  route: publicSupplierText(component.details.route),
                }
              : {
                  origin: publicSupplierText(component.details.origin),
                  destination: publicSupplierText(component.details.destination),
                  route: publicSupplierText(component.details.route),
                },
    ...(component.planningDetails
      ? {
          planningDetails: {
            locationName:
              component.planningDetails.locationName === null
                ? null
                : publicSupplierText(component.planningDetails.locationName),
            timezone: component.planningDetails.timezone,
            airportNames: component.planningDetails.airportNames.map(publicSupplierText),
            airlines: component.planningDetails.airlines.map(publicSupplierText),
            flightDirection: component.planningDetails.flightDirection,
            durationMinutes: component.planningDetails.durationMinutes,
            layovers: component.planningDetails.layovers.map(publicSupplierText),
            fareConditions:
              component.planningDetails.fareConditions === null
                ? null
                : publicSupplierText(component.planningDetails.fareConditions),
            accommodationType:
              component.planningDetails.accommodationType === null
                ? null
                : publicSupplierText(component.planningDetails.accommodationType),
            travelFromStayMinutes: component.planningDetails.travelFromStayMinutes,
            eligibility: component.planningDetails.eligibility,
            accessibility: component.planningDetails.accessibility,
            availability: component.planningDetails.availability,
            constraintEvidence: component.planningDetails.constraintEvidence.map((evidence) => ({
              constraintId: evidence.constraintId,
              status: evidence.status,
              source: publicSupplierText(evidence.source),
              checkedAt: evidence.checkedAt,
            })),
            source: publicSupplierText(component.planningDetails.source),
            checkedAt: component.planningDetails.checkedAt,
            unavailableFacts: component.planningDetails.unavailableFacts.map(publicSupplierText),
          },
        }
      : {}),
    price: publicTripPriceSchema.parse({
      currency: component.price.finalCustomerAmount.currency,
      finalCustomerMinor: component.price.finalCustomerAmount.minorUnits,
      taxesMinor: component.price.customerPayableTaxes.minorUnits,
      feesMinor: component.price.customerPayableFees.minorUnits,
      status:
        component.price.status !== "confirmed" &&
        component.price.expiresAt !== null &&
        Date.parse(component.price.expiresAt) <= now.getTime()
          ? "expired"
          : component.price.status,
      checkedAt: component.price.checkedAt,
      expiresAt: component.price.expiresAt,
    }),
  } as PublicComponent;
}

function projectValidatedSnapshot(
  snapshot: TripSnapshot | LegacyTripSnapshot,
  now: Date,
): CustomerSnapshot {
  const components = snapshot.components.map((component) => projectPublicComponent(component, now));
  const conversionWarnings = snapshot.price.conversionDisclosures.map((conversion) => ({
    code: "currency_conversion",
    severity: "info" as const,
    relatedIds: [],
    message: `Converted ${conversion.fromCurrency} to ${conversion.toCurrency} at ${conversion.rate} (${publicSupplierText(conversion.source)}, ${conversion.quotedAt}).`,
  }));
  return {
    departureOrigin: snapshot.departureOrigin ?? null,
    availabilityWindows: snapshot.availabilityWindows,
    duration: snapshot.duration,
    travellerParty: snapshot.travellerParty,
    preferences: snapshot.preferences,
    constraints: snapshot.constraints,
    destinations: snapshot.destinations,
    itineraryDays: snapshot.itineraryDays.map((day) => ({
      ...day,
      items: day.items.map((item) => ({
        ...item,
        ...(item.bookingDispositionEvidence
          ? {
              bookingDispositionEvidence: {
                ...item.bookingDispositionEvidence,
                source: publicSupplierText(item.bookingDispositionEvidence.source),
              },
            }
          : {}),
      })),
    })),
    components,
    warnings: [
      ...snapshot.warnings.map((warning) => ({
        code: publicSupplierText(warning.code),
        severity: warning.severity,
        relatedIds: warning.relatedIds,
        message: publicSupplierText(warning.message),
      })),
      ...conversionWarnings,
    ],
    price: publicTripPriceSchema.parse({
      currency: snapshot.price.currency,
      finalCustomerMinor: snapshot.price.finalCustomerTotal.minorUnits,
      taxesMinor: snapshot.price.customerPayableTaxesTotal.minorUnits,
      feesMinor: snapshot.price.customerPayableFeesTotal.minorUnits,
      status: components.some((component) => component.price.status === "expired")
        ? "expired"
        : snapshot.price.status,
      checkedAt: snapshot.price.checkedAt,
    }),
  };
}

export function projectCustomerSnapshot(rawSnapshot: unknown, now = new Date()): CustomerSnapshot {
  return projectValidatedSnapshot(tripSnapshotSchema.parse(rawSnapshot), now);
}

export function projectStoredSnapshot(
  schemaVersion: number,
  rawSnapshot: unknown,
  now = new Date(),
): CustomerSnapshot {
  return projectValidatedSnapshot(decodeTripSnapshot(schemaVersion, rawSnapshot).snapshot, now);
}

export const projectAgentSnapshot = projectCustomerSnapshot;
