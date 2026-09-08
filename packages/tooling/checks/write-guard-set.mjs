// =============================================================================
// packages/tooling/checks/write-guard-set.mjs
// =============================================================================
// THE GUARDS ON THE WRITE BUILDERS ARE A DECLARED SET, AND THIS ASSERTS THE
// DECLARATION IS THE WHOLE OF IT.
//
//   node packages/tooling/checks/write-guard-set.mjs
//
// `ADR-448` section 8 item 5 is the whole of the motivation and it is quoted
// rather than paraphrased:
//
//   "`updateStatementOn` HAS THREE GUARDS AND NO CHECK ASSERTS THEY ARE THE
//    WHOLE SET. `refuseTenancyColumn` at `:473`, `refuseTermInValues` at `:946`
//    and `refuseGeneratedColumn`. A fourth rule arriving is guarded by whoever
//    remembers this list. Price: an assertion over the builder's body, which is
//    a shape this tree does not have anywhere yet."
//
// The failure is narrow and worth stating in one sentence: somebody adds a
// fourth refusal rule to the money-path update builder, puts it in ONE builder,
// and nothing notices it is missing from the others.
//
// -----------------------------------------------------------------------------
// WHY THIS IS SIX LEGS AND NOT ONE PINNED LIST
// -----------------------------------------------------------------------------
// A check that pinned only `updateStatementOn`'s three names would go red when
// that builder changed and STAY GREEN for the failure above, because adding a
// guard to `scopedInsertStatement` alone leaves the update builder's list
// untouched. The list is not the property. The property is the MATRIX: which
// builder calls which guard, and, for every cell that is empty, whether anybody
// has said why.
//
//   Leg A  the guard roster is closed. A `refuse*` declaration that is not
//          pinned here is a rule nobody has placed.
//   Leg B  the builder roster is closed. A function that constructs an INSERT,
//          UPDATE or DELETE and is not pinned here is a builder nobody has
//          guarded.
//   Leg C  the matrix is pinned, per builder, together with the count of
//          refusals that builder throws INLINE rather than through a guard.
//   Leg D  every empty cell is DECLARED, with a reason, and the reason is
//          classed `SETTLED` or `OPEN`.
//   Leg E  every function a pinned builder CALLS, which throws and is not
//          itself a builder, is either a guard by name or a declared non-guard.
//   Leg F  the convention literal this check matches on is still present in the
//          lint rule that carries the second copy of it.
//
// LEG D IS THE ONE THAT ANSWERS THE MOTIVATING FAILURE and legs A to C are what
// make leg D's inputs trustworthy. Under leg C alone, an author who adds a guard
// to one builder updates one cell and is finished. Under leg D, that same edit
// turns every OTHER builder's cell for the new guard into an undeclared absence,
// and the author has to write down, per builder, why it does not apply there.
// That is the difference between a list somebody remembers and a list something
// checks.
//
// -----------------------------------------------------------------------------
// WHAT THIS CHECK CANNOT DO, STATED HERE RATHER THAN DISCOVERED LATER
// -----------------------------------------------------------------------------
// IT DOES NOT ADJUDICATE AN ABSENCE. Leg D requires a reason to EXIST; it cannot
// tell a correct reason from a plausible one, and a reason classed `OPEN` keeps
// the check green ON PURPOSE. A check that went red on the tree it ships with is
// a check somebody deletes in the first week. What this converts is an unwritten
// convention into a written one with a tripwire on it, and that is the whole of
// the claim.
//
// IT READS NAMES AND NOT BEHAVIOUR. A "guard" here is a function declared in
// `scoped-db.ts` whose name matches `CONVENTION`. That convention is real and
// file-wide (nine declarations at the base this was written on) but it IS a
// convention: a refusal added under another name is invisible to legs A and D.
// Leg C's inline-throw count covers one part of that hole, because a refusal
// written inline instead of as a named guard changes the count. LEG E COVERS THE
// REST OF IT, and legs C and E do not overlap: leg C sees a `throw` written in
// the builder's own body and leg E sees one written in a function the builder
// calls.
//
// -----------------------------------------------------------------------------
// WHY THE MATCHER IS POSITION-INDEPENDENT, WHICH IS NOT A DETAIL
// -----------------------------------------------------------------------------
// The three guards on `updateStatementOn` DO NOT SHARE A SHAPE. Two are void
// calls in statement position and the third is an expression wrapping the
// `.set(...)` argument, because it returns the values it cleared. That is not a
// preference: `scoped-db.ts`'s own block header says the call "REPLACES the text
// of `:1221` rather than inserting a line above it, which is why the guard
// returns the values it cleared instead of returning `void` like the two guards
// beside it. THAT SHAPE IS FORCED BY THE CITATION CONSTRAINT AND IS NOT A
// PREFERENCE."
//
// So a matcher that looked for leading void statements would have missed the
// most recently added guard of the three, which is exactly the guard the next
// one will most resemble. This one searches the whole body for a call by name
// and cares nothing for where it sits. The same constraint that forced that
// shape will force the next one, so this is the only matcher with a future.
//
// -----------------------------------------------------------------------------
// LEG E, AND WHY IT DECLARES RATHER THAN CONVICTS
// -----------------------------------------------------------------------------
// `ADR-459` section 9 item 1 priced this leg and worded it as a conviction:
// "every function `scoped-db.ts` calls FROM a pinned write builder, whose own
// body throws and which is not itself a builder, MATCHES the convention". That
// PREDICATE is kept here in full. Its DISPOSITION is not, and the reason is
// measurement rather than taste: on the tree this leg landed against the
// predicate reaches SIX functions and THREE of them do not match, and all three
// are legitimate. `columnByName` throws on a registry/schema drift, `bothOf`
// throws on a composition drizzle-orm cannot produce, and `scopePredicate`
// throws on a `pair` key that has no scoped reading. None of the three refuses a
// caller's write and none of them should be renamed `refuse*`.
//
// SO THE SHAPE THAT ENTRY FEARS IS NOT MERELY RESEMBLED BY LEGITIMATE CODE, IT
// IS INSTANTIATED BY IT. `scopePredicate` returns a value, carries a non-verb
// name, and its own comment calls its `pair` throw "the runtime half of a type
// refusal". That IS the expression-shaped guard under a non-verb name, spelled
// exactly, inside a function whose purpose is to build a predicate. No predicate
// over names, return shapes or throw positions separates it from the arrival
// item 1 wants caught, because there is nothing there to separate.
//
// WHAT IS LEFT IS THE INSTRUMENT LEG D ALREADY USES ON THE SAME CLASS OF
// PROBLEM, and it is taken from leg D rather than invented: an absence is not
// adjudicated, it is DECLARED, with a class. The predicate is not narrowed by
// one term to make the tree green -- all six functions are still evaluated by it
// -- and the only thing that changes is that a non-conformer may be answered in
// writing instead of only in red. A seventh arrival that nobody answers is red,
// and that is the failure item 1 names.
//
// A REVIEWER WHO WANTS THE STRICT WORDING CAN HAVE IT for the price of deleting
// `DECLARED_THROWER` and the four lines that read it, at which point this check
// exits 1 on a clean tree and names those three functions. That is a legible
// choice and it is written down here so that it stays one.
//
// WHAT LEG E STILL CANNOT SEE, stated rather than discovered later. A refusal
// reached through a VALUE rather than a name -- a guard passed in as a callback,
// or held in a table and called off it -- is invisible to it, because it matches
// a call by identifier. It also reads `function` declarations only, which costs
// nothing on this file today (`scoped-db.ts` declares no function as a `const`
// arrow, measured, 0 of them) and would cost the whole leg on a file that did.
//
// -----------------------------------------------------------------------------
// LEG F, AND THE ONE THING IT MUST NOT KEY ON
// -----------------------------------------------------------------------------
// `ADR-459` section 9 item 2: the convention is written in two places and
// nothing ties them together. `refusal-naming.js` holds `/^refuse[A-Z]/` and so
// does this file. Leg F asserts the rule file CONTAINS the literal this checker
// matches with, read off `CONVENTION` rather than typed a third time.
//
// IT KEYS ON PRESENCE AND ON NOTHING ELSE. Not the line the literal sits on, not
// how many legs that rule has, not the length or the hash of that file. The rule
// file is under active edit by other work, and a leg keyed on any of those would
// go red at the next legitimate change to a file this check does not own, which
// is the one reliable way to make a checker something people route around.
//
// IT STRIPS COMMENTS FIRST, which is `RI-25`'s lesson rather than a flourish:
// that check's first version reported PASS with the call it asserts COMMENTED
// OUT, because the file's own header explained the repair at length. A rule file
// whose regex is commented out has lost the convention as surely as one that
// deleted it, and a raw-text search cannot tell those two apart.
// `strip-comments.mjs` preserves regular-expression literals deliberately ("A
// REGULAR EXPRESSION LITERAL IS CODE AND IS MODELLED"), which is what makes the
// literal readable through the stripper at all.
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { stripComments } from './strip-comments.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {{ name: string; line: number; body: string }} Declared
 * @typedef {{ name: string; line: number; guards: string[]; throws: number; throwers: string[] }} Builder
 * @typedef {{ functions: Declared[]; guards: string[]; builders: Builder[] }} Derived
 */

/** The one file this check reads for its subject. */
export const SCOPED_DB = resolve(HERE, '../../db/src/scoped-db.ts');

/**
 * The lint rule that carries the SECOND copy of the naming convention, which is
 * the only other file this check opens and which it opens READ-ONLY, for leg F.
 */
export const REFUSAL_RULE = resolve(HERE, '../../eslint-plugin-merit/rules/refusal-naming.js');

/**
 * THE NAMING CONVENTION, AND IT IS NAMED HERE RATHER THAN SPELLED TWICE.
 *
 * It used to be an anonymous literal inside `derive`. Leg F asserts the lint
 * rule holds the SAME literal, and an assertion that compares a checker's
 * behaviour against a string typed a second time in the same file asserts only
 * that the author typed it twice consistently. Leg A matches with this and leg F
 * searches for `CONVENTION.source`, so there is one spelling and one place to
 * change it.
 *
 * `ADR-459` section 9 item 2 pins this literal to a line number of this file, and that figure was
 * RIGHT at the base it was written against: the blob there is byte-identical to the one at the
 * merge after PR #742. It went stale in row 460's commit, which shortened the file. No corrected
 * number is restated here, because every number previously written into this comment to correct
 * that one was already false in the commit that wrote it. `ADR-459` is a dated record and is not
 * repaired; `ADR-467` rules this repair, and naming the constant is what retired the line number.
 */
export const CONVENTION = /^refuse[A-Z]/;

/**
 * Words that take a `(` and are not calls. Leg E's matcher reads an identifier
 * followed by an open paren, and every one of these would otherwise arrive as a
 * callee named `if` or `catch`.
 */
const CALL_KEYWORDS = new Set([
  'await',
  'case',
  'catch',
  'const',
  'delete',
  'do',
  'else',
  'for',
  'function',
  'if',
  'in',
  'instanceof',
  'let',
  'new',
  'of',
  'return',
  'switch',
  'throw',
  'typeof',
  'var',
  'void',
  'while',
  'yield',
]);

/**
 * Every `refuse*` declared in `scoped-db.ts`, pinned.
 *
 * DERIVED AT `74381018` AND NOT TYPED FROM MEMORY. Nine, of which three are
 * called by a write builder and six guard an address, a bound or a registry
 * lookup instead.
 */
const GUARD_ROSTER = [
  'refuseGeneratedColumn',
  'refuseNullBound',
  'refusePinnedColumn',
  'refusePublicAddress',
  'refuseTenancyColumn',
  'refuseTermInValues',
  'refuseUnaddressed',
  'refuseUncatalogued',
  'refuseUnresolvableAddress',
];

/**
 * Every function in `scoped-db.ts` that CONSTRUCTS a write, pinned with the
 * guards it calls and the refusals it throws inline.
 *
 * `throws` IS PART OF THE PIN AND NOT DECORATION. A fourth rule can arrive as a
 * named guard, which legs A and D see, or as a bare `throw new Error(...)` in a
 * builder's body, which they do not. The count is what sees the second shape.
 * Editing an existing message does not move it; adding a refusal does.
 *
 * @type {Record<string, { guards: string[]; throws: number }>}
 */
const BUILDERS = {
  scopedInsertStatement: {
    guards: ['refuseTenancyColumn', 'refuseTermInValues'],
    throws: 2,
  },
  unscopedInsertStatement: {
    guards: ['refuseTermInValues'],
    throws: 0,
  },
  updateStatementOn: {
    guards: ['refuseGeneratedColumn', 'refuseTenancyColumn', 'refuseTermInValues'],
    throws: 0,
  },
  deleteStatementOn: {
    guards: [],
    throws: 0,
  },
  insertUnderStatement: {
    guards: ['refuseTermInValues'],
    throws: 8,
  },
  pairInsertStatement: {
    guards: ['refuseTermInValues'],
    throws: 8,
  },
};

/**
 * Why a builder does not call a guard that some other builder calls.
 *
 * KEYED `builder::guard`. Every reason opens `SETTLED` or `OPEN`. `SETTLED` means
 * the absence is correct and the argument for it is at the cited source; `OPEN`
 * means the absence is a hole somebody has written down and priced. Both keep
 * this check green, and the difference between them is the difference between a
 * decision and a debt.
 *
 * MOST OF THESE REASONS ARE THE SOURCE'S OWN WORDS. `insertUnderStatement` and
 * `pairInsertStatement` each explain, in a comment beside the code, why
 * `refuseTenancyColumn` is not reused there. This table is where those comments
 * stop being prose a reader has to find and start being a declaration a check
 * counts.
 *
 * @type {Record<string, string>}
 */
const DECLARED_ABSENCE = {
  // ---- refuseTenancyColumn -------------------------------------------------
  'unscopedInsertStatement::refuseTenancyColumn':
    'SETTLED: an unscoped authority stamps no identity, so there is no handle-supplied ' +
    'tenancy value for a caller to contradict.',
  'deleteStatementOn::refuseTenancyColumn':
    'SETTLED: DELETE builds no values object at all. Its only argument is a predicate, and ' +
    'every guard in this table reads values.',
  'insertUnderStatement::refuseTenancyColumn':
    'SETTLED: a `derived` row REACHES its identity through the parent edge, which ' +
    "`tenancyColumns` returns as that row's tenancy column, and proving the parent is the " +
    'whole contract of this builder. The source says it beside the code: "`refuseTenancyColumn` ' +
    'refuses both spellings on the paths that stamp; this one requires one and refuses the ' +
    'other." Calling the guard here would refuse every insert this builder exists to make.',
  'pairInsertStatement::refuseTenancyColumn':
    'SETTLED: the source says it beside the code. "`refuseTenancyColumn` is NOT reused: it ' +
    "refuses BOTH of a pair row's columns, and the counterparty is the one value this door " +
    'genuinely needs from the caller." The WRITER column is refused here in both spellings by ' +
    "a loop of this builder's own, which is one of its inline throws.",

  // ---- refuseTermInValues --------------------------------------------------
  'deleteStatementOn::refuseTermInValues':
    'SETTLED: DELETE builds no values object. See the tenancy cell above.',

  // ---- refuseGeneratedColumn -----------------------------------------------
  'scopedInsertStatement::refuseGeneratedColumn':
    'OPEN: `ADR-448` section 8 item 3. Drizzle DROPS a generated column from an INSERT column ' +
    'list and EMITS an identity column, so half is silently harmless and half is `428C9`. That ' +
    'item prices the guard together with a change to leg B of `generated-column-writes.mjs`, ' +
    'whose own probe would be refused by it.',
  'unscopedInsertStatement::refuseGeneratedColumn': 'OPEN: `ADR-448` section 8 item 3, as above.',
  'insertUnderStatement::refuseGeneratedColumn': 'OPEN: `ADR-448` section 8 item 3, as above.',
  'pairInsertStatement::refuseGeneratedColumn': 'OPEN: `ADR-448` section 8 item 3, as above.',
  'deleteStatementOn::refuseGeneratedColumn':
    'SETTLED: DELETE builds no values object. See the tenancy cell above.',
};

/**
 * Leg E's declared non-guards: a function a pinned builder calls, which throws,
 * which is not itself a builder, and which is NOT a refusal rule despite
 * reaching the predicate that hunts for one.
 *
 * KEYED ON THE CALLEE'S NAME AND NOT ON `builder::callee`, which is the one way
 * this table differs in shape from `DECLARED_ABSENCE` beside it. Leg D asks a
 * question that varies per builder ("does THIS builder need that guard"). Leg E
 * asks one that does not: whether a function IS a refusal rule is a fact about
 * the function, so keying per builder would demand a second identical entry the
 * day a second builder calls it, and the reviewer reading it would learn
 * nothing from the duplicate.
 *
 * EVERY REASON HERE IS THE SOURCE'S OWN ARGUMENT AND NOT THIS FILE'S. All three
 * were read at their declaration before being written down.
 *
 * @type {Record<string, string>}
 */
const DECLARED_THROWER = {
  columnByName:
    "SETTLED: it resolves a scope rule's SQL column name to the Drizzle column and throws when " +
    'the registry names a column the table does not have. Its own docblock says the throw is a ' +
    'REGISTRY DEFECT rather than a caller error and that "the suite asserts every rule\'s ' +
    'columns resolve for all seven tables so the throw is unreachable in a green tree". A ' +
    'refusal rule refuses a caller; this refuses the repository.',
  bothOf:
    'SETTLED: `and(left, right)` in drizzle-orm returns `undefined` when every argument is, and ' +
    'this exists to make that total for two arguments that are both present. Its throw is a ' +
    'condition the type system already excludes, kept because the silent alternative is a ' +
    'scoped write with no predicate. It reads no caller value and refuses no write.',
  scopePredicate:
    'OPEN: THIS IS THE ONE THAT IS GENUINELY THE SHAPE ADR-459 SECTION 9 ITEM 1 DESCRIBES, and ' +
    'it is legitimate anyway. It returns a value, carries a non-verb name, and its `pair` arm ' +
    'throws on a key with no scoped reading, which its own comment calls "the runtime half of ' +
    'a type refusal". So a refusal DOES live under a non-verb name here, and no name-shaped or ' +
    'return-shaped predicate can separate it from the arrival item 1 wants caught, because the ' +
    'difference is purpose rather than form. What is owed is not a rename: it is whether a ' +
    'refusal reached from a builder should be required to be reachable by SOME instrument other ' +
    'than a reviewer, and ADR-462 section 9 prices that question rather than answering it.',
};

/**
 * A function declaration in `scoped-db.ts`, with its body.
 *
 * @param {string} source
 * @returns {Declared[]}
 */
function declarations(source) {
  /** @type {Declared[]} */
  const found = [];
  for (const match of source.matchAll(/^(?:export )?(?:async )?function (\w+)/gm)) {
    const open = source.indexOf('{', match.index + match[0].length);
    if (open === -1) continue;
    let depth = 0;
    let close = -1;
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    const name = match[1];
    if (close === -1 || name === undefined) continue;
    found.push({
      name,
      line: source.slice(0, match.index).split('\n').length,
      body: source.slice(open, close + 1),
    });
  }
  return found;
}

/**
 * Every function declared in this same file that `fn` calls by name, whose own
 * body throws, and which does not itself construct a write.
 *
 * THIS IS LEG E'S WHOLE PREDICATE and it is `ADR-459` section 9 item 1's
 * wording turned into code with nothing added: called FROM a builder, throws,
 * not a builder. The three terms are applied in that order.
 *
 * IT MATCHES A CALL BY IDENTIFIER, so `x.foo()` is not a local call and neither
 * is a guard held in a table and reached off it. The lookbehind is what draws
 * that line, and it is the same line leg C's guard matcher draws.
 *
 * @param {Declared} fn
 * @param {Map<string, Declared>} declared
 * @param {Set<string>} builderNames
 * @returns {string[]}
 */
function throwingCallees(fn, declared, builderNames) {
  /** @type {Set<string>} */
  const found = new Set();
  for (const match of fn.body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[1];
    if (name === undefined || CALL_KEYWORDS.has(name)) continue;
    if (builderNames.has(name)) continue;
    const callee = declared.get(name);
    if (callee === undefined) continue;
    if (!/\bthrow\b/.test(callee.body)) continue;
    found.add(name);
  }
  return [...found].sort();
}

/**
 * Read `scoped-db.ts` and return what the legs over it assert on.
 *
 * TAKES A PATH SO THE SUITE CAN WATCH THIS RED. The default is the real file;
 * the suite hands it a mutated COPY, which is the only way to seed a missing
 * guard without editing the tree the check ships with.
 *
 * @param {string} [sourcePath]
 * @returns {Derived}
 */
export function derive(sourcePath = SCOPED_DB) {
  const source = stripComments(readFileSync(sourcePath, 'utf8'), { literals: 'blank' });
  const functions = declarations(source);

  const guards = functions
    .filter((fn) => CONVENTION.test(fn.name))
    .map((fn) => fn.name)
    .sort();

  // A WRITE BUILDER CONSTRUCTS A STATEMENT, which is `.insert(`, `.update(` or
  // `.delete(` on the Drizzle handle. `.set(` and `.values(` are NOT in this
  // term: `uniqueKeys` calls `UNIQUE_KEYS.set(...)` on a Map and would be
  // classified a write builder by a matcher that took them.
  const constructsWrite = (/** @type {Declared} */ fn) =>
    /\.(?:insert|update|delete)\s*\(/.test(fn.body);

  // DERIVED BEFORE THE MAP because leg E's third term is "is not itself a
  // builder", and a builder calling a builder is leg B's and leg C's subject
  // rather than a refusal reached under the wrong name.
  const declared = new Map(functions.map((fn) => [fn.name, fn]));
  const builderNames = new Set(functions.filter(constructsWrite).map((fn) => fn.name));

  const builders = functions.filter(constructsWrite).map((fn) => ({
    name: fn.name,
    line: fn.line,
    guards: [
      ...new Set([...fn.body.matchAll(/\brefuse[A-Z]\w*(?=\s*\()/g)].map((m) => m[0])),
    ].sort(),
    throws: (fn.body.match(/\bthrow\s+new\b/g) ?? []).length,
    throwers: throwingCallees(fn, declared, builderNames),
  }));

  return { functions, guards, builders };
}

/**
 * Leg A. Every `refuse*` declared is a guard somebody placed on purpose.
 *
 * @param {Derived} derived
 */
export function legGuardRoster(derived) {
  /** @type {string[]} */
  const findings = [];
  for (const name of derived.guards) {
    if (!GUARD_ROSTER.includes(name)) {
      findings.push(
        `leg A: \`${name}\` is declared in scoped-db.ts and is not in this check's guard ` +
          'roster. A refusal rule has arrived. Add it to GUARD_ROSTER, then answer leg D for ' +
          'every builder that does not call it.',
      );
    }
  }
  for (const name of GUARD_ROSTER) {
    if (!derived.guards.includes(name)) {
      findings.push(
        `leg A: \`${name}\` is pinned in this check's guard roster and is no longer declared ` +
          'in scoped-db.ts. A refusal rule has been removed or renamed.',
      );
    }
  }
  return { findings, count: derived.guards.length };
}

/**
 * Leg B. Every function that builds a write is a builder somebody guarded.
 *
 * @param {Derived} derived
 */
export function legBuilderRoster(derived) {
  /** @type {string[]} */
  const findings = [];
  for (const builder of derived.builders) {
    if (!Object.hasOwn(BUILDERS, builder.name)) {
      findings.push(
        `leg B: \`${builder.name}\` at :${String(builder.line)} constructs a write and is not ` +
          'pinned in this check. A builder nobody has placed guards on is the failure ADR-448 ' +
          'section 8 item 5 names, arriving one level up.',
      );
    }
  }
  for (const name of Object.keys(BUILDERS)) {
    if (!derived.builders.some((b) => b.name === name)) {
      findings.push(
        `leg B: \`${name}\` is pinned as a write builder and no longer constructs a write. It ` +
          'has been renamed, removed, or had its statement construction moved elsewhere.',
      );
    }
  }
  return { findings, count: derived.builders.length };
}

/**
 * Leg C. The matrix is what it was pinned as, guards and inline refusals both.
 *
 * @param {Derived} derived
 */
export function legMatrix(derived) {
  /** @type {string[]} */
  const findings = [];
  let cells = 0;
  for (const builder of derived.builders) {
    const pinned = BUILDERS[builder.name];
    if (pinned === undefined) continue; // leg B owns this one.
    cells += 1;
    const expected = [...pinned.guards].sort();
    if (expected.join(',') !== builder.guards.join(',')) {
      findings.push(
        `leg C: \`${builder.name}\` calls [${builder.guards.join(', ')}] and is pinned as ` +
          `[${expected.join(', ')}]. If a guard was ADDED, leg D now owes a reason for every ` +
          'other builder that does not call it. If one was REMOVED, say here why the write it ' +
          'refused is now safe.',
      );
    }
    if (pinned.throws !== builder.throws) {
      findings.push(
        `leg C: \`${builder.name}\` throws ${String(builder.throws)} refusal(s) inline and is ` +
          `pinned at ${String(pinned.throws)}. A refusal added inline is a rule that never ` +
          'reaches the guard roster, so it is counted here instead.',
      );
    }
  }
  return { findings, cells };
}

/**
 * Leg D. Every empty cell in the matrix is declared, with a reason.
 *
 * THE CELLS ARE THE GUARDS A BUILDER ACTUALLY CALLS SOMEWHERE, crossed with
 * every builder. A guard no builder calls is not a write guard at all
 * (`refuseNullBound` constructs a term, `refusePinnedColumn` reads an address)
 * and this leg says nothing about it.
 *
 * @param {Derived} derived
 */
export function legAbsences(derived) {
  /** @type {string[]} */
  const findings = [];
  const writeGuards = [...new Set(derived.builders.flatMap((b) => b.guards))].sort();
  let declared = 0;
  let open = 0;

  for (const builder of derived.builders) {
    for (const guard of writeGuards) {
      if (builder.guards.includes(guard)) continue;
      const key = `${builder.name}::${guard}`;
      const reason = DECLARED_ABSENCE[key];
      if (reason === undefined) {
        findings.push(
          `leg D: \`${builder.name}\` does not call \`${guard}\`, and no reason is declared. ` +
            'Another builder calls it, so this is either a rule that does not apply here (say ' +
            `why, and open the reason with SETTLED) or a hole (say so, and open it with OPEN). ` +
            `The key is "${key}".`,
        );
        continue;
      }
      if (!/^(SETTLED|OPEN):/.test(reason)) {
        findings.push(
          `leg D: the reason declared for "${key}" opens with neither SETTLED nor OPEN. The ` +
            'class is what separates a decision from a debt and it is not optional.',
        );
        continue;
      }
      declared += 1;
      if (reason.startsWith('OPEN:')) open += 1;
    }
  }

  for (const key of Object.keys(DECLARED_ABSENCE)) {
    const [builderName, guard] = key.split('::');
    const builder = derived.builders.find((b) => b.name === builderName);
    // leg B owns a builder that has gone.
    if (builder === undefined || guard === undefined) continue;
    if (builder.guards.includes(guard)) {
      findings.push(
        `leg D: "${key}" declares why that guard is absent, and the builder now CALLS it. The ` +
          'declaration is stale and should be deleted rather than left to contradict the code.',
      );
    }
  }

  return { findings, declared, open, writeGuards };
}

/**
 * Leg E. Every throwing function a pinned builder reaches is a guard by name, or
 * is declared not to be one.
 *
 * `ADR-459` SECTION 9 ITEM 1. It keys on BEING CALLED BY A BUILDER, which is
 * what makes it reach a shape legs A and D miss: those two key on the callee's
 * own name, so a refusal under a non-verb name is invisible to both, and leg C
 * keys on a `throw` in the builder's own body, so a refusal extracted into a
 * helper is invisible to it. This leg is the remaining edge of that triangle.
 *
 * WHY A NON-CONFORMER MAY BE DECLARED RATHER THAN CONVICTED is argued at length
 * in this file's header and rests on a measurement: the predicate is red on
 * three legitimate functions on the tree it landed against.
 *
 * @param {Derived} derived
 */
export function legCallgraph(derived) {
  /** @type {string[]} */
  const findings = [];
  /** @type {Set<string>} */
  const conforming = new Set();
  /** @type {Set<string>} */
  const answered = new Set();
  let edges = 0;
  let open = 0;

  for (const builder of derived.builders) {
    // leg B owns a builder nobody has pinned; convicting it twice says nothing.
    if (!Object.hasOwn(BUILDERS, builder.name)) continue;
    for (const name of builder.throwers) {
      edges += 1;
      if (CONVENTION.test(name)) {
        conforming.add(name);
        continue;
      }
      const reason = DECLARED_THROWER[name];
      if (reason === undefined) {
        findings.push(
          `leg E: \`${builder.name}\` at :${String(builder.line)} calls \`${name}\`, which ` +
            `throws, is not itself a write builder, and does not match ${String(CONVENTION)}. ` +
            'A refusal reached from a write builder under a name legs A and D cannot see is ' +
            'the shape ADR-459 section 9 item 1 names. Either rename it to the convention, ' +
            `which puts it under every other leg here, or declare in DECLARED_THROWER what it ` +
            `is instead. The key is "${name}".`,
        );
        continue;
      }
      if (!/^(SETTLED|OPEN):/.test(reason)) {
        findings.push(
          `leg E: the reason declared for "${name}" opens with neither SETTLED nor OPEN. The ` +
            'class is what separates a decision from a debt and it is not optional here ' +
            'either.',
        );
        continue;
      }
      answered.add(name);
      if (reason.startsWith('OPEN:')) open += 1;
    }
  }

  for (const name of Object.keys(DECLARED_THROWER)) {
    if (answered.has(name)) continue;
    findings.push(
      `leg E: "${name}" is declared as a throwing callee that is not a guard, and no pinned ` +
        'builder reaches it any more. The declaration is stale: either the call has gone, or ' +
        'the function has been renamed, and in both cases it now describes nothing and should ' +
        'be deleted rather than left to contradict the code.',
    );
  }

  return { findings, edges, conforming: conforming.size, answered: answered.size, open };
}

/**
 * Leg F. The convention is written in two files and this is the tie between
 * them.
 *
 * `ADR-459` SECTION 9 ITEM 2. It asserts PRESENCE of `CONVENTION.source` in the
 * lint rule and asserts nothing else about that file: not the line, not the leg
 * count, not the length. The rule file has other owners and a leg that pinned
 * any of those would go red on their legitimate work.
 *
 * COMMENTS ARE STRIPPED FIRST, so a convention that has been commented out is
 * absent, which is `RI-25`'s lesson. Regular-expression literals survive the
 * stripper by its own design, which is the only reason a regex is findable here.
 *
 * @param {string} [rulePath]
 */
export function legConventionShared(rulePath = REFUSAL_RULE) {
  /** @type {string[]} */
  const findings = [];
  /** @type {string} */
  let source;
  try {
    source = stripComments(readFileSync(rulePath, 'utf8'), { literals: 'blank' });
  } catch (err) {
    findings.push(
      `leg F: the lint rule holding the other copy of the convention could not be read: ` +
        `${String(err)}. The tie between the two spellings cannot be asserted, and an ` +
        'unassertable tie is reported rather than assumed.',
    );
    return { findings, present: false };
  }

  const present = source.includes(CONVENTION.source);
  if (!present) {
    findings.push(
      `leg F: this check matches a guard with ${String(CONVENTION)} and the lint rule at ` +
        `${rulePath} no longer contains the literal \`${CONVENTION.source}\` outside its ` +
        'comments. The convention is written in two places and they have stopped agreeing, ' +
        'which is exactly the drift ADR-459 section 9 item 2 priced this leg to make loud. ' +
        'Change BOTH spellings or neither.',
    );
  }
  return { findings, present };
}

/** @param {string} line */
const emit = (line) => {
  process.stdout.write(`${line}\n`);
};

/**
 * Run every leg. Exit 0 only when all six hold.
 *
 * @param {string[]} [argv]
 */
export function run(argv = []) {
  if (argv.length > 0) {
    emit('It takes no argument. Every input it has is derived from the tree on the run.');
    return 2;
  }

  /** @type {Derived} */
  let derived;
  try {
    derived = derive();
  } catch (err) {
    emit(`ERROR  could not read the accessor: ${String(err)}`);
    return 2;
  }

  const a = legGuardRoster(derived);
  const b = legBuilderRoster(derived);
  const c = legMatrix(derived);
  const d = legAbsences(derived);
  const e = legCallgraph(derived);
  // LEG F READS A FILE THIS CHECK DOES NOT OWN, so its own read failure is a
  // finding rather than an ERROR exit: an unreadable rule file is a real result.
  const f = legConventionShared();
  const findings = [
    ...a.findings,
    ...b.findings,
    ...c.findings,
    ...d.findings,
    ...e.findings,
    ...f.findings,
  ];

  if (findings.length === 0) {
    const update = derived.builders.find((builder) => builder.name === 'updateStatementOn');
    emit(
      `PASS   ${String(a.count)} guard(s) declared and ${String(b.count)} write builder(s) ` +
        `built from them; the money-path UPDATE builder carries ` +
        `${String(update?.guards.length ?? 0)} of them ` +
        `(${update?.guards.join(', ') ?? 'none'}); ` +
        `${String(c.cells)} matrix row(s) match their pin; ` +
        `${String(d.declared)} empty cell(s) over ${String(d.writeGuards.length)} write ` +
        `guard(s) carry a declared reason, of which ${String(d.open)} are OPEN; ` +
        `${String(e.edges)} builder-to-thrower edge(s) reach ` +
        `${String(e.conforming)} guard(s) by name and ${String(e.answered)} declared ` +
        `non-guard(s), of which ${String(e.open)} are OPEN; the convention literal ` +
        `${String(CONVENTION)} is present in refusal-naming.js`,
    );
    return 0;
  }

  emit(
    `FAIL   the write-builder guard set is not what it was declared to be (${String(
      findings.length,
    )})`,
  );
  for (const finding of findings) emit(`       ${finding}`);
  emit('');
  emit(
    'THE PIN IS IN THIS FILE AND THE TRUTH IS IN scoped-db.ts. If a finding names a change you ' +
      'meant to make, the pin is what you update, and leg D is where you say what the change ' +
      'means for every builder you did NOT touch.',
  );
  return 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(run(process.argv.slice(2)));
