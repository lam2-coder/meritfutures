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
// WHY THIS IS FOUR LEGS AND NOT ONE PINNED LIST
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
// `scoped-db.ts` whose name matches `refuse[A-Z]`. That convention is real and
// file-wide (nine declarations at the base this was written on) but it IS a
// convention: a refusal added under another name is invisible to legs A and D.
// Leg C's inline-throw count is what covers the other half of that hole, because
// a refusal written inline instead of as a named guard changes the count.
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
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { stripComments } from './strip-comments.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The one file this check reads. */
export const SCOPED_DB = resolve(HERE, '../../db/src/scoped-db.ts');

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
    guards: [],
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
  'insertUnderStatement::refuseTermInValues':
    'OPEN: NO REASON EXISTS FOR THIS ONE AND THAT IS THE FINDING. Every other builder that ' +
    'takes a values object calls this guard; this one does not, and the word "term" does not ' +
    'appear anywhere in its body. `ADR-458` section 6 records it, measures the exposure at one ' +
    'live producer on `sessions`, and prices the repair. It is a declared debt and not a ' +
    'settled asymmetry.',

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

/** A function declaration in `scoped-db.ts`, with its body. */
function declarations(source) {
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
    if (close === -1) continue;
    found.push({
      name: match[1],
      line: source.slice(0, match.index).split('\n').length,
      body: source.slice(open, close + 1),
    });
  }
  return found;
}

/**
 * Read `scoped-db.ts` and return what the four legs assert over.
 *
 * TAKES A PATH SO THE SUITE CAN WATCH THIS RED. The default is the real file;
 * the suite hands it a mutated COPY, which is the only way to seed a missing
 * guard without editing the tree the check ships with.
 */
export function derive(sourcePath = SCOPED_DB) {
  const source = stripComments(readFileSync(sourcePath, 'utf8'), { literals: 'blank' });
  const functions = declarations(source);

  const guards = functions
    .filter((fn) => /^refuse[A-Z]/.test(fn.name))
    .map((fn) => fn.name)
    .sort();

  // A WRITE BUILDER CONSTRUCTS A STATEMENT, which is `.insert(`, `.update(` or
  // `.delete(` on the Drizzle handle. `.set(` and `.values(` are NOT in this
  // term: `uniqueKeys` calls `UNIQUE_KEYS.set(...)` on a Map and would be
  // classified a write builder by a matcher that took them.
  const builders = functions
    .filter((fn) => /\.(?:insert|update|delete)\s*\(/.test(fn.body))
    .map((fn) => ({
      name: fn.name,
      line: fn.line,
      guards: [
        ...new Set([...fn.body.matchAll(/\brefuse[A-Z]\w*(?=\s*\()/g)].map((m) => m[0])),
      ].sort(),
      throws: (fn.body.match(/\bthrow\s+new\b/g) ?? []).length,
    }));

  return { functions, guards, builders };
}

/** Leg A. Every `refuse*` declared is a guard somebody placed on purpose. */
export function legGuardRoster(derived) {
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

/** Leg B. Every function that builds a write is a builder somebody guarded. */
export function legBuilderRoster(derived) {
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

/** Leg C. The matrix is what it was pinned as, guards and inline refusals both. */
export function legMatrix(derived) {
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
 */
export function legAbsences(derived) {
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
    if (builder === undefined) continue; // leg B owns a builder that has gone.
    if (builder.guards.includes(guard)) {
      findings.push(
        `leg D: "${key}" declares why that guard is absent, and the builder now CALLS it. The ` +
          'declaration is stale and should be deleted rather than left to contradict the code.',
      );
    }
  }

  return { findings, declared, open, writeGuards };
}

const emit = (line) => {
  process.stdout.write(`${line}\n`);
};

/** Run every leg. Exit 0 only when all four hold. */
export function run(argv = []) {
  if (argv.length > 0) {
    emit('It takes no argument. Every input it has is derived from the tree on the run.');
    return 2;
  }

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
  const findings = [...a.findings, ...b.findings, ...c.findings, ...d.findings];

  if (findings.length === 0) {
    const update = derived.builders.find((builder) => builder.name === 'updateStatementOn');
    emit(
      `PASS   ${String(a.count)} guard(s) declared and ${String(b.count)} write builder(s) ` +
        `built from them; the money-path UPDATE builder carries ` +
        `${String(update?.guards.length ?? 0)} of them ` +
        `(${update?.guards.join(', ') ?? 'none'}); ` +
        `${String(c.cells)} matrix row(s) match their pin; ` +
        `${String(d.declared)} empty cell(s) over ${String(d.writeGuards.length)} write ` +
        `guard(s) carry a declared reason, of which ${String(d.open)} are OPEN`,
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
