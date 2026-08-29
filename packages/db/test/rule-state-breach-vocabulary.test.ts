import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

// =============================================================================
// rule-state-breach-vocabulary.test.ts
// =============================================================================
// THE COMPARATOR FOR A COPY. `0065_rule_state_lifetime_and_breach.sql` writes
// `BreachKind`'s three members into a CHECK constraint, and `types.ts` declares
// them. That is two copies of one statement, which is `FM-16` and which this
// corpus has found four times; the copy is admitted deliberately (a CHECK
// cannot import a TypeScript union) and this file is what stops it drifting.
//
// IT DERIVES BOTH SIDES AND CARRIES NEITHER. There is no list of breach kinds
// anywhere below. A fourth member added to `types.ts` turns this red and names
// the migration; a member renamed on either side turns it red and names both.
//
// THE PARSER GUARDS ITSELF, which is `migrations.integration.test.ts`'s idiom
// and the reason it is repeated here: a parser that stopped matching would make
// two empty sets compare equal and report PASS, which is the one failure a
// derivation can suffer that a hand-maintained copy cannot.
//
// `@merit/db` DOES NOT DEPEND ON `@merit/rules-engine` AND THIS FILE DOES NOT
// ADD ONE. The union is read as text, the way this package's other tests read
// `ALLOCATION.md`, so the assertion costs no edge in the dependency graph.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const ENGINE_TYPES = join(ROOT, 'packages', 'rules-engine', 'src', 'types.ts');
const MIGRATION = join(
  ROOT,
  'packages',
  'db',
  'migrations',
  '0065_rule_state_lifetime_and_breach.sql',
);
const SCHEMA = join(ROOT, 'packages', 'db', 'src', 'schema.ts');

/** `BreachKind`'s members, in the order the engine declares them. */
function engineBreachKinds(): readonly string[] {
  const body = readFileSync(ENGINE_TYPES, 'utf8');
  const declaration = /export type BreachKind\s*=\s*([^;]+);/.exec(body);
  if (declaration?.[1] === undefined)
    throw new Error(`no \`export type BreachKind\` declaration in ${ENGINE_TYPES}`);
  const members = [...declaration[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1] as string);
  if (members.length === 0)
    throw new Error(`the BreachKind declaration parsed to no members: ${declaration[1]}`);
  return members;
}

/** The vocabulary `0065`'s CHECK admits, in the order it writes them. */
function migrationBreachKinds(): readonly string[] {
  const body = readFileSync(MIGRATION, 'utf8');
  const check =
    /CONSTRAINT rule_states_breach_kind_is_a_breach_kind CHECK \(([\s\S]*?)\n {2}\);/.exec(body);
  if (check?.[1] === undefined)
    throw new Error(`no rule_states_breach_kind_is_a_breach_kind CHECK in ${MIGRATION}`);
  const members = [...check[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1] as string);
  if (members.length === 0) throw new Error(`the CHECK parsed to no members: ${check[1]}`);
  return members;
}

test('the 0065 breach vocabulary is BreachKind, member for member and in order', () => {
  expect(migrationBreachKinds()).toEqual(engineBreachKinds());
});

// A SET COMPARISON WOULD NOT HAVE CAUGHT THE ONE THAT MATTERS. `static_floor`
// and `trailing_eod_floor` are the two floor types `breach.ts:54` says the
// evidence pack must tell apart, so a swap between them is the drift with a
// consequence, and it is invisible to `toEqual` over sets.
test('the vocabulary is closed at exactly the engine members and admits no fourth', () => {
  const engine = engineBreachKinds();
  const migration = migrationBreachKinds();
  expect(new Set(migration)).toEqual(new Set(engine));
  expect(migration.length).toBe(engine.length);
});

// THE THREE COLUMNS EXIST IN THE ACCESSOR'S VIEW OF THE TABLE. `RuleState`
// requires all three and `readEligibility` rejects because none was reachable;
// a migration that adds them while `schema.ts` does not name them leaves the
// port exactly as blocked as it was.
test('the ruleStates entry names all three columns 0065 adds', () => {
  const schema = readFileSync(SCHEMA, 'utf8');
  const entry = /export const ruleStates = pgTable\('rule_states', \{([\s\S]*?)\n\}\);/.exec(
    schema,
  );
  if (entry?.[1] === undefined) throw new Error('no ruleStates entry found in schema.ts');
  for (const column of ['lifetime_settled_cents', 'breached', 'breach_kind'])
    expect(entry[1]).toContain(`'${column}'`);
});

// `0015` IS MERGED AND IS SUPERSEDED BY ADDITION, NEVER EDITED (constitution
// E2). Asserted here rather than trusted, because the whole shape of this
// migration follows from it: an `ALTER TABLE` that a reviewer could have
// written as three more lines in `0015` is the temptation E2 exists to refuse.
test('0065 only adds, and edits no merged migration', () => {
  const body = readFileSync(MIGRATION, 'utf8');
  const statements = body
    .split('\n')
    .filter((line) => /^(ALTER|CREATE|DROP|UPDATE|DELETE|INSERT)\b/.test(line.trim()));
  expect(statements.length).toBeGreaterThan(0);
  for (const statement of statements) expect(statement.trim()).toMatch(/^ALTER TABLE rule_states$/);
});

// SUCCESS 6 OF `probe_rule_states_calendar_revision.sql` ASSERTS A LITERAL
// SUBSTRING OF THIS COMMENT, and `0065` rewrites the comment. The probe runs
// only in the `corpus.yml` install job, which needs a database; this assertion
// needs none and fails in `pnpm vitest run`, where the edit is made.
test('the superseded state_hash comment preserves the substring SUCCESS 6 reads', () => {
  const body = readFileSync(MIGRATION, 'utf8');
  const comment = /COMMENT ON COLUMN rule_states\.state_hash IS([\s\S]*?);\n/.exec(body);
  if (comment?.[1] === undefined) throw new Error('0065 does not rewrite the state_hash comment');
  // The comment is written as adjacent SQL string literals, so the substring is
  // reassembled the way PostgreSQL reassembles it before it is looked for.
  const text = [...comment[1].matchAll(/'((?:[^']|'')*)'/g)]
    .map((m) => (m[1] as string).replace(/''/g, "'"))
    .join('');
  expect(text).toContain('calendar_revision_id are excluded');
});
