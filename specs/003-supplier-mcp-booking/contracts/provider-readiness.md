# Provider access, credential and readiness contract

Extend existing adapter capabilities and typed composition; do not add another provider abstraction. Every deployment records per-provider/per-operation support, actual access, mode, market/party/property coverage, approved API contract/version, authentication requirements, scope limitations, read-only semantics, deadline/rate/freshness policy, idempotency and status evidence. Unknown values remain unknown and block claims of verified live capability.

## Provider-specific baseline

| Provider | Read implementation target | Restricted write target and activation gate |
| --- | --- | --- |
| Duffel Flights | Flight search/current-offer/detail/pricing with separate read key and established read semantics | Separate write key, approved Orders/payment/status semantics, exact terms, safe duplicate prevention and trusted passenger/payment references |
| Duffel Stays | Accommodation search, room/rate detail and safe quote evidence with read key where permitted; preserve actual property/occupancy and mandatory costs | Independently approved Stays access; restricted booking/status mappings, selected quote/room/rate, payment schedule and trusted guest/payment references; Flights access does not establish Stays readiness |
| Viator activities | Partner API product/option/detail/availability/pricing behind a closed read-operation allowlist, using the single upstream key | The same upstream key in the worker, plus actual booking-tier entitlement and approved booking/status semantics; required booking questions resolved through trusted references |
| Booking.com / Trainline | Deferred, no current onboarding or default synthetic/live inventory; rail requests explicitly unsupported | Future features only; preserve legacy attribution/confirmed evidence and existing approved reconciliation without enabling new writes |
| GetYourGuide | Replaced by Viator, not an active source or fallback | Legacy compatibility/reconciliation only; no new access requirement |

Primary sources and the distinction between public documentation and deployment access are recorded in [research.md](../research.md). Public documentation alone is never evidence of OnHolid.ai credentials or commercial approval.

## Configuration and composition

- Existing deterministic mode remains default; it explicitly reports demonstration mode in all results and reviews. Provide both read and restricted transaction doubles through existing composition roots so the stock worker's empty registry does not silently block acceptance.
- Replace the generic travel API key assumption in current typed configuration with explicit operation-level provider configuration and readiness. Keep service/auth/pricing-diagnostic keys distinct. Configuration records secret references, not values in public readiness or evidence reports.
- Duffel read secrets exist only in web read-client composition; its separate write secrets exist only in booking-worker composition. Viator's single upstream read/write key is provisioned to both trusted processes, with the same secret reference allowed. This is a declared upstream scope limitation, not a pair of independently scoped keys. No supplier secret reaches agent/MCP/browser.
- Trusted Viator web clients expose only fixed, documented, side-effect-free endpoint/method combinations, never arbitrary forwarding or transactional imports. Test that book/hold/cart/cancel/reschedule operations cannot execute from discovery even with a write-capable key. Restricted worker calls still require exact workflow authorization and operation-specific entitlement.
- Track support/access per provider, component type and operation. A failed Duffel Stays operation cannot disable Flights or Viator, and Flights credentials cannot establish Stays verification. Do not inject a Duffel write key to make a disallowed read work.
- Revalidation uses only documented side-effect-free operations. HTTP method alone does not determine safety: a POST search/pricing call may be read-only, while any reserve/hold/cart operation is disallowed. Verify semantics before declaring the capability supported.
- Fixed provider base URLs and typed operations prevent arbitrary URL/method forwarding. Bound request/response sizes, abort/deadline behavior, concurrency and rate-limit handling. No automatic retries of writes; safe read retries remain inside the original deadline.
- Known missing/expired/revoked auth, wrong scope, unavailable market, approval or prerequisite produces blocked/unknown readiness with a safe resolution, not live success. Partial configuration must not prevent unrelated available products/providers or accepted-trip reads. Deferred rail produces an explicit unsupported outcome even for rail-only queries; no fallback supplier, synthetic rail offers or successful-empty result hides deferral.
- Sensitive identity/payment handling is not implemented by an agent/browser collection form. The current payment helper alone does not establish prerequisite fulfillment. Until an approved trusted server reference is available, booking is blocked and explains the missing prerequisite. Never substitute synthetic identity/payment in live mode.

## Required evidence before live activation

For each enabled operation record approved provider contract/version, access approval, scoped secret provisioning, actual supported market/party/property/fare coverage, current price/mandatory cost/material-term evidence, provider limits, authenticated status evidence and safe duplicate prevention. Test provider-specific timeouts and uncertain writes in the permitted environment. Store safe evidence references rather than customer data or raw secrets. If status reconciliation is unavailable, declare manual resolution and prohibit blind retries; do not claim unsupported recovery automation.

Evidence statuses are `implemented`, `deterministically_verified`, `provider_test_verified`, `live_access_verified`, and `externally_blocked`, with dates and safe references. These are separate dimensions rather than a single checkbox: deterministic success cannot set live access. Operational approval must explicitly enable each capability. No deployment or commercial approval is performed by planning.

## Privacy and operational checks

Customer/agent output is allowlisted and includes only payable prices, safe facts and status. Protected supplier economics, credentials, payment details and sensitive traveller data are absent from outputs, logs, exception text, MCP tracing and general telemetry. Restricted audit evidence includes request/attempt/component IDs, version/hash, actor, timestamps and safe outcomes sufficient to establish authorization and possible commitment. Existing retention/hold policy applies.

Activation checks cover absent/revoked credentials, rate limiting, unsupported coverage, read outage, abort, malformed nested payloads, stale evidence, missing mandatory costs, duplicate requests, partial/uncertain results, status conflicts and unavailable support automation. UI clearly separates unavailable live capabilities from a successful search with no matches.
