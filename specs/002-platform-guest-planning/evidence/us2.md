# US2 evidence — verified end to end

Independent test executed: a seeded accepted estimate refines through the conversation,
survives a competing direct edit reported as stale, accepts exactly once, records version
history and undo, and keeps its route list when the map fails.

| Check                                       | Command / file                                                                                   | Result |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------ |
| Owner-access matrix                         | `web/tests/contract/guest-planning-api.test.ts`                                                  | passed |
| Seeded refinement/replay/quota              | `web/tests/integration/guest-planning.test.ts`                                                   | passed |
| Browser journey                             | `web/tests/e2e/refinement.spec.ts` (chromium, dedicated seeded trips)                            | passed |
| Refinement/finalization/pricing regressions | `web/tests/integration/refinement.test.ts`, `finalization.test.ts`, `pricing-disclosure.test.ts` | passed |
| Replay/clock retention                      | `web/tests/integration/retention.test.ts`                                                        | passed |

Fixed while running this story: `GET /api/v1/trips/{id}/conversations` returned 500 because
retention opened a nested transaction inside the new request transaction, and every
agent→web callback returned 401 because `verifyServiceToken` rejected an empty
`requiredScopes` list — which is why no research run ever completed before this pass.

Two browser journeys are fixture-mutating, so each runs against its own freshly seeded trip
(`US2_TRIP_ID`, `US2_REFINEMENT_TRIP_ID`) on a single project.
