# Merit Futures: Session Brain

**Constitution:** [MERIT_BUILD_MASTER_PROMPT.md](MERIT_BUILD_MASTER_PROMPT.md) (read-only; amendments via docs/DECISIONS.md). Read it in full once; re-read the section governing your current task.

## Start ritual (every session, no exceptions)
1. Read this file, then [docs/STATE.md](docs/STATE.md), then the tail (last 2 entries) of [docs/SESSION_LOG.md](docs/SESSION_LOG.md), then the active module plan if any.
2. State back the session objective in one sentence; get confirmation.
3. One objective per session. End ritual: commit clean, append SESSION_LOG entry (done / next / blockers / landmines / files touched), update STATE.md.

## Current phase
**Planning corpus generation (pre-FREEZE). Zero application code until STATE.md says FROZEN.**
Wave 1 (research/) is approved. Wave 2 (docs/architecture/) is in progress. See STATE.md for the gate and next actions.

## Conventions (binding)
- Deliverables are documents until FREEZE. Docs are the single source of truth.
- Every doc carries frontmatter: `status: draft | review | approved | frozen`, `depends_on:`, `last_updated:`.
- [docs/INDEX.md](docs/INDEX.md) is regenerated whenever any doc is added or changes status. If a thing is not in INDEX.md, it does not exist.
- Money is integer cents; thresholds in basis points / integer cents. No floats in financial paths (applies to all doc examples too).
- Timestamps UTC in storage; trading day follows the exchange session calendar (CT), maintained as data.
- Avoid em-dashes in all Merit prose, site and docs (Appendix F).
- When the constitution is ambiguous, ASK. When it is silent, propose an ADR in docs/DECISIONS.md and proceed on approval.

## Working agreements (from section 9, applicable pre-FREEZE)
- Plan before content: waves advance only through founder-approved gates.
- Small conventional commits referencing the constitution section or doc.
- Never weaken a gate to pass it; every discovered gap becomes a docs/EDGE_CASES.md entry.

## Session-length regime (ADR-003)
- **Money paths** (rules-engine, payout, ledger, auth): one objective per session, fresh session per slice, `/clear` between unrelated tasks. Context poisoning on these diffs is catastrophic.
- **Non-money work** (marketing site, docs, fixtures, seed data): longer compounding sessions are permitted.

## Model preferences
Default: sonnet (routine drafting on approved outlines)
Escalate to fable-5 for: rules-engine design and edge-case enumeration; schema/API contract docs;
  security architecture; module plan docs for M1/M2/M5/M7; Phase-0 synthesis; B4 scenario invention
Opus 4.8 @ xhigh for: long drafting sessions, deep review passes
Haiku for: changelogs, summaries, bulk mechanical transforms
