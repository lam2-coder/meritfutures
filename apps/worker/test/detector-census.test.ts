// =============================================================================
// apps/worker/test/detector-census.test.ts
// =============================================================================
// WHAT THE DETECTOR RUNNER ACTUALLY DOES WHEN EVERY DETECTOR IN THE TREE IS
// HANDED ITS OWN REGISTRY ROW. ADR-409.
//
// -----------------------------------------------------------------------------
// WHY A CENSUS, WHEN EVERY MODULE ALREADY TESTS ITSELF
// -----------------------------------------------------------------------------
// `detectors-fills`, `detectors-graph` and `detectors-identity` each run their
// own detectors against their own seeded rows and each is thorough. NOTHING
// RUNS ALL THREE SETS AT ONCE, and before this file nothing in the workspace
// composed them: `FILL_DETECTORS`, `graphDetectors` and `IDENTITY_DETECTORS`
// are re-exported side by side through `apps/worker/src/index.ts`'s barrel and
// no value anywhere is their union. So the question "how many of the detectors
// that exist would run tonight" had no answer that any check could falsify, and
// three separate suites can all stay green across a change that moves it.
//
// **THAT IS THE SHAPE OF EXPIRY THIS PROGRAMME KEEPS PAYING FOR.** A reason is
// recorded once, in prose, beside the disposition it justifies; the tree moves
// under it; and the sentence stays because no runner reads it. `apps/worker/src/
// schedule.ts`'s detector row carries three blockers and its own header already
// records that its FIRST sentence had to be kept beside a correction under
// RI-14. This file makes the third blocker mechanical instead of narrative.
//
// -----------------------------------------------------------------------------
// WHAT IT ASSERTS, AND WHAT GOING RED WOULD MEAN
// -----------------------------------------------------------------------------
// Section 2 is the census and it is DERIVED BY RUNNING rather than by reading
// the seed. It goes red on exactly the events worth waking somebody for:
//
//   (a) A detector module lands for one of the registry rows that has none. The
//       absence set in section 1 is derived from both populations, so it
//       narrows on its own and the assertion that names it fails.
//   (b) `OQ-M7-02` is answered and a threshold becomes stated. A detector that
//       declined yesterday runs today, the census moves, and somebody has to
//       look at whether the job can now be scheduled. THAT IS A FINDING FOR A
//       ROW TO TAKE AND NOT AN EDIT THIS FILE SHOULD ABSORB.
//   (c) A detector stops finding its own canary. `INV-M7-07` calls that a
//       failure and `AS-M7-05` is the entry it comes from.
//
// **THIS FILE WIRES NOTHING AND CHANGES NO `src/` FILE.** `test/schedule.test.ts`
// case 3.1 derives a job's disposition from whether its entry point has a caller
// under `src/`, and `runDetectors` still has none. The detector runs job is
// unscheduled before this file and unscheduled after it, which is correct:
// section 3 is the reason, and it is the whole reason.
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { UNWIRED_DETECTOR_EVENT_SINK } from '../src/detectors/adapter.ts';
import { canaryMint, canaryNonce, isCanaryId } from '../src/detectors/canary.ts';
import { FILL_DETECTORS } from '../src/detectors/fills.ts';
import { graphDetectors } from '../src/detectors/graph.ts';
import { IDENTITY_DETECTORS } from '../src/detectors/identity.ts';
import type {
  Detector,
  DetectorRunnerIo,
  DetectorTx,
  DetectorValues,
} from '../src/detectors/ports.ts';
import { runDetectors } from '../src/detectors/runner.ts';
import type { DetectorRunReport } from '../src/detectors/runner.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, 'utf8');

/** `P7-d`'s seed, which is the only source of a threshold anywhere in this tree. */
const SEED = JSON.parse(
  read('packages/db/src/seed/detectors/m07-detectors-v1.rows.json'),
) as SeedFile;

interface SeedFile {
  readonly rows: readonly {
    readonly detector: string;
    readonly version: string;
    readonly parameters: Record<string, unknown>;
    readonly is_sensitive?: boolean;
  }[];
}

/**
 * Every detector this workspace has built, composed HERE and nowhere else.
 *
 * THE THREE MODULE LISTS ARE THE SOURCE AND NOT A LIST OF IDS TYPED OUT AGAIN.
 * A detector added to any of them joins this census without anybody editing
 * this file, which is the only way the counts below can be trusted to move.
 */
const IMPLEMENTED: readonly Detector[] = [
  ...FILL_DETECTORS,
  ...graphDetectors(),
  ...IDENTITY_DETECTORS,
];

const idsOf = (detectors: readonly Detector[]): string[] => detectors.map((one) => one.id).sort();
const SEEDED_IDS: string[] = SEED.rows.map((row) => row.detector).sort();
const IMPLEMENTED_IDS: string[] = idsOf(IMPLEMENTED);

const TRADING_DAY = '2026-01-09';
const CENSUS_NONCE = 'nonce-census-409';

// -----------------------------------------------------------------------------
// The fake, which holds the REAL registry rows and nothing else
// -----------------------------------------------------------------------------

interface Written {
  readonly table: string;
  readonly values: DetectorValues;
}

interface Fake {
  readonly io: DetectorRunnerIo;
  readonly writes: Written[];
}

/**
 * An IO whose `detectorDefinitions` reads answer out of the seed file.
 *
 * **EVERY OTHER TABLE ANSWERS EMPTY, AND THAT IS DELIBERATE.** This census asks
 * what a detector does with its REGISTRY ROW, which is the question `INV-M7-04`
 * governs and the question the three blockers in `schedule.ts` turn on. Feeding
 * it rows as well would be asking a second question, and the module suites ask
 * that one already, each against fixtures it argues for.
 *
 * The sink RESOLVES here, so section 2 sees the run the runner would record if a
 * sink existed. Section 3 swaps in the real one, which refuses.
 */
function fake(events: DetectorRunnerIo['events'] = { emit: () => Promise.resolve() }): Fake {
  const writes: Written[] = [];
  const definitions = SEED.rows.map((row) => ({
    detector: row.detector,
    version: row.version,
    parameters: row.parameters,
    isSensitive: row.is_sensitive ?? true,
    effectiveTo: null,
  }));
  let tick = 0;
  let sequence = 0;
  return {
    writes,
    io: {
      transact: async <T>(fn: (tx: DetectorTx) => Promise<T>): Promise<T> => {
        // STAGED AND ONLY THEN COMMITTED, which is the property section 3 reads:
        // a sink that rejects inside the unit of work must leave no write behind.
        const staged: Written[] = [];
        const tx: DetectorTx = {
          rowsWhere: (table, where) =>
            table === 'detectorDefinitions'
              ? Promise.resolve(definitions.filter((row) => row.detector === where['detector']))
              : Promise.resolve([]),
          insert: (table, values) => {
            sequence += 1;
            const row = { ...values, id: `census-${String(sequence)}` };
            staged.push({ table, values: row });
            return Promise.resolve([row]);
          },
        };
        const value = await fn(tx);
        writes.push(...staged);
        return value;
      },
      terms: {
        atMost: (value) => ({ term: 'at-most', value }),
        atLeast: (value) => ({ term: 'at-least', value }),
        isNull: () => ({ term: 'is-null' }),
      },
      events,
      now: () => {
        tick += 1000;
        return new Date(Date.UTC(2026, 0, 9, 2, 0, 0) + tick);
      },
      nonce: () => canaryNonce(CENSUS_NONCE),
    },
  };
}

const runAll = (io: DetectorRunnerIo): Promise<DetectorRunReport> =>
  runDetectors(IMPLEMENTED, { tradingDay: TRADING_DAY }, io);

// =============================================================================
// 1. THE TWO POPULATIONS, AND THE GAP BETWEEN THEM
// =============================================================================

describe('the registry and the modules, counted against each other', () => {
  it('every detector that exists has a seeded registry row', () => {
    // THE DIRECTION THAT MUST NEVER HAVE AN EXCEPTION. A detector with no row
    // cannot record the parameters it ran under, which is INV-M7-04, and the
    // runner raises DetectorUnregistered rather than running it.
    for (const id of IMPLEMENTED_IDS) expect(SEEDED_IDS).toContain(id);
  });

  it('the rows with no detector are derived rather than transcribed', () => {
    const absent = SEEDED_IDS.filter((id) => !IMPLEMENTED_IDS.includes(id));
    // DERIVED FROM BOTH POPULATIONS ABOVE, so this narrows by itself the day a
    // module lands and this assertion is what tells somebody it did.
    expect(absent).toEqual(['D-06', 'D-12', 'D-15', 'D-17']);
    // D-12's absence is RULED rather than pending: `detectors-graph.test.ts`
    // holds the case, and M07 gives it a watched-cluster set rather than a flag,
    // which `correlation_groups` cannot store without a statistic and a
    // threshold. The other three are simply unbuilt.
    expect(idsOf(graphDetectors())).not.toContain('D-12');
  });

  it('no module composes the three lists, so this file is the only place they meet', () => {
    // RI-14's discipline applied to this file's own header: the claim that
    // nothing composes them is checked rather than asserted in prose. The
    // barrel re-exports all three names and builds no union of them.
    const barrel = read('apps/worker/src/index.ts');
    for (const name of ['FILL_DETECTORS', 'graphDetectors', 'IDENTITY_DETECTORS']) {
      expect(barrel).toContain(name);
    }
    expect(barrel).not.toContain('...FILL_DETECTORS');
    expect(barrel).not.toContain('...IDENTITY_DETECTORS');
  });
});

// =============================================================================
// 2. THE CENSUS: what a loaded registry actually produces
// =============================================================================
// **THIS IS THE SECTION THE ROW WAS DISPATCHED TO WRITE.**
//
// `schedule.ts`'s third blocker reads that eleven of the eighteen seeded rows
// state no number, "so a loaded registry still gets `DetectorDeclined`". The
// first half reproduces exactly. THE SECOND HALF IS TRUE OF THIRTEEN OF THE
// FOURTEEN DETECTORS THAT EXIST AND IS NOT TRUE OF ALL OF THEM: `D-02` carries
// its numbers, runs, and finds its canary. `detectors-graph.test.ts` already
// titles its own section "`D-02`, THE ONE THAT RUNS", so the module knew; what
// no check knew is what that does to the blocker read across all three modules.
//
// The disposition does not move on it, and section 3 is why: blockers one and
// two stand, and under the sink this deployment actually installs, the one
// detector that runs records nothing either.

describe('the census, derived by running every detector against its own row', () => {
  it('exactly one of the detectors that exist runs under the seed as it stands', async () => {
    const run = fake();
    const report = await runAll(run.io);

    const ok = report.outcomes.filter((one) => one.status === 'ok').map((one) => one.detector);
    expect(ok).toEqual(['D-02']);
    // AND THE REST DECLINED RATHER THAN CRASHED, which is a different fact and
    // the one that says the modules are healthy. A thrown TypeError would also
    // be `failed`, so the error is read and not just the status.
    expect(report.failed.length).toBe(IMPLEMENTED.length - 1);
    for (const outcome of report.outcomes) {
      if (outcome.status === 'ok') continue;
      expect(outcome.status).toBe('failed');
      expect(outcome.error).toContain('DetectorDeclined');
    }
    expect(report.degraded).toEqual([]);
  });

  it('every run is recorded, including the thirteen that produced no answer', async () => {
    const run = fake();
    const report = await runAll(run.io);
    // INV-M7-07 over the whole population at once: "Every detector run is
    // recorded, including runs that raised nothing". A declined detector is
    // visible to the morning read through detector_runs_unhealthy_idx on the day
    // it happens, and a run that is absent is a job nobody scheduled.
    expect(report.unrecorded).toEqual([]);
    for (const outcome of report.outcomes) expect(outcome.recorded).toBe(true);
    expect(run.writes.filter((each) => each.table === 'detectorRuns')).toHaveLength(
      IMPLEMENTED.length,
    );
  });

  it('the thirteen that decline raise no flag and write no group', async () => {
    const run = fake();
    await runAll(run.io);
    // A detector with no threshold that raised anything would have invented one,
    // and FM-M7-01 is "detection appears healthy and is absent" running the
    // other way. No fixture rows are supplied, so the one that DOES run has
    // nothing real to find either.
    expect(run.writes.filter((each) => each.table === 'riskFlags')).toEqual([]);
    expect(run.writes.filter((each) => each.table === 'correlationGroups')).toEqual([]);
  });

  it('the decline names the parameter it wants, for every detector that declines', async () => {
    const run = fake();
    const report = await runAll(run.io);
    for (const outcome of report.outcomes) {
      if (outcome.status === 'ok') continue;
      // A reader of a red dashboard must not be sent to the code to find out
      // which knob is missing. Every message carries the detector and a reason
      // longer than its own name.
      expect(outcome.error).toContain(outcome.detector);
      expect((outcome.error ?? '').length).toBeGreaterThan(outcome.detector.length + 40);
    }
  });
});

// =============================================================================
// 3. THE REFUSAL, WATCHED OVER THE WHOLE POPULATION AT ONCE
// =============================================================================
// Section 2 ran against a sink that resolves, which no deployment has. This
// section swaps in `UNWIRED_DETECTOR_EVENT_SINK`, the value
// `postgresDetectorRunnerIo` installs when it is called the way `src/` calls it.
//
// **THE SENTENCE THAT STOOD HERE IS KEPT BESIDE ITS CORRECTION (`RI-14`).** It
// read: *"THE ONE DETECTOR THAT RUNS TODAY WRITES NOTHING EITHER"*, because
// `runner.ts` emitted `detector.run_completed` first and unconditionally inside
// the write transaction and the refusal rolled the run row back.
//
// **ADR-409 RULES THAT A DEFECT AND REPAIRS IT**, on the ground that no rule
// binds the BI point to the run row and `INV-M7-07` requires the row. So the
// population now RECORDS under the sink this deployment installs, and what it
// still cannot do is PAGE. **Both halves are asserted, because the second is the
// control**: a degraded run whose page cannot be written must still take its row
// down with it, and a suite that stopped checking that would have bought
// `INV-M7-07` with `AS-M7-05`.

describe('the sink this deployment installs, over every detector at once', () => {
  it('every run is now RECORDED, and every one still reports the refusal', async () => {
    const run = fake(UNWIRED_DETECTOR_EVENT_SINK);
    const report = await runAll(run.io);

    // INV-M7-07 over the whole population, under the sink that actually ships.
    expect(report.unrecorded).toEqual([]);
    for (const outcome of report.outcomes) expect(outcome.recorded).toBe(true);
    expect(run.writes.filter((each) => each.table === 'detectorRuns')).toHaveLength(
      IMPLEMENTED.length,
    );
    // AND NOTHING WAS SWALLOWED TO BUY THAT. Every outcome names the refusal.
    for (const outcome of report.outcomes) {
      expect(outcome.error).toContain('DetectorAdapterUnwired');
    }
  });

  it('none of the fourteen is degraded today, which is why none of them rolls back', async () => {
    // THE PRECONDITION OF THE CASE ABOVE, ASSERTED RATHER THAN ASSUMED. If a
    // detector ever became degraded under the seed, its row would roll back and
    // the case above would be reading a different population than it thinks.
    const run = fake(UNWIRED_DETECTOR_EVENT_SINK);
    const report = await runAll(run.io);
    expect(report.degraded).toEqual([]);
  });

  it('the refusal names the blocker rather than only failing', async () => {
    const run = fake(UNWIRED_DETECTOR_EVENT_SINK);
    const report = await runAll(run.io);
    const runs = report.outcomes.find((one) => one.detector === 'D-02');
    // Named at its source: RI-04, the writer that exists and where, and the two
    // catalogue blockers that would stand even if the import were legal. Cited
    // by name and not by line, because `apps/api/src/events.ts` is another row's
    // file this wave.
    expect(runs?.error).toContain('DetectorAdapterUnwired');
    expect(runs?.error).toContain('RI-04');
    expect(runs?.error).toContain('apps/api/src/events.ts');
    expect(runs?.error).toContain('detector.run_degraded');
    expect(runs?.error).toContain('detector_run_id');
  });

  it('a DEGRADED run still takes its run row down with its unwritable page', async () => {
    // THE CONTROL. `ports.ts` binds `detector.run_degraded` to the run row under
    // `ADR-006`, and ADR-409 changed the BI point's handling and NOT this one.
    // A detector that reads nothing cannot find the canary it seeded.
    const run = fake(UNWIRED_DETECTOR_EVENT_SINK);
    const blind: Detector = {
      id: 'D-02',
      streams: () => [],
      canaries: (mint) => [mint.hedgedPair('D-02', 0)],
      scan: () => ({ findings: [] }),
    };
    const report = await runDetectors([blind], { tradingDay: TRADING_DAY }, run.io);

    expect(report.outcomes[0]?.status).toBe('degraded');
    expect(report.unrecorded).toEqual(['D-02']);
    expect(report.outcomes[0]?.recorded).toBe(false);
    expect(run.writes).toEqual([]);
  });
});

// =============================================================================
// 4. THE CANARIES, ACROSS EVERY MODULE
// =============================================================================
// `P7` section 12 names this slice "the runner and the canaries". The battery is
// what makes a green dashboard falsifiable, so its properties are asserted over
// the whole population rather than per module.

describe('the battery, over every detector in the tree', () => {
  it('every detector seeds at least one canary, which the DDL cannot check', () => {
    // `detector_runs_synthetics_match_status` reads "status <> 'ok' OR
    // synthetic_found >= synthetic_expected" and is satisfied at 0 >= 0, so a
    // detector seeding none reports ok forever. The runner refuses one, and this
    // is the population-wide statement of the same rule.
    const mint = canaryMint(canaryNonce(CENSUS_NONCE));
    for (const detector of IMPLEMENTED) {
      expect(detector.canaries(mint).length).toBeGreaterThan(0);
    }
  });

  it('every canary carries THIS run nonce, so a memorised battery cannot pass', () => {
    // AS-M7-05 note 2. The identifier grammar puts the nonce in the third
    // segment and every actor hangs off the subject that carries it.
    const nonce = 'nonce-census-second';
    for (const detector of IMPLEMENTED) {
      for (const subject of detector.canaries(canaryMint(canaryNonce(nonce)))) {
        expect(subject.id.split(':')[2]).toBe(nonce);
      }
    }
  });

  it('the detector that runs finds its whole battery and misses none', async () => {
    const run = fake();
    const report = await runAll(run.io);
    const runs = report.outcomes.find((one) => one.detector === 'D-02');
    expect(runs?.syntheticExpected).toBeGreaterThan(0);
    expect(runs?.syntheticFound).toBe(runs?.syntheticExpected);
    expect(runs?.syntheticMissing).toEqual([]);
    // Evaluated as the DDL evaluates it, so the row this run would have written
    // satisfies its own constraint.
    expect(
      runs?.status !== 'ok' || Number(runs.syntheticFound) >= Number(runs.syntheticExpected),
    ).toBe(true);
  });

  it('no canary identifier reaches any written value, anywhere in the population', async () => {
    const run = fake();
    await runAll(run.io);
    // AS-M7-05 note 1 over every write the whole census made. A canary is minted
    // in memory and discarded, so every aggregate excludes it by never existing,
    // including the aggregates nobody has written yet.
    for (const written of run.writes) {
      for (const value of Object.values(written.values)) {
        expect(isCanaryId(value)).toBe(false);
      }
    }
  });
});

// =============================================================================
// 5. ANSWERING THE FOUNDER'S QUESTION WOULD NOT CLEAR ALL THIRTEEN
// =============================================================================
// `schedule.ts`'s third blocker attributes the declines to `OQ-M7-02`, the
// founder's unanswered question about thresholds. THAT IS THE LARGEST CLASS AND
// IT IS NOT THE ONLY ONE, and the difference matters to whoever is deciding what
// to buy: a threshold is an answer, an absent parameter is a seed repair, and an
// unmet input is a build. Only the first is the founder's.
//
// The two classes below are asserted because both are legible in the runner's
// own message without reading its prose. The remainder turn on a stated number,
// a severity band, or both, and this file DOES NOT partition them further:
// separating "wants a number" from "wants a severity" cleanly needs the decline
// messages to agree on a form they do not agree on today, and a partition that
// over-fits their wording is a claim that breaks on a rewording rather than on a
// change of fact.

describe('the declines that answering OQ-M7-02 would not clear', () => {
  it('two rows carry no such parameter at all, which is a seed repair', async () => {
    const run = fake();
    const report = await runAll(run.io);
    const absent = report.outcomes
      .filter((one) => /carries no "[a-z_]+" parameter at all/.test(one.error ?? ''))
      .map((one) => one.detector);
    // A row that STATES a parameter as `unstated` is waiting on an answer. A row
    // that does not carry the parameter at all is a different repair, and
    // INV-M7-04 makes the registry the authority, so the seed is where it lands.
    expect(absent).toEqual(['D-04', 'D-05']);
  });

  it('two decline on an unmet INPUT rather than on a missing number', async () => {
    const run = fake();
    const report = await runAll(run.io);
    const starved = report.outcomes
      .filter((one) => (one.error ?? '').includes('input:'))
      .map((one) => one.detector);
    // Neither is a founder question. `D-09` names its dependency by identifier,
    // and `D-18` reports that some of its required legs have no input at all, so
    // both wait on work somebody builds rather than on a number somebody picks.
    expect(starved).toEqual(['D-09', 'D-18']);
    expect(report.outcomes.find((one) => one.detector === 'D-09')?.error).toMatch(/DEP-M7-\d+/);
  });
});
