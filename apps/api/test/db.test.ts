// =============================================================================
// apps/api/test/db.test.ts
// =============================================================================
// THE ASSERTIONS ADR-171 IS WILLING TO HAVE WATCHED, AND AN HONEST STATEMENT OF
// WHAT EACH ONE COVERS.
//
// `src/db.ts` opens `scoped` and `firm` and declares NO THIRD DOOR, on ADR-120
// clause 3 and now on ADR-171. Until this file existed that ruling was a
// paragraph in a header, and that file says so about the neighbouring property
// in its own words: "It is a convention and it is not a control, and it is
// written down as a convention so nobody mistakes it for one."
//
// `apps/worker/test/db.test.ts` makes the same family of properties assertions
// over THAT deployable, and ADR-165 section 10 finding 5 recorded that the
// identical case for `apps/api` did not exist and named this fence as the one
// that could write it. This is that file.
//
// -----------------------------------------------------------------------------
// WHAT IT COVERS, WHICH IS THE USE AND NEVER THE ADMISSION
// -----------------------------------------------------------------------------
// `RI-08` in `packages/tooling/checks/repo-invariants.mjs` is the MANIFEST half
// over every workspace package, it runs in `CI-01`, and it is the control that
// decides whether this deployable may name the accessor at all. Nothing here
// duplicates it, because that check's own header states what a second copy
// costs: "Two lists is the defect; one list read twice is the fix."
//
// WHAT THIS FILE COVERS IS NARROWER AND IS INVISIBLE TO `RI-08`: what
// `apps/api` DOES with the capability now that it holds it. Three properties,
// each of which can go wrong silently, and every one of them a diff that
// compiles, lints and leaves every other suite in this deployable green.
//
//   1. THE DOOR COUNT AND THEIR NAMES. A third door added beside a slice that
//      wanted one is exactly the diff ADR-171 refuses, and section 5 of that
//      entry names the file it would be spent in: `auth-backend.ts` takes an
//      `ApiDb`, so a door declared for the admin console arrives in the handler
//      whose whole design is that a pre-identity read has no door (ADR-120 B1).
//   2. WHICH VALUES `src/db.ts` TAKES OFF THE ACCESSOR. `systemDb` is the one
//      name that would make `'operator-console'` reachable from this deployable,
//      and it is a one-word edit to an import list nobody re-reads.
//   3. THE ACQUISITION POINT, WHICH IS WHERE A HANDLE IS OBTAINED AND NOT WHERE
//      THE PACKAGE IS NAMED. Case 3 pins WHICH FILE TAKES WHICH VALUE off the
//      accessor, as a map, because writing it as "one file imports `@merit/db`"
//      is FALSE IN THIS TREE and was false before this file existed. See below.
//
// 2 AND 3 ARE ONE PROPERTY WHEN READ TOGETHER and neither is that property
// alone: case 3 says which files may take a value off the accessor and which
// value each may take, and case 2 pins `src/db.ts`'s list on its own so that
// `systemDb` arriving in the door file fails with the word in the message. A
// type-only import is deliberately not pinned, because a type buys no
// capability -- `import type { SystemTx }` cannot open anything, and a case
// that failed on one would be asserting a house style rather than an authority.
//
// -----------------------------------------------------------------------------
// THE ONE-FILE CONVENTION `src/db.ts` STATES IS ALREADY NOT TRUE, AND THIS FILE
// FOUND THAT BY BEING WRITTEN
// -----------------------------------------------------------------------------
// `src/db.ts`'s header says "`grep -rln '@merit/db' apps/api/src` returning
// exactly this file is that answer". It returns TWO: `src/routes/account-reads.ts`
// imports `atMost` (ADR-157's range term) for its cursor pagination at `:912`.
// The first draft of case 3 below asserted the sentence as written and FAILED on
// that line, which is the whole argument for the case existing: the convention
// had drifted, no gate could see it, and the header still described the tree as
// it was when it was written.
//
// AND THE DRIFT IS BENIGN, WHICH IS WHY THE CASE PINS A MAP RATHER THAN A COUNT.
// `atMost(value)` mints a frozen `FilterTerm` (`scoped-db.ts:662`). It opens no
// connection, holds no reason, yields no handle, and is useless without one of
// the four constructors that do. So the property with teeth is not "one file
// names the accessor", it is "ONE FILE TAKES A HANDLE FROM IT", and that is what
// `HANDLE_NAMES` below asserts by name. The map is pinned beside it so a SECOND
// benign import is a decision somebody sees rather than a silent second drift.
//
// -----------------------------------------------------------------------------
// THE INSTRUMENT IS THE IMPORT STATEMENT AND NEVER THE STRING, AND THAT WAS
// MEASURED RATHER THAN ANTICIPATED
// -----------------------------------------------------------------------------
// Six files under `apps/api/src` name `systemDb` in PROSE, every one of them in
// order to say that they do not reach it: `auth-backend.ts` names it inside the
// constant its refusals cite, `routes/admin-reads.ts` names it in the
// port header that stops at it, `routes/certificates.ts` names it to say the
// door would not serve an unauthenticated read. A substring check would count
// each of those as a violation of the property it is describing, which is
// ADR-165 section 9's measured lesson one deployable over.
//
// -----------------------------------------------------------------------------
// WHAT IT PROVES NOTHING ABOUT
// -----------------------------------------------------------------------------
// Whether a composed predicate reaches one row or many: that is `packages/db`'s
// and is asserted in `packages/db/test/keyed-accessor.test.ts`. Whether
// `SystemReason` still has two members: `packages/ledger/test/accessor-bind.test.ts`
// already parses that out of `scoped-db.ts` and a second copy here would be the
// two-lists defect one register over. And it does not STOP a third door: a
// session that decides to open one edits this file beside `src/db.ts`. That is
// the point rather than a weakness. The check cannot take the decision; it can
// only put the decision in the diff, which is what a paragraph in a header
// does not do.
// =============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { LIVE_DB } from '../src/db.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');

/** The accessor package, read from its own manifest rather than written here. */
function accessorPackageName(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(join(APP, '..', '..', 'packages', 'db', 'package.json'), 'utf8'),
  );
  const name = (manifest as { name?: unknown }).name;
  if (typeof name !== 'string' || name === '')
    throw new Error('packages/db declares no name; this suite has no accessor to look for');
  return name;
}

/** Every `.ts` file under this deployable's `src/`, absolute and sorted. */
function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) found.push(full);
    }
  };
  walk(join(APP, 'src'));
  return found.sort();
}

/**
 * Every bare module specifier a file imports, and whether the import was
 * type-only.
 *
 * Bare rather than relative, because a relative import resolves inside this
 * deployable; a bare one is a CAPABILITY, and under `.npmrc`'s
 * `node-linker=isolated` it resolves only if the manifest declares it. Static
 * `import`, `export ... from` and `import type` all match, which is every form
 * this tree uses.
 */
function importsIn(file: string): { specifier: string; typeOnly: boolean; clause: string }[] {
  const source = readFileSync(file, 'utf8');
  const found: { specifier: string; typeOnly: boolean; clause: string }[] = [];
  for (const match of source.matchAll(
    /(?:^|\n)\s*(?:import|export)(\s+type)?([\s\S]*?)from\s+'([^']+)'/g,
  )) {
    const specifier = match[3] ?? '';
    if (specifier.startsWith('.')) continue;
    found.push({ specifier, typeOnly: match[1] !== undefined, clause: match[2] ?? '' });
  }
  return found;
}

/** The names inside one `{ ... }` import clause, in source order. */
function namedBindings(clause: string): string[] {
  const braced = /\{([^}]*)\}/.exec(clause);
  if (braced === null) return [];
  return (braced[1] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

// -----------------------------------------------------------------------------
// 1. The door count, which is the diff ADR-171 refuses
// -----------------------------------------------------------------------------

test('there are exactly four doors, and the one ADR-171 refused is still not one of them', () => {
  // `LIVE_DB` IS TYPED `ApiDb`, SO THE INTERFACE IS CHECKED THROUGH ITS ONE
  // IMPLEMENTATION. A method added to the interface and not to this value does
  // not compile, and a method added to both lands here. That is why the case
  // reads a runtime object rather than parsing a type: the type has a witness.
  // FOUR SINCE ADR-200, AND THE ORDER IS THE DECLARATION'S. `resolution` is
  // ADR-126's pre-identity read and `establishment` is ADR-197's one-verb write,
  // both narrowed AT THE DOOR by a type in `packages/db` rather than by a
  // convention here: `ResolutionDb` reads one row of one table at one address
  // and has no `transaction` overload at all, and `EstablishmentTx` carries
  // `establish` and no other verb, no key vocabulary and no `sqlExecutor`.
  expect(Object.keys(LIVE_DB)).toEqual(['scoped', 'firm', 'resolution', 'establishment']);

  // NOT `operator`, written as its own expectation rather than left implied by
  // the line above, because a reader of a failing suite should see the word
  // ADR-171 refused. THAT REFUSAL IS UNMOVED BY THE TWO DOORS ABOVE and the
  // distinction is the whole of ADR-200 section 3: `operator(fn)` would hand
  // `databaseAuthBackend` a `SystemTx` over every table at the reason word
  // `'operator-console'`, which is ADR-120's B1 answered by accident. These two
  // answer B1 on purpose, at a vocabulary of one table and one verb.
  expect(Object.keys(LIVE_DB)).not.toContain('operator');
  expect(Object.keys(LIVE_DB)).not.toContain('system');

  // THE ARITY IS THE OTHER HALF OF THE SHAPE. A `system(reason, fn)` door
  // arriving under one of the two names above would pass the key check and
  // fail here: `firm` takes the unit of work and nothing else, and `scoped`
  // takes the identity the handler resolved and then the unit of work.
  // `Function.length` counts declared parameters before the first default or
  // rest, which is exactly the shape being pinned.
  expect(LIVE_DB.scoped.length).toBe(2);
  expect(LIVE_DB.firm.length).toBe(1);
  // BOTH NEW DOORS TAKE THE UNIT OF WORK AND NOTHING ELSE. A `resolution(email,
  // fn)` or an `establishment(reason, fn)` would be a door whose first argument
  // is a value a caller chooses, which is the shape `firm` deliberately does not
  // have and `system` was refused for having.
  expect(LIVE_DB.resolution.length).toBe(1);
  expect(LIVE_DB.establishment.length).toBe(1);
});

// -----------------------------------------------------------------------------
// 2. What `src/db.ts` takes off the accessor, which is where `'operator-console'`
//    would become reachable
// -----------------------------------------------------------------------------

test('src/db.ts imports five values from the accessor and systemDb is not one of them', () => {
  const accessor = accessorPackageName();
  const values = importsIn(join(APP, 'src', 'db.ts'))
    .filter((entry) => entry.specifier === accessor && !entry.typeOnly)
    .flatMap((entry) => namedBindings(entry.clause))
    .sort();

  // `systemDb` IS THE ONLY NAME IN `packages/db` THAT YIELDS AN UNSCOPED
  // HANDLE, and `SystemReason` already carries `'operator-console'` (ADR-165
  // clause 3 ruled it gains no member). So the vocabulary was never the
  // obstacle and this list is: with case 3 below making this the only file that
  // may import the accessor at all, the two together are the mechanical form of
  // "this deployable cannot open a door at the operator reason".
  // FIVE SINCE ADR-200. The two added are CONSTRUCTORS FOR THE TWO DOORS ABOVE
  // and neither widens what this file can reach: `resolutionDb()` yields a
  // reader over `users` by `email`, and `establishmentDb()` yields a handle
  // whose transaction has one verb. `systemDb` is still absent and that is the
  // name this case exists for.
  expect(values).toEqual(['establishmentDb', 'firmDb', 'resolutionDb', 'scopedDb', 'transaction']);
});

// -----------------------------------------------------------------------------
// 3. The acquisition point, which ADR-165 finding 5 rowed as owed to this fence
// -----------------------------------------------------------------------------

/**
 * Every export of `packages/db` that YIELDS A HANDLE.
 *
 * The FIVE constructors plus the function that turns one into a transaction with
 * the write methods attached. Nothing else in that package can reach a
 * connection: `atMost` and its sibling terms mint frozen values,
 * `normalizedEmail` is a pure function over a string, `IdentityAlreadyEstablished`
 * is an error class, and the rest of the surface is types.
 *
 * `resolutionDb` AND `establishmentDb` ARE ON THIS LIST RATHER THAN EXEMPT FROM
 * IT. They are narrow, and narrow is not the same as harmless: each opens a real
 * connection at an authority holding no identity, so the property this case
 * asserts -- that `src/db.ts` is the only file that can obtain one -- is the
 * property that matters most about them.
 */
const HANDLE_NAMES = [
  'establishmentDb',
  'firmDb',
  'resolutionDb',
  'scopedDb',
  'systemDb',
  'transaction',
] as const;

test('only src/db.ts takes a handle off the accessor, and the other importer takes a term', () => {
  const accessor = accessorPackageName();

  /** Every file under `src/` that takes a VALUE off the accessor, to what it takes. */
  const taken: Record<string, readonly string[]> = {};
  for (const file of sourceFiles()) {
    const names = importsIn(file)
      .filter((entry) => entry.specifier === accessor && !entry.typeOnly)
      .flatMap((entry) => namedBindings(entry.clause))
      .sort();
    if (names.length > 0) taken[relative(APP, file).split('\\').join('/')] = names;
  }

  // THE HALF WITH TEETH, ASSERTED FIRST SO ITS FAILURE NAMES THE HANDLE AND THE
  // FILE. The map below would also fail on this diff, and it would report a
  // shape mismatch where this reports "src/routes/wallet.ts takes scopedDb".
  // This is the property `src/db.ts`'s header is actually about: not where the
  // package is named, but where a connection can be obtained.
  const elsewhere = Object.entries(taken)
    .filter(([file]) => file !== 'src/db.ts')
    .flatMap(([file, names]) =>
      names
        .filter((name) => (HANDLE_NAMES as readonly string[]).includes(name))
        .map((name) => `${file} takes ${name}`),
    )
    .sort();

  expect(elsewhere).toEqual([]);

  // THE MAP, PINNED, AS THE BROADER NET. A new importer, or a new name at an
  // existing one, is a decision a reviewer sees rather than a line that lands
  // with a feature -- benign or not.
  // `src/auth-backend.ts` IS THE THIRD IMPORTER AND IT TAKES NO HANDLE. Every
  // name it takes is inert on its own: three ADR-157 filter terms, the
  // normalizer `otp_challenges.email_normalized` is keyed on -- exported by
  // `packages/db` for exactly this caller, so that one entity-resolution key has
  // one spelling -- and the error class the establishment door raises when
  // `users_email_key` arbitrates a race. None of them opens anything, which is
  // why the `elsewhere` assertion above is empty on this diff and this map
  // records it as a decision rather than as a violation.
  expect(taken).toEqual({
    'src/auth-backend.ts': [
      'IdentityAlreadyEstablished',
      'atLeast',
      'atMost',
      'isNull',
      'normalizedEmail',
    ],
    'src/db.ts': ['establishmentDb', 'firmDb', 'resolutionDb', 'scopedDb', 'transaction'],
    'src/routes/account-reads.ts': ['atMost'],
  });
});
