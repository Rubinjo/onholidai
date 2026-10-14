"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { changeProposalSchema } from "@/domain/trip/proposal";
import { planningJson, planningError } from "@/components/trip-setup/http";
import { tripEnvelopeSchema, type TripEnvelope } from "@/components/trip-workspace/use-trip";
import { ProposalCard } from "./proposal-card";
import { Clarification } from "./clarification";
const runSchema = z.object({ id: z.uuid(), status: z.string(), result: z.object({ kind: z.string(), message: z.string().optional(), proposal: changeProposalSchema.optional(), clarification: z.object({ id: z.uuid(), question: z.string() }).passthrough().optional() }).passthrough().nullable().optional() }).passthrough();
const messagesSchema = z.object({ items: z.array(z.object({ messages: z.array(z.object({ id: z.uuid(), role: z.string(), content: z.string(), tripVersion: z.number().nullable() }).passthrough()) }).passthrough()) }).passthrough();
export function Conversation({ trip, initialRunId, onCommit }: { trip: TripEnvelope; initialRunId: string | null; onCommit: (raw: unknown) => void }) {
  const client = useQueryClient(), [runId, setRunId] = useState(initialRunId), [message, setMessage] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [dismissed, setDismissed] = useState<string | null>(null);
  const history = useQuery({ queryKey: ["conversation", trip.tripId], queryFn: async () => messagesSchema.parse(await planningJson(`/api/v1/trips/${trip.tripId}/conversations`)), refetchInterval: 2000 });
  const run = useQuery({ queryKey: ["run", runId], enabled: Boolean(runId), queryFn: async () => runSchema.parse(await planningJson(`/api/v1/agent-runs/${runId}`)), refetchInterval: (query) => ["queued", "running"].includes(query.state.data?.status ?? "queued") ? 1000 : false });
  async function submit(purpose?: "finalization") {
    setError(""); setBusy(true);
    try {
      // Another actor may have committed since this pane cached the trip, and a run must
      // reserve against the current version. Fall back to the cached envelope if the read fails.
      const latest = await planningJson(`/api/v1/trips/${trip.tripId}`)
        .then((raw) => tripEnvelopeSchema.parse(raw)).catch(() => trip);
      const value = runSchema.parse(await planningJson(`/api/v1/trips/${trip.tripId}/agent-runs`, { requestId: crypto.randomUUID(), baseTripVersion: latest.version, conversationId: null, purpose: purpose ?? (latest.snapshot.components.length ? "refinement" : "initial_estimate"), message: purpose === "finalization" ? "Prepare detailed itinerary" : message }));
      setRunId(value.id); setMessage(""); setDismissed(null); void history.refetch();
    } catch (failure) { setError(planningError(failure)); } finally { setBusy(false); }
  }
  const result = run.data?.result, active = ["queued", "running"].includes(run.data?.status ?? "");
  return <section aria-labelledby="conversation-heading" data-trip-version={trip.version}><h2 id="conversation-heading">Agent conversation</h2><p>Current trip version {trip.version}.</p>
    <ol>{history.data?.items.flatMap((entry) => entry.messages).map((entry) => <li key={entry.id}>{entry.role}: {entry.content} (version {entry.tripVersion})</li>)}</ol>
    <p role="status" aria-live="polite">{run.data?.status ?? "Ready"}</p><p role="alert">{error || (run.error ? "Progress unavailable; retry status. The saved trip is preserved." : "")}</p>
    <button type="button" onClick={() => { void run.refetch(); void history.refetch(); }}>Refresh conversation and progress</button>
    {result?.proposal && ["proposed", "stale"].includes(result.proposal.status) && dismissed !== result.proposal.id && <ProposalCard key={result.proposal.id} proposal={result.proposal} tripId={trip.tripId} version={trip.version} onCommit={onCommit} onDismiss={() => { setDismissed(result.proposal!.id); void history.refetch(); }} />}
    {result?.proposal?.status === "applied" && <p>This proposal was accepted. Its committed version is recorded in history.</p>}
    {result?.proposal?.status === "rejected" && <p>This proposal was rejected; it did not change the trip.</p>}
    {result?.clarification && runId && run.data?.status === "awaiting_clarification" && <Clarification key={result.clarification.id} runId={runId} question={result.clarification} onResume={() => { void client.invalidateQueries({ queryKey: ["run", runId] }); }} />}
    {result?.kind === "answer" && <p>{result.message}</p>}
    <button type="button" disabled={busy || active || trip.lifecycleState !== "draft"} onClick={() => void submit("finalization")}>Prepare detailed itinerary</button>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}><label>Discuss a trip change<textarea required maxLength={12000} value={message} onChange={(event) => setMessage(event.target.value)} /></label><button type="submit" disabled={busy || active || !message.trim() || trip.lifecycleState !== "draft"}>Request a proposal</button></form>
  </section>;
}
