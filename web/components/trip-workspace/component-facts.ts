import type { CustomerSnapshot } from "@/domain/pricing/projections";

export type Component = CustomerSnapshot["components"][number];
export type TravelFact = { label: string; value: string };

// Discovery reads store bounded supplier JSON in fareConditions, including in saved trips.
// Only known traveller-facing facts should cross this presentation boundary.
export function supplierText(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || /^\s*[[{]/.test(value)) return null;
  return value.trim();
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function texts(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const text = supplierText(entry);
        return text ? [text] : [];
      })
    : [];
}

export function componentMoney(minor: number, currency: string): string {
  const format = new Intl.NumberFormat("en", { style: "currency", currency });
  return format.format(minor / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
}

export function componentDate(value: string, timezone?: string | null, dateOnly = false): string {
  // Without a named zone, retain the supplier's local wall-clock time, not the browser's zone.
  const date = timezone && !dateOnly ? new Date(value) : new Date(`${value.slice(0, 19)}Z`);
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(!dateOnly ? ({ hour: "2-digit", minute: "2-digit" } as const) : {}),
    timeZone: dateOnly ? "UTC" : (timezone ?? "UTC"),
  }).format(date);
  return timezone || dateOnly
    ? formatted
    : `${formatted} (UTC${value.endsWith("Z") ? "" : value.slice(-6)})`;
}

export function componentDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${hours} hr` : "", rest || !hours ? `${rest} min` : ""]
    .filter(Boolean)
    .join(" ");
}

export function sourceFacts(component: Component): {
  facts: TravelFact[];
  route: string | null;
  notice: string | null;
} {
  const value = component.planningDetails?.fareConditions;
  const result: ReturnType<typeof sourceFacts> = {
    facts: [],
    route: null,
    notice: null,
  };
  if (!value || supplierText(value)) return result;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return {
      ...result,
      notice: "Some supplier details are incomplete. Verify them before booking.",
    };
  }
  const source = record(parsed);
  const add = (label: string, value: string | null) => {
    if (value) result.facts.push({ label, value });
  };
  if (component.type === "flight") {
    const origin = supplierText(source.originAirportCode);
    const destination = supplierText(source.destinationAirportCode);
    if (origin && destination) result.route = `${origin} → ${destination}`;
    add("Fare", [...new Set(texts(source.fareBrands))].join(", "));
    const cabins = records(source.passengerFares)
      .map((fare) => supplierText(fare.cabinClass)?.replaceAll("_", " "))
      .filter(Boolean);
    add("Cabin", [...new Set(cabins)].join(", "));
    if (source.identityDocumentsRequired === true)
      add("Travel documents", "Identity documents required");
    if (typeof source.refundBeforeDepartureAllowed === "boolean")
      add(
        "Refund before departure",
        source.refundBeforeDepartureAllowed ? "Allowed; check fees and conditions" : "Not allowed",
      );
    if (source.extraCostsVerified === false) add("Extra costs", "To be confirmed");
  }
  if (component.type === "accommodation") {
    const rooms = records(source.roomFacts);
    add(
      "Room",
      [...new Set(rooms.map((room) => supplierText(room.roomName)).filter(Boolean))].join(", "),
    );
    add(
      "Meals",
      [...new Set(rooms.map((room) => supplierText(room.meal)).filter(Boolean))].join(", "),
    );
    if (source.membershipRequired === true) add("Membership", "Membership required for this rate");
    if (
      typeof source.dueAtPropertyMinor === "number" &&
      Number.isSafeInteger(source.dueAtPropertyMinor) &&
      source.dueAtPropertyMinor >= 0
    )
      add("Pay at property", componentMoney(source.dueAtPropertyMinor, component.price.currency));
  }
  if (component.type === "activity") {
    add("Start time", supplierText(source.startTime));
    const options = records(source.productOptions);
    // Alternative options are not the selected activity; only show an unambiguous description.
    if (options.length === 1) add("Experience", supplierText(options[0].description));
  }
  result.notice =
    "Supplier information is provisional. Confirm availability and final terms before booking.";
  return result;
}
