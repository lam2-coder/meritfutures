import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  CONVENTION,
  REFUSAL_RULE,
  SCOPED_DB,
  derive,
  legAbsences,
  legBuilderRoster,
  legCallgraph,
  legConventionShared,
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

/** Every finding, from every leg over the accessor, on one derived tree. */
function findingsFor(path: string): string[] {
  const derived = derive(path);
  return [
    ...legGuardRoster(derived).findings,
    ...legBuilderRoster(derived).findings,
    ...legMatrix(derived).findings,
    ...legAbsences(derived).findings,
    ...legCallgraph(derived).findings,
  ];
}

/**
 * The lint rule, mutated, written where only this suite can see it.
 *
 * SEPARATE FROM `seeded` BECAUSE THE FILE IS SEPARATE AND HAS ANOTHER OWNER.
 * Leg F reads `refusal-naming.js`, which this package does not own and which
 * concurrent work edits; every case below mutates a COPY for that reason and the
 * real file is opened read-only, once, here.
 */
const REAL_RULE = readFileSync(REFUSAL_RULE, 'utf8');

function seededRule(mutate: (source: string) => string): string {
  const source = mutate(REAL_RULE);
  expect(source, 'the seed did not match the lint rule and the case would be vacuous').not.toBe(
    REAL_RULE,
  );
  const path = join(mkdtempSync(join(tmpdir(), 'merit-guard-rule-')), 'refusal-naming.js');
  writeFileSync(path, source);
  return path;
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

describe('leg E, the callgraph out of a builder', () => {
  // ADR-459 SECTION 9 ITEM 1. The leg keys on BEING CALLED BY A BUILDER, so the
  // cases below move each of its three terms in turn and read which of them was
  // load-bearing. A leg whose terms have not each been falsified separately is a
  // leg that might be passing on one of them.

  test('a throwing helper reached from a builder under a non-verb name is named', () => {
    // THE ARRIVAL ITEM 1 IS ABOUT. It returns a value, so `refusal-naming.js`
    // does not see it; it is not named `refuse*`, so legs A and D do not; and
    // the throw is in its own body rather than the builder's, so leg C does not.
    const path = seeded(
      (s) =>
        s.replace(
          '  refuseTermInValues(key, values);\n  return source\n    .update(',
          '  refuseTermInValues(key, values);\n  values = checkedValues(values);\n  return source\n    .update(',
        ) +
        '\nfunction checkedValues(values: WriteValues): WriteValues {\n' +
        "  if (values.x === 1) throw new Error('no');\n  return values;\n}\n",
    );
    const findings = legCallgraph(derive(path)).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('checkedValues');
    expect(findings[0]).toContain('updateStatementOn');
    expect(findings[0]).toContain('does not match');
  });

  test('the same helper named to the convention is not a finding, which is the escape route the leg offers', () => {
    // THE POINT OF THE LEG IS NOT TO CONVICT, IT IS TO MAKE THE ARRIVAL VISIBLE
    // TO THE OTHER LEGS. Renaming it moves it into leg A's roster, where it goes
    // red for a better reason, so this case asserts leg E is silent AND that leg
    // A has picked it up.
    const path = seeded(
      (s) =>
        s.replace(
          '  refuseTermInValues(key, values);\n  return source\n    .update(',
          '  refuseTermInValues(key, values);\n  values = refuseCheckedValues(values);\n  return source\n    .update(',
        ) +
        '\nfunction refuseCheckedValues(values: WriteValues): WriteValues {\n' +
        "  if (values.x === 1) throw new Error('no');\n  return values;\n}\n",
    );
    const derived = derive(path);
    expect(legCallgraph(derived).findings).toEqual([]);
    expect(legGuardRoster(derived).findings.some((f) => f.includes('refuseCheckedValues'))).toBe(
      true,
    );
  });

  test('a helper that does NOT throw is not a finding, which is the term that keeps the leg off every ordinary call', () => {
    const path = seeded(
      (s) =>
        s.replace(
          '  refuseTermInValues(key, values);\n  return source\n    .update(',
          '  refuseTermInValues(key, values);\n  values = tidiedValues(values);\n  return source\n    .update(',
        ) + '\nfunction tidiedValues(values: WriteValues): WriteValues {\n  return values;\n}\n',
    );
    expect(legCallgraph(derive(path)).findings).toEqual([]);
  });

  test('a builder calling another builder is not a finding, because that is leg B and leg C', () => {
    const path = seeded((s) =>
      s.replace(
        '  refuseTermInValues(key, values);\n  return source\n    .update(',
        '  refuseTermInValues(key, values);\n  void deleteStatementOn;\n  return source\n    .update(',
      ),
    );
    // `deleteStatementOn` throws nothing today, so the reference alone proves
    // little. The real assertion is the general one: no derived builder appears
    // in any other builder's thrower list.
    const derived = derive(path);
    const builderNames = new Set(derived.builders.map((b) => b.name));
    for (const builder of derived.builders) {
      for (const name of builder.throwers) expect(builderNames.has(name)).toBe(false);
    }
  });

  test('a declared non-guard the code no longer reaches is reported as stale, not left to rot', () => {
    // The declaration and the code are two statements and this is the leg that
    // notices they have stopped agreeing. Renaming the callee does both halves
    // at once: `bothOf` becomes unreachable and a new undeclared thrower arrives.
    const path = seeded((s) => s.replaceAll('bothOf(', 'bothOfPresent('));
    const findings = legCallgraph(derive(path)).findings;
    expect(findings.some((f) => f.includes('"bothOf"') && f.includes('stale'))).toBe(true);
    expect(findings.some((f) => f.includes('"bothOfPresent"'))).toBe(true);
  });

  test('the three non-conforming throwers this leg found on the real tree are still the three, and all three are declared', () => {
    // THE MEASUREMENT THAT DECIDED THE LEG'S DISPOSITION, PINNED. ADR-462 argues
    // from exactly this set: the priced wording would be red on all three, and
    // all three are legitimate. A fourth arriving is the finding, and it should
    // arrive as a leg E finding rather than as a surprise in this list.
    const derived = derive(SCOPED_DB);
    const reached = [...new Set(derived.builders.flatMap((b) => b.throwers))].sort();
    const nonConforming = reached.filter((name) => !CONVENTION.test(name));
    expect(nonConforming).toEqual(['bothOf', 'columnByName', 'scopePredicate']);
    expect(legCallgraph(derived).findings).toEqual([]);
  });
});

describe('leg F, the convention is one literal written in two files', () => {
  // ADR-459 SECTION 9 ITEM 2. The rule file has another owner, so the cases here
  // pin BOTH halves of the contract: that a lost literal is red, and that an
  // ordinary edit which merely MOVES it is not.

  test('the real lint rule carries the literal this checker matches with', () => {
    const result = legConventionShared();
    expect(result.present).toBe(true);
    expect(result.findings).toEqual([]);
  });

  test('a rule file that has lost the literal goes red', () => {
    const path = seededRule((s) =>
      s.replace('const CONVENTION = /^refuse[A-Z]/;', 'const CONVENTION = /^deny[A-Z]/;'),
    );
    const findings = legConventionShared(path).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('leg F');
    expect(findings[0]).toContain('stopped agreeing');
  });

  test('a rule file whose literal is COMMENTED OUT goes red, which a raw-text search would call green', () => {
    // `RI-25`'s LESSON, EXECUTED. That check's first version reported PASS with
    // the call it asserts commented out. Commenting the convention out loses it
    // exactly as surely as deleting it, and the stripper is what sees that.
    const path = seededRule((s) =>
      s.replace('const CONVENTION = /^refuse[A-Z]/;', '// const CONVENTION = /^refuse[A-Z]/;'),
    );
    expect(readFileSync(path, 'utf8')).toContain('/^refuse[A-Z]/');
    expect(legConventionShared(path).findings).toHaveLength(1);
  });

  test('a rule file where the literal has MOVED is green, which is the whole reason this leg keys on presence', () => {
    // THE COUPLING THIS LEG WAS BUILT AROUND. Other work edits that file and may
    // move this line. A leg keyed on the line number, the file length or a hash
    // would turn that work red for doing what it was asked to do, and this case
    // is what stops a later session tightening leg F into exactly that.
    const path = seededRule((s) => `// a line added above everything\n${s}\n// and one below\n`);
    expect(legConventionShared(path).present).toBe(true);
    expect(legConventionShared(path).findings).toEqual([]);
  });

  test('a rule file that cannot be read is a finding rather than a crash', () => {
    const findings = legConventionShared(join(tmpdir(), 'merit-no-such-refusal-rule.js')).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('could not be read');
  });
});

describe('the runner', () => {
  test('takes no argument, because every input it has is derived', () => {
    expect(run(['--fix'])).toBe(2);
  });
});
