# Supplier discovery contract

Proposed additions to existing `contracts/supply`, agent tools and trip route families. These are design contracts, not claims that endpoints exist. Zod/Pydantic exports remain canonical; do not hand-maintain a separate MCP offer schema.

## MCP surface

First-party server identity: `onholidai-suppliers`. Transport: FastMCP in-memory client/server within the existing agent runtime. Each trusted run/resume constructs an isolated facade capturing its request/store and approved offer grants. All four tools have read-only, non-destructive annotations; enforced handler permissions, not annotations, provide safety. No arbitrary proxy, arbitrary URL, provider method name, booking, payment, cancellation, rescheduling or booking-status tool is registered.

Tool arguments are closed typed objects: reject unknown fields/coercions that bypass validation. No owner/trip/run/version/token/credential is model-settable. Context derives from the trusted request and is reverified by the web endpoint. Read evidence persistence is allowed; trip mutation/provider transactions are not.

| Tool | Typed model-visible arguments | Structured result |
| --- | --- | --- |
| `supplier_search` | `componentTypes`: nonempty unique array of flight/accommodation/activity/rail, max 4; `destinationIds`: UUID array max 8; `startDate`, `endDate`: ordered ISO dates; optional `departurePlaceId`: approved place reference; optional `requirementIds`: derived IDs in the current context; optional property-type filters bounded by declared support | bounded offer summaries/references, source mode, query fingerprint, provider outcomes and relevant capability limitations |
| `supplier_offer_details` | `offerRef`: bounded opaque reference; `revision`: positive integer | current known public PlanningOffer revision and evidence state, or explicit unavailable/expired/unknown/unsupported outcome |
| `supplier_revalidate_offer` | `offerRef`, `revision` as above | exactly one unchanged/changed/unavailable/unknown/unsupported/expired outcome, checked/expiry, material differences and current public offer revision where established |
| `supplier_capabilities` | optional `componentTypes` bounded as search | safe per-provider operation support/access, supported filters/types, relevant coverage/limits/prerequisites and limitations |

Currency, party, origin, accepted constraints, eligible requirements and trip/version are derived server-side. Search dates/destinations/origin must fit the current authoritative planning scope. If an existing planner legitimately explores a new route, use its existing validated research/proposal scope; arbitrary model arguments cannot expand it. Provider native IDs are never authority to fetch unrelated inventory.

Active inventory is Duffel flight/accommodation and Viator activity only. Keep rail in query types for compatibility, but every rail request (including rail-only) returns explicit unsupported/deferred capability information without a Trainline call, replacement provider or synthetic offer. Absence of rail must not reject a mixed request or discard its supported results. Capability support/access is product/operation-specific so Duffel Flights access cannot imply Stays access. The four-tool count is independent of the two-provider/three-product scope.

Detail/revalidation references must belong to the current run's stored offers or server-approved imported selections. Browser-created refinements may import selected references from earlier same-owner/trip/current-version research only after access validation. A reference from another run without that grant is denied, including same-owner unrelated work. A new revision does not mutate old evidence or accepted trip state.

## Public result fields

Reuse the extended public PlanningOffer shape from [data-model.md](../data-model.md). Include requirement/selection group, source attribution and mode, component/service/property type, safe details, party/occupancy eligibility, customer price/currency/tax/fee facts, availability, terms/evidence, check/expiry and unknown reasons. Incomplete source facts are nullable/unverified, never fabricated to meet accepted-component requirements. Summaries are bounded; full safe detail is retrieved explicitly. Maximum 32 offers per search, with fair allocation across requested requirements/types and no duplicate inventory/context revision.

Provider search outcome is separate from inventory outcome:

| Search status | Meaning |
| --- | --- |
| `available` | Search completed and returned offers |
| `no_matches` | Search completed with no matching inventory |
| `unconfigured` / `access_blocked` | Required credentials/approval/coverage not established |
| `unsupported` | Operation/filter not supported |
| `rate_limited` | Retry guidance applies; no inventory conclusion |
| `deadline` / `error` | Truth could not be established; no inventory conclusion |

Each source includes a safe reason, retry eligibility/time when known and unknown-fact count. No fake successful source is manufactured when the live registry is empty. Every requested revalidation yields an explicit outcome; unchanged requires affirmative current matching evidence, and changed includes differences. Expiry cannot be extended locally without evidence. Estimated, quoted and live-revalidated labels do not imply inventory is held.

Use provider plus component type/requirement to identify source outcomes and fairly allocate the 32-offer bound; do not merge Duffel flight and accommodation evidence or let one starve the other. Represent requested rail as an unsupported component-type outcome without inventing a replacement provider identity. Legacy saved supplier references retain their original attribution and cannot become newly verified current inventory through aliasing.

## Web routes and shared service

Retain `POST /api/v1/internal/trips/{tripId}/planning-search`; move its reusable search/persistence/projection logic into a small existing supply service function invoked by route handlers, not another provider facade hierarchy.

Proposed sibling internal reads:

- `GET /api/v1/internal/trips/{tripId}/planning-offers/{offerRef}?revision=...`
- `POST /api/v1/internal/trips/{tripId}/planning-offers/{offerRef}/revalidations` with expected offer revision
- `GET /api/v1/internal/trips/{tripId}/planning-capabilities`

All internal reads reuse `internalPlanningApiResponse`, `internalActor`, signed `web` audience/`trip:read` token, current run grant, trusted trip/version/request headers and record membership checks. No service credential grants booking access. Existing callback signing/clock/replay tests extend to these paths.

Browser search starts an existing agent run with `purpose: supplier_research`, request ID and expected trip version; extend existing run result read to return safe research references. Proposed browser sibling `planning-offers` detail/revalidation and `planning-capabilities` routes use existing planning resource/session/Origin protections and the same domain functions. Browser offer access derives ownership through source run/trip and current version, not the agent's active-run requirement. The browser never talks to MCP or receives internal credentials.

Selection passes an opaque offer reference/revision in a structured refinement request; server validates provenance/current scope and the existing proposal pipeline independently materializes/reprices it. Read-only research purpose cannot return mutation operations. Application policy remains immutable per existing run.

## Errors, limits and safety

Reuse the existing problem envelope/status conventions: validation 400/422, unauthenticated 401, inaccessible reference 403/404 without cross-owner disclosure, stale version/revision 409, rate limiting 429, bounded unavailable/deadline failure 503/504 where the entire read fails. Partial provider failures are structured outcomes in a successful search response, not loss of all results.

Enforce one <=12s overall research budget, current <=8s supplier ceiling, abort propagation and bounded payloads. No automatic retries by default; one rate-limit-directed safe read retry only if it fits. Apply existing guest/account run limits and provider/account request limits; no Redis or new quota service. Late response/revalidation uses expected revision and cannot overwrite newer evidence. Failed evidence persistence cannot return an unresolvable reference.

Duffel discovery uses only the separate read key; Stays quote/search operations must have established safe semantics and permitted read-key scope before use. Viator's shared upstream key stays in the trusted web client behind a closed non-transactional endpoint/method allowlist. Key scope does not grant model/tool authority, and a POST read is not automatically transactional or automatically safe. No discovery call may hold inventory or invoke booking/cart/cancellation/rescheduling; blocked semantics return unsupported instead of using privileged fallback.

URLs/text are data, never instructions. Allowlist schemes/fields and strip protected values before MCP/browser output, trace spans or exceptions. Do not log tool arguments, raw supplier responses, arbitrary detail strings, credential headers or sensitive context. Audit safe IDs/categories/duration/counts.

## Contract acceptance

Exercise actual MCP list/call operations, exact four-tool allowlist, strict input and structured output schemas, simultaneous run isolation, forged extra context fields, revoked/stale grants, cross-trip and ungranted cross-run references, approved selected-reference import, changed revisions, unknown facts, all property types, rate/deadline/outage/no-matches distinctions and secret canaries in nested output. Assert zero reservation/transaction calls and no accepted-trip version change for every read. Cross-language fixtures prove public schemas and generated outputs agree.
