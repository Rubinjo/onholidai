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
import { DayPlan } from "./day-plan";
import { ComponentDetails } from "./component-details";
import { FinalizationReview } from "./finalization-review";
function WorkspacePanes({ initialTrip, initialRunId }: { initialTrip: TripEnvelope; initialRunId: string | null }) {
  const query = useTrip(initialTrip), trip = query.data;
  useTripEvents(initialTrip.tripId);
  return <main className="planning-page planning-workspace"><h1>Your living trip</h1>{query.error && <p role="alert">Trip refresh unavailable. Showing saved version {trip.version}. <button type="button" onClick={() => void query.refetch()}>Retry trip refresh</button></p>}
    {/* The price bar stays last in the DOM for the documented focus order and is
        placed in the middle column by the grid, which owns price and booking. */}
    <div className="trip-workspace">
      <div className="trip-workspace__pane trip-workspace__pane--details"><TripEditor trip={trip} onCommit={query.accept} /><DayPlan days={trip.snapshot.itineraryDays} version={trip.version} /><ComponentDetails components={trip.snapshot.components} version={trip.version} /><FinalizationReview trip={trip} onCommit={query.accept} /><VersionHistory trip={trip} onCommit={query.accept} /></div>
      <div className="trip-workspace__pane trip-workspace__pane--route"><ItineraryList trip={trip} /><ItineraryMap trip={trip} fill /></div>
      <div className="trip-workspace__pane trip-workspace__pane--conversation"><Conversation trip={trip} initialRunId={initialRunId} onCommit={query.accept} /></div>
      <PriceBar trip={trip} />
    </div></main>;
}
export function Workspace(props: { initialTrip: TripEnvelope; initialRunId: string | null }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } }));
  return <QueryClientProvider client={client}><WorkspacePanes {...props} /></QueryClientProvider>;
}
