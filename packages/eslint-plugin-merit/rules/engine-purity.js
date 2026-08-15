// =============================================================================
// merit/engine-purity
// =============================================================================
// THE SOURCE-LEVEL HALF OF packages/rules-engine's PURITY BOUNDARY.
//
// OVERVIEW section 3 gives the engine `(planConfigVersion, accountState,
// dayMarks[]) -> newState + events` and "zero I/O", and three commitments rest
// on that being literally true: the replay self-audit, the `PT-nn` property
// suites, and Stryker running there and nowhere else (STRATEGY section 2, where
// restricting mutation testing to the engine is what makes the number worth
// reading).
//
// RI-01 in packages/tooling asserts the MANIFEST declares no workspace
// dependency. THIS RULE IS THE OTHER HALF, and P1 section 2.1 is explicit that
// it is not a smaller half: "the clock is the same defect class as an import:
// the trading day comes from calendar data, so a wall-clock read inside the
// engine is impurity wearing a different hat." An undeclared import resolves
// anyway under a hoisted layout, and `Date.now()` needs no manifest entry at
// all.
//
// The float ban is STRATEGY section 4.5's "no banned constructs in the engine
// (dates, locales, floats, `Math.random`)" and the constitution's money rule:
// money is integer cents and thresholds are basis points or integer cents. A
// float in a rule computation is a rounding decision nobody made.
//
// WHAT IT DOES NOT CATCH, stated rather than implied. It reads one file at a
// time with no type information, so it sees the SPELLING of impurity rather
// than impurity itself: a nondeterministic value passed in as an argument, or
// reached through an alias assigned in another module, is invisible here. The
// property suites and the replay self-audit are what catch that class. This
// rule closes the accidental door, not the deliberate one.
//
// Bare global references (`fetch(...)`, `process`) are left to
// `no-restricted-globals`, configured beside this rule in
// packages/tooling/eslint.base.js: ESLint already resolves scope for those and
// a second implementation here would be a second expression of one concept.

/** `Math.random`, `Date.now` and the like: object, property, and why. */
const BANNED_MEMBERS = [
  { object: 'Math', property: 'random', messageId: 'random' },
  { object: 'Date', property: 'now', messageId: 'clock' },
  { object: 'crypto', property: 'randomUUID', messageId: 'random' },
  { object: 'crypto', property: 'getRandomValues', messageId: 'random' },
];

/** Objects that are impure however they are reached. */
const BANNED_OBJECTS = [
  { object: 'Intl', messageId: 'locale' },
  { object: 'performance', messageId: 'clock' },
  { object: 'process', messageId: 'ambient' },
  { object: 'globalThis', messageId: 'ambient' },
];

/** Constructors that read wall time. */
const CLOCK_CONSTRUCTORS = new Set(['Date']);

/** @type {import('eslint').Rule.RuleModule} */
const enginePurity = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban ambient nondeterminism, I/O and floating-point literals inside packages/rules-engine.',
    },
    schema: [],
    messages: {
      clock:
        'The engine may not read a clock ({{name}}). A trading day is calendar data supplied by ' +
        'the caller, never derived from wall time: a wall-clock read is impurity wearing a ' +
        'different hat, and it breaks the replay self-audit silently.',
      random:
        'The engine may not use {{name}}. Determinism is the property the replay self-audit ' +
        'asserts and the PT-nn suites depend on.',
      locale:
        'The engine may not use {{name}}. Locale-dependent behavior makes an output depend on ' +
        'the machine that produced it.',
      ambient:
        'The engine may not read {{name}}. Everything it needs arrives through its arguments.',
      io:
        'The engine may not import "{{name}}". Its contract is zero I/O, and the manifest check ' +
        'RI-01 cannot see an import that resolves through a hoisted layout.',
      float:
        'The engine may not carry the floating-point literal {{value}}. Money is integer cents ' +
        'and thresholds are basis points or integer cents.',
    },
  },

  create(context) {
    return {
      // `new Date()`, `new Intl.NumberFormat()`
      NewExpression(node) {
        const callee = node.callee;
        if (callee.type === 'Identifier' && CLOCK_CONSTRUCTORS.has(callee.name)) {
          context.report({ node, messageId: 'clock', data: { name: `new ${callee.name}()` } });
        }
      },

      MemberExpression(node) {
        if (node.object.type !== 'Identifier') return;
        const object = node.object.name;
        const property = node.property.type === 'Identifier' ? node.property.name : null;

        for (const banned of BANNED_MEMBERS) {
          if (object === banned.object && property === banned.property) {
            context.report({
              node,
              messageId: banned.messageId,
              data: { name: `${object}.${property}` },
            });
            return;
          }
        }
        for (const banned of BANNED_OBJECTS) {
          if (object === banned.object) {
            context.report({ node, messageId: banned.messageId, data: { name: object } });
            return;
          }
        }
      },

      // ANY non-relative import. The engine's own modules are relative;
      // everything else is either a workspace package (RI-01's half) or a
      // runtime the engine is not allowed to reach.
      ImportDeclaration(node) {
        const source = String(node.source.value ?? '');
        if (source.startsWith('.')) return;
        context.report({ node, messageId: 'io', data: { name: source } });
      },

      // `await import('node:fs')` reaches the same runtime by a route
      // ImportDeclaration does not see.
      ImportExpression(node) {
        if (node.source.type !== 'Literal') return;
        const source = String(node.source.value ?? '');
        if (source.startsWith('.')) return;
        context.report({ node, messageId: 'io', data: { name: source } });
      },

      Literal(node) {
        if (typeof node.value !== 'number') return;
        const raw = node.raw ?? '';
        // `1.5` and `1e-3` are floats. `1_000_000` and `0x10` are not.
        if (!/[.]|e-/i.test(raw)) return;
        context.report({ node, messageId: 'float', data: { value: raw } });
      },
    };
  },
};

export default enginePurity;
