---
status: draft
depends_on:
  [
    ../../docs/plans/M01-rules-engine.md,
    ../../docs/plans/M02-rithmic-bridge.md,
    ../../docs/plans/P2-rules-engine.md,
  ]
last_updated: 2026-08-17
---

# The demo: the simulator, through the engine

```
node scripts/demo/run.mjs                       # the default run
node scripts/demo/run.mjs --help
node scripts/demo/run.mjs --seed abc --days 40 --accounts 3
```

Seeds a population against **Core EOD at 50K**, runs the synthetic simulator in
file mode for N trading days, folds `advanceDay` over every account, and prints
what happened: balance, floor, high-water balance, win days, consistency, every
gate with its have and its need, and eligibility.

**Everything is in memory.** No database, no file written, no network call, no
clock read. **No dependency was added** (VG-12): the entry is a `.mjs` shim that
registers a twenty-line resolve hook so Node's own type stripping can load the
workspace's TypeScript sources.

**A demo, not a product surface.** It imports each package's published entry
point only, touches nothing under `packages/rules-engine/src` or `test`, and
builds no handler, page or route.

## What it demonstrates by default

| | |
| --- | --- |
| `DEMOSTDY000001` | funds on 2026-11-19 and **reaches eligibility** on 2026-12-01, $1,022.50 payable at ordinal 1 of 5 |
| `DEMORISK500001` | **breaches**, and the platform's own auto-liquidation record is the evidence |
| `DEMOSWNG250002` | **breaches a trailed floor the platform setpoint is nowhere near**, so there is no vendor liquidation record at all |

The three are asserted in `test/determinism.test.ts`, because a demo that
quietly stopped showing one of them would still look complete.

## Reading the table

Left of `bal` is what the **platform** reported for the day. `bal` and
everything right of it is what the **engine** holds after folding it. They agree
on every day but one: on the eval pass, R-31 resets the balance to `size_cents`
in the same step as the pass, so `closing` is what the trader finished the
evaluation with and `bal` is what they start funded with.

The `gates` column is six characters, `T W B C G M`: traded days, win days,
buffer, consistency, cadence gap, minimum amount. **Uppercase passes, lowercase
fails, a dash is a skipped gate** and that third state is not decoration: CV-19
and R-37 report `skipped` precisely so a disabled gate renders as disabled
rather than as satisfied (GS-080).

A leading `*` marks the day the platform account was re-provisioned at
`size_cents` (INV-M2-07).

## Determinism

`--seed` reproduces the report byte for byte. `pnpm vitest run --project unit`
asserts it, and asserts the converse so the comparison cannot pass vacuously.

The property is the two packages': `buildPopulation` is "a pure function of
`(seed, i)`" and `advanceDay` is "pure, total, and the only place a rule is
applied". What the test protects is the demo's own use of them.

## The boundaries of what watching this proves

**It skips the file.** In the real pipeline the simulator renders an EOD report,
`ingestEOD` reads it, the normalizer writes `daily_marks`, and the batch folds
from there (INV-M2-11). This calls `simulate()` and converts the day in memory.
**So it proves nothing about the CSV rendering or the normalizer**, which are
the two places INV-M2-11 is actually about.

**The calendar is a fiction and says so.** `sessions()` produces consecutive
weekdays with no holidays, no early closes and no halts, because there is not
one calendar row in this repository and the CME publication has not been
transcribed (P2 section 6). R-04 (no win day on a halted session) is therefore
present in the engine and unexercised here.

**No settlement ever happens.** The fold always passes an empty
`SettlementFact[]`, so group H never runs, no account acquires a
`cadenceAnchorDay`, and **R-37 reports `skipped` on every row of every run**.
The cadence gap is the one gate this demo cannot show binding.

**The context gates are constants.** `CLEAN_CONTEXT` answers all five of R-40's
questions permissively, so the only thing moving in the output is the engine
half of eligibility. A run that wanted to watch a freeze or a KYC hold changes
that one record and nothing else.

## What the first watched run surfaced

Four things, none of them fixed here: the engine belongs to another session.

### 1. Merit's floor trails and the platform's setpoint does not

`DEMOSWNG250002` locked its floor at $50,462.50 on 2026-11-16 and breached on
2026-11-19 at a low of $50,095.00. The platform setpoint was $47,500.00, pushed
once at provisioning. **The gap was $2,962.50 and the platform had no reason to
act**, so the breach carries no auto-liquidation record.

That account closed the day **up $745.00 on its size**, and was breached.
Nothing there is wrong: R-13 trails the floor, ADR-014 makes the lock permanent,
and the low is the breach comparison input (0014). But DATA_CAPABILITIES section
1 names the EOD report's liquidation record as Merit's breach evidence, and on
this shape of breach there is nothing to cite. **How often M2 re-pushes the
setpoint is an M02 question** and this run makes the cost of "once, at
provisioning" visible in cents.

### 2. A disabled consistency rule reports as satisfied, not as disabled

`consistencyOk` returns `{ ok: true, skipped: false, bestDayShareBp: null }`
when `cfg.enabled` is false, and its own header says `skipped` **is not**
`!enabled`. So Core EOD's `phase.passed` payload reads
`consistency={bestDayShareBp=null maxDayShareBp=null satisfied=true
skipped=false}` on a plan whose eval consistency is **disabled**.

That is the vocabulary CV-19 fixed, quoted in the same file: a gate that was
never evaluated must be "visibly disabled in the eligibility breakdown ... so no
trader or support agent ever sees a gate that reads as satisfied when it was
never evaluated". The funded gate is enabled on all three v1 plans so nothing in
the lineup renders wrong today; **the eval half of R-28 is where this would
surface**, and it surfaces in an event payload M16 and M04 both read.

### 3. `EngineEvent` cannot be narrowed by a consumer

`DayOutput.events` is `readonly EngineEvent[]`, and `EngineEvent` is
`{ type: string; tradingDay }`. The nine concrete events extend it and **no
discriminated union is exported**, so a consumer that wants `PhasePassedEvent`'s
`resetFloorCents` must cast. This renderer walks each event's own fields instead,
which needs no cast and has the better property anyway, but a portal rendering
one event type per screen will reach for the cast.

### 4. A breach day is never a traded day

`DEMORISK500002` traded on 2026-11-02, was liquidated, breached, and its state
carries `tradedDaysCount: 0`. DO-4 returns before DO-6, which is R-25's ordering
law working exactly as written ("breach beats everything on the same day"). It
is worth knowing before someone reconciles a traded-day count against a fill
count and finds them off by one on precisely the accounts that closed.

## Files

| | |
| --- | --- |
| `run.mjs` | the executable. Registers the hook, imports `main.ts`, writes |
| `ts-resolve.mjs` | the resolve hook: `./x.js` retried as `./x.ts` after the ordinary resolution fails |
| `config.ts` | the plan, the symbols, the three cohorts, the session window |
| `bridge.ts` | `SimDay` to `DailyMark`, `SimSession[]` to `CalendarSlice` |
| `fold.ts` | `advanceDay` over one account, including the R-31 re-provision |
| `render.ts` | the report, as a pure function |
| `main.ts` | flags, orchestration, and `runDemo` which returns the string |
| `test/determinism.test.ts` | the seed reproduces, and the run still shows both sides |
