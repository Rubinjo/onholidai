# US1 evidence — verified end to end

Independent test executed: a fresh signed-out context selects a country and two cities,
reorders, replaces and removes destinations, completes a valid confirmed-origin setup,
requests research, reviews and accepts the estimate, and reloads the same accepted trip.

| Check                          | Command / file                                                             | Result |
| ------------------------------ | -------------------------------------------------------------------------- | ------ |
| Contract cases                 | `web/tests/contract/guest-setup-api.test.ts`                               | passed |
| Draft revision/submit          | `web/tests/integration/setup-drafts.test.ts`                               | passed |
| Browser journey                | `web/tests/e2e/guest-setup.spec.ts` (4 journeys × 5 projects)              | passed |
| Estimate regression            | `web/tests/integration/estimate.test.ts`, `web/tests/e2e/estimate.spec.ts` | passed |
| Booking denial + accessibility | `web/tests/e2e/estimate-outages.spec.ts`, `setup-accessibility.spec.ts`    | passed |

Fixed while running this story: guest bootstrap returned 500 for every caller (ambiguous
`session_count` in the upsert), and the draft hook compared payloads with `JSON.stringify`
so autosave looped and reloads lost saved destinations. Both now pass.

Checkpoint met except for the participant-measured outcomes: SC-002/003/004 evidence is
automated; SC-001/007/010 need the cohort.
