import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, test } from 'vitest';

import {
  FIXTURE_DIR,
  FixtureError,
  describeDiff,
  loadFixture,
  loadFixtureDirectory,
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
    expect(fixture.input.dayMarks).toHaveLength(1);
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

  test('L-11 a non-zero adjustment, which has nowhere to go', () => {
    const dir = seedbed();
    editYaml(dir, (b) => b.replace('adjustment_cents: 0', 'adjustment_cents: 5000'));
    expect(refusal(dir).rule).toBe('L-11');
  });

  test('L-11 a settlement, which has nowhere to go either', () => {
    const dir = seedbed();
    editYaml(dir, (b) => b.replace('settlements: []', 'settlements:\n  - ordinal: 1'));
    expect(refusal(dir).rule).toBe('L-11');
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
  test('reports a mismatch on every field the fixture pins and the stub does not produce', () => {
    // This is the loader's own answer to "prove it FAILS when an expected end
    // state does not match", taken through the real path rather than through
    // the diff function alone: read the file, resolve the plan and the
    // calendar, call the engine's public entry point, diff.
    const dir = seedbed();
    const fixture = loadFixture(yamlPath(dir), { fixtureDir: dir, registry: REGISTRY });
    const { diffs } = runFixture(fixture);

    expect(diffs.map((d) => d.field)).toEqual([
      'phase',
      'floor_cents',
      'high_water_balance_cents',
      'breached',
      'events',
    ]);
    expect(describeDiff(diffs[1] as never)).toContain('the engine result carries no "floorCents"');
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
