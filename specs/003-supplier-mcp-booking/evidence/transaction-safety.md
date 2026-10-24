# US4 transaction safety: verified persistence increment

## Scope and activation boundary

This records completion of T069, T071 and T072 plus initial regression, provenance,
dispatch and recovery-status work. It does **not** certify all of US4, consequential
v2 execution, supplier HTTP mappings or full executing recovery browser journeys.
The later recovery-review increment below implements T073 without enabling writes.

All database exercises used a task-owned, disposable loopback PostGIS container
with the repository's separate migration/web/worker roles. No application database,
live supplier endpoint, real payment, customer identity or environment file was
used or changed. V2 basis, claim and dispatch remain explicitly disabled.

## Reproduced failures and verified results

| Boundary                                 | Reproduction before the fix                                                                                                  | Verified result                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate dispatch                       | 100 concurrent deliveries of one durable claim made 100 provider calls.                                                      | The durable claimed-to-dispatched compare-and-set permits exactly one call and one confirmation. Other deliveries cannot renew the claim or repeat the provider operation.                                                                                                             |
| Provider success / database failure      | Persistence and claim release were split; database exceptions could be treated as supplier uncertainty after partial writes. | A real PostgreSQL trigger injects a crash before local outcome projection. Confirmation, evidence, projection and release roll back together; the previously committed dispatched attempt and claim survive. A new activity instance resolves status without another write.            |
| Expiry after claim                       | Dispatch did not recheck the basis atomically with durable dispatch ownership.                                               | Expiry is rechecked under access/trip/transaction locks before dispatch. The supplier is not called. Only proven-undispatched claimed records can release their claim; dispatched/unknown actions cannot.                                                                              |
| Fresh authorization/key                  | Existing claims did not establish complete cross-attempt confirmed/requirement protection.                                   | A fresh transaction/key cannot repeat a claimed, unknown or confirmed component. Denied claims do not create orphan attempts.                                                                                                                                                          |
| Different component, same v2 requirement | A new component identity could evade a component-only claim.                                                                 | Repository-only v2 cases prove claimed, unknown and confirmed requirement coverage prevents a second component/key from booking the same requirement. The fixtures do not enable v2 activity dispatch.                                                                                 |
| Immutable lineage/evidence               | No requirement/evidence-conflict metadata existed on attempts.                                                               | Migration 016 adds immutable requirement IDs, append-only sanitized evidence, monotonic conflicts and a composite claim/attempt scope constraint. Database tests reject evidence removal, conflict reset, requirement mutation, attempt reclamation and cross-owner/trip/root lineage. |
| Changed confirmation                     | A confirmation with changed customer terms lost its supplier reference and actual terms.                                     | Valid actual terms and reference remain in an immutable confirmation and evidence history. The component requires support and its unresolved guard remains. No fresh authorization is inferred.                                                                                        |
| Late authenticated truth                 | Outcome recording returned early for inactive execution; divergent trip projection could roll back evidence.                 | Expired/invalidated callback and status paths preserve supplier truth. An incompatible trip version or competing claim prevents projection and reports action required without replacing accepted edits. Execution authority is never renewed.                                         |
| Contradictory callbacks/status           | A changed event could fail without retaining the conflicting evidence.                                                       | Identical event replay returns its original receipt. A conflicting event for the same scope commits its sanitized evidence/conflict state before returning 409. The first confirmation/reference remains immutable. Repeated evidence does not duplicate the evidence history.         |
| Status-only access                       | Reconciliation incorrectly required the original write capability.                                                           | An approved status client can reconcile while fresh booking is disabled. The status request receives saved terms/reference context. Historical v1 confirmations without attempts can create reconciliation-only evidence without new provider calls.                                   |
| Missing status                           | Lack of status risked being treated as renewed retry permission.                                                             | The outcome explicitly requires manual support; the unknown claim remains and even expiry does not permit another booking. Network exceptions are unknown, never definitive non-commit.                                                                                                |
| Recovery text/polling                    | An invalidated partial v2 attempt claimed no services were attempted; manual status retry fetched twice.                     | Confirmed, uncertain and not-attempted labels are distinct. References/support context and return-to-trip remain visible. Polling is bounded, abortable and non-overlapping; manual refresh performs one status read and never starts a booking.                                       |

Provider calls stay outside database transactions. Outcome ingestion follows the
principal/access, trip, transaction, attempt/claim lock order. Execution activities
do not catch database failures as if they were supplier transport failures.
`failed` is reserved for a trusted client's definitive non-commit result; a timeout,
missing status, unknown response or prior confirmation cannot establish it.

The existing authenticated callback bridge is retained only for its existing
providers. No Nuitee or Viator webhook authentication or commercial approval was
invented. Canonical provider/product routing preserves original provenance; the
new current-product registry permits only Duffel flights, Nuitee accommodation and
Viator activities. Inactive products cannot be selected as new-write fallback.
Worker activation and pending-v1 transition remain separate unfinished tasks.

## Validation

Final combined run:

- **362 tests passed across 26 files, zero skips**, including every web contract,
  booking workflows/callbacks/authorization, planning identity, migrations, privacy,
  review and recovery/account-continuation unit tests.
- The workflow suite contains **20 cases**, including actual Temporal workflows,
  one 100-concurrent-delivery regression and repository-only v2 requirement guards.
- Upgrade from migration 014 applies 015 and 016 without rewriting v1 terms/hash
  or the saved confirmation. Historical status-only reconciliation still works.
- TypeScript, complete web ESLint, related formatting, generated agent/booking
  contracts and TripSnapshot contract drift checks passed.
- Production Next.js 16.4.3 build passed, including its TypeScript step.

Reproduction command with all four isolated database URLs already configured:

```powershell
corepack.cmd pnpm --dir web test tests/contract tests/integration/booking-workflows.test.ts tests/integration/provider-callbacks.test.ts tests/integration/booking-authorization.test.ts tests/integration/booking-planning-identity.test.ts tests/integration/migration-compatibility.test.ts tests/integration/booking-privacy.test.ts tests/integration/booking-review.test.tsx tests/unit/booking-continuation.test.tsx --maxWorkers=1
```

Earlier targeted red runs established the duplicate-write, lost-reference,
status-capability and recovery-text defects before their corresponding fixes.
Superseded failures included the old expectation that changed confirmations should
be discarded, the additive migration filename expectation, a nested lineage-test
declaration and a remapped v2 fixture's incomplete coverage-ID set; these were
corrected and are covered by the final passing combined run.

## Remaining acceptance

- T061/T077 require at least 100 **distinct** whole-trip
  duplicate/concurrent/two-authorization/restart/timeout/continuation cases.
  The 100 deliveries in one test and the 362 total compatibility/contract tests
  are not substitutes for that matrix.
- Restricted Nuitee/Duffel/Viator HTTP mappings and verified per-operation,
  environment, final-terms, identity and payment prerequisites remain unfinished.
  No Nuitee prebook/session ID is assumed to guarantee idempotency.
- T073 recovery review now derives parent/root and every unresolved requirement
  server-side, preserves confirmed commitments and authorizes only the exact
  remaining amount. V2 dispatch is still blocked independently of that consent.
- Stock worker composition, the v1-to-v2 execution transition, complete execution
  guard activation and success/partial/uncertain/continuation browser certification
  remain pending. The review-only recovery browser checks below are not executing
  booking acceptance.
- A configured operational support channel is not invented; the current recovery
  status supplies the durable attempt/reference context for support.

See [tasks](../tasks.md), [whole-trip contract](../contracts/whole-trip-booking.md)
and [quickstart](../quickstart.md) for the remaining execution gates.

## Later T073 recovery-review increment

- Server-derived current parent/original root are checked at review persistence,
  authorization and start under the trip lock. Active/uncertain/conflicting actions
  block continuation. Competing authorizations yield one child and stale consent
  cannot choose another parent.
- Full actual confirmed service/charge/party terms must be retained and cannot be
  omitted or moved into the new write set. Confirmed services are not revalidated
  as unbooked offers and do not contribute to the remaining payable amount.
- Definitive non-commit and proven-undispatched local stops no longer project
  misleading pending/commitment state. Durable failure/action-required history is
  preserved; uncertainty and dispatched claims are not cleared.
- Additive migration 017 gives separate booking workflow intents their own durable
  outbox identities at one trip version, with required bounded workflow IDs and
  duplicate protection. Trip-version event uniqueness is preserved.
- Combined selection: **374 passed / 26 files / zero skips**. Final affected
  outcome/workflow/authorization/privacy selection after the local-stop regression:
  **66 passed / 4 files / zero skips**.
- Real production HTTPS recovery-review cases passed across all five configured
  browser projects: 9/10 in the first matrix, with the fixture-seed-timeout WebKit
  case passing an unchanged-limit focused rerun. They use real database/auth/domain
  review/consent/reload and injected synthetic outcomes, never v2 supplier dispatch.

See [recovery evidence](recovery.md) for exact scenarios and limits. T061/T077/T078,
supplier wire implementations and stock-worker execution composition remain open.
