---
status: approved
depends_on: [../CLAUDE.md, decisions/ALLOCATION.md]
last_updated: 2026-08-28
---

# Dispatch protocol

**Every build session dispatched into this repository is handed an objective, a finding, a fence, and a pointer to this file.** What follows is the part that was identical in every dispatch and was therefore being retyped into each one. A dispatch that contradicts this file wins on its own subject and loses everywhere else; if it contradicts this file **without saying so**, that is a defect in the dispatch and reporting it is part of the work.

---

## 1. The start ritual

Read [`CLAUDE.md`](../CLAUDE.md), then [`docs/STATE.md`](STATE.md), then the tail of [`docs/sessions/`](sessions/README.md), then your own reservation row in [`ALLOCATION`](decisions/ALLOCATION.md) if you hold one, then whatever the dispatch names.

**Re-derive the dispatch's premises at their sources before you build on them.** As of this file's last update, **fourteen premises written into a dispatch by the dispatcher have been refuted by the session that checked them**, one of them inside the allocation row the session was reading. **A refuted premise is a finding, not a failure**, and it may change the ruling. Say so plainly and rule on what you find.

## 2. Conventions, binding

- **Avoid em-dashes in all Merit prose** (Appendix F). Use `--` or restructure.
- **Money is integer cents.** No floats in financial paths, including doc examples and fixtures.
- **Every factual claim carries a `file:line` citation to a primary source.** A claim you cannot cite is itself the finding.
- **Any count you report must be derived at the moment of reporting**, never carried forward from a dispatch, a session log or an entry.
- **Derive a line citation LAST**, after the final edit to the file above it. A line number derived before the last edit is a guess. One session shipped three false pointers inside the pull request whose own findings section calls citation drift a defect: it derived them, then edited above them, then ran checks that do not read that file.
- **Commit small and push immediately after each commit.** Keep separable parts in separate commits so a reviewer can take them one at a time.

## 3. Standing refusals

**Never weaken a gate to pass it and never widen a fence to finish. They are the same move.**

- No new `SystemReason` member: [ADR-165](decisions/ADR-165.md) closed that vocabulary.
- No new `SqlExecutorReason` member: [ADR-157](decisions/ADR-157.md) clause 7 closed that one.
- No `pg` import outside the packages admitted to hold one.
- No cast past a key type.
- No ledger account named inside a route module.
- [ADR-157](decisions/ADR-157.md) admits a RANGE term and an `IS NULL` **on the READ path only** and refuses the rest **on evidence**. If a slice wants a scalar aggregate or a substring predicate, **report rather than widen**, and read that entry's evidence before proposing to overturn it.
- **A merged migration is never edited, only superseded** (constitution E2). A constraint moves by `DROP` and re-`ADD` under one name.
- **Changing a frozen or approved document requires an ADR, not a commit.** If your fence does not hold an ADR number, the change is a report.
- **DO NOT SIGN an ADR.** Ship `status: proposed` with an **UNSIGNED** approval line and a `What a founder read adds` block. Merging is not signing and a ruling is not a signature.

## 4. Verification, before the pull request

Run each command **separately**. **`pnpm install` first**, always: a stale `node_modules` produced a false red on a dependency that had landed hours earlier.

| Command | Expected |
|---|---|
| `node scripts/corpus/gates.mjs generate` then `check` | **33 of 33** |
| `node packages/tooling/checks/repo-invariants.mjs` | **16 of 16** unless your slice adds one |
| `pnpm vitest run` | green, against the baseline your dispatch names, **reproduced before a line changes** |
| `pnpm run typecheck` | exit 0 |
| `pnpm run lint`, `pnpm run format:check` | 0, clean. The format glob reads `.ts`, `.tsx`, `.mjs` and `scripts/` |
| `node scripts/corpus/falsify.mjs` | clean |

**NEVER run `pnpm run verify`.** It exceeds 560s and is killed.

**`falsify.mjs` MUTATES THE WORKING TREE.** Never background it, never `git add -A` after it, and confirm `git status` is clean afterwards.

**Read `falsify`'s OUTPUT rather than its exit code.** A formatting sweep once silently blinded its reader while every gate stayed green: a table it parsed went from 36 rows to 13 and another from 1 to 0, because an array literal wrapped across lines and the reader sliced to end-of-line.

**Seed defects and watch them fail.** A guard nobody watched fire is a guard nobody has. Apply each seed to the committed shape, run it, and restore from a copy taken before the seed rather than with `git checkout`; `git status --porcelain` empty after every one. **A seed that fails to fire is the most valuable result you can get** and has twice exposed a control covering less than its own words claimed.

## 5. Measuring the API surface

**`CompositionReport.registered` over a real `compose()` is the only reliable source for which routes exist. A grep over route files has been wrong twice.** `apps/api/test/account-reads.test.ts` shows the idiom. Report both surfaces and, where a port moves, the wiring triple `{ declared, wired, blocked }`.

**Wiring an adapter moves `wired` and `blocked` and leaves `declared` alone. A method is not a port.**

## 6. Local PostgreSQL

```
pg_ctlcluster 16 main start
su postgres -c "env -u PGUSER -u PGDATABASE -u PGHOST psql -c \"CREATE ROLE root SUPERUSER LOGIN PASSWORD 'merit'\""
su postgres -c "env -u PGUSER -u PGDATABASE -u PGHOST psql -c 'CREATE DATABASE merit_ci OWNER root'"
export PGHOST=/var/run/postgresql PGUSER=root PGDATABASE=merit_ci
for f in packages/db/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -f "$f"; done
```

**The `env -u` matters**: `PGUSER` leaks into `su postgres` and causes a peer-authentication failure. Roles are cluster-wide, so drop and recreate the DATABASE and not the roles. Read counts from `pg_tables`, `pg_indexes`, `pg_constraint`, `pg_proc` and `pg_trigger`, **never from a grep**.

**Watch the acceptance cases fire, not only the refusals.** A probe that only ever attempts forbidden things passes against a guard that rejects everything.

## 7. Conditional numbers

A migration number reserved **conditionally** is taken only if the ruling needs one. **If it does not, RETURN IT TO THE POOL UNSPENT and say so in its row.** The pool has absorbed a returned number six times and it is the mechanism rather than the exception: a number returned unspent is cheaper than a number taken to justify the reservation.

## 8. The stop condition

**Open the pull request. DO NOT MERGE IT.**

Report what landed, what you refused and why, what you registered rather than repaired and with whose fence, every count derived at the moment of writing, and **anything you found that was not in the dispatch**.

**If you run low on context mid-set, say "I am at N of M" and stop.** A session that reports nine of twenty-seven honestly beats eighteen thin files that look complete. **If a slice turns out to be blocked, land the measurement and say so**; establishing precisely why something cannot be built is a complete deliverable and has three times been worth more than the build would have been.
