# Cross-browser accessibility acceptance

Status: automated scenario authored; no browser or manual accessibility journey was run in this environment.

## Required record

Record the exact versions for the latest two stable Chromium, Firefox, WebKit/Safari desktop, and mobile browser builds used; OS/device, viewport, zoom level, reduced-motion setting, map/provider outage behavior, test command and result; and a journey-by-journey result for setup, estimate acceptance, refinement, proposal review, undo, finalization, booking authorization, recovery, rescheduling, and booking-summary navigation.

For keyboard and screen-reader passes, record the screen reader and version, navigation path, focus order, control names, announcements, blockers, and retest outcome. Capture screenshots only from synthetic accounts and keep them in the approved test artifact store.

## Open evidence

- Run the Playwright `@accessibility` suite on the latest two stable desktop/mobile browser releases and Firefox ESR.
- Complete keyboard and screen-reader journeys with map loading enabled and disabled, high zoom, and reduced motion.
- Measure SC-012 using the fixed participant protocol and failure-inclusive denominator in `spec.md`; do not infer participant results from automated tests.
