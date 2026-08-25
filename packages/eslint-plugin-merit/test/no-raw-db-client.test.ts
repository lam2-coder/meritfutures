import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';

import { noRawDbClient } from '../index.js';

// =============================================================================
// merit/no-raw-db-client (VG-4), watched rejecting each route into a raw client
// =============================================================================
// A GATE NOBODY HAS WATCHED FAIL IS NOT A GATE (STRATEGY section 4.4), and for
// a lint rule "watched fail" means both halves: the invalid cases below prove
// it reports, and the valid cases prove it is not a rule that reports
// everything. A rule that rejects every import passes every invalid case and is
// indistinguishable from a working one, right up until it blocks `@merit/db`
// from importing the client it exists to wrap.
//
// The CI-level half is `CI-01/vg4` in scripts/ci/falsify-ci.mjs, which seeds a
// real file into `apps/portal/src/` and asserts the STAGE fails on this rule's
// name. This file proves the rule works; that one proves the rule is wired.

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

// THE TYPESCRIPT PARSER, NOT espree, AND THE DIFFERENCE IS A REAL CASE RATHER
// THAN TIDINESS. Every file this rule runs over is `.ts`. Under espree,
// `import type { ScopedDb } from '@merit/db'` is a PARSE ERROR, so the two
// type-only cases below could not be written at all and the rule's behavior on
// them would be a guess about a merge blocker. No type information is
// requested: the parser alone, which is all a syntax rule needs.
const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2023,
    sourceType: 'module',
  },
});

ruleTester.run('no-raw-db-client', noRawDbClient, {
  valid: [
    // THE SANCTIONED IDIOM. If this ever becomes a finding the rule has eaten
    // the thing it exists to protect.
    "import { scopedDb } from '@merit/db';",
    "import type { ScopedDb } from '@merit/db';",

    // A package whose name merely starts with a banned one. The prefix match is
    // on `name/`, not on `name`, and this is the case that proves it.
    "import { helper } from 'drizzle-orm-helpers';",
    "import { pgAdmin } from 'pgadmin-client';",
    "import { postgresqlUrl } from 'postgres-url-parser';",

    // Ordinary intra-package imports, including relative paths that go up
    // without landing in packages/db/src.
    "import { SERVICE } from './service.ts';",
    "import { format } from '../shared/format.ts';",
    "import { evaluate } from '@merit/rules-engine';",

    // A string that happens to name a client but is not a specifier.
    "export const DRIVER_NOTE = 'pg is wrapped by packages/db';",

    // A dynamic specifier built at runtime. Invisible to this rule BY
    // CONSTRUCTION, and the case is here so the limit is asserted rather than
    // discovered: the header says so, VG-3 and the VG-6 suite are what cover it.
    'export const load = (name) => import(name);',
  ],

  invalid: [
    {
      name: 'the Drizzle client, which is the import VG-4 is named for',
      code: "import { drizzle } from 'drizzle-orm/node-postgres';",
      errors: [{ messageId: 'rawClient' }],
    },
    {
      name: 'the bare package, not only a subpath',
      code: "import { sql } from 'drizzle-orm';",
      errors: [{ messageId: 'rawClient' }],
    },
    {
      name: 'a driver reached directly, which opens a connection nothing scopes',
      code: "import { Pool } from 'pg';",
      errors: [{ messageId: 'rawClient' }],
    },
    {
      name: 'the serverless driver, which is the one an app is most likely to reach for',
      code: "import { neon } from '@neondatabase/serverless';",
      errors: [{ messageId: 'rawClient' }],
    },
    {
      name: 'a second ORM, which ADR-008 rules out as a second data idiom',
      code: "import { Kysely } from 'kysely';",
      errors: [{ messageId: 'rawClient' }],
    },
    {
      name: 're-export, which forwards the binding and no ImportDeclaration sees',
      code: "export { Pool } from 'pg';",
      errors: [{ messageId: 'rawClient' }],
    },
    {
      name: 'star re-export, the same route with no name to read in the diff',
      code: "export * from 'drizzle-orm';",
      errors: [{ messageId: 'rawClient' }],
    },
    {
      name: 'the dynamic form with a literal specifier',
      code: "export const load = () => import('pg');",
      errors: [{ messageId: 'rawClient' }],
    },
    {
      name: 'createRequire, which survives the module system',
      code: "const { Pool } = require('pg');",
      errors: [{ messageId: 'rawClient' }],
    },
    {
      name: 'a deep import into @merit/db, walking around the public entry',
      code: "import { client } from '@merit/db/src/client.js';",
      errors: [{ messageId: 'deepImport' }],
    },
    {
      // A TYPE-ONLY IMPORT IS ERASED AT RUNTIME AND IS STILL A FINDING, which
      // is a decision rather than an accident. It opens no connection, so the
      // BOLA argument does not reach it; what it does is make a file outside
      // packages/db name the client's types, and the next commit that needs a
      // value has the import line already written. The permitted shape is
      // `ScopedDb` from the public entry, which is `valid` above.
      name: 'the type-only form, which is erased and still names the client',
      code: "import type { PgTable } from 'drizzle-orm';",
      errors: [{ messageId: 'rawClient' }],
    },
    {
      name: 'the relative form of the same walk, which no exports map can stop',
      code: "import { client } from '../../db/src/client.ts';",
      errors: [{ messageId: 'deepImport' }],
    },
  ],
});
