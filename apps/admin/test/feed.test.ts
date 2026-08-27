// =============================================================================
// apps/admin/test/feed.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF `src/feed.ts`.
//
// **THE SENTENCE THIS SUITE EXISTS TO MAKE FALSE IS "A SCREEN THAT IS A BULK
// EXPORT OF IDENTITIES."** INV-M6-10 is "the admin console renders
// trader-identifying data only when the query names a specific subject",
// enforced by "no bulk export of identities exists as a UI affordance", and an
// unfiltered page of `events` is exactly that affordance unless something stops
// it. Section 1 below is that something, asserted three ways: on the structure,
// on the produced lines, and by the surface's own control run against its own
// output.
//
// THE HARDEST CASE IS THE THIRD-PARTY UUID INSIDE THE PAYLOAD, and it has its
// own section. `packages/db/src/scope.ts` records it as a thing NO SCOPE RULE
// CAN EXPRESS, so a renderer that got it wrong would have nothing behind it.
//
// -----------------------------------------------------------------------------
// WHAT THIS SUITE READS RATHER THAN RESTATES
// -----------------------------------------------------------------------------
//   docs/plans/M06-admin-ops-console.md   INV-M6-10, and the fifth surface
//   packages/db/src/scope.ts              the two payload keys the rule must
//                                         cover, named by that file itself
//
// -----------------------------------------------------------------------------
// THESE ARE UNIT TESTS AND NOT GOLDEN FIXTURES, ON `liability.test.ts`'S LIMIT
// -----------------------------------------------------------------------------
// A fixture is `packages/rules-engine/fixtures/GS-NNN-*.yaml` and this session
// is fenced to two apps, so no file here is named `*.golden.test.ts`: a suite
// claiming the CI-03 stage without a registered fixture reads as coverage it
// does not have.
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import {
  FeedError,
  WITHHELD,
  assertWithheld,
  buildFeed,
  mayReadEventFeed,
  namesASubject,
  renderFeed,
  thread,
  type FeedEvent,
  type FeedScope,
} from '../src/feed.ts';
import { ADMIN_ROLES } from '../src/roles.ts';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const M06 = read('../../../docs/plans/M06-admin-ops-console.md');
const SCOPE = read('../../../packages/db/src/scope.ts');

// -----------------------------------------------------------------------------
// Rows
// -----------------------------------------------------------------------------

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const REQUEST = '44444444-4444-4444-8444-444444444444';
const SAGA = '55555555-5555-4555-8555-555555555555';

const base: FeedEvent = {
  id: '100',
  eventName: 'payout.hold_released',
  occurredAt: '2026-08-27T04:00:00.000Z',
  recordedAt: '2026-08-27T04:00:00.000Z',
  identityId: ALICE,
  accountId: ACCOUNT,
  subjectKind: 'payout_request',
  subjectId: REQUEST,
  payload: { payout_request_id: REQUEST, released_by: 'expiry', approved_cents: '150000' },
  actorKind: 'system',
  actorId: null,
  correlationId: null,
};

const row = (over: Partial<FeedEvent>): FeedEvent => ({ ...base, ...over });

const OPERATIONAL: FeedScope = { kind: 'operational' };
const READ_AT = '2026-08-27T21:00:00.000Z';
const feedOf = (rows: readonly FeedEvent[], scope: FeedScope = OPERATIONAL, limit = 50) =>
  buildFeed({ rows, scope, limit, readAt: READ_AT });

// =============================================================================
// 0. THE INVARIANT THIS SURFACE IS ABOUT IS REALLY THE ONE QUOTED
// =============================================================================

describe('the sources this file argues from say what it says they say', () => {
  test('INV-M6-10 is the rule, in M06 section 1.3', () => {
    expect(M06).toContain(
      'The admin console renders trader-identifying data only when the query names a specific subject',
    );
    expect(M06).toContain('No bulk export of identities exists as a UI affordance');
  });

  test("the event feed is one of M06 section 1.1's surfaces", () => {
    expect(M06).toContain('the flags queue, and the event feed');
  });

  test('scope.ts names the two payload keys the withholding rule has to cover', () => {
    expect(SCOPE).toContain('matched_identity_id');
    expect(SCOPE).toContain('merged_identity_id');
  });
});

// =============================================================================
// 1. INV-M6-10, WHICH IS THIS SURFACE'S WHOLE PROBLEM
// =============================================================================

describe('a query that names no subject renders no trader-identifying data', () => {
  test('both tenancy columns are withheld and neither is dropped', () => {
    const feed = feedOf([base]);
    expect(feed.rows[0]?.identityId).toBe(WITHHELD);
    expect(feed.rows[0]?.accountId).toBe(WITHHELD);
    // WITHHELD RATHER THAN NULL, because a row showing no identity must not read
    // as a row with no identity involved.
    expect(feed.rows[0]?.identityId).not.toBeNull();
    expect(feed.rows[0]?.withheld).toBe(true);
  });

  test('the withheld values never reach the rendered lines, and the surface checks itself', () => {
    const feed = feedOf([base]);
    const lines = renderFeed(feed);
    expect(feed.withheldValues).toStrictEqual([ALICE, ACCOUNT]);
    expect(lines.join('\n')).not.toContain(ALICE);
    expect(lines.join('\n')).not.toContain(ACCOUNT);
    expect(() => assertWithheld(feed, lines)).not.toThrow();
  });

  test('the redaction is the WORD, in the line, because a style does not survive a screenshot', () => {
    expect(renderFeed(feedOf([base])).join('\n')).toContain(WITHHELD);
  });

  test('a subject that IS a person is withheld too', () => {
    const feed = feedOf([row({ subjectKind: 'identity', subjectId: BOB, identityId: BOB })]);
    expect(feed.rows[0]?.subjectId).toBe(WITHHELD);
  });

  test('a subject that is an OBJECT renders, because withholding it protects nothing', () => {
    // A `payout_request` uuid is the link target the operator clicks through to.
    // INV-M6-10 is about trader-identifying data, and a feed nobody can act on
    // would be paying that invariant's cost for none of its benefit.
    expect(feedOf([base]).rows[0]?.subjectId).toBe(REQUEST);
  });

  test('`actor_id` is an operator string and is not gated', () => {
    const feed = feedOf([row({ actorKind: 'admin', actorId: 'ops@merit' })]);
    expect(feed.rows[0]?.actorId).toBe('ops@merit');
  });
});

describe('THE THIRD-PARTY UUID INSIDE THE PAYLOAD, which no scope rule can express', () => {
  test.each(['matched_identity_id', 'merged_identity_id', 'identity_id', 'account_id'])(
    '`%s` is recognised as naming a subject',
    (key) => {
      expect(namesASubject(key)).toBe(true);
    },
  );

  test.each(['payout_request_id', 'withdrawal_id', 'released_by', 'approved_cents'])(
    '`%s` is not, so the rule redacts nothing it should not',
    (key) => {
      expect(namesASubject(key)).toBe(false);
    },
  );

  test('a DIFFERENT identity inside the payload is withheld even in a subject-named feed', () => {
    // THE SHARPEST CASE IN THE FILE. The query named Alice, so Alice's own id
    // renders; the payload names Bob, and INV-M6-10's licence was for Alice.
    const feed = feedOf(
      [
        row({
          eventName: 'kyc.dedupe_hit',
          // A dedupe hit is identity-level and carries no account.
          accountId: null,
          payload: { identity_id: ALICE, matched_identity_id: BOB },
        }),
      ],
      { kind: 'identity', identityId: ALICE },
    );
    expect(feed.rows[0]?.identityId).toBe(ALICE);
    expect(feed.rows[0]?.payload['identity_id']).toBe(ALICE);
    expect(feed.rows[0]?.payload['matched_identity_id']).toBe(WITHHELD);
    expect(feed.withheldValues).toStrictEqual([BOB]);
  });

  test('every non-identifying payload field survives untouched', () => {
    const feed = feedOf([base]);
    expect(feed.rows[0]?.payload).toStrictEqual({
      payout_request_id: REQUEST,
      released_by: 'expiry',
      approved_cents: '150000',
    });
  });

  test('the withholding is in the STRUCTURE, so a second consumer cannot walk around it', () => {
    // It is asserted on `buildFeed`'s output rather than on `renderFeed`'s,
    // which is what makes a JSON response or an export inherit the control.
    const feed = feedOf([base]);
    expect(JSON.stringify(feed.rows)).not.toContain(ALICE);
  });
});

describe('a query that names a subject earns the licence for that subject and no other', () => {
  test('an identity-scoped feed renders that identity', () => {
    const feed = feedOf([base], { kind: 'identity', identityId: ALICE });
    expect(feed.rows[0]?.identityId).toBe(ALICE);
    // AND STILL WITHHOLDS THE ACCOUNT, because the query named an identity.
    expect(feed.rows[0]?.accountId).toBe(WITHHELD);
  });

  test('an account-scoped feed renders that account and not the identity behind it', () => {
    const feed = feedOf([base], { kind: 'account', accountId: ACCOUNT });
    expect(feed.rows[0]?.accountId).toBe(ACCOUNT);
    expect(feed.rows[0]?.identityId).toBe(WITHHELD);
  });

  test("another identity's rows on the same page are still withheld", () => {
    const feed = feedOf([base, row({ id: '101', identityId: BOB })], {
      kind: 'identity',
      identityId: ALICE,
    });
    expect(feed.rows.map((r) => r.identityId)).toStrictEqual([WITHHELD, ALICE]);
  });

  test('the scope has no default, so a caller cannot omit the decision', () => {
    // @ts-expect-error a feed with no scope does not compile: either default is wrong.
    expect(() => buildFeed({ rows: [base], limit: 10, readAt: READ_AT })).toThrow();
  });
});

// =============================================================================
// 2. THE AGGREGATE, REFUSED ON EVIDENCE
// =============================================================================

describe('a feed that wants a count counts the rows it read', () => {
  test('`shown` is the length of what came back', () => {
    expect(feedOf([base, row({ id: '101' })]).shown).toBe(2);
  });

  test('THERE IS NO `total` TO REACH FOR', () => {
    expect(Object.keys(feedOf([base]))).not.toContain('total');
  });

  test('a short page is complete and says so', () => {
    const feed = feedOf([base], OPERATIONAL, 50);
    expect(feed.complete).toBe(true);
    expect(renderFeed(feed).join('\n')).toContain('which is all of them for this query');
  });

  test('a FULL page is a truncation and the line says that, not the opposite', () => {
    const feed = feedOf([base, row({ id: '101' })], OPERATIONAL, 2);
    expect(feed.complete).toBe(false);
    expect(renderFeed(feed).join('\n')).toContain('more this read did not see');
  });

  test('more rows than the limit is refused, because `complete` would be a claim about nothing', () => {
    expect(() => feedOf([base, row({ id: '101' })], OPERATIONAL, 1)).toThrow(/limit/);
  });

  test('a limit that is not a positive integer is refused', () => {
    expect(() => feedOf([base], OPERATIONAL, 0)).toThrow(FeedError);
    expect(() => feedOf([base], OPERATIONAL, 1.5)).toThrow(FeedError);
  });
});

// =============================================================================
// 3. TWO INSTANTS, TWO ORDERS
// =============================================================================

describe('the feed is what we learned, in the order we learned it', () => {
  test('a late correction about an old fact is at the TOP, not buried where it happened', () => {
    const old = row({
      id: '100',
      occurredAt: '2026-08-25T00:00:00.000Z',
      recordedAt: '2026-08-27T20:00:00.000Z',
    });
    const recent = row({
      id: '101',
      occurredAt: '2026-08-27T10:00:00.000Z',
      recordedAt: '2026-08-27T10:00:00.000Z',
    });
    expect(feedOf([recent, old]).rows.map((r) => r.id)).toStrictEqual(['100', '101']);
  });

  test('ties break on the id, which is the only total order the table has', () => {
    const a = row({ id: '9' });
    const b = row({ id: '10' });
    expect(feedOf([a, b]).rows.map((r) => r.id)).toStrictEqual(['10', '9']);
  });

  test('the id is compared as a bigint, so the order survives past 2^53', () => {
    const a = row({ id: '9007199254740993' });
    const b = row({ id: '9007199254740992' });
    expect(feedOf([b, a]).rows.map((r) => r.id)).toStrictEqual([
      '9007199254740993',
      '9007199254740992',
    ]);
  });

  test('an id that is not a bigint is refused rather than ordered arbitrarily', () => {
    expect(() => feedOf([row({ id: 'evt_1' })])).toThrow(/total order/);
  });

  test('an unparseable instant is refused, never placed anywhere anyway', () => {
    expect(() => feedOf([row({ recordedAt: 'yesterday' })])).toThrow(/timeline/);
  });

  test('the occurrence instant is rendered whenever it differs from the recording one', () => {
    const late = row({ occurredAt: '2026-08-25T00:00:00.000Z' });
    expect(renderFeed(feedOf([late])).join('\n')).toContain('occurred 2026-08-25T00:00:00.000Z');
  });
});

describe('a thread reads the other way, and the difference is the point', () => {
  const first = row({
    id: '200',
    correlationId: SAGA,
    occurredAt: '2026-08-27T01:00:00.000Z',
    recordedAt: '2026-08-27T20:00:00.000Z',
  });
  const second = row({
    id: '201',
    correlationId: SAGA,
    occurredAt: '2026-08-27T02:00:00.000Z',
    recordedAt: '2026-08-27T02:00:00.000Z',
  });

  test('the saga is in OCCURRENCE order even though the feed is not', () => {
    const feed = feedOf([first, second, row({ id: '202' })]);
    expect(feed.rows.map((r) => r.id)).toStrictEqual(['200', '202', '201']);
    expect(thread(feed, SAGA).map((r) => r.id)).toStrictEqual(['200', '201']);
  });

  test('a thread carries only its own correlation', () => {
    expect(thread(feedOf([first, row({ id: '203' })]), SAGA).map((r) => r.id)).toStrictEqual([
      '200',
    ]);
  });

  test('a correlation nobody on this page carries is an empty thread and not an error', () => {
    expect(thread(feedOf([base]), SAGA)).toStrictEqual([]);
  });

  test("a thread inherits the page's withholding", () => {
    expect(thread(feedOf([first]), SAGA)[0]?.identityId).toBe(WITHHELD);
  });
});

// =============================================================================
// 4. AN INCOHERENT ROW IS MARKED AND RENDERED, WHICH IS NOT WHAT `liability.ts` DOES
// =============================================================================

describe('we cannot have learned a fact before it happened', () => {
  const impossible = row({
    occurredAt: '2026-08-27T10:00:00.000Z',
    recordedAt: '2026-08-27T04:00:00.000Z',
  });

  test('the row is flagged', () => {
    expect(feedOf([impossible]).rows[0]?.instantsIncoherent).toBe(true);
  });

  test('THE PAGE STILL RENDERS, because a list is not an aggregate', () => {
    // `theThreeNumbers` refuses an incoherent snapshot: one bad input corrupts
    // the answer. One bad row does not corrupt a list, and blanking an
    // operator's timeline during the incident the bad row is evidence of is the
    // worse failure.
    const lines = renderFeed(feedOf([impossible, row({ id: '101' })]));
    expect(lines).toHaveLength(4);
    expect(lines.join('\n')).toContain('INCOHERENT');
  });

  test('a coherent row carries no flag and no marker', () => {
    expect(feedOf([base]).rows[0]?.instantsIncoherent).toBe(false);
    expect(renderFeed(feedOf([base])).join('\n')).not.toContain('INCOHERENT');
  });
});

// =============================================================================
// 5. THE CONTROL THE SURFACE ASSERTS ABOUT ITS OWN OUTPUT
// =============================================================================

describe('assertWithheld is a control and not a comment', () => {
  test('it catches a withheld value that reached the lines', () => {
    const feed = feedOf([base]);
    // The failure a carelessly added panel would produce, simulated at the one
    // place it could be produced.
    expect(() => assertWithheld(feed, [...renderFeed(feed), `debug ${ALICE}`])).toThrow(
      /INV-M6-10/,
    );
  });

  test('it passes on the page the surface actually renders', () => {
    const feed = feedOf([base, row({ id: '101', identityId: BOB })]);
    expect(() => assertWithheld(feed, renderFeed(feed))).not.toThrow();
  });

  test('it has nothing to check when the scope licensed everything on the page', () => {
    const feed = feedOf([row({ accountId: null })], { kind: 'identity', identityId: ALICE });
    expect(feed.withheldValues).toStrictEqual([]);
  });
});

test('every role may read the feed, and no narrower rule is invented here', () => {
  for (const role of ADMIN_ROLES) expect(mayReadEventFeed(role)).toBe(true);
});

test('an empty page is a page and not an error', () => {
  const feed = feedOf([]);
  expect(feed.shown).toBe(0);
  expect(feed.complete).toBe(true);
  expect(renderFeed(feed)).toHaveLength(2);
});
