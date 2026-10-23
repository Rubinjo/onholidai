"use client";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { changeProposalSchema } from "@/domain/trip/proposal";
import { planningJson, planningError } from "@/components/trip-setup/http";
import { tripEnvelopeSchema, type TripEnvelope } from "@/components/trip-workspace/use-trip";
import { Button } from "@/components/ui/button";

import { ProposalCard } from "./proposal-card";
import { Clarification } from "./clarification";
import { TripCheckpoint, useChatVersions } from "./trip-checkpoints";

import type { SelectedOffer } from "@/domain/trip/proposal";

const runSchema = z
  .object({
    id: z.uuid(),
    status: z.string(),
    result: z
      .object({
        kind: z.string(),
        message: z.string().optional(),
        proposal: changeProposalSchema.optional(),
        clarification: z.object({ id: z.uuid(), question: z.string() }).passthrough().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
const messagesSchema = z
  .object({
    items: z.array(
      z
        .object({
          messages: z.array(
            z
              .object({
                id: z.uuid(),
                role: z.string(),
                content: z.string(),
                tripVersion: z.number().nullable(),
                agentRunId: z.string().nullable().optional(),
                createdAt: z.string().optional(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
    nextMessageCursor: z.uuid().nullable().optional(),
  })
  .passthrough();
export function Conversation({
  trip,
  initialRunId,
  initialResearchRequestId,
  onCommit,
  selection,
}: {
  trip: TripEnvelope;
  initialRunId: string | null;
  initialResearchRequestId?: string;
  onCommit: (raw: unknown) => void;
  selection?: {
    requestId: string;
    tripId: string;
    tripVersion: number;
    offer: SelectedOffer;
  } | null;
}) {
  const client = useQueryClient(),
    [runId, setRunId] = useState(initialRunId),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dismissed, setDismissed] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");
  const versions = useChatVersions(trip.tripId, trip.version);
  const pendingResearch = useRef<{
    requestId: string;
    baseTripVersion: number;
    purpose: "initial_estimate" | "refinement" | "finalization";
    message: string;
    selectedOffers?: SelectedOffer[];
  } | null>(null);
  const history = useInfiniteQuery({
    queryKey: ["conversation", trip.tripId],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) =>
      messagesSchema.parse(
        await planningJson(
          `/api/v1/trips/${trip.tripId}/conversations?timeline=true${pageParam ? `&beforeMessage=${pageParam}` : ""}`,
        ),
      ),
    getNextPageParam: (page) => page.nextMessageCursor ?? undefined,
    refetchInterval: 2000,
  });
  const run = useQuery({
    queryKey: ["run", runId],
    enabled: Boolean(runId),
    queryFn: async () => runSchema.parse(await planningJson(`/api/v1/agent-runs/${runId}`)),
    refetchInterval: (query) =>
      ["queued", "running"].includes(query.state.data?.status ?? "queued") ? 1000 : false,
  });
  const refreshHistory = history.refetch;
  const submit = useCallback(
    async (
      purpose?: "initial_estimate" | "refinement" | "finalization",
      selected?: NonNullable<typeof selection>,
    ) => {
      setError("");
      setOutcome("");
      setBusy(true);
      try {
        // A new reservation uses current accepted facts; uncertain submissions
        // replay their original request and version until their outcome is known.
        const latest = tripEnvelopeSchema.parse(await planningJson(`/api/v1/trips/${trip.tripId}`));
        if (
          selected &&
          (selected.tripId !== latest.tripId || selected.tripVersion !== latest.version)
        )
          throw new Error("Selected research is stale. Request current options.");
        pendingResearch.current ??= {
          requestId:
            selected?.requestId ??
            (!runId && initialResearchRequestId ? initialResearchRequestId : crypto.randomUUID()),
          baseTripVersion: latest.version,
          purpose:
            purpose ?? (latest.snapshot.components.length ? "refinement" : "initial_estimate"),
          message:
            purpose === "finalization"
              ? "Prepare detailed itinerary"
              : selected
                ? "Use this selected supplier research within my current trip requirements."
                : message || "Estimate my reviewed settings and update my draft trip.",
          ...(selected ? { selectedOffers: [selected.offer] } : {}),
        };
        const sent = pendingResearch.current;
        const value = runSchema.parse(
          await planningJson(`/api/v1/trips/${trip.tripId}/agent-runs`, {
            ...sent,
            applicationPolicy: "automatic",
            conversationId: null,
          }),
        );
        pendingResearch.current = null;
        setRunId(value.id);
        setMessage((current) => (current === sent.message ? "" : current));
        setDismissed(null);
        void refreshHistory();
      } catch (failure) {
        setError(planningError(failure));
      } finally {
        setBusy(false);
      }
    },
    [trip.tripId, runId, initialResearchRequestId, message, refreshHistory],
  );
  const handledSelection = useRef<string | null>(null);
  useEffect(() => {
    if (selection && handledSelection.current !== selection.requestId) {
      handledSelection.current = selection.requestId;
      if (pendingResearch.current) {
        setError("A planning request is still pending. Retry it before selecting another option.");
        return;
      }
      void submit("refinement", selection);
    }
  }, [selection, submit]);
  const initialStarted = useRef(false);
  useEffect(() => {
    if (!initialStarted.current && !initialRunId && initialResearchRequestId) {
      initialStarted.current = true;
      void submit();
    }
  }, [initialRunId, initialResearchRequestId, submit]);
  const result = run.data?.result,
    active = ["queued", "running"].includes(run.data?.status ?? "");
  const checkpoints = versions.data?.pages.flatMap((page) => page.items) ?? [];
  const committedRuns = new Set(checkpoints.map((entry) => entry.runId).filter(Boolean));
  const timeline = [
    ...(history.data?.pages.flatMap((page) => page.items.flatMap((entry) => entry.messages)) ?? [])
      .filter(
        (entry) =>
          entry.role !== "assistant" || !entry.agentRunId || !committedRuns.has(entry.agentRunId),
      )
      .map((entry) => ({
        id: entry.id,
        at: entry.createdAt ?? "",
        message: entry,
        checkpoint: null,
      })),
    ...checkpoints.map((entry) => ({
      id: `version-${entry.version}`,
      at: entry.createdAt,
      message: null,
      checkpoint: entry,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return (
    <section
      className="assistant-chat"
      aria-labelledby="conversation-heading"
      data-trip-version={trip.version}
    >
      <h2 id="conversation-heading">Your travel assistant</h2>
      <p>Ask a question, explore an option, or tell us what you’d change.</p>
      <p className="assistant-chat__hint">
        Planning changes are applied automatically. Restore an earlier version below. Nothing is
        booked here.
      </p>
      {versions.hasNextPage && (
        <Button
          variant="ghost"
          disabled={versions.isFetchingNextPage}
          onClick={() => void versions.fetchNextPage()}
        >
          Load earlier trip versions
        </Button>
      )}
      {history.hasNextPage && (
        <Button
          variant="ghost"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          Load earlier messages
        </Button>
      )}
      <ol
        className="assistant-chat__messages"
        aria-label="Conversation"
        aria-live="polite"
        aria-relevant="additions"
      >
        {timeline.map((entry) => (
          <li
            className={`assistant-chat__message assistant-chat__message--${entry.message?.role ?? "assistant"}`}
            key={entry.id}
          >
            <strong>
              {entry.message?.role === "user" || entry.checkpoint?.actor === "user"
                ? "You"
                : entry.checkpoint && entry.checkpoint.actor !== "agent_proposal"
                  ? "Saved trip"
                  : "OnHolidai"}
            </strong>
            {entry.checkpoint ? (
              <TripCheckpoint
                entry={entry.checkpoint}
                trip={trip}
                onCommit={onCommit}
                onStatus={setOutcome}
              />
            ) : (
              <p>{entry.message?.content}</p>
            )}
          </li>
        ))}
      </ol>
      <p role="status" aria-live="polite">
        {busy
          ? "Sending your request…"
          : outcome ||
            (run.data?.status === "failed"
              ? "Research interrupted. Request a fresh update on this saved trip."
              : active
                ? "Updating your trip…"
                : "Ready")}
      </p>
      <p role="alert">
        {error ||
          (run.error
            ? planningError(run.error)
            : history.error
              ? planningError(history.error)
              : versions.error
                ? planningError(versions.error)
                : "")}
      </p>
      {result?.proposal &&
        ["proposed", "stale"].includes(result.proposal.status) &&
        dismissed !== result.proposal.id && (
          <>
            <p>
              This saved proposal predates automatic updates. Review it once, or send a new request.
            </p>
            <ProposalCard
              key={result.proposal.id}
              proposal={result.proposal}
              tripId={trip.tripId}
              version={trip.version}
              onCommit={onCommit}
              onDismiss={() => {
                setDismissed(result.proposal!.id);
                void history.refetch();
                void run.refetch();
              }}
            />
          </>
        )}
      {result?.proposal?.status === "rejected" && (
        <p>This proposal was rejected; it did not change the trip.</p>
      )}
      {result?.clarification && runId && run.data?.status === "awaiting_clarification" && (
        <Clarification
          key={result.clarification.id}
          runId={runId}
          question={result.clarification}
          onResume={() => {
            void client.invalidateQueries({ queryKey: ["run", runId] });
          }}
        />
      )}
      {!active && (
        <Button
          variant="outline"
          disabled={busy || trip.lifecycleState !== "draft"}
          onClick={() => void submit("initial_estimate")}
        >
          {trip.snapshot.components.length ? "Research route options" : "Research estimate"}
        </Button>
      )}
      <form
        className="assistant-chat__composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          Ask your travel assistant
          <textarea
            placeholder="Could we spend more time in Kyoto?"
            required
            maxLength={12000}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <Button
          type="submit"
          disabled={busy || active || !message.trim() || trip.lifecycleState !== "draft"}
        >
          Send message
        </Button>
      </form>
    </section>
  );
}
