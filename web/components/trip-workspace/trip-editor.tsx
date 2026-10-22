"use client";
import { useState } from "react";

import { planningJson, planningError } from "@/components/trip-setup/http";
import { Destinations } from "@/components/trip-setup/destinations";
import { Availability } from "@/components/trip-setup/availability";
import { PartyPreferences } from "@/components/trip-setup/party-preferences";
import { Constraints } from "@/components/trip-setup/constraints";
import { Button } from "@/components/ui/button";

import { tripEnvelopeSchema } from "./use-trip";

import type { TripEnvelope } from "./use-trip";

const editableTargets = [
  "departureOrigin",
  "departureOrigins",
  "destinationOrder",
  "destinations",
  "availabilityWindows",
  "duration",
  "travellerParty",
  "preferences",
  "constraints",
] as const;
export function TripEditor({
  trip,
  onCommit,
  draftState,
  onEditRoute,
}: {
  trip: TripEnvelope;
  onCommit: (raw: unknown) => void;
  draftState?: {
    snapshot: TripEnvelope["snapshot"];
    update: (snapshot: TripEnvelope["snapshot"]) => void;
  };
  onEditRoute?: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [command, setCommand] = useState<{
    requestId: string;
    expectedVersion: number;
    operations: { operation: string; target: string; value: unknown }[];
  } | null>(null);
  const [localDraft, setLocalDraft] = useState(trip.snapshot);
  const draft = draftState?.snapshot ?? localDraft,
    setDraft = draftState?.update ?? setLocalDraft;
  const [editingBase, setEditingBase] = useState(trip);
  // Only changed settings become operations; the review contract rejects an empty request.
  const operations = editableTargets.flatMap((key) =>
    JSON.stringify(draft[key]) === JSON.stringify(editingBase.snapshot[key])
      ? []
      : [
          {
            operation: editingBase.snapshot[key] === undefined ? "add" : "replace",
            target: `/${key}`,
            value: draft[key],
          },
        ],
  );
  const matchesSaved = editableTargets.every(
    (key) => JSON.stringify(draft[key]) === JSON.stringify(trip.snapshot[key]),
  );
  if (editingBase.version !== trip.version && (operations.length === 0 || matchesSaved)) {
    setEditingBase(trip);
    if (!draftState) setLocalDraft(trip.snapshot);
    setCommand(null);
  }
  async function apply() {
    if (busy || matchesSaved || editingBase.version !== trip.version) return;
    setBusy(true);
    setError("");
    try {
      const input =
        command &&
        command.expectedVersion === editingBase.version &&
        JSON.stringify(command.operations) === JSON.stringify(operations)
          ? command
          : { requestId: crypto.randomUUID(), expectedVersion: editingBase.version, operations };
      setCommand(input);
      const result = tripEnvelopeSchema.parse(
        await planningJson(`/api/v1/trips/${trip.tripId}/commands/edit`, input),
      );
      onCommit(result);
      setEditingBase(result);
      setDraft(result.snapshot);
      setCommand(null);
    } catch (failure) {
      setError(planningError(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="details-heading" data-trip-version={trip.version}>
      <h2 id="details-heading">Trip details</h2>
      <p>Saved version {trip.version}.</p>
      <p>
        Saved travellers: {trip.snapshot.travellerParty.adults} adults; child ages at trip start:{" "}
        {trip.snapshot.travellerParty.children.map((child) => child.ageAtTripStart).join(", ") ||
          "none"}
        .
      </p>
      {editingBase.version !== trip.version && (
        <p role="alert">
          The trip changed while you were editing. Your unsaved inputs are preserved. Discard
          changes to use the latest saved details before applying edits.
        </p>
      )}
      {!matchesSaved && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setEditingBase(trip);
            setDraft(trip.snapshot);
            setCommand(null);
            setError("");
          }}
        >
          Discard changes
        </Button>
      )}
      {trip.lifecycleState === "finalized" && (
        <p>Undo finalization in version history to return to a draft before editing.</p>
      )}
      <form
        onInvalid={(event) => {
          if (event.target instanceof HTMLElement) {
            let section = event.target.closest("details");
            while (section) {
              section.open = true;
              section = section.parentElement?.closest("details") ?? null;
            }
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void apply();
        }}
      >
        <fieldset disabled={busy || trip.lifecycleState !== "draft"}>
          <legend>Edit draft settings</legend>
          <details>
            <summary>Destinations and departure locations</summary>
            {onEditRoute && (
              <Button variant="secondary" onClick={onEditRoute}>
                Edit destinations on the globe
              </Button>
            )}
            <Destinations
              mode={onEditRoute ? "origin" : "both"}
              mapVisible={false}
              origin={draft.departureOrigin}
              destinations={draft.destinations}
              onOrigin={(departureOrigin) => setDraft({ ...draft, departureOrigin })}
              origins={
                draft.departureOrigins ?? (draft.departureOrigin ? [draft.departureOrigin] : [])
              }
              order={draft.destinationOrder ?? "manual"}
              onOrder={(destinationOrder) => setDraft({ ...draft, destinationOrder })}
              onOrigins={(departureOrigins) =>
                setDraft({
                  ...draft,
                  departureOrigins,
                  departureOrigin:
                    departureOrigins.find(
                      (entry) => entry.placeId === draft.departureOrigin?.placeId,
                    ) ??
                    departureOrigins[0] ??
                    null,
                })
              }
              onDestinations={(destinations) =>
                setDraft({
                  ...draft,
                  destinations: destinations.map((entry) => ({
                    ...entry,
                    arrivalDate: null,
                    departureDate: null,
                    plannedNights: 0,
                  })),
                })
              }
            />
          </details>
          <details>
            <summary>Dates and trip length</summary>
            <Availability
              windows={draft.availabilityWindows}
              timezone={draft.departureOrigin?.timezone}
              duration={draft.duration}
              onChange={({ windows: availabilityWindows, duration }) =>
                setDraft({ ...draft, availabilityWindows, duration })
              }
            />
          </details>
          <details>
            <summary>Travellers and travel style</summary>
            <PartyPreferences
              party={draft.travellerParty}
              preferences={draft.preferences}
              onParty={(travellerParty) => setDraft({ ...draft, travellerParty })}
              onPreferences={(preferences) => setDraft({ ...draft, preferences })}
            />
          </details>
          <details>
            <summary>Requirements</summary>
            <Constraints
              constraints={draft.constraints}
              onChange={(constraints) => setDraft({ ...draft, constraints })}
            />
          </details>
          {!matchesSaved && (
            <Button type="submit" disabled={busy || editingBase.version !== trip.version}>
              {busy ? "Applying…" : "Apply changes"}
            </Button>
          )}
        </fieldset>
      </form>
      <p role="alert">{error}</p>
    </section>
  );
}
