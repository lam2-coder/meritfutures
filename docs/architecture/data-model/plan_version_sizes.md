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
Triggers: `plan_version_sizes_published_immutable` ([`0066`](../../../packages/db/migrations/0066_published_size_grid_immutable.sql), running `assert_published_plan_version_size_immutable()`). **A row here may be written only while its parent `plan_versions` row is `draft`**: `INSERT`, `UPDATE` and `DELETE` are all refused once the version is `published` or `retired`, and both ends of an `UPDATE` are checked, so a row cannot be moved onto or off a published version either. The refused set is derived as *not `draft`* rather than listed, so a status a later migration adds is refused by default. [ADR-213](../../decisions/ADR-213.md).

> **This line read "Immutable once the parent version is published (same trigger)" from the day the table landed until 2026-08-29, and there was no such trigger.** `0028` pins the parent row; `plan_version_sizes` carried zero triggers, and `buffer_cents` was measured moving from `100000` to `777777` on a published version with the whole grid then deleting. **The record claiming the guard is why nobody looked for it**, and no gate can see this class: `CI-06i` reconciles the table set and [`data-model-columns.mjs`](../../../scripts/corpus/data-model-columns.mjs) reconciles columns, and nothing reconciles a record's trigger prose against the `CREATE TRIGGER` statements in the migrations. [`plan_versions.md`](plan_versions.md) records the neighbouring half, about a trigger whose NAME was wrong.

**Why the `INSERT` is refused and not only the `UPDATE`**: `validatePlan(rules, sizes)` runs at the publish transition and takes the WHOLE grid, eight of the nineteen `CV` rules being evaluated once per size row. Of those eight only `CV-11` has a constraint here, and `CV-09`, `CV-10`, `CV-12`, `CV-17` and the `floor_lock_enabled` materialization check have none, three of them because they read the parent's `rules` jsonb. A row added after publication is a row nothing validated. Adding a size is done by publishing a version, which is what [`0044`](../../../packages/db/migrations/0044_fee_back_and_ladder_unlock.sql)'s `plan_size_unlocks` already assumes when it keys an entitlement to a `size_cents` rather than to a row.
Why `SD-10` is a materialized column rather than a trigger: the enabling flag lives in the parent's `rules` jsonb at `phase_funded.drawdown.lock.enabled`, and a CHECK constraint cannot read another table. A trigger is the weaker control, because it can be disabled and it fires per row rather than per constraint, so the flag is materialized here alongside every other value this table materializes at publish. The publish path writes both and CV-publish validation asserts the materialized flag matches the parent's jsonb.
Why the second half of the lock constraint matters as much as the first: an enabled lock published without its values does not fail, it **silently never locks**; and a disabled lock carrying stale values is a lock that turns on with the wrong numbers the day someone flips the flag.
Why `buffer_clears_lock` is here: together with R-48 it is INV-21, a settled payout can never breach the account that earned it.
