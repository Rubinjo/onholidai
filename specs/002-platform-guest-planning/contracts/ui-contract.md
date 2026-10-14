# UI Contract: Marketing, Setup, and Authentication

## Routes and draft controller

Homepage is server-rendered marketing with value proposition, /trips/new CTA, process, benefits and clearly illustrative itineraries or licensed images with alt text. Trust/booking claims reflect enabled capabilities. No embedded builder or guest-session bootstrap.

Builder steps: destinations → origin → dates/duration → travellers → preferences/requirements → review. One parent draft controller retains entries/step, hydrates server recovery, debounces saves 500 ms, serializes its saves and flushes before submit. Title/currency in review/summary. Desktop summary persistent; mobile summary expandable and reachable. Show unsaved/conflict/retry honestly and preserve local edits; estimate/workspace continue on existing trip route.

## Globe and destination controls

Default-visible globe is dominant first panel, with skeleton and always available search/ordered list. One MapLibre instance, existing local countries/worker/attribution, globe projection after load, source/filter updates, ResizeObserver and unmount cleanup. Selected/candidate city points are canonical lookup records.

Country selection opens Radix Sheet/Dialog with country confirmation and country-filtered cities; pointer and search paths have identical semantics. No guessed city/timezone/ocean destination. List actions Earlier/Later/Remove/Replace have destination-specific accessible names; optional dragging never replaces buttons. Replacement retains slot ID/position where valid, swapping canonical place facts. Reorder contiguous positions; numbered markers one-based. Exact duplicates rejected, country plus city and distinct same-country cities permitted, maximum eight explained. Missing coordinates retain list selection.

Route lines are diagrams, not verified transport. Map failure retains selection and complete search/list plus retry. Canvas may remain aria-hidden only when equivalent DOM information/actions are complete.

## Fields, states and booking boundary

Reuse explicit origin/default return, preferred/flexible windows, min/ideal/max, adult/child ages-at-start, five meaningfully labelled preference ranges, reviewable requirement wording/category/priority/status and customer currency. No passports/payment/traveller identities for planning.

Use current AccessibleField/StatusAnnouncer with loading, empty, saving/saved/unsaved/conflict/error and accepted-proposal states; skeleton/alert/inline success, no new toast library. Disable duplicate pending submit; distinguish save, research and acceptance. Preserve estimate/synthetic/unverified/expired/live disclosures and customer-only pricing.

Guest booking explains account association with actions/confirmations and free registration/no subscription. Offer sign-in, free sign-up, back to planning. Shared forms ask name/email/password as existing auth policy requires. Failed/cancelled auth preserves trip. Continuation has pending/success/retry; existing-account error offers sign-in. Linking success never implies booking; resume live review and separate exact-term authorization.

## shadcn components and tokens

Use source-owned Radix variants of needed Button/Input/Textarea/Label/Card/Badge/Progress/Skeleton/Alert/Dialog/Sheet; reuse existing calendar/native selects/field/status where sufficient. components.json uses current @/* aliases, rsc true, TSX, app/globals.css, empty Tailwind config for v4. Add source-required utilities and matching PostCSS plugin/config only; no unattended theme reset.

| Semantic token | Source |
| --- | --- |
| background / foreground | --canvas / --text |
| card/popover and foreground | --surface / --text |
| primary and foreground | existing --accent / contrast-tested light text |
| secondary/muted | new subdued surface alias, --text or --text-muted |
| destructive and foreground | --danger / contrast-tested light text |
| border/input | --border |
| ring | --focus-ring |
| accent hover utility | distinct subdued hover token; never overwrite legacy --accent |
| radius | shared new radius values only |

Use Tailwind @theme inline mappings and semantic variables while retaining legacy raw variables/typography/color scheme. Scope old planning-page element styles so they cannot override shadcn variants. Preserve forced colors/focus indicators.

## Accessibility, motion and layouts

CSS entrance/selection/step transitions never delay input/navigation. No auto-rotation. Reduced-motion media checks suppress decorative transforms and use animate:false for MapLibre camera. If Motion later demonstrates value, scope motion/react with reducedMotion='user', no exit-wait navigation.

Focus new heading on step change, first invalid field on error, suitable neighboring action after row removal and trigger after dialog close. Announce outcomes without re-reading whole summary. Semantic lists/labels/description/error/landmarks/skip link and full keyboard/screen-reader equivalent globe operations are required.

Verify 320/390/768/1440 CSS pixels and 200% zoom, browser mobile projects, contrast/forced colors/reduced motion. No page-wide overflow, clipped actions or summary/sticky-price overlays; targets at least 44×44 CSS pixels. No information only through color/map/movement.
> Implementation handoff (2026-10-15): wizard, globe/list fallback, auth boundary and marketing source are implemented. Browser/manual/cohort checks remain open; no screenshot, accessibility or timing pass is claimed.
