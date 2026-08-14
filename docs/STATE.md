---
status: approved
depends_on: []
last_updated: 2026-08-14
---

# STATE

# **FROZEN** (2026-08-14)

**The planning corpus is complete, approved, and FROZEN. Application code may now begin.**

Every document is `approved` except [M02](plans/M02-rithmic-bridge.md), which holds at `review` by [ADR-005](DECISIONS.md) pending the Rithmic vendor call, as ruled.

**Branch-per-module and pull-request discipline resume now**, per constitution C7 and the amended [ADR-D1](DECISIONS.md). The corpus-phase single-trunk rule has expired; it was a corpus-phase rule and code exists from here.

---

## What FREEZE means, operationally

| | |
|---|---|
| **The corpus is the specification** | A behavior not in the corpus is not in scope. A behavior in the corpus is a commitment |
| **Changing a frozen document requires an ADR** | Not a commit. The document is the record and the ADR is how it moves |
| **Plan parameters remain launch candidates** | Confirmed at this gate, re-confirmed at launch as config per the standing [parameter-status ruling](DECISIONS.md). They are rows in `plan_version_sizes`, never constants |
| **Structural rulings are fixed** | Caps exist, the ladder exists and is finite, EOD semantics are authoritative, zero denial, the permanent floor lock, the wallet-credit cadence anchor. Absent a new ADR, these do not move |

---

## The gate that closed

**25 ADRs. 140 edge cases. 257 golden scenarios. Four waves.**

| Sign-off | Ruling |
|---|---|
| Wave 3 batch 2 (M09 to M20) | **APPROVED** |
| Wave 4 (testing, ops, design, legal) | **APPROVED** |
| Plan parameters | **CONFIRMED as launch candidates** |
| **Direct's ladder** | **4.** Direct skips the eval filter, so its funded population carries the unselected base rate and the heaviest per-account tail. The shortest ladder belongs on the least-filtered plan |
| **KYC trigger set** | **`{second_distinct_account_purchase, pre_funded}`, earliest fires.** Fleet coverage prevails; telemetry adjudicates post-beta |
| **M12 statistics, including S-16** | **APPROVED.** The first published number publishes whatever it says |
| **OQ-FREEZE-01** | Implementation **confirmed**, [ADR-025](DECISIONS.md)'s literal wording **overruled**. The perk is `promotional_credit`, never withdrawable. **The invariant guard caught a founder-guide wording error**, which is the review system working as designed |
| **OQ-FREEZE-02** | [ADR-D1](DECISIONS.md) amended: harness-launched sessions run designated branches and **must end mergeable**, founder merges **same day**; local sessions commit direct to `main`. **PR #2 merged** |

---

## The calibration engine landed and the corpus is recalibrated

`research/calibration/mc_lifecycle.py` is committed and was **run**. Full record in [SIMULATION_HARNESS section 9](testing/SIMULATION_HARNESS.md).

**Exact figures at the corpus configuration** (`w=3`, funded `min_trading_days = 0` on all three, ladder 5 / 5 / 4):

| Plan | Eval pass | Funded to payout | Firm $ per funded (50K) | Payouts per payer | Contribution margin |
|---|---|---|---|---|---|
| Core EOD | 26.53% | 33.46% | **$690.44** | 1.54 | **+0.25%** |
| **Merit Rapid** | 16.55% | **48.11%** | **$904.07** | **2.13** | **16.9%** |
| Direct | 100% | 12.07% | **$207.33** | 1.30 | **39.2%** |

[ADR-018](DECISIONS.md) carried $889, 48.1 percent, 2.09, and roughly 18 percent. **The funnel figure matched to two decimals; firm cost is 1.7 percent higher and margin 1.1 points lower. Immaterial, and mildly unfavorable.**

**Lifetime to trader at 50K: $6,750 Core EOD, $5,400 Direct, $4,500 Merit Rapid.**

**The reproduction check passed.** The engine as committed reproduces the workbook's plans tab, and the risk engine reproduces the calibration README's table **exactly, to the cent**: CVaR99 at rho = 0.30 is **$132,896.71**, the multiple **2.9285x**, all twenty ruin cells matching.

**The finding worth carrying: the ladder does not bind the average account.** Ladder 8/6 and ladder 5/4 return identical figures on Core EOD and Direct, because mean payouts per payer are 1.54, 2.13 and 1.30. **The ladder change is margin-neutral in the central estimate and its entire value is tail protection.** No margin table will ever show the ladder costing anything, so a future review looking only at unit economics may conclude it can be lengthened for free. **It cannot.**

**The engine is stale in four places** (plan name, Rapid's win days, Rapid and Direct minimum days, ladder counts). **Re-running it at the corpus configuration is a build-phase task** and must reproduce the table above before any CI calibration band is set from it.

---

## What survives FREEZE

**Nine items. Six are founder or third-party actions with no engineering content**, which remains the honest summary of where the schedule is exposed.

| # | Item | Blocking | Owner |
|---|---|---|---|
| 1 | **The Rithmic vendor call.** Sixteen `V-M2-nn` items. **`V-M2-15` is a commercial precondition rather than a question**: without an acknowledgement artifact or a readable risk setting, fail-closed provisioning brings **no account online at all**. Raise it first, not as item fifteen | M02 leaving `review`. Could stop a launch that is otherwise ready | founder |
| 2 | **PSP applications.** Two MIDs, sent **the day the capital go-decision lands**. Approval takes longer than the module does. A firm with one MID has no working version of [RB-03](ops/runbooks/RB-03-mid-freeze.md) | Revenue | founder |
| 3 | **The capital decision.** 18-month combined-stress ruin is **6.28% at $150K, 1.64% at $250K, 0.36% at $350K, 0.01% at $500K** | Whether the plan is worth executing | founder |
| 4 | **The counsel sitting.** Three items, one sendable document: [COUNSEL_PACKET](legal/COUNSEL_PACKET.md). Item 2, wallet characterization, is the only one that blocks launch and most likely resolves as yes-with-conditions | The privacy policy leaving draft; all live-program copy; the dormancy calendar | founder |
| 5 | **Re-run `mc_lifecycle.py`** at the corpus configuration and commit the result. Four stale places, listed above | CI calibration bands | claude, build phase |
| 6 | **Launch-time parameter re-confirmation.** Every value is a config row, and the standing rule requires a deliberate confirmation rather than an inherited one | Launch | founder |
| 7 | **The `promotional_credit` loyalty perk's build**, per OQ-FREEZE-01 as ruled | M14 | claude, build phase |
| 8 | **Post-beta KYC trigger adjudication** on the funnel and corpus-coverage telemetry | Nothing. A config array | founder, post-beta |
| 9 | **The schema-delta reconciliation.** The first build session, below | The first line of application code | claude |

---

## The first build session

**Schema-delta reconciliation. Money path. Strict [ADR-003](DECISIONS.md) regime: one objective, fresh context, no compounding. PLAN MODE IS MANDATORY.**

**What it is.** Four waves of proposed schema deltas reconciled into one reviewed migration set against the approved [DATA_MODEL](architecture/DATA_MODEL.md): **M01's ten (SD-01 to SD-10), batch 1's thirty-seven (`SD-M2-nn` to `SD-M8-nn`), and batch 2's forty-one (`SD-M9-nn` to `SD-M20-nn`): 88 numbered, plus 5 unnumbered schema changes that exist as rulings with no delta number, for a total of 93.** SD-M19-03 widens to record which KYC trigger fired, and the link-confidence signal-weight table gets a home in the reserved sequence.

**The counts above are corrected.** This document previously read "thirty-one" and "thirty-four", which had been wrong since Session 5 and were quoted onward by three other documents. [ADR-026](DECISIONS.md) records the correction and its provenance; the manifest completeness gate joins CI so a hand-maintained tally cannot drift again.

**Why plan mode is mandatory rather than advised.** This session touches every money table at once; it is the only session whose output cannot be corrected by a later session without a migration against live data; and its failure mode is silent, because a delta folded wrongly produces a schema that works and is wrong. [DELIVERY_PLAN section 3.1](DELIVERY_PLAN.md) names the four specific reasons it is the highest-risk work remaining. **The plan is reviewed before a single migration file is written.**

**Definition of done.** One migration set, every delta traced to the document that proposed it, every money-path column reviewed line by line by the founder per constitution E2, and no delta silently dropped. **A delta that is rejected is rejected in writing, in an ADR, never by omission.**

---

## Blocked

Nothing.

## Next 3 actions

1. **The schema-delta reconciliation session**, in plan mode, fresh context.
2. **In parallel, the three calendar items**: book the vendor call, book the counsel sitting, and send the PSP applications the day the capital decision lands.
3. **Re-run and commit `mc_lifecycle.py`** at the corpus configuration, closing the last calibration gap.
