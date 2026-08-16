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
 * Monday 2026-11-23 to Monday 2026-11-30, holding one holiday (Thursday), one
 * early close (Friday), and a weekend the generator must skip.
 */
function source(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'synthetic',
    status: 'transcribed',
    provenance: PROVENANCE,
    coverage: { from: '2026-11-23', to: '2026-11-30' },
    session_rule: RULE,
    holidays: [{ day: '2026-11-26', name: 'Synthetic Closure' }],
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
        coverage: { from: '2026-06-15', to: '2026-06-15' },
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
      { holidays: [{ day: '2026-11-28', name: 'Synthetic Closure' }] },
    ],
    [
      'a holiday is listed twice',
      'holiday-duplicated',
      {
        holidays: [
          { day: '2026-11-26', name: 'Synthetic Closure' },
          { day: '2026-11-26', name: 'Synthetic Closure' },
        ],
      },
    ],
    [
      'a holiday has no name for the second reader to diff against',
      'holiday-unnamed',
      { holidays: [{ day: '2026-11-26', name: '  ' }] },
    ],
    [
      'an exception falls outside coverage, where it is a transcribed value that does nothing',
      'exception-outside-coverage',
      { holidays: [{ day: '2026-12-25', name: 'Synthetic Closure' }] },
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
      { holidays: [{ day: '2026-02-30', name: 'Synthetic Closure' }] },
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
      { coverage: { from: '2026-11-30', to: '2026-11-23' } },
    ],
  ];

  for (const [name, finding, over] of cases) {
    it(`${name} -> ${finding}`, () => {
      expect(findingOf(() => build(source(over), { sourceFile: 'synthetic.json' }))).toBe(finding);
    });
  }
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
      source({ holidays: [{ day: '2026-11-26', name: 'A Different Closure' }] }),
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
