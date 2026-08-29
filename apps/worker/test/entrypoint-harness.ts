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

const MARK = { accountId: '11111111-1111-4111-8111-111111111111', supersededBy: null };

function rowsFor(key: string): unknown[] {
  if (key === 'tradingCalendar') return MODE === 'empty-calendar' ? [] : [SESSION];
  if (key === 'tradingCalendarRevisions') return [];
  if (key === 'dailyMarks') return MODE === 'refusing-port' ? [MARK] : [];
  if (key === 'ruleStates') return [];
  throw new Error(`the harness has no rows for ${key}`);
}

// THE STUB IS CAST RATHER THAN IMPLEMENTED. `SystemTx` publishes seven methods
// and this harness exercises two of them; implementing the other five would be
// writing a second accessor to prove a fact about a process exit code.
const tx = {
  rows: (key: string) => Promise.resolve(rowsFor(key)),
  rowsWhere: (key: string) => Promise.resolve(rowsFor(key)),
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
