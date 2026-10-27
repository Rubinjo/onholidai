import { ProblemError } from "@/server/errors";

import type { TripSnapshot } from "@/domain/trip/schema";

const REQUIRED_PARTS = [
  "supplierAmount",
  "platformMargin",
  "customerPayableTaxes",
  "customerPayableFees",
] as const;

/**
 * Draft estimates may carry a payable total whose supplier breakdown is unverified, so a
 * component can be reviewed before its fees are established. Booking commits money, so it
 * requires the parts to be established; an incomplete draft is reported as a conflict the
 * caller can surface, never as a silently understated charge.
 */
export function assertEstablishedPricing(snapshot: TripSnapshot): void {
  const incomplete = snapshot.components.some(
    (component) =>
      REQUIRED_PARTS.some((part) => component.price[part] === null) || component.details === null,
  );
  if (incomplete)
    throw new ProblemError({
      title: "Booking requires revalidated supplier pricing",
      status: 409,
      code: "price_breakdown_unverified",
    });
}
