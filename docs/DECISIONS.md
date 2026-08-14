---
status: draft
depends_on: []
last_updated: 2026-08-13
---

# DECISIONS (ADR registry)

Every choice with rationale and alternatives. Constitution amendments are proposed here. ADR format per entry:

```
## ADR-NNN: <title>  (YYYY-MM-DD, status: proposed | accepted | superseded)
- Context:
- Decision:
- Alternatives considered:
- Consequences:
```

The Open Decisions Register (constitution section 10) resolves into entries here during W1 with the founder: queue tech, ORM, Rithmic ingest path, PSP shortlist, auth provider, hosting, restricted-jurisdiction list, Discord bot scope, KYC placement (M19).

---

## ADR-001: Repo root stands in for `merit/`  (2026-08-13, status: proposed)
- Context: Section 0.5 draws the skeleton under a `merit/` directory. The git repo `meritfutures` already holds the constitution at its root.
- Decision: Treat the repo root as `merit/`; the skeleton lives directly at root.
- Alternatives considered: Nesting everything under a `merit/` subdirectory (adds a pointless path segment to every reference).
- Consequences: All constitution paths map 1:1 with the leading `merit/` dropped.

## ADR-002: Rithmic ingest path is SFTP-first, both directions  (2026-08-13, status: accepted)
- Context: Constitution section 10 leaves "Rithmic ingest (reports vs R|API admin)" open pending vendor docs. research/DATA_CAPABILITIES.md section 3 built the comparison.
- Decision (proposed): Outbound provisioning via CSV/SFTP (Rithmic's scriptable bulk interface). Inbound marks via Rithmic EOD report files over SFTP as primary ingest. R|API+ admin pull deferred to a post-v1 enhancement for intraday recon if operations demand it.
- Alternatives considered: R|API+ admin pull as primary (rejected v1: $100/mo per API ID, standing admin credentials in a worker widen the attack surface, and the EOD rule model needs only closed-day data); hybrid from day one (rejected: two ingest paths to test and reconcile before either is proven).
- Consequences: File-based ingest is replayable and quarantinable (B4 #4); EOD report doubles as auto-liquidation evidence for M6 packs. Contingent on the vendor call confirming per-fill granularity in report files; the fills-to-marks pipeline absorbs either file shape. Blocks: M2 plan doc detail.
- **Founder approval (2026-08-13): ACCEPTED**, closing the section-10 open item, with two conditions recorded.
  - **T+1 tradeoff accepted explicitly.** File-based EOD ingest means every derived state (daily_marks, rule_states, eligibility, liability dashboard, recon) reflects the last closed trading day only. Merit has no intraday state by design, and breach visibility in our own system lags Rithmic's enforcement by one batch cycle. This is consistent with the constitution's EOD rule model (intraday enforcement is delegated to Rithmic's auto-liquidator), and it is the price of a replayable, quarantinable, low-credential ingest. Trader-facing copy and the admin dashboard must both label data as "as of last closed session" so the lag is never mistaken for a bug or a stale page.
  - **Vendor-confirmation condition stands but the call is deferred** pending the founder's capital decision. See ADR-005. Until the call happens, every ingest specific derived from public quote details is provisional and flagged in the architecture docs.

## ADR-003: Session-length policy on money vs non-money paths  (2026-08-13, status: accepted)
- Context: research/CLAUDE_CODE_PLAYBOOK.md section 7 found a 2026 community strand advocating long compounding sessions (reset only on project change), enabled by 1M-token windows + compaction. This contradicts constitution C4/C3 (`/clear` between unrelated tasks; one objective per session; fresh session per module slice).
- Decision (proposed): Keep per-slice resets and one-objective sessions on money paths (rules-engine, payout, ledger, auth) where context poisoning is catastrophic. Permit longer compounding sessions only for explicitly non-money work (marketing site, docs, fixtures).
- Alternatives considered: Adopt long-compounding universally (rejected: unacceptable risk on money-path diffs); keep strict resets everywhere (viable, but needlessly costs time on low-stakes work).
- Consequences: Amends C4 to be path-sensitive.
- **Founder approval (2026-08-13): ACCEPTED.** C4 is amended: per-slice resets and one-objective sessions remain binding on rules-engine, payout, ledger, and auth work; longer compounding sessions are permitted on marketing site, docs, fixtures, and seed work. CLAUDE.md carries the split so every session knows which regime it is in.

## ADR-004: CLAUDE_CODE_PLAYBOOK.md location (research/ vs docs/)  (2026-08-13, status: accepted)
- Context: Constitution section 0.5 skeleton places the playbook in research/; Appendix C0 text says docs/CLAUDE_CODE_PLAYBOOK.md. Standing landmine since Session 1.
- Decision (proposed): Keep it in research/ (all Phase-0 research lives together; C1 says research outputs land in research/). Treat the C0 docs/ reference as superseded.
- Alternatives considered: Move to docs/ per C0 literal text (one-line INDEX change; separates it from its six sibling research docs).
- Consequences: Cosmetic; a one-line INDEX edit either way.
- **Founder approval (2026-08-13): ACCEPTED.** The playbook stays at research/CLAUDE_CODE_PLAYBOOK.md; the Appendix C0 reference to docs/ is superseded and the Session-1 landmine is closed.

## ADR-006: Queue technology is pg-boss (Postgres-only)  (2026-08-13, status: proposed)
- Context: Constitution section 10 leaves queue tech open (BullMQ plus Redis, or pg-boss). Wave 2 needs the answer because the provisioning saga, Rise transfers, and the nightly batch all enqueue work, and the choice changes the backup and restore story.
- Decision (proposed): pg-boss. Jobs live in the same Postgres instance as the money data.
- Alternatives considered: BullMQ plus Redis (higher throughput, richer primitives, mature dashboards, but adds a second stateful service to secure, back up, and restore, and puts job state outside the PITR boundary that protects the ledger). At v1 scale (5,000 accounts in a nightly batch under 10 minutes, payout request p95 under 500ms) the throughput advantage buys nothing we need.
- Consequences: One datastore to restore, one credential set, one backup drill. Enqueue participates in the same transaction as the state change that caused it, which removes a whole class of saga bugs ("committed the purchase, lost the provisioning job"). Restore-from-backup keeps queued work and idempotency keys consistent with the ledger (B4 scenario 19). If job volume ever outgrows Postgres, migration is a contained change behind the job interface.

## ADR-005: Rithmic vendor call deferred; M2 ingest specifics are provisional  (2026-08-13, status: accepted)
- Context: ADR-002 is conditional on a Rithmic vendor call confirming EOD report formats and field lists, delivery cadence and timing guarantees, correction/backdated-fill semantics (critical for replay determinism, B4 #5), sandbox availability, server-side copy configuration, and admin R|API+ terms. The founder is deferring that call pending a capital decision.
- Decision: Wave 2 architecture is designed fully from the known public CSV/SFTP quote details rather than waiting. Every ingest specific that the vendor call must later confirm is labeled **provisional-pending-vendor-confirmation** at the point of use, and the assumption is stated explicitly so a later correction is a bounded edit rather than a redesign.
- Alternatives considered: Block Wave 2 on the vendor call (rejected: the architecture is 90% independent of file-format detail, and blocking wastes the deferral window); design vaguely to avoid being wrong (rejected: vagueness moves the cost into Wave 3 and hides the assumptions instead of listing them).
- Consequences: DATA_MODEL absorbs either report shape because marks are computed from ingested rows, never trusted from a vendor summary. The provisional set is tracked in STATE.md and re-verified the moment the vendor conversation happens; the M2 plan doc (Wave 3) cannot leave draft until it does.
