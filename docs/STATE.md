---
status: draft
depends_on: []
last_updated: 2026-08-13
---

# STATE

**Milestone:** planning corpus generation. **NOT FROZEN. Zero application code.**

## Current wave
Wave 1 (Research) APPROVED. Wave 2 (Architecture) APPROVED. **Wave 3 (Module plans) in progress.** M01 APPROVED at the M1 gate. **Wave 3 batch 1 (M02 through M08) is drafted and at `status: review`.** M09 through M19 not started.

## Gate in front of us
**Wave 3 batch 1 review.** Seven plans await founder review. Suggested order, money paths first: **M05, M02, M03**, then M07, M06, M04, M08. Per B5, no module's code begins until its plan doc is reviewed and its section 7 carries adversarial scenarios not found in the constitution; all seven do.

**M02 cannot reach `approved` while the Rithmic vendor call is outstanding** ([ADR-005](DECISIONS.md)). Its fourteen `V-M2-nn` items are the call's agenda.

## Done
- Wave 1 approved (7 docs). Wave 2 approved (8 docs).
- **M1 gate closed.** All eleven open questions ruled. M01, GOLDEN_SCENARIOS, EDGE_CASES at `approved`. ADR-013 (settlement cadence anchor; Rapid Daily renamed **Merit Rapid**), ADR-014 (no post-payout floor reset; lock on all three plans at size plus $100), ADR-015 (plan parameters from the founder's lifecycle simulation; funded min days 0).
- **Wave 3 batch 1 written:** M02 rithmic-bridge, M03 billing-checkout, M04 trader-portal, M05 payout-system, M06 admin-ops-console, M07 risk-abuse, M08 affiliate-system. Each a full B5 ten-section plan, each committed separately.
- Registries grown to **127 golden scenarios** and **82 edge cases**. 44 adversarial scenarios across the eight plans, 35 of them novel.
- ADRs 001 to 015 accepted; **016 and 017 proposed** (see below).

## In flight
- Nothing. Parked at the batch 1 review gate as instructed.

## Blocking nothing, but needs founder eyes
Ordered by how much they change, most first.

1. **OQ-M5-01 / [ADR-016](DECISIONS.md) (proposed).** A one cent ledger imbalance currently halts **every** payout for every trader. Scoping it to the implicated identity, with only a global mismatch stopping everything, amends approved EVENTS wording and needs a ruling.
2. **OQ-12 (from the M1 gate).** Merit Rapid's real cycle is 5 trading days, set by its win-day gate, not 3 to 4 by its 1 day cadence gap. Published copy depends on the answer, and an instant settlement rail does **not** make the plan daily.
3. **OQ-M7-01.** Is copy trading allowed? Detector D-01 finds it either way; without a ToS clause its flags cannot be acted on. Legal drafting dependency.
4. **OQ-M3-04.** PSP applications are still open (constitution section 10, and section 8 flags the lead time as a schedule risk to front-load in W1). This is a **calendar** dependency, not a design one: no revenue exists until two MIDs are approved, and approval takes longer than the module does.
5. **OQ-M2-04.** Does Merit accept a vendor relationship with no provisioning acknowledgement artifact? If Rithmic returns nothing, `set_risk` can never be positively confirmed and an account can trade with no working auto-liquidator. Worth raising **on the call as a requirement**, not a question.
6. **OQ-M6-03.** Break-glass for the second `owner` credential. Both dual-control keys are the founder's; if both are lost or the founder is unreachable, no sensitive change can be made at all.
7. **OQ-M5-04.** Is the firm's split recognized as revenue at approval or at settlement? An accounting policy with tax consequences, to settle before the first close.
8. **[ADR-017](DECISIONS.md) (proposed).** One outbound payment rail for every module that ever pays anybody.
9. Commercial judgments: OQ-M8-01 (new-affiliate reserve holdback), OQ-M8-02 (flat commission rate), OQ-M3-02 (refund window stated precisely enough to publish), OQ-M5-02 (freeze expiry, proposed 10 business days).

## Provisional: pending Rithmic vendor confirmation (ADR-005)
Now enumerated as **fourteen numbered items** in [M02 section 11](plans/M02-rithmic-bridge.md), each with what depends on it, what changes if it is wrong, and whether the blast radius is an edit, a design change, or a data-model change. The two highest risk:
- **V-M2-05**, non-trading balance movements applied between sessions and distinguishable in the report. If wrong, `daily_marks` needs an intraday adjustment timestamp and M1's breach comparison changes shape. **Data-model blast radius.**
- **V-M2-08**, whether the account's current risk setting or its liquidation events are visible to us. If not, Merit cannot verify the one control the entire intraday risk posture rests on, and [M02 AS-M2-03](plans/M02-rithmic-bridge.md)'s residual is permanent.
Also newly load bearing: **V-M2-11**, per-fill detail. Without it M7's strongest detector family (fill clustering, news windows, martingale) does not exist, and evidence packs degrade from trade level to day level.

## Blocked
- Nothing. The vendor call is deferred by choice; engineering proceeds against the simulator, which is a v1 requirement rather than a convenience.

## Next 3 actions
1. Founder review of Wave 3 batch 1, money paths first (M05, M02, M03).
2. **Fold M1's ten schema deltas (SD-01 to SD-10) into DATA_MODEL as one reviewed migration.** Approved but not yet folded; DATA_MODEL section 11 carries the pointer so the gap is visible rather than silent. Money-path migration, own session, ADR-003 strict regime. **Note:** batch 1 proposed a further 31 module-level deltas (`SD-M2-nn` through `SD-M8-nn`); they should fold in the same pass, not as a second migration.
3. Wave 3 batch 2: M09 through M19, after batch 1 clears its gate.
