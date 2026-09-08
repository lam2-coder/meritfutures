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
    // -------------------------------------------------------------------------
    // VG-4. EVERY PATH BUT ONE.
    // -------------------------------------------------------------------------
    // STRATEGY section 4.2 phrases VG-4 over "app paths"; ADR-008 and
    // packages/db's own header phrase the invariant it protects over the
    // complement: `packages/db` is THE ONLY PACKAGE PERMITTED TO IMPORT THE
    // DRIZZLE CLIENT. Those two are not the same set, and the wider one is
    // correct. A raw connection opened inside `packages/rithmic` or
    // `packages/tooling` is exactly as unscoped as one opened in `apps/portal`,
    // and the narrow reading would have left the rule silent on every path that
    // is not an app.
    //
    // THE EXCEPTION IS ONE `ignores` LINE, IN THIS FILE, AND THAT IS
    // DELIBERATE. An allowlist inside the rule is a list a rule change can
    // widen without a reviewer reading the word "ignores"; a line here is a
    // diff on the file whose entire subject is which rules apply where.
    //
    // `test/` IS IN SCOPE. A test that opens its own connection is the same
    // unscoped query with a shorter lifetime, and CI-04's integration suite
    // reaches its database through the accessor like everything else.
    files: ['apps/**/*.ts', 'packages/**/*.ts'],
    ignores: ['packages/db/**', 'packages/tooling/checks/generated-column-writes.mjs'],
    plugins: { merit },
    rules: {
      'merit/no-raw-db-client': 'error',
    },
  },

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
    // -------------------------------------------------------------------------
    // ADR-042. THE HOLD, EXPIRY AND SWEEP PATH, WHICH DOES NOT EXIST YET.
    // -------------------------------------------------------------------------
    // A release deadline is measured in WALL-CLOCK HOURS and answered by
    // `now()`. The trading calendar is a different set of days, and there is no
    // business-day calendar in this system because ADR-042 ruled that Merit
    // quotes that unit and never computes it.
    //
    // THIS GLOB MATCHES ZERO FILES TODAY, AND SAYING SO IS THE POINT. The sweep
    // is P2 code. A gate wired while it is green, and watched failing on a
    // seeded violation, is the cheapest it will ever be; wired afterwards it
    // arrives to find the defect already shipped. `packages/eslint-plugin-merit/
    // test/no-calendar-in-expiry-path.test.ts` is where the rule is watched
    // firing, and `RI-06` is what stops this block being quietly deleted while
    // the rule file stays behind looking like a control.
    //
    // THE GLOB IS THE RULE'S SCOPE AND THE RULE DOES NOT GUESS. Naming the
    // paths here rather than sniffing filenames inside the rule is
    // `merit/no-raw-db-client`'s shape exactly: a rule whose whole meaning is
    // the path it is scoped to belongs beside its glob, in the file whose
    // subject is which rules apply where. When the sweep lands somewhere these
    // patterns do not reach, THE LINE TO CHANGE IS THIS ONE, and it is a diff a
    // reviewer reads.
    files: [
      'apps/**/payout*/**/*.ts',
      'apps/**/payouts/**/*.ts',
      'apps/**/wallet/**/*.ts',
      'apps/**/*sweep*.ts',
      'apps/**/*expiry*.ts',
      'apps/**/*freeze*.ts',
      'apps/**/*hold*.ts',
      'packages/**/*sweep*.ts',
      'packages/**/*expiry*.ts',
      'packages/**/*freeze*.ts',
    ],
    ignores: ['**/test/**'],
    plugins: { merit },
    rules: {
      'merit/no-calendar-in-expiry-path': 'error',
    },
  },

  {
    // -------------------------------------------------------------------------
    // ADR-459. THE GUARD NAMING CONVENTION, WHICH WAS LOAD-BEARING AND UNHELD.
    // -------------------------------------------------------------------------
    // `packages/tooling/checks/write-guard-set.mjs` asserts that the guard set
    // on the accessor's write builders is complete, and its legs A and D find a
    // guard by the name `refuse[A-Z]`. ADR-458 section 5 names the hole that
    // leaves: "a refusal added under another name is invisible to legs A and
    // D". Nine declarations honour the convention and, until this rule, nothing
    // required the tenth to.
    //
    // THE GLOB IS `src` AND IT IS WIDER THAN ADR-458 PRICED, DELIBERATELY.
    // That entry priced the rule over `scoped-db.ts` alone, which is where all
    // nine guards live today. The wider glob was MEASURED before it was chosen:
    // across all six files of this directory there are seven named functions
    // that return nothing and throw, and all seven already match the
    // convention, so widening buys an evasion closed at the cost of no
    // exemption. The evasion is a guard extracted to a sibling file, which is
    // somewhere legs A and D do not read either.
    //
    // `test/` IS OUT OF SCOPE, unlike VG-4's glob one block up, and for the
    // reason that block gives for the opposite call. VG-4 bans a construct
    // whose danger does not care who wrote it. This rule enforces a NAMING
    // convention that a checker reads off `src`, and a fixture in a suite that
    // throws to prove a guard fires is not a guard.
    files: ['packages/db/src/**/*.ts'],
    plugins: { merit },
    rules: {
      'merit/refusal-naming': 'error',
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
