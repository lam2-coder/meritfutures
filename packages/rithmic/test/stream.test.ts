import { expect, test } from 'vitest';

import { canonicalInput, CANONICAL_SEED } from './canonical.js';
import { renderRun } from '../src/simulator/emit.js';
import { simulate } from '../src/simulator/session.js';
import { foldStream, sampleTicks, streamRun, StreamError } from '../src/simulator/stream.js';
import { formatMoney, DECLARED_CSV_QUIRKS } from '../src/simulator/csv.js';
import { EOD_REPORT_COLUMNS } from '../src/simulator/eod-report.js';
import type { LiveAccountTick } from '../src/simulator/stream.js';

// CI-02, the `unit` project.
//
// =============================================================================
// THE EQUIVALENCE IS THE TEST WORTH WRITING, AND IT CROSSES THE FILE BOUNDARY
// =============================================================================
// ADR-020's tier 2 ships a second view of the same run, so the question that
// decides whether streaming mode is trustworthy is not "is it deterministic"
// (necessary, and cheap) but "does it agree with the file mode about the same
// seed" (the thing a divergence would silently break).
//
// So the equivalence below does NOT compare the stream to `SimDay`. Both are
// in-memory objects from one `simulate` call and comparing them would assert
// that the run equals itself. It compares the folded stream to the RENDERED
// EOD CSV: the stream is summarised, the file is parsed back, and the two are
// checked field by field in the vendor's own decimal-currency spelling.
//
// That is the boundary INV-M2-11 cares about. If the two modes ever disagree,
// the failure is a live dashboard showing a number the closing file will
// contradict at settlement, which under ADR-020 is exactly the class of defect
// that "indicative data never feeds a money decision" makes survivable and
// which a trader still experiences as Merit being wrong.
//
// -----------------------------------------------------------------------------
// V-M2-16 IS UNCONFIRMED AND THESE ASSERTIONS ARE ABOUT THE PATH, NOT THE WIRE
// -----------------------------------------------------------------------------
// Nothing here asserts a delivery mechanism, because there is not one to
// assert: `V-M2-16` is whether a stream exists at all. What is asserted is that
// whatever delivers these ticks, the equity path they describe is the same path
// the file summarises. A mechanism change moves `stream.ts`; it does not move
// this expectation.
// =============================================================================

/** Parse the rendered EOD CSV back into rows keyed by account. Header excluded. */
function parseEodRows(csv: string): Map<string, readonly string[]> {
  // The terminator is READ FROM THE QUIRKS rather than restated. This parser
  // hardcoded CRLF on its first run and the declared quirk is LF, so the whole
  // file arrived as one line and the header comparison reported 152 fields. A
  // test that restates a renderer's constant is a second source for it.
  const lines = csv.split(DECLARED_CSV_QUIRKS.lineEnding).filter((line) => line.length > 0);
  const header = lines[0]!.split(',');
  expect(header).toEqual([...EOD_REPORT_COLUMNS]);
  const rows = new Map<string, readonly string[]>();
  for (const line of lines.slice(1)) {
    // The canonical run's fields carry no embedded comma or quote, asserted
    // below rather than assumed: a naive split is only safe while that holds.
    expect(line.includes('"')).toBe(false);
    const cells = line.split(',');
    rows.set(`${cells[2]!} ${cells[0]!}`, cells);
  }
  return rows;
}

const column = (name: (typeof EOD_REPORT_COLUMNS)[number]): number =>
  EOD_REPORT_COLUMNS.indexOf(name);

test('the folded stream and the rendered EOD file agree, field by field', () => {
  const run = simulate(canonicalInput());
  const ticks = streamRun(run);
  const folds = foldStream(ticks);

  const eod = renderRun(run, { kinds: ['eod_report'] });
  const rows = new Map<string, readonly string[]>();
  for (const file of eod)
    for (const [key, cells] of parseEodRows(file.contents)) rows.set(key, cells);

  // Not a hand-maintained count: one fold per account per session, derived from
  // the run rather than typed. A stream that dropped an account's whole day
  // would otherwise pass every field comparison below by having nothing to
  // compare.
  const expectedFolds = run.sessions.length * run.population.length;
  expect(folds.length).toBe(expectedFolds);
  expect(rows.size).toBe(expectedFolds);

  for (const fold of folds) {
    const key = `${fold.tradingDay} ${fold.platformAccountRef}`;
    const cells = rows.get(key);
    expect(cells, `no EOD row for ${key}`).toBeDefined();

    // THE FOUR NUMBERS FILE MODE SUMMARISES THE PATH INTO. `session.ts`: "high
    // / low = max and min over the waypoints, opening included".
    expect(cells![column('opening_balance')]).toBe(formatMoney(fold.openingEquityCents));
    expect(cells![column('closing_balance')]).toBe(formatMoney(fold.closingEquityCents));
    expect(cells![column('high_balance')]).toBe(formatMoney(fold.highEquityCents));
    expect(cells![column('low_balance')]).toBe(formatMoney(fold.lowEquityCents));
  }
});

test('every account-day in the run reaches the stream', () => {
  // The equivalence above compares folds to rows. A stream that emitted no tick
  // at all for some account-day would produce no fold for it, and the count
  // assertion would catch that. This one catches the narrower case: a day whose
  // ticks all carry the wrong account or day key, which would still produce the
  // right NUMBER of folds while pairing every one of them with the wrong row.
  const run = simulate(canonicalInput());
  const streamed = new Set(
    streamRun(run).map((tick) => `${tick.tradingDay} ${tick.platformAccountRef}`),
  );
  const expected = new Set<string>();
  for (const days of run.days) {
    for (const day of days) expected.add(`${day.tradingDay} ${day.account.platformAccountRef}`);
  }
  expect([...streamed].sort()).toEqual([...expected].sort());
});

test('the stream is deterministic: two calls in one process agree', () => {
  const run = simulate(canonicalInput());
  expect(serialise(streamRun(run))).toBe(serialise(streamRun(run)));
});

test('the stream is deterministic across simulate calls on the same seed', () => {
  // Stronger than the above: a fresh `simulate` from the same input, so a draw
  // that had leaked ambient state would show up here and not there.
  expect(serialise(streamRun(simulate(canonicalInput())))).toBe(
    serialise(streamRun(simulate(canonicalInput()))),
  );
});

test('a different seed produces a different stream', () => {
  // Without this, a `streamRun` that ignored the run entirely and emitted a
  // constant would satisfy every determinism assertion above.
  const base = canonicalInput();
  const other = { ...base, seed: `${CANONICAL_SEED}-other` };
  expect(serialise(streamRun(simulate(base)))).not.toBe(serialise(streamRun(simulate(other))));
});

test('both delivery orders carry exactly the same tick set', () => {
  // `time` is one vendor connection; `account` is per-account polling. They are
  // orderings of one set, so a consumer that behaves differently under one has
  // an ordering bug rather than two feeds to support.
  const run = simulate(canonicalInput());
  const byTime = streamRun(run, { order: 'time' });
  const byAccount = streamRun(run, { order: 'account' });

  expect(byTime.length).toBe(byAccount.length);
  expect([...byTime].map(serialiseTick).sort()).toEqual([...byAccount].map(serialiseTick).sort());

  // And the orders are genuinely different, or the assertion above is vacuous.
  // The canonical run has more than one account per session, so interleaving
  // must move something.
  expect(serialise(byTime)).not.toBe(serialise(byAccount));
});

test('the time order is non-decreasing within a session', () => {
  const run = simulate(canonicalInput());
  for (const [index, session] of run.sessions.entries()) {
    const ticks = streamRun(run, { order: 'time' }).filter(
      (tick) => tick.tradingDay === session.tradingDay,
    );
    expect(ticks.length, `session ${index} streamed nothing`).toBeGreaterThan(0);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]!.atUtc >= ticks[i - 1]!.atUtc).toBe(true);
    }
  }
});

test('sequence is per account per day and gapless, in both orders', () => {
  // ADR-020 rule 3: feed loss is a first-class state. A consumer detects it by
  // the ordinal, so an ordinal that renumbered under a delivery order would
  // make gap detection an artifact of delivery rather than a property of the
  // feed.
  const run = simulate(canonicalInput());
  for (const order of ['time', 'account'] as const) {
    const seen = new Map<string, number[]>();
    for (const tick of streamRun(run, { order })) {
      const key = `${tick.tradingDay} ${tick.platformAccountRef}`;
      const list = seen.get(key) ?? [];
      list.push(tick.sequence);
      seen.set(key, list);
    }
    for (const [key, sequences] of seen) {
      const sorted = [...sequences].sort((a, b) => a - b);
      expect(sorted, `${order}: ${key}`).toEqual(
        Array.from({ length: sequences.length }, (_, i) => i + 1),
      );
    }
  }
});

test('every tick is labeled indicative', () => {
  // ADR-020: labeling is at the point of use. The type makes it unavoidable;
  // this asserts the producer never emits one without it, which is the half a
  // type cannot check once a tick has crossed a JSON boundary.
  const run = simulate(canonicalInput());
  for (const tick of streamRun(run)) expect(tick.indicative).toBe(true);
});

test('a polled mechanism sees the same closing equity and can miss the extremes', () => {
  // `V-M2-16` names "frequent report snapshots" as a candidate mechanism, so
  // the polled shape has to be expressible before the vendor call rather than
  // after it. The property that distinguishes polling from streaming is that
  // sampling CARRIES THE LAST OBSERVATION FORWARD and can step over an
  // extreme between samples.
  const run = simulate(canonicalInput());
  const ticks = streamRun(run);
  const sampled = sampleTicks(ticks, 900);

  const streamed = new Map(
    foldStream(ticks).map((f) => [`${f.tradingDay} ${f.platformAccountRef}`, f]),
  );
  for (const fold of foldStream(sampled)) {
    const key = `${fold.tradingDay} ${fold.platformAccountRef}`;
    const full = streamed.get(key)!;
    // The closing equity survives sampling: the last sample carries the last
    // observation, whatever the cadence.
    expect(fold.closingEquityCents).toBe(full.closingEquityCents);
    // The extremes are BOUNDED BY the full path and may be narrower. Asserting
    // equality here would be asserting that polling loses nothing, which is the
    // claim this function exists to contradict.
    expect(fold.highEquityCents <= full.highEquityCents).toBe(true);
    expect(fold.lowEquityCents >= full.lowEquityCents).toBe(true);
  }
});

test('sampleTicks refuses an interval that is not a positive whole number', () => {
  const ticks = streamRun(simulate(canonicalInput()));
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    expect(() => sampleTicks(ticks, bad)).toThrow(StreamError);
  }
});

test('streamRun refuses an unknown delivery order', () => {
  const run = simulate(canonicalInput());
  expect(() => streamRun(run, { order: 'whenever' as 'time' })).toThrow(StreamError);
});

// -----------------------------------------------------------------------------
// Serialisation used by the determinism assertions
// -----------------------------------------------------------------------------
// `bigint` has no JSON representation, so it is spelled explicitly rather than
// left to a replacer that would silently stringify it one way here and another
// way in a later test.

function serialiseTick(tick: LiveAccountTick): string {
  return [
    tick.tradingDay,
    tick.platformAccountRef,
    tick.atUtc,
    tick.equityCents.toString(),
    tick.kind,
    String(tick.sequence),
    String(tick.indicative),
  ].join('|');
}

function serialise(ticks: readonly LiveAccountTick[]): string {
  return ticks.map(serialiseTick).join('\n');
}
