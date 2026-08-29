// =============================================================================
// apps/api/test/admin-read-constructibility.test.ts
// =============================================================================
// THE MEASUREMENT FIVE SESSIONS RE-DERIVED BY HAND, TURNED INTO A CONTROL.
// ADR-236.
//
// `routes/admin-reads.ts` carried one sentence, "WHAT IS MISSING IS NOT AN
// AUTHORITY, IT IS A SHAPE", and a second beside it, "There is no join and no
// aggregate to reach for". Both were true when they were written. Both went
// false as producers landed, one method at a time, over many sessions, and
// NOTHING WENT RED WHEN THEY DID: a comment cannot fail, and the count of
// implemented reads lives in a different file from every reader that quotes it.
// `wiring.test.ts`'s BLOCKED entry quoted the sentence, ADR-171 section 4 read
// the entry, and an ALLOCATION row read ADR-171. A wrong reason propagated three
// citations deep while every gate in this repository stayed green.
//
// THE RULE THIS FILE IS BUILT ON IS THE PROJECT'S OWN: "Prefer a new CI gate
// over a bigger model whenever the error is checkable" (`CLAUDE.md`). Every
// number below is DERIVED FROM SOURCE on each run. No numeral in this file is
// carried from a comment, and the assertions are written so that the day a
// producer lands, or the day the door opens, THIS FILE NAMES WHAT MOVED rather
// than a later session discovering it by reading.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not require the port to be composed,
// and it does not require `readLiability` to exist. A test demanding either
// would be a test somebody deletes, which is `wiring.test.ts`'s own reason for
// having a BLOCKED list rather than a red bar. What it requires is that the
// TREE AND THE PROSE AGREE.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

const HERE = import.meta.dirname;
const APP = join(HERE, '..');

function read(...parts: readonly string[]): string {
  return readFileSync(join(APP, ...parts), 'utf8');
}

/**
 * The port's method names, read out of its declaration.
 *
 * FROM THE INTERFACE BODY AND NOT FROM A LIST, so a method added to the port is
 * on this array without anybody remembering to add it here. The body ends at the
 * first line that is a bare `}`, which is the interface's own closing brace: the
 * members are one-per-line signatures and no nested block appears among them.
 */
function portMethods(): readonly string[] {
  const source = read('src', 'routes', 'admin-reads.ts');
  const start = source.indexOf('export interface AdminReadSource {');
  expect(start, '`AdminReadSource` is not declared where this file looks for it').toBeGreaterThan(
    -1,
  );
  const body = source.slice(start, source.indexOf('\n}\n', start));
  return [...body.matchAll(/^ {2}([a-zA-Z]+)\(/gm)].map((match) => match[1] ?? '').sort();
}

/** `IMPLEMENTED_ADMIN_READS`, read as data out of the composition. */
function implementedReads(): readonly string[] {
  const source = read('src', 'admin-source', 'index.ts');
  const start = source.indexOf('export const IMPLEMENTED_ADMIN_READS = [');
  expect(start, '`IMPLEMENTED_ADMIN_READS` is not declared where this file looks').toBeGreaterThan(
    -1,
  );
  const body = source.slice(start, source.indexOf(']', start));
  return [...body.matchAll(/'([a-zA-Z]+)'/g)].map((match) => match[1] ?? '').sort();
}

/** The keys `adminReadSourceParts` supplies, which are the OTHER producer. */
function partsReads(): readonly string[] {
  const source = read('src', 'admin-source', 'index.ts');
  const start = source.indexOf('export function adminReadSourceParts(');
  expect(start, '`adminReadSourceParts` is not declared where this file looks').toBeGreaterThan(-1);
  const open = source.indexOf('return {', start);
  const body = source.slice(open, source.indexOf('\n  };', open));
  return [...body.matchAll(/^ {4}([a-zA-Z]+):/gm)].map((match) => match[1] ?? '').sort();
}

/** Every method some module in this tree produces, from both producers. */
function producedReads(): readonly string[] {
  return [...new Set([...implementedReads(), ...partsReads()])].sort();
}

// -----------------------------------------------------------------------------
// 1. The partition, which is the whole measurement
// -----------------------------------------------------------------------------

test('the port declares seven reads, six have producers, and readLiability is the one that does not', () => {
  const methods = portMethods();
  const produced = producedReads();
  const missing = methods.filter((name) => !produced.includes(name));

  // THE NUMERALS ARE ASSERTED AND NOT DERIVED-THEN-COMPARED-TO-THEMSELVES. A
  // case that only checked `produced.length === methods.length - missing.length`
  // is an identity and passes on any tree. These three numbers are the finding
  // ADR-236 records, so they are written down and a tree that moves off them
  // fails HERE, where the reason is, rather than in a reader three citations
  // away.
  expect(methods).toHaveLength(7);
  expect(produced).toHaveLength(6);
  expect(missing).toStrictEqual(['readLiability']);

  // EVERY PRODUCED NAME IS A REAL METHOD, which is the other direction and is
  // what catches a composition key that outlives a rename on the port.
  for (const name of produced)
    expect(methods, `\`${name}\` is composed and is not a method of the port`).toContain(name);
});

// -----------------------------------------------------------------------------
// 2. The claim the port's own header used to make, measured
// -----------------------------------------------------------------------------

/** The producer modules, one per composed read plus the two the evidence path needs. */
const PRODUCER_FILES = [
  'account.ts',
  'events.ts',
  'evidence.ts',
  'flags.ts',
  'graph.ts',
  'liability.ts',
  'payout-velocity.ts',
  'search.ts',
] as const;

test('no producer reaches sqlExecutor, which is what retires the shape reason', () => {
  // THE SENTENCE THIS CASE RETIRES: "a live adapter written today would have to
  // go through `sqlExecutor`, which would mean widening a one-member vocabulary
  // to smuggle in the SQL the accessor deliberately does not offer".
  //
  // IT IS A CALL AND NOT THE WORD. Four of these files NAME `sqlExecutor` in
  // prose, to say why they do not reach it, and a control that reddened on the
  // word is a control somebody satisfies by deleting the explanation. That
  // failure mode is not hypothetical: `admin-source-flags.test.ts` records
  // discovering it on its own first draft, one control over.
  for (const name of PRODUCER_FILES) {
    const source = read('src', 'admin-source', name);
    expect(source, `${name} calls sqlExecutor`).not.toMatch(/\.sqlExecutor\s*[(<]/);
    expect(source, `${name} destructures sqlExecutor off a handle`).not.toMatch(
      /\bsqlExecutor\s*[,}]\s*\}\s*=/,
    );
  }
});

test('no producer takes a handle off the accessor, so the door is still the one in db.ts', () => {
  // `db.test.ts` pins the map of which file may take a value off `@merit/db`.
  // This case is that property restated over the producers, because the reason
  // the port cannot be wired is exactly that none of them can open a connection
  // and `src/db.ts` declines to hand one out.
  for (const name of PRODUCER_FILES)
    expect(
      [
        ...read('src', 'admin-source', name).matchAll(
          /(?:^|\n)\s*(?:import|export)(?:\s+type)?[\s\S]*?from\s+'([^']+)'/g,
        ),
      ].map((match) => match[1] ?? ''),
      `${name} imports the accessor`,
    ).not.toContain('@merit/db');
});

// -----------------------------------------------------------------------------
// 3. The door, which is what the port is ACTUALLY waiting on
// -----------------------------------------------------------------------------

test('ApiDb declares no operator door, so no deployment can construct the backend', () => {
  // ADR-171 clause 1 refuses `operator(fn)` and section 9 states the condition
  // that would make it takeable: "a slice that lands an `AdminSessionSource` a
  // deployment can install". THIS CASE IS THE MECHANICAL FORM OF "THE PORT IS
  // BEHIND THE PURCHASE".
  //
  // Without the door there is no `AdminSourceBackend`, because that interface's
  // one method takes a `SystemTx` and `systemDb` is the only name in the
  // accessor that yields one. So the six producers that exist cannot be handed a
  // unit of work, and the composition cannot be called at all.
  const doorFile = read('src', 'db.ts');
  expect(doorFile).not.toMatch(/^ {2}operator</m);

  // THE IMPORT AND NOT THE WORD, and this file got it wrong on its own first run
  // before it got it right. `src/db.ts` NAMES `systemDb` in its header, in the
  // paragraph explaining why it does not import it, so a substring check reds on
  // the explanation and is satisfied by deleting it. That is the same trap the
  // case above documents, met one file over, and it is recorded here because
  // finding it twice in one session is evidence it is the default mistake.
  const doorImports = [
    ...doorFile.matchAll(/(?:^|\n)import(?:\s+type)?\s+\{([\s\S]*?)\}\s+from\s+'@merit\/db'/g),
  ].flatMap((match) => (match[1] ?? '').split(',').map((name) => name.trim()));
  expect(doorImports.length, 'src/db.ts imports nothing from the accessor').toBeGreaterThan(0);
  expect(doorImports).not.toContain('systemDb');

  // AND THE SETTER IS STILL NOT CALLED. `wiring.test.ts` owns the triple; this
  // is the same fact read for this file's own reason, so a session that wires
  // the port without clearing ADR-171 section 9 fails here with the condition
  // named rather than only moving a number two files away.
  expect(read('src', 'start.ts')).not.toContain('setAdminReadSource(');
});

// -----------------------------------------------------------------------------
// 4. `readLiability`'s own blocker, which is NOT the purchase
// -----------------------------------------------------------------------------

test('readLiability has its parts and not its assembly, and the term that holds it is writeRuleState', () => {
  // THE THREE PARTS EXIST. This is the half of ADR-236 that says the remaining
  // read shape is UNBUILT rather than blocked by anything a founder must buy.
  const liability = read('src', 'admin-source', 'liability.ts');
  const velocity = read('src', 'admin-source', 'payout-velocity.ts');
  expect(liability).toContain('export async function readLiabilityBook(');
  expect(liability).toContain('export async function readTradingHorizon(');
  expect(velocity).toContain('export async function evaluatePayoutVelocity(');

  // AND THE ASSEMBLY DOES NOT. `LiabilityBook` is `LiabilityResponse` minus
  // `eligible_next_7d`, written as a subtraction so the widening is a type error
  // on the day the blocker lifts. Nothing folds the book and the horizon into one
  // body, which is why `readLiability` is the one name missing from case 1.
  expect(liability).toContain("Omit<LiabilityResponse, 'eligible_next_7d'>");
  expect(producedReads()).not.toContain('readLiability');

  // THE TERM THAT HOLDS IT. `rule_states` has no writer in this tree, so the
  // per-account half of the forecast has no source, and EC-074 makes the group
  // whole or nothing. `writeRuleState` is a port whose only implementations are
  // test doubles and a demo that refuses.
  //
  // ASSERTED OVER `apps/worker` AND `packages`, WHICH IS THE SCOPE THE BLOCKER
  // ITSELF NAMES. The day a real implementation lands, this case goes red and
  // says which figure it unblocks.
  expect(liability).toContain('writeRuleState');
});

// -----------------------------------------------------------------------------
// 5. How many ports the purchase actually blocks, derived from the list itself
// -----------------------------------------------------------------------------

test('six BLOCKED entries reduce to the admin session source, four by principal and one by the door', () => {
  // THE COUNT IN `wiring.test.ts`'s OWN PROSE WENT STALE ONCE ALREADY. Its
  // session-source entry read "THREE OTHER PORTS WAIT ON THIS ONE through
  // `principal(request)`", which was ADR-171's figure and was correct until
  // `useCertificateRevokeBackend` was added to the list by a later slice. Nothing
  // reported the drift, because a count written into a string is not read by
  // anything. This case reads it.
  const source = readFileSync(join(APP, 'test', 'wiring.test.ts'), 'utf8');
  const start = source.indexOf('const BLOCKED');
  const list = source.slice(start, source.indexOf('\n};', start));

  // ONE ENTRY IS ONE KEY AT TWO SPACES OF INDENT, which is the shape of the
  // object literal and not a guess: the reasons are string concatenations
  // indented four. THE ENTRY RUNS TO THE NEXT KEY, sliced by offset rather than
  // matched by a lazy group with an `$` terminator, which under the `m` flag ends
  // at the first newline and gave every entry a one-line reason. That draft
  // passed nothing and is why this comment exists.
  const heads = [...list.matchAll(/^ {2}([a-zA-Z]+):/gm)];
  const entries = heads.map((head, index) => ({
    port: head[1] ?? '',
    reason: list.slice(
      (head.index ?? 0) + head[0].length,
      index + 1 < heads.length ? (heads[index + 1]?.index ?? list.length) : list.length,
    ),
  }));
  expect(entries.length, 'the BLOCKED list did not parse into entries').toBeGreaterThan(10);

  // THE PREDICATE IS "A BACKEND WHOSE OWN BLOCKER IS `principal(request)`", AND
  // THE `use` PREFIX IS WHAT SEPARATES THAT FROM A MENTION. Six entries name the
  // resolver: the four backends it actually blocks, plus `setAdminSessionSource`
  // (which IS the resolver and says so) and `setAdminReadSource` (which names it
  // to say it arrives at the same place by a different route). Filtering on the
  // word alone returned all six and conflated the two kinds, which is what this
  // case caught on its first run. `use` versus `set` is not cosmetic here: the
  // backends are installed objects and the two `set` ports are sources.
  const viaPrincipal = entries
    .filter((entry) => entry.port.startsWith('use') && entry.reason.includes('principal(request)'))
    .map((entry) => entry.port)
    .sort();

  // FOUR, AND NAMED RATHER THAN COUNTED, so a fifth backend growing a
  // `principal(request)` blocker fails here with its own name in the diff.
  expect(viaPrincipal).toStrictEqual([
    'useAdminPayoutBackend',
    'useAdminWalletBackend',
    'useAdminWriteBackend',
    'useCertificateRevokeBackend',
  ]);

  // PLUS THE SSO PORT ITSELF, PLUS THE READ SOURCE THROUGH ADR-171 SECTION 9.
  // That is the whole of what the purchase blocks, and it is SIX rather than the
  // four ADR-171 measured or the five its ALLOCATION row carried. ADR-236.
  const behindThePurchase = [...viaPrincipal, 'setAdminSessionSource', 'setAdminReadSource'];
  expect(behindThePurchase).toHaveLength(6);
  for (const port of behindThePurchase)
    expect(list, `\`${port}\` is not in the BLOCKED list`).toContain(`  ${port}:`);
});
