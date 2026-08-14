---
status: approved
depends_on: [../plans/M01-rules-engine.md, ../GLOSSARY.md, ../architecture/DATA_MODEL.md, ../EDGE_CASES.md, ../DECISIONS.md]
last_updated: 2026-08-13
---

# Golden Scenarios

Hand-built scenario fixtures, numbered. **Tests cite scenario numbers**, never prose. Per [GLOSSARY](../GLOSSARY.md#golden-file) and constitution C10, every scenario here derives from a plan doc or an approved constitution scenario and **never** from implementation output. That rule is the whole defence against the self-grading trap: if a fixture was written by reading the code, it proves only that the code agrees with itself.

**Seeded in Wave 3 by [M01](../plans/M01-rules-engine.md), and GS-001 to GS-083 approved with it at the M1 gate on 2026-08-13.** Each later module plan appends its own block and those scenarios carry that plan's status. Constitution section 5.2 requires at least 40 golden files. **GS-001 to GS-083 are M1's**, of which 67 are executable against the pure engine with zero I/O, plus 5 (GS-034, GS-035, GS-041, GS-047, GS-050) where M1 owns an assertion inside a scenario another module drives. The numbering map below is the current total.

**Five scenarios were added and four rewritten by the M1 gate rulings** ([ADR-013](../DECISIONS.md), [ADR-014](../DECISIONS.md), [ADR-015](../DECISIONS.md)). A golden file that pinned a behavior the founder overruled is not quietly deleted: it is rewritten to pin what was actually decided, and the row says so, because a fixture that silently changes meaning is how a suite stops being a specification.

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
| GS-052 | Payout stacking before settlement | AS-01, novel | Three requests fired inside the transfer window are refused by G-NO-IN-FLIGHT. Without the rule, one qualifying stretch funds three capped extractions |
| GS-053 | Stacking attempt across the settlement boundary | AS-01, novel | Request 2 lands the instant request 1 settles: win days have reset to the basis-day anchor, so it fails the win-day gate rather than paying |
| GS-054 | Manufactured dilution days from a hedged pair | AS-02, novel | Account A takes controlled small profits solely to inflate the consistency denominator while account B carries the loss. Engine behaves correctly; the scenario asserts the detector signal exists and that consistency alone does not stop it |
| GS-055 | Minimum-variance path to a full-cap extraction | AS-03, novel. **Rewritten by [ADR-013](../DECISIONS.md)** | Five days at 50,000c each, best-day share 2000bp, clears every gate: the floor on days-to-first-payout is 5 trading days. Steady state is then 7 to 8 trading days per cycle under the ruled **settlement** anchor, giving 16,875c to 19,286c per trading day to the trader, which reproduces the constitution's stated ceiling. The fixture also carries the basis-anchored counterfactual (5 day cycle, 27,000c per day) as an **expected-to-fail** case, so any future change that re-anchors the gap fails this file loudly instead of silently raising liability 40 percent |
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
| GS-082 | Merit Rapid: the cadence gap counts from the effective day, and the win-day gate is what actually binds | OQ-1 and OQ-12, [ADR-013](../DECISIONS.md) | On a `merit_rapid` account with `cadence_gap_trading_days = 1`, a request made one trading day after the **basis** day fails, because the gap counts from the **effective** day and because only one or two win days have accrued. The same account qualifies on the fifth trading day after the basis day, driven by the win-day gate rather than by the gap. Asserts both anchors independently and pins the published cadence figure that M09 renders |
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

## 10. What is not here yet

Scenarios owned by M4 through M19 are numbered above where they intersect the B4 battery and are otherwise added by each module plan as it is written. The rule for every wave that follows: **a scenario enters this file before its implementation exists, or it is not a golden file.**
