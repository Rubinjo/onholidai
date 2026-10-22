# US3 evidence — verified end to end

Independent test executed: a guest trip is linked to exactly one free account, history and
versions are unchanged, the guest loses access while the account keeps it, and booking
operations stay closed to guests even by direct request.

| Check                                 | Command / file                                                                     | Result |
| ------------------------------------- | ---------------------------------------------------------------------------------- | ------ |
| Intent/link/auth contracts            | `web/tests/contract/booking-auth-api.test.ts`                                      | passed |
| Concurrent claim/save/link/replay     | `web/tests/integration/account-linking.test.ts`                                    | passed |
| Account != principal booking identity | `web/tests/integration/booking-planning-identity.test.ts`                          | passed |
| Authorization/Temporal regressions    | `web/tests/integration/booking-authorization.test.ts`, `booking-workflows.test.ts` | passed |
| Browser boundary                      | `web/tests/e2e/booking-auth.spec.ts`, `refinement.spec.ts` continuation journey    | passed |

Registration asks for identity only (no payment or subscription fields) and offers an
existing-account path; the price bar states that finalisation, not authentication, unlocks
booking.

Open: T068 coordinated web/worker deployment confirmation remains blocked by the pre-existing
booking-worker entrypoint defect recorded in [rollout.md](rollout.md), so booking for linked
principals is not enabled. T067's simultaneous quota/link/callback lock coverage is exercised
by `account-linking.test.ts`; additional cross-replica timing scenarios are not simulated.
