---
status: approved
depends_on: [../plans/M01-rules-engine.md, ../GLOSSARY.md, ../architecture/DATA_MODEL.md, ../EDGE_CASES.md, ../DECISIONS.md]
last_updated: 2026-08-15
---

# Golden Scenarios

Hand-built scenario fixtures, numbered. **Tests cite scenario numbers**, never prose. Per [GLOSSARY](../GLOSSARY.md#golden-file) and constitution C10, every scenario here derives from a plan doc or an approved constitution scenario and **never** from implementation output. That rule is the whole defence against the self-grading trap: if a fixture was written by reading the code, it proves only that the code agrees with itself.

**Seeded in Wave 3 by [M01](../plans/M01-rules-engine.md), and GS-001 to GS-083 approved with it at the M1 gate on 2026-08-13.** Each later module plan appends its own block and those scenarios carry that plan's status. Constitution section 5.2 requires at least 40 golden files and the registry defines **257**. **GS-001 to GS-083 are M1's**, of which 67 are executable against the pure engine with zero I/O, plus 5 (GS-034, GS-035, GS-041, GS-047, GS-050) where M1 owns an assertion inside a scenario another module drives. The numbering map below is the current total and section 33 is the reconciliation behind it.

**Five scenarios were added and four rewritten by the M1 gate rulings** ([ADR-013](../DECISIONS.md), [ADR-014](../DECISIONS.md), [ADR-015](../DECISIONS.md)). **Fourteen more were added and four rewritten by the Wave 3 batch 1 gate rulings** ([ADR-016](../DECISIONS.md) through [ADR-020](../DECISIONS.md)). A golden file that pinned a behavior the founder overruled is not quietly deleted: it is rewritten to pin what was actually decided, and the row says so, because a fixture that silently changes meaning is how a suite stops being a specification.

**Consolidated in Wave 4, and the registry now stands at 257** (section 33 carries the full reconciliation, the ownership partition, and the coverage map). Four things were repaired in that pass and each is worth naming, because a registry whose defects are fixed silently is a registry nobody can trust the next count from. **The section numbering was duplicated at 25, 26 and 27** and is now contiguous through 33. **Section 6's stated range said GS-071 to GS-083 while its table ended at GS-078**, which overlapped section 7. **GS-139 to GS-141 were listed out of order.** And **GS-206 through GS-209 were claimed by two different blocks at once**, the M18 graduation scenarios and the addendum's verification-UX scenarios; the verification-UX pair is renumbered to GS-256 and GS-257, and the collision note stays in section 28 rather than being erased.

**Two blocks were added in the same pass.** GS-246 to GS-255 are the **Appendix D0 attack battery**, discharging the obligation [SECURITY section 9](../architecture/SECURITY.md) recorded for Wave 4. GS-243 to GS-245 carry [ADR-025](../DECISIONS.md#adr-025-progressive-cap-release-is-rejected-for-v1-and-replaced-with-cross-account-loyalty--2026-08-14-status-accepted).

**A fifth defect was repaired at the S-D read and it is a different class from the four above, which is why it is named separately.** Section 3's plan shorthand **restated thirteen parameter values from [M01 Appendix A.1](../plans/M01-rules-engine.md#a1-core-eod-core_eod) in the same sentence that named Appendix A as the only place they are defined**, and one of the thirteen had drifted: the ladder read 8 against Appendix A.1's 5 ([ADR-024](../DECISIONS.md)). The four earlier repairs were numbering; this one is a **value a running system reads from config**, which is the first time this registry has been found disagreeing with the specification rather than with itself. **The thirteen copies are deleted and the section points at the appendix** ([ADR-037](../DECISIONS.md#adr-037-a-shorthand-may-not-restate-a-value-the-config-owns--2026-08-15-status-accepted)); GS-066 and GS-067 carried the same stale 8 in their pins and now name `max_payouts` rather than a number.

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
| GS-142 to GS-148 | Marketing site: cache-versus-config, content drift, statistic framing, solicitation, operator seams, permanent version URLs | M9 |
| GS-149 to GS-154 | Integrations: support-console scoping, internal-versus-published metrics, late suppression guards, error-payload egress, alert leakage, vendor coupling | M10 |
| GS-155 to GS-161 | Certificates and social proof: cherry-picking, revocation reach, key rotation, verify-page enumeration, revocation classes, leaderboard exposure, aggregate creep | M11 |
| GS-162 to GS-171 | Transparency platform: denominator choice, on-chain disclosure, review gating, adversary intelligence, the constant claim, restatement, sample floors, comparative claims | M12 |
| GS-172 to GS-178 | Trader analytics and journal: engine parity, history changes, journal isolation, provenance blending, undefined metrics, population leakage, load contention | M13 |
| GS-179 to GS-185 | Loyalty and retention: cap-release liability, streak incentives, the bright line's composition, inverted win-back targeting, tier discretion, config bypass, calendar-broken streaks | M14 |
| GS-186 to GS-191 | Discord integration: role disclosure, chat-account-as-credential, bot-token voice, moderation versus enforcement, enforcement by role removal, support in public | M15 |
| GS-192 to GS-197 | Notification center: freeze notice versus tip-off, muting the alarm first, batch broadcasts, template leakage, proof of notice, new-kind defaults | M16 |
| GS-198 to GS-204 | Offers engine: rules sold as promotions, free-trial identity loss, price experiments, stacking floors, leaked codes, chargeback-funded credit, rule experiments | M17 |
| GS-205 to GS-211 | Live-graduation pipeline: unbacked live-program promises, ladder finiteness, graduating-cohort risk, vault projections, stranded balances, discretion at the last step, third-party exposure | M18 |
| GS-212 to GS-221 | KYC and identity: corpus coverage, provider dependency, geo triangle fairness, sanctions carve-out, dedupe false matches, real re-verification, evidence durability, funnel telemetry | M19 |
| GS-222 to GS-231 | Merit Wallet: credit farming, spend-back laundering, refund arbitrage, deposit accretion, chargeback races, transfer through checkout, dormancy, float segregation | M20 |
| GS-232 to GS-239 | Scenarios created by the consolidated founder addendum: the composite KYC trigger set, the three identity-defense tiers, checkout enrichment | mixed, listed per row |
| GS-240 to GS-242 | Scenarios created by [ADR-024](../DECISIONS.md): the ladder and invitation separation, the shortened lifetime bound, percent-of-size scaling | M1, M18 |
| GS-243 to GS-245 | Scenarios created by [ADR-025](../DECISIONS.md#adr-025-progressive-cap-release-is-rejected-for-v1-and-replaced-with-cross-account-loyalty--2026-08-14-status-accepted): bound invariance across loyalty state, perk exclusion under review, loyalty credit provenance | M14 |
| GS-246 to GS-255 | The Appendix D0 attack battery, `GS-(245 + n)` maps to D0 item `n` | mixed, listed per row |
| GS-256 to GS-257 | Verification UX: mid-flow resumption, milestone-not-accusation copy | M19 |

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

**`CORE-50K` is the 50K column of [M01 Appendix A.1](../plans/M01-rules-engine.md#a1-core-eod-core_eod), and this section restates none of it.** Appendix A is approved, it is the only place those numbers are defined, and a reader who needs a value reads it there. The executable form is [`packages/rules-engine/fixtures/plans/CORE-50K.json`](../../packages/rules-engine/fixtures/plans/CORE-50K.json), transcribed from that column and from nowhere else.

**This paragraph used to restate thirteen of those values, and one of them had drifted** ([ADR-037](../DECISIONS.md#adr-037-a-shorthand-may-not-restate-a-value-the-config-owns--2026-08-15-status-accepted)): it said the ladder was 8 where Appendix A.1 says **5** per [ADR-024](../DECISIONS.md), in the same sentence that called Appendix A the only authority. **The thirteen copies are the defect and the wrong one is the symptom**, so the copies are deleted rather than corrected. [CI-06g](STRATEGY.md)'s rule now reaches parameters as well as counts: **a shorthand may not restate a value the config owns.**

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
| GS-066 | Failed transfer does not consume a ladder rung | AS-11, novel | Ordinal 3 fails, the retry is ordinal 3 again, `payouts_settled_count` never moved, and graduation still requires the plan's full `max_payouts` settlements |
| GS-067 | Graduation fires exactly on the ladder count | Constitution M1 | The `max_payouts`th settlement graduates; the one before it does not. `>=` asserted at both boundaries. **The count is the plan's, read from config**, and stating it here would be a fourteenth copy of the value [ADR-037](../DECISIONS.md#adr-037-a-shorthand-may-not-restate-a-value-the-config-owns--2026-08-15-status-accepted) deleted the other thirteen of |
| GS-068 | Consistency period boundary at the settlement day | AS-12, novel | The basis day itself is excluded from the new period and the day after is included. Asserts a one-day off-by-one cannot silently move eligibility |
| GS-069 | Adding profit on the best day breaks a passing consistency gate | AS-13, novel | The monotonicity counterexample. Eligibility is **not** monotone in profit, contrary to constitution section 5.1's phrasing, and the fixture is the proof |
| GS-070 | Funded start balance does not equal size | AS-14, novel | A platform that fails to reset the funded account produces a first funded mark whose opening balance is not `size_cents`. The engine refuses the day and raises reconciliation rather than computing on it |

## 6. GS-071 to GS-078: replay, upgrade, and config validation (M1)

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
| GS-140 | An affiliate destination change enters the 48 hour cooling window | M8, M5 | The change is accepted, does not take effect today, notifies the contact already on file, and is refused settlement inside the window, identically to a trader destination change. Pins one rail as one control, including on the path an attacker would reach through a compromised affiliate account. [ADR-017](../DECISIONS.md), pairs with GS-104 and GS-127 |
| GS-141 | The publish diff types co-binding apart from dominated | M1, M3 | Publishing all three v1 plans emits **`PW-02a` as `info`** on Core EOD and Direct (gap and win days tie at 5, both load bearing) and **`PW-02b` as `warning`** on Merit Rapid (gap of 1 against 3 win days, can never bind), with distinct text. Asserts the two are never rendered identically, because three identical warnings per publish, two of them false positives, is how a founder learns to approve a diff without reading it. [M01](../plans/M01-rules-engine.md) section 2, EC-049 |

## 16. GS-142 to GS-148: marketing site (M9)

Defined by [M09](../plans/M09-marketing-site.md) section 8.2. Every scenario here tests the boundary between a published sentence and an executed configuration, which is the only failure class this module owns.

| ID | Name | Pins |
|---|---|---|
| GS-142 | A plan version publishes and revalidation fails | The new version does **not** become purchasable, the previous version keeps selling, and the failure pages. Asserts that the cure for a stale price page is publish ordering rather than a shorter cache lifetime, and that the failure direction costs Merit a delay rather than costing a trader a surprise. AS-M9-01, extends GS-041 (B4 #12) |
| GS-143 | MDX content containing a bare parameter value | The build **fails**. The same sentence written with `<PlanValue>` builds and renders the live configured value. Asserts that the marketing-versus-implementation gap is closed by a compiler rather than by a copy reviewer, because prose decays and configuration moves. AS-M9-02, EC-083 |
| GS-144 | A published statistic rendered without its trailing window | The build **fails**, including on the OG image path, which is where screenshots actually originate. Asserts that a transparency number and the window it was computed over are one indivisible unit. AS-M9-03 |
| GS-145 | A restricted-country visitor, with and without a VPN | The notice renders and the call to action is suppressed on the direct visit; checkout refuses server side in **both** cases. Asserts the site notice is disclosure and the control is elsewhere, and that the VPN case is an expected outcome rather than a bypass. AS-M9-04, EC-084 |
| GS-146 | A `copy_block` whose wording contradicts its rule's operator | Publish validation **fails**: "more than" against a `>=` comparison never reaches a page. Asserts that the plain-English explainer is versioned with the rule it explains, so the forensic reader finds no seam between the sentence and the operator. AS-M9-05 |
| GS-147 | Payout copy with one leg omitted | The lint fails on a headline, a social card, an email subject, and an OG image alike. Asserts that same-day wallet credit and the 2 to 3 business day external withdrawal are always stated together at equal weight, because a true sentence that manufactures the perception of a late cycle is the failure constitution 0 names as fatal. AS-M9-06 |
| GS-148 | A superseded plan version's public URL | Resolves forever, is labeled superseded, names its successor, and is excluded from indexing and from every navigational path. Asserts that a rules page cited inside an evidence pack cannot 404 and cannot silently become a different document at the same address. AS-M9-07, EC-085 |

## 17. GS-149 to GS-154: integrations (M10)

Defined by [M10](../plans/M10-integrations.md) section 8.2. Every scenario here is about what leaves the building, or about what happens when a thing outside the building stops answering.

| ID | Name | Pins |
|---|---|---|
| GS-149 | A support agent attempts to address an unassigned identity | The request carries **no identity parameter to tamper with**; the contact reference resolves server side; the read is audited with the exact field list returned. Asserts that the support tool is minimized in the data rather than in the agent's training, because agents are hired to be helpful under time pressure. AS-M10-01, EC-086 |
| GS-150 | An internal analytical question diverges from the published metric | The nightly reconciliation alerts, the **published value does not change**, and the internal question is the one investigated. Asserts that the analytical tool is a checker of the published number rather than a competing source of it. AS-M10-02 |
| GS-151 | Breach at 00:20, detector flag at 00:40, restriction at 09:15 | The commiseration and its reset offer are **suppressed at send**, not delivered at 00:21. Asserts guards evaluate against live state, and that the offer-bearing messages hold deliberately so a late signal has time to arrive. AS-M10-03, EC-087 |
| GS-152 | An unhandled exception on the payout path | The captured payload contains route, release, error class, request id, and account id, and nothing else; the seeded canary never appears vendor-side. Asserts deny-by-default egress on money paths, because a denylist tuned for auth secrets is blind to financial data. AS-M10-04, EC-088 |
| GS-153 | An operational alert dispatched to a mis-set Discord channel | The startup and per-send channel assertion **fails closed and pages**; nothing is posted; and the message body carried a severity and a link rather than a figure in any case. Asserts that an operations alert conveys what an operator must act on and nothing a reader could quote. AS-M10-05 |
| GS-154 | Every vendor returns 500, then times out | Purchase, provisioning, payout request, and payout settlement all complete; messages queue and dead-letter with replay available. Asserts INV-M10-01 as an executable assertion rather than an agreed principle. AS-M10-06, EC-089 |

## 18. GS-155 to GS-161: certificates and social proof (M11)

Defined by [M11](../plans/M11-certificates-social-proof.md) section 8.2. [M04](../plans/M04-trader-portal.md)'s GS-102 covers the basic valid, unknown, and revoked lookups and stays where it is; these extend it into the system behind the card.

| ID | Name | Pins |
|---|---|---|
| GS-155 | A per-trade certificate is requested | v1 exposes **no such kind**. If the deferred kind is later enabled, the card renders the account's period aggregate alongside the trade or it does not render at all. Asserts the bright line that Merit signs facts about accounts and periods, never facts about selected events. AS-M11-01, EC-090 |
| GS-156 | A shared payout card is revoked after enforcement | The live re-render shows revoked, the verify code printed inside the image resolves to the class sentence, and the `account_enforced` sentence does **not** claim the payout did not happen. Asserts that a screenshot cannot be recalled and that the design optimizes for the recoverable case instead of pretending otherwise. AS-M11-02, extends GS-102 |
| GS-157 | Key rotation with historical certificates outstanding | A card signed under the **retired** key still verifies, and a card signed under a **revoked** key still verifies through the row. Asserts that rotation costs nothing historically, which is what stops the 90 day calendar from quietly skipping this key forever. AS-M11-03 |
| GS-158 | Enumeration attempt against the verification endpoint | Known and unknown codes respond in indistinguishable time, rate limits engage per IP and per ASN, and `certificate.verify_anomaly` fires on the distinct-code and unknown-rate signature. Asserts the public oracle is unwalkable rather than merely throttled. AS-M11-04, EC-091 |
| GS-159 | Enforcement on an account holding a pass card and a payout card | Both revoke as `account_enforced` with the standing-claim sentence; neither revokes as `fact_untrue`. Asserts that revoking proof of a thing that remains true is a retroactive denial, which is the shape zero denial exists to make impossible. AS-M11-05 |
| GS-160 | A leaderboard participant opts out | The identity disappears from the current publish **and** from historical entries, and no plan size was exposed at any point. Asserts that a leaderboard nobody can leave is a publication rather than a feature. AS-M11-06, EC-092 |
| GS-161 | A public surface attempts a cross-account aggregate | The response contains no count, sum, or average across accounts; the trader's own list may total the trader's own cards. Asserts the routing rule that sends every public aggregate to M12, which has a method page, a window, and a sample-size floor. AS-M11-07, EC-093 |

## 19. GS-162 to GS-171: transparency platform (M12)

Defined by [M12](../plans/M12-transparency-platform.md) section 8.2. These are the fixtures that decide whether Merit's published numbers are computed or selected, which is the only difference between this module and a marketing page.

| ID | Name | Pins |
|---|---|---|
| GS-162 | Pass rate computed under all five denominator choices | One dataset yields **five materially different values**, each matching its own definition version's hand-computed fixture. Asserts that the number is a choice of denominator and that the choice is therefore the artifact that must be versioned. AS-M12-01, EC-094 |
| GS-163 | A published settlement address accumulates past its ceiling | The alarm fires, and no reserve or operating address is reachable from any published artifact. Asserts that proving payouts must not publish the liquidity a correlated wave would be timed against. AS-M12-02, EC-095 |
| GS-164 | Review invitations across a mixed-outcome population | The invited set's trigger-class distribution matches population shares; a payout-only trigger set **fails the test**. Asserts that the compliant design is the one that invites people who had a bad outcome. AS-M12-03, EC-096 |
| GS-165 | Loss ratio and reserve coverage requested from the public API | Both absent, and the registry index returns the **published exclusion reason** for each. Asserts that an unexplained gap reads as concealment while an explained one reads as judgment. AS-M12-04 |
| GS-166 | Approval rate published for a window containing freezes | Publishes 100 percent **and** the freeze decomposition: count, median duration, and release outcome. Asserts that the way to make an unbelievable constant believable is to publish the denominator a skeptic is already looking for. AS-M12-05, EC-097 |
| GS-167 | A backdated correction lands on an already-published window | A **new row** with `restatement_of`; the original stays visible; recomputation uses the definition version in force at original publication rather than the current one. Asserts that a data correction and a methodology change never mix inside one restatement. AS-M12-06, EC-098, extends GS-034 (B4 #5) |
| GS-168 | Sample below the published minimum | Renders "not yet meaningful" **with the sample size and the floor**, and no admin path exists that could publish or withhold otherwise. Asserts that withholding on a threshold and withholding on a result are indistinguishable unless the threshold was published first. AS-M12-07 |
| GS-169 | A comparative claim in marketing copy | The review gate rejects a value-to-value comparison against a figure with no published method; a comparison about the **practice** passes. Asserts that comparing a rigorous number to an unmethodical one concedes the whole argument to win a sentence. AS-M12-08 |
| GS-170 | The statistics run executes on a day whose replay self-audit diverged | The run **halts**, publishes nothing, and pages. Asserts that Merit never publishes a number computed over state the engine itself does not currently vouch for. INV-M12-01, INV-M12-12 |
| GS-171 | A definition change is written with a backdated `effective_from` | Rejected at write time. Asserts the module's central control: a definition cannot take effect before it was written, so no definition can be chosen with knowledge of its result. INV-M12-07, EC-094 |

## 20. GS-172 to GS-178: trader analytics and journal (M13)

Defined by [M13](../plans/M13-trader-analytics-journal.md) section 8.2. Every adversary in this set is internal: a second implementation, a helpful feature, and a load pattern.

| ID | Name | Pins |
|---|---|---|
| GS-172 | Consistency share rendered on analytics against the engine's value | Equal **to the cent**, and the analytics database role cannot read plan config at all. Asserts that a second rulebook is prevented by permission rather than by care, since a review catches the obvious version and a unit test written by the same engineer tests the same misunderstanding. AS-M13-01, EC-099 |
| GS-173 | A backdated correction lands on a day already snapshotted | The inputs digest changes, `analytics.history_changed` notifies with cause and date range, and the trader is told before they notice. Asserts that told-first-by-Merit and noticed-later-by-them are different products. AS-M13-02, EC-100, extends GS-034 |
| GS-174 | Journal content requested from the risk, admin, evidence, and support paths | All four fail **by database grant**; trader view and trader export succeed. Asserts the privacy promise is an absence of a code path rather than a policy, which is the only form of it worth publishing. AS-M13-03, EC-101 |
| GS-175 | An equity series with a live final point appended | Build failure: a series carrying mixed provenance does not render. Asserts that a label at the foot of a chart does not stop a trader reading a line as a line, on the very number they use to decide whether to keep trading. AS-M13-04, [ADR-020](../DECISIONS.md) |
| GS-176 | An R-multiple requested with no declared risk | **Absent with a stated reason**, never inferred; with a trader-declared risk it computes and says the risk was trader-supplied. Asserts that a definitionally circular metric is worse than a missing one because it looks rigorous. AS-M13-05, EC-102 |
| GS-177 | A percentile or population comparison requested | No such endpoint exists; self-comparison across the trader's own accounts succeeds. Asserts that a percentile endpoint is an enumerable oracle over the population distribution, which is the raw material for the figures M12 deliberately does not publish. AS-M13-06 |
| GS-178 | Analytics load concurrent with a payout wave | Payout request p95 holds under its target and **analytics degrades first**. Asserts the only interaction that matters, which testing the two suites separately would never have exercised. AS-M13-07, EC-103, pairs with GS-051 |

## 21. GS-179 to GS-185: loyalty and retention (M14)

Defined by [M14](../plans/M14-loyalty-retention.md) section 8.2. [ADR-019a](../DECISIONS.md)'s bright line is binding on this module by name, and three of these fixtures exist to keep it that way.

| ID | Name | Pins |
|---|---|---|
| GS-179 | A progressive cap release is proposed. **Rewritten by [ADR-025](../DECISIONS.md#adr-025-progressive-cap-release-is-rejected-for-v1-and-replaced-with-cross-account-loyalty--2026-08-14-status-accepted)** | No v1 plan version carries a second `payout_cap_schedule` step, and a config that does is **refused at publish with the rejection cited**. The fixture carries the full option arithmetic as the **superseded counterfactual**: the market's own shape (release after ordinal 5) is structurally impossible on a 5-rung ladder, release at ordinal 5 costs **+20 percent** of the lifetime bound, release from ordinal 4 costs **+40 percent**. Same discipline as GS-055: the price of overruling a ruling stays in the suite rather than only in an ADR. AS-M14-01, EC-104, EC-140 |
| GS-180 | A hedged pair accumulates a perfect streak | The streak earns **recognition and no economic benefit**, and the cohort surfaces as an M7 input. Asserts that a streak reward pays out faster than D-02's detection window closes, so its most reliable earners would be the undetected. AS-M14-02, EC-105 |
| GS-181 | An earned free spin awarding a randomized reset discount | Rejected by the compositional test: no mechanic may let a randomized outcome determine what a later purchase yields. Asserts that ADR-019a's two clauses are violated by their composition even when each is satisfied alone. AS-M14-03, EC-106 |
| GS-182 | Win-back scoring across a population containing serial resetters | Above the velocity ceiling the identity is **excluded rather than prioritized**, and flagged or restricted identities are excluded at both computation and send. Asserts the deliberate inversion of what every off-the-shelf retention tool does by default. AS-M14-04, EC-107 |
| GS-183 | A high-milestone identity reaches the flags queue and the payout path | Loyalty state is unreadable from both, and from support's default view. Asserts that a status visible to a reviewer degrades detection in a way no metric records, because nobody logs the flag they did not raise. AS-M14-05 |
| GS-184 | The loyalty service attempts to write a payout cap | Fails on the database grant, and there is **no per-account override column to write to**. Asserts that ADR-010's control cannot be routed around by a service whose job is to be generous. AS-M14-06, EC-108 |
| GS-185 | A streak spans a half day, a holiday, and a limit-locked session | The streak **pauses and survives**; only trader conduct breaks it, and the break event names its enumerated cause. Asserts consistency with the published halted-session answer rather than a second calendar understanding. AS-M14-07, EC-109, pairs with GS-030 to GS-032 |

## 22. GS-186 to GS-191: Discord integration (M15)

Defined by [M15](../plans/M15-discord-integration.md) section 8.2. Every fixture here tests a disclosure, because that is the only thing this module actually does.

| ID | Name | Pins |
|---|---|---|
| GS-186 | Role sync for a trader opted into one role and not another | **Only the consented role** is granted, and no role in the catalogue encodes an amount, size, count, or rank. Asserts that consent to be in a room is not consent to be labeled in it, and that granularity is what turns a badge into a target list ordered by value. AS-M15-01, EC-110 |
| GS-187 | A Discord identity presented to auth, recovery, and support verification | All three refuse and the link table is unreachable from each by grant; a bot state query returns a portal link and no account data. Asserts that a community feature must not import the password-stuffing threat model SECURITY C-01 designed Merit out of. AS-M15-02, EC-111 |
| GS-188 | The bot token used to post an unknown template and a free-text message | **Both refused**; a replayed legitimate template posts and is recorded with its causing event. Asserts that the control bounds what a valid credential can say, since a fake retroactive rule change does its damage at the screenshot rather than at the correction. AS-M15-03, EC-112 |
| GS-189 | Prohibited-arrangement solicitation observed in the community | Moderated as a server matter, producing **no flag, no evidence entry, and no account action**. Asserts the published separation between moderating a room and enforcing against an account. AS-M15-04, EC-113 |
| GS-190 | An enforcement closes an account holding a synced role | Removal is deferred into a batch window containing mixed churn, and the trader was notified first. Asserts that a role vanishing at a timestamp publishes a private enforcement to a public room, bypassing the whole two-tier evidence machinery in one API call. AS-M15-05 |
| GS-191 | An account-specific question asked in a public channel | An automatic routing reply, **no account state disclosed**, and no human answer in channel. Asserts that a public answer is an unlogged support interaction with an audience. AS-M15-06 |

## 23. GS-192 to GS-197: notification center (M16)

Defined by [M16](../plans/M16-notification-center.md) section 8.2. The module's entire failure surface is the class boundary, so four of these six are negative fixtures.

| ID | Name | Pins |
|---|---|---|
| GS-192 | A freeze notice for an account inside an active investigation | The notice **sends on time**, carrying the ToS clause and the expiry date, and contains no detector, threshold, pattern description, or other identity. Asserts the tension is resolved by changing what the notice contains rather than whether it is sent, because the alternative is the "under review" anti-pattern Merit defined itself against. AS-M16-01, EC-114 |
| GS-193 | Contact change, then preference mute, then destination change | The **prior contact** receives every security notice, the preference change confirmed to the old contact before taking effect, and the sequence raises a high-severity risk signal. Asserts that a cooling window protects nobody if the person it exists to warn cannot be reached. AS-M16-02, EC-115, pairs with GS-104 |
| GS-194 | The nightly batch is replayed after a mid-run crash | One coalesced message per **identity**, and zero duplicates on replay; security and money classes stay exempt from coalescing. Asserts that recovery from a batch failure must not itself be a broadcast to the entire trader base. AS-M16-03, pairs with GS-047 |
| GS-195 | A template referencing a detector name and a population comparison | **Lint failure**; a template referencing published rule values and the trader's own facts passes. Asserts that the boundary is rules versus detection rather than secrecy versus openness, and that it derives from M7's strip registry so the two lists cannot drift. AS-M16-04 |
| GS-196 | A notice disputed with `read_at` null, and again with `read_at` set | Both answered from **dispatch plus delivery**, and `read_at` is never cited. Asserts that the convenient field is the one that cannot bear the weight a dispute puts on it. AS-M16-05, EC-116 |
| GS-197 | A migration adds a new notification kind | Marketing defaults **off**, the class is stated in the migration, and an unclassified kind fails the registry test. Asserts that class assignment is a policy decision that otherwise looks like a data row and gets no review. AS-M16-06 |

## 24. GS-198 to GS-204: offers engine (M17)

Defined by [M17](../plans/M17-offers-engine.md) section 8.2. The module's governing sentence is that an offer changes the price of a known thing and may never change the thing, and five of these fixtures test that boundary from a different side.

| ID | Name | Pins |
|---|---|---|
| GS-198 | A campaign attempts a temporary cap or a waived consistency gate | Refused: no write grant exists, and **no offer field can express a plan parameter**. The compliant path is a published plan version, pinned and visible before purchase. Asserts the parameter-status ruling on the surface most tempted to break it. AS-M17-01, EC-117 |
| GS-199 | A free-trial cohort sharing device and ASN signals | Absent a payment fingerprint, entity resolution degrades **measurably**; the trial path requires KYC before provisioning and counts against the entity cap. Asserts that free trials drive marginal identity cost to zero, which is the one condition under which the account cap stops constraining anything. AS-M17-02, EC-118 |
| GS-200 | A price experiment runs while the public pricing page renders | The public page shows the **offer-free config price** to every visitor, and the offer is presented against the stored list price. Asserts that experiments live in offers bound to identities, never on the surface M09 guarantees is config-rendered. AS-M17-03 |
| GS-201 | Coupon plus bundle plus promotional credit on a Direct plan | The floor **clamps**, `offer.floor_applied` alerts, and no combination reaches or crosses it. Asserts that the characteristic failure is a combination nobody enumerated, and that the Direct floor is a liability number rather than a margin one. AS-M17-04, EC-119, extends GS-040 |
| GS-202 | A campaign code posted to a public aggregator | `max_redemptions` caps it, the refusal and distinct-identity rates raise the leak signature within the hour, revocation is immediate, and **completed purchases are not repriced**. Asserts that retroactive repricing would be the FundingTicks failure applied to commerce. AS-M17-05 |
| GS-203 | Credit granted, spent, then the funding purchase charged back | The grant revokes, the promotional balance goes **negative**, further credit spend blocks, and settlement follows the existing chargeback path. Asserts that a credit must know what paid for it or a stolen card buys two extractions. AS-M17-06, EC-120, pairs with GS-039 |
| GS-204 | An experiment proposed with a rule-varying arm | **Unrepresentable**: `varies` has no such value, so the experiment cannot be written down. Asserts the line that Merit experiments on what it charges and how it explains itself, never on what it enforces. AS-M17-07 |

## 25. GS-205 to GS-211: graduation track (M18)

Defined by [M18](../plans/M18-graduation-track.md) section 8.2. **The module was renamed from "live-graduation pipeline" to "graduation track" at the batch 2 gate**, and this heading follows it, because a section named for a pipeline to a program that does not exist is the marketing-versus-implementation gap committed in a table of contents. Almost every failure in this module is a promise rather than a computation, so most of these are disclosure fixtures.

| ID | Name | Pins |
|---|---|---|
| GS-205 | Any surface using live-program language with no contracted program | Copy lint failure across page, email, certificate, and social card alike. Asserts that the copy is what commits Merit, not the code, and that a disclosure repeated on every surface cannot be made conditionally false by a marketing sentence. AS-M18-01, EC-121 |
| GS-206 | An account reaches the final ladder ordinal | Finiteness was disclosed at purchase, in the plan comparison, and counted **down** in the tracker from ordinal zero, with the lifetime figure published in money. Asserts that a defense the customer does not know about feels like a trap when it fires. AS-M18-02, EC-122 |
| GS-207 | A graduating account carrying an unresolved correlation signal | The final payout and the terminal settlement **complete**; only the discretionary benefit is held, with a cited flag, a reason class, and an expiry. Asserts that the review touches the reward and never the money. AS-M18-03, EC-123 |
| GS-208 | A vault display with a benefit not yet accrued | Renders **accrued value only** with its stated basis; progress appears as a count rather than as a currency figure. Asserts that a number in a box with a currency symbol is a balance to the person reading it, whatever the caption says. AS-M18-04 |
| GS-209 | Graduation with withdrawable balance remaining | A terminal settlement pays it to the wallet automatically, is **not an ordinal**, is not capped by the payout cap, and is labeled distinctly on the timeline. Asserts that zero denial must not fail at an accounting boundary. AS-M18-05, EC-124 |
| GS-210 | Graduation with no human in the path | Reaching the final settlement graduates the account, and **no approval step exists for anyone to use**. Asserts that discretion reintroduced at the last step is discretion everyone who was not invited will infer a reason for. AS-M18-06 |
| GS-211 | A third-party introduction is presented to a graduate | The party is **named**, compensation is disclosed at the point of introduction, no representation is made about their terms, and declining costs the trader nothing. Asserts that an introduction a trader must accept to receive full value is not an introduction. AS-M18-07 |

## 26. GS-212 to GS-221: KYC and identity verification (M19)

Defined by [M19](../plans/M19-kyc-identity.md) section 8.2. Identity is the chokepoint the zero-denial policy depends on, so these fixtures test both directions: that the gate holds, and that it does not fall on the wrong people.

| ID | Name | Pins |
|---|---|---|
| GS-212 | Thirty purchases under `pre_funded`, four of which pass | **Twenty-six identities never enter the dedupe corpus**, and corpus-coverage telemetry records it. Asserts the variable the constitution's placement tradeoff omitted: placement decides the size of the control the same section calls the fleet-killer. AS-M19-01, EC-125 |
| GS-213 | Provider outage during a payout wave | Verified identities pay normally, **no payout path calls the provider**, and new verifications queue with an honest trader-facing status. Asserts that verification is a state Merit holds rather than a question Merit asks. AS-M19-02, EC-126 |
| GS-214 | Geo triangle mismatch on an expatriate profile | Signal recorded and scored, with **no refusal, no trader-facing message, and no extra step**. Asserts that a hard rule here would fail on the same population M05's name matching already fails on, twice over. AS-M19-03, EC-127 |
| GS-215 | Sanctions possible match on a common name | No auto-refusal; a review queue; confirmation requires **dual control**; and the event payload carries no name. Asserts the one mandatory refusal in the corpus is scoped to the relationship and is never precedent for a general refusal power. AS-M19-04, EC-128 |
| GS-216 | A dedupe match between two unrelated legitimate traders | **No state change on either**, a recorded disposition with `inconclusive` available, and neither trader told about the other. Asserts that the strongest fraud control is also a false-accusation engine and must rest on corroborating conduct. AS-M19-05, EC-129 |
| GS-217 | A destination change against a stored verified status | The cached status **does not satisfy the trigger**; a new verification with its own liveness result is required; the 48 hour cooling runs regardless; both contacts are notified. Asserts defence in depth on the assumption that liveness will eventually be beaten. AS-M19-06, EC-130, pairs with GS-104 and GS-193 |
| GS-218 | An enforcement pack built on a dedupe hit after a provider change | `evidence_snapshot` supplies score, method, and version, and the pack's spine is corroborating conduct. Asserts that minimization is right and creates an evidence dependency that must be handled rather than discovered. AS-M19-07, EC-131 |
| GS-219 | A funnel query for drop-off by placement | Abandonment events exist for identities with **no verification row**, and the Direct-versus-others comparison is available without assigning anyone at random to a weaker fraud posture. Asserts that the measurement must describe the right population. AS-M19-08 |
| GS-220 | A plan with no evaluation phase published with a placement other than `direct_purchase` | Publish validation **fails**. Asserts that instant funding leaves no later gate to move to, so this placement is not configurable. INV-M19-02 |
| GS-221 | The placement config changes after an account was purchased | The account keeps its **pinned** placement and no retroactive gate appears. Asserts that a config change must not require verification from people who bought without it, which would be a rule change applied backwards. INV-M19-01, pairs with GS-041 |

## 27. GS-222 to GS-231: Merit Wallet (M20)

Defined by [M20](../plans/M20-wallet.md) section 8.2. The wallet has two exits and every fixture here is somebody using the exit that was not built for them.

| ID | Name | Pins |
|---|---|---|
| GS-222 | Promotional credit buys an evaluation that passes and pays out | The payout credits the wallet normally, the **first withdrawal containing that value is held for review** rather than confiscated, and spending it inside Merit is unaffected. Asserts that separating ledger classes closes the direct route and the product itself is the converter. AS-M20-01, EC-132 |
| GS-223 | A payouts-frozen identity attempts a wallet-funded purchase | **Refused**, and expired KYC, `recon_blocked`, and an active restriction do the same. Asserts that a freeze covering one exit is not a freeze, and that spending converts frozen value into accounts that produce fresh unfrozen credits. AS-M20-02, EC-133 |
| GS-224 | A card-funded purchase is refunded | The refund returns **to the card**, on every path including partial and admin-initiated; a wallet-funded purchase refunds to the wallet. Asserts the rails never cross, because crossing them turns card money into withdrawable cash outside the card network's protections. AS-M20-03, EC-134 |
| GS-225 | Every conceivable inbound funding attempt | No deposit, top-up, or third-party funding path exists, and the `provenance` constraint rejects any credit outside the closed list. Asserts the boundary between a payable and a regulated stored-value product, which a checkout convenience would otherwise cross by ticket. AS-M20-04, EC-135 |
| GS-226 | Direct purchase, fast payout, then the funding card charges back | The withdrawal was **held** until the chargeback window closed, and the value was spendable inside Merit throughout. Asserts that ADR-019 compressed the attacker's cycle by exactly as much as the trader's. AS-M20-05, EC-136, extends GS-039 |
| GS-227 | Wallet spend targeting an account owned by another identity | **Refused and flagged at high severity**, with ownership resolved server side inside the debit transaction. Asserts that checkout is a transfer endpoint nobody labelled, and that SECURITY §4.7's containment claim is only true because of this check. AS-M20-06, EC-137 |
| GS-228 | A balance reaches the jurisdictional dormancy period | Escalating contact through security-class channels including prior contacts, **never forfeited**, remitted per jurisdiction. Asserts that expiry is the most brand-destroying term available and indefinite holding is non-compliant. AS-M20-07, EC-138 |
| GS-229 | Reserve coverage computed while the wallet float is large | Float is **excluded from reserve**, reported separately, and the RCR is computed from reserve alone against a live rail balance. Asserts the mechanism by which the breaker at 1.0 would quietly become fictional. AS-M20-08 |
| GS-230 | Simultaneous withdrawal and checkout spend against one balance | Exactly one succeeds where the balance covers only one, and the position never goes negative. Pins the concurrency case created by having two exits from one integer. INV-M20-01 |
| GS-231 | Per-identity reconciliation against a globally balanced ledger | The per-identity assertion **fails and pages** even though the global sum is zero. Asserts that the wallet is where a per-identity error would hide, which a global zero-sum check cannot see. INV-M20-10, [ADR-016](../DECISIONS.md) |

## 28. GS-232 to GS-239: the consolidated founder addendum

Added by [ADR-021](../DECISIONS.md), [ADR-022](../DECISIONS.md), and [ADR-023](../DECISIONS.md). Per ADR-022's condition, **each identity-defense tier carries its own scenarios**, so a defense promoted from one tier to the next arrives with the fixture proving it does what the tier above assumed.

| ID | Scenario | Pins |
|---|---|---|
| GS-232 | The composite trigger fires at the earliest reached trigger | An identity configured with `{second_distinct_account, pre_funded}` verifies at the second distinct account purchase and is **not** asked again at evaluation pass. Asserts first-wins semantics and single-verification. [ADR-021](../DECISIONS.md) |
| GS-233 | `payout_request` never fires as a sole trigger | A config listing only `payout_request` is **rejected at publish**, not silently accepted. Asserts the invalid-alone rule is a validation and not a convention |
| GS-234 | Resets inflate `second_purchase_any` | A trader who resets once and holds one account is captured by `second_purchase_any` and **not** by `second_distinct_account_purchase`. Pins that the two triggers reach different populations, which is the caveat most likely to be forgotten |
| GS-235 | **v1 tier:** a hard link auto-enforces | A biometric dedupe hit and a shared payout destination each enforce without a review step. [ADR-022](../DECISIONS.md) |
| GS-236 | **v1 tier:** a soft link never auto-enforces | A shared device and IP cluster queues a **pre-funding** review and enforces nothing. Asserts the review is upstream of funding, not upstream of payout |
| GS-237 | **v1.x tier:** the signal-weight table is config, not code | Changing a weight is a config diff that alters cluster scoring with no deployment. Pins the tunability ADR-022 depends on |
| GS-238 | **v1.x tier:** graph explorer packs are audience-scoped | A trader-facing pack generated from a cluster node contains conduct, rule text, and own trades, and **contains no weight, threshold, or detector internal**. The two-tier rule applied to the richest surface that exists |
| GS-239 | Enrichment failure never blocks checkout | The enrichment call times out; in observe mode the purchase completes, and in enforcement mode it **fails open** and completes. Asserts a fraud signal can never become an outage. [ADR-023](../DECISIONS.md) |

**A numbering collision is corrected here, 2026-08-14.** This block previously claimed GS-206 and GS-207 to GS-209 for the addendum's verification-UX ruling. **Those numbers belong to [M18](../plans/M18-graduation-track.md)** (the final ladder ordinal, the unresolved correlation signal at graduation, and the vault display), and citing them twice meant two different fixtures answered to one id, which is the failure mode a numbered registry exists to make impossible. The verification-UX scenarios are renumbered to **GS-256 and GS-257**, section 32. The identity-defense tier scenarios are **GS-235 to GS-238** in the table above and were never separately numbered.

## 29. GS-240 to GS-242: the ladder and invitation separation

[ADR-024](../DECISIONS.md).

| ID | Scenario | Pins |
|---|---|---|
| GS-240 | Ladder completion graduates without inviting | The fifth settlement sets phase `graduated`, closes the account, and sets `graduation_eligible`. **No invitation event is emitted.** Asserts R-49's split, which is the mechanical half of the decoupling |
| GS-241 | INV-17's bound at the shortened ladder | No sequence of settlements exceeds `5 * max cap`. At Core EOD 50K that is 750,000c gross and 675,000c to the trader; at Merit Rapid 500,000c and 450,000c. Replaces the 8-rung expectations in GS-067's neighbourhood |
| GS-242 | Percent-of-size scaling holds at 150K | Every bp-expressed parameter derives correctly at 15,000,000c, and `min_payout_cents` does **not** scale. Pins that adding a size is a row rather than a redesign ([ADR-024](../DECISIONS.md)) |

## 30. GS-243 to GS-245: the cap-release rejection and cross-account loyalty (M14)

[ADR-025](../DECISIONS.md#adr-025-progressive-cap-release-is-rejected-for-v1-and-replaced-with-cross-account-loyalty--2026-08-14-status-accepted). GS-179 above is rewritten by the same ruling and stays where it is.

| ID | Scenario | Pins |
|---|---|---|
| GS-243 | INV-17's bound computed for a first-time buyer and for an identity on its tenth completed ladder | **Equal to the cent**, on every plan and every size. The executable form of INV-M14-11 and of ADR-025's central claim: cross-account loyalty changes the price of the next purchase and the order of a discretionary queue, and changes no number the engine reads. AS-M14-01 |
| GS-244 | An identity completes its Nth ladder while under an open severity 4+ flag | The **milestone is earned and recorded**; **no perk is issued** while the exclusion holds, evaluated at computation and again at issuance; and the milestone is **not revoked** when the review closes, because the fact is true. Pins that a loyalty program which withholds a reward and a loyalty program which erases an achievement are different products. AS-M14-08, EC-139 |
| GS-245 | Loyalty bonus credit funds an evaluation that passes and pays out | The credit posts as `promotional_credit` and **never** as `trader_wallet`; the resulting payout credits the wallet normally; and the first withdrawal containing that value is **held for review** under [M20](../plans/M20-wallet.md)'s P-1. Pins that loyalty is a new **source** of promotional credit and deliberately not a new **class** of it, so it inherits an existing control rather than needing one. AS-M14-08, EC-139, extends GS-222 |

## 31. GS-246 to GS-255: the Appendix D0 attack battery

[SECURITY section 9](../architecture/SECURITY.md) records that the ten `D0` scenarios specified in [SECURITY_LANDSCAPE section 4](../../research/SECURITY_LANDSCAPE.md) "become numbered entries in `docs/testing/GOLDEN_SCENARIOS.md` during Wave 4". **This is that block, and it discharges the obligation.**

`GS-(245 + n)` is `D0-n`, the same mnemonic the B4 battery uses at `GS-(029 + n)`, so the mapping never needs looking up.

**Four of these extend an existing fixture rather than duplicating one, and the rows say which.** That is the honest form of deduplication here: each `D0` item is a distinct attack with its own expected behavior, and the fixture it pairs with covers a neighbouring case. Collapsing them would lose the attack; numbering them without stating the pairing would double-count the coverage in a table people read as a coverage report.

| ID | D0 | Scenario | Owner | Pins |
|---|---|---|---|---|
| GS-246 | 1 | Credential-stuffing storm: 50,000 login attempts across 5,000 emails in ten minutes | M4, SEC | **Passwordless has nothing to stuff.** The OTP endpoint rate-limits per IP **and** per identity, Turnstile engages, **no legitimate user is locked out** (an account-lockout policy would convert this into a denial-of-service on the whole trader base), and the burst alarms. Models the June 2025 industry event directly, which is the single most documented attack against trader dashboards |
| GS-247 | 2 | IDOR sweep: an authenticated trader enumerates accounts, marks, timelines, and payouts they do not own | M4, M5 | Every cross-owner request resolves to **`404` rather than `403`**, so existence is never confirmed to a stranger (the M1 gate ruling), and **zero object properties leak** in any error body. Pairs with VG-5's per-resource negative test, which proves the tests exist; this fixture proves the sweep finds nothing |
| GS-248 | 3 | Payout destination swap from a hijacked session, then a payout request | M4, M5, M19 | Extends GS-104, GS-131, and GS-217 into one end-to-end attack chain: the destination change enters its **48 hour cooling window**, the payout is refused inside it, the contact already on file is notified, the out-of-hours and geo anomaly alarms fire, and a name mismatch against the verified identity freezes rather than pays. Pins that the four controls compose, which testing them separately never shows |
| GS-249 | 4 | Forged settlement webhook, plus a valid one replayed 50 times | M5 | **Signature verification rejects the forgery** and the timestamp-and-nonce window rejects the replays. Extends GS-037, which pins that 50 replays of a *valid* event produce one settlement; this fixture adds the case where the event was never ours |
| GS-250 | 5 | Spoofed PSP `payment.success` for an order that was never paid | M3 | HMAC verification **fails closed**, no account is provisioned, and the alarm fires. Extends GS-099 (a webhook citing an unknown purchase reference) with the signature half, and pairs with GS-038, which pins that a *legitimate* duplicate and out-of-order delivery still resolves to one correct state |
| GS-251 | 6 | A trader-scoped token calls admin routes and the internal batch trigger | M6 | Refused server side; **the admin origin refuses a non-allowlisted IP even with a valid credential**, so the two controls are independent rather than layered on one check. Pins that role enforcement never depends on the client having hidden a button |
| GS-252 | 7 | A compromised operator credential edits a live plan version's cap, split, or gap | M3, M6 | **Dual control blocks a single-actor change** ([ADR-010](../DECISIONS.md)), the edit creates a **new version** so existing accounts are untouched (B4 #12, GS-041), and every cap, split, or gap edit audits and alarms. Pairs with GS-184, which pins the same protection against a *service* rather than a person, and with GS-179, which pins that no second cap step exists to reach for |
| GS-253 | 8 | Mass redemption of a single-use code across tabs and bots, with client-set price fields probed in the same run | M3, M17 | The unique index decides one winner (extends GS-040), **pricing is resolved server side from the plan version and the offer** so a client-supplied amount changes nothing (extends GS-200), `max_redemptions` caps the spread (extends GS-202), and the velocity throttle plus Turnstile engage. One fixture because the attacker runs it as one script |
| GS-254 | 9 | An admin or affiliate field accepting a URL is set to an internal metadata address | M8, M10 | The **egress allowlist refuses internal hosts** and no user-supplied host is fetched server side, ever. Pins the general rule rather than the instance: a URL a user can set is a request Merit's network makes on their behalf |
| GS-255 | 10 | `/docs`, `/openapi.json`, `/swagger`, and undocumented internal routes requested from the public origin | INFRA | `401` or `404` against the **production build**, asserted in CI rather than in a checklist, and internal routes are unreachable off the admin origin rather than merely unlinked. This is the one D0 item already wired as a build gate (CI-07) as well as a fixture |

## 32. GS-256 to GS-257: verification UX (M19)

Owned by the consolidated addendum's verification-UX ruling and **renumbered here from the M18 range they collided with**, per the note in section 28.

| ID | Scenario | Pins |
|---|---|---|
| GS-256 | A verification is abandoned mid-flow and resumed later | The trader **resumes at the step where they stopped** rather than restarting, no second provider applicant is created, and the abandonment is recorded as a funnel event with its step. Pins that the identity gate is a process the trader is walked through rather than an exam they can fail by closing a tab, and it is what makes GS-219's drop-off measurement describe a real population |
| GS-257 | Every verification surface is rendered and linted | The copy frames verification as a **milestone**, not an accusation: no failure language, no implication of suspicion, the trigger that fired is named in plain words, and what happens next is stated with a time. Asserts that a control which lands on honest traders and fraudsters identically must read as routine to the honest ones, which is the whole reason [ADR-021](../DECISIONS.md) moved friction upstream instead of to payout time. Pairs with GS-214 and GS-216, which pin that the scoring behind it does not accuse either |

## 33. Ownership index and coverage reconciliation

### 33.1 Scenarios by primary owner

**Every scenario has exactly one primary owner and this table is a partition**, so the counts sum to the registry total rather than to something larger. That is the property that makes the table checkable: a co-ownership table would double-count, and a coverage figure nobody can add up is a coverage figure nobody should quote. Co-owned scenarios are listed in 33.2, and each such row in its own section already says which assertion belongs to which module.

| Primary owner | Scenarios | Count |
|---|---|---|
| **M1 rules engine** | GS-001 to GS-032, GS-034 to GS-035, GS-042, GS-044, GS-047, GS-049, GS-052 to GS-083, GS-141, GS-241 to GS-242 | 73 |
| **M2 Rithmic bridge** | GS-033, GS-043, GS-084 to GS-093, GS-138 | 13 |
| **M3 billing and checkout** | GS-038 to GS-041, GS-094 to GS-099, GS-239, GS-250, GS-252 | 13 |
| **M4 trader portal** | GS-100 to GS-105, GS-132 to GS-133, GS-246 to GS-247 | 10 |
| **M5 payout system** | GS-036 to GS-037, GS-048, GS-051, GS-106 to GS-111, GS-128 to GS-129, GS-131, GS-139, GS-248 to GS-249 | 16 |
| **M6 admin and ops console** | GS-112 to GS-117, GS-130, GS-251 | 8 |
| **M7 risk and abuse** | GS-046, GS-050, GS-118 to GS-122, GS-134 to GS-137, GS-235 to GS-238 | 15 |
| **M8 affiliate system** | GS-045, GS-123 to GS-127, GS-140 | 7 |
| **M9 marketing site** | GS-142 to GS-148 | 7 |
| **M10 integrations** | GS-149 to GS-154, GS-254 | 7 |
| **M11 certificates and social proof** | GS-155 to GS-161 | 7 |
| **M12 transparency platform** | GS-162 to GS-171 | 10 |
| **M13 analytics and journal** | GS-172 to GS-178 | 7 |
| **M14 loyalty and retention** | GS-179 to GS-185, GS-243 to GS-245 | 10 |
| **M15 Discord integration** | GS-186 to GS-191 | 6 |
| **M16 notification center** | GS-192 to GS-197 | 6 |
| **M17 offers engine** | GS-198 to GS-204, GS-253 | 8 |
| **M18 graduation track** | GS-205 to GS-211, GS-240 | 8 |
| **M19 KYC and identity** | GS-212 to GS-221, GS-232 to GS-234, GS-256 to GS-257 | 15 |
| **M20 Merit Wallet** | GS-222 to GS-231 | 10 |
| **INFRA and cross-cutting** | GS-255 | 1 |
| | | **257** |

**Numbering is contiguous from GS-001 to GS-257 with no gaps and no duplicates**, which CI-06d asserts on every push ([STRATEGY](STRATEGY.md) section 4.4). The count in this file's closing line, the count quoted in [STATE](../STATE.md), the sum of the column above, and the number of rows across sections 3 to 32 are the same number or the build fails.

### 33.2 Co-owned scenarios

These carry an assertion in more than one module's suite. The primary owner in 33.1 is the module that owns the fixture; the participants own an assertion inside it.

| Scenario | Primary | Participants |
|---|---|---|
| GS-034 backdated correction for a closed day | M1 | M2 |
| GS-035 payout at 23:59:59 versus the batch | M1 | M5 |
| GS-039 chargeback after a settled payout | M3 | M5 |
| GS-041 plan v2 published while checkout is open on v1 | M3 | M1 |
| GS-047 batch crash at account 2,341 | M1 | M2 |
| GS-050 six-account hedged syndicate rehearsal | M7 | M1 |
| GS-131 account takeover against a funded wallet | M5 | M4 |
| GS-132 indicative data never reaches a money decision | M4 | M6, M2 |
| GS-133 streaming feed loss degrades to last closed | M4 | M2 |
| GS-140 affiliate destination cooling window | M8 | M5 |
| GS-141 the publish diff types co-binding apart from dominated | M1 | M3 |
| GS-248 destination swap from a hijacked session | M5 | M4, M19 |
| GS-252 compromised operator edits a live plan version | M3 | M6 |
| GS-253 mass coupon redemption with price probing | M3 | M17 |

### 33.2 How the registry reached 257

| Source | Range | Added | Running total |
|---|---|---|---|
| M01, seeded in Wave 3 and approved at the M1 gate | GS-001 to GS-078 | 78 | 78 |
| M1 gate rulings ([ADR-013](../DECISIONS.md) to [ADR-015](../DECISIONS.md)) | GS-079 to GS-083 | 5 | 83 |
| Wave 3 batch 1 module plans (M02 to M08) | GS-084 to GS-127 | 44 | 127 |
| Wave 3 batch 1 gate rulings ([ADR-016](../DECISIONS.md) to [ADR-020](../DECISIONS.md)) | GS-128 to GS-141 | 14 | 141 |
| Wave 3 batch 2 module plans (M09 to M20) | GS-142 to GS-231 | 90 | 231 |
| Consolidated founder addendum ([ADR-021](../DECISIONS.md) to [ADR-023](../DECISIONS.md)) | GS-232 to GS-239 | 8 | 239 |
| [ADR-024](../DECISIONS.md), ladder and invitation separation | GS-240 to GS-242 | 3 | 242 |
| [ADR-025](../DECISIONS.md#adr-025-progressive-cap-release-is-rejected-for-v1-and-replaced-with-cross-account-loyalty--2026-08-14-status-accepted), cap-release rejection | GS-243 to GS-245 | 3 | 245 |
| **Wave 4: the Appendix D0 attack battery** | GS-246 to GS-255 | 10 | 255 |
| **Wave 4: verification UX, renumbered out of a collision** | GS-256 to GS-257 | 2 | **257** |

**The registry was quoted at 242 going into Wave 4 and stands at 257 leaving it.** The fifteen are not scope creep: ten discharge an obligation [SECURITY](../architecture/SECURITY.md) recorded for this wave, three carry a founder ruling, and two fix a collision in which one number answered to two fixtures.

### 33.3 Constitution and research coverage

| Source battery | Where it lands | Complete |
|---|---|---|
| Appendix B4, 22 evil-brain scenarios | GS-030 to GS-051, `GS-(029 + n)` is B4 item `n` | yes |
| Appendix D0, 10 attack scenarios | GS-246 to GS-255, `GS-(245 + n)` is D0 item `n` | yes |
| Appendix A adversary taxonomy, 9 schemes | Distributed across M7 (GS-118 to GS-122, GS-134 to GS-137), M19 (GS-212 to GS-221), M20 (GS-222 to GS-231), and M1's adversarial set (GS-052 to GS-070) | yes |
| Constitution section 5.2's named examples | GS-020, GS-028, GS-041, GS-050, GS-059, GS-063, GS-065, GS-082 | yes |
| Section 5.2's minimum of 40 golden files | 257 defined | yes |

### 33.4 What is not here yet, and why

Three deliberate absences, each recorded so it reads as a decision rather than a gap.

1. **No fixture exists for the live-graduation program.** [OQ-M18-01](../DECISIONS.md) ruled that no live program exists at launch and that zero live-program copy is written until counsel rules. A fixture pinning behavior for a program that does not exist would be the marketing-versus-implementation gap arriving through the test suite, which is the one direction nobody watches.
2. **No fixture pins the vendor's real file format.** GS-084 pins that the simulator and a vendor file traverse the identical parser, which is the strongest assertion available before the [Rithmic vendor call](../STATE.md) happens. Sixteen `V-M2-nn` items are its agenda, and fixtures written against a guessed format would be a specification of the guess.
3. **The v1.x and post-launch identity-defense tiers carry fixtures that cannot yet run.** GS-237 and GS-238 describe the signal-weight table and the graph explorer, and [ADR-022](../DECISIONS.md) requires each tier to arrive with the fixture proving it does what the tier above assumed. They are written now and executed when the tier ships, which is the ordering that stops a promoted defense from arriving unproven.

Scenarios owned by M9 through M20 are numbered where they intersect the B4 battery and are otherwise added by each module plan as it is written. The rule for every wave that follows: **a scenario enters this file before its implementation exists, or it is not a golden file.**

