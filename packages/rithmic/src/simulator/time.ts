// =============================================================================
// packages/rithmic/src/simulator/time.ts
// =============================================================================
// INSTANT ARITHMETIC WITHOUT `Date`, AND THE REASON IS NOT PURITY THEATRE.
//
// `new Date('2026-11-02T14:31:00Z')` returns an Invalid Date for a malformed
// string rather than throwing, and every arithmetic on it then produces `NaN`,
// which formats as the string "NaN" and lands in a CSV column that a parser
// reads as a value. The simulator's whole claim is that its output is a
// FUNCTION OF ITS SEED, so a silent NaN is the one failure it cannot afford:
// it is deterministic, it is byte-identical run to run, and it is wrong.
//
// So parsing is a strict regex plus a round-trip check (2026-02-30 parses under
// `Date` and lands on March 2nd; here it is rejected), and formatting is
// integer arithmetic. The civil-date conversions are Howard Hinnant's
// `days_from_civil` and `civil_from_days`, which are exact over the proleptic
// Gregorian calendar and use no floating point.
//
// WHAT THIS FILE IS NOT. It is not a trading calendar and it does not know what
// a session is. Session boundaries are CALLER-SUPPLIED (`SimSession`), for the
// reason P2 section 6 states plainly: there is not one calendar row in this
// repository, the CME publication has not been transcribed, and writing
// session boundaries from recollection is what TR-01 forbids.
// =============================================================================

/** Thrown on any input this module cannot read exactly. Never returns NaN. */
export class InstantFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstantFormatError';
  }
}

const TRADING_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

const SECONDS_PER_DAY = 86_400;

/**
 * Days since 1970-01-01 for a proleptic Gregorian civil date. Exact integer
 * arithmetic; the shifted-era formulation is Hinnant's.
 */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400; // [0, 399]
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

/** The inverse. Together they are what makes the round-trip validity check exact. */
export function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365); // prettier-ignore
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const m = mp + (mp < 10 ? 3 : -9); // [1, 12]
  return { year: y + (m <= 2 ? 1 : 0), month: m, day: d };
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/**
 * `yyyy-mm-dd`, validated by round trip rather than by a range check on the
 * month and the day. A range check accepts the 30th of February.
 */
export function parseTradingDay(tradingDay: string): number {
  const match = TRADING_DAY_PATTERN.exec(tradingDay);
  if (match === null) {
    throw new InstantFormatError(`trading day ${JSON.stringify(tradingDay)} is not yyyy-mm-dd`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const days = daysFromCivil(year, month, day);
  const back = civilFromDays(days);
  if (back.year !== year || back.month !== month || back.day !== day) {
    throw new InstantFormatError(`trading day ${tradingDay} is not a real date`);
  }
  return days;
}

/** `yyyymmdd`, which is what every file name in this package is built from. */
export function compactTradingDay(tradingDay: string): string {
  parseTradingDay(tradingDay);
  return tradingDay.replaceAll('-', '');
}

/** `yyyy-mm-ddThh:mm:ssZ` to epoch seconds. Strict, and it never returns NaN. */
export function parseInstantUtc(instant: string): number {
  const match = INSTANT_PATTERN.exec(instant);
  if (match === null) {
    throw new InstantFormatError(
      `instant ${JSON.stringify(instant)} is not yyyy-mm-ddThh:mm:ssZ. ` +
        'The format is deliberately narrow: a simulator that accepts a shape it ' +
        'cannot render back cannot claim byte-identical output',
    );
  }
  const days = parseTradingDay(`${match[1]}-${match[2]}-${match[3]}`);
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  const seconds = Number(match[6]);
  if (hours > 23 || minutes > 59 || seconds > 59) {
    throw new InstantFormatError(`instant ${instant} has an out-of-range time component`);
  }
  return days * SECONDS_PER_DAY + hours * 3600 + minutes * 60 + seconds;
}

/** Epoch seconds back to `yyyy-mm-ddThh:mm:ssZ`. The exact inverse of the above. */
export function formatInstantUtc(epochSeconds: number): string {
  if (!Number.isSafeInteger(epochSeconds)) {
    throw new InstantFormatError(`epoch seconds ${epochSeconds} is not a safe integer`);
  }
  const days = Math.floor(epochSeconds / SECONDS_PER_DAY);
  const rest = epochSeconds - days * SECONDS_PER_DAY;
  const { year, month, day } = civilFromDays(days);
  const hours = Math.floor(rest / 3600);
  const minutes = Math.floor((rest - hours * 3600) / 60);
  const seconds = rest - hours * 3600 - minutes * 60;
  return (
    `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` +
    `T${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}Z`
  );
}
