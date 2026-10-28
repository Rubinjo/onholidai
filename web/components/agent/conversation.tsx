"use client";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { changeProposalSchema } from "@/domain/trip/proposal";
import { planningJson, planningError, PlanningRequestError } from "@/components/trip-setup/http";
import { tripEnvelopeSchema, type TripEnvelope } from "@/components/trip-workspace/use-trip";
import { Button } from "@/components/ui/button";

import { ProposalCard } from "./proposal-card";
import { Clarification } from "./clarification";
import { TripCheckpoint, useChatVersions } from "./trip-checkpoints";

const componentLabels: Record<string, string> = {
  flight: "Flight",
  accommodation: "Stay",
  activity: "Activity",
  rail: "Rail",
};
const researchSchema = z
  .object({
    outcomes: z.array(
      z
        .object({
          provider: z.string().nullable(),
          componentType: z.string(),
          status: z.string(),
          mode: z.string(),
          safeReason: z.string(),
          retryable: z.boolean(),
          retryAfterMs: z.number().nullable(),
          unverifiedCount: z.number(),
          reused: z.boolean(),
        })
        .passthrough(),
    ),
    retryableComponentTypes: z.array(z.string()),
    incomplete: z.boolean(),
  })
  .passthrough();
const runSchema = z
  .object({
    id: z.uuid(),
    status: z.string(),
    research: researchSchema.nullable().optional(),
    failure: z
      .object({ category: z.string(), message: z.string() })
      .passthrough()
      .nullable()
      .optional(),
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
}: {
  trip: TripEnvelope;
  initialRunId: string | null;
  initialResearchRequestId?: string;
  onCommit: (raw: unknown) => void;
}) {
  const client = useQueryClient(),
    [runId, setRunId] = useState(initialRunId),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dismissed, setDismissed] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");
  const [retryPending, setRetryPending] = useState(false);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);
  const initialRequest = useRef(initialRunId ? undefined : initialResearchRequestId);
  useEffect(() => {
    if (retryAfterSeconds <= 0) return;
    const timer = setTimeout(() => setRetryAfterSeconds((remaining) => remaining - 1), 1000);
    return () => clearTimeout(timer);
  }, [retryAfterSeconds]);
  const versions = useChatVersions(trip.tripId, trip.version);
  const pendingResearch = useRef<{
    requestId: string;
    baseTripVersion: number;
    purpose: "initial_estimate" | "refinement";
    message: string;
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
    async (purpose?: "initial_estimate", retryScope?: readonly string[]) => {
      setError("");
      setOutcome("");
      setBusy(true);
      try {
        // A new reservation uses current accepted facts; uncertain submissions
        // replay their original request and version until their outcome is known.
        const latest = tripEnvelopeSchema.parse(await planningJson(`/api/v1/trips/${trip.tripId}`));
        if (!pendingResearch.current) {
          const scope = retryScope?.length
            ? ` Retry supplier research for: ${retryScope.join(", ")}.`
            : "";
          pendingResearch.current = {
            requestId: initialRequest.current ?? crypto.randomUUID(),
            baseTripVersion: latest.version,
            purpose:
              purpose ?? (latest.snapshot.components.length ? "refinement" : "initial_estimate"),
            message: (message || "Estimate my reviewed settings and update my draft trip.") + scope,
          };
          initialRequest.current = undefined;
        }
        const sent = pendingResearch.current;
        const value = runSchema.parse(
          await planningJson(`/api/v1/trips/${trip.tripId}/agent-runs`, {
            ...sent,
            applicationPolicy: "automatic",
            conversationId: null,
          }),
        );
        pendingResearch.current = null;
        setRetryPending(false);
        setRunId(value.id);
        setMessage((current) => (current === sent.message ? "" : current));
        setDismissed(null);
        void refreshHistory();
      } catch (failure) {
        // A rejected reservation has no work to replay. Transport/5xx failures
        // can have committed, so retain their exact identity until acknowledged.
        if (
          failure instanceof PlanningRequestError &&
          failure.status >= 400 &&
          failure.status < 500 &&
          failure.status !== 408
        )
          pendingResearch.current = null;
        setRetryPending(Boolean(pendingResearch.current));
        setRetryAfterSeconds(
          failure instanceof PlanningRequestError ? (failure.retryAfterSeconds ?? 0) : 0,
        );
        setError(planningError(failure));
      } finally {
        setBusy(false);
      }
    },
    [trip.tripId, message, refreshHistory],
  );
  const initialStarted = useRef(false);
  useEffect(() => {
    if (
      !initialStarted.current &&
      !initialRunId &&
      trip.lifecycleState === "draft" &&
      (initialResearchRequestId ||
        (trip.version === 1 &&
          !trip.snapshot.components.length &&
          !trip.snapshot.itineraryDays.length))
    ) {
      initialStarted.current = true;
      void submit("initial_estimate");
    }
  }, [
    initialRunId,
    initialResearchRequestId,
    trip.lifecycleState,
    trip.version,
    trip.snapshot.components.length,
    trip.snapshot.itineraryDays.length,
    submit,
  ]);
  const result = run.data?.result,
    active = ["queued", "running"].includes(run.data?.status ?? "");
  const statusPanel =
    run.data?.research?.incomplete && !active && run.data.status !== "failed"
      ? run.data.research.outcomes.filter(
          (entry) =>
            entry.retryable || entry.status === "access_blocked" || entry.status === "no_matches",
        )
      : null;
  const canSend =
    !busy &&
    !active &&
    !retryPending &&
    retryAfterSeconds === 0 &&
    Boolean(message.trim()) &&
    trip.lifecycleState === "draft";
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
        I research and compare options automatically, then update your map and trip plan. I’ll ask
        here when I need your input. Restore an earlier version below. Nothing is booked here.
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
            (retryPending
              ? "The previous request is unconfirmed. Retry it before sending another message; your draft is preserved."
              : run.data?.status === "failed"
                ? (run.data.failure?.message ??
                  "Research interrupted. Retry the update or send a message to continue.")
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
      {!active && (error || run.data?.status === "failed") && (
        <Button
          variant="outline"
          disabled={busy || retryAfterSeconds > 0 || trip.lifecycleState !== "draft"}
          onClick={() => void submit()}
        >
          {retryAfterSeconds > 0
            ? `Retry trip update in ${retryAfterSeconds}s`
            : "Retry trip update"}
        </Button>
      )}
      {!active && statusPanel && (
        <section className="assistant-chat__research" aria-labelledby="research-status-heading">
          <h3 id="research-status-heading">Research status</h3>
          <p>
            Some supplier steps did not return usable current inventory. Nothing was booked and the
            missing facts stay unknown.
          </p>
          <ul aria-label="Supplier research results">
            {statusPanel.map((entry) => (
              <li key={`${entry.componentType}-${entry.provider ?? "none"}-${entry.status}`}>
                <strong>{componentLabels[entry.componentType] ?? entry.componentType}</strong>:{" "}
                {entry.safeReason}{" "}
                <span className="assistant-chat__research-status">({entry.status})</span>
                {entry.reused ? " Reused from earlier research for this trip; not re-priced." : ""}
              </li>
            ))}
          </ul>
          {run.data?.research?.retryableComponentTypes.length ? (
            <Button
              variant="outline"
              disabled={busy || retryAfterSeconds > 0 || trip.lifecycleState !== "draft"}
              onClick={() => void submit(undefined, run.data?.research?.retryableComponentTypes)}
            >
              {retryAfterSeconds > 0
                ? `Retry research in ${retryAfterSeconds}s`
                : `Retry ${run.data.research.retryableComponentTypes.map((type) => componentLabels[type] ?? type).join(" and ")} research`}
            </Button>
          ) : (
            <p>
              Retrying will not change these results until the supplier access or support changes.
            </p>
          )}
        </section>
      )}
      <form
        className="assistant-chat__composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend) void submit();
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
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              if (!event.repeat && canSend) event.currentTarget.form?.requestSubmit();
            }}
          />
        </label>
        <Button type="submit" disabled={!canSend}>
          Send message
        </Button>
      </form>
    </section>
  );
}
