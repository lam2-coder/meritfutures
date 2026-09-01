// =============================================================================
// packages/db/test/affiliate-commissions-is-a-column-away.test.ts -- CI-02, `unit`.
// =============================================================================
// ADR-304, EXECUTED. THE SIBLING OF `affiliate-commissions-unregistrable.test.ts`
// AND NOT ITS REPLACEMENT: that file asserts the SIX REFUSALS, and this one
// asserts the measurements the RULING on top of them rests on.
//
// ADR-253 ruled that no member of the closed six honestly fits this table and
// left one question open: whether a SEVENTH class should exist for it. ADR-304
// answers no, and the answer is a claim about the DDL rather than about the
// vocabulary -- that three sibling tables on this rail carry one column that
// makes them registrable without a ruling, that `affiliate_commissions` is the
// only one that does not, and that the class ADR-253 sketched would key an
// affiliate's money to a column `0012` declares to be a snapshot.
//
// EVERY CASE BELOW IS A SENTENCE OF THAT ENTRY THAT A LATER SESSION WOULD
// OTHERWISE TAKE ON TRUST. ADR-042 already ruled that prose is not a control.
//
// THE CASE WITH TEETH IS `the only child of a pair parent`. Section 3.2 of the
// entry argues that the seventh class would be true of exactly one foreign key
// in this whole schema, and that is a fact about today rather than a law: the
// day a second child of any `pair` relation lands, the argument is weaker and
// the enumeration should be re-opened. This case names the set, so that day
// arrives in a diff.
//
// AND ONE CASE IS WRITTEN TO GO RED ON SUCCESS. `the rail's shape` asserts that
// this table declares NO edge to `affiliates`. When `0078` lands it will, and
// this case fails -- which is correct, and is the entry that lands it being
// made to repoint the assertion that argued for it.
//
// WHY THE DDL AND NOT `schema.ts`. The subject of every claim here is a table
// that is NOT in `schema.ts`, so there is no transcription to read and the
// migration is the only source, which is the reason the sibling file states.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableName } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';

import { stripComments } from '../../tooling/checks/strip-comments.mjs';
import {
  SCOPE_RULES,
  TABLES,
  TABLE_KEYS,
  scopePredicate,
  type IdentityId,
  type TableKey,
} from '../src/index.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS = join(HERE, '..', 'migrations');
const REPO = join(HERE, '..', '..', '..');

const SUBJECT = 'affiliate_commissions';
const IDENTITY = 'i-1' as IdentityId;

/** The three tables registered `derived` via `affiliates`, and the fourth is the subject. */
const SIBLINGS = ['affiliate_creatives', 'affiliate_clicks', 'affiliate_statements'] as const;

const migrationFiles = (): string[] =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();

const rawSql = (): string =>
  migrationFiles()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');

const RAW = rawSql();

/** Comments stripped, because a comment is not a declaration. */
const SQL = RAW.replace(/--[^\n]*/g, '');

/** The body of a `CREATE TABLE`, brackets balanced. */
function createBody(table: string): string {
  const at = SQL.search(new RegExp(`CREATE TABLE ${table} \\(`, 'i'));
  if (at < 0) throw new Error(`no CREATE TABLE for ${table}`);
  const body = SQL.slice(SQL.indexOf('(', at) + 1);
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
  for (const part of topLevelParts(createBody(table))) {
    if (/^(CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY|EXCLUDE|LIKE)\b/i.test(part)) continue;
    const name = part.split(/\s+/)[0] as string;
    defs.set(name, part);
  }
  return defs;
}

/** `PRIMARY KEY` implies NOT NULL and the words are often absent. */
const declaredNotNull = (def: string): boolean =>
  /\bNOT NULL\b/i.test(def) || /\bPRIMARY KEY\b/i.test(def);

/** Every column of `table` whose definition references `parent`. */
const edgesTo = (table: string, parent: string): { column: string; notNull: boolean }[] =>
  [...columnDefs(table).entries()]
    .filter(([, def]) => new RegExp(`REFERENCES\\s+${parent}\\s*\\(`, 'i').test(def))
    .map(([column, def]) => ({ column, notNull: declaredNotNull(def) }));

/** Every `CREATE TABLE` name in the migration set. */
const createdTables = (): string[] =>
  [...SQL.matchAll(/CREATE TABLE\s+([a-z_]+)\s*\(/gi)].map((m) => (m[1] as string).toLowerCase());

/**
 * SQL name -> `TableKey`, DERIVED, and the derivation is not the claim. The
 * sibling file states the reason: nothing here asserts a name, and this map is
 * only how a registered relation's rule is found.
 */
const KEY_BY_SQL_NAME: ReadonlyMap<string, TableKey> = new Map(
  TABLE_KEYS.map((key) => [getTableName(TABLES[key]), key] as const),
);

/**
 * Every foreign key in the migration set whose parent satisfies `isParent`.
 *
 * PARAMETERISED SO THE WALK CAN BE WATCHED FINDING SOMETHING. The real question
 * is asked with `isRegisteredPair`; the case below it asks the identical walk a
 * question with a known answer, which is how this file demonstrates that a
 * second child would be found rather than asserting that it would.
 */
function childrenOf(isParent: (sqlName: string) => boolean): string[] {
  const out: string[] = [];
  for (const table of createdTables()) {
    for (const [column, def] of columnDefs(table)) {
      const ref = /REFERENCES\s+([a-z_]+)\s*\(/i.exec(def);
      if (ref === null) continue;
      const parent = (ref[1] as string).toLowerCase();
      if (!isParent(parent)) continue;
      out.push(`${table}.${column} -> ${parent}`);
    }
  }
  return out;
}

const isRegisteredPair = (sqlName: string): boolean => {
  const key = KEY_BY_SQL_NAME.get(sqlName);
  return key !== undefined && SCOPE_RULES[key].class === 'pair';
};

/** Every `.ts` file under a directory, recursively. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/** Every shipped source file in the workspace. Tests are not shipped. */
function shippedSources(): string[] {
  const roots: string[] = [];
  for (const group of ['apps', 'packages']) {
    for (const entry of readdirSync(join(REPO, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const src = join(REPO, group, entry.name, 'src');
      try {
        readdirSync(src);
        roots.push(src);
      } catch {
        // A workspace member with no `src/` contributes no shipped source.
      }
    }
  }
  return roots.flatMap(walk);
}

describe('the rail carries one column and this table is the only one without it', () => {
  // THE WHOLE GROUND OF ADR-304 SECTION 4, IN ONE CASE AND IN BOTH DIRECTIONS.
  // The three siblings are registrable without a ruling BECAUSE of this column,
  // and the subject is unregistrable in its ABSENCE. Asserting only one half
  // would leave the other free to move.
  test('three siblings declare `affiliate_id NOT NULL -> affiliates`, and the subject declares none', () => {
    for (const table of SIBLINGS) {
      expect(edgesTo(table, 'affiliates'), table).toEqual([
        { column: 'affiliate_id', notNull: true },
      ]);
    }
    expect(edgesTo(SUBJECT, 'affiliates')).toEqual([]);
  });

  // AND THE REGISTRY AGREES WITH THE DDL ON ALL THREE, which is what makes the
  // fourth table's registration a transcription rather than a judgement once
  // the column exists.
  test('all three are registered `derived` via `affiliates` on that column, as a `hop`', () => {
    for (const table of SIBLINGS) {
      const key = KEY_BY_SQL_NAME.get(table);
      expect(key, `${table} is not registered`).toBeDefined();
      const rule = SCOPE_RULES[key as NonNullable<typeof key>];
      expect(rule.class, table).toBe('derived');
      if (rule.class !== 'derived') throw new Error('unreachable');
      expect(rule.via, table).toBe('affiliates');
      expect(rule.localColumn, table).toBe('affiliate_id');
      expect(rule.foreignColumn, table).toBe('id');
      expect(rule.traversal, table).toBe('hop');
    }
    // The terminus, asserted once rather than four times: `affiliates` is the
    // `owned` row every one of these hops ends at.
    expect(SCOPE_RULES.affiliates.class).toBe('owned');
  });

  // NOTHING WRITES THE TABLE, WHICH IS WHAT MAKES A `NOT NULL` COLUMN WITH NO
  // DEFAULT ADDABLE WITH NO BACKFILL (section 4 clause 3). The search is over
  // source with COMMENTS STRIPPED, because two shipped files discuss this table
  // at length and a census counting prose would find a writer in a sentence
  // explaining that there is none. The stripper is imported per ADR-279: this
  // is an ABSENCE assertion, and one over a file a weaker stripper emptied goes
  // vacuously green rather than red.
  //
  // THE HUNT IS FOR A WRITER AND NOT FOR THE NAME, and the difference is
  // measured in the next case rather than assumed: the name DOES survive the
  // strip, in refusal strings and in `why` strings, which are string literals
  // and are deliberately kept.
  test('no shipped source writes a row of this table', () => {
    const writers = shippedSources().filter((file) => {
      const src = stripComments(readFileSync(file, 'utf8'));
      return (
        /affiliateCommissions\b/.test(src) ||
        new RegExp(`(INSERT INTO|UPDATE|DELETE FROM)\\s+${SUBJECT}`, 'i').test(src)
      );
    });
    expect(writers).toEqual([]);
    // A drizzle handle is the other half of the same absence and it cannot
    // exist: the table is not declared in `schema.ts`, so there is no
    // identifier for a writer to reach for.
    expect(TABLE_KEYS).not.toContain('affiliateCommissions' as (typeof TABLE_KEYS)[number]);
  });

  // WHAT DOES SURVIVE THE STRIP IS TWO REFUSALS, and naming them is what keeps
  // the case above from passing because the subject is missing entirely. Both
  // are strings a caller or a reader is SERVED, which is why they are literals
  // rather than comments, and neither is a write.
  test('the name survives the strip at exactly two sites, and both are refusals', () => {
    const sites = shippedSources().filter((file) =>
      new RegExp(SUBJECT).test(stripComments(readFileSync(file, 'utf8'))),
    );
    expect(sites.map((f) => f.slice(REPO.length + 1)).sort()).toEqual([
      'apps/api/src/routes/affiliate.ts',
      'packages/db/src/scope.ts',
    ]);
  });
});

describe('the parent carries two routes to the affiliate and one of them is frozen', () => {
  // ADR-304 SECTION 3.1. The seventh class would name `affiliate_identity_id`,
  // and the settlement rail keys on `affiliate_id`. Both are NOT NULL and both
  // are on the same row, so the difference is not visible to any mechanical
  // check and has to be asserted from the DDL.
  test('`attributions` declares both `affiliate_id` and `affiliate_identity_id`, both NOT NULL', () => {
    expect(edgesTo('attributions', 'affiliates')).toEqual([
      { column: 'affiliate_id', notNull: true },
    ]);
    const identityEdges = edgesTo('attributions', 'identities').sort((a, b) =>
      a.column.localeCompare(b.column),
    );
    expect(identityEdges).toEqual([
      { column: 'affiliate_identity_id', notNull: true },
      { column: 'buyer_identity_id', notNull: true },
    ]);
  });

  // THE MIGRATION'S OWN SENTENCE, READ RATHER THAN PARAPHRASED. Section 3.1 is
  // an argument about which of two columns is a fact of record, and `0012` is
  // the only thing entitled to settle that. It is read out of the RAW text,
  // because the sentence is a comment and the point is that it is one.
  test('`0012` says the identities are stored AT THE MOMENT OF PURCHASE and says why', () => {
    const zero12 = readFileSync(
      join(MIGRATIONS, '0012_disputes_and_affiliate_settlement.sql'),
      'utf8',
    );
    expect(zero12).toMatch(/statement about the two of them AT THE MOMENT OF PURCHASE/);
    expect(zero12).toMatch(
      /an affiliate\s*\n?\s*--\s*can be reassigned or an identity merged afterwards/,
    );
  });

  // AND THE PAIR IS A PAIR, so a class naming a LEG has two available answers
  // and only one of them is this table's. `buyer_identity_id` compiles exactly
  // as well and returns the buyer every commission Merit owes on their sale.
  test('`attributions` is `pair`, and both legs are named on its rule', () => {
    const rule = SCOPE_RULES.attributions;
    expect(rule.class).toBe('pair');
    if (rule.class !== 'pair') throw new Error('unreachable');
    expect([rule.columnA, rule.columnB].sort()).toEqual([
      'affiliate_identity_id',
      'buyer_identity_id',
    ]);
  });
});

describe('the seventh class would be true of exactly one foreign key in this schema', () => {
  // THE CASE WITH TEETH. ADR-304 section 3.2. A class that derives through a
  // `pair` parent has one possible member on this tree, and a second child of
  // any `pair` relation would weaken the argument that a column is the cheaper
  // repair. The set is asserted by NAME rather than counted, so the day one
  // lands it arrives in a diff with its own table attached.
  test('`affiliate_commissions.attribution_id` is the only edge to any `pair` relation', () => {
    expect(childrenOf(isRegisteredPair)).toEqual([`${SUBJECT}.attribution_id -> attributions`]);
  });

  // AND THE SCAN IS NOT BLIND, DEMONSTRATED ON A SECOND PARENT RATHER THAN
  // ASSERTED TO HAVE TEETH. A control green over a set that happens to hold no
  // counter-example is a control nobody has watched work, and no migration is
  // seeded to watch this one: the same walk is run with `affiliate_statements`
  // standing in for a `pair` relation, and it finds the edge that reaches it.
  // So an edge to a real `pair` parent added tomorrow is found by the case
  // above rather than passed over.
  test('the same walk finds a child when a different relation is treated as the parent', () => {
    expect(childrenOf((name) => name === 'affiliate_statements')).toEqual([
      `${SUBJECT}.paid_in_statement_id -> affiliate_statements`,
    ]);
  });

  // AND THE OTHER `pair` RELATIONS ARE REGISTERED, so the case above is a
  // measurement over a populated class rather than one that passes because the
  // class is empty.
  test('three relations are registered `pair` and two of them have no children at all', () => {
    const pairs = TABLE_KEYS.filter((key) => SCOPE_RULES[key].class === 'pair')
      .map((key) => getTableName(TABLES[key]))
      .sort();
    expect(pairs).toEqual(['attributions', 'dedupe_matches', 'identity_links']);
  });
});

describe('`GET /affiliate/stats` has a second obstruction and no class fixes it', () => {
  // ADR-304 SECTION 5. Four of the nine fields come off `affiliates`, which is
  // `owned`, so they are readable today and are not part of any obstruction.
  test('`affiliates` declares the four fields that are already served', () => {
    const columns = columnDefs('affiliates');
    for (const column of ['code', 'commission_bp', 'status', 'chargeback_rate_bp']) {
      expect(columns.has(column), column).toBe(true);
    }
    expect(SCOPE_RULES.affiliates.class).toBe('owned');
  });

  // AND IT DECLARES NO CONVERSION COUNTER, which is what sends the count to
  // `attributions` rather than to the affiliate's own row.
  test('no relation on this rail carries a conversion counter', () => {
    for (const table of ['affiliates', 'affiliate_clicks', ...SIBLINGS]) {
      const counters = [...columnDefs(table).keys()].filter((c) => /conversion/i.test(c));
      expect(counters, table).toEqual([]);
    }
  });

  // THE SECOND OBSTRUCTION, EXECUTED RATHER THAN ASSERTED ABOUT. `attributions`
  // is `pair`, so the scoped accessor refuses it at runtime and the type
  // refuses it at compile time. A count over it is therefore unavailable to
  // `stats` no matter what class `affiliate_commissions` is ever given.
  test('`scopePredicate` throws on `attributions`, so a scoped count over it has no door', () => {
    expect(() => scopePredicate('attributions', IDENTITY)).toThrow(/belongs to TWO identities/);
    expect(() => scopePredicate('attributions', IDENTITY)).toThrow(/systemDb/);
  });

  // THE ALTERNATIVE SOURCE, MEASURED AND ON THE WRONG SIDE OF THE TENANCY. A
  // second relation does record which affiliate was on a sale, and its table is
  // scoped to the BUYER, so an affiliate's scoped read of it returns their own
  // purchases and never their referrals'.
  test('`purchases.affiliate_id` exists, is nullable, and sits on a buyer-owned table', () => {
    expect(edgesTo('purchases', 'affiliates')).toEqual([
      { column: 'affiliate_id', notNull: false },
    ]);
    const rule = SCOPE_RULES.purchases;
    expect(rule.class).toBe('owned');
    if (rule.class !== 'owned') throw new Error('unreachable');
    expect(rule.column).toBe('identity_id');
    expect(rule.nullable).toBe(false);
  });
});

describe('what `0078` owes, asserted as facts about today rather than about a file', () => {
  // SECTION 4 CLAUSE 2. The composite edge that closes the drift needs a unique
  // key on the parent to name, and `attributions` does not declare one today.
  // The migration that adds the column adds this too, or the denormalized
  // column can disagree with its parent and a commission is paid to the wrong
  // affiliate.
  test('`attributions` declares no `UNIQUE (id, affiliate_id)` for a composite edge to name', () => {
    expect(createBody('attributions')).not.toMatch(/UNIQUE\s*\(\s*id\s*,\s*affiliate_id\s*\)/i);
    // The primary key it does have, which is what makes the extra unique
    // redundant for uniqueness and necessary for reference.
    expect(columnDefs('attributions').get('id')).toMatch(/PRIMARY KEY/i);
  });

  // AND THE IDIOM IS ALREADY IN THIS ESTATE, so the migration row is copying
  // rather than inventing. `0049`'s anchor is the composite foreign key
  // `scope.ts` already argues with by name.
  test('a composite foreign key already exists in this migration set', () => {
    expect(RAW).toMatch(/reserve_coverage_snapshots_anchor_fk/);
  });

  // AND NO FILE `0078_*.sql` EXISTS, which is this entry declining to spend the
  // number it reserved. `0077` is ADR-297's and is equally absent.
  test('neither `0078` nor `0077` is written', () => {
    const spent = migrationFiles().filter((f) => /^00(77|78)_/.test(f));
    expect(spent).toEqual([]);
  });
});
