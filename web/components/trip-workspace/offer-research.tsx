"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { planningError, planningJson } from "@/components/trip-setup/http";
import { publicPlanningOfferSchema, type PublicPlanningOffer } from "@/server/supply/offers";
import type { TripEnvelope } from "./use-trip";

const outcomeSchema = z.object({ provider: z.string().nullable().optional(), componentType: z.string(),
  status: z.string(), safeReason: z.string().max(500) });
const resultsSchema = z.object({ offers: z.array(publicPlanningOfferSchema).max(32),
  outcomes: z.array(outcomeSchema).max(16).default([]), tripVersion: z.number().int().positive() });
const runSchema = z.object({ id: z.uuid(), status: z.string() });
const detailSchema = z.object({ outcome: z.string(), offer: publicPlanningOfferSchema.optional(),
  differences: z.array(z.string()).max(32).optional() });
function customerAmount(minorUnits: number | null, currency: string) {
  if (minorUnits === null) return "Unknown";
  const format = new Intl.NumberFormat("en", { style: "currency", currency });
  const digits = format.resolvedOptions().maximumFractionDigits;
  if (digits === undefined) throw new Error("Currency minor-unit precision is unavailable");
  return format.format(minorUnits / 10 ** digits);
}

export function OfferResearch({ trip }: { trip: TripEnvelope }) {
  return <ResearchPanel key={`${trip.tripId}:${trip.version}`} trip={trip} />;
}
function ResearchPanel({ trip }: { trip: TripEnvelope }) {
  const [offers, setOffers] = useState<PublicPlanningOffer[]>([]);
  const [outcomes, setOutcomes] = useState<z.infer<typeof outcomeSchema>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Research is separate from your saved trip. Nothing here reserves inventory.");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<PublicPlanningOffer | null>(null);
  const controller = useRef<AbortController | null>(null);
  const base = `/api/v1/trips/${trip.tripId}`;
  const version = `version=${trip.version}`;

  async function load(signal: AbortSignal) {
    const result = resultsSchema.parse(await planningJson(`${base}/planning-offers?${version}`, undefined, undefined, signal));
    if (!signal.aborted && result.tripVersion === trip.version) { setOffers(result.offers); setOutcomes(result.outcomes); }
  }
  useEffect(() => {
    const initial = new AbortController();
    controller.current = initial;
    void planningJson(`${base}/planning-offers?${version}`, undefined, undefined, initial.signal)
      .then((raw) => {
        const result = resultsSchema.parse(raw);
        if (!initial.signal.aborted && result.tripVersion === trip.version) {
          setOffers(result.offers); setOutcomes(result.outcomes);
        }
      }).catch((failure: unknown) => { if (!initial.signal.aborted) setError(planningError(failure)); });
    return () => { initial.abort(); controller.current?.abort(); };
    // The keyed panel is replaced for every trip/version; unsaved editor state is not touched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setError(null); setActive(null); setBusy(true); setStatus("Finding current supplier options. Your saved trip is unchanged.");
    try {
      const dates = trip.snapshot.destinations.flatMap((place) => place.arrivalDate && place.departureDate ? [place.arrivalDate, place.departureDate] : []).sort();
      const window = trip.snapshot.availabilityWindows[0];
      const message = JSON.stringify({ componentTypes: ["flight", "accommodation", "activity", "rail"],
        destinationIds: trip.snapshot.destinations.map((place) => place.id), startDate: dates[0] ?? window.startDate,
        endDate: dates.at(-1) ?? window.endDate });
      let run = runSchema.parse(await planningJson(`${base}/agent-runs`, { requestId: crypto.randomUUID(),
        baseTripVersion: trip.version, purpose: "supplier_research", message }, "POST", current.signal));
      const deadline = Date.now() + 12_000;
      while (["queued", "running"].includes(run.status) && !current.signal.aborted && Date.now() < deadline) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { current.signal.removeEventListener("abort", cancel); resolve(); }, 500);
          const cancel = () => { clearTimeout(timer); reject(new Error("Research cancelled")); };
          current.signal.addEventListener("abort", cancel, { once: true });
        });
        run = runSchema.parse(await planningJson(`/api/v1/agent-runs/${run.id}`, undefined, undefined, current.signal));
      }
      if (current.signal.aborted) return;
      if (run.status !== "completed") throw new Error("Research did not complete within its deadline");
      await load(current.signal);
      if (!current.signal.aborted) setStatus("Options updated. Compare source facts before requesting a trip change; no inventory is held.");
    } catch (failure) { if (!current.signal.aborted) setError(planningError(failure)); }
    finally { if (!current.signal.aborted) setBusy(false); }
  }
  async function inspect(offer: PublicPlanningOffer, revalidate: boolean) {
    if (!offer.offerRef || !offer.revision) return;
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setBusy(true); setError(null);
    try {
      const path = `${base}/planning-offers/${offer.offerRef}`;
      const result = detailSchema.parse(await planningJson(revalidate ? `${path}/revalidations?${version}` : `${path}?${version}&revision=${offer.revision}`,
        revalidate ? { revision: offer.revision } : undefined, revalidate ? "POST" : undefined, current.signal));
      if (current.signal.aborted) return;
      if (result.offer) {
        const updated = result.offer;
        if (updated.offerRef !== offer.offerRef || (updated.revision ?? 0) < (offer.revision ?? 0)) {
          throw new Error("Supplier evidence does not match the selected revision");
        }
        setActive(updated);
        setOffers((previous) => previous.map((item) => item.offerRef === updated.offerRef
          && (item.revision ?? 0) <= (updated.revision ?? 0) ? updated : item));
      }
      setStatus(`Source check: ${result.outcome}. ${result.differences?.join(" ") ?? ""} No reservation was made.`);
    } catch (failure) { if (!current.signal.aborted) setError(planningError(failure)); }
    finally { if (!current.signal.aborted) setBusy(false); }
  }
  return <section className="offer-research" aria-labelledby="supplier-options-heading" data-trip-version={trip.version}>
    <h2 id="supplier-options-heading">Compare supplier options</h2>
    <p>Flights and stays from Duffel; activities from Viator. Train inventory is deferred.</p>
    <button type="button" disabled={busy} onClick={() => void search()}>{busy ? "Checking supplier options" : "Find supplier options"}</button>
    <p role="status" aria-live="polite">{status}</p>
    {error && <p role="alert">{error} <button type="button" disabled={busy} onClick={() => void search()}>Retry research</button></p>}
    {outcomes.length > 0 && <ul aria-label="Supplier search outcomes">{outcomes.map((source, index) =>
      <li key={`${source.provider}:${source.componentType}:${index}`}>{source.provider ? `${source.provider} ` : ""}{source.componentType}: {source.status}. {source.safeReason}</li>)}</ul>}
    {offers.length === 0 && <p>{outcomes.length
      ? "No comparable options were established. Check the source outcomes above; unsupported or failed sources do not establish that inventory is empty."
      : "No options to compare yet. Run a search to check current sources."}</p>}
    <ul className="offer-research__options" aria-label="Supplier options">{offers.map((offer) => <li key={`${offer.offerRef ?? offer.component.id}:${offer.revision ?? 0}`}>
      <h3>{offer.component.type}{offer.selectionGroup ? `: ${offer.selectionGroup}` : ""}</h3>
      <p>{offer.attribution.provider}; {offer.sourceMode === "deterministic" ? "Demonstration only" : offer.sourceMode}. {offer.evidence?.status ?? offer.component.price.status}; revision {offer.revision ?? "unknown"}.</p>
      {offer.component.type === "accommodation" && <p>Property type: {offer.component.planningDetails?.accommodationType ?? "Unknown"}</p>}
      <p>Customer total: {customerAmount(offer.component.price.finalCustomerMinor, offer.component.price.currency)}.
        {" "}Taxes: {customerAmount(offer.component.price.taxesMinor, offer.component.price.currency)};
        {" "}fees: {customerAmount(offer.component.price.feesMinor, offer.component.price.currency)}.</p>
      <p>{offer.component.serviceStart ?? "Start time unknown"} to {offer.component.serviceEnd ?? "End time unknown"}.</p>
      <p>Unverified: {offer.unverifiedFacts.join(", ") || "See source evidence"}. Expires: {offer.component.expiresAt ?? "Unknown"}.</p>
      <button type="button" disabled={busy || !offer.offerRef} onClick={() => void inspect(offer, false)}>Inspect {offer.component.type} details</button>{" "}
      <button type="button" disabled={busy || !offer.offerRef || offer.evidence?.status === "expired"} onClick={() => void inspect(offer, true)}>Recheck {offer.component.type} availability</button>
    </li>)}</ul>
    {active && <section aria-label="Selected supplier evidence"><h3>Source details</h3>
      <p>Location: {active.component.planningDetails?.locationName ?? "Unknown"}.</p>
      {active.component.type === "flight" && <>
        <p>Route: {active.component.details?.legs.join("; ") ?? "Unknown"}.</p>
        <p>Baggage: {active.component.details?.baggage.join("; ") || "Unknown; verify the selected fare"}.</p>
      </>}
      {active.component.type === "accommodation" && <>
        <p>Occupancy: {active.component.details?.occupancy ?? "Unknown"}.</p>
        <p>Amenities: {active.component.details?.amenities.join("; ") || "Unknown"}.</p>
      </>}
      {active.component.type === "activity" && <>
        <p>Duration: {active.component.details?.durationMinutes ?? "Unknown"} minutes.</p>
        <p>Directions: {active.component.details?.directions ?? "Unknown"}.</p>
      </>}
      <p>Source conditions: {active.component.planningDetails?.fareConditions ?? "Unknown"}.</p>
      <p>Terms: {active.component.cancellationTerms ?? "Unknown; not verified for booking"}.</p>
      <p>Eligibility: {active.eligibility.status}; accessibility: {active.accessibility}.</p>
      <p>Checked: {active.evidence?.checkedAt ?? active.component.checkedAt}. Evidence does not reserve inventory.</p>
      <button type="button" onClick={() => setActive(null)}>Close source details</button>
    </section>}
  </section>;
}
