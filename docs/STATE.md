---
status: draft
depends_on: []
last_updated: 2026-08-13
---

# STATE

**Milestone:** planning corpus generation. **NOT FROZEN. Zero application code.**

## Current wave
Wave 1 (Research) APPROVED. **Wave 2 (Architecture) COMPLETE** and awaiting the founder gate. All eight documents are at `status: review` and were committed separately: GLOSSARY, OVERVIEW, DATA_MODEL, EVENTS, STATE_MACHINES, API_CONTRACT, SECURITY, INFRA.

## Gate in front of us
Wave 2 gate: founder walks **OVERVIEW, then DATA_MODEL, then API_CONTRACT** line by line. Nothing advances to Wave 3 (module plans, M1 first) until that walkthrough passes and the five open ADRs are decided.

## Done
- Constitution committed at repo root; full section 0.5 skeleton.
- Wave 1 complete and approved: all seven research/ docs at `status: approved`.
- Wave 2 complete: eight architecture docs at `status: review`.
- ADRs accepted: 002 (Rithmic ingest SFTP-first, T+1 accepted), 003 (session-length regime by path), 004 (playbook stays in research/), 005 (vendor call deferred, ingest provisional).
- ADRs proposed and awaiting decision: **006** (pg-boss queue), **007** (Neon plus Railway plus Cloudflare hosting), **008** (Drizzle ORM).

## In flight
- Nothing. Paused at the Wave 2 gate per instruction (do not begin Wave 3).

## Provisional: pending Rithmic vendor confirmation (ADR-005)
The vendor call is deferred pending the founder's capital decision. These are designed fully but provisional, and each is flagged at its point of use in the architecture docs (OVERVIEW §8, DATA_MODEL `ingest_files`/`fills`/`provisioning_queue`, STATE_MACHINES §5 and §6, INFRA §12). The M2 plan doc (Wave 3) may not leave draft while they remain open.
1. **EOD report file formats and field lists.** Assumed: per-account CSV with account ref, session date, opening and closing balance, realized P&L, plus either per-fill detail rows or a separate fills file.
2. **Delivery cadence and timing guarantee.** Assumed: one post-session delivery per trading day with no contractual arrival-time SLA. The batch is therefore arrival-triggered with a late-file alarm, never clock-triggered.
3. **Correction and backdated-fill semantics.** Assumed: corrections arrive as new rows referencing the original (`fills.correction_of`), not as silent in-place restatements. **Highest-risk assumption in the corpus**, because replay determinism depends on it (B4 #5). Mitigation already designed: if the vendor restates in place, the ingest layer converts a restatement into a correction row so the table contract holds either way.
4. **Sandbox availability** before contract. Assumed unavailable, which is why the synthetic Rithmic simulator is a v1 requirement rather than a convenience.
5. **Provisioning CSV schemas** and the acknowledgement mechanism (G-VENDOR-CONFIRMED in STATE_MACHINES §5).
6. **Server-side copy configuration** and **admin R|API+ terms**. Assumed out of scope for v1.

## Blocked
- Nothing blocking. The vendor call is deferred by choice; engineering proceeds against the simulator.

## Next 3 actions
1. Founder walkthrough of OVERVIEW, DATA_MODEL, API_CONTRACT; decide ADR-006, 007, 008 and the five DATA_MODEL and API_CONTRACT questions listed at the end of those docs.
2. On approval: move the eight Wave 2 docs `review` to `approved`, regenerate INDEX.
3. Begin Wave 3 module plans, M1 rules engine first, always, using the B5 ten-section template with at least five novel adversarial scenarios per module.
