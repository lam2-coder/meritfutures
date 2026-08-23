### rule_states
Per account **per trading day**, not a single current row. Roughly 250 rows per funded account per year, confirmed at the Wave 2 gate.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | |
| `account_id` | uuid | fk accounts, not null, on delete restrict | |
| `trading_day` | date | not null | **Unit: trading day**, the day this state closes. |
| `phase` | text | not null | phase as of end of this day |
| `floor_cents` | bigint | not null | the [floor](../../GLOSSARY.md#floor) that **survived** this day |
| `floor_locked` | boolean | not null default false | |
| `floor_open_cents` | bigint | not null | **`SD-04`.** The floor the day was **judged against**. On any day where the floor moved the two differ, and the evidence pack must be able to show which one produced a breach decision (EC-035). Without it, a breach explanation reads "your low was below the floor" while showing a floor the low was never compared to |
| `high_water_balance_cents` | bigint | not null | drives trailing, and **frozen permanently once `floor_locked`** (`R-15`, `R-13`), so after the lock a new closing high leaves this column **below** `balance_cents` and the row is correct (`GS-016`). Reset **downward** to `size_cents` at the funded reset (`R-31`). [ADR-053](../../decisions/ADR-053.md) scopes the bound below to the unlocked state for exactly that reason |
| `balance_cents` | bigint | not null | end-of-day balance |
| `withdrawable_cents` | bigint | not null, check >= 0 | derived, stored for query speed. §13's invariant, as a CHECK |
| `traded_days_count` | integer | not null, check >= 0 | |
| `win_days_count` | integer | not null, check >= 0 | resets to 0 after a settled payout, anchored on `payout_anchor_day` |
| `consistency_best_day_cents` | bigint | not null default 0 | numerator |
| `consistency_period_profit_cents` | bigint | not null default 0 | denominator; the gate is skipped when this is <= 0, which is why it is stored rather than inferred from a sign |
| `consistency_period_start_day` | date | null | **`SD-07`.** Derivable and stored anyway: it makes `engine_gates` self-describing in the portal and the evidence pack, and turns a class of off-by-one bugs into a visible field (EC-045, GS-068) **Unit: trading day**, the consistency window is counted in trading days from it. |
| `payouts_settled_count` | integer | not null, check >= 0 | drives the [ladder](../../GLOSSARY.md#payout-ladder) and the cap schedule. **Settlements, not attempts** (R-45, `SD-05`) |
| `payout_anchor_day` | date | null | **`SD-02`.** The last settled payout's **basis** day. Resets win days and starts the consistency period **Unit: trading day**, win days reset from it and the consistency period starts at it. |
| `cadence_anchor_day` | date | null | **`SD-02`.** That payout's **effective** day. Drives the [cadence gap](../../GLOSSARY.md#cadence-gap) **Unit: trading day**, the cadence gap is counted in trading days from it. |
| `engine_eligible` | boolean | not null | **`SD-06`.** The engine's verdict from **engine gates only**, replayable by construction |
| `engine_gates` | jsonb | not null | **`SD-06`.** Profit target, drawdown, win days, minimum days, consistency, cadence, cap, minimum payout. Replayable, **in the hash** |
| `context_gates` | jsonb | not null | **`SD-06`.** Freeze, recon, KYC, in-flight. Not replayable, **not in the hash** (INV-23) |
| `state_hash` | bytea | not null, check `length = 32` | **`SD-08`.** SHA-256 over a canonical serialization of the state |
| `engine_version` | text | not null | which build produced this row. Required for replay **comparison** and deliberately excluded from the hash it is compared with |
| `calendar_revision_id` | bigint | fk `trading_calendar_revisions`, null, on delete restrict | **[ADR-047](../../decisions/ADR-047.md), `0035`.** The **calendar watermark this fold read**: the highest `trading_calendar_revisions` id that existed when the row was computed. **Not the revision that corrected this row's `trading_day`** (a rule state is folded over the whole day sequence from day one, so it depends on the calendar as a whole; a per-day pointer would scope replay to the corrected day and miss every downstream counter). **NULL means the calendar had never been corrected**, which is every row until the first correction lands, and it is not "unknown". The engine's **second version-like input**: replay compares only rows carrying the current watermark ([M01 Appendix B.4](../../plans/M01-rules-engine.md) step 1), exactly as it scopes by `engine_version`, and it is **excluded from the hash** for the same reason |
| `computed_at` | timestamptz | not null default now() | |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `rule_states_account_day_uq (account_id, trading_day)`, total rather than partial because unlike `daily_marks` a rule state is never superseded (a correction to the inputs produces a **replay**, and the replay's divergence is the finding); `rule_states_account_day_desc_idx (account_id, trading_day desc)`; `rule_states_engine_eligible_idx (trading_day)` where `engine_eligible`, the eligible-next-7-days forecast source; `rule_states_day_hash_idx (trading_day, account_id) include (state_hash)`, the nightly replay audit's comparison read.
Constraints: `rule_states_anchors_move_together`; `rule_states_cadence_anchor_not_before_payout_anchor`; `rule_states_settlements_imply_anchors`; `rule_states_consistency_period_after_anchor`; `rule_states_consistency_numerator_within_denominator`; `rule_states_high_water_bounds_balance_unlocked`; `rule_states_win_days_within_traded_days`; `rule_states_hash_is_sha256`.
Append-only. Retention: forever.

**The `state_hash` input list ([ADR-026](../../decisions/ADR-026.md) C-07), reproduced here because a hash whose input set is implicit is a hash that changes meaning when a column is added.** Nineteen fields in this exact declared order, bigint rendered base-10, null as an explicit sentinel, no whitespace:

| | | | |
|---|---|---|---|
| 1 `account_id` | 6 `floor_open_cents` | 11 `win_days_count` | 16 `payout_anchor_day` |
| 2 `trading_day` | 7 `high_water_balance_cents` | 12 `consistency_best_day_cents` | 17 `cadence_anchor_day` |
| 3 `phase` | 8 `balance_cents` | 13 `consistency_period_profit_cents` | 18 `engine_eligible` |
| 4 `floor_cents` | 9 `withdrawable_cents` | 14 `consistency_period_start_day` | 19 `engine_gates` |
| 5 `floor_locked` | 10 `traded_days_count` | 15 `payouts_settled_count` | |

Excluded, each for a stated reason: `context_gates` (the whole reason `SD-06` split them, INV-23); `engine_version` (a build identifier is not state, and including it makes every engine upgrade a universal divergence); **`calendar_revision_id`** ([ADR-047](../../decisions/ADR-047.md): the calendar revision is the engine's **second version-like input**, so the `engine_version` argument applies with identical force. In the hash, one calendar correction changes every row's hash at once and pages once per account, which is the 5,000-page morning ADR-047 exists to prevent); `computed_at` (wall clock, not state); `id` and `state_hash` themselves.

**The nineteen stay nineteen.** `0035` adds a column and adds it to the **exclusion** list, in the `state_hash` column comment as well as here, because that comment is the only machine-readable record of the input set and `probe_rule_states_calendar_revision.sql` SUCCESS 6 asserts it names this column as excluded rather than merely mentioning it. A comment that added it to the hashed list would satisfy a presence check while inverting the ruling.

**Why the two anchors stay two columns (`SD-02`, finding C-09).** They are genuinely different dates and conflating them is a silent liability change of 40 percent (EC-039). Under [ADR-019](../../decisions/ADR-019.md)'s current configuration they coincide, and that is precisely the trap: a single column would work perfectly until the anchor moved back, at which point the gap between payouts changes and nothing in the schema records that two facts had been merged. `rule_states_settlements_imply_anchors` is the constraint that would have failed loudly if they had been collapsed and half-populated.

**Why the gate split matters operationally (`SD-06`).** Freeze, recon, KYC and in-flight were true on the day and may not be true now. Mixing them into the replayed state guarantees nightly false divergences, and FM-17 is what happens next: a self-audit that becomes noisy becomes a self-audit that gets disabled. The trader's actual eligibility is `engine_eligible` **and** every context gate, and that combined answer is deliberately not stored here, because it is not a property of the day; it is a property of the moment it was asked.
