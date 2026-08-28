#!/usr/bin/env node
// =============================================================================
// scripts/ci/nightly-harness.mjs
// =============================================================================
// CI-09'S SIMULATION-HARNESS LEG. The whole of what the nightly workflow runs.
//
// [ADR-073](../../docs/decisions/ADR-073.md) section 5 rules CI-09 at ONE LEG
// OF FOUR. The simulation harness is that leg, on the stated ground that it
// "needs none" of the inputs the other three wait on: it is pure compute from a
// seed. The replay self-audit, Stryker on the engine and the detector canary are
// each disposition (b), waiting on a dated artifact, and NONE OF THEM IS BUILT
// HERE. A leg added because it looked easy is the thing that ADR forbids by name.
//
// It is also the answer to session 106's landmine, which ADR-073 section 5
// confirmed against the tree: `packages/harness` "exists with its own tests;
// nothing calls it", and no file outside the package imports `@merit/harness`.
// THIS FILE IS ITS CONSUMER.
//
// -----------------------------------------------------------------------------
// WHAT THIS ASSERTS, AND EVERY ONE IS A CORPUS IDENTIFIER RATHER THAN A NEW ONE
// -----------------------------------------------------------------------------
// No `<PREFIX>-nn` is minted here. ADR-074 makes a definition site a row inside
// a DECLARED register, and a series invented in a CI script is a claim on a
// namespace with no allocation table, which is what session 112 declined to do
// with `P-M6-11`. Each check below is named by the thing it enforces.
//
//   ADR-073 section 5   THE RUN DID SOMETHING. The funnel is non-empty
//   RE-S-06 / INV-17    lifetime extraction never exceeds `max_payouts * cap`
//   FM-05               every refusal is a `calendar_coverage_miss`
//   INV-M21-04          every output carries provenance and a sample size
//   SIM_HARNESS 7.2     the run is reproducible from its recorded seed
//
// **The first one is the one that would be left out, and it is the reason this
// file has assertions at all.** ADR-073 section 5 rejected the replay leg
// because with zero stored rows `runReplayAudit`'s `OI-14` refusal does not
// fire, so the nightly "would report `accountsAudited: 0`, `diverged: 0` and
// exit green, every night, over nothing". The ruling carries the obligation
// forward: "a leg whose activation condition is a seeded world must assert that
// the world is there." A Monte Carlo whose population never reaches funded is
// the same green-over-nothing one package to the left, so the funnel is asserted
// before anything is read off it.
//
// -----------------------------------------------------------------------------
// WHAT THIS DOES NOT ASSERT: SECTION 5'S CALIBRATION BANDS, AND WHY NOT
// -----------------------------------------------------------------------------
// [SIMULATION_HARNESS](../../docs/testing/SIMULATION_HARNESS.md) section 5 is
// eleven `RE-S-nn` bands and says "the nightly run asserts each band and fails
// the build on a breach". THIS RUN ASSERTS NONE OF THEM AND SUPPLIES NO BAND AT
// ALL, which is a smaller nightly than that sentence describes. Three artifacts
// are missing from this tree and each is checkable rather than argued:
//
//   the real lineup      Section 5's bands are stated "lineup blended", over
//                        Core EOD, Merit Rapid and Direct. The plan below is
//                        SYNTHETIC (see its own header). Reaching the real
//                        records in `packages/rules-engine/fixtures/plans/`
//                        needs a resolution path this fence does not own
//   the skill mixture    `PP-01` to `PP-04`. `packages/harness/README.md` lists
//                        it under what the package does NOT do: the day model
//                        draws a per-account drift and volatility from caller
//                        RANGES. `RE-S-01`'s pass rate is therefore a function
//                        of a range this file picked, so hitting the 12-to-20
//                        percent band would mean tuning the population until it
//                        landed, which is the assertion run backwards
//   the trading calendar `DEP-M21-08`. Section 4 is explicit that "a synthetic
//                        calendar of 252 identical days would silently remove
//                        the most calendar-sensitive rules from the run", and
//                        there is not one calendar row in this repository
//                        (P2 section 6). The sessions below are weekdays
//
// **So the choice was between a band that fails on arrival and no band, and the
// second is the ruled shape.** ADR-073 section 1 rejects the first in its own
// words: a rule applied to a table it cannot satisfy "produces a gate that FAILS
// ON ARRIVAL". Section 5 of that ADR rejects the other repair, which is to widen
// a band until the run fits inside it: that is `TR-03`, and SIMULATION_HARNESS
// section 5 names it as "the exact failure this harness exists to catch".
//
// The report says all of this on every run, in the run's own output, because a
// limitation recorded only in a pull-request body is read by nobody on run 200.
//
// -----------------------------------------------------------------------------
// WHY THE SCENARIO IS IN THIS FILE AND NOT IMPORTED FROM THE PACKAGE'S FIXTURE
// -----------------------------------------------------------------------------
// `packages/harness/test/canonical.ts` is a working run and importing it would
// have been shorter. It is not imported, for one reason: its calibration bands
// are "wide enough that a fixture population lands inside them, which is exactly
// what SIMULATION_HARNESS section 5 forbids a real band from being". A gate
// whose inputs are shaped to pass a unit suite is a gate that moves whenever
// that suite is edited, by an author who was not thinking about the nightly.
// The scenario a gate runs belongs in the file the gate is reviewed in.
// =============================================================================

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname } from 'node:path';

// Node 22 strips types from a `.ts` file on its own and prints an
// ExperimentalWarning while doing it. The warning is true and is not news; every
// other warning is still printed, because a filter that swallowed all of them
// would hide the next real one. `scripts/demo/run.mjs` makes the same call.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name !== 'ExperimentalWarning') process.stderr.write(`${warning.stack ?? ''}\n`);
});

// THE HOOK IS THE DEMO'S AND IS NOT COPIED. `scripts/demo/ts-resolve.mjs` is
// twenty lines that retry a relative `./x.js` as `./x.ts` after ordinary
// resolution has already failed, which is the one step Node does not do for a
// workspace that publishes its libraries from source. A second copy here would
// be a second thing to fix when Node's type stripping changes, and the hook is
// about the repository's module layout rather than about either caller.
register(new URL('../demo/ts-resolve.mjs', import.meta.url));

const harness = await import(new URL('../../packages/harness/src/index.ts', import.meta.url).href);
const { HARNESS_VERSION, format, runHarness } = harness;

// The two calendar primitives, from the package that owns them rather than
// reimplemented here. `scripts/demo` reaches the workspace libraries the same
// way and its tsconfig says why: there is no `node_modules` link to a workspace
// package from outside the workspace, and nothing in this repository is built,
// so a relative import of the published entry point is what a consumer outside
// `packages/*` has. THE POINT IS THAT NO `Date` APPEARS IN THIS FILE: a trading
// day is calendar data and `civilFromDays` is integer arithmetic on a day
// number, which is the idiom every other consumer of these sessions uses.
const rithmic = await import(new URL('../../packages/rithmic/src/index.ts', import.meta.url).href);
const { civilFromDays, parseTradingDay } = rithmic;

// =============================================================================
// THE SCENARIO
// =============================================================================
// **EVERY NUMBER BELOW IS SYNTHETIC AND NONE OF IT IS A CLAIM ABOUT MERIT.**
// Plan parameters are launch candidates that live as rows in
// `plan_version_sizes` and never as constants (STATE's standing parameter
// ruling, `INV-M21-10`); the transcription of the real lineup is
// `packages/rules-engine/fixtures/plans/CORE-50K.json` and this is not it.
//
// The plan is deliberately unlike the real one in every dimension a reader might
// mistake: a $10,000 size, a 2 percent target and a two-day win requirement. It
// carries the real lineup's LADDER LENGTH (5) and CADENCE GAP (5 trading days)
// because those two are what `RE-S-05` and `RE-S-06` are arithmetic over, and a
// nightly that exercised a three-rung ladder would be exercising a shape no
// published plan has.
//
// `INV-M21-09` is not weakened by any of it: nothing here decides a gate, a
// breach, an eligibility or a payout amount. The engine decides all four and
// this file supplies the configuration and reads the outcomes.

const PLAN = Object.freeze({
  planVersionId: '0199c7a1-0000-7000-8000-0000000000ce',
  sizeCents: 1_000_000n,
  eval: Object.freeze({
    drawdown: Object.freeze({
      type: 'trailing_eod',
      drawdownCents: 60_000n,
      lock: Object.freeze({ enabled: false }),
    }),
    dailyLossLimit: Object.freeze({ type: 'none' }),
    winDayFloorCents: 1_000n,
    profitTargetCents: 20_000n,
    minTradingDays: 1,
    consistency: Object.freeze({ enabled: false }),
    maxDays: null,
  }),
  funded: Object.freeze({
    drawdown: Object.freeze({
      type: 'trailing_eod',
      drawdownCents: 60_000n,
      lock: Object.freeze({ enabled: false }),
    }),
    dailyLossLimit: Object.freeze({ type: 'none' }),
    winDayFloorCents: 1_000n,
    minTradingDays: 0,
    winDaysRequiredCount: 2,
    consistency: Object.freeze({ enabled: false }),
    bufferCents: 5_000n,
    // The real lineup's figure, and it is here because `RE-S-05` divides by it.
    cadenceGapTradingDays: 5,
    payoutCapSchedule: Object.freeze([Object.freeze({ fromOrdinal: 1, capCents: 20_000n })]),
    minPayoutCents: 1_000n,
    splitBp: 9_000,
    // ADR-024's ladder length. `RE-S-06`'s bound is this times the largest cap.
    maxPayouts: 5,
  }),
});

/**
 * The population.
 *
 * IT IS DRAWN WITH A POSITIVE DRIFT, WHICH IS NOT THE REAL WORLD AND IS THE
 * POINT. `PP-02` is explicit that the literature's finding is a NEGATIVE
 * experience coefficient and that roughly 93 percent of the funded book has zero
 * or negative true edge. A population drawn that way produces almost no payouts,
 * and the paths this nightly exists to exercise at scale (settlement, the
 * ladder, the cycle arithmetic, `RE-S-06`'s bound) would never run.
 *
 * **So this run is a STRUCTURAL check of the harness and the engine at scale,
 * and its outputs are not projections.** A reader quoting `evaluation_pass_rate`
 * off this report is quoting a number about a drift range chosen in this file.
 * That sentence is in the report as well as here.
 */
const POPULATION = Object.freeze({
  accountCount: 0, // set from the trial count below
  sizes: Object.freeze([Object.freeze({ label: 'SIM-10K', sizeCents: 1_000_000n, weight: 1 })]),
  symbols: Object.freeze([
    Object.freeze({
      symbol: 'SIM1',
      exchangeMic: 'XSIM',
      priceDecimals: 2,
      referencePriceNumerator: 500_000,
      tickNumerator: 25,
      tickValueCents: 1_000n,
    }),
  ]),
  accountRefPrefix: 'NIGHTLY',
  userRefPrefix: 'NIGHTUSR',
  firstRefOrdinal: 1,
  riskMaxLossOffsetCents: 60_000n,
  // `V-M2-08`'s unprotected case: one account in six has no readable setpoint,
  // and the trial loop must leave it unprotected rather than push a floor onto
  // it. A run where every account is protected never folds that branch.
  unprotectedShareBasisPoints: 1_600,
  behaviour: Object.freeze({
    tradeRateBasisPoints: { min: 8_000, max: 10_000 },
    tradesPerDayMax: { min: 2, max: 4 },
    quantityMax: { min: 1, max: 2 },
    driftTicks: { min: 0, max: 2 },
    volatilityTicks: { min: 2, max: 5 },
    liquidationSlippageTicks: { min: 0, max: 2 },
  }),
});

/**
 * `PP-09`'s funding baseline: ask immediately.
 *
 * SIMULATION_HARNESS section 2.3 makes "100 percent, immediately" the
 * PESSIMISTIC cash-flow case and therefore the one the wallet is funded against.
 * `AS-08` requires the reserve estimate to be reported under both this and
 * `peak_picking` "so the bias is measured rather than assumed", and that pair is
 * NOT run here: the estimate `AS-08` is about is `CVaR99`, which the portfolio
 * risk engine computes and `packages/harness/README.md` lists under what the
 * package does not build. Running two arms to compare a number nobody consumes
 * would be a second run for a report.
 */
const BEHAVIOUR = Object.freeze({
  requestPolicy: Object.freeze({ kind: 'immediate' }),
  settlementLagTradingDays: 1,
  // `PP-05`. The post-payout risk-up cohort. A run without it "under-produces
  // breaches and over-produces liability".
  riskUpShareBp: 3_000,
  riskUpQuantityBp: 15_000,
});

/** Commercial terms for the synthetic plan. Not Merit's prices. */
const COMMERCIAL = Object.freeze({
  pricePerPurchaseCents: 20_000n,
  discountBp: 2_000,
  purchasesPerBuyer: Object.freeze({ numerator: 3n, denominator: 1n }),
  variableCostPerFundedAccountCents: 3_000n,
});

/** A clean context on every row, so the only thing moving is the ENGINE half. */
const CONTEXT = Object.freeze({
  accountStatus: 'active',
  kycState: 'verified',
  payoutsFrozen: false,
  reconBlocked: false,
  hasPayoutInFlight: false,
});

/**
 * A calibration source WITH NO BANDS, and the empty list is the assertion.
 *
 * `checkCalibrationSource` accepts it and `checkBands` returns nothing, so the
 * report carries zero band verdicts rather than a row of green ones. The header
 * above is why: section 5's bands describe the real lineup under a calibrated
 * population and a real calendar, and this run has none of the three. `note` is
 * read by a human and travels into the digest, so a session that later supplies
 * bands changes the digest and cannot do it silently.
 */
const CALIBRATION = Object.freeze({
  id: 'ci-09-nightly-no-calibration-of-record',
  observedAt: '2026-08-21',
  note:
    'NO BANDS. SIMULATION_HARNESS section 5 states eleven and this run asserts none: its plan ' +
    'is synthetic, its population has no PP-01..PP-04 skill mixture, and its calendar is ' +
    'weekdays rather than DEP-M21-08 calendar rows. The calibration of record is ' +
    'research/calibration/mc_lifecycle.py as re-run at the FREEZE gate.',
  bands: Object.freeze([]),
});

const ENGINE_VERSION = 'ci-09-nightly-not-a-build';

/**
 * The sessions: consecutive weekdays, integer arithmetic on the day number.
 *
 * NOT A CME CALENDAR, and section 4 says exactly what that costs: half days and
 * halts are the calendar semantics `GS-030` to `GS-032` pin, and a run of
 * identical days removes them. `DEP-M21-08` is the artifact.
 */
function weekdaySessions(startDay, count) {
  const pad = (value, width) => String(value).padStart(width, '0');
  let epochDay = parseTradingDay(startDay);
  const built = [];
  while (built.length < count) {
    // 1970-01-01 was a Thursday, so `(epochDay + 4) % 7` is 0 for Sunday and 6
    // for Saturday.
    const dayOfWeek = (((epochDay + 4) % 7) + 7) % 7;
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      const civil = civilFromDays(epochDay);
      const tradingDay = `${pad(civil.year, 4)}-${pad(civil.month, 2)}-${pad(civil.day, 2)}`;
      built.push({
        tradingDay,
        sessionOpenUtc: `${tradingDay}T13:30:00Z`,
        sessionCloseUtc: `${tradingDay}T20:00:00Z`,
      });
    }
    epochDay += 1;
  }
  return built;
}

// =============================================================================
// THE RUN'S DIGEST
// =============================================================================
// FIELD BY FIELD, IN A FIXED DECLARED ORDER, which is `provenance.ts`'s idiom and
// is here for its stated reason: the determinism contract bans "iteration over
// an object's keys where the result affects output", and `JSON.stringify` over a
// record literal is exactly that iteration wearing a library call as a disguise.
//
// It is hashed incrementally rather than assembled. A 10,000-trial run holds
// tens of thousands of settled payouts, and building one string of it to hash
// would be the only line in this file with a memory profile.

function digestRun(run) {
  const hash = createHash('sha256');
  const p = run.provenance;
  hash.update(
    [
      `harnessVersion=${p.harnessVersion}`,
      `engineVersion=${p.engineVersion}`,
      `seed=${p.seed}`,
      `calibrationId=${p.calibrationId}`,
      `calibrationDigest=${p.calibrationDigest}`,
      `calibrationObservedAt=${p.calibrationObservedAt}`,
      `runSampleSize=${String(p.runSampleSize)}`,
    ].join('|') + '\n',
  );
  for (const trial of run.trials) {
    hash.update(
      [
        trial.platformAccountRef,
        trial.sizeLabel,
        trial.sizeCents.toString(),
        trial.outcome,
        String(trial.startedInEval),
        String(trial.passedEvalOn),
        String(trial.reachedFunded),
        String(trial.firstFundedTradingDay),
        String(trial.breachedOn),
        String(trial.breachKind),
        String(trial.graduatedOn),
        trial.lifetimeSettledCents.toString(),
        trial.lifetimeTraderCents.toString(),
        String(trial.tradingDaysObserved),
        String(trial.inRiskUpCohort),
        String(trial.approvedRequestsNeverSettled),
        trial.refusal === null ? 'no-refusal' : `${trial.refusal.kind}@${trial.refusal.tradingDay}`,
      ].join('|') + '\n',
    );
    for (const payout of trial.payouts) {
      hash.update(
        [
          String(payout.ordinal),
          payout.basisTradingDay,
          payout.effectiveTradingDay,
          payout.approvedCents.toString(),
          payout.traderCents.toString(),
          payout.firmCents.toString(),
          payout.capCents.toString(),
          payout.clampReason,
          String(payout.cycleTradingDays),
          payout.cycleFirstTradingDay,
          String(payout.eligibleDaysWaited),
        ].join('|') + '\n',
      );
    }
  }
  const counts = run.aggregate.counts;
  for (const key of Object.keys(counts).sort())
    hash.update(`count.${key}=${String(counts[key])}\n`);
  for (const output of run.aggregate.outputs) {
    hash.update(
      [
        `key=${output.key}`,
        `unit=${output.unit}`,
        `registryId=${String(output.registryId)}`,
        `value=${output.value === null ? 'absent' : `${output.value.numerator}/${output.value.denominator}`}`,
        `sampleSize=${String(output.sampleSize)}`,
      ].join('|') + '\n',
    );
  }
  const bound = run.aggregate.lifetimeBound;
  hash.update(
    [
      `bound=${bound.boundCents.toString()}`,
      `observedMaximum=${bound.observedMaximumCents.toString()}`,
      `observedMaximumTrader=${bound.observedMaximumTraderCents.toString()}`,
      `holds=${String(bound.holds)}`,
      `sampleSize=${String(bound.sampleSize)}`,
    ].join('|') + '\n',
  );
  for (const band of run.bands) {
    hash.update(
      `band=${band.bandId}|verdict=${band.verdict}|sampleSize=${String(band.sampleSize)}\n`,
    );
  }
  return hash.digest('hex');
}

// =============================================================================
// THE CHECKS
// =============================================================================
// Each returns `{ name, cites, passed, detail }`. NONE OF THEM MINTS AN
// IDENTIFIER: `cites` is the corpus row the check enforces, and a check that
// could not name one would be a preference.

function checkFunnelIsNonEmpty(run) {
  const c = run.aggregate.counts;
  const empty = [];
  if (c.trials === 0) empty.push('trials');
  if (c.reachedFunded === 0) empty.push('reachedFunded');
  if (c.payers === 0) empty.push('payers');
  if (c.settledPayouts === 0) empty.push('settledPayouts');
  return {
    name: 'The run did something',
    cites: 'ADR-073 section 5, carrying OI-14 forward',
    passed: empty.length === 0,
    detail:
      empty.length === 0
        ? `${String(c.trials)} trials, ${String(c.reachedFunded)} reached funded, ` +
          `${String(c.payers)} paid, ${String(c.settledPayouts)} settled payouts, ` +
          `${String(c.breached)} breached, ${String(c.graduated)} graduated`
        : `EMPTY: ${empty.join(', ')}. Every rate below this point divides by one of them, so ` +
          'the outputs would be absent and the bound would hold over nothing. ADR-073 section 5 ' +
          'rejected the replay leg for exactly this shape: a clean report over zero subjects',
  };
}

function checkLifetimeBound(run) {
  const bound = run.aggregate.lifetimeBound;
  return {
    name: 'Lifetime extraction never exceeds max_payouts * cap',
    cites: 'RE-S-06, INV-17. A hard assertion and not a band',
    passed: bound.holds,
    detail: bound.detail,
  };
}

/**
 * Every refusal is a `calendar_coverage_miss`, and the scoping is the check.
 *
 * `AssertionKind` has eight members and they are two populations.
 * `opening_mismatch`, `closing_mismatch` and `funded_start_not_size` are
 * `INV-18` to `INV-20`, arithmetic identities the fold asserts about its own
 * input; `account_closed`, `not_forward`, `day_not_a_session` and
 * `eval_phase_without_eval_rules` are DO-1 preconditions the TRIAL LOOP controls
 * entirely. **A refusal of any of those seven is a defect in the engine or in
 * the harness** and this nightly is where it should surface.
 *
 * `calendar_coverage_miss` is the eighth and is not one of them. ADR-049 makes
 * it "the day is outside the slice's coverage, so the answer is UNKNOWN", and a
 * run over a FINITE window has an edge by construction: an account that passes
 * its evaluation on the last session has an `R-31` consistency period starting
 * on a day the slice cannot answer for. That is a property of the window and not
 * a finding, so it is counted and reported rather than failed on.
 *
 * IT IS NOT THEREBY ADVISORY. The check above fails if the window ever collapses
 * far enough that the funnel empties, which is the only way coverage misses
 * could quietly become the whole run.
 */
function checkRefusalKinds(run) {
  const byKind = new Map();
  for (const trial of run.trials) {
    if (trial.refusal === null) continue;
    byKind.set(trial.refusal.kind, (byKind.get(trial.refusal.kind) ?? 0) + 1);
  }
  const unexpected = [...byKind].filter(([kind]) => kind !== 'calendar_coverage_miss');
  const misses = byKind.get('calendar_coverage_miss') ?? 0;
  const example = run.trials.find(
    (t) => t.refusal !== null && t.refusal.kind !== 'calendar_coverage_miss',
  );
  return {
    name: 'No refusal other than a calendar coverage miss',
    cites: 'FM-05, ADR-049, and INV-18 to INV-20',
    passed: unexpected.length === 0,
    detail:
      unexpected.length === 0
        ? `${String(misses)} window-edge coverage miss(es) over ${String(run.trials.length)} ` +
          'trials, which is a property of a finite window and not a finding. No other kind'
        : `${unexpected.map(([k, n]) => `${k} x${String(n)}`).join(', ')}. ` +
          `First: ${example?.platformAccountRef ?? 'unknown'} on ` +
          `${example?.refusal?.tradingDay ?? 'unknown'}: ${example?.refusal?.detail ?? ''}`,
  };
}

/**
 * `INV-M21-04`: "a simulation result without a calibration identity and a sample
 * size cannot be rendered. Absent provenance is an error state, never a blank
 * field."
 *
 * The second half is `HO-07`'s rule generalised and is the half a renderer
 * breaks: `value: null` MEANS NOT MEASURED AND NEVER MEANS ZERO, and
 * `types.ts` states the correspondence exactly, "the denominator. Zero exactly
 * when `value` is null". So it is checked in both directions.
 */
function checkProvenance(run) {
  const findings = [];
  const digest = run.provenance.calibrationDigest;
  for (const output of run.aggregate.outputs) {
    const p = output.provenance;
    if (p === undefined || p === null) {
      findings.push(`${output.key}: no provenance`);
      continue;
    }
    if (p.calibrationId !== run.provenance.calibrationId || p.calibrationDigest !== digest) {
      findings.push(`${output.key}: provenance names a different calibration`);
    }
    if (p.seed !== run.provenance.seed)
      findings.push(`${output.key}: provenance names a different seed`);
    if (p.harnessVersion !== HARNESS_VERSION) findings.push(`${output.key}: harness version drift`);
    if ((output.value === null) !== (output.sampleSize === 0)) {
      findings.push(
        `${output.key}: value ${output.value === null ? 'absent' : 'present'} against sample ` +
          `size ${String(output.sampleSize)}. An output with no sample is absent and never zero`,
      );
    }
  }
  return {
    name: 'Every output carries provenance and its own sample size',
    cites: 'INV-M21-04, FM-M21-02, and HO-07 for the absent-not-zero half',
    passed: findings.length === 0,
    detail:
      findings.length === 0
        ? `${String(run.aggregate.outputs.length)} outputs, each carrying calibration ` +
          `${run.provenance.calibrationId}@${digest.slice(0, 12)} and its own denominator`
        : findings.join('; '),
  };
}

/**
 * The run is reproducible from its recorded seed.
 *
 * SIMULATION_HARNESS section 7.2: "the run is reproducible from a recorded seed,
 * and the seed is written into the report so a failure can be re-run exactly
 * rather than approximately. A HARNESS WHOSE FAILURES ARE NOT REPRODUCIBLE IS A
 * HARNESS WHOSE FAILURES GET ATTRIBUTED TO NOISE, which is the specific way this
 * kind of suite dies."
 *
 * THE LIMIT IS STATED RATHER THAN LEFT TO BE ASSUMED. Two calls in one process
 * catch a module-level counter, an unkeyed `Math.random`, and any iteration whose
 * order depends on insertion. They do not prove reproducibility across processes,
 * across Node versions or across machines. What carries that is the digest in the
 * report: two nights whose reports differ on it, with the same seed and the same
 * harness version, is a finding a reader can see without re-running anything.
 */
function checkDeterminism(first, second) {
  const a = digestRun(first);
  const b = digestRun(second);
  return {
    name: 'Two runs on one seed produce one result',
    cites: 'SIMULATION_HARNESS section 7.2, and INV-M21-04 for the seed on the record',
    passed: a === b,
    detail:
      a === b
        ? `sha256 ${a}, twice. Same process, so this proves the run is a pure function of its ` +
          'input here and not across processes or Node versions'
        : `FIRST ${a}\nSECOND ${b}\nThe same seed produced two results in one process`,
  };
}

// =============================================================================
// THE REPORT
// =============================================================================
// It goes to `test-results/`, which is SIMULATION_HARNESS section 4's rule
// carried from INFRA section 9: "output goes to `test-results/`, never to the
// production database and never into an agent's context. A 10,000-trader run
// produces on the order of a million marks, and a harness that writes them
// anywhere durable is a harness that eventually corrupts a real number."
//
// SO THE REPORT IS THE AGGREGATE AND NEVER THE MARKS. No trial row is written.

function renderReport(options, run, digest, checks, elapsedMs) {
  const c = run.aggregate.counts;
  const p = run.provenance;
  const lines = [];
  const passed = checks.filter((check) => check.passed).length;

  lines.push('# CI-09 nightly: the simulation-harness leg');
  lines.push('');
  lines.push(
    `**${String(passed)} of ${String(checks.length)} checks passed.** ` +
      `${String(c.trials)} trials over ${String(options.sessions)} sessions in ` +
      `${(elapsedMs / 1000).toFixed(1)}s, run twice.`,
  );
  lines.push('');
  lines.push('## Re-running this exact run');
  lines.push('');
  lines.push('```');
  lines.push(
    `node scripts/ci/nightly-harness.mjs --seed ${options.seed} ` +
      `--trials ${String(options.trials)} --sessions ${String(options.sessions)} ` +
      `--start-day ${options.startDay}`,
  );
  lines.push('```');
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  lines.push(`| Seed | \`${p.seed}\` |`);
  lines.push(`| Harness version | \`${p.harnessVersion}\` |`);
  lines.push(`| Engine version | \`${p.engineVersion}\` |`);
  lines.push(`| Calibration | \`${p.calibrationId}\`, observed ${p.calibrationObservedAt} |`);
  lines.push(`| Calibration digest | \`${p.calibrationDigest}\` |`);
  lines.push(`| Run digest | \`${digest}\` |`);
  lines.push('');

  lines.push('## Checks');
  lines.push('');
  lines.push('| | Check | Cites | Finding |');
  lines.push('|---|---|---|---|');
  for (const check of checks) {
    lines.push(
      `| ${check.passed ? 'pass' : '**FAIL**'} | ${check.name} | ${check.cites} | ` +
        `${check.detail.replace(/\n/g, ' ')} |`,
    );
  }
  lines.push('');

  lines.push('## The funnel');
  lines.push('');
  lines.push('| Count | |');
  lines.push('|---|---|');
  for (const key of Object.keys(c)) lines.push(`| ${key} | ${String(c[key])} |`);
  lines.push('');

  lines.push('## Outputs');
  lines.push('');
  lines.push(
    '**A value is absent and never zero when its sample is empty** (`HO-07` generalised), and ' +
      "the sample beside each value is that output's own denominator and not the run's trial " +
      'count (`AS-M21-02`).',
  );
  lines.push('');
  lines.push('| Output | Registry | Unit | Value | Sample |');
  lines.push('|---|---|---|---|---|');
  for (const output of run.aggregate.outputs) {
    lines.push(
      `| ${output.key} | ${output.registryId ?? output.proposedRegistryId ?? 'none'} | ` +
        `${output.unit} | ${output.value === null ? '**absent**' : format(output.value, 4)} | ` +
        `${String(output.sampleSize)} |`,
    );
  }
  lines.push('');

  lines.push('## Bands');
  lines.push('');
  if (run.bands.length === 0) {
    lines.push(
      '**None, and the emptiness is deliberate.** ' +
        '[SIMULATION_HARNESS](../docs/testing/SIMULATION_HARNESS.md) section 5 states eleven ' +
        '`RE-S-nn` bands and says the nightly asserts each one. This run asserts none, because ' +
        'the bands describe the real lineup under a calibrated population and the real trading ' +
        'calendar, and this tree has none of the three. Supplying a band this run could meet ' +
        'would be fitting the band to the run, which is `TR-03` and is the failure section 5 ' +
        'names as the one this harness exists to catch.',
    );
  } else {
    lines.push('| Band | Verdict | Realized | Sample |');
    lines.push('|---|---|---|---|');
    for (const band of run.bands) {
      lines.push(
        `| ${band.bandId} | ${band.verdict} | ${band.realized === null ? 'absent' : band.realized.toString()} | ` +
          `${String(band.sampleSize)} |`,
      );
    }
  }
  lines.push('');

  lines.push('## What this run is green about, which is less than its name');
  lines.push('');
  lines.push(
    '- **The population is drawn with a POSITIVE drift and is not a book.** `PP-02` finds a ' +
      'negative experience coefficient and roughly 93 percent of the funded book at zero or ' +
      'negative true edge. This population is drawn to REACH settlement, the ladder and the ' +
      'cycle arithmetic at scale. **Quoting `evaluation_pass_rate` off this report is quoting a ' +
      'drift range chosen in `scripts/ci/nightly-harness.mjs`.**',
  );
  lines.push(
    '- **The plan is synthetic.** Plan parameters are rows in `plan_version_sizes` and never ' +
      'constants (`INV-M21-10`). The real lineup is ' +
      '`packages/rules-engine/fixtures/plans/`, and this is not it.',
  );
  lines.push(
    '- **The calendar is consecutive weekdays and has no half days or halts.** `DEP-M21-08`. ' +
      'Section 4: a synthetic calendar "would silently remove the most calendar-sensitive rules ' +
      'from the run", which is `GS-030` to `GS-032`. There is not one calendar row in this ' +
      'repository (P2 section 6).',
  );
  lines.push(
    "- **Three of `CI-09`'s four legs are not here.** [ADR-073](../docs/decisions/ADR-073.md) " +
      'section 5 gives each a dated activation condition: the replay self-audit waits on a ' +
      'demo-world seed script, Stryker on the `VG-12` admission, and the detector canary on ' +
      "M07's detector code.",
  );
  lines.push('');
  return lines.join('\n');
}

// =============================================================================
// THE ENTRY
// =============================================================================

function parseArgs(argv) {
  const options = {
    seed: 'ci-09-nightly-001',
    // SIMULATION_HARNESS section 1's own figure: "run 10,000 synthetic traders
    // through the real engine nightly in CI". It is the corpus's number and not
    // a scale this file picked.
    trials: 10_000,
    // A weekday year. The window has to outlast a five-rung ladder at a
    // five-day cadence gap or the ladder never finishes and `RE-S-06`'s bound is
    // asserted over accounts that were still climbing.
    sessions: 252,
    startDay: '2027-01-04',
    out: 'test-results/ci-09-nightly.md',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--seed') options.seed = value;
    else if (flag === '--trials') options.trials = Number(value);
    else if (flag === '--sessions') options.sessions = Number(value);
    else if (flag === '--start-day') options.startDay = value;
    else if (flag === '--out') options.out = value;
    else throw new Error(`unknown flag ${flag}`);
    i += 1;
  }
  for (const key of ['trials', 'sessions']) {
    if (!Number.isSafeInteger(options[key]) || options[key] < 1) {
      throw new Error(`--${key} needs a positive integer, not ${String(options[key])}`);
    }
  }
  if (options.seed.trim() === '') throw new Error('--seed cannot be empty');
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  const sessions = weekdaySessions(options.startDay, options.sessions);
  const input = {
    seed: options.seed,
    engineVersion: ENGINE_VERSION,
    plan: PLAN,
    // THE POPULATION'S SEED AND THE RUN'S SEED ARE ONE KNOB HERE AND ARE TWO IN
    // THE PACKAGE. `PopulationSpec.seed` draws WHO the accounts are and the run
    // seed draws what they DO; a sweep holding traders fixed across arms moves
    // only the second. This is one run, so re-running it under a new seed should
    // move both, and threading one flag onto both is what makes `--seed` mean
    // "the whole run" rather than half of it.
    population: { ...POPULATION, seed: options.seed, accountCount: options.trials },
    sessions,
    specs: POPULATION.symbols,
    sequenceBase: 1_000,
    behaviour: BEHAVIOUR,
    commercial: COMMERCIAL,
    context: CONTEXT,
    calibration: CALIBRATION,
  };

  console.log(
    `CI-09 nightly: ${String(options.trials)} trials over ${String(sessions.length)} sessions, ` +
      `seed ${options.seed}, harness ${HARNESS_VERSION}`,
  );

  const started = process.hrtime.bigint();
  const first = runHarness(input);
  const second = runHarness(input);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  const checks = [
    checkFunnelIsNonEmpty(first),
    checkLifetimeBound(first),
    checkRefusalKinds(first),
    checkProvenance(first),
    checkDeterminism(first, second),
  ];
  const digest = digestRun(first);
  const report = renderReport(options, first, digest, checks, elapsedMs);

  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, `${report}\n`, 'utf8');

  console.log('');
  console.log(report);
  console.log('');
  console.log(`Report written to ${options.out}`);

  // The Actions step summary is where a reader who opened the run lands, and it
  // is written on a pass as well as on a failure. The block above says what the
  // run is green ABOUT, and that sentence is worth more on the green runs.
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary !== undefined && summary !== '') appendFileSync(summary, `${report}\n`, 'utf8');

  const failed = checks.filter((check) => !check.passed);
  if (failed.length > 0) {
    console.log(
      `\n${String(failed.length)} check(s) FAILED: ${failed.map((f) => f.name).join('; ')}`,
    );
    return 1;
  }
  console.log(`\n${String(checks.length)} of ${String(checks.length)} checks passed.`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
