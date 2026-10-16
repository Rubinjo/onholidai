# US5 evidence — automated checks pass, manual review open

| Check | Command / file | Result |
| --- | --- | --- |
| Responsive/state/focus/motion | `web/tests/e2e/platform-ux.spec.ts` (320/390/768/1440 px, reduced motion, 5 projects) | passed |
| Workspace under failure | `web/tests/e2e/accessibility.spec.ts` (390 and 195 px, maps aborted) | passed |
| Step labelling and focus | `web/tests/e2e/setup-accessibility.spec.ts` | passed |
| Two-second pane convergence | `web/tests/integration/workspace-propagation.test.tsx` | passed |
| Builder status/conflict handling | `web/tests/integration/setup-drafts.test.ts` | passed |

No horizontal overflow was found at any asserted width once the editor fieldset's
user-agent min-content floor was fixed. Focus order is asserted across routes, including the
skip link reaching `#main-content`, and reduced motion renders `scroll-behavior: auto`.

SC-010 input acknowledgement was **not** measured with a stopwatch: the journeys assert that
controls respond without waiting for animation, but the <=1-second deterministic
acknowledgement measurement and the participant ratings remain (T080/T084).
