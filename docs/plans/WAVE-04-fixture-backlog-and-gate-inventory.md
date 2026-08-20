---
status: approved
depends_on: [../STATE.md, ../decisions/ALLOCATION.md, ../testing/STRATEGY.md, ../testing/golden-scenarios/README.md, WAVE-03-duplicate-registry-keys.md]
last_updated: 2026-08-20
---

# WAVE-04: the fixture backlog and the gate inventory, eight sessions, six of them concurrent

**A wave plan, not a module plan.** It carries no design and one ruling only by
reference. It is the partition, the allocation table and the prompt set for the
sessions that close the two items **session 106**
handed over, written so a prompt is pasted into a fresh session and a pull request is
read.

**Session 106 is named throughout and never linked**, because its log is on
`origin/claude/merit-futures-briefing-7auoor` and unmerged, and `CI-06a` fails on a link
to an absent document. That is the same reason an unwritten `ADR-nnn` reservation carries
no link in [ALLOCATION](../decisions/ALLOCATION.md).

**Every number this wave spends is reserved in [ALLOCATION](../decisions/ALLOCATION.md)
in its own commit before any session starts.** `CI-06f` asserts gaplessness over
allocated plus reserved, so numbers handed to concurrent sessions without reservation
fail the first to commit, for all of them. This repository has done that at `044` and
again at `053`, `054` and `055`.

**Every claim in the brief that produced this plan was checked against the tree rather
than against the record that proposed it, and six did not survive.** They are section 1,
so the next reader does not re-derive them.

---

## 1. Six claims in the brief that the tree refutes

| Claim as briefed | What the tree says | How it was checked |
|---|---|---|
| **The two open items are `OI-19` and `OI-20`** | **Both numbers are taken.** [STATE](../STATE.md) carries `OI-19` (no gate detects a conflict marker) and `OI-20` (the session registry could not hold a three-digit number). The highest allocated is **`OI-24`**, in [session 95](../sessions/2026-08-20-session-95.md), M06's hand-maintained delta count. **The two items are `OI-25` and `OI-26` in this plan and everywhere after it** | `grep -rohE '\bOI-[0-9]{2}\b' docs/ \| sort -u \| tail` |
| **`<<<<<<< HEAD` stood in INDEX and STATE while 24 of 24 gates passed** | **No commit reachable from any branch head or any pull-request head has ever carried a leading `<<<<<<< ` in any `.md`, `.ts`, `.mjs` or `.json` file.** It stood in a **working tree** during a merge and was resolved before the commit landed. The record also disagrees with itself on the count: [session 105](../sessions/2026-08-20-session-105.md) and STATE say **22 of 22**, **session 106** says **24 of 24** | `git fetch origin '+refs/pull/*/head:refs/remotes/pr/*'` then `git log --all -G'^<<<<<<< ' -- '*.md' '*.ts' '*.mjs' '*.json'`, which returns nothing |
| **40 fixtures against 316 registered golden scenarios** | **Both confirmed, exactly.** 40 `.yaml` and 40 `.expected.json` in [`packages/rules-engine/fixtures`](../../packages/rules-engine/fixtures/README.md); 316 distinct `GS-nnn`, contiguous `GS-001` to `GS-316` with no holes. **The stage says so itself on every run**: *"Coverage of the registry is 40 of 316"* | `ls *.yaml \| wc -l`; `pnpm exec vitest run --project golden --reporter=verbose` |
| **The fixture backlog is 276 scenarios** | **Arithmetically yes and operationally no. 16 are writable today**, 14 need one ruling each, 3 are held on a named open question, and **243 have no code to run against**. Section 2 is the partition and every row of it names the mechanism | Section 2 |
| **`CI-06/identifier-series` is cheap and slug-shaped** | **The slug is cheap and the gate is not.** Roughly forty distinct `<PREFIX>-nn` series appear under `docs/`; `OI` alone appears **220** times and has no registry table at all. **"Definition site" is undefined**, and a gate cannot read a property nobody has stated. It gets `ADR-074` and a survey before it gets a runner | `grep -rhoE '\b[A-Z][A-Z0-9]*(-[A-Z0-9]+)*-[0-9]{2,3}\b' docs/ --include=*.md \| sed -E 's/-[0-9]{2,3}$//' \| sort \| uniq -c \| sort -rn` |
| **`docs/sessions/2026-08-20-session-106.md`** | **Not on `main`.** It is on `origin/claude/merit-futures-briefing-7auoor`, unmerged. `main`'s session registry ends at **105**. **106 is spent, so this planning session is 107** and the wave takes 108 to 115, which is what the brief's "next free: session log 107" already assumed | `git ls-tree -r --name-only origin/claude/merit-futures-briefing-7auoor docs/sessions/` |

**None of the six changes the work and all six change a number somebody would otherwise
write down.** The first is the one that would have cost the most: two sessions opening
`OI-19` against a `STATE` that already carries an `OI-19` is the duplicate-key class
[WAVE-03](WAVE-03-duplicate-registry-keys.md) spent nine sessions on, and **it arrived in
the prompt asking for the gate that catches it**.

### The baseline, run rather than quoted

```
node scripts/corpus/gates.mjs check    24 of 24 gates pass
pnpm run falsify                       clean and dirty, 35 scope cases, 10 loader cases
pnpm run check:invariants              7 of 7 invariants hold
pnpm exec vitest run                   74 test files, 1085 passing, 42 skipped
```

**The suite reads as five failing files on a stale `node_modules` and that is not a
break.** `packages/harness` is a new workspace package; `Cannot find package
'@merit/rithmic'` is a missing workspace link. `pnpm install` takes under a second and
turns 69 of 74 into 74 of 74. This is **session 106**'s
landmine, reproduced here so a session in this wave does not diagnose a red tree that is
green.

---

## 2. The backlog is 276 rows and sixteen fixtures of available work

**276 is the subtraction and it is not the plan.** A fixture is writable today only when
three things hold at once, and each of the three is checkable rather than a judgement:

| | Condition | Where it is enforced |
|---|---|---|
| **W1** | The code its assertion runs against exists **and is reachable from the loader**, which imports `@merit/rules-engine`'s public entry point and nothing else | [`packages/golden-loader/README.md`](../../packages/golden-loader/README.md), the structural obligation from [P1 section 2.2](P1-monorepo-scaffold.md) |
| **W2** | The **fixture format can express the input and the expectation**: a plan, a calendar, a day stream and an expected end state | [`fixtures/README.md`](../../packages/rules-engine/fixtures/README.md), and `L-05` refuses a YAML carrying `expect:` |
| **W3** | **No open question holds the expected end state undecided** | The scenario's own row in [GOLDEN_SCENARIOS](../testing/golden-scenarios/README.md) |

**"The engine has not implemented the rule yet" is NOT a blocker, and that is the design
working.** [ADR-048](../decisions/ADR-048.md) derives each fixture's polarity from the
rules it cites against the set the engine declares: a fixture citing an undeclared rule
**must load and derive inverted**, and `falsify.mjs` holds a scope case saying exactly
that. An inverted fixture is written before the rule and flips on its own when the rule
lands. **So the M1 backlog is bounded by W2 and W3, not by W1.**

### 2.0 CONDITION W1 IS WRONG AS WRITTEN, AND SO IS THE COUNT OF 16 (2026-08-20, session 110)

**`W3` returned 0 of 6 and its argument holds against the tree.** The condition
below says the code must be "reachable from the loader, which imports
`@merit/rules-engine`'s public entry point". **The planning session verified the
EXPORT MAP and never read the pipeline**, which is the primary-source failure
this plan's own section 5 argues against, landing on its author inside the
document that argues it.

[`packages/golden-loader/src/run.ts`](../../packages/golden-loader/src/run.ts)
imports **two symbols**:

```
import { advanceDay, initialState } from '@merit/rules-engine';
```

**Not `evaluatePayout`. Not `applySettlement`.** And `diffEvents` in
[`compare.ts`](../../packages/golden-loader/src/compare.ts) takes
`readonly { readonly type: string }[]` against `readonly string[]`, so **events
compare by type string only**.

| | |
|---|---|
| **REACHABLE** | Whatever `advanceDay` writes onto `RuleState`: `withdrawableCents`, `engineGates`, `engineEligible`, `payoutsSettledCount`, `lifetimeSettledCents`, `payoutAnchorDay`, `cadenceAnchorDay`, `breached`, `breachKind`. `GS-025` pins `withdrawable_cents` exactly this way and is the precedent |
| **NOT REACHABLE** | Anything returned only by `evaluatePayout` or `applySettlement`. `PayoutEvaluation` carries `asOfTradingDay`, `contextEligible`, `eligible` and **`clamp`**, so **no fixture can assert `clamp_reason` or `trader_cents` today**. `SettlementFact` is five fields and **none is a status**, so a failed transfer produces no fact at all |

**`outside-loader-boundary` does not cover this**, and that gap is why the error
survived: that term was defined for code living in `apps/worker` (the replay
scenarios). "In the engine, exported, and never called by `runFixture`" is a
**different blocker and the most common one**. `ADR-072` names it.

**THE COUNTS IN 2.1 AND 2.2 ARE SUSPENDED, NOT RESTATED.** Replacing them with a
second set derived the same afternoon by the same session that got them wrong is
the move this repository keeps finding. `W1`'s status table is the authority, as
`W1`'s prompt already required, and **the number it derives is the number that
stands.** What is certain today is that 16 is an upper bound and that
`W3`'s six are not in it.

**`W3`'s reasoning is on `claude/wave04-w3-settlement-ladder-fixtures` at
`fbd6e03`**, re-derived against `types.ts`, `rules.ts`, `loader.ts`, `compare.ts`,
`run.ts` and M01 section 3.5, and it is worth reading rather than re-deriving.
**It also verified `GS-241`'s two figures by hand under TR-01 and they match the
registry exactly**, so the row is right and only its reachability was wrong.

**The gate this wants is not written and is not `W8`'s.** Nothing in the tree
asserts that a scenario queued as writable has an assertion the fixture pipeline
can actually reach. That is checkable, and preferring a gate to more care is what
section 5 says to do about exactly this.

---

### 2.1 The partition, and it sums to 276

| Tier | What holds it | Count |
|---|---|---|
| **1. Writable today** | Nothing. The fold, the format and the record all reach it | **16** |
| **2. One ruling each** | The format cannot express the assertion, or the code sits outside the loader's import boundary. Each is a ruling, not a build | **14** |
| **3. Held on a named open question** | The expected end state is not decided | **3** |
| **4. No code to run against** | The owning module has no implementation, and no fixture format exists for it | **243** |
| | | **276** |

**Tiers 1 through 3 are all of M1's.** M1 owns **73** scenarios ([section 33.1](../testing/golden-scenarios/33-ownership-index-and-coverage-reconciliation.md)),
40 have fixtures, and the remaining 33 partition as 16 plus 14 plus 3. **Every fixture on
disk is M1-owned; not one belongs to any other module.**

### 2.2 Tier 1, the sixteen, by the session that writes them

| Session | Scenarios | Why the fold reaches them |
|---|---|---|
| **W2**, payout arithmetic and the gate object | `GS-026`, `GS-027`, `GS-028`, `GS-029`, `GS-042`, `GS-080` | `R-43` and `R-44` are declared and live in [`payout/clamp.ts`](../../packages/rules-engine/src/payout/clamp.ts); `R-39` and the gate object live in `payout/gates.ts`. `GS-025` already exercises this path as the one Group G fixture |
| **W3**, settlement, corrections and the ladder | `GS-035`, `GS-057`, `GS-058`, `GS-066`, `GS-082`, `GS-241` | `R-46` to `R-50` are declared and live in [`payout/settle.ts`](../../packages/rules-engine/src/payout/settle.ts). `settlements` reaches an engine input, which [`fixtures/README.md`](../../packages/rules-engine/fixtures/README.md) records as the field whose emptying `L-11` was written for |
| **W4**, the day fold and its boundaries | `GS-047`, `GS-049`, `GS-059`, `GS-079` | `advanceDay` is the fold `CI-03` runs. `GS-059`'s Christmas cluster is **transcribed** in [`calendars/cme-2026.json`](../../packages/rules-engine/fixtures/calendars/cme-2026.json), not synthesized, so the cadence gap it pins rests on a committed CME artifact |

**`GS-049` is a fixture and a property suite, and its row says so**: *"Runs as a property
suite as well as a fixture."* W4 writes the fixture. It does not write the `PT-nn` suite.

### 2.3 Tier 2, the fourteen, and the ruling each waits on

| Group | Scenarios | The ruling |
|---|---|---|
| **Publish-time validation has no fixture shape** | `GS-076`, `GS-077`, `GS-078`, `GS-083`, `GS-141` | `validatePlan` **exists** and `R-17` is declared, so this is not a code gap. The format is a day stream and an end state; **"publishing fails, naming CV-17"** is not an end state. Needs a second fixture shape |
| **Replay and upgrade sit outside the loader's import boundary** | `GS-034`, `GS-071`, `GS-072`, `GS-073`, `GS-074`, `GS-075` | [`replay.ts`](../../apps/worker/src/batch/replay.ts) and [`state-hash.ts`](../../apps/worker/src/batch/state-hash.ts) exist **in `apps/worker`**, and the loader may import the engine's entry point only. Needs a ruling on where a replay golden runs, not a build |
| **More than one account, or more than one request in one window** | `GS-052`, `GS-062` | The fold is one account, one day stream. `GS-052`'s internal half is three requests in one transaction window; `GS-062` is ten copy-traded accounts under one identity. The only multi-account fold in the tree is `scripts/demo` |
| **The calendar record carries no session open or close** | `GS-030` | The record has two keys, `trading_day` and `kind`. `GS-030` pins that the **23 hour and 25 hour** DST sessions each produce one trading day and one mark; the half a reader can check is not in the record. The file states this against itself under `what_this_format_cannot_carry` |

### 2.4 Tier 3, the three, and the question that holds each

| Scenario | Held on |
|---|---|
| `GS-004`, `GS-031` | **Two things, both named.** `halted` has no record key and no loader mapping, which the calendar file calls *"`halted`'s blocker exactly (GS-004, GS-031)"*; and **`OI-16`** asks whether any feed Merit will hold reports a whole-session halt at all. [ADR-059](../decisions/ADR-059.md) **granted** the hold |
| `GS-001` | `R-01` is a containment lookup over a fill's execution timestamp, **`DailyMark` carries `fillCount` and no instant**, and `R-01` is one of the four rules the engine does not declare because it is discharged at ingest. The assertion is M2's, in an M1-owned row |

### 2.5 Tier 4, the 243, and why "unwritable" is the honest word

| | Scenarios | Why |
|---|---|---|
| **M2** | **14** | *"The interface is declared and nothing implements it."* [M02](M02-rithmic-bridge.md) holds at `review` under [ADR-005](../decisions/ADR-005.md) pending the vendor call |
| **M3 to M20 and INFRA** | **229** | `apps/admin` is 32 source lines, `apps/portal` 21, `apps/site` 22, `packages/db` 38. **And no fixture format exists for any of them.** The format is `packages/rules-engine/fixtures/GS-NNN-*.yaml`, a day stream folded through the engine, and it is M1-shaped in every field |

**The second half of that row is the load-bearing one.** Even if M05's code landed
tomorrow, its scenarios would still have nowhere to be written, because the fixture
format, the loader and `CI-03` are one module's. **A plan that queues 243 fixture
sessions is queueing work that has no file to go in.**

### 2.6 What this wave delivers instead of 276 fixtures

**Sixteen fixtures, and a registry that makes the other 260 checkable.** `ADR-072` and
its status table are the larger of the two deliverables: today the reason a scenario has
no fixture lives nowhere, and [section 33.4](../testing/golden-scenarios/33-ownership-index-and-coverage-reconciliation.md)
records exactly **three** deliberate absences in prose against 276 of them. **A blocker
nobody wrote down is indistinguishable from a fixture nobody got to**, which is how 276
came to be quoted as though it were a queue.

---

## 3. What `CI-07`, `CI-08` and `CI-09` can be against this tree

`OI-26`. [STRATEGY section 4.1](../testing/STRATEGY.md) rows ten stages; `CI-01` to
`CI-06` run in [Actions](../../.github/workflows/ci.yml). **P1's definition of done is the
full inventory, so P1 has not been closed since it was declared closed.** That is the
finding and it is correct. **What follows from it is not "write three gates."**

| Stage | Its stated contents | What exists to gate |
|---|---|---|
| **CI-07** build and bundle | VG-2, VG-10, VG-11, D0-10 **against the production build** | **No production build exists.** Every app's `package.json` carries `typecheck` and `start` and no `build`; there is no bundler in the tree. VG-2 greps a built bundle for key-shaped strings and there is no bundle |
| **CI-08** E2E | Playwright, **three projects** | **Playwright is not installed** and the three surfaces are 75 source lines between them |
| **CI-09** nightly | Simulation harness, replay self-audit, Stryker on the engine, detector canary | **Three of four have a subject.** [`packages/harness`](../../packages/harness/README.md) exists and folds the real engine; [`replay.ts`](../../apps/worker/src/batch/replay.ts) exists; `packages/rules-engine` is 10,264 source lines and is a real Stryker target. **The detector canary needs M07**, which has no code |

**Writing `CI-07` against a tree with no build is the exact failure this repository keeps
finding.** It would be a control that exists, stays valid and enforces nothing, and
[STRATEGY section 4](../testing/STRATEGY.md) already rules against the softer version of
it: *"a gate added as advisory is a gate that stays advisory."*
[`falsify.mjs`](../../scripts/corpus/falsify.mjs) makes a gate that cannot pass the tree
an **ERROR**, which is the same judgement enforced.

**So the honest closure is a ruling, not three workflows.** `ADR-073` says a gate row is
closed when it is **implemented**, or when it carries a **dated activation condition
naming the artifact it waits for**, and `CI-06/gate-inventory` asserts that every row is
one or the other and that every named artifact resolves. **`CI-09` is built** because
three of its four legs have a subject. `CI-07` and `CI-08` get activation conditions that
name a `build` script and an installed Playwright, so the day either arrives the gate
fails until the stage is written.

**That also gives `packages/harness` its consumer.** Session 106's third landmine is that
the harness *"exists with its own tests; nothing calls it."* `CI-09` is the thing that
calls it.

### One contradiction inside STRATEGY, for `W5` to settle

**`VG-11` is assigned to two stages in one document.** `CI-07`'s contents row lists it;
the `VG` table two sections below rows it as **`CI-02`, blocks merge**. One of the two is
wrong and `ADR-073` is where it is said which.

---

## 4. M02, and what it blocks

**M02 blocks 14 fixtures and none that this wave queues.** Its own `GS-084` to `GS-093`
and the four scenarios in its owned set are Tier 4 by [ADR-005](../decisions/ADR-005.md),
and no Tier 1 scenario touches ingest, provisioning, entitlement or a setpoint.

**It reaches into three of M1's rows and stops none of them.** `GS-034` and `GS-047` are
co-owned with M2, and **M1's half of each is stated separately in the registry**: for
`GS-047` it is *"applying the same day twice is a no-op on state"*, which is a property
of the fold. `GS-047` is Tier 1 on that half. `GS-034` is Tier 2 on the replay boundary,
not on M2. `GS-001` is Tier 3 because its assertion is ingest's, which is M2's, and that
one **is** M02 reaching a fixture in M1's set.

**It is a calendar risk and this plan does not carry it.** Nothing below waits on the
vendor call.

---

## 5. Three more findings, recorded so the next reader does not re-derive them

- **The `gs_count` span sits in the wrong row of the registry's own running total.**
  [Section 33.2](../testing/golden-scenarios/33-ownership-index-and-coverage-reconciliation.md)'s
  source table gives FOLD-02 a running total of **316**, carried in a `gs_count`
  generated span, and the three rows below it then continue **299, 304, 316**. The arithmetic at
  FOLD-02 is **284**. `CI-06g` passes because the span's value matches its query: **the
  gate proves the number is current and says nothing about whether it is in the right
  cell.** The same section heads **two** subsections `### 33.2`.
- **[`packages/golden-loader/README.md`](../../packages/golden-loader/README.md) says
  "24 of 30 fixtures pass" and names six that do not.** The run says **40 fixtures, 40
  direct, 0 inverted, every one holding in the direction its citation derives**. The six
  named causes were repaired and the heading was not. It is a hand-maintained count in a
  file whose whole subject is that hand-maintained counts drift.
- **Constitution section 5.2's minimum of 40 golden files is met with zero margin, and
  the row asserting it is answering a different question.**
  [Section 33.3](../testing/golden-scenarios/33-ownership-index-and-coverage-reconciliation.md)
  rows *"Section 5.2's minimum of 40 golden files | 316 defined | yes."* 316 is the count
  of **defined scenarios**; the count of **files** is exactly 40. The row is true by
  coincidence of the two numbers meeting at the threshold, and it would read `yes` just
  the same at four files.

**None of the three is repaired here.** This is a planning session and each belongs to a
session with the file in its fence. The first two are named in `W1`'s and `W5`'s prompts;
the third is a reading, and `ADR-072` is where it is settled.

---

## 6. The registries this wave spends, allocated before any session starts

| Registry | Spent | Where the claim lives |
|---|---|---|
| **ADR numbers** | **072** (`W1`), **073** (`W5`), **074** (`W6`) | [ALLOCATION](../decisions/ALLOCATION.md), ADR table. **Written unlinked**, because `CI-06a` fails on a link to an absent document |
| **Migration numbers** | **none.** No session below touches `packages/db/migrations` | **`0046` stays free** |
| **`CI-06` letters** | **none, and that is [ADR-065](../decisions/ADR-065.md) rather than restraint.** A new gate takes a **slug** | The letter table is untouched. `a` to `w` are claimed and `x` is not taken |
| **Gate slugs** | `CI-06/conflict-markers`, `CI-06/fixture-inventory`, `CI-06/gate-inventory`, `CI-06/identifier-series` | **`W8`'s `GATES` entries in [`gates.mjs`](../../scripts/corpus/gates.mjs) and their rows in [STRATEGY section 4.4](../testing/STRATEGY.md). No ALLOCATION row, by ADR-065.** `CI-06w` reads gate ids out of the runner, so the registration and the implementation are the same line and cannot drift apart |
| **`OI` numbers** | **`OI-25`** the fixture backlog, **`OI-26`** the gate inventory | **This table, and `W1`'s and `W5`'s STATE appends.** `OI` has no allocation table, which is `ADR-074`'s subject |
| **Session-log numbers** | **108 to 115**, one per session, in section 7. This planning session is **107** | **This table.** `106` is spent on `origin/claude/merit-futures-briefing-7auoor` and unmerged |

**`OI-25` and `OI-26` are allocated in a plan document and not in a registry, and that is
the defect this wave is partly about rather than an exception to it.** `ADR-074` decides
whether `OI` gets a table. Until it does, this row is the only place the two numbers are
claimed, which is exactly how `SD-M6-nn` and `M6-N-nn` were allocated one wave ago.

---

## 7. The wave

| Rank | # | Session | Log | Branch | Fence | Regime |
|---|---|---|---|---|---|---|
| **1** | **W1** | `ADR-072`, fixture writability and the status registry | 108 | `claude/wave04-w1-adr072-fixture-writability` | `docs/decisions/ADR-072.md`, `docs/decisions/README.md`, `docs/testing/golden-scenarios/39-fixture-status-and-blockers.md`, `docs/testing/golden-scenarios/README.md` | non-money |
| **1** | **W2** | Six fixtures: payout arithmetic and the gate object | 109 | `claude/wave04-w2-payout-arithmetic-fixtures` | **BY FILE.** `packages/rules-engine/fixtures/GS-026*`, `GS-027*`, `GS-028*`, `GS-029*`, `GS-042*`, `GS-080*` | **money path** |
| **1** | **W3** | Six fixtures: settlement, corrections and the ladder | 110 | `claude/wave04-w3-settlement-ladder-fixtures` | **BY FILE.** `packages/rules-engine/fixtures/GS-035*`, `GS-057*`, `GS-058*`, `GS-066*`, `GS-082*`, `GS-241*` | **money path** |
| **1** | **W4** | Four fixtures: the day fold and its boundaries | 111 | `claude/wave04-w4-day-fold-fixtures` | **BY FILE.** `packages/rules-engine/fixtures/GS-047*`, `GS-049*`, `GS-059*`, `GS-079*` | **money path** |
| **1** | **W5** | `ADR-073`, what closes `CI-07`, `CI-08` and `CI-09` | 112 | `claude/wave04-w5-adr073-gate-inventory` | `docs/decisions/ADR-073.md`, `docs/decisions/README.md`, `docs/testing/STRATEGY.md` | non-money |
| **1** | **W6** | `ADR-074`, what a `<PREFIX>-nn` definition site is, with the survey | 113 | `claude/wave04-w6-adr074-identifier-series` | `docs/decisions/ADR-074.md`, `docs/decisions/README.md`, `docs/reviews/2026-08-21-identifier-series-survey.md` | non-money |
| **2** | **W7** | `CI-09`, the nightly workflow | 114 | `claude/wave04-w7-ci09-nightly` | `.github/workflows/`, `scripts/ci/` | non-money |
| **3** | **W8** | The four `CI-06` slug gates, four commits, in order | 115 | `claude/wave04-w8-slug-gates` | `scripts/corpus/`, `docs/testing/STRATEGY.md` | non-money |

**Six run at once: `W1`, `W2`, `W3`, `W4`, `W5` and `W6`.** The reasons, stated rather
than left to be inferred:

- **`W2`, `W3` and `W4` share one directory and are fenced BY FILE.** Every file each
  writes is **new**, and the twelve `GS-nnn` prefixes across the three sessions are
  disjoint. `packages/rules-engine/fixtures` has **no per-fixture table in its README**
  and **no `<!--gen:-->` span counts fixtures**, so three sessions appending sixteen new
  files touch nothing in common. That was checked, not assumed.
- **`fixtures/plans/` and `fixtures/calendars/` are the one shared thing and no session
  may touch them.** They are the collision the file fence would not catch. A session that
  needs a plan row or a calendar day that does not exist **stops and reports it in the
  pull-request body**. The calendar covers 2026-09-04 to 2027-01-04, 83 sessions, and
  three plan files exist: `CORE-50K`, `CORE-150K`, `MERIT-RAPID-50K`.
- **`W1` and `W5` are fenced to disjoint documents.** `W1` writes under
  `docs/testing/golden-scenarios/`, `W5` writes `docs/testing/STRATEGY.md`. Neither
  touches `docs/INDEX.md`: the golden-scenarios directory has **one** INDEX row for the
  directory and a per-file table in its own README, so `W1`'s new section file needs a
  README row and no INDEX row.
- **`W6` joins rank 1 because its fence is disjoint and nothing in rank 1 feeds it.** It
  writes `docs/decisions/ADR-074.md` and a survey under `docs/reviews/`, which **carries
  no README and no INDEX row**, so the survey needs no registry entry and collides with
  nobody. The only files it shares with `W1` and `W5` are `docs/decisions/README.md` and
  `docs/sessions/README.md`, and **both are union appends** under the merge discipline
  above. Holding it to rank 2 would buy a serial round and change nothing, because `W8`
  waits on all of rank 1 regardless.
- **`W7` cannot start until `W5` merges.** It needs `ADR-073` to have ruled which of
  `CI-09`'s four legs it builds, and a session that guesses that ruling is a session that
  builds the wrong three.
- **`W8` runs last and alone, and it is the only session that writes
  [`gates.mjs`](../../scripts/corpus/gates.mjs).** All four gates live in that file and
  [`falsify.mjs`](../../scripts/corpus/falsify.mjs), so they cannot be concurrent with
  each other under any fence. **Four sessions would buy four merge rounds and no
  parallelism**, which is what WAVE-03 paid at `S7` and `S8`. Each gate is one commit and
  the order is fixed: two of the four would **fail on arrival** if they landed before
  their input, because `CI-06/fixture-inventory` reads `W1`'s status table and
  `CI-06/gate-inventory` reads `W5`'s activation conditions and `W7`'s workflow.

### The generated spans, which are mechanical and must not be sequenced around

Three ADRs move `adr_count` from 71 to 74. Four gates move `gate_count` from 24 to 28.
**Every session runs `node scripts/corpus/gates.mjs generate`, and the review desk re-runs
it after each merge and commits the result.** It is idempotent and it is what `generate`
is for. **A `gen:` span in a conflict hunk is regenerated, never hand-picked**: each side
is right about its own registry and wrong about the other's.

### The merge discipline, carried from session 106

A **union** is correct for an appended registry row and **wrong** for a deletion, and the
two are indistinguishable in a conflict hunk. `docs/sessions/README.md`,
`docs/decisions/README.md` and `docs/testing/golden-scenarios/README.md` are unions. No
register in this wave shrinks.

---

## 8. The rules every prompt below carries, written once here

Each prompt restates these, because a prompt that points at a document is a prompt whose
rules do not arrive with it.

1. **`pnpm install` before you run anything.** A stale `node_modules` reads as five
   failing suites and it is a missing workspace link, not a break.
2. **The session-log stub is the first commit.** Write
   `docs/sessions/2026-08-20-session-<N>.md` with the objective and `placeholder` for
   every other field, add its row to [sessions/README](../sessions/README.md), commit,
   push. **Then do the work.**
3. **Commit and push after each file.** Not at the end of the task. A batch of unpushed
   commits is the failure mode the rule exists to prevent.
4. **The fence is absolute.** Touch nothing outside it. If the work needs a file outside
   the fence, **stop and report it in the pull-request body** rather than reaching.
5. **`docs/STATE.md`: append one `##` section at the END.** Edit no existing line.
6. **`docs/sessions/README.md`: append your row at the end of the table.** Your number is
   allocated in section 6. Do not take the next number you can see.
7. **Open the pull request yourself**, ready for review, titled with what landed. **Do
   not merge it.**
8. **Verify by running, never by reading.** Every completion claim ships with the command
   and its output. `node scripts/corpus/gates.mjs check` and `pnpm exec vitest run` are
   the two that everything must leave green.
9. **Report the count honestly.** Four of six beats six thin ones. A session low on
   context says so and stops.
10. **Never weaken a gate to pass it**, and never widen a fence to finish. Both are the
    same move.
11. **Authority citations must resolve.** Say **the review desk** or cite the ADR.
    **Never write founder ruling**; `CI-06q` exists because three sites cited one that
    never happened.
12. **`ADR-072` and `OI-25` and `OI-26` are reserved in
    [ALLOCATION](../decisions/ALLOCATION.md) and in section 6 of
    [WAVE-04](WAVE-04-fixture-backlog-and-gate-inventory.md).** Take no number that is not
    allocated to you there.

### The one rule the three fixture sessions carry and nobody else does

**TR-01. An expected end state is computed by hand from M01's rule text and never by
running the engine.** A fixture derived from the implementation proves only that the code
agrees with itself, which is why
[STRATEGY section 2](../testing/STRATEGY.md) rejected TypeScript fixture builders
outright. **If your fixture fails, report it in the pull-request body with the field that
moved. Do not edit the fixture to match.** Six fixtures once failed here and the record
of that says it plainly: *"none of the six is fixed here, because a fixture edited to
match an engine proves only that the code agrees with itself."*

---

## 9. The prompts

Each block is complete. Paste one into a fresh session and change nothing.

---

### W1: `ADR-072`, fixture writability and the status registry (session 108)

```
Branch: claude/wave04-w1-adr072-fixture-writability   (from origin/main)
Fence:  docs/decisions/ADR-072.md, docs/decisions/README.md,
        docs/testing/golden-scenarios/39-fixture-status-and-blockers.md,
        docs/testing/golden-scenarios/README.md, plus your session log and one
        appended STATE section.
        DO NOT WRITE A FIXTURE. DO NOT WRITE A GATE. DO NOT EDIT
        docs/testing/golden-scenarios/33-*.md.

Read WAVE-04 sections 2 and 5 first. Its partition is your input and you are
expected to check it rather than copy it.

OBJECTIVE. Two files.

1. docs/decisions/ADR-072.md. What makes a golden fixture WRITABLE, stated as
   three conditions that can be checked rather than judged (WAVE-04 section 2),
   and the ruling that EVERY registry row without a fixture carries a STATED
   BLOCKER from a closed vocabulary. Record that section 33.4 of the golden
   registry is the same idea at three rows and this is it at 276. Record the
   rejected alternative: leaving the reason in prose, which is what 33.4 does and
   what made 276 quotable as a queue.

   Settle one reading while you are here, in its own section. Section 33.3 rows
   "Section 5.2's minimum of 40 golden files | 316 defined | yes". 316 is the
   count of DEFINED SCENARIOS and the count of FILES is exactly 40. Say which
   question that row answers and whether the constitutional minimum is met on
   files or on definitions. Do not edit 33.3; it is outside your fence.

   status: proposed, with an unsigned approval line. It rules on a frozen
   registry document's completeness.

2. docs/testing/golden-scenarios/39-fixture-status-and-blockers.md. ONE TABLE,
   316 rows, first cell GS-nnn, in numeric order. Columns: id, status
   (written | writable | blocked), blocker (empty when written or writable, one
   vocabulary term otherwise), and the citation that supports the blocker.

   The blocker vocabulary is yours to close and WAVE-04 section 2 supplies at
   least these: no-module-code, no-fixture-format, outside-loader-boundary,
   format-cannot-express, open-question, vendor-call. Add what the rows need and
   no more. A blocker with no citation is the finding.

   Add its row to docs/testing/golden-scenarios/README.md. It needs NO INDEX row:
   INDEX carries one row for the directory and the per-file table lives in that
   README. CI-06n reads the README.

VERIFY, and this is the half that matters. WAVE-04 section 2 claims 40 written,
16 writable, 14 needing a ruling, 3 held and 243 with no code. Derive all five
from your own table and say in the pull-request body whether they agree. IF THEY
DO NOT, YOUR TABLE IS THE ANSWER AND THE PLAN IS THE ERROR. Say so plainly.

Then append ONE section to docs/STATE.md recording OI-25, the fixture backlog,
with the five counts your table derives. OI-25 is allocated to you in WAVE-04
section 6 and in ALLOCATION. OI-19 THROUGH OI-24 ARE ALREADY TAKEN; do not
renumber them and do not take another.

NAME THIS IN YOUR PULL-REQUEST BODY AND DO NOT FIX IT: section 33.2's source
table gives FOLD-02 a running total of 316 in a gen:gs_count span while the rows
below it read 299, 304 and 316. The arithmetic at FOLD-02 is 284. CI-06g passes
because the span's VALUE matches its query and the gate says nothing about which
cell it is in. The same section heads two subsections "### 33.2". 33-*.md is
outside your fence.

RULES. pnpm install first. Session-log stub is the first commit, its row appended
to docs/sessions/README.md, number 108. Commit and push after each file. The
fence is absolute; if the work needs a file outside it, stop and report it in the
pull request. Append to STATE at the END, editing no existing line. Verify by
running: node scripts/corpus/gates.mjs check and pnpm exec vitest run both green,
with output quoted. Run node scripts/corpus/gates.mjs generate and commit the
result. Report the count honestly; a session low on context says so and stops.
Never weaken a gate to pass it. Cite the review desk or an ADR, NEVER "founder
ruling" (CI-06q). Open the pull request yourself, ready for review. Do not merge.

STOP CONDITION. Two files, the README row, one STATE section. Stop. Do not write
a fixture, do not write a gate, do not touch STRATEGY.
```

---

### W2: six fixtures, payout arithmetic and the gate object (session 109, MONEY PATH)

```
Branch: claude/wave04-w2-payout-arithmetic-fixtures   (from origin/main)
Fence:  BY FILE, and only these twelve, all new:
        packages/rules-engine/fixtures/GS-026-*.yaml  and .expected.json
        packages/rules-engine/fixtures/GS-027-*.yaml  and .expected.json
        packages/rules-engine/fixtures/GS-028-*.yaml  and .expected.json
        packages/rules-engine/fixtures/GS-029-*.yaml  and .expected.json
        packages/rules-engine/fixtures/GS-042-*.yaml  and .expected.json
        packages/rules-engine/fixtures/GS-080-*.yaml  and .expected.json
        plus your session log.
        DO NOT TOUCH fixtures/plans/, fixtures/calendars/, fixtures/README.md,
        any existing fixture, or any file under packages/rules-engine/src.
        Two sibling sessions are writing fixtures in this directory right now.

MONEY PATH. One objective, fresh session, ADR-003 strict.

Read packages/rules-engine/fixtures/README.md in full before writing anything.
It is the format and it records four fields that reach an engine input where a
reader would assume they do not.

OBJECTIVE. Six golden fixtures, each a YAML of inputs and a JSON sibling holding
the expectation. The scenarios and their pins are in
docs/testing/golden-scenarios/03-gs-001-to-gs-029-rule-and-boundary-scenarios-m1.md,
04-gs-030-to-gs-051-the-appendix-b4-battery.md and
07-gs-079-to-gs-083-scenarios-created-by-the-m1-gate-rulings-m1.md.

  GS-026  cap clamp when withdrawable exceeds the cap        R-43
  GS-027  withdrawable clamp when the cap exceeds it         R-43
  GS-028  cap exactly equals withdrawable, clamp_reason none  R-43
  GS-029  split remainder goes to the trader, sum exact       R-44
  GS-042  100.00 versus 99.99 minimum, 0.01 requests, cap tie R-39
  GS-080  a gate configured to zero renders disabled          ADR-015

THE ONE RULE THAT MAKES THIS WORK VALID. TR-01. EVERY EXPECTED END STATE IS
COMPUTED BY HAND FROM M01's RULE TEXT AND NEVER BY RUNNING THE ENGINE. A fixture
derived from the implementation proves only that the code agrees with itself, and
STRATEGY section 2 rejected TypeScript fixture builders for exactly that reason.
Every value you write is transcribed from a plan document or computed from M01's
arithmetic, and the pull-request body shows the arithmetic for each of the six.

IF A FIXTURE FAILS, REPORT IT WITH THE FIELD THAT MOVED. DO NOT EDIT THE FIXTURE
TO MATCH THE ENGINE. A failing golden file on a money path is a finding and it may
be an engine defect. Six fixtures failed here once and none was edited; that is
the precedent and it is the correct one.

expect.pins is prose stating WHICH OPERATOR OR ORDERING the scenario exists to
protect. A fixture without a pin is a regression test and gets rejected in review.

R-43 and R-44 are declared. packages/golden-loader derives each fixture's polarity
from the rules it cites against IMPLEMENTED_RULES, so all six should derive
DIRECT and must MATCH. If any derives inverted, say so and say why: that means
your citation names a rule the engine has not declared.

RULES. pnpm install first, or five suites read as failing on a missing workspace
link. Session-log stub is the first commit, its row appended to
docs/sessions/README.md, number 109. Commit and push AFTER EACH FIXTURE PAIR, not
at the end. The fence is absolute. If a scenario needs a plan row or a calendar
day that does not exist, STOP AND REPORT IT IN THE PULL-REQUEST BODY: those two
directories are shared with two concurrent sessions and are the one collision the
file fence does not catch. Verify by running: pnpm exec vitest run --project
golden and node scripts/corpus/gates.mjs check, with output quoted. Report the
count honestly; four of six beats six thin ones. Never weaken a gate to pass it.
Cite the review desk or an ADR, NEVER "founder ruling" (CI-06q). Open the pull
request yourself, ready for review. Do not merge.

STOP CONDITION. Six fixture pairs, or fewer with the count reported. Stop. Do not
write a gate, do not touch the engine, do not write a seventh scenario.
```

---

### W3: six fixtures, settlement, corrections and the ladder (session 110, MONEY PATH)

```
Branch: claude/wave04-w3-settlement-ladder-fixtures   (from origin/main)
Fence:  BY FILE, and only these twelve, all new:
        packages/rules-engine/fixtures/GS-035-*.yaml  and .expected.json
        packages/rules-engine/fixtures/GS-057-*.yaml  and .expected.json
        packages/rules-engine/fixtures/GS-058-*.yaml  and .expected.json
        packages/rules-engine/fixtures/GS-066-*.yaml  and .expected.json
        packages/rules-engine/fixtures/GS-082-*.yaml  and .expected.json
        packages/rules-engine/fixtures/GS-241-*.yaml  and .expected.json
        plus your session log.
        DO NOT TOUCH fixtures/plans/, fixtures/calendars/, fixtures/README.md,
        any existing fixture, or any file under packages/rules-engine/src.
        Two sibling sessions are writing fixtures in this directory right now.

MONEY PATH. One objective, fresh session, ADR-003 strict.

Read packages/rules-engine/fixtures/README.md in full first. Read what it says
about `settlements`, which is the field L-11's message exists for and the one
every scenario below depends on.

OBJECTIVE. Six golden fixtures.

  GS-035  payout at 23:59:59 versus the batch at 00:05     both read the same
                                                            last closed day
  GS-057  correction after settlement, favors the trader   never clawed back,
                                                            absorbed amount is
                                                            COMPUTED and reported
  GS-058  correction after settlement, favors the firm     symmetric, so the
                                                            policy is not
                                                            one-directional
  GS-066  failed transfer does not consume a ladder rung   ordinal 3 retries as
                                                            ordinal 3
  GS-082  Merit Rapid: the win-day gate binds and the      ADR-013, ADR-018,
          cadence gap never does                            ADR-019
  GS-241  INV-17's bound at the shortened ladder           no sequence exceeds
                                                            5 * max cap

GS-241 CARRIES TWO EXACT FIGURES AND THEY ARE THE POINT OF IT. Core EOD 50K:
750,000c gross, 675,000c to the trader. Merit Rapid: 500,000c and 450,000c. Both
are transcribed from the registry row, and if your fixture derives anything else,
that disagreement is the finding.

THE ONE RULE THAT MAKES THIS WORK VALID. TR-01. EVERY EXPECTED END STATE IS
COMPUTED BY HAND FROM M01's RULE TEXT AND NEVER BY RUNNING THE ENGINE. Every
value is transcribed from a plan document or computed from M01's arithmetic, and
the pull-request body shows the arithmetic for each of the six.

IF A FIXTURE FAILS, REPORT IT WITH THE FIELD THAT MOVED. DO NOT EDIT THE FIXTURE
TO MATCH THE ENGINE. R-19 is discharged by an ABSENCE: settlement does not write
the floor, the high-water balance or the lock. GS-057 and GS-058 assert around
that absence, so read R-19 and R-48 before you write either.

expect.pins is prose stating WHICH OPERATOR OR ORDERING the scenario exists to
protect. A fixture without a pin gets rejected in review.

RULES. pnpm install first. Session-log stub is the first commit, its row appended
to docs/sessions/README.md, number 110. Commit and push AFTER EACH FIXTURE PAIR.
The fence is absolute. If a scenario needs a plan row or a calendar day that does
not exist, STOP AND REPORT IT IN THE PULL-REQUEST BODY: those directories are
shared with two concurrent sessions. GS-082 needs MERIT-RAPID-50K, which exists.
Verify by running: pnpm exec vitest run --project golden and node
scripts/corpus/gates.mjs check, with output quoted. Report the count honestly.
Never weaken a gate to pass it. Cite the review desk or an ADR, NEVER "founder
ruling" (CI-06q). Open the pull request yourself, ready for review. Do not merge.

STOP CONDITION. Six fixture pairs, or fewer with the count reported. Stop.
```

---

### W4: four fixtures, the day fold and its boundaries (session 111, MONEY PATH)

```
Branch: claude/wave04-w4-day-fold-fixtures   (from origin/main)
Fence:  BY FILE, and only these eight, all new:
        packages/rules-engine/fixtures/GS-047-*.yaml  and .expected.json
        packages/rules-engine/fixtures/GS-049-*.yaml  and .expected.json
        packages/rules-engine/fixtures/GS-059-*.yaml  and .expected.json
        packages/rules-engine/fixtures/GS-079-*.yaml  and .expected.json
        plus your session log.
        DO NOT TOUCH fixtures/plans/, fixtures/calendars/, fixtures/README.md,
        any existing fixture, or any file under packages/rules-engine/src.
        Two sibling sessions are writing fixtures in this directory right now.

MONEY PATH. One objective, fresh session, ADR-003 strict.

OBJECTIVE. Four golden fixtures.

  GS-047  batch crashes at account 2,341 of 5,000.  M1's ASSERTION AND ONLY M1's:
          applying the same day twice is a no-op on state. The resumability and
          idempotence of the batch are M2's half of a co-owned scenario and are
          NOT yours. Write the fold's half and say in the pull request that you
          did.
  GS-049  fuzz: adversarial day sequences. Alternating 14,999 and 15,001 days, a
          single 1,000,000 day into consistency math, 100-day flat grinds. THE
          ROW SAYS IT RUNS AS A PROPERTY SUITE AS WELL AS A FIXTURE. WRITE THE
          FIXTURE. DO NOT WRITE THE PT-nn SUITE.
  GS-059  holiday cluster compresses the cadence gap in calendar time. Five
          trading days across the Christmas cluster is 9 calendar days; the same
          five in June is 7. THE CLUSTER IS TRANSCRIBED, NOT SYNTHESIZED:
          2026-12-24 is `half` and 2026-12-25 is an ABSENCE, both from a
          committed CME artifact named in the calendar's transcribed_from. Read
          that block before choosing your days. The June half of the comparison
          is NOT in the calendar's coverage; state how you express the contrast
          within 2026-09-04 to 2027-01-04, or report that you cannot.
  GS-079  a day whose realized loss equals daily_loss_limit_cents exactly does
          NOT breach, and one cent more does. OQ-6, the M1 gate.

THE ONE RULE THAT MAKES THIS WORK VALID. TR-01. EVERY EXPECTED END STATE IS
COMPUTED BY HAND FROM M01's RULE TEXT AND NEVER BY RUNNING THE ENGINE.

IF A FIXTURE FAILS, REPORT IT WITH THE FIELD THAT MOVED. DO NOT EDIT THE FIXTURE
TO MATCH THE ENGINE.

expect.pins is prose stating WHICH OPERATOR OR ORDERING the scenario exists to
protect. A fixture without a pin gets rejected in review.

RULES. pnpm install first. Session-log stub is the first commit, its row appended
to docs/sessions/README.md, number 111. Commit and push AFTER EACH FIXTURE PAIR.
The fence is absolute. IF GS-059 NEEDS A CALENDAR DAY THAT DOES NOT EXIST, STOP
AND REPORT IT: fixtures/calendars/ is shared with two concurrent sessions and
editing it is the one collision the file fence does not catch. Verify by running:
pnpm exec vitest run --project golden and node scripts/corpus/gates.mjs check,
with output quoted. Report the count honestly; three of four beats four thin
ones. Never weaken a gate to pass it. Cite the review desk or an ADR, NEVER
"founder ruling" (CI-06q). Open the pull request yourself, ready for review. Do
not merge.

STOP CONDITION. Four fixture pairs, or fewer with the count reported. Stop.
```

---

### W5: `ADR-073`, what closes `CI-07`, `CI-08` and `CI-09` (session 112)

```
Branch: claude/wave04-w5-adr073-gate-inventory   (from origin/main)
Fence:  docs/decisions/ADR-073.md, docs/decisions/README.md,
        docs/testing/STRATEGY.md, plus your session log and one appended STATE
        section.
        DO NOT WRITE A GATE. DO NOT WRITE A WORKFLOW. DO NOT TOUCH
        scripts/corpus/ OR .github/workflows/.

Read WAVE-04 section 3 first, then STRATEGY section 4 in full.

THE FINDING YOU ARE RULING ON. P1's definition of done is the FULL gate
inventory. CI-01 to CI-06 run in Actions; CI-07, CI-08 and CI-09 do not exist.
P1 has not been closed since it was declared closed. That is OI-26.

WHAT THE TREE SAYS, AND YOU WILL VERIFY EACH LINE YOURSELF.
  CI-07 gates VG-2, VG-10, VG-11 and D0-10 AGAINST THE PRODUCTION BUILD. No app
        has a `build` script and there is no bundler in the tree. VG-2 greps a
        built bundle and there is no bundle.
  CI-08 is Playwright, three projects. Playwright is not installed and the three
        surfaces are 75 source lines between them.
  CI-09 is the simulation harness, the replay self-audit, Stryker on the engine,
        and a detector canary. THREE OF THE FOUR HAVE A SUBJECT: packages/harness
        exists and folds the real engine, apps/worker/src/batch/replay.ts exists,
        and packages/rules-engine is a real Stryker target. The detector canary
        needs M07, which has no code.

OBJECTIVE. ADR-073, and the STRATEGY edits it requires.

Rule what closes a gate row. The proposal to argue against and, if you agree,
adopt: A ROW IS CLOSED WHEN IT IS IMPLEMENTED, OR WHEN IT CARRIES A DATED
ACTIVATION CONDITION NAMING THE ARTIFACT IT WAITS FOR. Not implemented and not
condition-bearing is the finding.

ARGUE THE ALTERNATIVE PROPERLY BEFORE YOU REJECT IT. Writing CI-07 now against no
build is the option, and STRATEGY section 4 already says "a gate added as
advisory is a gate that stays advisory", while falsify.mjs makes a gate that
cannot pass the tree an ERROR. Say whether those two lines settle it or whether
they are being stretched.

Rule CI-09's scope: which legs it builds now and which get conditions. Stryker is
a NEW DEPENDENCY and therefore a VG-12 admission; say whether that is worth
spending here or is itself a condition. OQ-TS-02 proposes Stryker be a trend and
never a threshold; say whether ADR-073 settles it or leaves it open.

SETTLE ONE CONTRADICTION INSIDE STRATEGY WHILE YOU HOLD THE FILE. VG-11 IS
ASSIGNED TO TWO STAGES IN ONE DOCUMENT: CI-07's contents row lists it, and the VG
table rows it as CI-02, blocks merge. One is wrong. Say which and repair the
losing row.

Then edit STRATEGY section 4.1: give CI-07 and CI-08 their activation conditions
and CI-09 its ruled scope. ADD NO NEW GATE ROW; CI-06 slug rows are W8's and it
runs after you.

status: proposed, with an unsigned approval line. It changes what "P1 is done"
means.

Then append ONE section to docs/STATE.md recording OI-26 with what ADR-073 ruled.
OI-26 is allocated to you in WAVE-04 section 6 and in ALLOCATION. OI-19 THROUGH
OI-25 ARE TAKEN; do not renumber and do not take another.

RULES. pnpm install first. Session-log stub is the first commit, its row appended
to docs/sessions/README.md, number 112. Commit and push after each file. The
fence is absolute. Append to STATE at the END, editing no existing line. Verify
by running: node scripts/corpus/gates.mjs check and pnpm exec vitest run both
green, with output quoted. Run node scripts/corpus/gates.mjs generate and commit
the result. Report the count honestly. Never weaken a gate to pass it. Cite the
review desk or an ADR, NEVER "founder ruling" (CI-06q). Open the pull request
yourself, ready for review. Do not merge.

STOP CONDITION. One ADR, the STRATEGY edits, one STATE section. Stop. Do not
build CI-09; that is W7 and it reads your ruling.
```

---

### W6: `ADR-074`, what a `<PREFIX>-nn` definition site is (session 113)

```
Branch: claude/wave04-w6-adr074-identifier-series   (from origin/main)
Fence:  docs/decisions/ADR-074.md, docs/decisions/README.md,
        docs/reviews/2026-08-21-identifier-series-survey.md, plus your session
        log.
        DO NOT WRITE A GATE. DO NOT TOUCH scripts/corpus/ OR STRATEGY. W8 writes
        CI-06/identifier-series and it reads your ruling.

THE BRIEF THAT PRODUCED THIS WAVE CALLED THIS GATE CHEAP. IT IS NOT, AND THE
REASON IS THE WHOLE SESSION. Roughly forty distinct <PREFIX>-nn series appear
under docs/. OI alone appears 220 times and has NO REGISTRY TABLE AT ALL.
"Definition site" is undefined, and a gate cannot read a property nobody has
stated.

SURVEY FIRST, RULE SECOND. Do not write the ADR until the survey exists.

OBJECTIVE, in order.

1. docs/reviews/2026-08-21-identifier-series-survey.md. Every <PREFIX>-nn series
   under docs/, with: its occurrence count, whether it has an allocation table,
   whether every member has exactly one site that a parser could call a
   definition, and how many members do not. USE A COMMAND AND QUOTE IT. The one
   that produced the forty-series figure is in WAVE-04 section 1.

   SD-nn IS THE ONE THAT CANNOT BE SOLVED YOUR WAY AND YOU MUST SAY SO. ADR-026
   requires a DELTA_MANIFEST row for every SD- identifier appearing under docs/,
   so an SD allocation CANNOT live in a document: reserving one in a plan file
   creates a manifest obligation the reservation cannot discharge. WAVE-03 found
   SD-M6-nn and M6-N-nn this way, by a session reading rather than by a gate.
   Whatever ADR-074 rules must survive that constraint.

2. docs/decisions/ADR-074.md. What a definition site IS, as something a parser
   can find. Which series are IN SCOPE for CI-06/identifier-series and which are
   exempt, WITH A REASON PER EXEMPTION rather than a list. And whether OI gets an
   allocation table.

   YOUR ADR MUST STATE, IN A SECTION OF ITS OWN, WHETHER THE GATE PASSES THE TREE
   AS IT STANDS. falsify.mjs makes a gate that cannot pass an ERROR, so a gate
   whose scope has live violations must either narrow its scope or arrive with a
   registered exemption set, which is CI06U_REGISTER's precedent. DECIDE WHICH
   AND SAY WHY. W8 cannot make that decision at implementation time.

   status: proposed, with an unsigned approval line.

RULES. pnpm install first. Session-log stub is the first commit, its row appended
to docs/sessions/README.md, number 113. Commit and push after each file. The
fence is absolute. Verify by running: node scripts/corpus/gates.mjs check and
pnpm exec vitest run both green, with output quoted. Run node
scripts/corpus/gates.mjs generate and commit the result. Report the count
honestly. Never weaken a gate to pass it. Cite the review desk or an ADR, NEVER
"founder ruling" (CI-06q). Open the pull request yourself, ready for review. Do
not merge.

STOP CONDITION. One survey, one ADR. Stop. Do not write the gate.
```

---

### W7: `CI-09`, the nightly workflow (session 114, AFTER `W5` MERGES)

```
Branch: claude/wave04-w7-ci09-nightly   (from origin/main, AFTER W5 has merged)
Fence:  .github/workflows/, scripts/ci/, plus your session log.
        DO NOT TOUCH docs/testing/STRATEGY.md: ADR-073 already edited CI-09's
        row and yours is the implementation, not the description. DO NOT TOUCH
        scripts/corpus/.

READ ADR-073 FIRST. It ruled which of CI-09's four legs you build and which carry
an activation condition. BUILD EXACTLY WHAT IT RULED AND NOTHING ELSE. If it
ruled a leg out, do not build it because it looks easy; if it ruled one in and
you cannot build it, stop and report that in the pull request.

OBJECTIVE. The nightly workflow, on a schedule, with the ruled legs.

The two legs with a subject in this tree, for orientation and NOT as authority
over ADR-073:
  packages/harness   the Monte Carlo harness, DEP-M21-01. It folds the REAL
                     engine and it has its own assertions. Session 106's landmine
                     is that "nothing calls it". CI-09 IS ITS CONSUMER.
  apps/worker/src/batch/replay.ts   the replay self-audit.

A NIGHTLY GATE THAT NOBODY WATCHES FAIL IS THE FAILURE CLASS THIS REPOSITORY
KEEPS FINDING. Say in the pull-request body how a failure is seen: what the job
does on a red run and who or what reads it. If the answer is "the Actions tab",
say that plainly rather than implying more.

pnpm install IS THE FIRST STEP OF THE JOB, not an assumption. packages/harness is
a workspace package and a runner without it reads as five failing suites.

RULES. pnpm install first, locally too. Session-log stub is the first commit, its
row appended to docs/sessions/README.md, number 114. Commit and push after each
file. The fence is absolute. Verify by running: node scripts/corpus/gates.mjs
check and pnpm exec vitest run both green, with output quoted, AND by running the
job's own command locally and quoting that too. A workflow that has never been
run is a workflow that has never passed. Report the count honestly. Never weaken
a gate to pass it. Cite the review desk or an ADR, NEVER "founder ruling"
(CI-06q). Open the pull request yourself, ready for review. Do not merge.

STOP CONDITION. One workflow and whatever runner script it needs under
scripts/ci/. Stop. Do not build CI-07 and do not build CI-08.
```

---

### W8: the four `CI-06` slug gates, four commits, in order (session 115, LAST AND ALONE)

```
Branch: claude/wave04-w8-slug-gates   (from origin/main, AFTER W1, W5, W6 AND W7
        HAVE ALL MERGED)
Fence:  scripts/corpus/, docs/testing/STRATEGY.md, plus your session log.
        YOU ARE THE ONLY SESSION IN THIS WAVE THAT WRITES gates.mjs. Nothing
        else may be open against it.

Under ADR-065 a new gate takes a SLUG and needs no letter and no ALLOCATION row.
CI-06w reads gate ids out of the GATES array, so the registration and the
implementation are the same line and cannot drift apart. The letter table is
untouched by this session.

FOUR GATES, FOUR COMMITS, IN THIS ORDER. THE ORDER IS FIXED BECAUSE TWO OF THEM
READ A FILE AN EARLIER SESSION WROTE.

1. CI-06/conflict-markers. No tracked file carries a line beginning with the
   three markers git writes into a file it could not merge.

   READ THIS BEFORE YOU WRITE THE FALSIFICATION CASE. THE RECORD SAYS "<<<<<<<
   HEAD stood in INDEX and STATE while the gates passed". IT NEVER STOOD IN A
   COMMIT. No commit reachable from any branch head or any pull-request head has
   ever carried a leading marker in any .md, .ts, .mjs or .json file:
     git log --all -G'^<<<<<<< ' -- '*.md' '*.ts' '*.mjs' '*.json'
   returns nothing. Run it yourself. It stood in a WORKING TREE during a merge.
   The record also disagrees with itself on the count, 22 in session 105 and
   STATE, 24 in session 106.

   TWO THINGS FOLLOW AND BOTH MATTER. The gate is still worth writing, because
   the boundary it protects is the push and not the history. AND ITS FALSIFY CASE
   MUST SEED A MARKER RATHER THAN ANCHOR ON A HISTORICAL ONE, because there is no
   historical one. That is the better outcome: OI-21 records that a harness
   anchored to corpus state decays as the corpus is repaired, and a seeded anchor
   does not.

   Say all of this in the gate's own comment block. A gate justified by a claim
   the tree refutes is the thing this repository keeps finding.

2. CI-06/fixture-inventory. Reads W1's
   docs/testing/golden-scenarios/39-fixture-status-and-blockers.md. Assert, in
   both directions: every GS-nnn in the registry has exactly one row; every
   fixture on disk has a `written` row; no row claims `written` without both
   files present; every non-written row names a blocker from the closed
   vocabulary AND a citation.

   THIS IS THE DIRECTION STRATEGY ALREADY NAMES AND HAS NEVER SWITCHED ON. CI-03
   reports it on every run in its own words: "The inventory check for a registry
   row with no fixture is CI-06's and is not switched on."

3. CI-06/gate-inventory. Reads STRATEGY section 4.1 as W5 left it. Every stage
   row is implemented in a workflow under .github/workflows/, or carries a dated
   activation condition naming an artifact, and every named artifact resolves.

   IT MUST SEE CI-09 AS IMPLEMENTED. If it does not, W7 has not merged and you
   are running out of order. Stop.

4. CI-06/identifier-series. Implements ADR-074 EXACTLY AS RULED. Its scope, its
   exemptions and its definition-site parse are ADR-074's, not yours. IF THE
   RULING AND THE TREE DISAGREE, THAT IS A FINDING FOR THE PULL REQUEST AND NOT A
   LICENCE TO RE-SCOPE. ADR-074 also already decided whether the gate arrives
   blocking or with a registered exemption set; follow it.

EACH GATE ARRIVES WITH ITS falsify.mjs CASE AND ITS STRATEGY SECTION 4.4 ROW, IN
THE SAME COMMIT. A gate with no falsification case is a gate nobody has watched
fail, and falsify.mjs is what makes "fails dirty" a measurement instead of a
claim.

RULES. pnpm install first. Session-log stub is the first commit, its row appended
to docs/sessions/README.md, number 115. COMMIT AND PUSH AFTER EACH GATE, not at
the end: four gates in one push is four times the blast radius on the one file no
other session may touch. The fence is absolute. Verify by running, after every
gate: node scripts/corpus/gates.mjs check and pnpm run falsify, both green, with
output quoted. Run node scripts/corpus/gates.mjs generate and commit the result;
gate_count moves from 24 to 28 across every span that carries it. REPORT THE
COUNT HONESTLY: TWO LANDED GATES BEAT FOUR THIN ONES, and a session low on
context says so and stops rather than starting a third. Never weaken a gate to
pass it. Cite the review desk or an ADR, NEVER "founder ruling" (CI-06q). Open
the pull request yourself, ready for review. Do not merge.

STOP CONDITION. Four gates, or fewer with the count reported and the remainder
named for the next session. Stop.
```

---

## 10. What this plan does not do

- **It does not queue 276 fixtures**, and section 2 is the argument. It queues
  **sixteen** and a registry that makes the other 260 checkable.
- **It does not write the second fixture shape.** Tier 2's fourteen wait on rulings this
  wave does not make: a publish-time expectation, where a replay golden runs, a
  multi-account fold, and a calendar record key for the session open and close. **Four
  rulings, and they are the next planning session's first item**, not four builds.
- **It does not build `CI-07` or `CI-08`.** There is no production build and no installed
  Playwright. `ADR-073` gives each an activation condition and `CI-06/gate-inventory`
  makes the condition load bearing.
- **It does not touch M02** and nothing in it waits on the vendor call.
- **It does not repair the three findings in section 5.** Each needs a file this wave
  fences to somebody else; the first two are named in the prompts that hold the
  neighbouring file.
- **It does not close P1.** `ADR-073` says what closing P1 would mean and
  `CI-06/gate-inventory` makes the claim checkable. **Closing it needs a build system and
  a UI, which are modules and not gates.**
