# Privacy — verified by running the suites

`pnpm --dir web test` (isolated database, 283 tests, 0 skipped) includes the privacy and
pricing suites that were previously skipped:

- `web/tests/integration/booking-privacy.test.ts` — no guest credential or raw address is
  written to responses, logs or telemetry.
- `web/tests/integration/pricing-disclosure.test.ts` — customer projections never expose
  supplier cost or margin; diagnostics stay behind the registered-team secret.
- `web/tests/integration/retention.test.ts` — raw conversation bodies are replaced with an
  `expired` marker in a bounded batch while accepted history is preserved, and quota
  metadata cleanup never cascades into durable history.
- `web/tests/unit/telemetry-redaction.test.ts` — span attributes keep the reviewed allowlist.

Observed behaviour of the running stack:

- Planning responses are `Cache-Control: private, no-store` with a correlation id.
- Guest bootstrap returns an opaque base64url credential in an HttpOnly, `Path=/`,
  `SameSite=Lax` cookie; storage holds only its lowercase SHA-256 digest (64 hex characters).
- Bootstrap and quota buckets are keyed by an HMAC digest, never a raw address, and expire
  after one hour; `GUEST_TRUST_PROXY_IP` defaults to off.
- An expired session denies access without deleting accepted history — the guest journey
  asserts the accepted trip still reloads for its owner.

One defect fixed in this area: `expireRawConversationMessages` opened a nested transaction
inside the request transaction, which made the conversation history endpoint fail with 500
instead of applying retention.

Remaining gap: the retention/privacy suites prove the specified behaviours, but no external
privacy review or legal-hold exercise was performed.
