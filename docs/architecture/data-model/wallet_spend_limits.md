### wallet_spend_limits
**`SD-M20-02`**, INV-M20-07, [SECURITY](../SECURITY.md) C-23.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `identity_id` | uuid | fk identities, not null, on delete restrict, pk part | |
| `daily_cents` | bigint | not null, check >= 0 | |
| `rolling_7d_cents` | bigint | not null, check >= 0 | |
| `reason` | text | not null | |
| `set_by` | text | not null | |
| `effective_from` | timestamptz | not null, pk part | |
| `created_at` | timestamptz | not null default now() | |

Primary key: composite `(identity_id, effective_from)`.
Indexes: `wallet_spend_limits_current_idx (identity_id, effective_from desc)`.
Constraints: `wallet_spend_limits_weekly_exceeds_daily` (a rolling weekly limit below the daily limit is a daily limit with a confusing name).
Per identity rather than global, and the reason is the whole design: the limit that matters is the one on **the compromised session**. A global limit either throttles legitimate traders or is set so high it does nothing, and in practice it is set so high it does nothing.
