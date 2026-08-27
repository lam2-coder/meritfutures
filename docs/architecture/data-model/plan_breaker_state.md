### plan_breaker_state
**`SD-M6-02`**, INV-M6-07. The breaker that pauses sales on a plan.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `plan_id` | uuid | fk plans, not null, on delete restrict, pk part | |
| `evaluated_on` | date | not null, pk part | **Unit: wall clock**, the breaker evaluates on Merit’s own schedule. |
| `metric` | text | not null | |
| `numerator_cents` | bigint | not null | |
| `denominator_cents` | bigint | not null | |
| `sample_size` | integer | not null, check >= 0 | **`SD-M6-02`** |
| `ratio_bp` | integer | not null | |
| `threshold_bp` | integer | not null | |
| `min_sample` | integer | not null, check > 0 | **`SD-M6-02`** |
| `state` | text | not null, check in (`armed`,`paused`,`insufficient_data`,`manually_overridden`) | `insufficient_data` is a **first-class state**, not an error. It is what the breaker says during launch week, and saying it is the correct behaviour |
| `override_reason` | text | null | |
| `override_expires_at` | timestamptz | null | an indefinite override is a disabled breaker with a nicer name |
| `changed_by` | text | null | |
| `created_at` | timestamptz | not null default now() | |

Primary key: composite `(plan_id, evaluated_on)`.
Indexes: `plan_breaker_state_current_idx (plan_id, evaluated_on desc)`; `plan_breaker_state_override_expiry_idx (override_expires_at)` where overridden.
Constraints: `plan_breaker_state_respects_min_sample` (the breaker may not be armed or paused below its own minimum sample); `plan_breaker_state_override_is_complete`.
Why the sample size is the delta's real content: a loss-ratio breaker with no minimum sample fires on a two-transaction denominator, which means it fires during launch week on every new plan, every time. That is an outage Merit inflicts on itself, and worse, it is the outage that teaches everyone to override the breaker (AS-M6-02).

**The primary key is `(plan_id, evaluated_on)` and `metric` is NOT part of it, and that is now RULED rather than transcribed** ([ADR-167](../../decisions/ADR-167.md)). One plan-day is one row and one row is one metric. A later session that wants `metric` in the key is superseding that entry rather than extending this table, and what it has to answer is that `state`'s `'paused'` value would then govern the added rows: `API_CONTRACT`'s `per_plan.sales_paused` derives from `state = 'paused'`, so a second metric sharing this key gets a column that spells a **revenue pause** for a statistic that was never meant to pause anything.

**The pass-rate CUSUM does NOT live here, and it does not live anywhere.** `API_CONTRACT`'s `per_plan` carries a `cusum: { statistic, threshold, alarm }` object beside the four fields this table does hold, [`0049`](../../../packages/db/migrations/0049_reserve_coverage_snapshots.sql) dispositioned the whole field as needing nothing, and [P7 section 5.3](../../plans/P7-risk-and-abuse.md) found that it checked four of the five. **`ADR-167` rules that `S_t` is folded at read time from the account series and is never stored**, so no column here holds it, no second table holds it, and **no CUSUM value is ever written into `ratio_bp`, `threshold_bp`, `numerator_cents`, `denominator_cents` or `sample_size`** -- those columns are the loss ratio's and their names are load-bearing. The correction to `0049`'s disposition is in [DELTA_MANIFEST](../../../packages/db/DELTA_MANIFEST.md) section 27 and never in `0049`, which is merged and sacred under [E2](../../../MERIT_BUILD_MASTER_PROMPT.md).

**`sample_size` is the DENOMINATOR's count and the source is `0016`'s own header, not a preference.** That header states the delta's content as *"a loss-ratio breaker with no minimum sample fires on a two-transaction **denominator**"*, and `AS-M6-02` says the same in its own words. The loss ratio is settled payouts over fees, so this is the purchase count in the window. **`OQ-M6-02`'s proposal is a conjunction of two counts over two populations** -- *"20 purchases and 3 settled payouts"* -- and `min_sample` is one scalar compared against one `sample_size`, so **the row expresses one of the two terms and the second lives in the evaluator or it does not exist** ([ADR-167](../../decisions/ADR-167.md) section 5). A row whose `sample_size` held the settled-payout count would satisfy every `CHECK` in `0016` and describe the wrong population, and no gate can see which count an integer is. **The NUMBER remains `OQ-M6-02` and the founder's.**

**Nothing writes this table yet.** [`P7-k`](../../plans/P7-risk-and-abuse.md) is its first producer, and `insufficient_data` below the minimum with sales NOT paused is `GS-113`.
