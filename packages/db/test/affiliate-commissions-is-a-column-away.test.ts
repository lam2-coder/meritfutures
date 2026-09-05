// =============================================================================
// packages/db/test/affiliate-commissions-is-a-column-away.test.ts -- CI-02, `unit`.
// =============================================================================
// ADR-304 RULED IT, ADR-321 SPENT IT, AND THIS FILE MOVED WITH THE RULING. THE
// SIBLING OF `affiliate-commissions-unregistrable.test.ts` AND NOT ITS
// REPLACEMENT: that file asserts the SIX REFUSALS against `0012`'s column set,
// and this one asserts the measurements the RULING on top of them rested on and
// what the migration then did about them.
//
// ADR-253 ruled that no member of the closed six honestly fitted this table and
// left one question open: whether a SEVENTH class should exist for it. ADR-304
// answered no, and the answer was a claim about the DDL rather than about the
// vocabulary -- that three sibling tables on this rail carry one column that
// makes them registrable without a ruling, that `affiliate_commissions` was the
// only one that did not, and that the class ADR-253 sketched would key an
// affiliate's money to a column `0012` declares to be a snapshot.
// `0078_affiliate_commission_owner.sql` adds that column and the fourth table is
// registered on the third's rule.
//
// THE HEADER READ "AND ONE CASE IS WRITTEN TO GO RED ON SUCCESS", NAMING `the
// rail's shape`, AND THAT PREDICTION WAS HALF RIGHT IN A WAY WORTH KEEPING.
// `0012` is merged and constitution E2 makes its `CREATE TABLE` body permanent,
// so the column could only ever arrive as an `ADD COLUMN` from outside it -- and
// every parser in the file read `CREATE TABLE` bodies alone. The case that was
// supposed to go red on success DID NOT: it read `0012` and `0012` had not
// changed. THE ONE THAT WENT RED WAS `neither 0078 nor 0077 is written`, which
// was about the directory. Watched, at 1 failed of 17, before a line was moved.
//
// SO THE PARSERS FOLD NOW, AND BOTH READINGS ARE KEPT. `foldedColumnDefs` walks
// the migration set and replays every `ADD COLUMN`, which is ADR-094's rule that
// a table is read AS OF THE LAST MIGRATION; `columnDefs` still reads the CREATE
// body alone. The first case below asserts BOTH, because "the subject declares
// none" is a permanent and true fact about `0012` and "all four declare it" is
// the fact about the database, and a file that kept only one of them would have
// no way to say that `0012` was not edited.
//
// WHY THE DDL AND NOT `schema.ts`. It read: "The subject of every claim here is
// a table that is NOT in `schema.ts`, so there is no transcription to read and
// the migration is the only source." The first half stopped being true with
// ADR-321 and the reason survives it: the migration is the source and
// `schema.ts` is the transcription, so a claim about the schema read out of the
// transcription is a copy compared with itself. Where `schema.ts` and `scope.ts`
// are read below it is as the SUBJECT of a claim about registration, never as
// the source of a claim about the DDL.

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

/** The three tables that carried the column before `0078`, and the subject is the fourth. */
const SIBLINGS = ['affiliate_creatives', 'affiliate_clicks', 'affiliate_statements'] as const;

/** All four tables on the affiliate settlement rail, since `0078`. */
const RAIL = [...SIBLINGS, SUBJECT] as const;

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

/** Column name -> its whole definition, AS OF THE `CREATE TABLE`. Table constraints are not columns. */
function columnDefs(table: string): Map<string, string> {
  const defs = new Map<string, string>();
  for (const part of topLevelParts(createBody(table))) {
    if (/^(CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY|EXCLUDE|LIKE)\b/i.test(part)) continue;
    const name = part.split(/\s+/)[0] as string;
    defs.set(name, part);
  }
  return defs;
}

/**
 * Column name -> its whole definition, AS OF THE LAST MIGRATION. ADR-094's rule,
 * arriving in this file because ADR-321 is the first entry that needed it here.
 *
 * IT FOLDS `ADD COLUMN` AND NOTHING ELSE, WHICH IS NARROWER THAN
 * `scoped-db.test.ts`'s FOLD AND IS ENOUGH FOR EVERY CLAIM BELOW. That file
 * additionally applies `DROP NOT NULL`, a retype and a rename, and it REFUSES
 * every other shape rather than skipping it, which is the guarantee this reader
 * does not reproduce and does not need to: no claim here reads a nullability or
 * a type that any of those three statements moves, and the one column this file
 * is about is added and never altered. A second full fold would be two readers
 * of one fact, which is ADR-092 section 5's measured hazard.
 */
function foldedColumnDefs(table: string): Map<string, string> {
  const defs = columnDefs(table);
  for (const file of migrationFiles()) {
    const text = readFileSync(join(MIGRATIONS, file), 'utf8').replace(/--[^\n]*/g, '');
    for (const statement of text.match(/ALTER\s+TABLE\s+"?[a-z_]+"?[\s\S]*?;/gi) ?? []) {
      if (/ALTER\s+TABLE\s+"?([a-z_]+)"?/i.exec(statement)?.[1] !== table) continue;
      const body = statement.replace(/^\s*ALTER\s+TABLE\s+"?[a-z_]+"?/i, '').replace(/;\s*$/, '');
      for (const clause of topLevelParts(body)) {
        const name = /^ADD\s+COLUMN\s+"?([a-z_][a-z0-9_]*)"?/i.exec(clause)?.[1];
        if (name === undefined) continue;
        defs.set(
          name,
          clause
            .replace(/^ADD\s+COLUMN\s+/i, '')
            .replace(/\s+/g, ' ')
            .trim(),
        );
      }
    }
  }
  return defs;
}

/** `PRIMARY KEY` implies NOT NULL and the words are often absent. */
const declaredNotNull = (def: string): boolean =>
  /\bNOT NULL\b/i.test(def) || /\bPRIMARY KEY\b/i.test(def);

/** Every column of `table` whose definition references `parent`, read at the given fold. */
const edgesIn = (
  defs: Map<string, string>,
  parent: string,
): { column: string; notNull: boolean }[] =>
  [...defs.entries()]
    .filter(([, def]) => new RegExp(`REFERENCES\\s+${parent}\\s*\\(`, 'i').test(def))
    .map(([column, def]) => ({ column, notNull: declaredNotNull(def) }));

/** Every column of `table` reaching `parent`, AS OF THE LAST MIGRATION. */
const edgesTo = (table: string, parent: string): { column: string; notNull: boolean }[] =>
  edgesIn(foldedColumnDefs(table), parent);

/** Every column of `table` reaching `parent`, AS OF ITS `CREATE TABLE`. */
const createdEdgesTo = (table: string, parent: string): { column: string; notNull: boolean }[] =>
  edgesIn(columnDefs(table), parent);

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
 *
 * IT WALKS THE FOLD SINCE ADR-321, so an edge a superseding migration adds is
 * found. Read at the CREATE it would have missed `0078`'s column, which is the
 * blindness this file's own header records being caught.
 */
function childrenOf(isParent: (sqlName: string) => boolean): string[] {
  const out: string[] = [];
  for (const table of createdTables()) {
    for (const [column, def] of foldedColumnDefs(table)) {
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

describe('the rail carries one column and this table was the only one without it', () => {
  // THE WHOLE GROUND OF ADR-304 SECTION 4, IN ONE CASE, IN BOTH DIRECTIONS AND
  // AT BOTH FOLDS. The three siblings were registrable without a ruling BECAUSE
  // of this column and the subject was unregistrable in its ABSENCE; ADR-321
  // ends the absence and asserting only the new half would leave the old one
  // free to move.
  //
  // THE SECOND HALF IS WHAT SAYS `0012` WAS NOT EDITED. Constitution E2 makes a
  // merged migration's `CREATE TABLE` body permanent, so "the subject's CREATE
  // declares no edge to `affiliates`" is a fact that must stay true forever, and
  // a supersession that quietly rewrote `0012` instead of adding `0078` would
  // turn it red.
  test('all four declare `affiliate_id NOT NULL -> affiliates`, and the fourth declares it from outside its CREATE', () => {
    for (const table of RAIL) {
      expect(edgesTo(table, 'affiliates'), table).toEqual([
        { column: 'affiliate_id', notNull: true },
      ]);
    }
    for (const table of SIBLINGS) {
      expect(createdEdgesTo(table, 'affiliates'), table).toEqual([
        { column: 'affiliate_id', notNull: true },
      ]);
    }
    // `0012` IS UNTOUCHED, WHICH IS CONSTITUTION E2 AND IS THE HALF A REWRITE
    // WOULD BREAK.
    expect(createdEdgesTo(SUBJECT, 'affiliates')).toEqual([]);
  });

  // AND THE REGISTRY AGREES WITH THE DDL ON ALL FOUR, which is what made the
  // fourth table's registration a transcription rather than a judgement once the
  // column existed. ADR-304 section 4's own words about what the registration
  // then costs: nothing.
  test('all four are registered `derived` via `affiliates` on that column, as a `hop`', () => {
    for (const table of RAIL) {
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

  // THE STANDING CONDITION IS INHERITED AND THE RULE SAYS SO, which is ADR-304's
  // closing instruction to the row that registers this table. It is asserted
  // over the `why` because that is the only place a later session reading the
  // registry will meet it, and a condition recorded only in an ADR is a
  // condition the next reader of `scope.ts` never sees.
  test("the rule's own `why` carries ADR-253 section 6's standing condition", () => {
    const rule = SCOPE_RULES.affiliateCommissions;
    expect(rule.why).toMatch(/ADR-253 SECTION 6'S STANDING CONDITION/i);
    // It attaches to row-level readability by ANY route rather than to the class
    // that was refused, which is the whole reason a `derived` rule does not
    // discharge it.
    expect(rule.why).toMatch(/ROW-LEVEL READABILITY BY ANY ROUTE/i);
    expect(rule.why).toMatch(/resolves an `attributions` row from its id/i);
    // And the condition holds today for a reason the entry names: the one door
    // that resolves anything about an attribution returns a bit.
    expect(rule.why).toMatch(/attributionAffiliate/);
  });

  // NOTHING WRITES THE TABLE, WHICH IS WHAT MADE A `NOT NULL` COLUMN WITH NO
  // DEFAULT ADDABLE WITH NO BACKFILL (ADR-304 section 4 clause 3, re-derived by
  // ADR-321 rather than carried forward). The search is over source with
  // COMMENTS STRIPPED, because two shipped files discuss this table at length
  // and a census counting prose would find a writer in a sentence explaining
  // that there is none. The stripper is imported per ADR-279: this is an ABSENCE
  // assertion, and one over a file a weaker stripper emptied goes vacuously
  // green rather than red.
  //
  // THE PREDICATE NARROWED WITH ADR-321 AND THE NARROWING IS THE POINT. It used
  // to read "the identifier `affiliateCommissions` appears", which was a sound
  // proxy for a write only while the identifier did not exist: the table was
  // undeclared, so there was nothing for a reader to name either. It is declared
  // now, so the hunt is for the WRITE VERBS the keyed accessor takes -- which is
  // how every writer in this tree is spelled (`tx.insert('ledgerEntries', ...)`
  // in `packages/ledger/src/post.ts` is the shape) -- plus the raw SQL forms.
  // A proxy kept past the day its premise died is the failure this whole file is
  // about, one level down.
  test('no shipped source writes a row of this table', () => {
    const writers = shippedSources().filter((file) => {
      const src = stripComments(readFileSync(file, 'utf8'));
      return (
        /\b(?:insert|update|delete)\s*\(\s*(?:TABLES\s*\[\s*)?['"`]affiliateCommissions['"`]/.test(
          src,
        ) ||
        /\b(?:insert|update|delete)\s*\(\s*affiliateCommissions\b/.test(src) ||
        new RegExp(`(INSERT INTO|UPDATE|DELETE FROM)\\s+${SUBJECT}`, 'i').test(src)
      );
    });
    expect(writers).toEqual([]);
    // AND THE HUNT IS NOT BLIND, demonstrated on a table that IS written rather
    // than asserted to have teeth. `ledgerEntries` is written by
    // `packages/ledger/src/post.ts` through the same accessor, so the identical
    // predicate finds it, and a shape change that stopped matching would empty
    // this half rather than pass the half above in silence.
    const ledgerWriters = shippedSources().filter((file) =>
      /\b(?:insert|update|delete)\s*\(\s*(?:TABLES\s*\[\s*)?['"`]ledgerEntries['"`]/.test(
        stripComments(readFileSync(file, 'utf8')),
      ),
    );
    expect(ledgerWriters.length).toBeGreaterThan(0);
  });

  // AND THE DRIZZLE HANDLE EXISTS NOW, which is the assertion that inverted. It
  // read `expect(TABLE_KEYS).not.toContain('affiliateCommissions')` and its
  // reason was that the table is not in `schema.ts`, so there is no identifier
  // for a writer to reach for. There is one, and what keeps the case above
  // honest is the predicate rather than the absence of a name.
  test('the table is a `TableKey`, so a writer now has an identifier and still does not use it', () => {
    expect(TABLE_KEYS).toContain('affiliateCommissions' as (typeof TABLE_KEYS)[number]);
    expect(getTableName(TABLES.affiliateCommissions)).toBe(SUBJECT);
  });

  // WHAT SURVIVES THE STRIP IS THREE SITES AND NONE OF THEM IS A WRITE. Two are
  // strings a caller or a reader is SERVED and the third is the declaration
  // ADR-321 added; naming them is what keeps the case above from passing
  // because the subject is missing entirely.
  test('the name survives the strip at exactly three sites, and none is a write', () => {
    const sites = shippedSources().filter((file) =>
      new RegExp(SUBJECT).test(stripComments(readFileSync(file, 'utf8'))),
    );
    expect(sites.map((f) => f.slice(REPO.length + 1)).sort()).toEqual([
      'apps/api/src/routes/affiliate.ts',
      'packages/db/src/schema.ts',
      'packages/db/src/scope.ts',
    ]);
  });
});

describe('the parent carries two routes to the affiliate and one of them is frozen', () => {
  // ADR-304 SECTION 3.1. The seventh class would have named `affiliate_identity_id`,
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

describe('the seventh class would have been true of exactly one foreign key in this schema', () => {
  // THE CASE WITH TEETH. ADR-304 section 3.2. A class that derives through a
  // `pair` parent has one possible member on this tree, and a second child of
  // any `pair` relation would have weakened the argument that a column is the
  // cheaper repair. The set is asserted by NAME rather than counted, so the day
  // one lands it arrives in a diff with its own table attached.
  //
  // THE CLAIM SURVIVES ADR-321 AND IS NARROWER THAN IT LOOKS. `0078` adds a
  // SECOND edge from this table to `attributions` -- the composite
  // `(attribution_id, affiliate_id)` -- and it adds no column, so the edge count
  // read per COLUMN is unmoved. What the migration changes is that the table now
  // ALSO reaches `affiliates`, which is `owned`, and that is the whole repair:
  // the row's path to an identity no longer runs through a `pair` relation at
  // all.
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

  // AND THE WALK SEES A COLUMN A SUPERSEDING MIGRATION ADDED, which is the
  // blindness this file's header records being caught. Read at the `CREATE
  // TABLE` body alone the subject reaches `affiliates` nowhere, so every claim
  // above about what this table's edges are would be a claim about `0012` while
  // reading as a claim about the database.
  test('the walk reaches `0078`’s column, so the fold is not decorative', () => {
    expect(childrenOf((name) => name === 'affiliates')).toContain(
      `${SUBJECT}.affiliate_id -> affiliates`,
    );
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
    for (const table of ['affiliates', ...RAIL]) {
      const counters = [...foldedColumnDefs(table).keys()].filter((c) => /conversion/i.test(c));
      expect(counters, table).toEqual([]);
    }
  });

  // THE FIRST OBSTRUCTION IS DISCHARGED AND THE SECOND IS NOT, WHICH IS THE
  // WHOLE STATE CHANGE ADR-321 PRODUCES ON THIS ENDPOINT. Three of `stats`'
  // nine fields are sums over a table that now has a door; the fourth is still a
  // count over a relation no door reaches, so the method is nearer and is not
  // served, and a session reading only the first half would think it was.
  test('the three money figures now have a door and the fourth field still does not', () => {
    expect(SCOPE_RULES.affiliateCommissions.class).toBe('derived');
    expect(() => scopePredicate('affiliateCommissions', IDENTITY)).not.toThrow();
    expect(() => scopePredicate('attributions', IDENTITY)).toThrow(/belongs to TWO identities/);
  });

  // THE SECOND OBSTRUCTION, EXECUTED RATHER THAN ASSERTED ABOUT. `attributions`
  // is `pair`, so the scoped accessor refuses it at runtime and the type
  // refuses it at compile time. A count over it is therefore unavailable to
  // `stats` no matter what class `affiliate_commissions` was ever given.
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

describe('what `0078` owed, asserted against the file that spent it', () => {
  const zero78 = (): string =>
    readFileSync(join(MIGRATIONS, '0078_affiliate_commission_owner.sql'), 'utf8');

  // SECTION 4 CLAUSE 1. THE COLUMN, AND THE TWO PROPERTIES A LATER MIGRATION IS
  // MOST LIKELY TO SOFTEN. `NOT NULL` is what makes the first writer that omits
  // the column fail loudly, and NO `DEFAULT` is what stops that writer being
  // given a wrong affiliate instead. A default is the failure this is here to
  // catch, because it would turn every rejection into a silent wrong answer.
  test('the column is `NOT NULL` with no `DEFAULT`', () => {
    const def = foldedColumnDefs(SUBJECT).get('affiliate_id');
    expect(def).toBeDefined();
    expect(def ?? '').toMatch(/^affiliate_id uuid NOT NULL REFERENCES affiliates\(id\)/i);
    expect(def ?? '').not.toMatch(/\bDEFAULT\b/i);
  });

  // SECTION 4 CLAUSE 2. The composite edge that closes the drift needs a unique
  // key on the parent to name, and `attributions` did not declare one before
  // `0078`. Without both halves the denormalized column can disagree with its
  // parent and a commission is paid to the wrong affiliate.
  test('`attributions` declares `UNIQUE (id, affiliate_id)`, and `0012` does not', () => {
    // NOT in the CREATE body, which is `0012` untouched under constitution E2.
    expect(createBody('attributions')).not.toMatch(/UNIQUE\s*\(\s*id\s*,\s*affiliate_id\s*\)/i);
    // The primary key it does have, which is what makes the extra unique
    // redundant for uniqueness and necessary for reference.
    expect(columnDefs('attributions').get('id')).toMatch(/PRIMARY KEY/i);
    // And `0078` adds it, from outside the merged file.
    expect(zero78()).toMatch(
      /ALTER TABLE attributions\s+ADD CONSTRAINT attributions_id_affiliate_uq UNIQUE \(id, affiliate_id\);/,
    );
  });

  // AND THE COMPOSITE EDGE NAMES IT. This is the assertion with the money behind
  // it: without this constraint `0078` would put one fact on two rows with
  // nothing holding them together, which is the seventh class's strongest
  // remaining argument against a column.
  test('the composite foreign key names that pair, and the estate already held the idiom', () => {
    expect(zero78()).toMatch(
      /ADD CONSTRAINT affiliate_commissions_attribution_owner_fk\s+FOREIGN KEY \(attribution_id, affiliate_id\)\s+REFERENCES attributions \(id, affiliate_id\) ON DELETE RESTRICT;/,
    );
    // `0049`'s anchor is the composite foreign key `scope.ts` already argues
    // with by name, and it is what `0078` copied rather than invented.
    expect(RAW).toMatch(/reserve_coverage_snapshots_anchor_fk/);
  });

  // SECTION 4 CLAUSE 4. THE READ SHAPE. `0012` declares four indexes on this
  // table and none was keyed on an affiliate, because until the column existed
  // there was nothing to key on.
  test('the index the three per-affiliate sums read is keyed `(affiliate_id, status)`', () => {
    expect(zero78()).toMatch(
      /CREATE INDEX affiliate_commissions_affiliate_status_idx\s+ON affiliate_commissions \(affiliate_id, status\);/,
    );
    const zero12 = readFileSync(
      join(MIGRATIONS, '0012_disputes_and_affiliate_settlement.sql'),
      'utf8',
    );
    expect(zero12).not.toMatch(/CREATE INDEX[^;]*ON affiliate_commissions \(affiliate_id/);
  });

  // AND `0078` IS WRITTEN WHILE `0077` IS NOT. It read `neither 0078 nor 0077 is
  // written`, and that case is the one that went red when the migration landed.
  // `0077` is ADR-297's and is still reserved and unspent, so the half that is
  // still an absence is still asserted as one.
  test('`0078` is written and `0077` is still not', () => {
    expect(migrationFiles().filter((f) => /^0078_/.test(f))).toEqual([
      '0078_affiliate_commission_owner.sql',
    ]);
    expect(migrationFiles().filter((f) => /^0077_/.test(f))).toEqual([]);
  });
});
