---
status: approved
depends_on: [../STATE.md, ../decisions/ALLOCATION.md, P2-rules-engine.md, ../testing/STRATEGY.md]
last_updated: 2026-08-18
---

# WAVE-01: ten sessions, six of them concurrent

**A wave plan, not a module plan.** It carries no ruling and no design. It is the allocation
table and the prompt set for the ten sessions that are unblocked on 2026-08-18, written so
the founder pastes a prompt into a fresh session and reads a pull request rather than
composing anything.

**Every claim below was checked against the tree rather than against the handoff that
proposed it**, and three of the handoff's items did not survive that check. They are recorded
in section 5 so the next reader does not re-derive them.

---

## 1. The three registries this wave spends, allocated here before any session starts

**Handing out N numbers without reserving them breaks `CI-06f` gaplessness at every
intermediate state, and the session that hits it is never the one that caused it.**
[ADR-034](../decisions/ADR-034.md) and [ADR-036](../decisions/ADR-036.md) both rule that the
claim precedes the artifact.

| Registry | Spent by this wave | Where the claim lives |
|---|---|---|
| **`CI-06` letters** | **`r`** (G1), **`s`** (G3), **`t`** (G4). `o` was already reserved and unwritten and G2 spends it | [ALLOCATION](../decisions/ALLOCATION.md), letter table. **`r` and `s` were committed before this document existed**; `t` was claimed mid-session when the defect that needs it was found |
| **Session-log numbers** | **61 to 70**, one per session, in the table below | **This table.** That registry has no allocation table and has now raced twice: [STATE](../STATE.md) records four entries numbered 31 and two numbered 32, and [sessions/README](../sessions/README.md) currently carries **two rows numbered 58 and two numbered 59**. Until it gets a table of its own, this document is one for this wave |
| **ADR numbers** | **none reserved** | No session below is expected to need one. **A session that discovers it does stops, claims the number in [ALLOCATION](../decisions/ALLOCATION.md) in its own commit, and proceeds** — it does not write the ADR first. `059` is the next free number and no row claims it |
| **Migration numbers** | **none.** No session below touches `packages/db/migrations` | `0038` is the next free number and no row claims it |

---

## 2. The wave

**Six sessions run at once.** The fences do not intersect, and where two sessions share a
directory they are fenced to files that do not exist yet.

| Rank | # | Session | Log | Branch | Fence | Regime |
|---|---|---|---|---|---|---|
| **1** | **G1** | `CI-06r`: an ADR heading agrees with its own body | 61 | `claude/wave01-g1-ci06r-adr-status` | `scripts/corpus/`, `docs/testing/STRATEGY.md`, ADR-006/007/008 | non-money |
| **1** | **E1** | `PT-04` and `PT-07` | 62 | `claude/wave01-e1-pt04-pt07` | new files in `packages/rules-engine/test/` | **money path** |
| **1** | **E2** | `PT-02` and `PT-08` | 63 | `claude/wave01-e2-pt02-pt08` | new files in `packages/rules-engine/test/` | **money path** |
| **1** | **E3** | `PT-05` | 64 | `claude/wave01-e3-pt05` | new files in `packages/rules-engine/test/` | **money path** |
| **1** | **W1** | The replay comparison, `INV-04` | 65 | `claude/wave01-w1-replay-comparison` | `apps/worker/` | **money path** |
| **1** | **F1** | Golden fixtures batch 10, and one retraction that left a copy standing | 66 | `claude/wave01-f1-fixtures-batch-10` | `packages/rules-engine/fixtures/`, `packages/golden-loader/` | non-money |
| **2** | **G2** | `CI-06o`: the money-path model ban | 67 | `claude/wave01-g2-ci06o-model-ban` | `scripts/corpus/`, `docs/testing/STRATEGY.md` | non-money |
| **2** | **G3** | `CI-06s`: every probe is run **and** pinned | 68 | `claude/wave01-g3-ci06s-probe-pinning` | `scripts/corpus/`, `docs/testing/STRATEGY.md` | non-money |
| **3** | **G4** | `CI-06t`: every generated span is closed | 69 | `claude/wave01-g4-ci06t-span-balance` | `scripts/corpus/`, `docs/testing/STRATEGY.md` | non-money |
| **4** | **R1** | `OI-11`: the duplicated registry rows | 70 | `claude/wave01-r1-oi11-dedup` | `docs/decisions/ALLOCATION.md`, `docs/STATE.md` | non-money |

**Why the ranks exist, stated rather than left to be inferred.**

- **The gates lane is serial and cannot be widened.** `G1`, `G2`, `G3` and `G4` all write
  `scripts/corpus/gates.mjs` and `scripts/corpus/falsify.mjs`. The
  [PR #7 / PR #8 reconciliation](../STATE.md) is what two branches independently writing that
  one file costs, and it cost a session.
- **`R1` runs alone and last.** Its entire objective is editing lines of
  [STATE](../STATE.md) and [ALLOCATION](../decisions/ALLOCATION.md) that other sessions are
  appending to. Running it concurrently reproduces `OI-10`, which is the defect it exists to
  clear.
- **Nothing else has an ordering constraint.** `E1`, `E2` and `E3` share a directory and no
  file; `W1` and `F1` share nothing with anyone.

---

## 3. The rules every prompt below carries, written once here

Each prompt restates these, because a prompt that points at a document is a prompt whose
rules do not arrive with it. They are collected here so an eleventh session can be written
without re-deriving them.

1. **The session-log stub is the first commit.** Write
   `docs/sessions/2026-08-18-session-<N>.md` with the objective and `placeholder` for every
   other field, add its row to [sessions/README](../sessions/README.md), commit, push. **Then
   do the work.** A session that dies mid-task has to be recoverable from the log alone, and a
   log written at the end is a log that does not exist when it is needed.
2. **Commit and push after each file.** Not at the end of the task. A batch of unpushed
   commits is the failure mode the rule exists to prevent.
3. **The fence is absolute.** Touch nothing outside it. If the work needs a file outside the
   fence, **stop and report it in the pull-request body** rather than reaching.
4. **`docs/STATE.md`: append one `##` section at the END of the file. Edit no existing line,
   and do not touch `## Next 3 actions`.** Four passages in that file are duplicated today
   because parallel branches each appended their own version of a shared line and the merges
   kept both. `R1` is the session that clears it; every other session must not add to it.
5. **`docs/sessions/README.md`: append your row at the end of the table.** Your number is
   allocated in section 2 above. Do not take "the next number you can see"; that is what
   produced two 58s and two 59s.
6. **Open the pull request yourself**, as ready for review, titled with what landed rather
   than with what was attempted. **Do not merge it.**
7. **Verify by running, never by reading.** Every completion claim in the pull-request body
   ships with the command and its output. `node scripts/corpus/gates.mjs check` and
   `pnpm vitest run` are the two that everything must leave green.
8. **Report the count honestly.** "I am at 3 of 5" beats five thin files. A session low on
   context says so and stops.
9. **Never weaken a gate to pass it**, and never widen a fence to finish. Both are the same
   move.
10. **Authority citations must resolve.** Say "the review desk" or cite the ADR. **Never
    invent a founder ruling** — `CI-06q` exists because three sites cited one that never
    happened.

---

## 4. The prompts

Each block below is complete. Paste one into a fresh session and change nothing.

---

### G1 — `CI-06r`, an ADR heading agrees with its own body (session 61)

```
Branch: claude/wave01-g1-ci06r-adr-status   (create from origin/main)
Fence:  scripts/corpus/gates.mjs, scripts/corpus/falsify.mjs,
        docs/testing/STRATEGY.md, docs/decisions/ADR-006.md,
        docs/decisions/ADR-007.md, docs/decisions/ADR-008.md,
        docs/STATE.md (append only), docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE.
Regime: non-money. One objective. Your session-log number is 61.

OBJECTIVE
Write CI-06r and repair the three ADRs it will fail on.

The letter `r` IS ALREADY RESERVED for you in docs/decisions/ALLOCATION.md's
letter table. Do not claim it again and do not take a different one.

THE DEFECT, from docs/decisions/gates/unsigned-adr-audit-2026-08-18.md.
ADR-006, ADR-007 and ADR-008 head themselves `status: proposed` while each
carries, at its own line 6, a dated `Founder approval ... ACCEPTED` line, and
the M1 gate closure (docs/decisions/gates/m1-gate-closure-2026-08-13.md, line
20) records the founder accepting all three on 2026-08-13. Seventeen of
seventeen gates pass over that contradiction: CI-06f reads ADR numbers and
gaplessness and never status, and CI-06b validates FRONTMATTER while an ADR
entry carries its status in a HEADING. This is the twelfth instance of the
prose-carried-fact-in-a-registry class, inside the registry ADR-034 and
ADR-036 were written to protect.

WHAT THE GATE ASSERTS. Read each ADR entry file against ITSELF:
  - an entry whose body carries a founder-approval line reading ACCEPTED may
    not head itself `status: proposed`;
  - an entry heading itself `accepted` must carry such a line.
State in the gate's own `covers` string what it CANNOT do: it compares a file
with itself and can check NEITHER half against the gate record. That is the
same boundary CI-06q states one row above it in the letter table, and stating
it is not optional — a gate implying coverage it does not have is worse than
the absence.

WHAT YOU MUST REPAIR, AND WHY IT IS TRANSCRIPTION RATHER THAN A DECISION.
The gate will fail on ADR-006, ADR-007 and ADR-008 the moment it runs, and a
gate that fails on arrival is a gate somebody switches off (STATE says this in
those words). So correct the three headings to `accepted` IN THIS SESSION,
each with a citation to the founder's own dated gate record. THE SIGNATURE
EXISTS AND THE STATUS WORD IS WHAT IS STALE — you are transcribing a founder
ruling that was made on 2026-08-13, not making one.
DO NOT TOUCH ADR-001, ADR-033, ADR-036, ADR-056 or ADR-058. Those five are
genuinely unsigned, the audit recommends a SPLIT rather than a batch
signature, and the split is the founder's to make. Your gate must PASS on
them, because a `proposed` heading with no acceptance line in the body is not
a contradiction. If it does not pass on them, your assertion is wrong, not
theirs.

FALSIFICATION IS THE DELIVERABLE, NOT THE GATE.
Add the CI-06r seed to scripts/corpus/falsify.mjs and WATCH IT FAIL ON ITS OWN
FINDING. A gate nobody has watched fail is not a gate, and two of the original
eleven were passing while asserting nothing. Report the exact failure text.
Add a scope case too: an ADR that is legitimately `proposed` with no approval
line must NOT be a finding.

ALSO
Add the CI-06r row to docs/testing/STRATEGY.md section 4.4. CI-06p asserts
each letter heads at most one row there.

DEFINITION OF DONE
  - node scripts/corpus/gates.mjs check      -> 18 of 18 pass
  - node scripts/corpus/falsify.mjs          -> green, CI-06r watched failing
    on its own finding and passing out of scope, both quoted in the PR body
  - pnpm vitest run                          -> 54 files, 789 passing
STOP THERE. Do not write CI-06o or CI-06s; they are sessions 67 and 68 and
their letters are reserved for them.

Then: append ONE `##` section at the END of docs/STATE.md. Edit no existing
line of that file and do not touch `## Next 3 actions`. Open the pull request
yourself, ready for review, and do not merge it.
```

---

### E1 — `PT-04` and `PT-07` (session 62)

```
Branch: claude/wave01-e1-pt04-pt07   (create from origin/main)
Fence:  NEW FILES ONLY under packages/rules-engine/test/.
        You may READ anything. You may WRITE only files you create, plus
        docs/STATE.md (append only) and docs/sessions/ (your log + its row).
        DO NOT EDIT packages/rules-engine/src/**, and do not edit any existing
        test file or any existing generator — sessions 63 and 64 are running in
        this same directory concurrently. If a generator needs a change, STOP
        and say so in the PR body.
Regime: MONEY PATH. ADR-003 strict: one objective, fresh context, PLAN MODE
        MANDATORY. Your session-log number is 62.

OBJECTIVE
Assert PT-04 and PT-07 as fast-check properties, each watched failing on a
seeded mutant.

THE PRIMARY SOURCE IS docs/testing/STRATEGY.md's named-properties table,
lines 60 to 70. Read the rows themselves; do not work from this summary:
  PT-04  `withdrawable_cents >= 0` always, at every point in every generated
         life. Its note is load bearing: THE GENERATOR IS ALLOWED TO DRIVE
         BALANCE BELOW `size + buffer`, which is the case a naive
         implementation returns a negative for. A generator that never reaches
         that case proves nothing.
  PT-07  Idempotence of day application. Applying the same closed day twice is
         a no-op on state. It is GS-047's assertion as a property, and it is
         what makes the resumable nightly batch safe.

WHAT ALREADY EXISTS, so you do not rebuild it.
  - packages/rules-engine/test/generators/ carries day-sequence.ts,
    settlement-sequence.ts, plan.ts, plan-config.ts and day-input.ts, each with
    a validate-*.ts beside it. Use them. Read them first.
  - floor-monotonicity.property.test.ts is PT-01 and is the shape to follow.
  - Of P2's seven properties only PT-01 is asserted today. PT-02, PT-04,
    PT-05, PT-07 and PT-08 are all unasserted; 02 and 08 are session 63's and
    05 is session 64's. Take only your two.

THE TRAP, NAMED IN P2 SECTION 5 AND BINDING HERE.
A property test can pass vacuously. So each of your two properties ships with
a SEEDED MUTANT you have watched it fail on: change the implementation under
it, run, quote the shrunk counterexample, revert. A property you have not
watched fail is a property that has not been shown to bite. Report both
counterexamples in the PR body verbatim.

DEFINITION OF DONE
  - pnpm vitest run     -> green, and the new file count and test count stated
  - both mutants watched failing, counterexamples quoted, tree reverted clean
    (git status reports no modification under src/)
  - node scripts/corpus/gates.mjs check -> 17 of 17 (or 18 if session 61 has
    merged ahead of you)
STOP THERE. Do not write PT-02, PT-05 or PT-08.

Then: append ONE `##` section at the END of docs/STATE.md. Edit no existing
line. Open the pull request yourself, ready for review, and do not merge it.
```

---

### E2 — `PT-02` and `PT-08` (session 63)

```
Branch: claude/wave01-e2-pt02-pt08   (create from origin/main)
Fence:  NEW FILES ONLY under packages/rules-engine/test/. Same rule as session
        62, which is running concurrently in this directory: read anything,
        write only files you create, never edit an existing test or generator.
        Plus docs/STATE.md (append only) and docs/sessions/.
Regime: MONEY PATH. ADR-003 strict, PLAN MODE MANDATORY. Log number 63.

OBJECTIVE
Assert PT-02 and PT-08 as fast-check properties, each watched failing on a
seeded mutant.

PRIMARY SOURCE: docs/testing/STRATEGY.md's named-properties table, lines 60
to 70.
  PT-02  Win days never decrease EXCEPT at a payout reset, and at a reset they
         go to exactly zero. THE EXCEPTION IS THE WHOLE PROPERTY, in the row's
         own words: a generator that never settles proves nothing about R-47.
         So your generator must settle, and you must show it settling.
  PT-08  The lifetime bound. No sequence of settlements on one account exceeds
         `max_payouts * max(payout_cap_schedule)`. It is M01's INV-17. Since
         ADR-025 the schedule has one step, so the bound is `max_payouts *
         cap`, and GS-243 asserts the same number regardless of loyalty state.

BOTH OF YOURS ARE SETTLEMENT-DRIVEN, which is why they are one session:
generators/settlement-sequence.ts is the input both need, and
`applySettlement` is exported from packages/rules-engine/src/index.ts.

READ BEFORE WRITING. `applySettlement` TAKES A FOURTH ARGUMENT M01's signature
does not show, and ADR-049 authorises it: R-47 needs the trading day AFTER the
basis day. The note is at packages/rules-engine/src/index.ts lines 44 to 47.
A property built on the wrong arity will look like a source disagreement and
is not one.

THE TRAP: a property test against a stub or against a generator that never
reaches the exception passes vacuously. Each property ships with a SEEDED
MUTANT you have watched it fail on, with the shrunk counterexample quoted in
the PR body and the tree reverted clean afterward.

DEFINITION OF DONE
  - pnpm vitest run -> green, counts stated
  - both mutants watched failing, counterexamples quoted, src/ unmodified
  - node scripts/corpus/gates.mjs check -> green
STOP THERE. PT-04 and PT-07 are session 62's; PT-05 is session 64's.

Then: append ONE `##` section at the END of docs/STATE.md. Edit no existing
line. Open the pull request yourself, ready for review, and do not merge it.
```

---

### E3 — `PT-05`, the clamp inequality (session 64)

```
Branch: claude/wave01-e3-pt05   (create from origin/main)
Fence:  NEW FILES ONLY under packages/rules-engine/test/. Same rule as sessions
        62 and 63, both running concurrently in this directory. Plus
        docs/STATE.md (append only) and docs/sessions/.
Regime: MONEY PATH. ADR-003 strict, PLAN MODE MANDATORY. Log number 64.

OBJECTIVE
Assert PT-05 as a fast-check property, watched failing on a seeded mutant.

PRIMARY SOURCE: docs/testing/STRATEGY.md line 67.
  PT-05  `approved_cents <= cap_cents_for_ordinal` AND
         `approved_cents <= withdrawable_cents`, and the result is
         `>= min_payout_cents` OR THE REQUEST IS NOT ELIGIBLE.
         It is ADR-009's clamp order ASSERTED AS AN INEQUALITY RATHER THAN AS
         A SEQUENCE OF STEPS. That distinction is the property: a test that
         re-walks the clamp in the same order as the implementation is the
         implementation talking to itself (C10's self-grading trap), and a
         three-way inequality is not.

THE CONSTRAINT THAT DECIDES YOUR ENTRY POINT, AND IT IS ALREADY RULED.
`clampPayout` IS DELIBERATELY NOT EXPORTED. M01 disagrees with itself: section
3.6's reference algorithm writes `export function clampPayout` and section
1.3's "nothing else is exported" does not list it among the six. SECTION 1.3
WINS, so the clamp is reachable only through `evaluatePayout`. The reasoning
is written at packages/rules-engine/src/index.ts lines 37 to 42. Assert
through `evaluatePayout`. DO NOT EXPORT `clampPayout` to make your test easier
— that is weakening a boundary to pass it, and section 9 forbids it.

The third clause needs care: `>= min_payout_cents` OR NOT ELIGIBLE is a
disjunction, and a generator that only ever produces eligible requests tests
one side of it. Show both sides being reached.

THE TRAP: seed a mutant in the clamp, watch the property fail, quote the
shrunk counterexample, revert. src/ must be unmodified when you finish.

DEFINITION OF DONE
  - pnpm vitest run -> green, counts stated
  - mutant watched failing, counterexample quoted, src/ unmodified
  - node scripts/corpus/gates.mjs check -> green
STOP THERE. PT-02, PT-04, PT-07 and PT-08 belong to sessions 62 and 63.

Then: append ONE `##` section at the END of docs/STATE.md. Edit no existing
line. Open the pull request yourself, ready for review, and do not merge it.
```

---

### W1 — the replay comparison, `INV-04` (session 65)

```
Branch: claude/wave01-w1-replay-comparison   (create from origin/main)
Fence:  apps/worker/ only, plus docs/STATE.md (append only) and docs/sessions/.
        DO NOT EDIT packages/rules-engine/** — three sessions are working there
        concurrently, and the engine is not what this session changes.
Regime: MONEY PATH. ADR-003 strict, fresh context, PLAN MODE MANDATORY.
        Log number 65.

OBJECTIVE
Wire the replay self-audit's COMPARISON.

THE GAP IS STATED IN THE FILE ITSELF, at apps/worker/src/batch/nightly.ts
lines 22 to 24: "`state_hash` is COMPUTED here and written on every row;
nothing yet re-derives a stored row and compares the two." INV-04 is
"replaying every mark from day one reproduces stored state", the constitution
calls this replay a nightly self-audit job in production, and today the
evidence is produced and never read. The hash is computed at nightly.ts:219.

FIRST, AND BEFORE YOU PLAN: STATE'S NEXT-ACTION 6 IS STALE AND YOU MUST SAY SO
RATHER THAN BUILD IT. It asks for `ENGINE_GATE_LEAVES` to be tied to
`EngineGateResults` at compile time, on the grounds that the list is
twenty-five hand-written dotted paths with a test asserting `toHaveLength(25)`
against the list itself. That was true when it was written. It is now largely
discharged: apps/worker/test/state-hash.test.ts:452 carries
"every leaf of EngineGateResults is declared in ENGINE_GATE_LEAVES", walking a
representative value with `dottedLeafPaths` and asserting BOTH directions, and
the walker itself is exercised on a widened value so it cannot silently skip an
unknown field. READ IT AND JUDGE THE RESIDUE: a newly added REQUIRED field
breaks the fixture literal at compile time and is then caught by the walk; a
newly added OPTIONAL or nullable field may not be. Record what you find in the
PR body — as a closure, or as the narrowed gap with its shape named. DO NOT
BUILD IT in this session either way; it is a separate objective and this one is
already money path.

WHAT THE COMPARISON MUST BE, read from the sources rather than designed:
  - INV-04's statement, in docs/plans/M01-rules-engine.md
  - Appendix B.4's replay protocol and its ENGINE-UPGRADE event, which is what
    makes a legitimate hash change different from a divergence
  - migration 0035, which put the calendar revision on `rule_states` so that
    replay can SCOPE a calendar correction (ADR-047, OQ-P2-02), and the note at
    nightly.ts:255 about a row read under an OLDER calendar
  - ports.ts:142, which marks a field "required for replay COMPARISON, excluded
    from the hash it is compared with"
A divergence must NAME THE FIELD, which is why `ENGINE_GATE_LEAVES` carries
dotted paths at all.

THE TRAP THIS PROJECT HAS HIT REPEATEDLY: a comparison that can only pass. Lead
your tests with SUCCESS cases — a replay that legitimately reproduces — before
any divergence case, on the lesson probe_payout_hold.sql records in
DELTA_MANIFEST section 13: a guard rejecting everything passes every rejection
test written against it, and probe_reversible_contact_addresses.sql then
proved the same thing about a table with no success case at all.

DEFINITION OF DONE
  - pnpm vitest run -> green, counts stated
  - the comparison watched DETECTING a seeded divergence AND watched passing a
    legitimate reproduction, both quoted
  - node scripts/corpus/gates.mjs check -> green
  - if the work needs a schema change, STOP: migrations are money path, take
    their own session, and 0038 is unclaimed. Say so; do not write one.

Then: append ONE `##` section at the END of docs/STATE.md. Edit no existing
line and do not touch `## Next 3 actions` — you are the session best placed to
correct item 6 and you must NOT, because R1 (session 69) owns that file's
existing lines. Open the pull request yourself and do not merge it.
```

---

### F1 — golden fixtures batch 10, and one retraction that left a copy standing (session 66)

```
Branch: claude/wave01-f1-fixtures-batch-10   (create from origin/main)
Fence:  packages/rules-engine/fixtures/, packages/golden-loader/,
        docs/STATE.md (append only), docs/sessions/.
        DO NOT EDIT packages/rules-engine/src/ or test/ — three money-path
        sessions are working there concurrently.
Regime: non-money. Log number 66.

OBJECTIVE
Write golden fixtures batch 10, and repair one retraction that left a copy
standing.

POSITION, VERIFIED: 36 of 284 fixtures exist, all 36 derive `direct`, and the
engine declares 46 of 50 rules.

THE SMALL ONE FIRST, because it is one line and it is already recorded as a
defect in this directory's own README:
packages/golden-loader/test/fixtures.golden.test.ts:202 opens
"FOUNDER RULING, 2026-08-17". That attribution was RETRACTED twenty-eight
lines above it — coverage.ts:125 and fixtures.golden.test.ts:174 both now say
"no such ruling exists and none is needed". CI-06q passes over it because
2026-08-17 does carry three declared rulings, so the date RESOLVES while the
claim is false; CI-06q's own covers line says it checks that an authority
EXISTS and never that it says what is attributed to it. A retraction that
leaves one copy standing is worse than the original claim: the next reader
finds two and cannot tell which is current. Fix it, cite the retraction.

THE BATCH. Read packages/rules-engine/fixtures/README.md IN FULL before
choosing rows — it names, per blocked row, WHY. Two things in it are binding
and are the reason this session exists rather than a bigger one:

  1. GROUP A IS NOT WAITING ON THE CALENDAR AND YOU MUST NOT TREAT IT AS IF IT
     IS. The re-derivation at README lines 196 to 209 was run against
     types.ts, rules.ts and calendar.ts and reads: R-01 is blocked because
     `DailyMark` carries NO INSTANT; R-04 because `calendarRowsFromRecord`
     writes `halted: false` as a CONSTANT; R-05 because `CalendarDay` is
     `{tradingDay, isHalfDay, halted, sequence}` and session bounds are two
     columns it does not have; and R-06 is a GROUP B row that needs a CLOCK,
     which INV-01 forbids the engine to read. NO FURTHER CALENDAR
     TRANSCRIPTION UNBLOCKS ANY OF THEM. Batch 9's objective named four group A
     rules as newly writable and NOT ONE OF THE FOUR WAS; do not repeat it.
  2. A FIXTURE MAY NOT CITE A RULE THE ENGINE DOES NOT DECLARE. The four
     undeclared rules are R-01, R-05, R-11 and R-20, and ADR-048's per-fixture
     polarity derives `inverted` for a fixture citing one, which asserts the
     fixture FAILS. README line 240 records that batch 9 nearly broke this.

So: derive your candidate rows from what the engine ACTUALLY declares and what
the fixture format can state without inventing an input, exactly as batches 4
through 9 did. STATE THE COUNT HONESTLY — "I wrote 6 and here is why the
seventh is not writable" is the deliverable, and a reason per rejected row is
worth more than an extra file.

DEFINITION OF DONE
  - pnpm vitest run -> green; the golden stage's own coverage block quoted from
    the run (it prints what it currently proves, per ADR-038)
  - every new fixture's expected end state traced to a PLAN DOCUMENT, never to
    engine output. TR-01: a value derived from the implementation is the engine
    grading itself
  - node scripts/corpus/gates.mjs check -> green (CI-06d resolves every cited
    GS-nnn)
  - the fixtures README updated with this batch's reasoning and its rejections

Then: append ONE `##` section at the END of docs/STATE.md. Edit no existing
line. Open the pull request yourself, ready for review, and do not merge it.
```

---

### G2 — `CI-06o`, the money-path model ban (session 67, after G1 merges)

```
Branch: claude/wave01-g2-ci06o-model-ban   (create from origin/main AFTER
        session 61's pull request has merged — you both write gates.mjs and
        falsify.mjs, and two branches independently writing that one file is
        what the PR #7 / PR #8 reconciliation cost a session to undo)
Fence:  scripts/corpus/, docs/testing/STRATEGY.md, docs/STATE.md (append only),
        docs/sessions/.
Regime: non-money. Log number 67.

OBJECTIVE
Write CI-06o.

The letter `o` HAS BEEN RESERVED AND UNWRITTEN SINCE ADR-044. Do not re-claim
it; its row is already in docs/decisions/ALLOCATION.md's letter table.

WHAT IT ASSERTS, from ADR-044 section 8: no module resolving from
packages/rules-engine, or from the payout, ledger or auth paths, imports a
model SDK or reaches a model endpoint — AND a money path added without being
added to the gate's scope is ITSELF A FINDING. That second half is the part
that keeps it from going quietly vacuous, and it is the assertion to spend
your care on.

WHY NOW RATHER THAN LATER, IN ADR-044'S OWN WORDS: a money-path model ban
enforced by people remembering it is a control that exists, stays valid and
enforces nothing. Until the gate runs and has been WATCHED FAILING ON A SEEDED
VIOLATION, ADR-044's first prohibition is prose. It is cheapest now, while the
payout, ledger and auth packages DO NOT EXIST and the gate is close to
vacuous. That near-vacuity is not a reason to defer it; it is the argument for
writing it, and it is ADR-042's argument for its SQL shape check.

BECAUSE IT IS NEARLY VACUOUS TODAY, THE SEED IS THE WHOLE DELIVERABLE. Add the
CI-06o seed to scripts/corpus/falsify.mjs and watch it fail on its own
finding. Add a scope case for the second half: a new money path that the
gate's scope list does not name must be a finding, and you must watch that
fire too. One seed for a two-assertion gate leaves half of it unwatched —
CI-06k's record in STATE says exactly this about a three-assertion gate
watched failing on a third of itself.

ALSO: add the CI-06o row to docs/testing/STRATEGY.md section 4.4.

DEFINITION OF DONE
  - node scripts/corpus/gates.mjs check  -> 19 of 19 (18 plus yours, assuming
    session 61 merged; state the number you actually see)
  - node scripts/corpus/falsify.mjs      -> green, both CI-06o cases watched
    firing on their own findings, quoted
  - pnpm vitest run                      -> green
STOP THERE. CI-06s is session 68's and its letter is reserved for it.

Then: append ONE `##` section at the END of docs/STATE.md. Edit no existing
line. Open the pull request yourself and do not merge it.
```

---

### G3 — `CI-06s`, every probe is run **and** pinned (session 68, after G2 merges)

```
Branch: claude/wave01-g3-ci06s-probe-pinning   (create from origin/main AFTER
        session 67's pull request has merged — same gates.mjs collision)
Fence:  scripts/corpus/, docs/testing/STRATEGY.md, docs/STATE.md (append only),
        docs/sessions/.
Regime: non-money. Log number 68.

OBJECTIVE
Write CI-06s.

The letter `s` IS ALREADY RESERVED for you in docs/decisions/ALLOCATION.md.

WHAT IT ASSERTS: every scripts/db/probe_*.sql on disk appears BOTH as a step in
.github/workflows/corpus.yml AND in CI-06h's required-needle list. And the
stale direction, which is the half that earns the gate: a needle naming a probe
NO FILE PROVIDES is a finding too. CI-06l's record in STATE is explicit that the
stale-entry checks are the two that earn it, because they run in the direction
nobody looks — a list naming something that no longer exists still LOOKS
complete.

WHY THIS IS A GATE AND NOT A HABIT. It is OI-07's third occurrence and STATE
records all three: probe_payout_hold.sql was wired into the workflow and NEVER
pinned by CI-06h, so it had been one delete away from being OI-07 again since
the day it landed; probe_reversible_contact_addresses.sql then made the
IDENTICAL omission and was caught before merge only by hand. STATE's own words:
"Three occurrences is a pattern: the fix is a gate asserting that every
scripts/db/probe_*.sql on disk is both run and pinned, and it is named here
rather than claimed, because a gate arrives with a CI-06 letter and a seeded
violation of its own." You now have the letter. Bring the seeded violation.

WATCH IT FAIL IN BOTH DIRECTIONS: a probe on disk that the workflow does not
run; a probe the workflow runs that CI-06h does not pin; and a needle naming a
probe that does not exist. Three cases, three watched failures, each quoted.

ALSO: add the CI-06s row to docs/testing/STRATEGY.md section 4.4.

DEFINITION OF DONE
  - node scripts/corpus/gates.mjs check -> 20 of 20 (state the number you see)
  - node scripts/corpus/falsify.mjs     -> green, all three cases watched
    firing on their own findings, quoted
  - pnpm vitest run                     -> green
  - if the gate finds a REAL unpinned or unrun probe on arrival, FIX IT in this
    session and say so. A gate that fails on arrival is a gate somebody
    switches off.
STOP THERE. CI-06t is session 69's and its letter is reserved for it.

Then: append ONE `##` section at the END of docs/STATE.md. Edit no existing
line. Open the pull request yourself and do not merge it.
```

---

### G4 — `CI-06t`, every generated span is closed (session 69, after G3 merges)

```
Branch: claude/wave01-g4-ci06t-span-balance   (create from origin/main AFTER
        session 68's pull request has merged — same gates.mjs collision)
Fence:  scripts/corpus/, docs/testing/STRATEGY.md, docs/STATE.md (append only),
        docs/sessions/.
Regime: non-money. Log number 69.

OBJECTIVE
Write CI-06t.

The letter `t` IS ALREADY RESERVED for you in docs/decisions/ALLOCATION.md.

WHAT IT ASSERTS: in every tracked document, each `gen:` opener is followed by
its closer BEFORE ANY OTHER OPENER APPEARS. An unbalanced document is a
finding, and so is a closer with no opener. NOTE THAT THIS PARAGRAPH NAMES THE
TOKENS RATHER THAN SPELLING THEM, and so must your gate's `covers` line and
your STRATEGY row: a document describing this gate is a document carrying the
defect unless it is careful, which is how the reservation row for this very
letter became the fifth instance of the class.

THE DEFECT IT COMES FROM, AND WHY CI-06g CANNOT SEE IT. On 2026-08-18 the
planning session appended a section to docs/STATE.md and CI-06g failed
reporting that the `ec_count` span "reads" ten thousand characters of
unrelated prose. The cause was two days old and had been passing: STATE line
1404 described a falsify.mjs seed by WRITING THE OPENER OUT IN FULL, and never
closed it. AN OPENER WITH NO CLOSER AFTER IT ANYWHERE IN THE FILE SIMPLY DOES
NOT MATCH, so CI-06g skipped it in silence. It was invisible for exactly as
long as it was the last such token in the file, and the first append below it
supplied the closer it had been waiting for. The line was rewritten to name
the span rather than spell it, and the repair is on main; your gate is what
stops the next one.

THIS IS THE FOURTH INSTANCE OF THE SPAN-PARSER CLASS and you should say so in
the gate's `covers` line: CI-06n's parser matched a prose mention rather than
a table row (OI-09), CI-06g's own falsify seed hardcoded the value it was
checking, and `registryIds()` re-implemented the gs_count query. Each was a
reader looser or narrower than the property it claimed.

THE SEED MUST BE THE REAL SHAPE, NOT A CONVENIENT ONE. Seed a document with an
opener that has NO closer after it and confirm your gate fires. Then seed the
harder case and confirm it fires too: an unclosed opener EARLY in a file with
a legitimate closed span LATER, which is the arrangement that produced the
defect and the one a naive balance count of openers against closers passes.
A gate that only counts totals is not this gate.

WATCH IT PASS OUT OF SCOPE: a document with no spans at all, and a document
whose spans are all correctly closed, must not be findings.

ALSO: add the CI-06t row to docs/testing/STRATEGY.md section 4.4.

DEFINITION OF DONE
  - node scripts/corpus/gates.mjs check -> 21 of 21 (state the number you see)
  - node scripts/corpus/falsify.mjs     -> green, both seeded cases watched
    firing on their own findings and both scope cases passing, all quoted
  - pnpm vitest run                     -> green
  - if the gate finds a REAL unbalanced document on arrival, fix it and say so.

Then: append ONE `##` section at the END of docs/STATE.md. Edit no existing
line. Open the pull request yourself and do not merge it.
```

---

### R1 — `OI-11`, the duplicated registry rows (session 70, LAST and ALONE)

```
Branch: claude/wave01-r1-oi11-dedup   (create from origin/main AFTER EVERY
        OTHER WAVE-01 PULL REQUEST HAS MERGED. This session edits existing
        lines of docs/STATE.md and docs/decisions/ALLOCATION.md, which every
        other session appends to. Running it concurrently reproduces OI-10,
        which is the defect it exists to clear.)
Fence:  docs/decisions/ALLOCATION.md, docs/STATE.md, docs/sessions/.
        NO CODE. NO GATE. If the cleanup implies a gate, name it and STOP.
Regime: non-money, but it edits two registries. One objective. Log number 70.

OBJECTIVE
Deduplicate the allocation tables and STATE's duplicated passages, deciding
which of each pair survives, so that the duplicate-claim assertion becomes
writable by a later session.

THE FINDING IS ALREADY WRITTEN, at the end of ALLOCATION's migration-table
section, and it is why this is a session rather than a patch:
  - The ADR table claims 039 through 046 TWICE EACH — a branch row beside the
    row recording that branch's merge.
  - The migration table claims 0033 twice and 0034 twice.
  - `allocated()` in scripts/corpus/gates.mjs accumulates claims into a Set, so
    TWO ROWS CLAIMING 0034 PRODUCE ONE MEMBER. Gaplessness holds, "every number
    on disk is claimed" holds, and A TABLE WHOSE ENTIRE PURPOSE IS TO MAKE A
    DUPLICATE CLAIM VISIBLE CANNOT SEE ONE. Fifteen gates passed over a real
    double-claim of 0034.
  - The check is a handful of lines against a Set that already exists. IT WAS
    NOT WRITTEN FOR A STATED REASON: it fails on arrival against the tables as
    they stand. THE CLEANUP IS THE PREREQUISITE AND IT IS THIS SESSION.

AND THE SAME SHAPE IN STATE.md, recorded as OI-10 and PARTLY CLEARED ON
2026-08-16 — verify what is still there rather than trusting either record.
Known: `## Next 3 actions` currently carries FOUR near-identical copies of item
3 with four different tails, and TWO copies of item 5 that disagree about which
FOLD-02 session is next. The file itself says the duplication was left as found
because "the fix belongs with whoever rules on the OI-06 collision that has the
same cause". You are that session for the duplication; you are NOT that session
for OI-06, which is a founder ruling about a missing table.

HOW TO DECIDE WHICH OF EACH PAIR SURVIVES, because this is the part that is a
judgement and not a sweep:
  - For an ALLOCATION pair, the row recording the MERGE is the durable fact and
    the branch row is the claim it superseded. Keep one row per number carrying
    both, or keep the merge row and state in the row what it replaced. DO NOT
    silently drop the branch row's reasoning where it says something the merge
    row does not.
  - For a STATE pair, the copies DISAGREE. Reconcile against the tree — run
    the check, read the file, look at the migration — never against whichever
    copy reads most confidently. Two of the item-3 copies said 0032 was next,
    was done, and was not yet started; only one of those was true.
  - RECORD WHAT YOU DELETED AND WHY, in the PR body, row by row. A dedup that
    cannot be audited is indistinguishable from a dedup that lost something.

DEFINITION OF DONE
  - node scripts/corpus/gates.mjs check -> green, and CI-06f, CI-06h and CI-06p
    all still pass (they read these tables)
  - a stated count: N duplicate rows removed, M reconciled, and for each
    reconciliation the tree fact that decided it
  - the duplicate-claim assertion NAMED as now-writable and NOT WRITTEN. It
    needs a seeded violation and belongs to the gates lane, whose fence you do
    not hold.
  - pnpm vitest run -> green

Then: append your session-log row. You may edit STATE.md's existing lines —
you are the only wave session permitted to. Open the pull request yourself and
do not merge it.
```

---

## 5. Three things the handoff said that the tree does not

Recorded here because each was checked and each would otherwise be re-derived.

| Claim | What the tree says |
|---|---|
| **"136 edge cases"** | **157.** 136 is a FILE count. [`EC-012-to-033-appendix-b4-battery.md`](../edge-cases/EC-012-to-033-appendix-b4-battery.md) carries twenty-two entries as rows in one file, and `CI-06g`'s `ec_count` span, which reads distinct identifiers, is right at 157. The gate was suspected and the report was wrong |
| **"The remaining group A rules, four still blocked"** | **True in count and wrong in cause, which is the half that changes what to do.** The blocker is not the calendar and no transcription clears it: R-01 needs an instant `DailyMark` does not carry, R-04 a halted flag written as a constant, R-05 session bounds `CalendarDay` does not have, and R-06 a clock `INV-01` forbids. Reaching any of the first three is a change to the engine's input types, which is an ADR and not a fixture session. The derivation is at [fixtures/README](../../packages/rules-engine/fixtures/README.md) lines 196 to 209 |
| **`ENGINE_GATE_LEAVES` is untied** ([STATE](../STATE.md) next action 6) | **Largely discharged and the item is stale.** [`state-hash.test.ts:452`](../../apps/worker/test/state-hash.test.ts) walks a representative value and asserts both directions, and exercises the walker on a widened value so it cannot silently skip. The residue is the optional-field case. W1 is instructed to judge and record it, not to build it |

**A fourth, which is this document's own subject.** The handoff proposed the remaining group A
rules and `RE-P-02` as next work. `RE-P-02` and the crossing fixture are blocked on
[ADR-056](../decisions/ADR-056.md)'s signature, group A is blocked on a decision nobody has
framed, and neither is in this wave for that reason.

---

## 6. What this wave does not touch, and who it is waiting on

**Nothing below is engineering-blocked. Every row is a signature or a retrieval.**

| Item | Waiting on | What it unblocks |
|---|---|---|
| **[ADR-056](../decisions/ADR-056.md)** — rewritten 2026-08-18, `proposed`, the run that was its precondition is DISCHARGED | founder signature | `RE-P-02`, the fixture that crosses the pass pinning `floor_locked: false`, and item 4 of migration `0037` |
| **[ADR-058](../decisions/ADR-058.md)** — `proposed`, recommended for acceptance | founder signature | The two split calendar alarms, and the production seed's reclassification as a launch dependency |
| **The [unsigned-ADR audit](../decisions/gates/unsigned-adr-audit-2026-08-18.md)'s SPLIT** | founder | ADR-036 and ADR-001 signed, ADR-033 part 1 only. **G1 handles ADR-006/007/008 as transcription and touches none of these three** |
| **`OI-01`** `liability_snapshots`, **`OI-06`** the payout-destination cooling window's missing storage | founder ruling | M06, and a control five documents cite whose input does not exist |
| **The CME retrieval** | founder, on a standing cadence | The production `trading_calendar` seed. **Not a build blocker** per ADR-058, and the fixture calendar's eighty-three sessions carry the shapes the engine needs |
| **The four `V-M2-nn` and the counsel sitting** | founder calendar | M02 leaving `review`; the privacy policy leaving draft |

---

## 7. Verification, for the session that reads this next

The position this wave was planned against, each figure produced by a command rather than
quoted from a report:

```
git rev-parse --short HEAD                     6b7a41c
node scripts/corpus/gates.mjs check            17 of 17
node packages/tooling/checks/repo-invariants.mjs   7 of 7
pnpm vitest run                                54 files, 789 passed, 38 skipped
ls packages/db/migrations/*.sql | wc -l        37
```

Rules: 46 of 50 declared, asserted at
[`implemented-rules.test.ts:72`](../../packages/rules-engine/test/implemented-rules.test.ts)
rather than counted by hand. Fixtures: 36 of 284. Properties: **one of P2's seven asserted**,
which is what sessions 62, 63 and 64 exist to move.
