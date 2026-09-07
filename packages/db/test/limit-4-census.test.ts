// =============================================================================
// packages/db/test/limit-4-census.test.ts
// =============================================================================
// ADR-421. `ADR-303` LIMIT 4 IS NOT CALLERLESS, AND THIS IS THE CENSUS THAT
// SAYS SO.
//
// `ADR-303` narrowed the three CATALOGUE verbs and named four limits in
// `CatalogRow`'s docblock. Limit 4 reads, at source: "`rows`, `rowsWhere`,
// `rowAt`, `lockAt` and every `FirmTx` and `SystemTx` read still return
// `unknown`. Whether the same treatment is owed to them is NAMED here and NOT
// RULED: that is a much larger surface, IT HAS REAL CALLERS, and it is a
// separate row."
//
// -----------------------------------------------------------------------------
// WHAT THIS SUITE EXISTS TO STOP
// -----------------------------------------------------------------------------
// "It has real callers" is a claim about the TREE, stated in a docblock, and
// nothing compared it to the tree. That is `FM-16` in its purest form, and it
// has already produced one restatement that drifts: a row can read limit 4, or
// a summary of it, and conclude that the un-narrowed verbs are cheap to take
// because nothing calls them. They are not cheap. This file derives the caller
// population at the moment it runs and refuses that conclusion with a number.
//
// THE PREDICATES ARE EXISTENTIAL AND THE TOTALS ARE REPORTED RATHER THAN
// ASSERTED. A case that pinned `rowsWhere` at its present total would go red on
// the next row that adds a filter read, which is a control that trains people
// to edit it. What is asserted is the thing limit 4 actually claims -- that
// each verb HAS callers, that they are outside this package, and that the
// consuming directories include one this repository fences separately -- and
// every derived figure is printed in the failure message so a reader who wants
// the count gets it from the run rather than from prose that ages.
//
// -----------------------------------------------------------------------------
// THE SOURCE IS READ THROUGH THE ONE STRIPPER (`RI-30`)
// -----------------------------------------------------------------------------
// The tree quotes these verbs in prose constantly -- `repo-invariants.mjs`
// alone writes `.rows('tradingCalendarLoads')` inside four comments, and
// `falsify-ci.mjs` writes a `.rows(...)` call inside a fixture STRING. A naive
// grep counts all of them and reports a caller population that is 200 in code
// and 211 with the prose folded in. `stripComments` with `literals: 'blank'` is
// the mode its own docblock names for "a check hunting for a CALL": comments go,
// literal CONTENT goes, and a template substitution survives because it is code.
// -----------------------------------------------------------------------------

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { stripComments } from '../../tooling/checks/strip-comments.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');

/**
 * The four verbs `ADR-303` limit 4 names, in the docblock's own order.
 *
 * `lockScope` is NOT here and its absence is deliberate: `ADR-303` section 2
 * ruling 3 lists it, and limit 4 as written in `CatalogRow`'s docblock does not.
 * This file follows the docblock, which is the copy a session stands in front of.
 */
const LIMIT_4_VERBS = ['rows', 'rowsWhere', 'rowAt', 'lockAt'] as const;

type Limit4Verb = (typeof LIMIT_4_VERBS)[number];

/** The directories walked, which is every directory a caller could live in. */
const WALKED = ['apps', 'packages', 'scripts', 'e2e'] as const;

const SOURCE = /\.(ts|tsx|mts|mjs)$/;
const IGNORED = new Set(['node_modules', 'dist', '.git', 'migrations']);

const walk = (relative: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(join(ROOT, relative), { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const next = `${relative}/${entry.name}`;
    if (entry.isDirectory()) walk(next, out);
    else if (SOURCE.test(entry.name)) out.push(next);
  }
  return out;
};

/** A test file is not a caller of the accessor, it is an exercise of it. */
const isTest = (file: string): boolean =>
  /\.test\.ts$/.test(file) || /(^|\/)test\//.test(file) || file.startsWith('e2e/');

/** The declaration and implementation sites, which are the door rather than a caller. */
const isTheDoor = (file: string): boolean => file.startsWith('packages/db/src/');

const FILES = WALKED.flatMap((d) => walk(d));

const code = (file: string): string =>
  stripComments(readFileSync(join(ROOT, file), 'utf8'), { literals: 'blank' });

const CODE = new Map(FILES.map((f) => [f, code(f)]));

const countIn = (file: string, pattern: RegExp): number =>
  (CODE.get(file)?.match(pattern) ?? []).length;

/** `.verb(` -- a CALL on some handle. */
const calls = (verb: Limit4Verb): RegExp => new RegExp(`\\.${verb}\\(`, 'g');

/**
 * `  verb(` or `  verb<` at the head of an indented line -- a MEMBER of an
 * interface or an object literal, which is how a consumer re-states the door.
 */
const declarations = (verb: Limit4Verb): RegExp =>
  new RegExp(`^\\s{2,}(readonly\\s+)?${verb}\\s*(<|\\()`, 'gm');

interface Site {
  readonly file: string;
  readonly n: number;
}

const sitesOf = (verb: Limit4Verb, pattern: (v: Limit4Verb) => RegExp): readonly Site[] =>
  FILES.filter((f) => !isTest(f) && !isTheDoor(f))
    .map((file) => ({ file, n: countIn(file, pattern(verb)) }))
    .filter((s) => s.n > 0);

const total = (sites: readonly Site[]): number => sites.reduce((a, s) => a + s.n, 0);

const ADMIN_SOURCE = 'apps/api/src/admin-source/';

describe('`ADR-303` limit 4 names a surface with real callers, and here they are', () => {
  test('every one of the four verbs is called from production source outside `packages/db`', () => {
    const derived = LIMIT_4_VERBS.map((verb) => {
      const sites = sitesOf(verb, calls);
      return { verb, sites: total(sites), files: sites.length };
    });

    // THE PREDICATE, AND IT IS THE ONE LIMIT 4 STATES. A verb with no caller
    // would be cheap to narrow; `ADR-303` says none of these is, and a session
    // that reads a summary saying otherwise meets this line.
    for (const row of derived)
      expect(
        row.sites,
        `\`${row.verb}\` is called ${String(row.sites)} time(s) in ${String(row.files)} production ` +
          `file(s) outside \`packages/db\`. \`ADR-303\` limit 4 calls this surface one with REAL ` +
          `CALLERS and a reading that says the un-narrowed verbs are callerless is false. ` +
          `Full census: ${derived.map((d) => `${d.verb}=${String(d.sites)}/${String(d.files)}`).join(' ')}`,
      ).toBeGreaterThan(0);

    // AND THE POPULATION IS NOT A HANDFUL. Stated as a floor rather than a
    // total, so a row that adds a read does not edit this file.
    expect(total(LIMIT_4_VERBS.flatMap((v) => sitesOf(v, calls)))).toBeGreaterThan(100);
  });

  test('the consumers include `apps/api/src/admin-source/`, which this repository fences apart', () => {
    const consumed = LIMIT_4_VERBS.filter((verb) =>
      sitesOf(verb, calls).some((s) => s.file.startsWith(ADMIN_SOURCE)),
    );

    // THE COLLISION, HELD AS A FACT RATHER THAN AS A DISPATCH NOTE. Narrowing
    // one of these verbs changes a signature this directory satisfies
    // structurally, and the directory is edited under its own fence.
    expect(
      consumed.length,
      `\`${ADMIN_SOURCE}\` consumes [${consumed.join(', ')}] of the four verbs. A row narrowing ` +
        `any of them changes a signature that directory depends on.`,
    ).toBeGreaterThanOrEqual(3);

    expect(consumed).toContain('rowsWhere');
  });

  test('the `unknown` is re-stated at port declarations outside `packages/db/src`', () => {
    const ports = LIMIT_4_VERBS.flatMap((verb) => sitesOf(verb, declarations));
    const files = new Set(ports.map((s) => s.file));

    // THE PRICE OF LIMIT 4, AND IT IS THE NUMBER A LATER ROW ACTUALLY NEEDS.
    // Narrowing the accessor does not reach a reader, because the reader reads
    // its OWN port. Every one of these is a second place the `unknown` is
    // written down, and each is a mapping's origin.
    expect(
      total(ports),
      `${String(total(ports))} port declaration(s) over ${String(files.size)} file(s) outside ` +
        `\`packages/db/src\` re-state the four verbs. Narrowing the accessor changes none of them, ` +
        `so the mappings limit 4 describes survive a narrowing untouched.`,
    ).toBeGreaterThan(0);

    // THE RE-STATEMENT SPANS MORE THAN ONE WORKSPACE, which is why no single
    // fence can spend limit 4 on its own.
    const workspaces = new Set([...files].map((f) => f.split('/').slice(0, 2).join('/')));
    expect(workspaces.size).toBeGreaterThan(1);
    expect([...files].some((f) => f.startsWith(ADMIN_SOURCE))).toBe(true);
  });

  test('limit 4 is UNSPENT in the door itself: every declaration still returns `unknown`', () => {
    const door = CODE.get('packages/db/src/scoped-db.ts') ?? '';
    expect(door, '`scoped-db.ts` was not walked').not.toBe('');

    // EVERY SIGNATURE'S OWN RETURN, AND NOT "AN `unknown` NEARBY". The first
    // form of this case read 200 characters past the verb and looked for
    // `Promise<unknown` anywhere in them, which the NEXT member of the same
    // interface satisfies: `ScopedTx.rows` sits one line above `insert`, so a
    // narrowed `rows` still passed. The case is written to the first `Promise<`
    // after the parameter list closes, which is the verb's own return and
    // nothing else's.
    const returnsOf = (verb: Limit4Verb): readonly string[] => {
      const found: string[] = [];
      const head = new RegExp(`\\b${verb}<K extends `, 'g');
      let hit = head.exec(door);
      while (hit !== null) {
        const own = /\)\s*:\s*(Promise<[^;{]*?)[;{]/.exec(door.slice(hit.index));
        if (own?.[1] !== undefined) found.push(own[1].trim());
        hit = head.exec(door);
      }
      return found;
    };

    for (const verb of LIMIT_4_VERBS) {
      const returns = returnsOf(verb);

      // THE DECLARATIONS EXIST. A verb this case cannot find is a case that has
      // stopped reading the door, which passes in silence otherwise.
      expect(
        returns.length,
        `no \`${verb}<K extends ...>\` signature found in \`scoped-db.ts\``,
      ).toBeGreaterThan(0);

      const narrowed = returns.filter(
        (r) => r !== 'Promise<unknown>' && r !== 'Promise<unknown[]>',
      );
      expect(
        narrowed,
        `\`${verb}\` returns ${narrowed.join(', ')} at ${String(narrowed.length)} of ` +
          `${String(returns.length)} declaration(s) in \`scoped-db.ts\`. That is \`ADR-303\` limit 4 ` +
          `being SPENT, which is a decision an ADR has to carry rather than a tidy-up.`,
      ).toEqual([]);
    }
  });
});
