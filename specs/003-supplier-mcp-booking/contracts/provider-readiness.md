# Provider access, credential and readiness contract

Extend existing adapter capabilities and typed composition; do not add another provider abstraction. Every deployment records per-provider/per-operation support, actual access, mode, market/party/property coverage, approved API contract/version, authentication requirements, scope limitations, read-only semantics, deadline/rate/freshness policy, idempotency and status evidence. Unknown values remain unknown and block claims of verified live capability.

## Provider-specific baseline

| Provider | Read implementation target | Restricted write target and activation gate |
| --- | --- | --- |
| Booking.com Demand | Approved accommodation search/details/availability, preserving hotels/apartments/other supported property types and room/product/occupancy facts | Orders only with separately established book access and trusted prerequisites; affiliate/search/redirect access is not integrated booking approval |
| Duffel | Offer search plus complete current offer detail and pricing evidence for selected services/mandatory fees | Orders/payment semantics, exact terms, safe idempotency/status and trusted passenger/payment references must be verified |
| Trainline | Deterministic rail reads/detail/revalidation; approved partner wire mappings only when supplied | Partner docs, credentials, market/carrier rights, booking semantics, limits, status/idempotency and approvals required; do not invent endpoints |
| GetYourGuide | Approved reseller Partner API tour/option/detail/availability/pricing reads | Partner booking/status access and approved semantics; no cart/reservation operation in MCP; inbound inventory Supplier API is not this integration |

Primary sources and the distinction between public documentation and deployment access are recorded in [research.md](../research.md). Public documentation alone is never evidence of OnHolid.ai credentials or commercial approval.

## Configuration and composition

- Existing deterministic mode remains default; it explicitly reports demonstration mode in all results and reviews. Provide both read and restricted transaction doubles through existing composition roots so the stock worker's empty registry does not silently block acceptance.
- Replace the generic travel API key assumption in current typed configuration with explicit operation-level provider configuration and readiness. Keep service/auth/pricing-diagnostic keys distinct. Configuration records secret references, not values in public readiness or evidence reports.
- Provider read secrets exist only in the web read-client composition. Transaction secrets exist only in booking-worker composition. Agent/MCP receives neither. Where providers cannot independently scope read keys, use separate secret injection and code-level endpoint allowlists and disclose the upstream scope limitation.
- Revalidation uses only documented side-effect-free operations. HTTP method alone does not determine safety: a POST search/pricing call may be read-only, while any reserve/hold/cart operation is disallowed. Verify semantics before declaring the capability supported.
- Fixed provider base URLs and typed operations prevent arbitrary URL/method forwarding. Bound request/response sizes, abort/deadline behavior, concurrency and rate-limit handling. No automatic retries of writes; safe read retries remain inside the original deadline.
- Known missing/expired/revoked auth, wrong scope, unavailable market, approval or prerequisite produces blocked/unknown readiness with a safe resolution, not live success. Partial configuration must not prevent unrelated available providers or accepted-trip reads.
- Sensitive identity/payment handling is not implemented by an agent/browser collection form. The current payment helper alone does not establish prerequisite fulfillment. Until an approved trusted server reference is available, booking is blocked and explains the missing prerequisite. Never substitute synthetic identity/payment in live mode.

## Required evidence before live activation

For each enabled operation record approved provider contract/version, access approval, scoped secret provisioning, actual supported market/party/property/fare coverage, current price/mandatory cost/material-term evidence, provider limits, authenticated status evidence and safe duplicate prevention. Test provider-specific timeouts and uncertain writes in the permitted environment. Store safe evidence references rather than customer data or raw secrets. If status reconciliation is unavailable, declare manual resolution and prohibit blind retries; do not claim unsupported recovery automation.

Evidence statuses are `implemented`, `deterministically_verified`, `provider_test_verified`, `live_access_verified`, and `externally_blocked`, with dates and safe references. These are separate dimensions rather than a single checkbox: deterministic success cannot set live access. Operational approval must explicitly enable each capability. No deployment or commercial approval is performed by planning.

## Privacy and operational checks

Customer/agent output is allowlisted and includes only payable prices, safe facts and status. Protected supplier economics, credentials, payment details and sensitive traveller data are absent from outputs, logs, exception text, MCP tracing and general telemetry. Restricted audit evidence includes request/attempt/component IDs, version/hash, actor, timestamps and safe outcomes sufficient to establish authorization and possible commitment. Existing retention/hold policy applies.

Activation checks cover absent/revoked credentials, rate limiting, unsupported coverage, read outage, abort, malformed nested payloads, stale evidence, missing mandatory costs, duplicate requests, partial/uncertain results, status conflicts and unavailable support automation. UI clearly separates unavailable live capabilities from a successful search with no matches.
