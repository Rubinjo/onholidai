import { z } from "zod";

import { decodeTripSnapshot, publicTripPriceSchema, tripSnapshotSchema, type TripSnapshot, type LegacyTripSnapshot } from "../trip/schema";

type Component = TripSnapshot["components"][number];
export type PublicPrice = z.infer<typeof publicTripPriceSchema>;
export type CustomerSnapshot = Omit<TripSnapshot, "components" | "price" | "departureOrigin"> & {
  departureOrigin: TripSnapshot["departureOrigin"] | null;
  components: (Omit<Component, "price"> & { price: PublicPrice })[];
  price: PublicPrice;
};

function projectValidatedSnapshot(snapshot: TripSnapshot | LegacyTripSnapshot, now: Date): CustomerSnapshot {
  const components = snapshot.components.map((component) => ({
    ...component,
    price: publicTripPriceSchema.parse({ currency: component.price.finalCustomerAmount.currency,
      finalCustomerMinor: component.price.finalCustomerAmount.minorUnits,
      taxesMinor: component.price.customerPayableTaxes.minorUnits,
      feesMinor: component.price.customerPayableFees.minorUnits,
      status: component.price.status !== "confirmed" && component.price.expiresAt !== null
        && Date.parse(component.price.expiresAt) <= now.getTime() ? "expired" : component.price.status,
      checkedAt: component.price.checkedAt, expiresAt: component.price.expiresAt }),
  }));
  const conversionWarnings = snapshot.price.conversionDisclosures.map((conversion) => ({
    code: "currency_conversion", severity: "info" as const, relatedIds: [],
    message: `Converted ${conversion.fromCurrency} to ${conversion.toCurrency} at ${conversion.rate} (${conversion.source}, ${conversion.quotedAt}).`,
  }));
  return {
    ...snapshot, departureOrigin: snapshot.departureOrigin ?? null, components,
    warnings: [...snapshot.warnings, ...conversionWarnings],
    price: publicTripPriceSchema.parse({ currency: snapshot.price.currency,
      finalCustomerMinor: snapshot.price.finalCustomerTotal.minorUnits,
      taxesMinor: snapshot.price.customerPayableTaxesTotal.minorUnits,
      feesMinor: snapshot.price.customerPayableFeesTotal.minorUnits,
      status: components.some((component) => component.price.status === "expired") ? "expired" : snapshot.price.status,
      checkedAt: snapshot.price.checkedAt }),
  };
}

export function projectCustomerSnapshot(rawSnapshot: unknown, now = new Date()): CustomerSnapshot {
  return projectValidatedSnapshot(tripSnapshotSchema.parse(rawSnapshot), now);
}

export function projectStoredSnapshot(schemaVersion: number, rawSnapshot: unknown, now = new Date()): CustomerSnapshot {
  return projectValidatedSnapshot(decodeTripSnapshot(schemaVersion, rawSnapshot).snapshot, now);
}

export const projectAgentSnapshot = projectCustomerSnapshot;
