// =============================================================================
// apps/api/test/admin-write-trading-day.test.ts
// =============================================================================
// `ADR-251`. THE `useAdminWriteBackend` ENTRY LOST A CLAUSE AND THIS FILE IS
// WHERE THAT LOSS IS DERIVED FROM SOURCE INSTEAD OF ASSERTED IN PROSE.
//
// The entry named THREE suppliers. One of them, "nothing in this workspace maps
// an instant to an exchange trading day", was a census claim about the whole
// repository, and a census claim in a comment is the exact shape that goes
// stale without anything saying so: `ADR-236` found the same defect three
// citations deep in this same list, and `ADR-171` finding 10 found another one
// in this same entry.
//
// SO EVERY CLAUSE OF THE NARROWED ENTRY IS EXECUTED HERE. The supplier is
// CALLED rather than described, the port is watched still refusing, and the
// reason the port cannot yet be handed that supplier is asserted as a property
// of the two SHAPES rather than as a sentence somebody has to keep true.
//
// WHAT THIS FILE DOES NOT DO IS WIRE ANYTHING, and the last test is the one
// that keeps that honest.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { SCOPE_RULES } from '@merit/db';
import { buildSessionCalendar, tradingDayAt } from '@merit/rules-engine';
import type { TradingDay } from '@merit/rules-engine';

import { UNWIRED_ADMIN_WRITE_BACKEND, AdminWriteUnwired } from '../src/routes/admin-writes.ts';

const SRC = join(import.meta.dirname, '..', 'src');
const read = (path: string): string => readFileSync(path, 'utf8');

const day = (value: string): TradingDay => value as TradingDay;
const at = (iso: string): number => Date.parse(iso);

/**
 * A two-day window with one declared load.
 *
 * IT IS NOT A CLAIM ABOUT ANY EXCHANGE'S CALENDAR (`TR-01`) and it is not the
 * engine's fixture either. What it is for is reaching the supplier from THIS
 * deployable, which is the fact the narrowed entry rests on: a function that
 * exists in a package `apps/api` cannot import would discharge nothing.
 */
const WINDOW = buildSessionCalendar({
  sessions: [
    {
      tradingDay: day('2026-03-03'),
      isHoliday: false,
      openAtMs: at('2026-03-02T23:00:00Z'),
      closeAtMs: at('2026-03-03T22:00:00Z'),
    },
    {
      tradingDay: day('2026-03-04'),
      isHoliday: false,
      openAtMs: at('2026-03-03T23:00:00Z'),
      closeAtMs: at('2026-03-04T22:00:00Z'),
    },
  ],
  coverage: [{ from: day('2026-03-03'), to: day('2026-03-04') }],
});

test('the discharged clause: this deployable can map an instant to a trading day', () => {
  // The entry said nothing in this workspace could. `apps/api` declares
  // `@merit/rules-engine`, so the import above is the measurement and the call
  // below is the demonstration.
  const evening = '2026-03-03T23:30:00Z';
  const resolved = tradingDayAt(WINDOW, at(evening));

  expect(resolved.found).toBe(true);
  if (!resolved.found) return;
  expect(resolved.tradingDay).toBe(day('2026-03-04'));
  // And it is a READ rather than a conversion: the instant's own UTC date is
  // the other day, which is `ADR-146` section 3's divergence.
  expect(evening.slice(0, 10)).toBe('2026-03-03');
});

test('the read is available too: both calendar tables are `firm` and this deployable holds `firm`', () => {
  // ADR-042 F-4 needs BOTH: `trading_calendar` says which days are sessions and
  // `trading_calendar_loads` says which days the estate has an opinion about.
  expect(SCOPE_RULES['tradingCalendar']?.class).toBe('firm');
  expect(SCOPE_RULES['tradingCalendarLoads']?.class).toBe('firm');

  // `src/db.ts` declares the door that reads a `firm` table.
  expect(read(join(SRC, 'db.ts'))).toMatch(/firm<T>\(fn: \(tx: FirmTx\) => Promise<T>\)/);
});

test('what replaces the clause: `tradingDay(): string` has one arm and the answer has three', () => {
  // THE OBSTRUCTION IS NOW A SHAPE AND NOT AN ABSENCE, and it is asserted as a
  // property of the resolver rather than quoted from the entry.
  //
  // An estate that loaded nothing answers for nothing (`ADR-042` F-4), so there
  // is a legal state of the database in which a total `tradingDay(): string`
  // has no string to return that it did not invent.
  const unloaded = buildSessionCalendar({ sessions: [], coverage: [] });
  const unknown = tradingDayAt(unloaded, at('2026-03-03T23:30:00Z'));
  expect(unknown.found).toBe(false);
  if (unknown.found) return;
  expect(unknown.reason).toBe('outside_coverage');

  // And an instant inside coverage that no session contains is a SECOND
  // non-answer, distinct from the first and equally unrepresentable in a
  // `string`. 22:30Z on the 3rd is after `2026-03-03` closed at 22:00Z and
  // before `2026-03-04` opened at 23:00Z: the daily gap between one close and
  // the next open, which is inside the span and inside no session.
  //
  // THE FIRST VERSION OF THIS CASE USED `2026-03-04T22:30:00Z` AND WAS RED,
  // correctly: that instant is past the last close in this window, so it is
  // `outside_coverage` and not the answer this case is about. It is recorded
  // because a case that was never wrong is a case nobody watched.
  const between = tradingDayAt(WINDOW, at('2026-03-03T22:30:00Z'));
  expect(between.found).toBe(false);
  if (between.found) return;
  expect(between.reason).toBe('not_a_session');

  // The port declares the one-armed shape, which is what the two answers above
  // cannot be handed to.
  expect(read(join(SRC, 'routes', 'admin-writes.ts'))).toContain('tradingDay(): string;');
});

test('the two stale census sentences are gone from the port, at the source', () => {
  // A correction recorded in `wiring.test.ts` while the refuted sentence stands
  // in the file it is about is the defect `ADR-172` found in that list twice and
  // `ADR-246` found a third time. Both are asserted as ABSENCES here so neither
  // can come back in a keep-both merge.
  const source = read(join(SRC, 'routes', 'admin-writes.ts'));

  expect(source).not.toContain('Nothing in this\n   * workspace maps an instant to a trading day');
  expect(source).not.toContain('`apps/api` does not declare `@merit/rules-engine` and this');

  // And the live reason is present in its place.
  expect(source).toContain('IS NOW FALSE (ADR-251)');
});

test('the port is NOT wired, and it still refuses by name', () => {
  // THE DELIVERABLE IS NOT A RAISED WIRED COUNT. `useAdminWriteBackend` stays
  // blocked on `principal(request)` whatever this session landed, so the
  // default must still be the refusing one.
  expect(() => UNWIRED_ADMIN_WRITE_BACKEND.tradingDay()).toThrow(AdminWriteUnwired);
  expect(() => UNWIRED_ADMIN_WRITE_BACKEND.tradingDay()).toThrow(/no backend is installed/);

  // Read as text, on `wiring.test.ts`'s own reason: calling the setter is a side
  // effect of importing the entry point, so source is the only observation that
  // does not start a server.
  expect(read(join(SRC, 'start.ts'))).not.toContain('useAdminWriteBackend(');
});
