---
status: review
depends_on: []
last_updated: 2026-08-14
---

# STATE

**Milestone: the corpus is complete and standing at the FREEZE gate. STILL NOT FROZEN. Zero application code until this file says FROZEN.**

## Repo workflow

**`main` is the sole trunk for the corpus phase** ([ADR-D1](DECISIONS.md)), with `SessionStart` pulling and `Stop` pushing per the committed [.claude/settings.json](../.claude/settings.json). **Branch-per-module and pull-request discipline resume at FREEZE for application code**, per constitution C7.

**One divergence in this session, flagged rather than absorbed.** Wave 4 was developed on the branch `claude/corpus-workflow-founder-rulings-py70hi` because the session was launched with an explicit designated-branch instruction, which conflicts with the single-trunk rule above. Nothing is at risk: every commit is pushed and a pull request carries the branch into `main`. **The founder should merge it and then decide whether the single-trunk rule or the harness's branch default wins**, because the two will conflict again on every session launched the same way.

**Founder action still outstanding:** `origin/dev` and `origin/claude/axcera-brochure-research-7s2pdd` still exist. Session credentials return 403 on ref deletion. Both point at commits `main` already contains, so they are stale rather than divergent.

---

## Where the corpus stands

| Wave | Status |
|---|---|
| **Wave 1, research** | **APPROVED**, 7 docs plus the calibration source |
| **Wave 2, architecture** | **APPROVED**, 7 docs |
| **Wave 3, module plans** | **Complete.** M01 approved, M03 to M08 approved, M02 held at `review` by [ADR-005](DECISIONS.md), M09 to M20 at `review` |
| **Wave 4, testing, ops, design, legal** | **COMPLETE**, 2026-08-14. 18 new documents, the 5 remaining placeholders retired, and 3 existing documents substantially rewritten. **No placeholder remains anywhere in the corpus** |

**73 index entries. 25 ADRs. 140 edge cases. 257 golden scenarios.** Every count is stated in [INDEX](INDEX.md) and is checked against the registries by [CI-06d](testing/STRATEGY.md) once CI exists.

---

## The gate in front of us: FREEZE

**This is the last gate before application code.** It is a read-through plus a set of confirmations rather than a design review, because every open architectural question has been ruled.

### What the founder is signing off

1. **Wave 3 batch 2**, M09 through M20 at `review`. Suggested order by downstream reach: **M20, M19, M12**.
2. **Wave 4**, 18 new documents plus 5 retired placeholders and 3 rewrites. The two carrying decisions rather than descriptions are [M12-statistic-definitions](plans/M12-statistic-definitions.md) (a 16-row sign-off table) and [DELIVERY_PLAN](DELIVERY_PLAN.md) (18 weeks and a launch-blocking triage).
3. **The parameter confirmation.** Every plan parameter is a **launch candidate** under the [parameter-status ruling](DECISIONS.md#parameter-status-launch-candidates-versus-structural-rulings-founder-ruling-2026-08-14) and is **formally confirmed at this gate**: prices, caps, win days, consistency ratios, buffers, cadence gaps, splits, and `max_payouts`. **Direct's ladder is 4 or 5 and the choice is made here.**
4. **The KYC trigger set.** [ADR-021](DECISIONS.md) left the final set to FREEZE: `{pre_funded always}` versus `{second_distinct_account + pre_funded}`. Both are the same code and the difference is a config array.

### Two questions this session raised that need a ruling at the gate

**OQ-FREEZE-01. The loyalty perk's credit class.** [ADR-025](DECISIONS.md#adr-025-progressive-cap-release-is-rejected-for-v1-and-replaced-with-cross-account-loyalty--2026-08-14-status-accepted) names the cross-account loyalty perk "bonus wallet credit". **It is implemented as `promotional_credit`**, rendered inside the wallet screen and never withdrawable, because the literal reading breaches INV-M14-10, [M20](plans/M20-wallet.md) INV-M20-03 and INV-M20-11, `INV-WALLET-NO-DEPOSITS`, and [M17](plans/M17-offers-engine.md) INV-M17-08, and because it would hand an attacker a laundering path that does not require passing an evaluation. **Confirm or overrule.** Overruling is a money-path change to a closed check constraint and needs its own ADR and its own session.

**OQ-FREEZE-02. The branch-workflow conflict** described under Repo workflow above.

---

## In flight

Nothing. Wave 4 is complete and parked at the gate as instructed.

---

## What survives the gate into the build

Nine items. **Six are founder or third-party actions with no engineering content**, which is the honest summary of where the schedule is exposed: [DELIVERY_PLAN](DELIVERY_PLAN.md) records that **three of its six named risks are calendar rather than engineering**, and all three have been outstanding for the whole corpus phase.

| # | Item | Blocking | Owner |
|---|---|---|---|
| 1 | **The Rithmic vendor call.** Sixteen `V-M2-nn` items. **`V-M2-15` is a commercial precondition rather than a question**: without an acknowledgement artifact or a readable risk setting, fail-closed provisioning brings **no account online at all**. Raise it first on the agenda rather than as item fifteen | M02 leaving `review`. Could stop a launch that is otherwise ready | founder |
| 2 | **PSP applications.** Two MIDs. They go out **the day the capital go-decision is made**, and approval takes longer than the module does. A firm with one MID has no working version of [RB-03](ops/runbooks/RB-03-mid-freeze.md) | Revenue | founder |
| 3 | **The capital decision.** 18 month combined-stress ruin is **6.28 percent at $150K, 1.64 percent at $250K, 0.36 percent at $350K, 0.01 percent at $500K** | Whether the plan is worth executing | founder |
| 4 | **The counsel sitting.** Three items, one lawyer, now one sendable document: [COUNSEL_PACKET](legal/COUNSEL_PACKET.md). Item 2, wallet characterization, is the only one that blocks launch, and it most likely resolves as yes-with-conditions | The privacy policy leaving draft; all live-program copy; the dormancy calendar | founder |
| 5 | **The KYC trigger set**, decided at the gate on beta funnel data rather than in advance | Nothing. Same code either way | founder |
| 6 | **Direct's ladder ordinal**, 4 or 5 | Nothing. A config row | founder |
| 7 | **The plan-parameter confirmation**, at the gate | Nothing. Every value is a versioned-config launch candidate | founder |
| 8 | **`mc_lifecycle.py`.** Still not committed. The workbook is here; the engine is not, and the upload that accompanied it was an unrelated database dump. **Four calibrated figures are conservative rather than exact** after [ADR-024](DECISIONS.md) shortened the ladder, and the direction of the error is the safe one. [SIMULATION_HARNESS section 8](testing/SIMULATION_HARNESS.md) is the executable checklist, including the six workbook divergences and an eight-step order of operations | Exact recalibration, and the sensitivity sweeps | founder |
| 9 | **The consolidated schema-delta migration reconciliation.** **Its own session, money path, strict [ADR-003](DECISIONS.md) regime, fresh context.** Four waves of deltas reconciled into one migration set against the approved [DATA_MODEL](architecture/DATA_MODEL.md). [DELIVERY_PLAN section 3.1](DELIVERY_PLAN.md) names the four specific reasons it is high risk | The first line of application code | claude, after FREEZE approval |

---

## Settled and folded, for reference

- **25 ADRs accepted.** Widest reach: **013/014/015** (cadence anchor, permanent floor lock, plan parameters from the lifecycle simulation), **019** (Merit Wallet, two-leg payouts, and the cadence anchor on wallet credit) with **019a** (the gamification bright line), **020** (two-tier data plane), **021/022/023** (composite KYC triggers, identity defense in three priced tiers, bought checkout enrichment), **024** (the ladder and the live invitation decoupled, `max_payouts` 5), **025** (progressive cap release rejected, cross-account loyalty in its place).
- **Conservatism is relocated, not lost.** Calibration bands are central estimates. Conservatism lives in `rho = 0.30`, the regime-stress scenarios, and the RCR breaker at 1.0. **`CVaR99 at rho = 0.30` is the reserve floor, never the estimate.**
- **The ladder is a limit, not a promise.** Lifetime to trader at 50K: **$6,750 Core EOD and Direct, $4,500 Merit Rapid.** Published framing, verbatim from Lucid: the ladder is **"the maximum payout level, not a guaranteed minimum for live eligibility."** Topstep's live selectivity is **0.71 percent**.
- **The ladder disclosure is confirmed unchanged** at this session's fold: the tracker **counts down** from the final ordinal, and the continuation clause sits **in the same sentence** as the limit ([EC-122](EDGE_CASES.md)).
- **No live program exists at launch and zero live-program copy is written until counsel rules.**

## Blocked

Nothing. The vendor call and the counsel sitting are deferred by choice; engineering proceeds against the simulator.

## Next 3 actions

1. **Founder read-through and the FREEZE gate**, covering the four sign-offs and the two questions above.
2. **On approval, the schema-delta reconciliation session.** Its own session, fresh context, strict regime. It is the last thing before code and it is the highest-risk documentation work remaining.
3. **In parallel, the three calendar items**: book the vendor call, book the counsel sitting, and send the PSP applications on the day the capital decision lands.
