import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { TABLE_KEYS } from '@merit/db';

import { buildServer, discoverRouteModules } from '../src/index.ts';
import {
  ADMIN_SESSION_COOKIE,
  AdminReadError,
  LIMIT_MAX,
  setAdminReadSource,
  setAdminSessionSource,
} from '../src/routes/admin-reads.ts';
import type { AdminAccountSearchItem, AdminPage } from '../src/routes/admin-reads.ts';
import { SEARCH_READ_TABLES, readAccountSearch } from '../src/admin-source/search.ts';
import type { SearchTx } from '../src/admin-source/search.ts';
import {
  IMPLEMENTED_ADMIN_READS,
  AdminSourceNotComposed,
  composeAdminReadSource,
  composeImplementedAdminReads,
} from '../src/admin-source/index.ts';
import type { AdminSourceTx } from '../src/admin-source/index.ts';

// CI-02, the `unit` project.
//
// WHAT THIS SUITE IS FOR. `searchAccounts` is the fifth of `AdminReadSource`'s
// seven methods to get a module, and it is the one the port's own header calls
// a join: "`AdminAccountSearchItem` joins accounts to identities to flags to
// reconciliation state". There is still no join. What there is instead is six
// equalities fanning in to keys and four reads fanning out over a PAGE, and the
// assertions that matter here are the ones about that boundary rather than the
// ones about the twelve fields.
//
// THERE IS NO POSTGRES IN CI. `ci.yml`'s `integration` job runs on bare
// `ubuntu-latest` with no services block, which is `packages/db`'s own suite
// header, so every case below runs over a recording fake and the live round
// trip is EVIDENCE recorded in the session log rather than a control that runs
// here. Two properties are therefore asserted at the fake and re-checked by
// hand against a real cluster: that `citext` makes the email and coupon terms
// case-free, and that a `uuid` column refuses a term that is not one.
//
// THE THREE CASES WORTH THE MOST are the three written to fail rather than to
// pass: the early stop is asserted by PAGING THROUGH THE WHOLE RESULT SET and
// comparing it to the unstopped answer, so a stop that dropped a row is a red
// test rather than a faster one; the uuid guard is asserted by what the module
// DID NOT CALL, because a guard that fires on nothing passes every admission
// test; and the balance zero is pinned with a stated clearing condition, so the
// day a `rule_states` row is written at account open the case goes red and
// names the choice.

const ROOT = join(import.meta.dirname, '..', '..', '..');
const onDisk = await discoverRouteModules();
const COOKIE = { cookie: `${ADMIN_SESSION_COOKIE}=operator-token` };

afterEach(() => {
  setAdminReadSource(null);
  setAdminSessionSource(null);
});

// -----------------------------------------------------------------------------
// The fake
// -----------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/**
 * `admin-source-account.test.ts`'s `Recorder`, narrowed to what `SearchTx`
 * declares, plus the one refusal the real accessor makes that this module has to
 * live with: `rowAt` throws where the address names no unique key.
 */
class Recorder {
  readonly calls: string[] = [];

  constructor(private readonly tables: Tables) {}

  rowsWhere(key: string, where: Row): Promise<unknown[]> {
    const terms = Object.keys(where).sort();
    if (terms.length === 0)
      throw new Error(`rowsWhere ${key} was handed an empty filter, which does not compile`);
    this.calls.push(
      `rowsWhere ${key} ${terms.join('+')}=${terms.map((t) => String(where[t])).join('+')}`,
    );
    return Promise.resolve(
      (this.tables[key] ?? []).filter((row) => terms.every((term) => row[term] === where[term])),
    );
  }

  rowAt(key: string, at: Row): Promise<unknown> {
    const terms = Object.keys(at).sort();
    // `refuseUnaddressed` (scoped-db.ts) reads uniqueness out of `schema.ts` and
    // throws where the address names none. `coupons.code` is the live instance
    // and the census below is why this arm exists rather than being a guess.
    if (!ADDRESSABLE[key]?.some((unique) => unique.every((column) => terms.includes(column))))
      throw new Error(`a read of ${key} at [${terms.join(', ')}] names no unique key`);
    this.calls.push(`rowAt ${key} ${terms.join('+')}=${terms.map((t) => String(at[t])).join('+')}`);
    return Promise.resolve(
      (this.tables[key] ?? []).find((row) => terms.every((term) => row[term] === at[term])),
    );
  }
}

/** The unique keys `schema.ts` declares over this module's tables, as the fake sees them. */
const ADDRESSABLE: Record<string, readonly (readonly string[])[]> = {
  accounts: [['id'], ['purchaseId']],
  couponRedemptions: [['id']],
  coupons: [['id']],
  identities: [['id']],
  planVersions: [['id']],
  plans: [['id'], ['code']],
  platformAccountRefs: [['platform', 'platformAccountRef']],
  payoutRequests: [['id']],
  riskFlags: [['id']],
  ruleStates: [['id']],
  users: [['id'], ['email']],
};

// -----------------------------------------------------------------------------
// The fixtures. Only the columns this module reads, because the rest is noise
// -----------------------------------------------------------------------------

const IDENTITY_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const IDENTITY_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const ACCOUNT_1 = '11111111-0000-4000-8000-000000000001';
const ACCOUNT_2 = '11111111-0000-4000-8000-000000000002';
const ACCOUNT_3 = '22222222-0000-4000-8000-000000000003';
const USER_A = 'cccccccc-0000-4000-8000-000000000001';
const USER_B = 'cccccccc-0000-4000-8000-000000000002';
const VERSION = 'dddddddd-0000-4000-8000-000000000001';
const PLAN = 'eeeeeeee-0000-4000-8000-000000000001';
const PAYOUT = 'ffffffff-0000-4000-8000-000000000001';
const COUPON = '99999999-0000-4000-8000-000000000001';

function accountRow(id: string, identityId: string, userId: string, over: Row = {}): Row {
  return {
    id,
    identityId,
    userId,
    planVersionId: VERSION,
    sizeCents: 5_000_000n,
    phase: 'funded',
    status: 'active',
    platformAccountRef: null,
    payoutsFrozen: false,
    reconBlocked: false,
    ...over,
  };
}

function identityRow(id: string, over: Row = {}): Row {
  return { id, payoutsFrozen: false, ...over };
}

function userRow(id: string, identityId: string, email: string, over: Row = {}): Row {
  return { id, identityId, email, emailNormalized: email, ...over };
}

function stateRow(id: bigint, accountId: string, tradingDay: string, over: Row = {}): Row {
  return {
    id,
    accountId,
    tradingDay,
    balanceCents: 5_100_000n,
    withdrawableCents: 60_000n,
    ...over,
  };
}

function flagRow(id: string, identityId: string, over: Row = {}): Row {
  return { id, identityId, accountId: null, status: 'open', ...over };
}

/** The estate every case starts from: two people, three accounts, one plan. */
function estate(over: Partial<Tables> = {}): Tables {
  return {
    accounts: [
      accountRow(ACCOUNT_1, IDENTITY_A, USER_A, { platformAccountRef: 'RITH-1' }),
      accountRow(ACCOUNT_2, IDENTITY_A, USER_A),
      accountRow(ACCOUNT_3, IDENTITY_B, USER_B),
    ],
    identities: [identityRow(IDENTITY_A), identityRow(IDENTITY_B)],
    users: [
      userRow(USER_A, IDENTITY_A, 'alice@example.com'),
      userRow(USER_B, IDENTITY_B, 'bob@example.com'),
    ],
    planVersions: [{ id: VERSION, planId: PLAN }],
    plans: [{ id: PLAN, code: 'CORE-25K' }],
    ruleStates: [
      stateRow(1n, ACCOUNT_1, '2026-08-26', { balanceCents: 5_000_000n, withdrawableCents: 0n }),
      stateRow(2n, ACCOUNT_1, '2026-08-27'),
    ],
    riskFlags: [],
    coupons: [],
    couponRedemptions: [],
    payoutRequests: [],
    platformAccountRefs: [],
    ...over,
  };
}

function search(
  tables: Tables,
  query: string,
  over: { limit?: number; cursor?: string | null } = {},
): { tx: Recorder; run: () => ReturnType<typeof readAccountSearch> } {
  const tx = new Recorder(tables);
  return {
    tx,
    run: () =>
      readAccountSearch(tx as unknown as SearchTx, {
        query,
        limit: over.limit ?? 25,
        cursor: over.cursor ?? null,
      }),
  };
}

const ids = (page: AdminPage<AdminAccountSearchItem>): string[] =>
  page.data.map((item) => item.account_id);

// -----------------------------------------------------------------------------
// 1. The six terms, one case each, because a term nobody exercised is a term
// -----------------------------------------------------------------------------

describe('the six terms API_CONTRACT declares, each reaching its own column', () => {
  it('resolves an account id to that one account', async () => {
    const { run } = search(estate(), ACCOUNT_2);
    expect(ids((await run()).page)).toStrictEqual([ACCOUNT_2]);
  });

  it('resolves an identity id to every account that identity holds, in order', async () => {
    const { run } = search(estate(), IDENTITY_A);
    expect(ids((await run()).page)).toStrictEqual([ACCOUNT_1, ACCOUNT_2]);
  });

  it('resolves a LIVE platform ref off `accounts`', async () => {
    const { run } = search(estate(), 'RITH-1');
    expect(ids((await run()).page)).toStrictEqual([ACCOUNT_1]);
  });

  it('resolves a RETIRED platform ref off the history table, which `accounts` no longer holds', async () => {
    // ADR-194 section 3: the live index is partial and the burn history is
    // `platform_account_refs`. A ref nobody can find is the search that matters
    // most, because a burned ref is one something went wrong on.
    const tables = estate({
      platformAccountRefs: [
        { platform: 'rithmic', platformAccountRef: 'RITH-OLD', accountId: ACCOUNT_3 },
      ],
    });
    const { run } = search(tables, 'RITH-OLD');
    expect(ids((await run()).page)).toStrictEqual([ACCOUNT_3]);
  });

  it('resolves an email off `users.email` to the whole person', async () => {
    const { run } = search(estate(), 'alice@example.com');
    expect(ids((await run()).page)).toStrictEqual([ACCOUNT_1, ACCOUNT_2]);
  });

  it('resolves an email off `email_normalized`, which is the term `users.email` cannot answer', async () => {
    // `0002_identity.sql:254`: "dots and plus-tags stripped: the entity-resolution
    // key. Indexed but deliberately NOT unique". An operator holding the plain
    // address reaches an account opened under a tagged one.
    const tables = estate({
      users: [
        userRow(USER_A, IDENTITY_A, 'a.lice+news@example.com', {
          emailNormalized: 'alice@example.com',
        }),
        userRow(USER_B, IDENTITY_B, 'bob@example.com'),
      ],
    });
    const { run } = search(tables, 'alice@example.com');
    expect(ids((await run()).page)).toStrictEqual([ACCOUNT_1, ACCOUNT_2]);
  });

  it('resolves a coupon to every identity that redeemed it, released ones included', async () => {
    const tables = estate({
      coupons: [{ id: COUPON, code: 'LAUNCH50' }],
      couponRedemptions: [
        { id: 'r1', couponId: COUPON, identityId: IDENTITY_A, releasedAt: null },
        // A RELEASED REDEMPTION IS STILL A REDEMPTION. `0006_commerce.sql` keeps
        // the row so claim-and-abandon stays visible, and that is exactly what
        // an operator asking who used a code is asking about.
        { id: 'r2', couponId: COUPON, identityId: IDENTITY_B, releasedAt: new Date() },
      ],
    });
    const { run } = search(tables, 'LAUNCH50');
    expect(ids((await run()).page)).toStrictEqual([ACCOUNT_1, ACCOUNT_2, ACCOUNT_3]);
  });

  it('resolves a payout id to the account that payout was requested against', async () => {
    const tables = estate({
      payoutRequests: [{ id: PAYOUT, accountId: ACCOUNT_3, identityId: IDENTITY_B }],
    });
    const { run } = search(tables, PAYOUT);
    expect(ids((await run()).page)).toStrictEqual([ACCOUNT_3]);
  });

  it('answers a term the estate does not hold with an EMPTY PAGE and never a refusal', async () => {
    // ADR-194 section 10 item 6: an operator who types a fragment "gets an empty
    // page rather than a validation failure", and that is "the ordinary shape of
    // a search that found nothing".
    const { run } = search(estate(), 'jo');
    const { page } = await run();
    expect(page).toStrictEqual({ data: [], next_cursor: null });
  });
});

// -----------------------------------------------------------------------------
// 2. The uuid guard, asserted by what was NOT called
// -----------------------------------------------------------------------------

describe('a term that is not a uuid never reaches a `uuid` column', () => {
  it('makes none of the three uuid reads for a coupon-shaped term', async () => {
    // Postgres answers 22P02 to `id = 'jo'`, so without this every coupon search
    // is a 500. ASSERTED BY ABSENCE: a guard that fires on nothing passes every
    // admission test ever written against it.
    const { tx, run } = search(estate(), 'LAUNCH50');
    await run();
    expect(tx.calls.filter((call) => call.startsWith('rowAt accounts'))).toStrictEqual([]);
    expect(tx.calls.filter((call) => call.startsWith('rowAt payoutRequests'))).toStrictEqual([]);
    expect(
      tx.calls.filter((call) => call.startsWith('rowsWhere accounts identityId')),
    ).toStrictEqual([]);
  });

  it('makes all three for a uuid term, so the guard is not refusing everything', async () => {
    const { tx, run } = search(estate(), ACCOUNT_1);
    await run();
    expect(tx.calls.some((call) => call.startsWith(`rowAt accounts id=${ACCOUNT_1}`))).toBe(true);
    expect(tx.calls.some((call) => call.startsWith(`rowAt payoutRequests id=${ACCOUNT_1}`))).toBe(
      true,
    );
    expect(
      tx.calls.some((call) => call.startsWith(`rowsWhere accounts identityId=${ACCOUNT_1}`)),
    ).toBe(true);
  });

  it('still offers a non-uuid term to every TEXT column, which is the whole point', async () => {
    const { tx, run } = search(estate(), 'jo');
    await run();
    for (const expected of [
      'rowsWhere accounts platformAccountRef=jo',
      'rowsWhere platformAccountRefs platformAccountRef=jo',
      'rowAt users email=jo',
      'rowsWhere users emailNormalized=jo',
      'rowsWhere coupons code=jo',
    ])
      expect(tx.calls).toContain(expected);
  });
});

// -----------------------------------------------------------------------------
// 3. The twelve fields, field by field
// -----------------------------------------------------------------------------

describe('`AdminAccountSearchItem`, twelve fields and no thirteenth', () => {
  it('projects every member from its own column', async () => {
    const { run } = search(estate(), ACCOUNT_1);
    const [item] = (await run()).page.data;
    expect(item).toStrictEqual({
      account_id: ACCOUNT_1,
      identity_id: IDENTITY_A,
      email: 'alice@example.com',
      plan_code: 'CORE-25K',
      size_cents: 5_000_000,
      phase: 'funded',
      status: 'active',
      // The LATEST rule state, which is 2026-08-27 and not 2026-08-26.
      balance_cents: 5_100_000,
      withdrawable_cents: 60_000,
      open_flags: 0,
      payouts_frozen: false,
      recon_blocked: false,
    });
  });

  it('takes the email from the account`s LOGIN and not from the person', async () => {
    // ADR-041: an identity may hold more than one login, so "the identity's
    // email" has more than one answer and `accounts.user_id` is the column that
    // has one.
    const tables = estate({
      users: [
        userRow(USER_A, IDENTITY_A, 'alice@example.com'),
        userRow('cccccccc-0000-4000-8000-000000000009', IDENTITY_A, 'alice.second@example.com'),
        userRow(USER_B, IDENTITY_B, 'bob@example.com'),
      ],
    });
    const { run } = search(tables, IDENTITY_A);
    expect((await run()).page.data.map((item) => item.email)).toStrictEqual([
      'alice@example.com',
      'alice@example.com',
    ]);
  });

  it('reads `plan_code` two hops out and memoises it across the page', async () => {
    const { tx, run } = search(estate(), IDENTITY_A);
    const { page, cost } = await run();
    expect(page.data.map((item) => item.plan_code)).toStrictEqual(['CORE-25K', 'CORE-25K']);
    // Two accounts on one plan version is TWO reads and not four.
    expect(cost.planReads).toBe(2);
    expect(tx.calls.filter((call) => call.startsWith('rowAt plans'))).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// 4. `payouts_frozen` is the money path's definition and not this module's
// -----------------------------------------------------------------------------

describe('`payouts_frozen` is the account`s OR the identity`s', () => {
  it('is true where only the IDENTITY is frozen, which is what `investigating` sets', async () => {
    // `packages/rules-engine/src/types.ts`: `ExternalGates.payoutsFrozen` is
    // "account level OR identity level, RESOLVED BY THE CALLER". `M06` section
    // 3.3 sets the identity half. An account rendered `false` here would say
    // this account can be paid where the engine will refuse it.
    const tables = estate({
      identities: [identityRow(IDENTITY_A, { payoutsFrozen: true }), identityRow(IDENTITY_B)],
    });
    const { run } = search(tables, IDENTITY_A);
    expect((await run()).page.data.map((item) => item.payouts_frozen)).toStrictEqual([true, true]);
  });

  it('is true where only the ACCOUNT is frozen, which is what the freeze route writes', async () => {
    const tables = estate();
    tables['accounts'] = [
      accountRow(ACCOUNT_1, IDENTITY_A, USER_A, { payoutsFrozen: true }),
      accountRow(ACCOUNT_2, IDENTITY_A, USER_A),
      accountRow(ACCOUNT_3, IDENTITY_B, USER_B),
    ];
    const { run } = search(tables, IDENTITY_A);
    expect((await run()).page.data.map((item) => item.payouts_frozen)).toStrictEqual([true, false]);
  });

  it('leaves `recon_blocked` on the account alone, because it has no identity half', async () => {
    const tables = estate({
      identities: [identityRow(IDENTITY_A, { payoutsFrozen: true }), identityRow(IDENTITY_B)],
    });
    const { run } = search(tables, ACCOUNT_1);
    expect((await run()).page.data.map((item) => item.recon_blocked)).toStrictEqual([false]);
  });
});

// -----------------------------------------------------------------------------
// 5. `open_flags`, which is `account.ts`'s rule and `admin-writes.ts`'s word
// -----------------------------------------------------------------------------

describe('`open_flags` counts the owner`s open flags that reach this account', () => {
  it('counts an identity-level flag and this account`s, and neither the other account`s nor a resolved one', async () => {
    const tables = estate({
      riskFlags: [
        // Identity-level: `account_id` NULL. `account.ts`'s header is why it
        // counts -- entering `investigating` freezes the IDENTITY, so a flag
        // naming no account is the cause of an account-level outcome.
        flagRow('f1', IDENTITY_A),
        flagRow('f2', IDENTITY_A, { accountId: ACCOUNT_1 }),
        flagRow('f3', IDENTITY_A, { accountId: ACCOUNT_2 }),
        // `investigating` is a flag somebody is already working, and
        // `admin-writes.ts` reads "still open" as `status === 'open'`.
        flagRow('f4', IDENTITY_A, { status: 'investigating' }),
        flagRow('f5', IDENTITY_A, { status: 'dismissed' }),
        flagRow('f6', IDENTITY_B),
      ],
    });
    const { run } = search(tables, IDENTITY_A);
    expect((await run()).page.data.map((item) => item.open_flags)).toStrictEqual([2, 2]);
  });
});

// -----------------------------------------------------------------------------
// 6. The engine`s record, and the absence that is pinned rather than papered
// -----------------------------------------------------------------------------

describe('`balance_cents` and `withdrawable_cents` are ONE rule state', () => {
  it('takes the greatest trading day', async () => {
    const { run } = search(estate(), ACCOUNT_1);
    const [item] = (await run()).page.data;
    expect([item?.balance_cents, item?.withdrawable_cents]).toStrictEqual([5_100_000, 60_000]);
  });

  it('tie-breaks two rows on one day on the row`s own `bigint` id', async () => {
    // `0015` keys the table on `id` and not on `(account_id, trading_day)`, so
    // two rows for one day are a shape the database permits and the later one is
    // what the engine wrote last.
    const tables = estate({
      ruleStates: [
        stateRow(9n, ACCOUNT_1, '2026-08-27', { balanceCents: 1n, withdrawableCents: 1n }),
        stateRow(10n, ACCOUNT_1, '2026-08-27', { balanceCents: 7n, withdrawableCents: 7n }),
      ],
    });
    const { run } = search(tables, ACCOUNT_1);
    const [item] = (await run()).page.data;
    // 10 and not 9: compared as numbers, because "10" sorts before "9" as text.
    expect([item?.balance_cents, item?.withdrawable_cents]).toStrictEqual([7, 7]);
  });

  it('never takes the two numbers from two different days', async () => {
    const tables = estate({
      ruleStates: [
        stateRow(1n, ACCOUNT_1, '2026-08-26', { balanceCents: 1n, withdrawableCents: 999n }),
        stateRow(2n, ACCOUNT_1, '2026-08-27', { balanceCents: 2n, withdrawableCents: 0n }),
      ],
    });
    const { run } = search(tables, ACCOUNT_1);
    const [item] = (await run()).page.data;
    expect([item?.balance_cents, item?.withdrawable_cents]).toStrictEqual([2, 0]);
  });

  it('CLEARING CONDITION: an account with no rule state reports zero, and this case expires', async () => {
    // THE DAY ANYTHING IN THIS TREE WRITES A `rule_states` ROW AT ACCOUNT OPEN,
    // OR THE DAY API_CONTRACT ADMITS A NULL ON EITHER MEMBER, THIS CASE IS THE
    // ONE THAT SAYS SO. `search.ts`'s header prices the three answers that were
    // available: a throw is `FM-17`'s shape on a console, `accounts.size_cents`
    // would be a rules-engine claim this module may not make, and zero is the
    // honest reading of an absent record. `withdrawable_cents` at zero is exactly
    // right (`0015` CHECKs it `>= 0` and no gate has passed); `balance_cents` at
    // zero is the weaker half and is why this case exists.
    const tables = estate({ ruleStates: [] });
    const { run } = search(tables, ACCOUNT_1);
    const [item] = (await run()).page.data;
    expect([item?.balance_cents, item?.withdrawable_cents]).toStrictEqual([0, 0]);

    // NON-VACUITY: the same estate WITH a state reports that state, so a module
    // that returned zero unconditionally fails here rather than passing above.
    const { run: withState } = search(estate(), ACCOUNT_1);
    const [real] = (await withState()).page.data;
    expect(real?.balance_cents).toBe(5_100_000);
  });
});

// -----------------------------------------------------------------------------
// 7. The ordering and the cursor
// -----------------------------------------------------------------------------

describe('the page is ordered `(identity_id, account_id)` and the cursor is that key', () => {
  it('groups one person`s accounts together and sorts identities ascending', async () => {
    const tables = estate({
      coupons: [{ id: COUPON, code: 'LAUNCH50' }],
      couponRedemptions: [
        { id: 'r1', couponId: COUPON, identityId: IDENTITY_B },
        { id: 'r2', couponId: COUPON, identityId: IDENTITY_A },
      ],
    });
    const { run } = search(tables, 'LAUNCH50');
    // `aaaaaaaa` before `bbbbbbbb`, whatever order the redemptions arrived in.
    expect(ids((await run()).page)).toStrictEqual([ACCOUNT_1, ACCOUNT_2, ACCOUNT_3]);
  });

  it('pages through every row exactly once, dropping none and repeating none', async () => {
    const tables = estate({
      coupons: [{ id: COUPON, code: 'LAUNCH50' }],
      couponRedemptions: [
        { id: 'r1', couponId: COUPON, identityId: IDENTITY_A },
        { id: 'r2', couponId: COUPON, identityId: IDENTITY_B },
      ],
    });
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const { run } = search(tables, 'LAUNCH50', { limit: 1, cursor });
      const result: Awaited<ReturnType<typeof readAccountSearch>> = await run();
      seen.push(...ids(result.page));
      cursor = result.page.next_cursor;
      if (cursor === null) break;
    }
    expect(seen).toStrictEqual([ACCOUNT_1, ACCOUNT_2, ACCOUNT_3]);
    expect(cursor).toBeNull();
  });

  it('reports `next_cursor: null` on the last page and a cursor on every other', async () => {
    const { run: first } = search(estate(), IDENTITY_A, { limit: 1 });
    const one = await first();
    expect(one.page.next_cursor).not.toBeNull();
    const { run: second } = search(estate(), IDENTITY_A, {
      limit: 1,
      cursor: one.page.next_cursor,
    });
    expect((await second()).page.next_cursor).toBeNull();
  });

  it('refuses a cursor from a different ordering rather than paging at a position that means nothing', async () => {
    const wrong = Buffer.from('one two three', 'utf8').toString('base64url');
    const { run } = search(estate(), IDENTITY_A, { cursor: wrong });
    await expect(run()).rejects.toBeInstanceOf(AdminReadError);
  });

  it('never returns more rows than the limit, which the route asserts again', async () => {
    const { run } = search(estate(), IDENTITY_A, { limit: 1 });
    expect((await run()).page.data).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// 8. The early stop, asserted by the answer rather than by the saving
// -----------------------------------------------------------------------------

describe('the widest term is affordable, and the saving costs no rows', () => {
  /** Forty identities on one coupon, one account each. */
  function launch(): { tables: Tables; accounts: string[] } {
    const tables = estate({
      accounts: [],
      identities: [],
      users: [],
      coupons: [{ id: COUPON, code: 'LAUNCH50' }],
      couponRedemptions: [],
      ruleStates: [],
    });
    const accounts: string[] = [];
    for (let n = 0; n < 40; n += 1) {
      const suffix = String(n).padStart(12, '0');
      const identityId = `aaaaaaaa-0000-4000-8000-${suffix}`;
      const accountId = `11111111-0000-4000-8000-${suffix}`;
      const userId = `cccccccc-0000-4000-8000-${suffix}`;
      tables['identities']?.push(identityRow(identityId));
      tables['users']?.push(userRow(userId, identityId, `t${String(n)}@example.com`));
      tables['accounts']?.push(accountRow(accountId, identityId, userId));
      tables['couponRedemptions']?.push({ id: `r${String(n)}`, couponId: COUPON, identityId });
      accounts.push(accountId);
    }
    return { tables, accounts };
  }

  it('expands far fewer identities than it resolved, on the first page', async () => {
    const { tables } = launch();
    const { run } = search(tables, 'LAUNCH50', { limit: 5 });
    const { cost } = await run();
    expect(cost.identitiesResolved).toBe(40);
    // Six: five to fill the window and one more to know there is another page.
    expect(cost.identitiesExpanded).toBe(6);
  });

  it('still reaches every account, page after page, which is what makes the stop a saving and not a cap', async () => {
    // `graph.ts` refuses a silent truncation by name and so does this. The
    // unstopped answer is the paged answer.
    const { tables, accounts } = launch();
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const { run } = search(tables, 'LAUNCH50', { limit: 5, cursor });
      const result: Awaited<ReturnType<typeof readAccountSearch>> = await run();
      seen.push(...ids(result.page));
      cursor = result.page.next_cursor;
      if (cursor === null) break;
    }
    expect(seen).toStrictEqual([...accounts].sort());
    expect(seen).toHaveLength(40);
  });

  it('skips whole identities below the cursor rather than reading and discarding them', async () => {
    const { tables } = launch();
    const { run: first } = search(tables, 'LAUNCH50', { limit: 5 });
    const one = await first();
    const { run: second } = search(tables, 'LAUNCH50', { limit: 5, cursor: one.page.next_cursor });
    const two = await second();
    // SEVEN AND NOT SIX, and the extra one is the identity the cursor SITS ON.
    // It is expanded, contributes nothing after the cursor, and is the price of
    // a cursor whose first component is not a whole page boundary. Thirty-three
    // identities are still skipped without a read.
    expect(two.cost.identitiesExpanded).toBe(7);
  });

  it('reads the four per-row tables for the WINDOW and never for every candidate', async () => {
    const { tables } = launch();
    const { tx, run } = search(tables, 'LAUNCH50', { limit: 5 });
    await run();
    // Five rows on the page, five identity reads, five user reads.
    expect(tx.calls.filter((call) => call.startsWith('rowAt identities'))).toHaveLength(5);
    expect(tx.calls.filter((call) => call.startsWith('rowAt users id='))).toHaveLength(5);
    expect(tx.calls.filter((call) => call.startsWith('rowsWhere ruleStates'))).toHaveLength(5);
    expect(tx.calls.filter((call) => call.startsWith('rowsWhere riskFlags'))).toHaveLength(5);
  });
});

// -----------------------------------------------------------------------------
// 9. The refusals this module makes for itself
// -----------------------------------------------------------------------------

describe('what the adapter refuses', () => {
  it('refuses an empty term, because a source that answered one would be the enumeration by another door', async () => {
    const { run } = search(estate(), '   ');
    await expect(run()).rejects.toThrow(/INV-M6-10/);
  });

  it('refuses a limit that is not a page size', async () => {
    const tx = new Recorder(estate());
    await expect(
      readAccountSearch(tx as unknown as SearchTx, { query: 'x', limit: 0, cursor: null }),
    ).rejects.toBeInstanceOf(AdminReadError);
  });

  it('refuses an account whose identity row is absent, rather than rendering a hole', async () => {
    const tables = estate({ identities: [identityRow(IDENTITY_B)] });
    const { run } = search(tables, ACCOUNT_1);
    await expect(run()).rejects.toThrow(/has no `identities` row/);
  });

  it('drops a candidate whose account row vanished, rather than emptying the search', async () => {
    // `platform_account_refs` references `accounts` `ON DELETE RESTRICT`, so
    // this cannot happen while the constraint holds, and one absent row must not
    // empty an operator's search.
    const tables = estate({
      platformAccountRefs: [
        { platform: 'rithmic', platformAccountRef: 'RITH-GONE', accountId: 'not-here' },
      ],
    });
    const { run } = search(tables, 'RITH-GONE');
    expect((await run()).page.data).toStrictEqual([]);
  });
});

// -----------------------------------------------------------------------------
// 10. The composition, and the route that stops answering 500
// -----------------------------------------------------------------------------

describe('the composition', () => {
  it('names searchAccounts in IMPLEMENTED_ADMIN_READS, sorted', () => {
    expect([...IMPLEMENTED_ADMIN_READS]).toStrictEqual([...IMPLEMENTED_ADMIN_READS].sort());
    expect(IMPLEMENTED_ADMIN_READS).toContain('searchAccounts');
  });

  it('declares only tables `packages/db` registers, which is what `TS2322` would refuse', () => {
    for (const table of SEARCH_READ_TABLES)
      expect(TABLE_KEYS as readonly string[]).toContain(table);
    expect(new Set(SEARCH_READ_TABLES).size).toBe(SEARCH_READ_TABLES.length);
    expect([...SEARCH_READ_TABLES]).toStrictEqual([...SEARCH_READ_TABLES].sort());
  });

  it('no longer throws AdminSourceNotComposed for searchAccounts once composed', async () => {
    const tx = new Recorder(estate()) as unknown as AdminSourceTx;
    const source = composeAdminReadSource(
      composeImplementedAdminReads({ operator: (fn) => fn(tx) }),
    );
    const page = await source.searchAccounts({ query: ACCOUNT_1, limit: 25, cursor: null });
    expect(page.data.map((item) => item.account_id)).toStrictEqual([ACCOUNT_1]);
  });

  it('still throws AdminSourceNotComposed, synchronously, for a method nobody supplies', () => {
    const source = composeAdminReadSource({});
    expect(() => source.searchAccounts({ query: 'x', limit: 1, cursor: null })).toThrow(
      AdminSourceNotComposed,
    );
  });

  it('ANSWERS 200 WHERE IT ANSWERED 500, which is the whole of this slice', async () => {
    // MEASURED THROUGH THE REAL ROUTER by way of `inject`, because a 500 in this
    // file is produced the way a deployment's is.
    const tx = new Recorder(estate()) as unknown as AdminSourceTx;
    setAdminSessionSource({
      lookup: () =>
        Promise.resolve({ kind: 'operator', principal: { actorId: 'a', role: 'owner' } }),
    });
    setAdminReadSource(
      composeAdminReadSource(composeImplementedAdminReads({ operator: (fn) => fn(tx) })),
    );
    const { app, report } = buildServer({ surface: 'operator', modules: onDisk });
    await app.ready();
    expect(report.registered).toContain('GET /admin/accounts');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/accounts?query=alice@example.com',
      headers: COOKIE,
    });
    await app.close();
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as AdminPage<AdminAccountSearchItem>;
    expect(body.data.map((item) => item.account_id)).toStrictEqual([ACCOUNT_1, ACCOUNT_2]);
    expect(body.next_cursor).toBeNull();
  });

  it('is capped by INV-M6-10 at the route as well as here', () => {
    expect(LIMIT_MAX).toBe(100);
  });
});

// -----------------------------------------------------------------------------
// 11. A census, and one clearing condition it holds
// -----------------------------------------------------------------------------

describe('the coupon term reads through `rowsWhere` because a UNIQUE was not transcribed', () => {
  const DDL = readFileSync(join(ROOT, 'packages/db/migrations/0006_commerce.sql'), 'utf8');
  const SCHEMA = readFileSync(join(ROOT, 'packages/db/src/schema.ts'), 'utf8');

  /** `coupons`' body in `schema.ts`, from its `pgTable` to the closing brace. */
  function couponsTable(): string {
    const start = SCHEMA.indexOf("export const coupons = pgTable('coupons', {");
    expect(start).toBeGreaterThan(-1);
    const end = SCHEMA.indexOf('});', start);
    expect(end).toBeGreaterThan(start);
    return SCHEMA.slice(start, end);
  }

  it('NON-VACUITY: the reader finds the two sources it compares', () => {
    // A parse matching nothing would make the absence below pass for the wrong
    // reason, which is ADR-112 section 8's warning applied to a reader.
    expect(DDL).toContain('CREATE TABLE coupons');
    expect(couponsTable()).toContain("code: citext('code')");
    // And the reader can see a `.unique()` where one exists, on the same file.
    expect(SCHEMA).toContain("email: citext('email').notNull().unique()");
  });

  it('the DATABASE declares `coupons.code` UNIQUE', () => {
    expect(DDL).toMatch(/code\s+citext NOT NULL UNIQUE/);
  });

  it('CLEARING CONDITION: `schema.ts` does not, so `rowAt` is refused over it', () => {
    // `refuseUnaddressed` (`packages/db/src/scoped-db.ts`) reads uniqueness out
    // of `schema.ts` through Drizzle's own table config, so an addressed read
    // the database would honour throws here. THE DAY `.unique()` IS ADDED TO
    // THAT COLUMN THIS CASE GOES RED AND NAMES THE REPAIR: the coupon term in
    // `admin-source/search.ts` may become a `rowAt`, and the fan-out over
    // matched coupons collapses to one. `packages/db` is another slice's fence
    // and this is reported rather than taken.
    expect(couponsTable()).not.toContain("code: citext('code').notNull().unique()");
  });
});
