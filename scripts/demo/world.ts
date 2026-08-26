// =============================================================================
// scripts/demo/world.ts
// =============================================================================
// THE DEMO WORLD. `CI-09`'s replay self-audit leg has had a subject since
// `replay.ts` landed and has never had an INPUT. This file is the input.
//
// [ADR-119](../../docs/decisions/ADR-119.md) rules the path, and the ruling is
// the deliverable rather than the code: [STRATEGY section 4.1](../../docs/testing/STRATEGY.md)
// registered the artifact as *"a demo-world seed script"*, session 121 rowed it
// **"Registered. Names neither a path nor a manifest key"**, and
// `CI-06/gate-inventory` has reported it unprobeable on every run since. A
// session that invented a path would have closed that condition by fiat, which
// is what ADR-073 section 2 (b) exists to prevent.
//
// -----------------------------------------------------------------------------
// THE WORLD IS A VALUE AND NOT A DATABASE, AND THAT IS THE RULING'S HALF THAT
// A LATER READER WILL WANT TO OVERTURN
// -----------------------------------------------------------------------------
// [INFRA section 11](../../docs/architecture/INFRA.md) describes a seed script
// that "creates a full demo world: plans and versions, a trading calendar, 50
// synthetic traders with histories, breached and funded accounts, flags, payouts,
// and affiliate data, so every surface is developable offline". THAT IS A
// DIFFERENT ARTIFACT FROM THIS ONE and ADR-119 section 3 says so at length. Its
// consumer is a developer running surfaces against `docker compose up`. This
// file's consumer is `runReplayAudit`, and `runReplayAudit` does not read
// Postgres. It reads `BatchPorts`.
//
// TWO MEASUREMENTS, EITHER OF WHICH IS ENOUGH ON ITS OWN:
//
//   1. NO ADAPTER IMPLEMENTS `BatchPorts` OVER POSTGRES. `apps/worker/src/index.ts`
//      states the gap in its own header: "what is missing is an adapter
//      implementing `BatchPorts` over those accessors". Rows seeded into
//      `rule_states` today reach `runReplayAudit` through nothing at all, so a
//      database seed would give the replay leg a SUBJECT and still no INPUT.
//      That is session 118's distinction, one level down, and repeating it
//      quietly is the one thing this session had to not do.
//   2. `loadAccountDay`'s `prior` HAS NO PRODUCER IN STORAGE. `RuleState`
//      carries `lifetimeSettledCents`, `breached` and `breachKind`;
//      `RuleStateRow` carries none of the three and `rule_states` has no column
//      for any of them (`packages/rules-engine/src/hash.ts:506`,
//      `apps/worker/src/batch/nightly.ts`'s `AccountDayFold`). A world seeded
//      into Postgres could not be READ BACK as a day stream even with an
//      adapter written, without a migration. `0048` stays free and this is
//      reported as a finding rather than repaired here.
//
// -----------------------------------------------------------------------------
// THE FORMAT IS NOT NEW. IT IS M1'S DAY STREAM, FOLDED
// -----------------------------------------------------------------------------
// [ADR-072](../../docs/decisions/ADR-072.md) closed the fixture-format
// vocabulary and measured that the corpus has exactly one format: "a day stream
// folded through the engine, M1-shaped in every field". A demo world is a day
// stream. So this file writes no format: an account's world is its
// `AccountDay[]`, which is `apps/worker`'s own published type, and the calendar
// is a `CalendarSlice` built by `bridge.ts` from the same sessions the demo's
// table already prints.
//
// WHAT IS NEW IS THAT THE STREAM IS FOLDED AND KEPT. `main.ts` folds this same
// population and RENDERS it; nothing has ever stored what the fold produced.
// The stored side here is `foldAccountDay`'s own `RuleStateRow`, hashed by
// `stateHash`, which is the row the nightly batch would have written.
//
// -----------------------------------------------------------------------------
// WHY `foldAccountDay` AND NOT `runNightlyBatch`, WHICH IS THE OBVIOUS CALLER
// -----------------------------------------------------------------------------
// `runNightlyBatch` closes ONE trading day and returns a `NightlyBatchReport`
// whose written outcomes carry `row` and `events` AND NOT `state`. Chaining a
// second day needs the next day's `prior`, which is a `RuleState`, and the two
// places it could come from are both closed: the report drops it, and
// `RuleStateRow` cannot rebuild it for the three-column reason above. SO A
// DRIVER GOING THROUGH `runNightlyBatch` CANNOT BUILD A WORLD MORE THAN ONE DAY
// DEEP, and a one-day world audits one row per account.
//
// `foldAccountDay` is the same fold with the state returned, and its own comment
// says why it returns it: "THE STATE IS RETURNED SO A REPLAY CAN CHAIN ITS OWN
// PRIOR, and without it INV-04 is not expressible." This file is the caller that
// sentence was written for. There is still exactly one fold, it is the batch's,
// and `runNightlyBatch` is a loop and a writer around it.
//
// -----------------------------------------------------------------------------
// MONEY IS INTEGER CENTS IN EVERY ROW THIS SEEDS, AND IT IS ASSERTED
// -----------------------------------------------------------------------------
// A seeded float in a demo world becomes a seeded float in every replay that
// reads it, and a `number` that happens to be integral today reads exactly like
// a `bigint`. `assertIntegerCents` below walks every money field of every row
// the world holds and refuses on the first one that is not a `bigint`. It costs
// one pass over a few hundred rows and it is the only control that survives a
// future contributor widening a type.
//
// -----------------------------------------------------------------------------
// WHAT THIS WORLD DOES NOT HAVE, in `scripts/demo/README.md`'s own terms
// -----------------------------------------------------------------------------
//   NO SETTLEMENTS. Every `AccountDay.settlements` is empty, because this
//   repository has no settlement source and one invented here would be a money
//   fact nobody ruled. So group H never runs, no account acquires a
//   `cadenceAnchorDay`, and R-37 is skipped on every row. The replay audit is
//   unaffected: it compares what the fold produced, and a skipped gate is
//   reproduced as a skipped gate.
//
//   THE CALENDAR IS THE DEMO'S FICTION AND SAYS SO. `sessions()` is consecutive
//   weekdays; there is not one calendar row in this repository (P2 section 6).
//   R-04 is present in the engine and unexercised here.
//
//   THE CONTEXT GATES ARE CONSTANTS. `CLEAN_CONTEXT` answers all five of R-40's
//   questions permissively. INV-23 keeps them out of the hash, so they change no
//   comparison; they are stored on the row because the column is `NOT NULL`.
//
// NONE OF THE THREE WEAKENS WHAT THE AUDIT PROVES, because the audit's subject
// is INV-04: that replaying the stream reproduces the stored state byte for
// byte. A rule the world never exercises is a rule the world never exercises on
// both sides of that comparison.
// =============================================================================

import { createHash } from 'node:crypto';

// ADR-083's spelling: a relative import names THE FILE IT ACTUALLY IS. The `.js`
// specifiers in this directory's older files are resolved by `ts-resolve.mjs`
// retrying them as `.ts`; a `.ts` specifier needs no hook and type-checks under
// `allowImportingTsExtensions`, which `tsconfig.base.json` sets for this reason.
import type {
  AccountDay,
  BatchPorts,
  ReconciliationFinding,
  ReplayAuditReport,
  ReplayDivergenceFinding,
  RuleStateRow,
} from '../../apps/worker/src/index.ts';
import { foldAccountDay, runReplayAudit, stateHash } from '../../apps/worker/src/index.ts';

import type {
  CalendarSlice,
  Cents,
  ResolvedPlan,
  RuleState,
  TradingDay,
} from '../../packages/rules-engine/src/index.ts';
import type { SimAccount, SimDay, SimSession } from '../../packages/rithmic/src/index.ts';
import { buildPopulation, simulate } from '../../packages/rithmic/src/index.ts';

import { asTradingDay, toCalendarSlice, toDailyMark } from './bridge.ts';
import {
  CORE_EOD_50K,
  COHORTS,
  DEFAULT_START_DAY,
  DEMO_SPECS,
  SEQUENCE_BASE,
  populationSpec,
  sessions,
  type Cohort,
} from './config.ts';
import { CLEAN_CONTEXT } from './fold.ts';

/**
 * The engine version this world is folded and stamped under.
 *
 * IT IS A CONSTANT AND NOT A PACKAGE VERSION, for `fold.ts`'s reason: replay
 * scopes divergence detection to rows computed under the RUNNING version (M01
 * Appendix B.4), and a world that read one from a manifest would be claiming to
 * be a build. The name says what it is on every report it appears in.
 */
export const DEMO_WORLD_ENGINE_VERSION = 'demo-world-not-a-build';

/**
 * The calendar revision every row is stamped with.
 *
 * IT IS NOT `null`, AND THE REASON IS THAT `null` WOULD PASS FOR THE WRONG
 * REASON. B.4 step 1 scopes a row in when `row.calendarRevisionId` equals the
 * watermark; with `null` on both sides the comparison is `null === null` and a
 * row stamped with a real revision would be indistinguishable from one that was
 * never stamped. `0033` made the revision required on the table, so a world that
 * exercises the stamped path is the world the schema describes.
 */
export const DEMO_WORLD_CALENDAR_REVISION = 1;

/** How an account's life in this world ended. `fold.ts`'s vocabulary, one term wider. */
export type DemoOutcome = 'trading' | 'breached' | 'graduated' | 'refused';

/** One account, its whole input stream, and everything the fold wrote for it. */
export interface DemoAccount {
  /** `rule_states.account_id`'s shape. See `demoAccountId`. */
  readonly accountId: string;
  readonly platformAccountRef: string;
  readonly cohort: string;
  /** ADR-051's anchor: the first TRADEABLE day, which here is the run's first session. */
  readonly openedOn: TradingDay;
  /** The day stream, oldest first. `accountDaysFrom`'s answer. */
  readonly days: readonly AccountDay[];
  /** What `foldAccountDay` wrote. `storedRuleStates`'s answer, oldest first. */
  readonly rows: readonly RuleStateRow[];
  readonly outcome: DemoOutcome;
  /** The day the fold refused, when it did. No row exists for it (DO-3). */
  readonly refusedOn: TradingDay | null;
}

/**
 * WHAT THE SEED SAYS THE AUDIT MUST FIND, recorded BEFORE the audit runs.
 *
 * THE POINT IS THAT IT IS INDEPENDENT. A check that read its expectation off the
 * report it is checking is a check that passes over any world, including the
 * empty one, which is `OI-14`'s failure with a comparison bolted on. Every field
 * here is counted from what the fold produced, and `auditDemoWorld` compares the
 * report against it field by field.
 */
export interface DemoWorldExpectation {
  /** `accountsWithStoredState().length`. ADR-073's refusal fires when this is 0. */
  readonly accountsAudited: number;
  readonly storedRows: number;
  /** Every stored row is in scope: one engine version, one calendar revision. */
  readonly inScope: number;
  readonly outOfScope: number;
  readonly matched: number;
  readonly diverged: number;
  /** Shape coverage, so a world that stopped showing a breach is a failure. */
  readonly breached: number;
  readonly graduated: number;
  readonly refused: number;
  readonly stillTrading: number;
  /** Accounts that reached the funded phase. A world of evaluations audits little. */
  readonly reachedFunded: number;
}

export interface DemoWorld {
  readonly seed: string;
  readonly startDay: string;
  readonly sessionCount: number;
  readonly accountsPerCohort: number;
  readonly engineVersion: string;
  readonly calendarRevisionId: number;
  readonly plan: ResolvedPlan;
  readonly calendar: CalendarSlice;
  readonly accounts: readonly DemoAccount[];
  readonly expectation: DemoWorldExpectation;
}

export interface DemoWorldOptions {
  readonly seed: string;
  readonly sessionCount: number;
  readonly accountsPerCohort: number;
  readonly startDay: string;
}

/**
 * THE DEFAULT WORLD IS THE DEMO'S DEFAULT RUN, AND THAT IS DELIBERATE.
 *
 * `main.ts` folds this population, at this seed, over this window, and prints
 * the result; `scripts/demo/test/determinism.test.ts` asserts three named
 * accounts by shape. Seeding a DIFFERENT world would mean two demo populations
 * whose divergence nobody would notice until one of them stopped showing a
 * breach. The world the replay audits is the world the demo already documents.
 */
export const DEFAULT_WORLD: DemoWorldOptions = {
  seed: 'merit-demo-001',
  sessionCount: 25,
  accountsPerCohort: 2,
  startDay: DEFAULT_START_DAY,
};

/** Thrown when the world, or an audit over it, cannot honestly report. */
export class DemoWorldRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoWorldRefusal';
  }
}

// -----------------------------------------------------------------------------
// Account identity
// -----------------------------------------------------------------------------

/**
 * A deterministic account id in `rule_states.account_id`'s shape.
 *
 * `AccountDay.accountId` is documented as a "canonical lowercase UUID, as
 * Postgres renders it", so the world's ids are UUIDs even though the world never
 * reaches Postgres: an id shaped like the column is one fewer thing that changes
 * if a DB-backed world is ever built, and a bare `DEMOSTDY000001` in that field
 * would be a value the type's own comment says it is not.
 *
 * VERSION 8, WHICH IS RFC 9562'S CUSTOM FORM, AND THE HONEST ONE. This is a
 * digest of a name, not a random draw and not a v5 over a registered namespace,
 * and stamping it v4 would claim entropy it does not have.
 */
export function demoAccountId(seed: string, platformAccountRef: string): string {
  const digest = createHash('sha256')
    .update(`merit-demo-world:${seed}:${platformAccountRef}`)
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x80, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// -----------------------------------------------------------------------------
// Integer cents, asserted rather than assumed
// -----------------------------------------------------------------------------

/** Every money field on a `rule_states` row, by the name the column has. */
const MONEY_FIELDS = Object.freeze([
  'floorCents',
  'floorOpenCents',
  'highWaterBalanceCents',
  'balanceCents',
  'withdrawableCents',
  'consistencyBestDayCents',
  'consistencyPeriodProfitCents',
] as const);

/**
 * REFUSE ON THE FIRST MONEY FIELD THAT IS NOT A `bigint`.
 *
 * The constitution's rule is that money is integer cents and no float reaches a
 * financial path. A `number` is the way that rule is broken in TypeScript, and
 * `typeof x === 'bigint'` is the only check that cannot be satisfied by a float
 * that happens to be integral on the day somebody looked.
 */
export function assertIntegerCents(row: RuleStateRow): void {
  for (const field of MONEY_FIELDS) {
    const value: unknown = row[field];
    if (typeof value !== 'bigint') {
      throw new DemoWorldRefusal(
        `account ${row.accountId} day ${String(row.tradingDay)}: ${field} is a ` +
          `${typeof value} (${String(value)}) and money is integer cents. A seeded float in a ` +
          'demo world becomes a seeded float in every replay that reads it',
      );
    }
  }
}

// -----------------------------------------------------------------------------
// The build
// -----------------------------------------------------------------------------

/** One account's build state while the world is being folded, day by day. */
interface Building {
  readonly accountId: string;
  readonly account: SimAccount;
  readonly cohort: Cohort;
  readonly days: AccountDay[];
  readonly rows: RuleStateRow[];
  /** The simulated days of the CURRENT segment, `segmentStart` onward. */
  segment: readonly (readonly SimDay[])[];
  segmentStart: number;
  prior: RuleState | null;
  live: boolean;
  outcome: DemoOutcome;
  refusedOn: TradingDay | null;
  reachedFunded: boolean;
}

/**
 * Simulate one account over `window`, in file mode.
 *
 * ONE ACCOUNT PER CALL, which is what makes the segment restart below possible
 * without disturbing any other account's draws: every key in the simulator's rng
 * is `(seed, accountRef, tradingDay, ...)` and none of them is a session index,
 * so an account re-simulated from a later day draws exactly the trades it would
 * have drawn in one continuous run (`fold.ts`).
 */
function simulateFrom(
  seed: string,
  account: SimAccount,
  window: readonly SimSession[],
): readonly (readonly SimDay[])[] {
  return simulate({
    seed,
    population: [account],
    sessions: window,
    specs: DEMO_SPECS,
    adjustments: [],
  }).days;
}

/**
 * The world: every account, every session, folded through the batch's own fold.
 *
 * DAY MAJOR AND NOT ACCOUNT MAJOR, because that is the shape the nightly batch
 * has (Appendix B.5 partitions by account WITHIN a trading day) and because a
 * world built account by account cannot be checked against a report that closes
 * days. The fold is per account and shares no state either way, so the two
 * orders produce identical rows; the loop is written in the order the thing it
 * imitates runs.
 *
 * THE SEGMENT RESTART IS `fold.ts`'s AND IS NOT AN OPTIMISATION. R-31 resets a
 * funded account's balance to `size_cents` on the day its evaluation passes, the
 * simulator has no notion of a phase, and INV-18 (`opening == prior.balance +
 * adjustment`) would refuse the next day for every account that ever passed. The
 * platform re-provisions at `size_cents` (INV-M2-07) and the restart is what
 * that looks like from here. Without it this world is a world of evaluations and
 * the funded half of the engine is never stored, let alone replayed.
 */
export function buildDemoWorld(options: DemoWorldOptions): DemoWorld {
  const window = sessions(options.startDay, options.sessionCount);
  const first = window[0];
  if (first === undefined) throw new DemoWorldRefusal('a demo world needs at least one session');

  const calendar = toCalendarSlice(window, SEQUENCE_BASE);
  const openedOn = asTradingDay(first.tradingDay);

  const building: Building[] = [];
  for (const cohort of COHORTS) {
    const population = buildPopulation(
      populationSpec(cohort, options.seed, options.accountsPerCohort),
    );
    for (const account of population) {
      building.push({
        accountId: demoAccountId(options.seed, account.platformAccountRef),
        account,
        cohort,
        days: [],
        rows: [],
        segment: simulateFrom(options.seed, account, window),
        segmentStart: 0,
        prior: null,
        live: true,
        outcome: 'trading',
        refusedOn: null,
        reachedFunded: false,
      });
    }
  }

  for (let i = 0; i < window.length; i += 1) {
    for (const b of building) {
      if (!b.live) continue;

      const forSession = b.segment[i - b.segmentStart];
      const simDay = forSession?.[0];
      if (simDay === undefined) {
        throw new DemoWorldRefusal(
          `no simulated day for ${b.account.platformAccountRef} at session index ` +
            `${String(i)} of a segment starting at ${String(b.segmentStart)}`,
        );
      }

      const day: AccountDay = {
        accountId: b.accountId,
        plan: CORE_EOD_50K,
        prior: b.prior,
        mark: toDailyMark(simDay),
        // Stated once, here, and the header says what it costs.
        settlements: [],
        openedOn,
        external: CLEAN_CONTEXT,
      };
      b.days.push(day);

      const fold = foldAccountDay(
        day,
        calendar,
        DEMO_WORLD_ENGINE_VERSION,
        DEMO_WORLD_CALENDAR_REVISION,
      );

      if (fold.kind === 'refused') {
        // DO-3: no state is written for a refusal, and the fold stops for this
        // account. `fold.ts` stops on the first refusal for the same reason:
        // folding tomorrow against a state today declined to produce is the
        // confident wrong number the refusal exists to prevent.
        b.outcome = 'refused';
        b.refusedOn = day.mark.tradingDay;
        b.live = false;
        continue;
      }

      assertIntegerCents(fold.row);
      b.rows.push(fold.row);
      b.prior = fold.state;
      if (fold.state.phase === 'funded') b.reachedFunded = true;

      if (fold.state.phase === 'closed') {
        // R-24. Terminal, and no state advances after it.
        b.outcome = 'breached';
        b.live = false;
        continue;
      }
      if (fold.state.phase === 'graduated') {
        b.outcome = 'graduated';
        b.live = false;
        continue;
      }

      if (fold.events.some((event) => event.type === 'phase.passed')) {
        const next = window.slice(i + 1);
        if (next.length === 0) {
          // The pass landed on the last session of the window. There is no next
          // day to re-provision into, which is a short window rather than a
          // finding, and the account simply stops here.
          b.live = false;
          continue;
        }
        b.segment = simulateFrom(options.seed, b.account, next);
        b.segmentStart = i + 1;
      }
    }
  }

  const accounts: DemoAccount[] = building.map((b) => ({
    accountId: b.accountId,
    platformAccountRef: b.account.platformAccountRef,
    cohort: b.cohort.label,
    openedOn,
    days: b.days,
    rows: b.rows,
    outcome: b.outcome,
    refusedOn: b.refusedOn,
  }));

  const stored = accounts.filter((a) => a.rows.length > 0);
  const storedRows = stored.reduce((sum, a) => sum + a.rows.length, 0);
  const count = (outcome: DemoOutcome): number =>
    accounts.filter((a) => a.outcome === outcome).length;

  const expectation: DemoWorldExpectation = {
    accountsAudited: stored.length,
    storedRows,
    // EVERY STORED ROW IS IN SCOPE, and that is an arithmetic consequence rather
    // than a hope: one engine version and one calendar revision were handed to
    // every `foldAccountDay` call above, and B.4 step 1 scopes on exactly those
    // two fields.
    inScope: storedRows,
    outOfScope: 0,
    matched: storedRows,
    diverged: 0,
    breached: count('breached'),
    graduated: count('graduated'),
    refused: count('refused'),
    stillTrading: count('trading'),
    reachedFunded: building.filter((b) => b.reachedFunded).length,
  };

  return {
    seed: options.seed,
    startDay: options.startDay,
    sessionCount: window.length,
    accountsPerCohort: options.accountsPerCohort,
    engineVersion: DEMO_WORLD_ENGINE_VERSION,
    calendarRevisionId: DEMO_WORLD_CALENDAR_REVISION,
    plan: CORE_EOD_50K,
    calendar,
    accounts,
    expectation,
  };
}

// -----------------------------------------------------------------------------
// The ports
// -----------------------------------------------------------------------------

/** A `BatchPorts` over a world, plus what the write side was handed. */
export interface DemoWorldPorts {
  readonly ports: BatchPorts;
  readonly divergences: readonly ReplayDivergenceFinding[];
  readonly reconciliations: readonly ReconciliationFinding[];
}

/**
 * `BatchPorts` over a sealed world.
 *
 * `writeRuleState` REFUSES RATHER THAN APPENDING, and that is the one port whose
 * behaviour is a decision. A world is folded once; a second writer over it would
 * produce a second copy of the truth, and the audit would then compare a replay
 * against whichever copy the read port happened to return. `0015`'s own rule is
 * that a rule state is never superseded, and `0026` revoked UPDATE on the table
 * from `merit_app` and PUBLIC. The in-memory port keeps the same promise.
 *
 * `raiseDivergence` and `raiseReconciliation` COLLECT rather than refusing,
 * because they are the audit's output channel and an audit that could not report
 * a finding would be a green audit by construction.
 */
export function demoWorldPorts(world: DemoWorld): DemoWorldPorts {
  const byId = new Map(world.accounts.map((a) => [a.accountId, a]));
  const divergences: ReplayDivergenceFinding[] = [];
  const reconciliations: ReconciliationFinding[] = [];

  const ports: BatchPorts = {
    read: {
      calendarWatermark: () => Promise.resolve(world.calendarRevisionId),
      calendarSlice: () => Promise.resolve(world.calendar),
      accountsWithLiveMark: (tradingDay) =>
        Promise.resolve(
          world.accounts
            .filter((a) => a.days.some((d) => d.mark.tradingDay === tradingDay))
            .map((a) => a.accountId),
        ),
      loadAccountDay: (accountId, tradingDay) =>
        Promise.resolve(
          byId.get(accountId)?.days.find((d) => d.mark.tradingDay === tradingDay) ?? null,
        ),
      // B.1 is "every account that has ever existed", and an account with no
      // stored row has nothing for the audit to compare. Filtering here is what
      // a `SELECT DISTINCT account_id FROM rule_states` would do.
      accountsWithStoredState: () =>
        Promise.resolve(world.accounts.filter((a) => a.rows.length > 0).map((a) => a.accountId)),
      storedRuleStates: (accountId) => Promise.resolve(byId.get(accountId)?.rows ?? []),
      accountDaysFrom: (accountId) => Promise.resolve(byId.get(accountId)?.days ?? []),
    },
    write: {
      writeRuleState: (row) =>
        Promise.reject(
          new DemoWorldRefusal(
            `the demo world is sealed and something tried to write a rule state for ` +
              `${row.accountId} on ${String(row.tradingDay)}. A world folded twice has two ` +
              'copies of its own truth and the audit would compare a replay against whichever ' +
              'one the read port returned',
          ),
        ),
      raiseReconciliation: (finding) => {
        reconciliations.push(finding);
        return Promise.resolve();
      },
      raiseDivergence: (finding) => {
        divergences.push(finding);
        return Promise.resolve();
      },
    },
  };

  return { ports, divergences, reconciliations };
}

// -----------------------------------------------------------------------------
// The audit, compared against the seed's own expectation
// -----------------------------------------------------------------------------

export interface DemoWorldAudit {
  readonly report: ReplayAuditReport;
  readonly divergences: readonly ReplayDivergenceFinding[];
  readonly expectation: DemoWorldExpectation;
}

/**
 * Replay the world and check the report against what the seed said it would be.
 *
 * THE REFUSAL ON ZERO IS ADR-073'S, CARRIED OUT WHERE IT CAN BE. That ruling
 * closed the replay leg with "when it is built it refuses on `accountsAudited
 * === 0`", and `runReplayAudit`'s own `OI-14` guard does not cover it: that
 * guard fires on `storedRows > 0 && inScope === 0`, so a world with no rows at
 * all returns `accountsAudited: 0, diverged: 0` and reads exactly like a clean
 * audit. The refusal belongs in `replay.ts` eventually and `apps/worker` is
 * outside this session's fence, so it lives here and ADR-119 records that it is
 * owed one directory over.
 *
 * EVERY FIELD IS COMPARED AND NOT ONLY `diverged`. A report can be clean because
 * nothing was compared, which is `FM-17` and is the whole reason `OI-14` exists;
 * comparing `matched` against the row count the seed counted is what makes a
 * green result mean the rows were read.
 */
export async function auditDemoWorld(world: DemoWorld): Promise<DemoWorldAudit> {
  const { ports, divergences } = demoWorldPorts(world);
  const report = await runReplayAudit(ports, {
    engineVersion: world.engineVersion,
    mode: 'detect',
  });

  if (report.accountsAudited === 0) {
    throw new DemoWorldRefusal(
      'the replay audit ran over zero accounts. ADR-073 section 5 closed this leg on exactly ' +
        'that outcome: "a nightly built today reports accountsAudited: 0, diverged: 0, green, ' +
        'every night, over nothing", and `runReplayAudit`\'s OI-14 guard cannot catch it ' +
        'because it fires on storedRows > 0 && inScope === 0',
    );
  }

  return { report, divergences, expectation: world.expectation };
}

/** One disagreement between the seed's expectation and the replay's report. */
export interface ExpectationMismatch {
  readonly field: string;
  readonly expected: number;
  readonly reported: number;
}

/**
 * The seed's expectation against the audit's report, field by field.
 *
 * Returns every mismatch rather than the first, because a run that reports both
 * "two fewer accounts" and "forty fewer rows" is a different diagnosis from one
 * that reports only the second.
 */
export function checkAgainstExpectation(audit: DemoWorldAudit): readonly ExpectationMismatch[] {
  const { report, expectation } = audit;
  const pairs: readonly ExpectationMismatch[] = [
    {
      field: 'accountsAudited',
      expected: expectation.accountsAudited,
      reported: report.accountsAudited,
    },
    { field: 'storedRows', expected: expectation.storedRows, reported: report.storedRows },
    { field: 'inScope', expected: expectation.inScope, reported: report.inScope },
    { field: 'outOfScope', expected: expectation.outOfScope, reported: report.outOfScope },
    { field: 'matched', expected: expectation.matched, reported: report.matched },
    { field: 'diverged', expected: expectation.diverged, reported: report.diverged },
    {
      field: 'divergencesRaised',
      expected: expectation.diverged,
      reported: audit.divergences.length,
    },
  ];
  return pairs.filter((p) => p.expected !== p.reported);
}

// -----------------------------------------------------------------------------
// The converse, which is what stops the check passing vacuously
// -----------------------------------------------------------------------------

/**
 * The same world with one stored row carrying a balance the engine never
 * computed, AND A HASH OVER THAT WRONG BALANCE.
 *
 * THE HASH IS RECOMPUTED AND THAT IS THE WHOLE DESIGN OF THIS FUNCTION. Leaving
 * the original hash in place would leave the stored bytes AGREEING with the
 * replay, `diffStoredAgainstRecomputed` would return no divergence, and the
 * falsification would prove that the audit ignores a field it never reads. What
 * INV-04 is actually about is a row that storage recorded faithfully from an
 * engine that computed something else, and that row's hash is the hash OF the
 * wrong state.
 *
 * `by` is signed and in CENTS. One cent is the default because a divergence
 * detector that needs a large error is not a divergence detector.
 */
export function perturbDemoWorld(
  world: DemoWorld,
  accountIndex = 0,
  rowIndex = 0,
  by: bigint = 1n,
): DemoWorld {
  const target = world.accounts[accountIndex];
  if (target === undefined) {
    throw new DemoWorldRefusal(`no account at index ${String(accountIndex)} to perturb`);
  }
  const original = target.rows[rowIndex];
  if (original === undefined) {
    throw new DemoWorldRefusal(
      `account ${target.accountId} has ${String(target.rows.length)} stored row(s) and no row ` +
        `at index ${String(rowIndex)}. A falsification that perturbs nothing asserts nothing`,
    );
  }

  const wrong = { ...original, balanceCents: (original.balanceCents + by) as Cents };
  const perturbed: RuleStateRow = {
    ...wrong,
    stateHash: stateHash({ accountId: wrong.accountId, state: wrong }),
  };

  const rows = target.rows.map((row, i) => (i === rowIndex ? perturbed : row));
  const accounts = world.accounts.map((a, i) => (i === accountIndex ? { ...a, rows } : a));

  return {
    ...world,
    accounts,
    // THE EXPECTATION MOVES WITH THE WORLD. One row diverges, and it is the only
    // one: the replay chains its own prior from day one, so a corrupted stored
    // row poisons no later comparison. A perturbation that expected a cascade
    // would be asserting the defect INV-04's "from day one" exists to rule out.
    expectation: { ...world.expectation, matched: world.expectation.matched - 1, diverged: 1 },
  };
}
