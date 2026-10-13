"use client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type TripEnvelope, useTrip } from "./use-trip";
import { useTripEvents } from "./use-trip-events";
import { TripEditor } from "./trip-editor";
import { ItineraryList } from "./itinerary-list";
import { ItineraryMap } from "@/components/map/itinerary-map";
import { Conversation } from "@/components/agent/conversation";
import { VersionHistory } from "./version-history";
import { PriceBar } from "./price-bar";
function WorkspacePanes({ initialTrip, initialRunId }: { initialTrip: TripEnvelope; initialRunId: string | null }) {
  const query = useTrip(initialTrip), trip = query.data;
  useTripEvents(initialTrip.tripId);
  return <><h1>Your living trip</h1>{query.error && <p role="alert">Trip refresh unavailable. Showing saved version {trip.version}. <button type="button" onClick={() => void query.refetch()}>Retry trip refresh</button></p>}
    <div className="trip-workspace"><TripEditor trip={trip} onCommit={query.accept} /><div><ItineraryList trip={trip} /><ItineraryMap trip={trip} /><VersionHistory trip={trip} onCommit={query.accept} /></div><Conversation trip={trip} initialRunId={initialRunId} onCommit={query.accept} /></div><PriceBar trip={trip} /></>;
}
export function Workspace(props: { initialTrip: TripEnvelope; initialRunId: string | null }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } }));
  return <QueryClientProvider client={client}><WorkspacePanes {...props} /></QueryClientProvider>;
}
