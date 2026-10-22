export function ItineraryExample({
  title,
  places,
  description,
}: {
  title: string;
  places: readonly string[];
  description: string;
}) {
  return (
    <figure className="itinerary-example">
      <figcaption>
        <span>Illustrative route</span>
        <h2>{title}</h2>
      </figcaption>
      <ol>
        {places.map((place) => (
          <li key={place}>
            <span aria-hidden="true">●</span>
            <strong>{place}</strong>
          </li>
        ))}
      </ol>
      <p>{description}</p>
      <small>An example of a planning route, not live inventory or a booked itinerary.</small>
    </figure>
  );
}
