---
status: review
depends_on: [plans/M01-rules-engine.md, testing/GOLDEN_SCENARIOS.md, GLOSSARY.md]
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
- Correct behavior: Three things together, and all three are needed. Non-trading balance movements are carried in `daily_marks.adjustment_cents` (schema delta SD-01) and are applied **between sessions**, at the open of the payout's effective trading day, never inside a session (dependency D-M2-2, and a vendor-confirmation item). The floor is recomputed in the **same step** as the balance drop (R-48), so balance and floor move together and the day's low is compared against a floor that already knows about the withdrawal. And the config validator guarantees `buffer_cents` exceeds any locked-floor offset (CV-11), so a post-payout balance of `size + buffer` sits above even a locked floor. The mark identities `opening == prior_balance + adjustment` and `closing == opening + realized_pnl` are asserted on every mark, and a violation raises reconciliation rather than being computed on. The result is INV-21: a settled payout can never breach the account that earned it.
- Golden scenario ref: GS-065.

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

## EC-039: The cadence anchor changes the published extraction ceiling  (2026-08-13, module: M1, status: open, founder ruling required)
- Scenario: The [cadence gap](GLOSSARY.md#cadence-gap) can be counted from the payout's basis day or from its settlement day. On CORE-50K the choice moves the steady-state extraction ceiling from 19,300c per trading day (settlement anchored, a roughly 7 trading day cycle) to 27,000c per trading day (basis anchored, a 5 trading day cycle), a 40% difference in the per-account liability rate.
- Correct behavior: The constitution's own stated ceiling of roughly 19,000c per day is consistent only with the **settlement** anchor, so the engine is specified settlement-anchored, matching [GLOSSARY](GLOSSARY.md#cadence-gap)'s "counted from the last settled payout". Win days and the consistency period reset on the **basis** day of that same payout, so progress earned during the transfer window is not confiscated. Two anchors, each with a stated reason, both stored on the payout row and both deterministic under replay. **Founder ruling required** because it also decides whether Rapid Daily can be published as daily. See [M01 section 10 OQ-1](plans/M01-rules-engine.md).
- Golden scenario ref: GS-055, GS-059, GS-068.

## EC-040: Payout stacking inside the settlement window  (2026-08-13, module: M1 + M5, status: specced)
- Scenario: Win days and the consistency period reset on settlement. A trader who is eligible fires a second and third request during the two to three business day transfer window, before any reset has happened, and converts one qualifying stretch into three capped extractions.
- Correct behavior: G-NO-IN-FLIGHT is part of eligibility: no request may be created while another for the same account is `approved`, `transferring`, or `frozen`. Enforced by a partial unique index, not only by the engine, because the engine is not the only writer. This is a liability control and is documented as one wherever the `conflict` error appears.
- Golden scenario ref: GS-052, GS-053.

## EC-041: The funded account does not start at the account size  (2026-08-13, module: M1 + M2, status: specced)
- Scenario: On eval pass, the platform fails to reset the simulated account and the first funded mark opens at the eval closing balance. The trader begins the funded phase already in profit, clears the buffer immediately, and can extract before any funded gate has had time to work.
- Correct behavior: The funded phase begins at `size_cents` and eval profit is never carried. The engine asserts `first funded mark.opening_balance_cents == size_cents` and refuses the day with a reconciliation error rather than computing on it. Whether M2 achieves the reset by resetting the platform account or provisioning a new one is M2's choice; the assertion is M1's contract either way.
- Golden scenario ref: GS-070, GS-019.

## EC-042: Minimum trading days is dominated by the win-day gate  (2026-08-13, module: M1, status: specced)
- Scenario: CORE-50K requires 5 win days and 5 minimum trading days. Since every win day is a traded day, the minimum-days gate can never be the binding constraint and provides no protection whatsoever.
- Correct behavior: The gate stays (it is the binding one on any plan where `required_win_days < min_trading_days`, and it is what stops a one-day funded account on a future config), but the plan-config validator warns at publish when `required_win_days >= min_trading_days`, so nobody believes a decorative gate is doing work. Marketing copy must not present it as a separate protection on plans where it is dominated.
- Golden scenario ref: GS-060.

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
