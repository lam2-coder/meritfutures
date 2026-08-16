## 3. GS-001 to GS-029: rule and boundary scenarios (M1)

**`CORE-50K` is the 50K column of [M01 Appendix A.1](../../plans/M01-rules-engine.md#a1-core-eod-core_eod), and this section restates none of it.** Appendix A is approved, it is the only place those numbers are defined, and a reader who needs a value reads it there. The executable form is [`packages/rules-engine/fixtures/plans/CORE-50K.json`](../../../packages/rules-engine/fixtures/plans/CORE-50K.json), transcribed from that column and from nowhere else.

**This paragraph used to restate thirteen of those values, and one of them had drifted** ([ADR-037](../../decisions/ADR-037.md)): it said the ladder was 8 where Appendix A.1 says **5** per [ADR-024](../../decisions/ADR-024.md), in the same sentence that called Appendix A the only authority. **The thirteen copies are the defect and the wrong one is the symptom**, so the copies are deleted rather than corrected. [CI-06g](../STRATEGY.md)'s rule now reaches parameters as well as counts: **a shorthand may not restate a value the config owns.**

| ID | Name | Pins | Rule |
|---|---|---|---|
| GS-001 | Fill at 17:05 CT belongs to the next trading day | Trading day comes from session containment in the calendar, never from the UTC date of the timestamp | R-01 |
| GS-002 | Counters advance on a day the trader did not trade | Trading days advance regardless of activity; traded days do not | R-02 |
| GS-003 | Half day counts as a full trading day | Thanksgiving Friday advances min-day and gap counters identically to a full session | R-03 |
| GS-004 | Halted session advances day counters but not win days | B4 #2 resolution, published as such | R-04 |
| GS-005 | Day with fills and exactly zero P&L | `traded_day = true`, `win_day = false`. The `>` on fill count and the `>=` on the win floor are different operators and both are asserted | R-08, R-09 |
| GS-006 | Win day exactly at the floor counts | `realized_pnl_cents == 15000` satisfies `>= 15000` | R-09 |
| GS-007 | Win day one cent below the floor does not count | `14999 >= 15000` is false. The pair GS-006 and GS-007 is the published boundary | R-09 |
| GS-008 | Initial floor at account open | `floor = size - drawdown = 4,750,000` before any mark exists | R-12 |
| GS-009 | Floor trails a new closing high | close 5,100,000 raises hwb and floor to 4,850,000 | R-13 |
| GS-010 | Floor never retreats after a losing day | close falls to 5,020,000, floor stays 4,850,000 | R-14 |
| GS-011 | Trailing floor ignores the intraday high | high 5,090,000 with close 5,020,000 leaves hwb at 5,020,000 | R-13 |
| GS-012 | Breach compares against the floor at open, not the floor after trailing | Day closes at a new high **and** dipped below the previous floor: breach wins, and the new high is never used to rescue the day | R-18, R-21 |
| GS-013 | Low exactly at the floor survives | `4,750,000 < 4,750,000` is false. This is the auto-liquidation setpoint ruling | R-21 |
| GS-014 | Low one cent below the floor breaches | `4,749,999 < 4,750,000` is true | R-21 |
| GS-015 | Floor lock engages continuously with no jump | At profit 260,000 the trailing floor reaches exactly `size + 10,000` and locks there. Asserts the lock introduces no discontinuity | R-15 |
| GS-016 | Locked floor does not move on a later high | Once locked, a new closing high leaves the floor at `size + 10,000` forever | R-15 |
| GS-017 | Eval passes at exactly the profit target | `300,000 >= 300,000` passes | R-26 |
| GS-018 | Eval one cent below target does not pass | `299,999 >= 300,000` is false | R-26 |
| GS-019 | Eval pass resets the funded phase to the account size | Balance to 5,000,000, floor to 4,750,000, all funded counters to zero. Eval profit is not carried | R-31 |
| GS-020 | Eval consistency defers the pass and dilution later clears it | Best day is 40% of profit on the pass day: deferred, never failed. Two more profitable days dilute to under 30% and the pass fires | R-28 |
| GS-021 | Consistency skipped when period profit is zero | Denominator rule: gate passes by definition, no division is ever attempted | R-30 |
| GS-022 | Consistency skipped when period profit is negative | Same rule, negative denominator | R-30 |
| GS-023 | Consistency at exactly the threshold passes | `best * 10000 == max_bp * profit` satisfies `<=`. Integer cross-multiplication, no division anywhere | R-29 |
| GS-024 | Consistency one cent over the threshold fails the gate | Eligibility is delayed, never denied, and `profit_needed_to_dilute_cents` is reported | R-29, R-36 |
| GS-025 | Withdrawable is balance minus size minus buffer, floored at zero | Balance below `size + buffer` yields exactly 0, never a negative | R-35 |
| GS-026 | Cap clamp when withdrawable exceeds the cap | withdrawable 214,250, cap 150,000, approved 150,000, `clamp_reason: cap` | R-43 |
| GS-027 | Withdrawable clamp when the cap exceeds withdrawable | withdrawable 120,000, cap 150,000, approved 120,000, `clamp_reason: withdrawable` | R-43 |
| GS-028 | Cap exactly equals withdrawable | Exact tie resolves to that value with `clamp_reason: none`. B4 #13's tie case | R-43 |
| GS-029 | Split remainder goes to the trader | approved 100,001 at 9000bp: trader 90,001, firm 10,000, sum exact. Asserts ceiling rounding toward the trader and zero cents lost | R-44 |
