# Accessibility — automated checks pass, manual review still required

Automated browser checks now run against the real stack on chromium, firefox, webkit and
both mobile projects (82 passing journeys, `pnpm --dir web test:e2e`):

- `platform-ux.spec.ts` — public journeys at 320, 390, 768 and 1440 px with reduced motion:
  no horizontal overflow, an `h1` per route, and the skip link is the first tab stop in
  engines that include links (see the WebKit note below).
- `setup-accessibility.spec.ts` — every builder step is reachable by keyboard with labelled
  controls, including a second availability window.
- `accessibility.spec.ts` — the trip workspace stays navigable with maps aborted at 390 and
  195 px, keeps its route, conversation and `contentinfo` landmarks, reports
  `scroll-behavior: auto` under reduced motion, and does not overflow.
- `guest-setup.spec.ts` — invalid steps are announced once and the offending control is
  marked `aria-invalid`; the destination search stays focusable when the globe fails.
- `refinement.spec.ts` — the conversation keeps its intended focus order at 200% text size.

Fixed in this area: the builder moved focus to its step heading on first render, which
overrode the document start and made the first tab stop the wrong control; the price bar lost
its `contentinfo` landmark when the grid nested it inside `<main>`; and the trip editor's
fieldset kept a user-agent min-content floor that overflowed the narrowest pane.

WebKit note: Playwright's WebKit keeps Safari's default of tabbing only through form
controls, so the skip-link ordering assertion is limited to engines that include links. The
skip link itself is asserted in every engine by activating it and checking that focus lands
on `#main-content`.

**Still open (T079):** no manual screen-reader journey (NVDA/VoiceOver/TalkBack), no
forced-colours-mode check and no screenshot evidence. Automated assertions do not replace
that review, and no such result is claimed.
