"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { customerSnapshotSchema } from "@/domain/trip/proposal";
import { planningJson } from "@/components/trip-setup/http";
export const tripEnvelopeSchema = z.object({ tripId: z.uuid(), version: z.number().int().positive(), snapshot: customerSnapshotSchema, lifecycleState: z.string(), updatedAt: z.string() }).strict();
export type TripEnvelope = z.infer<typeof tripEnvelopeSchema>;
export const tripKey = (tripId: string) => ["trip", tripId] as const;
export function useTrip(initial: TripEnvelope) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: tripKey(initial.tripId), initialData: initial, refetchInterval: 1000,
    queryFn: async () => {
      const latest = tripEnvelopeSchema.parse(await planningJson(`/api/v1/trips/${initial.tripId}`));
      const cached = client.getQueryData<TripEnvelope>(tripKey(initial.tripId));
      return cached && cached.version > latest.version ? cached : latest;
    } });
  function accept(raw: unknown) {
    const next = tripEnvelopeSchema.parse(raw), current = client.getQueryData<TripEnvelope>(tripKey(initial.tripId));
    if (next.tripId !== initial.tripId) throw new Error("Trip response mismatch");
    if (!current || next.version >= current.version) client.setQueryData(tripKey(initial.tripId), next);
    void client.invalidateQueries({ queryKey: ["history", initial.tripId] });
    void client.invalidateQueries({ queryKey: ["conversation", initial.tripId] });
  }
  return { ...query, accept };
}
