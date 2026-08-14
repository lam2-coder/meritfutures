---
status: draft
depends_on: []
last_updated: 2026-08-13
---

# STATE

**Milestone:** planning corpus generation. **NOT FROZEN. Zero application code.**

## Current wave
Wave 1 (Research) APPROVED. **Wave 2 (Architecture) APPROVED** at the founder gate on 2026-08-13. All eight documents (GLOSSARY plus the seven architecture docs) are at `status: approved`. **Wave 3 (Module plans) is in progress**, M1 first per the constitution.

## Gate in front of us
**M1 plan review.** [docs/plans/M01-rules-engine.md](plans/M01-rules-engine.md) is drafted and at `status: review`, awaiting external review by the founder before approval. Per B5, no module code begins until its plan doc is reviewed and its section 7 contains adversarial scenarios not found in the constitution. No other Wave 3 plan starts until M1 is approved: M1 is a money path under the [ADR-003](DECISIONS.md) strict regime and every other module consumes its state shape.

## Done
- Constitution committed at repo root; full section 0.5 skeleton.
- Wave 1 complete and approved: all seven research/ docs at `status: approved`.
- **Wave 2 complete and approved**: eight architecture docs at `status: approved`.
- ADRs accepted: 001 (repo root as `merit/`), 002 (Rithmic ingest SFTP-first, T+1 accepted), 003 (session-length regime by path), 004 (playbook stays in research/), 005 (vendor call deferred, ingest provisional), **006 (pg-boss)**, **007 (Neon plus Railway plus Cloudflare)**, **008 (Drizzle)**, **009 (payout amount optional, defaults to maximum eligible)**, **010 (dual control, both keys founder-held at launch)**, **011 (reserve funding weekly-manual plus same-day top-up trigger)**, **012 (admin console on a separate apex domain, placeholder `ADMIN_ORIGIN`)**.
- Wave 2 gate rulings recorded in [DECISIONS.md](DECISIONS.md#wave-2-gate-closure-2026-08-13): `promotional_credit` and `currency` reserved, `404` confirmed for cross-trader access, settlement published as 2 to 3 business days, `day.closed` carries the full mark payload, auto-liquidation setpoint sits AT the floor.
- M1 plan drafted with the B5 ten-section template: 50 numbered rules with their exact operators, 24 invariants, 10 schema deltas, 16 config-validation rules, 18 failure modes, 14 adversarial scenarios (11 novel), and the replay self-audit design including the engine-upgrade protocol. [EDGE_CASES.md](EDGE_CASES.md) seeded with 47 entries; [GOLDEN_SCENARIOS.md](testing/GOLDEN_SCENARIOS.md) seeded with 78 numbered scenarios, 62 of them M1's.

## In flight
- Nothing. Parked at the M1 review gate per instruction. The founder is taking M01 for external review before approval.

## Provisional: pending Rithmic vendor confirmation (ADR-005)
The vendor call is deferred pending the founder's capital decision. These are designed fully but provisional, and each is flagged at its point of use in the architecture docs (OVERVIEW section 8, DATA_MODEL `ingest_files`/`fills`/`provisioning_queue`, STATE_MACHINES sections 5 and 6, INFRA section 12). The M2 plan doc (Wave 3) may not leave draft while they remain open.
1. **EOD report file formats and field lists.** Assumed: per-account CSV with account ref, session date, opening and closing balance, realized P&L, plus either per-fill detail rows or a separate fills file.
2. **Delivery cadence and timing guarantee.** Assumed: one post-session delivery per trading day with no contractual arrival-time SLA. The batch is therefore arrival-triggered with a late-file alarm, never clock-triggered.
3. **Correction and backdated-fill semantics.** Assumed: corrections arrive as new rows referencing the original (`fills.correction_of`), not as silent in-place restatements. **Highest-risk assumption in the corpus**, because replay determinism depends on it (B4 #5). Mitigation already designed: if the vendor restates in place, the ingest layer converts a restatement into a correction row so the table contract holds either way.
4. **Sandbox availability** before contract. Assumed unavailable, which is why the synthetic Rithmic simulator is a v1 requirement rather than a convenience.
5. **Provisioning CSV schemas** and the acknowledgement mechanism (G-VENDOR-CONFIRMED in STATE_MACHINES section 5).
6. **Server-side copy configuration** and **admin R|API+ terms**. Assumed out of scope for v1.
7. **New in Wave 3 (M1 dependency, D-M2-2):** whether the platform applies non-trading balance movements (payout withdrawals) **between sessions**. The engine's breach arithmetic assumes it does. If the platform applies them intraday, `daily_marks` must carry an intraday adjustment timestamp and the breach comparison changes shape. This is now the second-highest-risk vendor assumption in the corpus.

## Blocked
- Nothing blocking. The vendor call is deferred by choice; engineering proceeds against the simulator.

## Next 3 actions
1. Founder external review of [M01-rules-engine.md](plans/M01-rules-engine.md), then approve or return with changes. Section 10 carries 11 open questions, of which **OQ-1 (Rapid Daily cadence versus the one-in-flight rule)** and **OQ-3 (the unspecified Rapid Daily funded gates)** are blocking: both are published-marketing decisions and both change plan configs.
2. On approval: flip M01 to `approved`, regenerate INDEX, and begin M02 in a fresh session (money path, ADR-003 strict regime).
3. Fold the M1 schema deltas (section 2) into DATA_MODEL as a reviewed amendment when M1 is approved, since DATA_MODEL is now `approved` and deltas must not accumulate silently against an approved doc.
