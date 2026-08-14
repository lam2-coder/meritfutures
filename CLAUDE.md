# Merit Futures: Session Brain

**Constitution:** [MERIT_BUILD_MASTER_PROMPT.md](MERIT_BUILD_MASTER_PROMPT.md) (read-only; amendments via docs/DECISIONS.md). Read it in full once; re-read the section governing your current task.

## Git workflow (POST-FREEZE, from 2026-08-14)

**The corpus is FROZEN. Branch-per-module plus pull-request discipline is now in force** (constitution C7). The corpus-phase single-trunk rule has expired.

**Every code change runs on a branch and lands through a pull request.** Money-path modules (rules engine, payout, ledger, auth) are reviewed line by line by the founder per constitution E2 before merge.

**Session-origin rule** ([ADR-D1](docs/DECISIONS.md), as amended at the FREEZE gate):

| Session origin | Workflow |
|---|---|
| **Harness-launched** (web, mobile, any designated-branch instruction) | Run the designated branch. **End mergeable.** The founder merges same day |
| **Local** | Branch, push, open a PR |

Deterministic enforcement lives in [.claude/settings.json](.claude/settings.json), per constitution C10:
- **`SessionStart` -> `git pull --ff-only`**, then echo STATE.md. A session never starts on a stale tree.
- **`Stop` -> `git push origin HEAD`**. A session never ends with unpushed commits.

Both hooks report failure loudly and exit zero rather than blocking, so a network outage cannot wedge a session. If a hook prints a failure, fix it by hand before doing anything else.

**Changing a frozen document requires an ADR, not a commit.**

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
**FROZEN (2026-08-14). The corpus is the specification and application code has begun.**
A behavior not in the corpus is not in scope; a behavior in the corpus is a commitment. The first build session is the **schema-delta reconciliation**: money path, strict ADR-003 regime, fresh context, **plan mode mandatory**.
See [docs/STATE.md](docs/STATE.md) for the post-FREEZE position, the nine surviving items, and the build sequence.

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
