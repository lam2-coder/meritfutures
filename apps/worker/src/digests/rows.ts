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
// **IT NOW IMPORTS NOTHING AT ALL, AND THAT IS ADR-426's DELETION SHOWING
// THROUGH.** It used to import `DigestRow` from `ports.ts`, which was
// `Readonly<Record<string, unknown>>`: the accessor's `unknown` written down a
// second time so that a cast could get back out of it. `SystemTx.rowsWhere` now
// hands back the row `schema.ts` declares, so every reader below takes the row
// it was given and the compiler checks the COLUMN NAME against the schema.
//
// **WHAT DID NOT MOVE IS EVERY REFUSAL.** `ADR-299` section 5.1 item 5: a type derived from a
// TRANSCRIPTION does not retire a runtime check. So the type buys the guard for a column's
// EXISTENCE and buys nothing about its VALUE, and not one `throw` below was deleted with the
// mapping. The evidence this header gave for that ruling was not evidence. It read "ADR-112
// foreclosure 4 records that nothing in this tree compares a `schema.ts` column type against the
// DDL." `RI-14` (ADR-441): IS FALSE, and was false when written, and misattributed besides.
// `scoped-db.test.ts:2728` compares TYPE and NULLABILITY for every column of every registered
// non-view relation; ADR-112 foreclosure 4 is about ADDRESSABILITY and EXHAUSTIVENESS and says
// nothing of the kind. THE RULING SURVIVES ON A NARROWER FOOTING, which is why not one refusal
// came off with the sentence: what is compared is the folded MIGRATION TEXT and not the database,
// so a transcription and a second transcription agreeing settles nothing about the rows the
// driver hands back, and DEFAULT is compared nowhere because `TYPE_ENDS_AT` at
// `scoped-db.test.ts:2520` cuts it off the DDL text before the comparison.
// =============================================================================

/** Raised when a row crossing a port is not the shape the column declares. */
export class DigestRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DigestRowError';
  }
}

/**
 * A `uuid` or `text` column.
 *
 * A refusal rather than `String(value)`. See this file's header: the coercion
 * produces a plausible identifier for a row nobody can find again.
 */
export function readText<R extends object>(row: R, key: keyof R & string, where: string): string {
  const value: unknown = row[key];
  if (typeof value !== 'string')
    throw new DigestRowError(`${where}.${key}: expected text and received ${typeof value}`);
  return value;
}

/** A nullable `text` column. */
export function readNullableText<R extends object>(
  row: R,
  key: keyof R & string,
  where: string,
): string | null {
  const value: unknown = row[key];
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
export function readInstant<R extends object>(row: R, key: keyof R & string, where: string): Date {
  const value: unknown = row[key];
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
export function readBoolean<R extends object>(
  row: R,
  key: keyof R & string,
  where: string,
): boolean {
  const value: unknown = row[key];
  if (typeof value !== 'boolean')
    throw new DigestRowError(
      `${where}.${key}: expected a boolean and received ${typeof value}. \`enabled\` decides ` +
        "whether a schedule is the alarm's subject at all, so a truthy string would enrol every " +
        'row this read returns',
    );
  return value;
}

/** An `integer NOT NULL` column, as a safe integer. */
export function readInteger<R extends object>(
  row: R,
  key: keyof R & string,
  where: string,
): number {
  const value: unknown = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new DigestRowError(
      `${where}.${key}: expected a safe integer and received ${JSON.stringify(value)}`,
    );
  return value;
}

/** A `text[] NOT NULL` column. */
export function readTextArray<R extends object>(
  row: R,
  key: keyof R & string,
  where: string,
): readonly string[] {
  const value: unknown = row[key];
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
