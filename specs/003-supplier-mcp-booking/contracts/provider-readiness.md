# Provider access, credential and readiness contract

Extend existing adapter capabilities and typed composition; do not add another provider abstraction. Every deployment records per-provider/per-operation support, actual access, mode, market/party/property coverage, approved API contract/version, authentication requirements, scope limitations, read-only semantics, deadline/rate/freshness policy, idempotency and status evidence. Unknown values remain unknown and block claims of verified live capability.

## Provider-specific baseline

| Provider                     | Read implementation target                                                                                                                             | Restricted write target and activation gate                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duffel Flights               | Flight search/current-offer/detail/pricing with separate read key and established read semantics                                                       | Separate write key, approved Orders/payment/status semantics, exact terms, safe duplicate prevention and trusted passenger/payment references                                                                       |
| Nuitee stays                 | Property details and hotel rates with trusted location/nationality/occupancy; safe revalidation only when no-hold/no-payment semantics are established | Approved environment/access/payment path; exact selected offer/room/guest/cost terms, booking/status correlation and durable duplicate prevention; shared key or prebook ID is not entitlement/idempotency evidence |
| Viator activities            | Partner API product/option/detail/availability/pricing behind a closed read-operation allowlist, using the single upstream key                         | The same upstream key in the worker, plus actual booking-tier entitlement and approved booking/status semantics; required booking questions resolved through trusted references                                     |
| Duffel Stays                 | Replaced by Nuitee; saved evidence only, no new search/detail-refresh/revalidation or fallback                                                         | Existing approved status reconciliation/confirmed commitments only, no new bookings or onboarding requirement                                                                                                       |
| Nuitee Flights / Experiences | Evaluated, inactive; shared authentication does not activate these products                                                                            | Future separately approved scope only; no default calls, synthetic inventory or automatic fallback                                                                                                                  |
| Booking.com / Trainline      | Deferred, no current onboarding or default synthetic/live inventory; rail requests explicitly unsupported                                              | Future features only; preserve legacy attribution/confirmed evidence and existing approved reconciliation without enabling new writes                                                                               |
| GetYourGuide                 | Replaced by Viator, not an active source or fallback                                                                                                   | Legacy compatibility/reconciliation only; no new access requirement                                                                                                                                                 |

Primary sources and the distinction between public documentation and deployment access are recorded in [research.md](../research.md). Public documentation alone is never evidence of OnHolid.ai credentials or commercial approval.

## Configuration and composition

**Approved demo reassignment (2026-10-24):** the user authorized a sandbox
shopping/detail test and then selected discovery-only use of the tested variable.
The explicit mapping is Duffel `readSecretRef: "DUFFEL_TRANSACTION_SECRET"` with
`transactionSecretRef` omitted. That variable is now the dedicated discovery
credential, not a configured worker credential. Keep validation of distinct
references/values whenever both roles exist; never infer roles from variable names
or fall back to an unreferenced value. The old discovery value is untouched and no
longer referenced. Demo/provider modes, operation verification declarations and
other supplier mappings remain unchanged. This test established sandbox reads
for a matching EUR query, not production access, FX conversion, final terms or
booking/payment authority.

- Existing deterministic mode remains default; it explicitly reports demonstration mode in all results and reviews. Provide both read and restricted transaction doubles through existing composition roots so the stock worker's empty registry does not silently block acceptance.
- Replace the generic travel API key assumption in current typed configuration with explicit operation-level provider configuration and readiness. Keep service/auth/pricing-diagnostic keys distinct. Configuration records secret references, not values in public readiness or evidence reports.
- Duffel discovery secrets exist only in web read-client composition; its separate booking secrets exist only in booking-worker composition. The discovery token must permit POST offer-request creation (upstream read-write if no narrower permission is available). `readSecretRef` describes the local discovery role, not a read-only upstream scope. Its fixed allowlist excludes consequential writes even when the dedicated token is write-capable; never fall back to or share the worker booking token. Nuitee and Viator each permit their shared upstream key/reference in trusted web/worker processes, without claiming separate scopes. Prefer narrower upstream permissions if established. No supplier secret reaches agent/MCP/browser.
- Trusted Nuitee/Viator web clients expose only fixed, documented, side-effect-free endpoint/method combinations, never arbitrary forwarding or transactional imports. Test that prebook/hold/cart/book/pay/cancel/reschedule operations cannot execute from discovery even with write-capable keys. Nuitee prebook is excluded unless approved evidence establishes a no-hold/no-reservation/no-payment variant; `usePaymentSdk=false` alone is not evidence. Restricted worker calls still require exact workflow authorization and operation-specific entitlement.
- Track support/access per provider, component type, operation and environment. A failed Nuitee stays operation cannot disable Duffel Flights or Viator. Hotel access cannot establish Nuitee Flights/Experiences verification. Missing trusted nationality/occupancy facts block affected rates requests; no credential elevation or synthetic live fallback.
- Viator `accessTier` is `unknown` (default), `affiliate_basic`, `affiliate_full`, `affiliate_full_booking` or `merchant`. Basic/full affiliate content access cannot enable this worker's merchant booking actions. Only merchant declarations can enable book/idempotency/cancel/reschedule in the current merchant lane; authenticated saved status additionally permits Full Access + Booking. Tier declaration alone never establishes implementation or entitlement: existing support, process credential, operation evidence and exact `VIATOR_ENVIRONMENT` match are still required. Missing/wrong-environment verification remains unverified. A sandbox Basic account must not be relabelled merchant or used for provider-hosted redirect checkout as a substitute for the required unified payment.
- Revalidation uses only documented side-effect-free operations. HTTP method alone does not determine safety: a POST search/pricing call may be read-only, while any reserve/hold/cart operation is disallowed. Verify semantics before declaring the capability supported.
- Fixed provider base URLs and typed operations prevent arbitrary URL/method forwarding. Bound request/response sizes, abort/deadline behavior, concurrency and rate-limit handling. No automatic retries of writes; safe read retries remain inside the original deadline.
- Nuitee opaque offer/rate tokens can exceed 256 characters and contain Base64 punctuation. Preserve exact tokens through private records, revision grants, accepted components, evidence/consent and restricted sources within the local 4,096-character bound; do not truncate, relabel or put them into arbitrary URL paths. Hotel/room/booking IDs retain their distinct validation. Offer-level money accepts the observed object and documented single-element-array forms without relaxing per-room array shape, currency, decimal or total-consistency checks. If enriched selling totals may already include property charges, expose an unverified/unknown customer price rather than double counting. HTTP 200 and successful normalization do not establish final-terms or write readiness.
- Known missing/expired/revoked auth, wrong scope, unavailable market, approval or prerequisite produces blocked/unknown readiness with a safe resolution, not live success. Partial configuration must not prevent unrelated available products/providers or accepted-trip reads. Deferred rail produces an explicit unsupported outcome even for rail-only queries; no fallback supplier, synthetic rail offers or successful-empty result hides deferral.
- Sensitive identity/payment handling is not implemented by an agent/browser collection form. The current payment helper alone does not establish prerequisite fulfillment. Until an approved trusted server reference is available, booking is blocked and explains the missing prerequisite. Never substitute synthetic identity/payment in live mode.

## Required evidence before live activation

The customer-payment direction is one payment to OnHolidai with separate
supplier settlement, not customer cards forwarded to each supplier. The
recommended target is approved Nuitee enterprise CREDIT, Duffel Balance and
Viator merchant settlement; the confirmed Basic affiliate tier is currently
insufficient. See [the funding decision](../research.md#2026-10-24-supplier-sufficiency-and-single-customer-payment-direction).
Customer PSP collection, supplier funding and final-term prebook permissions
are independent readiness gates. No payment processor or capture/refund policy
is implemented or activated by these declarations.

For each enabled operation record approved provider contract/version, access approval, scoped secret provisioning, actual supported market/party/property/fare coverage, current price/mandatory cost/material-term evidence, provider limits, authenticated status evidence and safe duplicate prevention. Test provider-specific timeouts and uncertain writes in the permitted environment. Store safe evidence references rather than customer data or raw secrets. If status reconciliation is unavailable, declare manual resolution and prohibit blind retries; do not claim unsupported recovery automation.

Evidence statuses are `implemented`, `deterministically_verified`, `provider_test_verified`, `live_access_verified`, and `externally_blocked`, with dates and safe references. These are separate dimensions rather than a single checkbox: deterministic success cannot set live access. Operational approval must explicitly enable each capability. No deployment or commercial approval is performed by planning.

### Implemented Nuitee restricted wire boundary

`NuiteeTransactionHttpOptions` accepts explicit environment-scoped operation and
final-terms evidence references plus approved payment methods. Its private
`resolveBooking` source must provide a validated `NuiteeBookingInput`, including
the exact durable attempt key/fingerprint, selected offer/inventory, normalized
provider confirmation basis and already approved holder/guest/payment payload.
Exported types describe this server-only boundary; unknown runtime source
values are still strictly parsed. No production source, prebook operation or
activation configuration is supplied by the factory.

`resolveStatus` may supply the original `NuiteeConfirmationBasis` without fresh
booking/payment authority. An authenticated correlated confirmation remains
evidence even if that source is unavailable; missing/changed material terms do
not become a copied unchanged confirmation. Missing actual booking ID requires
manual support. HTTP errors, duplicate-reference error 4005 and elapsed time do
not prove non-commit or permit retries. See the
[wire evidence](../evidence/provider-readiness.md#restricted-nuitee-transaction-wire-increment-2026-10-24).

## Privacy and operational checks

Customer/agent output is allowlisted and includes only payable prices, safe facts and status. Protected supplier economics, credentials, payment details and sensitive traveller data are absent from outputs, logs, exception text, MCP tracing and general telemetry. Restricted audit evidence includes request/attempt/component IDs, version/hash, actor, timestamps and safe outcomes sufficient to establish authorization and possible commitment. Existing retention/hold policy applies.

Activation checks cover absent/revoked credentials, rate limiting, unsupported coverage, read outage, abort, malformed nested payloads, stale evidence, missing mandatory costs, duplicate requests, partial/uncertain results, status conflicts and unavailable support automation. UI clearly separates unavailable live capabilities from a successful search with no matches.
