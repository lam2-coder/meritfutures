// =============================================================================
// merit/no-raw-db-client                                                  VG-4
// =============================================================================
// "A custom ESLint rule banning raw client imports in app paths"
// (STRATEGY section 4.2, where VG-4 blocks merge and is assigned to CI-01).
//
// ADR-008 gives this system ONE sanctioned data idiom: `scopedDb(identity)`,
// exported from `packages/db`, which is the only package permitted to import
// the database client. Every query in the system goes through a value it
// returns, and that is what makes the BOLA blast radius reviewable: the scope
// is applied in one place rather than remembered at each call site.
//
// A SECOND CONNECTION IS NOT A SECOND STYLE, IT IS AN UNSCOPED QUERY. The first
// `import { drizzle } from 'drizzle-orm/...'` in an app is added because a
// handler needed one join that the accessor did not expose yet, in a session
// with a deadline, and from that moment the identity scope is a convention
// rather than a control. This rule is what makes "everywhere" mechanical.
//
// -----------------------------------------------------------------------------
// WHERE IT IS ATTACHED, AND WHY THE EXCEPTION IS NOT IN THIS FILE
// -----------------------------------------------------------------------------
// The rule is unconditional: it reports every raw client import it sees. The
// ONE package permitted to hold them is named in `eslint.config.js`, as an
// `ignores` entry on the config object that turns this rule on. That direction
// matters. An allowlist inside the rule is a list a rule change can widen
// silently; an `ignores` line in the root config is a diff on the file whose
// entire subject is which rules apply where.
//
// -----------------------------------------------------------------------------
// WHAT IT DOES NOT CATCH, stated rather than implied
// -----------------------------------------------------------------------------
// It reads one file at a time with no type information, so it sees the SPELLING
// of a raw client rather than a raw client. Three routes are open to anyone who
// wants them: a dynamic specifier built from a variable, a re-export laundered
// through a package this rule does not know the name of, and a client handed in
// as a function argument. VG-3 and the VG-6 entitlement suite (CI-04) are what
// catch an unscoped query however it was obtained. THIS RULE CLOSES THE
// ACCIDENTAL DOOR, NOT THE DELIBERATE ONE, which is the same limit
// `merit/engine-purity` states about itself.
//
// It also does not know that `scopedDb` exists yet: `packages/db` declares the
// `ScopedDb` type and the accessor arrives with the client (M-series work). The
// rule is writable ahead of that because what it BANS is fixed today, and what
// it POINTS AT is a package that exists. Waiting for the accessor would have
// meant a CI-01 stage shipping without the gate STRATEGY assigns to it.

/**
 * Module specifiers that ARE a database client. Matched exactly, or as a
 * prefix followed by `/`, so `drizzle-orm/node-postgres` is caught by the
 * `drizzle-orm` entry and a package merely named `drizzle-orm-helpers` is not.
 *
 * The `why` is per-family rather than per-package because the finding a
 * reviewer needs is "this is a second connection", not "this is Postgres".
 *
 * @type {{ names: string[], why: string }[]}
 */
const CLIENT_FAMILIES = [
  {
    names: ['drizzle-orm', 'drizzle-kit', 'drizzle-zod'],
    why: 'the Drizzle client and its tooling, which packages/db wraps',
  },
  {
    names: [
      'pg',
      'pg-pool',
      'pg-native',
      'pg-promise',
      'postgres',
      '@neondatabase/serverless',
      '@vercel/postgres',
      '@electric-sql/pglite',
    ],
    why: 'a PostgreSQL driver, which opens a connection this system does not scope',
  },
  {
    names: ['knex', 'kysely', 'typeorm', 'sequelize', 'prisma', '@prisma/client', 'mikro-orm'],
    why: 'a second ORM, which is a second data idiom and ADR-008 rules there is one',
  },
];

/** Flat lookup of the above, specifier -> why. */
const CLIENTS = new Map(
  CLIENT_FAMILIES.flatMap(({ names, why }) => names.map((name) => [name, why])),
);

/**
 * `@merit/db` internals. The package's `exports` map already publishes only
 * `.`, so a deep specifier does not resolve; catching it here makes the
 * FAILURE legible instead of a resolution error, and catches the relative form
 * that no `exports` map can stop.
 */
const DB_PACKAGE = '@merit/db';

/**
 * A relative specifier that climbs out of the current package and lands inside
 * `packages/db/src`. `../../db/src/client.js` from an app is the same import as
 * `@merit/db/src/client.js` with the package boundary walked around on foot.
 */
const RELATIVE_INTO_DB_SRC = /(^|\/)(packages\/)?db\/src\//;

/**
 * The family a specifier belongs to, or null.
 *
 * @param {string} source
 * @returns {{ messageId: 'rawClient' | 'deepImport', data: Record<string, string> } | null}
 */
function classify(source) {
  for (const [name, why] of CLIENTS) {
    if (source === name || source.startsWith(`${name}/`)) {
      return { messageId: 'rawClient', data: { name: source, why } };
    }
  }

  if (source.startsWith(`${DB_PACKAGE}/`)) {
    return { messageId: 'deepImport', data: { name: source } };
  }

  if (source.startsWith('.') && RELATIVE_INTO_DB_SRC.test(source)) {
    return { messageId: 'deepImport', data: { name: source } };
  }

  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const noRawDbClient = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'VG-4. Ban raw database client imports outside packages/db, which is the only package ' +
        'permitted to hold them (ADR-008).',
    },
    schema: [],
    messages: {
      rawClient:
        'VG-4: "{{name}}" is {{why}}. Only packages/db may import it. Everything else reads ' +
        'through `scopedDb(identity)` from @merit/db, which is what applies the identity scope ' +
        'in one place instead of at every call site (ADR-008). A second connection is not a ' +
        'second style, it is an unscoped query.',
      deepImport:
        'VG-4: "{{name}}" reaches inside packages/db instead of through its public entry. The ' +
        'accessor is the boundary; an import that walks around it inherits none of the scoping ' +
        'the boundary exists to apply.',
    },
  },

  create(context) {
    /**
     * @param {import('eslint').Rule.Node} node
     * @param {unknown} raw
     */
    const check = (node, raw) => {
      if (typeof raw !== 'string') return;
      const finding = classify(raw);
      if (finding === null) return;
      context.report({ node, messageId: finding.messageId, data: finding.data });
    };

    return {
      ImportDeclaration: (node) => check(node, node.source.value),

      // `export { db } from 'drizzle-orm'` and `export * from 'pg'` are the
      // same import with the binding forwarded, and a rule that reads only
      // ImportDeclaration says nothing about either.
      ExportNamedDeclaration: (node) => {
        if (node.source) check(node, node.source.value);
      },
      ExportAllDeclaration: (node) => check(node, node.source.value),

      // `await import('pg')` reaches the same client by a route the
      // declaration forms do not cover. A computed specifier is invisible
      // here, which the header states as a limit rather than implying.
      ImportExpression: (node) => {
        if (node.source.type === 'Literal') check(node, node.source.value);
      },

      // The workspace is ESM-only, so this is `createRequire` rather than CJS.
      // It is one selector and it closes the escape hatch that survives the
      // module system.
      CallExpression: (node) => {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;
        const [first] = node.arguments;
        if (first?.type === 'Literal') check(node, first.value);
      },
    };
  },
};

export default noRawDbClient;
