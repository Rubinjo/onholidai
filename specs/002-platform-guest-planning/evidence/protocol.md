# Frozen acceptance protocol

Frozen before implementation on 2026-10-14. All data below is synthetic;
this protocol contains no participant results or claims of passing acceptance.

## Cohort and scoring

Recruit at least 20 first-time participants, including at least five keyboard-only
or screen-reader users, five family planners, and five multi-destination planners.
Groups may overlap. Use anonymous participant IDs P01–P20; collect no passwords,
session credentials, payment details, or identifying traveller information.
Include failures and abandoned tasks in denominators. Record assistance as failure.
Separate external outages and research wait time from the specified task clocks;
retain raw elapsed times and exclusion reasons. Additional participants do not
replace unsuccessful participants. Freeze fixtures and task wording for the cohort.

| Criterion | Task and denominator                                                                                                                                                                                                               | Passing threshold                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| SC-001    | Open the homepage. Explain what the product does, whether planning needs an account, and which action starts planning. 20 participants; 60 seconds maximum.                                                                        | At least 18 identify all three without help.                                                             |
| SC-002    | Start a guest holiday visiting Portugal, Lisbon and Porto. Confirm Amsterdam as departure, enter dates/duration, two adults and a child aged eight, review and submit. 20 participants; exclude research and proposal review time. | At least 18 finish valid setup within eight minutes without help or registration.                        |
| SC-003    | Add Portugal and two cities; move Porto before Lisbon, replace Lisbon with Coimbra, remove Coimbra, and continue. 20 participants; three minutes.                                                                                  | At least 18 complete; all keyboard/screen-reader participants complete equivalent list actions.          |
| SC-004    | Backtrack, refresh, return to valid session, interrupt saving, conflict in two tabs, lose submit response and retry. Each frozen deterministic scenario counts once.                                                               | Every case preserves acknowledged data and creates at most one trip; conflicts never silently overwrite. |
| SC-005    | Unrelated guest/account, expired session, revoked credential after linking and identifier-only access, for each private resource and stream. Every actor/resource combination counts once.                                         | Every unauthorized attempt denies content and writes.                                                    |
| SC-006    | Simultaneous same/different account claims, existing account trips, active research, lost link response, repeat link after cookie expiry, and save/callback races. Each scenario counts once.                                      | Every case retains one authorized owner, original trip/history, and no copy.                             |
| SC-007    | Enter booking, explain the account boundary, choose sign-in or free registration and resume review. 20 participants; three minutes excluding external delivery/outage.                                                             | At least 18 succeed; none supply payment information or select a subscription.                           |
| SC-008    | Attempt guest booking, authenticate, link, redirect and replay; edit material terms, expire consent, retry provider outcomes. Each frozen transaction case counts once.                                                            | Every case has zero unauthorized reservations/payments and renewed exact-term consent where required.    |
| SC-009    | Core journeys at 320/390/768/1440 CSS pixels and 200% zoom; keyboard/screen reader, forced colors, reduced motion, map failure, pending/error/conflict/expiry. Every journey/condition counts once.                                | All preserve usable controls, equivalent information, focus and announcements.                           |
| SC-010    | After setup and booking-boundary tasks, ask: “Rate clarity and ease of navigation from 1 to 5.” 20 participants; measure deterministic input acknowledgement separately.                                                           | At least 18 rate 4 or 5; input acknowledgement within one second with no animation wait.                 |

## Synthetic fixtures and safety checks

Use deterministic provider mode and isolated databases only. Fixture A is an empty
signed-out browser; B a separate unrelated guest; C an existing account with an
unrelated trip; D another competing account. Use reserved example.invalid email
addresses. Canonical destinations and timezones must come from the existing place
provider. Do not fabricate location identities from globe coordinates.

Use dates 2030-06-01 through 2030-06-21, duration 5/7/8 days, EUR, five preference
values of 50 and a required step-free-access constraint. Missing numeric values
remain null. Seed accepted/finalized trips through existing domain fixtures for
refinement/linking tests; record fixture snapshot/version before each run.

Compare trip/version/run/request IDs, snapshots, reversal relationships, proposal
expiry, receipt fingerprints, terms hashes, execution basis JSON, conversations,
and booking/provider call counts before and after ownership changes. Test the
clean-start baseline on a fresh isolated database; upgrading the previous
migration history is unsupported. Record all assertion failures/skips.

## Evidence record

For each run retain scenario ID, fixture/revision, actor, start/end time, outcome,
assistance, exclusion reason, observations and relevant anonymized screenshot.
Record participant timings/ratings in usability.md only after actual sessions.
Manual assistive-technology evidence, the cohort, database compatibility and
transaction regressions are outstanding release gates until measured.
