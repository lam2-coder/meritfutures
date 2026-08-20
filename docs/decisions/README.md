---
status: approved
depends_on: []
last_updated: 2026-08-18
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

Split to a file per entry on 2026-08-15 by [ADR-043](ADR-043.md). The number
allocation tables live in [ALLOCATION.md](ALLOCATION.md); the gate closures that
grouped these rulings live in [gates/](gates/).

## Architecture decision records

| ADR | Title |
|---|---|
| [ADR-001](ADR-001.md) | Repo root stands in for `merit/`  (2026-08-13, status: proposed) |
| [ADR-002](ADR-002.md) | Rithmic ingest path is SFTP-first, both directions  (2026-08-13, status: accepted) |
| [ADR-003](ADR-003.md) | Session-length policy on money vs non-money paths  (2026-08-13, status: accepted) |
| [ADR-004](ADR-004.md) | CLAUDE_CODE_PLAYBOOK.md location (research/ vs docs/)  (2026-08-13, status: accepted) |
| [ADR-006](ADR-006.md) | Queue technology is pg-boss (Postgres-only)  (2026-08-13, status: proposed) |
| [ADR-007](ADR-007.md) | Hosting is managed Postgres (Neon) plus Railway plus Cloudflare  (2026-08-13, status: proposed) |
| [ADR-008](ADR-008.md) | ORM is Drizzle  (2026-08-13, status: proposed) |
| [ADR-005](ADR-005.md) | Rithmic vendor call deferred; M2 ingest specifics are provisional  (2026-08-13, status: accepted) |
| [ADR-009](ADR-009.md) | Payout amount is optional and defaults to the maximum eligible  (2026-08-13, status: accepted) |
| [ADR-010](ADR-010.md) | Dual control on cap, split, gap, and treasury credentials, with both keys founder-held at launch  (2026-08-13, status: accepted) |
| [ADR-011](ADR-011.md) | Reserve funding is weekly-manual with a same-day top-up trigger  (2026-08-13, status: accepted) |
| [ADR-012](ADR-012.md) | Admin console lives on a separate apex domain  (2026-08-13, status: accepted) |
| [ADR-013](ADR-013.md) | The cadence gap anchors on the settled payout's effective day; Rapid Daily becomes Merit Rapid  (2026-08-13, status: accepted) |
| [ADR-014](ADR-014.md) | The floor never resets on settlement; the lock is a permanent stop  (2026-08-13, status: accepted) |
| [ADR-015](ADR-015.md) | Plan parameters come from the founder's lifecycle simulation; funded minimum trading days is zero  (2026-08-13, status: accepted) |
| [ADR-D1](ADR-D1.md) | Corpus phase runs on a single trunk, with pull and push enforced by hooks  (2026-08-14, status: accepted) |
| [ADR-016](ADR-016.md) | A ledger imbalance halts payouts for the implicated identity; only a global mismatch halts everything  (2026-08-13, status: accepted) |
| [ADR-017](ADR-017.md) | Every outbound payment in Merit uses one rail and one transfer table  (2026-08-13, status: accepted) |
| [ADR-018](ADR-018.md) | Merit Rapid requires 3 win days  (2026-08-14, status: accepted) |
| [ADR-019](ADR-019.md) | Merit Wallet, two-leg payouts with the cadence anchor on wallet credit  (2026-08-14, status: accepted) |
| [ADR-020](ADR-020.md) | A two-tier data plane, with an indicative realtime layer over the authoritative EOD engine  (2026-08-14, status: accepted) |
| [ADR-021](ADR-021.md) | KYC placement is a composite trigger set, not a single point  (2026-08-14, status: accepted) |
| [ADR-022](ADR-022.md) | Identity defense is elevated to a scored graph, in three priced tiers  (2026-08-14, status: accepted) |
| [ADR-023](ADR-023.md) | A digital-footprint enrichment vendor at checkout, bought and not built  (2026-08-14, status: accepted) |
| [ADR-024](ADR-024.md) | The ladder and the live invitation are two separate mechanisms  (2026-08-14, status: accepted) |
| [ADR-025](ADR-025.md) | Progressive cap release is rejected for v1 and replaced with cross-account loyalty  (2026-08-14, status: accepted) |
| [ADR-026](ADR-026.md) | The schema-delta reconciliation, and the count correction  (2026-08-14, status: accepted) |
| [ADR-027](ADR-027.md) | `trader_withdrawable` and `trader_wallet` are two distinct positions  (2026-08-14, status: accepted, **reversing an earlier ruling in this same session**) |
| [ADR-028](ADR-028.md) | `payout_requests.status` under the wallet  (2026-08-14, status: accepted) |
| [ADR-029](ADR-029.md) | `dedupe_matches` is the authoritative hard link  (2026-08-14, status: accepted) |
| [ADR-030](ADR-030.md) | Plan-config key names are `max_payouts` and `kyc.triggers`  (2026-08-14, status: accepted) |
| [ADR-031](ADR-031.md) | The published statistic is `bigint` with a unit, and its no-floats exemption is retired  (2026-08-14, status: accepted) |
| [ADR-032](ADR-032.md) | `measure` on `published_statistics`, and the pair invariant as DDL  (2026-08-14, status: accepted) |
| [ADR-033](ADR-033.md) | The reviewer subagent is a citation check, not an adversarial one  (2026-08-14, status: proposed) |
| [ADR-034](ADR-034.md) | ADR numbers are allocated, not guessed, and no document states a derivable count  (2026-08-14, status: accepted) |
| [ADR-035](ADR-035.md) | `0027`'s published-plan-version immutability trigger reads a column that does not exist  (2026-08-15, status: accepted) |
| [ADR-036](ADR-036.md) | Migration numbers are allocated, not guessed, and the allocation gate lives where the number set already lives  (2026-08-15, status: proposed) |
| [ADR-037](ADR-037.md) | A shorthand may not restate a value the config owns  (2026-08-15, status: accepted) |
| [ADR-038](ADR-038.md) | A CI stage states, in its own output, what it currently proves  (2026-08-15, status: accepted) |
| [ADR-039](ADR-039.md) | Auth is passkeys plus email OTP plus SMS OTP, and a verified phone is an identity signal  (2026-08-15, status: accepted) |
| [ADR-040](ADR-040.md) | The payout enforcement window, and zero denial expressed as a state that expires  (2026-08-15, status: accepted) |
| [ADR-041](ADR-041.md) | Identity-level restriction is `restricted`, and this is its enforcement surface  (2026-08-15, status: accepted) |
| [ADR-042](ADR-042.md) | The trading calendar is transcribed from the exchange, and Merit computes nothing in business days  (2026-08-15, status: accepted) |
| [ADR-043](ADR-043.md) | The append-only registries become directory-per-entry  (2026-08-15, status: accepted) |
| [ADR-044](ADR-044.md) | The AI and LLM policy. A permission boundary that adds no scope, and a narration boundary on the trader surface  (2026-08-16, status: accepted) |
| [ADR-045](ADR-045.md) | A `trading_calendar` correction that leaves no prior image is refused by the database  (2026-08-16, status: accepted) |
| [ADR-047](ADR-047.md) | `rule_states` carries the calendar revision, and Appendix B.4's protocol governs a calendar correction  (2026-08-16, status: accepted) |
| [ADR-048](ADR-048.md) | CI-03's polarity is derived per fixture from the rules it cites  (2026-08-16, status: accepted) |
| [ADR-049](ADR-049.md) | `CalendarSlice` is a value, and a lookup miss is a typed refusal  (2026-08-16, status: accepted) |
| [ADR-050](ADR-050.md) | `INV-06` gains a stated `R-31` exception, and it is exactly one rule  (2026-08-17, status: accepted) |
| [ADR-046](ADR-046.md) | A contact address is held reversibly, and the notification obligation is discharged by evidence  (2026-08-16, status: accepted) |
| [ADR-051](ADR-051.md) | `R-32` anchors at `opened_on`, and `phase_eval.max_days` is the column that binds  (2026-08-17, status: accepted) |
| [ADR-052](ADR-052.md) | The locked floor is an assignment, and the engine is wrong because a test was made stricter than the rule it was testing  (2026-08-17, status: accepted) |
| [ADR-053](ADR-053.md) | The high-water bound holds only while the floor is unlocked, and what it stops asserting is the ruling  (2026-08-17, status: accepted) |
| [ADR-054](ADR-054.md) | `R-35` does not run on the row that closes an account, and `GS-064`'s `20,000` is right  (2026-08-17, status: accepted) |
| [ADR-055](ADR-055.md) | A holiday pauses the session belonging to the next trade date, and the exception carries that session's bounds  (2026-08-17, status: accepted) |
| [ADR-056](ADR-056.md) | `INV-07` gains a stated `R-31` exception, and the lock is cleared rather than carried  (2026-08-18, status: accepted) |
| [ADR-057](ADR-057.md) | one refuted sentence in four documents, and the ninth field on a breach row  (2026-08-18, status: accepted) |
| [ADR-058](ADR-058.md) | The calendar source publishes forward-only, so a full forward year never exists and the six-month horizon alarm can never be cleared  (2026-08-18, status: accepted) |
| [ADR-060](ADR-060.md) | `engine_eligible` contains the six funded gates and not R-38, and the reason it was unrulable is that no document ever enumerated them  (2026-08-18, status: accepted) |
| [ADR-058](ADR-058.md) | The calendar source publishes forward-only, so a full forward year never exists and the six-month horizon alarm can never be cleared  (2026-08-18, status: proposed) |
| [ADR-060](ADR-060.md) | `engine_eligible` contains the six funded gates and not R-38, and the reason it was unrulable is that no document ever enumerated them  (2026-08-18, status: proposed) |
| [ADR-059](ADR-059.md) | The three engine inputs group A is blocked on, framed as three questions, and the disposition of the five registry rows that no answer to them can free  (2026-08-18, status: accepted) |

## Gate closures

| Closure | Rulings | ADRs |
|---|---|---|
| [M1 gate closure (2026-08-13)](gates/m1-gate-closure-2026-08-13.md) | 0 | 0 |
| [Wave 3 batch 1 gate closure (2026-08-14)](gates/wave-3-batch-1-gate-closure-2026-08-14.md) | 9 | 0 |
| [Parameter status: launch candidates versus structural rulings (founder ruling, 2026-08-14)](gates/parameter-status-launch-candidates-versus-structural-rulings-founder-ruling-2026-08-14.md) | 0 | 0 |
| [Consolidated founder addendum and batch 2 gate closure (2026-08-14)](gates/consolidated-founder-addendum-and-batch-2-gate-closure-2026-08-14.md) | 2 | 5 |
| [FREEZE gate closure (2026-08-14)](gates/freeze-gate-closure-2026-08-14.md) | 4 | 17 |
| [Unsigned ADR audit (2026-08-18)](gates/unsigned-adr-audit-2026-08-18.md) | 0 | 0 |
