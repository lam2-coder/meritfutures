import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// =============================================================================
// packages/tooling/eslint.base.js
// =============================================================================
// The shared ESLint base, imported once by the workspace root's
// eslint.config.js. P1 section 2.1: the alternative is that each application
// grows its own copy of the base config, and a gate gets disabled in one of
// them without a diff anyone reads.
//
// WHAT IS DELIBERATELY NOT HERE. VG-4, the rule banning raw Drizzle client
// imports outside `packages/db` (ADR-008, STRATEGY section 4.2), needs the
// `scopedDb(identity)` accessor to exist before it can name what it permits.
// That accessor is M-series work and the rule lands with CI-01 in session S-C
// (P1 section 6). It is named here so its absence is a scheduled gap rather
// than an oversight.

/**
 * Paths ESLint must not read. The corpus is prose and the migrations are SQL;
 * neither is source this config has anything true to say about.
 */
export const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  'docs/**',
  'research/**',
  'packages/db/migrations/**',
  'pnpm-lock.yaml',
];

/**
 * Appendix F2's code-level tells, wired rather than remembered
 * (STRATEGY section 4.5). Each of these is a merge blocker in that table, so
 * each is `error` here: a lint rule set to `warn` is a rule that gets scrolled
 * past.
 *
 * @type {import('eslint').Linter.RulesRecord}
 */
export const antiSlop = {
  // "A gap becomes an EDGE_CASES entry or gets fixed." A marker in the source
  // is a third option the corpus does not have.
  'no-warning-comments': [
    'error',
    { terms: ['todo', 'fixme', 'xxx', 'hack'], location: 'anywhere' },
  ],

  // "No `as any` or type-assertion workaround outside test fixtures." The
  // `no-explicit-any` rule catches the annotation; these two catch the escape
  // hatches that route around it.
  'no-restricted-syntax': [
    'error',
    {
      selector: 'TSAsExpression[typeAnnotation.type="TSAnyKeyword"]',
      message: 'An `as any` is a type error deferred to runtime. Model the type or narrow it.',
    },
    {
      selector: 'TSTypeAssertion',
      message: 'Angle-bracket type assertions are banned. Use a type guard.',
    },
  ],
};

/**
 * The base every file in the workspace is linted under.
 *
 * TYPE-AWARE LINTING IS NOT ENABLED and the reason is honest rather than
 * ideological: it needs a project service pointed at every tsconfig, it roughly
 * triples CI-01's runtime, and `tsc --noEmit` already runs in that same stage
 * and finds the type errors. The rules that genuinely need type information
 * (and VG-4 may be one) get it turned on for their own glob when they arrive.
 */
export const base = tseslint.config(
  { ignores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    linterOptions: {
      // A disable comment for a rule that no longer fires is a claim about the
      // code that has stopped being true.
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      ...antiSlop,
      '@typescript-eslint/no-explicit-any': 'error',
      // A leading underscore is the declared way to say "bound on purpose,
      // unused on purpose", which the type-level assertions in
      // packages/rules-engine rely on.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
);

export default base;
