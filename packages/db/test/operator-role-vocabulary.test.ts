import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

// =============================================================================
// operator-role-vocabulary.test.ts
// =============================================================================
// THE COMPARATOR FOR A SET THAT EXISTS IN FOUR PLACES, on
// `rule-state-breach-vocabulary.test.ts`'s pattern one estate over.
// API_CONTRACT section 8 closes the admin role set at three members,
// `0073_operator_directory.sql` writes them into a CHECK constraint, and
// `admin-reads.ts` and `admin-writes.ts` EACH declare their own `ADMIN_ROLES`.
// THE FOURTH COPY WAS FOUND WHILE WRITING THIS FILE and it is the one a
// three-way check would have missed: two route modules in one deployable state
// the same closed set independently, and `admin-writes.ts` states it twice more
// besides, as `AdminRole` and as the constant. That is four copies of one
// statement, which is `FM-16`; the copies are admitted
// deliberately (a CHECK cannot import a TypeScript union and neither can a
// frozen markdown document) and this file is what stops them drifting.
//
// IT DERIVES ALL THREE SIDES AND CARRIES NONE. There is no list of roles
// anywhere below. A fourth role added on any one side turns this red and names
// the other two.
//
// THE CONTRACT IS THE AUTHORITY AND THE OTHER TWO ARE TRANSCRIPTIONS, which is
// why the assertions compare each against API_CONTRACT rather than against each
// other: two transcriptions that drift together would agree, and comparing them
// pairwise would report PASS on a corpus the database no longer implements.
//
// EACH PARSER GUARDS ITSELF, which is that file's stated idiom and the reason it
// is repeated here: a parser that stopped matching would make two empty sets
// compare equal and report PASS, which is the one failure a derivation can
// suffer that a hand-maintained copy cannot.
//
// `@merit/db` TAKES NO DEPENDENCY ON `apps/api` AND THIS FILE DOES NOT ADD ONE.
// All three sources are read as text, the way this package's other tests read
// `ALLOCATION.md`, so the assertion costs no edge in the dependency graph.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const API_CONTRACT = join(ROOT, 'docs', 'architecture', 'API_CONTRACT.md');
const MIGRATION = join(ROOT, 'packages', 'db', 'migrations', '0073_operator_directory.sql');
const ADMIN_READS = join(ROOT, 'apps', 'api', 'src', 'routes', 'admin-reads.ts');
const ADMIN_WRITES = join(ROOT, 'apps', 'api', 'src', 'routes', 'admin-writes.ts');

/**
 * The roles API_CONTRACT section 8 declares, in the order it writes them.
 *
 * THE LINE IS FOUND BY ITS OWN PREFIX AND NOT BY A LINE NUMBER, because five
 * documents in this corpus cite it at `API_CONTRACT:516` and it is at `:896`.
 * A citation drifts silently; a prefix match either finds the sentence or
 * throws.
 */
function contractRoles(): readonly string[] {
  const body = readFileSync(API_CONTRACT, 'utf8');
  const line = /^Roles: (.+)$/m.exec(body);
  if (line?.[1] === undefined) throw new Error(`no \`Roles:\` line in ${API_CONTRACT}`);
  // THE SENTENCE AND NOT THE LINE. The paragraph continues past the role set
  // into the `admin_actions` obligation, and both of the identifiers it names
  // there are backticked too, so a match over the whole line reads five roles.
  const sentence = line[1].split('. ')[0] ?? '';
  const members = [...sentence.matchAll(/`([a-z_]+)`/g)].map((m) => m[1] as string);
  if (members.length === 0) throw new Error(`the Roles sentence parsed to no members: ${sentence}`);
  return members;
}

/** The vocabulary `0073`'s CHECK admits, in the order it writes them. */
function migrationRoles(): readonly string[] {
  const body = readFileSync(MIGRATION, 'utf8');
  const check = /CHECK \(role IN \(([^)]*)\)\)/.exec(body);
  if (check?.[1] === undefined) throw new Error(`no \`CHECK (role IN (...))\` in ${MIGRATION}`);
  const members = [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
  if (members.length === 0) throw new Error(`the CHECK parsed to no members: ${check[1]}`);
  return members;
}

/** One module's `ADMIN_ROLES` members, in the order that module declares them. */
function apiRoles(file: string): readonly string[] {
  const body = readFileSync(file, 'utf8');
  const declaration = /export const ADMIN_ROLES = \[([^\]]*)\]/.exec(body);
  if (declaration?.[1] === undefined)
    throw new Error(`no \`export const ADMIN_ROLES\` declaration in ${file}`);
  const members = [...declaration[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
  if (members.length === 0)
    throw new Error(`the ADMIN_ROLES declaration parsed to no members: ${declaration[1]}`);
  return members;
}

/**
 * `admin-writes.ts`'s THIRD statement of the set, which is its `AdminRole` type.
 *
 * IT IS READ BECAUSE IT IS A SEPARATE COPY AND NOT A RESTATEMENT. That module
 * declares the union and then declares the constant `satisfies readonly
 * AdminRole[]`, which binds the constant to the union at compile time and binds
 * NEITHER of them to the contract or to the database.
 */
function writesRoleUnion(): readonly string[] {
  const body = readFileSync(ADMIN_WRITES, 'utf8');
  const declaration = /export type AdminRole = ([^;]+);/.exec(body);
  if (declaration?.[1] === undefined)
    throw new Error(`no \`export type AdminRole\` declaration in ${ADMIN_WRITES}`);
  const members = [...declaration[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
  if (members.length === 0)
    throw new Error(`the AdminRole declaration parsed to no members: ${declaration[1]}`);
  return members;
}

/**
 * The column names one `CREATE TABLE` in `0073` declares, comments stripped.
 *
 * IT GUARDS ITSELF for the parsers' stated reason: a body that parsed to no
 * columns would make every assertion below vacuously true, which is the exact
 * shape of a check that reports PASS while checking nothing.
 */
function columnsOf(table: string): readonly string[] {
  const body = readFileSync(MIGRATION, 'utf8');
  const create = new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\);`).exec(body);
  if (create?.[1] === undefined) throw new Error(`no \`CREATE TABLE ${table}\` in ${MIGRATION}`);
  const columns = create[1]
    .split('\n')
    .map((line) => /^ {2}([a-z_]+) /.exec(line.replace(/--.*$/, '')))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1] as string)
    .filter((name) => name !== 'CONSTRAINT');
  if (columns.length === 0) throw new Error(`the ${table} body parsed to no columns`);
  return columns;
}

test('0073 admits exactly the roles API_CONTRACT closes, member for member and in order', () => {
  expect(migrationRoles()).toEqual(contractRoles());
});

test('every API copy is exactly the roles API_CONTRACT closes, member for member and in order', () => {
  expect(apiRoles(ADMIN_READS)).toEqual(contractRoles());
  expect(apiRoles(ADMIN_WRITES)).toEqual(contractRoles());
  expect(writesRoleUnion()).toEqual(contractRoles());
});

// ORDER IS ASSERTED ABOVE AND MEMBERSHIP IS ASSERTED HERE, and the second is not
// implied by the first once a reader is tempted to relax it. `owner` is the only
// role that may change a role and `readonly` is the only one that may change
// nothing, so a swap between two members is the drift with a consequence and it
// is invisible to a comparison over sets.
test('the role set is closed at exactly three and no copy admits a fourth', () => {
  const contract = contractRoles();
  expect(contract.length).toBe(3);
  const copies = [
    migrationRoles(),
    apiRoles(ADMIN_READS),
    apiRoles(ADMIN_WRITES),
    writesRoleUnion(),
  ];
  for (const copy of copies) {
    expect(new Set(copy)).toEqual(new Set(contract));
    expect(copy.length).toBe(contract.length);
  }
});

// -----------------------------------------------------------------------------
// THE HALF THAT IS NOT A VOCABULARY
// -----------------------------------------------------------------------------
// `0073` IS A DIRECTORY AND NOT A LOGIN, and that is the one property in this
// file worth a mechanical assertion rather than a comment. `0002:280` states the
// rule for the whole schema -- "Merit is passwordless only, so THERE IS NO
// PASSWORD TABLE ANYWHERE IN THIS SCHEMA, by design" -- and the highest
// privilege door is where breaking it would cost the most.
//
// IT ASSERTS OVER THE COLUMNS AND NOT OVER THE PROSE. The header of that file
// says there is no credential in it, and a header cannot fail. The comments say
// so too, in words a substring check would match, which is why this reads the
// declared column names of both tables and nothing else.
test('0073 declares no credential column on either table', () => {
  const declared = [...columnsOf('operators'), ...columnsOf('operator_sessions')];
  expect(declared.length).toBeGreaterThan(10);
  for (const column of declared) {
    expect(column, `0073 declares a credential column \`${column}\``).not.toMatch(
      /password|passphrase|secret|api_key|shared_key|credential/,
    );
  }
});

// THE TOKEN IS A HASH AND THE COLUMN NAME IS WHERE THAT IS VISIBLE, on
// `sessions.refresh_token_hash` and `impersonation_sessions.token_hash`. A
// column named `token` on this table would be the raw value at rest, which is
// the failure the other two spell out in their own comments.
test('operator_sessions stores a hash and never a token', () => {
  const columns = columnsOf('operator_sessions');
  expect(columns).toContain('token_hash');
  expect(columns).not.toContain('token');
});

// THE REFERENT IS THE POINT OF THE MIGRATION AND THIS IS THE ONE LINE THAT
// DELIVERS IT. `0017:77` declares `actor text NOT NULL` with no foreign key, so
// "NO UNEXPLAINED ADMIN ACTION, EVER" rested on a constraint any string
// satisfies. Deleting the ALTER would leave two new tables nothing points at.
test('0073 gives admin_actions.actor a foreign key into the directory', () => {
  const body = readFileSync(MIGRATION, 'utf8');
  const alter =
    /ALTER TABLE admin_actions\s*\n\s*ADD CONSTRAINT admin_actions_actor_is_an_operator\s*\n\s*FOREIGN KEY \(actor\) REFERENCES operators\(actor\)\s*\n\s*ON UPDATE RESTRICT ON DELETE RESTRICT;/.exec(
      body,
    );
  expect(alter, 'no admin_actions_actor_is_an_operator foreign key in 0073').not.toBeNull();
});
