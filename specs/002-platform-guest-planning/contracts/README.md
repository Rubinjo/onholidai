# Feature Contracts

These additive contracts extend the existing Next.js BFF and do not replace authoritative trip, agent, supply, booking or privacy schemas.

- [Planning API](planning-api.md): session/draft/places/intent/link routes, actor resolution, errors and permission matrix.
- [UI contract](ui-contract.md): route/step/state/focus/theme behavior.
- [Data model](../data-model.md): durable entities and exact constraints.

Browser planning command shapes remain compatible. Legacy agent wire userId means stable planning principal; booking userId/executionBasis.ownerUserId means registered account. Neither is selectable by a browser as an owner field. Explicit server arguments resolve the distinction.

Regression must exercise old account principals, linked principals whose ID differs from account ID, revoked pre-link service grants, all guest denials at booking and preserved exact-term authorization.
