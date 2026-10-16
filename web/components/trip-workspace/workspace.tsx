"use client";
import { useState } from "react";
import Link from "next/link";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type TripEnvelope, useTrip } from "./use-trip";
import { useTripEvents } from "./use-trip-events";
import { TripEditor } from "./trip-editor";
import { ItineraryList } from "./itinerary-list";
import { ItineraryMap } from "@/components/map/itinerary-map";
import { Conversation } from "@/components/agent/conversation";
import { PriceBar } from "./price-bar";
import { DayPlan } from "./day-plan";
import { ComponentDetails } from "./component-details";
import { planningError, PlanningRequestError } from "@/components/trip-setup/http";
import { Destinations } from "@/components/trip-setup/destinations";
import { canonicalJson } from "@/domain/canonical-json";
import { tripEnvelopeSchema } from "./use-trip";
type WorkspaceProps = { initialTrip: TripEnvelope; initialRunId: string | null; initialResearchRequestId?: string; authenticated?: boolean };
function WorkspacePanes({ initialTrip, initialRunId, initialResearchRequestId, authenticated = false }: WorkspaceProps) {
  const query = useTrip(initialTrip), trip = query.data;
  const [editor, setEditor] = useState({ base: initialTrip, snapshot: initialTrip.snapshot }), [editingRoute, setEditingRoute] = useState(false);
  // Refresh clean controls with accepted facts, but keep a dirty draft tied to the
  // version it was edited against. Never silently rebase unsaved traveller input.
  if (editor.base.version !== trip.version && canonicalJson(editor.snapshot) === canonicalJson(editor.base.snapshot)) {
    setEditor({ base: trip, snapshot: trip.snapshot });
  }
  const editorDraft = editor.snapshot;
  const setEditorDraft = (snapshot: TripEnvelope["snapshot"]) => setEditor((previous) => ({
    base: canonicalJson(snapshot) === canonicalJson(trip.snapshot) ? trip : previous.base, snapshot,
  }));
  useTripEvents(initialTrip.tripId);
  if (query.error instanceof PlanningRequestError && [401, 403, 404].includes(query.error.status)) return <main className="planning-page"><h1>Private plan unavailable</h1>
    <p role="alert">{planningError(query.error)}</p><Link href="/sign-in">Sign in to your account</Link><p><Link href="/trips/new">Start a new plan</Link></p></main>;
  return <main className="planning-page planning-workspace"><h1>Your living trip</h1>{query.error && <p role="alert">{planningError(query.error)} Showing saved version {trip.version}. <button type="button" onClick={() => void query.refetch()}>Retry trip refresh</button></p>}
    {/* The price bar stays last in the DOM for the documented focus order and is
        placed in the middle column by the grid, which owns price and booking. */}
    <div className="trip-workspace">
      <div className="trip-workspace__pane trip-workspace__pane--details"><TripEditor key={editor.base.version} trip={trip} onCommit={(raw) => { const accepted = tripEnvelopeSchema.parse(raw); query.accept(accepted); setEditor({ base: accepted, snapshot: accepted.snapshot }); setEditingRoute(false); }} draftState={{ snapshot: editorDraft, update: setEditorDraft }} onEditRoute={() => setEditingRoute(true)} /><details><summary>Daily plans and activities</summary><DayPlan days={trip.snapshot.itineraryDays} version={trip.version} /><ComponentDetails components={trip.snapshot.components} version={trip.version} /></details></div>
      <div className="trip-workspace__pane trip-workspace__pane--route">{editingRoute ? <div className="workspace-route-editor"><p role="status">Editing your route. Review edit impacts in Trip details to save these changes.</p><button type="button" onClick={() => setEditingRoute(false)}>Show accepted route</button>
        <Destinations mode="destinations" globe origin={editorDraft.departureOrigin} destinations={editorDraft.destinations} onOrigin={() => {}}
          order={editorDraft.destinationOrder ?? "manual"} onOrder={(destinationOrder) => setEditorDraft({ ...editorDraft, destinationOrder })}
          onDestinations={(destinations) => setEditorDraft({ ...editorDraft, destinations: destinations.map((entry) => ({ ...entry, arrivalDate: null, departureDate: null, plannedNights: 0 })) })} />
      </div> : <ItineraryMap trip={trip} fill />}<details className="route-details"><summary>Route, stays and transport details</summary><ItineraryList trip={trip} /></details></div>
      <div className="trip-workspace__pane trip-workspace__pane--conversation"><Conversation trip={trip} initialRunId={initialRunId} initialResearchRequestId={initialResearchRequestId} onCommit={query.accept} /></div>
      <PriceBar trip={trip} authenticated={authenticated} />
    </div></main>;
}
export function Workspace(props: WorkspaceProps) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } }));
  return <QueryClientProvider client={client}><WorkspacePanes {...props} /></QueryClientProvider>;
}
