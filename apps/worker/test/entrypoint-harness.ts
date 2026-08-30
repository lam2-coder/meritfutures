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
// door: a run that completes, and a run whose port refuses.
// =============================================================================

import { main, type WorkerJobIo } from '../src/index.ts';
import type { WorkerDb } from '../src/db.ts';
import {
  ACCOUNT_A,
  PLAN_VERSION_ID,
  accountRow,
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

// THE `refusing-port` MODE NOW CARRIES A WHOLE ACCOUNT DAY AND THAT IS THE
// POINT RATHER THAN SETUP. `ADR-258` made `loadAccountDay` resolve five of an
// `AccountDay`'s six fields, so a stub mark with two keys on it no longer
// reaches the refusal: it reaches a `BatchRowError` about a column, which is a
// different fact and would let case 2.3 pass while proving nothing about a
// PORT. The rows below are `fixtures.ts`'s, which are `DATA_MODEL` section 11's
// plan and the materialized grid, so this harness refuses where the deployment
// refuses: after the plan resolved, the prior read and the mark was live, on
// `external` and on nothing else.
const DAY = SESSION.tradingDay;

function rowsFor(key: string): unknown[] {
  const refusing = MODE === 'refusing-port';
  if (key === 'tradingCalendar') return MODE === 'empty-calendar' ? [] : [SESSION];
  if (key === 'tradingCalendarRevisions') return [];
  if (key === 'dailyMarks') return refusing ? [markRow({ tradingDay: DAY })] : [];
  if (key === 'ruleStates') return [];
  if (key === 'accounts') return refusing ? [accountRow({ openedOn: DAY })] : [];
  if (key === 'planVersions') return refusing ? [planVersionRow()] : [];
  if (key === 'planVersionSizes') return refusing ? [sizeRow()] : [];
  if (key === 'payoutRequests') return [];
  throw new Error(`the harness has no rows for ${key}`);
}

/** The two addresses this path takes, answered by key rather than by predicate. */
function rowAt(key: string, at: Record<string, unknown>): unknown {
  if (key === 'accounts') return at['id'] === ACCOUNT_A ? accountRow({ openedOn: DAY }) : undefined;
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
