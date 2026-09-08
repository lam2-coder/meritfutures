import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';

import { refusalNaming } from '../index.js';

// =============================================================================
// merit/refusal-naming, watched refusing each thing it claims to
// =============================================================================
// ADR-459. The rule exists because `packages/tooling/checks/write-guard-set.mjs`
// finds a write guard by the name `refuse[A-Z]` and ADR-458 section 5 says what
// that misses: "a refusal added under another name is invisible to legs A and
// D". This suite is where the rule is watched seeing it.
//
// THE `valid` HALF IS THE LOAD-BEARING HALF HERE, AND MORE SO THAN IN THE
// SIBLING SUITES. The rule ADR-458 priced was "no function in `scoped-db.ts`
// may throw outside a guard", and it was refused because 68 of that file's 81
// throws sit outside one and every one of them is legitimate. So the risk this
// rule carries is NOT that it fails to fire. It is that it fires on the 68.
// Every `valid` case below is one of those shapes, transcribed from the real
// accessor rather than invented: a schema-drift assertion, a read-back
// assertion, a `throw cause` rethrow, an async builder, a `.map` callback. If
// any of them starts erroring, the rule has become the rule ADR-459 refused.
//
// LEG 3 IS THE OPPOSITE POLARITY AND ITS RISK IS THE MIRROR OF THE ABOVE. It
// reports a `refuse[A-Z]` function that refuses NOTHING, so what it can get
// wrong is calling a real refusal empty. The two shapes that could make it do
// that are cased here as `valid` and not left to the header: a guard whose only
// throw is inside a `.forEach` callback, and a guard that throws nowhere because
// it DELEGATES to guards that do. A `refuse` function that throws directly is
// covered three times over by the convention cases already at the top of this
// half, and every one of them now exercises leg 3 as well as leg 1.
//
// THE PARSER IS `typescript-eslint`'s AND THAT IS NOT OPTIONAL FOR THIS RULE.
// Leg 1 reads a `void` return ANNOTATION, which under espree is a parse error
// rather than a result. A suite for this rule on the JavaScript subset would be
// testing the half of the rule that does not decide anything.

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2023,
    sourceType: 'module',
  },
});

ruleTester.run('refusal-naming', refusalNaming, {
  valid: [
    // -----------------------------------------------------------------------
    // THE CONVENTION ITSELF, IN BOTH SHAPES THE ACCESSOR ACTUALLY USES.
    // -----------------------------------------------------------------------
    // The void shape, which is seven of the nine guards.
    'function refuseTermInValues(key: string, values: Record<string, unknown>): void { if (values.term !== undefined) throw new Error(key); }',
    // The expression shape, which `scoped-db.ts` says is FORCED by a citation
    // constraint rather than chosen. A rule that demanded void of every guard
    // would have banned `refuseGeneratedColumn`.
    'function refuseGeneratedColumn(key: string, values: Record<string, unknown>): Record<string, unknown> { if (values.gen !== undefined) throw new Error(key); return values; }',
    // `refuseNullBound`'s shape: returns `unknown`, throws on the bad bound.
    'function refuseNullBound(value: unknown, constructor: string): unknown { if (value === null) throw new Error(constructor); return value; }',

    // -----------------------------------------------------------------------
    // THE 68 THROWS THAT ARE NOT GUARDS. If any of these errors, the rule has
    // become the one ADR-459 refused.
    // -----------------------------------------------------------------------
    // A schema-drift assertion, which returns the column it found.
    'function columnByName(table: unknown, name: string): unknown { const c = lookup(table, name); if (c === undefined) throw new Error(name); return c; }',
    // A read-back assertion on a RETURNING clause.
    'function returnedId(key: string, rows: unknown[]): string { if (rows.length !== 1) throw new Error(key); return String(rows[0]); }',
    // A predicate builder whose throw is the unreachable branch.
    'function conjunctionOver(parts: unknown[]): unknown { if (parts.length === 0) throw new Error("nothing to conjoin"); return parts[0]; }',
    // `throw cause`, the translated rethrow that rolls a transaction back.
    'async function establish(email: string): Promise<string> { try { return await insert(email); } catch (cause) { if (taken(cause)) throw new AlreadyEstablished(email); throw cause; } }',
    // AN ASYNC WRITE BUILDER RETURNING `Promise<void>`, which is
    // `pairInsertStatement` exactly: eight inline throws, pinned at eight by
    // leg C, and not a guard. This is the single case where excluding `async`
    // is what keeps the rule off the real tree, so it is stated as a case
    // rather than left to the header.
    'async function pairInsertStatement(source: unknown, values: Record<string, unknown>): Promise<void> { if (values.term !== undefined) throw new Error("term"); await insert(source, values); }',
    // An anonymous callback that throws. It has no name to hold to a naming
    // convention, and a guard must be reachable by name to be called at all.
    'function properties(names: string[]): string[] { return names.map((n) => { const p = lookup(n); if (p === undefined) throw new Error(n); return p; }); }',
    // A `forEach` callback: anonymous AND returns nothing, so it satisfies leg
    // 1's shape test and is skipped only because it has no name. This is the
    // case that would fire if the anonymous exclusion were ever dropped.
    'function checkAll(rows: string[]): void { rows.forEach((r) => { if (r === "") throw new Error("empty"); }); }',
    // A function that throws nothing at all is never this rule's business,
    // whatever it is called.
    'function assertNothing(x: unknown): void { record(x); }',
    // A concise arrow: its body IS its return value, so it returns something.
    'const firstOr = (rows: string[]) => rows[0] ?? fail("no rows");',
    // A generator, which is not a guard shape either.
    'function* rowsOf(table: string): Generator<string> { if (table === "") throw new Error("no table"); yield table; }',

    // -----------------------------------------------------------------------
    // NEAR MISSES ON THE CONVENTION ITSELF, which must stay valid.
    // -----------------------------------------------------------------------
    // `refuse` with no capital after it is not the convention and is also not a
    // refusal verb, so neither leg has an opinion. The convention is
    // `refuse[A-Z]` because that is the literal `write-guard-set.mjs` reads.
    'function refusals(key: string): string[] { if (key === "") throw new Error(key); return [key]; }',
    // A refusal VERB on a function that does not throw is somebody else's
    // naming taste and not this rule's subject.
    'function validateShape(x: unknown): boolean { return x !== null; }',

    // -----------------------------------------------------------------------
    // LEG 3's TWO FALSE-POSITIVE SHAPES, which are the whole risk that leg
    // carries. If either of these starts erroring, leg 3 is calling a real
    // refusal empty, which is the failure this half exists to catch.
    // -----------------------------------------------------------------------
    // A guard whose refusal is spelled inside a callback. The throw belongs to
    // the arrow's own frame, which is exactly what keeps leg 1 off `properties`
    // above, and leg 3 reads the WIDER `throwsWithin` for this reason.
    'function refuseEmptyRow(rows: string[]): void { rows.forEach((r) => { if (r === "") throw new Error("empty"); }); }',
    // A guard that throws nowhere because it delegates to guards that do. Every
    // name it delegates to carries the convention, so `write-guard-set.mjs`
    // still sees the whole refusal.
    'function refuseBoth(key: string, values: Record<string, unknown>): void { refuseTenancyColumn(key, values); refuseTermInValues(key, values); }',
    // The same delegation through a member call, which is how a guard reached
    // from a namespace object would be spelled.
    'function refuseVia(key: string): void { guards.refuseUncatalogued(key); }',
    // AN `async` REFUSAL THAT THROWS. Leg 3 keys on the NAME and not the shape,
    // so `async` buys no exemption from it, and this case pins that a
    // conforming name that DOES throw is still nobody's finding. The `async`
    // exclusion in leg 1's shape test is untouched: a conforming name never
    // reaches leg 1 at all.
    'async function refuseLate(v: string): Promise<void> { if (v === "") throw new Error("empty"); await record(v); }',
  ],

  invalid: [
    {
      name: 'ADR-458 section 5 executed literally: the guard named `checkCurrency`',
      code: 'function checkCurrency(key: string, values: Record<string, unknown>): void { if (values.currency !== "USD") throw new Error(key); }',
      errors: [{ messageId: 'unnamedRefusal', data: { name: 'checkCurrency' } }],
    },
    {
      name: 'a void-returning refusal under a name with no refusal verb in it at all, which is the case leg 2 alone would miss',
      code: 'function currencyRule(key: string, values: Record<string, unknown>): void { if (values.currency !== "USD") throw new Error(key); }',
      errors: [{ messageId: 'unnamedRefusal' }],
    },
    {
      name: 'THE EVASION: delete the return annotation and leg 1 reads the body instead',
      code: 'function checkCurrency(key: string, values: Record<string, unknown>) { if (values.currency !== "USD") throw new Error(key); }',
      errors: [{ messageId: 'unnamedRefusal' }],
    },
    {
      name: 'a `never` return, which is the annotation for a function that only ever throws',
      code: 'function unreachableState(key: string): never { throw new Error(key); }',
      errors: [{ messageId: 'unnamedRefusal' }],
    },
    {
      name: 'the arrow spelling, whose name lives on the declarator rather than the function node',
      code: 'const ensureNotEmpty = (values: Record<string, unknown>): void => { if (Object.keys(values).length === 0) throw new Error("empty"); };',
      errors: [{ messageId: 'unnamedRefusal', data: { name: 'ensureNotEmpty' } }],
    },
    {
      name: 'a function expression bound to a name, which is the third spelling of the same thing',
      code: 'const assertScoped = function (key: string): void { if (key === "") throw new Error(key); };',
      errors: [{ messageId: 'unnamedRefusal', data: { name: 'assertScoped' } }],
    },
    {
      name: 'LEG 2: an expression-shaped refusal, which leg 1 cannot see because it returns the values it cleared',
      code: 'function validateTermsIn(values: Record<string, unknown>): Record<string, unknown> { if (values.term !== undefined) throw new Error("term"); return values; }',
      errors: [{ messageId: 'refusalVerb', data: { name: 'validateTermsIn' } }],
    },
    {
      name: 'LEG 2 across the vocabulary: each verb reaches an expression-shaped refusal the shape test cannot',
      code: [
        'function assertA(v: string): string { if (v === "") throw new Error("a"); return v; }',
        'function ensureB(v: string): string { if (v === "") throw new Error("b"); return v; }',
        'function verifyC(v: string): string { if (v === "") throw new Error("c"); return v; }',
        'function rejectD(v: string): string { if (v === "") throw new Error("d"); return v; }',
        'function requireE(v: string): string { if (v === "") throw new Error("e"); return v; }',
        'function forbidF(v: string): string { if (v === "") throw new Error("f"); return v; }',
        'function denyG(v: string): string { if (v === "") throw new Error("g"); return v; }',
        'function disallowH(v: string): string { if (v === "") throw new Error("h"); return v; }',
        'function prohibitI(v: string): string { if (v === "") throw new Error("i"); return v; }',
        'function guardJ(v: string): string { if (v === "") throw new Error("j"); return v; }',
        'function mustK(v: string): string { if (v === "") throw new Error("k"); return v; }',
        'function checkL(v: string): string { if (v === "") throw new Error("l"); return v; }',
      ].join('\n'),
      errors: [
        { messageId: 'refusalVerb', data: { name: 'assertA' } },
        { messageId: 'refusalVerb', data: { name: 'ensureB' } },
        { messageId: 'refusalVerb', data: { name: 'verifyC' } },
        { messageId: 'refusalVerb', data: { name: 'rejectD' } },
        { messageId: 'refusalVerb', data: { name: 'requireE' } },
        { messageId: 'refusalVerb', data: { name: 'forbidF' } },
        { messageId: 'refusalVerb', data: { name: 'denyG' } },
        { messageId: 'refusalVerb', data: { name: 'disallowH' } },
        { messageId: 'refusalVerb', data: { name: 'prohibitI' } },
        { messageId: 'refusalVerb', data: { name: 'guardJ' } },
        { messageId: 'refusalVerb', data: { name: 'mustK' } },
        { messageId: 'refusalVerb', data: { name: 'checkL' } },
      ],
    },
    {
      name: 'a refusal nested inside a builder is attributed to ITSELF and not to the builder around it',
      code: 'function scopedInsertStatement(values: Record<string, unknown>): unknown { function checkTenancy(v: Record<string, unknown>): void { if (v.id === undefined) throw new Error("id"); } checkTenancy(values); return build(values); }',
      errors: [{ messageId: 'unnamedRefusal', data: { name: 'checkTenancy' } }],
    },
    {
      name: 'a method on an object literal, which is a route to a shared guard that skips `function` entirely',
      code: 'const guards = { assertPinned(key: string): void { if (key === "") throw new Error(key); } };',
      errors: [{ messageId: 'unnamedRefusal', data: { name: 'assertPinned' } }],
    },

    // -------------------------------------------------------------------------
    // LEG 3. ADR-459 section 9 item 3: a name in the guard set over no refusal.
    // -------------------------------------------------------------------------
    {
      name: 'LEG 3: a conforming name that refuses nothing, which `write-guard-set.mjs` would count as a declared guard',
      code: 'function refuseNothing(key: string): void { record(key); }',
      errors: [{ messageId: 'refusalWithoutThrow', data: { name: 'refuseNothing' } }],
    },
    {
      name: 'LEG 3 in the arrow spelling, whose name lives on the declarator',
      code: 'const refuseEmptyValues = (values: Record<string, unknown>): void => { record(values); };',
      errors: [{ messageId: 'refusalWithoutThrow', data: { name: 'refuseEmptyValues' } }],
    },
    {
      name: 'LEG 3 on an object-literal method, the route a shared guard takes without the `function` keyword',
      code: 'const guards = { refusePinned(key: string): void { record(key); } };',
      errors: [{ messageId: 'refusalWithoutThrow', data: { name: 'refusePinned' } }],
    },
    {
      name: 'DELEGATION TO A NAME THE CONVENTION DOES NOT COVER IS NOT DELEGATION: both halves are reported, and the pair is the composite being only as visible as its least visible part',
      code: [
        'function refuseCurrency(key: string, values: Record<string, unknown>): void { checkCurrency(values); }',
        'function checkCurrency(values: Record<string, unknown>): void { if (values.currency !== "USD") throw new Error("currency"); }',
      ].join('\n'),
      errors: [
        { messageId: 'refusalWithoutThrow', data: { name: 'refuseCurrency' } },
        { messageId: 'unnamedRefusal', data: { name: 'checkCurrency' } },
      ],
    },
    {
      name: 'A CALL TO ITSELF IS NOT DELEGATION, because a refusal that delegates to itself refuses nothing',
      code: 'function refuseLoop(value: string): void { if (value !== "") refuseLoop(""); }',
      errors: [{ messageId: 'refusalWithoutThrow', data: { name: 'refuseLoop' } }],
    },
    {
      name: 'AN `async` CONFORMING NAME THAT THROWS NOWHERE IS STILL REPORTED, and this is the case that will force ADR-459 section 9 item 5 the day somebody writes an async guard that refuses by awaiting a rejection',
      code: 'async function refuseSlowly(value: string): Promise<void> { await record(value); }',
      errors: [{ messageId: 'refusalWithoutThrow', data: { name: 'refuseSlowly' } }],
    },
  ],
});
