import { base } from '@merit/tooling/eslint';
import merit from 'eslint-plugin-merit';

// =============================================================================
// eslint.config.js
// =============================================================================
// CI-01's lint half. The base lives in @merit/tooling so there is one copy of
// it rather than one per application (P1 section 2.1); this file is where the
// rules that apply to SOME paths are attached to those paths.
//
// A rule attached to a glob is the reason the workspace layout is what it is.
// VG-4 is "a custom ESLint rule banning raw client imports in app paths"
// (STRATEGY section 4.2), and a rule phrased over "app paths" is expressible
// only if app paths are a glob. `merit/engine-purity` below is the same shape
// pointed at the engine.

export default [
  ...base,

  {
    // THE ENGINE'S SOURCE, AND ONLY ITS SOURCE.
    //
    // `test/` is deliberately out of scope. A property suite generates dates to
    // build inputs with and a fixture reads files; both are the harness rather
    // than the engine, and banning them there would ban the tests that prove
    // the engine is pure. The boundary is what `src/` imports and reads, which
    // is what ships.
    files: ['packages/rules-engine/src/**/*.ts'],
    plugins: { merit },
    rules: {
      'merit/engine-purity': 'error',

      // The bare-global half. ESLint already resolves scope for these, so a
      // second implementation inside merit/engine-purity would be a second
      // expression of one concept, which is the defect OQ-P1-04 was about.
      'no-restricted-globals': [
        'error',
        {
          name: 'Date',
          message:
            'The engine may not read a clock. A trading day is calendar data supplied by the caller.',
        },
        { name: 'fetch', message: 'The engine performs no I/O.' },
        { name: 'process', message: 'Everything the engine needs arrives through its arguments.' },
        { name: 'performance', message: 'The engine may not read a clock.' },
        { name: 'crypto', message: 'The engine is deterministic.' },
      ],
    },
  },

  {
    // Test files may assert against `any`-shaped fixtures and may name a
    // construct the source is banned from using. STRATEGY section 4.5 scopes
    // the type-assertion ban to "outside test fixtures" for exactly this
    // reason, and the ban is relaxed HERE, in one visible place, rather than by
    // disable comments scattered through the suites.
    files: ['**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
