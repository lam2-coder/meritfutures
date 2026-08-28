import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { renderToStaticMarkup } from 'react-dom/server';

import type { AdminAccountSearchItem } from '../src/api/types.ts';
import AccountSearchRoute, { dynamic, readQueryTerm } from '../src/app/search/page.tsx';
import {
  AccountSearchDocument,
  type AccountSearchPage,
  NO_NAME_TERM,
  RESULT_ORDER,
  SEARCH_TERMS,
  WITHHELD_FIGURES,
  assertAccessWasRecorded,
  assertQueryNamesASubject,
  assertServedAccountSearchStrings,
  reachableSubjectIds,
  renderAccountSearchDocument,
  servedAccountSearchStrings,
} from '../src/app/search/account-search.tsx';
import { PageError, assertNamesNoSubject } from '../src/page.ts';

// =============================================================================
// THE ACCOUNT SEARCH, ASSERTED OVER THE BYTES AN OPERATOR RECEIVES
// =============================================================================
// WAVE-06 rule 4: "AN ASSERTION THAT CANNOT REACH THE SERVED BYTES IS NOT AN
// ASSERTION." Every case below reads the markup, the walk that ships, or the
// module's own source, and none of them reads an intermediate nobody serves.
//
// THE MARKUP RENDER LIVES HERE AND NOT IN THE SOURCE, which is `test/render.
// test.ts`'s finding inherited rather than re-learned: `next build` refuses
// `react-dom/server` inside a Server Component's import graph, so the control
// that ships walks the element tree and this suite, which is in no route graph,
// renders the real markup and binds the two.
//
// THE COMPONENT IS CALLED RATHER THAN WRITTEN AS AN ELEMENT because this file
// is `.ts`, which is `test/flags-render.test.ts`'s reason for the same shape.
//
// -----------------------------------------------------------------------------
// THE FIXTURE IS THE SCREEN'S OWN ARGUMENT, WRITTEN AS DATA
// -----------------------------------------------------------------------------
// THE TERM IS A COUPON AND THE ANSWER FANS OUT ACROSS TWO HUMANS, because that
// is the case `FM-M6-10` looks most like and is nonetheless ruled inside the
// licence: `ADR-194` clause 3 admits a coupon precisely because many accounts
// share one, and M06 section 7.10 rules that naming a signal and listing what
// shares it IS a specific-subject query. A fixture whose term returned one row
// would exercise none of that and would let the closure below pass while
// admitting only the trivial case.
//
// THE SECOND IDENTITY HOLDS TWO ACCOUNTS, so the page carries three rows over
// two humans and the row count and the human count differ. A closure that
// happened to key on the wrong one is caught by them disagreeing.
// =============================================================================

const RENDERED_AT = '2026-08-28T14:00:00.000Z';

const IDENTITY_A = 'a1d2c3b4-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const IDENTITY_B = 'b2e3d4c5-6f70-4b8c-9dae-1f2a3b4c5d6e';
const ACCOUNT_A = '3f7c1a52-0d64-4b19-9a2e-5c81d0f4b731';
const ACCOUNT_B = '4a8d2b63-1e75-4c20-8b3f-6d92e1a5c842';
const ACCOUNT_C = '5b9e3c74-2f86-4d31-9c40-7ea3f2b6d953';

/** An identity nothing on this page reaches. The closure's whole subject. */
const STRANGER = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';

const ROW_A: AdminAccountSearchItem = {
  account_id: ACCOUNT_A,
  identity_id: IDENTITY_A,
  email: 'alice@example.com',
  plan_code: 'CORE-25K',
  size_cents: 2_500_000,
  phase: 'funded',
  status: 'active',
  balance_cents: 2_610_000,
  withdrawable_cents: 60_000,
  open_flags: 2,
  payouts_frozen: true,
  recon_blocked: false,
};

const ROW_B: AdminAccountSearchItem = {
  account_id: ACCOUNT_B,
  identity_id: IDENTITY_B,
  email: 'bob@example.com',
  plan_code: 'CORE-50K',
  size_cents: 5_000_000,
  phase: 'evaluation',
  status: 'active',
  balance_cents: 0,
  withdrawable_cents: 0,
  open_flags: 0,
  payouts_frozen: false,
  recon_blocked: false,
};

const ROW_C: AdminAccountSearchItem = {
  account_id: ACCOUNT_C,
  identity_id: IDENTITY_B,
  email: 'bob@example.com',
  plan_code: 'CORE-25K',
  size_cents: 2_500_000,
  phase: 'funded',
  status: 'closed',
  balance_cents: 1_000_000,
  withdrawable_cents: 0,
  open_flags: 1,
  payouts_frozen: false,
  recon_blocked: true,
};

const ROWS: readonly AdminAccountSearchItem[] = [ROW_A, ROW_B, ROW_C];

const PAGE: AccountSearchPage = {
  renderedAt: RENDERED_AT,
  query: 'LAUNCH50',
  rows: ROWS,
  nextCursor: null,
  accessRecord:
    'three identity accesses recorded against the operator session for identities a1d2c3b4 and ' +
    'b2e3d4c5, M06 section 7.9',
};

const markupOf = (page: AccountSearchPage): string =>
  renderToStaticMarkup(AccountSearchDocument({ page }));

/** Source with comments removed, so a needle named in prose is not a finding. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
    .replaceAll(/(?<!:)\/\/[^\n]*/g, ' ');
}

/**
 * Source with comments AND string literals removed.
 *
 * `test/account-render.test.ts`'s helper and its reason: this screen EXPLAINS
 * in prose, rendered to the operator as string literals, exactly what it does
 * not do. A sweep over `code()` alone cannot tell that explanation from the
 * thing it refuses.
 */
function logic(file: string): string {
  return code(file)
    .replaceAll(/`(?:[^`\\]|\\.)*`/g, ' ')
    .replaceAll(/'(?:[^'\\\n]|\\.)*'/g, ' ')
    .replaceAll(/"(?:[^"\\\n]|\\.)*"/g, ' ');
}

/** The markup's text, with tags removed and the five entities React escapes decoded. */
function text(markup: string): string {
  return markup
    .replaceAll(/<[^>]*>/g, '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

const SEARCH = join(import.meta.dirname, '..', 'src', 'app', 'search');
const MODULE = join(SEARCH, 'account-search.tsx');
const ROUTE = join(SEARCH, 'page.tsx');
const ACCOUNTS = join(import.meta.dirname, '..', 'src', 'app', 'accounts');

// -----------------------------------------------------------------------------
// M6-A-73. The directory publishes one route, and the accounts directory still
//          publishes no index
// -----------------------------------------------------------------------------

describe('M6-A-73: the search surface is its own segment and grows no list beside it', () => {
  test('the directory holds the document module and one route', () => {
    expect(readdirSync(SEARCH).sort()).toStrictEqual(['account-search.tsx', 'page.tsx']);
  });

  test('src/app/accounts is unchanged by this slice and still holds no page.tsx', () => {
    // `M6-A-66` owns this assertion and this case is not a second copy of it: it
    // reads the ONE fact this slice could have broken by putting the search
    // screen in the tempting directory, so the two go red for different edits.
    expect(readdirSync(ACCOUNTS)).not.toContain('page.tsx');
  });

  test('the route is dynamic by declaration rather than by a code path', () => {
    // Session 368's finding one application over: a segment whose load throws
    // before it reaches a request-scoped API prerenders its failure screen,
    // silently, with the build exiting 0. Reading `searchParams` would mark this
    // route dynamic today; the declaration is what keeps it dynamic when a
    // future arm throws first.
    expect(dynamic).toBe('force-dynamic');
    expect(code(ROUTE)).toContain("export const dynamic = 'force-dynamic'");
  });
});

// -----------------------------------------------------------------------------
// M6-A-74. FM-M6-10: no term, no rows, and the refusal is on the path
// -----------------------------------------------------------------------------

describe('M6-A-74: a result set with no term above it is refused rather than answered', () => {
  test('a page value with no term throws before a byte is built', () => {
    expect(() => assertQueryNamesASubject({ ...PAGE, query: '' })).toThrow(PageError);
    expect(() => assertQueryNamesASubject({ ...PAGE, query: '   ' })).toThrow(/FM-M6-10/);
  });

  test('the refusal is on the render path and not only in this suite', () => {
    // `renderAccountSearchDocument` is what the route calls, so a supplier that
    // built a page with no term cannot reach the browser through it.
    expect(() => renderAccountSearchDocument({ ...PAGE, query: '' })).toThrow(PageError);
  });

  test('a real term renders, so the refusal is not refusing everything', () => {
    // THE ACCEPTANCE LEG, AND IT IS THE ONE THAT MATTERS. A guard that threw on
    // every page would pass every refusal case above while covering nothing.
    const markup = renderToStaticMarkup(renderAccountSearchDocument(PAGE));
    expect(text(markup)).toContain('Searched: LAUNCH50');
    expect(markup).toContain('data-testid="results"');
  });

  test('the route renders the box and no row when no term arrives', async () => {
    const markup = renderToStaticMarkup(
      await AccountSearchRoute({ searchParams: Promise.resolve({}) }),
    );
    expect(markup).toContain('data-testid="account-search-no-term"');
    expect(markup).toContain('data-testid="search-form"');
    expect(markup).not.toContain('data-testid="results"');
    expect(text(markup)).toContain('FM-M6-10');
  });

  test('a blank term is not a term, because the server trims before it refuses', () => {
    expect(readQueryTerm('   ')).toBeNull();
    expect(readQueryTerm('')).toBeNull();
    expect(readQueryTerm(undefined)).toBeNull();
    expect(readQueryTerm('  LAUNCH50 ')).toBe('LAUNCH50');
  });

  test('a repeated parameter is refused rather than resolved to either half', () => {
    // Picking `a` or `b` would be this route deciding which subject an operator
    // meant. `null` puts them back at the box.
    expect(readQueryTerm(['a', 'b'])).toBeNull();
    expect(readQueryTerm([])).toBeNull();
  });

  test('a term reaches the read seam and the blocked list, not a row', async () => {
    const markup = renderToStaticMarkup(
      await AccountSearchRoute({ searchParams: Promise.resolve({ query: 'LAUNCH50' }) }),
    );
    expect(markup).toContain('data-testid="account-search-unsupplied"');
    expect(markup).toContain('data-origin="ADR-171"');
    expect(markup).not.toContain('data-testid="results"');
    // The term the operator typed survives to the box, so a second search does
    // not start from empty.
    expect(markup).toContain('value="LAUNCH50"');
  });
});

// -----------------------------------------------------------------------------
// M6-A-75. INV-M6-10: every id served is one this query reached
// -----------------------------------------------------------------------------

describe('M6-A-75: the closure is the term plus the ids of the rows that answered it', () => {
  test('the closure is the term and both ids of every row, and nothing else', () => {
    expect([...reachableSubjectIds(PAGE)].sort()).toStrictEqual(
      ['LAUNCH50', ACCOUNT_A, ACCOUNT_B, ACCOUNT_C, IDENTITY_A, IDENTITY_B].sort(),
    );
  });

  test('the fixture spans more accounts than humans, so the two cannot be confused', () => {
    expect(PAGE.rows.length).toBe(3);
    expect(new Set(PAGE.rows.map((row) => row.identity_id)).size).toBe(2);
  });

  test('the ids the query reached ARE served, on the links they belong on', () => {
    // THE ACCEPTANCE LEG. `assertNamesNoSubject` would refuse every one of
    // these, which is why this screen does not call it, and a closure that
    // served no id at all would pass the refusal case below while rendering an
    // unusable screen.
    const markup = markupOf(PAGE);
    for (const id of [ACCOUNT_A, ACCOUNT_B, ACCOUNT_C, IDENTITY_A, IDENTITY_B])
      expect(markup).toContain(id);
    expect(markup).toContain(`href="/accounts/${ACCOUNT_A}"`);
    expect(markup).toContain(`href="/identities/${IDENTITY_A}"`);
    expect(() => assertNamesNoSubject(servedAccountSearchStrings(PAGE))).toThrow(PageError);
  });

  test('an id from outside the closure is refused however it arrived', () => {
    // THROUGH A FIELD NOBODY CLASSIFIED AS AN IDENTIFIER. `status` is a
    // server-supplied string, so this is the shape a leak really takes rather
    // than a hand-added id field.
    const leaked: AccountSearchPage = {
      ...PAGE,
      rows: [{ ...ROW_A, status: `active, linked_to_${STRANGER}` }],
    };
    expect(() => assertServedAccountSearchStrings(leaked)).toThrow(PageError);
    expect(() => assertServedAccountSearchStrings(leaked)).toThrow(/nobody asked about/);
  });

  test('the glued spelling is refused too, because the pattern carries no boundary', () => {
    const leaked: AccountSearchPage = {
      ...PAGE,
      rows: [{ ...ROW_A, plan_code: `CORE-25K${STRANGER}` }],
    };
    expect(() => assertServedAccountSearchStrings(leaked)).toThrow(PageError);
  });

  test('an id arriving through the email field is refused as well', () => {
    const leaked: AccountSearchPage = {
      ...PAGE,
      rows: [{ ...ROW_A, email: `${STRANGER}@example.com` }],
    };
    expect(() => assertServedAccountSearchStrings(leaked)).toThrow(PageError);
  });

  test('the cursor token is never served, so it cannot leak a page boundary', () => {
    // Session 371 records both cursor components as primary keys, so the token
    // encodes an `identity_id` the closure cannot read. The remedy is not to
    // render it, and what an operator needs is the fact rather than the token.
    const paged: AccountSearchPage = { ...PAGE, nextCursor: `${IDENTITY_B}:${ACCOUNT_C}` };
    const markup = markupOf(paged);
    expect(markup).not.toContain(`${IDENTITY_B}:${ACCOUNT_C}`);
    expect(markup).toContain('data-exhausted="false"');
    expect(markupOf(PAGE)).toContain('data-exhausted="true"');
  });

  test('the exhausted flag is the only paging fact on the page, and there is no total', () => {
    // ADR-157 refuses the scalar aggregate on the read path, so a count of all
    // matching accounts is a number nothing in this system can obtain.
    expect(RESULT_ORDER).toContain('there is no total');
    expect(text(markupOf(PAGE))).not.toMatch(/\bof\s+\d+\s+results?\b/);
  });
});

// -----------------------------------------------------------------------------
// M6-A-76. INV-M6-04: the three amounts are withheld, by source and by value
// -----------------------------------------------------------------------------

describe('M6-A-76: a figure raised on a search result has no origin it may declare', () => {
  test('the module reads no amount field of the response', () => {
    const source = logic(MODULE);
    for (const field of ['size_cents', 'balance_cents', 'withdrawable_cents'])
      expect(source, `${MODULE} reads ${field}`).not.toContain(field);
  });

  test('the module imports neither figure.ts nor data-trust.ts', () => {
    // The two mechanisms that would let it raise one. `../accounts/
    // account-detail.tsx` asserts the same pair for the same reason.
    const source = code(MODULE);
    expect(source).not.toContain("from '../../figure.ts'");
    expect(source).not.toContain("from '../../data-trust.ts'");
  });

  test('no amount on the fixture reaches the served bytes', () => {
    // A VALUE CHECK BESIDE THE SOURCE CHECK, and it catches what the source
    // check cannot: an amount reaching a page through a label, a definition or
    // an error string without ever being read by name.
    const markup = markupOf(PAGE);
    for (const row of ROWS)
      for (const amount of [row.size_cents, row.balance_cents, row.withdrawable_cents]) {
        if (amount === 0) continue; // `0` is a substring of half the page.
        expect(markup, `an amount ${String(amount)} reached the page`).not.toContain(
          String(amount),
        );
      }
  });

  test('the withholding is stated where an operator reads it, with its owner', () => {
    const rendered = text(markupOf(PAGE));
    expect(rendered).toContain('WITHHELD');
    expect(rendered).toContain('INV-M6-04');
    expect(WITHHELD_FIGURES).toHaveLength(1);
    expect(WITHHELD_FIGURES[0]?.blockedBy).toContain('no as-of and no source');
  });

  test('the open-flag count IS rendered, because a count is not a figure', () => {
    // THE ACCEPTANCE LEG AGAIN. A screen that withheld every number would pass
    // every case above and tell an operator nothing.
    const markup = markupOf(PAGE);
    expect(markup).toContain('data-open-flags="2"');
    expect(text(markup)).toContain('2 open flags');
    expect(text(markup)).toContain('0 open flags');
    expect(text(markup)).toContain('1 open flag.');
  });

  test('the frozen scope is stated, because the row resolves two levels into one word', () => {
    // Session 371 watched `payouts_frozen` come back true on a row whose own
    // `accounts.payouts_frozen` is false, because the identity is frozen.
    const rendered = text(markupOf(PAGE));
    expect(rendered).toContain('ACCOUNT is frozen OR the IDENTITY is');
    expect(markupOf(PAGE)).toContain('data-payouts-frozen="true"');
  });
});

// -----------------------------------------------------------------------------
// M6-A-77. INV-M6-10's second half: no access record, no render
// -----------------------------------------------------------------------------

describe('M6-A-77: a view nobody logged is not a view this screen renders', () => {
  test('a blank record is refused and the reason names the invariant', () => {
    expect(() => assertAccessWasRecorded({ ...PAGE, accessRecord: '' })).toThrow(PageError);
    expect(() => assertAccessWasRecorded({ ...PAGE, accessRecord: '  ' })).toThrow(/INV-M6-10/);
  });

  test('the refusal is on the render path, so a supplier cannot skip it', () => {
    expect(() => renderAccountSearchDocument({ ...PAGE, accessRecord: '' })).toThrow(PageError);
  });

  test('the record is served, so an operator can see the access was taken', () => {
    expect(text(markupOf(PAGE))).toContain('Access recorded:');
  });

  test('the route names the second blocker beside the first, on one origin', async () => {
    // ADR-171 blocks this screen twice: the read needs a principal, and the
    // access log needs the same principal a second time. ONE ENTRY AND BOTH
    // HALVES, asserted over what an operator reads rather than over the source,
    // because a blocker nobody is told about is not a blocker they can clear.
    const markup = renderToStaticMarkup(
      await AccountSearchRoute({ searchParams: Promise.resolve({ query: 'LAUNCH50' }) }),
    );
    const rendered = text(markup);
    expect(markup.match(/data-origin="/g)).toHaveLength(1);
    expect(rendered).toContain('IT BLOCKS THIS SCREEN TWICE');
    expect(rendered).toContain('assertAccessWasRecorded');
    expect(rendered).toContain('M06 section 7.9');
  });
});

// -----------------------------------------------------------------------------
// M6-A-78. Roles are closed, and this screen renders no control any of them
//          could not use
// -----------------------------------------------------------------------------

describe('M6-A-78: no mutating control, and no error kind this console did not receive', () => {
  test('neither file names one of section 8`s four account writes', () => {
    for (const file of [MODULE, ROUTE]) {
      const source = code(file);
      for (const needle of ['/freeze', '/unfreeze', '/close', '/note'])
        expect(source, `${file} names ${needle}`).not.toContain(needle);
    }
  });

  test('the only form is a GET form, and nothing posts', () => {
    const source = logic(MODULE).toLowerCase();
    expect(source).toContain('<form');
    expect(source).not.toContain('post');
    expect(source).not.toContain('formaction');
    expect(source).not.toContain("'use client'");
  });

  test('neither file names an error kind, because neither performs a read', () => {
    // ADR-190 ruling 3. `test/render.test.ts`'s M6-A-60 asserts this over the
    // whole `src/app/` directory; this case says it about the two files this
    // slice adds, so it fires here first and with the file named.
    for (const file of [MODULE, ROUTE]) {
      const source = code(file);
      for (const needle of ['toAdminErrorKind', 'AdminErrorKind', 'data-error'])
        expect(source, `${file} names ${needle}`).not.toContain(needle);
    }
  });

  test('the six terms are the contract`s, and a name is not among them', () => {
    expect([...SEARCH_TERMS]).toStrictEqual([
      'account id',
      'platform ref',
      'email',
      'identity id',
      'coupon',
      'payout id',
    ]);
    expect(NO_NAME_TERM).toContain('ADR-194');
    expect(text(markupOf(PAGE))).toContain('Merit stores no legal name at all');
  });

  test('the module names no seventh term anywhere it could be mistaken for one', () => {
    expect(SEARCH_TERMS).not.toContain('name fragment');
    expect(logic(MODULE)).not.toContain('fragment');
  });
});

// -----------------------------------------------------------------------------
// M6-A-79. The walk this document ships agrees with the markup a browser gets
// -----------------------------------------------------------------------------

describe('M6-A-79: the sweep reads what the browser receives', () => {
  test('every string the walk collects is in the real markup', () => {
    // The control that ships walks the element tree, because `next build`
    // refuses `react-dom/server` in a Server Component's graph. This binds the
    // two, which is what makes the walk an assertion about served bytes.
    //
    // THE MARKUP IS DECODED AND NOT STRIPPED. `text()` removes tags and would
    // lose every attribute value, and the walk collects those too, so a sweep
    // compared against stripped text would silently stop covering half of what
    // it collects.
    const decoded = markupOf(PAGE)
      .replaceAll('&quot;', '"')
      .replaceAll('&#x27;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&');
    for (const served of servedAccountSearchStrings(PAGE)) {
      if (served.trim() === '') continue;
      expect(
        decoded.includes(served),
        `the walk collected ${JSON.stringify(served)} and the markup lacks it`,
      ).toBe(true);
    }
  });

  test('the walk is not vacuous, which is the seed a blinded one would pass', () => {
    const served = servedAccountSearchStrings(PAGE);
    expect(served.length).toBeGreaterThan(20);
    // THE ID IS NOT A STRING OF ITS OWN AND THAT IS THE POINT OF CHECKING FOR
    // IT THIS WAY. It reaches the bytes inside `href="/accounts/<id>"` and
    // inside the link's own text, which is exactly why the closure in
    // `assertServedAccountSearchStrings` scans every served string for a match
    // rather than comparing whole strings against a set.
    expect(served.some((string) => string.includes(ACCOUNT_A))).toBe(true);
  });

  test('an empty answer is a sentence rather than a missing section', () => {
    const empty: AccountSearchPage = { ...PAGE, rows: [] };
    const markup = markupOf(empty);
    expect(markup).toContain('data-testid="empty-result"');
    expect(markup).not.toContain('data-testid="results"');
    expect(text(markup)).toContain('No account answers to that term');
  });
});
