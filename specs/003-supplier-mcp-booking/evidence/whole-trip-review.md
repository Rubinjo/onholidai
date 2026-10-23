# US3 whole-trip review and authorization acceptance

Validated 2026-10-23 using synthetic evidence, isolated PostgreSQL/PostGIS
databases, deterministic services and the production HTTPS browser harness.
This certifies US3 T042-T060, not consequential supplier execution, live checkout
or completion of the entire supplier feature.

## Implemented boundary

- Current products remain Duffel flights, Nuitee stays and Viator activities.
  Deferred rail and Nuitee Flights/Experiences are not activated or fallback lanes.
- Coverage derives the entire accepted trip, including absent outbound,
  intercity and return legs, stay nights and room/party requirements, activities
  and explicitly required unsupported transport. Bundles count once. Missing
  legacy classification stays unknown without authoritative evidence.
- Informational/free or self-arranged classification needs trusted evidence.
  Proposal text and a generic acknowledgement cannot waive a required service.
- V2 terms bind the complete coverage report, exact component mapping, provider,
  offer/inventory, dates, party, service/property/room/fare/baggage, customer money,
  taxes/fees, refund/change conditions, opaque readiness versions and lineage.
  Confirmed commitments are distinct from new work and remaining payable.
- Owner-scoped consent and start independently recompute coverage and verify
  current persisted review, terms, exact acknowledgement set and prerequisites.
  Expiry is checked again after trusted reads. Identical request identities replay;
  altered requests conflict. New whole-trip v1 starts are rejected.
- Start records one transaction and pending outbox, consumes exact authority and
  does not execute suppliers. Unconditional v2 guards remain at execution-basis,
  claim and direct dispatch entry points. US4 must complete before activation.
- Owner-scoped review/status GETs restore safe durable state without supplier
  reads, revalidation, holds or booking writes. Private nested legacy terms,
  unrestricted supplier text, economics and identity/payment values are excluded.
- Migration 015 is additive. The original v1 parser, canonical hash and historical
  JSON remain unchanged. Existing review immutability is extended, not duplicated
  with a second competing trigger.

## Final verification

These results record the original US3 certification. The Next.js advisory was
resolved by the subsequent security update documented at the end of this report.

All required database tests ran with all four isolated test-role URLs configured.
No missing-database skips are counted as acceptance.

| Gate                                                   | Result                                                                              | Scope                                                                                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Booking/coverage/compatibility selection               | 129 functional cases passed; the remaining latency case passed on its focused rerun | Eleven files, 130 distinct cases in total; see the superseded run below                                                                    |
| Focused durable-start latency                          | 1/1 passed, zero skips                                                              | Eight fresh complete v2 authorizations/starts; maximum acknowledgement <=500 ms and first durable status read <=5,000 ms                   |
| Production browser matrix                              | 20/20 passed, zero skips                                                            | Four cases across Chromium, Firefox, WebKit, mobile Chromium and mobile WebKit                                                             |
| Root contract gate, earlier in this US3 implementation | 250 web and 43 Python cases passed, zero skips                                      | Shared/canonical/supply contracts and snapshot drift                                                                                       |
| Final contract checks                                  | Passed                                                                              | Source/promoted OpenAPI and supply equality, references/operations, 16 shared supply wire cases and generated snapshot/public-review drift |
| Final web types and targeted ESLint/format             | Passed                                                                              | Includes the safe blocker presentation, accessible submission error and updated browser/latency fixtures                                   |
| Final production build                                 | Passed, exit 0 on normal retry                                                      | Framework advisory remains unresolved; see below                                                                                           |

The selected files and reproduction commands are listed in
[the quickstart](../quickstart.md#bounded-us3-whole-trip-review-checks).
The final functional selection includes real legacy Temporal workflow cases,
fresh migration and actual 014-to-015 upgrade cases, and separately authorized
rescheduling/reconciliation compatibility. Those legacy checks do not activate
v2 provider execution.

The production browser matrix completed in 8.7 minutes. The positive review
journey proves:

1. Route, party, provider/service terms and room information are visible.
2. The accepted estimate of GBP 95.00 is distinguished from current GBP 100.00;
   remaining payable is GBP 400.00.
3. There is one whole-trip action and no component/subset checkout controls.
4. At a 320px viewport the document has no horizontal overflow.
5. Keyboard consent creates exactly one authorization, one transaction and one
   pending outbox; component attempt count stays zero.
6. Replaying the exact start does not create another record.
7. Actual-clock expiry withdraws consent; reload restores the existing durable
   attempt without starting another.

The negative review journey removes the return while retaining stale,
complete-looking saved terms. The client offers no consent/acknowledgement
escape; the real authorization route returns `booking_coverage_changed`, and
authorization, transaction, outbox and component-attempt counts all remain zero.

The account journeys use real application registration, guest linking,
sign-out and sign-in. Linking preserves the same trip/version/snapshot and is
not consent. Required planning evidence can legitimately remain a clarification;
account continuation does not depend on inventing an automatically eligible
estimate.

## Browser fixture versus application coverage

Positive browser authorization/start POSTs are intercepted by a test-only CLI
that invokes the actual domain functions with explicitly seeded synthetic
readiness. It is restricted to a loopback database named exactly
`onholidai_us3_browser`. This source is never installed in application
composition. Application SSR, durable GETs, authentication and negative
authorization use the real running application.

Credentialed HTTP contract tests independently exercise the real positive
authorization/start routes, owner/guest/cross-owner boundaries, safe responses,
replay and read-only GET behavior. Neither layer claims a live payment path,
supplier confirmations or v2 workflow execution.

## SC-005: unauthorized-write and replay evidence

The deterministic adversarial checks reject incomplete mappings/subsets, changed
material terms, a copied fingerprint attached to a forged coverage report,
missing/changed trusted readiness, stale versions and expiry before or after
trusted reads. Changed final terms invalidate unused consent. A late older
worker cannot replace the latest requested review; concurrent completed replay
returns immutable saved evidence.

Hash/schema regressions cover provider/offer/inventory, property/room,
fare/baggage/refund/change, taxes, party, dates, readiness, mapping and lineage;
the frozen original v1 hash is retained. Exact non-reversible acknowledgement
sets and stable authorization/start request identities are separately tested.
Planning edits/restore cannot rewrite confirmed provider commitments.

The positive recorded attempt and guarded direct-dispatch cases leave zero v2
component attempts/provider execution. Ineligible authorization/start paths
leave no new booking transaction. This is bounded US3 zero-unauthorized-write
evidence, not certification of the future US4 execution/recovery paths.

Nuitee rates alone, unverified prebook and `usePaymentSdk=false` do not establish
safe final checkout. Missing approved read-only final terms or trusted
traveller/payment readiness stays blocked with safe reasons. Malformed source
facts and exceptions persist failed/unknown rather than favourable defaults.
Trusted reads are bounded; ephemeral token buffers are erased.

## Superseded failures and certification limits

- Initial red tests exposed missing whole-trip coverage, incomplete/subset
  acceptance and absent durable review reads. A direct-dispatch regression also
  exposed a v2 write bypass; basis, claim and dispatch now all reject activation.
- Development-server browser runs failed while repeated page reloads aborted
  restoration GETs. They are not counted as passes. The final full matrix used
  the existing production HTTPS harness instead.
- The first production matrix passed 15/20; account continuation wrongly assumed
  automatic version-two planning despite required source evidence being unknown.
  The fixture now waits for the real clarification and verifies preservation of
  that version-one draft. All 20 final cases passed without weakening the
  account, completeness or write assertions.
- A broad run initially exposed an obsolete latency fixture starting new v1
  consent. It now uses the same complete, approved synthetic v2 review as the
  other tests. The next broad run passed 129/130 but measured 774.843 ms maximum
  acknowledgement during concurrent browser/type/Temporal work. After those
  jobs stopped, the unchanged <=500 ms/<=5,000 ms assertions passed for all eight
  fresh samples in the focused rerun. No deadline was increased. This is local
  isolated-path timing, not a live supplier or loaded-system latency guarantee.
- Next.js 16.4.0 emitted its known-vulnerability upgrade reminder and stopped a
  build after compilation/type checking. A normal immediate retry completed
  with exit 0. Upgrading Next.js is recommended; no dependency upgrade or
  independent vulnerability review was performed in this US3 task.

No live supplier entitlement, Nuitee no-hold/no-payment prebook semantics,
production approved readiness source, consequential v2 dispatch/recovery,
participant study or full US5 accessibility acceptance is claimed. Those gates
remain separate and uncompleted. No production credentials/data were used by
these checks.

Task-owned web/agent services and the disposable database container were stopped
after validation. Cleanup of the three session-only self-signed TLS files was
denied by the tool; they remain outside the repository. No certificate was
installed into the user trust store.

## 2026-10-23 Next.js security follow-up

Updated the exact Next.js and `eslint-config-next` pins from 16.4.0 to 16.4.3,
with the matching environment/compiler/plugin packages regenerated in the pnpm
lockfile. React and unrelated dependency versions remain unchanged.

The baseline audit reported three Next.js advisories: two critical and one high,
all patched in >=16.4.1. After the update, `pnpm --dir web audit --json` reports
zero advisories at every severity, and the installed framework reports 16.4.3.
The production build completes with exit 0, including TypeScript, without the
previous security reminder or a retry.

All 213 selected unit/review regression tests passed across 43 files without
skips, and the complete web ESLint check passed. Database-backed and browser
matrices above were not rerun for this dependency-only follow-up.

pnpm added exact-version release-age exceptions for the twelve updated Next.js
package entries; other dependencies retain the release-age gate. Its existing
ESLint peer-range warnings for import, accessibility and React plugins predate
the upgrade and remain unchanged; the actual lint run succeeds.
