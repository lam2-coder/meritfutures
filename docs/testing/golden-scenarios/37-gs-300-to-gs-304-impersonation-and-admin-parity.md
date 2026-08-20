---
status: approved
depends_on: [README.md]
last_updated: 2026-08-20
---

## 37. GS-300 to GS-304: impersonation and admin parity (FOLD-04)

`ADR-068` and `ADR-069`, planned by [FOLD-04](../../plans/FOLD-04-impersonation-and-admin-parity.md). **Both are reserved and unwritten**, and `ADR-068` is **auth and therefore money path**, so its session writes these rather than a fold session.

**GS-302 says `restricted` and the referral said suspended.** [`0001`](../../../packages/db/migrations/0001_extensions_and_enums.sql):27 declares `identity_status AS ENUM ('active','restricted','closed')` and [ADR-041](../../decisions/ADR-041.md) **refused** to add a fourth value. **A scenario written against `suspended` would be unwritable.** `closed` is `OQ-F4-04` and is deliberately not one of these five.

**Four of the five are negative scenarios**, which is the shape the capability demands: impersonation is defined far more by what it cannot do than by what it can.

| ID | Scenario | Pins |
|---|---|---|
| GS-300 | An impersonation session issues a payout request | **Rejected server side and alerted.** The rejection is an authorization decision, **not a hidden button**: the test calls the route directly, because a UI-only block is not a control |
| GS-301 | A session reaches its 30 minute expiry while a page is open | The next request is **refused**, not silently served. An impersonation session that outlives its box is the whole risk, and a page already rendered is not evidence the session is live |
| GS-302 | Impersonation of a **`restricted`** identity | **Permitted for visibility**, and every money surface that `restricted` already blocks stays blocked. Support needs to see a restricted account precisely because that is when the trader calls |
| GS-303 | **Negative:** an impersonation token is replayed against a trader route as a trader token | **Refused.** This is the session-type boundary and it is a database-level distinction under `0042`, not a middleware convention. A token that can be replayed makes every other control on this list decorative |
| GS-304 | The parity matrix is checked against the enumerated trader-side action set | **Every trader action has an `owner`-role admin equivalent, or an open question with a narrow-exception proposal.** A coverage test rather than a behaviour test: it fails when someone adds a trader route and no admin equivalent, which is how parity rots |
