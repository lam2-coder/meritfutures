# Unsigned ADR audit (2026-08-18): the six proposed decisions the build rests on

**This record signs nothing.** It is the evidence for a batch the founder either signs whole or
splits, per [E2](../../../MERIT_BUILD_MASTER_PROMPT.md). Eight ADRs sit at `status: proposed`. Two are
live work from this week and are excluded by design: [ADR-056](../ADR-056.md) and
[ADR-058](../ADR-058.md) both carry `PENDING` approval lines written by the sessions that proposed
them. The remaining six were proposed during the corpus phase and are being built against now:
[001](../ADR-001.md), [006](../ADR-006.md), [007](../ADR-007.md), [008](../ADR-008.md),
[033](../ADR-033.md), [036](../ADR-036.md).

Each was read against the tree rather than against the registry.

---

## The finding, stated first because it outranks the signature question

**Three of the six are already accepted, and have been since 2026-08-13. The premise that
commissioned this audit is false for half its subjects.**

[`m1-gate-closure-2026-08-13.md:20`](m1-gate-closure-2026-08-13.md) closes with the sentence, in the
founder's own gate record: **"ADR-006, ADR-007, and ADR-008 are accepted above."** Each of the three
also carries its own approval line, dated the same day, inside its own file:

| ADR | The line in its own body |
|---|---|
| [ADR-006](../ADR-006.md) | `ADR-006.md:6` **"Founder approval (2026-08-13): ACCEPTED.** Closes the section-10 queue-tech open item." |
| [ADR-007](../ADR-007.md) | `ADR-007.md:6` **"Founder approval (2026-08-13): ACCEPTED.** Closes the section-10 hosting open item." |
| [ADR-008](../ADR-008.md) | `ADR-008.md:6` **"Founder approval (2026-08-13): ACCEPTED.** Closes the section-10 ORM open item." |

**What is stale is the status word in the heading, not the signature.** Line 1 of each file still
reads `status: proposed` while line 6 records the acceptance. The vocabulary is binary and settled:
across the 59 ADR entry files, 51 headings read `status: accepted` and 8 read `status: proposed`.
Three of those eight are contradicted by their own sixth line.

**The contradiction is not confined to the ADR files, and its shape says how it happened.** Four
other documents restate the acceptance, and two of them contradict themselves in the same way, in
the same direction, for the same reason: the sentence written **before** the M1 gate was never
revisited when the gate closed, and only the post-gate summary section was.

| Document | Pre-gate sentence, never updated | Post-gate sentence, correct |
|---|---|---|
| [OVERVIEW](../../architecture/OVERVIEW.md) | `:79` "is **proposed** as ADR-006" | `:303` "Queue: pg-boss, **accepted** (ADR-006). Closes the constitution section 10 queue-tech item" |
| [INFRA](../../architecture/INFRA.md) | `:21` "**Proposed** as ADR-007: Neon plus Railway plus Cloudflare" | `:214` "ADR-007 (hosting) and ADR-008 (ORM): both **ACCEPTED**" |

Two more restate it without hedging, and one of them is application code:

- [`packages/db/src/index.ts:5`](../../../packages/db/src/index.ts) "the one sanctioned data accessor
  (**ADR-008, accepted**, with the wrapper and the ESLint ban part of the acceptance rather than a
  follow-up)."
- [`research/PROP_TECH_LANDSCAPE.md:131`](../../../research/PROP_TECH_LANDSCAPE.md) "Infra only: Neon
  + Railway + Cloudflare, ~$200/month per the **approved** ADR-007 stack."

**So the build is not resting on unsigned decisions for 006, 007 and 008. It is resting on signed
decisions whose registry says otherwise**, which is a different defect with a different remedy. The
signature exists. The record of it does not reach the place a reader looks first.

### Why nobody raised it

**Not age. No gate can see it.** 17 of 17 gates pass on a tree in which three ADR headings contradict
their own bodies. [`CI-06f`](../../../scripts/corpus/gates.mjs) asserts that ADR numbers are unique,
gapless over allocated plus reserved, and that each entry file is named for the heading it declares.
It never reads the status word. Nor does any other check: `grep -n "status: proposed"
scripts/corpus/gates.mjs` returns nothing. [`CI-06b`](../../../scripts/corpus/gates.mjs) validates
frontmatter, and ADR entry files carry their status in a heading rather than in frontmatter, so they
are outside it.

**A status word that no assertion reads is prose, and this corpus has a standing ruling about
prose-carried facts in registries.** [ADR-036](../ADR-036.md) made exactly this argument about the
State column of the allocation table, and [ADR-034](../ADR-034.md)'s remedy was applied to it:
either generate the fact or delete it and point at the source. Eleven instances of that drift were
recorded before the column was deleted ([STATE:1091](../../STATE.md), [STATE:1212](../../STATE.md)).
**This is the twelfth instance of the same class, in the registry those two ADRs were written to
protect, and it went unnoticed for five days because the word sits in a heading rather than a
table cell.**

---

## What the tree says, one row per ADR

| ADR | Accurate against the tree? | Built against | Superseded in practice without an ADR? | Recommendation |
|---|---|---|---|---|
| **[001](../ADR-001.md)** Repo root stands in for `merit/` | **Decision yes, Consequences no.** The root is the skeleton root. The "1:1 map" claim is false for five paths | Structurally by the entire tree; **cited by no file** | **No.** [ADR-043](../ADR-043.md) (accepted) moved all five, but does not name ADR-001 and ADR-001 was never amended | **Sign, with the Consequences line amended** to defer to ADR-043 |
| **[006](../ADR-006.md)** Queue is pg-boss | **Yes.** Nothing contradicts it | 9 files. One is code: `apps/worker/src/index.ts:16`. **No dependency installed** | **No** | **Already signed 2026-08-13. Correct the heading** |
| **[007](../ADR-007.md)** Neon plus Railway plus Cloudflare | **Yes.** Nothing contradicts it | 8 files, plus four `SERVICE` constants and four tests, plus a CI stage that needs a Neon token. **No deploy config exists** | **No** | **Already signed 2026-08-13. Correct the heading** |
| **[008](../ADR-008.md)** ORM is Drizzle | **Yes.** The half that was executable is executed | 19 files, including a custom ESLint rule, a Semgrep rule and the `packages/db` boundary. **No dependency installed** | **No** | **Already signed 2026-08-13. Correct the heading** |
| **[033](../ADR-033.md)** The reviewer subagent is a citation check | **Part 1 yes, part 2 yes, and one sentence is false about itself** | `.claude/agents/reviewer.md`, [INDEX:26](../../INDEX.md) | **Yes, one convention.** The verdict artifact it specifies has never been written, and practice replaced it with dated review-desk records | **Split. Sign part 1; part 2 is still a live question the founder has not answered** |
| **[036](../ADR-036.md)** Migration numbers are allocated | **Decision yes and it is load bearing. Three numbers in its Consequences are stale** | 16 files, including both gates, both falsify scope cases, and a live 37-row table | **No.** Every departure was recorded where it happened | **Sign. Highest-value of the six and the only one that has already caught a collision** |

---

## The evidence, per ADR

### ADR-001: repo root stands in for `merit/`

**The Decision holds and the Consequences line does not.** The decision is "treat the repo root as
`merit/`; the skeleton lives directly at root", and the tree obeys it: `CLAUDE.md`,
`MERIT_BUILD_MASTER_PROMPT.md`, `research/` and `docs/` are all at the repository root, exactly as
[section 0.5](../../../MERIT_BUILD_MASTER_PROMPT.md) draws them one level down.

**Its Consequences line says "All constitution paths map 1:1 with the leading `merit/` dropped." That
is false for five of the skeleton's paths**, and all five moved under one accepted ADR:

| Constitution path | On disk today |
|---|---|
| `docs/SESSION_LOG.md` | absent; [`docs/sessions/`](../../sessions/README.md) |
| `docs/DECISIONS.md` | absent; [`docs/decisions/`](../README.md) |
| `docs/EDGE_CASES.md` | absent; [`docs/edge-cases/`](../../edge-cases/README.md) |
| `docs/architecture/DATA_MODEL.md` | absent; [`docs/architecture/data-model/`](../../architecture/data-model/README.md) |
| `docs/testing/GOLDEN_SCENARIOS.md` | absent; [`docs/testing/golden-scenarios/`](../../testing/golden-scenarios/README.md) |

[ADR-043](../ADR-043.md) (`status: accepted`) rules all five. **It does not cite ADR-001 and ADR-001
carries no amendment pointing at it**, so the two are consistent in fact and disconnected in the
record. Three directories exist that the skeleton does not name at all: `docs/reviews/`,
`docs/decisions/gates/` (which holds this file), and `docs/legal/` is named while
`docs/DELIVERY_PLAN.md` and `docs/GUIDE_BRIEFING.md` are not.

**Nothing cites ADR-001.** Excluding its own file, the registry README and the generated map, the
only reference in the tree is the session-59 stub written today. It is the one ADR of the six whose
signature changes nothing operationally, and it is also the one whose text is wrong.

### ADR-006: queue technology is pg-boss

**Accurate. Nothing in the tree contradicts it and nothing supersedes it.**

**Built against, in nine files, but only one line of code.**
[`apps/worker/src/index.ts:16`](../../../apps/worker/src/index.ts) states "The queue is pg-boss
inside the same Postgres (ADR-006), so the job store participates in the same transactions and the
same PITR as the money data. It arrives with the first job." The doctrine files depend on it more
heavily than the code does: [`INFRA:29`](../../architecture/INFRA.md) rows it as the queue,
[`INFRA:193`](../../architecture/INFRA.md) re-derives it against payout volume,
[`RB-06:33`](../../ops/runbooks/RB-06-restore-from-backup.md) makes "queue state consistent with the
ledger" a numbered restore-drill step **because** the jobs are in the same Postgres, and
[EC-089](../../edge-cases/EC-089.md), [EC-103](../../edge-cases/EC-103.md),
[M10](../../plans/M10-integrations.md) and [M13](../../plans/M13-trader-analytics-journal.md) all
reason from it.

**The dependency is not installed.** `pg-boss` appears zero times in `pnpm-lock.yaml` and in no
`package.json`. That is consistent with the ADR, which says the queue "arrives with the first job",
and it is worth stating plainly: **RB-06's step 3 is a restore drill that cannot be rehearsed yet.**

### ADR-007: hosting is Neon plus Railway plus Cloudflare

**Accurate. Nothing in the tree contradicts it and nothing supersedes it.**

**Built against, and unlike 006 it is load bearing in executable code.** Every one of the four
deployables names its Railway service as an exported constant, and every one has a test that asserts
the name:

| App | Constant | Test |
|---|---|---|
| [`apps/site/src/index.ts:17`](../../../apps/site/src/index.ts) | `SERVICE = 'site'` | `apps/site/test/service.test.ts:6` |
| [`apps/portal/src/index.ts:16`](../../../apps/portal/src/index.ts) | `SERVICE = 'portal-api'` | `apps/portal/test/service.test.ts:6` |
| [`apps/admin/src/index.ts:24`](../../../apps/admin/src/index.ts) | `SERVICE = 'admin'` | `apps/admin/test/service.test.ts:6` |
| [`apps/worker/src/index.ts:59`](../../../apps/worker/src/index.ts) | `SERVICE = 'worker'` | `apps/worker/test/service.test.ts:6` |

**The Neon half reaches CI.** [`vitest.config.ts:89`](../../../vitest.config.ts) defines the
`integration` project as "a Neon branch per run, so this stage cannot run on a fork pull request",
and [`packages/db/test/migrations.integration.test.ts:8`](../../../packages/db/test/migrations.integration.test.ts)
says the same in its own header. **`CI-04`'s entire shape is an ADR-007 consequence**, including the
fork-degradation problem it is holding open. The Cloudflare half reaches the ESLint rule, which bans
`@neondatabase/serverless` outside `packages/db`
([`no-raw-db-client.js:69`](../../../packages/eslint-plugin-merit/rules/no-raw-db-client.js)).

**No deploy configuration exists.** No `railway.*`, no `wrangler.*`, no `vercel.*`, no `fly.toml`, no
`Dockerfile`, no compose file, and no deploy job in the three workflows under `.github/workflows/`.
The hosting decision is fully described and entirely unexercised. **[INFRA](../../architecture/INFRA.md)
sections 38 to 40 name three environments and section 109 promises a sub-one-minute PITR recovery
point. Neither is testable today, and the first thing that will test them is the restore drill, not
a deploy.**

### ADR-008: ORM is Drizzle

**Accurate, and the half of it that could be executed without the dependency has been executed.** The
ADR's own approval line says the `scopedDb(identity)` wrapper and the ESLint ban "are part of the
acceptance, not a follow-up". The ban exists and runs:

- [`packages/eslint-plugin-merit/rules/no-raw-db-client.js:59`](../../../packages/eslint-plugin-merit/rules/no-raw-db-client.js)
  names `drizzle-orm`, `drizzle-kit` and `drizzle-zod` as the banned prefixes, with `:49` recording
  that the match is on a prefix followed by `/`, so `drizzle-orm/node-postgres` is caught and a
  package merely named `drizzle-orm-helpers` is not.
- [`packages/eslint-plugin-merit/test/no-raw-db-client.test.ts`](../../../packages/eslint-plugin-merit/test/no-raw-db-client.test.ts)
  pins both sides, including the `drizzle-orm-helpers` false positive at `:48`.
- [`eslint.config.js:27`](../../../eslint.config.js) attaches it to `apps/**` and `packages/**` with
  `packages/db/**` as the single ignore.
- [`.semgrep/merit.yml:73`](../../../.semgrep/merit.yml) cites ADR-008 by name for the
  string-interpolated-SQL rule: "a single accessor is that the identity scope is applied in one place."

**The wrapper is a type and not an implementation, and the file says so.**
[`packages/db/src/index.ts:17`](../../../packages/db/src/index.ts): "NEITHER THE CLIENT NOR THE
ACCESSOR EXISTS YET, and the scaffold does not invent them. What it fixes is that they will live here
and nowhere else." `ScopedDb` is declared with one member, `identityId`.

**The dependency is not installed.** `drizzle` appears zero times in `pnpm-lock.yaml` and in no
`package.json`. **This is the ADR with the widest citation footprint of the six, 19 files, and the
thing it names has not been added to the tree.** Nothing about that contradicts the ADR. It is worth
the founder seeing before signing, because a decision cited in nineteen places and never once
exercised is a decision whose cost of reversal is now paid in nineteen edits rather than one.

### ADR-033: the reviewer subagent is a citation check

**Part 1 is built and accurate.** [`.claude/agents/reviewer.md`](../../../.claude/agents/reviewer.md)
exists, its system prompt loads GUIDE_BRIEFING and ADR-033 as the ADR specifies, and
[INDEX:26](../../INDEX.md) carries it. **That row is the only `proposed` row in INDEX.md**, which is
itself a useful signal: the index has one open item and this is it.

**Part 2 is accurately reported as NOT implemented, and the tree confirms it.**
[`.claude/settings.json`](../../../.claude/settings.json) carries one `Stop` hook, `git push origin
HEAD 2>&1 || echo 'PUSH FAILED: ...'`, which exits zero on failure exactly as
[CLAUDE.md:22](../../../CLAUDE.md) records. No verdict gate, blocking or otherwise. **The tension the
ADR puts in front of the founder is still open and is the reason this one should be split rather
than batched:** C10 requires a `Stop` gate that blocks, the committed hook set deliberately never
blocks, and the ADR asks for a ruling on what happens when the check itself cannot run. **Signing
ADR-033 as a whole would read as answering that question, and it has not been answered.**

**Superseded in practice, one convention, with no ADR saying so.** The ADR rules that verdicts are
artifacts at `docs/reviews/<item>-verdict.md`, overwritten per item, with four statuses and a PASS
requiring zero UNCITED and zero CONTRADICTED. [`reviewer.md:66`](../../../.claude/agents/reviewer.md)
restates the path. **`docs/reviews/` holds exactly one file and it is not a verdict.** It is
[`2026-08-17-review-desk.md`](../../reviews/2026-08-17-review-desk.md), a dated record of four merged
pull requests, whose own opening says it "carries no frontmatter, appears in no INDEX, and binds
nothing by existing". **Zero files matching `*-verdict.md` exist anywhere in the tree.** The reviewer
is used, five session files reference the desk, and the artifact convention that was ruled for it has
never once been followed. This is small, and it is the one place where practice has quietly replaced
a written ruling.

**One sentence in ADR-033 is false about ADR-033.** [`ADR-033.md:59`](../ADR-033.md): "The ADR
numbering skips 026 to 030 ... **This entry is 031** so the two branches do not collide on a number.
**Both branches append to the end of this file**, so a merge conflict here is expected." The file is
`ADR-033.md`. [STATE:128](../../STATE.md) records the resolution: "The founder assigned at merge, PR
#5's became **ADR-033**." And "this file" was `DECISIONS.md`, which [ADR-043](../ADR-043.md) split
into a directory, so there is no shared file left to conflict in. **Two false clauses in one sentence,
inside the ADR whose entire subject is that a claim which cannot be checked against a primary source
is the finding.** It is a documentation defect and not a decision defect. It should be corrected as
part of any signature, because leaving it is the advertisement ADR-033 warns about.

### ADR-036: migration numbers are allocated, not guessed

**Accurate, fully built, and the only one of the six that has already prevented and recorded a real
collision. If the batch is split, this is the one to sign first.**

Every part of the decision is in the tree and executable:

| The ruling | Where it lives now |
|---|---|
| A second allocation table beside the ADR one | [`ALLOCATION.md:93`](../ALLOCATION.md), "Migration number allocation", now 37 migrations deep |
| `CI-06f`'s assertion verbatim: gapless over allocated **plus reserved** | [`gates.mjs:1079`](../../../scripts/corpus/gates.mjs), `CI-06h`, title "Migration numbers are gapless over allocated plus reserved, and the install job exists" |
| It extends `CI-06h` rather than arriving as a sibling | `CI-06h` is one gate. The runner holds 17 checks and no `CI-06` letter is a second expression of this concept |
| One parser, not two | [`gates.mjs:368`](../../../scripts/corpus/gates.mjs) `allocated(body, heading)`, called at `:765` by `CI-06f` and at `:1118` by `CI-06h` |
| `falsify.mjs` gains two scope cases, one per direction | [`falsify.mjs:1239`](../../../scripts/corpus/falsify.mjs) `CI-06h/reserved` must PASS, [`:1287`](../../../scripts/corpus/falsify.mjs) `CI-06h/unallocated` must FAIL. Both watched: the run reports 19 scope cases holding |

**It has been load bearing at least once.** [`ALLOCATION.md:118`](../ALLOCATION.md) carries a section
titled "`0034` was claimed twice IN THIS TABLE, and twelve gates read it and passed", recording a
real double-claim on the sequence where [E2](../../../MERIT_BUILD_MASTER_PROMPT.md) makes a rename
impossible. **The table is where the collision was found.** [ADR-043](../ADR-043.md) cites ADR-036 as
one of the two reasons the registries were split at all.

**Three numbers in its Consequences line are stale, and every one of them has already been repaired
somewhere else in the corpus.** [`ADR-036.md:29`](../ADR-036.md) states:

| The stale claim | The tree today | Where the repair is already recorded |
|---|---|---|
| "The next free migration number is `0029`" | 37 migrations exist; `0037` is the last row | [`ALLOCATION.md`](../ALLOCATION.md), "The next free number is the one after the last row of this table, and **this file no longer says which it is**." The number was **deleted** under ADR-034's remedy |
| "The runner still holds eleven checks" | 17. `gates.mjs check` reports "17 of 17 gates pass" | [INDEX:117](../../INDEX.md), where the count is a `gate_count` generated span **because that cell stated it by hand and was wrong** |
| The alternatives list rejects a gate named `CI-06k` | `CI-06k` exists and is [ADR-039](../ADR-039.md)'s declared-authority gate | [`ALLOCATION.md`](../ALLOCATION.md): "One letter in this file is already spoken for by something that is not a gate, and it is named here so a reader does not mistake it for a reservation" |

**None of these is a superseding-without-an-ADR case. Each is the corpus catching its own drift and
writing it down at the site of the drift rather than in the ADR.** That is the system working. It
does mean **the ADR text itself has never been amended**, so a reader who reads ADR-036 alone leaves
with three wrong numbers, and the founder should know that before signing the words rather than the
ruling.

---

## Two defects found while reading, neither of which is a signature question

**1. Two ADR rows were sitting inside the gate-closure table.** `ADR-056` and `ADR-057` were appended
to the end of [`docs/decisions/README.md`](../README.md) rather than to the end of the ADR table, so
they rendered as two-cell rows of the three-column "Gate closures" table. `ADR-058`'s row is
correctly placed, so this is sessions 56 and 57 only. **Repaired in this branch.** `CI-06n` checks
that every entry file has a row and that every row resolves; both held, so no gate saw it. **No gate
reads which table a row is in.**

**2. `packages/db/test/migrations.integration.test.ts:16` cites a file that no longer exists.** It
says "CI-06h asserts the same thing against the allocation table **in DECISIONS.md**". The table is in
[`docs/decisions/ALLOCATION.md`](../ALLOCATION.md) since [ADR-043](../ADR-043.md). **Not repaired
here**, because it is outside `docs/` and this session's fence is `docs/`.

---

## What the founder is asked to decide

| # | Item | Recommendation |
|---|---|---|
| **1** | **006, 007, 008** | **Nothing to sign. Correct the record.** Change three headings from `status: proposed` to `status: accepted`, citing `m1-gate-closure-2026-08-13.md:20` and each file's own line 6, and update the two pre-gate sentences at [OVERVIEW:79](../../architecture/OVERVIEW.md) and [INFRA:21](../../architecture/INFRA.md). This is a transcription repair and needs no ruling |
| **2** | **036** | **Sign.** Accurate, fully built, already caught a collision on the unrecoverable registry. Amend the three stale numbers in its Consequences line at the same time, or delete them and point at [ALLOCATION](../ALLOCATION.md), which is ADR-034's own remedy |
| **3** | **001** | **Sign, with the Consequences line amended** to say the map holds except where [ADR-043](../ADR-043.md) moved a registry, and name the five paths. Nothing turns on it either way |
| **4** | **033 part 1** | **Sign the reviewer subagent.** It is built, used, and its stated limits hold. Rule at the same time whether the `<item>-verdict.md` convention stands, since it has produced zero artifacts and practice has replaced it with dated review-desk records. Correct the false "This entry is 031" sentence at `ADR-033.md:59` |
| **5** | **033 part 2** | **Do not sign in this batch.** The blocking `Stop` hook is a live question with a named prerequisite: what happens when the check itself cannot run. Signing the ADR whole would read as answering it |

**Split recommended over a whole-batch signature**, on one distinction: items 1 to 4 are records
catching up with reality, and item 5 is a decision that has not been made.

## The control this recommends instead of care

[CLAUDE.md](../../../CLAUDE.md) states the doctrine: **"Prefer a new CI gate over a bigger model
whenever the error is checkable."** This error is checkable in one line of comparison.

**A gate asserting that an ADR entry file whose body carries a `Founder approval ... ACCEPTED` line
declares `status: accepted` in its heading**, and that a file declaring `status: proposed` carries
either no approval line or a `PENDING` one. Both directions matter: today's defect is
accepted-in-body against proposed-in-heading, and the reverse would be worse. It is the same shape as
[`CI-06q`](../../testing/STRATEGY.md), which already asserts that every dated citation of a founder
ruling resolves to a declared ruling, over the same corpus of files.

**No `CI-06` letter is claimed for it here.** [ADR-034](../ADR-034.md) and [ADR-036](../ADR-036.md)
both rule that a number is claimed in [ALLOCATION](../ALLOCATION.md) before the artifact is written,
and this record is not that artifact. **The next free letter is `r`**, and the session that writes
the gate claims it.
