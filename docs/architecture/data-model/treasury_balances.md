### treasury_balances
**`SD-M5-03`**, INV-M5-11. The reserve coverage ratio's anchor.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `account_code` | text | not null, pk part | |
| `as_of` | timestamptz | not null, pk part | |
| `balance_cents` | bigint | not null | |
| `source` | text | not null, check in (`provider_api`,`manual_attestation`) | |
| `recorded_by` | uuid | fk users, null | |
| `recorded_at` | timestamptz | not null default now() | |

Primary key: composite `(account_code, as_of)`.
Constraints: `treasury_balances_attestation_has_author` (an attestation with no human attached is not an attestation).
Retention: forever.
Why it is anchored outside our own ledger: the RCR decides whether sales pause, and computing it from our own ledger makes it a number that agrees with itself. It is anchored to the **rail's** reported balance; when the rail cannot be queried, to a dated manual attestation that is visibly stale rather than silently wrong.
**Deviation from §1 recorded rather than smoothed:** `recorded_at` and no `created_at`, for the same reason as `ledger_transactions`.
