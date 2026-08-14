---
status: approved
depends_on: [../plans/M01-rules-engine.md, ../GLOSSARY.md, ../architecture/DATA_MODEL.md, ../EDGE_CASES.md, ../DECISIONS.md]
last_updated: 2026-08-14
---

# Golden Scenarios

Hand-built scenario fixtures, numbered. **Tests cite scenario numbers**, never prose. Per [GLOSSARY](../GLOSSARY.md#golden-file) and constitution C10, every scenario here derives from a plan doc or an approved constitution scenario and **never** from implementation output. That rule is the whole defence against the self-grading trap: if a fixture was written by reading the code, it proves only that the code agrees with itself.

**Seeded in Wave 3 by [M01](../plans/M01-rules-engine.md), and GS-001 to GS-083 approved with it at the M1 gate on 2026-08-13.** Each later module plan appends its own block and those scenarios carry that plan's status. Constitution section 5.2 requires at least 40 golden files. **GS-001 to GS-083 are M1's**, of which 67 are executable against the pure engine with zero I/O, plus 5 (GS-034, GS-035, GS-041, GS-047, GS-050) where M1 owns an assertion inside a scenario another module drives. The numbering map below is the current total.

**Five scenarios were added and four rewritten by the M1 gate rulings** ([ADR-013](../DECISIONS.md), [ADR-014](../DECISIONS.md), [ADR-015](../DECISIONS.md)). **Fourteen more were added and four rewritten by the Wave 3 batch 1 gate rulings** ([ADR-016](../DECISIONS.md) through [ADR-020](../DECISIONS.md)), bringing the registry to **141**. A golden file that pinned a behavior the founder overruled is not quietly deleted: it is rewritten to pin what was actually decided, and the row says so, because a fixture that silently changes meaning is how a suite stops being a specification.

**GS-055 is the one to read if you read only one row of that rewrite.** It pinned the extraction ceiling under the settlement anchor and carried the basis-anchored case as an expected-to-fail counterfactual. [ADR-019](../DECISIONS.md) made the counterfactual live, so the fixture now pins the opposite direction. That is exactly the situation this file's rule about rewriting rather than deleting exists for: the number changed because a decision changed, and both the number and the decision are on the record.

## 1. Numbering map

| Range | Contents | Owner |
|---|---|---|
| GS-001 to GS-029 | M1 rule and boundary scenarios, one per pinned operator | M1 |
| GS-030 to GS-051 | The Appendix B4 evil-brain battery, `GS-(029 + n)` maps to B4 item `n` | mixed, listed per row |
| GS-052 to GS-070 | M1 adversarial scenarios, including the novel set from [M01 section 7](../plans/M01-rules-engine.md) | M1 |
| GS-071 to GS-078 | Replay, engine-upgrade, and plan-config validation scenarios | M1 |
| GS-079 to GS-083 | Scenarios created by the M1 gate rulings | M1 |
| GS-084 to GS-093 | Rithmic bridge: ingest, provisioning, entitlements, setpoints | M2 |
| GS-094 to GS-099 | Billing and checkout: caps, failover, chargebacks, coupons, publish | M3 |
| GS-100 to GS-105 | Trader portal: transparency, confirm-time truth, certificates, ATO | M4 |
| GS-106 to GS-111 | Payout system: reflection, mules, reserve waves, freezes, ledger halts | M5 |
| GS-112 to GS-117 | Admin and ops: redaction, breakers, suppressions, liability definitions | M6 |
| GS-118 to GS-122 | Risk and abuse: detection cadence, group hedging, queue integrity | M7 |
| GS-123 to GS-127 | Affiliate: clawbacks, fleet funding, cookie stuffing, compliance, mule rail | M8 |
| GS-128 to GS-141 | Scenarios created by the Wave 3 batch 1 gate rulings: the Merit Wallet, the indicative realtime layer, the new detectors, fail-closed provisioning, the scoped ledger halt, and the typed publish diff | mixed, listed per row |

## 2. Fixture format

Each scenario is a YAML file at `packages/rules-engine/fixtures/GS-NNN-<slug>.yaml` with an expected end-state JSON sibling. The format is fixed so a fixture is readable by a human and loadable by a test without a parser of its own.

```yaml
id: GS-011
name: trailing floor does not trail on an intraday spike
source: M01 R-13, R-18
plan: CORE-50K              # resolves to fixtures/plans/CORE-50K.json, a full plan_version + size row
account:
  phase: funded
  opened_on: 2026-11-02
  size_cents: 5000000
calendar: cme-2026          # fixtures/calendars/cme-2026.json, real sessions including half days
days:                       # one row per trading day, in order; the exact daily_marks input
  - trading_day: 2026-11-03
    opening_balance_cents: 5000000
    closing_balance_cents: 5020000
    high_balance_cents: 5090000
    low_balance_cents: 4995000
    realized_pnl_cents: 20000
    fill_count: 4
    adjustment_cents: 0
settlements: []             # payout settlements folded into the day stream, see M01 section 3.1
expect:
  end_state:
    phase: funded
    floor_cents: 4770000
    high_water_balance_cents: 5020000
    breached: false
  events: [day.closed]
  pins: "floor trails the closing balance, never the intraday high"
```

`expect.pins` is prose stating **which operator or ordering the scenario exists to protect**. A fixture without a pin is a regression test, not a golden file, and gets rejected in review.

## 3. GS-001 to GS-029: rule and boundary scenarios (M1)

Plan shorthand resolves to [M01 Appendix A](../plans/M01-rules-engine.md), which is approved and is the only place these numbers are defined. CORE-50K: size 5,000,000c, drawdown 250,000c, eval target 300,000c, buffer 100,000c, win-day floor 15,000c, 5 win days, funded consistency 3000bp, funded min days 0 (gate disabled), cadence gap 5, cap 150,000c, min payout 10,000c, split 9000bp, ladder 8, floor lock enabled at 260,000c of profit fixing the floor at size + 10,000c, no post-payout floor recompute.

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

## 4. GS-030 to GS-051: the Appendix B4 battery

`GS-(029 + n)` is B4 item `n`, so the mapping never needs looking up. Rows marked M1 are executable against the pure engine now; the others are numbered here and specified by their owning module plan.

| ID | B4 | Scenario | Owner | Expected behavior (M1 rows are binding here) |
|---|---|---|---|---|
| GS-030 | 1 | DST transition day | M1 | Day boundary follows the exchange calendar. The 23 hour and 25 hour sessions each produce exactly one trading day and one mark |
| GS-031 | 2 | CME halt or limit-locked session | M1 | Calendar trading days advance, win days do not. Cadence gap and min-day counters progress. Published as such |
| GS-032 | 3 | Half day (Thanksgiving) | M1 | Counts as a full trading day, identical to GS-003 with the real calendar |
| GS-033 | 4 | Ingest file late or corrupt mid-row | M2 | Whole-file quarantine, zero rows committed, alert, yesterday's states untouched. M1's assertion: given no new mark, no rule state advances and no counter moves |
| GS-034 | 5 | Backdated correction for a closed day | M1 + M2 | New mark supersedes, replay recomputes forward, stored states change, **a settled payout is never clawed back**, `ingest.correction_received` and a review flag fire |
| GS-035 | 6 | Payout at 23:59:59 versus batch at 00:05 | M1 + M5 | Both evaluate against the same last closed day. The request is unaffected by the in-flight batch |
| GS-036 | 7 | Two accounts, same identity, payout the same second | M5 | Both valid, independent, row-locked per account. M1's assertion: two independent folds produce two independent states with no shared counter |
| GS-037 | 8 | Rise webhook replayed 50 times | M5 | Exactly one settlement, exactly one win-day reset, exactly one floor recompute |
| GS-038 | 9 | PSP duplicate and out-of-order delivery | M3 | One account, correct final state |
| GS-039 | 10 | Chargeback after a settled payout | M3 + M5 | Account closes, identity flagged, ledger reversal posted, identity nets negative and the books say so |
| GS-040 | 11 | Coupon race across two tabs | M3 | One redemption wins, decided by the unique index |
| GS-041 | 12 | Plan v2 published while checkout is open on v1 | M3 + M1 | Buyer gets v1, provably. M1's assertion: an existing account's `plan_version_id` is an engine input and no published version ever mutates a live account's rules |
| GS-042 | 13 | 100.00 versus 99.99 minimum, 0.01 requests, cap tie | M1 | `10000 >= 10000` eligible; `9999` not eligible; a supplied `1` clamps to 1 and fails the minimum gate rather than paying 1 cent |
| GS-043 | 14 | Micro versus mini mixed fills | M2 | Tick value from `contract_specs`, never a hardcoded multiplier. M1 consumes only the resulting P&L and asserts no symbol-aware logic exists in the engine |
| GS-044 | 15 | Passes eval while payouts are frozen | M1 | Progression continues, `phase.passed` fires, payouts stay gated, comms template fires. Freezing is not a rule input to progression |
| GS-045 | 16 | Affiliate buys through their own code | M8 | Attribution voided, flag raised |
| GS-046 | 17 | Identity merge after both identities were funded | M7 | Existing accounts grandfathered, new purchases blocked, `accounts_at_merge` recorded |
| GS-047 | 18 | Batch crashes at account 2,341 of 5,000 | M1 + M2 | Resumable, idempotent, no double-applied day. M1's assertion: applying the same day twice is a no-op on state |
| GS-048 | 19 | Restore from backup with payouts mid-queue | M5 | No duplicate transfers; idempotency keys survive the restore |
| GS-049 | 20 | Fuzz: adversarial day sequences | M1 | Alternating 14,999 and 15,001 days, a single 1,000,000 day into consistency math, and 100-day flat grinds. Hunts rounding, overflow, and monotonicity breaks. Runs as a property suite as well as a fixture |
| GS-050 | 21 | Six-account hedged syndicate rehearsal | M7 + M1 | Detectors flag by day 3; caps bound worst-case extraction to the computed ceiling. M1 supplies the ceiling arithmetic, see GS-060 |
| GS-051 | 22 | 500 simultaneous payout requests in one minute | M5 | All correct, p95 under 1s |

## 5. GS-052 to GS-070: adversarial scenarios (M1 section 7)

| ID | Name | Source | Pins |
|---|---|---|---|
| GS-052 | Payout stacking before settlement | AS-01, novel. **Rewritten by [ADR-019](../DECISIONS.md)** | Two halves, because the wallet split the leg the attack lived in. **Internal:** three requests fired in the same transaction window produce exactly one wallet credit, one ordinal, and one win-day reset, because the internal leg completes atomically and leaves no window to stack inside. **External:** three wallet-to-rail withdrawals fired inside the transfer window are refused by G-NO-IN-FLIGHT, which now guards the external leg only. Without the rule, one qualifying stretch funds three capped extractions |
| GS-053 | Stacking attempt across the settlement boundary | AS-01, novel | Request 2 lands the instant request 1 credits the wallet: win days have reset to the basis-day anchor, so it fails the win-day gate rather than paying. Under [ADR-019](../DECISIONS.md) that boundary is the same trading day rather than days later, which makes this the **only** remaining line of defence on the internal leg and is why the fixture is kept rather than folded into GS-052 |
| GS-054 | Manufactured dilution days from a hedged pair | AS-02, novel | Account A takes controlled small profits solely to inflate the consistency denominator while account B carries the loss. Engine behaves correctly; the scenario asserts the detector signal exists and that consistency alone does not stop it |
| GS-055 | Minimum-variance path to a full-cap extraction | AS-03, novel. **Rewritten by [ADR-013](../DECISIONS.md), rewritten again by [ADR-019](../DECISIONS.md)** | Five days at 50,000c each, best-day share 2000bp, clears every gate: the floor on days-to-first-payout is 5 trading days. Steady state on Core EOD is then **5 trading days per cycle** under the live wallet-credit anchor, giving **27,000c per trading day** to the trader. The fixture carries the settlement-anchored figure (7 to 8 day cycle, 16,875c to 19,286c per day) as the **superseded counterfactual**, retained so that the liability cost of the wallet stays visible in the suite rather than only in an ADR. **The expected-to-fail direction has inverted**: what must now fail loudly is any future change that re-introduces a settlement term into the cadence anchor, because that would silently *reduce* modeled extraction and hide a product regression |
| GS-056 | Locked floor converts the account into a free option | AS-04, novel. **Rewritten by [ADR-014](../DECISIONS.md)** | The lock is enabled on all three plans and there is no post-payout reset, so this asserts the shipped behavior rather than a comparison between two modes. After the lock engages at `size + 260,000c` of high water, a maximum-variance day cannot breach below `size + 10,000c`, and the post-payout balance of `size + 100,000c` leaves exactly 90,000c of loss room. Pins the free option as **accepted and bounded**: the only capital at risk is the buffer, which was never withdrawable |
| GS-057 | Correction lands after settlement and favors the trader | AS-05, novel | Never clawed back, flagged, absorbed. Asserts the absorbed amount is computed and reported rather than silently dropped |
| GS-058 | Correction lands after settlement and favors the firm | AS-05, novel | Symmetric treatment: also never clawed back, also flagged. Asserts the policy is not one-directional |
| GS-059 | Holiday cluster compresses the cadence gap in calendar time | AS-06, novel | Five trading days spanning the Christmas cluster is 9 calendar days; the same five trading days in June is 7. Asserts the gap is counted in trading days and that the published copy says so |
| GS-060 | Zero-risk day farming for min-trading-days | AS-07, novel. **Rewritten by [ADR-015](../DECISIONS.md)** | One micro round trip per day advances traded days at commission cost. The funded min-days gate is now configured 0 and reports `skipped`, so the fixture asserts two things: that the farming pattern buys nothing against the real gates (win days, buffer, consistency), and that a disabled gate renders as disabled rather than as satisfied. Pairs with GS-080 |
| GS-061 | Peak-picking: requesting on a local maximum | AS-08, novel | A volatile account requests on its best close. Asserts the firm systematically pays at trader-chosen local maxima and hands the premium to the simulation harness to price |
| GS-062 | Identity-level correlated eligibility wave | AS-09, extends B4 #7 | Ten copy-traded accounts under one identity clear the win-day gate the same day. Each is individually correct and capped; the aggregate is 1,500,000c in one day. Asserts the identity-level forecast exists |
| GS-063 | Breach and profit target on the same day | Constitution M1 | Breach wins, account closes, no `phase.passed`, no funded state written |
| GS-064 | Breach and payout eligibility on the same day | M1 extension | Breach wins. An eligibility that existed at the previous close does not survive the breach check |
| GS-065 | Settled payout drops the balance toward a floor that does not move | AS-10, novel. **Rewritten by [ADR-014](../DECISIONS.md)** | The withdrawal is an adjustment, not a loss, and the floor is **not** recomputed to compensate. Asserts that the breach comparison neutralizes non-trading balance movements, that the day's opening balance after a maximum capped payout still sits above the floor by the buffer minus the lock offset, and therefore that a payout can never breach the account that earned it. INV-21 now rests on config validation (CV-11, CV-17), so this fixture is paired with GS-083, which proves the validator catches the config that would break it |
| GS-066 | Failed transfer does not consume a ladder rung | AS-11, novel | Ordinal 3 fails, the retry is ordinal 3 again, `payouts_settled_count` never moved, graduation still requires 8 settled |
| GS-067 | Graduation fires exactly on the ladder count | Constitution M1 | The 8th settlement graduates; the 7th does not. `>=` asserted at both boundaries |
| GS-068 | Consistency period boundary at the settlement day | AS-12, novel | The basis day itself is excluded from the new period and the day after is included. Asserts a one-day off-by-one cannot silently move eligibility |
| GS-069 | Adding profit on the best day breaks a passing consistency gate | AS-13, novel | The monotonicity counterexample. Eligibility is **not** monotone in profit, contrary to constitution section 5.1's phrasing, and the fixture is the proof |
| GS-070 | Funded start balance does not equal size | AS-14, novel | A platform that fails to reset the funded account produces a first funded mark whose opening balance is not `size_cents`. The engine refuses the day and raises reconciliation rather than computing on it |

## 6. GS-071 to GS-083: replay, upgrade, and config validation (M1)

| ID | Name | Pins |
|---|---|---|
| GS-071 | Replay of a 250-day funded life reproduces every stored state byte-identically | The core determinism claim, asserted on state hashes and then field by field |
| GS-072 | Replay with days delivered in shuffled arrival order | Canonical ordering is by trading day, not by arrival. Same output |
| GS-073 | Replay under a different process timezone and locale | `TZ=Asia/Kolkata` and a non-English locale produce identical output. Guards the banned-construct list |
| GS-074 | Replay after a correction supersedes day 40 of 250 | States from day 40 forward change, states before day 40 do not, and the settled payout on day 60 keeps its original snapshot |
| GS-075 | Engine upgrade that changes historical output is caught, not silently applied | The upgrade protocol produces a diff report and requires approval. An unapproved divergence pages |
| GS-076 | Plan config rejected at publish: cap below the minimum payout | Nobody can ever be paid under this config. Publish fails with the failing validation rule named |
| GS-077 | Plan config rejected at publish: consistency threshold of 0 bp or above 10000 bp | Impossible and meaningless configurations respectively |
| GS-078 | Plan config rejected at publish: intraday trailing drawdown selected in v1 | Config-supported and explicitly unimplemented. Publishing it fails loudly rather than computing something plausible |

## 7. GS-079 to GS-083: scenarios created by the M1 gate rulings (M1)

Every row here exists because a founder ruling on 2026-08-13 changed a rule, an operator, or a config value. They are numbered after the original set rather than inserted, so no existing fixture reference moves.

| ID | Name | Source | Pins |
|---|---|---|---|
| GS-079 | Hard daily loss limit exactly at the limit survives | OQ-6, [M1 gate](../DECISIONS.md#m1-gate-closure-2026-08-13) | A day whose realized loss equals `daily_loss_limit_cents` exactly does **not** breach, and one cent more does. Asserts R-22's strict `>` and, in the same fixture, R-21's strict `<` on the floor, so the two operators are pinned **together**. The point of the file is not the DLL, which no v1 plan configures: it is that the two breach comparators can never drift apart unnoticed, since the day they disagree is the day a trader loses an account on a rule Merit publishes as "more than" |
| GS-080 | A gate configured to zero renders as disabled, not as satisfied | OQ-3 and OQ-8, [ADR-015](../DECISIONS.md) | Funded `min_trading_days = 0` produces `pass: true, skipped: true` in `engine_gates`, the same shape the consistency denominator rule uses, and the eligibility response distinguishes it from a gate that was evaluated and passed. Asserts that `engineEligible` is unaffected. Exists because "a gate that is always true" and "a gate that is turned off" look identical in a boolean and must not look identical to a trader or a support agent |
| GS-081 | Settlement leaves the floor, the high-water balance, and the lock untouched | OQ-5, [ADR-014](../DECISIONS.md) | A capped payout settles on a locked account and on an unlocked one. In both cases `floor_cents`, `high_water_balance_cents`, and `floor_locked` are byte-identical across the settlement while `balance_cents` falls by exactly `approved_cents`. No `payout.floor_recomputed` event is emitted. This is the direct fixture for the retirement of the post-payout recompute, and it is what makes INV-06 assertable with no settlement carve-out |
| GS-082 | Merit Rapid: the win-day gate is what binds, and the cadence gap never does | OQ-1 and OQ-12, [ADR-013](../DECISIONS.md), **re-materialized by [ADR-018](../DECISIONS.md) and [ADR-019](../DECISIONS.md)** | On a `merit_rapid` account with `win_days.required_count = 3` and `cadence_gap_trading_days = 1`, a request on the first or second trading day after the basis day fails on the **win-day** gate. The same account qualifies on the **third** trading day. The 1 day gap is asserted to pass on every one of those days, including the ones that fail, which is what proves it is dominated rather than merely inactive. Pins the published 3 trading day cadence that M09 and M04 render, and pins that the gap may not be described as the reason the plan is fast |
| GS-083 | Plan config rejected at publish: trailing drawdown, lock disabled, cap at or above the drawdown | CV-17, [ADR-014](../DECISIONS.md) | Publishing fails with CV-17 named. The fixture also carries the arithmetic of what would have happened: an account paid on a new closing high would open the next session below its own floor and breach on the day it was paid. This is the file that keeps INV-21 true now that no post-payout recompute exists to rescue it |

## 8. GS-084 to GS-093: Rithmic bridge (M2)

Defined by [M02](../plans/M02-rithmic-bridge.md) section 8.3. These run against the **simulator adapter** until a real vendor file exists, which is itself the subject of GS-084.

| ID | Name | Pins |
|---|---|---|
| GS-084 | Simulator file and vendor file traverse the identical parser | The simulator writes CSV into the ingest path and no downstream code branches on source. The counter to the corpus's own biggest ingest risk: with no vendor sandbox, the simulator is the only spec we have, so it must not be a second code path. AS-M2-01 |
| GS-085 | Hostile-but-legal file shapes | BOM, CRLF, reordered columns, an extra trailing column, a zero-account day, a 200MB file. Each either parses identically or quarantines whole; none partially applies |
| GS-086 | Redelivered file for an already-applied day with no correction markers | Whole-file quarantine, zero rows committed, the alarm names the trading day. Asserts that a silent double-apply is impossible, which is the failure that would corrupt every downstream number at once. AS-M2-02 |
| GS-087 | Day low below the floor with no liquidation record | The behavioral setpoint check fires and `platform.setpoint_unconfirmed` is emitted. Pins the only detection Merit has for an account whose auto-liquidator was never actually configured. AS-M2-03 |
| GS-088 | Entitlement hygiene attempts a disable on an `active` account | Hard error, nothing disabled, alarm. Asserts the asymmetry: leaking cost is a warning, cutting off a live trader is a bug. AS-M2-04 |
| GS-089 | Inbound row citing a retired `platform_account_ref` | Whole-file quarantine, never routed to any account. Asserts that a vendor identifier is burned permanently on close. AS-M2-05 |
| GS-090 | Vendor session date disagrees with calendar containment | Both values stored, the divergence alarms, and our calendar still decides `fills.trading_day`. Asserts we detect the disagreement rather than resolving it silently in our own favor. AS-M2-06 |
| GS-091 | Correction after settlement records its delta against the superseded mark | The absorbed amount stays computable after replay has run, because the original number survives only on the superseded row. AS-M2-07, pairs with GS-057 and GS-058 |
| GS-092 | Balance delta matching no known settlement and no fills | Quarantine. Never classified as realized P&L, never guessed. INV-M2-12, EC-051 |
| GS-093 | Funded reset post-condition | After `phase.passed`, the next opening balance is exactly `size_cents`, asserted by M2 before the engine sees the mark. Pairs with GS-070, which asserts the engine refuses when it is not. DEP-M2-01 |

## 9. GS-094 to GS-099: billing and checkout (M3)

Defined by [M03](../plans/M03-billing-checkout.md) section 8.2. The B4 commerce battery (GS-038 to GS-041, GS-046) is shared and stays where it is.

| ID | Name | Pins |
|---|---|---|
| GS-094 | Account cap enforced per identity, not per email | Two emails resolving to one identity, cap of 10: the eleventh purchase is refused with `account_cap_reached`. Asserts constitution B1's binding identity rule at the one endpoint where getting it wrong costs money and creates a fleet |
| GS-095 | Failover never retries a purchase at the second MID | A slow PSP-A session that later succeeds produces exactly one charge and one account, and the double-charge fingerprint alarm fires on two `paid` purchases for the same plan and size inside five minutes. Asserts failover is per-attempt routing and never mid-transaction. AS-M3-02 |
| GS-096 | Chargeback lands after a settled payout | Account closes, identity flagged, compensating reversal posted, identity nets negative and the ledger says so. The settled payout is **not** clawed back. Extends GS-039 with the deliberate version of the attack. AS-M3-03 |
| GS-097 | Coupon restricted by purchase kind | A `new`-only code is refused on a reset with `conflict`, and a coupon with no `applies_to_kind` cannot be created at all. Asserts that a leaked launch code cannot silently reprice resets forever. AS-M3-04 |
| GS-098 | Reset onto a changed plan version renders the rule diff | Parent account on v1, current published version is v3 with a lower cap: the reset flow renders the changed rules from `copy_blocks` and refuses payment without explicit acknowledgement. Asserts that the one place a trader can be surprised by a rule change is the one place the diff is mandatory. AS-M3-05 |
| GS-099 | Webhook citing an unknown purchase reference | Rejected and alarmed; no purchase row and no account created. Asserts that a `purchases` row Merit itself wrote is a precondition for any paid state, so a forged or replayed event cannot mint a funded account. AS-M3-06 |

## 10. GS-100 to GS-105: trader portal (M4)

Defined by [M04](../plans/M04-trader-portal.md) section 8.2. These are Playwright and component-contract fixtures rather than engine fixtures, and they follow the same rule: each pins a decision, not a rendering.

| ID | Name | Pins |
|---|---|---|
| GS-100 | Consistency meter and dilution amount render on a **passing** account | Both visible when the gate passes, not only when it fails. The OQ-9 ruling, and the reason AS-13 (making money and losing eligibility) does not read as a moved goalpost. AS-M4-01 |
| GS-101 | Eligibility moves between dashboard render and confirm | The confirm step re-fetches, states plainly that the amount changed, and requires fresh confirmation; the request body carries the displayed amount so the server clamp can only ever reduce it. Asserts the trader's screenshot and their payout can never disagree. AS-M4-02 |
| GS-102 | Certificate verification: valid, unknown, revoked | Valid resolves to the signed claims; an unknown code returns "no certificate with this code" rather than "fake"; a revoked certificate states its revocation. Asserts the verification page is the authority and the image never is. AS-M4-03 |
| GS-103 | Breach screen ordering at every breakpoint | Floor, day low, shortfall, and rule name appear above the reset call to action at 375px and 1280px, with no countdown and no pre-selected option. Asserts the ordering itself is the anti-dark-pattern control. AS-M4-04 |
| GS-104 | Payout destination change enters a 48 hour cooling window | Accepted, not effective, notified to the existing contact, and visible in the active-session view. Asserts the one control that survives an attacker holding a valid session. AS-M4-05 |
| GS-105 | Eligibility notification names its trading day and links to the gates screen | The body carries "as of <trading day>" and deep-links to eligibility rather than to a request action. Asserts a notification never promises an outcome it cannot guarantee is still true. AS-M4-06 |

## 11. GS-106 to GS-111: payout system (M5)

Defined by [M05](../plans/M05-payout-system.md) section 8.2. The B4 payout battery (GS-035 to GS-039, GS-048, GS-051) is shared and stays where it is.

| ID | Name | Pins |
|---|---|---|
| GS-106 | A settled payout never appears as an adjustment on any mark | The observation window expires, `payout.balance_reflection_missing` pages, the account is `recon_blocked`, and the payout is **not** reversed. Asserts that having paid and the account knowing it was paid are two separate claims, and that the second one is checked. AS-M5-01 |
| GS-107 | Name match scored across a realistic set | Transliteration, a married name, middle-name ordering, and a genuine third-party destination. Only the last crosses the freeze threshold and every score is recorded. Asserts the check is a tunable score rather than a boolean, because a strict string comparison freezes real traders and catches no mules. AS-M5-02 |
| GS-108 | Ten correlated accounts under one identity approve on the same day | All ten individually correct and individually capped; the identity-level forecast showed the wave before it landed; `treasury.coverage_changed` fired the same-day top-up trigger. Asserts that the answer to a correlated wave is liquidity and visibility, never a payout block. AS-M5-03, pairs with GS-062 |
| GS-109 | A freeze reaches its expiry with no decision made | The payout **releases**. Extension requires a separate audited action with its own written reason. Asserts that an unbounded hold is a denial nobody had to authorize, and that the clock binds Merit rather than the trader. AS-M5-04 |
| GS-110 | A one cent per-transaction ledger imbalance | Halts payouts for the implicated identity only; a global sum mismatch halts everything and pages. Asserts that the system's own safety control is not itself a cheap denial-of-payouts trigger. AS-M5-05 |
| GS-111 | Settlement rail outage during a payout wave | Transfers queue with idempotency keys intact, no state is lost, and the pre-written comms template reaches every affected trader before any of them asks. Asserts that the communications response is part of the definition of done, not an afterthought. AS-M5-07 |

## 12. GS-112 to GS-117: admin and ops console (M6)

Defined by [M06](../plans/M06-admin-ops-console.md) section 8.2. Three of these pin controls against Merit's own future behavior rather than against an external adversary, which is deliberate: the failure this module actually suffers is a control that gets ignored.

| ID | Name | Pins |
|---|---|---|
| GS-112 | Evidence pack redaction by declared audience | A `trader` pack carries every fill, mark, rule state, gate result, the plan's rule text, and the fact and ToS clause of any flag, and carries **no** detector parameter, threshold, or other identity. An `internal` pack carries everything. Asserts that answering a dispute cannot also publish the detection thresholds to the ring that triggered them. AS-M6-01 |
| GS-113 | Loss ratio computed on a sample below the minimum | State is `insufficient_data`, sales are **not** paused, and the alert carries the sample size. Asserts the breaker's first firing is not a false one, because a control that is wrong the first time is a control that gets overridden every time after. AS-M6-02 |
| GS-114 | Alarm suppression expires and the alarm returns by itself | Suppression requires a written reason and a mandatory expiry; expiry restores automatically; ledger imbalance, replay divergence, and payout balance-reflection-missing cannot be suppressed at all. Asserts that "temporarily off" is a dated fact rather than a thing people tell themselves. AS-M6-03 |
| GS-115 | The three liability numbers diverge on one book | An account with 500,000c withdrawable, a 150,000c cap, and 6 ladder rungs left contributes 500,000c to open liability, 150,000c to bounded near-term liability, and 900,000c to remaining ladder exposure. Asserts they are named separately and never conflated, which is the precise failure that killed FTT. AS-M6-04 |
| GS-116 | Evidence pack export burst | Ten exports inside an hour alerts; signed URLs are short-lived and single-use; no screen returns a bulk identity list. Asserts the admin console's read surface is treated as a crown jewel, not only its write surface. AS-M6-05 |
| GS-117 | Reversing a protective state requires the reason typed first | Unfreeze, breaker override, and entitlement re-enable each require a reason before the confirm control enables; a breaker override with no expiry is rejected; no route edits a verified identity at all. Asserts that the dangerous actions are slow by design, because the operator being social-engineered is the founder on a phone. AS-M6-06 |

## 13. GS-118 to GS-122: risk and abuse (M7)

Defined by [M07](../plans/M07-risk-abuse.md) section 8.1. The ring rehearsal (GS-050) and the M1 adversarial fixtures it depends on (GS-054, GS-060, GS-062) are shared and stay where they are.

| ID | Name | Pins |
|---|---|---|
| GS-118 | Detection cadence beats extraction on the minimum-variance path | A six-account ring on the 5 trading day path is flagged by fill clustering and group exposure before the first settlement lands, and the inverse-pair detector is asserted **not** to have fired, because its 20 day window has no data yet. Pins the honest conclusion that the flagship correlation detector does not defend the first cycle at all. AS-M7-01 |
| GS-119 | Three-leg rotation defeats pairwise correlation and not group variance | Every pair sits comfortably inside the pairwise threshold while the group's summed variance sits far below the sum of member variances, and the group detector fires. Pins the invariance that makes rotating legs pointless. AS-M7-02 |
| GS-120 | Queue ordering under manufactured noise | Fifty innocent clustering flags do not outrank one identity with three independent detector families implicated, and a detector whose precision collapses is auto-demoted to digest severity as a data change rather than a deploy. Pins attention as the scarce resource an adversary can attack. AS-M7-03 |
| GS-121 | Household signals produce a soft link and never a merge | Shared IP, shared device, and shared card across two identities produce edges below the confidence ceiling, caps do **not** aggregate, and a disputed link renders on the graph before an admin acts. Pins the asymmetry: over-merging harms people who did nothing wrong and who are sympathetic, articulate, and telling the truth. AS-M7-04 |
| GS-122 | A detector run that finds none of its own canaries | Status `degraded`, `detector.run_degraded` emitted, page fired. Synthetic subjects are excluded from every aggregate and are regenerated per run rather than static. Pins the only difference between a broken detector and a quiet night. AS-M7-05 |

## 14. GS-123 to GS-127: affiliate system (M8)

Defined by [M08](../plans/M08-affiliate-system.md) section 8.1. GS-045, the B4 self-purchase case, is shared and stays where it is.

| ID | Name | Pins |
|---|---|---|
| GS-123 | Chargeback lands after the commission was paid | The clawback posts, the affiliate balance goes negative and nets against future commission, and a chargeback rate above the threshold **holds the next statement** pending review rather than merely appearing on a dashboard. Pins the accepted consequence of paying affiliates before the chargeback window closes, which is the only commercially available option. AS-M8-01 |
| GS-124 | An affiliate whose referred buyers cluster on shared signals | The concentration flag fires, commission is withheld on purchases by identities linked above the confidence ceiling, and a genuine family referral below the ceiling is **not** voided. Pins the extension of the self-deal check from "the buyer is the affiliate" to "the buyer is linked to the affiliate". AS-M8-02 |
| GS-125 | Ten thousand clicks with a near-zero conversion rate | The suspicious-pattern event fires on the clicks-to-conversions ratio and the distinct-referrer count, routes to the risk queue, and does **not** auto-suspend. The 30 day attribution window is deliberately unchanged, because shortening it would punish legitimate content affiliates to stop a pattern that is detectable directly. AS-M8-03 |
| GS-126 | A required disclosure version is superseded | Every creative bound to the old version is withdrawn automatically, and an approved landing page whose content later changes reverts to `pending` on re-check. Pins approval as per-asset and per-disclosure-version rather than a boolean on the affiliate. AS-M8-04 |
| GS-127 | An affiliate destination also receives trader payouts from unrelated identities | The shared destination-concentration detector fires across both payment types, because affiliate payments ride the same transfer machinery as trader payouts. Pins the general rule that every outbound payment path in Merit is the same path. AS-M8-05 |

## 15. GS-128 to GS-141: scenarios created by the Wave 3 batch 1 gate rulings

Defined by the rulings recorded in [DECISIONS.md](../DECISIONS.md#wave-3-batch-1-gate-closure-2026-08-14). Same discipline as every block above: each derives from the ruling and the plan doc, never from an implementation.

| ID | Name | Owner | Pins |
|---|---|---|---|
| GS-128 | A payout credits the wallet in the same transaction it is approved | M5 | Approval, the LT-01 posting, and the wallet credit commit together or not at all. `cadence_anchor_day` equals `basis_trading_day`, both anchors coincide, and no external party is in the path. Pins the internal leg as genuinely instant rather than fast, which is the property the whole cadence model now rests on. [ADR-019](../DECISIONS.md) |
| GS-129 | A wallet-to-rail withdrawal carries every external control | M5 | KYC verified, name match scored, destination inside its 48 hour cooling window refused, below the 10,000c minimum refused, **no fee applied**, and a second concurrent withdrawal refused by G-NO-IN-FLIGHT. Asserts that moving the speed to the internal leg removed no control from the external one. [ADR-019](../DECISIONS.md) |
| GS-130 | Wallet balances appear in Open Liability and reserve coverage | M6 | An identity holding a wallet balance contributes it to P-M6-01 and to the RCR denominator. Pins the honest reading: a wallet balance has cleared every gate, so it is the **most** certain liability on the book, and a design that improved liquidity is asserted not to have quietly improved the reported liability with it. [ADR-019](../DECISIONS.md) |
| GS-131 | Account takeover against a funded wallet, both directions | M5, M4 | **External:** the attacker's destination change enters cooling, notifies the address already on file, and settles nothing today. **Internal:** the attacker spends the wallet balance on evaluations and resets; the loss is real, never leaves Merit's books, and is fully reversed by compensating ledger entries with `reversal_of` set. Pins containment as the intended asymmetry rather than an accident, and pins wallet-spend velocity limits firing before the balance is drained. [ADR-019](../DECISIONS.md), SECURITY D4 |
| GS-132 | Indicative data never reaches a money decision | M4, M6, M2 | The live cache is populated with values that would flip eligibility, a breach, and a payout clamp. The engine's output is asserted **byte-identical** to the run without the cache, because it never reads it. Pins the hard rule in [ADR-020](../DECISIONS.md) as structural rather than procedural |
| GS-133 | Streaming feed loss degrades to the last closed session | M4, M2 | On feed loss every live surface falls back to last-closed values **and the label changes with them**, in the same render. A live number that silently freezes at its last value is asserted to be a failure, not a fallback. Pins the labeling contract at the point of use. [ADR-020](../DECISIONS.md) |
| GS-134 | A ring is a watched cluster on day 0, before any fill exists | M7 | Candidate pairs and groups are formed from identity-graph priors at funding time, with zero trading data. Pins the direct answer to AS-M7-01: the flagship correlation detector cannot defend the first cycle, so the first cycle is defended by the graph instead |
| GS-135 | Young-account fast path, positive and near-miss | M7 | Inside a 5 trading day window, a pair at correlation below -0.95 **with** mirrored size and timing fires; a pair at -0.93, and a pair at -0.97 **without** mirroring, both do **not**. Pins the deliberate choice of precision over sensitivity on accounts too young to carry any corroborating evidence |
| GS-136 | Clique position-sum detects third-leg rotation intraday | M7 | Within a candidate clique, summed positions at or near zero fire the detector on the same day, while every pairwise correlation in the clique sits comfortably inside D-02's threshold. Pins the complement to D-03: positions rather than realized P&L, so it fires inside a day rather than after the close |
| GS-137 | Copy trading, allowed and prohibited | M7 | Same-identity clustering across a trader's own accounts is **filtered at the detector** and raises nothing at all. Identical clustering across two identities raises a flag whose evidence is the conduct and the ToS clause, never a correlation coefficient. Pins the clause from the batch 1 gate and pins the removal of D-01's largest benign-noise source |
| GS-138 | An account with an unconfirmed setpoint cannot trade | M2 | Provisioning completes, `set_risk` returns no acknowledgement and no read-back succeeds, and the account is held out of trading entirely rather than surfaced as carried liability. Pins fail-closed provisioning as design law, and pins that the failure is a visible bounded outage rather than a silent unprotected account. AS-M2-03 |
| GS-139 | A ledger imbalance scopes only when locality is proven | M5 | An imbalance attributable to exactly one identity halts that identity's payouts, **pages immediately**, and starts the escalation clock; on expiry it escalates to a global halt. An imbalance spanning identities, one with ambiguous attribution, and one traceable to no transaction all halt **globally** on the spot. Pins the classifier proving locality before granting it. [ADR-016](../DECISIONS.md), extends GS-110 |
| GS-141 | The publish diff types co-binding apart from dominated | M1, M3 | Publishing all three v1 plans emits **`PW-02a` as `info`** on Core EOD and Direct (gap and win days tie at 5, both load bearing) and **`PW-02b` as `warning`** on Merit Rapid (gap of 1 against 3 win days, can never bind), with distinct text. Asserts the two are never rendered identically, because three identical warnings per publish, two of them false positives, is how a founder learns to approve a diff without reading it. [M01](../plans/M01-rules-engine.md) section 2, EC-049 |
| GS-140 | An affiliate destination change enters the 48 hour cooling window | M8, M5 | The change is accepted, does not take effect today, notifies the contact already on file, and is refused settlement inside the window, identically to a trader destination change. Pins one rail as one control, including on the path an attacker would reach through a compromised affiliate account. [ADR-017](../DECISIONS.md), pairs with GS-104 and GS-127 |

## 16. What is not here yet

Scenarios owned by M9 through M19 are numbered above where they intersect the B4 battery and are otherwise added by each module plan as it is written. The rule for every wave that follows: **a scenario enters this file before its implementation exists, or it is not a golden file.**
