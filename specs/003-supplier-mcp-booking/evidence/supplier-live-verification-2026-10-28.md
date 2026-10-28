# Live supplier access verification — 2026-10-28

Production-environment verification for Nuitee/LiteAPI after the accommodation
credential was replaced with a production key and `NUITEE_ENVIRONMENT` was set
to `production`. `PROVIDER_MODE=live`.

Why this was needed: the Nuitee declaration carried `"environment":"sandbox"`
from the 2026-10-26 verification. `deriveProviderReadiness` only marks an
operation `verified` when the declared evidence environment matches
`NUITEE_ENVIRONMENT`, so live research classified accommodation search as
`access_blocked` ("Search access or a required supplier prerequisite is
blocked") even though the credential itself worked. Sandbox and production
keys are not interchangeable evidence.

Calls were issued from the local development host with the same credential the
web process resolves through `readSecretRef` (`NUITEE_SECRET`), so these results
describe the credential's production access.

No credential, token fragment or account identifier is recorded here.

## Nuitee — accommodation search and detail verified in production

```
GET  https://api.liteapi.travel/v3.0/data/places?textQuery=Paris&countryCode=FR
     -> 200, places returned (Paris, FR resolved to a LiteAPI place id)

POST https://api.liteapi.travel/v3.0/hotels/rates
{"placeId":"<paris>","checkin":"2026-11-10","checkout":"2026-11-12",
 "currency":"EUR","guestNationality":"NL","occupancies":[{"adults":2}],
 "timeout":10,"limit":5,"maxRatesPerHotel":1,"roomMapping":true}
     -> 200 (5.8 s, 18 KB, 5 hotels with dated room rates)
```

The request shapes match `nuitee-http.ts` (`placeFor` and `getRates`), including
the guest nationality and single occupancy the adapter derives from the
confirmed departure country and traveller party.

Declared after this verification:

- `nuitee.products.accommodation.operations.search` = `verified`,
  `environment` `production`, `verifiedAt` 2026-10-28T13:05:00Z
- `nuitee.products.accommodation.operations.detail` = `verified`,
  `environment` `production`, `verifiedAt` 2026-10-28T13:05:00Z

## Outstanding limitations

- Final stay revalidation and every transaction (`prebook`, payment,
  cancellation) remain undeclared and blocked by the adapter; only read
  operations are declared.
- Availability, prices and cancellation terms are production supplier data but
  are never reserved by research. A stay is only held after a reviewed booking
  attempt.
- A later `NUITEE_ENVIRONMENT` change (in either direction) requires fresh
  matching evidence, not just an enum change.
