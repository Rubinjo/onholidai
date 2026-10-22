# Release checks — 2026-10-15

Executed this pass with Node.js 24.21.0, pnpm 12.11.2 and Docker Desktop 29.6.1 against the
migrated local stack (PostGIS 18-3.6, Temporal 1.27.2, deterministic providers) and an
isolated test database. Real output, not source review.

| Command                                                                               | Result                                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                                                      | passed                                                             |
| `pnpm --dir web lint`                                                                 | 0 problems                                                         |
| `pnpm --dir web typecheck`                                                            | passed                                                             |
| `pnpm lint` (web eslint + agent ruff)                                                 | passed                                                             |
| `pnpm typecheck` (tsc + pyright)                                                      | 0 errors, 0 warnings                                               |
| `pnpm --dir web test` (isolated DB)                                                   | 55 files, 283 tests passed, 0 skipped                              |
| `pnpm --dir web test:e2e` (chromium, firefox, webkit, mobile-chromium, mobile-webkit) | 82 passed, 0 failed, 20 fixture-gated skips                        |
| `pnpm --dir web build`                                                                | passed (must run with `NODE_ENV=production`)                       |
| `uv run --project agent pytest agent/tests`                                           | 75 passed                                                          |
| `pnpm test:contracts`                                                                 | web contracts 75 passed/3 skipped; agent contract exports verified |
| `git diff --check`                                                                    | no tracked whitespace errors                                       |

## Gates that remain open

- Manual assistive-technology, forced-colour, 200% zoom and screenshot review was not
  performed (T079). Automated responsive/state/focus checks pass.
- No participant cohort ran, so SC-001/002/003/007/010 have no measured outcome (T084).
- Coordinated web/worker deployment was not approved: the compose `booking-worker` cannot
  start because `server/workflows/alias-loader.mjs` never registers its resolution hooks
  (pre-existing, from the booking feature). Linked-principal booking therefore stays
  disabled (T068). A Temporal activity regression suite does execute inside
  `pnpm --dir web test`.
- `agent/tests/contract/test_contract_export.py` needs `--basetemp` on this machine because
  the account path contains an apostrophe; with that override all 75 agent tests pass.

Not release-approved. The remaining gaps are explicitly listed rather than counted as passed.
