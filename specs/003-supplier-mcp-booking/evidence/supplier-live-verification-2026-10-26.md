# Live supplier access verification — 2026-10-26

Docker Compose stack, `PROVIDER_MODE=live`, `NUITEE_ENVIRONMENT=sandbox`,
`VIATOR_ENVIRONMENT=sandbox`. Calls were issued from inside the running
`web` container with the same credentials the process resolves through
`readSecretRef`, so these results describe the deployed web process's access,
not a separate developer machine.

No credential, token fragment or account identifier is recorded here.

## Duffel — flight search verified

Credential: `DUFFEL_READ_SECRET` (see deviation note below).

```
POST https://api.duffel.com/air/offer_requests?return_offers=true
Authorization: Bearer <DUFFEL_READ_SECRET>
Duffel-Version: v2
{"data":{"slices":[{"origin":"AMS","destination":"NRT","departure_date":"2026-11-10"}],
"passengers":[{"type":"adult"}],"cabin_class":"economy"}}
```

Result: `201`, `data.offers` populated (offer `off_034mVFjBoya6J8RSv4Ns12`),
`live_mode: false` at 2026-10-26T07:53:28Z.

Declared: `duffel.products.flight.operations.search` = `verified`,
`verifiedAt` 2026-10-26T07:52:00Z.

Notes:

- `live_mode: false` confirms this is a Duffel **test** token; results are test
  inventory, not production inventory.
- Deviation from the recommended posture: the transaction credential is also
  provisioned as `DUFFEL_READ_SECRET` by explicit product decision, because a
  separate discovery token was unavailable. The web process receives only
  `DUFFEL_READ_SECRET`, so `validateSupplierSecrets` has no second value to
  compare and no booking authority is added to web. Revisit this if a
  dedicated discovery credential is provisioned.
- Only `search` is declared. Offer detail, revalidation and all booking
  operations remain undeclared/unverified.

### Duffel client limitation observed (not an access failure)

The same offer request issued through the deployed web composition
(`createConfiguredPlanningProviders` -> `duffel-http.ts`) fails with
`SupplyReadError("error")`. `read-http.ts` aborts any response larger than
1 MiB, and `return_offers=true` responses in Duffel test mode are far larger:

| Route (round trip, 1 adult) | HTTP | Response bytes |
| --------------------------- | ---- | -------------- |
| AMS-LHR                     | 201  | 39,878,026     |
| AMS-BLL                     | 201  | 18,003,213     |
| AMS-NCE                     | 201  | 44,916,483     |

So `search` access is verified, but every Duffel flight search currently yields
the `error` outcome (inventory unknown) before mapping. This is resolved by
paging offers; see "Resolution applied" below.

## Viator — activity search verified

Credential: `VIATOR_SECRET`.

```
POST https://api.sandbox.viator.com/partner/products/search
exp-api-key: <VIATOR_SECRET>
{"filtering":{"destination":"334"},"pagination":{"start":1,"count":1},"currency":"EUR"}
```

Result: `200`, `products` populated (product `28575P41`) at
2026-10-26T07:53:05Z. This is the exact operation and payload shape the
planning client issues.

The same search executed through the deployed web composition
(`createConfiguredPlanningProviders`) with `providerPlaceIds["viator:destination"] = "334"`
returned products successfully, so the full client path (request, mapping,
discovery hits) works for Viator.

Declared: `viator.products.activity.operations.search` = `verified`,
`verifiedAt` 2026-10-26T07:53:00Z. `accessTier` remains `affiliate_basic`;
merchant/status operations stay undeclared.

## Nuitee — credential reachable, operation intentionally not declared

```
GET  https://api.liteapi.travel/v3.0/data/hotels?countryCode=JP&cityName=Tokyo&limit=1  -> 200
POST https://api.liteapi.travel/v3.0/hotels/rates                                        -> 200
```

The sandbox key works, but this deployment does not inject the trusted
`staySearch` resolver (`createApplication` is invoked without
`supplierMappings`), so `NuiteeHttpClient.selection()` rejects every query with
an explicit access prerequisite. Declaring `verified` would advertise a
capability no trip can use, so `nuitee` stays `configured_unverified`.

## Not verified by this record

Rail (unsupported), Duffel stays (legacy/inactive), all booking, cancellation
and status operations, Viator merchant entitlement, payment access, and any
production-environment access.

## Known remaining blocker for end-to-end live planning

Default Flights and Viator resolvers require trusted supplier place IDs on the
saved trip: `providerPlaceIds["duffel:flight"]` (IATA) and
`providerPlaceIds["viator:destination"]` (numeric supplier destination ID).
The setup flow currently persists only `providerPlaceIds["lookup"]`
(Google Place ID), so live searches return explicit unsupported coverage until
those mappings are persisted at destination selection or injected through
`supplierMappings` in `createApplication`.

## Resolution applied

Both blockers were addressed in code:

1. Destination selection now persists supplier identities. An OurAirports
   airport contributes `duffel:flight` from its own IATA code (offline), and
   cities/countries are resolved at selection through
   `GET /api/v1/places/viator-destination`, which records
   `viator:destination` only for a unique exact name match.
2. Duffel search now creates the offer request with `return_offers=false` and
   reads one bounded page:
   `GET /air/offers?offer_request_id=…&limit=32&sort=total_amount`
   (397 KB / 32 offers / EUR for AMS-NRT), which stays inside the 1 MiB client
   limit.

Verified against the live sandbox APIs after the change: the paged Duffel
search returns 32 offers, and the Viator destination lookup resolves
`Tokyo` to destination `334`.

## Follow-up (2026-10-26T11:45Z) — gateway identities and Nuitee stays

### Flight gateway resolution is supplier-authoritative

Setup no longer has to persist an IATA code for a country or city selection.
`duffel-http.ts` resolves the destination and a code-less city departure
through `GET https://api.duffel.com/places/suggestions?query=<name>` with the
same read token, so Duffel itself decides which airport it serves.

| Query         | HTTP | Latency | Resolved                            |
| ------------- | ---- | ------- | ----------------------------------- |
| `Japan`       | 200  | 61 ms   | city `Tokyo` -> `HND` (then `NRT`)  |
| `Netherlands` | 200  | 63 ms   | `AMS` (then `RTM`, `EIN`)           |
| `Tokyo`       | 200  | 56 ms   | city `Tokyo` -> `HND`, `NRT`, `OKO` |
| `Amsterdam`   | 200  | 169 ms  | `AMS`                               |
| `Portugal`    | 200  | 58 ms   | `LIS` (then `OPO`, `FAO`)           |

A stored `providerPlaceIds["duffel:flight"]` still wins when present. A failed,
malformed or ambiguous lookup yields no airport (source stays `unsupported`), so
no IATA code is ever invented. Resolution is cached in-process for ten minutes.

This replaces demographic guessing: the bundled catalogue previously ranked
`RTM` above `AMS` and `FUK` above `HND` because airport rank came from the
nearest settlement's population. The generator now records `airportClass` and
uses the population of the city the airport actually serves, which fixes
place-search ordering, while flight identity stays with Duffel.

### Nuitee stays verified with an internal destination mapping

```
GET  https://api.liteapi.travel/v3.0/data/places?textQuery=Japan&countryCode=JP   -> 200 (113-310 ms)
POST https://api.liteapi.travel/v3.0/hotels/rates                                  -> 200 (154-469 ms, 78 KB, 21 hotels / 20 usable offers)
GET  https://api.liteapi.travel/v3.0/data/places?textQuery=Tokyo&countryCode=JP   -> 200 (15 ms cached)
POST https://api.liteapi.travel/v3.0/hotels/rates                                  -> 200 (2873 ms, 5 hotels)
GET  https://api.liteapi.travel/v3.0/data/hotels?countryCode=JP&cityName=Tokyo&limit=5 -> 200 (1607 ms)
```

A place-based page exposed one supplier inconsistency: hotel `lp741d4` reported
`offerRetailRate` 1174.85 while its own `retailRate.total` was 1174.86. The
mapper used to reject the whole search on that one-cent disagreement. It now
drops only the inconsistent offer and still fails the search when every offer on
the page is inconsistent, so no price is ever substituted or rounded.

`createConfiguredPlanningProviders` now supplies a trusted `staySearch`
default: guest nationality comes from the confirmed departure country (the only
residence fact setup collects), one occupancy carries the exact party and child
ages, and the destination name plus country are resolved to a LiteAPI place id
by the adapter before rates are read. The previous `() => null` mapping made
every Nuitee search return `access_blocked` regardless of access, which is why
the declaration stayed `configured_unverified`.

Declared: `nuitee.products.accommodation.operations.search` and `.detail` =
`verified`, `verifiedAt` 2026-10-26T11:45:00Z, environment `sandbox`.

Stays remain **sandbox** access: rates and totals are test inventory, and
prebook, payment, cancellation and booking are still undeclared.

### Viator sandbox latency is unresolved

Activities did not gain a verified path in this follow-up. Repeated sandbox
`products/search` calls for a Japan destination took 23 s, 31 s and then
40 s/`500` (with and without date filters, and at page sizes 5, 16 and 32), and
`search/freetext` returned `500` for `Tokyo`. Every attempt exceeds the pinned
8-second source-search budget, so activity coverage degrades to `deadline`
rather than blocking the estimate. This is supplier-side behaviour, not an
access, payload or client defect, and no timeout was widened to hide it.
