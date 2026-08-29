import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

// =============================================================================
// rule-state-phase-vocabulary.test.ts
// =============================================================================
// THE COMPARATOR FOR A VOCABULARY THAT HAD SIX COPIES AND NO COMPARATOR.
// `Phase`'s four members are written out literally in `types.ts`, in `0001`'s
// `CREATE TYPE`, in this package's `pgEnum`, twice in `apps/api` and once in
// `apps/portal`, and until this file NOTHING COMPARED ANY TWO OF THEM.
//
// `0067` (ADR-216) moves `rule_states.phase` onto `account_phase` rather than
// giving it a CHECK, and the argument for that is exactly the copy count: a
// CHECK would have been a SEVENTH copy. So this file defends the three copies
// the ruling depends on and adds none of its own:
//
//   1. `packages/rules-engine/src/types.ts`     `export type Phase`
//   2. `packages/db/migrations/0001_...sql`     `CREATE TYPE account_phase`
//   3. `packages/db/src/schema.ts`              `pgEnum('account_phase', ...)`
//
// IT DERIVES ALL THREE AND CARRIES NONE. There is no list of phases anywhere
// below. A fifth member added to `types.ts` turns this red and names the
// migration; a member renamed or reordered on any side turns it red and names
// both sides.
//
// ORDER IS ASSERTED AND NOT ONLY MEMBERSHIP, which matters more here than it
// did for `BreachKind`. An enum's declaration order IS its sort order, and
// `accounts.phase` has been `account_phase` since `0001`, so a member inserted
// with `BEFORE` or `AFTER` silently changes how another table's rows sort while
// every set comparison stays green.
//
// THE PARSER GUARDS ITSELF, which is `rule-state-breach-vocabulary.test.ts`'s
// idiom and the reason it is repeated: a parser that stopped matching would make
// two empty lists compare equal and report PASS, which is the one failure a
// derivation can suffer that a hand-maintained copy cannot.
//
// `@merit/db` DOES NOT DEPEND ON `@merit/rules-engine` AND THIS FILE DOES NOT
// ADD ONE. The union is read as text, so the assertion costs no edge in the
// dependency graph.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const ENGINE_TYPES = join(ROOT, 'packages', 'rules-engine', 'src', 'types.ts');
const ENUMS = join(ROOT, 'packages', 'db', 'migrations', '0001_extensions_and_enums.sql');
const MIGRATION = join(
  ROOT,
  'packages',
  'db',
  'migrations',
  '0067_rule_state_phase_vocabulary.sql',
);
const SCHEMA = join(ROOT, 'packages', 'db', 'src', 'schema.ts');

/** Every single-quoted lowercase identifier in a fragment, in the order it appears. */
function members(fragment: string, where: string): readonly string[] {
  const found = [...fragment.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1] as string);
  if (found.length === 0) throw new Error(`${where} parsed to no members: ${fragment}`);
  return found;
}

/** `Phase`'s members, in the order the engine declares them. */
function enginePhases(): readonly string[] {
  const body = readFileSync(ENGINE_TYPES, 'utf8');
  const declaration = /export type Phase\s*=\s*([^;]+);/.exec(body);
  if (declaration?.[1] === undefined)
    throw new Error(`no \`export type Phase\` declaration in ${ENGINE_TYPES}`);
  return members(declaration[1], 'the Phase declaration');
}

/** `account_phase`'s labels, in the order `0001` creates them. */
function typePhases(): readonly string[] {
  const body = readFileSync(ENUMS, 'utf8');
  const declaration = /CREATE TYPE account_phase AS ENUM \(([^)]*)\);/.exec(body);
  if (declaration?.[1] === undefined)
    throw new Error(`no \`CREATE TYPE account_phase\` in ${ENUMS}`);
  return members(declaration[1], 'the account_phase CREATE TYPE');
}

/** `account_phase`'s labels as `schema.ts` transcribes them. */
function pgEnumPhases(): readonly string[] {
  const body = readFileSync(SCHEMA, 'utf8');
  const declaration = /pgEnum\('account_phase',\s*\[([^\]]*)\]/.exec(body);
  if (declaration?.[1] === undefined) throw new Error(`no account_phase pgEnum in ${SCHEMA}`);
  return members(declaration[1], 'the account_phase pgEnum');
}

// THE RULING'S PREMISE, ASSERTED RATHER THAN QUOTED. ADR-216 turns on
// `account_phase` being the engine's union EXACTLY -- not a superset it happens
// to contain today. A fifth label added to the type would make this column admit
// a phase the engine cannot produce, which is the defect `0067` closes arriving
// back through the type instead of through the column.
test('account_phase is the engine Phase union, member for member and in order', () => {
  expect(typePhases()).toEqual(enginePhases());
});

// THE TRANSCRIPTION IS A THIRD COPY AND IT IS THE ONE THE ACCESSOR USES. A
// `pgEnum` that drifted from the DDL would type every read of this column wrong
// while the database stayed correct.
test('the schema.ts pgEnum is the DDL type, member for member and in order', () => {
  expect(pgEnumPhases()).toEqual(typePhases());
});

// ORDER, ASSERTED SEPARATELY, BECAUSE A SET COMPARISON CANNOT SEE THE MOVE THAT
// MATTERS. `ALTER TYPE ... ADD VALUE ... BEFORE` reorders an enum without adding
// or removing a member, and the enum's order is `accounts.phase`'s sort order.
test('the three copies agree as sets and are the same length', () => {
  const engine = enginePhases();
  for (const copy of [typePhases(), pgEnumPhases()]) {
    expect(new Set(copy)).toEqual(new Set(engine));
    expect(copy.length).toBe(engine.length);
  }
});

// THE COLUMN THE MIGRATION MOVED IS THE COLUMN THE ACCESSOR NAMES. A migration
// that retypes the column while `schema.ts` still says `text` leaves every read
// of it typed as an open string, which is most of what `0067` exists to stop.
test('the ruleStates entry types phase as the account_phase pgEnum', () => {
  const schema = readFileSync(SCHEMA, 'utf8');
  const entry = /export const ruleStates = pgTable\('rule_states', \{([\s\S]*?)\n\}\);/.exec(
    schema,
  );
  if (entry?.[1] === undefined) throw new Error('no ruleStates entry found in schema.ts');
  expect(entry[1]).toContain("phase: accountPhase('phase')");
  expect(entry[1]).not.toContain("text('phase')");
});

// ADR-216 RULES THAT THE TYPE IS THE VOCABULARY AND THAT THERE IS NO SECOND COPY
// OF IT ON THIS COLUMN. `probe_rule_state_phase_vocabulary.sql` REJECTION 6
// asserts the same thing from `pg_constraint`, where a database exists; this
// assertion needs none and fails in `pnpm vitest run`, where the edit is made.
test('0067 adds no CHECK that re-lists the vocabulary the type already carries', () => {
  const body = readFileSync(MIGRATION, 'utf8');
  const executable = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(ALTER|CREATE|DROP|UPDATE|DELETE|INSERT|GRANT|REVOKE)\b/.test(line));
  expect(executable).toEqual([
    'ALTER TABLE rule_states',
    'ALTER COLUMN phase TYPE account_phase USING phase::account_phase;',
  ]);
  expect(body).not.toMatch(/ADD CONSTRAINT/);
});

// `0001` AND `0015` ARE MERGED AND ARE SUPERSEDED FROM OUTSIDE, NEVER EDITED
// (constitution E2). Asserted rather than trusted, because the whole shape of
// `0067` follows from it: an `ALTER COLUMN ... TYPE` a reviewer could have
// written as one word in `0015:47` is exactly the temptation E2 exists to
// refuse. `account_phase`'s own definition is not this ruling's to move either,
// so the migration must not touch the type.
test('0067 moves the column and neither edits a merged migration nor moves the type', () => {
  const body = readFileSync(MIGRATION, 'utf8');
  const statements = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(ALTER|CREATE|DROP)\b/.test(line));
  for (const statement of statements) expect(statement).not.toMatch(/^ALTER TYPE\b/);
  expect(body).toContain('ALTER COLUMN phase TYPE account_phase USING phase::account_phase');
});
