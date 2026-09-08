import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  BUDGET,
  ENUMERATORS,
  MEASURE_CHILD,
  REPO_ROOT,
  ROUNDS,
  SELF,
  bodyBrace,
  callsIn,
  carriersOf,
  census,
  enumerates,
  exportedSurface,
  foldPath,
  functions,
  grewWithTheTree,
  isTreeDirectory,
  legBudgetCarried,
  legBudgetEarned,
  legDerivationIsReal,
  legMeasurementIsReal,
  legRosterIsComplete,
  legRosterIsMeasured,
  measure,
  measuredSummary,
  measuredVerdicts,
  measurementPatch,
  measurementPlan,
  readSource,
  run,
} from '../checks/tree-input-budget.mjs';
import type { Verdict } from '../checks/tree-input-budget.mjs';
import { CORPUS_SCAN_MS } from './scan-budget.js';

// =============================================================================
// EVERY LEG IS WATCHED FAILING, AND BOTH DIRECTIONS OF THE DISCRIMINATION TOO
// =============================================================================
// `ADR-470`. The check says a case whose input is this repository carries a
// budget sized against this repository. A check that only ever says YES has not
// been shown to be reading anything, so every case below is a pair: a fixture
// this fold must place IN the population, and the smallest edit to it that must
// take it OUT.
//
// THE FALSE POSITIVES ARE THE HARDER HALF AND THEY ARE NAMED BY SOURCE.
// `ADR-468` section 3.2 found four kinds of thing that LOOK like a walk and are
// not: a signature default nobody uses, a CLI called with an argument so it
// returns before reading, a defaulted parameter that names two FILES, and a
// named read under the tree root. Each has its own case here, because a check
// that flags them is worse than no check: it teaches a reader to paste a
// sixty-second wall onto a case whose input is two files.
//
// THE FIXTURES ARE WRITTEN OUTSIDE THE REPOSITORY AND NAME IT BY VALUE. A
// fixture cannot compute this repository's root from its own location, so it
// carries the root as a literal. That is not a workaround, it is the property
// under test: the fold reads a VALUE and never an identifier, and not one
// fixture below spells `REPO_ROOT`.
// =============================================================================

/** A real directory of this repository, and a real file in it. */
const DIR = join(REPO_ROOT, 'packages');
const FILE = join(REPO_ROOT, 'package.json');

/**
 * A checks directory and a suite directory, written where only this suite can
 * see them. Keys are `checks/<name>.mjs` and `test/<name>.test.ts`.
 */
function fixture(files: Record<string, string>): { suite: string; checks: string } {
  const root = mkdtempSync(join(tmpdir(), 'merit-tree-budget-'));
  mkdirSync(join(root, 'checks'));
  mkdirSync(join(root, 'test'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body);
  return { suite: join(root, 'test'), checks: join(root, 'checks') };
}

/** The population this fold derives over a fixture, as `line:budgeted` strings. */
function population(files: Record<string, string>): string[] {
  const { suite, checks } = fixture(files);
  return census(suite, checks)
    .cases.filter((one) => one.why.length > 0)
    .map((one) => `${one.title}:${one.budgeted ? 'budgeted' : 'bare'}`);
}

/** Every finding, from both reporting legs, over a fixture. */
function findingsFor(files: Record<string, string>): string[] {
  const { suite, checks } = fixture(files);
  const seen = census(suite, checks);
  return [...legBudgetCarried(seen.cases), ...legBudgetEarned(seen.cases)];
}

/** A checker whose parameter defaults to a directory of this repository. */
const WALKER = `
import { readdirSync } from 'node:fs';
export function sweep(root = '${DIR}') {
  return readdirSync(root);
}
export function run(argv = []) {
  if (argv.length > 0) return 2;
  return sweep().length > 0 ? 0 : 1;
}
`;

/** A checker whose parameter defaults to a FILE, so it is not a walk. */
const READER = `
import { readFileSync } from 'node:fs';
export const ROOT = '${DIR}';
export function readOne(path = '${FILE}') {
  return readFileSync(path, 'utf8');
}
`;

const IMPORT_BUDGET = 'const CORPUS_SCAN_MS = 60000;\n';

// -----------------------------------------------------------------------------

describe('the tree it runs against', () => {
  test(
    'is green, and the population is neither empty nor everything',
    () => {
      const seen = census();
      const inside = seen.cases.filter((one) => one.why.length > 0);
      expect(legBudgetCarried(seen.cases)).toEqual([]);
      expect(legBudgetEarned(seen.cases)).toEqual([]);
      expect(run()).toBe(0);

      // DERIVED AND NOT PINNED. A number typed here is a second copy of a
      // measurement, and rows land beside this one. What is asserted is the
      // SHAPE: the population is real, it is a minority of the suite, and it
      // spans files rather than sitting in one.
      expect(inside.length).toBeGreaterThan(20);
      expect(inside.length).toBeLessThan(seen.cases.length / 2);
      expect(new Set(inside.map((one) => one.file)).size).toBeGreaterThan(5);
    },
    CORPUS_SCAN_MS,
  );

  test(
    'reads all three forms on this repository, so none of them is dead code',
    () => {
      // ADR-468 SECTION 3.2 IS THE WHOLE REASON THIS CASE EXISTS. Three of the
      // eight files that walk this tree name `REPO_ROOT` nowhere, so a fold that
      // had quietly stopped reading forms 2 and 3 would still find most of the
      // population and would miss three whole files.
      const seen = census();
      expect(seen.forms.W1).toBeGreaterThan(0);
      expect(seen.forms.W2).toBeGreaterThan(0);
      expect(seen.forms.W3).toBeGreaterThan(0);
    },
    CORPUS_SCAN_MS,
  );

  test(
    'the population is not a `REPO_ROOT` grep, and the difference is measured',
    () => {
      // THE PREDICATE ADR-466 PRICED AND ADR-468 FALSIFIED, run beside this one.
      // If the two ever agree, this fold has stopped folding values.
      const seen = census();
      const inside = new Set(seen.cases.filter((one) => one.why.length > 0).map((c) => c.file));
      const named = new Set(
        seen.files.filter((file) => readSource(join(REPO_ROOT, file)).kept.includes('REPO_ROOT')),
      );
      const missedByGrep = [...inside].filter((file) => !named.has(file));
      expect(missedByGrep.length).toBeGreaterThanOrEqual(3);
    },
    CORPUS_SCAN_MS,
  );

  test(
    'it takes no argument, because every input it has comes off the tree',
    () => {
      const lines: string[] = [];
      expect(run(['--fix'], (line) => lines.push(line))).toBe(2);
      expect(lines[0]).toContain('usage:');
    },
    CORPUS_SCAN_MS,
  );
});

// -----------------------------------------------------------------------------
// LEG B: THE SUBJECT
// -----------------------------------------------------------------------------

describe('leg B, the motivating failure', () => {
  test('a case that walks the tree and carries no budget is named', () => {
    const findings = findingsFor({
      'checks/sweep.mjs': WALKER,
      'test/a.test.ts': `
import { sweep } from '../checks/sweep.mjs';
test('the thirty-fourth case', () => {
  expect(sweep()).toBeDefined();
});
`,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('the thirty-fourth case');
    expect(findings[0]).toContain(`carries no ${BUDGET}`);
  });

  test('the same case with the budget is silent, and that is the only edit', () => {
    expect(
      findingsFor({
        'checks/sweep.mjs': WALKER,
        'test/a.test.ts': `${IMPORT_BUDGET}
import { sweep } from '../checks/sweep.mjs';
test('the thirty-fourth case', () => {
  expect(sweep()).toBeDefined();
}, CORPUS_SCAN_MS);
`,
      }),
    ).toEqual([]);
  });

  test('a `test.each` table carries its budget as the third argument of the second call', () => {
    const files = (timeout: string) => ({
      'checks/sweep.mjs': WALKER,
      'test/a.test.ts': `${IMPORT_BUDGET}
import { sweep } from '../checks/sweep.mjs';
test.each([['one'], ['two']])('%s generated', () => {
  expect(sweep()).toBeDefined();
}${timeout});
`,
    });
    expect(findingsFor(files(''))).toHaveLength(1);
    expect(findingsFor(files(', CORPUS_SCAN_MS'))).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// LEG C: THE REVERSE, WITHOUT WHICH LEG B IS SATISFIED BY PASTING
// -----------------------------------------------------------------------------

describe('leg C, a budget nothing earned', () => {
  test('a fixture case carrying the budget is named', () => {
    const findings = findingsFor({
      'checks/reader.mjs': READER,
      'test/a.test.ts': `${IMPORT_BUDGET}
import { readOne } from '../checks/reader.mjs';
test('reads one named file', () => {
  expect(readOne()).toBeDefined();
}, CORPUS_SCAN_MS);
`,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(`carries ${BUDGET}`);
    expect(findings[0]).toContain('finds no walk');
  });
});

// -----------------------------------------------------------------------------
// THE THREE FORMS A ROOT REACHES A CASE IN
// -----------------------------------------------------------------------------

describe('form 1, an imported constant, read by value and never by name', () => {
  test('the constant may be spelled anything at all', () => {
    // `price-register.mjs` spells its root `DECISIONS`, which is why the name is
    // not the key. The fixture calls it `WHEREVER` to make that unarguable.
    expect(
      population({
        'checks/sweep.mjs': `
import { readdirSync } from 'node:fs';
export const WHEREVER = '${DIR}';
export function sweep(root) {
  return readdirSync(root);
}
`,
        'test/a.test.ts': `
import { WHEREVER, sweep } from '../checks/sweep.mjs';
test('walks', () => {
  expect(sweep(WHEREVER)).toBeDefined();
});
`,
      }),
    ).toEqual(['walks:bare']);
  });
});

describe('form 2, a root computed locally, which no import reaches', () => {
  test('a root the file builds for itself is still a root', () => {
    expect(
      population({
        'checks/sweep.mjs': `
import { readdirSync } from 'node:fs';
export function sweep(root) {
  return readdirSync(root);
}
`,
        'test/a.test.ts': `
import { join } from 'node:path';
import { sweep } from '../checks/sweep.mjs';
const HOME = join('${REPO_ROOT}', 'packages');
test('walks', () => {
  expect(sweep(HOME)).toBeDefined();
});
`,
      }),
    ).toEqual(['walks:bare']);
  });
});

describe('form 3, a default parameter, with nothing at the call site to see', () => {
  test('a call with no root argument at all is a walk', () => {
    expect(
      population({
        'checks/sweep.mjs': WALKER,
        'test/a.test.ts': `
import { sweep } from '../checks/sweep.mjs';
test('walks', () => {
  expect(sweep()).toBeDefined();
});
`,
      }),
    ).toEqual(['walks:bare']);
  });

  test('the same call with a fixture root overriding the default is not', () => {
    expect(
      population({
        'checks/sweep.mjs': WALKER,
        'test/a.test.ts': `
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { sweep } from '../checks/sweep.mjs';
test('does not walk this tree', () => {
  expect(sweep(mkdtempSync(tmpdir()))).toBeDefined();
});
`,
      }),
    ).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// THE FOUR FALSE POSITIVES ADR-468 SECTION 3.2 FOUND, EACH WATCHED STAYING OUT
// -----------------------------------------------------------------------------

describe('what looks like a walk and is not', () => {
  test('a signature default nobody uses names the root and scans nothing', () => {
    // `transcript(checks, root = REPO_ROOT)` in `repo-invariants.test.ts`, whose
    // fixtures ignore the root entirely. ADR-468 section 10 item 6 calls it the
    // single most misleading `REPO_ROOT` in the suite.
    expect(
      population({
        'checks/sweep.mjs': WALKER,
        'test/a.test.ts': `
const HOME = '${DIR}';
const transcript = (checks, root = HOME) => checks.map((c) => c.run(root));
test('runs fixtures and reads no directory', () => {
  expect(transcript([{ run: () => [] }])).toEqual([[]]);
});
`,
      }),
    ).toEqual([]);
  });

  test('a CLI called WITH an argument returns before it reads anything', () => {
    // `run(['--fix'])` and `run(['--set', 'rcr_bp'], emit)`: the walking function
    // is called and no walk happens. Both spellings of the pair are asserted.
    expect(
      population({
        'checks/sweep.mjs': WALKER,
        'test/a.test.ts': `
import { run } from '../checks/sweep.mjs';
test('empty argv walks', () => {
  expect(run([])).toBe(0);
});
test('no argv walks', () => {
  expect(run()).toBe(0);
});
test('an argument returns first', () => {
  expect(run(['--fix'])).toBe(2);
});
`,
      }),
    ).toEqual(['empty argv walks:bare', 'no argv walks:bare']);
  });

  test('a default that names a FILE is a named read and never a walk', () => {
    // `write-guard-set.mjs`s `derive` and `legConventionShared` default to two
    // named files. Their suite reaches the real tree in every case and walks
    // none of it, at 165ms worst.
    expect(
      population({
        'checks/reader.mjs': READER,
        'test/a.test.ts': `
import { readOne } from '../checks/reader.mjs';
test('reads one file', () => {
  expect(readOne()).toBeDefined();
});
`,
      }),
    ).toEqual([]);
  });

  test('the same root joined to a file is out and joined to a directory is in', () => {
    // THE ONE FOLD THAT SEPARATES THEM IS WHAT IS ON DISK, and this is the case
    // that says so: two calls, one expression apart, decided by `statSync`.
    expect(
      population({
        'checks/sweep.mjs': `
import { readFileSync, readdirSync } from 'node:fs';
export function sweep(root) {
  return readdirSync(root);
}
export function read(path) {
  return readFileSync(path, 'utf8');
}
`,
        'test/a.test.ts': `
import { join } from 'node:path';
import { read, sweep } from '../checks/sweep.mjs';
const HOME = '${REPO_ROOT}';
test('a named read under the root', () => {
  expect(read(join(HOME, 'package.json'))).toBeDefined();
});
test('a walk under the root', () => {
  expect(sweep(join(HOME, 'packages'))).toBeDefined();
});
`,
      }),
    ).toEqual(['a walk under the root:bare']);
  });

  test('a callee this fold has read whole and which enumerates nothing is out', () => {
    // `legPaths(prices, DECISIONS, {})` resolves named targets under a directory
    // and enumerates none of it. Five cases in `price-register.test.ts` do this
    // and every one of them keeps the framework default.
    expect(
      population({
        'checks/sweep.mjs': `
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
export const HOME = '${DIR}';
export function resolveUnder(names, dir) {
  return names.filter((name) => existsSync(resolve(dir, name)));
}
`,
        'test/a.test.ts': `
import { HOME, resolveUnder } from '../checks/sweep.mjs';
test('resolves names under a directory', () => {
  expect(resolveUnder(['db'], HOME)).toEqual(['db']);
});
`,
      }),
    ).toEqual([]);
  });

  test('a callee this fold CANNOT read whole is in, and the asymmetry is deliberate', () => {
    // `findings(id, root)` hands the root to `check(id).run(root)`. Nothing
    // static follows that, so no claim of "enumerates nothing" is available and
    // the case stays in the population. Five cases in `repo-invariants.test.ts`
    // depend on this direction.
    expect(
      population({
        'checks/sweep.mjs': WALKER,
        'test/a.test.ts': `
const HOME = '${DIR}';
const findings = (id, root) => check(id).run(root);
test('hands a root to something dynamic', () => {
  expect(findings('RI-01', HOME)).toEqual([]);
});
`,
      }),
    ).toEqual(['hands a root to something dynamic:bare']);
  });
});

// -----------------------------------------------------------------------------
// A HELPER THAT TAKES NO ARGUMENT AND WALKS ANYWAY
// -----------------------------------------------------------------------------

describe('the body a case reaches', () => {
  test('a zero-argument local helper carries its walk to every caller', () => {
    // `sourceTree()` and `worstVictim()` in `strip-comments.test.ts`. Nothing at
    // the call site names a root and both cases walk two directories.
    expect(
      population({
        'checks/sweep.mjs': `
import { readdirSync } from 'node:fs';
export function sweep(root) {
  return readdirSync(root);
}
`,
        'test/a.test.ts': `
import { sweep } from '../checks/sweep.mjs';
const HOME = '${DIR}';
function sourceTree() {
  return sweep(HOME);
}
function worstVictim() {
  return sourceTree()[0];
}
test('two hops from the walk', () => {
  expect(worstVictim()).toBeDefined();
});
`,
      }),
    ).toEqual(['two hops from the walk:bare']);
  });
});

// -----------------------------------------------------------------------------
// LEG A: THE SENTINELS, WHICH THROW RATHER THAN REPORT
// -----------------------------------------------------------------------------

describe('leg A throws rather than passing over an empty scope', () => {
  test('a suite with no case in it is an error and not a pass', () => {
    const { suite, checks } = fixture({ 'checks/sweep.mjs': WALKER });
    expect(() => {
      legDerivationIsReal(census(suite, checks));
    }).toThrow(/no suite found|no case found/);
  });

  test('a roster that has lost the walk spelled `DECISIONS` is an error', () => {
    const { suite, checks } = fixture({
      'checks/sweep.mjs': WALKER,
      'test/a.test.ts': `
import { sweep } from '../checks/sweep.mjs';
test('walks', () => {
  expect(sweep()).toBeDefined();
});
`,
    });
    expect(() => {
      legDerivationIsReal(census(suite, checks));
    }).toThrow(/price-register\.mjs#derive is not in the roster/);
  });

  test(
    'and it does not throw on this repository',
    () => {
      expect(() => {
        legDerivationIsReal(census());
      }).not.toThrow();
    },
    CORPUS_SCAN_MS,
  );
});

// -----------------------------------------------------------------------------
// THE FOUR PARSING DEFECTS THIS CHECK WAS BUILT THROUGH, HELD OPEN
// -----------------------------------------------------------------------------
// EVERY ONE OF THESE COST A CASE OR FIVE WHILE THE FOLD WAS BEING WRITTEN, and
// every one of them failed SILENTLY: the check still said PASS, over a
// population that was quietly wrong. They are asserted at the unit rather than
// through a fixture because each is one line of parsing.
// -----------------------------------------------------------------------------

describe('the parsing this fold gets wrong when nobody is watching', () => {
  test('a return-type annotation carrying braces is not the function body', () => {
    const src = readSource(join(REPO_ROOT, 'packages/tooling/test/strip-comments.test.ts'));
    const worst = functions(src).get('worstVictim');
    expect(worst, 'the helper this case is about is not in the file any more').toBeDefined();
    expect(worst?.body).toContain('sourceTree()');
    expect(worst?.body).not.toMatch(/^\s*readonly path: string;\s*$/);
  });

  test('a name declared at module scope beats the same name nested inside another', () => {
    const src = readSource(join(REPO_ROOT, 'packages/tooling/checks/repo-invariants.mjs'));
    const walk = functions(src).get('walk');
    expect(walk?.params.map((p) => p.name)).toEqual(['root', 'dir', 'out']);
    expect(walk?.body).toContain('readdirSync');
  });

  test('a root survives a ternary on its way to the enumerator', () => {
    expect([...carriersOf("const here = dir === '' ? root : join(root, dir);", 'root')]).toContain(
      'here',
    );
  });

  test('a root that has been counted is a number, and a number reaches no walk', () => {
    expect([...carriersOf('const length = target.split(x).length;', 'target')]).not.toContain(
      'length',
    );
  });

  test('a call on the result of another call is dotted, so its receiver is unknown', () => {
    const calls = callsIn('check(id).run(root)');
    expect(calls.map((c) => c.whole)).toEqual(['check', '.run']);
  });

  test('a body brace is found past a type annotation and a plain signature alike', () => {
    const plain = 'function f(a) {}';
    expect(bodyBrace(plain, plain.indexOf(')'))).toBe(plain.indexOf('{'));
    const typed = 'function f(a): { b: number } { return 1; }';
    expect(bodyBrace(typed, typed.indexOf(')'))).toBe(typed.lastIndexOf('{'));
  });
});

describe('folding a path to a value', () => {
  const binds = new Map<string, string | null>([['HOME', `'${REPO_ROOT}'`]]);

  test('a literal, a join and an identifier all reach the same directory', () => {
    expect(foldPath(`'${DIR}'`, FILE, binds)).toBe(DIR);
    expect(foldPath("join(HOME, 'packages')", FILE, binds)).toBe(DIR);
    expect(isTreeDirectory(foldPath("join(HOME, 'packages')", FILE, binds))).toBe(true);
  });

  test('a relative literal is not a root, whatever the working directory is', () => {
    // `'packages/db/migrations'` is a string a case COMPARES against. Resolving
    // it against the process working directory made five fixture cases into
    // walks the first time this fold ran.
    expect(isTreeDirectory('packages')).toBe(false);
    expect(isTreeDirectory(foldPath("'packages'", FILE, binds))).toBe(false);
  });

  test('a file is not a directory and a path outside the tree is neither', () => {
    expect(isTreeDirectory(FILE)).toBe(false);
    expect(isTreeDirectory(tmpdir())).toBe(false);
    expect(isTreeDirectory(null)).toBe(false);
  });

  test('an unresolvable expression folds to null rather than to a guess', () => {
    expect(foldPath('mkdtempSync(prefix)', FILE, binds)).toBeNull();
    expect(foldPath('somethingElse', FILE, binds)).toBeNull();
  });
});

// =============================================================================
// LEGS D AND E: THE ROSTER IS MEASURED AND NOT ONLY DERIVED
// =============================================================================
// `ADR-472`. Everything above this line reads source. Everything below RUNS the
// roster against a tree with a counted number of files and compares what each
// walker reads, which is the price `ADR-470` section 10 item 2 set.
//
// THE FIXTURE CHECKERS NAME THIS REPOSITORY BY VALUE AND CONTAIN NOTHING ELSE.
// A fixture whose default root is a real directory of this repository is
// redirected to the planted tree by the measurement patch, which is the whole
// mechanism: the planted tree stands in for the repository, so a fixture needs
// no corpus, no migration and no register to be measured walking one.
//
// AND THESE CASES DO NOT CARRY `CORPUS_SCAN_MS`, WHICH LEG C HAD TO SAY TWICE.
// Every one of them was written with the budget pasted on out of habit, and the
// check named all seven on the first run: their input is a fixture module and
// one child process, not this repository, so the budget was a sixty-second wall
// bounding a hang and nothing else. The cases that DO carry it below are the
// two that call `census()` or `run()` over the real tree. This is leg C working
// on the diff that added leg D, which is the only reason to trust either.
// =============================================================================

/** A checker directory outside this repository, holding one module. */
function checkerFixture(source: string): string {
  const root = mkdtempSync(join(tmpdir(), 'merit-measured-roster-'));
  writeFileSync(join(root, 'fixture-checker.mjs'), source);
  return join(root, 'fixture-checker.mjs');
}

/**
 * FIVE SHAPES, ONE MODULE. Each default root is a real directory of this
 * repository written as a literal, so the patch redirects it to the planted
 * tree and the fixture never learns where it actually ran.
 */
const SHAPES = `
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function walks(root = '${DIR}') {
  let total = 0;
  for (const name of readdirSync(root)) total += readFileSync(join(root, name), 'utf8').length;
  return total;
}

export function walksUnrostered(root = '${DIR}') {
  return readdirSync(root).length;
}

export function named(root = '${DIR}') {
  return readFileSync(join(root, 'one-named-file-that-is-not-there.md'), 'utf8');
}

export function readsThenWalks(root = '${DIR}') {
  const held = readFileSync(join(root, 'one-named-file-that-is-not-there.md'), 'utf8');
  return held.length + readdirSync(root).length;
}

export function quiet() {
  return 1;
}

export function spawns(root = '${DIR}') {
  return execFileSync('git', ['-C', root, 'ls-files', '-z']);
}

export function writes(root = '${DIR}') {
  writeFileSync(join(root, 'the-measurement-must-never-put-this-here.txt'), 'x');
  return 1;
}
`;

/** The whole block's measurement, taken once, in one child. */
function measureShapes(): Map<string, Verdict> {
  const module = checkerFixture(SHAPES);
  const rostered = ['walks', 'named', 'quiet', 'readsThenWalks'];
  const probed = ['walksUnrostered', 'spawns', 'writes'];
  return measuredVerdicts(
    measure([
      ...rostered.map((name) => ({ module, name, rostered: true, args: ['default' as const] })),
      ...probed.map((name) => ({ module, name, rostered: false, args: [] })),
    ]),
  );
}

const named = (verdicts: Map<string, Verdict>, name: string): Verdict => {
  const found = [...verdicts].find(([id]) => id.endsWith(`#${name}`));
  if (found === undefined) throw new Error(`${name} was not measured at all`);
  return found[1];
};

describe('leg D, a rostered walker that does not enumerate when it is run', () => {
  test('a walker that enumerates is measured, and what it reads grows with the planted tree', () => {
    const v = named(measureShapes(), 'walks');
    expect(enumerates(v)).toBe(true);
    expect(v.dirs).toBe(1);
    // THE COMPARISON IS THE MEASUREMENT. Two rounds, the same walker, more
    // files planted in the second, and more of them read. A named read of one
    // file reads one file in both rounds, which is the next case.
    expect(v.planted).toEqual([ROUNDS[0]?.perDir, ROUNDS[1]?.perDir]);
    expect(v.read[1]).toBeGreaterThan(v.read[0] as number);
    expect(grewWithTheTree(v)).toBe(true);
  });

  test('a rostered walker that reads the planted tree and enumerates none of it is named', () => {
    const verdicts = measureShapes();
    const findings = legRosterIsMeasured(verdicts);
    expect(findings.join('\n')).toContain('#named');
    expect(findings.join('\n')).toContain('enumerates no directory of it');
    // AND THE LEG DOES NOT OVER-FIRE. The walker beside it in the same
    // measurement, in the same fixture, walks and is silent here.
    expect(findings.join('\n')).not.toContain('#walks');
    expect(named(verdicts, 'named').touched).toBeGreaterThan(0);
    expect(named(verdicts, 'named').dirs).toBe(0);
  });

  test('a named read is ANSWERED rather than refused, and the walk behind it still happens', () => {
    // THIS PAIR IS THE CONTROL THAT CHANGED THE INSTRUMENT. The first seed
    // written for leg D read one file by name and then walked, and the leg
    // named it anyway: the planted tree did not hold the file, the read threw,
    // and the walk behind it never ran. A measurement that refuses a named read
    // is measuring its own gaps. `readsThenWalks` and `named` are one line
    // apart now, and the leg separates them.
    const verdicts = measureShapes();
    const walked = named(verdicts, 'readsThenWalks');
    expect(walked.named).toBeGreaterThan(0);
    expect(enumerates(walked)).toBe(true);
    expect(legRosterIsMeasured(verdicts).join('\n')).not.toContain('#readsThenWalks');
    expect(named(verdicts, 'named').named).toBeGreaterThan(0);
  });

  test('a walker that never reached the planted tree is INCONCLUSIVE and never a finding', () => {
    // THE THIRD OUTCOME IS NOT A ROUNDING ERROR. `quiet` is handed the empty
    // argument this measurement supplies and returns without looking at
    // anything. Calling that a stale roster entry would be this check
    // inventing a defect out of its own calling convention.
    const verdicts = measureShapes();
    expect(named(verdicts, 'quiet').touched).toBe(0);
    expect(enumerates(named(verdicts, 'quiet'))).toBe(false);
    expect(legRosterIsMeasured(verdicts).join('\n')).not.toContain('#quiet');
  });
});

describe('leg E, an enumeration with no argument at all that is not in the roster', () => {
  test('a walk reached with nothing supplied is named, and so is one performed by a spawn', () => {
    const verdicts = measureShapes();
    const findings = legRosterIsComplete(verdicts).join('\n');
    expect(findings).toContain('#walksUnrostered');
    // `ADR-470` SECTION 3.4 ITEM 3, MEASURED. `git ls-files` is not in
    // `ENUMERATORS` and never will be, because it is not an `fs` call at all.
    // The measurement sees it because it watches the process boundary.
    expect(findings).toContain('#spawns');
    expect(findings).toContain('ls-files');
    expect(named(verdicts, 'spawns').dirs).toBe(0);
    expect(enumerates(named(verdicts, 'spawns'))).toBe(true);
  });

  test('a function that enumerates nothing is not named, whichever side of the roster it is on', () => {
    const verdicts = measureShapes();
    expect(legRosterIsComplete(verdicts).join('\n')).not.toContain('#quiet');
    expect(legRosterIsComplete(verdicts).join('\n')).not.toContain('#named');
    // AND A ROSTERED WALKER IS NEVER LEG E's, whatever it does.
    expect(legRosterIsComplete(verdicts).join('\n')).not.toContain('#walks ');
  });
});

describe('what a measured run is not allowed to do', () => {
  test('it may not write, and the write it attempted is not in this repository afterwards', () => {
    const verdicts = measureShapes();
    const v = named(verdicts, 'writes');
    expect(v.error).toContain('may not write');
    // THE CONTROL, AND IT IS THE REASON THIS CAN RUN AT ALL. The fixture aims
    // its write at a real directory of this repository. The patch records the
    // path it was given, unredirected, and refuses.
    expect(existsSync(join(DIR, 'the-measurement-must-never-put-this-here.txt'))).toBe(false);
  });

  test('it may not spawn, so no measured checker ever sees the real tree through a process', () => {
    const v = named(measureShapes(), 'spawns');
    expect(v.spawns.join(' ')).toContain('ls-files');
    expect(v.error).toContain('may not spawn');
  });
});

describe('leg A over the measurement, which throws rather than reporting', () => {
  const verdict = (over: Partial<Verdict>): Verdict => ({
    rostered: true,
    dirs: 0,
    touched: 0,
    spawns: [],
    read: [0, 0],
    planted: [8, 24],
    error: null,
    ...over,
  });

  test('a measurement with no row at all is not a measurement', () => {
    expect(() => {
      legMeasurementIsReal(new Map());
    }).toThrow(/no row at all/);
  });

  test('a measurement in which nothing enumerated is an instrument that is not reading', () => {
    expect(() => {
      legMeasurementIsReal(new Map([['m#a', verdict({})]]));
    }).toThrow(/not one rostered walker was measured enumerating/);
  });

  test('two rounds that no walker distinguishes have compared nothing', () => {
    // A WALKER CAN ENUMERATE AND STILL READ THE SAME FILES IN BOTH ROUNDS, so
    // this is a separate throw from the one above rather than a stricter form
    // of it: it is the only thing that says the two trees differ at all.
    expect(() => {
      legMeasurementIsReal(new Map([['m#a', verdict({ dirs: 1 })]]));
    }).toThrow(/not distinguishable/);
    expect(() => {
      legMeasurementIsReal(new Map([['m#a', verdict({ dirs: 1, read: [1, 2] })]]));
    }).not.toThrow();
  });
});

describe('the measured roster on this repository', () => {
  test(
    'every rostered walker is measured enumerating or is named inconclusive, and neither leg fires',
    () => {
      const seen = census();
      const verdicts = measuredVerdicts(measure(measurementPlan(seen.mods, seen.walkers)));
      expect(legRosterIsMeasured(verdicts)).toEqual([]);
      expect(legRosterIsComplete(verdicts)).toEqual([]);

      // DERIVED AND NOT PINNED, for the reason the first case in this file
      // gives. What is asserted is that the measurement accounts for the whole
      // roster and that it is not vacuous.
      const summary = measuredSummary(verdicts);
      expect(summary.rostered).toBe(seen.walkers.size);
      expect(summary.measured + summary.inconclusive).toBe(summary.rostered);
      expect(summary.measured).toBeGreaterThan(0);
      expect(summary.grew).toBeGreaterThan(0);
      expect(summary.probed).toBeGreaterThan(0);
      expect(summary.probed).toBeLessThan(exportedSurface(seen.mods));
    },
    CORPUS_SCAN_MS,
  );

  test(
    'the patch and the fold read one register of enumeration primitives, not two',
    () => {
      // IF THESE EVER DIVERGE, THE ROSTER AND THE MEASUREMENT ARE ABOUT
      // DIFFERENT THINGS and the agreement between them stops meaning anything.
      expect(measurementPatch(REPO_ROOT, SELF)).toContain(JSON.stringify(ENUMERATORS));
      expect(ENUMERATORS).toContain('readdirSync');
    },
    CORPUS_SCAN_MS,
  );

  test(
    'the child mode is not a user-facing option and the usage text does not offer it',
    () => {
      const lines: string[] = [];
      expect(run([MEASURE_CHILD], (line) => lines.push(line))).toBe(2);
      expect(lines[0]).toContain('usage:');
      expect(lines.join('\n')).not.toContain(MEASURE_CHILD);
    },
    CORPUS_SCAN_MS,
  );
});
