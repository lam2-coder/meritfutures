// =============================================================================
// apps/api/test/payout-velocity.test.ts
// =============================================================================
// `evaluatePayoutVelocity`, AND THE ACCEPTANCE PROPERTY IS NOT THAT IT COMPILES.
//
// `ADR-201` exists because two of the three readings `avg_30d_cents` admits are
// NOT CONTROLS: one can never fire on any input, and the other fires every day
// forever. `INFRA:160` attaches a PAGE to this number. So the property this file
// asserts is that the control DISCRIMINATES -- silent in steady state, loud on a
// genuine excursion -- and a suite that only ever showed the alarm firing would
// pass against a module that alarms on everything.
//
// **THE TWO REFUTED READINGS ARE COMPUTED ON THE SAME ROWS AND ASSERTED.** The
// entry's proof is arithmetic; this file makes it a measurement. Over one steady
// state fixture: ruling 2's reading gives `10000 bp` and is silent, the daily
// mean gives `70000 bp` and pages, and the 30-day total gives `2333 bp` and
// could not reach `25000` on any history at all.
//
// **EVERY NUMBER IN THIS FILE'S FIXTURES WAS ALSO RUN AGAINST A LIVE
// POSTGRESQL** with all 59 migrations applied, through `systemDb('operator-console')`
// and the real keyed accessor, over rows in `payout_transfers`,
// `trading_calendar` and `trading_calendar_loads`. The calendar fixture below is
// the same 50 weekdays and the same two holidays that run used, so the anchor,
// the boundary day and the thirty window days are identical in both, and the
// figures a case asserts here are figures a database produced.
//
// THE DOUBLE HAS `rows` AND NOTHING ELSE, which is `PayoutVelocityTx` and is the
// point of that interface: `ADR-201` ruling 7 refuses this control a column of
// any kind, so a double carrying `insert` would let this suite pass over a write
// the module must not be able to make.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TABLE_KEYS } from '@merit/db';

import {
  evaluatePayoutVelocity,
  PAYOUT_VELOCITY_POLICY,
  PAYOUT_VELOCITY_TABLES,
} from '../src/admin-source/payout-velocity.ts';
import { AdminReadError } from '../src/routes/admin-reads.ts';
import type {
  PayoutVelocityTable,
  PayoutVelocityTx,
  PayoutVelocityVerdict,
} from '../src/admin-source/payout-velocity.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const MODULE = readFileSync(join(ROOT, 'apps/api/src/admin-source/payout-velocity.ts'), 'utf8');

// -----------------------------------------------------------------------------
// The calendar, which is the live run's calendar
// -----------------------------------------------------------------------------

/**
 * Every weekday from 2026-09-28 to 2026-12-31, which is 69 rows.
 *
 * WRITTEN OUT RATHER THAN GENERATED, because a fixture that computed its own
 * days by date arithmetic would be the very thing `R-02` forbids the module,
 * asserted against itself. The two holidays are Thanksgiving and Christmas, and
 * the weekends are simply absent: a Saturday is not a `trading_calendar` row at
 * all, which is what makes ruling 4's attribution a real question.
 */
const WEEKDAYS: readonly string[] = [
  '2026-09-28',
  '2026-09-29',
  '2026-09-30',
  '2026-10-01',
  '2026-10-02',
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
  '2026-10-08',
  '2026-10-09',
  '2026-10-12',
  '2026-10-13',
  '2026-10-14',
  '2026-10-15',
  '2026-10-16',
  '2026-10-19',
  '2026-10-20',
  '2026-10-21',
  '2026-10-22',
  '2026-10-23',
  '2026-10-26',
  '2026-10-27',
  '2026-10-28',
  '2026-10-29',
  '2026-10-30',
  '2026-11-02',
  '2026-11-03',
  '2026-11-04',
  '2026-11-05',
  '2026-11-06',
  '2026-11-09',
  '2026-11-10',
  '2026-11-11',
  '2026-11-12',
  '2026-11-13',
  '2026-11-16',
  '2026-11-17',
  '2026-11-18',
  '2026-11-19',
  '2026-11-20',
  '2026-11-23',
  '2026-11-24',
  '2026-11-25',
  '2026-11-26',
  '2026-11-27',
  '2026-11-30',
  '2026-12-01',
  '2026-12-02',
  '2026-12-03',
  '2026-12-04',
  '2026-12-07',
  '2026-12-08',
  '2026-12-09',
  '2026-12-10',
  '2026-12-11',
  '2026-12-14',
  '2026-12-15',
  '2026-12-16',
  '2026-12-17',
  '2026-12-18',
  '2026-12-21',
  '2026-12-22',
  '2026-12-23',
  '2026-12-24',
  '2026-12-25',
  '2026-12-28',
  '2026-12-29',
  '2026-12-30',
  '2026-12-31',
];

const HOLIDAYS: readonly string[] = ['2026-11-26', '2026-12-25'];

function session(tradingDay: string): Record<string, unknown> {
  const holiday = HOLIDAYS.includes(tradingDay);
  return {
    tradingDay,
    // Opens 23:00Z the prior evening and closes 22:00Z, which is what makes "the
    // last CLOSED day" a real question rather than a restatement of the date.
    sessionOpenAt: holiday
      ? null
      : new Date(Date.parse(`${tradingDay}T22:00:00.000Z`) - 23 * 60 * 60 * 1000),
    sessionCloseAt: holiday ? null : new Date(`${tradingDay}T22:00:00.000Z`),
    isHalfDay: tradingDay === '2026-11-27',
    isHoliday: holiday,
    halted: tradingDay === '2026-12-01',
    notes: tradingDay === '2026-11-27' ? 'group close 13:00 CT' : null,
  };
}

const CALENDAR = WEEKDAYS.map(session);
const LOADS = [{ coverageStartDay: '2026-09-28', coverageEndDay: '2026-12-31' }];

/** 23:00Z on the 25th: every session closes at 22:00Z, so the anchor is that day. */
const AS_OF = '2026-11-25T23:00:00.000Z';

/** The thirty trading days ending at the anchor, and the boundary day before them. */
const BOUNDARY_DAY = '2026-10-14';
const WINDOW: readonly string[] = WEEKDAYS.slice(13, 43);
const NUMERATOR: readonly string[] = WEEKDAYS.slice(36, 43);

// -----------------------------------------------------------------------------
// The double
// -----------------------------------------------------------------------------

interface Settlement {
  readonly date: string;
  readonly cents: bigint;
  readonly status?: string;
  readonly settledAt?: unknown;
}

function transfer(s: Settlement): Record<string, unknown> {
  return {
    amountCents: s.cents,
    status: s.status ?? 'settled',
    settledAt: 'settledAt' in s ? s.settledAt : new Date(`${s.date}T18:00:00.000Z`),
  };
}

interface Recorded {
  readonly key: PayoutVelocityTable;
}

function handle(
  settlements: readonly Settlement[],
  overrides: { calendar?: readonly unknown[]; loads?: readonly unknown[] } = {},
): { tx: PayoutVelocityTx; calls: Recorded[] } {
  const rows: Partial<Record<PayoutVelocityTable, readonly unknown[]>> = {
    payoutTransfers: settlements.map(transfer),
    tradingCalendar: overrides.calendar ?? CALENDAR,
    tradingCalendarLoads: overrides.loads ?? LOADS,
  };
  const calls: Recorded[] = [];
  const tx: PayoutVelocityTx = {
    rows: async (key) => {
      calls.push({ key });
      return [...(rows[key] ?? [])];
    },
  };
  return { tx, calls };
}

/** Every window day carrying the same amount. The steady state, by construction. */
function steady(cents: bigint): readonly Settlement[] {
  return WINDOW.map((date) => ({ date, cents }));
}

function evaluated(
  verdict: PayoutVelocityVerdict,
): Extract<PayoutVelocityVerdict, { kind: 'evaluated' }> {
  if (verdict.kind !== 'evaluated')
    throw new Error(`expected an evaluated verdict and got ${verdict.kind}: ${verdict.detail}`);
  return verdict;
}

// -----------------------------------------------------------------------------
// ADR-201 ruling 8: one constant, one module, every number cited
// -----------------------------------------------------------------------------

describe('the policy carries every number and the module spells none of them', () => {
  it('states all four, which is exactly what ADR-201 bought', () => {
    // `LOSS_RATIO_POLICY` ships two of five `unstated` and its suite asserts
    // they STAY unstated, "so filling one in is a red suite rather than a quiet
    // commit". The mirror holds here: before ADR-201 every one of these would
    // have had to be `unstated` because there was no document to cite, and a
    // member turning `unstated` now means a citation stopped resolving.
    for (const [name, number] of Object.entries(PAYOUT_VELOCITY_POLICY)) {
      expect(number.state, name).toBe('stated');
      expect(number.value, name).toBeTypeOf('number');
      expect(Number.isSafeInteger(number.value), name).toBe(true);
      expect(number.cite, name).toContain('ADR-201');
      expect(number.quote.length, name).toBeGreaterThan(0);
    }
    // A FIFTH MEMBER IS A NUMBER SOMEBODY INVENTED. ADR-201 rules four and the
    // entry names no other, so a policy that grew one is a window, a threshold
    // or a scale that no document states.
    expect(Object.keys(PAYOUT_VELOCITY_POLICY).sort()).toEqual([
      'basisPointScale',
      'denominatorTradingDays',
      'numeratorTradingDays',
      'thresholdBp',
    ]);
  });

  it('has the 2.5x threshold stated by FOUR documents and every one of them STRICT', () => {
    // FOUR AND NOT THREE, which is the count session 381 re-derived and this
    // case derives again rather than carrying. The fourth is `research/` and is
    // descriptive rather than normative; it is here because its agreement is
    // evidence, the number having survived restatement in a document written
    // for another purpose.
    //
    // STRICTNESS IS THE HALF A COUNT MISSES. Not one of the four says "at or
    // above", so a ratio landing exactly on 25000 does not page, and
    // `alarm` is `>` rather than `>=` because of these four lines and nothing
    // else.
    const strict: readonly (readonly [string, string])[] = [
      ['MERIT_BUILD_MASTER_PROMPT.md', 'payout velocity vs 30-day avg (alarm >2.5'],
      ['docs/plans/M06-admin-ops-console.md', 'alarming above 2.5x (constitution M6)'],
      ['docs/architecture/INFRA.md', 'Over 2.5 times the 30 day average pages'],
      ['research/ADVERSARY_DOSSIER.md', 'trips the payout-velocity alarm (>2.5'],
    ];
    for (const [file, quote] of strict)
      expect(readFileSync(join(ROOT, file), 'utf8'), file).toContain(quote);
    expect(strict).toHaveLength(4);
    expect(PAYOUT_VELOCITY_POLICY.thresholdBp.value).toBe(25000);
  });

  it('spells no window, threshold or scale outside the policy object', () => {
    // RULING 8 IN A MECHANICAL FORM: "the implementing session must not spell
    // `7`, `30` or `25000` at a second site", because two literals at two sites
    // is `B2` again. Comments and refusal messages quote all three and must, so
    // the scan is over the CODE with both stripped, and the policy object itself
    // is removed because it is the one site the ruling appoints.
    const code = MODULE.replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .map((line) => line.replace(/^\s*\/\/.*$/, ''))
      .join('\n')
      // AND THE STRINGS TOO, IN ONE PASS OVER ALL THREE QUOTE CHARACTERS.
      // Every refusal message cites `ADR-201 section 7` and quotes `7/30`, so a
      // scan that read message text would report the citations as second sites
      // and could only be satisfied by removing them. The three forms are
      // stripped by ONE alternation rather than three passes, because a pass
      // that knew only about apostrophes swallowed a whole file from the first
      // double-quoted message onward and reported a `7` that was a citation.
      .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');
    const start = code.indexOf('export const PAYOUT_VELOCITY_POLICY');
    expect(start).toBeGreaterThan(-1);
    const end = code.indexOf('\n};', start);
    expect(end).toBeGreaterThan(start);
    const outside = code.slice(0, start) + code.slice(end);
    for (const literal of ['7', '30', '25000', '10000'])
      expect(new RegExp(String.raw`(?<![\w.])${literal}n?(?![\w.])`).test(outside), literal).toBe(
        false,
      );
  });

  it('does NOT reuse ELIGIBLE_HORIZON_TRADING_DAYS, which is the trap ruling 8 looks like', () => {
    // `liability.ts` already exports a 7. It is `EC-074`'s FORWARD horizon over
    // accounts that will become eligible; this one is `ADR-201`'s TRAILING
    // window over money that has already left. Two independent quantities that
    // happen to be equal today, and a constant shared between them would move
    // this pager's window the day EC-074 moved its forecast, silently and with
    // no ADR. Ruling 7 makes this number movable only by a superseding entry,
    // and binding it to another document's number deletes exactly that.
    const imports = /import \{([\s\S]*?)\} from '\.\/liability\.ts';/.exec(MODULE);
    expect(imports?.[1]).toBeDefined();
    expect(imports?.[1]).not.toContain('ELIGIBLE_HORIZON_TRADING_DAYS');
  });

  it('names three real tables of packages/db and no others', () => {
    for (const key of PAYOUT_VELOCITY_TABLES) expect(TABLE_KEYS).toContain(key);
    expect([...PAYOUT_VELOCITY_TABLES]).toEqual([
      'payoutTransfers',
      'tradingCalendar',
      'tradingCalendarLoads',
    ]);
  });
});

// -----------------------------------------------------------------------------
// The acceptance property: the control DISCRIMINATES
// -----------------------------------------------------------------------------

describe('the control is SILENT in steady state, which is the half a defect would hide', () => {
  it('sits at exactly 10000 bp when every trading day pays the same', async () => {
    const { tx } = handle(steady(100_000n));
    const v = evaluated((await evaluatePayoutVelocity(tx, AS_OF)).verdict);

    expect(v.anchor_day).toBe('2026-11-25');
    expect(v.attribution_boundary_day).toBe(BOUNDARY_DAY);
    expect(v.denominator_from_day).toBe('2026-10-15');
    expect(v.numerator_from_day).toBe('2026-11-17');
    expect(v.total_30_cents).toBe(3_000_000);
    expect(v.panel.last_7d_cents).toBe(700_000);
    expect(v.panel.avg_30d_cents).toBe(700_000);
    expect(v.panel.ratio_bp).toBe(10_000);
    // THE WHOLE CASE. A pager that fires here fires every day forever.
    expect(v.panel.alarm).toBe(false);
  });

  it('measures BOTH refuted readings on the SAME rows, which is ADR-201 section 3 run', async () => {
    const { tx } = handle(steady(100_000n));
    const v = evaluated((await evaluatePayoutVelocity(tx, AS_OF)).verdict);
    const total = BigInt(v.total_30_cents);
    const last7 = BigInt(v.panel.last_7d_cents);

    // READING B, the mean DAILY figure. Steady state sits near 70000 bp, which
    // is 2.8 times the threshold, so the pager fires on day one and every day
    // after and goes quiet only on a roughly 64 percent COLLAPSE in payouts.
    const dailyMean = total / 30n;
    const readingB = (last7 * 10_000n) / dailyMean;
    expect(readingB).toBe(70_000n);
    expect(readingB > 25_000n).toBe(true);

    // READING A, the 30-day TOTAL. The trailing 7 days are a SUBSET of the
    // trailing 30, so this ratio is bounded by 10000 on every possible history
    // and 10000 is never greater than 25000: the alarm cannot fire, ever.
    const readingA = (last7 * 10_000n) / total;
    expect(readingA).toBe(2_333n);
    expect(readingA <= 10_000n).toBe(true);

    // AND THE READING THAT SURVIVED is the one the module computes.
    expect(v.panel.ratio_bp).toBe(10_000);
    expect(v.panel.alarm).toBe(false);
  });

  it('holds reading A refuted on every history this suite can build, not just this one', async () => {
    // The subset proof needs no data, and this is the closest a suite can come
    // to running it: over ten shapes -- flat, ramping, spiking, a single day
    // carrying everything -- `last_7d_cents` never exceeds the 30-day total, so
    // the total-based ratio never exceeds 10000.
    for (let shape = 0; shape < 10; shape += 1) {
      const { tx } = handle(
        WINDOW.map((date, i) => ({ date, cents: BigInt(1 + ((i * (shape + 3)) % 17)) * 1_000n })),
      );
      const v = evaluated((await evaluatePayoutVelocity(tx, AS_OF)).verdict);
      expect(v.panel.last_7d_cents).toBeLessThanOrEqual(v.total_30_cents);
      const readingA = (BigInt(v.panel.last_7d_cents) * 10_000n) / BigInt(v.total_30_cents);
      expect(readingA <= 10_000n, `shape ${String(shape)}`).toBe(true);
    }
  });
});

describe('the control FIRES on a genuine excursion, and exactly where four documents put it', () => {
  it('pages when the trailing week runs five times the baseline', async () => {
    const { tx } = handle(
      WINDOW.map((date, i) => ({ date, cents: i >= 23 ? 500_000n : 100_000n })),
    );
    const v = evaluated((await evaluatePayoutVelocity(tx, AS_OF)).verdict);

    expect(v.total_30_cents).toBe(5_800_000);
    expect(v.panel.last_7d_cents).toBe(3_500_000);
    expect(v.panel.avg_30d_cents).toBe(1_353_333);
    expect(v.panel.ratio_bp).toBe(25_862);
    expect(v.panel.alarm).toBe(true);
  });

  it('is SILENT at exactly 25000 and LOUD at 25001, on the same total', async () => {
    // THE STRICTNESS OF FOUR DOCUMENTS, ISOLATED TO ONE DOLLAR. Both fixtures
    // carry a 30-day total of 4285715 cents, so `avg_30d_cents` is 1000000 in
    // both; the only difference is that 100 cents sit inside the numerator
    // window in the second and outside it in the first.
    const silent = evaluated(
      (
        await evaluatePayoutVelocity(
          handle([
            { date: '2026-10-15', cents: 1_785_715n },
            { date: '2026-11-25', cents: 2_500_000n },
          ]).tx,
          AS_OF,
        )
      ).verdict,
    );
    expect(silent.total_30_cents).toBe(4_285_715);
    expect(silent.panel.avg_30d_cents).toBe(1_000_000);
    expect(silent.panel.ratio_bp).toBe(25_000);
    expect(silent.panel.alarm).toBe(false);

    const loud = evaluated(
      (
        await evaluatePayoutVelocity(
          handle([
            { date: '2026-10-15', cents: 1_785_615n },
            { date: '2026-11-25', cents: 2_500_100n },
          ]).tx,
          AS_OF,
        )
      ).verdict,
    );
    expect(loud.total_30_cents).toBe(4_285_715);
    expect(loud.panel.avg_30d_cents).toBe(1_000_000);
    expect(loud.panel.ratio_bp).toBe(25_001);
    expect(loud.panel.alarm).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Ruling 3 and ruling 4: trading days, and all of the money
// -----------------------------------------------------------------------------

describe('the window is counted in TRADING days and never in calendar days', () => {
  it('spans 42 calendar dates to hold 30 trading days, and the difference is the case', async () => {
    const { tx } = handle(steady(100_000n));
    const v = evaluated((await evaluatePayoutVelocity(tx, AS_OF)).verdict);

    // Thirty TRADING days ending 2026-11-25 reach back to 2026-10-15. Thirty
    // CALENDAR days would reach only to 2026-10-27, which is twelve of these
    // thirty days later: a window over the wrong month, looking exactly right in
    // review. `M01:941`'s "five trading days is 7 calendar days in June and can
    // be 9 to 10 across the year-end cluster", arriving on a ratio.
    expect(v.denominator_from_day).toBe('2026-10-15');
    expect(v.denominator_from_day).not.toBe('2026-10-27');
    expect(Date.parse('2026-11-25') - Date.parse(v.denominator_from_day)).toBe(
      41 * 24 * 60 * 60 * 1000,
    );
    // Seven TRADING days reach back to 2026-11-17; seven calendar days reach
    // 2026-11-19, and the two differ by a weekend.
    expect(v.numerator_from_day).toBe('2026-11-17');
    expect(v.numerator_from_day).not.toBe('2026-11-19');
    expect([...NUMERATOR]).toEqual([
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
    ]);
  });

  it('takes the anchor as the last CLOSED session and includes it in the window', async () => {
    // RULING 3 IS INCLUSIVE AND THE FORWARD HORIZON IS NOT, which is the one
    // place a reader is most likely to assume symmetry. A settlement on the
    // anchor day itself is inside the numerator.
    const { tx } = handle([{ date: '2026-11-25', cents: 900_000n }]);
    const v = evaluated((await evaluatePayoutVelocity(tx, AS_OF)).verdict);
    expect(v.anchor_day).toBe('2026-11-25');
    expect(v.panel.last_7d_cents).toBe(900_000);

    // AND A SESSION STILL OPEN IS NOT THE ANCHOR. At 21:00Z the 25th has not
    // closed, so the anchor is the 24th and the same settlement is in the
    // future.
    const open = evaluated(
      (
        await evaluatePayoutVelocity(
          handle([{ date: '2026-11-25', cents: 900_000n }]).tx,
          '2026-11-25T21:00:00.000Z',
        )
      ).verdict,
    );
    expect(open.anchor_day).toBe('2026-11-24');
    expect(open.panel.last_7d_cents).toBe(0);
  });

  it('attributes a SATURDAY settlement forward to Monday rather than dropping it', async () => {
    // `GLOSSARY:47` is the source that argues hardest against a trading-day
    // window, because a payout SETTLES on the rail's clock and the rail moves
    // money on days the exchange is shut. Ruling 4 is the answer: the calendar
    // is asked only WHICH SNAPSHOT FIRST SEES a settlement, and 2026-11-21 is a
    // Saturday whose first trading day on or after it is Monday the 23rd.
    const { tx } = handle([...steady(100_000n), { date: '2026-11-21', cents: 100_000n }]);
    const result = await evaluatePayoutVelocity(tx, AS_OF);
    const v = evaluated(result.verdict);

    expect(v.total_30_cents).toBe(3_100_000);
    expect(v.panel.last_7d_cents).toBe(800_000);
    expect(result.cost.settlementsAttributedInWindow).toBe(31);
    expect(result.cost.settlementsBeforeWindow).toBe(0);
    expect(result.cost.settlementsAfterAnchor).toBe(0);
  });

  it('attributes FORWARD and not backward, which the totals alone cannot tell apart', async () => {
    // **THIS CASE EXISTS BECAUSE A SEEDED DEFECT DID NOT FIRE WITHOUT IT.**
    // Rewriting attribution to take the LAST trading day on or BEFORE a
    // settlement -- the exact opposite of ruling 4 -- left this suite green,
    // because in every other fixture both directions land inside the same
    // window and the TOTALS are identical. A case that asserts a sum is
    // asserting that SOMETHING attributed the row, never that ruling 4 did.
    //
    // The discriminating fixture puts a weekend settlement across the NUMERATOR
    // boundary. Anchored at 2026-11-24 the seven-day window opens on Monday
    // 2026-11-16, so a Saturday 2026-11-14 settlement attributes FORWARD to the
    // 16th and is inside the numerator, while the backward reading would put it
    // on Friday the 13th, inside the thirty and outside the seven. The 30-day
    // total is the same number either way and `last_7d_cents` is not.
    const asOf = '2026-11-24T23:00:00.000Z';
    const window = WEEKDAYS.slice(12, 42);
    const { tx } = handle([
      ...window.map((date) => ({ date, cents: 100_000n })),
      { date: '2026-11-14', cents: 210_000n },
    ]);
    const v = evaluated((await evaluatePayoutVelocity(tx, asOf)).verdict);

    expect(v.anchor_day).toBe('2026-11-24');
    expect(v.numerator_from_day).toBe('2026-11-16');
    expect(v.total_30_cents).toBe(3_210_000);
    // FORWARD. The backward reading gives 700000 here and the same total.
    expect(v.panel.last_7d_cents).toBe(910_000);
    expect(v.panel.last_7d_cents).not.toBe(700_000);
    expect(v.panel.avg_30d_cents).toBe(749_000);
    expect(v.panel.ratio_bp).toBe(12_149);
  });

  it('attributes an EXCHANGE HOLIDAY settlement forward, and 2026-11-26 is one', async () => {
    // Thanksgiving is a `trading_calendar` row with `is_holiday` true and no
    // session, and the rail settles on it. Anchored at 2026-11-27 the settlement
    // lands on the 27th, which is a HALF DAY and a full trading day (`0004`
    // B4 #3).
    const { tx } = handle([{ date: '2026-11-26', cents: 400_000n }]);
    const v = evaluated((await evaluatePayoutVelocity(tx, '2026-11-27T23:00:00.000Z')).verdict);
    expect(v.anchor_day).toBe('2026-11-27');
    expect(v.panel.last_7d_cents).toBe(400_000);
  });

  it('leaves a HOLIDAY out of the thirty days while still counting its money', async () => {
    // 2026-12-25 is an exchange holiday sitting INSIDE the thirty trading days
    // ending 2026-12-31, which the November anchor's window does not contain.
    // The day is not one of the thirty and the money settled on it is still
    // counted, on the next session: ruling 3 and ruling 4 pulling in opposite
    // directions and both being satisfied.
    const asOf = '2026-12-31T23:00:00.000Z';
    const { tx } = handle([{ date: '2026-12-25', cents: 640_000n }]);
    const v = evaluated((await evaluatePayoutVelocity(tx, asOf)).verdict);

    expect(v.anchor_day).toBe('2026-12-31');
    // Thirty trading days back from 2026-12-31 reach 2026-11-18. Thirty
    // CALENDAR days reach 2026-12-01, which is nine of these thirty days later.
    expect(v.denominator_from_day).toBe('2026-11-18');
    expect(v.numerator_from_day).toBe('2026-12-22');
    // Neither holiday is a day of the window, and both sit inside the calendar
    // dates it spans.
    expect(v.denominator_from_day < '2026-12-25').toBe(true);
    // The money settled on Christmas is attributed to 2026-12-28, which is
    // inside the numerator window, so nothing is dropped for landing on a day
    // the exchange was shut.
    expect(v.total_30_cents).toBe(640_000);
    expect(v.panel.last_7d_cents).toBe(640_000);
  });

  it('drops NO settlement and counts none twice, which is ruling 4 as arithmetic', async () => {
    const settlements: readonly Settlement[] = [
      ...steady(100_000n),
      { date: '2026-09-29', cents: 50_000n },
      { date: '2026-10-14', cents: 50_000n },
      { date: '2026-11-21', cents: 50_000n },
      { date: '2026-11-30', cents: 50_000n },
      { date: '2026-12-03', cents: 50_000n },
    ];
    const { cost } = await evaluatePayoutVelocity(handle(settlements).tx, AS_OF);
    expect(cost.settledTransfersRead).toBe(settlements.length);
    expect(
      cost.settlementsAttributedInWindow +
        cost.settlementsBeforeWindow +
        cost.settlementsAfterAnchor,
    ).toBe(cost.settledTransfersRead);
    expect(cost.settlementsBeforeWindow).toBe(2);
    expect(cost.settlementsAfterAnchor).toBe(2);
  });

  it('keeps a settlement ON the boundary day OUT, which is why the 31st day is read', async () => {
    // Without the boundary day every settlement in recorded history attributes
    // to the window's oldest day, because "the first trading day on or after" a
    // date in 2019 is, for a walk that can only see thirty days, the first day
    // it can see. The boundary is a READ FACT and this case is what proves it
    // is being used.
    const huge = 900_000_000n;
    const { tx } = handle([...steady(100_000n), { date: BOUNDARY_DAY, cents: huge }]);
    const result = await evaluatePayoutVelocity(tx, AS_OF);
    const v = evaluated(result.verdict);
    expect(v.attribution_boundary_day).toBe(BOUNDARY_DAY);
    expect(v.total_30_cents).toBe(3_000_000);
    expect(result.cost.settlementsBeforeWindow).toBe(1);

    // AND A SETTLEMENT ONE TRADING DAY LATER IS IN, on the same fixture.
    const inside = await evaluatePayoutVelocity(
      handle([...steady(100_000n), { date: '2026-10-15', cents: huge }]).tx,
      AS_OF,
    );
    expect(evaluated(inside.verdict).total_30_cents).toBe(3_000_000 + Number(huge));
  });
});

// -----------------------------------------------------------------------------
// Coverage: ADR-042 F-4, in both directions
// -----------------------------------------------------------------------------

describe('an exhausted or uncovered calendar produces an ANSWER and never a quiet run of days', () => {
  it('says `exhausted` and how short it is, rather than scaling from twelve days', async () => {
    // A denominator scaled from fewer days than it claims is SMALLER than the
    // one four documents describe, and a smaller denominator is a larger ratio
    // against a threshold that pages. At launch this is the ordinary case.
    const { tx } = handle(steady(100_000n), {
      loads: [{ coverageStartDay: '2026-11-02', coverageEndDay: '2026-12-31' }],
    });
    const { verdict, cost } = await evaluatePayoutVelocity(tx, AS_OF);

    expect(verdict.kind).toBe('exhausted');
    if (verdict.kind !== 'exhausted') throw new Error('unreachable');
    expect(verdict.anchor_day).toBe('2026-11-25');
    expect(verdict.trading_days_found).toBe(18);
    expect(verdict.short_by).toBe(13);
    expect(verdict.detail).toContain('ADR-042 F-4');
    expect(verdict.detail).toContain('ADR-201 section 7');
    // AND THE UNBOUNDED SCAN IS NOT PAID for a verdict that discards it.
    expect(cost.transferRowsScanned).toBe(0);
  });

  it('says `uncovered` when the calendar has rows and no load declares coverage', async () => {
    const { tx, calls } = handle(steady(100_000n), { loads: [] });
    const { verdict, cost } = await evaluatePayoutVelocity(tx, AS_OF);

    expect(verdict.kind).toBe('uncovered');
    if (verdict.kind !== 'uncovered') throw new Error('unreachable');
    expect(verdict.anchor_day).toBeNull();
    expect(verdict.detail).toContain('ADR-042 F-4');
    expect(cost.calendarRowsScanned).toBe(CALENDAR.length);
    expect(cost.transferRowsScanned).toBe(0);
    expect(calls.map((c) => c.key)).not.toContain('payoutTransfers');
  });

  it('says `uncovered` and names the intervals when coverage stops before the anchor', async () => {
    const { tx } = handle(steady(100_000n), {
      loads: [{ coverageStartDay: '2026-09-28', coverageEndDay: '2026-09-30' }],
    });
    const { verdict } = await evaluatePayoutVelocity(tx, AS_OF);
    expect(verdict.kind).toBe('uncovered');
    if (verdict.kind !== 'uncovered') throw new Error('unreachable');
    expect(verdict.anchor_day).toBe('2026-11-25');
    expect(verdict.detail).toContain('2026-09-28..2026-09-30');
    expect(verdict.detail).toContain('UNKNOWN and never a holiday');
  });
});

// -----------------------------------------------------------------------------
// Ruling 6, and the money guards
// -----------------------------------------------------------------------------

describe('ruling 6 answers an empty denominator, and the arm is reachable two ways', () => {
  it('gives 0 and false when nothing settled inside the window', async () => {
    // A velocity alarm is a RELATIVE control and a firm with no payout history
    // has nothing to be relative to. `P-M6-01` and `P-M6-02` watch the absolute
    // exposure on the same page and read no ratio at all.
    const { tx } = handle([{ date: '2026-09-29', cents: 100_000n }]);
    const v = evaluated((await evaluatePayoutVelocity(tx, AS_OF)).verdict);
    expect(v.total_30_cents).toBe(0);
    expect(v.panel.avg_30d_cents).toBe(0);
    expect(v.panel.ratio_bp).toBe(0);
    expect(v.panel.alarm).toBe(false);
  });

  it('gives 0 and false when the total is UNDER FIVE CENTS, which section 7 does not contemplate', async () => {
    // A REPORTED FINDING RATHER THAN A RULING TAKEN. Ruling 6 is written on the
    // VALUE ("when `avg_30d_cents` is 0") and section 7's reasoning is about
    // "no payout settled in the trailing 30 trading days". The two differ for a
    // 30-day total under five cents, where `floor(total * 7 / 30)` is 0 with a
    // NON-ZERO numerator. The transcription follows the ruling's own words; the
    // outcome -- no page over four cents of payouts -- is obviously right, and
    // it is pinned here so a later reader finds it rather than discovers it.
    const { tx } = handle([{ date: '2026-11-25', cents: 4n }]);
    const v = evaluated((await evaluatePayoutVelocity(tx, AS_OF)).verdict);
    expect(v.total_30_cents).toBe(4);
    expect(v.panel.last_7d_cents).toBe(4);
    expect(v.panel.avg_30d_cents).toBe(0);
    expect(v.panel.ratio_bp).toBe(0);
    expect(v.panel.alarm).toBe(false);
  });
});

describe('the money is integer cents and no float reaches the ratio', () => {
  it('divides exactly where a double would be one cent wrong', async () => {
    // `0010` declares `amount_cents bigint NOT NULL` and the scaling forms
    // `total * 7` BEFORE dividing (ruling 5's own ordering), so the magnitude
    // the arithmetic reaches is not the magnitude the column holds. At this
    // total, `Math.floor(total * 7 / 30)` in IEEE doubles is ONE CENT HIGHER
    // than the exact answer, and one cent on the denominator moves the ratio
    // toward or away from a pager.
    const total = 9_007_199_246_740_967n;
    const { tx } = handle([{ date: '2026-11-25', cents: total }]);
    const v = evaluated((await evaluatePayoutVelocity(tx, AS_OF)).verdict);

    const exact = Number((total * 7n) / 30n);
    const asDouble = Math.floor((Number(total) * 7) / 30);
    expect(asDouble).not.toBe(exact);
    expect(asDouble).toBe(exact + 1);
    expect(v.panel.avg_30d_cents).toBe(exact);
    expect(v.panel.ratio_bp).toBe(Number((total * 10_000n) / ((total * 7n) / 30n)));
  });

  it('refuses an amount the CHECK in 0010 forbids', async () => {
    for (const cents of [0n, -1n])
      await expect(
        evaluatePayoutVelocity(handle([{ date: '2026-11-25', cents }]).tx, AS_OF),
      ).rejects.toThrow(AdminReadError);
  });

  it('refuses an amount that is not a whole number of cents', async () => {
    const { tx } = handle([]);
    void tx;
    for (const amountCents of [1.5, '12.50', null, undefined, {}]) {
      const rows = {
        payoutTransfers: [
          { amountCents, status: 'settled', settledAt: new Date('2026-11-25T18:00:00.000Z') },
        ],
        tradingCalendar: CALENDAR,
        tradingCalendarLoads: LOADS,
      } as const;
      const fake: PayoutVelocityTx = {
        rows: async (key) => [...((rows as Record<string, readonly unknown[]>)[key] ?? [])],
      };
      await expect(evaluatePayoutVelocity(fake, AS_OF)).rejects.toThrow(AdminReadError);
    }
  });
});

describe('the ONE-DIRECTIONAL CHECK in 0010 decides which rows are money that left', () => {
  it('does not count a FAILED transfer that carries a settled_at, and reports it', async () => {
    // `payout_transfers_settled_has_timestamp` is
    // `CHECK (status <> 'settled' OR settled_at IS NOT NULL)`. It forbids a
    // settled row with no instant and PERMITS a failed or retrying row that
    // carries one, so selecting on `settled_at IS NOT NULL` would count money
    // the rail did not move and OVERSTATE the numerator of a pager. Selecting
    // on `status` is safe in the other direction because the CHECK guarantees
    // the instant is there.
    const { tx } = handle([
      ...steady(100_000n),
      { date: '2026-11-25', cents: 90_000_000n, status: 'failed' },
      { date: '2026-11-24', cents: 90_000_000n, status: 'retrying' },
    ]);
    const result = await evaluatePayoutVelocity(tx, AS_OF);
    const v = evaluated(result.verdict);

    expect(v.total_30_cents).toBe(3_000_000);
    expect(v.panel.alarm).toBe(false);
    expect(result.cost.transferRowsScanned).toBe(32);
    expect(result.cost.settledTransfersRead).toBe(30);
    expect(result.cost.settledInstantsOnUnsettledRows).toBe(2);
  });

  it('refuses a `settled` row with no settled_at, which the CHECK forbids outright', async () => {
    await expect(
      evaluatePayoutVelocity(
        handle([{ date: '2026-11-25', cents: 100n, settledAt: null }]).tx,
        AS_OF,
      ),
    ).rejects.toThrow(AdminReadError);
  });

  it('ignores a queued transfer with no settlement instant at all', async () => {
    const { tx } = handle([
      ...steady(100_000n),
      { date: '2026-11-25', cents: 90_000_000n, status: 'queued', settledAt: null },
    ]);
    const result = await evaluatePayoutVelocity(tx, AS_OF);
    expect(evaluated(result.verdict).total_30_cents).toBe(3_000_000);
    expect(result.cost.settledInstantsOnUnsettledRows).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// What this module does NOT do
// -----------------------------------------------------------------------------

describe('the evaluator is not composed and the four leaves are still blocked', () => {
  it('leaves `payout_velocity` off the liability book, and the reason is the wire shape', async () => {
    // NOT BECAUSE THE NUMBERS ARE UNAVAILABLE -- every case above produces them
    // -- but because this evaluator answers THREE ways and `LiabilityResponse`
    // carries ONE. `ratio_bp` is a non-nullable number and `alarm` a
    // non-nullable boolean, so an `uncovered` calendar would have to be rendered
    // `0 / false`, which is indistinguishable from a quiet week. That is
    // ADR-201 finding 3's gap arriving with a pager attached, and composing
    // against a source that cannot fully serve the shape turns an honest 500
    // into a wrong answer.
    //
    // CLEARING CONDITION: the wire gains a shape for "there is no window", which
    // is a change to a response `RI-18` binds in three copies and is another
    // entry's.
    const contract = readFileSync(join(ROOT, 'docs/architecture/API_CONTRACT.md'), 'utf8');
    expect(contract).toContain(
      'payout_velocity: { last_7d_cents: number; avg_30d_cents: number; ratio_bp: number; alarm: boolean }',
    );
    const liability = readFileSync(join(ROOT, 'apps/api/src/admin-source/liability.ts'), 'utf8');
    expect(liability).toContain(
      "'eligible_next_7d' | 'payout_velocity' | 'per_plan' | 'integrations'",
    );
  });

  it('holds no write verb, because ruling 7 refuses this control a column', async () => {
    // A COLUMN IS REFUSED, on `0049`'s own reason for storing no
    // `breaker_armed`: "storing it would recreate in one column exactly the
    // drift item 1 removes from another". A config value an operator sets is
    // refused louder, on `INV-M6-13`'s "an 'extend' button is the one
    // control-shaped affordance that would delete the control".
    const { tx } = handle(steady(100_000n));
    expect(Object.keys(tx)).toEqual(['rows']);
    for (const verb of ['insert', 'updateAt', 'deleteAt', 'sqlExecutor', 'rowsWhere', 'rowAt'])
      expect(MODULE).not.toContain(`tx.${verb}(`);
  });
});
