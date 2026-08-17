import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, test } from 'vitest';

import {
  FIXTURE_DIR,
  FixtureError,
  citedIdentifiers,
  describeDiff,
  loadFixture,
  loadFixtureDirectory,
  m01Identifiers,
  registryIds,
  runFixture,
  unusedAwaitingEntries,
} from '../src/index.js';

// =============================================================================
// EVERY LOADER RULE IS WATCHED FAILING ON A SEEDED VIOLATION
// =============================================================================
// STRATEGY section 4.4: "A gate nobody has watched fail is not a gate", and P1
// section 6 makes it a condition on every gate any P1 session wires. The corpus
// paid for the second half of that lesson too: two of the eleven corpus gates
// exited non-zero on a finding nobody had planted and would have been scored as
// working. So each case below asserts the RULE ID that came back, not merely
// that something threw.
//
// The seedbed is a COPY OF THE REAL FIXTURE DIRECTORY, so a change to the
// format is a change to what these cases are seeded against. A hand-written
// miniature would drift from the thing under test, which is how a harness ends
// up proving something about itself.

const GS_011 = 'GS-011-trailing-floor-ignores-the-intraday-high';
const REGISTRY = registryIds();
const beds: string[] = [];

/** A throwaway copy of the fixture tree, holding one fixture and its resources. */
function seedbed(): string {
  const dir = mkdtempSync(join(tmpdir(), 'merit-golden-'));
  beds.push(dir);
  mkdirSync(join(dir, 'plans'), { recursive: true });
  mkdirSync(join(dir, 'calendars'), { recursive: true });
  cpSync(join(FIXTURE_DIR, 'plans'), join(dir, 'plans'), { recursive: true });
  cpSync(join(FIXTURE_DIR, 'calendars'), join(dir, 'calendars'), { recursive: true });
  cpSync(join(FIXTURE_DIR, `${GS_011}.yaml`), join(dir, `${GS_011}.yaml`));
  cpSync(join(FIXTURE_DIR, `${GS_011}.expected.json`), join(dir, `${GS_011}.expected.json`));
  return dir;
}

const yamlPath = (dir: string, stem = GS_011) => join(dir, `${stem}.yaml`);

function editYaml(dir: string, edit: (body: string) => string, stem = GS_011): void {
  writeFileSync(yamlPath(dir, stem), edit(readFileSync(yamlPath(dir, stem), 'utf8')));
}

function editExpectation(dir: string, edit: (value: Record<string, unknown>) => unknown): void {
  const file = join(dir, `${GS_011}.expected.json`);
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  writeFileSync(file, JSON.stringify(edit(parsed) ?? parsed, null, 2));
}

/** Load the seedbed's fixture and return the error it refused with. */
function refusal(dir: string, stem = GS_011): FixtureError {
  let thrown: unknown;
  try {
    loadFixture(yamlPath(dir, stem), { fixtureDir: dir, registry: REGISTRY });
  } catch (cause) {
    thrown = cause;
  }
  if (!(thrown instanceof FixtureError)) {
    throw new Error(`expected a FixtureError, got: ${String(thrown)}`);
  }
  return thrown;
}

afterAll(() => {
  for (const dir of beds) rmSync(dir, { recursive: true, force: true });
});

// -----------------------------------------------------------------------------
// The positive control, which is the half a seeded-violation suite forgets
// -----------------------------------------------------------------------------
// A rule that refuses everything passes every case below and is useless. The
// unmutated copy must load.

describe('the seedbed itself', () => {
  test('an untouched copy of the fixture tree loads clean', () => {
    const dir = seedbed();
    const fixture = loadFixture(yamlPath(dir), { fixtureDir: dir, registry: REGISTRY });
    expect(fixture.id).toBe('GS-011');
    expect(fixture.input.marks).toHaveLength(1);
    expect(fixture.expected.pins).toContain('never the intraday high');
  });
});

describe('each loader rule, watched failing on its own seeded violation', () => {
  test('L-01 an id that does not match the filename', () => {
    const dir = seedbed();
    editYaml(dir, (b) => b.replace('id: GS-011', 'id: GS-012'));
    expect(refusal(dir).rule).toBe('L-01');
  });

  test('L-02 a misspelled top-level key is refused, not ignored', () => {
    // The dangerous direction: `dayz:` leaves the day stream empty and the
    // expectation then pins the account-open state of a scenario about day one.
    const dir = seedbed();
    editYaml(dir, (b) => b.replace('days:', 'dayz:'));
    expect(refusal(dir).rule).toBe('L-02');
  });

  test('L-03 an id that is not in the registry', () => {
    const dir = seedbed();
    editYaml(dir, (b) => b.replace('id: GS-011', 'id: GS-999'));
    cpSync(yamlPath(dir), join(dir, 'GS-999-not-a-scenario.yaml'));
    cpSync(join(dir, `${GS_011}.expected.json`), join(dir, 'GS-999-not-a-scenario.expected.json'));
    expect(refusal(dir, 'GS-999-not-a-scenario').rule).toBe('L-03');
  });

  test('L-04 no expectation sibling at all', () => {
    const dir = seedbed();
    rmSync(join(dir, `${GS_011}.expected.json`));
    expect(refusal(dir).rule).toBe('L-04');
  });

  test('L-04 an end state that pins no field', () => {
    const dir = seedbed();
    editExpectation(dir, (e) => ({ ...e, end_state: {} }));
    expect(refusal(dir).rule).toBe('L-04');
  });

  test('L-04 an unknown key in the sibling', () => {
    const dir = seedbed();
    editExpectation(dir, (e) => ({ ...e, expect_end_state: {} }));
    expect(refusal(dir).rule).toBe('L-04');
  });

  test('L-05 an expect block left in the YAML', () => {
    const dir = seedbed();
    editYaml(dir, (b) => `${b}expect:\n  end_state:\n    floor_cents: 1\n`);
    expect(refusal(dir).rule).toBe('L-05');
  });

  test('L-06 a fixture with no pins is a regression test wearing a golden file name', () => {
    const dir = seedbed();
    editExpectation(dir, (e) => {
      const without = { ...e };
      delete without['pins'];
      return without;
    });
    expect(refusal(dir).rule).toBe('L-06');
  });

  test('L-07 a plan that does not resolve', () => {
    const dir = seedbed();
    editYaml(dir, (b) => b.replace('plan: CORE-50K', 'plan: CORE-999K'));
    expect(refusal(dir).rule).toBe('L-07');
  });

  test('L-07 a plan record missing a field the engine config declares', () => {
    const dir = seedbed();
    const file = join(dir, 'plans', 'CORE-50K.json');
    const plan = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    delete plan['plan_version_id'];
    writeFileSync(file, JSON.stringify(plan, null, 2));
    expect(refusal(dir).rule).toBe('L-07');
  });

  test('L-08 a trading day the calendar does not declare as a session', () => {
    const dir = seedbed();
    editYaml(dir, (b) => b.replace('trading_day: 2026-11-03', 'trading_day: 2026-11-07'));
    expect(refusal(dir).rule).toBe('L-08');
  });

  test('L-09 an account field that reaches no engine input and is on no list', () => {
    const dir = seedbed();
    editYaml(dir, (b) =>
      b.replace('  size_cents: 5000000', '  size_cents: 5000000\n  nickname: bob'),
    );
    expect(refusal(dir).rule).toBe('L-09');
  });

  test('L-09 a fixture claiming an identifier the loader owns', () => {
    const dir = seedbed();
    editYaml(dir, (b) =>
      b.replace(
        '  size_cents: 5000000',
        '  plan_version_id: some-other-version\n  size_cents: 5000000',
      ),
    );
    expect(refusal(dir).message).toContain('supplied by the loader');
  });

  test('L-10 days out of order', () => {
    const dir = seedbed();
    editYaml(dir, (b) =>
      b.replace(
        'settlements: []',
        [
          '  - trading_day: 2026-11-02',
          '    opening_balance_cents: 5000000',
          '    closing_balance_cents: 5000000',
          '    high_balance_cents: 5000000',
          '    low_balance_cents: 5000000',
          '    realized_pnl_cents: 0',
          '    fill_count: 0',
          '    traded_day: false',
          'settlements: []',
        ].join('\n'),
      ),
    );
    expect(refusal(dir).rule).toBe('L-10');
  });

  test('L-10 a day with no traded_day, which the loader will not derive', () => {
    const dir = seedbed();
    editYaml(dir, (b) => b.replace('    traded_day: true\n', ''));
    expect(refusal(dir).rule).toBe('L-10');
  });

  test('a non-zero adjustment now REACHES the fold, and INV-18 is what judges it', () => {
    // L-11's refusal of this is RETIRED and its own comment predicted the day:
    // "M01 folds settlements into the day stream and this refusal expires
    // there". `DailyMark.adjustmentCents` is SD-01's non-trading movement and
    // INV-18 is stated against it, so an adjustment a fixture states is now a
    // number the engine checks rather than a number the loader refuses.
    //
    // THE SEEDED VIOLATION IS KEPT, POINTED AT THE RULE THAT NOW OWNS IT. The
    // day's opening balance no longer equals `prior.balance + adjustment`, so
    // DO-3 refuses the day. That is the engine's answer, arrived at through the
    // loader, which is the property this suite exists to hold.
    const dir = seedbed();
    editYaml(dir, (b) => b.replace('adjustment_cents: 0', 'adjustment_cents: 5000'));
    const fixture = loadFixture(yamlPath(dir), { fixtureDir: dir, registry: REGISTRY });
    expect(fixture.input.marks[0]?.adjustmentCents).toBe(5_000n);

    const { assertions } = runFixture(fixture);
    expect(assertions.map((a) => a.kind)).toEqual(['opening_mismatch']);
  });

  test('L-11 a settlement, which the FORMAT cannot state', () => {
    // The refusal survives and the reason moved. `DayInput.settlements` exists,
    // so the engine is no longer what is missing; what is missing is any way for
    // a fixture to state the five fields `SettlementFact` declares. Inventing
    // them here would be the loader writing a fixture.
    const dir = seedbed();
    editYaml(dir, (b) => b.replace('settlements: []', 'settlements:\n  - ordinal: 1'));
    const error = refusal(dir);
    expect(error.rule).toBe('L-11');
    expect(error.message).toContain('basis_trading_day');
  });

  test('L-13 a source citing nothing at all, which is ADR-048 case 4', () => {
    // THE VACUITY CASE, AND IT IS THE REASON THIS RULE IS ADR-048'S STATED
    // PREREQUISITE. "Every rule this fixture cites is implemented" is trivially
    // true of a fixture that cites none, so without this refusal such a fixture
    // flips to `direct` against an engine that implements nothing.
    const dir = seedbed();
    editYaml(dir, (b) => b.replace(/^source: .*$/m, 'source: the floor rule'));
    expect(refusal(dir).rule).toBe('L-13');
  });

  test('L-13 a source citing an identifier M01 does not define', () => {
    const dir = seedbed();
    editYaml(dir, (b) => b.replace(/^source: .*$/m, 'source: M01 R-99'));
    const error = refusal(dir);
    expect(error.rule).toBe('L-13');
    expect(error.message).toContain('R-99');
  });

  test('L-13 resolves against what M01 DEFINES, not what it mentions', () => {
    // The half a mention-anywhere query would lose. `RE-U-019` and `ADR-048`
    // both contain two digits after a letter and a dash, and neither is a
    // citation; a fixture whose source named only those cites no rule.
    expect(citedIdentifiers('RE-U-019, ADR-048, GS-011')).toEqual([]);
    expect(citedIdentifiers('M01 R-13, R-18')).toEqual(['R-13', 'R-18']);
    expect(citedIdentifiers('M01 CV-01 and INV-06')).toEqual(['CV-01', 'INV-06']);
  });

  test('L-12 a file outside the YAML subset', () => {
    const dir = seedbed();
    editYaml(dir, (b) => `${b}\tphase: funded\n`);
    const error = refusal(dir);
    expect(error.rule).toBe('L-12');
    expect(error.message).toContain('tab character');
  });
});

// -----------------------------------------------------------------------------
// The whole chain, end to end, against the engine as it actually is
// -----------------------------------------------------------------------------

describe('a fixture folded through the engine', () => {
  test('MATCHES, which it could not do while the fold was the identity stub', () => {
    // This assertion used to read the other way and list five fields the stub
    // did not produce, `floor_cents` among them, with the message "the engine
    // result carries no floorCents". `runFixture` folded `evaluate`, which
    // returns `{ newState: input.accountState, events: [] }`, so the thirty
    // fixtures diffed an identity function and CI-03's end-to-end half was
    // vacuous (ADR-038).
    //
    // GS-011 pins that the trailing floor does not trail on an intraday spike
    // (R-13, R-15), and folding its one day through `advanceDay` now produces
    // exactly the state the fixture states.
    const dir = seedbed();
    const fixture = loadFixture(yamlPath(dir), { fixtureDir: dir, registry: REGISTRY });
    const { diffs, assertions } = runFixture(fixture);

    expect(assertions).toEqual([]);
    expect(diffs.map(describeDiff)).toEqual([]);
  });

  test('and FAILS on a corrupted expectation, through the whole chain', () => {
    // The half that has to survive the flip. A stage that matches is worth
    // nothing without the paired proof that it would not have matched a wrong
    // number, and taking it through the real path rather than through
    // `diffEndState` alone is what makes it a statement about the loader:
    // read the file, resolve the plan and the calendar, build the slice, fold
    // the day stream, diff.
    const dir = seedbed();
    editExpectation(dir, (e) => ({
      ...e,
      // One cent, on the field the scenario exists to pin.
      end_state: { ...(e['end_state'] as Record<string, unknown>), floor_cents: 4_770_001 },
    }));
    const fixture = loadFixture(yamlPath(dir), { fixtureDir: dir, registry: REGISTRY });
    const { diffs } = runFixture(fixture);

    expect(diffs.map(describeDiff)).toEqual([
      'floor_cents: expected 4770001, engine produced 4770000n',
    ]);
  });
});

// -----------------------------------------------------------------------------
// The directory loader
// -----------------------------------------------------------------------------

describe('loadFixtureDirectory', () => {
  test('reports every bad fixture rather than stopping at the first', () => {
    const dir = seedbed();
    editYaml(dir, (b) => b.replace('id: GS-011', 'id: GS-012'));
    cpSync(yamlPath(dir), join(dir, 'GS-011-second-copy.yaml'));
    cpSync(join(dir, `${GS_011}.expected.json`), join(dir, 'GS-011-second-copy.expected.json'));

    const { fixtures, failures } = loadFixtureDirectory({ fixtureDir: dir, registry: REGISTRY });
    expect(fixtures).toHaveLength(0);
    expect(failures.map((f) => f.error.rule)).toEqual(['L-01', 'L-01']);
  });

  test('the awaiting-input list cannot rot into an excuse nobody is still making', () => {
    // Every entry names a fixture field the engine's types have no home for. An
    // entry no fixture uses is an admission nobody is making, and leaving it in
    // place is how a temporary exception becomes permanent.
    const { fixtures } = loadFixtureDirectory();
    expect(unusedAwaitingEntries(fixtures)).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// The registry
// -----------------------------------------------------------------------------

describe("M01's identifier space, which is what L-13 resolves against", () => {
  test('every rule, config validation and invariant runs 1..n with no holes', () => {
    // NOT A COUNT, for the same reason the registry contiguity case is not one.
    // Contiguity is the structural property, and it is what makes the leading
    // table cell a trustworthy definition query: a series with a hole in it is
    // a series the query stopped reading, not a document with a missing rule.
    const m01 = m01Identifiers();
    for (const prefix of ['R', 'CV', 'INV']) {
      const numbers = [...m01]
        .filter((id) => id.startsWith(`${prefix}-`))
        .map((id) => Number(id.slice(prefix.length + 1)))
        .sort((a, b) => a - b);
      expect(numbers.length).toBeGreaterThan(0);
      expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    }
  });

  test('every fixture on the tree already cites a resolvable identifier', () => {
    // The positive control for L-13. A rule that refuses everything passes every
    // seeded case above and is useless; this is the other direction, over the
    // real directory rather than over the seedbed's one fixture.
    const { fixtures, failures } = loadFixtureDirectory();
    expect(failures.map((f) => f.error.message)).toEqual([]);
    expect(fixtures.filter((f) => citedIdentifiers(f.source).length === 0)).toEqual([]);
  });
});

describe('the golden scenario registry', () => {
  test('is contiguous from GS-001 with no holes', () => {
    // DELIBERATELY NOT A COUNT. STRATEGY section 4.4's own rule is that a
    // quantity a script can derive does not get stated by hand, and this file
    // would be the fourteenth place to state one. Contiguity is the structural
    // property; `gs_count` in scripts/corpus/gates.mjs is where the number
    // lives.
    const numbers = [...REGISTRY].map((id) => Number(id.slice(3))).sort((a, b) => a - b);
    expect(numbers[0]).toBe(1);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });
});
