// =============================================================================
// apps/worker/src/digests/rows.ts
// =============================================================================
// THE COLUMN READERS BOTH RUNS SHARE, AND EVERY ONE OF THEM REFUSES RATHER THAN
// COERCES.
//
// `breaker/evaluate.ts`'s readers are the idiom and the reason is theirs: a
// `uuid` arriving as an object becomes `[object Object]` under `String(value)`
// and is then written into a schedule id, which is a finding about a schedule
// that does not exist. A refusal names the column and the shape it got.
//
// **THIS FILE IS SEPARATE SO THAT `alarm.ts` NEED NOT IMPORT `produce.ts`.**
// `ports.ts` section 1 makes the alarm's independence from the producer a
// property of a type; the readers are the one thing the two runs genuinely
// share, so they live in a third module and the dependency edge between the
// alarm and the producer stays absent. `test/digests.test.ts` asserts that
// absence by reading `alarm.ts` as text.
//
// IT IMPORTS ONLY TYPES, FROM `ports.ts`, AND NOTHING ELSE AT ALL.
// =============================================================================

import type { DigestRow } from './ports.ts';

/** Raised when a row crossing a port is not the shape the column declares. */
export class DigestRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DigestRowError';
  }
}

/** A value that is a row, or a refusal that shows what arrived instead. */
export function record(value: unknown, where: string): DigestRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new DigestRowError(`${where}: expected a row and received ${JSON.stringify(value)}`);
  return value as DigestRow;
}

/**
 * A `uuid` or `text` column.
 *
 * A refusal rather than `String(value)`. See this file's header: the coercion
 * produces a plausible identifier for a row nobody can find again.
 */
export function readText(row: DigestRow, key: string, where: string): string {
  const value = row[key];
  if (typeof value !== 'string')
    throw new DigestRowError(`${where}.${key}: expected text and received ${typeof value}`);
  return value;
}

/** A nullable `text` column. */
export function readNullableText(row: DigestRow, key: string, where: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return readText(row, key, where);
}

/**
 * A `timestamptz` column that must be present.
 *
 * **A STRING IS REFUSED AND NOT PARSED.** `due_at` is the column the whole
 * control rests on (`0040` header item 1), and `new Date('not a date')` is an
 * `Invalid Date` whose every comparison is `false`, which would make a closed
 * window read as an open one and the alarm silently pass.
 */
export function readInstant(row: DigestRow, key: string, where: string): Date {
  const value = row[key];
  if (!(value instanceof Date))
    throw new DigestRowError(
      `${where}.${key}: expected a Date and received ${typeof value}. A timestamptz parsed from a ` +
        'string can be an Invalid Date, whose every comparison is false, which would make a closed ' +
        'window read as one that has not opened yet',
    );
  if (Number.isNaN(value.getTime()))
    throw new DigestRowError(`${where}.${key} is an Invalid Date, whose every comparison is false`);
  return value;
}

/** A `boolean NOT NULL` column. */
export function readBoolean(row: DigestRow, key: string, where: string): boolean {
  const value = row[key];
  if (typeof value !== 'boolean')
    throw new DigestRowError(
      `${where}.${key}: expected a boolean and received ${typeof value}. \`enabled\` decides ` +
        "whether a schedule is the alarm's subject at all, so a truthy string would enrol every " +
        'row this read returns',
    );
  return value;
}

/** An `integer NOT NULL` column, as a safe integer. */
export function readInteger(row: DigestRow, key: string, where: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new DigestRowError(
      `${where}.${key}: expected a safe integer and received ${JSON.stringify(value)}`,
    );
  return value;
}

/** A `text[] NOT NULL` column. */
export function readTextArray(row: DigestRow, key: string, where: string): readonly string[] {
  const value = row[key];
  if (!Array.isArray(value))
    throw new DigestRowError(`${where}.${key}: expected an array and received ${typeof value}`);
  return value.map((element, index) => {
    if (typeof element !== 'string')
      throw new DigestRowError(
        `${where}.${key}[${String(index)}]: expected text and received ${typeof element}`,
      );
    return element;
  });
}

/** A `date` column, as the `YYYY-MM-DD` the trading-day rule requires. */
const TRADING_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A trading day, refused when it is anything else.
 *
 * `CLAUDE.md` and `ADR-042`: timestamps are UTC in storage and the trading day
 * follows the exchange session calendar maintained as data. A UTC instant here
 * would be a job inventing a calendar, which is what `tradingDayOf` is injected
 * to prevent.
 */
export function readTradingDay(value: string, where: string): string {
  if (!TRADING_DAY.test(value))
    throw new DigestRowError(
      `${where} is ${JSON.stringify(value)}, and a trading day is a YYYY-MM-DD exchange session ` +
        'day, never a UTC timestamp',
    );
  return value;
}
