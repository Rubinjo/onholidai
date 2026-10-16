# Coverage after running the suites

`pnpm --dir web test` runs 55 files / 283 tests with an isolated database and **no skipped
cases** (the earlier handoff recorded 67 database skips). `pnpm --dir web test:e2e` runs 82
browser journeys across five projects.

| Requirements | Implementation | Proof now executed | Remaining proof |
| --- | --- | --- | --- |
| FR-001 | marketing homepage, navigation, illustrative route | `homepage.spec.ts` on 5 projects: public, no builder bootstrap, CTA to `/trips/new` | cohort comprehension (T084) |
| FR-002–004 | globe, canonical places, shared destination actions | `guest-setup.spec.ts` add/reorder/replace/remove plus globe-failure fallback; `guest-setup-api.test.ts` empty-query country restriction; `platform-ux` responsive checks | country-pin selection through the globe surface itself |
| FR-005–008 | draft schema, repository, six-step wizard, autosave | `setup-drafts.test.ts`, `guest-setup-api.test.ts`, `guest-setup.spec.ts` refresh/validation/acceptance, `setup-accessibility.spec.ts` | — |
| FR-009–011 | planning API, estimate, proposal, customer pricing | `estimate.test.ts`, `estimate-api.test.ts`, `estimate.spec.ts`, `pricing-disclosure.test.ts` | — |
| FR-012–016 | session, access, quota, run reservation | `planning-session.test.ts`, `planning-actor.test.ts`, `guest-planning.test.ts`, `retention.test.ts` (quota buckets, expiry, replay) | — |
| FR-017–018 | free sign-up, booking-only auth boundary | `booking-auth-api.test.ts`, `booking-auth.spec.ts` | — |
| FR-019–023 | intent, link, continuation, revocation | `account-linking.test.ts`, `planning-link-repository`, `auth/continue` journey in `refinement.spec.ts`/`guest-planning.spec.ts` | cross-replica race timing |
| FR-024 | booking actor, domain, routes, workers | `booking-planning-identity.test.ts`, `booking-authorization.test.ts`, `booking-workflows.test.ts` (Temporal activities) | coordinated worker deployment (T068) |
| FR-025–028 | theme, states, accessibility, motion | `platform-ux.spec.ts`, `accessibility.spec.ts`, `setup-accessibility.spec.ts`, `workspace-propagation.test.tsx` (two-second convergence) | manual AT/forced-colour/zoom (T079), SC-010 timings |
| FR-029 | principal joins, migrations 011–012 | `migration-compatibility.test.ts` (22 cases, fresh and 001–010 upgrade) | — |

Success criteria: SC-004 persistence and validation, SC-005 ownership, SC-006 linking,
SC-008 transaction safety and SC-009 automated access checks are exercised by the suites
above. SC-001/002/003/007/010 depend on the participant cohort, which has not run, so no
outcome is claimed for them.

Residual gaps: the globe's country-pin selection is not driven by an automated journey (the
deterministic search path is), the refinement journeys need their own freshly seeded trips,
and SC-010 input-acknowledgement timing was not measured.
