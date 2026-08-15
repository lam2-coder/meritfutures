### plan_version_sizes
Materialized per-size thresholds. Percentages scale, but the published number must be exact, so it is computed once at publish and never recomputed at runtime.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `plan_version_id` | uuid | fk plan_versions, not null, on delete restrict | |
| `size_cents` | bigint | not null, check > 0 | the v1 sizes the file names are 2500000, 5000000, 10000000 and 15000000 |
| `price_cents` | bigint | not null, check > 0 | list price |
| `reset_price_cents` | bigint | not null, check > 0 | |
| `drawdown_cents` | bigint | not null, check > 0 | derived from `drawdown.amount_bp` |
| `profit_target_cents` | bigint | null, check > 0 | null on Direct: there is no evaluation, so there is no profit target. A zero here would be a target of zero, which is a different and reachable thing |
| `buffer_cents` | bigint | not null, check >= 0 | |
| `win_day_floor_cents` | bigint | not null, check > 0 | |
| `payout_cap_schedule_cents` | jsonb | not null | ordered steps keyed by payout ordinal; an array from day one even though v1 publishes one flat step. [ADR-025](../../decisions/ADR-025.md) rejected progressive cap release for v1 and the **shape** stays, because the reservation costs nothing and the retrofit does not |
| `daily_loss_limit_cents` | bigint | null, check > 0 | null when the plan has none, which is all three in v1 |
| `floor_lock_enabled` | boolean | not null | **`SD-10`.** Materialized from the parent's `rules` jsonb at publish, because a CHECK cannot read another table (see below) |
| `floor_lock_at_profit_cents` | bigint | null, check > 0 | **`SD-10`** |
| `floor_lock_floor_at_cents` | bigint | null, check > 0 | **`SD-10`** |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `plan_version_sizes_version_size_uq (plan_version_id, size_cents)`.
Constraints: `plan_version_sizes_floor_lock_complete` (**`SD-10`**: both lock values present when enabled, both absent when not); `plan_version_sizes_buffer_clears_lock` (CV-11: `size_cents + buffer_cents > floor_lock_floor_at_cents` whenever the lock is enabled).
Immutable once the parent version is published (same trigger).
Why `SD-10` is a materialized column rather than a trigger: the enabling flag lives in the parent's `rules` jsonb at `phase_funded.drawdown.lock.enabled`, and a CHECK constraint cannot read another table. A trigger is the weaker control, because it can be disabled and it fires per row rather than per constraint, so the flag is materialized here alongside every other value this table materializes at publish. The publish path writes both and CV-publish validation asserts the materialized flag matches the parent's jsonb.
Why the second half of the lock constraint matters as much as the first: an enabled lock published without its values does not fail, it **silently never locks**; and a disabled lock carrying stale values is a lock that turns on with the wrong numbers the day someone flips the flag.
Why `buffer_clears_lock` is here: together with R-48 it is INV-21, a settled payout can never breach the account that earned it.
