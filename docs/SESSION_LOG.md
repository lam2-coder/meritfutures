---
status: draft
depends_on: []
last_updated: 2026-08-13
---

# SESSION LOG

Append-only handoff journal (C3 ritual). Newest entry last. Format per entry: done / next / blockers / landmines / files touched. A session that dies mid-task must be recoverable from this log alone.

---

## 2026-08-13 - Session 1: skeleton (section 0.5)
- **Done:** Read the constitution in full. Created the complete section 0.5 folder skeleton with the repo root standing in for `merit/` (constitution already lived at root). All docs stubbed with frontmatter (`status: draft`, `depends_on`, `last_updated`). Tracking trio (INDEX/STATE/SESSION_LOG), living registries (DECISIONS/EDGE_CASES/GLOSSARY), and lean CLAUDE.md written. Committed as initial structure. No Wave 1 content written, per instruction.
- **Next:** Founder reviews skeleton + INDEX.md. On approval, Wave 1 begins with research/PROP_TECH_LANDSCAPE.md.
- **Blockers:** None.
- **Landmines:**
  - The constitution's section 0.5 layout places CLAUDE_CODE_PLAYBOOK.md in `research/`, but Appendix C0 says `docs/CLAUDE_CODE_PLAYBOOK.md`. Followed section 0.5 (it says "nothing lives anywhere else"). If the founder prefers docs/, move it and update INDEX.
  - Runbooks and legal are directories of future files; they carry README.md stubs so git tracks them and INDEX has something to point at.
  - Module plan filenames follow `M0x-<name>.md` zero-padded to keep dependency order sortable.
- **Files touched:** CLAUDE.md; docs/{INDEX,STATE,SESSION_LOG,DECISIONS,EDGE_CASES,GLOSSARY}.md; research/ (7 stubs); docs/architecture/ (7 stubs); docs/plans/M01-M19 (19 stubs); docs/testing/ (3 stubs); docs/ops/runbooks/README.md; docs/design/DESIGN_SYSTEM.md; docs/legal/README.md.

---

## 2026-08-13 - Session 2: Wave 1 research (all 7 docs)
- **Done:** Executed the full Wave 1 research wave. All seven research/ docs written to status: review with real web research (2026-08-13) and inline citations, each committed separately with a conventional message referencing its constitution section. Docs: PROP_TECH_LANDSCAPE (s1, 8+ vendors + matrix + MUST/SHOULD/LATER + schema-impact list), TOP10_FIRMS (s1B, 10 one-pagers + table-stakes + gaps), ADVERSARY_DOSSIER (App A, 9 schemes -> detection signal + golden-test note GT-A1..A9), DATA_CAPABILITIES (B3, 7-platform matrix + ADR-002 SFTP-first + reserved schema fields), SECURITY_LANDSCAPE (D0, June-2025 prop credential-stuffing incident + ASVS 5.0 L2 + API Top-10 + per-endpoint control checklist + D0-1..D0-10), VIBE_FAILURE_POSTMORTEMS (App E, incidents -> VG-1..VG-12 CI gates + hook mapping), CLAUDE_CODE_PLAYBOOK (C0, current practice merged + contradictions flagged). INDEX + STATE updated after each. Four ADRs proposed in DECISIONS (002 ingest path, 003 session-length, 004 playbook location; 001 pre-existing).
- **Next:** Founder review gate on all seven docs + ADRs. Do NOT begin Wave 2 until approved.
- **Blockers:** None. Several OPEN items need a Rithmic vendor call (EOD file formats/cadence, correction semantics, sandbox), front-loaded per s8; captured in DATA_CAPABILITIES s5.
- **Landmines:**
  - Market shift the constitution predates: ProjectX went Topstep-exclusive (Feb 2026), no longer licensable; validates Rithmic-native call. Several top-10 firms now run CQG/dxFeed not Rithmic (TradeDay all-CQG, MFF dual-feed), so the B3 adapter interface matters more than the constitution implies.
  - No hard contradictions found; the only divergences from current Claude Code practice (worktree cap, per-slice resets) are places the constitution is deliberately stricter for money-code safety. Keep the stricter rule.
  - Slopsquatting (VG-12) is arguably a first-tier CI gate given the AI-assisted build method; recommend wiring it in the very first CI setup, not deferring.
  - Web sources are secondary (review sites, help-center summaries). Firm rules change fast; TOP10_FIRMS must be refreshed monthly and rule specifics re-verified against help centers directly before any config is authored.
- **Files touched:** research/ (all 7 docs); docs/{INDEX,STATE,SESSION_LOG,DECISIONS}.md.

---

## 2026-08-13 - Session 3: Wave 1 gate closure + Wave 2 architecture (all 8 docs)
- **Done:** Closed the Wave 1 gate: recorded founder approval of ADR-002 (with the T+1 tradeoff written into the ADR and the vendor-call condition preserved), ADR-003, ADR-004; added ADR-005 (vendor call deferred, ingest specifics provisional); flipped all seven research docs to `status: approved`. Fixed 59 em-dash violations of the Appendix F convention that had slipped into the Wave 1 drafts. Then executed Wave 2 in full: GLOSSARY, OVERVIEW, DATA_MODEL, EVENTS, STATE_MACHINES, API_CONTRACT, SECURITY, INFRA, each committed separately with INDEX and STATE updated as I went. Proposed ADR-006 (pg-boss), ADR-007 (Neon plus Railway plus Cloudflare), ADR-008 (Drizzle). Paused at the Wave 2 gate; Wave 3 not started.
- **Next:** Founder walks OVERVIEW, DATA_MODEL, API_CONTRACT line by line; decides ADR-006/007/008 and the founder-eyes questions at the end of DATA_MODEL and API_CONTRACT. Then Wave 3, M1 first.
- **Blockers:** None. The Rithmic vendor call is deferred by the founder's choice; every dependent specific is listed in STATE.md and flagged in the docs.
- **Landmines:**
  - GLOSSARY now fixes the canonical config field names and comparison operators (bp for ratios, cents for money, `>=` versus `<` per rule). Later docs and the engine must use these names verbatim; changing one is a GLOSSARY edit plus a sweep, not a local rename.
  - `rule_states` is stored per account **per trading day**, not as a single current row. This is a deliberate departure from the constitution's "stored for speed" phrasing and it is what makes the account timeline, the replay comparison, and the evidence pack cheap. Roughly 250 rows per funded account per year.
  - `daily_marks` and `fills` use **supersession, never update**, so what we believed on the day survives alongside what we believe now. This is the mechanism behind the never-claw-back promise (B4 #5).
  - `payout_requests.status` has no `denied` value and no review state. The zero-denial policy is expressed as a schema constraint, and the freeze endpoint requires a cited open flag, which is a deliberate constraint on the founder's own future self under pressure.
  - Consistency arithmetic is specified as integer cross-multiplication (`best_day * 10000 <= max_bp * period_profit`), never division, so there is no float anywhere in the gate.
  - The em-dash convention is easy to violate when drafting fast. Wave 3 should grep for it before each commit.
- **Files touched:** docs/GLOSSARY.md; docs/architecture/{OVERVIEW,DATA_MODEL,EVENTS,STATE_MACHINES,API_CONTRACT,SECURITY,INFRA}.md; docs/{INDEX,STATE,SESSION_LOG,DECISIONS}.md; CLAUDE.md; research/ (status flip plus em-dash fixes).

---

## 2026-08-13 - Session 4: Wave 2 gate closure + Wave 3 M01 (rules engine plan)
- **Done:** Closed the Wave 2 gate. Recorded founder acceptance of ADR-006 (pg-boss), 007 (Neon plus Railway plus Cloudflare), 008 (Drizzle), which closes four constitution section-10 open items. Wrote four new ADRs from the walkthrough: 009 (payout `amount_cents` optional, defaults to maximum eligible), 010 (dual control with both keys founder-held, documented as compromise resistance not insider resistance), 011 (reserve funding weekly-manual plus a same-day top-up trigger on Eligible-Next-7-Days), 012 (admin console on a separate apex domain behind the placeholder `ADMIN_ORIGIN`). Added a gate-closure table recording the confirmations: `promotional_credit` and `currency` reserved, 404 for cross-trader access, settlement published as 2 to 3 business days, `day.closed` full payload, and the Rithmic auto-liquidation setpoint sitting AT the floor. Amended API_CONTRACT, DATA_MODEL, EVENTS, OVERVIEW, INFRA, SECURITY, STATE_MACHINES, and GLOSSARY accordingly and flipped all eight Wave 2 docs to `approved`. Then wrote Wave 3's first and hardest document: [M01-rules-engine.md](plans/M01-rules-engine.md), 1,154 lines, the full B5 ten-section template. Seeded GOLDEN_SCENARIOS (78 numbered scenarios, 62 M1's) and EDGE_CASES (47 entries) from it. Stopped at the review gate as instructed; M01 is `status: review` and no other Wave 3 plan was started.
- **Next:** Founder external review of M01. OQ-1, OQ-2, and OQ-3 in section 10 are blocking and all three decide published marketing copy. On approval, flip M01 to `approved`, fold the ten schema deltas into DATA_MODEL as a reviewed migration, and start M02 in a fresh session.
- **Blockers:** None for drafting. Three founder rulings block M1 approval (OQ-1, OQ-2, OQ-3). D-M2-2 (the platform applies non-trading balance movements between sessions) is now the second-highest-risk vendor assumption in the corpus and is added to STATE's provisional list.
- **Landmines:**
  - **The constitution's stated extraction ceiling of roughly $190 per day is only reproducible under settlement-anchored cadence.** Basis-anchored cadence gives $270 per day on Core EOD, a 40 percent difference in the per-account liability rate. The engine is specified settlement-anchored to match both GLOSSARY and the constitution's own economics, but this is OQ-1 and it is the single highest-leverage number in the plan.
  - **Rapid Daily cannot be published as daily.** A 1 trading day gap counted from settlement, plus the one-in-flight rule (which is a liability control we cannot drop), makes the practical cadence one payout per settlement cycle, roughly every 3 to 4 trading days. This is a marketing-versus-implementation gap of exactly the kind constitution section 0.5 exists to prevent, and it must be settled before any Rapid Daily copy is written.
  - **Rapid Daily's funded gates are simply absent from the constitution.** Drawdown, eval target, win-day count, win-day floor, buffer, and funded minimum days are all unspecified. Appendix A carries proposals marked `RULING NEEDED` rather than quietly inventing them.
  - **Eligibility is not monotone in profit.** Constitution section 5.1's phrasing is imprecise: adding profit to the current best day worsens the consistency ratio and can remove eligibility. The property suite asserts the accurate version and GS-069 is the witness. This is also the most likely source of a public complaint about the engine, so OQ-9 asks for the dilution number to be displayed at all times, not only on failure.
  - **Two anchors, not one.** `payout_anchor_day` (the settled payout's basis day) resets win days and the consistency period so progress earned during the transfer window is kept. `cadence_anchor_day` (its effective day) drives the gap so the liability model holds. Conflating them is a silent 40 percent liability change; they are separate columns for that reason (SD-02).
  - The engine refuses to compute in exactly two situations: a mark whose arithmetic does not close, and a funded account that did not start at `size_cents`. Both refuse for the same reason, and that reason should survive any future refactor: computing anyway produces a confident wrong answer.
  - Context gates (frozen, recon, KYC, in-flight) must never enter the replayed state or its hash, or the nightly self-audit will produce false divergences forever and then get disabled. That is SD-06 and INV-23, and it is not obvious from the approved DATA_MODEL, which has a single `eligible` column.
  - There are ten schema deltas against a now-`approved` DATA_MODEL. They must be folded in as one reviewed migration when M1 is approved, not allowed to accumulate.
- **Files touched:** docs/DECISIONS.md; docs/GLOSSARY.md; docs/architecture/{OVERVIEW,DATA_MODEL,EVENTS,STATE_MACHINES,API_CONTRACT,SECURITY,INFRA}.md; docs/ops/runbooks/README.md; docs/plans/M01-rules-engine.md; docs/testing/GOLDEN_SCENARIOS.md; docs/EDGE_CASES.md; docs/{INDEX,STATE,SESSION_LOG}.md.
