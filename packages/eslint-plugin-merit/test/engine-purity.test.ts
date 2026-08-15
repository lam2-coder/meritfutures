import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import { enginePurity } from '../index.js';

// =============================================================================
// merit/engine-purity, watched rejecting each thing it claims to reject
// =============================================================================
// The `valid` half is not filler. A rule that rejects everything passes every
// `invalid` case and is indistinguishable from a rule that works, right up
// until it blocks the engine's own arithmetic. Each valid case below is a
// construct the engine is expected to contain.

// ESLint 10's RuleTester emits its cases through whatever `describe`/`it` it is
// handed, which is how they show up as Vitest tests rather than as one opaque
// pass. Its three statics are the whole integration surface; the legacy
// `afterAll` hook is gone in this major.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
});

ruleTester.run('engine-purity', enginePurity, {
  valid: [
    // The engine's own modules are relative, and it has them.
    "import { applyDayMark } from './day-mark.js';",
    // Integer cents and basis points, which is what the money rule permits.
    'export const MIN_PAYOUT_CENTS = 10_000;',
    'export const asBasisPoints = (n) => n * 10000;',
    // A trading day ARRIVES. Reading one from a parameter is the permitted
    // shape, and the rule has to leave it alone or the engine cannot be written.
    'export function evaluate({ dayMarks }) { return dayMarks.at(-1); }',
    // Hex and bigint literals are not floats.
    'export const mask = 0xff;',
    'export const big = 9007199254740993n;',
    // A local named `date` is not the `Date` constructor.
    'export const f = (date) => date.tradingDay;',
  ],

  invalid: [
    {
      name: 'a wall-clock read, which is the whole point of the rule',
      code: 'export const stamp = Date.now();',
      errors: [{ messageId: 'clock' }],
    },
    {
      name: 'the constructor form of the same read',
      code: 'export const today = new Date();',
      errors: [{ messageId: 'clock' }],
    },
    {
      name: 'nondeterminism, which the replay self-audit cannot survive',
      code: 'export const jitter = Math.random();',
      errors: [{ messageId: 'random' }],
    },
    {
      name: 'a node builtin, which no manifest entry would reveal',
      code: "import { readFileSync } from 'node:fs';",
      errors: [{ messageId: 'io' }],
    },
    {
      name: 'a workspace package, caught here as well as by RI-01',
      code: "import { db } from '@merit/db';",
      errors: [{ messageId: 'io' }],
    },
    {
      name: 'the dynamic form, which ImportDeclaration does not see',
      code: "export const load = () => import('node:fs');",
      errors: [{ messageId: 'io' }],
    },
    {
      name: 'a float, which is a rounding decision nobody made',
      code: 'export const HALF = 0.5;',
      errors: [{ messageId: 'float' }],
    },
    {
      name: 'a float written in exponent form',
      code: 'export const TINY = 1e-6;',
      errors: [{ messageId: 'float' }],
    },
    {
      name: 'locale-dependent formatting, which makes output depend on the machine',
      code: 'export const fmt = new Intl.NumberFormat();',
      errors: [{ messageId: 'locale' }],
    },
    {
      name: 'ambient configuration, which is a parameter read from the wrong place',
      code: 'export const cap = process.env.CAP_BP;',
      errors: [{ messageId: 'ambient' }],
    },
    {
      name: 'a high-resolution clock, which is still a clock',
      code: 'export const t = performance.now();',
      errors: [{ messageId: 'clock' }],
    },
  ],
});
