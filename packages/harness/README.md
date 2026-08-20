# @merit/harness

**`DEP-M21-01`. The Monte Carlo harness: a trial loop and an aggregator over
[`packages/rithmic/src/simulator`](../rithmic/src/simulator/session.ts)'s day
model, folded through the real rules engine.**

It is not a simulator written from nothing. `session.ts` opens *"THE DAY MODEL.
One account, one session, in integer cents and integer ticks"* and exists because
`daily_marks` needs a high and a low balance and the low is the breach comparison
input. That is the correct inner loop and this package does not replace it: it
drives it one session at a time, folds each day through
[`@merit/rules-engine`](../rules-engine/src/index.ts), asks the engine for an
eligibility, settles what the engine approves, and aggregates the result.

```
population model  ->  daily_marks per account per trading day
                          |
                          v
                  packages/rules-engine  (the real one, unmodified)
                          |
                          v
             rule_states, eligibility, settlements
                          |
                          v
                  aggregate funnel  ->  RE-S-nn bands
```

---

## The one rule that makes it valid

[SIMULATION_HARNESS section 4](../../docs/testing/SIMULATION_HARNESS.md), carried
into [M21](../../docs/plans/M21-plan-designer.md) as `INV-M21-09`:

> The harness may not contain a single line that decides a gate, a breach, an
> eligibility, or a payout amount. It generates balances and fills and it reads
> outcomes.

Three questions it would be cheapest to answer itself, and where each one goes:

| Question | Answered by |
|---|---|
| Is this account eligible today? | `evaluatePayout`, every day, as the portal asks it |
| How much may it take? | `evaluation.maxPayoutCents`, which is `0n` when the answer is no |
| Does a second request stack? | `R-38`. The loop supplies the fact that an external leg is outstanding, which M01 section 2.1 makes the caller's job, and never the verdict |

What the loop does decide is behaviour: **when** the trader asks (`PP-09` and
`AS-08`) and what the account trades after its first payout (`PP-05`). Both are
population parameters the corpus names, both are caller-supplied, neither is a
rule.

`test/no-second-rulebook.test.ts` asserts the boundary mechanically rather than
leaving it to review: plan parameters are read in `src/assertions.ts` and nowhere
else, and the only bigint literals in `src/` are `0n`, `1n`, `10n` and `10_000n`,
so no plan figure can arrive as a form default (`INV-M21-10`).

---

## What every result carries

**A projection without provenance is a number nobody can defend later.**
`INV-M21-04` makes that structural: *"a simulation result without a calibration
identity and a sample size cannot be rendered. Absent provenance is an error
state, never a blank field."* So `Provenance` is a required property of every
output record, with one constructor, and it carries the harness version, the
engine version, the seed, the calibration id, its digest, its observation date
and the run's sample size.

The output's **own** sample size sits beside its value and is not the run's trial
count: `RE-S-03` is over payers, `RE-S-02` is over funded accounts, and a
10,000-trial run can produce a payouts-per-payer figure computed over eleven
accounts. `AS-M21-02` is that read as a signal.

**An output with no sample is absent and never zero**, which is `HO-07`'s rule
generalised. The two places it bites both look like they want a number: a plan
with no evaluation phase has no pass rate (Direct funds on purchase, and 100
percent is the calibration source's convention rather than an observation), and a
run with no payer has no payouts-per-payer.

**There is no clock in this package.** The observation date travels with the
calibration and is never compared to one, because a projection whose value
depends on when it was rendered cannot be reproduced. M21's surface does that
comparison.

---

## What it produces

M21 requirement (b)'s eight outputs, in `src/outputs.ts`:

| Output | Identifier |
|---|---|
| Evaluation pass rate | `RE-S-01` |
| Funded to first payout | `RE-S-02` |
| Payouts per paying account | `RE-S-03` |
| Liability per funded account | none. `HO-09` proposed by `OQ-M21-03` |
| Contribution per buyer | none. `HO-10` proposed |
| Contribution margin at the entered price | none. `HO-11` proposed |
| Per-day extraction at the ceiling | `RE-S-05` |
| Lifetime extraction per account | `RE-S-06`, checked as a hard bound |

plus `HO-01`'s funnel report (`checkBands`), the funnel counts every rate divides,
and a sweep facility whose arms are individually traceable (`HO-08`).

**Money is integer cents and no aggregate is a float.** A mean is a division, so
every value is an exact `Ratio` of two `bigint`s and every comparison is a cross
multiplication; `toBasisPoints` and `format` exist for a surface that needs one
number, and the pair is always carried beside them.

---

## What it does NOT do, named rather than left absent

**A harness whose gaps are invisible is a harness whose gaps get discovered by a
reserve decision.** Everything below is out of scope for this package and belongs
to work that owns it.

| Not built here | Where it belongs |
|---|---|
| **The portfolio risk engine**: `RE-S-07` (mean monthly payout), `RE-S-08` (`CVaR99` at `rho = 0.30`, the reserve floor), `RE-S-09` (the ruin table), `HO-02`, `HO-03` | It aggregates across a book of accounts with a correlation structure (`PP-06`). This package produces the per-account liability distribution such an engine consumes, and stops there |
| **`PP-10`, the adversarial cohort, and `HO-05`'s labelled fixture population** | [M07](../../docs/plans/M07-risk-abuse.md). SIMULATION_HARNESS names `PP-10` as "the parameter that makes this harness worth more than a spreadsheet, and the one most likely to be dropped for being hard". It is dropped here, and this row is the record of it |
| **`HO-04`** (CUSUM `mu_0` and `sigma` per plan) | [M06](../../docs/plans/M06-admin-ops-console.md) `DEP-M6-05` |
| **`HO-07`** (the day-one `rho` estimator) | It needs live data and the field is absent until it exists |
| **`HO-06`** (the wallet float projection) | `PP-09` is a knob here and the float projection that reads it is [M20](../../docs/plans/M20-wallet.md)'s |
| **`RE-S-10`** (breach rate by funded cycle) and **`RE-S-11`** (detected share of the adversarial cohort) | The first needs a per-cycle breakdown this aggregate does not cut; `PP-05` is implemented so the behaviour that produces it is present |
| **`PP-01` to `PP-04`, the skill mixture** | The day model draws a per-account drift and volatility from caller ranges, which is coarser than "per-trader true Sharpe drawn from a mixture". A caller can approximate the mixture by weighting the population's drift range, and that is an approximation rather than the model |
| **Writing anything** | Output is a value. `INFRA section 9` and `AS-M21-04` put simulation output in `test-results/` and never in the production database; this package returns a `HarnessRun` and the caller decides where it goes |
| **The real trading calendar** | `DEP-M21-08`. Sessions and their half-day and halted flags arrive as caller data, because there is not one calendar row in this repository yet (P2 section 6). A synthetic calendar of identical days silently removes the most calendar-sensitive rules from a run |
| **The cost stack** | `mc_lifecycle.py` computes no contribution line and the workbook's cost tab is an `.xlsx`. The commercial terms are caller inputs, so **SIMULATION_HARNESS section 9.2's contribution-margin column is not reproducible from this package alone** |

---

## Four things found while building it, reported and not acted on

This session's fence is `packages/` and excludes `docs/`, so each of these is
recorded here and in the session log rather than fixed in the document that owns
it.

1. **`liability per funded account` may be `RE-S-04` under another name.**
   `RE-S-04` is "firm dollars per funded account", and `mc_lifecycle.py` computes
   that figure as `avg_firmcost_per_funded` over an accumulator whose own comment
   reads *"firm cash outflow = trader's split"*. That is the sum of the trader
   legs over funded accounts, which is the liability figure M21 lists as
   unidentified. If they are one output, `OQ-M21-03` needs two new identifiers
   rather than three.

2. **`RE-S-nn` names two different lists.** SIMULATION_HARNESS section 5 says
   *"`RE-S-nn` is M01 section 8.3's identifier"*, and the two tables disagree:
   M01's `RE-S-02` is INV-17's bound, which is section 5's `RE-S-06`; M01's
   `RE-S-03` is the peak-picking policy requirement, which section 5 gives to
   payouts per payer. This package cites section 5 throughout, because it is the
   harness's own document, and the collision is worth an ADR.

3. **`AS-08` is a direct requirement on this port and reads as an aside.** M01:
   *"the simulation harness must model request timing as a strategy, not as a
   random draw, or the CVaR99 estimate that drives the reserve is biased low.
   This is a direct requirement on the Monte Carlo port."* It is implemented
   (`RequestPolicy`), and it is named here because a build session reading only
   SIMULATION_HARNESS would not have found it.

4. **`SD-M21-01` carries one `swept_value_bp` column and `HO-08` sweeps a
   count.** A ladder of 5 is five rungs and not five basis points. The harness
   records the unit beside the value; whether `0045` grows a unit column is the
   migration's question.

---

## Running one

```ts
import { runHarness } from '@merit/harness';

const run = runHarness({
  seed,                 // what the accounts DO
  engineVersion,        // what the fold ran under, for replay scoping
  plan,                 // a ResolvedPlan, from resolvePlan
  population,           // a PopulationSpec: who the accounts ARE
  sessions, specs, sequenceBase,
  behaviour,            // PP-05, PP-09 and AS-08's request policy
  commercial,           // the price, the discount, the rebuys, the variable cost
  context,              // R-40's gates, the caller's to resolve
  calibration,          // the identity, its date, and its bands
});

run.aggregate.outputs; // eight records, each with its provenance and sample size
run.aggregate.lifetimeBound; // RE-S-06, a bound that holds or does not
run.bands;             // HO-01, with `not_measured` as a third verdict
```

`runSweep(sweepId, arms)` runs N of those and reports the two facts no single arm
can see: the smallest sample any output reached, and the outputs that came back
identical in every arm. When outputs come back identical it carries section 9.3's
warning with the finding, because **a flat line means "no effect on the mean" and
not "no effect"**, and the ladder's whole value is tail protection.

The population's `seed` and the run's `seed` are separate on purpose: a sweep that
wants the same traders under two configurations holds the first fixed and varies
the second.
