import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { CHECKS, REPO_ROOT, workspacePackages } from '../checks/repo-invariants.mjs';
import { SUBJECTS, copiesOf, typescriptFences } from '../checks/response-shape-copies.mjs';

/**
 * The check AS THE RUNNER COMPOSES IT, pulled out of `CHECKS` rather than built
 * here. `ri18For` takes its package lister as an argument, so a case that
 * composed its own would be testing a check the repository does not run.
 */
const ri18 = CHECKS.find((c) => c.id === 'RI-18');
if (ri18 === undefined) throw new Error('RI-18 is not a row of CHECKS');

// =============================================================================
// RI-18 IS WATCHED FAILING ON A SEED IN EACH OF THE THREE COPIES SEPARATELY
// =============================================================================
// `falsify.mjs`'s rule, and this check needs it more than most: a comparison
// that reports agreement is indistinguishable from a comparison that read
// nothing, and both print an empty array. So every case below plants ONE field
// in ONE copy and demands the finding that names it, and the three directions
// are separate cases rather than one, because a reader that walked only the
// document, or only the first source file it found, would pass a single case.
//
// The seeded direction runs against a SYNTHETIC tree. The clean direction runs
// against it too AND against the repository, where the answer today is a
// divergence rather than agreement: `ADR-188` ruled four fields and four
// `reserve` members onto the contract's `LiabilityResponse` and edited no code,
// so `repo-invariants.test.ts`'s real-tree case for `RI-18` is RED on purpose
// and this file states the count rather than restating the fields, which would
// be the stored list `RI-17` exists to remove.
// =============================================================================

const seeded: string[] = [];
afterEach(() => {
  for (const dir of seeded.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const write = (root: string, rel: string, body: string): void => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), body);
};

/**
 * The one subject `SUBJECTS` holds, read from the check rather than typed here.
 *
 * A case that spelled the name itself would keep passing on the day the check
 * stopped being about it.
 */
const SUBJECT = SUBJECTS[0];
if (SUBJECT === undefined) throw new Error('SUBJECTS is empty; these cases have no subject');

/** What each copy says, before a case edits one of them. */
const CONTRACT_BODY =
  `## Section\n\n### GET /admin/thing\n` +
  '```ts\n' +
  `type ${SUBJECT} = {\n` +
  '  as_of: string;\n' +
  '  nested: { cents: number };\n' +
  '  rows: Array<{ day: string }>;\n' +
  '};\n' +
  '```\n';

const API_BODY =
  `interface Nested {\n  readonly cents: number;\n}\n` +
  `export interface ${SUBJECT} {\n` +
  '  readonly as_of: string;\n' +
  '  readonly nested: Nested;\n' +
  '  readonly rows: readonly { readonly day: string }[];\n' +
  '}\n';

const ADMIN_BODY =
  `export type ${SUBJECT} = {\n` +
  '  readonly as_of: string;\n' +
  '  readonly nested: { readonly cents: number };\n' +
  '  readonly rows: ReadonlyArray<{ readonly day: string }>;\n' +
  '};\n';

const CONTRACT_REL = 'docs/architecture/API_CONTRACT.md';
const API_REL = 'apps/api/src/routes/thing.ts';
const ADMIN_REL = 'apps/admin/src/api/types.ts';

/**
 * A tree whose three copies AGREE while spelling the shape three ways.
 *
 * The contract writes no `readonly` and `Array<>`, `apps/api` writes an
 * `interface` that reaches a second declaration by reference and `readonly []`,
 * and `apps/admin` writes a `type` alias with `ReadonlyArray<>`. If any case in
 * this file passed because the three strings were equal, this fixture would be
 * the one that caught it.
 */
function cleanTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'merit-shape-copies-'));
  seeded.push(root);
  write(root, 'pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - 'packages/*'\n");
  write(root, 'apps/api/package.json', JSON.stringify({ name: '@merit/api' }));
  write(root, 'apps/admin/package.json', JSON.stringify({ name: '@merit/admin' }));
  write(root, CONTRACT_REL, CONTRACT_BODY);
  write(root, API_REL, API_BODY);
  write(root, ADMIN_REL, ADMIN_BODY);
  return root;
}

const findings = (root: string): string[] => ri18.run(root);

// -----------------------------------------------------------------------------
// The clean direction
// -----------------------------------------------------------------------------
describe('three copies that agree', () => {
  test('RI-18 holds when the same field set is spelled three different ways', () => {
    expect(findings(cleanTree())).toEqual([]);
  });

  test('it really read all three, rather than finding one and stopping', () => {
    const copies = copiesOf(cleanTree(), SUBJECT, workspacePackages);
    expect(copies.map((c) => c.rel).sort()).toEqual([ADMIN_REL, API_REL, CONTRACT_REL]);
    // The nested shape reached THROUGH a reference, which is the truncation
    // that would make two copies agree about a name and never look inside it.
    for (const copy of copies) {
      expect({ rel: copy.rel, paths: [...copy.paths].sort() }).toEqual({
        rel: copy.rel,
        paths: ['as_of', 'nested', 'nested.cents', 'rows', 'rows[].day'],
      });
      expect(copy.anomalies).toEqual([]);
    }
  });
});

// -----------------------------------------------------------------------------
// One seed per copy, which is the whole of this check's evidence
// -----------------------------------------------------------------------------
describe('a field added to one copy and forgotten in the others', () => {
  test('RI-18 catches it in the CONTRACT copy, which no compiler reads', () => {
    const root = cleanTree();
    write(
      root,
      CONTRACT_REL,
      CONTRACT_BODY.replace('  as_of: string;', '  as_of: string;\n  seed_cents: number;'),
    );
    const found = findings(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(`\`${SUBJECT}.seed_cents\``);
    expect(found[0]).toContain(`is declared in ${CONTRACT_REL}:`);
    expect(found[0]).toContain(`ABSENT from ${ADMIN_REL}:`);
    expect(found[0]).toContain(API_REL);
  });

  test('RI-18 catches it in the apps/api copy', () => {
    const root = cleanTree();
    write(
      root,
      API_REL,
      API_BODY.replace(
        '  readonly as_of: string;',
        '  readonly as_of: string;\n  readonly seed_cents: number;',
      ),
    );
    const found = findings(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(`\`${SUBJECT}.seed_cents\``);
    expect(found[0]).toContain(`is declared in ${API_REL}:`);
    expect(found[0]).toContain(CONTRACT_REL);
    expect(found[0]).toContain(ADMIN_REL);
  });

  // THE CASE THAT MATTERS MOST, and the one measured on the real tree in this
  // session's log: seeding this copy leaves `pnpm run typecheck` at zero errors
  // and the whole `apps/admin` suite green, because nothing in `apps/api`
  // constructs it and no compiler relates two declarations in two packages.
  test('RI-18 catches it in the apps/admin copy, which typecheck does not relate to either other', () => {
    const root = cleanTree();
    write(
      root,
      ADMIN_REL,
      ADMIN_BODY.replace(
        '  readonly as_of: string;',
        '  readonly as_of: string;\n  readonly seed_cents: number;',
      ),
    );
    const found = findings(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(`\`${SUBJECT}.seed_cents\``);
    expect(found[0]).toContain(`is declared in ${ADMIN_REL}:`);
  });

  test('RI-18 reads a NESTED field, and names it by its path', () => {
    const root = cleanTree();
    write(
      root,
      ADMIN_REL,
      ADMIN_BODY.replace(
        '{ readonly cents: number }',
        '{ readonly cents: number; readonly seed_bp: number }',
      ),
    );
    const found = findings(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(`\`${SUBJECT}.nested.seed_bp\``);
  });

  test('RI-18 reads a field inside an ARRAY ELEMENT, through all three array spellings', () => {
    const root = cleanTree();
    write(
      root,
      CONTRACT_REL,
      CONTRACT_BODY.replace('{ day: string }', '{ day: string; seed: number }'),
    );
    const found = findings(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(`\`${SUBJECT}.rows[].seed\``);
  });

  test('RI-18 catches a field made OPTIONAL in one copy alone', () => {
    const root = cleanTree();
    write(root, API_REL, API_BODY.replace('readonly as_of: string;', 'readonly as_of?: string;'));
    const found = findings(root);
    // Two findings and that is the shape of the fact: `as_of` is absent from
    // the copy that made it optional, and `as_of?` is absent from the two that
    // did not. A single finding would have to pick one of those to say.
    expect(found).toHaveLength(2);
    expect(found.join('\n')).toContain(`\`${SUBJECT}.as_of?\``);
    expect(found.join('\n')).toContain(`\`${SUBJECT}.as_of\``);
  });

  test('RI-18 does NOT fire on `readonly`, which the contract never writes', () => {
    const root = cleanTree();
    write(root, ADMIN_REL, ADMIN_BODY.replaceAll('readonly ', ''));
    expect(findings(root)).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// The truncation cases: a shape it cannot read is REPORTED, never dropped
// -----------------------------------------------------------------------------
describe('a shape the reader cannot follow is a finding rather than a leaf', () => {
  test('a type reference the declaring source does not declare is reported', () => {
    const root = cleanTree();
    // The reference is IMPORTED rather than declared, which is the ordinary way
    // a real copy would be written and the way this reader is blindest.
    write(
      root,
      API_REL,
      `import type { Nested } from './nested.ts';\n` +
        `export interface ${SUBJECT} {\n` +
        '  readonly as_of: string;\n' +
        '  readonly nested: Nested;\n' +
        '  readonly rows: readonly { readonly day: string }[];\n' +
        '}\n',
    );
    const found = findings(root);
    const truncation = found.filter((f) => f.includes('compared as a LEAF'));
    expect(truncation).toHaveLength(1);
    expect(truncation[0]).toContain(`${API_REL}:`);
    expect(truncation[0]).toContain('`nested` is `Nested`');
    // And the truncation is not merely announced: the field it swallowed is
    // reported missing too, so a reader cannot mistake it for agreement.
    expect(found.join('\n')).toContain(`\`${SUBJECT}.nested.cents\``);
  });

  test('an interface extending a name the source does not declare is reported', () => {
    const root = cleanTree();
    write(
      root,
      API_REL,
      `interface Nested {\n  readonly cents: number;\n}\n` +
        `export interface ${SUBJECT} extends Elsewhere {\n` +
        '  readonly as_of: string;\n' +
        '  readonly nested: Nested;\n' +
        '  readonly rows: readonly { readonly day: string }[];\n' +
        '}\n',
    );
    expect(findings(root).filter((f) => f.includes('extends `Elsewhere`'))).toHaveLength(1);
  });

  test('the subject declared twice in one source is reported, and the SPACE is the whole document', () => {
    const root = cleanTree();
    write(
      root,
      CONTRACT_REL,
      CONTRACT_BODY + '\n```ts\n' + `type ${SUBJECT} = { as_of: string };\n` + '```\n',
    );
    const found = findings(root);
    expect(found.filter((f) => f.includes('an accident of document order'))).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// The non-vacuity guards: a check that cannot reach its inputs is not a pass
// -----------------------------------------------------------------------------
describe('RI-18 throws rather than passing when it cannot compare', () => {
  test('one copy is nothing to compare', () => {
    const root = cleanTree();
    rmSync(join(root, API_REL));
    rmSync(join(root, ADMIN_REL));
    expect(() => findings(root)).toThrow(/declared once/);
  });

  test('the contract not declaring the subject is a failure, not a silent skip', () => {
    const root = cleanTree();
    // A fence that PARSES and declares something else, so the fence guard is
    // satisfied and the subject guard is the one under test. A document with no
    // fence at all trips the earlier guard and would have proved nothing here.
    write(root, CONTRACT_REL, '## Section\n\n```ts\ntype Elsewhere = { x: string };\n```\n');
    expect(() => findings(root)).toThrow(/declares no/);
  });

  test('a document with no ```ts fence fails loudly', () => {
    const root = cleanTree();
    write(root, CONTRACT_REL, '## Section\n\n```json\n{}\n```\n');
    expect(() => findings(root)).toThrow(/holds no/);
  });

  test('the contract being renamed away fails loudly', () => {
    const root = cleanTree();
    rmSync(join(root, CONTRACT_REL));
    expect(() => findings(root)).toThrow(/does not exist/);
  });

  test('a copy that parsed to zero fields fails loudly rather than agreeing with everything', () => {
    const root = cleanTree();
    write(root, ADMIN_REL, `export type ${SUBJECT} = Record<string, unknown>;\n`);
    expect(() => findings(root)).toThrow(/ZERO fields/);
  });
});

// -----------------------------------------------------------------------------
// The reader's own claims about what it read
// -----------------------------------------------------------------------------
describe('the fence reader', () => {
  test('reads only ```ts, so a ```tsx or ```json block is not TypeScript', () => {
    const fences = typescriptFences('```tsx\nA\n```\n```json\nB\n```\n```ts\nC\n```\n');
    expect(fences.map((f) => f.body)).toEqual(['C']);
  });

  test('reports the DOCUMENT line a fenced declaration sits on, not the fence line', () => {
    const root = cleanTree();
    const contract = readFileSync(join(root, CONTRACT_REL), 'utf8').split('\n');
    const copy = copiesOf(root, SUBJECT, workspacePackages).find((c) => c.rel === CONTRACT_REL);
    expect(copy).toBeDefined();
    // 1-based, so the cited line is the array index one below it. The assertion
    // is against the document's own text rather than against a number typed
    // here, which would drift the moment the fixture gained a line.
    expect(contract[(copy?.line ?? 0) - 1]).toContain(`type ${SUBJECT} = {`);
  });

  test('an unterminated fence is dropped, which the guards are what notice', () => {
    expect(typescriptFences('```ts\ntype A = { x: string };\n')).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// The real tree, stated rather than asserted green
// -----------------------------------------------------------------------------
describe('the repository today', () => {
  // THIS CHECK LANDS RED AND THAT IS THE FINDING RATHER THAN A DEFECT.
  // `ADR-188` ruled fields onto the contract's `LiabilityResponse` and edited
  // no code, on a measurement that landing the type alone would be a red
  // `CI-01` reaching two files outside that session's fence. The window it
  // opened is what this check closes, and closing it means SAYING SO.
  //
  // The count is derived here rather than written down: an expectation of
  // "eight" would be a stored answer that goes stale the moment the code half
  // lands, and this assertion is what tells the session that lands it that the
  // work is done.
  test('every RI-18 finding on the real tree is about the ADR-188 delta and nothing else', () => {
    const found = ri18.run(REPO_ROOT);
    for (const finding of found) {
      expect(finding).toContain(`\`${SUBJECT}.`);
      expect(finding).toContain('docs/architecture/API_CONTRACT.md');
    }
    // No anomaly: every copy parsed whole, so the divergence below is a real
    // disagreement and not a shape this reader could not follow.
    expect(found.filter((f) => f.includes('compared as a LEAF'))).toEqual([]);
    expect(found.filter((f) => f.includes('carries no type annotation'))).toEqual([]);
  });
});
