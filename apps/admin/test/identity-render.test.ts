import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { renderToStaticMarkup } from 'react-dom/server';

import type { IdentityGraph } from '../src/api/types.ts';
import IdentityDrillDownRoute from '../src/app/identities/[identityId]/page.tsx';
import {
  IdentityGraphDocument,
  type IdentityGraphPage,
  WITHHELD_FIGURES,
  assertRootIsTheNamedSubject,
  assertServedIdentityGraphStrings,
  reachableIdentityIds,
  renderIdentityGraphDocument,
  servedIdentityGraphStrings,
} from '../src/app/identities/identity-graph.tsx';
import { PageError } from '../src/page.ts';

// =============================================================================
// THE ONE SCREEN THAT HOLDS AN INV-M6-10 LICENCE, AND THE BOUND ON IT
// =============================================================================
// M06 section 3.2a: the drill-down "renders trader-identifying data across
// several accounts at once, so it is reachable ONLY BY NAMING A SPECIFIC
// SUBJECT ... It is not a browse surface and there is no list behind it."
//
// So the cases here are not the ones the other screens need. Everywhere else in
// this console the assertion is "no subject id in the served bytes" and here it
// would refuse the page's own subject. The rule this suite checks instead is a
// CLOSURE: every id served is one the query reached, the root the server
// answered with is the subject the path named, and the two ways to reach a
// human without naming one -- an index route and a search affordance -- are
// absent from the directory rather than absent from an intention.
//
// THE COMPONENT IS CALLED RATHER THAN WRITTEN AS AN ELEMENT because this file
// is `.ts`, which is `test/render.test.ts`'s reason and WAVE-06's `W6-g` row
// spelling one filename.
// =============================================================================

const RENDERED_AT = '2026-08-28T15:00:00.000Z';

const SUBJECT = 'aa11bb22-cc33-4d44-8e55-ff6677889900';
const LINKED = 'bb22cc33-dd44-4e55-8f66-001122334455';
const STRANGER = 'cc33dd44-ee55-4f66-8011-223344556677';

const GRAPH: IdentityGraph = {
  root: { identity_id: SUBJECT, status: 'active', accounts: 3 },
  nodes: [
    { identity_id: SUBJECT, status: 'active', accounts: 3, total_withdrawable_cents: 412_500 },
    { identity_id: LINKED, status: 'restricted', accounts: 1, total_withdrawable_cents: 0 },
  ],
  edges: [
    {
      a: SUBJECT,
      b: LINKED,
      link_kind: 'shared_payout_instrument',
      confidence_bp: 9_400,
      evidence: { instrument_fingerprint: 'sha256:0f1e2d', first_seen: '2026-07-02' },
    },
  ],
  aggregate: {
    identities: 2,
    accounts: 4,
    open_liability_cents: 412_500,
    payouts_lifetime_cents: 1_875_000,
  },
};

const PAGE: IdentityGraphPage = {
  renderedAt: RENDERED_AT,
  subjectIdentityId: SUBJECT,
  graph: GRAPH,
};

/** The bytes a browser receives for this document. */
function servedBytes(page: IdentityGraphPage): string {
  return renderToStaticMarkup(IdentityGraphDocument({ page }));
}

/** Source with comments removed, so a needle named in prose is not a finding. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
    .replaceAll(/(?<!:)\/\/[^\n]*/g, ' ');
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

const IDENTITIES = join(import.meta.dirname, '..', 'src', 'app', 'identities');
const DOCUMENT = join(IDENTITIES, 'identity-graph.tsx');
const ROUTE = join(IDENTITIES, '[identityId]', 'page.tsx');

describe('M6-A-49: there is no list behind it, asserted over the directory', () => {
  test('`src/app/identities/` publishes ONE route and it carries a dynamic segment', () => {
    // THE FILE TREE IS THE CONTROL, because the framework maps it to URLs. An
    // `identities/page.tsx` added for tidiness would publish `/identities`,
    // which is the browse surface M06 section 3.2a says does not exist, and no
    // assertion over a rendered document could see it.
    const top = readdirSync(IDENTITIES, { withFileTypes: true });
    const routeFiles = top
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => /^(page|route|default)\.(ts|tsx)$/.test(name));
    expect(routeFiles).toEqual([]);

    const directories = top.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    expect(directories).toEqual(['[identityId]']);
    expect(readdirSync(join(IDENTITIES, '[identityId]'))).toEqual(['page.tsx']);
  });

  test('no search, no form and no history affordance exists under this directory', () => {
    // `FM-M6-10` is "a bulk PII surface hiding inside a convenience feature",
    // and each of these is that feature: an input resolves a human without
    // naming one, and a recent-identities list names them all at once.
    const needles = ['<input', '<form', '<select', '<datalist', 'searchParams', 'localStorage'];
    for (const file of [DOCUMENT, ROUTE]) {
      const source = code(file);
      for (const needle of needles)
        expect(source, `${file} contains ${needle}`).not.toContain(needle);
    }
  });

  test('NO RESTRICTION AFFORDANCE AND NO RESTORE AFFORDANCE', () => {
    // INV-M6-14's write is behind ADR-171 and WAVE-06 section 8 puts it in a
    // wave that is not dispatched. The needles are the CONTROLS rather than the
    // words: this screen names the restriction in prose, on the list of what it
    // does not show, and that sentence is the opposite of building one.
    const needles = ['<button', 'onClick', 'onSubmit', 'method="post"', 'action='];
    for (const file of [DOCUMENT, ROUTE]) {
      const source = code(file);
      for (const needle of needles)
        expect(source, `${file} contains ${needle}`).not.toContain(needle);
    }
    expect(text(servedBytes(PAGE))).toContain('The restriction and the restore, INV-M6-14');
  });
});

describe('M6-A-50: the licence is a closure, and an id outside it is refused', () => {
  test('the ids the query reached are the subject, the root, the nodes and the edge ends', () => {
    expect([...reachableIdentityIds(PAGE)].sort()).toEqual([SUBJECT, LINKED].sort());
    expect(reachableIdentityIds(PAGE).has(STRANGER)).toBe(false);
  });

  test('the subject and its resolved cluster ARE served, which is the screen', () => {
    // The half a permissive reading gets wrong in the other direction: a rule
    // that refused every id would refuse the page this screen exists to be.
    const markup = servedBytes(PAGE);
    expect(markup).toContain(SUBJECT);
    expect(markup).toContain(LINKED);
    expect(text(markup)).toContain(`${LINKED}: restricted, 1 accounts`);
    expect(() => renderIdentityGraphDocument(PAGE)).not.toThrow();
  });

  test('A SUBJECT ID ARRIVING THROUGH `link_kind` IS REFUSED', () => {
    // THE SEED THIS CONTROL EXISTS FOR, and it is the shape `W6-d` caught in
    // `movement.feed` and `W6-f` caught in `evidence_summary`, arriving on the
    // one screen whose licence would otherwise excuse an identifier.
    const first = GRAPH.edges[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const seeded: IdentityGraphPage = {
      ...PAGE,
      graph: {
        ...GRAPH,
        edges: [{ ...first, link_kind: `also_seen_with_${STRANGER}` }],
      },
    };
    expect(() => assertServedIdentityGraphStrings(seeded)).toThrow(PageError);
    expect(() => renderIdentityGraphDocument(seeded)).toThrow(PageError);
  });

  test('a subject id arriving through a status string is refused too', () => {
    const seeded: IdentityGraphPage = {
      ...PAGE,
      graph: { ...GRAPH, root: { ...GRAPH.root, status: `merged into ${STRANGER}` } },
    };
    expect(() => renderIdentityGraphDocument(seeded)).toThrow(PageError);
  });

  test('the refusal is ON THE RENDER PATH and not only in this suite', () => {
    const seeded: IdentityGraphPage = {
      ...PAGE,
      graph: { ...GRAPH, root: { ...GRAPH.root, status: `see ${STRANGER}` } },
    };
    expect(() => IdentityGraphDocument({ page: seeded })).not.toThrow();
    expect(() => renderIdentityGraphDocument(seeded)).toThrow(PageError);
  });
});

describe('M6-A-51: the root the server answered with is the subject the path named', () => {
  test('a graph rooted on somebody else is refused before a byte is built', () => {
    // THE WORST ANSWER THIS ENDPOINT CAN GIVE, and the one an operator cannot
    // detect: a page headed by the id they typed whose rows belong to another
    // human.
    const wrong: IdentityGraphPage = { ...PAGE, subjectIdentityId: STRANGER };
    expect(() => assertRootIsTheNamedSubject(wrong)).toThrow(PageError);
    expect(() => renderIdentityGraphDocument(wrong)).toThrow(PageError);
  });

  test('the check is FIRST, so a mismatch is refused rather than swept', () => {
    // `assertServedIdentityGraphStrings` would also refuse the case above,
    // because the named subject is in the closure and the root is not. That is
    // a coincidence of this fixture rather than the control, and the order is
    // what makes the message the right one: the failure is a response about the
    // wrong human, not an id that leaked.
    const wrong: IdentityGraphPage = { ...PAGE, subjectIdentityId: STRANGER };
    expect(() => renderIdentityGraphDocument(wrong)).toThrow(/root that is not the identity/);
  });
});

describe('M6-A-52: the money is a named absence and the edge evidence is not rendered', () => {
  const markup = servedBytes(PAGE);
  const body = text(markup);

  test('no `_cents` figure on this response reaches the served bytes', () => {
    // INV-M6-04: a number without its as-of and its source is a number this
    // console may not render, and this response carries neither for any of the
    // three. Rendering one would be the confidently wrong figure AS-M6-04 is
    // about, on the screen an enforcement is decided from.
    for (const forbidden of ['412500', '4125.00', '1875000', '18750.00'])
      expect(markup, `the drill-down served ${forbidden}`).not.toContain(forbidden);
  });

  test('the absence is STATED with its owner rather than left blank', () => {
    expect(WITHHELD_FIGURES.length).toBeGreaterThan(0);
    for (const entry of WITHHELD_FIGURES)
      expect(body).toContain(
        `[${entry.origin}] ${entry.title}: NOT BUILT, blocked by ${entry.blockedBy}`,
      );
    expect(body).toContain('no as-of and no source on this response');
  });

  test('the counts ARE rendered, because a count is not an undated figure', () => {
    expect(body).toContain('2 identities holding 4 accounts');
    expect(body).toContain('3 accounts');
  });

  test('the module never reads `evidence`, read from its own source', () => {
    // M06 section 3.2a names an edge`s KIND and CONFIDENCE and does not name
    // its evidence, which is `Record<string, unknown>` of server-supplied keys
    // on the one screen holding a PII licence.
    const source = code(DOCUMENT);
    expect(source).not.toContain('.evidence');
    expect(source).not.toContain("['evidence']");
    expect(markup).not.toContain('instrument_fingerprint');
    expect(markup).not.toContain('sha256:0f1e2d');
  });

  test('the edge IS rendered with its kind and its confidence', () => {
    expect(body).toContain('shared_payout_instrument, confidence 9400 bp');
    expect(markup).toContain('data-confidence-bp="9400"');
  });
});

describe('M6-A-53: the shipped walk and the served bytes are the same surface', () => {
  const served = servedIdentityGraphStrings(PAGE);
  const markup = servedBytes(PAGE);

  /** React escapes these five in text and in attribute values both. */
  const escaped = (value: string): string =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#x27;');

  test('every string the walk collects is in the bytes', () => {
    const missing = served.filter((value) => !markup.includes(escaped(value)));
    expect(missing).toEqual([]);
  });

  test('the walk collects the whole document rather than a corner of it', () => {
    expect(served.length).toBeGreaterThan(GRAPH.nodes.length + GRAPH.edges.length);
    for (const entry of WITHHELD_FIGURES) expect(served.join('\n')).toContain(entry.blockedBy);
  });

  test('it collects attribute values and not only text', () => {
    expect(served).toContain('identity-drill-down');
    expect(served).toContain('shared_payout_instrument');
  });

  test('an empty cluster is a sentence rather than an empty list', () => {
    const alone: IdentityGraphPage = {
      ...PAGE,
      graph: { ...GRAPH, nodes: [], edges: [] },
    };
    const bytes = servedBytes(alone);
    expect(bytes).toContain('data-testid="no-nodes"');
    expect(bytes).toContain('data-testid="no-edges"');
    expect(bytes).not.toContain('data-testid="node-rows"');
  });
});

describe('M6-A-54: the route names the subject, reads nothing and claims no status', () => {
  test('it renders the blocked state and no graph', async () => {
    const markup = renderToStaticMarkup(
      await IdentityDrillDownRoute({ params: Promise.resolve({ identityId: SUBJECT }) }),
    );
    expect(markup).toContain('data-testid="identity-drill-down-unsupplied"');
    expect(markup).not.toContain('data-testid="node-rows"');
    expect(markup).toContain(SUBJECT);
    expect(markup).toContain('[ADR-171]');
  });

  test('IT NAMES NO ERROR KIND, because 503 is a status no operator route produces', () => {
    // The measurement `src/app/flags/page.tsx` states and this route inherits:
    // an operator route answers 401 with no admin session cookie and 500 with
    // one. WAVE-06 section 8.1 predicts 503 and `src/app/page.tsx` renders it;
    // both are outside this fence and are REPORTED.
    const source = code(ROUTE);
    expect(source).not.toContain('toAdminErrorKind');
    expect(source).not.toContain('data-error');
  });

  test('the access-log obligation is named on the page rather than assumed', async () => {
    // M06 section 3.2a: "every view is logged as an access to the underlying
    // identities". Nothing in this repository writes that row, and a drill-down
    // that shipped silently without it would be the half of the sentence that
    // is easy to forget.
    const markup = renderToStaticMarkup(
      await IdentityDrillDownRoute({ params: Promise.resolve({ identityId: SUBJECT }) }),
    );
    expect(text(markup)).toContain('LOGGED as an access to the underlying identities');
  });
});
