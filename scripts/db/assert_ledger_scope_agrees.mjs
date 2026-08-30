#!/usr/bin/env node
// =============================================================================
// scripts/db/assert_ledger_scope_agrees.mjs
// =============================================================================
// ADR-259. The scope map the LIBRARY declares and the scope every ledger account
// row actually carries are the same map, read from the two places that hold it,
// in both directions.
//
//   node scripts/db/assert_ledger_scope_agrees.mjs            assert
//   node scripts/db/assert_ledger_scope_agrees.mjs --falsify  watch it fail on a seed
//
// -----------------------------------------------------------------------------
// WHAT ADR-247 SECTION 7 FOUND, AND THE HALF OF IT THAT WAS WRONG
// -----------------------------------------------------------------------------
// That entry seeded `0056`'s row to `('withdrawals_in_flight', 'liability',
// 'identity')`, watched the vitest suite stay GREEN at 20 of 20, and concluded
// that "the suite holds the TYPESCRIPT copy of the scope and not the migration's
// own, so the two can diverge and only one side is watched". The instrument it
// named is `probe_ledger_constraints.sql`'s `LEDGER-K3` block, said to need "a
// running PostgreSQL that CI-02 does not have".
//
// TWO THINGS ARE WRONG WITH THAT AND BOTH WERE MEASURED RATHER THAN READ.
//
// FIRST, THE PROBE IS RUN. `corpus.yml`'s `migrations` job (CI-06h) declares a
// `postgres:16` service, applies every migration forward from empty, and runs
// `probe_ledger_constraints.sql` against the result. `LEDGER-K3` therefore reads
// the migration's own copy on every push. The claim is true of `CI-02` and false
// of CI, and `CI-06s` is a gate that exists to keep every probe on disk wired
// into exactly that job.
//
// SECOND, THAT SEED IS UNREPRESENTABLE. `ledger_accounts_scope_identity` is
// `(scope = 'identity' AND identity_id IS NOT NULL) OR (scope = 'firm' AND
// identity_id IS NULL)`, and `0056` seeds with no `identity_id`. Applying the
// seeded `0056` fails at the INSERT, so the set never installs and no probe is
// reached. A green vitest run against that seed is not evidence that a copy is
// unwatched; it is evidence that vitest has no database.
//
// -----------------------------------------------------------------------------
// THE GAP THAT IS REAL IS LARGER THAN THE ONE THAT WAS NAMED
// -----------------------------------------------------------------------------
// `ledger_accounts` carries `ledger_accounts_kind_matches_code`, a CASE over all
// eight codes closed with `ELSE false`, so a row's KIND is bound to its CODE by
// the database. NOTHING BINDS ITS SCOPE. `ledger_accounts_scope_identity` binds
// scope to whether `identity_id` is null and says nothing about which code may
// be firm-scoped and which may not.
//
// Measured on a `0001` to `0074` database, one INSERT per code inside a rolled
// back transaction: THE DATABASE ACCEPTS A WRONG-SCOPE ROW FOR ALL EIGHT CODES.
// A firm-scoped `trader_wallet` with a null identity lands, and so does the
// mirror of it in the other direction.
//
// `LEDGER-K3` asserts the pairing for exactly ONE of the eight, because it was
// written by ADR-187 to defend the code ADR-187 minted. No reader anywhere
// compares the two representations AS SETS. That comparison is what ADR-247
// named and did not write, and it is what this file is.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE ADDS, MEASURED SEED BY SEED RATHER THAN CLAIMED
// -----------------------------------------------------------------------------
// Five representable divergences were seeded into a COPY of the migration set and
// applied forward from empty. `probe_ledger_constraints.sql` already catches
// three of them, and this file is not written as though it were alone:
//
//   0054's trigger drops promotional_credit          probe RED   this RED
//   0054's trigger opens withdrawals_in_flight       probe RED   this RED
//   the code vocabulary narrows to seven             probe RED   this RED
//   a firm-scoped trader_wallet row is seeded        probe GREEN this RED
//   an identity-scoped reserve row is seeded         probe GREEN this RED
//
// So the coverage this adds is NARROW AND IT IS REAL: the wrong-scope row, in
// both directions, for the seven codes `LEDGER-K3` does not name.
//
// AND THE PART THAT IS NOT A COVERAGE COUNT MATTERS MORE. Every database-side
// assertion the probe makes about scope is a HAND COPY: `LEDGER-K3` writes
// `'firm'` as a literal, and the provisioning block writes the three identity
// codes as a SQL array literal. Neither is derived from `LEDGER_ACCOUNT_SCOPE`,
// so each is a further copy of the fact ADR-247 was worried about, able to drift
// from the library in the same silence. This file holds NO copy. It reads the
// library's exported object and the database, and compares them.
//
// -----------------------------------------------------------------------------
// WHY THIS IS A .mjs AND WHY IT DOES NOT PARSE ANYTHING
// -----------------------------------------------------------------------------
// A `.sql` file cannot read a TypeScript declaration, so it would have to carry
// a THIRD copy of the scope map as a literal, watched against neither of the
// first two. That is the same defect in a new costume and it would read green
// forever, which is the trap this work was dispatched with.
//
// A parser over `accounts.ts` would be the same object one step better. It is
// not needed: `packages/ledger/src/accounts.ts` has ZERO imports and Node 22
// strips types on import, so this file imports the module and reads the exported
// VALUE. One side is the library's own runtime object and the other side is
// `pg_constraint` and `ledger_accounts` on a live database. Neither is text.
//
// -----------------------------------------------------------------------------
// THE READS ARE ONE PSQL SESSION AND EVERY ONE IS ROLLED BACK
// -----------------------------------------------------------------------------
// `assert_append_only_grants.mjs`'s discipline, for its reason: a seed in one
// invocation and a query in the next are two transactions and the rollback comes
// too late. The identity this file opens to observe `0054`'s provisioning
// trigger is inside that same transaction, so the assert path leaves the database
// exactly as it found it and section 5 of the falsify path proves it did.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ACCOUNTS = join(ROOT, 'packages', 'ledger', 'src', 'accounts.ts');

/** The declared vocabulary, as the library's own exported object. */
const { LEDGER_ACCOUNT_SCOPE } = await import(ACCOUNTS);

const DECLARED_CODES = Object.keys(LEDGER_ACCOUNT_SCOPE).sort();
const DECLARED_IDENTITY = DECLARED_CODES.filter((c) => LEDGER_ACCOUNT_SCOPE[c] === 'identity');

// A sentinel on the import itself. A module that stopped exporting the map, or
// exported an empty one, would make every finding below vacuous and this file
// would report a clean agreement between nothing and the database.
if (DECLARED_CODES.length === 0) {
  throw new Error(
    'packages/ledger/src/accounts.ts exports no LEDGER_ACCOUNT_SCOPE entries. Zero ' +
      'means the declaration moved or the import stopped resolving, at which point ' +
      'this file compares the empty set against the database and reports agreement',
  );
}
for (const code of DECLARED_CODES) {
  const scope = LEDGER_ACCOUNT_SCOPE[code];
  if (scope !== 'firm' && scope !== 'identity') {
    throw new Error(
      `LEDGER_ACCOUNT_SCOPE.${code} is ${JSON.stringify(scope)}, which is neither ` +
        "'firm' nor 'identity'. ledger_accounts_scope_check admits exactly those two, " +
        'so a third value makes every comparison below meaningless',
    );
  }
}

// -----------------------------------------------------------------------------
// The three reads, as one script
// -----------------------------------------------------------------------------
// CODE|<code>          one per member of ledger_accounts_code_is_declared, taken
//                      from pg_get_constraintdef rather than from the DDL files,
//                      because the whole finding is that a file and a database
//                      can disagree.
// ROW|<code>|<scope>|<origin>
//                      every row the table holds. `origin` is `probe` for a row
//                      0054's trigger opened for the identity this script
//                      creates, and `seed` for every other row, which is every
//                      row a migration left behind.
// KIND|<code>|<kind>  one per arm of ledger_accounts_kind_matches_code, so the
//                     falsify path can find the one firm code whose ruled kind
//                     is `liability` instead of naming it.
const DERIVE_SQL = `
SELECT 'CODE|' || v.c
  FROM (
    SELECT (regexp_matches(pg_get_constraintdef(oid), '''([a-z_]+)''::text', 'g'))[1] AS c
      FROM pg_constraint
     WHERE conname = 'ledger_accounts_code_is_declared'
  ) v
 ORDER BY 1;

SELECT 'KIND|' || v.m[1] || '|' || v.m[2]
  FROM (
    SELECT regexp_matches(
             pg_get_constraintdef(oid),
             'WHEN ''([a-z_]+)''::text THEN \\(kind = ''([a-z]+)''::text\\)',
             'g') AS m
      FROM pg_constraint
     WHERE conname = 'ledger_accounts_kind_matches_code'
  ) v
 ORDER BY 1;

SELECT 'ROW|' || la.code || '|' || la.scope || '|'
       || CASE
            WHEN la.identity_id IS NOT NULL
             AND la.identity_id = (SELECT id FROM probe_identity) THEN 'probe'
            ELSE 'seed'
          END
  FROM ledger_accounts la
 ORDER BY 1`;

/**
 * One psql session: open an identity so `0054`'s trigger fires, apply whatever
 * the caller is seeding, read, roll back.
 *
 * `seedBefore` runs ahead of the identity INSERT, which is the only slot a seed
 * that replaces the provisioning function can use; `seed` runs after it and can
 * reference `probe_identity`.
 */
function readDatabase(seedBefore = '', seed = '') {
  const script =
    `\\set ON_ERROR_STOP on\nBEGIN;\n${seedBefore}\n` +
    'CREATE TEMP TABLE probe_identity ON COMMIT DROP AS\n' +
    '  WITH n AS (INSERT INTO identities DEFAULT VALUES RETURNING id) SELECT id FROM n;\n' +
    `${seed}\n${DERIVE_SQL};\nROLLBACK;\n`;
  const out = execFileSync('psql', ['-At', '-q', '-f', '-'], { input: script, encoding: 'utf8' });

  const codes = [];
  const kinds = new Map();
  const rows = [];
  for (const line of out.split('\n')) {
    const t = line.trim();
    if (t.startsWith('CODE|')) codes.push(t.slice(5));
    else if (t.startsWith('KIND|')) {
      const [code, kind] = t.slice(5).split('|');
      kinds.set(code, kind);
    } else if (t.startsWith('ROW|')) {
      const [code, scope, origin] = t.slice(4).split('|');
      rows.push({ code, scope, origin });
    }
  }

  // Both sentinels are the same shape as CI-06s's: a zero here means a reader
  // stopped matching, and every code would then agree with the database for the
  // reason that nothing was read.
  if (codes.length === 0) {
    throw new Error(
      'the database reports no member of ledger_accounts_code_is_declared. Either ' +
        'the migrations have not been applied, or the constraint was renamed, or ' +
        "pg_get_constraintdef's rendering has moved. All three make the vocabulary " +
        'comparison below assert nothing',
    );
  }
  if (rows.length === 0) {
    throw new Error(
      'ledger_accounts is empty, and 0052, 0053 and 0056 each seed a firm row into ' +
        'it. Zero rows means the set was not applied, and a scope comparison over no ' +
        'row passes in exactly the same way as one that holds',
    );
  }
  if (kinds.size === 0) {
    throw new Error(
      'the database reports no arm of ledger_accounts_kind_matches_code. Either the ' +
        "constraint was renamed or pg_get_constraintdef's rendering of a CASE has moved, " +
        'and the falsify path below would then find no firm liability code to seed with',
    );
  }
  return { codes, kinds, rows };
}

/**
 * The firm-declared codes whose ruled kind is `liability`, DERIVED from the
 * constraint rather than named here. `kind_matches_code` refuses a substitution
 * whose kind literal does not match the code, so this is the set the trigger
 * seed can draw from at all.
 */
function firmLiabilityCodes(kinds) {
  return DECLARED_CODES.filter(
    (c) => LEDGER_ACCOUNT_SCOPE[c] === 'firm' && kinds.get(c) === 'liability',
  );
}

// -----------------------------------------------------------------------------
// The comparisons. Exported so the falsify path exercises the same functions the
// assert path does, rather than a second copy of the logic that could be
// narrowed independently.
// -----------------------------------------------------------------------------

/** 1. The declared vocabulary and the installed vocabulary are one set. */
export function compareVocabulary(declared, installed) {
  const findings = [];
  const inDb = new Set(installed);
  const inTs = new Set(declared);
  for (const code of declared) {
    if (!inDb.has(code)) {
      findings.push(
        `${code}: LEDGER_ACCOUNT_SCOPE declares it and ledger_accounts_code_is_declared ` +
          'does not admit it. Every chart resolution for this code throws at the database ' +
          'while the library type-checks, which is the divergence with no reader',
      );
    }
  }
  for (const code of installed) {
    if (!inTs.has(code)) {
      findings.push(
        `${code}: the database admits it and LEDGER_ACCOUNT_SCOPE does not declare it. ` +
          'A row can exist in a class no posting in this tree can name, and it is ' +
          'summed by every balance query that reads the table rather than the library',
      );
    }
  }
  return findings;
}

/** 2. Every row carries the scope the library declares for its code. */
export function compareRowScopes(scopeMap, rows) {
  const findings = [];
  const seen = new Set();
  for (const { code, scope, origin } of rows) {
    const declared = scopeMap[code];
    if (declared === undefined) continue; // vocabulary drift, reported by 1
    if (scope === declared) continue;
    const key = `${code}|${scope}|${origin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(
      `${code}: LEDGER_ACCOUNT_SCOPE declares it ${declared}-scoped and the database ` +
        `holds a ${scope}-scoped row for it (opened by ${
          origin === 'probe' ? "0054's provisioning trigger" : 'a migration seed'
        }). No constraint binds scope to code, so the row is legal and wrong: ` +
        `firmAccount and identityAccount are compile-time refusals over a map this ` +
        `row contradicts`,
    );
  }
  return findings;
}

/**
 * 3. `0054`'s trigger opens exactly the codes the library declares `identity`.
 *
 * `0054`'s own header says a wrong literal in the CODE position is not refused by
 * any constraint and is watched by `identity-provisioning.test.ts` instead. That
 * suite reads the migration's TEXT. This reads what the trigger DID.
 */
export function compareProvisioning(declaredIdentity, rows) {
  const findings = [];
  const opened = [...new Set(rows.filter((r) => r.origin === 'probe').map((r) => r.code))].sort();
  const openedSet = new Set(opened);
  const declaredSet = new Set(declaredIdentity);
  for (const code of declaredIdentity) {
    if (!openedSet.has(code)) {
      findings.push(
        `${code}: LEDGER_ACCOUNT_SCOPE declares it identity-scoped and 0054's trigger ` +
          'opened no position in it for a fresh identity. chart.ts resolve throws rather ' +
          'than opening an account, so every posting against this class is unpostable for ' +
          'every identity created from here on',
      );
    }
  }
  for (const code of opened) {
    if (!declaredSet.has(code)) {
      findings.push(
        `${code}: 0054's trigger opened a per-identity position in it and ` +
          'LEDGER_ACCOUNT_SCOPE does not declare it identity-scoped. A firm class with ' +
          'per-identity rows is summed twice by anything reading the class as the firm ' +
          "position, which is the property ADR-124 clause 3's conclusion depends on",
      );
    }
  }
  if (opened.length === 0) {
    findings.push(
      "0054's provisioning trigger opened NO position for a fresh identity. Either the " +
        'trigger is gone or it no longer fires, and LT-06 is unpostable for every ' +
        'identity created after that change',
    );
  }
  return findings;
}

// -----------------------------------------------------------------------------

function assertTree() {
  const { codes, rows } = readDatabase();
  const findings = [
    ...compareVocabulary(DECLARED_CODES, codes),
    ...compareRowScopes(LEDGER_ACCOUNT_SCOPE, rows),
    ...compareProvisioning(DECLARED_IDENTITY, rows),
  ];
  if (findings.length > 0) {
    console.error(
      'LEDGER SCOPE DISAGREES BETWEEN packages/ledger/src/accounts.ts AND THE DATABASE:\n',
    );
    for (const f of findings) console.error(`  - ${f}`);
    console.error(
      `\n${findings.length} finding(s). LEDGER_ACCOUNT_SCOPE is what firmAccount and ` +
        'identityAccount refuse at compile time; a row the database holds against it is ' +
        'a position the library cannot name.',
    );
    process.exit(1);
  }
  console.log(
    `assert_ledger_scope_agrees: ${DECLARED_CODES.length} declared codes, ` +
      `${codes.length} admitted by the database, ${rows.length} rows, and ` +
      `${DECLARED_IDENTITY.length} identity classes provisioned. Every scope agrees.`,
  );
}

// -----------------------------------------------------------------------------
// FALSIFICATION
// -----------------------------------------------------------------------------
// An assertion only ever run against a schema that satisfies it reports PASS in
// exactly the same way as one narrowed until it reads nothing. Each seed below is
// a divergence the database ACCEPTS today, measured before this file existed.
// -----------------------------------------------------------------------------

// Seeded ahead of the identity INSERT, because they rewrite the function the
// INSERT fires. `pg_get_functiondef` and a replacement rather than a copy of the
// body: a copy would drift from 0054 and the seed would stop being 0054's own
// trigger with one thing changed.
//
// WHICH SUBSTITUTION IS REPRESENTABLE AT ALL IS DERIVED AND NOT WRITTEN DOWN.
// Putting a firm code in the trigger's code position while leaving `'liability'`
// in its kind position is REFUSED by `ledger_accounts_kind_matches_code` for
// every firm code whose ruled kind is not `liability`, which is most of them.
// The seed needs the one that IS a liability, and naming it in a comment here
// would be a roll-call of the firm subset that goes stale the day a ninth code is
// minted -- which is the enumeration price ADR-187 section 4's registry exists to
// collect, and this file declines to add a site to it.
//
// So `firmLiabilityCodes()` READS the arms of `kind_matches_code` off
// `pg_get_constraintdef`, intersects them with the codes the library declares
// firm, and the falsify path REQUIRES exactly one. A ninth firm liability makes
// that assertion fail and says so, which is strictly better than a comment.
const seedTriggerBody = (expr) => `
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO def
    FROM pg_proc WHERE proname = 'provision_identity_ledger_accounts';
  IF def IS NULL THEN
    RAISE EXCEPTION 'provision_identity_ledger_accounts() is not installed';
  END IF;
  EXECUTE ${expr};
END $$;`;

// 4a. The trigger stops opening one of the three. Nothing in the database
//     requires it to open any, so this is silent.
const SEED_TRIGGER_OMITS = seedTriggerBody(
  "regexp_replace(def, ',\\s*\\(''promotional_credit''[^)]*\\)', '')",
);

// 4b. The trigger opens a FIRM class per identity, in the one spelling the kind
//     constraint admits. The code is passed in, derived at run time.
const seedTriggerSubstitutes = (code) =>
  seedTriggerBody(`replace(def, '''promotional_credit''', '''${code}''')`);

function falsify() {
  let failures = 0;
  const before = readDatabase();

  const watch = (label, findings, needle) => {
    if (findings.length === 0) {
      console.error(`FALSIFY FAILED: the ${label} seed produced no finding`);
      failures += 1;
      return;
    }
    if (!findings.some((f) => f.includes(needle))) {
      console.error(
        `FALSIFY FAILED: the ${label} seed was reported without naming ${needle}:\n` +
          findings.map((f) => `    ${f}`).join('\n'),
      );
      failures += 1;
      return;
    }
    console.log(`falsified: ${label} -> ${findings.length} finding(s), naming ${needle}`);
  };

  // 1. THE VOCABULARY DRIFTS. `reserve` is dropped from the CHECK. It carries no
  //    seeded row, so the narrowed constraint validates and the drift is exactly
  //    the silent one: every other code still works.
  const narrowed = DECLARED_CODES.filter((c) => c !== 'reserve')
    .map((c) => `'${c}'`)
    .join(', ');
  watch(
    'vocabulary',
    compareVocabulary(
      DECLARED_CODES,
      readDatabase(
        '',
        'ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_code_is_declared;\n' +
          'ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_code_is_declared ' +
          `CHECK (code = ANY (ARRAY[${narrowed}]));`,
      ).codes,
    ),
    'reserve',
  );

  // 2. A MIGRATION-SHAPED ROW WITH THE WRONG SCOPE. `trader_wallet` is declared
  //    identity and this row is firm-scoped with a null identity. Measured
  //    accepted by every constraint on the table.
  watch(
    'firm-scoped identity class',
    compareRowScopes(
      LEDGER_ACCOUNT_SCOPE,
      readDatabase(
        '',
        "INSERT INTO ledger_accounts (code, kind, scope, identity_id) VALUES ('trader_wallet', 'liability', 'firm', NULL);",
      ).rows,
    ),
    'trader_wallet',
  );

  // 3. THE OTHER DIRECTION, AND IT IS THE ONE LEDGER-K3 HOLDS FOR ONE CODE OF
  //    EIGHT. `reserve` is declared firm and this row is identity-scoped.
  watch(
    'identity-scoped firm class',
    compareRowScopes(
      LEDGER_ACCOUNT_SCOPE,
      readDatabase(
        '',
        'INSERT INTO ledger_accounts (code, kind, scope, identity_id) ' +
          "SELECT 'reserve', 'asset', 'identity', id FROM probe_identity;",
      ).rows,
    ),
    'reserve',
  );

  // 4a. THE TRIGGER STOPS OPENING ONE OF THE THREE. 0054's own function with one
  //     tuple removed. THIS SEED IS ALSO CAUGHT BY probe_ledger_constraints.sql,
  //     measured rather than assumed, and it is kept for the reason section 3 of
  //     ADR-259 gives: that block holds the three codes as a SQL array literal
  //     nothing derives from LEDGER_ACCOUNT_SCOPE, so it is a copy that can drift
  //     from the library exactly as the two copies ADR-247 named can drift from
  //     each other. This case is the control that says both readers still agree.
  watch(
    'provisioning trigger drops a class',
    compareProvisioning(DECLARED_IDENTITY, readDatabase(SEED_TRIGGER_OMITS, '').rows),
    'promotional_credit',
  );

  // 4b. THE TRIGGER OPENS A FIRM CLASS PER IDENTITY. Both comparisons must fire:
  //     it is a provisioning drift and it is also a row whose scope contradicts
  //     the declaration.
  const firmLiabilities = firmLiabilityCodes(before.kinds);
  if (firmLiabilities.length !== 1) {
    console.error(
      `FALSIFY FAILED: ledger_accounts_kind_matches_code rules ${String(firmLiabilities.length)} ` +
        'firm code(s) a liability and this seed needs exactly one. Every other firm code is ' +
        'refused in the code position while the kind literal stays `liability`, so with none ' +
        'this seed is unrepresentable and with two it is no longer the sharp case. Read the ' +
        'constraint before widening this',
    );
    failures += 1;
  } else {
    const firmLiability = firmLiabilities[0];
    const substituted = readDatabase(seedTriggerSubstitutes(firmLiability), '');
    watch(
      'provisioning trigger opens a firm class',
      compareProvisioning(DECLARED_IDENTITY, substituted.rows),
      firmLiability,
    );
    watch(
      'provisioning trigger, seen as a row',
      compareRowScopes(LEDGER_ACCOUNT_SCOPE, substituted.rows),
      firmLiability,
    );
  }

  // 5. NO SEED LEAKED. Every one above lived inside a transaction this file
  //    rolled back, and proving that rather than trusting it is the discipline
  //    assert_append_only_grants.mjs applies to its own.
  const after = readDatabase();
  if (
    after.codes.join(',') !== before.codes.join(',') ||
    after.rows.length !== before.rows.length
  ) {
    console.error(
      'FALSIFY FAILED: a seed leaked. The database admitted ' +
        `${before.codes.length} codes over ${before.rows.length} rows before, and ` +
        `${after.codes.length} over ${after.rows.length} now`,
    );
    failures += 1;
  }

  // And the clean database must still agree, or the findings above are noise.
  const clean = [
    ...compareVocabulary(DECLARED_CODES, after.codes),
    ...compareRowScopes(LEDGER_ACCOUNT_SCOPE, after.rows),
    ...compareProvisioning(DECLARED_IDENTITY, after.rows),
  ];
  if (clean.length > 0) {
    console.error(`FALSIFY FAILED: the unseeded database reports ${clean.length} finding(s)`);
    failures += 1;
  }

  if (failures > 0) process.exit(1);
  console.log(
    'assert_ledger_scope_agrees: falsified on a vocabulary drift, on a wrong scope in ' +
      "both directions, and on 0054's provisioning trigger, and no seed leaked.",
  );
}

const argv = process.argv.slice(2);
if (argv.includes('--falsify')) falsify();
else assertTree();
