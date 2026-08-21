// =============================================================================
// packages/db/test/trading-calendar-generator.test.ts
// =============================================================================
// EVERY GENERATOR RULE, WATCHED FAILING ON ITS OWN SEEDED VIOLATION, and each
// one asserted on its FINDING rather than on the fact that something threw
// (P1 section 6). A rule that rejects for the wrong reason and a rule that
// accepts for the wrong reason are the same defect, and `falsify.mjs`'s
// standing lesson is that a check which cannot fail is not a check.
//
// THE FIXTURES HERE ARE SYNTHETIC AND ARE NOT A TRANSCRIPTION OF ANYTHING. No
// date, holiday name or close time below is a claim about what CME publishes.
// The shapes are chosen to exercise the generator (a holiday followed by an
// early close is the hardest ordering to get right, and a winter session and a
// summer session are an hour apart in UTC while looking identical in CT); the
// real values arrive in the source file, from the publication, under the
// procedure in `src/seed/calendars/README.md`.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  build,
  CalendarSourceError,
  checkDstTransitions,
  checkRows,
  diffTranscriptions,
  findDstTransitions,
  readSource,
} from '../src/seed/calendars/generate.mjs';

const GENERATOR = fileURLToPath(new URL('../src/seed/calendars/generate.mjs', import.meta.url));
const SOURCE_FILE = fileURLToPath(
  new URL('../src/seed/calendars/cme-2026-2028.source.json', import.meta.url),
);

const PROVENANCE = {
  source_url: 'https://example.invalid/synthetic-holiday-calendar',
  retrieved_at: '2026-08-16',
  retrieved_by: 'synthetic fixture, not a retrieval',
  artifact: 'synthetic.html',
  artifact_sha256: 'a'.repeat(64),
};

const RULE = {
  timezone: 'America/Chicago',
  open_ct: '17:00',
  open_day_offset: -1,
  close_ct: '16:00',
};

/**
 * ADR-055's absorbed session, on the synthetic holiday.
 *
 * The holiday is Thursday and the next trade date is Friday, whose session
 * opened Wednesday evening, before the closure. That is the shape the ruling
 * exists for, and the close is 12:15 rather than 16:00 because the Friday is
 * also the early close: the hardest of the four combinations to get right, and
 * the one where a check that reached for `session_rule.close_ct` instead of the
 * `early_closes` entry would pass on everything else and be wrong here.
 */
const ABSORBED = {
  trading_day: '2026-11-27',
  session_open_day: '2026-11-25',
  session_open_ct: '17:00',
  session_close_day: '2026-11-27',
  session_close_ct: '12:15',
};

/**
 * Monday 2026-11-23 to Monday 2026-11-30, holding one holiday (Thursday), one
 * early close (Friday), and a weekend the generator must skip.
 *
 * `coverage.evidence_to` and the holiday's `absorbs_into` are ADR-055's, and
 * they are in the BASE fixture rather than in an override because the ruling
 * made them required: a base that omitted them would make every case below
 * fail on the missing key rather than on its own seeded violation, which is the
 * failure mode this file exists to prevent one level up.
 */
function source(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'synthetic',
    status: 'transcribed',
    provenance: PROVENANCE,
    coverage: { from: '2026-11-23', to: '2026-11-30', evidence_to: '2026-11-30' },
    session_rule: RULE,
    holidays: [{ day: '2026-11-26', name: 'Synthetic Closure', absorbs_into: ABSORBED }],
    early_closes: [
      {
        day: '2026-11-27',
        close_ct: '12:15',
        notes: 'synthetic per-group closes: group A 12:00 CT, group B 12:15 CT',
      },
    ],
    ...over,
  });
}

/** The base fixture's holiday with one field of its `absorbs_into` changed. */
function absorbing(over: Record<string, unknown>): Record<string, unknown> {
  return {
    holidays: [
      { day: '2026-11-26', name: 'Synthetic Closure', absorbs_into: { ...ABSORBED, ...over } },
    ],
  };
}

/** The finding, not the message. */
function findingOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof CalendarSourceError) return e.finding;
    throw e;
  }
  throw new Error(
    'expected a CalendarSourceError and the call succeeded, which is the seeded violation passing',
  );
}

describe('the positive control', () => {
  // A generator that refuses everything passes every seeded violation below and
  // gates nothing. This is the case that has to pass, and it comes first for
  // the same reason `falsify.mjs` states.
  const generated = build(source(), { sourceFile: 'synthetic.json' });

  it('emits one row per weekday in coverage and none for the weekend', () => {
    expect(generated.rows.map((r) => r.trading_day)).toEqual([
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-30',
    ]);
  });

  it('makes the holiday a positive fact carrying no session (ADR-042 F-1)', () => {
    const holiday = generated.rows.find((r) => r.trading_day === '2026-11-26');
    expect(holiday).toMatchObject({
      is_holiday: true,
      is_half_day: false,
      session_open_at: null,
      session_close_at: null,
      session_open_ct: null,
      session_close_ct: null,
      notes: 'Synthetic Closure',
    });
  });

  it('brings the early close forward, sets is_half_day and records the per-group times (F-3)', () => {
    const half = generated.rows.find((r) => r.trading_day === '2026-11-27');
    expect(half).toMatchObject({
      is_holiday: false,
      is_half_day: true,
      session_close_ct: '2026-11-27T12:15:00',
      session_close_at: '2026-11-27T18:15:00Z',
    });
    expect(half?.notes).toContain('group B 12:15 CT');
  });

  it('opens each session at 17:00 CT on the PRIOR CALENDAR DAY, so Monday opens on Sunday', () => {
    expect(generated.rows.find((r) => r.trading_day === '2026-11-23')).toMatchObject({
      session_open_ct: '2026-11-22T17:00:00',
      session_open_at: '2026-11-22T23:00:00Z',
    });
    expect(generated.rows.find((r) => r.trading_day === '2026-11-30')).toMatchObject({
      session_open_ct: '2026-11-29T17:00:00',
    });
  });

  it('opens the absorbed trade date where the exchange did, not where the rule computes (ADR-055)', () => {
    // THE MONEY-PATH LINE. The holiday is Thursday, so `open_day_offset: -1`
    // computes a Thursday 17:00 open for Friday's session. The exchange opened
    // it WEDNESDAY evening, before the closure. The computed row is a strict
    // SUBSET of the real session, and a fill in the gap falls inside no session
    // in the file at all, which is the condition R-01 exists to detect.
    const absorbed = generated.rows.find((r) => r.trading_day === '2026-11-27');
    expect(absorbed).toMatchObject({
      session_open_ct: '2026-11-25T17:00:00',
      session_open_at: '2026-11-25T23:00:00Z',
    });
    expect(absorbed?.session_open_ct).not.toBe('2026-11-26T17:00:00');
  });

  it('leaves every unabsorbed session on the rule, so the exception stays an exception', () => {
    // The three ordinary rows are unchanged by ADR-055. A change that widened
    // the absorbed open into a general rewrite would still pass the case above
    // and fail here.
    expect(
      generated.rows
        .filter((r) => !r.is_holiday && r.trading_day !== '2026-11-27')
        .map((r) => [r.trading_day, r.session_open_ct]),
    ).toEqual([
      ['2026-11-23', '2026-11-22T17:00:00'],
      ['2026-11-24', '2026-11-23T17:00:00'],
      ['2026-11-25', '2026-11-24T17:00:00'],
      ['2026-11-30', '2026-11-29T17:00:00'],
    ]);
  });

  it('keeps the absorbed session from overlapping the one before it, which R-01 needs', () => {
    // Wednesday closes 16:00 CT and Friday's absorbed session opens 17:00 CT
    // the same day, one hour later. `checkRows` asserts this for every
    // consecutive pair and `build` has already run it; the case is here because
    // an absorbed open reaching BACK past a close is the way this rule breaks,
    // and it is the failure a reader would not think to look for.
    const wed = generated.rows.find((r) => r.trading_day === '2026-11-25');
    const fri = generated.rows.find((r) => r.trading_day === '2026-11-27');
    expect(wed?.session_close_at).toBe('2026-11-25T22:00:00Z');
    expect(fri?.session_open_at).toBe('2026-11-25T23:00:00Z');
    expect(Date.parse(fri!.session_open_at!)).toBeGreaterThan(Date.parse(wed!.session_close_at!));
  });

  it('counts what it generated, and states the digest of the source that produced it', () => {
    expect(generated.counts).toEqual({
      holiday_count: 1,
      early_close_count: 1,
      session_count: 5,
      row_count: 6,
    });
    expect(generated.source_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

// -----------------------------------------------------------------------------
// The class P1 S-E section 3.2 calls "the one a careful reader still gets wrong"
// -----------------------------------------------------------------------------

describe('CT to UTC', () => {
  // The two rows below carry IDENTICAL CT wall times and UTC instants an hour
  // apart. That is the entire DST failure mode in two lines: a hand transcriber
  // reading a published 16:00 CT close writes one UTC value for the year and is
  // wrong for roughly a third of it, invisibly.
  it('resolves the same wall time to different instants either side of a transition', () => {
    const winter = build(source(), { sourceFile: 'synthetic.json' }).rows.find(
      (r) => r.trading_day === '2026-11-23',
    );
    const summer = build(
      source({
        coverage: { from: '2026-06-15', to: '2026-06-15', evidence_to: '2026-06-15' },
        holidays: [],
        early_closes: [],
      }),
      { sourceFile: 'synthetic.json' },
    ).rows[0];

    expect(winter?.session_open_ct).toBe('2026-11-22T17:00:00');
    expect(winter?.session_open_at).toBe('2026-11-22T23:00:00Z');
    expect(summer?.session_open_ct).toBe('2026-06-14T17:00:00');
    expect(summer?.session_open_at).toBe('2026-06-14T22:00:00Z');

    // The same wall time on both sides of the transition, an hour apart in UTC.
    expect(winter?.session_close_ct?.slice(10)).toBe(summer?.session_close_ct?.slice(10));
    expect(winter?.session_close_ct?.slice(10)).toBe('T16:00:00');
    expect(winter?.session_close_at).toBe('2026-11-23T22:00:00Z');
    expect(summer?.session_close_at).toBe('2026-06-15T21:00:00Z');
  });

  it('rejects a stated pair that disagrees, which is what the loader will do against the database', () => {
    const generated = build(source(), { sourceFile: 'synthetic.json' });
    const rows = generated.rows.map((r) =>
      r.trading_day === '2026-11-23' ? { ...r, session_open_at: '2026-11-22T22:00:00Z' } : r,
    );
    // Re-checking a mutated row set is exactly S-E4's round trip, one layer up.
    expect(findingOf(() => checkRows(rows, { declared: null }))).toBe('ct-and-utc-disagree');
  });
});

describe('the DST transitions, discovered from IANA and checked against the published rule', () => {
  const coverage = { from: { y: 2026, mo: 1, d: 1 }, to: { y: 2028, mo: 12, d: 31 } };
  const transitions = findDstTransitions(coverage);

  it('finds exactly two per fully covered year, both on Sundays', () => {
    expect(() => checkDstTransitions(transitions, coverage)).not.toThrow();
    expect(transitions).toHaveLength(6);
    expect(transitions.every((t) => t.weekday === 'Sunday')).toBe(true);
  });

  // The days themselves, stated here so that a tzdata change is a failing test
  // with a diff rather than two hundred and fifty session boundaries quietly
  // moving by an hour. `checkDstTransitions` derives the same days from the
  // published second-Sunday-in-March, first-Sunday-in-November rule; this is
  // the third statement and it is the one a human reads.
  it('lands on the days the United States rule puts them on', () => {
    expect(transitions.map((t) => `${t.day} ${t.kind}`)).toEqual([
      '2026-03-08 spring_forward',
      '2026-11-01 fall_back',
      '2027-03-14 spring_forward',
      '2027-11-07 fall_back',
      '2028-03-12 spring_forward',
      '2028-11-05 fall_back',
    ]);
    expect(transitions.map((t) => `${t.from_offset}->${t.to_offset}`)).toEqual([
      '-06:00->-05:00',
      '-05:00->-06:00',
      '-06:00->-05:00',
      '-05:00->-06:00',
      '-06:00->-05:00',
      '-05:00->-06:00',
    ]);
  });

  // ---------------------------------------------------------------------------
  // GS-030's surviving half, WAVE-05 `X6`
  // ---------------------------------------------------------------------------
  //
  // THIS IS A COUNT AND NOT A DURATION, AND THE DISTINCTION IS THE WHOLE ITEM.
  // `GS-030`'s registry row and EC-012 both pin "the 23 hour and 25 hour
  // sessions each produce exactly one trading day and one mark". ADR-076
  // section 5 falsifies the first clause of that sentence and rules that the
  // second is the half this suite can assert: ONE TRADING DAY AND ONE ROW
  // ACROSS EACH TRANSITION, WHATEVER THE CLOCK DID. The falsified arithmetic is
  // `X7`'s ADR and is deliberately not asserted here; a case that reached for
  // the 23 and the 25 is how the row came to be blocked in the first place.
  //
  // `FM-14` (M01) names the failure this is the detector for: "DST transition
  // handled by arithmetic instead of data -> a duplicated or missing trading
  // day at the boundary". So the expected row set is computed HERE, from the
  // weekday, rather than taken from anything the generator produced, and the
  // two independent statements have to agree.
  //
  // THE SECOND HALF IS WHAT MAKES THE FIRST MEAN ANYTHING. A case asserting
  // only that ten weekdays produce ten rows passes on any ordinary fortnight
  // and is not about DST at all. The close instants either side of the
  // transition pin that the clock DID move: the same 16:00 CT wall time lands
  // an hour apart in UTC, in the direction `kind` names.

  /** `day` moved by `by` calendar days. UTC throughout, where a day is 24 hours. */
  function shiftDay(day: string, by: number): string {
    return new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
  }

  /** The weekdays in `[from, to]`, derived from the weekday and from nothing else. */
  function weekdaysBetween(from: string, to: string): string[] {
    const out: string[] = [];
    const end = Date.parse(`${to}T00:00:00Z`);
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) {
      const dow = new Date(t).getUTCDay();
      if (dow !== 0 && dow !== 6) out.push(new Date(t).toISOString().slice(0, 10));
    }
    return out;
  }

  it('produces one trading day and one row across each transition, whatever the clock did', () => {
    for (const transition of transitions) {
      // Sunday to Sunday around the transition Sunday: two whole trading weeks,
      // ten weekdays, and the transition sitting between them.
      const from = shiftDay(transition.day, -7);
      const to = shiftDay(transition.day, 7);
      const where = `${transition.kind} ${transition.day}`;
      const rows = build(
        source({
          coverage: { from, to, evidence_to: to },
          holidays: [],
          early_closes: [],
        }),
        { sourceFile: 'synthetic.json' },
      ).rows;

      // ONE TRADING DAY AND ONE ROW. None duplicated, none missing, and the
      // Set is stated separately from the list because a duplicate and a
      // reordering are different defects and `toEqual` alone reports both as
      // "the arrays differ".
      const days = rows.map((r) => r.trading_day);
      expect(days, where).toEqual(weekdaysBetween(from, to));
      expect(new Set(days).size, where).toBe(days.length);

      // The transition day carries NO row, which is why the count is unchanged:
      // it is a Sunday, and it falls in the gap between Friday's 16:00 close and
      // Sunday's 17:00 open. No session contains it.
      expect(days, where).not.toContain(transition.day);

      // WHATEVER THE CLOCK DID. Both sessions close at the same CT wall time
      // and their UTC instants are an hour apart: earlier after a spring
      // forward, later after a fall back. R-05's "DST is data" in two rows.
      const before = rows.filter((r) => r.trading_day < transition.day).at(-1);
      const after = rows.find((r) => r.trading_day > transition.day);
      expect(
        [before?.session_close_ct?.slice(10), after?.session_close_ct?.slice(10)],
        where,
      ).toEqual(['T16:00:00', 'T16:00:00']);
      expect(
        [before?.session_close_at?.slice(11), after?.session_close_at?.slice(11)],
        where,
      ).toEqual(
        transition.kind === 'spring_forward'
          ? ['22:00:00Z', '21:00:00Z']
          : ['21:00:00Z', '22:00:00Z'],
      );
    }
  });
});

// -----------------------------------------------------------------------------
// The seeded violations
// -----------------------------------------------------------------------------

describe('the source file is refused when', () => {
  const cases: Array<[string, string, Record<string, unknown>]> = [
    [
      'it has not been transcribed at all',
      'source-not-transcribed',
      { status: 'awaiting-transcription' },
    ],
    [
      'an exception list is null rather than empty, which is the difference between nobody looked and the exchange lists none',
      'exception-list-not-transcribed',
      { holidays: null },
    ],
    [
      'the provenance names no source URL',
      'provenance-field-missing',
      { provenance: { ...PROVENANCE, source_url: '' } },
    ],
    [
      'the retrieved artifact digest is not a SHA-256',
      'artifact-digest-not-sha256',
      { provenance: { ...PROVENANCE, artifact_sha256: 'deadbeef' } },
    ],
    [
      'a holiday falls on a weekend, where it would silently generate nothing',
      'holiday-on-a-weekend',
      { holidays: [{ day: '2026-11-28', name: 'Synthetic Closure', absorbs_into: null }] },
    ],
    [
      'a holiday is listed twice',
      'holiday-duplicated',
      {
        holidays: [
          { day: '2026-11-26', name: 'Synthetic Closure', absorbs_into: ABSORBED },
          { day: '2026-11-26', name: 'Synthetic Closure', absorbs_into: ABSORBED },
        ],
      },
    ],
    [
      'a holiday has no name for the second reader to diff against',
      'holiday-unnamed',
      { holidays: [{ day: '2026-11-26', name: '  ', absorbs_into: ABSORBED }] },
    ],
    [
      'an exception falls outside coverage, where it is a transcribed value that does nothing',
      'exception-outside-coverage',
      { holidays: [{ day: '2026-12-25', name: 'Synthetic Closure', absorbs_into: null }] },
    ],
    [
      'a day is both a holiday and an early close, so the two lists disagree about whether it trades',
      'early-close-on-a-holiday',
      { early_closes: [{ day: '2026-11-26', close_ct: '12:15', notes: 'group A 12:15 CT' }] },
    ],
    [
      'an early close is not before the regular close, which would set is_half_day on a full day',
      'early-close-not-early',
      { early_closes: [{ day: '2026-11-27', close_ct: '16:00', notes: 'group A 16:00 CT' }] },
    ],
    [
      'an early close records no per-group times, which 0032 rejects at the database anyway',
      'early-close-notes-blank',
      { early_closes: [{ day: '2026-11-27', close_ct: '12:15', notes: '   ' }] },
    ],
    [
      'a date matches the pattern and is not a calendar date',
      'day-not-a-date',
      { holidays: [{ day: '2026-02-30', name: 'Synthetic Closure', absorbs_into: null }] },
    ],
    ['a CT time is malformed', 'ct-time-malformed', { session_rule: { ...RULE, close_ct: '4pm' } }],
    [
      'the session opens on the same calendar day, which would put Monday`s open after its close',
      'session-rule-open-offset',
      { session_rule: { ...RULE, open_day_offset: 0 } },
    ],
    [
      'the rule names a timezone other than the exchange`s',
      'session-rule-timezone',
      { session_rule: { ...RULE, timezone: 'UTC' } },
    ],
    [
      'the declared count disagrees with what the file generates',
      'declared-count-disagrees',
      { declared: { holiday_count: 2, early_close_count: 1, session_count: 5 } },
    ],
    [
      'coverage runs backwards',
      'coverage-inverted',
      { coverage: { from: '2026-11-30', to: '2026-11-23', evidence_to: '2026-11-30' } },
    ],

    // -------------------------------------------------------------------------
    // ADR-055. The six rejections the ruling enumerates, plus the evidence
    // bound section 5 rules and the type check that keeps a malformed
    // `absorbs_into` from failing on the wrong finding.
    // -------------------------------------------------------------------------
    [
      'a holiday does not say whether it absorbed a session, which is the state ADR-055 made required',
      'absorbs-into-not-transcribed',
      { holidays: [{ day: '2026-11-26', name: 'Synthetic Closure' }] },
    ],
    [
      'absorbs_into is neither null nor an object, so it would otherwise fail on a sub-key',
      'absorbs-into-not-an-object',
      { holidays: [{ day: '2026-11-26', name: 'Synthetic Closure', absorbs_into: '2026-11-27' }] },
    ],
    [
      'the absorbed session opens ON the holiday, which is what session_rule already computes',
      'absorbed-open-not-before-holiday',
      absorbing({ session_open_day: '2026-11-26' }),
    ],
    [
      'the absorbed session opens AFTER the holiday, which is the unchanged rule wearing an exception',
      'absorbed-open-not-before-holiday',
      absorbing({ session_open_day: '2026-11-27' }),
    ],
    [
      'the holiday claims a trade date that is not the next one',
      'absorbed-trading-day-not-next',
      absorbing({ trading_day: '2026-11-30', session_close_day: '2026-11-30' }),
    ],
    [
      'the stated close disagrees with the early_closes entry for the day it absorbed',
      'absorbed-close-disagrees',
      absorbing({ session_close_ct: '16:00' }),
    ],
    [
      'the stated close lands on a day other than the trade date it belongs to',
      'absorbed-close-disagrees',
      absorbing({ session_close_day: '2026-11-30' }),
    ],
    [
      'a mid-week holiday claims to absorb nothing while the next calendar day trades',
      'absorbed-null-but-next-day-trades',
      { holidays: [{ day: '2026-11-26', name: 'Synthetic Closure', absorbs_into: null }] },
    ],
    [
      'nobody has established how far the committed evidence reaches',
      'coverage-evidence-not-transcribed',
      { coverage: { from: '2026-11-23', to: '2026-11-30', evidence_to: null } },
    ],
    [
      'coverage runs past the last date a committed artifact supports',
      'coverage-exceeds-evidence',
      { coverage: { from: '2026-11-23', to: '2026-11-30', evidence_to: '2026-11-27' } },
    ],
  ];

  for (const [name, finding, over] of cases) {
    it(`${name} -> ${finding}`, () => {
      expect(findingOf(() => build(source(over), { sourceFile: 'synthetic.json' }))).toBe(finding);
    });
  }
});

// -----------------------------------------------------------------------------
// ADR-055's sixth rejection, which is currently unreachable
// -----------------------------------------------------------------------------

describe('`absorbed-session-not-claimed` is a backstop the two checks above it shadow', () => {
  // THIS SUITE'S OWN RULE IS THAT EVERY REJECTION SHIPS WITH A SEEDED VIOLATION
  // WATCHED FAILING ON ITS OWN FINDING, and this one has none, because no
  // source file can reach it. That is stated here rather than papered over with
  // a seed that fails on a different finding and looks like coverage.
  //
  // THE PROOF IS SHORT. Let `D` trade and let `D - 1` be a holiday. The holiday
  // states `absorbs_into` as either `null` or an object.
  //
  //   null   `absorbed-null-but-next-day-trades` fires, because `D` is the next
  //          calendar day and it trades
  //   object `absorbed-trading-day-not-next` requires it to name
  //          `nextTradingDay(D - 1)`. That walk starts at `D`, and `D` trades,
  //          so it returns `D`. The object therefore names `D` and `D` is claimed
  //
  // Both branches are closed before the reverse pass runs, so it cannot fire.
  // The two cases below are the two branches, each asserted on the finding that
  // actually catches it. If a future change to either check makes this suite go
  // red, the backstop has become reachable and owes a seed of its own.

  it('catches the null branch on the more specific finding', () => {
    expect(
      findingOf(() =>
        build(
          source({
            holidays: [{ day: '2026-11-26', name: 'Synthetic Closure', absorbs_into: null }],
          }),
          { sourceFile: 'synthetic.json' },
        ),
      ),
    ).toBe('absorbed-null-but-next-day-trades');
  });

  it('catches the object branch on the more specific finding', () => {
    expect(
      findingOf(() =>
        build(source(absorbing({ trading_day: '2026-11-30', session_close_day: '2026-11-30' })), {
          sourceFile: 'synthetic.json',
        }),
      ),
    ).toBe('absorbed-trading-day-not-next');
  });

  it('accepts a run of holidays, where both entries legitimately claim the same trade date', () => {
    // Wednesday and Thursday both shut and Friday trades. `nextTradingDay`
    // skips a holiday, so BOTH entries name 2026-11-27 and both are right: the
    // session opened Tuesday evening, before the run, and both closures sit
    // inside it. Recorded as a passing case rather than left to be discovered,
    // because it is the shape a reader assumes must be a duplicate claim.
    //
    // WHAT IS NOT CHECKED, AND IT IS STATED HERE RATHER THAN IMPLIED: two
    // claimants on one trade date are not required to AGREE about its bounds.
    // `generate` keys them by trade date and the last one wins. It is outside
    // ADR-055's six and is not invented here; it is carried to the session log
    // as a finding.
    const run = {
      trading_day: '2026-11-27',
      session_open_day: '2026-11-24',
      session_open_ct: '17:00',
      session_close_day: '2026-11-27',
      session_close_ct: '12:15',
    };
    const generated = build(
      source({
        holidays: [
          { day: '2026-11-25', name: 'First Synthetic Closure', absorbs_into: run },
          { day: '2026-11-26', name: 'Second Synthetic Closure', absorbs_into: run },
        ],
      }),
      { sourceFile: 'synthetic.json' },
    );
    expect(generated.rows.find((r) => r.trading_day === '2026-11-27')).toMatchObject({
      session_open_ct: '2026-11-24T17:00:00',
      session_close_ct: '2026-11-27T12:15:00',
    });
  });
});

// -----------------------------------------------------------------------------
// The committed source file
// -----------------------------------------------------------------------------

describe('the committed CME source file', () => {
  // This is a HOLDING TEST and it is written to be deleted. While the file is
  // an untranscribed shape it must be impossible to generate from, and the test
  // asserts exactly that. When the transcription lands, this case fails, and
  // the failure is the reminder to replace it with the real assertions:
  // declared counts, coverage bounds, and the generated file being reproducible.
  it('refuses to generate until it has been transcribed from the publication', () => {
    const text = readFileSync(SOURCE_FILE, 'utf8');
    expect(findingOf(() => readSource(text, SOURCE_FILE))).toBe('source-not-transcribed');
  });

  it('carries four independent refusals, so satisfying one does not make it loadable', () => {
    // FOUR, AND THE COUNT WAS CHECKED RATHER THAN ASSUMED: this case was
    // written expecting three and the run said `provenance-field-missing`,
    // which is the fourth and sits between the other two in `readSource`'s
    // order. They are not spares. `status` says nobody has transcribed, the
    // null exception lists say nobody has read the exceptions, `provenance`
    // says nobody has named the publication, and `evidence_to` says nobody has
    // established how far the committed evidence reaches. A transcriber peels
    // them off one at a time and the last one is ADR-055's, which is the one a
    // reader is least likely to expect.
    const raw = JSON.parse(readFileSync(SOURCE_FILE, 'utf8'));
    const peel = (over: Record<string, unknown>) =>
      findingOf(() => readSource(JSON.stringify({ ...raw, ...over })));

    const transcribed = { status: 'transcribed' };
    expect(peel(transcribed)).toBe('exception-list-not-transcribed');

    const listed = { ...transcribed, holidays: [], early_closes: [] };
    expect(peel(listed)).toBe('provenance-field-missing');

    const sourced = { ...listed, provenance: PROVENANCE };
    expect(peel(sourced)).toBe('coverage-evidence-not-transcribed');
  });

  it('states the absorbs_into contract where the transcriber will read it', () => {
    // ADR-055 is a document and this file is what the transcriber has open.
    // The contract has to be legible HERE, and the three states are the half
    // that a reader who skims will get wrong.
    const raw = JSON.parse(readFileSync(SOURCE_FILE, 'utf8'));
    const note = String(raw._holidays_note);
    expect(note).toContain('absorbs_into');
    for (const state of ['ABSENT', 'null', 'object']) expect(note).toContain(state);
    // The key is `day`, and ADR-055 section 3's snippet writes `date`. The
    // discrepancy is named in the note so a transcriber following the ADR
    // verbatim finds out here rather than from a rejection.
    expect(note).toContain('`day` AND NOT `date`');
  });
});

// -----------------------------------------------------------------------------
// OQ-SE-04
// -----------------------------------------------------------------------------

describe('the second, blind transcription', () => {
  it('is empty when two readers agree, ignoring the fields independence makes differ', () => {
    const first = readSource(source());
    const second = readSource(
      source({
        id: 'synthetic-second-reader',
        provenance: {
          ...PROVENANCE,
          retrieved_at: '2026-08-17',
          retrieved_by: 'the second reader',
        },
        early_closes: [
          {
            day: '2026-11-27',
            close_ct: '12:15',
            notes: 'phrased differently by the second reader',
          },
        ],
      }),
    );
    expect(diffTranscriptions(first, second)).toEqual([]);
  });

  it('surfaces a disagreement about which holiday a closure is, not only about whether one exists', () => {
    const first = readSource(source());
    const second = readSource(
      source({
        holidays: [{ day: '2026-11-26', name: 'A Different Closure', absorbs_into: ABSORBED }],
      }),
    );
    expect(diffTranscriptions(first, second)).toEqual([
      'holiday 2026-11-26: first says Synthetic Closure, second says A Different Closure',
    ]);
  });

  it('surfaces a missing holiday in either direction', () => {
    const first = readSource(source());
    const second = readSource(source({ holidays: [] }));
    expect(diffTranscriptions(first, second)).toHaveLength(1);
    expect(diffTranscriptions(second, first)).toHaveLength(1);
  });

  it('refuses to call the diff meaningful when the two readers read different bytes', () => {
    const first = readSource(source());
    const second = readSource(
      source({ provenance: { ...PROVENANCE, artifact_sha256: 'b'.repeat(64) } }),
    );
    expect(diffTranscriptions(first, second)[0]).toContain('did not read the same bytes');
  });
});

// -----------------------------------------------------------------------------
// Timezone hostility
// -----------------------------------------------------------------------------

describe('the process timezone', () => {
  // P1 S-E section 6, borrowing RE-D-02's idiom: "a calendar loader is the most
  // timezone-sensitive program in this system". Run out of process, because the
  // point is the whole program's behaviour under TZ and an in-process
  // `process.env.TZ` assignment does not reach an already-constructed
  // `Intl.DateTimeFormat`, which would make this pass without testing anything.
  it('changes nothing, byte for byte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'merit-cal-'));
    const path = join(dir, 'synthetic.json');
    writeFileSync(path, source());
    try {
      const under = (TZ: string) =>
        execFileSync(process.execPath, [GENERATOR, path], {
          encoding: 'utf8',
          env: { ...process.env, TZ },
        });
      expect(under('Asia/Kolkata')).toBe(under('UTC'));
      expect(under('Pacific/Kiritimati')).toBe(under('America/Chicago'));
      expect(under('UTC')).toContain('"session_open_at": "2026-11-22T23:00:00Z"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
