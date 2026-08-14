---
status: draft
depends_on: []
last_updated: 2026-08-13
---

# STATE

**Milestone:** planning corpus generation. **NOT FROZEN. Zero application code.**

## Current wave
Wave 1 (Research) APPROVED. Wave 2 (Architecture) APPROVED. **Wave 3 (Module plans) is in progress.** M01 is APPROVED at the M1 gate (2026-08-13) and Wave 3 batch 1 (M02 through M08) is being written against its now-fixed interfaces.

## Gate in front of us
**Wave 3 batch 1 review.** M02 through M08 are being drafted to `status: review` for founder review. Per B5, no module's code begins until its plan doc is reviewed and its section 7 contains adversarial scenarios not found in the constitution. M09 through M19 are not started.

## Done
- Constitution committed at repo root; full section 0.5 skeleton.
- Wave 1 complete and approved: all seven research/ docs at `status: approved`.
- Wave 2 complete and approved: eight architecture docs at `status: approved`.
- **M1 gate closed (2026-08-13).** All eleven open questions ruled on. [M01](plans/M01-rules-engine.md), [GOLDEN_SCENARIOS](testing/GOLDEN_SCENARIOS.md), and [EDGE_CASES](EDGE_CASES.md) are `approved`. Three new ADRs: **013** (cadence gap anchors on the settled payout's effective day; Rapid Daily renamed **Merit Rapid**), **014** (no post-payout floor reset; floor lock enabled on all three plans at size plus $100; `post_payout_floor_rule` retired to `none`), **015** (plan parameters sourced from the founder's lifecycle simulation; funded minimum trading days is 0 on all three plans).
- ADRs accepted: 001 through 015. See [DECISIONS.md](DECISIONS.md).

## In flight
- Wave 3 batch 1, starting now: M02 rithmic-bridge, M03 billing-checkout, M04 trader-portal, M05 payout-system, M06 admin-ops, M07 risk-abuse, M08 affiliate. Each consumes M01's approved interfaces rather than restating them.

## Open for the founder, non-blocking
- **OQ-12 (new, from the M1 gate).** Merit Rapid's cycle is **5 trading days**, set by its 5 win-day gate, not 3 to 4 as OQ-1 estimated before the win-day count was fixed. Its 1 day cadence gap is a dominated gate that never binds (EC-049). An instant settlement rail does **not** make the plan daily, because the settlement leg already hides behind the win-day gate; only `win_days.required_count` moves that cadence, and lowering it to 1 raises extraction to roughly 30,000 cents per trading day on the current rail (about 1.6x the design ceiling) or roughly 45,000 on an instant rail (about 2.4x). Holding the ceiling at a 2 day cycle needs the cap at about 42,000c ($420). Every option is a config edit; nothing is blocked.
- **The post-beta revisit recorded in ADR-014.** The floor lock hands the trader a bounded free option (AS-04). Accepted deliberately, watched as a cohort via `rule.floor_locked` from launch, revisited against realized variance after beta.

## Provisional: pending Rithmic vendor confirmation (ADR-005)
The vendor call is deferred pending the founder's capital decision. These are designed fully but provisional, and each is flagged at its point of use. **M02's plan doc may not leave `review` for `approved` while these are open** (ADR-005).
1. **EOD report file formats and field lists.** Assumed: per-account CSV with account ref, session date, opening and closing balance, realized P&L, plus either per-fill detail rows or a separate fills file.
2. **Delivery cadence and timing guarantee.** Assumed: one post-session delivery per trading day with no contractual arrival-time SLA. The batch is therefore arrival-triggered with a late-file alarm, never clock-triggered.
3. **Correction and backdated-fill semantics.** Assumed: corrections arrive as new rows referencing the original (`fills.correction_of`), not as silent in-place restatements. **Highest-risk assumption in the corpus**, because replay determinism depends on it (B4 #5). Mitigation designed: if the vendor restates in place, the ingest layer converts a restatement into a correction row so the table contract holds either way.
4. **Sandbox availability** before contract. Assumed unavailable, which is why the synthetic Rithmic simulator is a v1 requirement rather than a convenience.
5. **Provisioning CSV schemas** and the acknowledgement mechanism (G-VENDOR-CONFIRMED in STATE_MACHINES section 5).
6. **Server-side copy configuration** and **admin R|API+ terms**. Assumed out of scope for v1.
7. **Non-trading balance movements applied between sessions** (M1 dependency D-M2-2). The engine's breach arithmetic assumes the platform applies payout withdrawals between sessions. If it applies them intraday, `daily_marks` must carry an intraday adjustment timestamp and the breach comparison changes shape. Second-highest-risk vendor assumption in the corpus.

## Blocked
- Nothing blocking. The vendor call is deferred by choice; engineering proceeds against the simulator.

## Next 3 actions
1. Founder review of Wave 3 batch 1 (M02 through M08), one doc at a time, money paths first (M05, then M02, then M03).
2. **Fold M1's ten schema deltas (SD-01 to SD-10) into DATA_MODEL as one reviewed migration.** They are approved but not yet folded; DATA_MODEL section 11 carries the pointer so the gap is visible rather than silent. This is a money-path migration and gets its own session under the ADR-003 strict regime.
3. Wave 3 batch 2: M09 through M19, in dependency order, after batch 1 clears its gate.
