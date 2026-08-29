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
| `engine_gates` | jsonb | not null | **`SD-06`.** The engine's own `EngineGateResults` value: six gate groups, twenty-five leaves, in the engine's field names, with every cents leaf a base-10 string. Ruled by [ADR-206](../../decisions/ADR-206.md) and declared in full below. Replayable, **in the hash** |
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

**The `engine_gates` encoding ([ADR-206](../../decisions/ADR-206.md)), reproduced here because a `jsonb` bag whose shape is implicit is a bag every reader fixes differently.** The column stores the engine's `EngineGateResults` value, group for group and leaf for leaf, in the engine's own field names. The leaves are exactly the dotted paths `ENGINE_GATE_LEAVES` declares in [`hash.ts`](../../../packages/rules-engine/src/hash.ts), which is the same enumeration `state_hash` column 19 hashes, so the column and the hash read one list rather than two copies of one list.

| Group | Leaves, in the order the interface declares them |
|---|---|
| `tradedDays` | `pass`, `skipped`, `have`, `need` |
| `winDays` | `pass`, `have`, `need`, `floorCents` |
| `buffer` | `pass`, `haveCents`, `needCents` |
| `consistency` | `pass`, `skipped`, `bestDayShareBp`, `maxDayShareBp`, `profitNeededToDiluteCents` |
| `cadenceGap` | `pass`, `skipped`, `tradingDaysSinceLastPayout`, `need`, `nextEligibleTradingDay` |
| `minimumAmount` | `pass`, `withdrawableCents`, `capCents`, `minPayoutCents` |

**Every `*Cents` leaf is a JSON string holding the base-10 integer, and no other leaf is a string except `nextEligibleTradingDay`.** `Cents` is `bigint` and the encoding has to be total over it: a write path that refused a legal state would leave the day with no row at all, which is `DO-3` and a raised reconciliation for a value the engine computed correctly. A JSON number is not total in the direction that matters. Postgres holds it exactly, because `jsonb` numbers are `numeric`, and JavaScript loses it on the way back: `9007199254740993` stored as a number and read through `JSON.parse` returns `9007199254740992`, so the read port could not rebuild the `bigint` it is typed to return. A base-10 string round-trips through `BigInt` exactly and is the same rendering `hash.ts`'s `money()` already puts into the hash.

**`skipped` is present on the three groups that declare it and absent on the other three, which is the interface's shape rather than an omission.** `CV-19` fixed the vocabulary: a gate that was not evaluated reports `pass: true, skipped: true`. `winDays`, `buffer` and `minimumAmount` are always evaluated and carry no such leaf, so a bag that grew one there would be carrying a fact the engine never produced.

**Key order is not part of the encoding and no reader may depend on it.** `jsonb` sorts keys by length and then bytewise, so the value Postgres returns is in a different order from the one written. The hash is therefore taken over the engine's in-memory value and never over the round trip: the column and the hash are written from one value in one step, and a hash recomputed from what storage gives back is a different serializer.

**Nothing else goes in the bag.** The four context gates are barred by `INV-23`, which is the whole reason `SD-06` split the column in two, and the wire shape is not the storage shape: `projectGates` in [`payouts.ts`](../../../apps/api/src/routes/payouts.ts) is an allowlist for `API_CONTRACT`'s eligibility breakdown, it drops three of the twenty-five leaves, renames two beyond casing, and reports a `minimum_amount.pass` that is the route's conjunction with the clamp rather than the engine's gate.

**This row used to name eight gates and the engine produces six.** "Profit target, drawdown, win days, minimum days, consistency, cadence, cap, minimum payout" was carried here and in [`0015`](../../../packages/db/migrations/0015_rule_states.sql)'s column comment, in two copies with nothing comparing them, and neither copy names a group `EngineGateResults` declares. `ADR-060` had already closed the enumeration at the six `R-33`, `R-34`, `R-35`, `R-36`, `R-37` and `R-39`. This row is corrected under `ADR-206`; the migration is merged and its comment is superseded rather than edited (constitution E2).

**Why the two anchors stay two columns (`SD-02`, finding C-09).** They are genuinely different dates and conflating them is a silent liability change of 40 percent (EC-039). Under [ADR-019](../../decisions/ADR-019.md)'s current configuration they coincide, and that is precisely the trap: a single column would work perfectly until the anchor moved back, at which point the gap between payouts changes and nothing in the schema records that two facts had been merged. `rule_states_settlements_imply_anchors` is the constraint that would have failed loudly if they had been collapsed and half-populated.

**Why the gate split matters operationally (`SD-06`).** Freeze, recon, KYC and in-flight were true on the day and may not be true now. Mixing them into the replayed state guarantees nightly false divergences, and FM-17 is what happens next: a self-audit that becomes noisy becomes a self-audit that gets disabled. The trader's actual eligibility is `engine_eligible` **and** every context gate, and that combined answer is deliberately not stored here, because it is not a property of the day; it is a property of the moment it was asked.
