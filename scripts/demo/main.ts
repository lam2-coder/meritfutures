// =============================================================================
// scripts/demo/main.ts
// =============================================================================
// THE ENTRY. Parse the flags, build the population, fold every account, render.
//
// `runDemo` IS PURE AND `main` IS THE ONLY THING THAT WRITES, which is what
// makes the determinism test worth having. The test calls `runDemo` twice with
// the same options and compares the two strings; if the report were assembled
// inside a function that also printed it, the test would either have to capture
// stdout or assert on something weaker than the bytes.
//
// NO DATABASE, NO FILES, NO NETWORK, NO CLOCK. The whole run is a population
// object, a session array and a fold, and the only I/O in this directory is the
// `write` callback below.
// =============================================================================

import { buildPopulation } from '../../packages/rithmic/src/index.ts';
import {
  CORE_EOD_50K,
  COHORTS,
  DEFAULT_START_DAY,
  DEMO_SPECS,
  SEQUENCE_BASE,
  populationSpec,
  sessions,
} from './config.ts';
import { foldAccount, type AccountRun } from './fold.ts';
import { render } from './render.ts';

export interface Options {
  readonly seed: string;
  readonly days: number;
  readonly accountsPerCohort: number;
  readonly startDay: string;
}

export const DEFAULT_OPTIONS: Options = {
  seed: 'merit-demo-001',
  // TWENTY-FIVE SESSIONS, AND THE NUMBER IS A CONSEQUENCE RATHER THAN A ROUND
  // NUMBER. A Core EOD account has to clear a 300,000c evaluation target, be
  // re-provisioned, and then earn five win days at a floor of 15,000c before any
  // gate but the buffer can pass. A shorter window prints a table in which
  // nothing has happened yet, which is a demo of the fold rather than of the
  // rules.
  days: 25,
  // TWO PER COHORT, WHICH IS THE SMALLEST NUMBER THAT SHOWS EVERY SHAPE AT THE
  // DEFAULT SEED: one account reaches eligibility, one breaches against a floor
  // the platform liquidated it at, and one breaches against a TRAILED floor with
  // no vendor liquidation record at all. A demo whose default run is missing one
  // of the three is a demo that has to be re-invoked before it is useful.
  accountsPerCohort: 2,
  startDay: DEFAULT_START_DAY,
};

export const USAGE = `merit demo: the simulator, through the engine

  node scripts/demo/run.mjs [options]

  --seed <string>       the run seed. The same seed reproduces the same bytes
  --days <n>            trading sessions to simulate      (default ${String(DEFAULT_OPTIONS.days)})
  --accounts <n>        accounts per cohort               (default ${String(DEFAULT_OPTIONS.accountsPerCohort)})
  --start <yyyy-mm-dd>  first trading day                 (default ${DEFAULT_OPTIONS.startDay})
  --help                this

Everything runs in memory. There is no database, no file is written, and no
network call is made. The plan is Core EOD at 50K, transcribed from M01
Appendix A.1; the calendar is a synthetic weekday sequence and is NOT the CME
calendar, which has not been transcribed (P2 section 6).
`;

/** A flag parser small enough to read, which refuses rather than defaulting a bad value. */
export function parseArgs(argv: readonly string[]): Options | 'help' {
  const options: {
    seed: string;
    days: number;
    accountsPerCohort: number;
    startDay: string;
  } = { ...DEFAULT_OPTIONS };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') return 'help';

    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${String(flag)} needs a value`);
    i += 1;

    switch (flag) {
      case '--seed':
        options.seed = value;
        break;
      case '--days':
        options.days = positiveInteger('--days', value);
        break;
      case '--accounts':
        options.accountsPerCohort = positiveInteger('--accounts', value);
        break;
      case '--start':
        options.startDay = value;
        break;
      default:
        throw new Error(`unknown flag ${String(flag)}`);
    }
  }

  return options;
}

function positiveInteger(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} wants a positive integer, not ${value}`);
  }
  return parsed;
}

/**
 * The whole run, as a string. PURE: same options, same bytes, every time.
 *
 * The two properties that make that true are stated by the packages themselves
 * rather than assumed here. `buildPopulation`: "account i is a pure function of
 * `(seed, i)`". `advanceDay`: "pure, total, and the only place a rule is
 * applied". Nothing between them consults a clock or an environment.
 */
export function runDemo(options: Options): string {
  const window = sessions(options.startDay, options.days);
  const runs: AccountRun[] = [];

  for (const cohort of COHORTS) {
    const population = buildPopulation(
      populationSpec(cohort, options.seed, options.accountsPerCohort),
    );
    for (const account of population) {
      runs.push(
        foldAccount({
          seed: options.seed,
          plan: CORE_EOD_50K,
          sessions: window,
          specs: DEMO_SPECS,
          sequenceBase: SEQUENCE_BASE,
          cohort,
          account,
        }),
      );
    }
  }

  return render({
    seed: options.seed,
    plan: CORE_EOD_50K,
    planLabel: 'Core EOD at 50K',
    startDay: options.startDay,
    sessionCount: window.length,
    accountsPerCohort: options.accountsPerCohort,
    cohorts: COHORTS,
    runs,
  });
}

/** The shell. Returns the exit code rather than calling `process.exit`. */
export function main(
  argv: readonly string[],
  write: (text: string) => void,
  writeError: (text: string) => void,
): number {
  let options: Options | 'help';
  try {
    options = parseArgs(argv);
  } catch (error) {
    writeError(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }

  if (options === 'help') {
    write(USAGE);
    return 0;
  }

  write(runDemo(options));
  return 0;
}
