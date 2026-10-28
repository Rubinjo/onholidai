import { z } from "zod";

import { componentDetails } from "@/server/supply/directions";

import {
  FEASIBILITY_POLICY as policy,
  offsetMatches,
  paceMinutes,
  qualifiedInstant,
  requiredArrivalMinutes,
} from "./feasibility-policy";
import { feasibilityIssueSchema } from "./itinerary.ts";

import type { TripSnapshot } from "./schema";

export { feasibilityIssueSchema } from "./itinerary.ts";

export const feasibilityReportSchema = z
  .object({
    policyVersion: z.literal("1"),
    blocking: z.array(feasibilityIssueSchema),
    unverified: z.array(feasibilityIssueSchema),
    exceptions: z.array(feasibilityIssueSchema),
    suggestions: z.array(
      z
        .object({ itemId: z.uuid(), action: z.enum(["move", "remove"]), reason: z.string() })
        .strict(),
    ),
    totalItems: z.number().int().nonnegative(),
    verifiedItems: z.number().int().nonnegative(),
  })
  .strict();
export type FeasibilityReport = z.infer<typeof feasibilityReportSchema>;
type Item = TripSnapshot["itineraryDays"][number]["items"][number];

// Free time is what the day leaves unallocated rather than a placeholder block, so an
// itinerary only carrying sourced events and meals can still satisfy policy v1.
const LEISURE_START_MINUTE = 8 * 60;
const LEISURE_END_MINUTE = 21 * 60;
const LEISURE_MINUTES = LEISURE_END_MINUTE - LEISURE_START_MINUTE;

function wallClockMinute(value: string): number {
  return Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
}

/** Minutes of an item that fall inside the day's ordinary waking window. */
function leisureOverlap(start: string, end: string, dayDate: string): number {
  const from = Math.max(wallClockMinute(start), LEISURE_START_MINUTE);
  const until =
    end.slice(0, 10) > dayDate
      ? LEISURE_END_MINUTE
      : Math.min(wallClockMinute(end), LEISURE_END_MINUTE);
  return Math.max(0, until - from);
}

export function evaluateFeasibility(snapshot: TripSnapshot, now = new Date()): FeasibilityReport {
  const result: FeasibilityReport = {
    policyVersion: "1",
    blocking: [],
    unverified: [],
    exceptions: [],
    suggestions: [],
    totalItems: 0,
    verifiedItems: 0,
  };
  const failed = new Set<string>(),
    activeConstraints = snapshot.constraints.filter((entry) => entry.status !== "removed");
  function issue(
    bucket: "blocking" | "unverified" | "exceptions",
    code: string,
    message: string,
    ids: string[] = [],
  ) {
    result[bucket].push({ code, message, relatedIds: ids });
    if (bucket !== "exceptions") ids.forEach((id) => failed.add(id));
  }
  for (const warning of snapshot.warnings.filter((entry) => entry.severity === "blocking"))
    issue("blocking", warning.code, warning.message, warning.relatedIds);
  for (const constraint of activeConstraints) {
    if (constraint.status === "conflicting")
      issue(
        constraint.priority === "required" ? "blocking" : "unverified",
        "constraint_conflict",
        `Resolve ${constraint.statement}`,
        [constraint.id],
      );
  }
  if (!snapshot.itineraryDays.length)
    issue("blocking", "missing_itinerary", "Prepare a day-by-day itinerary before finalization.");
  const days = [...snapshot.itineraryDays].sort((a, b) => a.date.localeCompare(b.date));
  const first = days[0]?.date,
    last = days.at(-1)?.date;
  if (first && last) {
    const count = Math.round((Date.parse(last) - Date.parse(first)) / 86400000) + 1;
    if (
      count < snapshot.duration.minimumDays ||
      count > snapshot.duration.maximumDays ||
      count !== days.length ||
      !snapshot.availabilityWindows.some(
        (window) => first >= window.startDate && last <= window.endDate,
      )
    ) {
      issue(
        "blocking",
        "date_duration",
        "Resolve missing days, availability window or duration conflicts.",
        days.flatMap((day) => day.items.map((item) => item.id)),
      );
    }
    const scheduled = snapshot.destinations.filter(
      (destination) => destination.arrivalDate && destination.departureDate,
    );
    if (
      scheduled.length !== snapshot.destinations.length ||
      scheduled[0]?.arrivalDate !== first ||
      scheduled.at(-1)?.departureDate !== last
    ) {
      issue(
        "blocking",
        "route_coverage",
        "The itinerary must cover the full accepted destination route.",
      );
    }
  }
  let previousEnd: number | null = null;
  const timing = new Map<string, { start: number; end: number; item: Item }>();
  for (const day of days) {
    const items = day.items.filter((item) => item.status !== "cancelled");
    result.totalItems += items.length;
    const hasMandatoryTravel = items.some(
      (item) =>
        item.type === "travel" &&
        item.travelSegment &&
        ["flight", "rail", "ferry"].includes(item.travelSegment.mode),
    );
    const exception = Boolean(day.mandatoryTravelException && hasMandatoryTravel);
    if (exception)
      issue(
        "exceptions",
        "mandatory_travel",
        day.mandatoryTravelException!,
        items.map((item) => item.id),
      );
    let occupied = 0,
      discretionary = 0,
      scheduled = 0,
      meals = 0,
      prior: { item: Item; end: number } | null = null;
    for (const item of items) {
      const start = qualifiedInstant(item.start, day.timezone, item.startOffset),
        end = qualifiedInstant(item.end, day.timezone, item.endOffset);
      if (start === null || end === null || end <= start) {
        issue(
          "blocking",
          "invalid_local_time",
          "Clarify ambiguous, nonexistent or unordered local times.",
          [item.id],
        );
        continue;
      }
      timing.set(item.id, { start, end, item });
      const minutes = (end - start) / 60000;
      if (item.type === "activity") discretionary += minutes;
      if (["meal", "activity", "travel"].includes(item.type)) occupied += minutes;
      if (item.type === "meal" && minutes >= policy.mealMinutes) meals++;
      // Notes and explicit free-time blocks are not occupancy: free time is what a day
      // leaves unallocated, whichever form the plan uses to describe it.
      if (item.type !== "note" && item.type !== "free_time")
        scheduled += leisureOverlap(item.start, item.end, day.date);
      if (
        item.verificationStatus !== "verified" ||
        !item.timingEvidence?.length ||
        item.feasibilityPolicyVersion !== "1"
      )
        issue("unverified", "item_evidence", "Timing/source evidence is unverified.", [item.id]);
      if (item.durationUpperBoundMinutes && minutes < item.durationUpperBoundMinutes)
        issue("blocking", "duration_bound", "Allow the sourced upper duration bound.", [item.id]);
      if (prior && start < prior.end)
        issue("blocking", "overlap", "Move or remove overlapping items.", [prior.item.id, item.id]);
      if (prior && item.type !== "note" && prior.item.type !== "note") {
        const a = prior.item.travelSegment
          ? prior.item.travelSegment.destination.location
          : prior.item.location;
        const b = item.travelSegment ? item.travelSegment.origin.location : item.location;
        const different = a && b && (a.latitude !== b.latitude || a.longitude !== b.longitude);
        if (different) {
          const route = item.transitionFromPrevious;
          if (!route || route.verificationStatus !== "verified")
            issue(
              "unverified",
              "unknown_transit",
              "Travel time between these locations is unverified.",
              [item.id],
            );
          if (
            route &&
            (start - prior.end) / 60000 <
              (route.durationUpperBoundMinutes ?? route.durationMinutes) + policy.transitionMinutes
          )
            issue(
              "blocking",
              "transition_buffer",
              "Allow sourced travel duration plus 15 minutes transition.",
              [item.id],
            );
        } else if (!a || !b)
          issue("unverified", "unknown_location", "Location or transit evidence is unavailable.", [
            item.id,
          ]);
      }
      for (const constraint of activeConstraints) {
        const relevant =
          constraint.category === "schedule" ||
          constraint.category === "other" ||
          (constraint.category === "transport" && item.type === "travel") ||
          (constraint.category === "dietary" && item.type === "meal") ||
          (constraint.category === "accessibility" && ["activity", "travel"].includes(item.type));
        if (!relevant || item.type === "note") continue;
        const evidence = item.constraintEvidence?.find(
          (entry) => entry.constraintId === constraint.id,
        );
        if (
          constraint.priority === "required" &&
          constraint.category === "schedule" &&
          /no (?:activities|early mornings)|mornings free/i.test(constraint.statement)
        ) {
          const threshold = /before\s+(\d{1,2}):(\d{2})/.exec(constraint.statement);
          const earliest = threshold ? Number(threshold[1]) * 60 + Number(threshold[2]) : 600;
          const hour = Number(item.start.slice(11, 13)) * 60 + Number(item.start.slice(14, 16));
          if (item.type === "activity" && hour < earliest)
            issue(
              "blocking",
              "required_schedule",
              `Resolve required schedule: ${constraint.statement}`,
              [item.id],
            );
        }
        if (evidence?.status === "failed")
          issue(
            constraint.priority === "required" ? "blocking" : "unverified",
            "required_constraint",
            `Resolve ${constraint.statement}`,
            [item.id, constraint.id],
          );
        else if (evidence?.status !== "verified")
          issue(
            "unverified",
            "constraint_unverified",
            `Unverified condition: ${constraint.statement}`,
            [item.id, constraint.id],
          );
      }
      const segment = item.travelSegment;
      if (segment) {
        const departure = Date.parse(segment.plannedDeparture),
          arrival = Date.parse(segment.plannedArrival);
        if (
          !offsetMatches(segment.plannedDeparture, segment.origin.timezone) ||
          !offsetMatches(segment.plannedArrival, segment.destination.timezone)
        )
          issue("blocking", "segment_timezone", "Resolve travel timezone/offset mismatch.", [
            item.id,
          ]);
        if (segment.verificationStatus === "failed")
          issue("blocking", "travel_unavailable", "Resolve unavailable travel.", [item.id]);
        if (segment.verificationStatus !== "verified" || !segment.timingEvidence.length)
          issue("unverified", "travel_evidence", "Travel duration is unverified.", [item.id]);
        if (
          (arrival - departure) / 60000 <
            (segment.durationUpperBoundMinutes ?? segment.durationMinutes) ||
          arrival > end ||
          departure < start
        )
          issue(
            "blocking",
            "travel_duration",
            "Travel must fit the sourced upper duration and itinerary item.",
            [item.id],
          );
        const buffer = requiredArrivalMinutes(
          segment.mode,
          segment.international ?? true,
          segment.providerArrivalMinutes,
        );
        if (buffer && (departure - start) / 60000 < buffer) {
          // A departure just after the day starts cannot hold its airport buffer inside
          // this plan, so the shortfall is disclosed rather than reported as impossible.
          const dayStart = qualifiedInstant(`${day.date}T00:00`, day.timezone);
          const truncated = dayStart !== null && start <= dayStart;
          issue(
            truncated ? "exceptions" : "blocking",
            "arrival_buffer",
            truncated
              ? `The ${buffer}-minute airport buffer before departure starts before this day.`
              : `Arrive ${buffer} minutes before departure (planning default).`,
            [item.id],
          );
        }
        if (segment.connectionFromItemId) {
          const connection = timing.get(segment.connectionFromItemId)?.item.travelSegment;
          if (!connection || segment.connectionMinimumMinutes == null)
            issue("unverified", "connection_minimum", "Published connection minimum unavailable.", [
              item.id,
            ]);
          else if (
            (departure - Date.parse(connection.plannedArrival)) / 60000 <
            segment.connectionMinimumMinutes + policy.connectionCushionMinutes
          )
            issue(
              "blocking",
              "impossible_connection",
              "Resolve connection: published minimum plus 30 minutes is required.",
              [item.id],
            );
        }
      }
      prior = { item, end };
    }
    const timed = items.map((item) => timing.get(item.id)).filter((value) => value !== undefined);
    const start = timed[0]?.start;
    if (
      previousEnd !== null &&
      start !== undefined &&
      start - previousEnd < policy.overnightRestMinutes * 60000
    )
      issue(
        exception ? "exceptions" : "blocking",
        "overnight_rest",
        "Preserve 9 hours overnight rest.",
        items.map((item) => item.id),
      );
    previousEnd = timed.at(-1)?.end ?? previousEnd;
    if (meals < policy.mealCount || LEISURE_MINUTES - scheduled < policy.freeMinutes)
      issue(
        exception ? "exceptions" : "blocking",
        "daily_rest",
        "Preserve two 45-minute meals and 60 unallocated daytime minutes.",
        items.map((item) => item.id),
      );
    if (
      discretionary > paceMinutes(snapshot.preferences.pace) ||
      occupied > policy.occupiedMinutes
    ) {
      issue(
        exception ? "exceptions" : "blocking",
        "pace_limit",
        "Move or remove lower-priority items to respect pace and the 10-hour occupied cap.",
        items.map((item) => item.id),
      );
      for (const item of items.filter(
        (entry) => entry.type === "activity" && entry.priority !== "required",
      ))
        result.suggestions.push({
          itemId: item.id,
          action: "move",
          reason: "Lower-priority activity exceeds daily pace or occupied allowance.",
        });
    }
  }
  for (const component of snapshot.components) {
    const details = componentDetails(component),
      ids = [component.id, ...component.itineraryItemIds];
    if (
      details.timezone &&
      (!offsetMatches(component.serviceStart, details.timezone) ||
        !offsetMatches(component.serviceEnd, details.timezone))
    )
      issue(
        "blocking",
        "component_timezone",
        "Resolve component timezone and service-time offsets.",
        ids,
      );
    if (
      details.constraintEvidence.some(
        (entry) => !activeConstraints.some((constraint) => constraint.id === entry.constraintId),
      )
    )
      issue(
        "unverified",
        "unknown_constraint_evidence",
        "Component constraint evidence references an unknown requirement.",
        ids,
      );
    if (
      component.offerStatus === "unavailable" ||
      details.eligibility === "failed" ||
      details.availability === "failed"
    )
      issue(
        "blocking",
        "component_unavailable",
        "Resolve unavailable or ineligible component, including seasonal closure.",
        ids,
      );
    if (component.bookingStatus !== "unbooked")
      issue(
        "blocking",
        "transactional_component",
        "Planning finalization cannot change booked components.",
        ids,
      );
    if (
      [component.expiresAt, component.price.expiresAt].some(
        (expiry) => expiry && Date.parse(expiry) <= now.getTime(),
      ) ||
      component.offerStatus !== "available"
    )
      issue(
        "unverified",
        "offer_freshness",
        "Offer facts are expired or changed; revalidation is needed before booking.",
        ids,
      );
    if (
      details.unavailableFacts.length ||
      details.eligibility === "unverified" ||
      details.availability === "unverified"
    )
      issue(
        "unverified",
        "component_details",
        `Unavailable component facts: ${details.unavailableFacts.join(", ") || "eligibility/availability"}`,
        ids,
      );
    for (const constraint of activeConstraints) {
      const relevant =
        constraint.category === "accessibility" ||
        (constraint.category === "lodging" && component.type === "accommodation") ||
        (constraint.category === "dietary" && component.type === "activity");
      if (!relevant) continue;
      const evidence = details.constraintEvidence.find(
        (entry) => entry.constraintId === constraint.id,
      );
      if (
        evidence?.status === "failed" ||
        (constraint.category === "accessibility" && details.accessibility === "failed")
      )
        issue(
          constraint.priority === "required" ? "blocking" : "unverified",
          "component_constraint",
          `Resolve ${constraint.statement}`,
          ids,
        );
      else if (evidence?.status !== "verified")
        issue(
          "unverified",
          "component_constraint",
          `Unverified condition: ${constraint.statement}`,
          ids,
        );
    }
    if (
      component.type !== "accommodation" &&
      !days.some((day) => day.items.some((item) => item.componentId === component.id))
    )
      issue(
        "blocking",
        "missing_component_schedule",
        "Schedule every accepted travel/activity component.",
        ids,
      );
    if (component.type !== "accommodation") {
      const scheduled = [...timing.values()].filter(
        (entry) => entry.item.componentId === component.id,
      );
      // A round-trip fare schedules one item per flown journey; without journey facts
      // the component's single service window remains the only schedule it can match.
      const expected = (
        component.planningDetails?.flightJourneys?.length
          ? component.planningDetails.flightJourneys.map((journey) => ({
              start: Date.parse(journey.departingAt),
              end: Date.parse(journey.arrivingAt),
            }))
          : [{ start: Date.parse(component.serviceStart), end: Date.parse(component.serviceEnd) }]
      ).map((window) => `${window.start}-${window.end}`);
      const actual = scheduled.map((entry) =>
        [
          entry.item.travelSegment
            ? Date.parse(entry.item.travelSegment.plannedDeparture)
            : entry.start,
          entry.end,
        ].join("-"),
      );
      if (
        actual.length !== expected.length ||
        expected.some((window) => !actual.includes(window))
      ) {
        issue(
          "blocking",
          "component_schedule_mismatch",
          "Resolve the itinerary against the exact accepted component service times.",
          ids,
        );
      }
    }
  }
  if (!snapshot.components.length)
    issue(
      "blocking",
      "missing_components",
      "Prepare estimated travel, stay and activity components before finalization.",
    );
  for (const constraint of activeConstraints.filter(
    (entry) => entry.category === "lodging" && entry.priority === "required",
  )) {
    const maximum = /(?:no more than|maximum|at most)\s+(\d+|two|one|three)\s+hotel changes/i.exec(
      constraint.statement,
    );
    if (maximum) {
      const limit =
        ({ one: 1, two: 2, three: 3 } as Record<string, number>)[maximum[1].toLowerCase()] ??
        Number(maximum[1]);
      const stays = new Set(
        snapshot.components
          .filter((entry) => entry.type === "accommodation")
          .map((entry) => entry.planningDetails?.locationName ?? entry.supplierOfferId),
      );
      if (stays.size - 1 > limit)
        issue(
          "blocking",
          "hotel_changes",
          `Resolve required hotel-change limit: ${constraint.statement}`,
          [constraint.id],
        );
    }
  }
  result.verifiedItems = days
    .flatMap((day) => day.items)
    .filter((item) => item.status !== "cancelled" && !failed.has(item.id)).length;
  return result;
}
