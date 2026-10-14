import type { SetupDraftPayload } from "./draft-schema";
export function SetupSummary({ payload }: { payload: SetupDraftPayload }) {
  return <aside className="setup-summary" aria-label="Trip summary"><details open>
    <summary>Your holiday so far</summary>
    <div><h2>{payload.title || "Your next holiday"}</h2>
      <ol>{payload.destinations.map((destination) => <li key={destination.id}>{destination.name}</li>)}</ol>
      {!payload.destinations.length && <p>Add a country or city to start your route.</p>}
      <dl><dt>Departure</dt><dd>{payload.departureOrigin?.name ?? "Choose your starting point"}</dd>
        <dt>Duration</dt><dd>{payload.duration.idealDays === null ? "Choose your dates" : `${payload.duration.idealDays} days preferred`}</dd>
        <dt>Travellers</dt><dd>{payload.travellerParty.adults ?? "Not set"} adults, {payload.travellerParty.children.length} children</dd>
        <dt>Currency</dt><dd>{payload.currency}</dd></dl>
      <p>Planning and estimates are free to explore without an account. Nothing is booked or paid for during setup.</p>
    </div></details></aside>;
}
