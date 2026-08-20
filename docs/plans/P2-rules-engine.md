---
status: draft
depends_on: [M01-rules-engine.md, ../DELIVERY_PLAN.md, ../testing/STRATEGY.md, ../testing/golden-scenarios/README.md, P1-monorepo-scaffold.md, P1-SE-trading-calendar.md]
last_updated: 2026-08-16
---

# P2: the rules engine

**A phase plan, not a module plan. Money path throughout.** [M01](M01-rules-engine.md) is the specification and this document does not re-specify it. What follows is the five things that make P2 the longest pole rather than transcription, the sequencing they force, and the four rulings that must land before any engine code does.

## Context

P1 is done except TradingCalendar's data. [`packages/rules-engine`](../../packages/rules-engine/README.md) ships the scaffold's identity stub: `evaluate(input)` returns the state it was given and emits nothing, `PlanConfigVersion` is a closed record carrying one field, and three purity mechanisms already enforce a contract no engine code has yet tested. P2 builds what M01 specifies in full: 50 rules, 19 config validations, 24 invariants, the replay self-audit, the simulator, and the nightly batch.

**Two premises this plan was briefed on are wrong on the tree, and both change it.**

| Briefed | Verified | Where |
|---|---|---|
| 272 golden scenarios exist | **<!--gen:gs_count-->316<!--/gen-->.** `GS-001` to `GS-284`, gapless | [golden-scenarios](../testing/golden-scenarios/README.md), sections 34 and 35 added `GS-258` to `GS-284` |
| Three mechanisms enforce engine purity | Correct, **and none of the three can see the case P2 introduces**: a capability passed as an argument. [`merit/engine-purity`](../../packages/eslint-plugin-merit/rules/engine-purity.js) says so in its own header | `packages/eslint-plugin-merit/rules/engine-purity.js` |

**The registry total is not the number P2 owes.** [DELIVERY_PLAN section 4](../DELIVERY_PLAN.md)'s done-condition is "all **engine-executable** golden files green". The ownership partition gives M1 **73** scenarios; the rest belong to the portal, the wallet, KYC, marketing and the others. **That partition is itself stale**: it sums to 257 and does not cover `GS-258` to `GS-284`.

---

## 1. The calendar, and the signature that keeps purity true

**M01's reference algorithm calls a function it never supplies.** `applySettlement` computes `consistencyPeriodStartDay: nextTradingDayAfter(fact.basisTradingDay)` ([M01 section 3.6](M01-rules-engine.md), R-47), and R-37 counts the cadence gap by `calendar.sequence` subtraction from `cadenceAnchorDay`, a day that may be months old. But `DayInput.calendar` is a single `CalendarDay` (section 2.1) and `replay` passes `calendar.get(mark.tradingDay)`, one row. **Neither rule can be computed from one row.** `CalendarSlice` appears in the `replay` signature and is defined nowhere.

This is a gap in an approved document rather than an implementation detail, so it lands as an ADR before code.

**Adopted: `CalendarSlice` is a value, not an interface.** A frozen ordered array of `CalendarDay` plus a precomputed index and a declared coverage interval, built by a pure exported constructor, with the calendar queries as free functions in `calendar.ts` over that value.

`merit/engine-purity` bans every non-relative import and every clock spelling, and `RI-01` asserts the manifest declares no workspace dependency. **Neither sees an interface whose implementation reads a database.** An interface carrying `get()` and `nextAfter()` is a capability: a caller could satisfy it with a live query, a memoiser, or something that consults the clock, and all three mechanisms would stay green. A value has no behavior to smuggle.

**The fourth mechanism, which belongs here because the other three cannot cover it.** `types.ts` already asserts `PlanConfigVersionIsClosed` with a `false`-not-`never` compile assertion. The same idiom extends: assert that `CalendarSlice` has **no function-valued property**. That makes "the calendar is data" a compile error rather than a review note, in the file that already carries the shape.

**The half that is load bearing: what a lookup miss does.** Replay will ask for the sequence of an anchor older than the slice.

| Answer | Verdict |
|---|---|
| Throw | **Rejected.** The fold's behavior would depend on how much calendar the caller loaded, which is a caller decision leaking into engine output |
| Return null and let the gate pass | **Rejected outright.** It silently weakens R-37, a money gate |
| **A typed refusal into `DayOutput.assertions`** | **Adopted.** Identical to DO-3's INV-18 handling: no state is written for the day, reconciliation is raised, nothing throws |

The coverage interval is not an invention. The fixture calendar already declares one and the loader enforces it (`L-08`), and [`0032`](../../packages/db/migrations/0032_trading_calendar_holidays_coverage_revisions.sql) makes an uncovered day a positive unknown per [ADR-042](../decisions/ADR-042.md) F-3. The engine reuses that idiom rather than inventing a second.

---

## 2. Fixture order, and what makes an expected value traceable

**The ordering follows from two rules already binding rather than from preference.** TR-02 puts the fixture before the function; constitution C10's writer/reviewer split says the session that writes the code is never the session that grades it.

**For each rule group: a fixture session writes the fixtures from M01 and Appendix A and watches them fail, then a separate engine session implements the group and they go green.** Alternating, never combined. A session doing both has derived its expectations from its own output, which is the failure TR-01 exists to prevent.

| Order | Rule group | Calendar needed | Notes |
|---|---|---|---|
| 1 | B marks, C floor, D breach | Session membership only | The five-session partial fixture calendar covers it. **GS-008, GS-009 and GS-011 are here and already exist** |
| 2 | E eval phase | Session membership only | |
| 3 | G payout arithmetic | None | `clampPayout` is pure arithmetic over a resolved plan |
| 4 | A time and calendar, F funded gates, H settlement | **Full slice, real data** | R-02, R-37 and R-47 need sequence subtraction across a range |

**So the calendar blocks the back half of P2 and not the front**, which is what makes starting legitimate while the data is absent.

**Traceability, in two tiers, because only one is mechanical.**

- **Mechanical.** `source:` is free text today. It becomes a resolvable citation: at least one `R-nn`, `CV-nn` or `INV-nn` that exists in M01, checked by a new rule in the loader's `L-nn` series, watched failing on its own seeded violation like the twelve that already are. This is CI-06d's discipline one directory over.
- **Human, but structured.** The expectation sibling already carries `note`, which the loader describes as where an author records why the expectation pins what it pins. It carries the arithmetic in integer cents from [M01 Appendix A.1](M01-rules-engine.md), so a reader checks the number instead of trusting it.

**Neither tier proves the number is right, and this plan does not pretend otherwise.** What proves it is that the fixture was written from the document by someone who had not written the code, which is a process property. The tiers make a violation visible; they do not make it impossible.

---

## 3. The CI-03 polarity flip

**The current probe cannot survive P2.** `engineIsIdentityStub()` folds one probe day and tests reference equality on the returned state. It is global and all-or-nothing, so **the moment the first rule lands, polarity flips to `direct` for every fixture at once**, including fixtures for rules not yet written, and the stage is red for the rest of P2. The design was right for the scaffold, where the engine was one step from nothing to something. M01 is fifty rules across eight groups and cannot land in one commit under [ADR-003](../decisions/ADR-003.md).

Two of the three ways out are already closed. Landing all fifty rules in one session is closed by ADR-003. A per-fixture `pending` flag is closed explicitly: the loader names it "the escape hatch a future session reaches for at 11pm when one scenario will not go green", and TR-03 forbids it.

**Adopted: polarity is derived per fixture, from the rules the fixture already cites.** The engine exports the set of rule identifiers it implements. If every rule a fixture's `source` cites is in that set, the fixture is `direct` and must match; otherwise it is `inverted` and must fail. **No fixture is edited and no flag is introduced**, which is the property the present design has and must keep. The direction is still read off the engine, per rule instead of per repository.

**The self-declaration risk and its answer.** A session could add a rule id without implementing the rule. M01 already requires one unit test per rule, fifty of them in the `RE-U-nnn` series, each asserting its operator at the boundary on both sides. The declared set is cross-checked against the passing `RE-U-nn` set, and a declared rule with no passing unit test fails the stage.

**What proves the flip happened is the measurement that already exists.** `coverage.ts` corrupts every loaded fixture and re-runs the stage's own assertion. Under inversion the corruption still passes and the report says the stage is blind; **when a group flips, that measurement becomes false for those fixtures on its own.** The only change is reporting it per rule group, so the block shows the flip advancing group by group. The mechanism is unchanged, which is the point.

---

## 4. Replay, the first time a calendar correction moves a day

**[M01 Appendix B.3](M01-rules-engine.md) has no row for this and the default it falls into is the wrong one.** Its table names three legitimate divergence causes: a superseded mark, a backdated mark, and an engine upgrade. Everything else is "no. Page."

**Verified on the tree: `rule_states` carries no calendar reference of any kind.** So replay cannot scope by calendar revision even if it wanted to. `trading_calendar_revisions` exists in `0032` and holds the prior image INV-04 needs, but nothing joins it to a state row.

**Why the gap is not small.** A mark correction changes one account's inputs. **A calendar correction changes the day sequence for every account at once**: every counter that advances per trading day, every cadence gap computed by sequence subtraction, every `nextTradingDayAfter`. The first holiday correction diverges the whole book and pages once per account. At 5,000 accounts that is 5,000 pages, which is exactly how Appendix B.5's own warning comes true: "a self-audit that becomes slow becomes a self-audit that gets disabled."

**Adopted: the calendar revision is the engine's second version-like input, and Appendix B.4's protocol already fits it.** `engine_version` is the code the fold runs; the calendar revision is the data it folds over. B.4 step 1 already scopes divergence detection to rows whose stored `engine_version` matches the running version.

1. `rule_states` carries the calendar revision it was computed under. **A migration, therefore money path**: its own session, plan mode, fresh context.
2. Replay compares only rows computed under the current revision. Older rows are out of scope until step 4, exactly as for an engine upgrade.
3. A revision triggers the dry run: accounts affected, fields changed, and **whether any changed day underlies a settled payout**.
4. Founder approval as an `admin_actions` row carrying the report digest.
5. Audited rewrite. **INV-22 holds: no settled payout's `eligibility_snapshot` is ever rewritten.**

**The wrinkle, stated so nobody re-derives it under pressure.** A calendar correction can insert or remove a day *between* two settled payouts and so change a cadence-gap count retroactively, which can make a settled payout retroactively ineligible. The corpus already rules this case in a different costume: B.3 and AS-05 say a correction under a settled payout is absorbed, flagged, reported, **never clawed back**. Nothing new is decided here.

---

## 5. The `PT-nn`, and P2's done-condition names SEVEN of them

**Seven of the eight need the engine, and the eighth is not an engine property at all.** That is not a scheduling accident; it is what "longest pole" means.

> **RULED (2026-08-16). `OQ-P2-04` is closed BOTH ways rather than either way, because both halves of the question were real.**
>
> **P2's done-condition names SEVEN properties.** `PT-03` is ledger zero-sum, it tests ledger transactions in aggregate, and **the ledger does not exist until P3**. A done-condition naming a property nothing in the phase can express is a done-condition that can never be met, and the honest repair is to stop naming it.
>
> **AND P2 owns the R-44 half.** `trader_cents + firm_cents == approved_cents` is **engine arithmetic in `clampPayout`**, it needs no ledger, and it is `INV-11`. It lands in P2 with group G, asserted by `GS-029`, **under its own name rather than as a fragment of `PT-03`**. Calling it half of `PT-03` is what made the property look half-expressible: it is not half of a ledger property, it is a whole engine one.
>
> **`PT-03` itself moves to P3 intact**, where the ledger it tests exists, keeping its pairing with `GS-231`.

| Property | Expressible before the engine? |
|---|---|
| PT-01 floor monotonicity, PT-02 win-day reset, PT-04 withdrawable floor, PT-07 idempotence | **No.** Each asserts over engine output |
| PT-05 clamp inequality, PT-08 lifetime bound | **No**, but each lands early: `clampPayout` and `applySettlement` are small pure functions with no calendar dependency |
| PT-06 replay determinism | **Harness yes, assertion no.** The `TZ` and `LC_ALL` randomization and the `RE-D-03` dependency-graph assertion are expressible and meaningful today; the determinism claim is vacuous against a stub |
| **PT-03 ledger zero-sum** | **Not an engine property, and NOT in P2's done-condition** (ruled 2026-08-16). It tests ledger transactions in aggregate and pairs with GS-231, an M20 wallet scenario. The ledger does not exist until P3, so it moves there whole. **The R-44 arithmetic half (`trader + firm == approved`, `INV-11`) is P2's and lands with group G under its own name** |

**PT-03 made P2's stated done-condition unsatisfiable as written, and the ruling above closes it.** The done-condition names **seven**, `PT-03` moves to P3 whole, and the R-44 arithmetic P2 genuinely owns is asserted under its own name instead of as a fragment of a property whose other half needs a ledger.

**What is genuinely buildable before the engine is the expensive half.** The `fast-check` generators: arbitrary day sequences, arbitrary settlement sequences, and arbitrary plans **satisfying CV-01 to CV-19**. A generator that emits only valid plans is the config contract made executable, it depends on nothing but the ruled parameter set, and every one of the eight consumes it.

**The trap to name: a property test against the identity stub passes vacuously.** So each `PT-nn` ships with a seeded mutant it has been watched failing on, which is `falsify.mjs`'s discipline and what [STATE](../STATE.md) already says the VG gates should have arrived with. Stryker is ruled for this package and nightly only, which makes it the proof that the properties bite rather than a coverage vanity number.

---

## 6. The blocking dependency

**There is not one calendar row in the repository, and the transcription is blocked on the founder.** [P1-SE](P1-SE-trading-calendar.md) session 3 landed the source contract, the generator and eighteen seeded violations; the CME publication could not be retrieved, and nothing was written from recollection because that is what TR-01 forbids.

Groups 1 to 3 above proceed without it. **Groups A, F and H cannot**, and neither can the simulator, the nightly batch or the replay self-audit, all three of which fold real day sequences. This is the largest schedule risk in P2 and it is a founder item rather than an engineering one.

---

## 7. Session sequence

Every session below is money path: fresh context, one objective, plan mode, [ADR-003](../decisions/ADR-003.md) strict. Each prompt is written when the prior session lands, so it names what actually exists.

| # | Session | Kind |
|---|---|---|
| **P2-0** | **The four rulings in section 8.** No engine code | ADRs |
| P2-1 | `resolvePlan`, `validatePlan`, CV-01 to CV-19, the `RE-C-nn` suite | engine |
| P2-2 | Fixture session: groups B, C, D. Watched failing | fixtures |
| P2-3 | `advanceDay` DO-1 to DO-7 for groups B, C, D | engine |
| P2-4 | Fixture session: group E | fixtures |
| P2-5 | DO-8 eval progression, R-26 to R-32 | engine |
| P2-6 | `clampPayout`, group G, PT-05 | engine |
| P2-7 | The generators, PT-06's harness, `RE-D-01` to `RE-D-03` | test infra |
| **calendar data lands** | | **founder** |
| P2-8 onward | Groups A, F and H; `applySettlement`; replay; simulator; nightly batch | engine |

---

## 8. What must be ruled before P2-1

Four items, each blocking, none an engineering call.

| # | Item | Form |
|---|---|---|
| **OQ-P2-01** | `CalendarSlice` as a value, its coverage interval, and a miss returning an assertion. Widens `DayInput` in an approved document | **CLOSED**, [ADR-049](../decisions/ADR-049.md) |
| **OQ-P2-02** | The calendar revision on `rule_states`, and Appendix B.4's protocol extended to it | **CLOSED**, [ADR-047](../decisions/ADR-047.md). **`0034` is claimed and unwritten**: the migration is money path and takes its own session |
| **OQ-P2-03** | Per-fixture polarity derived from the declared rule set. It changes what a green CI-03 means, which is what [ADR-038](../decisions/ADR-038.md) exists to keep honest | **CLOSED**, [ADR-048](../decisions/ADR-048.md). **It carries a stated prerequisite**: section 2's resolvable-citation `L-nn` rule lands before or with it, because a fixture citing nothing makes the polarity test **vacuously true** |
| **OQ-P2-04** | PT-03's status in P2's done-condition | **CLOSED** (2026-08-16), section 5. The done-condition names **seven**; `PT-03` moves to P3 whole; the R-44 arithmetic half is P2's under its own name |

**Two records also needed correcting, and neither was P2's to fix silently. Both are fixed as of 2026-08-16.** The ownership partition in [golden-scenarios section 33](../testing/golden-scenarios/33-ownership-index-and-coverage-reconciliation.md) summed to 257 and did not cover `GS-258` to `GS-284`; the twenty-seven are now assigned and the partition sums to the registry. And **P2 owes M1's owned set of 73** rather than the registry total, which section 33 now states where the partition is read rather than only here.

---

## 9. Verification

Per session, each a command with an output rather than a claim.

- `pnpm run verify` green: typecheck, lint, format, the invariant suite, every Vitest project.
- `node scripts/corpus/gates.mjs check` still reports every gate passing, and `node scripts/corpus/falsify.mjs` is green.
- **Every new `L-nn` loader rule and every `PT-nn` watched failing on its own seeded violation**, naming the finding rather than merely exiting non-zero.
- CI-03's coverage block regenerated: polarity per group, the corruption probe's result, and the registry fraction, all re-derived on the run.
- **On engine sessions:** every rule in the declared set has a passing `RE-U-nn` asserting its operator at the boundary on both sides.
