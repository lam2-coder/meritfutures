# Merit Futures: Session Brain

**Constitution:** [MERIT_BUILD_MASTER_PROMPT.md](MERIT_BUILD_MASTER_PROMPT.md) (read-only; amendments via docs/DECISIONS.md). Read it in full once; re-read the section governing your current task.

## Git workflow (corpus phase): single trunk, push after every commit
**`main` is the only branch and it is the single source of truth.** Corpus sessions commit directly to `main` and push to `origin` immediately after every commit. There are no feature branches and no pull requests during the corpus phase. The reason is a solo operator working across two machines: a commit that exists only in one container or on one laptop is a commit that is about to be lost, and a branch that exists only locally is a merge conflict with a delay fuse.

Deterministic enforcement lives in [.claude/settings.json](.claude/settings.json), per constitution C10 ("hooks are law; CLAUDE.md is advice"):
- **`SessionStart` → `git pull --ff-only`**, then echo STATE.md. A session never starts on a stale tree.
- **`Stop` → `git push origin HEAD`**. A session never ends with unpushed commits.

Both hooks report failure loudly and exit zero rather than blocking, so a network outage cannot wedge a session. That is a deliberate softening, recorded in [DECISIONS.md](docs/DECISIONS.md); if a hook prints a failure, fix it by hand before doing anything else.

**Branch-per-module plus pull-request discipline resumes at FREEZE for application code** (constitution C7). The single trunk is a corpus-phase rule only, and it expires the moment code exists.

## Start ritual (every session, no exceptions)
1. **Pull first.** `git pull --ff-only` (the SessionStart hook does this; verify it ran).
2. Read this file, then [docs/STATE.md](docs/STATE.md), then the tail (last 2 entries) of [docs/SESSION_LOG.md](docs/SESSION_LOG.md), then the active module plan if any.
3. State back the session objective in one sentence; get confirmation.
4. One objective per session.

## Commit ritual (every commit, no exceptions)
**Every commit is followed immediately by `git push origin HEAD`.** Not at the end of the session, not at the end of the task: immediately. A batch of unpushed commits is the failure mode this rule exists to prevent.

## End ritual (every session, no exceptions)
1. Append a SESSION_LOG entry (done / next / blockers / landmines / files touched) and update STATE.md.
2. Commit them.
3. **Verify clean and pushed:** `git status` reports a clean tree and `git log origin/main..HEAD` is empty. The Stop hook pushes, but the verification is yours; a hook that printed a failure into a scrollback nobody read is not a control.

## Current phase
**Planning corpus generation (pre-FREEZE). Zero application code until STATE.md says FROZEN.**
Wave 1 (research/) and Wave 2 (docs/architecture/) are approved. Wave 3 (docs/plans/) batch 1 is approved except M02, which holds at `review` pending the Rithmic vendor call ([ADR-005](docs/DECISIONS.md)). See STATE.md for the gate and next actions.

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
