---
status: draft
depends_on:
  [
    ../DELIVERY_PLAN.md,
    M04-trader-portal.md,
    M09-marketing-site.md,
    M12-transparency-platform.md,
    M17-offers-engine.md,
    ../architecture/API_CONTRACT.md,
    ../architecture/OVERVIEW.md,
    ../design/DESIGN_SYSTEM.md,
    ../testing/STRATEGY.md,
    ../decisions/ADR-072.md,
    ../decisions/ADR-073.md,
    ../decisions/ADR-080.md,
    ../decisions/ADR-083.md,
    ../decisions/ADR-084.md,
    ../decisions/ADR-085.md,
    ../decisions/ADR-086.md,
    P1-monorepo-scaffold.md,
    P3-ledger-billing-identity.md,
  ]
last_updated: 2026-08-24
---

# P4 build: the phase whose three preconditions each turn a green gate red on the commit that delivers them

**[P3's build plan](P3-ledger-billing-identity.md) measured [DELIVERY_PLAN section 4](../DELIVERY_PLAN.md)'s
stated contents against the tree and found none of six existing, on one shared precondition named in no
phase's contents. This document runs the identical method on P4, and it runs it over
[fourteen measurements that already exist](../sessions/README.md) rather than measuring from scratch.**

**Measured at `c1acfa7` on 2026-08-24.** Every figure below was re-derived by running the command named
beside it. Two things the fourteen carried did not survive that, and one measurement taken inside this
session was wrong on its first run and is corrected in section 5.4 rather than quietly replaced.

**This document carries no ruling of its own.** Every decision is cited to the entry or the file that took
it, and every ruling it needs is named for the founder in section 10.

---

## 1. The tree, measured

| Measurement | Command | Result |
|---|---|---|
| Gates | `node scripts/corpus/gates.mjs check` | **29 of 29 pass** |
| Tests | `pnpm exec vitest run` | 106 files, **1,526 passed, 1 skipped**. Unmoved since [session 147](../sessions/2026-08-24-session-147.md), which is expected: sessions 157 to 171 wrote logs and signatures, not code |
| `pnpm run verify` | run end to end | **exit 0**, 7 of 7 invariants, `falsify.mjs` clean-and-dirty over all 29 gates, 62 scope and 10 loader cases |
| Migrations | `ls packages/db/migrations/*.sql \| wc -l` | **47** |
| **Tables created across the migration set** | `grep -h '^CREATE TABLE' packages/db/migrations/*.sql \| wc -l` | **111** |
| **Tables transcribed into the ORM** | `grep -c 'pgTable(' packages/db/src/schema.ts` | **7** |
| **Schema deltas rowed, and their disposition** | read every `SD-Mnn-nn` row in [DELTA_MANIFEST](../../packages/db/DELTA_MANIFEST.md) | **100 rows, 98 `landed`.** The two that are not are `SD-M9-04` and `SD-M21-03`, both `reserved` |
| **Routes registered in any deployable** | read [`apps/api/src`](../../apps/api/src/index.ts), two files, 280 lines | **ZERO.** `main()` logs `no routes yet` |
| **What the accessor can do** | read [`scoped-db.ts:131`](../../packages/db/src/scoped-db.ts) | `__brand`, `identityId`, **`rows()`**. No insert, no update, **no transaction** |
| Fixtures | `CI-06/fixture-inventory` | **316 rows, 43 on disk: 43 written, 0 writable, 266 blocked, 7 covered-elsewhere** |
| Catalog | read [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml)'s `catalog:` block | **13 entries.** No `fastify`, no `next`, no `react`, no `@playwright/test`, no `undici`, no `zod` |

---

## 2. The finding no single session could make, verified here rather than taken

**Eight of the fourteen module measurements, running separately in fourteen containers against fourteen
different module plans, wrote the same sentence in different words.**

> [M18](../sessions/2026-08-24-session-167.md) *"schema is finished while nothing reads it"* ·
> [M05](../sessions/2026-08-24-session-159.md) *"the schema is finished while nothing can read it"* ·
> [M19](../sessions/2026-08-24-session-168.md) *"complete and unreachable"* ·
> [M17](../sessions/2026-08-24-session-166.md) *"the schema landed ahead of everything that reads it"* ·
> [M20](../sessions/2026-08-24-session-169.md) *"the one module whose schema is finished and whose code is
> absent"* · [M03](../sessions/2026-08-24-session-157.md) *"its schema is the only complete half of it"* ·
> [M07](../sessions/2026-08-24-session-161.md) *"schema complete and code empty"* ·
> [M06](../sessions/2026-08-24-session-160.md) *"the module's schema arrived without its process"*

**It reproduces, and the aggregate figure is one no single session could have produced because no single
session could see more than its own module:**

| The claim | The command run here | What came back |
|---|---|---|
| The database is finished | every `SD-Mnn-nn` row's disposition | **98 of 100 landed** |
| The application cannot reach it | `pgTable` count against `CREATE TABLE` count | **7 of 111** |
| And could not write to it if it could | the `ScopedDb` interface, read whole | **one method, `rows()`** |
| And has nowhere to serve it from | `apps/api/src`, read whole | **no route, no server** |

**98 of 100 against 7 of 111 is the finding.** It is not a percentage to be averaged with a route count. It
is a **shape**: every artifact a migration can carry is present, and every artifact that needs a process is
absent, across the whole estate at once.

### 2.1 What it means for phasing, which is this document's actual question

**Ten of the fourteen measurements proposed the same first slice, for fourteen different table sets, in one
pair of files.** [M03's `M3-a`](../sessions/2026-08-24-session-157.md),
[M05's `M5-1`](../sessions/2026-08-24-session-159.md), [M06's `B`](../sessions/2026-08-24-session-160.md),
[M07's slice 2](../sessions/2026-08-24-session-161.md), [M08's `M08-1`](../sessions/2026-08-24-session-162.md),
[M13's `M13-c`](../sessions/2026-08-24-session-164.md), [M16's `S1` and `S2`](../sessions/2026-08-24-session-165.md),
[M17's `S2`](../sessions/2026-08-24-session-166.md), [M19's `M19-0`](../sessions/2026-08-24-session-168.md)
and [M20's `M20-a`](../sessions/2026-08-24-session-169.md) are the same slice ten times.

**That is not ten pieces of work. It is one, and no module plan can say so**, which is precisely
[session 157](../sessions/2026-08-24-session-157.md)'s own item 3: *"thirteen other modules are being
measured concurrently and I can see none of their branches."* [`SCOPE_RULES`](../../packages/db/src/scope.ts)
is total over `TableKey` by a `satisfies` clause, so **the transcription is a phase-level artifact rather
than a per-module one.** This is [P3's `pnpm-lock.yaml` lesson](P3-ledger-billing-identity.md) on a file
nobody thinks of as shared, and four separate sessions said so independently in those words.

**Three consequences follow for P4 specifically, and the third is the one that decides the phase order.**

1. **The accessor is READ-ONLY, and P4 is the only phase whose contents are mostly reads.** Every other
   phase's contents need a write: M03 posts, M05 pays, M19 writes a verification row, M06 writes
   `admin_actions`. P4 renders. **So P4 is buildable against the accessor exactly as `ADR-084` left it**,
   and every other phase is not. That is an argument for running P4 sooner rather than later, and it is
   the opposite of what a reader of the aggregate would expect.
2. **P4's transcription is the largest single table set any phase can take**, thirteen tables, and section
   5.4 measures the one thing that makes it harder than it looks.
3. **P4 cannot deliver any of its four stated contents without landing at least one of three artifacts that
   `CI-06` PROBES**, and each one reports ARRIVED while its row still reads waiting. Section 4.

---

## 3. P4's four stated contents, against the tree

[DELIVERY_PLAN section 4](../DELIVERY_PLAN.md) gives P4, at weeks 7 to 8, *"Trader portal, marketing site
with config-rendered plans and rules, the M12 machine and method pages, the stats page rendering 'not yet
meaningful' honestly"*, with the done-condition *"[DESIGN_SYSTEM](../design/DESIGN_SYSTEM.md)'s slop-score
pass green, the parameter-lint green, every disclosure block present, GS-143 and GS-144 failing the build
on a seeded violation"*.

| Stated content | State | What exists, and where |
|---|---|---|
| **The trader portal** | **RENDER FUNCTIONS ONLY, and the schema is 4 of 4 landed** | [`apps/portal`](../../apps/portal/src/index.ts), 12 source files, **2,213 lines**, 12 test files, 82 tests green. Three of eleven screens ([session 158](../sessions/2026-08-24-session-158.md): `SC-M4-02`, `SC-M4-03`, `SC-M4-05` appear in code and the other eight do not). **113 wire fields transcribed with zero drift.** No framework, no server, no fetch: `grep 'fetch(' apps/portal/src` returns nothing |
| **The marketing site, config-rendered** | **RENDER FUNCTIONS ONLY, and the schema is 3 of 4 landed** | [`apps/site`](../../apps/site/src/index.ts), **2,687 lines** over 14 source files: `routes/` (7 pages), `render/`, `catalog/`, `stats/`, `content/`. `SD-M9-01` to `SD-M9-03` landed; **`SD-M9-04` is `reserved` against a migration number `ALLOCATION` records as SPENT under a different name** ([session 157](../sessions/2026-08-24-session-157.md) section 3.3) |
| **The M12 machine** | **NOTHING, and it is the content nobody reads P4 as containing** | [M12 section 3.1](M12-transparency-platform.md) makes *"the machine underneath"* a **nightly statistics run** that WRITES an immutable `published_statistics` row. `grep 'ST-01\|statistic' apps/worker packages/rules-engine/src` returns **nothing**. All four `SD-M12-nn` are landed |
| **The M12 method pages** | **NOTHING, and the endpoint is in no contract** | [M12 section 4](M12-transparency-platform.md) owns `GET /public/methods/:statCode`, marked **NEW, public**. `grep 'public/methods' docs/architecture/API_CONTRACT.md` returns **zero**. `statistic_definitions` is landed |
| **The stats page, "not yet meaningful" honestly** | **THE ONLY CONTENT WITH A BUILT HALF** | [`apps/site/src/stats/published.ts`](../../apps/site/src/stats/published.ts) transcribes `published_statistics` column for column, `routes/stats.ts` renders `PG-M9-05`, and a suppressed row renders as a stated limitation rather than a blank. **What is missing is a row to render**: nothing computes one |

**Three of the four contents are reads and the third is a WRITE.** Reading P4 as "the read phase" is the
error this row exists to refuse: the M12 machine writes into an append-only table, runs inside the nightly
batch, and [M12 section 3.1](M12-transparency-platform.md) makes it **conditional on the replay
self-audit**, which is `CI-09`'s second leg and is *"waiting, 2026-08-20. Artifact: a demo-world seed
script"* ([STRATEGY section 4.1](../testing/STRATEGY.md)).

### 3.1 The done-condition, clause by clause, and none of the four can be evaluated today

| Clause | State |
|---|---|
| **The slop-score pass green** | [DESIGN_SYSTEM section 8](../design/DESIGN_SYSTEM.md) defines `SS-01` to `SS-08` and its first sentence is *"A Playwright pass"*. `grep -rn 'SS-0' --include=*.ts apps packages scripts` returns **zero**, and `@playwright/test` is in no manifest and no catalog entry |
| **The parameter-lint green** | `grep -riE 'parameter.lint' apps packages scripts` returns **zero**. [P1 section 3](P1-monorepo-scaffold.md) already ruled it: tier 3 *"is P4's definition of done"* and *"P1 is not incomplete for lacking the parameter lint"* |
| **Every disclosure block present** | **THE ONE CLAUSE WITH AN IMPLEMENTATION.** [`apps/site/src/render/disclosure.ts:61`](../../apps/site/src/render/disclosure.ts) is `INV-M9-05`'s build check over the disclosure a page model carries, and it refuses an empty body |
| **`GS-143` and `GS-144` failing the build on a seeded violation** | Both are `blocked / no-fixture-format` in [section 39](../testing/golden-scenarios/39-fixture-status-and-blockers.md), and section 5.3 is why that term is the wrong one for these two rows |

**Three of P4's four done-clauses name an artifact that does not exist, and the fourth names two fixture
rows the registry says cannot be written.** That is the same shape as
[P3 section 4.2](P3-ledger-billing-identity.md), where P3's third done-clause named `GS-138` and the
registry rowed it `blocked / vendor-call`. **Here it is three clauses of four rather than one of four.**

### 3.2 Two P4 contents DELIVERY_PLAN section 4's cell does not list, and both are money path

| Item | Who put it in P4 |
|---|---|
| **Reset pricing** | [DELIVERY_PLAN:147](../DELIVERY_PLAN.md), in the deferrals table, not in the phase cell: *"M17's experiments, bundles, and promotional credit"* are post-launch and **"Reset pricing ships in P4"**. That is `OF-M17-01`, *"contextual reset pricing, a discount bound to one identity and one breached account"*, marked **Ship** |
| **Auth** | **Nobody, and that is section 4.4** |

**Reset pricing prices a purchase.** Its endpoint is `POST /accounts/:accountId/reset`, which
[API_CONTRACT:290](../architecture/API_CONTRACT.md) owns to **M03** and which
[P3 wave 3](P3-ledger-billing-identity.md) already scheduled. `reset_price_cents` is a first-class
`bigint CHECK (> 0)` at [`0004:151`](../../packages/db/migrations/0004_catalog.sql). **So P4's fifth content
is money path, its route belongs to another phase's module, and no phase cell names it.**

---

## 4. The precondition, and it is three artifacts a gate already probes

**P4's four gaps are not four gaps.** They are one runtime question with three names, and the sharp part is
not that the artifacts are missing. It is that **`CI-06` probes all three, and each probe reports the
artifact ARRIVED on the commit that delivers it, while the row it belongs to still reads waiting.**

| Artifact | Who probes it | The row it turns | What happens on the delivering commit |
|---|---|---|---|
| **a `build` script in any `apps/*/package.json`** | [`gates.mjs:6519`](../../scripts/corpus/gates.mjs), `INVENTORY_PROBES` | `CI-07`, *"Waiting, 2026-08-20"* | `CI-06/gate-inventory` **fails on good news** unless `CI-07`'s `Closure` cell moves in the same commit |
| **`@playwright/test` present in the lockfile** | [`gates.mjs:6533`](../../scripts/corpus/gates.mjs), anchored so `@vitest/browser-playwright` does not trip it | `CI-08`, *"Waiting, 2026-08-20"* | the same, on `CI-08`'s cell |
| **`fastify` present in the lockfile** | [`gates.mjs:6846`](../../scripts/corpus/gates.mjs), `VG_INVENTORY_PROBES`, anchored so `fastify-plugin` does not trip it | **`VG-3` AND `VG-6`**, both *"Waiting, 2026-08-24"* | `CI-06/vg-inventory` fails unless **both** rows move together |

**Every one of P4's stated contents needs at least one of the three.** The portal and the site are two
applications [M04 section 1.1](M04-trader-portal.md) and [M09 section 1.1](M09-marketing-site.md) both
specify as Next.js, which needs a build script. The slop-score pass is Playwright by
[DESIGN_SYSTEM section 8](../design/DESIGN_SYSTEM.md)'s own first sentence. The method-page endpoint needs a
route, and a route needs the framework `ADR-083` ruled and did not install.

**This is [session 146](../sessions/2026-08-24-session-146.md)'s shape, and the corpus has already paid for
it once.** `CI-04` acquired an implemented leg and `VG-3` and `VG-6`'s chains **expired on the same commit**
under [ADR-080](../decisions/ADR-080.md) (d), which is why session 146's fence had to hold
[STRATEGY](../testing/STRATEGY.md) section 4.2 as well as 4.1. Here it happens **three times**, and one of
the three is worse:

### 4.1 `VG-2` and `VG-10` chain on `CI-07`, and they behave differently

[STRATEGY section 4.2](../testing/STRATEGY.md):

- **`VG-2`** no secrets in client output: *"**Chained, 2026-08-22**, on `CI-07`. One leg: its subject is the
  built bundle, which is `CI-07`'s own artifact."* **It expires the moment `CI-07` acquires an implemented
  leg**, by `ADR-080` (d), exactly as `VG-3` and `VG-6` did on `CI-04`.
- **`VG-10`** no world-readable bucket: *"**Chained, 2026-08-22**, on `CI-07`, **AND waiting,
  2026-08-22.** Artifact: a bucket declared in any infrastructure manifest. **Conjunctive**, and the only
  row that is."* **It does NOT expire when `CI-07` lands**, because there is no bucket.

**STRATEGY:203 names this inversion as the one a session is most likely to inherit wrongly**, in its own
words: the legs of a `VG` row are conjunctive where the legs of a section 4.1 row are independent
deliverables. **A P4 session that expires both `VG-2` and `VG-10` because `CI-07` landed has broken the
only conjunctive row in the table.**

### 4.2 So the artifact-bearing slices carry `gates.mjs`, and session 173 already holds it

Each of the three artifacts forces its session to hold [`scripts/corpus/gates.mjs`](../../scripts/corpus/gates.mjs),
because `CI-06/gate-inventory` and `CI-06/vg-inventory` hold a **register of unprobeable conditions** whose
defining property is that *an entry naming no live condition is itself a finding*. **Session 173 is CLAIMED
and its fence is `scripts/corpus/gates.mjs`, `scripts/corpus/falsify.mjs` and STRATEGY section 4.4's row.**
Section 9 orders against it rather than discovering it.

### 4.3 No ADR rules a UI technology, and `ADR-083` is the one that looks like it does

`grep -l 'Next.js\|React' docs/decisions/*.md` returns **one file**, [ADR-083](../decisions/ADR-083.md), and
its only occurrence is a **rejected alternative**: *"Next.js API routes, or any full-stack framework serving
the API beside a UI ... it puts the API back inside a UI deployable and reinstates the back door."* **That
refuses Next.js for the API and rules nothing about the portal or the site.**

[`apps/portal/src/index.ts`](../../apps/portal/src/index.ts) states the gap at the point of declaration and
declines to close it: *"THERE IS NO FRAMEWORK HERE YET EITHER ... admitting one is a `VG-12` dependency
decision plus a root lockfile change, which belongs to P1's scaffold rather than to a read-surface
session."* [Session 158](../sessions/2026-08-24-session-158.md) put the same question first in its own
undetermined list. **It is P4's, because P4 is the phase whose contents are the two applications.**

### 4.4 Auth is in no phase's contents, and P4's first stated content cannot be reached without it

**This is [P3 section 3](P3-ledger-billing-identity.md)'s finding recurring one layer up, and it is the
sharpest thing in this document.**

| Fact | Evidence |
|---|---|
| The **contract** specifies seven auth endpoint headings | [API_CONTRACT:80](../architecture/API_CONTRACT.md) onward: `POST /auth/otp`, `/auth/verify`, `/auth/elevate`, the two passkey ceremonies, `/auth/logout`, `GET /me` |
| The **schema** is landed | `SD-M4-04` at [`0029:565`](../../packages/db/migrations/0029_phone_identity_and_auth.sql): `auth_factor`, `elevated_at`, `elevated_by_factor`, plus `sessions_elevation_is_complete` |
| The **code** is zero | `grep -rliE 'passkey\|webauthn\|otp\|elevat' --include=*.ts apps packages` returns five files and **not one is an implementation**: they are the portal's own fence assertions banning `otp`, `passkey` and `elevat` from its exported surface, and the impersonation banner |
| **No phase's contents name it** | `grep -niE 'passkey\|OTP\|authentication\|login' docs/DELIVERY_PLAN.md` returns four lines, none of them in section 4's phase table. P1 is scaffold and schema, P2 the engine, P3 ledger and billing and **KYC**, P4 portal and site, P5 payouts, P6 live, P7 risk, P8 hardening, P9 beta |

**KYC is not auth.** [M19](M19-kyc-identity.md) verifies who a human is; `SC-M4-01` and `SC-M4-11` log them
in and elevate them. **`SC-M4-01` is one of M04's eleven screens**, so "trader portal" contains it by
DELIVERY_PLAN's own wording, and **it is money path** under [CLAUDE.md](../../CLAUDE.md)'s regime table,
which names `auth` as one of the four `E2` classes.

**So P4's first stated content contains two money-path screens whose subject appears in no phase's contents
at all.** [P3 section 3](P3-ledger-billing-identity.md) declined to rewrite DELIVERY_PLAN on
[session 136](../sessions/2026-08-22-session-136.md)'s precedent that *"its definition of done is not a
session's to rewrite"*, and the same restraint is taken here: section 10 puts it to the founder.

---

## 5. Four claims checked against their sources, and one of the fourteen did not survive

**This is the section [CLAUDE.md](../../CLAUDE.md) asks for**, on its own statement that the reconciliation
session's worst errors *"were not capability failures. Each was a failure to check a claim against the
primary source."* The brief asked that any disagreement among the fourteen be **named rather than
averaged**, and there is one.

### 5.1 THE DISAGREEMENT: three sessions read one file and one of them read it wrong

**[Session 160](../sessions/2026-08-24-session-160.md) marks M06's enforcement slice `H` BLOCKED**, with the
blocker stated in its own landmine heading: *"THE RESTORE HAS NO EVENT AND THAT IS WHAT BLOCKS THE
ENFORCEMENT SLICE, NOT THE ENFORCEMENT ... `identity.restricted` has no counterpart in
[EVENTS](../architecture/EVENTS.md)."*

**[Session 162](../sessions/2026-08-24-session-162.md) measured the same file and found the opposite**, and
made it a landmine of its own: *"THE ONE THING M08 SAYS IS MISSING IS THE ONE THING THAT ARRIVED.
**[EVENTS:52](../architecture/EVENTS.md) now carries `identity.restriction_lifted`**."*
**[Session 165](../sessions/2026-08-24-session-165.md) found it a third time**, in section 11's trigger
table with an *"always send"* guard.

**Run here rather than adjudicated by majority:**

```
grep -n 'identity.restriction_lifted' docs/architecture/EVENTS.md
```

returns **three lines**. [`EVENTS:52`](../architecture/EVENTS.md) is the catalogue row,
`identity.restriction_lifted` **NEW**, payload
`{ identity_id, restriction_episode_id, restored_by, restore_evidence, restored_at }`, fanout
`FEED, MAIL, NOTIF, EVID, ALERT`. `EVENTS:319` is the section 11 trigger row. And
**[`EVENTS:68`](../architecture/EVENTS.md) names M06 by name as one of the three consumers the event was
written for**: *"the hold half of three consumers worked while the release half did not: M02 could not
re-enable trading, **M06 could not put the restore on the feed**, and M08 could not release a held
statement."* `git log -S` puts it on `main` at `84b8739`, **before all fourteen sessions opened.**

**So session 160's slice `H` is blocked on a condition that was already discharged, by a row that names M06
as the reason it was written.** Slice `H`'s remaining dependencies are its own `A`, `B` and `C`. **This is
not an averaging case and it is not a tie**: one reading reproduces at `file:line` and the other does not.

**What makes it worth a section rather than a correction.** All three sessions were fenced identically, ran
the same class of grep, and read a `docs/architecture/` file none of them owned. **The one that got it
wrong is the one whose own slice the answer blocks**, which is the direction in which a wrong absence is
most expensive: an absence is the claim a wider grep refutes, and the session with the strongest reason to
run the wider grep is the one that did not.

### 5.2 A second apparent disagreement that is NOT one, and saying so matters

`CI-04` reads three different ways across the fourteen and **all three are consistent**:
[session 161](../sessions/2026-08-24-session-161.md) calls its database leg *"still waiting"*,
[session 166](../sessions/2026-08-24-session-166.md) says *"`CI-04` RUNS NOW"*, and
[session 169](../sessions/2026-08-24-session-169.md) says *"`CI-04` HAS NO DATABASE"*. Measured here:
[`ci.yml:476`](../../.github/workflows/ci.yml) declares job `integration` on bare `ubuntu-latest` with
**no `services:` block**, and it runs `vitest run --project integration`. The `integration` project matches
**one file**, [`migrations.integration.test.ts`](../../packages/db/test/migrations.integration.test.ts),
whose assertions are about migration numbering and open no connection.

**The subject runs, the artifact does not exist, and no database is reached.** Three true sentences about
one row, which is [session 143](../sessions/2026-08-23-session-143.md)'s own *"`CI-04` is three facts"*
holding after `ADR-085` moved one of them. **Reporting it as a disagreement would be the error**; the
fourteen agree and their framings differ.

### 5.3 `GS-143` and `GS-144` are blocked under a term their own assertions refute

**Both are P4's done-condition and both are rowed with 264 other scenarios under one cause.**
[Section 39](../testing/golden-scenarios/39-fixture-status-and-blockers.md) rows them
`blocked / no-fixture-format`, whose reason text is the corpus-wide one: *"the only fixture format in the
tree is M1's day stream folded through `advanceDay`."*

**Read the assertions.** [Section 16](../testing/golden-scenarios/16-gs-142-to-gs-148-marketing-site-m9.md):
`GS-143` is *"MDX content containing a bare parameter value. **The build fails.**"* `GS-144` is *"A published
statistic rendered without its trailing window. **The build fails**, including on the OG image path."*

**Neither is a fixture in any format.** [ADR-072](../decisions/ADR-072.md) makes `no-fixture-format` a **W2**
term, a statement about what a fixture format can express; W1 is *"the code the assertion runs against
exists and is reachable from the loader"*, and the W1 term `outside-loader-boundary` requires the code to
**exist**. **The subject of these two rows is a build, and there is no build.** No fixture-format ruling of
any shape discharges them, because their subject is a compiler refusal rather than a day stream.

**So of the 266 blocked rows, these two are the ones a fixture-format ruling cannot clear**, and they are
two of P4's four done-clauses. **This is [session 167](../sessions/2026-08-24-session-167.md)'s `GS-240`
finding arriving on P4's own definition of done**: a row blocked under a term its own assertion refutes,
where checking the row was cheaper than clearing the blocker. **Whether the term moves is
[section 39](../testing/golden-scenarios/39-fixture-status-and-blockers.md)'s and an ADR's, and it is not
taken here.**

**All 42 golden scenarios P4's four modules own are `blocked / no-fixture-format`**, counted row by row:
M4 15, M9 9, M12 10, M17 8. **Zero writable.**

### 5.4 A measurement taken in this session was wrong on its first run, and the correction changes a slice

**The first measurement of column drift over P4's tables used a single-line grep and reported that every
one of them was clean.** `ALTER TABLE` statements in this migration set span lines, so the grep matched
almost nothing. Re-run with the **same algorithm the drift assertion itself uses**
([`scoped-db.test.ts:421`](../../packages/db/test/scoped-db.test.ts), a multiline `ALTER TABLE ... ;` match
with `ADD CONSTRAINT` exempted), twelve tables in the estate carry a later column change and **three of them
are P4's**:

| Table | Later column changes |
|---|---|
| **`plan_versions`** | [`0044`](../../packages/db/migrations/0044_fee_back_and_ladder_unlock.sql) `fee_back_repeats`; [`0045`](../../packages/db/migrations/0045_simulation_runs.sql) `decided_on_simulation_run_id`, `simulation_waiver_reason` |
| **`rule_states`** | [`0035`](../../packages/db/migrations/0035_rule_states_calendar_revision.sql) `calendar_revision_id` |
| **`sessions`** | [`0029`](../../packages/db/migrations/0029_phone_identity_and_auth.sql) `auth_factor`, `elevated_at`, `elevated_by_factor` |

**`plan_versions` is the table P4's second stated content renders from.** The site's config-rendered plans
and rules pages read it, and it is the most-drifted table in the phase.

**This is why the correction matters rather than being tidy-up.**
[Session 165](../sessions/2026-08-24-session-165.md) found this defect on M16's tables and made it the
reason its `S1` and `S2` were two slices rather than one: the drift assertion *"is re-derived every run"*
and *"a session adding all four tables at once turns the suite red in the assertion whose entire purpose is
to fail loudly."* It assigned the ruling to its own `S2`. **The ruling is P4's**, because `plan_versions` is
P4's central read and M16 is not scheduled before P4 in any phase. Section 8's `P4-a` carries it.

**The correction is recorded rather than replaced** because the class of error is the one the corpus keeps
paying for: an absence measured with a needle narrower than its subject. The wider measurement is what
refuted it, inside this session rather than after it.

---

## 6. What P4 is NOT

**Stated, because a phase whose neighbours are all blocked on the same aggregate finding will attract work
that belongs elsewhere.**

| Not P4's | Whose it is, and why |
|---|---|
| **The WRITE accessor** | `ScopedDb` gains insert, update or a transaction for the phase whose contents need one. **P4's contents do not**, with the single exception of the M12 machine, which writes through the nightly batch rather than through a request. [M19's `M19-0`](../sessions/2026-08-24-session-168.md) names it, and `ADR-086` section 6.1 already states three shapes for the executor and **rules none of them** |
| **The estate-wide transcription** | P4 transcribes **its own thirteen tables**. The other 91 belong to the phases that read them, and **who owns `schema.ts` across phases is a ruling nobody has taken**. Section 10 |
| **The fixture format** | **266 blocked rows, one cause, and P4 owns 42 of them.** [WAVE-04](WAVE-04-fixture-backlog-and-gate-inventory.md) and [WAVE-05](WAVE-05-tier2-fixture-shapes.md) hold this territory. A P4 slice claiming a `GS-nnn` in its done-clause is claiming something the registry says cannot be written |
| **Auth** | It is money path, it is in no phase's contents, and **inventing a phase for it is not a plan's to do**. Section 4.4 and section 10 |
| **The payout centre and the wallet screens** | `SC-M4-04` and `SC-M4-10` are M04's screens and **P5's contents**: DELIVERY_PLAN gives P5 *"M20 wallet and the two-leg payout"*. P4 builds the read screens; these two read a surface P5 creates |
| **`POST /accounts/:accountId/reset`** | The **route** is M03's and [P3 wave 3](P3-ledger-billing-identity.md) scheduled it. What is P4's is the **pricing**, section 3.2 |
| **The queue's executor** | [Session 147](../sessions/2026-08-24-session-147.md) measured it and `ADR-086` left it open. `packages/queue` needs a `JobTransaction` and `@merit/db`'s eight value exports contain nothing that yields one; the only implementations in the tree are the queue's own test fakes. **P4 needs no queue** |
| **The pg-boss job store migration** | Owed and unwritten, by `ADR-086`'s own `migrate: false` refusal. Not P4's, and named so it is not lost |

---

## 7. The registries this plan CANNOT spend, and that is a finding rather than an omission

**[Session 143](../sessions/2026-08-23-session-143.md) allocated seven rows in its first commit, *"before
anything else was written"*, and its fence included [`ALLOCATION.md`](../decisions/ALLOCATION.md). This
session's fence does not.**

So **every slice in section 8 names its ADR and its migration by POSITION and never by number.** Measured
for whoever dispatches them: `ALLOCATION`'s ADR table ends at **`089`** and its migration table ends at
**`0047`**, both landed, so the lowest free numbers are **`ADR-090`** and **`0048`**. **They are not claimed
here.**

**This is [session 157](../sessions/2026-08-24-session-157.md)'s item 1 arriving at the planning session
that inherits it**, and it is the same class as [P3 section 4.4](P3-ledger-billing-identity.md), where the
dispatching fence excluded `docs/INDEX.md` and a new plan document with no INDEX row is a `CI-06c` finding.
**Here the fence DOES include `docs/INDEX.md`**, so that lesson was collected. The registry it excludes is
`ALLOCATION`, and the honest consequence is stated rather than reached past: **a session dispatched from
this document allocates first, in one commit, before it runs.**

**Session numbers.** `173` to `177` are **already CLAIMED and dispatched by
[session 171](../sessions/2026-08-24-session-171.md)**, so the lowest free session number is **`178`**. Two
of the five collide with slices below and section 9 names both.

---

## 8. The wave

**Fences are by file, and every fence was checked against every other and against the five sessions already
in flight.** Two lessons are applied literally:

- **A session fenced out of the file that validates its change cannot end green** (section 4.2).
- **A depends-on column reads per item and collisions are per file.** Section 9 is the per-file table and it
  is the one to read; this one is the per-slice summary.

### Wave 1: the preconditions. Four sessions, and three of the four are SERIAL

**None of these four is P4's subject and P4 cannot start on any stated content without all four.**

| # | Slice | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **`P4-a`** | **The drift ruling, and the three P4 tables that need it.** How an `ADR-084` transcription reads a table whose column set is a `CREATE TABLE` plus later `ADD COLUMN`s, then `plan_versions`, `rule_states` and `sessions` enter `schema.ts` and `scope.ts` under it | `packages/db/src/schema.ts`, `packages/db/src/scope.ts`, `packages/db/test/scoped-db.test.ts`, `docs/decisions/ADR-0NN.md` (new), `ALLOCATION` (its row), `INDEX` (its row), `STATE` (append), `sessions/` | **YES.** A scope rule is where "forgot to scope" stops being available, and `SCOPE_RULES` is the tenancy registry ([session 159](../sessions/2026-08-24-session-159.md)'s reasoning, adopted) | nothing. **145 landed.** It goes FIRST |
| **`P4-b`** | **The other ten P4 read tables enter the transcription**: `plan_version_sizes`, `content_documents`, `page_revalidations`, `statistic_definitions`, `published_statistics`, `proof_links`, `review_requests`, `certificates`, `daily_marks`, `purchases`. **All ten measured clean of later column changes**, so no ruling is needed | `packages/db/src/schema.ts`, `packages/db/src/scope.ts`, `packages/db/test/scoped-db.test.ts`, `STATE` (append), `sessions/` | **YES**, same reason | **`P4-a`** via `schema.ts` and `scope.ts`. **Strictly serial with it** |
| **`P4-c`** | **The UI framework is RULED, and `CI-07`'s cell plus `VG-2`'s chain move in the same commit.** `ADR-083` rules the API's runtime and nothing about a UI; M04 and M09 both name Next.js and the workspace holds none | `docs/decisions/ADR-0NN.md` (new), `pnpm-workspace.yaml` (`catalog:` only), `pnpm-lock.yaml`, `apps/portal/package.json`, `apps/site/package.json`, `docs/testing/STRATEGY.md` (**section 4.1's `CI-07` row and section 4.2's `VG-2` row only**), `scripts/corpus/gates.mjs` (the inventory register only), `scripts/corpus/falsify.mjs`, `ALLOCATION` (its row), `INDEX` (its row), `STATE` (append), `sessions/` | no | **173** via `gates.mjs` and `falsify.mjs` |
| **`P4-d`** | **Fastify enters the catalog and `apps/api` gets a route registry**, and `VG-3` and `VG-6` are re-disposed together. **Four measurements proposed this same slice** ([M03's `M3-c`](../sessions/2026-08-24-session-157.md), [M06's `A`](../sessions/2026-08-24-session-160.md), [M16's `S4`](../sessions/2026-08-24-session-165.md), [M19's `M19-1`](../sessions/2026-08-24-session-168.md)) | `pnpm-workspace.yaml` (`catalog:` only), `pnpm-lock.yaml`, `apps/api/package.json`, `apps/api/src/**`, `apps/api/test/**`, `docs/testing/STRATEGY.md` (**section 4.2's `VG-3` and `VG-6` rows only**), `scripts/corpus/gates.mjs` (the `VG` register only), `ALLOCATION` (its row), `INDEX` (its row), `STATE` (append), `sessions/` | no by content, and **high consequence**: the registry's SHAPE decides whether [M19's seven route slices](../sessions/2026-08-24-session-168.md) serialize | **`P4-c`** via `pnpm-lock.yaml`; **173** via `gates.mjs`; **176** via `apps/api/**` |

**Wave 1 is SERIAL on `pnpm-lock.yaml` for `P4-c` and `P4-d`, and on `schema.ts` for `P4-a` and `P4-b`.**
This is [P3 wave 1](P3-ledger-billing-identity.md)'s finding on two files instead of one: four concurrent
branches would each merge cleanly alone and none of them together. **`P4-a`/`P4-b` and `P4-c`/`P4-d` share
no file with each other**, so the two pairs may run concurrently as pairs.

**`P4-c` must state what it does to `VG-10` and must NOT expire it.** Section 4.1: `VG-10` is the only
conjunctive row in the table, and `CI-07` landing satisfies one of its two legs.

### Wave 2: P4's stated contents. Four sessions

| # | Slice | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **`P4-e`** | **The site's ports get an adapter**, so `SitePorts`' four read ports resolve against `systemDb` and the config-rendered plans and rules pages render real rows. `INV-M9-05`'s disclosure check already refuses a page without one | `apps/site/src/catalog/adapter.ts` (new), `apps/site/src/index.ts`, `apps/site/package.json`, `apps/site/test/**`, `STATE` (append), `sessions/` | no. It reads a published config and holds no session | **`P4-a`**, **`P4-b`** via `packages/db/src/**` |
| **`P4-f`** | **M12's method pages exist as a contract row and then as a route.** `GET /public/methods/:statCode` enters [API_CONTRACT](../architecture/API_CONTRACT.md) and `apps/api` serves it. **API_CONTRACT is `approved`, so the contract half is an ADR and not a commit** | `docs/decisions/ADR-0NN.md` (new), `docs/architecture/API_CONTRACT.md`, `apps/api/src/routes/public-methods.ts` (new), `apps/api/src/routes/index.ts`, `apps/api/test/**`, `ALLOCATION` (its row), `INDEX` (its row), `STATE` (append), `sessions/` | no. A public read of a versioned definition | **`P4-d`** via `apps/api/src/routes/index.ts`; **`P4-b`** via `statistic_definitions` |
| **`P4-g`** | **The M12 machine: the nightly statistics run.** Reads authoritative closed-session tables, computes each registered definition, writes one immutable `published_statistics` row per window, never overwrites. **`input_digest` is the reproduction claim and it needs a producer** | `apps/worker/src/batch/statistics.ts` (new), `apps/worker/src/batch/ports.ts`, `apps/worker/src/batch/nightly.ts`, `apps/worker/test/statistics.test.ts` (new), `docs/ops/runbooks/CRON_INVENTORY.md`, `STATE` (append), `sessions/` | **YES.** [INV-M12-01](M12-transparency-platform.md) binds it to closed-session authoritative data, `ST-03` and `ST-04` publish **money on a public surface**, and `ADR-031` already ruled that surface `bigint` with a unit rather than `numeric` | **`P4-b`**; **`CI-09`'s replay self-audit leg**, which is *"waiting"* on a demo-world seed script; and [session 164's `M13-e`](../sessions/2026-08-24-session-164.md) via `ports.ts` |
| **`P4-h`** | **The portal's remaining READ screens and the contract rows they have no shape for**: `SC-M4-05` rules, `SC-M4-06` purchases and the rule diff, `SC-M4-07` KYC status, `SC-M4-08` certificates, `SC-M4-09` referrals. Plus [session 158](../sessions/2026-08-24-session-158.md)'s `required_factor`, `EconomicCalendarPanelResponse` and `ImpersonationSession`, none of which has a contract row | `docs/decisions/ADR-0NN.md` (new), `docs/architecture/API_CONTRACT.md`, `apps/portal/src/api/types.ts`, `apps/portal/src/view/**`, `apps/portal/src/index.ts`, `apps/portal/test/**`, `ALLOCATION` (its row), `INDEX` (its row), `STATE` (append), `sessions/` | no. **`SC-M4-04`, `SC-M4-10`, `SC-M4-01` and `SC-M4-11` are deliberately NOT in it**, and section 6 says whose they are | **`P4-c`** via `apps/portal/package.json`; **176** via `apps/portal/**`; **`P4-f`** via `API_CONTRACT` |

### Wave 3: the done-condition. Two sessions, and one of them cannot end green

| # | Slice | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **`P4-i`** | **The slop-score pass, `SS-01` to `SS-08`, and `CI-08`'s cell moves with it.** Playwright enters the catalog; the pass renders each page at 375px and 1280px in light and dark; `M4-F-01` is its identifier | `pnpm-workspace.yaml` (`catalog:` only), `pnpm-lock.yaml`, `apps/portal/e2e/**` (new), `apps/site/e2e/**` (new), `.github/workflows/ci.yml`, `docs/testing/STRATEGY.md` (**section 4.1's `CI-08` row only**), `scripts/corpus/gates.mjs` (the inventory register only), `scripts/corpus/falsify.mjs`, `STATE` (append), `sessions/` | no | **`P4-c`** via `pnpm-lock.yaml`; **`P4-e`**, **`P4-h`** for pages to render; **173** via `gates.mjs` |
| **`P4-j`** | **The parameter lint, `GS-143` and `GS-144`.** [P1 section 3](P1-monorepo-scaffold.md) tier 3: MDX carrying a bare parameter value fails the build, and a published statistic without its trailing window fails it including on the OG image path | `apps/site/**` (the MDX pipeline and its lint), `.github/workflows/ci.yml`, `docs/testing/golden-scenarios/39-fixture-status-and-blockers.md` (**`GS-143` and `GS-144`'s rows only**), `docs/decisions/ADR-0NN.md` (new, **required**: the blocker term moves), `ALLOCATION` (its row), `INDEX` (its row), `STATE` (append), `sessions/` | no | **`P4-c`** for a build to fail; **`P4-e`** for a page. **Section 5.3 is its ruling and it must not invent one** |

### Wave 4: the two money-path contents nobody put in a phase cell. NOT DISPATCHED

**Auth (`SC-M4-01`, `SC-M4-11`) and reset pricing are named here so they are not lost, and no slice is
written for either.** Both are money path, `ADR-003` strict, `E2`. **Auth is in no phase's contents at all**
and a plan does not get to put it in one; **reset pricing's route is M03's** and its floor
[cannot be dual-controlled as written](../sessions/2026-08-24-session-166.md): `price_floors`' primary key
is `(product_ref, effective_from)` at [`0024:94`](../../packages/db/migrations/0024_offers.sql) and
`dual_control_approvals.subject_id` is `uuid NOT NULL` at
[`0016:227`](../../packages/db/migrations/0016_treasury_controls.sql), both re-derived here. **Fencing
either against today's tree would be [WAVE-05](WAVE-05-tier2-fixture-shapes.md)'s defect in its worst
form**, a fence over files a ruling has not yet made possible. Section 10 puts both to the founder.

---

## 9. The collisions, BY FILE

**A per-slice depends-on column cannot express a per-file collision, and this corpus has made that error
twice and recorded both.** So: every file held by more than one slice, or by a slice and a session already
in flight.

| File | Held by | Why it collides, and the resolution |
|---|---|---|
| **[`packages/db/src/schema.ts`](../../packages/db/src/schema.ts)** and **[`scope.ts`](../../packages/db/src/scope.ts)** | **`P4-a`, `P4-b`**, and **ten of the fourteen module measurements' first slices** | **THE LARGEST COLLISION IN THE ESTATE AND IT IS NOT VISIBLE FROM INSIDE ANY MODULE.** `SCOPE_RULES` is total over `TableKey` by a `satisfies` clause, so the two files move together **or the workspace does not compile**. Treat them as ONE unit of contention. Within P4: **`P4-a` then `P4-b`, strictly serial.** Across phases: **RULED, by [ADR-092](../decisions/ADR-092.md) section 2**: **the owner is the TABLE and not the module**, a table being registered once by the first session that needs it and the registration not re-argued, and **the queue is the TYPE CHECKER and not a document**, a session computing its own slice from `TABLE_KEYS` and dispatching concurrently with any other whose remaining table set is disjoint |
| **[`packages/db/test/scoped-db.test.ts`](../../packages/db/test/scoped-db.test.ts)** | **`P4-a`, `P4-b`** | Same serialization, and harder to see: `DDL_NAMES` is one list and **`P4-a` additionally changes the drift assertion's rule**. A branch that adds a table here without its rule typechecks and the merge of two such branches typechecks too, which is the case that gets waved through ([session 159](../sessions/2026-08-24-session-159.md)) |
| **[`pnpm-lock.yaml`](../../pnpm-lock.yaml)** and **[`pnpm-workspace.yaml`](../../pnpm-workspace.yaml)** | **`P4-c`, `P4-d`, `P4-i`** | **SERIAL, three ways.** [P3 wave 1](P3-ledger-billing-identity.md)'s lesson verbatim: a lockfile cannot be appended to per row, and three branches each merge cleanly alone and none of them together. Order **`P4-c`, `P4-d`, `P4-i`**. Each catalog edit is its own `VG-12` admission and folding them into one diff is cheaper and worse |
| **[`scripts/corpus/gates.mjs`](../../scripts/corpus/gates.mjs)** and **[`falsify.mjs`](../../scripts/corpus/falsify.mjs)** | **`P4-c`, `P4-d`, `P4-i`**, and **session 173, CLAIMED** | **Four ways, and 173 is already dispatched.** Every artifact-bearing slice must shrink the unprobeable register in the same commit its `Closure` cell moves, because *an entry naming no live condition is itself a finding*. **173 goes first**, and the three P4 slices order behind it and behind each other |
| **[`docs/testing/STRATEGY.md`](../testing/STRATEGY.md)** | **`P4-c`** (4.1's `CI-07`, 4.2's `VG-2`), **`P4-d`** (4.2's `VG-3` and `VG-6`), **`P4-i`** (4.1's `CI-08`), and **173** (4.4's row) | Four slices, four different rows of two tables in one file. **Not textually overlapping and still serial**, because `CI-06/gate-inventory` and `CI-06/vg-inventory` read the whole cell and a keep-both merge produces a plausible cell with one leg lost |
| **[`docs/architecture/API_CONTRACT.md`](../architecture/API_CONTRACT.md)** | **`P4-f`, `P4-h`**, and **cross-phase: [M05's `M5-9`](../sessions/2026-08-24-session-159.md), [M16's `S4`/`S7`/`S8`](../sessions/2026-08-24-session-165.md), [M17's `S1`](../sessions/2026-08-24-session-166.md), [M21's `M21-f`](../sessions/2026-08-24-session-170.md), [M06's ADR-069 eighteen](../sessions/2026-08-24-session-160.md)** | **THE HOTTEST CROSS-PHASE FILE IN THE CORPUS, and six measurements found it independently.** [Session 166](../sessions/2026-08-24-session-166.md) measured why: `grep -c loyalty` and `grep -c graduation` over that file both return **0**, so the contract *"never absorbed any module plan's NEW rows"* and **no gate reconciles a plan's section 4 table against it**. Within P4: **`P4-f` then `P4-h`.** Across phases it is unresolved and is section 10's second item |
| **`apps/api/src/routes/index.ts`** (new in `P4-d`) | **`P4-d`** writes it; **`P4-f`** registers into it; **[M03's `M3-i`/`M3-j`](../sessions/2026-08-24-session-157.md), [M05's `M5-5`/`M5-8`](../sessions/2026-08-24-session-159.md), [M16's `S4`/`S7`/`S8`](../sessions/2026-08-24-session-165.md), [M19's seven](../sessions/2026-08-24-session-168.md)** all queue behind it | **NOT a write collision inside P4, and it is a BARRIER.** [Session 168](../sessions/2026-08-24-session-168.md) states the consequence exactly: *"`M19-1` must create a registry that is per-module rather than one array, or these seven serialize."* **`P4-d`'s design decision is the phase's largest lever on every later phase's concurrency**, and it is worth saying so in `P4-d`'s own prompt |
| **[`apps/portal/**`](../../apps/portal/src/index.ts) and [`apps/api/**`](../../apps/api/src/index.ts)** | **`P4-d`, `P4-h`, `P4-i`**, and **session 176, CLAIMED** | **176 holds both paths** and retires the six `portal-api` sites `ADR-089` supersedes, one of which is [`apps/portal/src/index.ts`](../../apps/portal/src/index.ts)'s `SERVICE` export, verified present. **176 FIRST**, and it is mechanical and small |
| **[`apps/worker/src/batch/ports.ts`](../../apps/worker/src/batch/ports.ts)** | **`P4-g`**, and **[M13's `M13-e`](../sessions/2026-08-24-session-164.md)** | Both add a port to one interface. **Cross-phase and neither dispatch names it.** M13 is not phased before P4, so `P4-g` holds it first and M13's slice orders behind |
| **[`docs/decisions/ALLOCATION.md`](../decisions/ALLOCATION.md)** | **`P4-a`, `P4-c`, `P4-d`, `P4-f`, `P4-h`, `P4-j`** | **Six of ten**, and section 7 is why this plan cannot pre-claim them. `CI-06w` reads the table as a multiset, so **one commit claims all six before any slice runs**, on [session 143](../sessions/2026-08-23-session-143.md)'s own idiom. **An expected collision costs a resolution; a discovered one costs a cycle** |
| **[`docs/INDEX.md`](../INDEX.md)** | the same six | One row each. `CI-06c` reads INDEX completeness in **both** directions, so a slice minting a document and fenced out of this file ships a finding. Every fence above that mints one holds its row |
| **[`docs/sessions/README.md`](../sessions/README.md)** | **every slice, and every session in the tree** | The `session_entries` span is **generated** under [ADR-088](../decisions/ADR-088.md) and merges by re-running `node scripts/corpus/gates.mjs generate`. **The CLAIM table above it is NOT generated and never will be**, and every slice strikes one row in it. [Session 163](../sessions/2026-08-24-session-163.md) measured that a log-only session still fails `CI-06g` and `CI-06n` at 27 of 29 until the generator runs |
| **[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)** | **`P4-i`, `P4-j`** | Two new job keys, which merge cleanly. **The collision is in `STRATEGY`'s cells above, not here**, and it is named so the reverse is not assumed |

**The migration NUMBER is a collision no file list shows.** No P4 slice writes a migration, which is
measured rather than assumed: **`SD-M9-04` is the only unlanded delta P4 touches**, and it is
[session 157's `M3-d`](../sessions/2026-08-24-session-157.md), scheduled under M03 rather than here.
**P4 needs no migration**, which is a property it shares with M19 alone
([session 168](../sessions/2026-08-24-session-168.md)) and which is worth stating because every other
module measurement in the wave needs at least one.

---

## 10. What could not be determined, named rather than guessed

**Six items, and the first four go to the founder rather than to a session.**

1. **Who owns `packages/db/src/schema.ts` and `scope.ts` across phases.** Ten of fourteen measurements
   proposed the same slice on one pair of files, correctly, from inside fourteen fences. **This plan
   schedules P4's thirteen tables and cannot schedule the other 91.** Whether the transcription is done
   once for the estate, once per phase, or once per module with an owner and a queue is a **ruling**, and
   it is the single decision that most changes how many of the remaining phases can run concurrently. It
   is not a planning session's to take.

2. **Whether a gate reconciles a module plan's endpoint table against API_CONTRACT.**
   [Session 165](../sessions/2026-08-24-session-165.md) proposed it and declined to write it, on the ground
   that *"writing it turns the corpus red on however many other modules share the defect, and measuring
   that is its own session."* [Session 166](../sessions/2026-08-24-session-166.md) measured the same hole
   from the other side. **Six measurements found this file short of rows and no two of them agree on how
   many**, because each counted only its own module. **It is a gate proposal, its cost is unmeasured, and
   this plan does not write it.**

3. **Whether auth gets a phase, and which.** Section 4.4. The contract specifies it, the schema carries it,
   no code implements it, and **no phase's contents name it**. `SC-M4-01` and `SC-M4-11` are inside P4's
   first stated content by DELIVERY_PLAN's own wording. **DELIVERY_PLAN is outside this session's fence and
   its definition of done is not a session's to rewrite** ([session 136](../sessions/2026-08-22-session-136.md)).
   Three readings are available and this plan takes none: auth is P4's and the cell is amended; auth is a
   phase of its own between P3 and P4; or auth is P3's, on the ground that P3 already carries M19.

4. **Whether `GS-143` and `GS-144`'s blocker term moves.** Section 5.3. Both are P4's done-condition, both
   are rowed `no-fixture-format` with 264 others, and **neither is a fixture in any format**: their subject
   is a build that does not exist. Whether [ADR-072](../decisions/ADR-072.md)'s closed six-term vocabulary
   has a term for this, or gains one, or whether these two rows leave section 39 entirely, is a ruling.
   **`P4-j` must not invent one.**

5. **Whether the M12 machine may run before the replay self-audit.**
   [M12 section 3.1](M12-transparency-platform.md) says Merit *"will not publish a statistic computed over
   a day whose self-audit diverged, because the statistic would be computed from state the engine itself
   does not currently vouch for"*, and calls that dependency *"the strongest quality gate available"*. The
   self-audit is `CI-09`'s second leg, waiting on a demo-world seed script.
   **`P4-g` is the only P4 slice with a dependency outside the phase**, and whether it may ship computing
   without publishing, or waits, is not derivable from the tree.

6. **What `apps/site`'s adapter reads through.** `SitePorts`' four ports are public reads with no identity,
   and `systemDb`'s `SystemReason` is a **closed vocabulary** of two members,
   `'nightly-batch' | 'operator-console'` ([`scoped-db.ts:143`](../../packages/db/src/scoped-db.ts)).
   **A public marketing page is neither.** Whether `P4-e` adds a third member, uses a scoped accessor with
   no identity, or reads through something that does not exist yet is an `ADR-084`-shaped question, and
   `ADR-084` did not anticipate an unauthenticated reader. **It is small, it is real, and `P4-e` cannot
   start without an answer.**

---

## 11. The rules every prompt carries, written once here

These are [P3 section 7](P3-ledger-billing-identity.md)'s, unchanged where they held and amended where the
fourteen measurements paid for an amendment.

1. **The session-log stub is the first commit.** Write `docs/sessions/2026-08-24-session-<N>.md` with the
   objective and `placeholder` for every other field, strike your row in
   [sessions/README](../sessions/README.md), commit, push. **Then do the work.**
2. **Your log MUST carry an `<!--index: ... -->` line** under its `##` heading, and
   **`node scripts/corpus/gates.mjs generate`** is part of writing a log rather than an optional tidy-up
   ([ADR-088](../decisions/ADR-088.md), and [session 161](../sessions/2026-08-24-session-161.md)'s landmine:
   the generator **throws** on a `##` section with no marker).
3. **`git fetch origin main` immediately before asserting anything about a registry.** **Twelve of the
   fourteen measurements recorded the same defect** ([157](../sessions/2026-08-24-session-157.md) to
   [165](../sessions/2026-08-24-session-165.md), [167](../sessions/2026-08-24-session-167.md),
   [169](../sessions/2026-08-24-session-169.md), [170](../sessions/2026-08-24-session-170.md)): a claim row
   genuinely absent at the session's base commit that had merged by the time the branch committed. **Each
   one recorded it as its own**, which is the second thing in this wave no single session could see. **An
   absence is a fact about a file at a commit**, and `SessionStart`'s `git pull --ff-only` proves nothing
   about the next forty minutes.
4. **Commit and push after each file.** Not at the end.
5. **The fence is absolute.** If the work needs a file outside it, **stop and report it in the pull-request
   body** rather than reaching.
6. **[STATE](../STATE.md): append one `##` section at the END.** Edit no existing line.
7. **Your ADR number and any migration number are allocated in ONE commit before you run**, and **section 7
   explains why this plan could not write them for you.** Do not read the register and take the next number
   you can see; that is [session 120](../sessions/2026-08-21-session-120.md)'s move and it created `OI-27`.
   **Amend your reservation IN PLACE** when the file lands ([ADR-065](../decisions/ADR-065.md) T3, enforced
   by `CI-06f`), and write it unlinked until then.
8. **Your ADR states what it FORECLOSES, not only what it chooses.** `P4-c` picks a rendering technology and
   `P4-d` picks a route registry's shape; both are decisions this project lives with for years, and
   `P4-d`'s shape decides whether seven M19 slices serialize.
9. **A new document gets its `INDEX.md` row in the same change.** `CI-06c` reads both directions.
10. **If your change lands a PROBED artifact, its row moves in the same commit.** Section 4. `CI-07`,
    `CI-08`, `VG-3` and `VG-6` all fail on good news, and **`VG-10` must not be expired with `VG-2`.**
11. **Verify by running, never by reading.** `node scripts/corpus/gates.mjs check` and `pnpm run verify`
    leave green, and every completion claim in the pull-request body ships with its command and its output.
    **Never background `falsify:ci` and never `git add -A` after it: it mutates the working tree.**
12. **Report the count honestly.** *"I am at 3 of 5"* beats five thin files.
13. **Never weaken a gate to pass it and never widen a fence to finish.** They are the same move.
14. **Authority citations must resolve, and an absence is the claim a wider grep refutes.** Section 5.1 is
    what happens when three sessions read one file and the one whose slice depends on the answer runs the
    narrowest grep. Section 5.4 is the same class inside this session.

**Money-path sessions (`P4-a`, `P4-b`, `P4-g`) additionally: plan mode, fresh context, one objective,
[ADR-003](../decisions/ADR-003.md) strict.**

---

## 12. The dispatch order

**Nothing below may be dispatched until section 7's allocation commit exists, and section 10's items 1, 3
and 6 are answered.** Item 6 blocks `P4-e` alone; items 1 and 3 change what the phase contains.

```
Already in flight, and both order AHEAD of P4:
  173  gates.mjs, falsify.mjs, STRATEGY 4.4     ->  blocks P4-c, P4-d, P4-i
  176  apps/portal/**, apps/api/**              ->  blocks P4-d, P4-h, P4-i

Wave 1, two pairs, each pair serial, the pairs concurrent with each other:
  P4-a  the drift ruling + 3 tables    MONEY   ->  P4-b  the other 10 tables    MONEY
  P4-c  the UI framework + CI-07/VG-2          ->  P4-d  fastify + the registry + VG-3/VG-6

Wave 2, after wave 1:
  P4-e  the site's adapter          (needs P4-a, P4-b, and section 10 item 6)
  P4-f  M12's method pages          (needs P4-b, P4-d)          ->  P4-h  the portal's read screens
  P4-g  the M12 machine     MONEY   (needs P4-b, and CI-09's replay leg)

Wave 3, last, and P4-j cannot end green until section 10 item 4 is ruled:
  P4-i  the slop-score pass + CI-08
  P4-j  the parameter lint + GS-143/GS-144
```

**`P4-a` is the one to run first and nothing blocks it.** It is money path, it takes one ruling, and it is
the slice ten of the fourteen measurements asked for in ten different fences.
