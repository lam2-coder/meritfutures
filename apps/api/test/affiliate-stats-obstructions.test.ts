// =============================================================================
// apps/api/test/affiliate-stats-obstructions.test.ts -- CI-02, `unit`.
// =============================================================================
// ADR-304 SECTION 8, EXECUTED, THEN ADR-324 REWRITTEN. THE REFUSAL
// `GET /affiliate/stats` SERVES WAS WRONG IN TWO PLACES AND A REFUSAL IS THE ONE
// PLACE A LATER SESSION READS TO FIND OUT WHAT TO BUILD.
//
// It told that session the table is `a seventh class away`, which ADR-304 rules
// it is not, and it named ONE obstruction where the method has two. The first
// error sends a session to `packages/db` to write a scope class; the second
// lets it think the endpoint is served once that class exists. Both are the
// shape ADR-253 section 5 repaired for `affiliate_statements` one method over.
//
// AND THEN THE SAME DEFECT HAPPENED AGAIN AT THIS FILE'S EXPENSE, WHICH IS WHY
// THE CASES BELOW LOOK DIFFERENT NOW. `0078_affiliate_commission_owner.sql`
// landed (ADR-321, on ADR-304), and FOUR clauses of the `stats` refusal became
// false the moment it did: the table was no longer UNREGISTERED, no longer
// undeclared, no longer one COLUMN away, and `0078` was no longer NOT WRITTEN.
// NOTHING IN THIS FILE WENT RED. The cases matched `/UNREGISTERED/`,
// `/one COLUMN away/` and `/NOT WRITTEN/` -- the WORDS -- and the words were
// still there. A test that pins prose goes stale in silence; a test that
// derives goes red.
//
// SO THE EXPECTATIONS ARE COMPUTED FROM THE TREE. `scope.ts` says which class
// this table is registered under, `schema.ts` says whether the owner column is
// declared, the migration directory says which file added it, and `scoped-db.ts`
// says whether the counting door exists yet. Each case reads one of those and
// then requires the SERVED MESSAGE to agree with it, in BOTH directions: if the
// tree says registered the message may not say UNREGISTERED, and if the tree
// says unregistered the message must. A migration, a revert or a superseding
// registration all turn a case red rather than leaving a sentence quietly false.
//
// THE ASSERTION IS STILL OVER WHAT A CALLER IS SERVED AND NOT OVER THE FILE,
// which is ADR-253 section 5's choice and its reason: an assertion over source
// text would forbid the docblock that QUOTES what was corrected, and could be
// satisfied by deleting the record instead of the defect. So every method of the
// shipped default is CALLED and its message read. What the tree supplies is the
// EXPECTATION, never the subject. A seventh site of a retired sentence fails
// this file rather than hiding behind the one that was repaired.
//
// AND THE FACTS THEMSELVES ARE STILL ASSERTED SEPARATELY, in
// `packages/db/test/affiliate-commissions-is-a-column-away.test.ts`, which reads
// the migrations and now asserts what `0078` did rather than that it was absent.
// Nothing here claims a scope class or a column is CORRECT; this file asserts
// only that what the port TELLS a caller matches what is there.
//
// WHAT COULD NOT BE DERIVED, AND WHY IT STAYS TEXTUAL. Three clauses of the
// message are RULINGS rather than facts: that `firm` is FALSE because a
// commission is what Merit owes a named affiliate, that ADR-106's exclusion is
// about what a ROW read returns, and that a NAMED DOOR is the right construction
// for a count. Nothing in this tree computes any of them, and each moves by an
// ADR rather than by a file edit, so each is pinned as text and named here as
// such. ADR-324 section 4.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  AffiliateBackendUnwired,
  UNWIRED_AFFILIATE_BACKEND,
  type AffiliateBackend,
} from '../src/routes/affiliate.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const MIGRATIONS = join(ROOT, 'packages/db/migrations');
const SCOPE = readFileSync(join(ROOT, 'packages/db/src/scope.ts'), 'utf8');
const SCHEMA = readFileSync(join(ROOT, 'packages/db/src/schema.ts'), 'utf8');
const SCOPED_DB = readFileSync(join(ROOT, 'packages/db/src/scoped-db.ts'), 'utf8');

/** One registry rule, read off `scope.ts` rather than imported. */
interface Rule {
  readonly class: string;
  readonly via: string | null;
  readonly localColumn: string | null;
}

/**
 * The rule `packages/db/src/scope.ts` declares for a table, or null if it
 * declares none. Read as TEXT and not through the module, on this file's own
 * rule: the subject is what a caller is told, and the expectation has to come
 * from somewhere a `stats` adapter would have to change too.
 */
function ruleOf(key: string): Rule | null {
  const start = SCOPE.indexOf(`\n  ${key}: {\n`);
  if (start === -1) return null;
  const end = SCOPE.indexOf('\n  },\n', start);
  const block = SCOPE.slice(start, end === -1 ? SCOPE.length : end);
  const cls = /^ {4}class: '([a-z]+)',$/m.exec(block)?.[1];
  if (!cls) return null;
  return {
    class: cls,
    via: /^ {4}via: '([A-Za-z_]+)',$/m.exec(block)?.[1] ?? null,
    localColumn: /^ {4}localColumn: '([a-z_]+)',$/m.exec(block)?.[1] ?? null,
  };
}

/** The `pgTable` body `schema.ts` declares for a table, or the empty string. */
function schemaBody(constName: string, table: string): string {
  const start = SCHEMA.indexOf(`export const ${constName} = pgTable('${table}', {`);
  if (start === -1) return '';
  const end = SCHEMA.indexOf('\n});', start);
  return SCHEMA.slice(start, end === -1 ? SCHEMA.length : end);
}

const COMMISSIONS_RULE = ruleOf('affiliateCommissions');
const ATTRIBUTIONS_RULE = ruleOf('attributions');
const COMMISSIONS_BODY = schemaBody('affiliateCommissions', 'affiliate_commissions');
const SCHEMA_DECLARES_OWNER = /affiliateId: uuid\('affiliate_id'\)/.test(COMMISSIONS_BODY);

/**
 * Every migration that adds `affiliate_id` to `affiliate_commissions`, by name.
 * `0012` created the table without it and constitution E2 makes that body
 * permanent, so the column can only ever arrive from outside it and this is the
 * only place the answer lives.
 */
const OWNER_MIGRATIONS = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith('.sql'))
  .filter((file) => {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    return /ALTER TABLE affiliate_commissions\s+ADD COLUMN affiliate_id /.test(sql);
  })
  .sort();

/** The four-digit number of the migration that spent it, or null. */
const OWNER_MIGRATION = OWNER_MIGRATIONS[0] ?? null;
const OWNER_MIGRATION_NUMBER = OWNER_MIGRATION === null ? null : OWNER_MIGRATION.slice(0, 4);

/** The column as the DDL actually spells it, without the `ON DELETE` tail. */
const OWNER_COLUMN_DDL =
  OWNER_MIGRATION === null
    ? null
    : (/ADD COLUMN (affiliate_id [^;]*?)(?: ON DELETE [A-Z]+)?;/.exec(
        readFileSync(join(MIGRATIONS, OWNER_MIGRATION), 'utf8'),
      )?.[1] ?? null);

/**
 * The members `ScopedTx` declares, which is what a NAMED DOOR is: the interface
 * body only, so a comment mentioning a word is not mistaken for a door.
 */
const SCOPED_TX_MEMBERS = (() => {
  const start = SCOPED_DB.indexOf('export interface ScopedTx extends TxCommon {');
  const body = start === -1 ? '' : SCOPED_DB.slice(start, SCOPED_DB.indexOf('\n}', start));
  return [...body.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*)\(/gm)]
    .map((m) => m[1])
    .filter((name): name is string => name !== undefined);
})();

/**
 * Whether a counting door for `conversions_30d` exists on the scoped handle.
 * The message says one does not and that it is what this method waits on, so
 * the day somebody builds it this file fails and the refusal gets rewritten
 * rather than outliving its own remaining obstruction the way it outlived the
 * first one.
 */
const CONVERSION_DOOR_BUILT = SCOPED_TX_MEMBERS.some((name) => /conversion/i.test(name));

/** Every method of the port, called, with the message it refuses with. */
async function refusals(): Promise<Map<keyof AffiliateBackend, string>> {
  const out = new Map<keyof AffiliateBackend, string>();
  const methods = Object.keys(UNWIRED_AFFILIATE_BACKEND) as (keyof AffiliateBackend)[];
  for (const method of methods) {
    // The default rejects on every method and takes no useful argument, so the
    // call is made with none and the rejection is the whole of what is read.
    const called = (UNWIRED_AFFILIATE_BACKEND[method] as () => Promise<never>)();
    await expect(called).rejects.toBeInstanceOf(AffiliateBackendUnwired);
    out.set(
      method,
      await called.then(
        () => '',
        (error: unknown) => (error as Error).message,
      ),
    );
  }
  return out;
}

describe('every method refuses, and the six are the contract of this port', () => {
  test('all six methods reject with `AffiliateBackendUnwired`', async () => {
    const served = await refusals();
    expect([...served.keys()].sort()).toEqual([
      'affiliate',
      'issueLink',
      'requiredDisclosure',
      'statements',
      'stats',
      'submitCreative',
    ]);
    for (const [method, message] of served) {
      expect(message, method).toMatch(new RegExp(`AffiliateBackend\\.${method} is not wired`));
    }
  });
});

describe('the readers of this file read the tree, so a stale expectation is a red case', () => {
  // NON-VACUITY FOR EVERY DERIVATION ABOVE, IN ONE PLACE. A parser that silently
  // matched nothing would make half the cases below pass by accident, which is
  // the failure mode this file was rewritten to remove and not one to reproduce
  // one layer down.
  test('the registry parser reads a class, and reads nothing for a name the registry has not got', () => {
    expect(ruleOf('affiliates')?.class).toBe('owned');
    expect(ruleOf('thisIsNotATableAnybodyRegisters')).toBeNull();
  });

  test('the schema parser finds the table body and a column inside it', () => {
    expect(COMMISSIONS_BODY).toContain("pgTable('affiliate_commissions'");
    expect(COMMISSIONS_BODY).toContain("amountCents: bigint('amount_cents'");
    expect(schemaBody('nothing', 'nothing')).toBe('');
  });

  test('the migration directory is read and it holds the set this file reasons over', () => {
    expect(readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql')).length).toBeGreaterThan(
      50,
    );
  });

  test('`ScopedTx` is read as an interface body, so a door is a member and not a word', () => {
    expect(SCOPED_TX_MEMBERS).toContain('effectiveAccountCap');
    // The word appears in this file twice, both times in prose about type
    // conversion, and neither is a door. A search over the whole file would
    // have called the counting door built.
    expect(SCOPED_DB).toMatch(/conversion/i);
  });
});

describe('the retired sentence is gone from every message a caller can reach', () => {
  // THE FIRST ERROR. The claim that the table is a seventh scope class away is
  // ADR-304's subject and its ruling is the opposite, so no message may still
  // carry it. Asserted over ALL SIX rather than over `stats`, because the site
  // that mattered last time was the one nobody had looked at.
  test('no served message says the table is a class away', async () => {
    for (const [method, message] of await refusals()) {
      expect(message, method).not.toMatch(/seventh class away/i);
      expect(message, method).not.toMatch(/declines to write one/i);
    }
  });

  // AND THE SENTENCE ADR-253 RETIRED IS STILL GONE, asserted here as well as in
  // its own file, because this file calls all six and that one calls all six
  // for a different claim. A message acquiring it again fails both.
  test('no served message says `affiliate_statements` is absent from the schema', async () => {
    for (const [method, message] of await refusals()) {
      expect(message, method).not.toMatch(/not in `?packages\/db\/src\/schema\.ts`? at all/i);
    }
  });

  // THE SECOND ERROR, AND THE ONE THIS FILE MISSED. The four clauses `0078`
  // retired are not listed here as literals a reader chose; they are ASSEMBLED
  // FROM THE TREE, so the list is empty on a tree where they are still true and
  // the case is vacuous by construction rather than by oversight. On a tree
  // where they are false it covers all six messages, which is where the sixth
  // site hides.
  test('no served message carries a clause the tree has retired', async () => {
    const retired: RegExp[] = [];
    if (COMMISSIONS_RULE) retired.push(/UNREGISTERED in `packages\/db\/src\/scope\.ts`/);
    if (SCHEMA_DECLARES_OWNER) retired.push(/undeclared in `packages\/db\/src\/schema\.ts`/);
    if (OWNER_MIGRATION_NUMBER) {
      retired.push(/is one COLUMN away/, /is RESERVED for it/, /is NOT WRITTEN/);
    }

    // Non-vacuity, and it is the whole point: on this tree the column landed, so
    // there ARE retired clauses and this case has work to do.
    expect(retired.length).toBeGreaterThan(0);

    for (const [method, message] of await refusals())
      for (const clause of retired)
        expect(message, `${method} / ${clause.source}`).not.toMatch(clause);
  });
});

describe('the `stats` refusal agrees with the tree about the commissions obstruction', () => {
  // WHAT THIS CASE USED TO BE: four `toMatch` calls over `/UNREGISTERED/`,
  // `/one COLUMN away/`, `/0078/` and `/NOT WRITTEN/`. All four were still
  // matching on the day all four claims became false. The expectation is
  // computed now and the direction is asserted both ways.
  test('what it says about `scope.ts` is what `scope.ts` says', async () => {
    const message = (await refusals()).get('stats') as string;
    expect(message).toMatch(/affiliate_commissions/);

    if (COMMISSIONS_RULE === null) {
      expect(message).toMatch(/UNREGISTERED in `packages\/db\/src\/scope\.ts`/);
      return;
    }

    expect(message).toMatch(
      new RegExp(`REGISTERED \`${COMMISSIONS_RULE.class}\`[^.]*\`packages/db/src/scope\\.ts\``),
    );
    if (COMMISSIONS_RULE.via) expect(message).toContain(`via \`${COMMISSIONS_RULE.via}\``);
    if (COMMISSIONS_RULE.localColumn)
      expect(message).toContain(`on \`${COMMISSIONS_RULE.localColumn}\``);
  });

  test('what it says about `schema.ts` is what `schema.ts` says', async () => {
    const message = (await refusals()).get('stats') as string;

    if (!SCHEMA_DECLARES_OWNER) {
      expect(message).toMatch(/undeclared in `packages\/db\/src\/schema\.ts`/);
      return;
    }

    expect(message).toMatch(/DECLARED in `packages\/db\/src\/schema\.ts`/);
  });

  test('what it says about the migration is what the migration directory says', async () => {
    const message = (await refusals()).get('stats') as string;

    if (OWNER_MIGRATION_NUMBER === null) {
      expect(message).toMatch(/is NOT WRITTEN/);
      return;
    }

    // The NUMBER is derived rather than written here, so a superseding file or a
    // renumber fails this case instead of leaving the refusal naming a migration
    // that no longer owns the column.
    expect(message).toContain(`\`${OWNER_MIGRATION_NUMBER}\``);
    expect(message).toMatch(new RegExp(`\`${OWNER_MIGRATION_NUMBER}\`, which is WRITTEN`));
    expect(message).not.toMatch(/is NOT WRITTEN/);
  });

  test('the column it quotes is the column the DDL declares, character for character', async () => {
    const message = (await refusals()).get('stats') as string;
    expect(OWNER_COLUMN_DDL).not.toBeNull();
    expect(message).toContain(OWNER_COLUMN_DDL as string);
  });

  // AND IT STILL SAYS `firm` IS FALSE, which is the sentence ADR-253 put here,
  // which ADR-304 kept and which this entry deliberately does not re-argue. IT
  // IS TEXTUAL ON PURPOSE: the registry says the answer is `derived`, and no
  // file in this tree says WHY `firm` would have been wrong. A repair that
  // dropped it would leave the available mistake unnamed at the only site a
  // session reaching for it would read.
  test('it still says `firm` is available, passes every check, and is false', async () => {
    const message = (await refusals()).get('stats') as string;
    expect(message).toMatch(/`firm` is available/);
    expect(message).toMatch(/is FALSE/);
    expect(message).toMatch(/what Merit owes a named affiliate/);
    // Derived half: `firm` is a class this registry really has, so the mistake
    // the sentence warns about is available rather than hypothetical.
    expect(SCOPE).toMatch(/^ {4}class: 'firm',$/m);
  });
});

describe('the `stats` refusal keeps the obstruction `0078` did not touch', () => {
  // THE OBSTRUCTION THAT SURVIVES, AND THE REASON THIS METHOD IS STILL UNWIRED.
  // A message naming only `affiliate_commissions` told a session the endpoint is
  // served once that table is registered. It is registered now and the endpoint
  // is not served, which is exactly what that error would have cost.
  test('it names the class `attributions` is actually registered under', async () => {
    const message = (await refusals()).get('stats') as string;
    expect(ATTRIBUTIONS_RULE).not.toBeNull();
    expect(message).toMatch(/conversions_30d/);
    expect(message).toMatch(/attributions/);
    expect(message).toContain(`scope class \`${(ATTRIBUTIONS_RULE as Rule).class}\``);
  });

  test('it says no class reaches it, and says so only while that is what the registry does', async () => {
    const message = (await refusals()).get('stats') as string;

    if ((ATTRIBUTIONS_RULE as Rule).class !== 'pair') {
      // The exclusion is a property of `pair`. If the class moved, this message
      // is making a claim the registry no longer supports and must be rewritten.
      expect(message).not.toMatch(/NO scope class fixes that/);
      return;
    }

    expect(message).toMatch(/ScopedTableKey/);
    expect(message).toMatch(/FirmTableKey/);
    expect(message).toMatch(/NO scope class fixes that/);
    // Derived: the two keys really do exclude this class, so the sentence is
    // describing the registry rather than restating itself.
    expect(SCOPE).toMatch(/ScopedTableKey = Exclude<TableKey, FirmTableKey \| PairTableKey>/);
  });

  test('it waits on a counting door for exactly as long as no counting door exists', async () => {
    const message = (await refusals()).get('stats') as string;

    if (CONVERSION_DOOR_BUILT) {
      // Somebody built it. The refusal is then wrong in the same way it was
      // wrong about `0078`, and this is the case that says so on the day it
      // happens rather than a wave later.
      expect(message).not.toMatch(/waited on a migration, a registration, a counting door/);
      return;
    }

    expect(message).toMatch(/NAMED DOOR/);
    expect(message).toMatch(/counting door and then the adapter/);
  });

  test('every ADR the refusal cites as precedent exists', async () => {
    const message = (await refusals()).get('stats') as string;
    const cited = [...new Set(message.match(/ADR-\d{3}/g) ?? [])].sort();
    expect(cited.length).toBeGreaterThan(0);
    const present = readdirSync(join(ROOT, 'docs/decisions'));
    expect(cited.filter((adr) => !present.includes(`${adr}.md`))).toStrictEqual([]);
  });
});

describe('the other five messages are unchanged in what they say a caller must build', () => {
  // THE REPAIR IS BOUNDED, ASSERTED RATHER THAN INTENDED. Four methods wait on
  // an adapter and one waits on an adapter and a base URL, and neither ADR-304
  // nor ADR-324 moves any of them. A message drifting into naming DDL would
  // send a session to `packages/db` for work that is not owed.
  test('four methods say a door exists and an adapter does not', async () => {
    const served = await refusals();
    for (const method of ['affiliate', 'requiredDisclosure', 'submitCreative', 'statements']) {
      const message = served.get(method as keyof AffiliateBackend) as string;
      expect(message, method).toMatch(/has a door and no adapter has been written for it yet/);
    }
  });

  test('`issueLink` still waits on an adapter and a base URL rather than on DDL', async () => {
    const message = (await refusals()).get('issueLink') as string;
    expect(message).toMatch(/ADAPTER AND A BASE URL rather than DDL/);
    expect(message).toMatch(/ADR-253 rules that none is owed/);
  });
});
