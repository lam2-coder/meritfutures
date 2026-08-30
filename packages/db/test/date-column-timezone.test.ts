// =============================================================================
// packages/db/test/date-column-timezone.test.ts -- CI-02, `unit`.
// =============================================================================
// ADR-271. THE VALIDATING HALF OF THE `date` TYPE PARSER, AND IT PROVES THE
// PROPERTY BY RUNNING BOTH LIBRARIES RATHER THAN BY READING EITHER.
//
// -----------------------------------------------------------------------------
// THE DEFECT THIS FILE CLOSES, as ADR-268 section 7 measured it
// -----------------------------------------------------------------------------
// A `date` column reaches Merit code through two libraries and neither one is
// Merit:
//
//   1. `pg` registers `postgres-date`'s `parseDate` for OID 1082. On a bare
//      `YYYY-MM-DD` that function reaches `new Date(year, month, day)`, which is
//      the PROCESS'S LOCAL MIDNIGHT.
//   2. Drizzle's `PgDateString.mapFromDriverValue` then renders that `Date` with
//      `toISOString().slice(0, -14)`, which is UTC.
//
// A local midnight east of UTC is the previous UTC day, so the database's
// `2026-08-28` arrived in Merit code as `'2026-08-27'` on every deployment whose
// `TZ` was positive. That is `ADR-146` clause 4's forbidden failure -- a UTC
// calendar date meeting an exchange CT trading day -- performed before any Merit
// line runs, on all 52 `date` columns at once.
//
// -----------------------------------------------------------------------------
// WHY THE REPAIR IS A PARSER AND NOT A CORRECTION AT THE READER
// -----------------------------------------------------------------------------
// Drizzle ALREADY HOLDS THE CORRECT PATH and never takes it. `PgDateString`
// reads, in full:
//
//     mapFromDriverValue(value) {
//       if (typeof value === "string") return value;
//       return value.toISOString().slice(0, -14);
//     }
//
// A STRING PASSES THROUGH UNTOUCHED. The only reason the second line ever runs
// is that `pg` built a `Date` first. `setTypeParser(1082, ...)` returning the
// wire text verbatim means no `Date` is ever constructed, drizzle takes the
// branch it already has, and the timezone crossing has nowhere to happen. There
// is nothing left for a reader to correct, which is why correcting readers would
// have been the same defect multiplied.
//
// -----------------------------------------------------------------------------
// NO DATABASE, AND THE PROOF IS STILL A RUN
// -----------------------------------------------------------------------------
// What PostgreSQL puts on the wire for a `date` under the ISO DateStyle is
// exactly `YYYY-MM-DD`, and that string is this file's input. Everything from
// there to the value Merit code holds is the REAL registered parser and the REAL
// drizzle column off the REAL schema, run at five process timezones spanning
// UTC-11 to UTC+14. What is
// not proved here is PostgreSQL's own output, which is `assert_date_unit_shape.
// mjs`'s half of the same subject.
// =============================================================================

import pg from 'pg';
import { getTableColumns } from 'drizzle-orm';
import { type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, test } from 'vitest';

import { TABLES, type TableKey } from '../src/index.ts';

// IMPORTED FOR ITS SIDE EFFECT AS MUCH AS FOR THE NAME. `client.ts` installs
// the parser at module scope, so importing it is what makes the property true.
// The import opens no socket: the pool is lazy and `DATABASE_URL` is read on
// first use, both of which that file states and neither of which this file
// needs. The name is held so the registry entry can be asserted to BE Merit's
// function rather than merely to behave like it.
import { dateWireText } from '../src/client.ts';

const CLIENT_SRC = readFileSync(
  fileURLToPath(new URL('../src/client.ts', import.meta.url)),
  'utf8',
);

/** `date`. The one OID this repair touches. */
const DATE_OID = 1082;

/**
 * `timestamp` and `timestamptz`. NAMED HERE SO THEY CAN BE ASSERTED ABSENT.
 * Merit stores instants in UTC deliberately (CLAUDE.md), so an instant HAS a
 * timezone and must keep the coercion a calendar day must not get.
 */
const TIMESTAMP_OIDS = { timestamp: 1114, timestamptz: 1184 } as const;

/** The wire text PostgreSQL sends for a `date` under the ISO DateStyle. */
const WIRE_DAY = '2026-08-28';

/**
 * The five offsets the property is asserted at, and the reason each is here.
 *
 * THE DEFECT WAS ASYMMETRIC AND THAT IS WHY IT SURVIVED. A local midnight WEST
 * of UTC is the same UTC day at some hours past midnight, so `toISOString()`
 * returned the right answer and every negative offset was silently correct.
 * `America/Chicago` is Merit's own exchange zone and it is one of the ones that
 * never failed, which is exactly how a team reads a green tree and ships this.
 */
const OFFSETS = [
  ['UTC, where the defect never fired', 'UTC'],
  ['east of UTC, where it fired', 'Europe/Berlin'],
  ['the furthest east there is', 'Pacific/Kiritimati'],
  ['west of UTC, where it never fired', 'America/Chicago'],
  ['the furthest west there is', 'Pacific/Midway'],
] as const;

/**
 * One `date` value's whole journey, from the wire to the value Merit code holds.
 *
 * BOTH LIBRARIES ARE THE REAL ONES. `pg.types.getTypeParser` is the live
 * registry this process reads, so it answers with whatever is installed at the
 * moment of the call, and the column is off the real schema rather than one this
 * file built.
 */
function throughTheDriver(column: PgColumn, wire: string): unknown {
  const parse = pg.types.getTypeParser(DATE_OID, 'text') as (raw: string) => unknown;
  return column.mapFromDriverValue(parse(wire));
}

/** Every `date` column in the estate, by table and property name. */
function everyDateColumn(): { key: TableKey; property: string; column: PgColumn }[] {
  const found: { key: TableKey; property: string; column: PgColumn }[] = [];
  for (const key of Object.keys(TABLES) as TableKey[]) {
    const columns = getTableColumns(TABLES[key] as PgTable) as unknown as Record<string, PgColumn>;
    for (const [property, column] of Object.entries(columns)) {
      if (column.getSQLType() === 'date') found.push({ key, property, column });
    }
  }
  return found;
}

const DAY_COLUMN = (): PgColumn => {
  const columns = getTableColumns(TABLES['tradingCalendar'] as PgTable) as unknown as Record<
    string,
    PgColumn
  >;
  const column = columns['tradingDay'];
  if (column === undefined) throw new Error('tradingCalendar declares no tradingDay column');
  return column;
};

// `TZ` IS RESTORED RATHER THAN LEFT. Node re-reads it per operation, so a file
// that changed it and walked away would move every later date assertion in the
// same worker.
const ORIGINAL_TZ = process.env['TZ'];
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env['TZ'];
  else process.env['TZ'] = ORIGINAL_TZ;
});

/** Run `fn` with the process at `zone`, and put the zone back either way. */
function at<T>(zone: string, fn: () => T): T {
  const before = process.env['TZ'];
  process.env['TZ'] = zone;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env['TZ'];
    else process.env['TZ'] = before;
  }
}

// -----------------------------------------------------------------------------
// 1. THE PROPERTY: A DAY IS THE SAME DAY AT EVERY OFFSET
// -----------------------------------------------------------------------------

describe('a calendar day survives the driver unchanged, at every process timezone', () => {
  test.each(OFFSETS)('%s (%s) reads the wire day as itself', (_why, zone) => {
    const got = at(zone, () => throughTheDriver(DAY_COLUMN(), WIRE_DAY));
    expect({ zone, day: got }).toEqual({ zone, day: WIRE_DAY });
  });

  test('THE THREE-OFFSET PROOF: one read, three zones, one answer', () => {
    const answers = OFFSETS.map(([, zone]) =>
      at(zone, () => throughTheDriver(DAY_COLUMN(), WIRE_DAY)),
    );
    expect(new Set(answers)).toEqual(new Set([WIRE_DAY]));
  });

  // THE ZONE IS PROVED TO BE LIVE, so the three cases above cannot pass by
  // having changed nothing. If `TZ` stopped taking effect mid-process, every
  // offset would be the harness's own zone and the property would read as held
  // for a reason that has nothing to do with the parser.
  test('the harness really does move the process clock, or the cases above prove nothing', () => {
    const local = (): string => new Date(2026, 7, 28).toISOString();
    expect(at('UTC', local)).toBe('2026-08-28T00:00:00.000Z');
    expect(at('Europe/Berlin', local)).toBe('2026-08-27T22:00:00.000Z');
    expect(at('Pacific/Kiritimati', local)).toBe('2026-08-27T10:00:00.000Z');
  });
});

// -----------------------------------------------------------------------------
// 2. THE PROPERTY HOLDS FOR EVERY `date` COLUMN, NOT ONLY THE ONE THAT FOUND IT
// -----------------------------------------------------------------------------
// ADR-268 found this on the trading calendar and the blast radius was never the
// calendar. A parser is global, so the enumeration is asserted rather than
// argued: EVERY column the schema types `date` is read back verbatim, at the
// offset where the defect fired hardest.

describe('every `date` column in the estate, at the offset where the defect fired', () => {
  const columns = everyDateColumn();

  test('the reader found the estate rather than nothing', () => {
    // A SENTINEL, ON RI-24's PRECEDENT. Zero, or a number that has collapsed,
    // means `getSQLType()` or `TABLES` moved and every case below would pass by
    // reading an empty list. 52 is what the schema carried when ADR-271 landed.
    expect(columns.length).toBeGreaterThanOrEqual(52);
  });

  test('all of them read the wire day verbatim at UTC+14', () => {
    const wrong = at('Pacific/Kiritimati', () =>
      columns
        .map(({ key, property, column }) => ({
          where: `${key}.${property}`,
          got: throughTheDriver(column, WIRE_DAY),
        }))
        .filter(({ got }) => got !== WIRE_DAY),
    );
    expect(wrong).toEqual([]);
  });

  test('and at UTC-11, which is the direction that was always silently right', () => {
    const wrong = at('Pacific/Midway', () =>
      columns
        .map(({ key, property, column }) => ({
          where: `${key}.${property}`,
          got: throughTheDriver(column, WIRE_DAY),
        }))
        .filter(({ got }) => got !== WIRE_DAY),
    );
    expect(wrong).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// 3. THE MECHANISM, SO THE REPAIR IS NOT A CARGO CULT
// -----------------------------------------------------------------------------

describe('the parser is what keeps a `Date` from ever being built', () => {
  test('the registered parser returns the wire text and not a `Date`', () => {
    const parsed = pg.types.getTypeParser(DATE_OID, 'text')(WIRE_DAY);
    expect(typeof parsed).toBe('string');
    expect(parsed).toBe(WIRE_DAY);
    expect(parsed instanceof Date).toBe(false);
  });

  // THE REGISTRY ENTRY IS MERIT'S OWN FUNCTION, not something that happens to
  // agree with it on the values this file tries. A parser installed by anything
  // else -- a dependency, a second call, a future `types` option -- would still
  // satisfy every value assertion above and fail here.
  test('the installed parser IS `dateWireText`, by identity', () => {
    expect(pg.types.getTypeParser(DATE_OID, 'text')).toBe(dateWireText);
  });

  test("drizzle's mapper passes a string through untouched, which is the branch this buys", () => {
    expect(DAY_COLUMN().mapFromDriverValue(WIRE_DAY)).toBe(WIRE_DAY);
  });

  // WHAT WOULD STILL HAPPEN IF A `Date` GOT IN, kept as the reason the parser is
  // load-bearing rather than decorative. This is drizzle's own coercion, and it
  // is unchanged: the repair removes its INPUT, not the code.
  test('a `Date` still renders as a UTC day, which is why one must never reach it', () => {
    const localMidnightAtPlusTwo = new Date('2026-08-27T22:00:00Z');
    expect(DAY_COLUMN().mapFromDriverValue(localMidnightAtPlusTwo)).toBe('2026-08-27');
  });
});

// -----------------------------------------------------------------------------
// 4. THE TIMESTAMP OIDs ARE NOT TOUCHED, WHICH IS A SEPARATE PROPERTY
// -----------------------------------------------------------------------------
// An instant HAS a timezone and Merit stores it in UTC on purpose. Installing an
// identity parser on 1114 or 1184 would hand every `timestamptz` to consumers as
// raw PostgreSQL text instead of a `Date`, which is a far larger and quieter
// change than the one this entry makes.

describe('a timestamp keeps its coercion, because an instant is not a day', () => {
  test.each(Object.entries(TIMESTAMP_OIDS))(
    '%s (OID %d) still parses to a `Date`',
    (_name, oid) => {
      const parsed = pg.types.getTypeParser(oid, 'text')('2026-08-28 20:00:00+00');
      expect(parsed).toBeInstanceOf(Date);
    },
  );

  test('client.ts names 1082 and names neither timestamp OID as a parser subject', () => {
    expect(CLIENT_SRC).toContain('setTypeParser');
    expect(CLIENT_SRC).toContain('1082');
    expect(CLIENT_SRC).not.toContain('setTypeParser(1114');
    expect(CLIENT_SRC).not.toContain('setTypeParser(1184');
  });
});

// -----------------------------------------------------------------------------
// 5. WHAT THE PARSER DOES WITH WHAT IS NOT A DAY, WHICH IS: NOTHING
// -----------------------------------------------------------------------------
// THE PARSER REFUSES NOTHING AND THAT IS DELIBERATE. A throw here would be a
// driver-level failure naming no column, no table and no rule, which is the
// exact complaint `last-closed-trading-day-door.test.ts` records against the
// coercion it replaced. The parser's whole job is to stop INVENTING a value; the
// doors' own `YYYY-MM-DD` guards are what refuse one, by name.
//
// IT IS ALSO STRICTLY BETTER THAN WHAT IT REPLACED ON EVERY ONE OF THESE.
// `parseDate` turned `infinity` into the NUMBER `Infinity`, which then died in
// drizzle's mapper as "value.toISOString is not a function"; it turned an
// unrecognised DateStyle into `null`, which died the same way. Both now arrive
// as the text PostgreSQL sent, and meet a guard that can say which column.

describe('a value that is not a day arrives as itself, for a door to refuse by name', () => {
  test.each([
    ['infinity, which parseDate turned into the number Infinity', 'infinity'],
    ['-infinity, the same', '-infinity'],
    ['a BC day, which no Merit column has and which no longer silently shifts', '2026-08-28 BC'],
    ['a non-ISO DateStyle, which parseDate turned into null', '08/28/2026'],
  ])('%s', (_why, wire) => {
    expect(pg.types.getTypeParser(DATE_OID, 'text')(wire)).toBe(wire);
  });
});
