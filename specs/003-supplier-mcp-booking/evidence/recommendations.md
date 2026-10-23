# US2 recommendation and selected-research acceptance

Validated 2026-10-23 with synthetic, deterministic evidence and an isolated PostgreSQL/PostGIS database. This records US2, not booking activation or completion of the whole supplier feature.

## Scope and policy

- Current products remain Duffel flights, Nuitee stays and Viator activities. Rail and Nuitee Flights/Experiences are not activated or fallback providers.
- Selection filters sourced hard failures, dates, currency, party capacity, child age bounds and conflicts with commitments. Missing required evidence remains unresolved.
- Verified strong/preference evidence and supported pace/duration facts precede equivalent-price comparison. Spend is willingness, not an invented budget or evidence of quality. Explicit, unambiguous same-currency maximum budgets include retained components; ambiguous amounts ask a price question.
- Equivalence compares known schedules, details, cancellation terms, planning facts, eligibility, occupancy, accessibility and room identity. Equivalent options use the lowest customer total, then provider ID and native offer ID. Material differences ask one focused question.
- Unsupported required rail asks a material question, never for Trainline access or credentials. An explicit decision to keep rail unresolved allows supported planning without deleting the requirement, inventing rail inventory or silently satisfying it with another mode. Resumption and bounded conversation decisions preserve that choice. Itinerary planning still warns about unresolved rail; it does not establish booking eligibility.
- Tavily/maps remain bounded advisory facts, not supplier inventory or authority to change prices or transact.

## SC-003 fixed decision denominator

Corpus version: `1.5.0`; policy version: `1`.

Corpus hash: `sha256:2b68ebe0f6b1bd3403f8d565bd1af0471a0ca2c334b8321a0aa9fb5af5ae241a`.

The generator produces identical web/Python fixtures. All 26 cases execute the actual selection function against fixed evidence, assert the expected selected native ID or relevant single-question clarification, and check input immutability. All 18 selection cases and all eight material-question cases passed. The six dominant/equivalent cases produced zero unnecessary questions.

| Case                      | Verified outcome                                     |
| ------------------------- | ---------------------------------------------------- |
| flight-dominant           | Select lower-total equivalent `a`                    |
| flight-equivalent         | Stable equivalent tie selects `a`                    |
| flight-competitive        | One material source-terms question                   |
| flight-ineligible         | Reject ineligible `a`; select `b`                    |
| flight-unknown            | One required-evidence question                       |
| flight-constraint         | Reject failed requirement; select `b`                |
| accommodation-dominant    | Select lower-total equivalent `a`                    |
| accommodation-equivalent  | Stable equivalent tie selects `a`                    |
| accommodation-competitive | One material source-terms question                   |
| accommodation-ineligible  | Reject ineligible `a`; select `b`                    |
| accommodation-unknown     | One required-evidence question                       |
| accommodation-constraint  | Reject failed requirement; select `b`                |
| activity-dominant         | Select lower-total equivalent `a`                    |
| activity-equivalent       | Stable equivalent tie selects `a`                    |
| activity-competitive      | One material source-terms question                   |
| activity-ineligible       | Reject ineligible `a`; select `b`                    |
| activity-unknown          | One required-evidence question                       |
| activity-constraint       | Reject failed requirement; select `b`                |
| budget                    | Respect explicit EUR maximum; select `a`             |
| budget-unknown            | One total/currency question                          |
| wrong-currency            | Reject wrong-currency `a`; select `b`                |
| wrong-dates               | Reject out-of-scope `a`; select `b`                  |
| occupancy                 | Reject insufficient adult capacity; select `b`       |
| commitment                | Reject overlap with confirmed commitment; select `b` |
| rail-optional             | Supported planning selects `a` without rail keys     |
| rail-required             | One unsupported-required-rail question               |

Supplementary regressions cover differing sourced locations, child minimum/maximum ages despite an inconsistent eligible label, required evidence in another same-type requirement group, timestamp expiry despite a quoted label, flight-specific schedule constraints, retained-component budgets, useful partial research, rail deferral/resumption and preservation of an unrelated same-day flight.

The existing 100-estimate graph corpus produced **100/100 proposals within 30 seconds** and **100/100 required-constraint disclosures**. The separately printed graph-only p95 was **7.97 ms** on this run. This is not browser, BFF, database, model-provider or live-supplier latency.

## Trusted selection and application

The browser sends only `selectedOffers: [{ offerRef, revision }]` through the existing refinement reservation. It does not send an accepted component, supplier credential, native-ID authorization or trusted price.

The server:

1. Requires unique opaque references from completed same-owner/trip/current-version supplier research, an active product, the latest exact revision and matching route dates, party, origin and currency.
2. Binds selections to the reservation fingerprint and validated dispatch request. Only that target run receives imported read access; an unrelated active run is denied.
3. Reuses stored source offers and the existing candidate/proposal pipeline. Complete source-owned facts and internal prices replace model-supplied prices; hard required evidence and total budgets are checked independently of Python.
4. Preserves unrelated current draft components. Same-day identity alone is not replacement authority; ambiguous replacements and arbitrary removals are blocked. Existing bookings require a separate workflow.
5. Rechecks source freshness before non-replayed acceptance. Manual policy requires acceptance; automatic policy applies through the existing durable result transaction. Both preserve version checks, actual change summaries, inverse/history and undo.

Database-backed acceptance demonstrates:

- No accepted-trip change on selection or proposal preview.
- Repricing overrides a model-supplied customer total of `1`.
- Manual and automatic application each create one accepted version and durable history.
- Undo creates the next version and restores the original snapshot.
- Unfinished research, wrong-purpose import, cross-trip references, wrong query dates, unrelated-run access and stale accepted versions are rejected.
- Refresh after preview appends revision two; accepting the proposal bound to revision one is rejected with the saved trip unchanged.
- Every selected-source journey leaves `bookingTransactions` empty.

Actual in-process MCP tests exercise imported Nuitee references through `EstimateSources.selected_offers`, the closed `supplier_offer_details` tool and signed web reads. They validate canonical public output rather than bypassing the MCP boundary.

React integration checks prove one opaque automatic-refinement submission, focused chat clarification, no direct trip acceptance, and rejection rather than silent rebasing when the accepted version changes. Existing propagation, dirty-editor and source-panel regressions remain green.

## Final validation

| Gate                                                | Result                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Current web supplier/proposal/persistence/UI subset | 291 passed, 29 files, zero skips                                                           |
| Complete Python agent suite                         | 163 passed, zero skips                                                                     |
| Credentialed foundation gate                        | 46 passed, four files, zero skips                                                          |
| Root contract gate                                  | 230 web and 43 Python contract tests passed; supply/snapshot/canonical export drift passed |
| Corpus generation check                             | Identical fixture copies; version/hash above                                               |
| Types                                               | Web TypeScript and strict Python Pyright passed                                            |
| Static checks                                       | Python Ruff, affected-file Black and targeted web ESLint checks passed                     |

The initial foundation invocation failed closed because its shell omitted the four isolated test database URLs. The corrected credentialed invocation passed; no skipped database run is counted as acceptance. Earlier intentional red tests exposed percentile overspending, material-fact/age/group/expiry gaps, retained-budget/schedule gaps and missing UI dispatch. These were fixed and the final suites above rerun. A legacy refinement assertion was also updated to expect the current Nuitee stay lane, not historical Duffel stays.

Context regression: a 120-turn synthetic input compacted from 48,000 to 8,000 retained message bytes and 20 messages. Dynamic prompt: 11,842 bytes; stable prefix: 1,576 bytes; token estimate approximately 2,961. This is a bounded-context measurement, not a vendor token-billing count.

## Reproduction and limits

Use the existing commands in [quickstart](../quickstart.md#bounded-us2-recommendation-checks), with all four isolated database URLs configured in the same shell. No dependency installation or schema migration was introduced for US2.

No live API access, stay prebook/payment, reservation, booking authorization/execution, new US2 browser E2E run or participant-study outcome is claimed. The jsdom map canvas warning is an existing test-environment limitation; no canvas dependency was installed. Booking and participant certification remain separate feature gates. The disposable US2 database is removed after validation; code, fixtures and this evidence remain persistent.
