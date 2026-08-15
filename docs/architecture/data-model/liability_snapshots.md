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

Indexes: unique `liability_snapshots_as_of_uq (as_of)`.
Retention: forever.
**Deviation from §1 recorded rather than smoothed:** `computed_at` and no `created_at`.

> **OI-01 is open and this section is the reason it stays open.** The approved design carried a different shape: keyed on `snapshot_on date`, with `funded_accounts`, `reserve_cents`, `cvar99_cents`, `rcr_bp` and `per_plan`. **The migration is the truth and the table above is what exists.** The four reserve-coverage fields have **no home in the folded shape**, and the reserve coverage ratio is the number that decides whether sales pause, so they need one before [M06](../../plans/M06-admin-ops-console.md) is built.
>
> **Recommendation, for a ruling rather than a quiet reconciliation: give them their own table rather than widening this one.** Three reasons, in order of weight. **This table's whole purpose is EC-095**, three named liability numbers that are never collapsed into one, and a coverage ratio is a fourth kind of fact that re-collapses the distinction the table exists to enforce. **The cadences differ**: coverage is a ratio of `treasury_balances` (the rail's clock, `SD-M5-03`) to `bounded_near_term_cents` (ours), and one row forces one `as_of` on two sources that do not move together. **And a ratio stored beside its own numerator invites recomputation drift**, where the stored `rcr_bp` and the stored `bounded_near_term_cents` disagree with each other in the same row. The alternative, widening `liability_snapshots` with five nullable columns, is cheaper today and makes every historical row carry five nulls that mean "not measured" and "zero" indistinguishably.
