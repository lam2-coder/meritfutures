# The golden fixture format

**The format is ruled, not designed here.** [STRATEGY section 2](../../../docs/testing/STRATEGY.md) chooses "YAML plus an expected end-state JSON sibling" and [GOLDEN_SCENARIOS section 2](../../../docs/testing/golden-scenarios/README.md) prints a worked example of it. This file records what the loader does with that ruling, the two places the corpus is ambiguous and how each was read, and the forty M1-owned scenarios this directory cannot yet state, each with a reason re-derived against its own primary source rather than inherited.

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

## The list of fields that reach no engine input is EMPTY, and three of the four that emptied it are what batch 7 spent

It held `account.phase`, `account.opened_on`, `days[].adjustment_cents` and `settlements`. All four were true of the **scaffold's** engine types; M01's fold has a home for every one, and [`loader.ts`](../../golden-loader/src/loader.ts)'s `AWAITING_M01_INPUT` is now `[]`.

**The choice was between dropping them silently and naming them.** A dropped input on a money path is the worst outcome available: the fixture states a condition, the engine never sees it, and the scenario passes while pinning something else. So the loader **refuses any fixture field it can neither map nor find on that list**, the list is one visible place in [`loader.ts`](../../golden-loader/src/loader.ts), and `L-14` asserts every entry is still used by some fixture so it cannot rot into a permanent excuse.

**`days[].adjustment_cents` IS THE ONE WHOSE EMPTYING NOBODY HAD CASHED, and it unblocked three scenarios.** The old rule was that it "may only be `0`, because carried-and-ignored is not an option on a money field". It is now `DailyMark.adjustmentCents`, SD-01's non-trading movement, applied at the open of its effective day (R-10), and INV-18 is stated against it. **A settled payout reaches a mark as an adjustment and M01's R-10 row cites GS-065 by name when it says so.** Three held-back rows turned on a balance movement the format could not state and now can: GS-056, GS-065 and GS-070.

**`settlements` is the one that did NOT come with the others, and `L-11` says why in its own message.** `DayInput.settlements` takes `SettlementFact`, which needs `payout_request_id`, `ordinal`, `approved_cents`, `basis_trading_day` and `effective_trading_day`; the fixture format has no block for them and inventing five fields inside the loader would be the loader writing a fixture. **The blocker moved from the engine to the format**, which is a smaller thing and a differently owned one: eight held-back rows are behind it.

## Every value here is transcribed from a plan document

**TR-01.** [`plans/CORE-50K.json`](plans/CORE-50K.json) is [M01 Appendix A.1](../../../docs/plans/M01-rules-engine.md)'s 50K column and nothing else, [`plans/CORE-150K.json`](plans/CORE-150K.json) is the same appendix's 150K column, and [`plans/MERIT-RAPID-50K.json`](plans/MERIT-RAPID-50K.json) is [Appendix A.2](../../../docs/plans/M01-rules-engine.md)'s. Every fixture's header comment names the rule and the registry row each number comes from. A fixture written by reading the implementation proves only that the code agrees with itself.

**The two Core records are one plan at two sizes, and that is checkable rather than asserted.** Every bp column in `CORE-150K.json` is byte-identical to `CORE-50K.json` because they are the same plan; every cents column is the 50K figure times three, with exactly one exception, and the exception is `min_payout_cents`, which [Appendix A](../../../docs/plans/M01-rules-engine.md)'s preamble fixes at 10,000 for every size (CV-15). **A reader who finds a bp value that differs between the two files has found a transcription error, not a size difference**, and GS-242 is the fixture that turns each derived cents figure into a field that moves if it is wrong.

**One discrepancy was found in the transcription and is not resolved here.** [GOLDEN_SCENARIOS section 3](../../../docs/testing/golden-scenarios/README.md)'s plan shorthand restates Appendix A's numbers in prose and gives Core EOD a **ladder of 8**; [Appendix A.1](../../../docs/plans/M01-rules-engine.md) gives **5** per [ADR-024](../../../docs/decisions/ADR-024.md), in the same sentence that names Appendix A "the only place these numbers are defined". The plan record follows the named authority. It needs a founder ruling, and no fixture here reads the field.

## The calendar is seven sessions, not a year

[`calendars/cme-2026.json`](calendars/cme-2026.json) covers `2026-10-30` to `2026-11-09`. **TradingCalendar as data is session S-E** ([P1 section 6](../../../docs/plans/P1-monorepo-scaffold.md)) and there is not one calendar row anywhere in this repository yet.

The file declares a `coverage` interval and `L-08` enforces it in both directions, so a partial calendar **cannot silently be mistaken for the CME year**: a fixture naming a day outside the window is refused rather than run against a calendar that does not know about it. When S-E lands, this file is **derived** from the seeded rows rather than maintained beside them.

**THE CALENDAR NOW REACHES THE FOLD, AND THIS PARAGRAPH SAID THE OPPOSITE UNTIL BATCH 7 RE-DERIVED IT.** It read "the calendar reaches no engine input, and that is a sharper fact than *it holds five sessions*": `EngineInput` was `{ planConfigVersion, accountState, dayMarks }`, `loadCalendar` returned a `Set` of day strings for `L-08` to check against, and the set was then discarded. **`DayInput.calendar` is a `CalendarSlice` (ADR-049), [`run.ts`](../../golden-loader/src/run.ts) builds it with `buildCalendarSlice`, and `advanceDay` looks every day up in it.** What that changes, and what it does not:

- **`sessions[].kind` IS READ, and the silent drop this section warned about is closed.** [`calendar.ts`](../../golden-loader/src/calendar.ts) maps `full` and `half` to `CalendarDay.isHalfDay` and **refuses a third spelling** rather than flattening it, which is `L-08`'s answer to the one place this format could previously drop a stated condition. So `is_half_day` no longer "reaches nothing whatever the calendar declares", and **GS-003 and GS-032 are blocked on the transcription alone**.
- **`halted` HAS NO SOURCE AND IS `false` ON EVERY DAY.** The record format has no key for it and `calendarRowsFromRecord` writes the constant, because inventing one would be the loader deciding a session was halted. R-04 is declared, `isWinDay` reads the flag, and **no fixture graded through this loader can reach it**. GS-004 and GS-031 therefore need a calendar key and a loader mapping **as well as** the transcription, which is one more thing than the held-back table used to say.
- **`sequence` is synthesized from position in the `sessions` array**, so it equals the dense calendar index only while the file stays contiguous. The repair is a `sequence` on the record and it belongs with the transcription.

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

**Thirty-three scenarios, against a registry that defines 284.** The count is the stage's own, re-derived on every run rather than written here, and the honest form of it is **33 of 284**.

**AND 284 IS THE WRONG DENOMINATOR FOR THE QUESTION A READER IS ACTUALLY ASKING.** 284 is the registry, and this directory can only ever hold **M1's partition of it, which is 73** ([ownership index](../../../docs/testing/golden-scenarios/33-ownership-index-and-coverage-reconciliation.md) 33.1). The other 211 are other modules' fixtures, in other suites, and a scenario written here that another module primarily owns would double-count against that module's coverage, which is the property the index calls a partition. So there are two true counts and each answers a different question:

| Count | The question it answers |
|---|---|
| **33 of 284** | What share of the registry has an executable fixture anywhere. This is CI-06's inventory figure and it is the one the stage re-derives |
| **33 of 73** | What is left **for this directory**. The remaining 40 are each on a named row below |

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

### Batch 6 wrote no fixture and was right to. Batch 7 re-derived the same forty-three and three of them had come unblocked

**Batch 6's zero was correct on its premise and the premise expired underneath it.** Its finding was that "every remaining scenario needs an input `EngineInput` does not have — a calendar, a settlement, a clamp result, a nested gate object, a second account, a repeated day, a clock", and on the tree it ran against that was true of all forty-three. **Four things changed after it:** the loader folds `advanceDay` with a real `CalendarSlice`, the fixture calendar reaches seven sessions, `openedOn` reaches `DayInput` (ADR-051), and `AWAITING_M01_INPUT` emptied. **Nobody had re-derived the list against them**, which is what this batch did, row by row, against each row's own primary source rather than against the previous list.

**Three rows came unblocked and every one of them turned on the same field.** `days[].adjustment_cents` stopped being pinned at zero, and a balance movement that is not a trading loss became statable:

| Fixture | The clause that expired | What it now asserts |
|---|---|---|
| [GS-070](GS-070-funded-start-balance-does-not-equal-size.yaml) | "`L-11` fixes `adjustment_cents` at 0, so any opening that trips AS-14's check trips INV-18 in the same pass" | With the credit stated, **INV-18 holds and INV-20 fails on the same mark**, so `funded_start_not_size` is the only assertion the day can raise and AS-14's claim is isolated from its neighbour's |
| [GS-065](GS-065-settled-payout-drops-the-balance-toward-a-floor-that-does-not-move.yaml) | "turns on a **settlement**, and `L-11` refuses a fixture that states one because `EngineInput` has no home for it" | The **payout day folds and closes**, R-19's three untouched fields are measured across it, and a day that consumes the whole post-payout loss room touches the floor without breaching (INV-21) |
| [GS-056](GS-056-locked-floor-converts-the-account-into-a-free-option.yaml) | "GS-056's second half is a post-payout balance, so it needs a settlement" | The locked half of R-19's loss-room sentence: **90,000c, exactly the buffer minus the lock offset**, all of it lost on one maximum-variance day, none of it ever withdrawable (AS-04) |

**THE THREE WERE NEARLY WITHDRAWN ON A BLOCKER THAT WAS LIFTED TWO DAYS BEFORE THEY WERE WRITTEN, AND IT IS THE SHARPEST THING THIS BATCH FOUND.** [EC-157](../../../docs/edge-cases/EC-157.md) is the finding that `INV-18`, `INV-19` and `0014`'s `daily_marks_balance_arithmetic` CHECK "have exactly one common solution and it is `adjustment_cents = 0`", and its own Golden-scenario line reads: "**GS-065's fixture cannot be written until this is ruled**". Every mark in these three files carries a non-zero adjustment, so on that entry all three are unwritable and this section would have been another zero.

**IT IS RULED. `EC-157` REPAIR A, 2026-08-16, and [`0036_supersede_daily_marks_balance_arithmetic.sql`](../../db/migrations/0036_supersede_daily_marks_balance_arithmetic.sql) IS MERGED**: the constraint is dropped and replaced with `closing = opening + realized_pnl`, because it was "the one artifact of five that disagrees with `INV-18`, `R-10`, `EC-034` and `0014`'s own column comment". **All eleven marks in these three fixtures satisfy the surviving constraint**, checked rather than assumed. **The edge case still reads `status: open` and still says `NOT RULED`**, and [STATE](../../../docs/STATE.md)'s open-items table still carries the entry. Neither is this directory's to edit and both are recorded here, because the file a fixture author reaches for is the edge case and it currently tells them to stop.

**A POST-PAYOUT BALANCE IS AN ADJUSTMENT AND M01 SAYS SO IN THE ROW THAT CITES GS-065.** R-10: "non-trading balance movements are applied between sessions and carried in `adjustment_cents` ... the withdrawal lands at the open of `effectiveTradingDay`". The held-back reason read "needs a settlement" and what those three rows actually needed was the **balance half** of one. What `applySettlement` additionally computes — R-46's anchors, R-47's reset, R-49's ladder, R-50's lifetime total — is what the eight rows still under `L-11` are about, and **none of the three files above pins one of those fields or cites a group H rule**.

**The reconciliation is mechanical rather than read by eye**, because that is the check batch 4 introduced and the only kind that stays true:

| | |
|---|---|
| M1 partition | **73** |
| Written | **33** |
| Named on a held-back row | **40**, and the rows also carry cross-references to written fixtures (GS-021, GS-022, GS-054, GS-055, GS-064, GS-065, GS-081) which are explanations inside other rows rather than claims that those files are missing |
| **Unaccounted** | **none** |

**Four reasons were corrected without being unblocked, and two of them would have sent a reader at the wrong thing.** An expired clause standing in front of a binding one is as misleading as a true one standing in front of a binding one:

- **GS-003 and GS-032 lost their engine clause and kept their transcription clause.** The row said `is_half_day` "reaches nothing whatever the calendar declares". It reaches `CalendarDay.isHalfDay` now. What still blocks them is that none of `cme-2026.json`'s seven sessions is a CME half day and declaring one would be a transcription from recollection.
- **GS-004 and GS-031 gained a clause.** `halted` has no key in the calendar record and no mapping in the loader, so the transcription **alone** would not move them. They were filed beside GS-003 as if one thing blocked all four.
- **GS-059 gained a clause.** Its recorded blocker was a calendar spanning a holiday cluster. R-37 also counts from `cadenceAnchorDay`, which only a settlement sets, so it is behind `L-11` as well as behind the transcription.
- **GS-076, GS-077, GS-078 and GS-083 have GS-141's shape.** `validatePlan` has landed, so "config validation is unwritten" is no longer any part of why they are here; the row's head clause, that none of them is one account's day stream, is the whole of it. **That is the third instance of this shape in three batches** and it is now the thing this table is checked for rather than a thing that keeps being noticed.

**One reason was re-checked and stands exactly as written**, which is worth recording because it is the one a reader would most expect to have moved: `engine_eligible: true` is still unpinnable. M01 puts R-38 under **Group F: funded gates** while its input `hasPayoutInFlight` is declared on `ExternalGates`, and R-40's context list does not name it. R-41 is `engineEligible && contextEligible` and says nothing about which gates are in the left operand. **The engine has chosen a reading; M01 has not**, so a fixture pinning `true` would ratify it. GS-055's sibling found this and GS-080's row inherits it.

### What these thirty-three fixtures currently prove, and the window that closed

**Stated plainly here because the stage's own block states it per run, and a reader of this directory is not looking at a CI log.**

**THE INVERTED WINDOW IS OVER AND THIS SECTION DESCRIBED IT AS THE PRESENT TENSE FOR THREE BATCHES.** It read "`run.ts` still folds `evaluate`, the scaffold's identity evaluation, which returns the state it was given and emits nothing", so these files proved only that they parsed, that their ids were in the registry, that each stated a pin and a resolvable citation, and that each **failed** against a fold computing nothing. `runFixture` folds **`advanceDay`** now. What that changes is everything the previous paragraph said it did not cover:

- every expected end state is compared **field by field against the rules it cites**, so a corrupted expectation now fails rather than passing;
- every event sequence is compared in order;
- and a fixture that would pass against any engine at all no longer exists, because there is no longer an engine that computes nothing.

**What it does NOT prove, which is the half worth keeping.** `stateHash` is not compared (SD-08 belongs to `hash.ts`), the `engine_gates` breakdown is not reachable by a flat expectation, and nothing here exercises `evaluatePayout`, `clampPayout` or `applySettlement`: the stage folds one function and the held-back table below is largely a list of what the other three own.

### The polarity every one of the thirty-three derives, and the premise that now holds

[ADR-048](../../../docs/decisions/ADR-048.md)'s per-fixture derivation and `L-13` have both landed. The result, read off the stage rather than reasoned about:

**All thirty-three derive `direct`. None derives `inverted`.** Every fixture in this directory cites at least one `R-nn`, the engine declares 46 of 50, and the four it does not (R-01, R-05, R-11, R-20) are cited by no fixture here, so every citation resolves. **The empty-citation case that derives `inverted` catches nothing here** — it is a guard against a fixture that has not been written yet, not a reclassification of any that has.

**THE DERIVED DIRECTION IS NOW ENFORCED, AND NOTHING WAS EDITED TO ENFORCE IT.** This section recorded the opposite: the derivation was "reported and not enforced, because its premise does not hold ... no declared rule is reachable from the fold at all". `declaration.holds` went true the moment `run.ts` folded the functions the declaration describes, the standing TR-02 assertion switched off and the derived one switched on, with no fixture edited and no flag removed. That is the property ADR-048 was built for, observed rather than argued.

> **The ruling this section reported as living in one source comment was withdrawn, and the withdrawal is incomplete in the file that made it.** [`coverage.ts:125`](../../golden-loader/src/coverage.ts) and [`fixtures.golden.test.ts:174`](../../golden-loader/test/fixtures.golden.test.ts) both now say the attribution was wrong: "no such ruling exists and none is needed: a derived direction cannot be enforced against a fold that reaches none of the rules a fixture cites, which is a fact about the tree rather than a decision". **`fixtures.golden.test.ts:202` still opens `FOUNDER RULING, 2026-08-17`**, twenty-eight lines below the sentence retracting it. Not fixed here: it is outside this directory's fence. Recorded because a retraction that leaves one copy standing is worse than the original claim — the next reader finds the two and cannot tell which is current.

**THE FORTY ROWS, RE-DERIVED AGAINST THEIR OWN PRIMARY SOURCES BY BATCH 7.** Each row names the M01 rule group its scenario sits in, states whether the recorded reason **still binds**, and where a clause has expired says which one. **A held-back reason is a claim with a shelf life** and this table is now checked rather than inherited.

| Held back | Group | Why, re-derived |
|---|---|---|
| GS-001 | A | **Binds, and not on the calendar.** R-01 is a claim about which trading day a **fill instant** belongs to. `DailyMark` carries no timestamp, no plan document puts one on a mark, and R-01 is one of the four rules the engine does not declare because it is discharged at ingest. A transcribed CME year moves this not at all |
| GS-003, GS-032 | A | **Binds on the transcription alone, and the engine clause has EXPIRED.** The row read that `is_half_day` "reaches nothing whatever the calendar declares". `kind: "half"` maps to `CalendarDay.isHalfDay` now, `advanceDay` looks the day up, and R-03 is declared. What is left is that **none of `cme-2026.json`'s seven sessions is a CME half day**, and declaring one would be transcription from recollection |
| GS-004, GS-031 | A | **Binds on TWO things, and the table used to name neither.** `halted` has **no key in the calendar record** and [`calendarRowsFromRecord`](../../golden-loader/src/calendar.ts) writes the constant `false`, so R-04 is declared, `isWinDay` reads the flag, and no fixture graded through this loader can set it. The transcription **alone would not unblock these**: they need a record key and a loader mapping with it |
| GS-030 | A | **Binds.** DST is data: R-05 stores session bounds as UTC instants derived from CT definitions, the calendar record states a `trading_day` and a `kind` and nothing about session length, and R-05 is undeclared. "The 23 hour and 25 hour sessions each produce exactly one trading day" is a claim about the ingest boundary, not about the fold |
| GS-026 to GS-029, GS-042 | G | **Binds, and the reason has sharpened rather than softened.** `clampPayout` and `evaluatePayout` now EXIST ([`payout/`](../src/payout/)), which the row's old phrasing could be read as denying. The fold is `advanceDay` and the diff is taken against `RuleState`, which carries **no clamp result**: `approved_cents`, `clamp_reason`, `trader_cents` and `firm_cents` live on `PayoutEvaluation`, which no fixture in this format ever sees. GS-042's `10000 >= 10000` half is R-39's gate verdict, which is inside `engine_gates` and hits the row below |
| GS-060, GS-080 | F | **Binds on `compare.ts`, and half of GS-060 is now reachable.** Both turn on a gate rendering as **disabled rather than satisfied**, which lives in `engine_gates`. [`compare.ts`](../../golden-loader/src/compare.ts) diffs flat fields with `Object.is`, so a nested expectation can never match. **GS-060's first half — that the farming pattern buys nothing against the real gates — is assertable today** in flat counters, and writing it alone is a half-row wearing a whole row's id, which is GS-049's objection. **GS-080's second half is unchanged and was re-checked**: `engine_eligible: true` may not be pinned while M01 lists R-38 under Group F and declares `hasPayoutInFlight` on `ExternalGates` |
| GS-052, GS-053, GS-066, GS-067, GS-068, GS-081, GS-082 | H | **Binds, and the blocker MOVED from the engine to the format.** `DayInput.settlements` is a `SettlementFact[]` and DO-2 applies them in ordinal order, so the engine's home exists. `L-11` refuses a non-empty list because the fixture format has no block for `payout_request_id`, `ordinal`, `approved_cents`, `basis_trading_day` and `effective_trading_day`. **Every one of these seven pins something only `applySettlement` computes**: an ordinal (GS-052, GS-066), a win-day reset anchored at the basis day (GS-053, GS-082), the ladder count (GS-067), R-47's period boundary (GS-068), or the settlement itself (GS-081). **GS-065 left this row** because it pinned none of them |
| GS-049 | A, F | **Binds, unchanged.** Three probe shapes on one row: alternating 14,999c and 15,001c days, a 1,000,000c day into consistency math, and **100-day flat grinds**. One fixture is one stream and the third needs 100 sessions against a seven-session calendar |
| GS-079 | D | **Binds, unchanged, and it is the cleanest TR-01 case in the table.** The fixture turns on a **hard daily loss limit** and all three Appendix A columns carry `none` (`CORE-50K.json`: `"daily_loss_limit": null`). A fourth plan record would have to state a value no plan document states, and a fixture graded against it would be checking the engine against the fixture author's invention |
| GS-071 to GS-075 | — | **Binds.** Replay and engine upgrade. `replay` does not exist, R-11 is undeclared, and none of the five is one account's ordered day stream: GS-072 is arrival order, GS-073 is process environment, GS-074 is a supersession, GS-075 is a cross-version diff report |
| GS-076 to GS-078, GS-083 | — | **Binds on the head clause, and the tail clause has EXPIRED — GS-141's shape, a third time.** `validatePlan` has landed, so "config validation is unwritten" is no longer any part of this. What binds is structural and always was: a publish validation returns a `ValidationResult` against `(rules, sizes[])`, and this format folds one account's day stream and diffs a `RuleState`. `RE-C-nn` is the suite that owns them |
| GS-034, GS-035, GS-047 | B | **Binds, unchanged.** GS-034 needs a **superseding mark** and a replay forward (R-11, undeclared). GS-035 needs a **clock**, which INV-01 forbids the engine from reading. GS-047 needs the **same day applied twice**, which `L-10` refuses at load and `advanceDay` answers with `not_forward` — **the loader rule that blocks the fixture is the claim the scenario exists to assert** (INV-14, idempotence) |
| GS-057, GS-058 | B, H | **Binds on three things.** A correction needs a **superseding mark** (R-11, undeclared), the scenario needs a **settlement** for the correction to land after, and "the absorbed amount is computed and reported" needs a field: `RuleState` carries neither an absorbed delta nor `corrected_days_in_period` |
| GS-059 | F | **Binds, and it gained a clause batch 7 added.** The recorded reason was a calendar spanning a holiday cluster, which is true. R-37 counts trading days from `cadenceAnchorDay`, and **only a settlement sets one**, so this row is behind `L-11` as well. Filed under the calendar alone, it would send a reader to transcribe a year and find the fixture still unwritable |
| GS-241 | H | **Binds, unchanged.** INV-17's lifetime bound over **five settlements**, which is `L-11` five times |
| GS-062, and GS-054's account B | — | **Not a format gap and not fixable by one.** A golden fixture is one account's fold, because the engine is per account by design: "cross-account state inside a pure fold would destroy replay" (AS-09). GS-062's assertion is the identity-level **forecast**, which M6 owns and no per-account fold can produce. GS-054 is written from account A's side alone and its sibling says why that is the assertion rather than the limitation |
| GS-141 | — | **Binds on its two structural clauses.** Corrected by batch 6 and re-checked here: the leading "`validatePlan` is P2-1" clause is gone, the scenario is a publish diff **across three plans** rather than one account's day stream, and `PW-02a` against `PW-02b` is a message-classification claim **no end state carries** |

**Three rows left this table and each one is named on the batch-7 list above**: GS-056, GS-065 and GS-070. **Forty remain**, and the M1 partition reconciles: 33 written, 40 held back, 73 total, **nothing unaccounted and nothing counted twice**. A sweep of the leading cell is what reconciles it; batch 6 recorded that sweeping the whole region instead reports five false positives, because a row's `Why` cell names neighbouring fixtures to explain what a blocker is not. **`GS-054` in the last row's leading cell is the one remaining exception** and it is a cross-reference too: the row is GS-062's and names account B of a fixture that exists.


**R-32 has no row above because it has no golden scenario, and that is the corpus's choice rather than an omission here.** `ADR-051` unblocked eval expiry and asked the implementing session to settle the fencepost with an executable pin at the boundary. The pin landed in [`RE-U-032`](../test/rules-e-progression.test.ts) and **not** as a fixture, for three reasons checked before the decision rather than after it:

- **[M01](../../../docs/plans/M01-rules-engine.md)'s coverage column names `RE-U-032` and nothing else.** R-13's cites `GS-009, GS-011` and R-25's cites `GS-063, GS-064`, so the column does carry golden scenarios where the corpus intends them. R-32's carries a unit test alone, which makes the unit test its *designated* pin instead of a substitute for one.
- **There is no scenario to write.** [GOLDEN_SCENARIOS](../../../docs/testing/golden-scenarios/README.md) runs to GS-284 and none of them is eval expiry. Minting a 285th would add a row to a frozen document, which is an ADR and not a commit.
- **And the plan record would have to invent `max_days`.** All three Appendix A columns carry `null`, so a fixture turning on an expiry needs a fourth plan file stating a value no plan document states. **That is GS-079's blocker exactly** (the hard daily loss limit row above), and TR-01 is the rule it breaks: "a fixture written by reading the implementation proves only that the code agrees with itself".

The boundary is pinned either way, on both sides, and the fencepost mutant in [`falsify-ci.mjs`](../../../scripts/ci/falsify-ci.mjs) is watched failing on `RE-U-032` by name.

**Every M1-owned scenario is now either in this directory or on one of these rows.** That was not true before batch 4: the table listed reasons for the scenarios somebody had tried to write and was silent about the rest, and **silence and "held back" are not the same claim**. The set checked against is the [ownership index](../../../docs/testing/golden-scenarios/33-ownership-index-and-coverage-reconciliation.md)'s M1 partition, GS-001 to GS-032, GS-034 to GS-035, GS-042, GS-044, GS-047, GS-049, GS-052 to GS-083, GS-141 and GS-241 to GS-242. **GS-036 and GS-041 are deliberately not on it**: both carry an M1 assertion and neither is M1-owned, so they belong to M5's and M3's coverage rather than to this directory's.

**The inventory check is the half that stays off until then.** [STRATEGY section 3.2](../../../docs/testing/STRATEGY.md)'s second loader rule has two directions: a fixture whose id is not in the registry fails to load, which `L-03` does, and a registry row with no fixture fails the inventory check, which is CI-06's and would today fail on every scenario in the registry.

---

## Two readings this directory does not choose, and where each one bites a fixture

**A fixture that pins a contested value is a fixture that ratifies a ruling nobody made.** **Neither of these is a new finding.** [Session 45](../../../docs/sessions/2026-08-16-session-45.md) recorded both while writing batch 1 and the engine's DO-7, and [session 44](../../../docs/sessions/2026-08-16-session-44.md) recorded M01's third self-disagreement, on R-22's operator, which section 3.5 then settles outright ("the operator column is the contract") and `RE-U-022` asserts. **They are restated here because this is the file a fixture author reads**, and both of them decide whether a given expectation may state a floor.

**BOTH ARE NOW RULED, AND THE SECOND WAS ACCEPTED WHILE BATCH 7 WAS RUNNING.** Section 1 fell to [ADR-050](../../../docs/decisions/ADR-050.md) and section 2 to [ADR-052](../../../docs/decisions/ADR-052.md), `status: accepted`, founder approval granted 2026-08-17 (PR #81). Both are kept in place, rewritten as records of their rulings rather than deleted, because a fixture author who reads only the current text should still learn why files pinned around a contested value for four batches and why they no longer have to.

### 1. The funded reset lowers the floor. RULED by [ADR-050](../../../docs/decisions/ADR-050.md) (2026-08-17)

R-31 sets `floor = size_cents - funded drawdown_cents` at the pass. On any 50K plan that is 4,750,000c. But the pass day's own close must clear a 300,000c target, so DO-7 has already trailed the floor to at least 5,050,000c **on that same day** before DO-8 rewrites it downward. INV-06 read "the floor never decreases, no exception, no phase qualifier", and the pseudocode's tripwire cannot see this one: `if (floor < s.floorCents) throw` runs at DO-7, strictly before the progression block that lowers it.

> **The founder ruled that `INV-06` gains a stated `R-31` exception.** The floor never decreases except at the funded reset. **4,750,000c is correct and citable**, and the alternative of scoping the invariant per `(account, phase)` was declined rather than merely not chosen, because a scope qualifier silently permits every step that crosses a phase boundary while an exception names the one step that is permitted.

**GS-019, GS-020 and GS-023 are confirmed rather than edited.** All three pinned `floor_cents: 4750000` through batches 1 and 2, batch 3 wrote nothing further that depended on it, and batch 4 is the first that could cross the pass freely. **`RE-P-01` is unblocked** and states the exception in the property rather than in a comment.

**What the ruling did NOT reach is why three of batch 4's four fixtures still pin no floor.** `INV-07` reads "a locked floor never changes again for the **life of the account**", and the same reset **clears the lock**: `progression.ts` writes `floorLocked: false` at DO-8 on a derivation from section 3.4's floor machine that is sound and is still not a ruling, because R-31 does not name the flag at all. `RE-P-02` fails on GS-019 the way `RE-P-01` did. **So a fixture that crosses an eval pass cannot pin `floor_cents`, `floor_locked` or `high_water_balance_cents` on any day after the pass**: under "cleared" the floor trails and the high-water balance follows the closes, under "carried" both are frozen. **The one floor such a fixture could pin is the reset itself**, which is unambiguous because DO-8 overwrites both DO-7 candidates with the same number. GS-044 and GS-242 both take that route and both say so in their own siblings.

### 2. The floor lock disagrees with itself when the trigger is crossed by a jump

[M01 section 3.4](../../../docs/plans/M01-rules-engine.md) gives the founder's binding expression, `floor = max(hwb - drawdown, floorLocked ? lock_floor : size - drawdown)`, and calls the `max` redundant "by CV-12". [Section 3.6](../../../docs/plans/M01-rules-engine.md)'s pseudocode instead **assigns** `floor = floorLockFloorAtCents`.

CV-12 makes them agree only when the closing balance lands **exactly** on the trigger, which is GS-015's case and is what GS-015 exists to pin. On a close that overshoots, they do not. At 50K with a close of 5,400,000c the trailing floor is 5,150,000c and the locked floor is 5,010,000c: 140,000c apart, on the value every later breach compares against.

> **RULED. The locked floor is `floor_lock_floor_at_cents` BY ASSIGNMENT, and the engine is the side it goes against** ([ADR-052](../../../docs/decisions/ADR-052.md), accepted 2026-08-17). Section 3.4's expression becomes `floorLocked ? floor_lock_floor_at_cents : max(hwb - drawdown_cents, size_cents - drawdown_cents)`: **the lock is a branch, not a term in a `max`.** What decides it is `CV-11`'s derivation of `INV-21`, which reads "post-lock it **equals**" the locked floor — a premise the `max` makes false, on a value no publish-time check can bound because it depends on the lock-day close.

**THE ENGINE HAS NOT BEEN CHANGED YET AND `GS-024` IS THE RED THAT SAYS SO.** [`floor.ts`](../src/day/floor.ts) still takes the `max` and still carries the 25-line comment that is now the argument being overruled. `GS-024` pins `floor_cents: 5010000` and the engine produces `5050001`, which is the ruling arriving as a number rather than as a paragraph. **Nothing in this directory is edited for it**: the fixture was right when it was written and applying the ruling is an engine session's, under ADR-003.

**What this changes for a fixture author, stated because it is the useful half.** A locked floor is now pinnable on any close, not only on one that lands exactly on the trigger. The files written while it was contested took the exact-trigger route (GS-015, GS-016, GS-056) and are correct under both readings, so none of them moves.

Where it bites: **GS-069** is a four-day stream whose lock engages 140,000c past the trigger. It pins no floor, and every low on its later days is set above **both** candidates, so its breach outcome is the same under either reading. **GS-055** is the counter-case and shows what the resolution costs: its minimum-variance path tops out 10,000c short of the trigger, the lock never engages, there is only one reading, and it pins `floor_cents` and `floor_locked: false` outright.
