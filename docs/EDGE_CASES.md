---
status: approved
depends_on: [plans/M01-rules-engine.md, testing/GOLDEN_SCENARIOS.md, GLOSSARY.md, DECISIONS.md]
last_updated: 2026-08-13
---

# EDGE CASES (living registry)

Every discovered edge case and (post-FREEZE) every bug becomes a numbered entry here plus a golden file in [docs/testing/GOLDEN_SCENARIOS.md](testing/GOLDEN_SCENARIOS.md). Never delete entries; supersede them. Entry format:

```
## EC-NNN: <one-line name>  (YYYY-MM-DD, module: Mx, status: open | specced | tested)
- Scenario:
- Correct behavior (with the deciding rule and comparison operators spelled out):
- Golden scenario ref:
```

Seed sources: constitution M1 edge-case list, Appendix B4 battery (22 scenarios), Appendix A adversary taxonomy. **Seeded in Wave 3 by [M01](plans/M01-rules-engine.md).** `status: specced` means the behavior is decided and written down; it becomes `tested` when the golden file exists and passes in CI, which cannot happen before FREEZE.

Numbering blocks: EC-001 to EC-011 are the constitution's own M1 list, EC-012 to EC-033 are the B4 battery in order (`EC-(011 + n)` is B4 item `n`), EC-034 upward are discovered during the build.

---

## EC-001: Rounding and comparison operators are per rule, never implied  (2026-08-13, module: M1, status: specced)
- Scenario: A threshold expressed as a percentage is compared against a money value, and the engine and the published rules page round differently by one cent.
- Correct behavior: Every threshold is materialized to integer cents at plan publish into `plan_version_sizes` and never recomputed at runtime. Every comparison operator is stated per rule in [M01 section 3.5](plans/M01-rules-engine.md) and mirrored verbatim in the plan's `copy_blocks`. Ratios are compared by integer cross-multiplication, never by division. There is no float anywhere in the engine, at any width.
- Golden scenario ref: GS-023, GS-029, and the boundary pair on every rule.

## EC-002: Consistency with a zero or negative denominator  (2026-08-13, module: M1, status: specced)
- Scenario: A funded account has a best day of 40,000c and a period profit of 0c or less. The ratio is undefined or meaningless.
- Correct behavior: The [consistency denominator rule](GLOSSARY.md#consistency-denominator-rule) applies. The gate is **skipped entirely** unless `period_profit_cents > 0` (strict `>`), and a skipped gate reports `pass: true, skipped: true`. No division is ever attempted, so there is no path to a divide-by-zero.
- Golden scenario ref: GS-021, GS-022.

## EC-003: Win day exactly at the floor  (2026-08-13, module: M1, status: specced)
- Scenario: A day closes at realized P&L of exactly the win-day floor.
- Correct behavior: Counts. The operator is `realized_pnl_cents >= win_day_floor_cents`, and the published copy says "at least". One cent below does not count.
- Golden scenario ref: GS-006, GS-007.

## EC-004: Breach and pass signals on the same day  (2026-08-13, module: M1, status: specced)
- Scenario: A day's low is below the floor and the same day's close is at or above the profit target.
- Correct behavior: **Breach wins.** Day ordering is binding and is a single ordered pipeline: mark ingest, then breach check, then progression. The breach check uses the floor **at the open of the day**, so a new closing high cannot retroactively rescue a day that already broke the floor. No `phase.passed` is emitted and no funded state is written.
- Golden scenario ref: GS-012, GS-063, GS-064.

## EC-005: Trading-calendar half days  (2026-08-13, module: M1, status: specced)
- Scenario: A shortened session, for example the day after Thanksgiving.
- Correct behavior: A half day is a full trading day for every counter: minimum days, cadence gap, and win-day eligibility. It is published as such so nobody is surprised.
- Golden scenario ref: GS-003, GS-032.

## EC-006: Account with fills but flat P&L  (2026-08-13, module: M1, status: specced)
- Scenario: A trader opens and closes a position for exactly zero realized P&L.
- Correct behavior: `traded_day = true` because `fill_count > 0` (strict `>`). `win_day = false` because `0 >= win_day_floor_cents` is false for any positive floor. The two flags use different operators on different inputs and both are asserted.
- Golden scenario ref: GS-005.

## EC-007: Payout request landing mid nightly batch  (2026-08-13, module: M1 + M5, status: specced)
- Scenario: A request arrives at 23:59:59 while the batch that closes the next day starts at 00:05.
- Correct behavior: Every evaluation is against the [last closed day](GLOSSARY.md#last-closed-day) and nothing more recent. The request pins `basis_trading_day` into an immutable snapshot, so the answer does not depend on whether the batch had started, finished, or crashed.
- Golden scenario ref: GS-035.

## EC-008: Cap greater than withdrawable  (2026-08-13, module: M1, status: specced)
- Scenario: The plan cap is 150,000c and the account's withdrawable is 120,000c.
- Correct behavior: Auto-clamp. `approved_cents = min(effective_request, cap_cents_for_ordinal, withdrawable_cents)`, `clamp_reason: withdrawable`. The clamped amount is shown before submission so the number never changes underneath the trader.
- Golden scenario ref: GS-026, GS-027, GS-028.

## EC-009: Multiple accounts, same identity, requesting the same day  (2026-08-13, module: M1 + M5 + M6, status: specced)
- Scenario: One [trader identity](GLOSSARY.md#trader-identity) holds ten funded accounts and several become eligible on the same trading day.
- Correct behavior: Each account is evaluated independently and each request is individually correct and individually capped. There is no cross-account state in the engine, by design. The aggregate exposure surfaces at identity level in admin, and the Eligible-Next-7-Days forecast is identity-aware so a correlated wave is visible before it lands.
- Golden scenario ref: GS-036, GS-062.

## EC-010: Config migration never touches existing accounts  (2026-08-13, module: M1 + M3, status: specced)
- Scenario: Plan version 2 is published while accounts exist on version 1.
- Correct behavior: An account's `plan_version_id` is pinned at purchase and never changes, enforced by an update trigger. A published version is immutable, enforced by a second trigger. The engine reads the account's pinned version as an input and has no concept of a "current" version.
- Golden scenario ref: GS-041.

## EC-011: Replay determinism  (2026-08-13, module: M1, status: specced)
- Scenario: Re-running every mark from day one must reproduce the stored `rule_states`.
- Correct behavior: Byte-identical, compared by canonical state hash first and then field by field on mismatch. This runs as a nightly self-audit job in production, not only in CI. Any divergence halts payout eligibility for the affected account and pages. The full design, including the engine-upgrade protocol that stops a bugfix from paging on every historical row, is [M01 Appendix B](plans/M01-rules-engine.md).
- Golden scenario ref: GS-071 to GS-075.

---

## EC-012 to EC-033: the Appendix B4 battery

`EC-(011 + n)` is B4 item `n`. Each maps to `GS-(029 + n)`. Rows owned by later modules are recorded now so the registry is complete and the numbering is stable; their behavior is decided in their own module plan.

| EC | B4 | Scenario | Module | Decided behavior (M1 rows are binding) | GS |
|---|---|---|---|---|---|
| EC-012 | 1 | DST transition day | M1 | Session bounds come from `trading_calendar` as stored UTC instants. The 23 hour and 25 hour sessions each produce exactly one trading day. No `new Date()` arithmetic exists in engine code | GS-030 |
| EC-013 | 2 | Halt or limit-locked session | M1 | Calendar trading days advance, win days do not. Published | GS-031 |
| EC-014 | 3 | Half day | M1 | Full trading day for every counter | GS-032 |
| EC-015 | 4 | File late or corrupt mid-row | M2 | Whole-file quarantine, zero rows committed, alert. M1 asserts that absent a mark, no state advances | GS-033 |
| EC-016 | 5 | Backdated correction on a closed day | M1 + M2 | Supersede the mark, replay forward, **never claw back** a settled payout, flag for review, absorb the difference, report the absorbed amount | GS-034 |
| EC-017 | 6 | Request at 23:59:59 versus batch at 00:05 | M1 + M5 | Last-closed-day snapshot semantics. Same as EC-007 | GS-035 |
| EC-018 | 7 | Same identity, two payouts the same second | M5 | Both valid, per-account row locks, aggregate visible to admin | GS-036 |
| EC-019 | 8 | Rise webhook replayed 50 times | M5 | One settlement, one win-day reset, one floor recompute | GS-037 |
| EC-020 | 9 | PSP duplicate and out-of-order | M3 | One account, correct final state, out-of-order deferred not applied | GS-038 |
| EC-021 | 10 | Chargeback after a settled payout | M3 + M5 | Close, flag, ledger reversal, identity nets negative honestly | GS-039 |
| EC-022 | 11 | Coupon race, two tabs, one code | M3 | Atomic claim, unique index decides | GS-040 |
| EC-023 | 12 | Plan v2 published mid-checkout | M3 + M1 | Buyer gets v1, provably. Same as EC-010 | GS-041 |
| EC-024 | 13 | 100.00 versus 99.99, 0.01 requests, cap tie | M1 | `>=` on the minimum, exact tie resolves to the tied value, a 1c request fails the minimum gate rather than paying 1c | GS-042 |
| EC-025 | 14 | Micro versus mini mixed fills | M2 | Tick value from `contract_specs`, versioned by date, never hardcoded. The engine contains no symbol-aware logic at all | GS-043 |
| EC-026 | 15 | Passes eval while payout-frozen | M1 | Progression continues, payouts stay gated. Freeze is not an input to progression | GS-044 |
| EC-027 | 16 | Affiliate self-purchase | M8 | Attribution voided, flag raised | GS-045 |
| EC-028 | 17 | Identity merge after both were funded | M7 | Grandfather existing, block new, record `accounts_at_merge` | GS-046 |
| EC-029 | 18 | Batch crash at account 2,341 of 5,000 | M1 + M2 | Per-account transaction plus cursor. Applying the same day twice is a no-op on state | GS-047 |
| EC-030 | 19 | Restore with payouts mid-queue | M5 | Idempotency keys survive restore, no double transfer | GS-048 |
| EC-031 | 20 | Fuzz on adversarial day sequences | M1 | Property suite plus fixtures. Hunts rounding, overflow, monotonicity | GS-049 |
| EC-032 | 21 | Six-account hedged syndicate rehearsal | M7 + M1 | Flagged by day 3, extraction bounded by the computed ceiling | GS-050 |
| EC-033 | 22 | 500 payout requests in one minute | M5 | All correct, p95 under 1s | GS-051 |

---

## EC-034: A settled payout looks like a catastrophic loss  (2026-08-13, module: M1 + M2, status: specced)
- Scenario: A 150,000c payout settles and the platform reduces the simulated account balance. The next mark's closing balance is 150,000c lower with no losing trade behind it. Under a naive breach check, a trader who just earned a payout can be breached by receiving it.
- Correct behavior: **Amended by [ADR-014](DECISIONS.md), which removed the middle of the three original mechanisms.** Non-trading balance movements are carried in `daily_marks.adjustment_cents` (schema delta SD-01) and are applied **between sessions**, at the open of the payout's effective trading day, never inside a session (dependency D-M2-2, and a vendor-confirmation item). The floor is **not** recomputed at settlement and does not need to be: config validation guarantees the post-payout balance clears the floor before any account is ever sold on that config. `buffer_cents` must exceed the locked-floor offset when the lock is enabled (CV-11), and every cap must be below the drawdown when it is not (CV-17), which together bound the floor above by `size + lock_offset` or below the post-payout balance in every reachable configuration. The mark identities `opening == prior_balance + adjustment` and `closing == opening + realized_pnl` are asserted on every mark, and a violation raises reconciliation rather than being computed on. The result is unchanged, INV-21: a settled payout can never breach the account that earned it. What changed is **where** it is enforced, and publish time is the better place, because a config that could break it never reaches an account rather than being compensated for on every settlement forever.
- Golden scenario ref: GS-065, GS-081, GS-083.

## EC-035: Comparing the day's low against the floor after trailing it  (2026-08-13, module: M1, status: specced)
- Scenario: A day dips below the floor at 10:00 and then rallies to a new closing high. If the engine trails the floor to the new high before checking the breach, the day is compared against a floor that did not exist while the trader was below it. In the other direction, if a naive implementation trails first on a losing day, nothing happens, so the bug hides until exactly the volatile day that matters.
- Correct behavior: The breach comparison uses `floor_at_open`, which is the floor carried by the previous closed day's rule state. Trailing happens strictly after the breach check, within the same day evaluation. Stated as rule R-18 and stored explicitly as `rule_states.floor_open_cents` (schema delta SD-04) so the evidence pack can show which number the decision used.
- Golden scenario ref: GS-012.

## EC-036: Eligibility is not monotone in profit  (2026-08-13, module: M1, status: specced)
- Scenario: An account is eligible with best day 30,000c and period profit 100,000c, exactly at a 3000bp threshold. The trader has one more good day of 20,000c on what was already their best day. Best day is now 50,000c, profit 120,000c, share 4166bp, and eligibility is **lost** by making money.
- Correct behavior: This is correct and intended, and the constitution's section 5.1 phrasing "eligibility is monotone in its inputs" is imprecise. The precise property, and the one the property suite asserts, is: eligibility is monotone non-decreasing in profit added on **any day other than the current best day**, monotone in elapsed trading days, and monotone in win-day count. It is **not** monotone in profit added to the best day. The trader-facing consequence is handled by reporting `profit_needed_to_dilute_cents` on the eligibility endpoint so the path forward is always visible.
- Golden scenario ref: GS-069.

## EC-037: A failed transfer consumes a ladder rung  (2026-08-13, module: M1 + M5, status: specced)
- Scenario: Payout ordinal 3 is approved, the transfer exhausts its retry budget, and the request ends `failed`. Under `unique (account_id, payout_ordinal)` the retry must take ordinal 4, which advances the trader up the cap schedule and toward graduation for a payout they never received.
- Correct behavior: The ordinal is defined as `payouts_settled_count + 1`, so a failed attempt does not consume a rung, and the uniqueness constraint becomes partial: `unique (account_id, payout_ordinal) where status <> 'failed'` (schema delta SD-05). Graduation and the cap schedule both key on settled count, never on attempt count.
- Golden scenario ref: GS-066.

## EC-038: Split rounding direction  (2026-08-13, module: M1 + M5, status: specced)
- Scenario: An approved amount of 100,001c at a 9000bp split. Naive integer division yields trader 90,000c and firm 10,000c, and one cent vanishes.
- Correct behavior: `trader_cents = ceil(approved_cents * split_bp / 10000)` computed as `(approved * split_bp + 9999) / 10000` in integer arithmetic, and `firm_cents = approved_cents - trader_cents`. The remainder always goes to the trader, the legs always sum exactly to the approved amount, and the published copy says the rounding favors the trader. It costs at most one cent per payout and it is a free trust signal.
- Golden scenario ref: GS-029.

## EC-039: The cadence anchor changes the published extraction ceiling  (2026-08-13, module: M1, status: specced)
- Scenario: The [cadence gap](GLOSSARY.md#cadence-gap) can be counted from the payout's basis day or from its settlement day. On CORE-50K the choice moves the steady-state extraction ceiling from 19,300c per trading day (settlement anchored, a roughly 7 trading day cycle) to 27,000c per trading day (basis anchored, a 5 trading day cycle), a 40% difference in the per-account liability rate.
- Correct behavior: **Ruled at the M1 gate, [ADR-013](DECISIONS.md): settlement anchored.** `cadence_anchor_day` is the settled payout's **effective** trading day and the gap counts trading days strictly after it (R-37). Win days and the consistency period reset on the **basis** day of that same payout (R-47), so progress earned during the transfer window is not confiscated. Two anchors, each with a stated reason, both stored on the payout row and both deterministic under replay. The founder's lifecycle simulation was basis anchored, so realized liability is at most the modeled figure. The same ruling renamed Rapid Daily to **Merit Rapid** and requires its cadence to be published honestly rather than as daily.
- Golden scenario ref: GS-055, GS-059, GS-068, GS-082.

## EC-040: Payout stacking inside the settlement window  (2026-08-13, module: M1 + M5, status: specced)
- Scenario: Win days and the consistency period reset on settlement. A trader who is eligible fires a second and third request during the two to three business day transfer window, before any reset has happened, and converts one qualifying stretch into three capped extractions.
- Correct behavior: G-NO-IN-FLIGHT is part of eligibility: no request may be created while another for the same account is `approved`, `transferring`, or `frozen`. Enforced by a partial unique index, not only by the engine, because the engine is not the only writer. This is a liability control and is documented as one wherever the `conflict` error appears.
- Golden scenario ref: GS-052, GS-053.

## EC-041: The funded account does not start at the account size  (2026-08-13, module: M1 + M2, status: specced)
- Scenario: On eval pass, the platform fails to reset the simulated account and the first funded mark opens at the eval closing balance. The trader begins the funded phase already in profit, clears the buffer immediately, and can extract before any funded gate has had time to work.
- Correct behavior: The funded phase begins at `size_cents` and eval profit is never carried. The engine asserts `first funded mark.opening_balance_cents == size_cents` and refuses the day with a reconciliation error rather than computing on it. Whether M2 achieves the reset by resetting the platform account or provisioning a new one is M2's choice; the assertion is M1's contract either way.
- Golden scenario ref: GS-070, GS-019.

## EC-042: Minimum trading days is dominated by the win-day gate  (2026-08-13, module: M1, status: specced)
- Scenario: CORE-50K was proposed with 5 win days and 5 minimum trading days. Since every win day is a traded day, the minimum-days gate can never be the binding constraint and provides no protection whatsoever.
- Correct behavior: **Resolved at the M1 gate by [ADR-015](DECISIONS.md): funded `min_trading_days` is 0 on all three plans.** The field stays, because it is the binding gate on any future plan where `required_win_days < min_trading_days` and it is what stops a one-day funded account on a future config, but at 0 the gate is **explicitly disabled** and reports `pass: true, skipped: true` rather than sitting in the eligibility breakdown reading as satisfied (CV-19). The publish-time warning also stays and now fires on all three plans by design, so the domination is a thing the founder sees in every publish diff rather than a thing the corpus remembers. Marketing copy must not present a dominated gate as a separate protection.
- Golden scenario ref: GS-060, GS-080.

## EC-043: Zero-risk day farming  (2026-08-13, module: M1 + M7, status: specced)
- Scenario: A [traded day](GLOSSARY.md#traded-day) requires only one fill. One micro round trip per day advances the traded-day counter at commission cost, so minimum-trading-day requirements are a fee rather than a constraint. Across a rented fleet this keeps every account's counters advancing while a single directional account carries the ring's risk.
- Correct behavior: The engine's definition does not change: a fill is a fill, and inventing a minimum-size or minimum-duration test invites arguments Merit will lose in public. The answer is that the real gates are win days, the buffer, and consistency, and that the pattern (fleets of accounts with exactly one round trip per day) is a detector signal for M7 rather than a rule.
- Golden scenario ref: GS-060.

## EC-044: An engine upgrade pages on every historical row  (2026-08-13, module: M1, status: specced)
- Scenario: A legitimate engine bugfix changes a computed value on historical days. The nightly replay self-audit compares stored against recomputed and raises `replay.divergence_detected` for thousands of accounts at once, burying the one real divergence.
- Correct behavior: Divergence detection compares only rows whose `engine_version` equals the running version. Changing the version requires the documented upgrade protocol in [M01 Appendix B](plans/M01-rules-engine.md): a dry-run replay that produces a full diff report, founder approval of that report, an audited rewrite of historical states under the new version, and a hard rule that **no settled payout's `eligibility_snapshot` is ever rewritten**, because the snapshot is what was true when the money moved.
- Golden scenario ref: GS-075.

## EC-045: Consistency period off-by-one at the settlement boundary  (2026-08-13, module: M1, status: specced)
- Scenario: The consistency period is "profit since the last payout". If the basis day is included in the new period, the day that funded the payout also counts against the next one, and a single good day silently blocks the following cycle.
- Correct behavior: The period is trading days **strictly after** the anchor day: `d > payout_anchor_day`. On a fresh funded account with no settled payout, the period is trading days `d > funded_on`, which excludes the eval pass day for the same reason. Both boundaries are pinned by fixtures because a one-day error here moves real eligibility and is invisible in aggregate.
- Golden scenario ref: GS-068.

## EC-046: Holiday clusters stretch and compress the gap in calendar time  (2026-08-13, module: M1, status: specced)
- Scenario: A 5 trading day cadence gap is 7 calendar days in June and 9 or more across the Christmas cluster. Traders experience this as the rules changing.
- Correct behavior: The gap is counted in [trading days](GLOSSARY.md#trading-day) and always was. The engine reports `next_eligible_trading_day` as a concrete date resolved through the calendar, so the trader sees the actual date rather than doing the arithmetic, and the published copy states the unit explicitly.
- Golden scenario ref: GS-059.

## EC-047: A trading day with no mark at all  (2026-08-13, module: M1 + M2, status: specced)
- Scenario: The vendor report omits an account entirely for a session. This is different from a day with no fills, which produces a mark with `fill_count = 0`.
- Correct behavior: A missing mark is never treated as a flat day. The engine's fold advances only on marks it is given, so a gap in the mark stream leaves the account's counters where they were, and the batch raises a completeness check: every `active` account must have exactly one live mark per trading day it was open. A missing mark is a reconciliation alarm, and the account is `recon_blocked` until it is resolved, which excludes it from payout eligibility.
- Golden scenario ref: GS-033, GS-047.

---

## Entries discovered at the M1 gate (2026-08-13)

The three below were produced by the founder's rulings rather than by drafting. Per the constitution's working agreements, a discovered gap becomes an entry here even when the gap was created by a decision that was correct.

## EC-048: Removing the post-payout floor reset creates a config that pays an account into a breach  (2026-08-13, module: M1, status: specced)
- Scenario: [ADR-014](DECISIONS.md) removed the post-payout floor recompute. On a trailing-EOD plan with the floor lock **disabled**, the floor sits `drawdown_cents` below the account's high-water balance and stays there. A trader who requests a payout on a new closing high has their balance reduced by up to `cap_cents` against a floor that does not move. If `cap_cents >= drawdown_cents`, the account opens the next session at or below its own floor and breaches on the day it was paid, which is precisely the failure INV-21 exists to make impossible.
- Correct behavior: A publish-time rejection, not a runtime compensation. **CV-17**: when `drawdown.type = "trailing_eod"` and `drawdown.lock.enabled` is false, every `cap_cents` in the schedule must be strictly less than `drawdown_cents`. When the lock is enabled, CV-11 already covers it by a different route: the floor can never exceed `size_cents + lock_offset`, and the post-payout balance is at least `size_cents + buffer_cents`, so `buffer_cents > lock_offset` is sufficient. No v1 plan can reach the unlocked case, since all three enable the lock, which is exactly why it is validated rather than trusted to stay true. INV-21 is now a property of the config rather than of the settlement code path, which is the stronger arrangement: it fails at publish, once, instead of needing to be right on every settlement forever.
- Golden scenario ref: GS-083, GS-065.

## EC-049: The cadence gap can be dominated by the win-day gate, and the two gates use different anchors  (2026-08-13, module: M1 + M9, status: specced)
- Scenario: Merit Rapid publishes a 1 trading day cadence gap and requires 5 win days. Win days reset to the settled payout's **basis** day and each one needs its own trading day, so no second request can qualify until 5 trading days after the basis day. The 1 day gap never binds. The plan's real cadence is 5 trading days, roughly weekly, and the number a trader would compute from the published gap is wrong by a factor of five. This also invalidated M01 OQ-1's own estimate of 3 to 4 trading days, which was made before the win-day count was fixed.
- Correct behavior: The engine is correct and does not change; the failure is a marketing-versus-implementation gap, which constitution section 0.5 treats as the thing the corpus exists to prevent. Three responses. **Published copy states the real cycle** (about 5 trading days for Merit Rapid) and may not attribute the plan's speed to its 1 day gap. **A publish-time warning fires** when `cadence_gap_trading_days + min_settlement_lag_trading_days <= win_days.required_count`, where `min_settlement_lag_trading_days` is a published config constant with v1 value 2, because the two gates measure from different anchors (gap from the effective day, win days from the basis day) and a naive comparison would wrongly flag Core EOD, where the gap genuinely binds at 7 to 8 trading days. And **the portal's `next_eligible_trading_day` resolves through the calendar**, so no trader ever has to do this arithmetic themselves. Whether Merit Rapid's win-day count should change is [OQ-12](plans/M01-rules-engine.md), a plan-economics decision and a config edit, not an engine change.
- Golden scenario ref: GS-082, GS-059.

## EC-050: A gate configured to zero is indistinguishable from a gate that passed  (2026-08-13, module: M1 + M4, status: specced)
- Scenario: [ADR-015](DECISIONS.md) sets funded `min_trading_days` to 0 on all three plans. Evaluated naively, `traded_days_count >= 0` is true on day zero and forever, so the eligibility breakdown shows a green gate that was never a constraint. A trader reads it as a hurdle they cleared; a support agent reads it as evidence the account met a requirement; a future config author reads it as a protection that exists. All three are wrong in the same way, and it is the same failure as EC-042 wearing different clothes.
- Correct behavior: A gate whose configured threshold makes it unconditionally true reports `pass: true, skipped: true`, the identical shape the [consistency denominator rule](GLOSSARY.md#consistency-denominator-rule) already uses for a skipped comparison, and the portal renders `skipped` as visibly disabled rather than as satisfied (CV-19). `engineEligible` is unaffected, because the conjunction of gates treats a skipped gate as true, which it is. The general rule this establishes and which every later module inherits: **a gate that cannot fail must say so.**
- Golden scenario ref: GS-080, GS-060.

---

## Entries from M02 (Rithmic bridge)

## EC-051: A balance movement that is neither trading nor a known settlement  (2026-08-13, module: M2 + M5, status: specced)
- Scenario: The vendor's EOD report shows an account's balance changed by an amount that does not match the day's fills and does not match any settlement Merit knows about. Candidate causes: a vendor-side adjustment, a fee Merit did not model, a manual correction by platform support, or a payout Merit's own records have not caught up with.
- Correct behavior: **The normalizer refuses to guess.** Every balance delta is classified as trading (explained by fills) or non-trading (explained by a settlement Merit issued, which becomes `adjustment_cents` under SD-01). A delta that fits neither quarantines that account's day, sets `recon_blocked`, and alarms. It is never absorbed into `realized_pnl_cents`, because doing so would make a vendor fee look like a trading loss and could breach an account (INV-M2-12). The correct resolution is a human matching it against M5's settlement record or the vendor's own explanation, then a corrected mark.
- Golden scenario ref: GS-092.

## EC-052: A redelivered file that is not byte-identical and carries no correction markers  (2026-08-13, module: M2, status: specced)
- Scenario: The vendor re-exports a day already applied. The bytes differ so the `sha256` duplicate guard does not fire, and the rows carry no `correction_of` reference. Processing it as new either collides on the live-mark unique index or doubles every account's realized P&L for that day.
- Correct behavior: Ingest file disposition is an explicit four-way decision recorded on the row (SD-M2-03): `new`, `duplicate_ignored`, `full_replacement`, `correction_set`. A row touching an already-applied trading day without a correction reference **quarantines the whole file** and pages. A deliberate `full_replacement` is a human decision that supersedes the prior marks rather than deleting them, emits `ingest.file_replaced`, and triggers replay forward with settled snapshots untouched.
- Golden scenario ref: GS-086.

## EC-053: A recycled platform account reference  (2026-08-13, module: M2, status: specced)
- Scenario: The platform reissues a User ID or account reference that a closed Merit account previously held. Historical files or late corrections for the old account then route onto the new one. Two accounts are corrupted, the fills are internally consistent so reconciliation may not catch it, and replay diverges on an account that did nothing wrong.
- Correct behavior: A platform reference is **burned permanently** on account close. `platform_account_refs` (SD-M2-02) records assignment and retirement, `platform.account_ref_retired` announces it, and any inbound row citing a retired reference quarantines the whole file rather than being routed anywhere at all. Losing a day of data is the correct trade against silently corrupting two accounts. Whether the vendor's identifier space forces reuse is V-M2-10 and, if it does, the answer is a Merit-side surrogate with an explicit epoch rather than an assumption.
- Golden scenario ref: GS-089.

## EC-054: A risk setpoint that was delivered but never applied  (2026-08-13, module: M2 + M6, status: specced)
- Scenario: Merit's entire intraday risk posture is one number pushed to the platform: the auto-liquidation setpoint at the account's floor. SFTP delivery confirms transport, not effect. An account whose setpoint never applied has no intraday enforcement, looks identical to a well-behaved account, and carries unbounded loss for the firm under an EOD rule model that explicitly assumes the platform stops the trader.
- Correct behavior: Transport success is **not** confirmation for `set_risk`, which is the one provisioning operation that may never reach `confirmed_inferred`. Confirmation is either an acknowledgement artifact (V-M2-06) or, where the report exposes it, a nightly comparison of the platform's stated setting against our floor (V-M2-08). Failing both, the fallback is behavioral: a day whose low went below the floor **without** an accompanying liquidation record is evidence the setpoint is not working and is a page. Unconfirmed setpoints appear as a named number on the admin liability dashboard, because an unenforced funded account is carried liability whether or not anyone noticed.
- Golden scenario ref: GS-087.

## EC-055: Entitlement hygiene disabling an account that is still trading  (2026-08-13, module: M2, status: specced)
- Scenario: The nightly job that disables billable platform entitlements for closed accounts disables one belonging to a live funded trader, taking them offline mid-session. The inverse failure, a job that silently stops running and leaks real money monthly, is the same job's other direction.
- Correct behavior: The two directions get deliberately asymmetric controls, because their costs are asymmetric. Disable fires **only** on a terminal account status with `closed_on` set, never on inactivity, never on a heuristic, never on a missing mark, and a disable targeting an `active` account is a hard error rather than a warning. The leak direction is caught by evaluating the alarm on the **query** ("any closed account entitled more than 24 hours") rather than on the job's own success signal, plus a monthly reconciliation of the vendor invoice against `platform_entitlements`, which requires knowing the vendor's billing unit (SD-M2-05).
- Golden scenario ref: GS-088.

## EC-056: The vendor's session date disagrees with our calendar  (2026-08-13, module: M2, status: specced)
- Scenario: A fill executed near the session boundary is assigned to one trading day by the platform's stated session date and to another by Merit's calendar containment. Silently taking our own answer hides the disagreement; silently taking theirs breaks replay determinism, since our calendar is what every counter is defined against.
- Correct behavior: Store both (SD-M2-04, `trading_day_vendor` plus `trading_day_source`) and **alarm on divergence**. Merit's calendar decides `fills.trading_day`, because every rule in the engine is defined against it, but the disagreement is the most valuable ingest signal available and must never be discarded. Systematic clustering of a trader's fills within seconds of the boundary is an M7 detector input rather than a rule, because trading into the close is entirely legitimate and a rule against it would be indefensible.
- Golden scenario ref: GS-090, and it shares the calendar fixtures GS-030 and GS-032.

---

## Entries from M03 (billing and checkout)

## EC-057: A refund taken before any trade, repeatedly, as free optionality  (2026-08-13, module: M3 + M7, status: specced)
- Scenario: The refund policy is pre-first-trade only. A buyer purchases an evaluation, watches the market, and refunds when conditions look poor, repeating until a good setup appears. "No trades placed" reads as "nothing consumed", but the account cost real entitlement money from provisioning, occupied a slot against the entity cap, and delivered something of value: the option to start on a day of the buyer's choosing.
- Correct behavior: The policy needs a fact to hang on, so `purchases.first_trade_at` is recorded by M2 on the account's first fill (SD-M3-02) and the window is enforced against it rather than against a support judgment. Refund **velocity per identity** is a risk signal routed to M7, never a checkout block, because a first-time buyer's refund is a support win and blocking it costs more brand than the pattern costs money. Entitlements are not provisioned before the account opens, which bounds the cost of the pattern to PSP fees. Stated honestly: this cannot be fully closed without charging for the option, and charging for the option is a worse product.
- Golden scenario ref: none owned; covered by the refund-window unit suite and M7's velocity detector.

## EC-058: Failover double-charges one purchase across two MIDs  (2026-08-13, module: M3, status: specced)
- Scenario: PSP-A goes slow, health checks mark it degraded, and a retry routes the same purchase to PSP-B. PSP-A then confirms. One buyer, two charges, two accounts, and a chargeback that damages exactly the MID health the failover existed to protect. Every individual step is reasonable and the bug only appears under the provider slowness that triggers failover, so it never shows up in testing.
- Correct behavior: **Failover is per-attempt routing and never mid-transaction.** Once a payment session exists at a provider, that purchase completes there or fails there; Merit never retries the same purchase elsewhere, because the card may already be charged and the provider may simply be slow to say so. A new attempt is a new purchase row with a new idempotency key, linked to the first so support can see the pair. Detection: an alarm on any identity holding two `paid` purchases for the same plan and size inside five minutes, which is the fingerprint of both this bug and a genuine double-click.
- Golden scenario ref: GS-095.

## EC-059: A leaked coupon code silently reprices resets forever  (2026-08-13, module: M3, status: specced)
- Scenario: A launch discount code leaks, as launch codes always do. The visible exposure is discounted evaluations. The real exposure is that resets are the highest-volume repeat purchase in the business, so a code with no purchase-kind restriction discounts every reset indefinitely and permanently reprices the revenue line that funds payout liability. Nobody notices, because per-transaction revenue looks normal and only slightly lower.
- Correct behavior: `applies_to_kind` (`new`, `reset`, `any`) and `first_purchase_only` on every coupon (SD-M3-04), with `applies_to_kind` **required at creation** rather than silently defaulted, plus `max_redemptions` as launch-code policy and the existing `per_identity_limit`. The detection that actually works is **realized discount rate per plan per week**, because absolute revenue hides a leaked code and realized discount rate does not.
- Golden scenario ref: GS-097.

## EC-060: A reset silently moves a trader onto rules they never agreed to  (2026-08-13, module: M3 + M4, status: specced)
- Scenario: Existing accounts are pinned to their plan version and are safe. Resets are not: a reset resolves the plan version current at reset time. A trader who breaches on Tuesday and rebuys on Wednesday, after a version publishing a lower cap or a longer gap, gets the new rules. Every mechanism behaved as designed, there is no bug anywhere, and the trader is still right to be angry.
- Correct behavior: The reset flow **renders the diff** between the parent account's plan version and the version being purchased whenever they differ, and requires explicit acknowledgement before payment. `copy_blocks` keyed by rule path is what makes the diff renderable at all, which is the same mechanism that keeps marketing equal to implementation, applied at the one moment a trader is most likely to be surprised. Dual control on cap, split, and gap edits ([ADR-010](DECISIONS.md)) means the publish that would trigger this cannot come from a single compromised session.
- Golden scenario ref: GS-098.

## EC-061: A payment event that Merit never originated  (2026-08-13, module: M3, status: specced)
- Scenario: A forged or replayed webhook, or a PSP that reports success optimistically, mints accounts at zero cost. On Direct plans that is a **funded** account, so the attacker is in the money with no evaluation to pass, and unlike a chargeback attack there is no cardholder left to complain, so the only possible detection is Merit's own books.
- Correct behavior: Three layers. Signature verification **throws** before the payload is parsed, with timestamp and nonce replay protection and the key in the platform vault on a 90 day rotation. `purchase.paid` requires a `purchases` row Merit itself created at checkout, matched on `(psp, psp_reference)`; a webhook citing an unknown reference is rejected and alarmed and may never create one. And a **daily reconciliation of accounts created against payments settled** at each provider, compared to the provider's own settlement report, with any discrepancy paging. That third layer is the money-in mirror of the platform balance reconciliation in M2 and exists for the same reason: a pipeline is only known to be honest when it is compared against an independent record.
- Golden scenario ref: GS-099.

---

## Entries from M04 (trader portal)

## EC-062: The payable amount changes between the dashboard render and the tap  (2026-08-13, module: M4 + M5, status: specced)
- Scenario: A trader opens the payout screen at 23:58 showing a maximum of 150,000c. The nightly batch closes a losing day at 00:05. The trader taps Request at 00:07. Naively the client sends 150,000c, the server clamps to 90,000c, and the trader receives an amount they never agreed to. Every component behaved correctly and the failure lives entirely in the seam.
- Correct behavior: The confirm step **re-fetches eligibility** and displays the amount that will actually be sent; when it has moved, the screen says so explicitly and requires a fresh confirmation. The request body carries the displayed amount rather than omitting it, so that the server-side clamp ([ADR-009](DECISIONS.md)) can only ever reduce the figure and the trader's screenshot and their payout can never disagree. A 422 is worded as "not yet, here is what is left", never as a denial, because the zero-denial policy is a copy obligation as well as a system one.
- Golden scenario ref: GS-101.

## EC-063: A share certificate the firm cannot verify  (2026-08-13, module: M4 + M11, status: specced)
- Scenario: Payout share cards are cheap virality and every competitor has them, so adversaries already know the format. A forged card claiming a Merit payout that never happened damages Merit in two directions: outward, when a scam signal service uses fake Merit proof, and inward, when a trader forges a card and the dispute becomes Merit's word against an image.
- Correct behavior: The image is a rendering and the **certificate is the signed row** (SD-M4-01). Every card carries a short code resolving to a public verification page that reports, from that row, exactly what Merit issued. Three rules make it defensible: the verification page is the authority and the image never is; an unknown code returns "no certificate with this code" rather than "this is fake", because the honest claim is the defensible one; and certificates are **revocable**, so a card on an account later closed for chargeback or enforcement says so instead of outliving the fact it proved. Claims are minimal by construction (plan, size, trading day, amount) with no identity and no cumulative totals.
- Golden scenario ref: GS-102.

## EC-064: The breach screen is the highest-yield dark-pattern surface in the product  (2026-08-13, module: M4, status: specced)
- Scenario: A trader has just lost an account, is emotional, and a reset purchase is one tap away. Countdown discounts, pre-checked upgrades, an obscured floor number, and "you were so close" framing all convert better here than anywhere else in the funnel. The revenue is immediate and measurable; the cost is invisible for months and then arrives as a review-page theme. The adversary in this entry is Merit's own future incentive under revenue pressure.
- Correct behavior: The breach screen shows the **arithmetic first**, rendered from the `breach.detected` payload: the floor, the day's low, the shortfall in cents, and which rule fired. The reset offer sits below that explanation, honestly priced, with no countdown, no pre-selection, and no comparative framing. The **ordering is the control**, so it is asserted by a layout test at every breakpoint rather than left to a review checklist that erodes.
- Golden scenario ref: GS-103.

## EC-065: An eligibility notification that was true yesterday and is not true today  (2026-08-13, module: M4 + M10 + M16, status: specced)
- Scenario: A "you are now eligible" notification is generated from a `day.closed` event. The trader reads it the following evening, after another day has closed, and the account is no longer eligible because a losing day moved the buffer or a new best day broke consistency (EC-036). The trader experiences a firm that invited them to request money and then refused. This is the highest-volume support wave available and it is entirely self-inflicted.
- Correct behavior: Three cheap rules. Every notification **carries the trading day it was true on** in the body, not in metadata, so the claim stays permanently true and is reconcilable by the reader. The eligibility notification links to the **eligibility screen, never to a request action**, because a notification that deep-links to a Request button is a notification promising an outcome. And no "you became ineligible" notification is sent, because that is technically transparent and practically cruel; the current state is always one tap away for anyone who wants it.
- Golden scenario ref: GS-105.

---

## Entries from M05 (payout system)

## EC-066: A settled payout that never reduces the platform balance  (2026-08-13, module: M5 + M2, status: specced)
- Scenario: Merit pays 150,000c through the settlement rail. The platform is supposed to reduce the simulated account's balance by the same amount, appearing as `adjustment_cents` on the next mark. If it does not, the account's balance still contains money already paid, the engine computes `withdrawable` from a figure that is too high, and the trader is legitimately eligible to withdraw the same cents again. Every rule passes, nothing is broken, and the ladder does not stop it because each payout is a separate correct ordinal. Reconciliation does not catch it either: our balance and the vendor's **agree**, since both believe the money is still there.
- Correct behavior: The reflection is a tracked fact, not an assumption. Every settled payout enters `balance_reflection_status = 'pending'` (SD-M5-04) and must be observed as an `adjustment_cents` matching amount and account within a window (proposed 3 trading days, OQ-M5-03). Past the window it emits `payout.balance_reflection_missing`, pages, and sets `recon_blocked`, removing the account from eligibility until a human resolves it. **The payout is never reversed.** The fix is a platform-side adjustment recorded as an admin action referencing the settlement, because reversing a settled payout to correct a firm-side error is the worst possible reason to break the never-claw-back promise.
- Golden scenario ref: GS-106.

## EC-067: The payout name match freezes real traders and catches no mules  (2026-08-13, module: M5 + M19, status: specced)
- Scenario: The settlement rail's payout name must match the verified identity, and a mismatch freezes and flags. Two problems. Mules pass it perfectly, because the mule **is** the verified person, so the check does not address the threat it is named for. And names are weak identifiers: transliteration, married and maiden names, hyphenation, middle-name ordering, and diacritics all produce mismatches on entirely legitimate traders, disproportionately those with non-Anglophone names. Under a zero-denial policy, freezing a real trader's payout on a string comparison is the most damaging false positive available.
- Correct behavior: Two separate answers, because they are two separate problems. For the check: a **score with a recorded method** rather than a boolean (SD-M5-02), a configured distance threshold, review inside the bounded freeze window, and a tracked false-positive rate so the threshold is tuned against recorded data rather than guessed before launch. For mules, which the name check does not address: biometric dedupe across all applicants (M19), the device and payment graph (M7), and the strongest signal of the three, **one settlement destination receiving payouts from several unrelated identities**, which is a query rather than an inference and therefore belongs in this module's data as a first-class flag input.
- Golden scenario ref: GS-107.

## EC-068: Instant approval commits the firm before the wallet can react  (2026-08-13, module: M5 + M6, status: specced)
- Scenario: Approval is instant and irrevocable. One identity holding ten copy-traded accounts crosses the win-day gate on the same day and produces up to 1,350,000c to the trader in individually correct, individually capped payouts. The payout wallet is funded weekly and manually ([ADR-011](DECISIONS.md)). The circuit breaker cannot help, because by design it pauses sales and never payouts, and that asymmetry is correct and must not be weakened. The commitment is made before anyone can react, and late settlement is the exact failure the constitution names as fatal.
- Correct behavior: A forecasting and liquidity problem, never a rule. The Eligible-Next-7-Days forecast is a **launch requirement** and aggregates at identity level as well as account level, since a correlated wave is invisible in an account-level sum until it lands. [ADR-011](DECISIONS.md)'s same-day top-up trigger fires on that forecast and emits `treasury.coverage_changed`, so it is an event rather than a dashboard someone remembers to open. The reserve coverage ratio is computed against a **live rail balance** (SD-M5-03), because a ratio derived from our own ledger is one that agrees with itself. And CVaR99 must model request timing as a strategy and correlated identity waves as a scenario, or the reserve is sized for a world where traders request at random. Residual, stated: with no identity ceiling (OQ-7) the one-day exposure is bounded only by cap times account maximum, and the whole mitigation is visibility plus liquidity.
- Golden scenario ref: GS-108, GS-062.

## EC-069: A freeze with no expiry is a denial nobody had to authorize  (2026-08-13, module: M5, status: specced)
- Scenario: A freeze requires a cited open flag, which is a real constraint. Nothing bounds its **duration**. A flag can sit in `investigating` indefinitely, and an indefinitely frozen payout has been denied without anyone typing the word. Every step is individually defensible, which is precisely the problem: the zero-denial policy is enforced against explicit denial and is silent about the implicit kind.
- Correct behavior: `freeze_expires_at` (SD-M5-01), where **expiry releases the payout** rather than extending the hold. `payout.freeze_expiring` fires two business days out so the decision is forced while there is still time to make it properly. Extension is a second, separately audited admin action requiring its own written reason, so an indefinite freeze remains possible but leaves a numbered trail of deliberate decisions rather than a silence. The trader sees the expiry date, because a review with no visible end is indistinguishable from a refusal to the person waiting.
- Golden scenario ref: GS-109.

## EC-070: The ledger zero-sum halt as a cheap denial-of-payouts trigger  (2026-08-13, module: M5, status: specced, founder ruling requested)
- Scenario: `ledger.invariant_violated` is the one event permitted to change system behavior automatically, and what it does is halt payouts. That is correct, because a ledger that does not sum to zero means we do not know what we owe. Viewed from outside it is also an outage switch with a very small activation energy: anyone who can cause a one cent imbalance anywhere halts every payout for every trader until a human intervenes. Candidate levers include a refund and chargeback race on one purchase, a partial refund with an odd amount interacting with a split, and an affiliate commission reversal timed against a statement boundary. The attack never has to move money; it only has to make the books disagree, and the safety control does the damage.
- Correct behavior: **Scope the halt.** A per-transaction imbalance halts payouts for the implicated identity and its accounts; only a **global** sum mismatch halts everything, because only a global mismatch means the aggregate is unknown. Make imbalance structurally hard: the per-transaction zero-sum check is a deferred constraint trigger at commit, so an unbalanced transaction cannot be written at all, which means a global mismatch implies corruption or a direct write and genuinely warrants a global halt. And make the global halt loud and short: page immediately, state the implicated transaction range, and open with the reconciliation query rather than a search for the cause. **This scoping amends the approved EVENTS wording and is OQ-M5-01, pending a founder ruling.**
- Golden scenario ref: GS-110.
