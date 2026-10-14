# Source coverage and remaining acceptance

| Requirements | Implementation | Remaining proof |
| --- | --- | --- |
| FR-001 | marketing/homepage/navigation | browser checks and cohort comprehension |
| FR-002–004 | destinations/globe/places | full candidate/action/fallback matrix |
| FR-005–008 | draft schema/repository/wizard | validation/save/reload/submit matrix |
| FR-009–011 | planning API/estimate/proposal/pricing | original estimate/refinement/pricing regressions |
| FR-012–016 | session/access/quota/run repository | complete isolation/expiry/quota/replay matrix |
| FR-017–018 | auth/signup/booking boundary | full auth/direct booking journeys |
| FR-019–023 | intent/link/continuation/revocation | save/link/callback/quota race matrix |
| FR-024 | booking actor/domain/routes/workers | exact-term/duplicate/partial-failure regressions |
| FR-025–028 | CSS/UI/summary/progress/status | all states/zoom/AT/motion checks |
| FR-029 | principal joins/migrations 011–012 | fresh/upgrade and legacy regressions |

All FR identifiers are traced; source coverage is not proof of satisfaction. New test files cover only part of requested comprehensive matrices and are unrun.

SC-001/002/003/007/010 require frozen participant outcomes; none were measured. SC-004 persistence/validation, SC-005 ownership, SC-006 linking, SC-008 transactions and SC-009 manual access remain unverified. SC-010 input acknowledgement also needs measurement. See open tasks.
