"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { changeProposalSchema } from "@/domain/trip/proposal";
import { planningJson, planningError } from "@/components/trip-setup/http";
import { tripEnvelopeSchema, type TripEnvelope } from "@/components/trip-workspace/use-trip";
import { ProposalCard } from "./proposal-card";
import { Clarification } from "./clarification";
const runSchema = z.object({ id: z.uuid(), status: z.string(), result: z.object({ kind: z.string(), message: z.string().optional(), proposal: changeProposalSchema.optional(), clarification: z.object({ id: z.uuid(), question: z.string() }).passthrough().optional() }).passthrough().nullable().optional() }).passthrough();
const messagesSchema = z.object({ items: z.array(z.object({ messages: z.array(z.object({ id: z.uuid(), role: z.string(), content: z.string(), tripVersion: z.number().nullable() }).passthrough()) }).passthrough()) }).passthrough();
export function Conversation({ trip, initialRunId, initialResearchRequestId, onCommit }: { trip: TripEnvelope; initialRunId: string | null; initialResearchRequestId?: string; onCommit: (raw: unknown) => void }) {
  const client = useQueryClient(), [runId, setRunId] = useState(initialRunId), [message, setMessage] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [dismissed, setDismissed] = useState<string | null>(null);
  const pendingResearch = useRef<{ requestId: string; baseTripVersion: number; purpose: "initial_estimate" | "refinement" | "finalization"; message: string } | null>(null);
  const history = useQuery({ queryKey: ["conversation", trip.tripId], queryFn: async () => messagesSchema.parse(await planningJson(`/api/v1/trips/${trip.tripId}/conversations`)), refetchInterval: 2000 });
  const run = useQuery({ queryKey: ["run", runId], enabled: Boolean(runId), queryFn: async () => runSchema.parse(await planningJson(`/api/v1/agent-runs/${runId}`)), refetchInterval: (query) => ["queued", "running"].includes(query.state.data?.status ?? "queued") ? 1000 : false });
  const refreshHistory = history.refetch;
  const submit = useCallback(async (purpose?: "initial_estimate" | "finalization") => {
    setError(""); setBusy(true);
    try {
      // A new reservation uses current accepted facts; uncertain submissions
      // replay their original request and version until their outcome is known.
      const latest = tripEnvelopeSchema.parse(await planningJson(`/api/v1/trips/${trip.tripId}`));
      pendingResearch.current ??= { requestId: !runId && initialResearchRequestId ? initialResearchRequestId : crypto.randomUUID(), baseTripVersion: latest.version,
        purpose: purpose ?? (latest.snapshot.components.length ? "refinement" : "initial_estimate"), message: purpose === "finalization" ? "Prepare detailed itinerary" : message || "Estimate my reviewed settings. Do not apply anything until I explicitly accept." };
      const sent = pendingResearch.current;
      const value = runSchema.parse(await planningJson(`/api/v1/trips/${trip.tripId}/agent-runs`, { ...sent, conversationId: null }));
      pendingResearch.current = null;
      setRunId(value.id); setMessage((current) => current === sent.message ? "" : current); setDismissed(null); void refreshHistory();
    } catch (failure) { setError(planningError(failure)); } finally { setBusy(false); }
  }, [trip.tripId, runId, initialResearchRequestId, message, refreshHistory]);
  const initialStarted = useRef(false);
  useEffect(() => {
    if (!initialStarted.current && !initialRunId && initialResearchRequestId) { initialStarted.current = true; void submit(); }
  }, [initialRunId, initialResearchRequestId, submit]);
  const result = run.data?.result, active = ["queued", "running"].includes(run.data?.status ?? "");
  return <section className="assistant-chat" aria-labelledby="conversation-heading" data-trip-version={trip.version}><h2 id="conversation-heading">Your travel assistant</h2><p>Ask a question, explore an option, or tell us what you’d change.</p>
    <ol className="assistant-chat__messages" aria-label="Conversation">{history.data?.items.flatMap((entry) => entry.messages).map((entry) => <li className={`assistant-chat__message assistant-chat__message--${entry.role}`} key={entry.id}><strong>{entry.role === "user" ? "You" : "OnHolidai"}</strong><p>{entry.content}</p></li>)}</ol>
    <p role="status" aria-live="polite">{busy ? "Sending your request…" : run.data?.status === "failed" ? "Research interrupted. Request a fresh proposal on this saved trip." : run.data?.status ?? "Ready"}</p><p role="alert">{error || (run.error ? planningError(run.error) : history.error ? planningError(history.error) : "")}</p>
    <button type="button" onClick={() => { void run.refetch(); void history.refetch(); }}>Refresh conversation and progress</button>
    {result?.proposal && ["proposed", "stale"].includes(result.proposal.status) && dismissed !== result.proposal.id && <ProposalCard key={result.proposal.id} proposal={result.proposal} tripId={trip.tripId} version={trip.version} onCommit={onCommit} onDismiss={() => { setDismissed(result.proposal!.id); void history.refetch(); void run.refetch(); }} />}
    {result?.proposal?.status === "applied" && <p>This proposal was accepted. Its committed version is recorded in history.</p>}
    {result?.proposal?.status === "rejected" && <p>This proposal was rejected; it did not change the trip.</p>}
    {result?.clarification && runId && run.data?.status === "awaiting_clarification" && <Clarification key={result.clarification.id} runId={runId} question={result.clarification} onResume={() => { void client.invalidateQueries({ queryKey: ["run", runId] }); }} />}
    {result?.kind === "answer" && <p>{result.message}</p>}
    <button type="button" disabled={busy || active || trip.lifecycleState !== "draft"} onClick={() => void submit("finalization")}>Prepare detailed itinerary</button>
    {!active && <button type="button" disabled={busy || trip.lifecycleState !== "draft"} onClick={() => void submit("initial_estimate")}>{trip.snapshot.components.length ? "Research route options" : "Research estimate"}</button>}
    <form className="assistant-chat__composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}><label>Ask your travel assistant<textarea placeholder="Could we spend more time in Kyoto?" required maxLength={12000} value={message} onChange={(event) => setMessage(event.target.value)} /></label><button type="submit" disabled={busy || active || !message.trim() || trip.lifecycleState !== "draft"}>Send message</button></form>
  </section>;
}
