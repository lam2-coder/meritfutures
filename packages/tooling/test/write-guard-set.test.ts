import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  SCOPED_DB,
  derive,
  legAbsences,
  legBuilderRoster,
  legGuardRoster,
  legMatrix,
  run,
} from '../checks/write-guard-set.mjs';

// =============================================================================
// EVERY LEG IS WATCHED FAILING, AND THE MOTIVATING FAILURE IS WATCHED BY NAME
// =============================================================================
// `ADR-448` section 8 item 5 names one failure: a fourth refusal rule arrives on
// the money-path update builder, goes into ONE place, and nothing notices it is
// missing from another. `leg D, the motivating failure` below is that exact
// sentence executed. The rest of the cases are here because a leg nobody has
// seen red is a leg nobody knows the shape of.
//
// THE SEEDS ARE APPLIED TO A COPY AND NEVER TO THE TREE. `derive` takes a path
// for this reason and for no other. Every mutation below is asserted to have
// APPLIED before its finding is read, because a seed that silently failed to
// match would leave a case that passes by testing nothing, which is the failure
// mode this whole file exists to rule out.
// =============================================================================

const REAL = readFileSync(SCOPED_DB, 'utf8');

/** The real accessor, mutated, written where only this suite can see it. */
function seeded(mutate: (source: string) => string): string {
  const source = mutate(REAL);
  // A SEED THAT DID NOT APPLY IS A CASE THAT ASSERTS NOTHING.
  expect(source, 'the seed did not match the accessor and the case would be vacuous').not.toBe(
    REAL,
  );
  const path = join(mkdtempSync(join(tmpdir(), 'merit-guard-set-')), 'scoped-db.ts');
  writeFileSync(path, source);
  return path;
}

/** Every finding, from every leg, over one derived tree. */
function findingsFor(path: string): string[] {
  const derived = derive(path);
  return [
    ...legGuardRoster(derived).findings,
    ...legBuilderRoster(derived).findings,
    ...legMatrix(derived).findings,
    ...legAbsences(derived).findings,
  ];
}

/** The three guards on the money-path update builder, in the source's spelling. */
const UPDATE_GUARDS = ['refuseGeneratedColumn', 'refuseTenancyColumn', 'refuseTermInValues'];

describe('the tree it runs against', () => {
  test('is green, and the check exits 0 on it', () => {
    expect(findingsFor(SCOPED_DB)).toEqual([]);
    expect(run()).toBe(0);
  });

  test('is green on a byte-identical copy, which is the control every seed is read against', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'merit-guard-control-')), 'scoped-db.ts');
    writeFileSync(path, REAL);
    expect(readFileSync(path, 'utf8')).toBe(REAL);
    expect(findingsFor(path)).toEqual([]);
  });

  test('carries the three guards ADR-448 section 8 item 5 names, and no fourth', () => {
    // WRITTEN OUT RATHER THAN DERIVED, and this is the one place in this file
    // that is. The three names ARE the claim that entry makes; reading them back
    // off the same fold the checker runs would assert only that the fold is
    // deterministic. ADR-458 re-derived them from source before pinning them.
    const update = derive().builders.find((builder) => builder.name === 'updateStatementOn');
    expect(update?.guards).toEqual(UPDATE_GUARDS);
  });

  test('runs its guards over more builders than the one that entry names', () => {
    // The item speaks about `updateStatementOn`. The check covers every builder
    // that constructs a write, because a guard is missing from a builder
    // relative to the OTHER builders and not in the absolute.
    const derived = derive();
    expect(derived.builders.map((builder) => builder.name)).toContain('updateStatementOn');
    expect(derived.builders.length).toBeGreaterThan(1);
    expect(derived.guards).toEqual(expect.arrayContaining(UPDATE_GUARDS));
  });
});

describe('leg A, the guard roster is closed', () => {
  test('a refusal rule that arrives is named, and the roster is told to absorb it', () => {
    const path = seeded(
      (s) =>
        `${s}\nfunction refuseCurrencyColumn(key: TableKey, values: WriteValues): void {\n` +
        '  throw new Error(`${key} ${String(values)}`);\n}\n',
    );
    const findings = legGuardRoster(derive(path)).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('refuseCurrencyColumn');
    expect(findings[0]).toContain('A refusal rule has arrived');
  });

  test('a refusal rule that is renamed away is named too', () => {
    const path = seeded((s) =>
      s.replace('function refuseTermInValues(', 'function refuseTermsInValues('),
    );
    const findings = legGuardRoster(derive(path)).findings;
    expect(findings.some((f) => f.includes('`refuseTermsInValues` is declared'))).toBe(true);
    expect(findings.some((f) => f.includes('no longer declared'))).toBe(true);
  });
});

describe('leg B, the builder roster is closed', () => {
  test('a new builder that constructs a write with no guards at all is caught', () => {
    const path = seeded(
      (s) =>
        `${s}\nexport function sneakyInsertStatement(\n` +
        '  source: StatementSource,\n  key: TableKey,\n  values: WriteValues,\n): unknown {\n' +
        '  return source.insert(TABLES[key] as PgTable).values(values);\n}\n',
    );
    const findings = legBuilderRoster(derive(path)).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('sneakyInsertStatement');
    expect(findings[0]).toContain('constructs a write and is not pinned');
  });

  test('a pinned builder that stops constructing a write is caught', () => {
    const path = seeded((s) =>
      s.replace('function deleteStatementOn(', 'function deleteStatementElsewhere('),
    );
    const findings = legBuilderRoster(derive(path)).findings;
    expect(findings.some((f) => f.includes('`deleteStatementOn` is pinned'))).toBe(true);
  });
});

describe('leg C, the matrix is pinned', () => {
  test('a guard dropped from statement position goes red', () => {
    const path = seeded((s) =>
      s.replace(
        '  refuseTenancyColumn(key, values);\n  refuseTermInValues(key, values);\n  return source\n    .update(',
        '  refuseTenancyColumn(key, values);\n  return source\n    .update(',
      ),
    );
    const findings = legMatrix(derive(path)).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('updateStatementOn');
    expect(findings[0]).toContain('refuseTermInValues');
  });

  test('a guard dropped from the `.set(...)` ARGUMENT goes red, which is the shape a matcher keyed on statement position would miss', () => {
    // `refuseGeneratedColumn` is the most recently added of the three and the
    // only one that is not a statement. scoped-db.ts's own header says that
    // shape is forced by the citation constraint rather than chosen, so the
    // NEXT guard is more likely to look like this one than like the other two.
    const path = seeded((s) =>
      s.replace('.set(refuseGeneratedColumn(key, values))', '.set(values)'),
    );
    const findings = legMatrix(derive(path)).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('refuseGeneratedColumn');
  });

  test('a refusal added INLINE rather than as a named guard goes red on the throw count', () => {
    const path = seeded((s) =>
      s.replace(
        '  refuseTermInValues(key, values);\n  return source\n    .update(',
        "  refuseTermInValues(key, values);\n  if (values.x === 1) throw new Error('no');\n  return source\n    .update(",
      ),
    );
    const findings = legMatrix(derive(path)).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('throws 1 refusal(s) inline and is pinned at 0');
  });
});

describe('leg D, the motivating failure', () => {
  test('a fourth rule added to ONE builder names every builder it was not added to', () => {
    // ADR-448 SECTION 8 ITEM 5, EXECUTED. The rule goes into
    // `scopedInsertStatement` and nowhere else, which is precisely "puts it in
    // one place, and nothing notices it is missing from another".
    const path = seeded(
      (s) =>
        s.replace(
          '  refuseTenancyColumn(key, values);\n  refuseTermInValues(key, values);\n  const table = TABLES[key] as PgTable;',
          '  refuseTenancyColumn(key, values);\n  refuseTermInValues(key, values);\n' +
            '  refuseCurrencyColumn(key, values);\n  const table = TABLES[key] as PgTable;',
        ) +
        '\nfunction refuseCurrencyColumn(key: TableKey, values: WriteValues): void {\n' +
        '  throw new Error(`${key} ${String(values)}`);\n}\n',
    );
    const derived = derive(path);
    const findings = legAbsences(derived).findings;

    // EVERY OTHER BUILDER IS NAMED, and the money-path update builder is one of
    // them. That is the whole of the property this row was opened for.
    const missing = derived.builders
      .filter((builder) => !builder.guards.includes('refuseCurrencyColumn'))
      .map((builder) => builder.name);
    expect(missing).toContain('updateStatementOn');
    expect(findings).toHaveLength(missing.length);
    for (const name of missing) {
      expect(findings.some((f) => f.includes(`"${name}::refuseCurrencyColumn"`))).toBe(true);
    }
  });

  test('a declared absence that the code has since closed is reported as stale', () => {
    // THE SEED MOVED AND THE PROPERTY DID NOT. This case used to close the
    // `OPEN` cell ADR-458 section 6 records; ADR-460 closed that cell FOR REAL,
    // so seeding it now finds no declaration to contradict and the case would
    // assert nothing. It seeds a SETTLED cell instead, which is the same
    // mechanism over the class of reason this tree has most of. The check does
    // not celebrate a closed absence: it says the declaration now contradicts
    // the code and asks for it to be deleted.
    const path = seeded((s) =>
      s.replace(
        '  refuseTermInValues(key, values);\n  return source.insert(TABLES[key] as PgTable).values(values);',
        '  refuseTenancyColumn(key, values);\n  refuseTermInValues(key, values);\n  return source.insert(TABLES[key] as PgTable).values(values);',
      ),
    );
    const findings = legAbsences(derive(path)).findings;
    expect(
      findings.some(
        (f) => f.includes('unscopedInsertStatement::refuseTenancyColumn') && f.includes('stale'),
      ),
    ).toBe(true);
  });

  test('the cell ADR-458 section 6 opened is closed in the tree, and nothing declares it absent', () => {
    // ADR-460 IS PINNED HERE RATHER THAN ONLY IN THE MATRIX. Leg C would go red
    // if the guard were removed from the builder, and this says the other half:
    // no reason may be declared for an absence that is not there. Re-adding the
    // deleted `OPEN` cell without removing the call reddens this and leg D both.
    const derived = derive(SCOPED_DB);
    const builder = derived.builders.find((b) => b.name === 'insertUnderStatement');
    expect(builder?.guards).toContain('refuseTermInValues');
    expect(legAbsences(derived).findings).toEqual([]);
  });
});

describe('the runner', () => {
  test('takes no argument, because every input it has is derived', () => {
    expect(run(['--fix'])).toBe(2);
  });
});
