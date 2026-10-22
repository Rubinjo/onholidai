# US5 evidence — automated checks pass, manual review open

| Check                            | Command / file                                                                        | Result |
| -------------------------------- | ------------------------------------------------------------------------------------- | ------ |
| Responsive/state/focus/motion    | `web/tests/e2e/platform-ux.spec.ts` (320/390/768/1440 px, reduced motion, 5 projects) | passed |
| Workspace under failure          | `web/tests/e2e/accessibility.spec.ts` (390 and 195 px, maps aborted)                  | passed |
| Step labelling and focus         | `web/tests/e2e/setup-accessibility.spec.ts`                                           | passed |
| Two-second pane convergence      | `web/tests/integration/workspace-propagation.test.tsx`                                | passed |
| Builder status/conflict handling | `web/tests/integration/setup-drafts.test.ts`                                          | passed |

No horizontal overflow was found at any asserted width once the editor fieldset's
user-agent min-content floor was fixed. Focus order is asserted across routes, including the
skip link reaching `#main-content`, and reduced motion renders `scroll-behavior: auto`.

SC-010 input acknowledgement was **not** measured with a stopwatch: the journeys assert that
controls respond without waiting for animation, but the <=1-second deterministic
acknowledgement measurement and the participant ratings remain (T080/T084).

## Phase 9 instrumented acknowledgement — 2026-10-16

The paragraph above describes the earlier baseline, not the redesigned controls.
`platform-ux.spec.ts`, `guest-planning.spec.ts` and `planning-controls.spec.ts` now use
browser `performance.now()` around the input and its visible acknowledgement. The
measurement includes Playwright actionability/scrolling and assertion overhead, with
no artificial animation wait. Setup uses deterministic HTTP fixtures; chat and proposal
decisions use the real local database and deterministic agent. Network research
completion is intentionally not the acknowledgement endpoint.

Chromium focused run (2026-10-16T13:02:34Z, 22 passed, no skips):

| Action                           | Ordinary motion (ms) | Reduced motion (ms) |
| -------------------------------- | -------------------: | ------------------: |
| Destination search               |                216.2 |               210.9 |
| Select destination               |                220.9 |               212.6 |
| Reset destinations               |                 91.6 |                35.4 |
| Reorder destination              |                125.4 |               126.1 |
| Order mode                       |                917.5 |                41.3 |
| Step navigation                  |                 55.6 |                57.4 |
| Calendar range start             |                274.0 |                55.0 |
| Calendar range end               |                 52.1 |                74.8 |
| Duration handle                  |                 22.5 |                21.9 |
| Travel preference                |                 12.8 |                10.3 |
| Chat send pending feedback       |                 54.3 |                68.9 |
| Accept proposal pending feedback |                 41.8 |                39.8 |
| Reject proposal pending feedback |                 45.7 |                30.3 |

There is one sample per action per motion setting (26 samples), plus order-toggle
samples at 320/390/768/1440 px of 176.5/164.5/159.8/114.3 ms (four samples). All 30
were <=1000 ms; maximum 917.5 ms. This is a reproducible local check, not a percentile
benchmark, guarantee about live providers, or participant rating. Attachments are
emitted as `input-timings.json` in Playwright reports.

The measurements found and fixed a keyboard regression: a 0.01 display-scale step
rounded back to the same stored preference. The corrected 0.09 step changes exactly
one stored unit while retaining the 1–10 display scale and legacy values.

Manual assistive technology/zoom review and participant ratings remain T111/T113.

### Production HTTPS five-profile follow-up

The 115-case run starting 2026-10-16T14:44:32Z passed 114 cases and timed out in
one ordinary-motion desktop WebKit guest journey. No cases were skipped or retried.
Only persisted timing attachments are counted below; three samples from the failed
journey were not attached and are not inferred.

| Browser profile | Recorded samples | Maximum acknowledgement (ms) | Samples >1000 ms |
| --------------- | ---------------: | ---------------------------: | ---------------: |
| Chromium        |               30 |                        372.9 |                0 |
| Firefox         |               30 |                        298.0 |                0 |
| WebKit          |               27 |                        456.0 |                0 |
| Mobile Chromium |               30 |                        456.1 |                0 |
| Mobile WebKit   |               30 |                        491.0 |                0 |

All 147 recorded samples meet the local acknowledgement threshold. This does not
turn the failed journey into a pass, establish live-provider response times, or
replace the manual/participant gates. See [Phase 9](phase9.md) for the unresolved
timeout details and reproducible browser selection.
