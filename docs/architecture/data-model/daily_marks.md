### daily_marks
The only input the rules engine reads.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | |
| `account_id` | uuid | fk accounts, not null, on delete restrict | |
| `trading_day` | date | not null | **Unit: trading day**, the day this mark closes. |
| `opening_balance_cents` | bigint | not null | |
| `closing_balance_cents` | bigint | not null | |
| `high_balance_cents` | bigint | not null | |
| `low_balance_cents` | bigint | not null | the breach comparison input: the day's low against `rule_states.floor_open_cents` |
| `realized_pnl_cents` | bigint | not null | signed, because it is a movement |
| `fill_count` | integer | not null default 0, check >= 0 | |
| `traded_day` | boolean | not null | `fill_count > 0`. Stored rather than derived because the engine reads it on every day of every account |
| `win_day` | boolean | not null | `realized_pnl_cents >= win_day_floor_cents` at the account's **pinned** plan version, never against a current parameter |
| `adjustment_cents` | bigint | not null default 0 | **`SD-01`.** Signed non-trading movement (a settled withdrawal today, a promotional credit later), applied at the **open** of the effective trading day (R-10, `payout_requests.effective_trading_day`), never inside a session |
| `source_hash` | bytea | not null | digest of the exact input rows; what makes a recomputation provably the same computation |
| `source` | text | not null, check in (`report`,`api`,`recomputed`,`simulated`) | **B3 reservation** |
| `ingest_file_id` | uuid | fk ingest_files, null, on delete restrict | **B3 reservation** (`report_file_id`), null when recomputed |
| `superseded_by` | bigint | fk daily_marks, null, on delete restrict | a correction produces a **new** mark row and points the old one here |
| `computed_at` | timestamptz | not null default now() | |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `daily_marks_live_per_account_day_uq (account_id, trading_day)` where `superseded_by is null` (exactly one live mark per account per day, §13's invariant enforced by an index rather than by a job); `daily_marks_trading_day_idx (trading_day)`; `daily_marks_account_day_desc_idx (account_id, trading_day desc)`; `daily_marks_superseded_idx (superseded_by)` where not null.
Constraints: `daily_marks_inv19_closing_identity` (**`INV-19`**: `closing = opening + realized_pnl`, superseding `daily_marks_balance_arithmetic` under [EC-157](../../edge-cases/EC-157.md)'s **Repair A**, ruled 2026-08-16, in [`0036`](../../../packages/db/migrations/0036_supersede_daily_marks_balance_arithmetic.sql)); `daily_marks_high_bounds_day`; `daily_marks_low_bounds_day`; `daily_marks_traded_day_matches_fills`; `daily_marks_win_day_implies_traded` (a win day recorded on an untraded day is a counter that advanced for free); `daily_marks_no_self_supersede`.
Append-only, including supersession, and `superseded_by` is one of the two ruled single-column exceptions in §17. Retention: forever.
Why `SD-01` is a money-path column rather than bookkeeping: without it a settled payout of $2,500 leaving the platform balance is **indistinguishable from a $2,500 trading loss**. The breach check would compare a balance reduced by the trader's own earnings against a floor that has not moved, and breach the account that earned the payout (EC-034). The floor is recomputed in the same step as the balance drop so the two move together (R-48); those two plus CV-11's buffer clearance are INV-21, which GS-065 asserts directly.
Why supersession rather than update: replay must be able to show what we believed on the day and what we believe now. An `UPDATE` erases the first answer, and the first answer is what a settled payout was based on (B4 #5).
Carried risk: `V-M2-05`. If non-trading movements are **not** applied between sessions and are not distinguishable in the vendor's report, this table needs an intraday adjustment timestamp and M01's breach comparison changes shape. The column assumes the between-sessions answer, which is what the corpus assumes everywhere, and the vendor call is what confirms it.

**This row said `daily_marks_balance_arithmetic` (**INV-18**: `closing = opening + realized_pnl + adjustment`) until 2026-08-16, and it is NEITHER M01 identity.** `INV-18` is the opening identity (`opening == prior.balance + adjustment`) and `INV-19` is the closing one; `closing = opening + realized_pnl + adjustment` appears nowhere in M01. **The wrong label is how the wrong identity became authoritative**: a reader checking whether the schema enforced `INV-18` found a constraint that said it did, and the constraint added the adjustment a second time, inside the day. Worked in integer cents on the case `SD-01` exists for, the constraint refused the mark for **every settled payout** ([EC-157](../../edge-cases/EC-157.md)).

**`INV-18` is not enforceable here and that cost is accepted rather than hidden.** It reads `prior.balance_cents`, which lives in `rule_states`, and a `CHECK` cannot see across rows. It is asserted where it always was: by [M02](../../plans/M02-rithmic-bridge.md) before the engine sees the mark (`INV-M2-06`) and by the engine at `DO-3`, which returns an `AssertionFailure` and raises reconciliation rather than throwing (`R-07`, [EC-047](../../edge-cases/EC-047.md)).
