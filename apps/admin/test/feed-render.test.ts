// =============================================================================
// apps/admin/test/feed-render.test.ts
// =============================================================================
// `W6-h`'s suite. THE EVENT FEED AS A DOCUMENT, IN BOTH OF `INV-M6-10`'s MODES,
// WITH EVERY CONTROL EXERCISED OVER THE BYTES `renderToStaticMarkup` PRODUCES
// RATHER THAN OVER THE VALUE THE DOCUMENT WAS BUILT FROM.
//
// WAVE-06 rule 4: "AN ASSERTION THAT CANNOT REACH THE SERVED BYTES IS NOT AN
// ASSERTION." Section 5.2 names this slice's own version of that obligation:
// `assertWithheld` in `src/feed.ts` took the line array `renderFeed` produced,
// and a React page renders a DOM. Every case below that claims a value is or is
// not served checks the real markup as well as the sweep, so the two cannot
// diverge without a red test.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { renderToStaticMarkup } from 'react-dom/server';

import type { AdminEventItem, EventFeedQuery, EventFeedResponse } from '../src/api/types.ts';
import EventFeedRoute from '../src/app/feed/page.tsx';
import {
  CONTRACT_LIMIT_DEFAULT,
  type EventFeedPage,
  EventFeedDocument,
  assertScopeIsTheOneAsked,
  assertServedEventFeedStrings,
  controlFeed,
  licensedBy,
  renderEventFeedDocument,
  scopeSentence,
  servedEventFeedStrings,
} from '../src/app/feed/event-feed.tsx';
import { WITHHELD } from '../src/feed.ts';
import { PageError } from '../src/page.ts';

const IDENTITY_A = '11111111-1111-4111-8111-111111111111';
const IDENTITY_B = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_A = '33333333-3333-4333-8333-333333333333';
const RENDERED_AT = '2026-08-28T14:00:00.000Z';

function item(overrides: Partial<AdminEventItem> = {}): AdminEventItem {
  return {
    id: '1001',
    event_name: 'payout.hold_released',
    occurred_at: '2026-08-27T04:00:00.000Z',
    recorded_at: '2026-08-27T04:00:01.000Z',
    identity_id: WITHHELD,
    account_id: WITHHELD,
    subject_kind: 'payout_request',
    subject_id: 'pr-1',
    actor_kind: 'system',
    actor_id: 'expiry-job',
    correlation_id: null,
    payload: {},
    withheld: true,
    instants_incoherent: false,
    ...overrides,
  };
}

function response(
  data: readonly AdminEventItem[],
  over: Partial<EventFeedResponse> = {},
): EventFeedResponse {
  return { scope: 'operational', data, next_cursor: null, ...over };
}

function page(over: Partial<EventFeedPage> = {}): EventFeedPage {
  return {
    renderedAt: RENDERED_AT,
    query: { scope: 'operational', limit: 25 },
    response: response([item()]),
    ...over,
  };
}

/** The real bytes, which is what every claim below is checked against. */
function markup(value: EventFeedPage): string {
  return renderToStaticMarkup(EventFeedDocument({ page: value }));
}

const MODULE = join(import.meta.dirname, '..', 'src', 'app', 'feed', 'event-feed.tsx');
const ROUTE = join(import.meta.dirname, '..', 'src', 'app', 'feed', 'page.tsx');

/** The markup with its tags stripped and its entities decoded. */
function text(html: string): string {
  return html
    .replaceAll(/<[^>]*>/g, '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/** Source with comments removed, so a needle named in prose is not a finding. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

// =============================================================================
// M6-A-55. The order is the server's, rendered and never recomputed
// =============================================================================

describe('M6-A-55: the order is the server`s, rendered and never recomputed', () => {
  const OUT_OF_ORDER: readonly AdminEventItem[] = [
    item({ id: '1', recorded_at: '2026-08-27T01:00:00.000Z' }),
    item({ id: '2', recorded_at: '2026-08-27T09:00:00.000Z' }),
    item({ id: '3', recorded_at: '2026-08-27T05:00:00.000Z' }),
  ];

  test('a feed that arrives out of order is rendered out of order', () => {
    // THE CASE THAT MAKES THE CLAIM MEAN SOMETHING. A document that repaired
    // the order would be indistinguishable from one that inherited it on rows
    // that were already sorted, so the rows handed in here are not.
    const html = markup(page({ response: response(OUT_OF_ORDER) }));
    const positions = [...html.matchAll(/data-event-name="[^"]*"[^>]*>(\d+)\./g)].map(
      (match) => match[1],
    );
    expect(positions).toStrictEqual(['1', '2', '3']);
    expect(html.indexOf('2026-08-27T01:00:00.000Z')).toBeLessThan(
      html.indexOf('2026-08-27T09:00:00.000Z'),
    );
  });

  test('the document module compares nothing, read out of its own source', () => {
    // `buildFeed` SORTS AND IS CALLED FROM THIS MODULE, so the assertion is not
    // "no sort reachable from here" but "no sort in the render path". The call
    // is `controlFeed`, whose result is read for `withheldValues` alone.
    const source = code(MODULE);
    expect(source).not.toContain('.sort(');
    expect(source).not.toContain('.reverse(');
    expect(source).toContain('buildFeed(');
  });

  test('the order sentence is served above the rows', () => {
    const html = markup(page({ response: response(OUT_OF_ORDER) }));
    expect(html).toContain('Ordered by the server');
    expect(html.indexOf('Ordered by the server')).toBeLessThan(html.indexOf('data-position="1"'));
  });
});

// =============================================================================
// M6-A-56. Both of INV-M6-10's modes, and the header says which produced the page
// =============================================================================

describe('M6-A-56: both modes render and the page states which one it is', () => {
  test('operational says every identity and account is withheld', () => {
    const html = markup(page());
    expect(html).toContain('the query named no subject');
    expect(html).toContain('bulk identity screen that invariant says does not exist');
    expect(html).toContain('data-scope="operational"');
  });

  test('a named scope names its subject and says the licence is for that one', () => {
    const named = page({
      query: { scope: 'identity', identity_id: IDENTITY_A, limit: 25 },
      response: response([item({ identity_id: IDENTITY_A })], { scope: 'identity' }),
    });
    const html = markup(named);
    expect(html).toContain(IDENTITY_A);
    expect(html).toContain('for the subject it named and for no other');
    expect(scopeSentence(named.query)).toContain(IDENTITY_A);
  });

  test('the licence is the query`s subject, and operational licenses nothing', () => {
    expect([...licensedBy({ scope: 'operational' })]).toStrictEqual([]);
    expect([...licensedBy({ scope: 'identity', identity_id: IDENTITY_A })]).toStrictEqual([
      IDENTITY_A,
    ]);
    expect([...licensedBy({ scope: 'account', account_id: ACCOUNT_A })]).toStrictEqual([ACCOUNT_A]);
  });

  test('a named scope with no subject on the query is refused rather than widened', () => {
    // NOT A SECOND COPY OF THE SERVER'S VALIDATION. This is a licence this
    // console cannot COMPUTE, and the widest reading of a licence you cannot
    // compute is the one INV-M6-10 exists against.
    expect(() => licensedBy({ scope: 'identity' })).toThrow(PageError);
    expect(() => licensedBy({ scope: 'account' })).toThrow(/no INV-M6-10 licence it can compute/);
  });
});

// =============================================================================
// M6-A-57. The closure over the served bytes, in both modes
// =============================================================================

describe('M6-A-57: every subject served is one the query named', () => {
  test('an identifier the server failed to withhold is refused under operational', () => {
    // THE SERVER LEAKING IS THE CASE THIS LEG EXISTS FOR. ADR-184 ruling 3 puts
    // the withholding on the response; this is the console being defence in
    // depth over a response that did not apply it.
    const leaked = page({ response: response([item({ identity_id: IDENTITY_B })]) });
    expect(markup(leaked)).toContain(IDENTITY_B);
    expect(() => assertServedEventFeedStrings(leaked)).toThrow(PageError);
    expect(() => renderEventFeedDocument(leaked)).toThrow(/is not a subject this query named/);
  });

  test('under a named scope the named subject renders and a third party does not', () => {
    const named = (identity: string): EventFeedPage =>
      page({
        query: { scope: 'identity', identity_id: IDENTITY_A, limit: 25 },
        response: response([item({ identity_id: identity })], { scope: 'identity' }),
      });

    expect(() => renderEventFeedDocument(named(IDENTITY_A))).not.toThrow();
    expect(() => renderEventFeedDocument(named(IDENTITY_B))).toThrow(PageError);
  });

  test('the sweep and the markup are the same surface', () => {
    // WAVE-06 rule 4 made mechanical. A string the sweep collects that the
    // markup does not carry is a control asserting about bytes nobody receives.
    const value = page({
      query: { scope: 'identity', identity_id: IDENTITY_A, limit: 25 },
      response: response([item({ identity_id: IDENTITY_A })], { scope: 'identity' }),
    });
    const html = markup(value);
    for (const string of servedEventFeedStrings(value)) expect(html).toContain(string);
  });

  test('an id glued to a word character is still refused, which the package pattern would miss', () => {
    // SESSION 344 MEASURED `assertNamesNoSubject`'s PATTERN AS `\b`-ANCHORED,
    // so `linked_to_<uuid>` passes it. The closure's pattern is not anchored
    // and this is that difference exercised rather than asserted in prose.
    const glued = page({
      response: response([item({ subject_kind: 'audit', subject_id: `linked_to_${IDENTITY_B}` })]),
    });
    expect(() => assertServedEventFeedStrings(glued)).toThrow(/is not a subject this query named/);
  });

  test('the payload is not rendered, so unbounded server content reaches no byte', () => {
    // ASSERTED BEHAVIOURALLY AND NOT OVER THE SOURCE. `asFeedEvent` carries the
    // payload across, because the CONTROL feed has to withhold its identifying
    // keys; what must be true is that no value of it reaches a byte, and that
    // is a property of the markup rather than of a needle in the module.
    const withPayload = page({
      response: response([
        item({
          payload: {
            matched_identity_id: IDENTITY_B,
            note: 'sensitive-free-text',
            amount_cents: 4242,
          },
        }),
      ]),
    });
    const html = markup(withPayload);
    for (const needle of ['sensitive-free-text', IDENTITY_B, '4242'])
      expect(html, `the feed served \`${needle}\` out of a payload`).not.toContain(needle);
    for (const string of servedEventFeedStrings(withPayload))
      expect(string).not.toContain('sensitive-free-text');
  });
});

// =============================================================================
// M6-A-58. `assertWithheld` re-pointed at the served bytes
// =============================================================================

describe('M6-A-58: assertWithheld reads what the browser receives', () => {
  test('a leaked value that is NOT uuid-shaped is caught by this leg alone', () => {
    // THE CASE THAT MAKES TWO LEGS WORTH KEEPING. `events.identity_id` is a
    // uuid column, and a `jsonb` key ending `account_id` is any string; the
    // closure's pattern cannot match one and `buildFeed` withholds it by name.
    const legacy = 'acct-legacy-77';
    const leaked = page({ response: response([item({ account_id: legacy })]) });

    expect(markup(leaked)).toContain(legacy);
    expect(controlFeed(leaked).withheldValues).toContain(legacy);
    expect(() => assertServedEventFeedStrings(leaked)).toThrow(
      /the rendered feed contains acct-legacy-77/,
    );
  });

  test('the sentinel is dropped from the searched set, so an obedient page passes', () => {
    // SECTION 3 OF THE MODULE HEADER. Every obedient page renders the word
    // `withheld`, so a set carrying the sentinel would refuse every one of them.
    const obedient = page();
    expect(markup(obedient)).toContain(WITHHELD);
    expect(controlFeed(obedient).withheldValues).not.toContain(WITHHELD);
    expect(() => assertServedEventFeedStrings(obedient)).not.toThrow();
  });

  test('the control feed`s order and completeness are discarded, and only its set is read', () => {
    // `buildFeed` SORTS AND COMPUTES `complete` FROM A ROW COUNT. The document
    // renders neither. This pins the divergence rather than leaving it to be
    // rediscovered: a full page that exhausted the query carries
    // `next_cursor: null` and computes `complete: false`.
    const full = page({
      query: { scope: 'operational', limit: 2 },
      response: response([item({ id: '1' }), item({ id: '2' })], { next_cursor: null }),
    });
    expect(controlFeed(full).complete).toBe(false);
    expect(markup(full)).toContain('The server sent no next cursor, which is this query exhausted');
  });

  test('the contract default is transcribed, so a query naming no limit is still checkable', () => {
    expect(CONTRACT_LIMIT_DEFAULT).toBe(25);
    const noLimit: EventFeedQuery = { scope: 'operational' };
    expect(() => controlFeed(page({ query: noLimit }))).not.toThrow();
  });
});

// =============================================================================
// M6-A-59. The echo is checked first, before a byte is built
// =============================================================================

describe('M6-A-59: the mode the body was served under is the mode the query asked for', () => {
  const mismatched = page({
    query: { scope: 'identity', identity_id: IDENTITY_A, limit: 25 },
    response: response([item({ identity_id: IDENTITY_A })], { scope: 'operational' }),
  });

  test('a body served under another mode is refused', () => {
    expect(() => assertScopeIsTheOneAsked(mismatched)).toThrow(PageError);
    expect(() => renderEventFeedDocument(mismatched)).toThrow(
      /the response was served under `scope=operational`/,
    );
  });

  test('the echo check runs before the served-bytes sweep', () => {
    // THE ORDER IS THE ASSERTION. This page would ALSO pass the closure, since
    // its one id is the licensed subject, so a suite that only checked that
    // something threw would not know which control fired.
    expect(() => assertServedEventFeedStrings(mismatched)).not.toThrow();
    expect(() => renderEventFeedDocument(mismatched)).toThrow(/served under/);
  });
});

// =============================================================================
// M6-A-60. An empty feed is a sentence, and there is no total
// =============================================================================

describe('M6-A-60: an empty feed is a sentence and the completeness fact is the server`s', () => {
  test('an empty page says so rather than rendering an empty list', () => {
    const html = markup(page({ response: response([]) }));
    expect(html).toContain('That is an empty feed and not a failed read');
    expect(html).not.toContain('data-testid="event-rows"');
  });

  test('a truncated page says there are more, and names no total', () => {
    const html = markup(page({ response: response([item()], { next_cursor: 'opaque-1' }) }));
    expect(html).toContain('there are more events this read did not see');
    expect(html).toContain('ADR-157 refuses the aggregate');
    expect(html).not.toContain('opaque-1');
  });

  test('the incoherent row is marked in the words and rendered rather than refused', () => {
    const html = markup(
      page({
        response: response([
          item({
            occurred_at: '2026-08-27T05:00:00.000Z',
            recorded_at: '2026-08-27T04:00:00.000Z',
            instants_incoherent: true,
          }),
        ]),
      }),
    );
    expect(html).toContain('INCOHERENT: recorded before it occurred');
    expect(html).toContain('data-instants-incoherent="true"');
  });

  test('the withheld mark is a word and not only an attribute', () => {
    // `FM-M6-01`: a screenshot pasted into a message loses every attribute and
    // keeps the sentence.
    const html = markup(page());
    expect(html).toContain('some identifying values on this row are withheld under INV-M6-10');
    expect(html).toContain('data-withheld="true"');
  });
});

// =============================================================================
// M6-A-61. The route performs no read and claims no status it cannot produce
// =============================================================================

describe('M6-A-61: the route reads nothing, defaults no scope and names no error kind', () => {
  const html = renderToStaticMarkup(EventFeedRoute());

  test('it renders the blocked state and invents no event', () => {
    expect(html).toContain('data-testid="event-feed-unsupplied"');
    expect(html).not.toContain('data-testid="event-rows"');
    expect(html).toContain('no event on this page is invented while a supplier is missing');
  });

  test('it names both blockers, and the second is the port with its measured reason', () => {
    expect(html).toContain('data-origin="ADR-171"');
    expect(html).toContain('data-origin="ADR-184"');
    expect(html).toContain('AdminReadSource');
    // THIS CASE USED TO REQUIRE THE WORDS "unregistered in `packages/db`" AND
    // THAT IS NOW FALSE. ADR-191 registered `events` and
    // `apps/api/src/admin-source/events.ts` supplies `listEvents`, so the panel
    // names what actually blocks the screen: three methods the port still has
    // no module for.
    expect(html).toContain('listEvents');
    expect(html).toContain('ADR-191');
    expect(html).toContain('searchAccounts');
    expect(html).toContain('setAdminReadSource');
  });

  test('IT NAMES NO ERROR KIND, because 503 is a status no operator route produces', () => {
    // MEASURED IN THIS SLICE over a real `compose()` and Fastify's own
    // `inject`, against `GET /api/v1/admin/events` on the operator surface:
    // with no admin session cookie it answers 401 `unauthenticated`, and with
    // one it answers 500 `internal_error`. WAVE-06 section 8.1 says 503 and
    // `src/app/page.tsx` renders `toAdminErrorKind(503)` on that basis. Both
    // are outside this fence and are REPORTED; this route declines to repeat
    // the claim, and the two real answers are named in its blocker prose where
    // an operator reads them. The plan's own prediction is quoted there as a
    // prediction, which is why the needle is the CLAIM and not the number.
    expect(html).not.toContain('data-error=');
    expect(html).not.toContain('unavailable');
    expect(html).not.toContain('answers 503');
    expect(text(html)).toContain('401 `unauthenticated`');
    expect(text(html)).toContain('500 `internal_error`');
  });

  test('it defaults no scope, which is ADR-184 ruling 2 in the layer that renders', () => {
    expect(html).toContain('This route names no scope');
    const source = code(ROUTE);
    expect(source).not.toContain("scope: 'operational'");
    expect(source).not.toContain('scope:');
  });

  test('it performs no read and reaches no transport', () => {
    const source = code(ROUTE);
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('http/client');
  });
});
