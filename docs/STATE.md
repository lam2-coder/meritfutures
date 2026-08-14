---
status: draft
depends_on: []
last_updated: 2026-08-14
---

# STATE

**Milestone:** planning corpus generation. **NOT FROZEN. Zero application code.**

## Repo workflow (corpus phase)
**`main` is the sole trunk and holds the full corpus** ([ADR-D1](DECISIONS.md)). Commit directly to `main`, push after every commit. `SessionStart` pulls and `Stop` pushes, enforced by the committed [.claude/settings.json](../.claude/settings.json). Branch-per-module and pull-request discipline resume at FREEZE for application code, per constitution C7.

**One founder action outstanding:** `origin/dev` and `origin/claude/axcera-brochure-research-7s2pdd` still exist. Session credentials return 403 on ref deletion, so they could not be removed from here. Both point at commits `main` already contains, so they are stale rather than divergent and nothing is at risk; delete them from the GitHub UI or a local clone. `premain` was deliberately left alone (not named in the ruling, same commit `main` held before the merge).

## Current wave
Wave 1 (Research) APPROVED. Wave 2 (Architecture) APPROVED. **Wave 3 batch 1 gate CLOSED (2026-08-14): M03 through M08 are `approved`; M02 holds at `review`.** M09 through M19 not started.

## Gate in front of us
**Wave 3 batch 2: M09 through M19.** Nothing blocks it. Batch 1's rulings produced drafting inputs that batch 2 must consume rather than rediscover, listed under "Next 3 actions".

**M02 cannot reach `approved` while the Rithmic vendor call is outstanding** ([ADR-005](DECISIONS.md)). Its agenda is now **sixteen** `V-M2-nn` items, and `V-M2-15` is a **commercial precondition rather than a question**: without either a provisioning acknowledgement artifact or a readable current-risk-setting endpoint, fail-closed provisioning means no account can be brought online at all.

## Done
- Wave 1 approved (7 docs). Wave 2 approved (8 docs). M1 gate closed with ADR-013/014/015.
- **Wave 3 batch 1 gate closed.** Five ADRs: **016** (scoped ledger halt, accepted with a conservative unattributable classifier and an escalation clock), **017** (one outbound rail, plus 48h cooling on affiliate destinations), **018** (Merit Rapid `w=3`, resolving OQ-12), **019** (Merit Wallet, two-leg payouts, cadence anchor on wallet credit) with **019a** (gamification bright line), **020** (two-tier data plane). Plus [ADR-D1](DECISIONS.md) for the repo workflow.
- Also ruled: the copy-trading clause, M07's three new detectors (D-12, D-13, D-14), two-tier evidence packs, fail-closed provisioning as design law, break-glass custody, ledger recognition timing, the PSP calendar trigger, and `mc_lifecycle.py` as the version-controlled calibration source.
- Registries at **140 golden scenarios** and 82 edge cases.
- SECURITY gains C-23 to C-26, the wallet ATO blast-radius analysis (§4.7), and the break-glass procedure (§8.1). INFRA gains the 50,000-trader scale targets (§10.5).

## In flight
- Nothing. Parked after the batch 1 gate as instructed. Batch 2 not started.

## Settled at the follow-up ruling (2026-08-14)
The four findings raised after the batch 1 fold are closed and folded.

1. **Merit Rapid's per-day ceiling of record is $300** (30,000c). The $240 figure was settlement-anchored commentary predating [ADR-019](DECISIONS.md); the `w=3` calibration was basis anchored and already contained the 3 day cycle, so **no economic change**. Corrected in ADR-018, [M01 AS-03](plans/M01-rules-engine.md), STATE, and [SIMULATION_HARNESS](testing/SIMULATION_HARNESS.md), with the dossier framing added: the ceiling nominally exceeds the MFF-magnet benchmark, and the defense is the win-day gate, the 8-payout ladder (roughly **$7,200 per account lifetime**), and detection, **never the per-day rate**.
2. **Core EOD and Direct compressing to 5 trading days is CONFIRMED as intended.** Wallet-instant credit is lineup-wide by design and their economics equal the original sim calibration. Item cleared.
3. **Conservatism is relocated, not lost.** Calibration bands are central estimates; conservatism lives in `rho = 0.30`, the regime-stress ruin scenarios, and the RCR breaker at 1.0. **`CVaR99 at rho = 0.30` is the reserve floor, never the estimate.** Codified in [DECISIONS](DECISIONS.md), [GLOSSARY](GLOSSARY.md#cvar99), [M05](plans/M05-payout-system.md), [M06](plans/M06-admin-ops-console.md), and SIMULATION_HARNESS.
4. **The publish-time cadence check is split into two typed messages**, `PW-02a` (`info`, co-binding) and `PW-02b` (`warning`, dominated), with distinct text. [M01](plans/M01-rules-engine.md) section 2 carries the full typed table; [M03](plans/M03-billing-checkout.md) renders by severity.

## Parameter status (founder ruling, 2026-08-14)
**Every plan parameter is a versioned-config launch candidate.** Prices, caps, win days, consistency ratios, buffers, cadence gaps, splits, and ladder counts are economically validated working values, **formally confirmed at the FREEZE gate** and **tunable up to launch without an engine change**. **Structural rulings are fixed absent a new ADR**: universal caps exist, the payout ladder exists, EOD semantics are authoritative, zero denial, the permanent floor lock ([ADR-014](DECISIONS.md)), and the wallet-credit cadence anchor ([ADR-019](DECISIONS.md)).

Two consequences bind every public surface: **a parameter is read at request time from the pinned plan version, never copied into a template or a chart**, and **a structural ruling is never marketed as a tunable**. Recorded in [DECISIONS](DECISIONS.md#parameter-status-launch-candidates-versus-structural-rulings-founder-ruling-2026-08-14) and [M01 Appendix A.0](plans/M01-rules-engine.md).

## Blocking nothing, but needs founder eyes
Ordered by how much they change, most first.

1. **`V-M2-15` is now commercial.** Fail-closed provisioning means the vendor relationship cannot support Merit's risk posture without an acknowledgement artifact or a readable risk setting. This changes what the vendor call is for, and it should be raised first on the agenda rather than as item fifteen.
2. **ADR-020 costs roughly 2 to 4 weeks** at Wave 4, the largest single scope addition since the constitution. Recorded as a duration so it can be traded against something if the schedule tightens.
3. **`research/calibration/mc_lifecycle.py` and the workbook are not yet in the repository.** **Re-verified at the start of the batch 2 session (2026-08-14): `research/calibration/` still does not exist**, so the item stays tracked and no parameter verification against the model was possible this session. Every reference points at that path already, so the commit is all that is outstanding. Until then, Appendix A's parameters are sourced to the model by citation rather than by diff, which is exactly the standing the ruling above calls "launch candidate".
4. Remaining commercial judgments, unchanged: OQ-M8-01 (new-affiliate reserve holdback), OQ-M8-02 (flat commission rate), OQ-M3-02 (refund window stated precisely enough to publish), OQ-M5-02 (freeze expiry, proposed 10 business days), OQ-M5-05 and OQ-M5-06 (top-up threshold, wallet-spend velocity), OQ-M6-02 (breaker minimum sample), OQ-M7-03 (severity-5 SLA).

## Provisional: pending Rithmic vendor confirmation (ADR-005)
**Sixteen** numbered items in [M02 section 11](plans/M02-rithmic-bridge.md). The highest risk:
- **V-M2-15**, an acknowledgement artifact or a readable risk setting. **Now a commercial precondition**: without one, fail-closed provisioning stops every account.
- **V-M2-05**, non-trading balance movements applied between sessions and distinguishable in the report. **Data-model blast radius.**
- **V-M2-08**, whether the account's current risk setting or its liquidation events are visible to us. Feeds V-M2-15.
- **V-M2-11**, per-fill detail. Without it M7's strongest detector family does not exist and evidence packs degrade to day level.
- **V-M2-16** (new), the streaming mechanism for [ADR-020](DECISIONS.md)'s tier 2. A product gap rather than a correctness one; tier 1 is unaffected.

## Blocked
- Nothing. The vendor call is deferred by choice; engineering proceeds against the simulator, which now needs a **streaming mode** as well as file output.

## Next 3 actions
1. **Wave 3 batch 2: M09 through M19.** Carry these inputs in rather than rediscovering them: **M09** publishes Merit Rapid at 3 trading days and must not attribute the plan's speed to its cadence gap (EC-049); **M11** per-trade certificates; **M12** Trustpilot auto-review on payout settlement, with the compliance check mandatory; **M14 and M17** are bound by [ADR-019a](DECISIONS.md)'s gamification bright line and by the activated `promotional_credit` ledger class; **M17** free trials and rule-based promos; **M19** is now load bearing for the wallet's external leg.
2. **Fold the schema deltas into DATA_MODEL as one reviewed migration.** M1's ten (SD-01 to SD-10), batch 1's thirty-one (`SD-M2-nn` to `SD-M8-nn`), and now the gate's additions: SD-M2-03 unchanged, **SD-M3-06** (wallet payment method), **SD-M5-06** (`wallet_withdrawals`), **SD-M5-07** (`trader_wallet` ledger class). Money-path migration, own session, ADR-003 strict regime.
3. **Commit `research/calibration/mc_lifecycle.py` and the business-model workbook.** A founder action, and the last thing standing between Appendix A's parameters and being diffable against a versioned model. It also converts SIMULATION_HARNESS's ceiling check (30,000c on Merit Rapid, 27,000c on Core EOD and Direct) from a stated expectation into a runnable one.
