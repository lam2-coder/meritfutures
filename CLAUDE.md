# Merit Futures: Session Brain

**Constitution:** [MERIT_BUILD_MASTER_PROMPT.md](MERIT_BUILD_MASTER_PROMPT.md) (read-only; amendments via docs/decisions/). Read it in full once; re-read the section governing your current task.

## Git workflow (POST-FREEZE, from 2026-08-14)

**The corpus is FROZEN. Branch-per-module plus pull-request discipline is now in force** (constitution C7). The corpus-phase single-trunk rule has expired.

**Every code change runs on a branch and lands through a pull request.** Money-path modules (rules engine, payout, ledger, auth) are reviewed line by line by the founder per constitution E2 before merge.

**Session-origin rule** ([ADR-D1](docs/decisions/ADR-D1.md), as amended at the FREEZE gate):

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
2. Read this file, then [docs/STATE.md](docs/STATE.md), then the tail (last 2 files) of [docs/sessions/](docs/sessions/README.md), then the active module plan if any.
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
- When the constitution is ambiguous, ASK. When it is silent, propose an ADR in docs/decisions/ and proceed on approval.

## Working agreements (from section 9, applicable pre-FREEZE)
- Plan before content: waves advance only through founder-approved gates.
- Small conventional commits referencing the constitution section or doc.
- Never weaken a gate to pass it; every discovered gap becomes a docs/edge-cases/ entry.

## Session-length regime (ADR-003)
- **Money paths** (rules-engine, payout, ledger, auth): one objective per session, fresh session per slice, `/clear` between unrelated tasks. Context poisoning on these diffs is catastrophic.
- **Non-money work** (marketing site, docs, fixtures, seed data): longer compounding sessions are permitted.

## Build cadence (post-FREEZE)

**When to start a fresh session**

| Situation | Action |
|---|---|
| Money-path work (migrations, engine, ledger, payout, auth) | **New session every time.** ADR-003, no exceptions |
| The session reports it is low on context | New session, even mid-file-set |
| The objective changes | New session |
| Non-money work (site copy, fixtures, docs) | May compound in one session |

**Read early, merge late.** Migrations are sacred: once merged, never edited, only
superseded (constitution E2). So the founder's E2 line-by-line read happens
**incrementally, as each money-path file lands**, while the reasoning behind it is
still fresh; the **merge happens once**, when the full set exists and is coherent.
Merging file by file locks `0002` before `0010` has had the chance to prove it wrong.

**Report the count honestly.** "I am at 9 of 27" beats 18 thin files that look
complete. A session that runs out of context mid-set says so and stops.

### The build-session prompt is a template, not a new prompt each time

Continuing an in-flight file set needs **one line changed**, not a rewrite:

```
Already written, do not redo: [LIST WHAT LANDED]
Start at [NEXT FILE] and work forward.
```

Objective, branch, conventions, settled rulings and stop condition stay identical
between sessions. Rewriting them invites drift.

### Session sequence

```
Schema-delta build sessions   -> E2-read each money file as it lands
Merge the schema branch once  -> after the read, not during
Planning session: rest of P1  -> scaffold, TradingCalendar, full CI gate inventory
Build sessions for P1
Planning session: P2 engine   -> money path, PLAN MODE, the longest pole
```

## Model preferences (post-FREEZE)

The corpus-phase table routed on document type. Application code routes on **how much
of the work is novel reasoning versus faithful transcription**.

| Work | Level |
|---|---|
| **Planning sessions** (phase plans, engine design, edge-case enumeration) | Highest available. Depth here converts directly into migrations never written. Fable-5 for rules-engine and schema/API contract design, per the corpus-phase instinct |
| **Money-path implementation** (the E2 files, ledger, payout, auth) | High. The reasoning is settled; the **verification** is the work |
| **Non-money implementation** (transcription against an approved plan) | Normal to high. Care and context beat peak reasoning; max thinking mostly costs wall-clock |
| **Deep review passes** (reading across many docs for contradictions) | High |
| **Mechanical transforms** (manifest updates, INDEX regeneration, changelogs, summaries) | Small and fast |

**A caution learned the hard way.** The reconciliation session's three worst errors
(a ledger class that did not exist, a debit account that broke ruled recognition
timing, and a sign written backwards inside the ADR recording the first two) were
**not capability failures**. Each was a failure to check a claim against the primary
source. Escalating the model does not fix that class of error; reading the source
and adding a mechanical assertion does. Prefer a new CI gate over a bigger model
whenever the error is checkable.
