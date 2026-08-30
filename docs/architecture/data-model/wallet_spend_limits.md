### wallet_spend_limits
**`SD-M20-02`**, INV-M20-07, [SECURITY](../SECURITY.md) C-23.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `identity_id` | uuid | fk identities, not null, on delete restrict, pk part | |
| `daily_cents` | bigint | not null, check >= 0 | |
| `rolling_7d_cents` | bigint | not null, check >= 0 | |
| `reason` | text | not null | |
| `set_by` | text | not null | |
| `effective_from` | timestamptz | not null, pk part | **AN INSTANT AND NOT A DAY, ruled correct by [ADR-276](../../decisions/ADR-276.md) clause 1**, and Merit's own clock rather than the exchange's. It is the sole non-subject member of the primary key with no `version` column beside it, so it IS the row's identity and two limits set for one identity on one day must be told apart: `SECURITY C-23`'s scenario is a limit tightened during an incident and relaxed after it, and a `date` here would make the second write a primary-key collision. The route says so in its own refusal, *"the grain is `(identity_id, effective_from)` and a limit is an APPEND, so two writes at one INSTANT collide"*. **No `**Unit:**` marker: `CI-06m` reads that marker on `date` rows only** |
| `created_at` | timestamptz | not null default now() | |

Primary key: composite `(identity_id, effective_from)`.
Indexes: `wallet_spend_limits_current_idx (identity_id, effective_from desc)`.
Constraints: `wallet_spend_limits_weekly_exceeds_daily` (a rolling weekly limit below the daily limit is a daily limit with a confusing name).
Per identity rather than global, and the reason is the whole design: the limit that matters is the one on **the compromised session**. A global limit either throttles legitimate traders or is set so high it does nothing, and in practice it is set so high it does nothing.
