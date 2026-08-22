---
status: draft
depends_on:
  [
    P2-rules-engine.md,
    M01-rules-engine.md,
    ../DELIVERY_PLAN.md,
    ../testing/STRATEGY.md,
    ../decisions/ADR-073.md,
    ../decisions/ADR-074.md,
    ../decisions/ADR-076.md,
    WAVE-01-post-freeze-parallel-sessions.md,
  ]
last_updated: 2026-08-22
---

# P2 build: eight sessions, and six of P2's stated contents already exist

**[P2](P2-rules-engine.md) was written on 2026-08-16 and its session sequence has been overtaken.** Sessions executed `P2-8`'s content before `P2-7`'s, the engine reached its full rule set, and three of the five things [DELIVERY_PLAN section 4](../DELIVERY_PLAN.md) lists as P2's contents landed without any entry recording that they had. **This document is the measurement and the dispatch. It carries no ruling of its own**, and every decision below is cited to the entry that took it.

**Measured at `edb2e13` on 2026-08-22.** Every figure here was re-derived by running the command named beside it, never inherited from a prior entry. Two premises the briefing carried did not survive that, and one finding a landed session recorded turned out to be false against the tree. Both are in section 4.

---

## 1. The tree, measured

| Measurement | Command | Result |
|---|---|---|
| Gates | `node scripts/corpus/gates.mjs check` | **28 of 28 pass** |
| Falsification | `node scripts/corpus/falsify.mjs` | **28 pass clean and fail dirty, 52 scope cases, 10 loader cases** |
| Tests | `pnpm vitest run` | **101 files, 1,410 passed, 45 skipped** |
| Fixtures | `CI-06/fixture-inventory` | **316 rows, 43 on disk: 43 written, 1 writable, 266 blocked, 6 covered-elsewhere** |
| Identifier series | `CI-06/identifier-series` | **115 series over 1,070 members**, against [ADR-074](../decisions/ADR-074.md)'s signed 117 and 1,083 |
| Gate inventory | `CI-06/gate-inventory` | **10 stage rows: 5 implemented, 1 implemented and conditioned, 3 with no implementation leg, 1 discharged outside Actions** |
| Rules declared | `IMPLEMENTED_RULES` in [`rules.ts`](../../packages/rules-engine/src/rules.ts) | **46 of 50** |
| Golden polarity | the CI-03 coverage block, re-derived per run | **43 derive direct, 0 derive inverted**, every group A to H at 100 percent |

---

## 2. P2's five stated contents, against the tree

[DELIVERY_PLAN section 4](../DELIVERY_PLAN.md) gives P2 *"the engine, the entire section 5.1 to 5.3 test stack, the synthetic Rithmic simulator in both file and streaming modes, the nightly batch, the replay self-audit"*, with the done-condition *"all engine-executable golden files green, the eight `PT-nn` properties green, the harness running nightly with its bands"*.

| Stated content | State | Where it is |
|---|---|---|
| **The engine** | **Two files short of done** | [`packages/rules-engine/src`](../../packages/rules-engine/src/index.ts): 17 source files, six exported functions, the calendar four, 19 `CV` validations, 46 of 50 rules |
| **STRATEGY 5.1**, unit and property | **DONE for the seven P2 owns.** `PT-06`'s arrival-order half is skipped by derivation | [`packages/rules-engine/test`](../../packages/rules-engine/test/property-harness.ts), [`replay-determinism.property.test.ts`](../../scripts/demo/test/replay-determinism.property.test.ts) |
| **STRATEGY 5.2**, golden replay files | **DONE at 43 of 43 written, all direct, all green** | [`packages/golden-loader`](../../packages/golden-loader/README.md), [`golden.yml`](../../.github/workflows/golden.yml) |
| **STRATEGY 5.3**, simulation harness | **DONE**, and `CI-09` nightly consumes it | [`packages/harness`](../../packages/harness/README.md), [`nightly.yml`](../../.github/workflows/nightly.yml) |
| **The simulator, file AND streaming** | **BOTH DONE** | [`emit.ts`](../../packages/rithmic/src/simulator/emit.ts) and [`stream.ts`](../../packages/rithmic/src/simulator/stream.ts) |
| **The nightly batch** | **DONE** | [`apps/worker/src/batch`](../../apps/worker/src/batch/nightly.ts) |
| **The replay self-audit** | **DONE**, asserted at 250-day scale by [session 129](../sessions/2026-08-22-session-129.md) | [`apps/worker/src/batch/replay.ts`](../../apps/worker/src/batch/replay.ts) |
| **`RE-D-01`, `RE-D-02`, `RE-D-03`** | **DONE and falsified**, though [STATE](../STATE.md) records them as *"Nothing"* three times | [`determinism.test.ts`](../../packages/golden-loader/test/determinism.test.ts), `RI-07` in [`repo-invariants.mjs`](../../packages/tooling/checks/repo-invariants.mjs), five cases in [`falsify-ci.mjs`](../../scripts/ci/falsify-ci.mjs) |

**Six of the eight rows are done and no entry says so.** That is the answer this plan was asked for, and it is the same shape [ADR-072](../decisions/ADR-072.md) found when it measured the fixture backlog at sixteen against a plan that said 276.

### 2.1 The engine's rule set is complete, and 46 is not 50 for a stated reason

`R-01`, `R-05`, `R-11` and `R-20` are not a backlog. [`rules.ts`](../../packages/rules-engine/src/rules.ts) argues each: `R-01` is a containment lookup over a fill's execution timestamp and `DailyMark` carries `fillCount` and no instant; `R-05`'s session bounds are two columns `CalendarDay` does not carry; `R-11` is the caller's live-mark predicate and `R-20` is the platform setpoint. **Neither `R-01` nor `R-05` is waiting on the calendar transcription**, and the file says why in its own words: *"Transcribing the CME year adds rows, not columns, so it unblocks their GOLDEN files and not the rules."*

### 2.2 CI-03's polarity flip finished and nothing recorded it

[P2 section 3](P2-rules-engine.md) designed a per-fixture polarity derived from the rules a fixture cites, so that groups would flip one at a time with no fixture edited and no flag introduced ([ADR-048](../decisions/ADR-048.md)). **It worked all the way through.** The coverage block re-derives on every run and reports 43 direct and 0 inverted, `declaration.holds` is true so the derived direction is **enforced** rather than reported, and all eight rule groups are at 100 percent direct.

**The 43 skipped tests in the suite are the retired half of that mechanism**, the `describe.runIf(!declaration.holds)` block, which asserted that every fixture must NOT match. It can never run again. Retiring it is session `P2-f` below.

---

## 3. What is actually left

### 3.1 `replay` is not exported, and three things wait behind it

[M01 section 1.3](M01-rules-engine.md)'s layout lists `replay.ts`, section 3.7 writes `export function replay`, and 1.3's prose says *"the public surface is six functions"* and does not list it. [`index.ts`](../../packages/rules-engine/src/index.ts) already ruled the identical contradiction about `clampPayout` on the ground that section 1.3 wins. **Here two of the three sites say export and one does not**, which is the opposite balance, so the reading is not obvious and it is `ADR-078`'s.

Three artifacts are gated on the export, and each is measurable today:

| Waiting | State |
|---|---|
| `PT-06`'s arrival-order permutation | `describe.skipIf(!replayExists)` in [`replay-determinism.property.test.ts`](../../scripts/demo/test/replay-determinism.property.test.ts), and **its body throws** the day it switches on |
| `GS-071`'s registry row | the single `writable` row in [section 39](../testing/golden-scenarios/39-fixture-status-and-blockers.md) |
| M01 3.7's *"there is no second code path"* | [`auditAccount`](../../apps/worker/src/batch/replay.ts) folds `advanceDay` itself, which is a second expression of one fold |

### 3.2 `hash.ts` is not in the engine, and the condition that held it out has been met

The [2026-08-17 review desk](../reviews/2026-08-17-review-desk.md) ruling 2 held [`state-hash.ts`](../../apps/worker/src/batch/state-hash.ts) in `apps/worker` **until `RE-D-03` landed**. It has landed, as `RI-07`. The file's own header states the half that is still open: `merit/engine-purity` reports every non-relative import inside `packages/rules-engine/src/**`, while [M01 section 1.4](M01-rules-engine.md)'s banned-constructs table permits *"`crypto` beyond a pure hash"*. **The prose allows the import the rule refuses**, and the header says the choice between a scoped lint exception and a hand-rolled SHA-256 is *"not a decision to make in passing"*. `ADR-081`.

### 3.3 One `CHECK` refuses every eval-pass row the engine is specified to produce

[`0015:193`](../../packages/db/migrations/0015_rule_states.sql)'s `rule_states_consistency_period_started` requires `consistency_period_start_day <= trading_day`. [`progression.ts:339`](../../packages/rules-engine/src/day/progression.ts) sets `consistencyPeriodStartDay` to the trading day **after** the pass day, which is `R-47` and `AS-12` read correctly: [M01:987](M01-rules-engine.md) says the period is *"trading days strictly after the anchor"* and *"the eval pass day is excluded"*. Observed on [session 129](../sessions/2026-08-22-session-129.md)'s own row 0: `trading_day=2026-01-01 period_start=2026-01-02`.

**The rule is right and the constraint is right about the case it was written for.** Settlement gets equality, because `R-47`'s basis day is the previous closed day. What nobody checked is that a period may legitimately start on a day that has not happened yet. `0015` is merged, so only an ADR moves it. `ADR-079` and migration `0046`.

**Nothing in P2's stated done-condition could have caught this**, because CI-03 folds the engine and never touches a database. It is the highest-value item in the phase and it is the reason `P2-c` is money path with the founder's `E2` read.

### 3.4 Four hygiene items, each already named by a landed session

| Item | Named by |
|---|---|
| [ADR-074](../decisions/ADR-074.md) section 8's runner edits, without which a signed ruling and a live blocking gate disagree by two series | [session 126](../sessions/2026-08-21-session-126.md)'s **Next** |
| The retired pre-`ADR-048` golden block, plus `polarity.ts`'s stale claim that the loader folds `evaluate` when it folds `advanceDay` | this document, section 2.2 |
| [Section 39](../testing/golden-scenarios/39-fixture-status-and-blockers.md)'s line numbers into [`plan-validate.test.ts`](../../packages/rules-engine/test/plan-validate.test.ts), stale after `X3` and `X4` | [session 131](../sessions/2026-08-22-session-131.md)'s **Next** |
| [`fixtures/README.md`](../../packages/rules-engine/fixtures/README.md) reciting [ADR-077](../decisions/ADR-077.md)'s falsified *"23 hour and 25 hour"* clause a third time | [session 130](../sessions/2026-08-22-session-130.md)'s owed list |

### 3.5 The ruling [ADR-073](../decisions/ADR-073.md) section 8 named and deliberately did not take

Extending disposition (b) to [STRATEGY section 4.2](../testing/STRATEGY.md)'s twelve `VG` rows. Three are wired. ADR-073 declined it on the shape rather than the effort: **a `VG` row's activation condition is its stage, so the conditions chain, and a chained condition is a shape no entry has ruled.** It is named there *"so the next session proposes it rather than assuming this one covered it"*, and it has been unowned since 2026-08-20. `ADR-080`, and like `ADR-073` it writes no gate.

---

## 4. Three claims checked against their sources, and one did not survive

**This is the section [CLAUDE.md](../../CLAUDE.md) asks for**, on its own statement that the reconciliation session's three worst errors *"were not capability failures. Each was a failure to check a claim against the primary source."*

### 4.1 The simulator is NOT file-mode only

The briefing carried *"`packages/rithmic` 12 files, the day-model simulator. FILE MODE ONLY"*. [`stream.ts`](../../packages/rithmic/src/simulator/stream.ts) exists, [`index.ts`](../../packages/rithmic/src/index.ts) exports `streamRun`, `foldStream`, `sampleTicks`, `StreamOptions` and `LiveAccountTick`, and [`stream.test.ts`](../../packages/rithmic/test/stream.test.ts) asserts the streaming path folds back to the file summary exactly, in integer cents. It landed in merge `0b526c8`. **P2's simulator content is complete in both modes and this plan schedules nothing for it.**

### 4.2 Session 129's SECOND finding is false against the tree, and this is the correction that matters

[Session 129](../sessions/2026-08-22-session-129.md) recorded two money-path findings. The first is real and is section 3.3 above. **The second is not.**

It reads: *"`R-15`'s permanent lock makes a rising funded life unstorable after the lock day"*, citing [`0015:208`](../../packages/db/migrations/0015_rule_states.sql)'s `rule_states_high_water_bounds_balance`.

**That constraint was superseded on 2026-08-17 by [`0037`](../../packages/db/migrations/0037_supersede_rule_states_high_water_bounds_balance.sql), under [ADR-053](../decisions/ADR-053.md), which is `accepted`.** The migration drops `rule_states_high_water_bounds_balance` and adds `rule_states_high_water_bounds_balance_unlocked`, scoped so that the bound holds only while the floor is unlocked. `0037`'s own header states the arithmetic on the exact case session 129 described, and [ADR-053](../decisions/ADR-053.md)'s title is *"the high-water bound holds only while the floor is unlocked, and what it stops asserting is the ruling"*.

**The defect is not that the finding was wrong. It is that a session read a merged migration and did not ask whether a later one had superseded it**, which is the one question `E2`'s never-edit-only-supersede rule makes mandatory before citing any constraint by file and line. Every `0015` citation in the corpus is now suspect in the same way, and **checking them is not this plan's and is not P2's**: it is named here so the next session that holds `packages/db/DELTA_MANIFEST.md` proposes it.

**What it changes here:** `ADR-079` is one ruling with one application, not two, and `0046` moves one constraint rather than two. The plan is smaller than the finding it was briefed on.

### 4.3 The engine is at 46 of 50 declared, not 45, and all six functions are exported

[STATE](../STATE.md) records *"45 of 50 rules declared, four of M01's six exported functions"*. The tree is at 46 and six. `R-19` and `R-17` left the undeclared list when group H and `validatePlan` landed, and [`index.ts`](../../packages/rules-engine/src/index.ts) exports `resolvePlan`, `validatePlan`, `initialState`, `advanceDay`, `applySettlement` and `evaluatePayout`.

---

## 5. The registries this plan spends, allocated before any session starts

**Every number below is claimed in [ALLOCATION](../decisions/ALLOCATION.md) and in [sessions/README](../sessions/README.md) in this plan's own first commit.** No session dispatched from this document reads a register and takes the next free row. That is what [session 120](../sessions/2026-08-21-session-120.md) did, and it is how `OI-27` was created.

| Registry | Claimed | For |
|---|---|---|
| ADR | `078`, `079`, `080`, `081` | `P2-b`, `P2-c`, `P2-d`, `P2-g` |
| Migration | `0046` | `P2-c` |
| Session number | `132` for this planning session, `133` to `140` | one per session below |

**[ALLOCATION](../decisions/ALLOCATION.md) is touched by four of the eight sessions and is the one shared file in this plan.** It is not made serial, and the mitigation is that the numbers are pre-assigned: each session appends only its own row, at its own pre-assigned number, and **never reflows the table**. A session that finds its number already taken stops and reports rather than moving.

---

## 6. The wave

**Fences are by file.** Two lessons are applied literally, both paid for:

- **A session fenced out of the file that validates its change cannot end green.** [Session 127](../sessions/2026-08-22-session-127.md) added a status value and was forbidden [`gates.mjs`](../../scripts/corpus/gates.mjs), where `FIXTURE_STATUSES` lives, and ended red on nine findings through no fault of its own. **Where a change has a validating half, the fence holds both halves.**
- **A depends-on column reads per item and collisions are per file.** If two sessions touch one file they are one session or they are ordered.

### Wave 1: five sessions, dispatched together

| # | Session | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **133** | `P2-a` [ADR-074](../decisions/ADR-074.md) section 8's runner edits | `scripts/corpus/gates.mjs`, `scripts/corpus/falsify.mjs` | no | nothing |
| **134** | `P2-b` `replay` joins the public surface (`ADR-078`) | `packages/rules-engine/src/replay.ts`, `packages/rules-engine/src/index.ts`, `packages/rules-engine/test/replay*`, `packages/rules-engine/test/evaluate*`, `scripts/demo/test/replay-determinism.property.test.ts`, `docs/decisions/ADR-078.md` | **yes** | nothing |
| **135** | `P2-c` the eval-pass `CHECK` (`ADR-079`, `0046`) | `docs/decisions/ADR-079.md`, `packages/db/migrations/0046_*.sql`, `packages/db/DELTA_MANIFEST.md`, `packages/db/test/`, `scripts/db/probe_*.sql`, `docs/architecture/data-model/rule_states.md` | **yes, `E2`** | nothing |
| **136** | `P2-d` the chained `VG` conditions (`ADR-080`) | `docs/decisions/ADR-080.md`, `docs/testing/STRATEGY.md` | no | nothing |
| **137** | `P2-f` retire the pre-`ADR-048` golden block | `packages/golden-loader/test/fixtures.golden.test.ts`, `packages/golden-loader/src/polarity.ts`, `packages/golden-loader/src/run.ts`, `packages/golden-loader/src/coverage.ts`, `packages/golden-loader/src/index.ts` | no | nothing |

**Why `134` and `137` do not collide**, though both concern the engine's surface: `134` owns `packages/rules-engine/**` and `137` owns `packages/golden-loader/**`. **`134` must not touch the loader and `137` must not touch the engine.** `137`'s fence holds `run.ts`, where `engineIsIdentityStub` lives, so its own removal is validated inside it.

**Why `134`'s fence reaches into `scripts/demo/`**: exporting `replay` flips `describe.skipIf(!replayExists)` on, and its body throws by design. **A session fenced out of that file ships a red tree through no fault of its own**, which is session 127's failure exactly.

### Wave 2: two sessions, after wave 1 merges

| # | Session | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **138** | `P2-g` `hash.ts` into the engine (`ADR-081`) | `packages/rules-engine/src/hash.ts`, `packages/rules-engine/src/index.ts`, `apps/worker/src/batch/state-hash.ts`, `apps/worker/src/batch/nightly.ts`, `apps/worker/test/state-hash.test.ts`, `docs/decisions/ADR-081.md` | **yes** | **134**, via `packages/rules-engine/src/index.ts` |
| **139** | `P2-e` section 39, `GS-071`, and the third recitation | `docs/testing/golden-scenarios/39-fixture-status-and-blockers.md`, `packages/rules-engine/fixtures/README.md`, `scripts/corpus/gates.mjs` | no | **133**, via `scripts/corpus/gates.mjs` |

**`139` holds [`gates.mjs`](../../scripts/corpus/gates.mjs) in its fence deliberately, even though it should not need it.** `covered-elsewhere` entered `FIXTURE_STATUSES` in [session 131](../sessions/2026-08-22-session-131.md) and the counts derive, so moving `GS-071` should be a pure document edit. **Session 127 was fenced out of exactly this file for exactly this shape of change**, so the fence holds the validating half and `133` is ordered ahead of it so the file is free.

### Wave 3: one session

| # | Session | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **140** | `P2-h` the worker's audit folds the engine's `replay` | `apps/worker/src/batch/replay.ts`, `apps/worker/test/replay.test.ts` | **yes** | **134** for the export, **138** for `apps/worker/src/batch/` |

---

## 7. The rules every prompt below carries, written once here

Each prompt restates the ones it needs. They are collected here so a ninth session can be written without re-deriving them.

1. **The session-log stub is the first commit.** Write `docs/sessions/2026-08-22-session-<N>.md` with the objective and `placeholder` for every other field, strike your row in [sessions/README](../sessions/README.md), commit, push. **Then do the work.**
2. **Commit and push after each file.** Not at the end.
3. **The fence is absolute.** If the work needs a file outside it, **stop and report it in the pull-request body** rather than reaching.
4. **[STATE](../STATE.md): append one `##` section at the END.** Edit no existing line and do not touch `## Next 3 actions`.
5. **Your ADR number and your migration number are allocated in section 5.** Do not read the register and take the next one you can see. **Amend your reservation IN PLACE** when the file lands ([ADR-065](../decisions/ADR-065.md) T3, enforced by `CI-06f`), and write it unlinked until then, because `CI-06a` fails on a link to an absent document.
6. **Open the pull request yourself, as ready for review. Do not merge it.**
7. **Verify by running, never by reading.** `node scripts/corpus/gates.mjs check` and `pnpm vitest run` leave green, and every completion claim in the pull-request body ships with its command and output.
8. **Report the count honestly.** *"I am at 3 of 5"* beats five thin files.
9. **Never weaken a gate to pass it and never widen a fence to finish.** They are the same move.
10. **Authority citations must resolve, and a merged constraint is checked for a superseding migration before it is cited.** Section 4.2 is what happens when it is not.

**Money-path sessions (`134`, `135`, `138`, `140`) additionally: plan mode, fresh context, one objective, [ADR-003](../decisions/ADR-003.md) strict.**

---

## 8. The prompts

Each block is complete. Paste one into a fresh session and change nothing.

---

### `P2-a`: ADR-074 section 8's runner edits (session 133)

```
Branch: claude/p2a-adr074-runner-edits   (create from origin/main)
Fence:  scripts/corpus/gates.mjs, scripts/corpus/falsify.mjs,
        docs/STATE.md (append only), docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE.
Regime: non-money. One objective. Your session-log number is 133.

OBJECTIVE
Make CI-06/identifier-series read ADR-074's amended scope, so the gate reports
117 series over 1,083 census members with zero findings.

WHY NOW. ADR-074 is SIGNED and its approval line records, in its own words,
that "a signed ruling and a live gate disagree by two series, knowingly" until
these edits land. The gate is NOT wrong about the tree; it reads the scope as
it stood before the 2026-08-21 amendment.

THE EDITS. ADR-074 section 8 lists five and there is a SIXTH this plan found:

  1. OQ-F6 moves from the pending register into DECLARED_SERIES, register
     docs/decisions/ADR-067.md.
  2. P-M6 moves from the pending register into DECLARED_SERIES, register
     docs/plans/M06-admin-ops-console.md.
  3. A THIRD table joins the two, holding WITHHELD members in the same idiom:
     a closed list, one argued entry each, one entry today (P-M6-11). Its
     members are EXCLUDED from the census and it fails in BOTH directions,
     per ADR-074 section 5.1.
  4. The row test STRIPS LEADING WHITESPACE, so an indented table row is a row.
     OQ-F6's rows are indented inside a list item in ADR-067, which is the
     second reason they were unreadable.
  5. The comment heading the module class reads 93 and the block below it
     holds 92. Edit 2 makes the comment right.
  6. THE GATE'S OWN NOTE. Run the gate today and it says "ADR-074 section 3
     states 118 declared and 1,086 members and section 5 states 44 pending".
     Those are the PRE-AMENDMENT figures. Section 3.1 retraced them to 117 and
     1,083 and section 8 narrowed the pending class to ten. The note must cite
     the amended sections or it reproduces the error ADR-074 was signed to end.
     Section 8 does not list this edit; this plan does.

DO NOT re-scope the gate to make a number come out. ADR-074 rejected that by
name: "adjust the counts until they agree, and say nothing about where they
came from."

STOP CONDITION
`node scripts/corpus/gates.mjs check CI-06/identifier-series` reports 117
series over 1,083 members and zero findings, `node scripts/corpus/falsify.mjs`
is green with the new withheld-table case watched failing in both directions,
and 28 of 28 gates pass. Amend nothing in ADR-074: it is signed.
```

---

### `P2-b`: `replay` joins the public surface (session 134, MONEY PATH)

```
Branch: claude/p2b-adr078-replay-export   (create from origin/main)
Fence:  packages/rules-engine/src/replay.ts (new),
        packages/rules-engine/src/index.ts,
        packages/rules-engine/test/replay*.ts (new),
        packages/rules-engine/test/evaluate.test.ts,
        packages/rules-engine/test/evaluate.property.test.ts,
        scripts/demo/test/replay-determinism.property.test.ts,
        docs/decisions/ADR-078.md (new), docs/decisions/ALLOCATION.md (your row only),
        docs/STATE.md (append only), docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE. In particular: NOT packages/golden-loader (session 137
        holds it) and NOT apps/worker (session 138 and 140 hold it).
Regime: MONEY PATH. PLAN MODE. Fresh context. One objective. ADR-003 strict.
        Your session-log number is 134. Your ADR number is 078, already
        reserved in docs/decisions/ALLOCATION.md. Amend that row IN PLACE when
        the file lands (ADR-065 T3, CI-06f enforces it).

OBJECTIVE
Write ADR-078 and export `replay` from packages/rules-engine.

THE RULING FIRST, BECAUSE IT IS NOT OBVIOUS. M01 contradicts itself in three
places and this session decides which wins:
  - section 1.3's LAYOUT lists `replay.ts`
  - section 3.7 writes `export function replay(...)` with its full signature
  - section 1.3's PROSE says "the public surface is six functions" and does
    not list it
index.ts ALREADY resolved the identical contradiction about `clampPayout`, on
the ground that section 1.3 wins. Here TWO of the three sites say export and
ONE does not, which is the opposite balance. Read all three before you rule.

WHAT WAITS BEHIND IT, all three measurable today:
  - PT-06's arrival-order permutation, skipped by derivation
  - GS-071's registry row, the single `writable` row in section 39
  - M01 3.7's "there is no second code path", which apps/worker satisfies
    today by folding advanceDay itself

**YOUR FENCE INCLUDES scripts/demo/test/replay-determinism.property.test.ts
AND THAT IS NOT OPTIONAL.** That file reads the engine's public surface:
`const replayExists = Object.keys(engine).includes('replay')`. The moment you
export, `describe.skipIf(!replayExists)` switches ON and its body THROWS by
design, with the message "the engine now exports `replay`, so PT-06s
permutation half is expressible and must be written". Write that assertion in
this session. A session fenced out of it ships a red tree.

ALSO DELETE `evaluate` AND ITS TWO TEST FILES. It is the scaffold's identity
stub, M01 section 1.3 does not list it among the six, and nothing folds it:
`engineIsIdentityStub` in the loader folds advanceDay, and `runFixture` folds
advanceDay. Check that claim yourself before you delete anything.

M01 3.7's pseudocode is the specification: a total order by trading day then
id, `advanceDay` per mark, a throw on any assertion, and a break at `closed`
or `graduated`. Do not invent a second fold.

APPROVAL LINE. Unsigned, naming one checkable clause and what it costs if
wrong. Candidate: "`pnpm vitest run scripts/demo` reports PT-06's
arrival-order permutation LIVE and passing, and the engine's public surface
gains exactly one name." Cost if wrong: a seventh export widens the surface
M01 1.3 narrowed on purpose.

STOP CONDITION
`replay` exported, its permutation property written and passing, `evaluate`
gone, 28 of 28 gates, `falsify.mjs` green, `pnpm run verify` green. Do NOT
move GS-071's registry row: session 139 holds that file.
```

---

### `P2-c`: the eval-pass `CHECK` (session 135, MONEY PATH, E2 READ)

```
Branch: claude/p2c-adr079-0046-consistency-period   (create from origin/main)
Fence:  docs/decisions/ADR-079.md (new), docs/decisions/ALLOCATION.md (your two rows only),
        packages/db/migrations/0046_*.sql (new), packages/db/DELTA_MANIFEST.md,
        packages/db/test/, scripts/db/probe_*.sql (new),
        docs/architecture/data-model/rule_states.md,
        docs/STATE.md (append only), docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE. In particular: NOT packages/rules-engine. The rule
        is right; the constraint moves.
Regime: MONEY PATH. PLAN MODE. Fresh context. One objective. ADR-003 strict.
        E2: this branch waits on the founder's line-by-line read and must not
        be merged before it. Your session-log number is 135. Your ADR number
        is 079 and your migration number is 0046, both already reserved.

OBJECTIVE
Write ADR-079 and migration 0046. One constraint, superseded.

THE DEFECT. 0015_rule_states.sql:193

  CONSTRAINT rule_states_consistency_period_started CHECK (
    consistency_period_start_day IS NULL
    OR consistency_period_start_day <= trading_day
  ),

packages/rules-engine/src/day/progression.ts:339 sets
`consistencyPeriodStartDay: nextDay.day.tradingDay` on the eval pass day. The
row that day writes carries trading_day = the pass day and
consistency_period_start_day = the day AFTER it. Observed by session 129 on
its own row 0: trading_day=2026-01-01 period_start=2026-01-02. EVERY EVAL PASS
IN THE BOOK WOULD BE REJECTED BY POSTGRES ON INSERT.

THE ENGINE IS RIGHT. R-47 and AS-12: M01:987 says the period is "trading days
strictly after the anchor" and "the eval pass day is excluded". Settlement
rows are fine and get equality, because R-47's basis day is the previous
closed day. What nobody checked is that a period may legitimately start on a
day that has not happened yet.

0037_supersede_rule_states_high_water_bounds_balance.sql IS YOUR MODEL AND
YOUR PRECEDENT. Read it and ADR-053 in full before you write a line. Same
shape, one screen away in the same migration, ruled five days ago. Note in
particular that ADR-053 REFUSED to reuse the old constraint name, because that
would leave every existing reference pointing at a constraint whose meaning
had changed. Decide the same question here and say what you decided.

DECIDE AND STATE WHAT THE NEW PREDICATE STOPS ASSERTING. That is ADR-053's
own framing and it is the ruling, not the repair.

THE PROBE ASSERTS IN BOTH DIRECTIONS. The eval-pass row inserts clean against
a database at 0046 and is REFUSED against one at 0045, naming the constraint.
Run it. Do not quote a prediction.

**BEFORE YOU CITE ANY OTHER 0015 CONSTRAINT, GREP THE MIGRATION DIRECTORY FOR
A SUPERSEDING ONE.** Session 129 reported a second finding against 0015:208
that was already repaired by 0037 on 2026-08-17. Do not reproduce that.

APPROVAL LINE. Unsigned, one checkable clause. Candidate: "the probe inserts
the eval-pass row clean at 0046 and is refused at 0045 naming
rule_states_consistency_period_started." Cost if wrong: a merged money-table
constraint is superseded for a case that does not occur.

STOP CONDITION
One ADR, one migration, one probe run in both directions, DELTA_MANIFEST rows,
the data-model page, 28 of 28 gates, all 46 migrations applying forward-only
into an empty PostgreSQL 16. DO NOT MERGE. E2 read pending.
```

---

### `P2-d`: the chained `VG` conditions (session 136)

```
Branch: claude/p2d-adr080-vg-chained-conditions   (create from origin/main)
Fence:  docs/decisions/ADR-080.md (new), docs/decisions/ALLOCATION.md (your row only),
        docs/testing/STRATEGY.md,
        docs/STATE.md (append only), docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE. WRITE NO GATE. scripts/corpus/ is session 133's.
Regime: non-money. One objective. Your session-log number is 136. Your ADR
        number is 080, already reserved.

OBJECTIVE
Propose ADR-080: what closes a VG row, extending ADR-073's disposition (b) to
STRATEGY section 4.2's twelve.

THIS RULING IS NAMED AND UNOWNED. ADR-073 section 8, in its own words: "That
is a second ruling waiting to be asked for and this ADR deliberately does not
take it. Extending disposition (b) to section 4.2's twelve rows is the obvious
next move and it is a different question: a VG row's condition is its STAGE,
which makes the conditions CHAIN, and a chained condition is a shape nobody
has ruled. It is named here so the next session proposes it rather than
assuming this one covered it." Open since 2026-08-20.

THE TREE. Three of twelve are wired: VG-1 (gitleaks), VG-4
(merit/no-raw-db-client), VG-12 (frozen-lockfile plus audit plus SBOM). The
other nine are assigned to stages: VG-3 and VG-6 to CI-04, VG-5 to CI-06,
VG-2 and VG-10 to CI-07, VG-9 to CI-10, VG-11 to CI-02 (moved there by
ADR-073 section 7), VG-7 and VG-8 to "always". MEASURE THIS YOURSELF; every
figure here is from 2026-08-22 and a figure is the first thing that goes
stale.

THE HARD PART IS THE CHAIN AND IT IS THE WHOLE RULING. VG-5's stage (CI-06)
RUNS and VG-5 is still unwired, so "the stage exists" is not sufficient.
VG-11's stage (CI-02) runs and its subject, an upload path, does not exist, so
a VG condition can be an ARTIFACT rather than a stage. VG-2 and VG-10 wait on
CI-07, which itself waits on a production build, so their condition is
two links long. Decide whether a chained condition names its whole chain or
only its next link, and say what it costs either way.

P1 IS THE STAKE AND SAY SO. ADR-073 section 8: the gate inventory is P1's
CONTENTS; its DEFINITION OF DONE is the twelve VG gates, measured at three of
twelve. This ruling decides what closing P1 would mean.

DO NOT WRITE A GATE. ADR-073 wrote none and stated what a later session's gate
must read. Do the same.

APPROVAL LINE. Unsigned, one checkable clause. Candidate: "every one of the
twelve VG rows resolves to exactly one disposition, and every chained
condition names the row it chains to." Cost if wrong: nine gates acquire a
marker no gate reads, which is the state ADR-073 exists to end.

STOP CONDITION
One ADR, section 4.2 amended to carry the dispositions, 28 of 28 gates.
```

---

### `P2-f`: retire the pre-`ADR-048` golden block (session 137)

```
Branch: claude/p2f-retire-preadr048-golden-block   (create from origin/main)
Fence:  packages/golden-loader/test/fixtures.golden.test.ts,
        packages/golden-loader/src/polarity.ts,
        packages/golden-loader/src/run.ts,
        packages/golden-loader/src/coverage.ts,
        packages/golden-loader/src/index.ts,
        docs/STATE.md (append only), docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE. In particular: NOT packages/rules-engine, which
        session 134 holds, and NOT any fixture.
Regime: non-money. One objective. Your session-log number is 137.

OBJECTIVE
Retire the half of CI-03's polarity mechanism that can never run again, and
correct one comment that is false about the code beneath it.

WHAT THE TREE ACTUALLY DOES, AND VERIFY IT BEFORE YOU CUT ANYTHING. The CI-03
coverage block re-derives on every run and reports 43 fixtures deriving
DIRECT and 0 deriving inverted, every rule group A to H at 100 percent, and
`declaration.holds` TRUE, so the derived direction is ENFORCED. ADR-048's
design worked all the way through and no entry recorded that it finished.

THE DEAD CODE. `describe.runIf(!declaration.holds)` in fixtures.golden.test.ts
holds 43 tests asserting that every fixture must NOT match. It is the
pre-ADR-048 assertion. `declaration.holds` is true, so the block is skipped,
and it accounts for 43 of the suite's 45 skips. It cannot run again unless the
engine regresses to an identity fold.

BE CAREFUL HERE AND DO NOT OVER-CUT. `checkDeclarationAgainstFold` is a real
mechanism and ADR-048 case 1 is a real failure mode: a rule declared but
unreachable from the fold would flip every citing fixture to `direct` and fail
with a diff naming the wrong cause. KEEP the check and KEEP the block in the
coverage report that prints when it does not hold. What goes is the 43-test
duplicate assertion, not the guard.

THE FALSE COMMENT. polarity.ts:130 says "M01 section 1.3 exports six
functions, and `runFixture` calls none of them: it calls `evaluate`, the
scaffold's placeholder". READ run.ts: `runFixture` calls `initialState`,
`buildCalendarSlice` and `advanceDay`. `engineIsIdentityStub` also folds
`advanceDay`. The comment describes a state the code left. Correct it to what
the code does, and keep the FOURTH-FAILURE-MODE reasoning around it, which is
still true and is why the check exists.

STOP CONDITION
`pnpm vitest run` reports the same passing count with 43 fewer skips, the
CI-03 coverage block is unchanged in what it reports, 28 of 28 gates,
`node scripts/corpus/falsify.mjs` green with its 10 loader cases intact.
```

---

### `P2-g`: `hash.ts` into the engine (session 138, MONEY PATH, after 134)

```
Branch: claude/p2g-adr081-engine-hash   (create from origin/main AFTER 134 merges)
Fence:  packages/rules-engine/src/hash.ts (new),
        packages/rules-engine/src/index.ts,
        apps/worker/src/batch/state-hash.ts,
        apps/worker/src/batch/nightly.ts,
        apps/worker/test/state-hash.test.ts,
        docs/decisions/ADR-081.md (new), docs/decisions/ALLOCATION.md (your row only),
        docs/STATE.md (append only), docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE. apps/worker/src/batch/replay.ts is session 140's.
Regime: MONEY PATH. PLAN MODE. Fresh context. One objective. ADR-003 strict.
        Your session-log number is 138. Your ADR number is 081, reserved.
        DEPENDS ON 134 via packages/rules-engine/src/index.ts.

OBJECTIVE
Write ADR-081 and move state-hash.ts to packages/rules-engine/src/hash.ts,
where M01 section 1.3's layout puts it.

THE CONDITION THAT HELD IT OUT HAS BEEN MET. The 2026-08-17 review desk
ruling 2 held the file in apps/worker "until RE-D-03 lands". RE-D-03 has
landed, as RI-07 in packages/tooling/checks/repo-invariants.mjs. Verify that
yourself before you rely on it.

THE HALF THAT IS STILL OPEN, AND IT IS THE RULING. The file's own header
states it: merit/engine-purity REPORTS EVERY NON-RELATIVE IMPORT inside
packages/rules-engine/src/**, so `import { createHash } from 'node:crypto'`
is a lint error there, while M01 section 1.4's banned-constructs table permits
"crypto BEYOND A PURE HASH". The prose allows the import the rule refuses. The
header says the choice between a scoped lint exception and a hand-rolled
SHA-256 is "not a decision to make in passing". RI-07 now walks the TRANSITIVE
graph and will fail on node:crypto, so this is no longer hypothetical.

EXEMPTING RE-D-03 IS WEAKENING A GATE TO PASS IT, which section 9 forbids and
which the review desk already refused by name. If you rule the lint exception,
rule what makes it narrow enough that RI-07 still means what it says.

THE MOVE MUST BE BYTE-IDENTICAL. The file's own header: a hash recomputed from
what Postgres gives back is a different serializer and "would disagree with
every hash this batch wrote". Re-hashing the stored side would diverge the
entire book on its first run. Assert the digest over a known rule_states row
is unchanged across the move.

ALSO NAME, WITHOUT DOING IT: this is the digest half OI-29 needs. Nothing in
TypeScript computes `rules_digest` today, and OI-29's soundness check needs
one. Its enforcement is P3's; say so and do not reach for it.

APPROVAL LINE. Unsigned, one checkable clause. Candidate: "RI-07 walks
hash.ts and reports no Node builtin, and the digest over a known rule_states
row is byte-identical to the one apps/worker produced before the move." Cost
if wrong: the nightly diverges the whole book on its first run.

STOP CONDITION
hash.ts in the engine, apps/worker importing it, the digest proved unchanged,
28 of 28 gates, `pnpm run verify` green. Do NOT merge before the E2 read.
```

---

### `P2-e`: section 39, `GS-071`, and the third recitation (session 139, after 133)

```
Branch: claude/p2e-section39-gs071-hygiene   (create from origin/main AFTER 133 merges)
Fence:  docs/testing/golden-scenarios/39-fixture-status-and-blockers.md,
        packages/rules-engine/fixtures/README.md,
        scripts/corpus/gates.mjs (ONLY if the inventory assertion must move),
        docs/STATE.md (append only), docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE.
Regime: non-money. One objective. Your session-log number is 139.
        DEPENDS ON 133 via scripts/corpus/gates.mjs.

OBJECTIVE
Three repairs in two documents, each owed by a landed session.

1. SECTION 39'S LINE NUMBERS INTO plan-validate.test.ts ARE STALE. Session 128
   (WAVE-05 X3 and X4) moved every one of them. Session 131's "next" names
   this and says it "wants a session that owns that file". Re-derive each
   citation by running a grep, not by arithmetic on the old number.

2. GS-071 MOVES OFF `writable`. ADR-076 section 1's governing rule: a row is
   discharged when its assertion is EXECUTED somewhere a gate can read.
   Session 129 wrote that assertion, at the scale the row names: a 250-day
   funded life in apps/worker/test/replay.test.ts, asserted hash first and
   then field by field, and the block names GS-071 in its own header. Verify
   the grep resolves AND that the site executes rather than skipping, which is
   the distinction session 123 found and session 131 built the assertion for.
   Re-derive every count at the head of section 39 afterwards.

3. fixtures/README.md RECITES ADR-077's FALSIFIED CLAUSE A THIRD TIME. Session
   130's owed list names it and could not reach it, because packages/ was
   fenced off. The surrounding sentence survives the repair and is correct;
   ONLY THE QUOTATION MOVES. Read ADR-077 before you touch it.

**YOUR FENCE HOLDS scripts/corpus/gates.mjs DELIBERATELY.** You should not
need it: `covered-elsewhere` entered FIXTURE_STATUSES in session 131 and the
counts derive. But session 127 made exactly this shape of change, was fenced
out of this exact file, and ended red on nine findings through no fault of its
own. If the inventory assertion must move, move it here. If it must not, say
so in the pull-request body and leave the file untouched.

DO NOT change any status token's VOCABULARY. Adding a status word is a
different change and it is not this session's.

STOP CONDITION
`node scripts/corpus/gates.mjs check CI-06/fixture-inventory` reports zero
`writable` rows and reproduces every derived count at section 39's head,
28 of 28 gates, `node scripts/corpus/falsify.mjs` green.
```

---

### `P2-h`: the worker's audit folds the engine's `replay` (session 140, MONEY PATH, after 134 and 138)

```
Branch: claude/p2h-worker-audit-folds-replay   (create from origin/main AFTER 134 and 138 merge)
Fence:  apps/worker/src/batch/replay.ts, apps/worker/test/replay.test.ts,
        docs/STATE.md (append only), docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE. packages/rules-engine is closed to you.
Regime: MONEY PATH. PLAN MODE. Fresh context. One objective. ADR-003 strict.
        Your session-log number is 140. No ADR number: 078 already ruled the
        export and this session implements the consequence.

OBJECTIVE
Make apps/worker's replay self-audit call the engine's `replay` instead of
folding advanceDay itself.

WHY IT IS NOT COSMETIC. M01 section 3.7: "There is no second code path. The
nightly self-audit, the CI golden suite, the evidence pack's computation
trace, and the live batch all call advanceDay." `auditAccount` folds
advanceDay in its own loop today, which is a second EXPRESSION of one fold:
the sort order, the settlement grouping, the assertion handling and the
break at closed or graduated are each restated. A restatement is a place two
implementations can drift, and the thing that would drift is what the nightly
compares stored state against.

WHAT MUST NOT MOVE. Appendix B.2: the STORED row is never re-hashed. The
comparison is `stored.stateHash` against the hash the recomputed fold
produced, and the per-column diff runs only after those bytes disagree. B.4
step 1 scoping by engine_version and by calendar_revision_id (ADR-047) stays
exactly as it is. OI-14's refusal, that an empty in-scope set with stored rows
present THROWS rather than returning a clean report, stays exactly as it is.

PROVE IT BY EXECUTION. Session 129's 250-day case is in the file you hold.
It must produce the identical state_hash over all 250 days and the identical
43 fields a day after the change. If a single byte moves, the fold was not
equivalent and that is the finding, not the noise.

STOP CONDITION
The worker calls the engine's replay, session 129's case unchanged and green,
28 of 28 gates, `pnpm run verify` green. Do NOT merge before the E2 read.
```

---

## 9. Four things this plan hands the founder, none of them a session

| # | Item | What is needed |
|---|---|---|
| **1** | **`OQ-F6-01`, the dual-control threshold in integer cents** | **Recommendation: 10,000 cents.** [M20](M20-wallet.md) `WF-M20-02` sets the external withdrawal minimum at $100, so at 10,000c every adjustment large enough to be withdrawn on its own requires a second key, and no adjustment below it can leave the platform in one movement. [`0038:191`](../../packages/db/migrations/0038_account_adjustments.sql) makes `dual_control_threshold_cents` a `NOT NULL` column **per row** rather than a lookup, so the number is what the application writes at the time. Until it exists, `account_adjustments_dual_control_above_threshold` is **inert** and the dual-control half of [ADR-067](../decisions/ADR-067.md) is specification rather than enforcement. **`OQ-F6-02`'s sub-threshold aggregation gap is not closed by any value here** and is named beside it so the answer does not read as covering both |
| **2** | **TradingCalendar's data** | **Blocked on egress, not on engineering.** [`cme-2026-2028.source.json`](../../packages/db/src/seed/calendars/cme-2026-2028.source.json) is `awaiting-transcription` and the session that wrote it got `403` on `CONNECT www.cmegroup.com:443`. Writing the holiday list from recollection is the failure `TR-01` names, and it would defeat `OQ-SE-04`'s independent check in the same stroke because two recollections of one publication are perfectly correlated. **It is P1's last item and it does not block any of the eight sessions above.** Section 10 has the measurement |
| **3** | **`CI-04`'s Neon branch** | **No session can grant this.** Open since 2026-08-20. It is what `CI-09`'s replay leg waits on as well |
| **4** | **The `E2` reads** on `134`, `135`, `138` and `140` | Money path. `135` carries a migration and must not merge before the read |

---

## 10. What this plan does not schedule, and why each absence is a decision

| Item | Disposition |
|---|---|
| **The calendar transcription as P2's first slice** | **Refused on measurement.** [P2 section 6](P2-rules-engine.md) says groups A, F and H "cannot proceed" without it. That was true on 2026-08-16 and is false now: all three groups are declared, and their fixtures all derive `direct` and pass against the fixture calendar. [`rules.ts`](../../packages/rules-engine/src/rules.ts) records that transcription "adds rows, not columns, so it unblocks their GOLDEN files and not the rules". **P2 can start and can finish without it** |
| **`CI-07`** | **P2 does not meet its condition, measured rather than assumed.** No package in this repository declares a `build` script and there is no bundler in the tree. The eight sessions above add two engine source files, one migration and four document repairs, and **none of them introduces a build**. The first phase that plausibly does is P4 |
| **`CI-08`** | Waits on three surfaces that are read-only shells. P4 |
| **`CI-09`'s three remaining legs** | The replay leg waits on a database, therefore on `CI-04`; Stryker waits on the `VG-12` admission's human half, which [ADR-073](../decisions/ADR-073.md) section 6 states a session cannot perform; the detector canary waits on P7 |
| **`OI-27`** | One identifier series with two definition sites. Registry hygiene in [ADR-074](../decisions/ADR-074.md)'s family, **no engine surface**, and it belongs to the next session holding [`DELTA_MANIFEST`](../../packages/db/DELTA_MANIFEST.md) |
| **`OI-28`** | Widening [ADR-042](../decisions/ADR-042.md)'s closed `UNIT_TOKENS` for `simulation_runs.calibration_observed_at`. **M21 surface, no engine surface** |
| **`OI-29`** | **The one of the three with a P2 surface, and only its digest half.** Its remedy needs a canonical digest over the published rules, nothing in TypeScript computes `rules_digest` today, and that serializer is `hash.ts`, which `P2-g` lands. **Its enforcement, a trigger or an application publish path, is P3's** and is not moved here |
| **Every other `0015` citation in the corpus** | Section 4.2 makes them all suspect, because a merged constraint can have been superseded. **Auditing them is not P2's** and is named for the next session holding `DELTA_MANIFEST` |
| **`PT-03`** | Moved to P3 whole by `OQ-P2-04`. Not reopened |
| **[M02](M02-rithmic-bridge.md)** | Holds at `review` under [ADR-005](../decisions/ADR-005.md) pending the vendor call. **None of the eight sessions waits on it**, and the simulator's streaming mode landing (section 4.1) is why the tier-2 path is developable before any vendor agreement exists |

---

## 11. Verification

Per session, each a command with an output rather than a claim.

- `node scripts/corpus/gates.mjs check` reports every gate passing and `node scripts/corpus/falsify.mjs` is green, on every branch, before the pull request opens.
- `pnpm run verify` green: typecheck, lint, format, every Vitest project.
- **On `133`:** `CI-06/identifier-series` reports **117 series over 1,083 members**, and the withheld table is watched failing in both directions.
- **On `134`:** `pnpm vitest run scripts/demo` reports `PT-06`'s arrival-order permutation LIVE and passing.
- **On `135`:** the probe run in both directions, and all 46 migrations applied forward-only into an empty PostgreSQL 16.
- **On `137`:** the suite reports the same passing count with 43 fewer skips, and the CI-03 coverage block is unchanged in what it reports.
- **On `139`:** `CI-06/fixture-inventory` reports **zero `writable` rows** and reproduces every derived count at section 39's head.
- **On `140`:** session 129's 250-day case produces the identical `state_hash` over all 250 days and the identical 43 fields a day.
