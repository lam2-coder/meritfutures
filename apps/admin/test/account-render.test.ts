import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { renderToStaticMarkup } from 'react-dom/server';

import { ACCOUNT_DETAIL_SECTIONS, type AdminAccountDetail } from '../src/api/types.ts';
import AccountDrillDownRoute from '../src/app/accounts/[accountId]/page.tsx';
import {
  AccountDetailDocument,
  type AccountDetailPage,
  WITHHELD_SECTIONS,
  assertSectionsAreTheContracts,
  assertServedAccountDetailStrings,
  reachableAccountIds,
  renderAccountDetailDocument,
  servedAccountDetailStrings,
} from '../src/app/accounts/account-detail.tsx';
import { PageError } from '../src/page.ts';

// =============================================================================
// THE SECOND SCREEN THAT HOLDS AN INV-M6-10 LICENCE, AND THE ONE READ THE
// CONTRACT DOES NOT TYPE
// =============================================================================
// M06 section 3.2: "One screen answering one question: why did this account get
// this outcome ... The `gate_results` per day is the load-bearing part ... from
// the stored row rather than from a recomputation, because a recomputation is an
// assertion and the stored row is a record."
//
// TWO RULES MEET ON THIS FILE AND NEITHER IS THE OTHER SCREENS'.
//
//   THE LICENCE IS A CLOSURE, like `test/identity-render.test.ts`'s and unlike
//   the three screens that name no subject: every id served must be one the
//   query reached, rather than no id being served at all.
//
//   AND THE CLOSURE HAS EXACTLY ONE MEMBER, which the identity drill-down's does
//   not. `GET /admin/accounts/:accountId` is the one admin read in API_CONTRACT
//   section 8 whose row is PROSE rather than a `ts` block, so the response
//   declares no field that could widen the licence and no field the document may
//   render. The cases below assert that absence from the module's own source
//   rather than from its header, because a claim that a module reads no field is
//   a claim about the code.
//
// THE COMPONENT IS CALLED RATHER THAN WRITTEN AS AN ELEMENT because this file is
// `.ts`, which is `test/render.test.ts`'s reason and WAVE-06's `W6-j` row
// spelling one filename.
// =============================================================================

const RENDERED_AT = '2026-08-28T15:00:00.000Z';

const SUBJECT = 'aa11bb22-cc33-4d44-8e55-ff6677889900';
const STRANGER = 'cc33dd44-ee55-4f66-8011-223344556677';

/** A response with something in every section, so a count is a real count. */
const DETAIL: AdminAccountDetail = {
  account: { account_id: SUBJECT, status: 'funded' },
  identity: { identity_id: 'bb22cc33-dd44-4e55-8f66-001122334455' },
  marks: [{ trading_day: '2026-08-26' }, { trading_day: '2026-08-27' }],
  rule_states: [
    { trading_day: '2026-08-27', engine_gates: { max_loss: true }, context_gates: { recon: true } },
  ],
  events: [{ event_name: 'day.closed' }],
  flags: [],
  payouts: [{ payout_request_id: 'dd44ee55-ff66-4011-8223-344556677889' }],
  admin_actions: [{ actor: 'ops-7' }, { actor: 'ops-7' }, { actor: 'ops-9' }],
};

const PAGE: AccountDetailPage = {
  renderedAt: RENDERED_AT,
  subjectAccountId: SUBJECT,
  detail: DETAIL,
};

/** The bytes a browser receives for this document. */
function servedBytes(page: AccountDetailPage): string {
  return renderToStaticMarkup(AccountDetailDocument({ page }));
}

/** Source with comments removed, so a needle named in prose is not a finding. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
    .replaceAll(/(?<!:)\/\/[^\n]*/g, ' ');
}

/**
 * Source with comments AND string literals removed.
 *
 * THE DISTINCTION IS THE WHOLE OF WHY THIS HELPER EXISTS. These screens EXPLAIN
 * in prose, rendered to the operator as string literals, exactly what they do
 * not do: "never recomputed", "`../../figure.ts` closes its origin roster". A
 * sweep over `code()` alone cannot tell that explanation from the thing it
 * refuses. What is left after this is the module's LOGIC, which is what a claim
 * about recomputation is a claim about.
 */
function logic(file: string): string {
  return code(file)
    .replaceAll(/`(?:[^`\\]|\\.)*`/g, ' ')
    .replaceAll(/'(?:[^'\\\n]|\\.)*'/g, ' ')
    .replaceAll(/"(?:[^"\\\n]|\\.)*"/g, ' ');
}

/** Every module path a file imports from, in source order. */
function imports(file: string): string[] {
  return [...code(file).matchAll(/from '([^']+)'/g)].map((match) => match[1] ?? '');
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

const ACCOUNTS = join(import.meta.dirname, '..', 'src', 'app', 'accounts');
const MODULE = join(ACCOUNTS, 'account-detail.tsx');
const ROUTE = join(ACCOUNTS, '[accountId]', 'page.tsx');

// -----------------------------------------------------------------------------
// M6-A-62. The section roster is the contract's, in both directions
// -----------------------------------------------------------------------------

describe('M6-A-62: the eight sections are the contract`s, and both directions are refused', () => {
  test('the roster is section 8`s own nouns in its own order', () => {
    expect([...ACCOUNT_DETAIL_SECTIONS]).toStrictEqual([
      'account',
      'identity',
      'marks',
      'rule_states',
      'events',
      'flags',
      'payouts',
      'admin_actions',
    ]);
  });

  test('every section is rendered, each with what arrived in it', () => {
    const markup = servedBytes(PAGE);
    for (const section of ACCOUNT_DETAIL_SECTIONS)
      expect(markup).toContain(`data-section="${section}"`);
    expect(text(markup)).toContain('marks: 2 entries');
    expect(text(markup)).toContain('flags: 0 entries');
    expect(text(markup)).toContain('admin_actions: 3 entries');
  });

  test('a section the contract does not name is refused', () => {
    // A SECTION NOBODY SPECIFIED IS A FIELD THAT REACHED AN OPERATOR BY DEFAULT,
    // which is the route's own words for the same refusal one deployable over.
    const page = {
      ...PAGE,
      detail: { ...DETAIL, ledger: [] } as unknown as AdminAccountDetail,
    };
    expect(() => {
      assertSectionsAreTheContracts(page);
    }).toThrow(PageError);
    expect(() => {
      assertSectionsAreTheContracts(page);
    }).toThrow(/ledger/);
  });

  test('a section the contract names and the response omits is refused', () => {
    // THE FAILURE THAT READS AS SUCCESS. A drill-down rendered without `flags`
    // is the screen where a payout decision gets explained, explaining it
    // without the investigation.
    const { flags: _flags, ...withoutFlags } = DETAIL;
    const page = { ...PAGE, detail: withoutFlags as unknown as AdminAccountDetail };
    expect(() => {
      assertSectionsAreTheContracts(page);
    }).toThrow(/omitted `flags`/);
  });

  test('the whole document refuses before it renders, rather than in the suite alone', () => {
    const { events: _events, ...withoutEvents } = DETAIL;
    expect(() => {
      renderAccountDetailDocument({
        ...PAGE,
        detail: withoutEvents as unknown as AdminAccountDetail,
      });
    }).toThrow(PageError);
  });
});

// -----------------------------------------------------------------------------
// M6-A-63. No field of any section is rendered, because none is declared
// -----------------------------------------------------------------------------

describe('M6-A-63: the one read section 8 does not type renders no field of itself', () => {
  test('the module reads nothing off a section value but its length', () => {
    // MECHANICAL AND NOT A READING. Every property access on a section value in
    // this module is collected from its own source with comments stripped, and
    // the whole set must be `length`. A field name added later is a new member
    // here and turns this red, which is the failure a header sentence cannot
    // catch.
    const accesses = [...code(MODULE).matchAll(/\bvalue(?:\.\w+|\[[^\]]*\])/g)].map(
      (match) => match[0],
    );
    expect([...new Set(accesses)]).toStrictEqual(['value.length']);
  });

  test('a scalar sitting inside a section never reaches the bytes, member or field', () => {
    // TWO SHAPES AND NOT ONE. `SEEDED_MEMBER` is a section whose entries are
    // scalars, which is the shape an index access would put on the page;
    // `DETAIL`'s own sections are objects, which is the shape a field read
    // would. A seeded `value[0]` passed the first draft of the source sweep
    // above AND passed this case while it looked only at field values, which is
    // how both halves were found.
    const scalars = {
      ...DETAIL,
      marks: ['seeded-mark-member'],
      events: ['seeded-event-member'],
    };
    const served = text(servedBytes({ ...PAGE, detail: scalars }));
    expect(served).not.toContain('seeded-mark-member');
    expect(served).not.toContain('seeded-event-member');
    expect(served).toContain('marks: 1 entries');
  });

  test('a scalar sitting inside a section object never reaches the bytes', () => {
    // THE RUN-TIME LEG, AND IT FAILS AT A DIFFERENT TIME FROM THE ONE ABOVE. The
    // source sweep catches a field read written into this module; this catches a
    // value that reached the page by any other route, including one a future
    // node kind introduces.
    const served = text(servedBytes(PAGE));
    expect(served).not.toContain('funded');
    expect(served).not.toContain('day.closed');
    expect(served).not.toContain('ops-7');
  });

  test('a section that is not a list is reported as that, and never as zero', () => {
    // "0 entries" AND "not a list" ARE DIFFERENT ANSWERS AND ONLY ONE OF THEM IS
    // ABOUT THE ACCOUNT. A drill-down that rendered an unrecognised shape as an
    // empty collection would say this account has no marks on the day a server
    // changed the envelope.
    const page = { ...PAGE, detail: { ...DETAIL, marks: { total: 2 } } };
    const served = text(servedBytes(page));
    expect(served).toContain('marks: present, and not a list');
    expect(served).not.toContain('marks: 0 entries');
  });

  test('the roster is in the module, so the sweeps above are not over an empty subject', () => {
    expect(code(MODULE)).toContain('ACCOUNT_DETAIL_SECTIONS');
  });
});

// -----------------------------------------------------------------------------
// M6-A-64. Nothing is recomputed, which is M06 section 3.2's load-bearing half
// -----------------------------------------------------------------------------

describe('M6-A-64: the gate results are a record and this screen asserts nothing', () => {
  test('the module names no gate vocabulary and derives no verdict', () => {
    // `gate_results` IS NOT A TABLE IN THIS TREE. `SD-06` split it into
    // `rule_states.engine_gates` and `rule_states.context_gates`
    // (`packages/db/src/schema.ts` declares both as `jsonb ... notNull`), so a
    // console that hard-listed either would be the hand-listed drift INV-M7-10
    // exists to prevent, arriving on a screen instead of in a pack.
    // THE NEEDLES ARE THE COLUMN NAMES AND NOT THE WORD "recompute", AND THAT IS
    // A LIMIT OF THIS LEG RATHER THAN A CHOICE. `logic()` removes comments and
    // string literals; JSX TEXT CHILDREN ARE NEITHER, and this document's own
    // sentence to the operator contains "recomputed". So the general claim is
    // carried by `M6-A-63`'s property-access sweep, which is strictly stronger:
    // a recomputation of a gate result has to READ a gate column off a section,
    // and the only access that sweep admits is `length`.
    const source = logic(MODULE);
    for (const needle of ['engine_gates', 'context_gates', 'gate_results'])
      expect(source, `${needle} is in the module logic`).not.toContain(needle);
  });

  test('the route names no gate vocabulary either', () => {
    const source = logic(ROUTE);
    for (const needle of ['engine_gates', 'context_gates', 'gate_results'])
      expect(source).not.toContain(needle);
  });

  test('the rendered page states where a gate result comes from, in the contract`s terms', () => {
    // The claim an operator reads is the one the code keeps: the sentence names
    // the stored row, and the two cases above are why it is not merely a
    // sentence.
    const served = text(servedBytes(PAGE));
    expect(served).toContain('read from the stored rule state');
    expect(served).toContain('never recomputed');
  });
});

// -----------------------------------------------------------------------------
// M6-A-65. INV-M6-10, and the closure is one member wide
// -----------------------------------------------------------------------------

describe('M6-A-65: every id served is the one the query named, and there is only one', () => {
  test('the closure is exactly the path parameter', () => {
    // THE COUNT IS THE POINT RATHER THAN A SIMPLIFICATION. The identity
    // drill-down's closure grows with the graph its query resolved because
    // `IdentityGraph` declares those members. This response declares no field,
    // so nothing widens this licence.
    expect([...reachableAccountIds(PAGE)]).toStrictEqual([SUBJECT]);
  });

  test('the subject the operator typed is served, which is the licence', () => {
    expect(text(servedBytes(PAGE))).toContain(SUBJECT);
    expect(assertServedAccountDetailStrings(PAGE).join(' ')).toContain(SUBJECT);
  });

  test('an id from outside the closure is refused, wherever it entered from', () => {
    // THE SEED IS A STRANGER'S ID IN A PLACE THE DOCUMENT DOES NOT READ, so this
    // case fires on the RULE rather than on today's render path: the closure is
    // asserted over the served strings and a future node kind that started
    // rendering a section member meets it here.
    const leaking = {
      ...PAGE,
      subjectAccountId: `${SUBJECT} and ${STRANGER}`,
    };
    expect(() => assertServedAccountDetailStrings(leaking)).toThrow(PageError);
    expect(() => assertServedAccountDetailStrings(leaking)).toThrow(/nobody asked about/);
  });

  test('the guard runs on the render path and not only in this file', () => {
    const leaking = { ...PAGE, subjectAccountId: `${SUBJECT} ${STRANGER}` };
    expect(() => renderAccountDetailDocument(leaking)).toThrow(PageError);
  });

  test('`assertNamesNoSubject` is deliberately not called here, and the module says so', () => {
    // The three screens that name no subject call it and this one may not: it
    // would refuse the account the operator asked about. The absence is asserted
    // over the CODE because the reason for it lives in a comment.
    expect(code(MODULE)).not.toContain('assertNamesNoSubject(');
    expect(code(ROUTE)).not.toContain('assertNamesNoSubject(');
  });

  test('the walk sees what the renderer emits, which is what makes the guard mean anything', () => {
    const served = servedAccountDetailStrings(PAGE);
    const markup = servedBytes(PAGE);
    expect(served.length).toBeGreaterThan(10);
    // AN ATTRIBUTE VALUE IS IN THE MARKUP AND A TEXT NODE IS IN THE DECODED
    // TEXT, and the walk collects both, so the check accepts either rather than
    // pretending the two live in one place.
    for (const string of served)
      expect(
        markup.includes(string) || text(markup).includes(string),
        `${string} was collected by the walk and is not in the bytes`,
      ).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// M6-A-66. The directory publishes one route and no way to reach a subject
//          without naming one
// -----------------------------------------------------------------------------

describe('M6-A-66: there is no index, no search and no list under src/app/accounts', () => {
  const entries = (): string[] =>
    readdirSync(ACCOUNTS, { withFileTypes: true }).map((entry) =>
      entry.isDirectory() ? `${entry.name}/` : entry.name,
    );

  test('the directory holds the document module and one dynamic segment', () => {
    expect(entries().sort()).toStrictEqual(['[accountId]/', 'account-detail.tsx']);
  });

  test('there is no accounts/page.tsx, which would be a list with no query behind it', () => {
    // TWO REASONS AND THE SECOND OUTLIVES THE FIRST. The search surface is a
    // different contract row and `AdminReadSource.searchAccounts` is owned by no
    // plan (WAVE-06 section 10 item 3), which is a fence. An index with no query
    // behind it is FM-M6-10, "a bulk PII surface hiding inside a convenience
    // feature", which is an invariant. This case reads the DIRECTORY, so it
    // fires on the file rather than on the render.
    expect(entries()).not.toContain('page.tsx');
  });

  test('the dynamic segment publishes exactly one route', () => {
    expect(readdirSync(join(ACCOUNTS, '[accountId]')).sort()).toStrictEqual(['page.tsx']);
  });

  test('neither file carries an input, a form or a history affordance', () => {
    for (const file of [MODULE, ROUTE]) {
      const source = code(file);
      for (const needle of ['<input', '<form', '<select', 'localStorage', 'recent'])
        expect(source, `${file} carries ${needle}`).not.toContain(needle);
    }
  });
});

// -----------------------------------------------------------------------------
// M6-A-67. The route names no error kind, and the two real answers were measured
// -----------------------------------------------------------------------------

describe('M6-A-67: no error kind is named, because 503 is a status this route never sends', () => {
  test('the route names no kind and serves none as an attribute', () => {
    const source = code(ROUTE);
    for (const needle of ['toAdminErrorKind', 'AdminErrorKind', 'data-error'])
      expect(source).not.toContain(needle);
  });

  test('the two answers it really gives are carried where an operator reads them', async () => {
    // MEASURED IN THIS SLICE over a real `compose()` and the server injector
    // against `GET /api/v1/admin/accounts/:accountId` on the operator surface:
    // with no admin session cookie it answers 401 `unauthenticated`, and with
    // one it answers 500 `internal_error`. WAVE-06 section 8.1 says 503 and
    // `src/app/page.tsx` renders `toAdminErrorKind(503)` on that basis. Both are
    // outside this fence and are REPORTED; this route declines to repeat the
    // claim. ADR-190 ruled the same thing for the read routes an hour before
    // this slice began, and this is the account pair measured rather than
    // inherited.
    const markup = renderToStaticMarkup(
      await AccountDrillDownRoute({ params: Promise.resolve({ accountId: SUBJECT }) }),
    );
    expect(markup).not.toContain('data-error=');
    expect(text(markup)).toContain('401 `unauthenticated`');
    expect(text(markup)).toContain('500 `internal_error`');
    expect(text(markup)).not.toContain('answers 503');
  });
});

// -----------------------------------------------------------------------------
// M6-A-68. No figure, and the reason is figure.ts's roster rather than taste
// -----------------------------------------------------------------------------

describe('M6-A-68: a figure raised on section 3.2 has no origin it may declare', () => {
  test('neither file imports figure.ts or data-trust.ts', () => {
    // TWO MECHANISMS AND EITHER WOULD BE ENOUGH. `figure.ts`'s `ORIGIN_ID`
    // admits `P-M6-01` to `P-M6-10` and `AS-M6-04`, which are M06 section 3.1's
    // panels, and this response carries no `as_of` for a figure to cite anyway.
    // Widening the roster is an edit to `figure.ts`, which no WAVE-06 fence
    // holds.
    // THE IMPORT LIST AND NOT A SUBSTRING SWEEP. Both files NAME `figure.ts` in
    // the prose they render, which is the explanation of the absence and not the
    // absence failing, so the needle is what the module actually pulls in.
    expect(imports(MODULE)).toStrictEqual([
      'react',
      '../../api/types.ts',
      '../../page.ts',
      '../liability-home.tsx',
    ]);
    expect(imports(ROUTE)).toStrictEqual(['react', '../../../page.ts', '../account-detail.tsx']);
    for (const file of [MODULE, ROUTE]) expect(logic(file)).not.toContain('formatCents');
  });

  test('no money reaches the bytes, on a response whose money has no as-of', () => {
    const served = text(servedBytes(PAGE));
    expect(served).not.toContain('_cents');
    expect(served).not.toMatch(/\$\d/);
  });

  test('the absence is stated with its owner rather than left to be noticed', () => {
    const origins = WITHHELD_SECTIONS.map((entry) => entry.origin);
    expect(origins).toContain('INV-M6-04');
    expect(origins).toContain('API_CONTRACT section 8');
    expect(new Set(origins).size).toBe(origins.length);
  });
});

// -----------------------------------------------------------------------------
// M6-A-69. The route states both blockers, and the second is the adapter
// -----------------------------------------------------------------------------

describe('M6-A-69: two blockers, where the three screens before this one had one', () => {
  test('the unsupplied arm names the subject and reads nothing', async () => {
    const markup = renderToStaticMarkup(
      await AccountDrillDownRoute({ params: Promise.resolve({ accountId: SUBJECT }) }),
    );
    expect(markup).toContain('data-testid="account-drill-down-unsupplied"');
    expect(text(markup)).toContain(SUBJECT);
    expect(text(markup)).toContain('nothing about this account is invented');
  });

  test('the read blocker names the port, the three methods missing from it and the table that is not', async () => {
    const markup = renderToStaticMarkup(
      await AccountDrillDownRoute({ params: Promise.resolve({ accountId: SUBJECT }) }),
    );
    expect(markup).toContain('data-origin="WAVE-06 section 10 item 3"');
    expect(markup).toContain('data-origin="ADR-171"');
    const served = text(markup);
    expect(served).toContain('AdminReadSource');
    // THE BLOCKER MOVED FROM THE TABLE TO THE PORT AND THIS CASE MOVED WITH IT.
    // It used to require the words "rejected response", which was the claim that
    // seven of eight sections is not a smaller screen; ADR-191 registered
    // `events` and session 356 wrote the adapter, so all eight are reachable and
    // the sentence that case pinned is false. What is still true is the port.
    expect(served).toContain('`events`');
    expect(served).toContain('readAccount');
    expect(served).toContain('searchAccounts');
    expect(served).toContain('setAdminReadSource');
  });

  test('the document`s own absences are separate from the deployment`s, and survive it', () => {
    // WITHHELD_SECTIONS is a property of the CONTRACT and BLOCKED_ON is a
    // property of the deployment, which is why they are two lists and not one.
    // The route's list clears when an adapter and a session provider land; the
    // document's does not.
    const served = text(servedBytes(PAGE));
    expect(served).toContain('no declared shape');
    expect(served).toContain('the root cannot be checked against');
  });
});
