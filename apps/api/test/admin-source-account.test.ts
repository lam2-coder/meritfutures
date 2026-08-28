// =============================================================================
// apps/api/test/admin-source-account.test.ts
// =============================================================================
// `admin-source/account.ts`, WHICH IS THE ADAPTER THAT HAD TO BE WHOLE.
//
// Session 353 measured why it could not be written: seven of the eight sections
// read registered tables and the eighth read `events`, which was not a
// `TableKey`, and `routes/admin-reads.ts`'s `projectAccountDetail` refuses a
// response that omits a section the contract names. **So seven of eight was a
// rejected response and not a smaller adapter.** ADR-191 registered the table.
//
// THE SHARPEST CASES IN THIS FILE SERVE A REAL RESPONSE THROUGH THE REAL ROUTE.
// The section allowlist and `assertContractScalars` both live in
// `admin-reads.ts` and neither is reachable from a unit call on this module, so
// the drill-down is composed, wired and requested exactly as an operator would
// request it. That is what catches a `bigint` reaching the wire, a null under a
// day-shaped key, and a section this module spelled differently from the
// contract.
//
// TWO OF THE EIGHT SECTIONS READ ROWS THE CONTRACT DOES NOT PREDICATE, and both
// choices are asserted in both directions rather than described: `flags` keeps
// the owner's identity-level flags and refuses the owner's OTHER accounts', and
// `admin_actions` keeps this account's actions and not the person's.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { TABLE_KEYS } from '@merit/db';
import type { SystemTx, TableKey } from '@merit/db';

import { BASE_PATH, buildServer, discoverRouteModules } from '../src/index.ts';
import {
  ACCOUNT_DETAIL_SECTIONS,
  ADMIN_SESSION_COOKIE,
  AdminReadError,
  assertContractScalars,
  setAdminReadSource,
  setAdminSessionSource,
} from '../src/routes/admin-reads.ts';
import { ACCOUNT_READ_TABLES, readAccountDetail } from '../src/admin-source/account.ts';
import {
  IMPLEMENTED_ADMIN_READS,
  composeAdminReadSource,
  composeImplementedAdminReads,
} from '../src/admin-source/index.ts';
import type { AccountTx } from '../src/admin-source/account.ts';
import type { AdminSourceTx } from '../src/admin-source/index.ts';

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
type Tables = Record<string, readonly Row[]>;

/** `admin-source-flags.test.ts`'s `Recorder`, narrowed to what `AccountTx` declares. */
class Recorder {
  readonly calls: string[] = [];

  constructor(private readonly tables: Tables) {}

  rowsWhere(key: string, where: Row): Promise<unknown[]> {
    const terms = Object.keys(where).sort();
    if (terms.length === 0)
      throw new Error(`rowsWhere ${key} was handed an empty filter, which does not compile`);
    this.calls.push(`rowsWhere ${key} ${terms.join('+')}`);
    return Promise.resolve(
      (this.tables[key] ?? []).filter((row) => terms.every((term) => row[term] === where[term])),
    );
  }

  rowAt(key: string, at: Row): Promise<unknown> {
    const terms = Object.keys(at).sort();
    this.calls.push(`rowAt ${key} ${terms.join('+')}`);
    return Promise.resolve(
      (this.tables[key] ?? []).find((row) => terms.every((term) => row[term] === at[term])),
    );
  }
}

// -----------------------------------------------------------------------------
// The fixtures. Every stored column, because the projection is what is tested
// -----------------------------------------------------------------------------

const IDENTITY = '11111111-0000-4000-8000-000000000001';
const ACCOUNT = '22222222-0000-4000-8000-000000000002';
const OTHER_ACCOUNT = '22222222-0000-4000-8000-000000000003';
const OTHER_IDENTITY = '11111111-0000-4000-8000-000000000004';

const NOW = new Date('2026-08-28T09:00:00.000Z');

function accountRow(over: Row = {}): Row {
  return {
    id: ACCOUNT,
    identityId: IDENTITY,
    userId: '33333333-0000-4000-8000-000000000001',
    purchaseId: '44444444-0000-4000-8000-000000000001',
    planVersionId: '55555555-0000-4000-8000-000000000001',
    sizeCents: 5_000_000n,
    phase: 'funded',
    status: 'active',
    platform: 'rithmic',
    platformAccountRef: 'RITH-1',
    feed: 'cme',
    frontEndPermissions: [],
    openedOn: '2026-01-05',
    fundedOn: '2026-02-01',
    closedOn: null,
    closeReason: null,
    payoutsFrozen: false,
    reconBlocked: false,
    expiresOn: null,
    graduatedAt: null,
    graduationPath: null,
    terminalSettlementId: null,
    graduationEligible: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function identityRow(over: Row = {}): Row {
  return {
    id: IDENTITY,
    displayName: 'Alice',
    leaderboardOptIn: false,
    status: 'active',
    statusReason: null,
    maxAccountsOverride: null,
    payoutsFrozen: false,
    frozenReason: null,
    frozenAt: null,
    supportContactRef: null,
    firstSeenAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function markRow(id: string, tradingDay: string, over: Row = {}): Row {
  return {
    id: BigInt(id),
    accountId: ACCOUNT,
    tradingDay,
    openingBalanceCents: 5_000_000n,
    closingBalanceCents: 5_012_500n,
    highBalanceCents: 5_020_000n,
    lowBalanceCents: 4_990_000n,
    realizedPnlCents: 12_500n,
    fillCount: 7,
    tradedDay: true,
    winDay: true,
    adjustmentCents: 0n,
    sourceHash: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]),
    source: 'rithmic',
    ingestFileId: null,
    supersededBy: null,
    computedAt: NOW,
    createdAt: NOW,
    ...over,
  };
}

function ruleStateRow(id: string, tradingDay: string, over: Row = {}): Row {
  return {
    id: BigInt(id),
    accountId: ACCOUNT,
    tradingDay,
    phase: 'funded',
    floorCents: 4_800_000n,
    floorLocked: false,
    floorOpenCents: 4_800_000n,
    highWaterBalanceCents: 5_020_000n,
    balanceCents: 5_012_500n,
    withdrawableCents: 12_500n,
    tradedDaysCount: 9,
    winDaysCount: 6,
    consistencyBestDayCents: 8_000n,
    consistencyPeriodProfitCents: 30_000n,
    consistencyPeriodStartDay: null,
    payoutsSettledCount: 0,
    payoutAnchorDay: null,
    cadenceAnchorDay: null,
    engineEligible: false,
    engineGates: { G_MIN_DAYS: { passed: true }, G_CONSISTENCY: { passed: false } },
    contextGates: { 'G-HOLD-REQUIRED': { passed: true } },
    stateHash: Uint8Array.from([0x01, 0x02]),
    engineVersion: 'v3',
    calendarRevisionId: null,
    computedAt: NOW,
    createdAt: NOW,
    ...over,
  };
}

function eventRow(id: string, occurredAt: string, over: Row = {}): Row {
  return {
    id: BigInt(id),
    eventName: 'account.funded',
    schemaVersion: 1,
    occurredAt: new Date(occurredAt),
    recordedAt: new Date(occurredAt),
    identityId: IDENTITY,
    accountId: ACCOUNT,
    subjectKind: 'account',
    subjectId: ACCOUNT,
    actorKind: 'system',
    actorId: null,
    correlationId: null,
    payload: { plan_code: 'starter' },
    createdAt: NOW,
    ...over,
  };
}

function flagRow(id: string, over: Row = {}): Row {
  return {
    id,
    identityId: IDENTITY,
    accountId: ACCOUNT,
    flagType: 'copy_cluster',
    severity: 4,
    status: 'open',
    source: 'internal',
    detectorRunId: null,
    evidence: { pair_share_bp: 6000 },
    firstDetectedOn: '2026-08-20',
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
    slaDueAt: null,
    firstTouchedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function payoutRow(id: string, basisTradingDay: string, over: Row = {}): Row {
  return {
    id,
    accountId: ACCOUNT,
    identityId: IDENTITY,
    requestedCents: 10_000n,
    approvedCents: 10_000n,
    traderCents: 9_000n,
    firmCents: 1_000n,
    basisTradingDay,
    planVersionId: '55555555-0000-4000-8000-000000000001',
    eligibilitySnapshot: { withdrawable_cents: 12_500 },
    status: 'approved',
    idempotencyKey: 'k-1',
    payoutOrdinal: 1,
    approvedAt: NOW,
    settledAt: null,
    settledTradingDay: null,
    effectiveTradingDay: null,
    frozenAt: null,
    freezeFlagId: null,
    freezeExpiresAt: null,
    balanceReflectionStatus: 'pending',
    reflectedOnTradingDay: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function actionRow(id: string, over: Row = {}): Row {
  return {
    id: BigInt(id),
    actor: 'owner',
    action: 'account.freeze',
    subjectKind: 'account',
    subjectId: ACCOUNT,
    reason: 'copy trading under investigation',
    before: { payouts_frozen: false },
    after: { payouts_frozen: true },
    evidenceRefs: [],
    ip: null,
    initiative: 'merit',
    onBehalfOfIdentityId: null,
    createdAt: NOW,
    ...over,
  };
}

function tablesOf(over: Partial<Tables> = {}): Tables {
  return {
    accounts: [accountRow()],
    identities: [identityRow()],
    dailyMarks: [markRow('1', '2026-08-20')],
    ruleStates: [ruleStateRow('1', '2026-08-20')],
    events: [eventRow('1', '2026-08-20T14:00:00.000Z')],
    riskFlags: [flagRow('f-1')],
    payoutRequests: [payoutRow('p-1', '2026-08-20')],
    adminActions: [actionRow('1')],
    ...over,
  };
}

function accountTx(tables: Tables): { tx: AccountTx; recorder: Recorder } {
  const recorder = new Recorder(tables);
  return { tx: recorder as unknown as AccountTx, recorder };
}

async function detailOf(tables: Tables = tablesOf()): Promise<Record<string, unknown>> {
  const { tx } = accountTx(tables);
  const result = await readAccountDetail(tx, ACCOUNT);
  if (result === null) throw new Error('the fixture has no account');
  return result.detail as unknown as Record<string, unknown>;
}

function list(
  detail: Record<string, unknown>,
  section: string,
): readonly Record<string, unknown>[] {
  const value = detail[section];
  if (!Array.isArray(value)) throw new Error(`${section} is not a list`);
  return value as readonly Record<string, unknown>[];
}

// =============================================================================
// 0. THE SHAPE, AND THE BLOCKER THAT IS GONE
// =============================================================================

describe('the eight tables this drill-down reads', () => {
  it('are all keys packages/db registers, including the one that blocked session 353', () => {
    const keys: readonly TableKey[] = [...ACCOUNT_READ_TABLES];
    for (const key of keys) expect(TABLE_KEYS).toContain(key);
    expect(ACCOUNT_READ_TABLES).toContain('events');
  });

  it('are one per section and no wider', () => {
    expect([...ACCOUNT_READ_TABLES].sort()).toStrictEqual([
      'accounts',
      'adminActions',
      'dailyMarks',
      'events',
      'identities',
      'payoutRequests',
      'riskFlags',
      'ruleStates',
    ]);
    expect(ACCOUNT_READ_TABLES).toHaveLength(ACCOUNT_DETAIL_SECTIONS.length);
  });

  it('are reached through a handle SystemTx satisfies, which is the TS2322 that stopped 353', () => {
    const handle: AdminSourceTx = null as unknown as SystemTx;
    expect(handle).toBeNull();
  });

  it('are read through a fake carrying no write method at all', async () => {
    const recorder = new Recorder(tablesOf());
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(recorder)).sort()).toStrictEqual([
      'constructor',
      'rowAt',
      'rowsWhere',
    ]);
    expect(await readAccountDetail(recorder as unknown as AccountTx, ACCOUNT)).not.toBeNull();
  });
});

// =============================================================================
// 1. ALL EIGHT OR NONE, WHICH IS WHY THERE WAS NO PARTIAL TO LAND
// =============================================================================

describe('the drill-down fills every section API_CONTRACT section 8 names', () => {
  it('carries exactly the eight, in neither direction short', async () => {
    const detail = await detailOf();
    expect(Object.keys(detail).sort()).toStrictEqual([...ACCOUNT_DETAIL_SECTIONS].sort());
  });

  it('is a whole answer even where a section is empty, which is not the same as absent', async () => {
    const detail = await detailOf(
      tablesOf({ dailyMarks: [], ruleStates: [], events: [], adminActions: [] }),
    );
    expect(Object.keys(detail).sort()).toStrictEqual([...ACCOUNT_DETAIL_SECTIONS].sort());
    expect(list(detail, 'marks')).toStrictEqual([]);
  });

  it('is null where the account is not there, which the route turns into a 404', async () => {
    const { tx } = accountTx(tablesOf({ accounts: [] }));
    expect(await readAccountDetail(tx, ACCOUNT)).toBeNull();
  });

  it('refuses an account whose identity is not there rather than blanking a section', async () => {
    const { tx } = accountTx(tablesOf({ identities: [] }));
    await expect(readAccountDetail(tx, ACCOUNT)).rejects.toThrow(AdminReadError);
  });
});

// =============================================================================
// 2. THE SECTION THE CORPUS WARNS ABOUT HARDEST
// =============================================================================

describe('`gate_results` is two jsonb columns on rule_states and it is carried verbatim', () => {
  it('renders the stored bags rather than a recomputation, which is M06 section 3.2', async () => {
    const [state] = list(await detailOf(), 'rule_states');
    // SD-06 split `gate_results` into these two. `M06`: "from the STORED ROW
    // rather than from a recomputation, because a recomputation is an assertion
    // and the stored row is a record".
    expect(state?.['engine_gates']).toStrictEqual({
      G_MIN_DAYS: { passed: true },
      G_CONSISTENCY: { passed: false },
    });
    expect(state?.['context_gates']).toStrictEqual({ 'G-HOLD-REQUIRED': { passed: true } });
    // AND THE STORED VERDICT BESIDE THEM, unrecomputed: `engine_eligible` says
    // `false` while one gate says `passed`, and this module does not reconcile
    // them because reconciling them is the assertion.
    expect(state?.['engine_eligible']).toBe(false);
  });

  it('names no gate column in its own logic, so no gate is derived here', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'admin-source', 'account.ts'),
      'utf8',
    );
    const logic = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
      .join('\n');
    // The two column names may be TRANSCRIBED and may not be READ: the only
    // permitted appearances are the projector's own two lines.
    expect([...logic.matchAll(/engineGates|contextGates/g)]).toHaveLength(2);
  });
});

// =============================================================================
// 3. THE TWO SECTIONS THE CONTRACT DOES NOT PREDICATE
// =============================================================================

describe('flags keeps this account and the person, and refuses the person`s other accounts', () => {
  const TABLES = tablesOf({
    riskFlags: [
      flagRow('f-account', { accountId: ACCOUNT }),
      // ACCOUNT-LEVEL OUTCOME, IDENTITY-LEVEL CAUSE. M06 section 3.3: entering
      // `investigating` sets `payouts_frozen` on the IDENTITY.
      flagRow('f-identity', { accountId: null }),
      flagRow('f-sibling', { accountId: OTHER_ACCOUNT }),
      flagRow('f-stranger', { identityId: OTHER_IDENTITY, accountId: OTHER_ACCOUNT }),
    ],
  });

  it('keeps the flag that froze the person, which is the answer this screen exists to give', async () => {
    const ids = list(await detailOf(TABLES), 'flags').map((flag) => flag['flag_id']);
    expect([...ids].sort()).toStrictEqual(['f-account', 'f-identity']);
  });

  it('reads the owner once and narrows in memory, because `IS NULL` is a term this directory cannot mint', async () => {
    const { tx, recorder } = accountTx(TABLES);
    await readAccountDetail(tx, ACCOUNT);
    expect(recorder.calls).toContain('rowsWhere riskFlags identityId');
    expect(recorder.calls.filter((call) => call.startsWith('rowsWhere riskFlags'))).toHaveLength(1);
  });

  it('prices what the narrowing read, so the widened keyed read is visible', async () => {
    const { tx } = accountTx(TABLES);
    const result = await readAccountDetail(tx, ACCOUNT);
    expect(result?.cost.identityFlags).toBe(3);
    expect(result?.cost.flags).toBe(2);
  });

  it('carries the evidence bag, which the queue one file over deliberately does not', async () => {
    const [flag] = list(await detailOf(), 'flags');
    expect(flag?.['evidence']).toStrictEqual({ pair_share_bp: 6000 });
  });
});

describe('admin_actions keeps this account`s actions and not the person`s', () => {
  it('addresses the polymorphic subject with BOTH terms', async () => {
    const { tx, recorder } = accountTx(
      tablesOf({
        adminActions: [
          actionRow('1'),
          actionRow('2', { subjectKind: 'identity', subjectId: IDENTITY }),
          actionRow('3', { subjectKind: 'account', subjectId: OTHER_ACCOUNT }),
        ],
      }),
    );
    const result = await readAccountDetail(tx, ACCOUNT);
    const ids = (result?.detail['admin_actions'] as readonly Record<string, unknown>[]).map(
      (action) => action['admin_action_id'],
    );
    expect(ids).toStrictEqual(['1']);
    // KIND AND ID TOGETHER. `subject_id` is a bare uuid with no foreign key, so
    // an address on the id alone hands this screen whatever else shares it.
    expect(recorder.calls).toContain('rowsWhere adminActions subjectId+subjectKind');
  });

  it('carries the reason, which 0017 makes NOT NULL because of what it is', async () => {
    const [action] = list(await detailOf(), 'admin_actions');
    expect(action?.['reason']).toBe('copy trading under investigation');
  });
});

// =============================================================================
// 4. THE SCALAR SWEEP, WHICH IS WHERE THE SCHEMA AND THE CONTRACT COLLIDE
// =============================================================================

describe('the response survives assertContractScalars, which the route runs over it', () => {
  it('passes the sweep on a fully populated drill-down', async () => {
    const detail = await detailOf();
    expect(() => {
      assertContractScalars(detail, '');
    }).not.toThrow();
  });

  it('carries every money column as a JSON integer and never a bigint', async () => {
    const [mark] = list(await detailOf(), 'marks');
    expect(mark?.['opening_balance_cents']).toBe(5_000_000);
    expect(typeof mark?.['opening_balance_cents']).toBe('number');
    const [payout] = list(await detailOf(), 'payouts');
    // BOTH LEGS, because `approved_cents = trader_cents + firm_cents` is a CHECK
    // on the row and the total alone cannot say what the trader received.
    expect(payout?.['trader_cents']).toBe(9_000);
    expect(payout?.['firm_cents']).toBe(1_000);
  });

  it('refuses a money column past the safe integer range rather than rounding it', async () => {
    const { tx } = accountTx(
      tablesOf({ accounts: [accountRow({ sizeCents: 9_007_199_254_740_993n })] }),
    );
    await expect(readAccountDetail(tx, ACCOUNT)).rejects.toThrow(/safe integer/);
  });

  it('omits a nullable trading day rather than carrying a null the sweep refuses', async () => {
    const detail = await detailOf();
    const account = detail['account'] as Record<string, unknown>;
    // THE SWEEP REFUSES `null` UNDER A DAY-SHAPED NAME, so the two shapes this
    // response can carry are the day and no key at all. The fixture's account is
    // funded and open.
    expect(account['funded_on']).toBe('2026-02-01');
    expect(Object.hasOwn(account, 'closed_on')).toBe(false);
    expect(Object.hasOwn(account, 'expires_on')).toBe(false);
    expect(() => {
      assertContractScalars({ closed_on: null }, '');
    }).toThrow(AdminReadError);
  });

  it('omits `traded_day` and `win_day`, which are booleans the sweep cannot admit', async () => {
    const [mark] = list(await detailOf(), 'marks');
    // BOTH ARE `boolean NOT NULL` COLUMNS WHOSE NAMES END `_day`. Carrying them
    // is a 500 on every drill-down that has a mark; renaming them puts a field
    // in an operator's hands that no column has. The omission is asserted so it
    // reads as a decision rather than as a projector that missed two lines.
    expect(Object.hasOwn(mark ?? {}, 'traded_day')).toBe(false);
    expect(Object.hasOwn(mark ?? {}, 'win_day')).toBe(false);
    expect(() => {
      assertContractScalars({ traded_day: true }, '');
    }).toThrow(AdminReadError);
    // AND EVERY OTHER COLUMN OF THE MARK IS HERE, so the omission is two fields
    // rather than a section that quietly narrowed.
    expect(Object.keys(mark ?? {}).sort()).toStrictEqual([
      'account_id',
      'adjustment_cents',
      'closing_balance_cents',
      'computed_at',
      'created_at',
      'fill_count',
      'high_balance_cents',
      'ingest_file_id',
      'low_balance_cents',
      'mark_id',
      'opening_balance_cents',
      'realized_pnl_cents',
      'source',
      'source_hash',
      'superseded_by',
      'trading_day',
    ]);
  });

  it('carries a bytea as hex rather than as a Buffer nobody can compare by eye', async () => {
    const [mark] = list(await detailOf(), 'marks');
    expect(mark?.['source_hash']).toBe('deadbeef');
  });

  it('carries a bigint surrogate key as a string, because a JSON number loses the order', async () => {
    const [mark] = list(await detailOf(), 'marks');
    expect(mark?.['mark_id']).toBe('1');
  });
});

// =============================================================================
// 5. THE ORDER
// =============================================================================

describe('every list section is chronological, oldest first, tie-broken on the row id', () => {
  it('orders marks and rule states by trading day', async () => {
    const detail = await detailOf(
      tablesOf({
        dailyMarks: [
          markRow('3', '2026-08-22'),
          markRow('1', '2026-08-20'),
          markRow('2', '2026-08-21'),
        ],
        ruleStates: [ruleStateRow('2', '2026-08-21'), ruleStateRow('1', '2026-08-20')],
      }),
    );
    expect(list(detail, 'marks').map((mark) => mark['trading_day'])).toStrictEqual([
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
    ]);
    expect(list(detail, 'rule_states').map((state) => state['trading_day'])).toStrictEqual([
      '2026-08-20',
      '2026-08-21',
    ]);
  });

  it('breaks a tie on the id as a NUMBER, because "10" sorts before "9" as text', async () => {
    const detail = await detailOf(
      tablesOf({
        dailyMarks: [
          markRow('10', '2026-08-20'),
          markRow('9', '2026-08-20'),
          markRow('2', '2026-08-20'),
        ],
      }),
    );
    expect(list(detail, 'marks').map((mark) => mark['mark_id'])).toStrictEqual(['2', '9', '10']);
  });

  it('orders events forwards, which is the OPPOSITE of the feed and is the surface`s difference', async () => {
    const detail = await detailOf(
      tablesOf({
        events: [
          eventRow('2', '2026-08-22T09:00:00.000Z'),
          eventRow('1', '2026-08-20T09:00:00.000Z'),
        ],
      }),
    );
    // `GET /admin/events` is `recorded_at` DESCENDING because it is an incident
    // watch. This is a history and `EVENTS.md` rows the `TL` consumer as a
    // per-account CHRONOLOGICAL view.
    expect(list(detail, 'events').map((one) => one['event_id'])).toStrictEqual(['1', '2']);
  });
});

// =============================================================================
// 6. WHAT THIS RESPONSE DOES NOT DO, MEASURED RATHER THAN ASSUMED
// =============================================================================

describe('the drill-down has no INV-M6-10 projection where the feed has one', () => {
  it('carries an event payload naming a third party verbatim, which is the finding', async () => {
    const detail = await detailOf(
      tablesOf({
        events: [
          eventRow('1', '2026-08-20T09:00:00.000Z', {
            eventName: 'kyc.dedupe_hit',
            payload: { matched_identity_id: OTHER_IDENTITY },
          }),
        ],
      }),
    );
    const [one] = list(detail, 'events');
    // MEASURED AND REPORTED RATHER THAN REPAIRED IN AN ADAPTER. The feed gates
    // every key ending `identity_id` against the scope the query named; this
    // route names its subject in the PATH and does no gating, and a second gate
    // inside this module is the shape ADR-184 ruling 3 refused.
    expect((one?.['payload'] as Record<string, unknown>)['matched_identity_id']).toBe(
      OTHER_IDENTITY,
    );
  });
});

// =============================================================================
// 7. THE COMPOSITION AND THE ROUTE
// =============================================================================

describe('the composition gains one arm and the port is still partial', () => {
  it('names readAccount in IMPLEMENTED_ADMIN_READS, sorted', () => {
    expect([...IMPLEMENTED_ADMIN_READS]).toStrictEqual([...IMPLEMENTED_ADMIN_READS].sort());
    expect(IMPLEMENTED_ADMIN_READS).toContain('readAccount');
  });

  it('drops the cost and returns the detail, and null where the route answers 404', async () => {
    const recorder = new Recorder(tablesOf());
    const source = composeImplementedAdminReads({
      operator: async (fn) => await fn(recorder as unknown as AdminSourceTx),
    });
    const detail = await source.readAccount(ACCOUNT);
    expect(Object.keys(detail ?? {}).sort()).toStrictEqual([...ACCOUNT_DETAIL_SECTIONS].sort());
    expect(await source.readAccount('nobody')).toBeNull();
  });
});

describe('served through the real route, which is where the allowlist and the sweep run', () => {
  async function serve(tables: Tables = tablesOf()): Promise<{ statusCode: number; body: string }> {
    const recorder = new Recorder(tables);
    setAdminSessionSource({
      lookup: () =>
        Promise.resolve({ kind: 'operator', principal: { actorId: 'actor-1', role: 'owner' } }),
    });
    setAdminReadSource(
      composeAdminReadSource(
        composeImplementedAdminReads({
          operator: async (fn) => await fn(recorder as unknown as AdminSourceTx),
        }),
      ),
    );
    const { app } = buildServer({ surface: 'operator', modules: onDisk });
    const res = await app.inject({
      method: 'GET',
      url: `${BASE_PATH}/admin/accounts/${ACCOUNT}`,
      headers: COOKIE,
    });
    await app.close();
    return { statusCode: res.statusCode, body: res.body };
  }

  it('answers 200 where session 353 measured 500, and the difference is the adapter', async () => {
    const res = await serve();
    // Session 353 measured this route at 500 `internal_error` with an admin
    // session cookie, because no module supplied `readAccount`. It is 200 now.
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toStrictEqual([...ACCOUNT_DETAIL_SECTIONS].sort());
  });

  it('passes the section allowlist and the scalar sweep on real projected rows', async () => {
    const body = JSON.parse((await serve()).body) as Record<string, unknown>;
    const account = body['account'] as Record<string, unknown>;
    expect(account['account_id']).toBe(ACCOUNT);
    expect(account['size_cents']).toBe(5_000_000);
    const states = body['rule_states'] as readonly Record<string, unknown>[];
    expect(states[0]?.['withdrawable_cents']).toBe(12_500);
  });

  it('answers 404 for an account nobody has, over the same wiring', async () => {
    const res = await serve(tablesOf({ accounts: [] }));
    expect(res.statusCode).toBe(404);
  });
});
