// =============================================================================
// apps/api/test/affiliate-issued-link.test.ts -- CI-02, the `unit` project.
// =============================================================================
// ADR-253 SECTION 3, EXECUTED. AN ISSUED LINK IS NOT A ROW, AND THE REASON IS
// ARITHMETIC OVER A UNIQUE INDEX RATHER THAN A PREFERENCE ABOUT MODELLING.
//
// `useAffiliateDeps`' second obstruction reads "no table records an ISSUED
// link", and row `253` ruled that this is a CONTRACT question before it is a
// migration: rule where an issued link lives and what issuing one means before
// building anywhere to put it. This file is that ruling's evidence.
//
// THE SHAPE OF THE ARGUMENT. `CreateLinkResponse` is `{ url, click_token }` and
// `CheckoutRequest` carries `affiliate_click_token`, which `checkout.ts`
// resolves with `tx.clickByToken`. So the token a BUYER presents names an
// `affiliate_clicks` row. `affiliate_clicks_token_uq` makes that naming
// single-valued, which `resolveAttribution`'s own docblock leans on in so many
// words. ONE ISSUED LINK IS CLICKED MANY TIMES. A column that is UNIQUE cannot
// hold one value across many rows, so the handle an affiliate is issued and the
// token a buyer presents are NOT the same object and cannot be the same column.
//
// WHAT FOLLOWS FROM THAT is that `POST /affiliate/links` is refused a write to
// `affiliate_clicks` TWICE. The module header already refuses it once, on
// `clicks_30d`: a row written at issue time is a click nobody made, in the
// denominator AS-M8-03's cookie-stuffing arithmetic is read from. The second
// refusal is independent of how clicks are counted and survives any change to
// that count, which is why it is worth writing down beside the first.
//
// AND WHAT DOES NOT FOLLOW is that a new table is owed. Every attribute an
// issued link would carry is ALREADY on `affiliate_clicks`, at CLICK grain,
// which is the grain `0005` chose; `affiliates.code` is already a unique public
// handle for the affiliate a URL must name; and nothing in this repository
// ingests a click at all, so a link table's only reader would be absent. The
// cases below measure each of those three.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { productionAffiliateDeps } from '../src/routes/affiliate.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', '..', '..', 'packages', 'db', 'migrations');
const SCHEMA_TS = join(HERE, '..', '..', '..', 'packages', 'db', 'src', 'schema.ts');
const SCOPE_TS = join(HERE, '..', '..', '..', 'packages', 'db', 'src', 'scope.ts');
const API_SRC = join(HERE, '..', 'src');

const migrationSql = (): string =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');

const SQL = migrationSql();

/** The body of a `CREATE TABLE`, brackets balanced, comments stripped. */
function createBody(table: string): string {
  const text = SQL.replace(/--[^\n]*/g, '');
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

/** Every `.ts` file under a directory, recursively. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/** Source with line and block comments removed, so a comment is not evidence. */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '');

describe('a click token is per CLICK, and the index is what says so', () => {
  test('`click_token` is NOT NULL, defaulted per row, and UNIQUE', () => {
    const body = createBody('affiliate_clicks');
    expect(body).toMatch(/click_token\s+uuid\s+NOT NULL\s+DEFAULT\s+gen_random_uuid\(\)/i);
    // The uniqueness is an INDEX rather than a column constraint on this table,
    // so it is read where it is declared.
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX affiliate_clicks_token_uq\s+ON affiliate_clicks \(click_token\)/i,
    );
  });

  // THE CONSUMER DEPENDS ON THE SINGLE-VALUEDNESS AND SAYS SO. This is not an
  // inference about what the index is for: `resolveAttribution` names the index
  // in its own docblock as the reason it does not sort.
  test('the attribution fold names that index as the reason a token is single-valued', () => {
    const fold = readFileSync(
      join(HERE, '..', '..', '..', 'packages', 'affiliate', 'src', 'attribution.ts'),
      'utf8',
    );
    expect(fold).toContain('affiliate_clicks_token_uq');
    expect(fold).toMatch(/makes a token name exactly one row/i);
  });

  // THE ARITHMETIC, AND IT IS THE WHOLE RULING. A UNIQUE column holds a value
  // at most once. An issued link is clicked more than once, or it is not a
  // link. So the handle in the URL and the token in the index are two objects.
  test('so an issued handle and a click token cannot be one column', () => {
    // Nothing on the click row makes a click the FIRST click of anything: there
    // is no per-link discriminator, so `affiliate_clicks` cannot express "many
    // clicks of one link" while `click_token` is the only token it carries.
    const columns = createBody('affiliate_clicks')
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[0] as string)
      .filter((name) => /^[a-z_]+$/.test(name));
    expect(columns).toContain('click_token');
    expect(columns).not.toContain('link_id');
    expect(columns).not.toContain('link_token');
  });

  // AND ATTRIBUTION REACHES A CLICK RATHER THAN A LINK, which is where the two
  // objects would have to meet if the schema held both.
  test('`attributions.click_id` reaches `affiliate_clicks(id)` and nothing reaches a link', () => {
    expect(createBody('attributions')).toMatch(
      /click_id\s+bigint\s+NULL\s+REFERENCES affiliate_clicks\(id\)/i,
    );
    expect(/CREATE TABLE affiliate_links\b/i.test(SQL)).toBe(false);
  });
});

describe('the schema put every attribute of a link on the click, which is the grain it chose', () => {
  // A LINK OBJECT WOULD CARRY THE AFFILIATE AND THE LANDING PATH. Both are
  // already here, per click. If links were rows, `landing_path` would live on
  // the link and the click would reference it; `0005` did the opposite.
  test('`affiliate_clicks` carries the affiliate and the landing path itself', () => {
    const body = createBody('affiliate_clicks');
    expect(body).toMatch(/affiliate_id\s+uuid\s+NOT NULL\s+REFERENCES affiliates\(id\)/i);
    expect(body).toMatch(/landing_path\s+text\s+NULL/i);
  });

  // THE AFFILIATE ALREADY HAS A UNIQUE PUBLIC HANDLE, so a URL has something to
  // name without a new row existing to be named.
  test('`affiliates.code` is a unique handle already', () => {
    expect(createBody('affiliates')).toMatch(/code\s+citext\s+NOT NULL\s+UNIQUE/i);
  });

  // FINDING 3 OF THE MODULE HEADER, EXECUTED RATHER THAN QUOTED. `campaign` is
  // validated and passed to the port and reaches no column, and the only
  // occurrences of the word in the migration set are prose.
  test('no migration declares a `campaign` column, and the three hits are prose', () => {
    const withoutComments = SQL.replace(/--[^\n]*/g, '');
    expect(/\bcampaign\b/i.test(withoutComments)).toBe(false);
    const hits = SQL.split('\n').filter((line) => /\bcampaign\b/i.test(line));
    expect(hits).toHaveLength(3);
    for (const hit of hits) expect(hit.trim().startsWith('--')).toBe(true);
  });
});

describe('and a link table would have no reader, which is why none is taken here', () => {
  // NOTHING IN THIS DEPLOYABLE INGESTS A CLICK. The token a buyer presents is
  // READ at checkout and is written by nobody, so the handler that would
  // resolve a link handle into a click row does not exist. A table whose only
  // reader is absent is the primitive-before-a-caller ADR-120 clause 3 refuses.
  //
  // THE SEARCH IS OVER SOURCE WITH COMMENTS STRIPPED, because this module's own
  // header discusses `affiliate_clicks` at length and a census that counted
  // prose would find the writer it was looking for in a sentence explaining why
  // there is none.
  test('no route writes an `affiliate_clicks` row', () => {
    const writers = walk(API_SRC).filter((file) => {
      const src = stripComments(readFileSync(file, 'utf8'));
      return /affiliateClicks\b/.test(src) || /INSERT INTO affiliate_clicks/i.test(src);
    });
    expect(writers).toEqual([]);
  });

  // WHAT DOES EXIST IS THE READ, and naming it here is what keeps the case
  // above from passing because the whole subject is missing.
  test('checkout READS a click by token, so the consumer is real and the producer is not', () => {
    const checkout = stripComments(readFileSync(join(API_SRC, 'routes', 'checkout.ts'), 'utf8'));
    expect(checkout).toMatch(/clickByToken/);
  });
});

describe('the retired sentence is gone from the place a caller meets it', () => {
  // THE REPAIR ROW `253` GRANTED, ANCHORED TO THE FACT RATHER THAN TO A STRING.
  // `affiliate_statements` IS in `schema.ts` and IS registered, so a refusal
  // saying otherwise is false about this tree, and asserting the fact is what
  // keeps this case honest if the sentence is reworded again.
  test('`affiliate_statements` is declared and registered', () => {
    expect(/export const affiliateStatements\b/.test(readFileSync(SCHEMA_TS, 'utf8'))).toBe(true);
    expect(/^ {2}affiliateStatements: \{$/m.test(readFileSync(SCOPE_TS, 'utf8'))).toBe(true);
  });

  // THE ASSERTION IS OVER WHAT A CALLER IS SERVED AND NOT OVER THE FILE, and
  // the difference is deliberate. The repair leaves a docblock QUOTING the
  // retired sentence so a later reader can see what was corrected, which is
  // RI-14's rule; an assertion over the source text would forbid that idiom and
  // would be satisfied by deleting the record instead of the defect. What must
  // not survive is the sentence reaching a CALLER, so the messages are what is
  // read, and every method is read rather than the one the row named.
  test('no method serves the retired sentence to a caller', async () => {
    const backend = productionAffiliateDeps.backend;
    const session = { identityId: 'i-1' } as never;
    const ref = { affiliateId: 'a-1' } as never;
    const calls: Promise<unknown>[] = [
      // `affiliate` takes the session alone: the caller's own affiliate row is
      // what it resolves, so there is no ref to hand it.
      backend.affiliate(session),
      backend.stats(session, ref),
      backend.statements(session, ref, { limit: 20, cursor: null } as never),
      backend.issueLink(session, ref, { landing_path: '/plans' }),
      backend.requiredDisclosure(session, ref),
      backend.submitCreative(session, ref, { kind: 'landing', url_or_ref: '/x' } as never),
    ];

    const messages: string[] = [];
    for (const call of calls) {
      try {
        await call;
        messages.push('');
      } catch (error) {
        messages.push((error as Error).message);
      }
    }
    expect(messages).toHaveLength(6);
    for (const message of messages) {
      expect(message).not.toContain('`affiliate_statements` is not in');
      expect(message).not.toContain('is absent one step earlier');
    }
  });

  // THE REFUSAL STILL NAMES THE TABLE, which is what `affiliate.test.ts`'s own
  // assertion reads, so the repair narrows the sentence rather than emptying
  // it, and it now names the door that exists instead of one that does not.
  test('the `statements` refusal names the table and the class that makes it readable', async () => {
    let message = '';
    try {
      await productionAffiliateDeps.backend.statements(
        { identityId: 'i-1' } as never,
        { affiliateId: 'a-1' } as never,
        { limit: 20, cursor: null } as never,
      );
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('affiliate_statements');
    expect(message).toContain('derived');
    expect(message).toContain('affiliates');
  });
});
