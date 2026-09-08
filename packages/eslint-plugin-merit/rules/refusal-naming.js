// =============================================================================
// merit/refusal-naming
// =============================================================================
// ADR-458 SECTION 11 ITEM 2, AND IT IS NOT THE RULE THAT ENTRY PRICED.
//
// THE RULING BEING ENFORCED. `packages/db/src/scoped-db.ts` refuses illegal
// writes through functions named `refuse` something, and
// `packages/tooling/checks/write-guard-set.mjs` finds those functions BY THAT
// NAME. Its legs A and D read `/^refuse[A-Z]/` and nothing else. ADR-458
// section 5 states the consequence in its own words: *"a refusal added under
// another name is invisible to legs A and D"*, and leg C's inline-throw count
// closes only the half where the refusal is written inline in a builder. A
// refusal extracted into a helper called `checkCurrency` changes no builder's
// inline count and carries no name legs A and D recognise, so it is a write
// guard that the check asserting the guard set is complete cannot see.
//
// -----------------------------------------------------------------------------
// WHY THIS IS NOT THE PRICED RULE, WHICH MATTERS MORE THAN WHAT IT IS
// -----------------------------------------------------------------------------
// ADR-458 priced *"a lint rule that no function in `scoped-db.ts` may `throw`
// outside a function matching the convention"*. THAT RULE IS UNSOUND ON THIS
// TREE AND WAS MEASURED BEFORE IT WAS REFUSED. `scoped-db.ts` holds 81 throw
// statements. 13 are inside the 9 `refuse[A-Z]` declarations and 68 are not,
// spread over 24 distinct functions. Those 68 are not oversights: they are
// schema-drift assertions (`affiliates declares no `id`... The schema has
// drifted`), read-back assertions on a `RETURNING` clause, `throw cause`
// rethrows that roll a transaction back, and the raw-SQL reason refusals. The
// priced rule would be RED on all 68, and the only way to land it green would
// be an exemption list naming 24 functions, which is the rule's own negation
// written underneath it. ADR-459 records that measurement and refuses the
// priced shape on it.
//
// WHAT REPLACES IT IS NARROWER AND IS GREEN WITH NO EXEMPTIONS AT ALL. The
// question the priced rule got wrong is WHICH throws are guard-shaped. A guard
// in this file is not "any function that throws". It is a function whose ONLY
// observable effect is refusal: it is handed a value, it either returns nothing
// at all or it throws. Every one of the other 68 throws sits in a function that
// returns something its caller uses, which is why the caller called it.
//
// THAT SHAPE IS MEASURABLE AND IT IS EXACTLY THE CONVENTION. Seven functions in
// `scoped-db.ts` are declared `void`. All seven throw. All seven are named
// `refuse` something, and there is not one counterexample anywhere in
// `packages/db/src`. The convention ADR-458 says is real and unenforced is real
// in a stronger form than that entry claims, and this is the form a rule can
// hold: NOT "every throw is in a guard", which is false, but "every function
// shaped like a guard is named like one", which is true 7 times out of 7.
//
// -----------------------------------------------------------------------------
// THE TWO LEGS, AND WHY ONE IS NOT ENOUGH
// -----------------------------------------------------------------------------
// LEG 1, THE SHAPE. A named function that throws and returns nothing must match
// the convention. This is the leg that answers ADR-458's motivating sentence
// literally: `checkCurrency(key, values): void { throw ... }` is caught, under
// any name, with no vocabulary guessing anywhere in it.
//
// LEG 2, THE VOCABULARY. Two of the nine guards do NOT return void.
// `refuseNullBound` returns `unknown` and `refuseGeneratedColumn` returns the
// values it cleared, and `scoped-db.ts` says at its own site that the second
// shape is FORCED by a citation constraint rather than chosen. So the guard set
// already has an expression-shaped member, and ADR-458 section 11 item 1 prices
// a second one. Leg 1 cannot see either, because they return a value. Leg 2 is
// what reaches them: a function that throws and calls itself `assertFoo`,
// `checkFoo`, `validateFoo` or any other refusal verb is a refusal wearing the
// wrong name, whatever it returns.
//
// LEG 2 IS A HEURISTIC AND LEG 1 IS NOT, AND THE DIFFERENCE IS DECLARED RATHER
// THAN BLURRED. An expression-shaped guard named `clearedValues` evades leg 2
// and is invisible to leg 1 by construction. That hole is real, it is the one
// place this rule is weaker than its subject deserves, and ADR-459 section 8
// prices what would close it. What is NOT true is that the rule is vacuous:
// leg 1 is complete for the shape 7 of the 9 guards actually have.
//
// -----------------------------------------------------------------------------
// LEG 3, THE OTHER DIRECTION, AND IT IS THE ONLY LEG THAT READS A CONFORMING NAME
// -----------------------------------------------------------------------------
// ADR-459 section 9 item 3, dispatched rather than self-invented. Legs 1 and 2
// both ask whether a refusal is wearing the wrong name. NOTHING ASKED WHETHER A
// CONFORMING NAME IS BACKED BY A REFUSAL, and the check that trusts the name is
// why that matters: `write-guard-set.mjs` builds its guard list by filtering
// declarations through `/^refuse[A-Z]/` and nothing else, so a function called
// `refuseNothing` with an empty body is COUNTED as a declared write guard and
// gets a matrix row of its own. That is the worse of the two failures. A guard
// under the wrong name is INVISIBLE to the completeness check, which is a hole
// that reads as a hole; a conforming name over no refusal makes the completeness
// check report a guard the runtime does not have, which is a hole that reads as
// a control.
//
// "ITS OWN THROW" MEANS SOMETHING WIDER HERE THAN IT DOES IN LEG 1, AND THE
// DIFFERENCE IS FORCED BY THE POLARITY RATHER THAN CHOSEN. Leg 1 reports a
// function that DOES throw, so attributing a callback's throw to the function
// around it would MANUFACTURE reports. Leg 3 reports a function that does NOT,
// so the same attribution SUPPRESSES them. A guard whose refusal is spelled
// `rows.forEach((r) => { if (bad(r)) throw ... })` is a real refusal, and a leg 3
// reading only the outer frame would call it empty and be wrong. So leg 3 reads
// any `throw` lexically inside the function, nested frames included, while leg 1
// keeps reading its own frame alone. The two fields are separate for that reason.
//
// A DELEGATING REFUSAL IS NOT AN EMPTY ONE, AND THE TEST FOR IT IS THE
// CONVENTION ITSELF. A `refuseBoth(key, values)` whose whole body is
// `refuseTenancyColumn(key, values); refuseTermInValues(key, values);` throws
// nothing and refuses two things. It is not reported, because every guard it
// delegates to CARRIES THE NAME legs A and D read, so the guard set still sees
// the whole refusal. A `refuse` function delegating to a helper the convention
// does not cover IS reported, and so is that helper, by leg 1 or leg 2: the
// composite is only as visible as its least visible part, which is the rule's
// whole subject. A call to ITSELF does not count, because a refusal that
// delegates to itself refuses nothing.
//
// LEG 3 KEYS ON THE NAME, SO IT DOES NOT TOUCH THE `async` RULING LEFT OPEN
// BELOW. That ruling is about whether a guard-SHAPED async function must be
// renamed, and `pairInsertStatement` is the case holding it open. Leg 3 asks
// only that a name somebody has ALREADY chosen be backed by a throw, which is a
// question the `async` keyword does not change. ADR-459 section 9 item 5 stays
// open and this leg does not close it.
//
// -----------------------------------------------------------------------------
// WHAT IS DELIBERATELY OUT OF SCOPE
// -----------------------------------------------------------------------------
// `async` FUNCTIONS ARE NOT GUARD-SHAPED HERE AND EXCLUDING THEM IS NOT AN
// EXEMPTION BOUGHT TO PASS. `pairInsertStatement` returns `Promise<void>` and
// throws 8 times inline. It is a write BUILDER: it is async because it performs
// the insert, so its observable effect is the write and not the refusal, and its
// 8 inline throws are already counted by leg C of `write-guard-set.mjs`, which
// pins them at 8. Demanding it be renamed `refuse` something would be demanding
// a builder pretend to be a guard. No guard in this tree is async, and if one
// ever needs to be, that is a ruling somebody takes and this line is where they
// take it.
//
// AN ANONYMOUS FUNCTION IS SKIPPED BECAUSE THE CONVENTION IS ABOUT NAMES. A
// callback passed to `.map` or `.forEach` has no name to hold to a convention,
// and a guard must be reachable by name to be called from a builder at all, so
// nothing that could be a shared guard is lost here. Inline refusal is leg C's
// half of the hole and not this rule's.
//
// THE GLOB DECIDES WHERE, AND THE RULE DOES NOT GUESS. `merit/no-raw-db-client`
// and `merit/no-calendar-in-expiry-path` are both this shape: the rule states a
// property and `eslint.config.js` states the paths, in the one file whose whole
// subject is which rules apply where. This rule is attached to
// `packages/db/src/**/*.ts` and not to `scoped-db.ts` alone, which is WIDER than
// ADR-458 priced and was measured before it was chosen: all 6 files of that
// directory hold 7 named void-returning throwing functions between them, all 7
// conforming. The widening costs no exemption and closes an evasion the narrow
// glob leaves open, which is a guard extracted to a sibling file, where legs A
// and D would not look for it either.
//
// IT TAKES NO OPTIONS. The convention is a ruling recorded in ADR-458 and read
// by a checker, not a preference, and an options bag is where a future session
// widens the pattern without a reviewer reading the word.

/**
 * The convention itself, and it is the same literal `write-guard-set.mjs` reads
 * at its own line 270. Written out here rather than imported because a lint
 * rule that imports a checker to learn its own subject is a load-order problem
 * bought for nothing; that the two agree is asserted by ADR-459, and a change
 * to either is a diff on a file whose header says what it means.
 */
const CONVENTION = /^refuse[A-Z]/;

/**
 * The refusal verbs leg 2 treats as a near miss. Every one of these is a word
 * somebody reaches for when they mean "this throws if the input is wrong", and
 * NONE of them appears at the head of any function name in `packages/db/src`
 * today, so this list bans nothing the tree currently does.
 *
 * `no` IS DELIBERATELY ABSENT. `noSuchColumn` reads as a predicate answering a
 * question rather than a refusal taking an action, and banning that prefix
 * would be the rule guessing at intent from a word it cannot disambiguate.
 */
const REFUSAL_VERBS =
  /^(assert|check|ensure|validate|verify|reject|require|forbid|deny|disallow|prohibit|guard|must)[A-Z]/;

/**
 * The name a function is known by, which for the shapes that matter is not
 * always on the function node. `const assertCurrency = (v) => {...}` carries its
 * name on the declarator, and omitting that route would leave the arrow spelling
 * of every violation unreachable.
 *
 * @param {any} node
 * @returns {string | null}
 */
const nameOf = (node) => {
  if (node.id && node.id.type === 'Identifier') return node.id.name;
  const parent = node.parent;
  if (!parent) return null;
  if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
    return parent.id.name;
  }
  if (
    (parent.type === 'Property' ||
      parent.type === 'PropertyDefinition' ||
      parent.type === 'MethodDefinition') &&
    parent.key.type === 'Identifier'
  ) {
    return parent.key.name;
  }
  return null;
};

/** @type {import('eslint').Rule.RuleModule} */
const refusalNaming = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'A function whose only effect is refusal must be named `refuse` something. ' +
        'write-guard-set.mjs finds the accessor write guards by that name (ADR-458 section 5), ' +
        'so a refusal under another name is a guard the completeness check cannot see.',
    },
    schema: [],
    messages: {
      unnamedRefusal:
        '`{{name}}` returns nothing and throws, which is the shape of a write guard, and its ' +
        'name does not match the `refuse[A-Z]` convention. ' +
        '`packages/tooling/checks/write-guard-set.mjs` finds every guard by that name, so this ' +
        'function is a refusal rule its legs A and D cannot see and its leg C does not count ' +
        '(the count reaches inline throws in a builder, not a helper). Rename it to `refuse` ' +
        'plus what it refuses, then answer leg D for every builder that does not call it. ' +
        'If it is NOT a guard, it returns something its caller uses, and the fix is to say so ' +
        'in the signature rather than to widen this rule (ADR-458 section 11 item 2, ADR-459).',
      refusalVerb:
        '`{{name}}` throws and is named with a refusal verb that is not the convention. The ' +
        'accessor spells a refusal `refuse` something, and `write-guard-set.mjs` reads exactly ' +
        'that spelling; `{{name}}` would be invisible to it. An expression-shaped guard is ' +
        'still a guard (`refuseGeneratedColumn` returns the values it cleared), so returning a ' +
        'value is not what makes this permissible. Rename it to `refuse` plus what it refuses ' +
        '(ADR-458 section 11 item 2, ADR-459).',
      refusalWithoutThrow:
        '`{{name}}` matches the `refuse[A-Z]` convention, and that name is what ' +
        '`packages/tooling/checks/write-guard-set.mjs` reads a write guard by: in `scoped-db.ts` ' +
        'its guard list is every declaration matching that literal and nothing else, and a ' +
        'sibling file is inside this rule for the reason its header gives, that a guard extracted ' +
        'there is where legs A and D would not look either. But `{{name}}` throws nowhere inside ' +
        'itself and calls no other `refuse` function, so it refuses nothing. A name in the guard ' +
        'set over no refusal is worse than a refusal under the wrong name: the wrong name leaves ' +
        'a hole that READS as a hole, while this makes the completeness check report a guard the ' +
        'runtime does not have, and every builder answering leg D with a call to it answers with ' +
        'a call to nothing. Make it throw, delegate it to a `refuse` function that does, or ' +
        'rename it so the guard set stops counting it (ADR-459 section 9 item 3, ADR-463).',
    },
  },

  create(context) {
    /**
     * One frame per function-like node currently open. A `throw` or a
     * value-returning `return` belongs to the innermost frame, which is what
     * makes "its OWN throw" mean what it says: a nested callback that throws
     * pushes its own frame and does not make its parent a refusal.
     *
     * `throwsWithin` and `calls` are LEG 3's fields and they are deliberately
     * wider than `throws`: both are set on every frame currently open, not just
     * the innermost, because leg 3 reports the ABSENCE of a refusal and a
     * narrow reading there suppresses nothing and invents reports instead. The
     * header states that polarity argument in full.
     *
     * @type {{ node: any; throws: boolean; throwsWithin: boolean; calls: Set<string>; valueReturns: number }[]}
     */
    const stack = [];

    /** @param {any} node */
    const enter = (node) =>
      stack.push({ node, throws: false, throwsWithin: false, calls: new Set(), valueReturns: 0 });

    /**
     * Returns nothing that a caller could use. An explicit `void` or `never`
     * annotation settles it; with no annotation the body does, and that second
     * branch is what stops the one-character evasion of deleting the return
     * type to get out of leg 1.
     *
     * @param {any} node
     * @param {{ throws: boolean; valueReturns: number }} frame
     */
    const returnsNothing = (node, frame) => {
      if (node.async || node.generator) return false;
      // A concise arrow body IS its return value.
      if (node.type === 'ArrowFunctionExpression' && node.body.type !== 'BlockStatement') {
        return false;
      }
      const annotation = node.returnType && node.returnType.typeAnnotation;
      if (annotation) {
        return annotation.type === 'TSVoidKeyword' || annotation.type === 'TSNeverKeyword';
      }
      return frame.valueReturns === 0;
    };

    /** @param {any} node */
    const exit = (node) => {
      const frame = stack.pop();
      if (!frame) return;
      const name = nameOf(node);
      // The convention is about names and an anonymous callback has none.
      if (name === null) return;

      // LEG 3 TAKES EVERY NAME THAT MATCHES THE CONVENTION and legs 1 and 2
      // take every name that does not, so no node is ever reported twice and
      // the file's guard population is partitioned rather than sampled.
      if (CONVENTION.test(name)) {
        const delegates = [...frame.calls].some((called) => called !== name);
        if (!frame.throwsWithin && !delegates) {
          context.report({
            node: node.id ?? node,
            messageId: 'refusalWithoutThrow',
            data: { name },
          });
        }
        return;
      }

      if (!frame.throws) return;

      if (returnsNothing(node, frame)) {
        context.report({ node: node.id ?? node, messageId: 'unnamedRefusal', data: { name } });
        return;
      }
      if (REFUSAL_VERBS.test(name)) {
        context.report({ node: node.id ?? node, messageId: 'refusalVerb', data: { name } });
      }
    };

    return {
      FunctionDeclaration: enter,
      'FunctionDeclaration:exit': exit,
      FunctionExpression: enter,
      'FunctionExpression:exit': exit,
      ArrowFunctionExpression: enter,
      'ArrowFunctionExpression:exit': exit,

      ThrowStatement() {
        const frame = stack[stack.length - 1];
        if (frame) frame.throws = true;
        // Leg 3's wider reading: a callback's throw is still a throw inside
        // every function that lexically contains the callback.
        for (const open of stack) open.throwsWithin = true;
      },

      /**
       * Leg 3's delegation route, and it records only calls to a name the
       * convention already covers. A `refuse` function whose refusal is
       * delegated to `checkCurrency` is NOT delegating to anything the guard
       * set can see, so it is not recorded here and stays reportable, while
       * `checkCurrency` itself is leg 1's or leg 2's.
       *
       * @param {any} node
       */
      CallExpression(node) {
        const callee = node.callee;
        /** @type {string | null} */
        let called = null;
        if (callee.type === 'Identifier') called = callee.name;
        else if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property.type === 'Identifier'
        ) {
          called = callee.property.name;
        }
        if (called === null || !CONVENTION.test(called)) return;
        for (const open of stack) open.calls.add(called);
      },

      ReturnStatement(node) {
        const frame = stack[stack.length - 1];
        if (frame && node.argument) frame.valueReturns += 1;
      },
    };
  },
};

export default refusalNaming;
