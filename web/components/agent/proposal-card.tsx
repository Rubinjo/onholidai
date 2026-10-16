"use client";
import { useEffect, useRef, useState } from "react";
import type { ChangeProposal } from "@/domain/trip/proposal";
import { planningJson, planningError } from "@/components/trip-setup/http";
import { DayPlan } from "@/components/trip-workspace/day-plan";
export function ProposalCard({ proposal, tripId, version, onCommit, onDismiss }: { proposal: ChangeProposal; tripId: string; version: number; onCommit: (raw: unknown) => void; onDismiss: () => void }) {
  const request = useRef(crypto.randomUUID()), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(proposal.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [proposal.expiresAt]);
  async function act(action: "accept" | "reject") {
    setBusy(true); setError("");
    try {
      const result = await planningJson(`/api/v1/trips/${tripId}/proposals/${proposal.id}/${action}`, { requestId: request.current, expectedVersion: proposal.baseTripVersion });
      if (action === "accept") onCommit(result); onDismiss();
    } catch (failure) { setError(planningError(failure)); } finally { setBusy(false); }
  }
  const stale = proposal.baseTripVersion !== version || expired || !["proposed"].includes(proposal.status);
  return <article aria-label="Proposal review"><h3>Review proposed changes</h3><p>{proposal.rationale}</p><p>Affected: {proposal.affectedFacts.join(", ")}</p>
    <p>Proposed version {proposal.baseTripVersion + 1}. Departure and return: {proposal.previewSnapshot?.departureOrigin?.name ?? "Needs review"}.</p>
    {proposal.priceImpact && <p>Estimated total: {proposal.priceImpact.beforeMinor} → {proposal.priceImpact.afterMinor} minor units {proposal.priceImpact.currency}; change {proposal.priceImpact.deltaMinor}.</p>}
    <ol>{proposal.previewSnapshot?.destinations.map((entry) => <li key={entry.id}>{entry.name}: {entry.plannedNights} nights, {entry.arrivalDate} to {entry.departureDate}</li>)}</ol>
    {proposal.purpose === "finalization" && proposal.previewSnapshot && <DayPlan days={proposal.previewSnapshot.itineraryDays} />}
    <h4>Transport, stays and activities</h4><ul>{proposal.previewSnapshot?.components.map((entry) => <li key={entry.id}>{entry.type}: {entry.serviceStart} to {entry.serviceEnd}; {entry.price.status}, {entry.price.finalCustomerMinor} minor units {entry.price.currency}.</li>)}</ul>
    <h4>Availability and requirements</h4><ul>{proposal.previewSnapshot?.availabilityWindows.map((entry) => <li key={entry.id}>{entry.preference}: {entry.startDate} to {entry.endDate}</li>)}{proposal.previewSnapshot?.constraints.filter((entry) => entry.status !== "removed").map((entry) => <li key={entry.id}>{entry.priority}: {entry.statement}; {entry.status}.</li>)}</ul>
    <ul>{proposal.tradeoffs?.map((entry, index) => <li key={`tradeoff-${index}`}>{entry}</li>)}{proposal.warnings?.map((entry, index) => <li key={`warning-${index}`}>{entry}</li>)}</ul>
    <p>Expires {proposal.expiresAt}. Nothing has been applied.</p>{stale && <p role="alert">This proposal is stale or unavailable. Request a fresh proposal.</p>}<p role="alert">{error}</p>
    <p role="status">{busy ? "Saving your decision…" : ""}</p>
    <button type="button" disabled={busy || stale} onClick={() => void act("accept")}>Accept proposal</button><button type="button" disabled={busy || proposal.status !== "proposed"} onClick={() => void act("reject")}>Reject proposal</button>
  </article>;
}
