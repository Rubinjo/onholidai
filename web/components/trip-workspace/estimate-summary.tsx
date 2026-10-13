"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { type ChangeProposal, changeProposalSchema, customerSnapshotSchema } from "@/domain/trip/proposal";
import { EstimateMap } from "@/components/map/estimate-map";
import { planningError, planningJson } from "@/components/trip-setup/http";

const tripSchema = z.object({ tripId: z.uuid(), version: z.number().int().positive(), snapshot: customerSnapshotSchema,
  lifecycleState: z.string(), updatedAt: z.string() }).strict();
const runSchema = z.object({ id: z.uuid(), tripId: z.uuid(), status: z.enum(["queued", "running", "awaiting_clarification", "proposed", "completed", "failed", "cancelled"]),
  result: z.object({ kind: z.string(), proposal: changeProposalSchema.optional(), clarification: z.object({ id: z.uuid(), question: z.string() }).passthrough().optional() }).passthrough().nullable().optional() }).passthrough();
type Trip = z.infer<typeof tripSchema>;
export function EstimateSummary({ initialTrip, initialProposal, initialRunId }: {
  initialTrip: Trip; initialProposal: ChangeProposal | null; initialRunId: string | null;
}) {
  const [trip, setTrip] = useState(initialTrip), [proposal, setProposal] = useState(initialProposal);
  const [runId, setRunId] = useState(initialRunId), [status, setStatus] = useState(""), [error, setError] = useState("");
  const [clarification, setClarification] = useState<{ id: string; question: string } | null>(null), [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false), [pollRetry, setPollRetry] = useState(0);
  const acceptanceRequest = useRef<string | null>(null), answerRequest = useRef<string | null>(null);
  useEffect(() => {
    if (!runId) return;
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const run = runSchema.parse(await planningJson(`/api/v1/agent-runs/${runId}`));
        if (run.tripId !== initialTrip.tripId) throw new Error("Run belongs to a different trip");
        if (stopped) return;
        setStatus(run.status);
        if (run.result?.proposal) { setProposal(run.result.proposal); acceptanceRequest.current ??= crypto.randomUUID(); }
        if (run.result?.clarification) setClarification(run.result.clarification);
        if (["queued", "running"].includes(run.status)) timer = setTimeout(() => void poll(), 1000);
      } catch (failure) { if (!stopped) setError(planningError(failure)); }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [runId, pollRetry, initialTrip.tripId]);
  async function accept() {
    if (!proposal) return; setError(""); setBusy(true);
    acceptanceRequest.current ??= crypto.randomUUID();
    try {
      const response = await planningJson(`/api/v1/trips/${trip.tripId}/proposals/${proposal.id}/accept`, {
        requestId: acceptanceRequest.current, expectedVersion: proposal.baseTripVersion });
      const accepted = tripSchema.parse(z.object({ tripId: z.uuid(), version: z.number(), snapshot: customerSnapshotSchema,
        lifecycleState: z.string(), updatedAt: z.string() }).strip().parse(response));
      setTrip(accepted); setProposal({ ...proposal, status: "applied" }); setStatus("accepted"); setRunId(null);
    } catch (failure) { setError(planningError(failure)); } finally { setBusy(false); }
  }
  async function retry() {
    setError(""); setBusy(true);
    try {
      const latest = tripSchema.parse(await planningJson(`/api/v1/trips/${trip.tripId}`)); setTrip(latest);
      const run = runSchema.parse(await planningJson(`/api/v1/trips/${trip.tripId}/agent-runs`, { requestId: crypto.randomUUID(),
        baseTripVersion: latest.version, conversationId: null, purpose: "initial_estimate", message: "Research a new estimate for my current reviewed settings; do not apply it." }));
      setProposal(null); setRunId(run.id); setClarification(null); acceptanceRequest.current = null; setStatus(run.status);
    } catch (failure) { setError(planningError(failure)); } finally { setBusy(false); }
  }
  async function resume() {
    if (!clarification) return; setError(""); setBusy(true); answerRequest.current ??= crypto.randomUUID();
    try {
      await planningJson(`/api/v1/agent-runs/${runId}/clarifications`, { requestId: answerRequest.current, questionId: clarification.id, answer });
      setClarification(null); setAnswer(""); answerRequest.current = null; setPollRetry((value) => value + 1);
    } catch (failure) { setError(planningError(failure)); } finally { setBusy(false); }
  }
  const pending = proposal && proposal.status !== "applied", snapshot = pending ? proposal.previewSnapshot ?? trip.snapshot : trip.snapshot;
  const formatter = new Intl.NumberFormat("en", { style: "currency", currency: snapshot.price.currency });
  const total = formatter.format(snapshot.price.finalCustomerMinor / (10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2)));
  return <section><h1>{pending ? "Proposed estimate" : proposal?.status === "applied" ? "Accepted estimated draft" : "Your saved trip setup"}</h1>
    <p role="status">Research status: {status || "saved"}. Saved version {trip.version}.</p><p role="alert">{error}</p>
    {error && <button type="button" onClick={() => { setError(""); setPollRetry((value) => value + 1); }}>Retry status read</button>}
    {pending && <p>Nothing has been applied yet.</p>}
    <h2>Estimated total: {snapshot.components.length ? total : "not available yet"}</h2><p>Estimated, not live or confirmed. Availability, taxes, fees and terms require revalidation. No reservations or payments.</p>
    <p>Price status: {snapshot.price.status}. Last checked: {snapshot.price.checkedAt ?? "not yet checked"}. Taxes: {snapshot.price.taxesMinor ?? 0}; fees: {snapshot.price.feesMinor ?? 0} minor units {snapshot.price.currency}.</p>
    {proposal?.estimatedCostRange && <p>Illustrative estimated range (90–120% of planning total, not a supplier guarantee): {proposal.estimatedCostRange.minimumMinor}–{proposal.estimatedCostRange.maximumMinor} minor units {proposal.estimatedCostRange.currency}.</p>}
    {snapshot.components.some((component) => component.supplierOfferId.startsWith("synthetic-")) && <p>Deterministic synthetic offers, not live supplier quotes or inventory.</p>}
    <p>Departure and default return: {snapshot.departureOrigin?.name ?? "Origin needs confirmation"}.</p>
    <h2>Route and duration allocation</h2><ol>{snapshot.destinations.map((destination) => <li key={destination.id}>{destination.name}, {destination.countryCode} — {destination.plannedNights} nights; {destination.arrivalDate ?? "not scheduled"} to {destination.departureDate ?? "not scheduled"}</li>)}</ol>
    <EstimateMap destinations={snapshot.destinations} />
    <h2>Transport, stays and activities</h2><ul>{snapshot.components.map((component) => <li key={component.id}>{component.type}: {component.provider} — estimated; {component.serviceStart} to {component.serviceEnd}. {component.type === "flight" ? component.details.legs.join("; ") : component.type === "accommodation" ? component.details.occupancy : component.type === "activity" ? `${component.details.durationMinutes} minutes; ${component.details.directions}` : component.details.route}. Travel times and supplier facts remain unverified.</li>)}</ul>
    <h2>Dates and alternatives</h2><ul>{snapshot.availabilityWindows.map((window) => <li key={window.id}>{window.preference}: {window.startDate}–{window.endDate} ({window.timezone})</li>)}</ul>
    <h2>Rationale, style and requirements</h2><p>{proposal?.rationale ?? "Research the reviewed settings to see a proposal."}</p><p>{proposal?.styleCompatibility}</p>
    <p>Party: {snapshot.travellerParty.adults} adults, {snapshot.travellerParty.children.length} children. Child ages at trip start: {snapshot.travellerParty.children.map((child) => child.ageAtTripStart).join(", ") || "none"}.</p>
    <ul>{snapshot.constraints.filter((constraint) => constraint.status !== "removed").map((constraint) => <li key={constraint.id}>{constraint.priority}: {constraint.statement} — {constraint.status}; supplier verification is still required.</li>)}</ul>
    <ul>{proposal?.constraintSummary?.map((item, index) => <li key={index}>{item}</li>)}</ul><ul>{proposal?.warnings?.map((item, index) => <li key={index}>{item}</li>)}</ul>
    {pending && <><p>Proposal expires: {proposal.expiresAt}. Acceptance creates a new draft version, not a booking.</p>
      {proposal.baseTripVersion !== trip.version && <p role="alert">The saved trip has changed. Research a new estimate before accepting.</p>}
      <button type="button" disabled={busy || proposal.baseTripVersion !== trip.version} onClick={() => void accept()}>Accept this estimated draft</button></>}
    {clarification && <fieldset disabled={busy}><legend>Clarification needed</legend><label>{clarification.question}<textarea value={answer} maxLength={4000} onChange={(event) => setAnswer(event.target.value)} /></label><button type="button" disabled={!answer.trim()} onClick={() => void resume()}>Send clarification</button></fieldset>}
    <button type="button" disabled={busy || ["queued", "running"].includes(status)} onClick={() => void retry()}>Research a new estimate</button>
    <p>Booking is not available in this planning increment.</p>
  </section>;
}
