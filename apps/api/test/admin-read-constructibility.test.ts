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

// **THIS CASE PROMISED A RED IT COULD NOT DELIVER AND `ADR-269` IS WHERE THAT
// WAS FOUND.** It read "the day a real implementation lands, this case goes red
// and says which figure it unblocks", and asserted `expect(liability).toContain
// ('writeRuleState')` -- a string in a COMMENT of the module it was reading.
// `writeRuleStateVia` landed in session 395 and this case stayed green, because
// what it measured was the blocker's own prose and never the tree. A case that
// pins a sentence about a term instead of the term is the shape RI-15 and RI-16
// exist for, one level up: the citation is to a claim rather than to a line.
//
// So both halves are read at their own sources now: the RETIRED term over the
// scope the blocker named, POSITIVELY, and the LIVE term over the two files that
// hold it.
test('readLiability has its parts and its fold, and what holds it is an unsupplied port', () => {
  // THE THREE PARTS EXIST. This is the half of ADR-236 that says the remaining
  // read shape is UNBUILT rather than blocked by anything a founder must buy.
  const liability = read('src', 'admin-source', 'liability.ts');
  const velocity = read('src', 'admin-source', 'payout-velocity.ts');
  expect(liability).toContain('export async function readLiabilityBook(');
  expect(liability).toContain('export async function readTradingHorizon(');
  expect(velocity).toContain('export async function evaluatePayoutVelocity(');

  // **AND THE BODY THAT FOLDS THEM EXISTS NOW**, which is the sentence this
  // case carried for eight sessions and can no longer carry: "nothing folds
  // them into one body".
  const fold = read('src', 'admin-source', 'eligible-next-7d.ts');
  expect(fold).toContain('export async function readEligibleNext7d(');

  // THE ASSEMBLY IS STILL NOT COMPOSED ALL THE SAME. `LiabilityBook` is
  // `LiabilityResponse` minus `eligible_next_7d`, written as a subtraction so
  // the widening is a type error on the day the blocker lifts, and
  // `readLiability` is still the one name missing from case 1.
  expect(liability).toContain("Omit<LiabilityResponse, 'eligible_next_7d'>");
  expect(producedReads()).not.toContain('readLiability');

  // THE RETIRED TERM, READ AT SOURCE AND IN THE SCOPE THE BLOCKER NAMED
  // (`apps/worker/**` and `packages/**`). It is spent: the implementation
  // exists, the adapter composes it on the engine's codec, and ADR-264 section
  // 2 measured it writing a row.
  const root = join(APP, '..', '..');
  const writer = readFileSync(join(root, 'apps/worker/src/batch/state-writer.ts'), 'utf8');
  expect(writer).toContain('export function writeRuleStateVia');
  expect(readFileSync(join(root, 'apps/worker/src/batch/adapter.ts'), 'utf8')).toContain(
    'writeRuleState: writeRuleStateVia(',
  );

  // **THE LIVE TERM, AND THE SENTENCE THAT STOOD HERE IS FALSE (`ADR-283`).** It
  // read: "`plan_versions.rules` decodes in exactly one place in this repository
  // and it is not this deployable". The engine exports the decoder, this
  // deployable declares that package and `payout-backend.ts` calls it, so the
  // move `ADR-239` slice A ruled has landed and the fold's `plan` input is NOT
  // waiting on it. Both halves are read at source below rather than described,
  // because the claim this comment replaces went stale exactly by being prose.
  expect(readFileSync(join(root, 'packages/rules-engine/src/index.ts'), 'utf8')).toContain(
    'export { decodePlanRules',
  );
  expect(read('src', 'payout-backend.ts')).toContain('decodePlanRules(');

  // AND `toPublishedRules` IS STILL THERE, which is now evidence of the OTHER
  // half rather than of the retired one: the predicate is stated three times in
  // this tree and `rule-state-producibility.test.ts` link 7 holds that census.
  expect(readFileSync(join(root, 'apps/worker/src/batch/adapter.ts'), 'utf8')).toContain(
    'function toPublishedRules(',
  );

  // **WHAT HOLDS THE FOLD IS THE UNSUPPLIED PORT AND NOT THE DECODER.** Nothing
  // in this deployable composes the decode with the account's size row on a
  // transaction this fold holds, so the injected term still refuses by name and
  // `readLiability` is still the one method with no producer.
  expect(fold).toContain('export class EligibleFoldUnwired');
  expect(fold).not.toContain('schema_version');
});

// -----------------------------------------------------------------------------
// 5. How many ports the purchase actually blocks, derived over the WHOLE list
// -----------------------------------------------------------------------------
//
// **THIS CASE WAS GREEN AND ITS STATED CONCLUSION WAS WRONG, WHICH IS THE EXACT
// SHAPE IT WAS WRITTEN TO CATCH ONE LEVEL DOWN.** It read `wiring.test.ts`'s
// `BLOCKED` list, derived the `use`-prefixed entries naming `principal(request)`,
// added two names by hand, and concluded "that is the whole of what the purchase
// blocks, and it is SIX". `ADR-312` sorted the thirteen doors and found EIGHT:
// `useCheckoutBackend` says in its own words that what is left "IS THE OPERATOR
// ROUTE AND IT IS BEHIND THE SSO PURCHASE", and `setInternalOpsSource` says
// `ADR-171` clause 1 refuses its door "until an `AdminSessionSource` a deployment
// can install exists". **NEITHER IS `use`-PREFIXED-AND-NAMING-`principal`, so
// neither was counted.**
//
// **THE PREDICATE WAS THE DEFECT AND THE NUMERAL WAS ONLY ITS SYMPTOM.** A
// prefix and a phrase describe how FOUR of the eight happen to be written; they
// are not what makes an entry behind the purchase. What makes an entry behind the
// purchase is that it reduces to `AdminSessionSource`, the port whose own reason
// names the thing `SECURITY.md`'s C-08 row calls "a purchase Merit has not made".
// So the set is derived over EVERY entry by that property, and the day a
// fifteenth entry reduces to that port it is in this list without anybody
// remembering to add it.
//
// **THE FIGURE IS NOT ASSERTED AS A NUMERAL AND THAT IS DELIBERATE.** This file's
// case 1 asserts numerals because they are ADR-236's finding; here a numeral is
// what went stale, so what is asserted is the MEMBERSHIP, named, on
// `viaPrincipal`'s own stated rule below: a port entering or leaving the set
// fails here with its own name in the diff rather than moving a digit somewhere
// a reader has to trust.
//
// **THE ENTRY TEXT IS READ WITH ITS TRAILING COMMENTS STRIPPED, WHICH THE OLD
// PARSE DID NOT DO.** An entry runs to the next key, and this file's own comment
// says so; but the block comment introducing the NEXT entry sits inside that
// span, so a `BLOCKED` entry was being credited with prose about its successor.
// It moves no result on this tree, measured, and it is the kind of thing that
// moves one silently later.

/** One `BLOCKED` entry: its port name and its reason text, comments removed. */
interface BlockedEntry {
  readonly port: string;
  readonly reason: string;
}

/** `wiring.test.ts`'s `BLOCKED` map, parsed as data. */
function blockedEntries(): readonly BlockedEntry[] {
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
    reason: list
      .slice(
        (head.index ?? 0) + head[0].length,
        index + 1 < heads.length ? (heads[index + 1]?.index ?? list.length) : list.length,
      )
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n'),
  }));

  expect(entries.length, 'the BLOCKED list did not parse into entries').toBeGreaterThan(10);
  return entries;
}

/**
 * The port the purchase IS, named once so the two cases below cannot drift apart.
 *
 * It is not a hardcoded member of the answer: it is the port whose own reason
 * carries the purchase, asserted before anything is counted.
 */
const SSO_PORT = 'setAdminSessionSource';

test('the entry that names the purchase is the SSO port, so the reduction has an anchor', () => {
  // `SECURITY.md`'s C-08 row, as amended by ADR-237 section 3, is where the
  // corpus says this is bought rather than built: "Who is this person is the
  // identity provider's, is hardware-key SSO, and is a purchase Merit has not
  // made." THIS CASE IS THAT SENTENCE FOUND IN THE MAP, so the derivation below
  // is anchored to a reason a reader can open rather than to a name in this file.
  const sso = blockedEntries().find((entry) => entry.port === SSO_PORT);
  expect(sso, `\`${SSO_PORT}\` is not in the BLOCKED list`).toBeDefined();
  expect(sso?.reason).toMatch(/hardware-key SSO/);
  expect(sso?.reason).toMatch(/that is a purchase/);

  const security = readFileSync(join(APP, '..', '..', 'docs/architecture/SECURITY.md'), 'utf8');
  expect(security).toContain('a purchase Merit has not made');
});

test('every BLOCKED entry the purchase blocks, derived over the whole list and named', () => {
  const entries = blockedEntries();

  // THE PREDICATE IS "THIS ENTRY REDUCES TO THE SSO PORT", read as the entry
  // naming `AdminSessionSource` at all -- the interface or the setter, since
  // `setInternalOpsSource` reduces through ADR-171's clause about the interface
  // and never writes the setter's name. THE PORT ITSELF IS IN BY IDENTITY AND
  // NOT BY MENTION: its own reason names the purchase and not the port.
  const behindThePurchase = entries
    .filter((entry) => entry.port === SSO_PORT || entry.reason.includes('AdminSessionSource'))
    .map((entry) => entry.port)
    .sort();

  // EIGHT, NAMED RATHER THAN COUNTED. ADR-312 derived this set by hand over the
  // thirteen doors it sorted; this is the same set derived by a predicate, and
  // the two agree.
  expect(behindThePurchase).toStrictEqual([
    'setAdminReadSource',
    'setAdminSessionSource',
    'setInternalOpsSource',
    'useAdminPayoutBackend',
    'useAdminWalletBackend',
    'useAdminWriteBackend',
    'useCertificateRevokeBackend',
    'useCheckoutBackend',
  ]);

  // **THE WORD IS NOT THE PREDICATE, AND THIS IS THE GUARD THAT KEEPS A
  // SUCCESSOR FROM MAKING IT ONE.** `usePayoutBackend` calls its own missing
  // backend "the whole purchase" and is behind no purchase at all, so a check
  // that matched the noun would count nine and be wrong in a new direction.
  const namesTheWord = entries
    .filter((entry) => entry.reason.includes('purchase'))
    .map((entry) => entry.port);
  expect(namesTheWord).toContain('usePayoutBackend');
  expect(behindThePurchase).not.toContain('usePayoutBackend');
});

test('four of the eight reduce through principal(request), and they are named', () => {
  // THE COUNT IN `wiring.test.ts`'s OWN PROSE WENT STALE ONCE ALREADY. Its
  // session-source entry read "THREE OTHER PORTS WAIT ON THIS ONE through
  // `principal(request)`", which was ADR-171's figure and was correct until
  // `useCertificateRevokeBackend` was added to the list by a later slice. Nothing
  // reported the drift, because a count written into a string is not read by
  // anything. This case reads it.
  //
  // THE PREDICATE IS "A BACKEND WHOSE OWN BLOCKER IS `principal(request)`", AND
  // THE `use` PREFIX IS WHAT SEPARATES THAT FROM A MENTION. Six entries name the
  // resolver: the four backends it actually blocks, plus `setAdminSessionSource`
  // (which IS the resolver and says so) and `setAdminReadSource` (which names it
  // to say it arrives at the same place by a different route). Filtering on the
  // word alone returned all six and conflated the two kinds, which is what this
  // case caught on its first run. `use` versus `set` is not cosmetic here: the
  // backends are installed objects and the two `set` ports are sources.
  //
  // **THIS IS A SUBSET AND NO LONGER THE ANSWER**, which is the whole of what the
  // case above repairs: four is how many reduce THROUGH THE RESOLVER, and it was
  // read for eight sessions as how many the purchase blocks.
  const viaPrincipal = blockedEntries()
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
});
