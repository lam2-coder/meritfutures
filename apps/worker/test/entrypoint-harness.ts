// =============================================================================
// apps/worker/test/entrypoint-harness.ts
// =============================================================================
// A PROCESS THAT RUNS THE REAL `main` AGAINST A STUB DOOR, SO A TEST CAN WATCH
// THE EXIT CODE RATHER THAN REASON ABOUT IT.
//
// `test/entrypoint.test.ts` spawns this file and asserts the status it left.
// **THE PROPERTY UNDER TEST IS THE ONE THE LAST LINE HAS IN COMMON WITH
// `src/start.ts`**: the real `main`, awaited at the top level of an ES module,
// with no `catch` anywhere between it and the process. That test reads
// `start.ts` as text and asserts the same two facts about it, because a harness
// whose call shape drifted from the entry point would be proving a property
// about itself. What `start.ts` adds is the pool this file does not own.
//
// It takes no database. `src/start.ts` is the file that carries `LIVE_DB`, and
// `test/entrypoint.test.ts` watches THAT one fail against an unset
// `DATABASE_URL`. What this file adds is the two outcomes that need a working
// door: a run that completes, and a run the resolver refuses mid-batch.
// =============================================================================

import { main, type WorkerJobIo } from '../src/index.ts';
import type { WorkerDb } from '../src/db.ts';
import {
  ACCOUNT_A,
  IDENTITY_A,
  PLAN_VERSION_ID,
  accountRow,
  identityRow,
  kycRow,
  markRow,
  planVersionRow,
  sizeRow,
} from './fixtures.ts';

const MODE = process.argv[2] ?? '';

/** 2026-08-28's close, as an instant. The clock below is after it. */
const CLOSED_AT = new Date('2026-08-29T21:00:00Z');
const NOW = new Date('2026-08-30T06:00:00Z');

const SESSION = {
  tradingDay: '2026-08-28',
  isHalfDay: false,
  isHoliday: false,
  halted: false,
  sessionCloseAt: CLOSED_AT,
};

// THE MID-BATCH REFUSAL MOVED TWICE AND THE MODE IS RENAMED WITH IT, WHICH IS A
// CORRECTNESS POINT RATHER THAN TIDYING.
//
// It was `refusing-port` because `loadAccountDay` was a port this deployment had
// not wired. `ADR-258` made it resolve five of six fields and this harness grew a
// whole account day so the run would reach the refusal rather than a
// `BatchRowError` about a column. **`ADR-260` RESOLVED THE SIXTH, SO THERE IS NO
// UNWIRED PORT LEFT ON THE NIGHTLY PATH AT ALL** and a mode still called
// `refusing-port` would be asserting a fact that is no longer true of any port
// this run touches.
//
// **WHAT IS LEFT IS THE REFUSAL THAT MATTERS MORE**, and case 2.3 is stronger for
// it: the account below carries `accounts.status = 'provisioning_pending'`, the
// member `account_status` declares and `AccountStatus` does not, so
// `resolveExternalGates` refuses the `accountStatus` leg. That is the trap
// `ADR-260` was sent at, run end to end through a real process: the day resolved,
// the watermark was read, the plan resolved, the mark was live, and the resolver
// stopped rather than widening a union to make a map total. `runNightlyBatch`
// does not catch, `main` does not catch, and the entry point does not catch.
//
// The rows are `fixtures.ts`'s, which are `DATA_MODEL` section 11's plan and the
// materialized grid, so this harness refuses where the deployment refuses.
const DAY = SESSION.tradingDay;

/** The account the refusing mode folds: everything clear except the one status. */
const REFUSED_ACCOUNT = accountRow({ openedOn: DAY, status: 'provisioning_pending' });

function rowsFor(key: string): unknown[] {
  const refusing = MODE === 'refusing-gates';
  if (key === 'tradingCalendar') return MODE === 'empty-calendar' ? [] : [SESSION];
  if (key === 'tradingCalendarRevisions') return [];
  if (key === 'dailyMarks') return refusing ? [markRow({ tradingDay: DAY })] : [];
  if (key === 'ruleStates') return [];
  if (key === 'accounts') return refusing ? [REFUSED_ACCOUNT] : [];
  if (key === 'identities') return refusing ? [identityRow()] : [];
  if (key === 'kycVerifications') return refusing ? [kycRow()] : [];
  if (key === 'planVersions') return refusing ? [planVersionRow()] : [];
  if (key === 'planVersionSizes') return refusing ? [sizeRow()] : [];
  if (key === 'payoutRequests') return [];
  throw new Error(`the harness has no rows for ${key}`);
}

/** The addresses this path takes, answered by key rather than by predicate. */
function rowAt(key: string, at: Record<string, unknown>): unknown {
  if (key === 'accounts') return at['id'] === ACCOUNT_A ? REFUSED_ACCOUNT : undefined;
  if (key === 'identities') return at['id'] === IDENTITY_A ? identityRow() : undefined;
  if (key === 'planVersions') return at['id'] === PLAN_VERSION_ID ? planVersionRow() : undefined;
  throw new Error(`the harness has no address for ${key}`);
}

// THE STUB IS CAST RATHER THAN IMPLEMENTED. `SystemTx` publishes seven methods
// and this harness exercises three of them; implementing the other four would be
// writing a second accessor to prove a fact about a process exit code.
const tx = {
  rows: (key: string) => Promise.resolve(rowsFor(key)),
  rowsWhere: (key: string) => Promise.resolve(rowsFor(key)),
  rowAt: (key: string, at: Record<string, unknown>) => Promise.resolve(rowAt(key, at)),
} as unknown as Parameters<Parameters<WorkerDb['batch']>[0]>[0];

const db: WorkerDb = { batch: (fn) => fn(tx) };

const io: WorkerJobIo = {
  db,
  env: { MERIT_ENGINE_VERSION: 'harness-1' },
  now: () => NOW,
  log: (line) => {
    console.log(line);
  },
};

await main(io);
