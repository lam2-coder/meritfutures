// =============================================================================
// packages/db/test/affiliate-commissions-unregistrable.test.ts -- CI-02, `unit`.
// =============================================================================
// ADR-253 SECTION 2, EXECUTED. `affiliate_commissions` IS A REAL TABLE THAT NO
// MEMBER OF THE CLOSED SIX COULD HONESTLY NAME AGAINST `0012`'s COLUMN SET, AND
// THIS FILE IS THE ENUMERATION RATHER THAN A PARAGRAPH ABOUT IT.
//
// THE TABLE IS REGISTERED NOW AND THIS FILE IS NOT RETIRED BY THAT. Every case
// below reads `0012`'s `CREATE TABLE` body, which constitution E2 makes
// permanent, so every one of them is a claim about a column set that cannot
// change rather than a claim about today. What they hold is the RECORD OF WHY
// the table was unregistrable for eleven waves: `0078` (ADR-321, on ADR-304)
// adds `affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE
// RESTRICT` from OUTSIDE `0012` and the registration follows the column, so the
// six refusals were right and the repair was never the vocabulary. Deleting this
// file would delete the argument that a SEVENTH class was not owed.
//
// THE ONE CASE THAT WAS ABOUT TODAY IS REPOINTED RATHER THAN REMOVED, and it is
// `the two-step`: the table is in `schema.ts` and in the registry now, and the
// case says which migration put it there. `the fourth edge` below is new and is
// this file's own stated condition being met -- it says a fourth edge re-opens
// the enumeration, so the edge that ended it is asserted here rather than left
// to a reader to notice.
//
// `scope.ts`'s header has argued with this table by name since ADR-106 and its
// argument covers ONE of the six: a `derived` rule through `attributions`
// compiles and then throws, because a chain terminates at `owned` or at `root`
// and `pair` is no more a terminal than `firm` is. That is true and it is not
// the whole refusal. Two more `derived` edges exist on the row, and `firm` is
// available and is the DANGEROUS one, because it is refused by NOTHING in this
// repository today.
//
// THE FILE IS ORGANISED AROUND THAT LAST SENTENCE. Cases 1 to 6 execute the
// enumeration. Case 7 measures the gap: the predicate `scoped-db.test.ts` reads
// for its own firm assertion -- "no firm table carries a column referencing
// identities" -- PASSES on this table, so `firm` would compile, satisfy the
// totality clause, satisfy that assertion, and make the row readable through
// `firmDb()`, which takes no reason on ADR-102 clause 5's ground that no
// identity is at risk. Here one is: a commission is what Merit owes a named
// affiliate. Case 8 is the control that closes it, and it is general rather
// than about this table.
//
// WHY THE DDL AND NOT `schema.ts`. It read: "The subject of every claim here is
// a table that is NOT in `schema.ts`, so there is no transcription to read and
// the migration is the only source." The first half stopped being true with
// ADR-321 and the reason survives it unchanged: comparing a transcription with
// itself asserts that a copy equals its copy, which is `scoped-db.test.ts`'s
// stated reason for its own fold. Every registered table read below is read out
// of the migrations for that reason and not for the absent one.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableName } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';

import { SCOPE_RULES, TABLES, TABLE_KEYS, type TableKey } from '../src/index.ts';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));
const SCHEMA_TS = fileURLToPath(new URL('../src/schema.ts', import.meta.url));
const SCOPE_TS = fileURLToPath(new URL('../src/scope.ts', import.meta.url));

const SUBJECT = 'affiliate_commissions';

const migrationFiles = (): string[] =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();

const allMigrationSql = (): string =>
  migrationFiles()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');

const SQL = allMigrationSql();

/** The body of a `CREATE TABLE`, brackets balanced, comments stripped. */
function createBody(rawSql: string, table: string): string {
  const text = rawSql.replace(/--[^\n]*/g, '');
  const at = text.search(new RegExp(`CREATE TABLE ${table} \\(`, 'i'));
  if (at < 0) throw new Error(`no CREATE TABLE for ${table}`);
  const body = text.slice(text.indexOf('(', at) + 1);
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) return body.slice(0, i);
      depth--;
    }
  }
  throw new Error(`unbalanced CREATE TABLE body for ${table}`);
}

/** Top-level comma-separated parts of a `CREATE TABLE` body. */
function topLevelParts(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Column name -> its whole definition. Table constraints are not columns. */
function columnDefs(table: string): Map<string, string> {
  const defs = new Map<string, string>();
  for (const part of topLevelParts(createBody(SQL, table))) {
    if (/^(CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY|EXCLUDE|LIKE)\b/i.test(part)) continue;
    const name = part.split(/\s+/)[0] as string;
    defs.set(name, part);
  }
  return defs;
}

/**
 * `PRIMARY KEY` IMPLIES NOT NULL AND THE WORDS ARE OFTEN ABSENT, which is the
 * reading `scoped-db.test.ts` records against `wallet_dormancy`. A reader that
 * matched only the words would call such a column nullable.
 */
const declaredNotNull = (def: string): boolean =>
  /\bNOT NULL\b/i.test(def) || /\bPRIMARY KEY\b/i.test(def);

/** `column -> parent table`, for every column of `table` declaring a reference. */
function foreignKeys(table: string): { column: string; parent: string; notNull: boolean }[] {
  const out: { column: string; parent: string; notNull: boolean }[] = [];
  for (const [column, def] of columnDefs(table)) {
    const ref = /REFERENCES\s+([a-z_]+)\s*\(/i.exec(def);
    if (ref === null) continue;
    out.push({
      column,
      parent: (ref[1] as string).toLowerCase(),
      notNull: declaredNotNull(def),
    });
  }
  return out;
}

const identityColumnsOf = (table: string): string[] =>
  [...columnDefs(table).entries()]
    .filter(([, def]) => /REFERENCES\s+identities\s*\(\s*id\s*\)/i.test(def))
    .map(([name]) => name)
    .sort();

/**
 * SQL name -> `TableKey`, DERIVED, and the derivation is not the claim.
 *
 * `scoped-db.test.ts` keeps its own map by hand and says why: deriving it there
 * would make its DRIFT assertion compare the schema with itself. Nothing here
 * asserts a name. Every claim below is about what the MIGRATIONS declare, and
 * this map is only how a registered relation's DDL is found, so a derived
 * lookup is a lookup rather than a second copy of the thing being checked.
 */
const KEY_BY_SQL_NAME: ReadonlyMap<string, TableKey> = new Map(
  TABLE_KEYS.map((key) => [getTableName(TABLES[key]), key] as const),
);

/** The relations created with `CREATE VIEW`, which have no `CREATE TABLE` body. */
const VIEWS: ReadonlySet<string> = new Set(
  [...SQL.matchAll(/^\s*CREATE\s+VIEW\s+([a-z_]+)/gim)].map((m) => (m[1] as string).toLowerCase()),
);

/** Whether a registered relation's class reaches an identity at all. */
const REACHES_AN_IDENTITY: ReadonlySet<string> = new Set([
  'root',
  'owned',
  'derived',
  'pair',
  'either',
]);

describe('the table is real, and it is absent one step earlier than the registry', () => {
  // THE POINT OF THIS CASE IS THAT THE ABSENCE IS NOT THE TABLE'S. `0012`
  // creates it, so every sentence below is about a relation a deployed database
  // holds rows in, and not about a plan.
  test('`0012` creates it, and it is the migration that creates it', () => {
    const creators = migrationFiles().filter((file) =>
      new RegExp(`CREATE TABLE ${SUBJECT} \\(`, 'i').test(
        readFileSync(join(MIGRATIONS, file), 'utf8'),
      ),
    );
    expect(creators).toEqual(['0012_disputes_and_affiliate_settlement.sql']);
  });

  // THE TWO-STEP, AND THIS TABLE COMPLETED IT WITH ADR-321. It read `it is in
  // neither schema.ts nor the registry, while affiliate_statements is in both`,
  // and that was true of every day between `0012` and `0078`.
  // `affiliateStatements` completed exactly this pair when it landed, which is
  // why row `253` names it as the shape of the work, and this table has now
  // completed it on the same rule.
  test("it is in `schema.ts` and in the registry, on `affiliate_statements`' rule", () => {
    const schema = readFileSync(SCHEMA_TS, 'utf8');
    const scope = readFileSync(SCOPE_TS, 'utf8');

    expect(/export const affiliateCommissions\b/.test(schema)).toBe(true);
    expect(/^ {2}affiliateCommissions: \{$/m.test(scope)).toBe(true);
    expect(TABLE_KEYS).toContain('affiliateCommissions' as TableKey);
    expect(KEY_BY_SQL_NAME.get(SUBJECT)).toBe('affiliateCommissions');
    expect(SCOPE_RULES.affiliateCommissions.class).toBe('derived');

    // The precedent, asserted in the same case so it cannot rot separately.
    expect(/export const affiliateStatements\b/.test(schema)).toBe(true);
    expect(/^ {2}affiliateStatements: \{$/m.test(scope)).toBe(true);
    expect(TABLE_KEYS).toContain('affiliateStatements' as TableKey);
    expect(SCOPE_RULES.affiliateStatements.class).toBe('derived');
  });

  // THE FOURTH EDGE, AND THIS FILE ASKED FOR IT BY NAME. `the three edges are
  // exactly these three` below says a fourth edge added tomorrow re-opens the
  // whole enumeration rather than being silently outgrown. This is that edge,
  // and the point of asserting it HERE is that the three-edge case cannot see
  // it: that reader is `0012`'s `CREATE TABLE` body and E2 makes the body
  // permanent, so the enumeration stays a true statement about `0012` and this
  // case is the one that says the table is no longer that body.
  test('`0078` declares the fourth edge, from outside `0012`, and `0012` is untouched', () => {
    const zero12 = readFileSync(
      join(MIGRATIONS, '0012_disputes_and_affiliate_settlement.sql'),
      'utf8',
    );
    const zero78 = readFileSync(join(MIGRATIONS, '0078_affiliate_commission_owner.sql'), 'utf8');

    // The column is nowhere in `0012` and the enumeration above is therefore
    // untouched by it.
    expect(columnDefs(SUBJECT).has('affiliate_id')).toBe(false);
    expect(zero12).not.toMatch(/affiliate_commissions[\s\S]*ADD COLUMN/i);

    // And it is in `0078`, as an addition from outside the merged file.
    expect(zero78).toMatch(
      /ALTER TABLE affiliate_commissions\s+ADD COLUMN affiliate_id uuid NOT NULL REFERENCES affiliates\(id\) ON DELETE RESTRICT;/,
    );
    // The agreement constraint is what makes the denormalized column as sound as
    // the attribution's own, and it is the half a later session is most likely
    // to drop while keeping the column.
    expect(zero78).toMatch(
      /FOREIGN KEY \(attribution_id, affiliate_id\)\s+REFERENCES attributions \(id, affiliate_id\)/,
    );
  });
});

describe('four of the six classes have nothing on this row to name', () => {
  // `root` IS `identities`' ALONE, WHICH IS A PROPERTY OF THE REGISTRY RATHER
  // THAN OF THIS TABLE, so it is asserted where it lives.
  test('`root` is `identities` alone', () => {
    const roots = TABLE_KEYS.filter((key) => SCOPE_RULES[key].class === 'root');
    expect(roots).toEqual(['identities']);
  });

  // ONE MEASUREMENT REFUSES THREE CLASSES AT ONCE. `owned` names ONE column
  // declared against `identities(id)`, `pair` names TWO, and `either` names one
  // beside an account edge. The row declares ZERO.
  test('`owned`, `pair` and `either` are refused by the same zero', () => {
    expect(identityColumnsOf(SUBJECT)).toEqual([]);
    const accountColumns = [...columnDefs(SUBJECT).entries()]
      .filter(([, def]) => /REFERENCES\s+accounts\s*\(/i.test(def))
      .map(([name]) => name);
    expect(accountColumns).toEqual([]);
  });
});

describe('the row declares three edges and every one of them refuses `derived`', () => {
  // THE EDGE SET IS ASSERTED BY NAME RATHER THAN COUNTED, so a fourth edge
  // added tomorrow arrives in the diff with its own column name attached and
  // this whole enumeration is re-opened rather than silently outgrown.
  test('the three edges are exactly these three', () => {
    expect(foreignKeys(SUBJECT)).toEqual([
      { column: 'attribution_id', parent: 'attributions', notNull: true },
      { column: 'clawback_of', parent: SUBJECT, notNull: false },
      { column: 'paid_in_statement_id', parent: 'affiliate_statements', notNull: false },
    ]);
  });

  // EDGE 1. THIS IS THE ONE `scope.ts` ALREADY ARGUES WITH, and the refusal is
  // executed here rather than quoted: `attributions` is registered `pair`, and
  // `scoped-db.test.ts`'s own rule is that a chain terminates at `owned` or at
  // `root`. `pair` is neither, so the walk from this table stops at a class
  // that constructs no predicate.
  test('`attribution_id` reaches `attributions`, which is `pair`, so the chain does not terminate', () => {
    expect(SCOPE_RULES.attributions.class).toBe('pair');
    expect(['owned', 'root']).not.toContain(SCOPE_RULES.attributions.class);

    // AND THE PAIR IS NOT A NEAR MISS: it carries TWO identity columns, so the
    // parent reaches two people rather than none. That distinction matters for
    // section 3 of the entry and it is asserted here rather than assumed.
    expect(identityColumnsOf('attributions')).toEqual([
      'affiliate_identity_id',
      'buyer_identity_id',
    ]);
  });

  // EDGE 2, AND IT IS THE PLAUSIBLE MISTAKE RATHER THAN THE OBVIOUS ONE,
  // BECAUSE THE CHAIN THROUGH IT WOULD ACTUALLY TERMINATE. What refuses it is
  // ADR-101 clause 2 and the population, not the walk.
  test('`paid_in_statement_id` WOULD terminate, and is refused on nullability and on population', () => {
    // The walk: affiliate_statements -> affiliates -> owned. It terminates.
    expect(SCOPE_RULES.affiliateStatements.class).toBe('derived');
    const statements = SCOPE_RULES.affiliateStatements;
    if (statements.class !== 'derived') throw new Error('unreachable');
    expect(statements.via).toBe('affiliates');
    expect(SCOPE_RULES.affiliates.class).toBe('owned');

    // ADR-101 clause 2: the edge is NULLABLE, so the rows that reach nobody are
    // a subset returned in silence.
    const def = columnDefs(SUBJECT).get('paid_in_statement_id');
    expect(declaredNotNull(def as string)).toBe(false);

    // THE POPULATION, READ OFF THE DDL RATHER THAN ASSERTED. `status` admits
    // four members and only `paid` is constrained to carry a statement, so
    // three of the four are exactly the rows a nullable hop drops -- and they
    // are the rows an affiliate arguing about money is arguing about.
    const body = createBody(SQL, SUBJECT);
    const statusCheck = /status\s+IN\s*\(([^)]*)\)/i.exec(body);
    const members = (statusCheck?.[1] ?? '')
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .sort();
    expect(members).toEqual(['accrued', 'clawed_back', 'paid', 'payable']);
    expect(body).toMatch(
      /affiliate_commissions_paid_has_statement CHECK \(\s*status <> 'paid' OR paid_in_statement_id IS NOT NULL\s*\)/i,
    );
  });

  // EDGE 3. A SELF EDGE HAS NO TERMINUS AND IS NULL ON EVERY ACCRUAL, so it is
  // refused twice and neither refusal needs a judgement.
  test('`clawback_of` points at this same table and is null on every accrual', () => {
    const def = columnDefs(SUBJECT).get('clawback_of') as string;
    expect(declaredNotNull(def)).toBe(false);
    expect(foreignKeys(SUBJECT).find((e) => e.column === 'clawback_of')?.parent).toBe(SUBJECT);
    // The sign constraint is what makes the null the normal case: a row with no
    // `clawback_of` is an accrual, and an accrual is the majority of the table.
    expect(createBody(SQL, SUBJECT)).toMatch(/clawback_of IS NULL AND amount_cents > 0/i);
  });
});

describe('`firm` is the sixth class, it is a lie here, and nothing in this repository says so', () => {
  // THIS IS THE FINDING. The predicate below is the one `scoped-db.test.ts`
  // reads at `no firm table carries a column referencing identities, so the
  // class is not hiding one`. It PASSES on this table. So a session that
  // reached for `firm` to make a registration compile would be told nothing by
  // any check in this tree.
  test('the suite’s own firm predicate passes on this table, so `firm` is refused by nothing', () => {
    expect(identityColumnsOf(SUBJECT)).toEqual([]);
  });

  // AND THE PREDICATE IS NOT WEAK IN GENERAL, which is why the gap is worth a
  // control rather than a sentence: it is the whole of what stands between the
  // registry and a firm rule on all 47 firm relations today.
  test('that predicate is the whole of the existing firm check, over every firm relation', () => {
    const firmKeys = TABLE_KEYS.filter((key) => SCOPE_RULES[key].class === 'firm');
    expect(firmKeys.length).toBeGreaterThan(40);
    for (const key of firmKeys) {
      const table = getTableName(TABLES[key]);
      if (VIEWS.has(table)) continue;
      expect(identityColumnsOf(table), `${table} reaches identities directly`).toEqual([]);
    }
  });

  // -----------------------------------------------------------------------------
  // THE CONTROL. ADR-253 SECTION 4.
  // -----------------------------------------------------------------------------
  // A FIRM ROW IS ONE NO IDENTITY OWNS, AND A REQUIRED EDGE TO AN
  // IDENTITY-REACHING PARENT IS AN IDENTITY OWNING IT. `FirmRule` carries a
  // reason and no columns, so the registry itself holds nothing to check a firm
  // claim against; the migrations do. Every firm relation on this tree passes
  // this today, measured rather than hoped: 47 relations, zero violations.
  //
  // WHY `NOT NULL` AND NOT EVERY EDGE. A nullable edge leaves rows that reach
  // nobody, so a table with one is genuinely a table whose rows may belong to
  // no identity, and `events` is the class built for the case where that is the
  // ROW's property. A REQUIRED edge admits no such row: every row of the child
  // reaches the parent, and if the parent reaches an identity then so does
  // every row here.
  //
  // WHAT IT WOULD HAVE CAUGHT, AND THE ONLY REASON IT IS WRITTEN. Nothing. It
  // catches no defect on this tree. It is written because the mistake it
  // refuses is the one available RIGHT NOW to the next session that opens
  // `scope.ts` on this table, and because that mistake puts a wrong tenancy
  // answer behind a door that RETURNS ROWS rather than behind one that refuses.
  test('no firm relation has a required edge to a relation that reaches an identity', () => {
    const violations: string[] = [];
    for (const key of TABLE_KEYS) {
      if (SCOPE_RULES[key].class !== 'firm') continue;
      const table = getTableName(TABLES[key]);
      if (VIEWS.has(table)) continue;
      for (const edge of foreignKeys(table)) {
        if (!edge.notNull) continue;
        const parentKey = KEY_BY_SQL_NAME.get(edge.parent);
        const parentClass = parentKey === undefined ? 'unregistered' : SCOPE_RULES[parentKey].class;
        if (REACHES_AN_IDENTITY.has(parentClass)) {
          violations.push(`${table}.${edge.column} NOT NULL -> ${edge.parent} (${parentClass})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  // THE CONTROL HAS TEETH, DEMONSTRATED ON THE TABLE IT WAS WRITTEN FOR RATHER
  // THAN ASSERTED TO HAVE THEM. The same predicate is run against
  // `affiliate_commissions` as if it were registered `firm`, and it refuses.
  // A control asserted green over a set that happens to contain no counter-
  // example is a control nobody has watched work.
  test('and it refuses `affiliate_commissions`, which is what makes it a control', () => {
    const refused = foreignKeys(SUBJECT)
      .filter((edge) => {
        if (!edge.notNull) return false;
        const parentKey = KEY_BY_SQL_NAME.get(edge.parent);
        if (parentKey === undefined) return false;
        return REACHES_AN_IDENTITY.has(SCOPE_RULES[parentKey].class);
      })
      .map((edge) => `${SUBJECT}.${edge.column} NOT NULL -> ${edge.parent}`);

    expect(refused).toEqual([`${SUBJECT}.attribution_id NOT NULL -> attributions`]);
  });
});
