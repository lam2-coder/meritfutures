# The golden fixture format

**The format is ruled, not designed here.** [STRATEGY section 2](../../../docs/testing/STRATEGY.md) chooses "YAML plus an expected end-state JSON sibling" and [GOLDEN_SCENARIOS section 2](../../../docs/testing/golden-scenarios/README.md) prints a worked example of it. This file records what the loader does with that ruling, the two places the corpus is ambiguous and how each was read, and the four fields that currently reach no engine input.

The loader is [`packages/golden-loader`](../../golden-loader/README.md). It reads this directory and imports the engine's public entry point only.

---

## The layout

```
fixtures/
  GS-NNN-<slug>.yaml            the inputs: plan, calendar, account, day stream
  GS-NNN-<slug>.expected.json   the expectation: end_state, events, pins
  plans/<name>.json             a plan_version + plan_version_sizes row
  calendars/<name>.json         the sessions the day stream may name
```

**The YAML holds only inputs and the JSON sibling holds only the expectation.** A YAML carrying an `expect:` key is refused (`L-05`).

## The two ambiguities in the corpus, and how each was read

**The sibling versus the inline `expect:` block.** [STRATEGY section 2](../../../docs/testing/STRATEGY.md) and [GOLDEN_SCENARIOS section 2](../../../docs/testing/golden-scenarios/README.md) both rule the format as "YAML plus an expected end-state **JSON sibling**", and section 2's printed example then shows `expect:` inside the YAML. **The reading that keeps both sentences true is that the sibling IS the `expect` block, serialized as JSON.** The physical layout is the sibling; `expect` is the logical name for what it holds. The one shape neither reading permits is a fixture carrying two of them, which is why `L-05` refuses it rather than choosing.

**`traded_day`.** The engine's `DayMark` declares it and the printed example does not supply it. [R-08](../../../docs/plans/M01-rules-engine.md) derives it from `fill_count > 0`, so **a loader computing it would be a loader that has implemented a rule the fixtures exist to check.** The fixture states it, like every other measurement, and `L-10` refuses a day row without it.

## The four fields that reach no engine input yet

`account.phase`, `account.opened_on`, `days[].adjustment_cents`, `settlements`.

The corpus's format states all four and the scaffold's engine types declare none of them, which [`packages/rules-engine/src/types.ts`](../src/types.ts) says in its own words: "THE FIELD SETS BELOW ARE THE SCAFFOLD'S, NOT M01's".

**The choice was between dropping them silently and naming them.** A dropped input on a money path is the worst outcome available: the fixture states a condition, the engine never sees it, and the scenario passes while pinning something else. So the loader **refuses any fixture field it can neither map nor find on that list**, the list is one visible place in [`loader.ts`](../../golden-loader/src/loader.ts), and `L-14` asserts every entry is still used by some fixture so it cannot rot into a permanent excuse. `adjustment_cents` may only be `0` and `settlements` may only be `[]`, because carried-and-ignored is not an option on a money field.

**M01 empties the list.** Each entry disappears by the engine's input types growing a home for it, and the compile-time totality assertions in the loader make that widening impossible to do without updating the map.

## Every value here is transcribed from a plan document

**TR-01.** [`plans/CORE-50K.json`](plans/CORE-50K.json) is [M01 Appendix A.1](../../../docs/plans/M01-rules-engine.md)'s 50K column and nothing else, [`plans/CORE-150K.json`](plans/CORE-150K.json) is the same appendix's 150K column, and [`plans/MERIT-RAPID-50K.json`](plans/MERIT-RAPID-50K.json) is [Appendix A.2](../../../docs/plans/M01-rules-engine.md)'s. Every fixture's header comment names the rule and the registry row each number comes from. A fixture written by reading the implementation proves only that the code agrees with itself.

**The two Core records are one plan at two sizes, and that is checkable rather than asserted.** Every bp column in `CORE-150K.json` is byte-identical to `CORE-50K.json` because they are the same plan; every cents column is the 50K figure times three, with exactly one exception, and the exception is `min_payout_cents`, which [Appendix A](../../../docs/plans/M01-rules-engine.md)'s preamble fixes at 10,000 for every size (CV-15). **A reader who finds a bp value that differs between the two files has found a transcription error, not a size difference**, and GS-242 is the fixture that turns each derived cents figure into a field that moves if it is wrong.

**One discrepancy was found in the transcription and is not resolved here.** [GOLDEN_SCENARIOS section 3](../../../docs/testing/golden-scenarios/README.md)'s plan shorthand restates Appendix A's numbers in prose and gives Core EOD a **ladder of 8**; [Appendix A.1](../../../docs/plans/M01-rules-engine.md) gives **5** per [ADR-024](../../../docs/decisions/ADR-024.md), in the same sentence that names Appendix A "the only place these numbers are defined". The plan record follows the named authority. It needs a founder ruling, and no fixture here reads the field.

## The calendar is five sessions, not a year

[`calendars/cme-2026.json`](calendars/cme-2026.json) covers `2026-11-02` to `2026-11-06`. **TradingCalendar as data is session S-E** ([P1 section 6](../../../docs/plans/P1-monorepo-scaffold.md)) and there is not one calendar row anywhere in this repository yet.

The file declares a `coverage` interval and `L-08` enforces it in both directions, so a partial calendar **cannot silently be mistaken for the CME year**: a fixture naming a day outside the window is refused rather than run against a calendar that does not know about it. When S-E lands, this file is **derived** from the seeded rows rather than maintained beside them.

**THE CALENDAR REACHES NO ENGINE INPUT, AND THAT IS A SHARPER FACT THAN "IT HOLDS FIVE SESSIONS".** `EngineInput` is `{ planConfigVersion, accountState, dayMarks }` and carries no calendar at all; [`loadCalendar`](../../golden-loader/src/loader.ts) reads `sessions[].trading_day` and returns a `Set` of strings, which `L-08` uses to refuse a day the calendar does not declare and which is then discarded. So the `calendar:` field is **validated and not passed on**. Two consequences are worth stating where a fixture author hits them:

- **`sessions[].kind` is carried and ignored.** Every session in `cme-2026.json` states `"kind": "full"` and nothing reads it. It is not on `AWAITING_M01_INPUT`, because that list is about **fixture** fields, and no `L-nn` rule refuses it, so it is the one place in this format where a stated condition can be silently dropped. The equivalent on a `days:` row (`L-10`) or an `account:` block (`L-09`) is a refusal. **Recorded for the fixture-wiring session rather than fixed here**, because every rule in the table is that session's to add.
- **A transcribed CME year would not, on its own, unblock the session-kind scenarios.** `CalendarDay` carries `isHalfDay` and `halted` and `advanceDay` reads them, but `evaluate` is the surface this loader folds and it has no calendar parameter. Those fixtures need `EngineInput` to grow one, which is the same widening the other four awaiting fields need. See the held-back table below.

## The loader's rules

Each is asserted from both sides in [`test/loader.test.ts`](../../golden-loader/test/loader.test.ts): an untouched copy of this directory loads clean, and one seeded violation per rule is watched failing **on that rule** rather than merely exiting non-zero.

| Rule | Refuses |
|---|---|
| `L-01` | An `id` that is not `GS-nnn`, or does not match the filename |
| `L-02` | An unknown top-level key, so a misspelled `dayz:` is a finding rather than an empty day stream |
| `L-03` | An `id` that is not in [GOLDEN_SCENARIOS](../../../docs/testing/golden-scenarios/README.md) |
| `L-04` | A missing sibling, an `end_state` pinning no field, or an unknown key in the sibling |
| `L-05` | An `expect:` block left in the YAML |
| `L-06` | **No `pins`.** A golden file without a stated pin is a regression test wearing a golden file's name |
| `L-07` | A plan that does not resolve, or one missing a field the engine's config type declares |
| `L-08` | A calendar that does not resolve, or a trading day it does not declare as a session |
| `L-09` | An account field that reaches no engine input and is on no list |
| `L-10` | A malformed, out-of-order or repeated day, or one missing a `DayMark` field |
| `L-11` | A non-zero `adjustment_cents` or a non-empty `settlements` |
| `L-12` | A file outside the YAML subset the loader reads |
| `L-14` | An awaiting-input entry no fixture uses any more |

## What the fixture directory does not yet hold

**Thirty scenarios, against a registry that defines 284.** The count is the stage's own, re-derived on every run rather than written here, and the honest form of it is **30 of 284**.

**AND 284 IS THE WRONG DENOMINATOR FOR THE QUESTION A READER IS ACTUALLY ASKING.** 284 is the registry, and this directory can only ever hold **M1's partition of it, which is 73** ([ownership index](../../../docs/testing/golden-scenarios/33-ownership-index-and-coverage-reconciliation.md) 33.1). The other 211 are other modules' fixtures, in other suites, and a scenario written here that another module primarily owns would double-count against that module's coverage, which is the property the index calls a partition. So there are two true counts and each answers a different question:

| Count | The question it answers |
|---|---|
| **30 of 284** | What share of the registry has an executable fixture anywhere. This is CI-06's inventory figure and it is the one the stage re-derives |
| **30 of 73** | What is left **for this directory**. The remaining 43 are each on a named row below |

**"29 of 284" was the only figure this file carried and it reads as 255 fixtures still owed here.** Both are kept, because dropping the registry-wide one would understate how far the suite as a whole has to go.

**Why writing them does not need an engine, and why it never did.** TR-01 puts the derivation in the plan document rather than in the implementation: every value in a fixture is read out of [M01](../../../docs/plans/M01-rules-engine.md)'s rule taxonomy, its Appendix A column and the scenario's own registry row, by somebody reading prose. An engine is what the fixtures are eventually run against; it is not where their numbers come from.

**[ADR-048](../../../docs/decisions/ADR-048.md) is ruled and is NOT yet wired, and this paragraph said otherwise until batch 2 checked it.** It read that polarity "is derived per fixture from the rules the fixture cites, so a fixture for a rule the engine has not implemented is asserted to fail and is not a false red". The ruling says that; the code does not do it yet. [`run.ts`](../../golden-loader/src/run.ts) still folds `evaluate`, which is still the scaffold's identity stub, and `engineIsIdentityStub()` still decides the direction **globally** for the whole directory. So **every fixture here is inverted today**, including the ones that cite only implemented rules, and the stage's skip count equals the fixture count. **The ADR's stated prerequisite is also still open**: it requires `source:` to become a resolvable citation enforced by a new `L-nn` rule "before or with the polarity change, never after it", and no rule checks `source` beyond refusing an empty string (`L-02`). **The next free rule number is `L-13`**, which this directory's rule table skips.

**What batch 4 did instead of wiring it, and why that is the right half.** [STATE.md](../../../docs/STATE.md) names a **fixture-wiring session** that owns the polarity derivation together with the `bigint` conversion the loader needs before it can fold `advanceDay` at all: `diffEndState` compares with `Object.is`, expectations are JSON numbers, and `Object.is(4750000, 4750000n)` is **false**. Flipping polarity before that lands would make every `direct` fixture red on a comparison rather than on a rule. So batch 4 wrote the **citations** rather than the mechanism: each of its four fixtures cites only `R-nn` identifiers that resolve in [M01 section 3.5](../../../docs/plans/M01-rules-engine.md), each header states the polarity that derivation yields, and **each names any rule it deliberately did not cite**. GS-061 is the worked example: `R-06` is the rule AS-08 is about, it is not in the engine's declared set, and citing it would hold the fixture inverted for a rule its expected end state does not depend on. That decision belongs beside the fixture, not inside the loader.

**The batch of fifteen that took this directory from three to eighteen** is the part of GS-001 to GS-029 plus GS-063 that the current fixture format can state without inventing an input: GS-002, GS-005, GS-006, GS-007, GS-010, GS-012, GS-013, GS-014, GS-015, GS-016, GS-017, GS-018, GS-019, GS-025 and GS-063.

**The batch of three that took it from eighteen to twenty-one** is the eval-consistency block: **GS-020, GS-023 and GS-024**, on a second plan record [`plans/MERIT-RAPID-50K.json`](plans/MERIT-RAPID-50K.json) transcribed from [M01 Appendix A.2](../../../docs/plans/M01-rules-engine.md), because Core EOD disables eval consistency and no Core EOD fixture can pin R-28, R-29 or R-30. GS-023 and GS-024 are a **boundary pair on one cent**: identical period profit of 500,000c, differing only in which day carries the cent, so an engine that computed the ratio by division or wrote `<` for `<=` cannot satisfy both.

**The batch of four that took it from twenty-one to twenty-five** is **GS-021, GS-022, GS-055 and GS-069**. Three of them are pairs against files that already existed, which is deliberate: a fixture whose sibling differs by one input is an assertion about an operator, and a fixture that stands alone is an assertion about an outcome.

| Fixture | Pairs with | The one number that differs |
|---|---|---|
| GS-021 | GS-022 | The losing day's P&L, which lands the consistency denominator on zero rather than below it. Together they pin both halves of R-30's strict `> 0`, and an engine that wrote `>=` satisfies GS-022 and fails GS-021 |
| GS-069 | GS-023 | Day one's P&L, 250,000c against 150,000c. The expectation differs in the seventh event alone: `phase.pass_deferred_consistency` where GS-023 has `phase.passed`. This is AS-13's monotonicity counterexample, carried at a scale of five because AS-13's own period profit of 100,000c does not meet any 50K eval target |
| GS-055 | none | AS-03's minimum-variance path, five days at exactly 50,000c, where the withdrawable lands **exactly** on the cap |

**The batch of four that took it from twenty-five to twenty-nine** is **GS-044, GS-054, GS-061 and GS-242**, and it is the first batch whose subject is the **funded phase reached through the eval pass**. [ADR-050](../../../docs/decisions/ADR-050.md) is what made it writable: `INV-06` gained a stated `R-31` exception, so a fixture may cross the pass and state the funded-reset floor without ratifying a ruling nobody had made. Section 1 below, which used to be the first of two readings this directory declined to choose, is now a record of how it was ruled.

| Fixture | Source | What it asserts that no earlier fixture does |
|---|---|---|
| GS-044 | B4 #15 | The funded counters **accumulate from zero** rather than merely being zero. Three days are traded and every one wins, and the end state reads 2 and 2, because R-31 zeroed the pass day and R-33 counts "from the funded reset, not from account open". The freeze the scenario is named for appears nowhere in the file, which is the point: `payoutsFrozen` is one of R-40's context gates and `INV-23` keeps every context gate out of the replayed state, so `L-02` refusing an invented key is the assertion |
| GS-054 | AS-02 | R-29's cross multiplication **turning over on a manufactured denominator**. Days one and two are AS-02's stated position exactly, best day 100,000c on period profit 200,000c failing by 133,334c; days three to five are its "three manufactured days of roughly 45,000c each", and 335,000c is the first profit at which the gate passes. At day four it still fails, so the fifth day is load bearing. Account B is not in the file and cannot be, and that is the assertion rather than a limitation |
| GS-061 | AS-08 | That **the firm pays the peak and not the mean**, in two fields that coincide only on a peak: `balance_cents` and `high_water_balance_cents` are both 5,255,000. R-35 at the five closes gives 20,000, 0, 110,000, 20,000 and 155,000, a mean of 61,000 against a peak of 155,000. The peak overshoots the 150,000c cap by 5,000c on purpose, so AS-08's "not exploitable beyond the cap" is a fact about R-43 rather than a hope |
| GS-242 | [ADR-024](../../../docs/decisions/ADR-024.md) | **A second size**, on a new plan record [`plans/CORE-150K.json`](plans/CORE-150K.json) transcribed from [Appendix A.1](../../../docs/plans/M01-rules-engine.md)'s 150K column. Four bp-expressed parameters are pinned and each breaks a different field: the 600bp target lands the pass on exactly 900,000c, the 500bp drawdown is pinned through the breach check (day two's low is exactly 14,250,000c and R-21's strict `<` lets it survive), the 30bp win floor by a 45,000 / 44,999 pair that only a floor of 45,000 scores as 2 of 3, and the 200bp buffer by the withdrawable. `min_payout_cents` is pinned by **placement**: 20,000c is above the 10,000c minimum and below the 30,000c a scaled minimum would produce |

**Three of the four could not pin a floor, and the reason is new.** GS-044 and GS-242 cross an eval pass, GS-054 jumps past the lock trigger, and in both cases the floor has two readings. The full accounting is in sections 1 and 2 below. **GS-061 is the exception and pins all three floor fields**, because it never locks and never passes: it is the only shape in this directory where the floor is unambiguous on the last day.

**GS-021 and GS-022 correct a claim this file made after batch 2**, which is recorded rather than quietly edited. The held-back table said a non-positive consistency denominator "requires the period to have been reset by a settlement (R-47)". It does not: **R-31's funded reset zeroes the same accumulators**, and more simply, a funded account whose period has not been reset at all reaches a negative denominator the first time it has a losing stretch. The rule was reachable the whole time. What made it *look* blocked was reading R-30 as an eval rule, and R-30 is unreachable in eval for a different reason worth stating: with no adjustment, eval period profit **is** the closing balance minus the size, so a day that meets a 300,000c target has a denominator of at least 300,000c. R-30 has nothing to do at the eval gate and everything to do at the funded one.

**The batch of one that took it from twenty-nine to thirty is [GS-064](GS-064-breach-and-payout-eligibility-on-the-same-day.yaml), and the batch is one on purpose.** [Session 48](../../../docs/sessions/2026-08-17-session-48.md) checked mechanically that every M1-owned scenario was either a fixture or a held-back row, and it was right. So batch 5 had nothing left to transcribe and did the other half of the job instead: **it checked the held-back reasons against their primary sources**, which is the discipline this corpus keeps paying for. One of the reasons was wrong and three were incomplete.

**The wrong one was GS-064's, and the error is the corpus's own recurring shape.** The row read "six trading days after the win-day gate is satisfied", which is arithmetic on **`win_days.required_count = 5`**. That is [Appendix A.1](../../../docs/plans/M01-rules-engine.md)'s figure. [Appendix A.2](../../../docs/plans/M01-rules-engine.md) carries **3**, so on `MERIT-RAPID-50K` the cheapest eligible close is day three and the breach lands on day four, inside the five sessions the calendar already declares. **The plan record it needed had been sitting in [`plans/`](plans/MERIT-RAPID-50K.json) since batch 2**, put there by the session that wrote GS-020, GS-023 and GS-024 for exactly the reason that Core EOD could not express them. A correct observation about one plan, carried one unchecked step to the directory: [session 47](../../../docs/sessions/2026-08-16-session-47.md) named this pattern, session 48's engine log found it a third time in the DO ordering table, and this is the fourth.

| Fixture | Source | What it asserts that no earlier fixture does |
|---|---|---|
| GS-064 | M1 extension | **That the eligibility decision is not made from the account's numbers but from the pipeline's ordering.** Every input the decision reads is pinned at the value it held at the previous close, where all six engine gates passed, and `engine_eligible` is `false` beside them. The stream's fourth day is a **traded win day closing at a new high** whose low is one cent under the trailed floor, so DO-6, DO-7 and DO-9 would each have made the account look *more* eligible; DO-4 returns before any of them run |

**`engine_eligible` is pinned here and nowhere else, and the asymmetry with GS-055 is the reason it is safe.** GS-055 declined to pin `true` because M01 lists R-38 as a funded gate in group F while declaring its input on `ExternalGates`, so the conjunction's membership is unruled. `false` does not depend on that: R-25's row says "no eligibility" in its own words and section 3.6's breach block writes `engineEligible: false` outright. **A contested conjunction still has one uncontested value**, and this fixture takes only that one.

**What batch 5 deliberately did not do: add a calendar.** A longer synthetic slice was the obvious repair and it was worked out before it was found to be unnecessary, so the reasoning is recorded rather than discarded. It would have been legitimate on [`calendar.ts`](../src/calendar.ts)'s own `GAPPED_SLICE` precedent, where session 47 ruled that "what TR-01 forbids is writing down which days the exchange trades" and a slice supplied to make two answers disagree is not that. **It was dropped because it unblocks nothing.** GS-064 fits in four sessions on Merit Rapid, GS-070's blocker turned out not to be the calendar, and every other held-back row is blocked on a settlement, a clamp, a nested gate, a second account, or an input `EngineInput` does not have. **A convention introduced for a fixture that did not need it is a convention the next session inherits and cannot audit.**

**What the format cannot yet reach, named rather than left as an absence:**

| Held back | Why |
|---|---|
| GS-001, GS-003, GS-004, GS-030 to GS-032 | They turn on a session's **kind**: a fill timestamp inside a session, a half day, a halted day. **Corrected by batch 5.** This row read "`cme-2026.json` declares five full sessions and no fill stream, and inventing either would be transcription from recollection", which is true and is **not the binding blocker**. `EngineInput` carries **no calendar at all**, so `is_half_day` and `halted` reach nothing whatever the calendar declares, and GS-001's fill timestamp is R-01's, which `DailyMark` does not carry and which is discharged at ingest. **Transcribing the CME year would move none of these six.** They need `EngineInput` to grow a `CalendarSlice`, and GS-001 needs a home for a fill instant that no plan document puts on a mark |
| GS-026 to GS-029, GS-042 | Payout arithmetic. `evaluatePayout` and `clampPayout` are not the day fold, and the expectation sibling has no shape for a clamp result |
| GS-060, GS-080 | The `skipped: true` shape. Both turn on a gate rendering as **disabled rather than as satisfied**, which lives in `engine_gates`. That is a nested object and [`compare.ts`](../../golden-loader/src/compare.ts) diffs flat fields with `Object.is`, so a nested expectation could never match by reference. GS-021 and GS-022 reach R-30's denominator **state** and say in their own siblings that they cannot reach its flag. **GS-080 carries a second half and it has its own blocker**, added by batch 5: "asserts that `engineEligible` is unaffected" needs a fixture pinning `engine_eligible: true`, and no fixture may pin that direction while M01 lists R-38 in group F and declares its input on `ExternalGates`. GS-055's sibling is where that was found and [GS-064](GS-064-breach-and-payout-eligibility-on-the-same-day.expected.json) is why it does not block the `false` direction |
| GS-052, GS-053, GS-065 to GS-068, GS-081, GS-082 | They turn on a **settlement**, and `L-11` refuses a fixture that states one because `EngineInput` has no home for it |
| GS-070 | **Rewritten by batch 5, and GS-064 left this row.** The recorded reason was the calendar: both were "reachable in principle and not inside five sessions", because eligibility "is six trading days after the win-day gate is satisfied" and extending `cme-2026.json` by hand is not available. **That reason was Core EOD's and was read as the directory's** (see below). GS-070's real blocker is that **`funded_start_not_size` cannot be reached independently of `opening_mismatch`**: DO-3 tests `opening == prior.balance + adjustment` first, `L-11` fixes `adjustment_cents` at 0, and the prior balance after R-31's reset **is** `size_cents`, so any opening that trips AS-14's check trips INV-18 in the same pass. The sibling has no shape for an `AssertionFailure`, so a fixture could state that the day was refused and could **not** state which of the two refused it, and AS-14 is a claim about the second one |
| GS-049 | Its registry row names **three** probe shapes: alternating 14,999c and 15,001c days, a single 1,000,000c day into consistency math, and 100-day flat grinds. One fixture is one stream, and the third needs 100 sessions. Writing the first alone would be a third of a row wearing a whole row's id |
| GS-056, GS-079 | GS-056's second half is a post-payout balance, so it needs a settlement. GS-079 needs a plan with a **hard daily loss limit**, and all three columns of Appendix A carry `none`, so the plan record would have to invent the one value the fixture turns on |
| GS-071 to GS-078, GS-083 | Replay, engine upgrade, and publish-time config validation, none of which is one account's day stream |
| GS-034, GS-035, GS-047 | **Added by batch 4.** None of the three is one ordered day stream. GS-034 needs a **superseding mark** and a replay forward; GS-035 needs a **clock**, which INV-01 forbids the engine from reading; GS-047 needs the **same day applied twice**, and `L-10` refuses a repeated day. **In GS-047 the loader rule that blocks the fixture is the same claim the scenario exists to assert** (INV-14, idempotence), which is worth stating rather than filing as a gap |
| GS-057, GS-058, GS-059, GS-241 | **Added by batch 4.** GS-057 and GS-058 are the correction window in both directions and need a **settlement plus an absorbed delta**, which is `L-11` and a sibling shape at once. GS-059 counts a cadence gap **across a holiday cluster**, which needs a calendar spanning one. GS-241 is INV-17's lifetime bound over **five settlements** |
| GS-062, and GS-054's account B | **Not a format gap and not fixable by one.** A golden fixture is one account's fold, because the engine is per account by design: "cross-account state inside a pure fold would destroy replay" (AS-09). GS-062's assertion is the identity-level **forecast**, which M6 owns and no per-account fold can produce. GS-054 is written from account A's side alone and its sibling says why that is the assertion rather than the limitation |
| GS-141 | Publish-time validation. `validatePlan` is P2-1, the scenario is about a **publish diff** across three plans rather than an account's day stream, and PW-02a against PW-02b is a message-classification claim no end state carries |

**Every M1-owned scenario is now either in this directory or on one of these rows.** That was not true before batch 4: the table listed reasons for the scenarios somebody had tried to write and was silent about the rest, and **silence and "held back" are not the same claim**. The set checked against is the [ownership index](../../../docs/testing/golden-scenarios/33-ownership-index-and-coverage-reconciliation.md)'s M1 partition, GS-001 to GS-032, GS-034 to GS-035, GS-042, GS-044, GS-047, GS-049, GS-052 to GS-083, GS-141 and GS-241 to GS-242. **GS-036 and GS-041 are deliberately not on it**: both carry an M1 assertion and neither is M1-owned, so they belong to M5's and M3's coverage rather than to this directory's.

**The inventory check is the half that stays off until then.** [STRATEGY section 3.2](../../../docs/testing/STRATEGY.md)'s second loader rule has two directions: a fixture whose id is not in the registry fails to load, which `L-03` does, and a registry row with no fixture fails the inventory check, which is CI-06's and would today fail on every scenario in the registry.

---

## Two readings this directory does not choose, and where each one bites a fixture

**A fixture that pins a contested value is a fixture that ratifies a ruling nobody made.** **Neither of these is a new finding.** [Session 45](../../../docs/sessions/2026-08-16-session-45.md) recorded both while writing batch 1 and the engine's DO-7, and [session 44](../../../docs/sessions/2026-08-16-session-44.md) recorded M01's third self-disagreement, on R-22's operator, which section 3.5 then settles outright ("the operator column is the contract") and `RE-U-022` asserts. **They are restated here because this is the file a fixture author reads**, and both of them decide whether a given expectation may state a floor.

**The first of the two is now ruled and the second is not.** Section 1 is kept in place, rewritten as the record of the ruling rather than deleted, because a fixture author who reads only the current text should still learn why three files pinned a contested value for two batches and why a fourth may now state it plainly.

### 1. The funded reset lowers the floor. RULED by [ADR-050](../../../docs/decisions/ADR-050.md) (2026-08-17)

R-31 sets `floor = size_cents - funded drawdown_cents` at the pass. On any 50K plan that is 4,750,000c. But the pass day's own close must clear a 300,000c target, so DO-7 has already trailed the floor to at least 5,050,000c **on that same day** before DO-8 rewrites it downward. INV-06 read "the floor never decreases, no exception, no phase qualifier", and the pseudocode's tripwire cannot see this one: `if (floor < s.floorCents) throw` runs at DO-7, strictly before the progression block that lowers it.

> **The founder ruled that `INV-06` gains a stated `R-31` exception.** The floor never decreases except at the funded reset. **4,750,000c is correct and citable**, and the alternative of scoping the invariant per `(account, phase)` was declined rather than merely not chosen, because a scope qualifier silently permits every step that crosses a phase boundary while an exception names the one step that is permitted.

**GS-019, GS-020 and GS-023 are confirmed rather than edited.** All three pinned `floor_cents: 4750000` through batches 1 and 2, batch 3 wrote nothing further that depended on it, and batch 4 is the first that could cross the pass freely. **`RE-P-01` is unblocked** and states the exception in the property rather than in a comment.

**What the ruling did NOT reach is why three of batch 4's four fixtures still pin no floor.** `INV-07` reads "a locked floor never changes again for the **life of the account**", and the same reset **clears the lock**: `progression.ts` writes `floorLocked: false` at DO-8 on a derivation from section 3.4's floor machine that is sound and is still not a ruling, because R-31 does not name the flag at all. `RE-P-02` fails on GS-019 the way `RE-P-01` did. **So a fixture that crosses an eval pass cannot pin `floor_cents`, `floor_locked` or `high_water_balance_cents` on any day after the pass**: under "cleared" the floor trails and the high-water balance follows the closes, under "carried" both are frozen. **The one floor such a fixture could pin is the reset itself**, which is unambiguous because DO-8 overwrites both DO-7 candidates with the same number. GS-044 and GS-242 both take that route and both say so in their own siblings.

### 2. The floor lock disagrees with itself when the trigger is crossed by a jump

[M01 section 3.4](../../../docs/plans/M01-rules-engine.md) gives the founder's binding expression, `floor = max(hwb - drawdown, floorLocked ? lock_floor : size - drawdown)`, and calls the `max` redundant "by CV-12". [Section 3.6](../../../docs/plans/M01-rules-engine.md)'s pseudocode instead **assigns** `floor = floorLockFloorAtCents`.

CV-12 makes them agree only when the closing balance lands **exactly** on the trigger, which is GS-015's case and is what GS-015 exists to pin. On a close that overshoots, they do not. At 50K with a close of 5,400,000c the trailing floor is 5,150,000c and the locked floor is 5,010,000c: 140,000c apart, on the value every later breach compares against.

**The engine already resolved this in its own layer and that does not resolve it here.** Session 45 landed the `max` and `CI-02/engine-R-15` seeds the assignment back. But TR-01 is the whole reason this directory exists: **a fixture that took its floor from the engine would be proving the code agrees with itself.** M01 still says two things, so an expectation still states neither.

Where it bites: **GS-069** is a four-day stream whose lock engages 140,000c past the trigger. It pins no floor, and every low on its later days is set above **both** candidates, so its breach outcome is the same under either reading. **GS-055** is the counter-case and shows what the resolution costs: its minimum-variance path tops out 10,000c short of the trigger, the lock never engages, there is only one reading, and it pins `floor_cents` and `floor_locked: false` outright.
