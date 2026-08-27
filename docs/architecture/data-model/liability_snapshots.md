### liability_snapshots
**`SD-M6-01`**, EC-095: three named numbers, never one, each printed with its own definition. Showing one and calling it "liability" is how the FTT quote happens.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | |
| `as_of` | timestamptz | not null, unique | |
| `open_liability_cents` | bigint | not null | **1.** The sum of withdrawable across funded accounts |
| `bounded_near_term_cents` | bigint | not null | **2.** Sum of `min(withdrawable, cap for next ordinal)` over accounts eligible now or inside 7 trading days. The figure the payout wallet is funded against, and the one [ADR-011](../../decisions/ADR-011.md)'s top-up trigger reads |
| `remaining_ladder_exposure_cents` | bigint | not null | **3.** Sum of `(ladder - payouts_settled) * cap`. The upper bound on lifetime commitment; INV-17 asserts it. Read from the pinned plan version, never from a constant. [ADR-024](../../decisions/ADR-024.md) shortened the ladder to 5 / 5 / 4, so this number fell |
| `wallet_balances_cents` | bigint | not null | [ADR-019](../../decisions/ADR-019.md) made wallet balances part of Open Liability (INV-M5-15) |
| `absorbed_corrections_cents` | bigint | not null default 0 | signed. The absorbed-corrections line (OQ-10 ruling, M02 AS-M2-07) |
| `computed_at` | timestamptz | not null default now() | |
| `funded_accounts` | integer | not null, `>= 0` | **`OI-01`, added by [`0049`](../../../packages/db/migrations/0049_reserve_coverage_snapshots.sql).** `P-M6-01` is a sum "across funded accounts" and this is the count a reader needs in order to know whether that sum is one account or a thousand. [API_CONTRACT](../API_CONTRACT.md) renders it beside `as_of` and `open_liability_cents`, which is this table's grain. **NOT NULL with no default on purpose**: a defaulted zero is a number the dashboard would render and nobody counted |

Indexes: unique `liability_snapshots_as_of_uq (as_of)`.
Retention: forever.
**Deviation from §1 recorded rather than smoothed:** `computed_at` and no `created_at`.

> **`OI-01` CLOSES HERE**, by [ADR-128](../../decisions/ADR-128.md), and the ruling is the recommendation this section already carried rather than a new one. The approved design was keyed on `snapshot_on date` and named `funded_accounts`, `reserve_cents`, `cvar99_cents`, `rcr_bp` and `per_plan`. **The migration is the truth and the table above is what exists**, so the five were dispositioned one at a time against the migrations rather than as a group:
>
> | Field | Where it went |
> |---|---|
> | `reserve_cents`, `cvar99_cents`, `rcr_bp` | [`reserve_coverage_snapshots`](reserve_coverage_snapshots.md), a **separate table**, which is the recommendation below taken as written |
> | `funded_accounts` | **This table**, by `ALTER TABLE` in [`0049`](../../../packages/db/migrations/0049_reserve_coverage_snapshots.sql). It is not reserve coverage: it is the count behind `P-M6-01`'s own sum |
> | `per_plan` | **Nowhere, because it was never orphaned.** [API_CONTRACT](../API_CONTRACT.md)'s `per_plan` is loss ratio, threshold, `sales_paused` and CUSUM per plan, and [`plan_breaker_state`](plan_breaker_state.md) has carried exactly that since [`0016`](../../../packages/db/migrations/0016_treasury_controls.sql). `OI-01` had been counting an orphan that had a home for thirty-three migrations |
>
> **The recommendation, kept verbatim because it is what was ruled on rather than a summary of it: give them their own table rather than widening this one.** Three reasons, in order of weight. **This table's whole purpose is EC-095**, three named liability numbers that are never collapsed into one, and a coverage ratio is a fourth kind of fact that re-collapses the distinction the table exists to enforce. **The cadences differ**: coverage is a ratio of `treasury_balances` (the rail's clock, `SD-M5-03`) to `bounded_near_term_cents` (ours), and one row forces one `as_of` on two sources that do not move together. **And a ratio stored beside its own numerator invites recomputation drift**, where the stored `rcr_bp` and the stored `bounded_near_term_cents` disagree with each other in the same row. The alternative, widening `liability_snapshots` with five nullable columns, is cheaper today and makes every historical row carry five nulls that mean "not measured" and "zero" indistinguishably.
>
> **The third reason is answered rather than accepted.** `reserve_coverage_snapshots.rcr_bp` is a `GENERATED` column, so the ratio is computed by the database and cannot disagree with the two numbers stored beside it in the same row.
