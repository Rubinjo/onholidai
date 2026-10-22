function TransportIcon({ mode }: { mode: "flight" | "train" | "car" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {mode === "flight" && <path d="m21 3-7 18-3-8-8-3L21 3ZM11 13l5-5" />}
      {mode === "train" && (
        <>
          <rect x="5" y="3" width="14" height="15" rx="4" />
          <path d="M5 10h14M12 3v7M8 21l2-3m6 3-2-3M8 14h1m6 0h1" />
        </>
      )}
      {mode === "car" && (
        <>
          <path d="m5 9 2-5h10l2 5M5 9h14l2 4v5H3v-5l2-4ZM6 18v3m12-3v3M6 13h2m8 0h2" />
        </>
      )}
    </svg>
  );
}

export function JourneyRange() {
  return (
    <section className="journey-range" aria-labelledby="journey-range-heading">
      <div className="journey-range__intro">
        <h2 id="journey-range-heading">
          A few cities. A new country.
          <br />
          Still one holiday.
        </h2>
        <p>
          Stay a little longer in one place, then see what lies beyond the border. OnHolidai brings
          multi-city and multi-country trips into one plan you can shape along the way.
        </p>
      </div>
      <div className="journey-range__panel">
        <figure className="route-panorama">
          <div className="route-panorama__summary">
            <span>One connected journey</span>
            <span>3 cities / 2 countries</span>
          </div>
          <svg
            className="route-panorama__art"
            viewBox="0 0 720 300"
            role="img"
            aria-labelledby="route-panorama-title route-panorama-desc"
          >
            <title id="route-panorama-title">From Lisbon to Porto to Barcelona by air</title>
            <desc id="route-panorama-desc">
              An illustrative multi-city route connects an ornate waterfront tower in Lisbon, an
              arched iron bridge and riverside houses in Porto, and the Sagrada Familia in
              Barcelona. Solid green flight paths connect the three cities across Portugal and
              Spain.
            </desc>
            <defs>
              <pattern id="route-water" width="28" height="14" patternUnits="userSpaceOnUse">
                <path d="M2 7h12" stroke="#b3cbbd" strokeWidth="1" strokeLinecap="round" />
              </pattern>
            </defs>
            <circle cx="595" cy="83" r="45" fill="#dbe9e1" />
            <path
              d="M0 233c54-40 100-35 149-11s85 11 127-12 78-22 122 5 83 26 130 1 111-19 192 15v69H0Z"
              fill="#dbe9e1"
            />
            <path
              d="M0 268c89-15 116 5 183 0s100-28 167-14 121 20 190 5 117-4 180 5v36H0Z"
              fill="url(#route-water)"
            />
            <g stroke="#708078" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <g>
                <path d="M43 230v-29h25v-19h17v48m73 0v-42h23v14h17v28" fill="#dbe9e1" />
                <path d="m39 201 16-12 17 12m82-13 15-11 16 11" fill="#b3cbbd" />
                <path d="M77 230v-44h80v44Z" fill="#f7f8f6" />
                <path d="M91 186v-60h51v60Z" fill="#f7f8f6" />
                <path d="M132 126h10v60h-10Z" fill="#dbe9e1" stroke="none" />
                <path
                  d="M86 127v-9h9v5h9v-5h9v5h9v-5h9v5h9v-5h7v9ZM73 187v-8h10v4h10v-4h10v4h10v-4h10v4h10v-4h10v4h10v-4h8v8Z"
                  fill="#eaf0ec"
                />
                <path
                  d="M86 118v-10l6-8 6 8v10m35 0v-10l6-8 6 8v10M92 100v-5m47 5v-5"
                  fill="#f7f8f6"
                />
                <path d="M96 174v-10h39v10l-6 5h-27Z" fill="#dbe9e1" />
                <path
                  d="M100 164v-9h31v9m-25-9v-7a9 9 0 0 1 18 0v7m-9-16v16m-15 14h31m-24-5v10m16-10v10"
                  fill="none"
                />
                <path d="M101 142v-8h6v8m17 0v-8h6v8" fill="#b3cbbd" />
                <path
                  d="M86 230v-19a6 6 0 0 1 12 0v19m12 0v-19a6 6 0 0 1 12 0v19m12 0v-19a6 6 0 0 1 12 0v19"
                  fill="#b3cbbd"
                />
                <path
                  d="M80 197h74M99 190v7m17-7v7m17-7v7M71 231h92m-95 5h98M49 211h5m7 0h4m101-10h5m-5 10h5m12 1h5"
                  fill="none"
                />
              </g>
              <g>
                <path
                  d="M277 218v-42h20v42m-13-42v-16h17v58m7 0v-29h20v29m82 0v-48h22v48m3 0v-36h20v36"
                  fill="#f7f8f6"
                />
                <path
                  d="m274 176 13-10 13 10m-19-16 12-11 12 11m1 29 12-10 13 10m76-19 14-11 14 11m-2 12 13-10 13 10"
                  fill="#b3cbbd"
                />
                <path
                  d="M283 185h5m-5 10h5m-5 10h5m3-36h4m-4 10h4m19 20h5m-5 10h5m98-30h6m-6 11h6m-6 11h6m16-10h5m-5 10h5"
                  fill="none"
                />
                <path d="M285 224h150l-3 8H288Z" fill="#b3cbbd" />
                <path
                  d="M291 222c20-69 117-69 138 0M300 222c19-57 101-57 120 0"
                  fill="none"
                  stroke="#12664f"
                  strokeWidth="2"
                />
                <path d="M291 179h138v6H291Zm-5 31h148v6H286Z" fill="#f7f8f6" />
                <path
                  d="m305 179 15 6 15-6 15 6 15-6 15 6 15-6 15 6 15-6M305 185v25m14-25v25m14-25v25m14-25v25m14-25v25m14-25v25m14-25v25m14-25v25m14-25v25"
                  fill="none"
                />
                <path
                  d="m308 209 11-15 14 15 14-23 14 23 14-23 14 23 14-15 11 15M296 216v12m129-12v12M285 176h150"
                  fill="none"
                />
                <path d="M329 241h20m13 3h24m-8-8h20" fill="none" stroke="#b3cbbd" />
              </g>
              <g>
                <path d="M530 231v-35l13-13 13 13v35m70 0v-35l13-13 13 13v35" fill="#dbe9e1" />
                <path d="M549 231v-55h84v55Z" fill="#f7f8f6" />
                <path
                  d="M550 191v-41l5-24 5 24v41m9-7v-47l6-34 6 34v47m20 0v-47l6-34 6 34v47m9 7v-41l5-24 5 24v41"
                  fill="#f7f8f6"
                />
                <path d="M575 137h6v47h-6Zm32 0h6v47h-6Z" fill="#dbe9e1" stroke="none" />
                <path
                  d="m555 126-3-7 3-4 3 4-3 7m20-23-3-7 3-4 3 4-3 7m32 0-3-7 3-4 3 4-3 7m20 23-3-7 3-4 3 4-3 7"
                  fill="#b3cbbd"
                />
                <path d="M581 185v-32l10-19 10 19v32m-10-51v-14m-4 6h8" fill="#eaf0ec" />
                <path
                  d="m551 151 8-1m-9 12h10m-10 10h10m11-34h8m-9 12h10m-10 12h10m22-24h8m-9 12h10m-10 12h10m11-11 8-1m-9 12h10m-10 10h10"
                  fill="none"
                />
                <path d="m550 195 13-16 14 12 14-21 14 21 14-12 13 16" fill="#eaf0ec" />
                <circle cx="591" cy="188" r="8" fill="#b3cbbd" />
                <path d="M591 180v16m-8-8h16m-14-6 12 12m-12 0 12-12" fill="none" strokeWidth="1" />
                <path
                  d="M555 231v-19q5-14 10 0v19m12 0v-18q14-26 28 0v18m12 0v-19q5-14 10 0v19"
                  fill="#b3cbbd"
                />
                <path
                  d="M581 231v-17q10-18 20 0v17m-10-26v26M546 231h90m-93 5h96m-99-32v10m102-10v10"
                  fill="none"
                />
              </g>
            </g>
            <g fill="none" stroke="#12664f" strokeWidth="2.5" strokeLinecap="round">
              <path d="M123 130C172 35 301 29 357 130M363 130C417 29 548 35 597 130" />
            </g>
            <g fill="#12664f" stroke="#eaf0ec" strokeWidth="2" strokeLinejoin="round">
              <path d="M229 55h10l-5-10h4l10 10h6a3 3 0 0 1 0 6h-6l-10 10h-4l5-10h-10l-3 4h-3l2-7-2-7h3Z" />
              <path d="M469 55h10l-5-10h4l10 10h6a3 3 0 0 1 0 6h-6l-10 10h-4l5-10h-10l-3 4h-3l2-7-2-7h3Z" />
            </g>
            <g fill="#12664f" stroke="#f7f8f6" strokeWidth="4">
              <circle cx="120" cy="245" r="7" />
              <circle cx="360" cy="245" r="7" />
              <circle cx="600" cy="245" r="7" />
            </g>
          </svg>
          <ol className="route-panorama__cities">
            <li>Lisbon</li>
            <li>Porto</li>
            <li>Barcelona</li>
          </ol>
          <div className="route-panorama__countries">
            <span>Portugal</span>
            <span>Spain</span>
          </div>
          <figcaption>Illustrative route. Your destinations, your pace.</figcaption>
        </figure>
        <div className="journey-transport">
          <h3>More ways to get there.</h3>
          <p>Start with flights. More ways to connect your journey are on the horizon.</p>
          <ul aria-label="Transport availability">
            <li className="journey-transport__available">
              <TransportIcon mode="flight" />
              <div>
                <strong>Air travel</strong>
                <span className="journey-transport__status">Supported now</span>
              </div>
              <span className="journey-transport__check" aria-hidden="true">
                ✓
              </span>
            </li>
            <li>
              <TransportIcon mode="train" />
              <div>
                <strong>Train travel</strong>
                <span className="journey-transport__status">Coming soon</span>
              </div>
            </li>
            <li>
              <TransportIcon mode="car" />
              <div>
                <strong>Car rental</strong>
                <span className="journey-transport__status">Coming soon</span>
              </div>
            </li>
          </ul>
          <p className="journey-transport__note">
            Flight planning is available in the demo. No real tickets are issued.
          </p>
        </div>
      </div>
    </section>
  );
}
