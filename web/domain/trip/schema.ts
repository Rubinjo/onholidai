import { z } from "zod";
import { itemEvidenceFields, segmentGuidanceFields, planningDetailsSchema } from "./itinerary.ts";

export const CURRENT_TRIP_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const LEGACY_TRIP_SNAPSHOT_SCHEMA_VERSION = 0 as const;

const UUID = z.uuid();
const nonBlank = (maximum: number) => z.string().trim().min(1).max(maximum);
const positiveInteger = z.number().int().positive();
const nonNegativeInteger = z.number().int().nonnegative();
const localDateSchema = z.iso.date();
const localDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/, "Expected a local date-time");
const offsetDateTimeSchema = z.iso.datetime({ offset: true });
const utcDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/, "Expected a UTC timestamp")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Expected a valid UTC timestamp");

function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}

function isIsoCurrency(value: string): boolean {
  try {
    new Intl.NumberFormat("en", { currency: value, style: "currency" }).format(0);
    return Intl.supportedValuesOf("currency").includes(value);
  } catch {
    return false;
  }
}

function unique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

function epoch(value: string): number {
  return Date.parse(value);
}

function daysInclusive(start: string, end: string): number {
  return Math.floor((epoch(`${end}T00:00:00Z`) - epoch(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

function addIssue(context: z.RefinementCtx, path: PropertyKey[], message: string): void {
  context.addIssue({ code: "custom", path, message });
}

export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Expected an uppercase ISO 4217 currency code")
  .refine(isIsoCurrency, "Expected a recognized ISO 4217 currency code");

export const timezoneSchema = z.string().min(1).refine(isIanaTimezone, "Expected a valid IANA timezone");
export const geographyPointSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();

export const moneySchema = z
  .object({
    currency: currencySchema,
    minorUnits: nonNegativeInteger,
  })
  .strict();

export const departureOriginSchema = z
  .object({
    kind: z.enum(["city", "airport"]),
    placeId: nonBlank(256),
    name: nonBlank(120),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    timezone: timezoneSchema,
    airportCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
    location: geographyPointSchema.nullable().optional(),
    confirmedByUser: z.literal(true),
  })
  .strict()
  .superRefine((origin, context) => {
    if (origin.kind === "airport" && origin.airportCode === null) {
      addIssue(context, ["airportCode"], "An airport origin requires an IATA airport code");
    }
    if (origin.kind === "city" && origin.airportCode !== null) {
      addIssue(context, ["airportCode"], "A city origin cannot specify an airport code");
    }
  });

export const availabilityWindowSchema = z
  .object({
    id: UUID,
    startDate: localDateSchema,
    endDate: localDateSchema,
    preference: z.enum(["preferred", "flexible"]),
    timezone: timezoneSchema,
  })
  .strict()
  .superRefine((window, context) => {
    if (window.endDate < window.startDate) {
      addIssue(context, ["endDate"], "Availability endDate cannot precede startDate");
    }
  });

export const durationPreferenceSchema = z
  .object({
    minimumDays: positiveInteger,
    idealDays: positiveInteger,
    maximumDays: positiveInteger,
  })
  .strict()
  .superRefine((duration, context) => {
    if (duration.idealDays < duration.minimumDays) {
      addIssue(context, ["idealDays"], "idealDays must be at least minimumDays");
    }
    if (duration.maximumDays < duration.idealDays) {
      addIssue(context, ["maximumDays"], "maximumDays must be at least idealDays");
    }
  });

export const childTravellerSchema = z
  .object({
    id: UUID,
    ageAtTripStart: z.number().int().min(0).max(17),
  })
  .strict();

export const travellerPartySchema = z
  .object({
    adults: z.number().int().min(1).max(10),
    children: z.array(childTravellerSchema).max(9),
  })
  .strict()
  .superRefine((party, context) => {
    if (party.adults + party.children.length > 10) {
      addIssue(context, ["children"], "Total traveller party size cannot exceed 10");
    }
    if (!unique(party.children.map((child) => child.id))) {
      addIssue(context, ["children"], "Child traveller IDs must be unique");
    }
  });

const preferenceDimensionSchema = z.number().int().min(0).max(100);
export const preferenceProfileSchema = z
  .object({
    pace: preferenceDimensionSchema,
    spend: preferenceDimensionSchema,
    discovery: preferenceDimensionSchema,
    independence: preferenceDimensionSchema,
    setting: preferenceDimensionSchema,
  })
  .strict();

export const constraintSourceSchema = z
  .object({
    kind: z.enum(["setup_text", "direct_edit", "conversation_message", "system_inference"]),
    referenceId: z.string().trim().min(1).max(256).nullable(),
  })
  .strict()
  .superRefine((source, context) => {
    if (source.kind !== "setup_text" && source.referenceId === null) {
      addIssue(context, ["referenceId"], `${source.kind} requires a source reference`);
    }
  });

export const tripConstraintSchema = z
  .object({
    id: UUID,
    category: z.enum([
      "accessibility",
      "dietary",
      "schedule",
      "lodging",
      "budget",
      "occasion",
      "transport",
      "other",
    ]),
    statement: nonBlank(1000),
    priority: z.enum(["required", "strong", "preference"]),
    source: constraintSourceSchema,
    status: z.enum(["active", "conflicting", "unverified", "removed"]),
    confirmedByUser: z.boolean(),
  })
  .strict()
  .superRefine((constraint, context) => {
    if (
      constraint.source.kind === "system_inference" &&
      constraint.priority !== "preference" &&
      !constraint.confirmedByUser
    ) {
      addIssue(context, ["confirmedByUser"], "Material inferred constraints require user confirmation");
    }
  });

export const destinationSchema = z
  .object({
    timezone: timezoneSchema.optional(),
    id: UUID,
    kind: z.enum(["country", "city", "place"]),
    name: nonBlank(120),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    providerPlaceIds: z.record(nonBlank(80), nonBlank(256)),
    location: geographyPointSchema.nullable(),
    routePosition: nonNegativeInteger,
    arrivalDate: localDateSchema.nullable(),
    departureDate: localDateSchema.nullable(),
    plannedNights: nonNegativeInteger,
  })
  .strict()
  .superRefine((destination, context) => {
    if ((destination.arrivalDate === null) !== (destination.departureDate === null)) {
      addIssue(context, ["arrivalDate"], "Scheduled destinations require both arrival and departure dates");
      return;
    }
    if (destination.arrivalDate !== null && destination.departureDate !== null) {
      if (destination.departureDate < destination.arrivalDate) {
        addIssue(context, ["departureDate"], "Destination departure cannot precede arrival");
      }
      const nights = Math.max(0, daysInclusive(destination.arrivalDate, destination.departureDate) - 1);
      if (destination.plannedNights !== nights) {
        addIssue(context, ["plannedNights"], "plannedNights must match scheduled dates");
      }
    }
  });

export const travelPlaceSchema = z
  .object({
    placeId: nonBlank(256),
    name: nonBlank(120),
    timezone: timezoneSchema,
    location: geographyPointSchema.nullable(),
  })
  .strict();

export const travelSegmentSchema = z
  .object({
    ...segmentGuidanceFields,
    mode: z.enum(["walk", "public_transport", "bus", "drive", "flight", "rail", "transfer", "ferry", "other"]),
    origin: travelPlaceSchema,
    destination: travelPlaceSchema,
    plannedDeparture: offsetDateTimeSchema,
    plannedArrival: offsetDateTimeSchema,
    durationMinutes: positiveInteger,
    durationUpperBoundMinutes: positiveInteger.nullable(),
    routeGeometry: z.array(geographyPointSchema).nullable(),
    directionsSummary: nonBlank(2000),
    source: nonBlank(120),
    freshnessAt: utcDateTimeSchema,
    timingEvidence: z.array(nonBlank(500)).max(32),
    verificationStatus: z.enum(["unverified", "verified", "failed"]),
    feasibilityPolicyVersion: z.literal("1"),
  })
  .strict()
  .superRefine((segment, context) => {
    if (epoch(segment.plannedArrival) <= epoch(segment.plannedDeparture)) {
      addIssue(context, ["plannedArrival"], "Travel arrival must follow departure");
    }
    if (
      segment.durationUpperBoundMinutes !== null &&
      segment.durationUpperBoundMinutes < segment.durationMinutes
    ) {
      addIssue(context, ["durationUpperBoundMinutes"], "Duration upper bound cannot be below duration");
    }
    if (segment.verificationStatus === "verified" && segment.timingEvidence.length === 0) {
      addIssue(context, ["timingEvidence"], "Verified travel requires timing evidence");
    }
  });

export const componentPriceFields = {
  supplierAmount: moneySchema,
  platformMargin: moneySchema,
  customerPayableTaxes: moneySchema,
  customerPayableFees: moneySchema,
  finalCustomerAmount: moneySchema,
  status: z.enum(["estimated", "quoted", "live", "expired", "confirmed"]),
  source: nonBlank(120),
  checkedAt: utcDateTimeSchema,
  expiresAt: utcDateTimeSchema.nullable(),
};

export const componentPriceSchema = z
  .object(componentPriceFields)
  .strict()
  .superRefine((price, context) => {
    const amounts = [
      price.supplierAmount,
      price.platformMargin,
      price.customerPayableTaxes,
      price.customerPayableFees,
      price.finalCustomerAmount,
    ];
    if (!amounts.every((amount) => amount.currency === price.finalCustomerAmount.currency)) {
      addIssue(context, ["finalCustomerAmount", "currency"], "Component price currencies must match");
    }
    const expectedFinal =
      price.supplierAmount.minorUnits +
      price.platformMargin.minorUnits +
      price.customerPayableTaxes.minorUnits +
      price.customerPayableFees.minorUnits;
    if (price.finalCustomerAmount.minorUnits !== expectedFinal) {
      addIssue(context, ["finalCustomerAmount", "minorUnits"], "Final customer amount must equal all price parts");
    }
    if (price.expiresAt !== null && epoch(price.expiresAt) <= epoch(price.checkedAt)) {
      addIssue(context, ["expiresAt"], "Price expiry must follow its checked timestamp");
    }
  });

export const componentServiceFields = {
  serviceStart: offsetDateTimeSchema,
  serviceEnd: offsetDateTimeSchema,
};

export const componentBaseFields = {
  planningDetails: planningDetailsSchema.optional(),
  id: UUID,
  itineraryItemIds: z.array(UUID).max(64),
  provider: nonBlank(120),
  supplierOfferId: nonBlank(256),
  offerStatus: z.enum(["available", "changed", "unavailable", "expired"]),
  ...componentServiceFields,
  travellerIds: z.array(UUID).min(1).max(10),
  bookingRequirements: z.array(nonBlank(500)).max(32),
  cancellationTerms: nonBlank(2000),
  price: componentPriceSchema,
  checkedAt: utcDateTimeSchema,
  expiresAt: utcDateTimeSchema.nullable(),
  bookingStatus: z.enum(["unbooked", "pending", "confirmed", "cancelled", "unknown", "action_required"]),
};

const flightDetailsSchema = z
  .object({ legs: z.array(nonBlank(500)).min(1).max(8), baggage: z.array(nonBlank(500)).max(16) })
  .strict();
const accommodationDetailsSchema = z
  .object({ occupancy: nonBlank(500), amenities: z.array(nonBlank(120)).max(64) })
  .strict();
const activityDetailsSchema = z
  .object({ durationMinutes: positiveInteger, directions: nonBlank(2000) })
  .strict();
const railDetailsSchema = z
  .object({ originStation: nonBlank(120), destinationStation: nonBlank(120), route: nonBlank(500) })
  .strict();
const transferDetailsSchema = z
  .object({ origin: nonBlank(120), destination: nonBlank(120), route: nonBlank(500) })
  .strict();

export const travelComponentSchema = z
  .discriminatedUnion("type", [
    z.object({ ...componentBaseFields, type: z.literal("flight"), details: flightDetailsSchema }).strict(),
    z.object({ ...componentBaseFields, type: z.literal("accommodation"), details: accommodationDetailsSchema }).strict(),
    z.object({ ...componentBaseFields, type: z.literal("activity"), details: activityDetailsSchema }).strict(),
    z.object({ ...componentBaseFields, type: z.literal("rail"), details: railDetailsSchema }).strict(),
    z.object({ ...componentBaseFields, type: z.literal("transfer"), details: transferDetailsSchema }).strict(),
  ])
  .superRefine((component, context) => {
    if (!unique(component.itineraryItemIds)) {
      addIssue(context, ["itineraryItemIds"], "Itinerary item references must be unique");
    }
    if (!unique(component.travellerIds)) {
      addIssue(context, ["travellerIds"], "Traveller references must be unique");
    }
    if (epoch(component.serviceEnd) <= epoch(component.serviceStart)) {
      addIssue(context, ["serviceEnd"], "Component service end must follow service start");
    }
    if (component.expiresAt !== null && epoch(component.expiresAt) <= epoch(component.checkedAt)) {
      addIssue(context, ["expiresAt"], "Offer expiry must follow its checked timestamp");
    }
  });

export const itineraryItemSchema = z
  .object({
    ...itemEvidenceFields,
    id: UUID,
    type: z.enum(["activity", "meal", "free_time", "travel", "note"]),
    start: localDateTimeSchema,
    end: localDateTimeSchema,
    location: geographyPointSchema.nullable(),
    componentId: UUID.nullable(),
    constraintChecks: z.array(UUID).max(64),
    status: z.enum(["proposed", "planned", "confirmed", "cancelled"]),
    travelSegment: travelSegmentSchema.nullable(),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.end <= item.start) {
      addIssue(context, ["end"], "Itinerary item end must follow start");
    }
    if (item.type === "travel" && item.travelSegment === null) {
      addIssue(context, ["travelSegment"], "Travel items require a travel segment");
    }
    if (item.type !== "travel" && item.travelSegment !== null) {
      addIssue(context, ["travelSegment"], "Only travel items can contain a travel segment");
    }
    if (!unique(item.constraintChecks)) {
      addIssue(context, ["constraintChecks"], "Constraint check references must be unique");
    }
  });

export const itineraryDaySchema = z
  .object({
    practicalNotes: z.array(nonBlank(1000)).max(16).optional(),
    mandatoryTravelException: nonBlank(2000).optional(),
    date: localDateSchema,
    destinationId: UUID,
    timezone: timezoneSchema,
    paceAssessment: z.number().int().min(0).max(100),
    items: z.array(itineraryItemSchema).max(64),
  })
  .strict()
  .superRefine((day, context) => {
    if (!unique(day.items.map((item) => item.id))) {
      addIssue(context, ["items"], "Itinerary item IDs must be unique within a day");
    }
    for (let index = 1; index < day.items.length; index += 1) {
      const previous = day.items[index - 1];
      const current = day.items[index];
      if (current.start < previous.start) {
        addIssue(context, ["items", index, "start"], "Itinerary items must be ordered by start time");
      }
    }
  });

export const conversionDisclosureSchema = z
  .object({
    fromCurrency: currencySchema,
    toCurrency: currencySchema,
    rate: z.number().positive().finite(),
    source: nonBlank(120),
    quotedAt: utcDateTimeSchema,
  })
  .strict();

export const tripPriceSchema = z
  .object({
    currency: currencySchema,
    supplierTotal: moneySchema,
    platformMarginTotal: moneySchema,
    customerPayableTaxesTotal: moneySchema,
    customerPayableFeesTotal: moneySchema,
    finalCustomerTotal: moneySchema,
    status: z.enum(["estimated", "quoted", "live", "expired", "confirmed"]),
    checkedAt: utcDateTimeSchema,
    conversionDisclosures: z.array(conversionDisclosureSchema).max(32),
  })
  .strict()
  .superRefine((price, context) => {
    const totals = [
      price.supplierTotal,
      price.platformMarginTotal,
      price.customerPayableTaxesTotal,
      price.customerPayableFeesTotal,
      price.finalCustomerTotal,
    ];
    if (!totals.every((total) => total.currency === price.currency)) {
      addIssue(context, ["currency"], "Every trip price total must use the presentation currency");
    }
    const expectedFinal =
      price.supplierTotal.minorUnits +
      price.platformMarginTotal.minorUnits +
      price.customerPayableTaxesTotal.minorUnits +
      price.customerPayableFeesTotal.minorUnits;
    if (price.finalCustomerTotal.minorUnits !== expectedFinal) {
      addIssue(context, ["finalCustomerTotal", "minorUnits"], "Final trip total must equal all price parts");
    }
  });

export const publicTripPriceSchema = z
  .object({
    currency: currencySchema,
    finalCustomerMinor: nonNegativeInteger,
    taxesMinor: nonNegativeInteger.optional(),
    feesMinor: nonNegativeInteger.optional(),
    status: z.enum(["estimated", "quoted", "live", "expired", "confirmed"]),
    checkedAt: utcDateTimeSchema,
    expiresAt: utcDateTimeSchema.nullable().optional(),
  })
  .strict();

export const tripWarningSchema = z
  .object({
    code: nonBlank(120),
    message: nonBlank(1000),
    severity: z.enum(["info", "warning", "blocking"]),
    relatedIds: z.array(UUID).max(64),
  })
  .strict();

const snapshotFields = {
  departureOrigin: departureOriginSchema,
  departureOrigins: z.array(departureOriginSchema).max(8).optional(),
  destinationOrder: z.enum(["manual", "ai"]).optional(),
  availabilityWindows: z.array(availabilityWindowSchema).min(1).max(32),
  duration: durationPreferenceSchema,
  travellerParty: travellerPartySchema,
  preferences: preferenceProfileSchema,
  constraints: z.array(tripConstraintSchema).max(64),
  destinations: z.array(destinationSchema).min(1).max(8),
  itineraryDays: z.array(itineraryDaySchema).max(366),
  components: z.array(travelComponentSchema).max(32),
  price: tripPriceSchema,
  warnings: z.array(tripWarningSchema).max(64),
};

type SnapshotForValidation = Omit<z.infer<z.ZodObject<typeof snapshotFields>>, "departureOrigin"> & {
  departureOrigin?: z.infer<typeof departureOriginSchema> | null;
};

function validateSnapshot(snapshot: SnapshotForValidation, context: z.RefinementCtx): void {
  if (snapshot.departureOrigins?.length) {
    if (!unique(snapshot.departureOrigins.map((origin) => origin.placeId))) addIssue(context, ["departureOrigins"], "Departure alternatives must be unique");
    if (!snapshot.departureOrigins.some((origin) => origin.placeId === snapshot.departureOrigin?.placeId)) addIssue(context, ["departureOrigin"], "Selected departure must be a confirmed alternative");
  }
  if (!unique(snapshot.availabilityWindows.map((window) => window.id))) {
    addIssue(context, ["availabilityWindows"], "Availability window IDs must be unique");
  }
  if (!snapshot.availabilityWindows.some(
    (window) => daysInclusive(window.startDate, window.endDate) >= snapshot.duration.maximumDays,
  )) {
    addIssue(context, ["duration", "maximumDays"], "Maximum duration must fit at least one availability window");
  }

  const destinationIds = snapshot.destinations.map((destination) => destination.id);
  if (!unique(destinationIds)) {
    addIssue(context, ["destinations"], "Destination IDs must be unique");
  }
  const firstPosition = snapshot.destinations[0]?.routePosition;
  if (
    firstPosition === undefined ||
    (firstPosition !== 0 && firstPosition !== 1) ||
    snapshot.destinations.some((destination, index) => destination.routePosition !== firstPosition + index)
  ) {
    addIssue(context, ["destinations"], "Destination route positions must be unique, contiguous, and ordered");
  }

  for (const [index, destination] of snapshot.destinations.entries()) {
    if (
      destination.arrivalDate !== null &&
      destination.departureDate !== null &&
      !snapshot.availabilityWindows.some(
        (window) => destination.arrivalDate! >= window.startDate && destination.departureDate! <= window.endDate,
      )
    ) {
      addIssue(context, ["destinations", index], "Scheduled destination dates must fit an availability window");
    }
  }

  if (!unique(snapshot.constraints.map((constraint) => constraint.id))) {
    addIssue(context, ["constraints"], "Constraint IDs must be unique");
  }
  if (!unique(snapshot.itineraryDays.map((day) => day.date))) {
    addIssue(context, ["itineraryDays"], "Itinerary dates must be unique");
  }

  const allItemIds = snapshot.itineraryDays.flatMap((day) => day.items.map((item) => item.id));
  if (!unique(allItemIds)) {
    addIssue(context, ["itineraryDays"], "Itinerary item IDs must be unique across the trip");
  }
  const componentIds = snapshot.components.map((component) => component.id);
  if (!unique(componentIds)) {
    addIssue(context, ["components"], "Component IDs must be unique");
  }

  for (const [dayIndex, day] of snapshot.itineraryDays.entries()) {
    if (!destinationIds.includes(day.destinationId)) {
      addIssue(context, ["itineraryDays", dayIndex, "destinationId"], "Itinerary day references an unknown destination");
    }
    if (!snapshot.availabilityWindows.some((window) => day.date >= window.startDate && day.date <= window.endDate)) {
      addIssue(context, ["itineraryDays", dayIndex, "date"], "Itinerary date must fit an availability window");
    }
    for (const [itemIndex, item] of day.items.entries()) {
      if (item.componentId !== null && !componentIds.includes(item.componentId)) {
        addIssue(context, ["itineraryDays", dayIndex, "items", itemIndex, "componentId"], "Unknown component reference");
      }
      if (item.start.slice(0, 10) !== day.date || (item.type !== "travel" && item.end.slice(0, 10) !== day.date)) {
        addIssue(context, ["itineraryDays", dayIndex, "items", itemIndex], "Itinerary item local times must fall on the day date");
      }
    }
  }

  for (const [index, component] of snapshot.components.entries()) {
    if (!component.itineraryItemIds.every((id) => allItemIds.includes(id))) {
      addIssue(context, ["components", index, "itineraryItemIds"], "Component references an unknown itinerary item");
    }
    if (component.price.finalCustomerAmount.currency !== snapshot.price.currency) {
      addIssue(context, ["components", index, "price"], "Component and trip prices must use the same currency");
    }
  }

  const componentSums = snapshot.components.reduce(
    (totals, component) => ({
      supplier: totals.supplier + component.price.supplierAmount.minorUnits,
      margin: totals.margin + component.price.platformMargin.minorUnits,
      taxes: totals.taxes + component.price.customerPayableTaxes.minorUnits,
      fees: totals.fees + component.price.customerPayableFees.minorUnits,
      final: totals.final + component.price.finalCustomerAmount.minorUnits,
    }),
    { supplier: 0, margin: 0, taxes: 0, fees: 0, final: 0 },
  );
  const declaredTotals = snapshot.price;
  if (
    componentSums.supplier !== declaredTotals.supplierTotal.minorUnits ||
    componentSums.margin !== declaredTotals.platformMarginTotal.minorUnits ||
    componentSums.taxes !== declaredTotals.customerPayableTaxesTotal.minorUnits ||
    componentSums.fees !== declaredTotals.customerPayableFeesTotal.minorUnits ||
    componentSums.final !== declaredTotals.finalCustomerTotal.minorUnits
  ) {
    addIssue(context, ["price"], "Trip price totals must equal component price totals");
  }
}

export const tripSnapshotSchema = z.object(snapshotFields).strict().superRefine(validateSnapshot);
export const tripSnapshotV1Schema = tripSnapshotSchema;

const legacyTripSnapshotObjectSchema = z
  .object({ ...snapshotFields, departureOrigin: departureOriginSchema.nullable().optional() })
  .strict()
  .superRefine(validateSnapshot);

export const tripSchema = z
  .object({
    id: UUID,
    ownerUserId: UUID,
    title: nonBlank(120),
    lifecycleState: z.enum(["draft", "finalized", "partially_booked", "booked", "cancelled"]),
    currentVersion: positiveInteger,
    currency: currencySchema,
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
    lastActivityAt: utcDateTimeSchema,
  })
  .strict()
  .superRefine((trip, context) => {
    if (epoch(trip.updatedAt) < epoch(trip.createdAt)) {
      addIssue(context, ["updatedAt"], "updatedAt cannot precede createdAt");
    }
    if (epoch(trip.lastActivityAt) < epoch(trip.createdAt)) {
      addIssue(context, ["lastActivityAt"], "lastActivityAt cannot precede createdAt");
    }
  });

export const draftOperationSchema = z
  .object({
    operation: z.enum(["add", "replace", "remove", "reorder"]),
    target: z.string().regex(/^\/((departureOrigin|departureOrigins|destinationOrder|availabilityWindows|duration|travellerParty|preferences|constraints|destinations|itineraryDays|components|price|warnings)(\/.*)?)?$/),
    value: z.unknown(),
  })
  .strict();

export const tripVersionSchema = z
  .object({
    tripId: UUID,
    version: positiveInteger,
    previousVersion: positiveInteger.nullable(),
    schemaVersion: z.literal(CURRENT_TRIP_SNAPSHOT_SCHEMA_VERSION),
    snapshot: tripSnapshotSchema,
    initiatingActor: z.enum(["user", "agent_proposal", "system_revalidation", "booking_workflow"]),
    initiatingRequestId: UUID,
    proposalId: UUID.nullable(),
    changeSummary: z.array(nonBlank(256)).min(1).max(64),
    inverseOperation: draftOperationSchema.nullable(),
    nonReversibleReason: nonBlank(1000).nullable(),
    createdAt: utcDateTimeSchema,
  })
  .strict()
  .superRefine((version, context) => {
    const expectedPrevious = version.version === 1 ? null : version.version - 1;
    if (version.previousVersion !== expectedPrevious) {
      addIssue(context, ["previousVersion"], "previousVersion must be null for v1 and otherwise version - 1");
    }
    if (version.initiatingActor === "agent_proposal" && version.proposalId === null) {
      addIssue(context, ["proposalId"], "Proposal-initiated versions require proposalId");
    }
    if (version.initiatingActor !== "agent_proposal" && version.proposalId !== null) {
      addIssue(context, ["proposalId"], "proposalId is only valid for proposal-initiated versions");
    }
    if (version.inverseOperation === null && version.nonReversibleReason === null) {
      addIssue(context, ["nonReversibleReason"], "A non-reversible version requires a reason");
    }
    if (version.inverseOperation !== null && version.nonReversibleReason !== null) {
      addIssue(context, ["nonReversibleReason"], "A reversible version cannot have a non-reversible reason");
    }
    if (!unique(version.changeSummary)) {
      addIssue(context, ["changeSummary"], "Change summary entries must be unique");
    }
  });

export const tripAggregateSchema = z
  .object({
    trip: tripSchema,
    versions: z.array(tripVersionSchema).min(1),
  })
  .strict()
  .superRefine((aggregate, context) => {
    for (const [index, version] of aggregate.versions.entries()) {
      if (version.tripId !== aggregate.trip.id) {
        addIssue(context, ["versions", index, "tripId"], "Every version must belong to the aggregate trip");
      }
      if (version.version !== index + 1 || version.previousVersion !== (index === 0 ? null : index)) {
        addIssue(context, ["versions", index, "version"], "Versions must form an ordered, gap-free chain from 1");
      }
      if (index > 0 && epoch(version.createdAt) < epoch(aggregate.versions[index - 1].createdAt)) {
        addIssue(context, ["versions", index, "createdAt"], "Version timestamps must be monotonic");
      }
    }
    const current = aggregate.versions.at(-1);
    if (current?.version !== aggregate.trip.currentVersion) {
      addIssue(context, ["trip", "currentVersion"], "currentVersion must point to the last aggregate version");
    }
    if (current?.snapshot.price.currency !== aggregate.trip.currency) {
      addIssue(context, ["trip", "currency"], "Trip currency must match the current version presentation currency");
    }
  });

export class UnsupportedTripSnapshotVersionError extends Error {
  readonly schemaVersion: number;

  constructor(schemaVersion: number) {
    super(`Unsupported trip snapshot schema version: ${schemaVersion}`);
    this.name = "UnsupportedTripSnapshotVersionError";
    this.schemaVersion = schemaVersion;
  }
}

export type TripSnapshot = z.infer<typeof tripSnapshotSchema>;
export type LegacyTripSnapshot = z.infer<typeof legacyTripSnapshotObjectSchema>;
export type Trip = z.infer<typeof tripSchema>;
export type DraftOperation = z.infer<typeof draftOperationSchema>;
export type TripVersion = z.infer<typeof tripVersionSchema>;
export type TripAggregate = z.infer<typeof tripAggregateSchema>;

export type DecodedTripSnapshot =
  | { schemaVersion: 1; compatibility: "current"; snapshot: TripSnapshot; requiresDepartureOrigin: false }
  | { schemaVersion: 0; compatibility: "legacy"; snapshot: LegacyTripSnapshot; requiresDepartureOrigin: boolean };

export function decodeTripSnapshot(schemaVersion: number | null | undefined, snapshot: unknown): DecodedTripSnapshot;
export function decodeTripSnapshot(envelope: { schemaVersion?: number | null; snapshot: unknown }): DecodedTripSnapshot;
export function decodeTripSnapshot(
  versionOrEnvelope: number | null | undefined | { schemaVersion?: number | null; snapshot: unknown },
  snapshotArgument?: unknown,
): DecodedTripSnapshot {
  const envelope =
    typeof versionOrEnvelope === "object" && versionOrEnvelope !== null
      ? versionOrEnvelope
      : { schemaVersion: versionOrEnvelope, snapshot: snapshotArgument };

  if (envelope.schemaVersion === CURRENT_TRIP_SNAPSHOT_SCHEMA_VERSION) {
    return {
      schemaVersion: CURRENT_TRIP_SNAPSHOT_SCHEMA_VERSION,
      compatibility: "current",
      snapshot: tripSnapshotSchema.parse(envelope.snapshot),
      requiresDepartureOrigin: false,
    };
  }
  if (
    envelope.schemaVersion === LEGACY_TRIP_SNAPSHOT_SCHEMA_VERSION ||
    envelope.schemaVersion === null ||
    envelope.schemaVersion === undefined
  ) {
    const snapshot = legacyTripSnapshotObjectSchema.parse(envelope.snapshot);
    return {
      schemaVersion: LEGACY_TRIP_SNAPSHOT_SCHEMA_VERSION,
      compatibility: "legacy",
      snapshot,
      requiresDepartureOrigin: snapshot.departureOrigin == null,
    };
  }
  throw new UnsupportedTripSnapshotVersionError(envelope.schemaVersion);
}
