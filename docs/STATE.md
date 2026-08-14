---
status: draft
depends_on: []
last_updated: 2026-08-13
---

# STATE

**Milestone:** planning corpus generation. **NOT FROZEN. Zero application code.**

## Current wave
Wave 1 (Research) APPROVED and closed 2026-08-13. **Wave 2 (Architecture) in progress**: GLOSSARY, then the seven docs/architecture/ documents in dependency order (OVERVIEW, DATA_MODEL, EVENTS, STATE_MACHINES, API_CONTRACT, SECURITY, INFRA). Later docs reference earlier ones and never redefine them.

## Gate in front of us
Wave 2 gate: founder walks OVERVIEW, then DATA_MODEL, then API_CONTRACT line by line. Nothing advances to Wave 3 (module plans) until that walkthrough passes.

## Done
- Constitution committed at repo root; full section 0.5 skeleton.
- **Wave 1 complete and approved:** all seven research/ docs at `status: approved` (PROP_TECH_LANDSCAPE, TOP10_FIRMS, ADVERSARY_DOSSIER, DATA_CAPABILITIES, SECURITY_LANDSCAPE, VIBE_FAILURE_POSTMORTEMS, CLAUDE_CODE_PLAYBOOK).
- ADRs accepted: 002 (Rithmic ingest SFTP-first, T+1 tradeoff accepted), 003 (session-length regime by path), 004 (playbook stays in research/), 005 (vendor call deferred, ingest specifics provisional).

## In flight
- Wave 2 architecture docs.

## Provisional: pending Rithmic vendor confirmation (ADR-005)
The vendor call is deferred pending the founder's capital decision. The following are **designed fully but provisional**, and every one is flagged at its point of use in the architecture docs. None of them can move from provisional until the vendor conversation happens; the M2 plan doc (Wave 3) may not leave draft while they remain open.
1. **EOD report file formats and field lists.** Assumed: per-account CSV with account ref, session date, opening/closing balance, realized P&L, and (per ADR-002 contingency) either per-fill detail rows or a separate fills file.
2. **Delivery cadence and timing guarantee.** Assumed: one post-session delivery per trading day, with no contractual arrival-time SLA. The nightly batch is therefore arrival-triggered with a late-file alarm, never clock-triggered on an assumption of punctuality.
3. **Correction and backdated-fill semantics.** Assumed: corrections arrive as new rows referencing the original (hence `fills.correction_of`), not as silent in-place restatements. **This is the single highest-risk assumption in the corpus** because replay determinism depends on it (B4 #5).
4. **Sandbox/test environment availability** pre-agreement. Assumed unavailable until contract, which is why the synthetic Rithmic simulator (M2) is a v1 requirement and not a convenience.
5. **Provisioning CSV schemas** for users, accounts, risk settings, entitlements, platform permissions. Assumed: separate files per entity type with idempotent naming.
6. **Server-side copy configuration** and **admin R|API+ terms** (cost, dedicated admin User ID). Assumed out of scope for v1.

## Blocked
- Nothing blocking Wave 2. The vendor call is deferred by choice, not blocked.

## Next 3 actions
1. Finish Wave 2 architecture docs in order; INDEX and STATE updated per doc.
2. Founder walkthrough of OVERVIEW, DATA_MODEL, API_CONTRACT (the Wave 2 gate).
3. On approval: Wave 3 module plans, M1 rules engine first, always.
