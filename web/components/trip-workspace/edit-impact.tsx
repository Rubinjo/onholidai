"use client";
import { z } from "zod";
import { changeProposalSchema } from "@/domain/trip/proposal";
export const editImpactReviewSchema = z.object({ impactFingerprint: z.string(), previewSnapshot: changeProposalSchema.shape.previewSnapshot.unwrap(),
  impacts: z.object({ price: changeProposalSchema.shape.priceImpact.unwrap(), route: z.array(z.string()), dates: z.array(z.string()), transport: z.array(z.string()), stays: z.array(z.string()), activities: z.array(z.string()), availability: z.array(z.string()), constraints: z.array(z.string()), schedule: z.array(z.string()) }).strict(),
  affectedFacts: z.array(z.string()), reviewId: z.uuid(), baseTripVersion: z.number() }).passthrough();
export function EditImpact({ review, version, busy, onAccept, onDiscard }: { review: z.infer<typeof editImpactReviewSchema>; version: number; busy: boolean; onAccept: () => void; onDiscard: () => void }) {
  return <section aria-label="Edit impacts"><h3>Review changes</h3><p>Affected: {review.affectedFacts.join(", ")}</p>
    <p>Estimated price change: {review.impacts.price.deltaMinor} minor units {review.impacts.price.currency}. Before: {review.impacts.price.beforeMinor}; after: {review.impacts.price.afterMinor}.</p>
    {(["route", "dates", "transport", "stays", "activities", "availability", "constraints", "schedule"] as const).map((key) => <div key={key}><h4>{key[0].toUpperCase() + key.slice(1)}</h4><ul>{review.impacts[key].map((entry, index) => <li key={index}>{entry}</li>)}</ul></div>)}
    <button type="button" disabled={busy || review.baseTripVersion !== version} onClick={onAccept}>Accept reviewed edit</button><button type="button" disabled={busy} onClick={onDiscard}>Discard edit</button>
    {review.baseTripVersion !== version && <p role="alert">The trip changed. Review these edits again.</p>}
  </section>;
}
