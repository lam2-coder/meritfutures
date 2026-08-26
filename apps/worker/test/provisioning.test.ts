// =============================================================================
// apps/worker/test/provisioning.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF `src/provisioning/`.
//
// -----------------------------------------------------------------------------
// NOTHING HERE REACHES A DATABASE, AND SAYING SO IS PART OF THE SUITE
// -----------------------------------------------------------------------------
// `ci.yml`'s `integration` job runs on bare `ubuntu-latest` with NO services
// block, so there is no Postgres in this pipeline at all. ADR-102's own suite
// says the same about itself in its own header, and it is repeated here rather
// than assumed known: **the round trip through a real database is not asserted
// by this file and is not asserted anywhere else either.**
//
// What IS asserted is the property ADR-006 made a review criterion, at the
// resolution the property actually lives at. "Enqueue participates in the same
// transaction as the state change that caused it" is a claim about WHICH
// CONNECTION a statement went to and whether that connection committed, and a
// transaction is per connection. So `fakeDatabase` below refuses to make a
// statement durable unless the connection that ran it committed, and asserts
// the enqueue in both directions against that. This is
// `packages/queue/test/fake-database.ts`'s design, and it is REBUILT here
// rather than imported for the reason `src/provisioning/ports.ts` gives:
// `apps/worker/package.json` declares `@merit/rules-engine` and nothing else,
// `node-linker=isolated` makes an undeclared import unresolvable, and the
// manifest is outside this session's fence.
//
// -----------------------------------------------------------------------------
// WHAT THE SUITE READS RATHER THAN RESTATES
// -----------------------------------------------------------------------------
// Three lists in this module are second statements of facts that live
// elsewhere, and each is bound to its primary source by reading it:
//
//   the seven operations  <- packages/db/migrations/0007_accounts.sql's CHECK
//   the six statuses      <- packages/db/migrations/0001_...sql's enum
//   ProvisioningSqlExecutor <- packages/queue/src/job-queue.ts's JobTransaction
//
// ADR-084 section 7 is why this is worth the machinery: a suite whose expected
// value is read out of the code under test agrees with a wrong value.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  ADMISSION_REFUSALS,
  COMPENSATING_OPERATION,
  PERMITTED_TRANSITIONS,
  PROVISIONING_OPERATIONS,
  PROVISIONING_QUEUE_NAME,
  PROVISIONING_STATUSES,
  RISK_FLOOR_CENTS_FIELD,
  ProvisioningPayloadError,
  admitToTrading,
  advance,
  batchId,
  buildBatch,
  canonicalPayload,
  compensationFor,
  enqueueProvisioningOp,
  entitleAfterSetpoint,
  inRevocationOrder,
  payloadHash,
  provisioningFileName,
  renderPayload,
  runProvisioningSaga,
  setpointConfirmation,
  type AdmissionSubject,
  type EntitlementChange,
  type PlatformProvisioningPort,
  type ProvisioningBatch,
  type ProvisioningIntent,
  type ProvisioningJobQueue,
  type ProvisioningOp,
  type ProvisioningOperation,
  type ProvisioningPayload,
  type ProvisioningSqlExecutor,
  type ProvisioningStatus,
  type ProvisioningTx,
  type SetpointConfirmation,
} from '../src/provisioning/index.ts';

const MIGRATION_0001 = fileURLToPath(
  new URL('../../../packages/db/migrations/0001_extensions_and_enums.sql', import.meta.url),
);
const MIGRATION_0007 = fileURLToPath(
  new URL('../../../packages/db/migrations/0007_accounts.sql', import.meta.url),
);
const JOB_QUEUE_SOURCE = fileURLToPath(
  new URL('../../../packages/queue/src/job-queue.ts', import.meta.url),
);

// -----------------------------------------------------------------------------
// A fake Postgres at exactly one resolution
// -----------------------------------------------------------------------------
// Which connection a statement went to, and whether that connection committed.
// It does not parse SQL, does not enforce a constraint and does not know what a
// row is. It refuses to make a statement durable unless the connection that ran
// it committed, which is the one behaviour of a real database this file
// asserts against.

interface Statement {
  readonly kind: 'insert' | 'sql';
  readonly detail: string;
}

interface FakeConnection {
  readonly tx: ProvisioningTx;
  readonly statements: readonly Statement[];
  commit(): void;
  rollback(): void;
}

interface FakeDatabase {
  /** Statements that reached the database AND stayed there. */
  readonly committed: readonly Statement[];
  connection(): FakeConnection;
}

function fakeDatabase(): FakeDatabase {
  const committed: Statement[] = [];
  return {
    committed,
    connection(): FakeConnection {
      const buffered: Statement[] = [];
      let ended = false;
      const executor: ProvisioningSqlExecutor = {
        async executeSql(text: string): Promise<{ rows: unknown[] }> {
          if (ended) throw new Error('this connection has already ended.');
          buffered.push({ kind: 'sql', detail: text });
          return { rows: [] };
        },
      };
      const tx: ProvisioningTx = {
        async insert(key, values): Promise<unknown[]> {
          if (ended) throw new Error('this connection has already ended.');
          buffered.push({ kind: 'insert', detail: `${key}:${String(values['operation'])}` });
          return [values];
        },
        sqlExecutor(reason): ProvisioningSqlExecutor {
          if (reason !== 'job-enqueue') throw new Error(`bad reason ${String(reason)}`);
          return executor;
        },
      };
      return {
        tx,
        statements: buffered,
        commit(): void {
          ended = true;
          committed.push(...buffered);
        },
        rollback(): void {
          ended = true;
        },
      };
    },
  };
}

/** A queue that inserts its job through whatever executor it is handed. */
function fakeQueue(behaviour: { readonly failOn?: string } = {}): ProvisioningJobQueue {
  return {
    async enqueue(tx, request): Promise<string | null> {
      if (
        behaviour.failOn !== undefined &&
        String(request.payload['operation']) === behaviour.failOn
      ) {
        throw new Error(`the queue refused ${behaviour.failOn}`);
      }
      await tx.executeSql(`insert into j (name, data) values ($1, $2)`, [
        request.queue,
        request.payload,
      ]);
      return request.key ?? 'job-1';
    },
  };
}

function fakePlatform(
  behaviour: { readonly provisionThrows?: string } = {},
): PlatformProvisioningPort & { readonly entitled: EntitlementChange[][] } {
  const entitled: EntitlementChange[][] = [];
  return {
    platform: 'simulator',
    entitled,
    async provision(ops): Promise<ProvisioningBatch> {
      if (behaviour.provisionThrows !== undefined) throw new Error(behaviour.provisionThrows);
      const first = ops[0];
      if (first === undefined) throw new Error('empty batch');
      return {
        fileName: first.fileName ?? 'unassigned',
        operation: first.operation,
        intentCount: ops.length,
      };
    },
    async entitle(changes): Promise<ProvisioningBatch> {
      entitled.push([...changes]);
      return { fileName: 'entitle.csv', operation: 'set_entitlement', intentCount: changes.length };
    },
  };
}

const ACCOUNT = 'a1b2c3d4-0000-4000-8000-000000000001';
const FLOOR = 4_800_000n;
const SUBJECT: AdmissionSubject = { accountId: ACCOUNT, currentFloorCents: FLOOR };

function queueRow(over: {
  readonly accountId?: string;
  readonly operation?: ProvisioningOperation;
  readonly status?: ProvisioningStatus;
  readonly floorCents?: bigint | string | number | null;
  readonly confirmedAt?: Date | null;
}): Record<string, unknown> {
  const floor = over.floorCents === undefined ? FLOOR.toString(10) : over.floorCents;
  return {
    account_id: over.accountId ?? ACCOUNT,
    operation: over.operation ?? 'set_risk',
    status: over.status ?? 'confirmed',
    payload: floor === null ? {} : { [RISK_FLOOR_CENTS_FIELD]: floor },
    confirmed_at:
      over.confirmedAt === undefined ? new Date('2026-08-26T00:00:00.000Z') : over.confirmedAt,
  };
}

const SET_RISK: ProvisioningIntent = {
  accountId: ACCOUNT,
  operation: 'set_risk',
  payload: { [RISK_FLOOR_CENTS_FIELD]: FLOOR, account_ref: 'MERIT-1' },
};

// =============================================================================
describe('the vocabulary is the migrations, in both directions', () => {
  test('the seven operations are 0007_accounts.sql CHECK list', () => {
    const sql = readFileSync(MIGRATION_0007, 'utf8');
    const block = /operation\s+text NOT NULL CHECK \(operation IN \(([\s\S]*?)\)\)/.exec(sql);
    expect(block, '0007 no longer declares operation with an inline CHECK IN list').not.toBeNull();
    const declared = [...(block?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(declared).toEqual([...PROVISIONING_OPERATIONS]);
  });

  test('the six statuses are 0001 provisioning_status', () => {
    const sql = readFileSync(MIGRATION_0001, 'utf8');
    const block = /CREATE TYPE provisioning_status AS ENUM \(([\s\S]*?)\);/.exec(sql);
    expect(block, '0001 no longer declares provisioning_status').not.toBeNull();
    const declared = [...(block?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(declared).toEqual([...PROVISIONING_STATUSES]);
  });

  test('the binding CHECK 0007 carries is the one machine.ts enforces', () => {
    const sql = readFileSync(MIGRATION_0007, 'utf8');
    expect(sql).toContain('CONSTRAINT provisioning_queue_set_risk_never_inferred');
    expect(sql).toContain("operation <> 'set_risk' OR status <> 'confirmed_inferred'");
  });

  test('SD-M2-01 duplicate-intent index is keyed on the digest this module writes', () => {
    const sql = readFileSync(MIGRATION_0007, 'utf8');
    expect(sql).toContain('CREATE UNIQUE INDEX provisioning_queue_intent_uq');
    expect(sql).toContain('ON provisioning_queue (account_id, operation, payload_hash)');
    expect(sql).toContain("WHERE status <> 'failed'");
  });
});

// =============================================================================
describe("ADR-006's criterion, bound to packages/queue rather than restated", () => {
  test('ProvisioningSqlExecutor is JobTransaction, member for member', () => {
    const source = readFileSync(JOB_QUEUE_SOURCE, 'utf8');
    const body = /export interface JobTransaction \{([\s\S]*?)\n\}/.exec(source);
    expect(body, 'packages/queue no longer exports a JobTransaction interface').not.toBeNull();
    const members = (body?.[1] ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('*'));
    expect(members).toEqual([
      'executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;',
    ]);
  });

  test('enqueue still takes the transaction FIRST, with no overload that omits it', () => {
    const source = readFileSync(JOB_QUEUE_SOURCE, 'utf8');
    expect(source).toContain(
      'enqueue<P extends JobPayload>(tx: JobTransaction, request: JobRequest<P>): Promise<JobId | null>;',
    );
    // One declaration and one only. A second would be the overload the rule
    // exists to forbid.
    expect(source.match(/\n\s*enqueue</g)).toHaveLength(1);
  });
});

// =============================================================================
describe('the transactional enqueue, in both directions', () => {
  test('COMMIT makes the row AND the job durable', async () => {
    const db = fakeDatabase();
    const conn = db.connection();
    const result = await enqueueProvisioningOp(conn.tx, fakeQueue(), SET_RISK);
    expect(result.jobId).not.toBeNull();
    expect(db.committed).toHaveLength(0);
    conn.commit();
    expect(db.committed.map((s) => s.kind)).toEqual(['insert', 'sql']);
  });

  test('ROLLBACK loses the row AND the job. Neither, never one', async () => {
    const db = fakeDatabase();
    const conn = db.connection();
    await enqueueProvisioningOp(conn.tx, fakeQueue(), SET_RISK);
    expect(conn.statements).toHaveLength(2);
    conn.rollback();
    expect(db.committed).toHaveLength(0);
  });

  test('a failed enqueue leaves NO committed row, which is the approval clause', async () => {
    const db = fakeDatabase();
    const conn = db.connection();
    await expect(
      enqueueProvisioningOp(conn.tx, fakeQueue({ failOn: 'set_risk' }), SET_RISK),
    ).rejects.toThrow('the queue refused set_risk');
    // The caller abandons the transaction. The INSERT already ran on this
    // connection and is buffered; it is durable only if something commits.
    conn.rollback();
    expect(db.committed).toHaveLength(0);
  });

  test('the row and the job are on ONE connection, never two', async () => {
    const db = fakeDatabase();
    const a = db.connection();
    const b = db.connection();
    await enqueueProvisioningOp(a.tx, fakeQueue(), SET_RISK);
    expect(a.statements).toHaveLength(2);
    expect(b.statements).toHaveLength(0);
  });

  test('a deduplicated enqueue returns a key rather than an error', async () => {
    const db = fakeDatabase();
    const conn = db.connection();
    const result = await enqueueProvisioningOp(conn.tx, fakeQueue(), SET_RISK);
    expect(result.jobId).toBe(
      `${ACCOUNT}:set_risk:${payloadHash(SET_RISK.payload).toString('hex')}`,
    );
  });
});

// =============================================================================
describe("SD-M2-01's digest", () => {
  test('the same intent hashes the same however the fields were ordered', () => {
    const a: ProvisioningPayload = { b: 'two', a: 'one' };
    const b: ProvisioningPayload = { a: 'one', b: 'two' };
    expect(payloadHash(a).equals(payloadHash(b))).toBe(true);
  });

  test('two intents that plain concatenation would collide on do not', () => {
    expect(canonicalPayload({ ab: 'c' })).not.toBe(canonicalPayload({ a: 'bc' }));
    expect(payloadHash({ ab: 'c' }).equals(payloadHash({ a: 'bc' }))).toBe(false);
  });

  test('THE KEYS ARE IN THE DIGEST. Two intents with the same values do not collide', () => {
    // THIS CASE EXISTS BECAUSE A SEEDED MUTATION SURVIVED WITHOUT IT. Dropping
    // `frame(key)` from `canonicalPayload` -- keys out of the digest entirely --
    // left all sixty tests green, because the pair above is disambiguated by
    // the VALUE framing alone. The pair below is not: same values in the same
    // sorted order, different fields.
    //
    // The money form of the collision is the second assertion. A payload naming
    // a risk floor and a payload naming an account reference that happen to
    // carry the same number would be ONE intent under
    // `provisioning_queue_intent_uq`, so the second one is silently not
    // enqueued and an account is left at a floor nobody pushed.
    expect(payloadHash({ a: 'x', b: 'y' }).equals(payloadHash({ c: 'x', d: 'y' }))).toBe(false);
    expect(
      payloadHash({ [RISK_FLOOR_CENTS_FIELD]: 100n }).equals(payloadHash({ account_ref: 100n })),
    ).toBe(false);
  });

  test('the key is framed, so a key/value boundary cannot be moved', () => {
    // `{ab: 'c'}` and `{a: 'bc'}` framed without lengths are both `abc`.
    expect(payloadHash({ ab: 'c' }).equals(payloadHash({ a: 'bc' }))).toBe(false);
    expect(canonicalPayload({ a: 'b' })).toBe('1:a2:sb');
  });

  test("a string '100' and 100 cents are different intents", () => {
    expect(payloadHash({ x: '100' }).equals(payloadHash({ x: 100n }))).toBe(false);
  });

  test('null and absent are different intents', () => {
    expect(payloadHash({ x: null }).equals(payloadHash({}))).toBe(false);
  });

  test('the digest is thirty-two bytes, which is what bytea will hold', () => {
    expect(payloadHash(SET_RISK.payload)).toHaveLength(32);
  });

  test('an explicitly undefined field is a throw and not a skip', () => {
    expect(() => canonicalPayload({ x: undefined } as unknown as ProvisioningPayload)).toThrow(
      ProvisioningPayloadError,
    );
  });

  test('a float reaches the payload only past the type, and is refused', () => {
    expect(() => canonicalPayload({ x: 2.5 } as unknown as ProvisioningPayload)).toThrow(
      ProvisioningPayloadError,
    );
  });

  test('cents reach jsonb as a decimal string, above 2^53 without losing a digit', () => {
    const huge = 9_007_199_254_740_993n;
    const rendered = renderPayload({ [RISK_FLOOR_CENTS_FIELD]: huge });
    expect(rendered[RISK_FLOOR_CENTS_FIELD]).toBe('9007199254740993');
    expect(BigInt(String(rendered[RISK_FLOOR_CENTS_FIELD]))).toBe(huge);
  });

  test('an empty batch has no id, because it is a file that must not be written', () => {
    expect(() => batchId([])).toThrow(ProvisioningPayloadError);
  });

  test('the batch id does not depend on the order the intents were read in', () => {
    const h1 = payloadHash({ a: 1n });
    const h2 = payloadHash({ a: 2n });
    expect(batchId([h1, h2])).toBe(batchId([h2, h1]));
  });
});

// =============================================================================
describe("M02 section 3.3's file name", () => {
  const AT = new Date('2026-11-03T14:07:09.000Z');

  test('the name carries the operation, the UTC instant and the short batch id', () => {
    const name = provisioningFileName('set_risk', AT, [payloadHash(SET_RISK.payload)]);
    expect(name).toMatch(/^merit_set_risk_20261103_140709_[0-9a-f]{16}\.csv$/);
  });

  test('the same intents at the same instant produce the same name', () => {
    const h = [payloadHash(SET_RISK.payload)];
    expect(provisioningFileName('set_risk', AT, h)).toBe(provisioningFileName('set_risk', AT, h));
  });

  test('THE SAME INTENTS A SECOND LATER DO NOT, which is why the column exists', () => {
    const h = [payloadHash(SET_RISK.payload)];
    const later = new Date(AT.getTime() + 1000);
    expect(provisioningFileName('set_risk', AT, h)).not.toBe(
      provisioningFileName('set_risk', later, h),
    );
  });

  test('a retry KEEPS the assigned name rather than recomputing it', () => {
    const op: ProvisioningOp = {
      accountId: ACCOUNT,
      operation: 'set_risk',
      payload: SET_RISK.payload,
      payloadHash: payloadHash(SET_RISK.payload),
      fileName: 'merit_set_risk_20261103_140709_0123456789abcdef.csv',
    };
    const [kept] = buildBatch([op], new Date(AT.getTime() + 86_400_000));
    expect(kept?.fileName).toBe('merit_set_risk_20261103_140709_0123456789abcdef.csv');
  });

  test('a batch of mixed operations is refused, because the name names one', () => {
    const mk = (operation: ProvisioningOperation): ProvisioningOp => ({
      accountId: ACCOUNT,
      operation,
      payload: { x: 'y' },
      payloadHash: payloadHash({ x: operation }),
      fileName: null,
    });
    expect(() => buildBatch([mk('set_risk'), mk('set_entitlement')], AT)).toThrow(
      /carries one operation/,
    );
  });
});

// =============================================================================
describe("M02 section 3.2's machine refuses by default", () => {
  test('every permitted edge in the plan is permitted', () => {
    expect(advance('create_account', 'queued', 'written').permitted).toBe(true);
    expect(advance('create_account', 'written', 'delivered').permitted).toBe(true);
    expect(advance('create_account', 'written', 'failed').permitted).toBe(true);
    expect(advance('create_account', 'delivered', 'confirmed').permitted).toBe(true);
    expect(advance('create_account', 'delivered', 'confirmed_inferred').permitted).toBe(true);
    expect(advance('create_account', 'delivered', 'failed').permitted).toBe(true);
    expect(advance('create_account', 'failed', 'queued').permitted).toBe(true);
  });

  test('queued -> confirmed is refused: an intent confirmed without being sent', () => {
    const t = advance('create_account', 'queued', 'confirmed');
    expect(t.permitted).toBe(false);
    expect(t.permitted === false && t.refusal).toBe('not_a_permitted_edge');
  });

  test('both terminal states are terminal, for every operation', () => {
    for (const operation of PROVISIONING_OPERATIONS) {
      for (const to of PROVISIONING_STATUSES) {
        expect(advance(operation, 'confirmed', to).permitted).toBe(false);
        expect(advance(operation, 'confirmed_inferred', to).permitted).toBe(false);
      }
    }
  });

  test('AS-M2-03: set_risk may NEVER be inferred, from any status', () => {
    for (const from of PROVISIONING_STATUSES) {
      const t = advance('set_risk', from, 'confirmed_inferred');
      expect(t.permitted).toBe(false);
      expect(t.permitted === false && t.refusal).toBe('set_risk_may_never_be_inferred');
    }
  });

  test('the refusal is the DEFAULT: most status pairs are not edges', () => {
    let permitted = 0;
    for (const from of PROVISIONING_STATUSES) {
      for (const to of PROVISIONING_STATUSES) {
        if (advance('create_account', from, to).permitted) permitted += 1;
      }
    }
    // Seven edges out of thirty-six pairs. The table lists what is permitted
    // and everything else falls through to a refusal.
    expect(permitted).toBe(7);
    expect(PROVISIONING_STATUSES.length ** 2).toBe(36);
  });

  test('the machine is total over the enum', () => {
    expect(Object.keys(PERMITTED_TRANSITIONS).sort()).toEqual([...PROVISIONING_STATUSES].sort());
  });
});

// =============================================================================
describe("INV-M2-13's exit fails CLOSED", () => {
  test('a confirmed setpoint at the current floor admits, and nothing else does', () => {
    const admission = admitToTrading(SUBJECT, [queueRow({})]);
    expect(admission.admitted).toBe(true);
    expect(admission.admitted === true && admission.evidence.floorCents).toBe(FLOOR);
  });

  test('NO ROWS AT ALL refuses. The empty case is the default case', () => {
    const admission = admitToTrading(SUBJECT, []);
    expect(admission.admitted).toBe(false);
    expect(admission.admitted === false && admission.refusal).toBe('no_provisioning_row');
  });

  test('every non-confirmed status refuses, one at a time', () => {
    for (const status of PROVISIONING_STATUSES) {
      const admission = admitToTrading(SUBJECT, [queueRow({ status })]);
      expect(admission.admitted, `status ${status}`).toBe(status === 'confirmed');
    }
  });

  test('confirmed_inferred is NOT confirmation, which is AS-M2-03', () => {
    const admission = admitToTrading(SUBJECT, [queueRow({ status: 'confirmed_inferred' })]);
    expect(admission.admitted).toBe(false);
    expect(admission.admitted === false && admission.refusal).toBe('setpoint_not_confirmed');
  });

  test('a confirmed setpoint at ANOTHER floor refuses, which is INV-M2-08', () => {
    const admission = admitToTrading(SUBJECT, [
      queueRow({ floorCents: (FLOOR + 1n).toString(10) }),
    ]);
    expect(admission.admitted).toBe(false);
    expect(admission.admitted === false && admission.refusal).toBe('no_set_risk_for_current_floor');
  });

  test("another account's confirmation does not admit this one", () => {
    const admission = admitToTrading(SUBJECT, [
      queueRow({ accountId: 'a1b2c3d4-0000-4000-8000-000000000002' }),
    ]);
    expect(admission.admitted).toBe(false);
  });

  test('a confirmed create_account is not a confirmed setpoint', () => {
    const admission = admitToTrading(SUBJECT, [queueRow({ operation: 'create_account' })]);
    expect(admission.admitted).toBe(false);
  });

  test('a confirmed row with no confirmed_at refuses', () => {
    const admission = admitToTrading(SUBJECT, [queueRow({ confirmedAt: null })]);
    expect(admission.admitted).toBe(false);
  });

  test('a floor that arrived as a float refuses rather than rounding', () => {
    const admission = admitToTrading(SUBJECT, [queueRow({ floorCents: 4_800_000.5 })]);
    expect(admission.admitted).toBe(false);
  });

  test('a floor that arrived as a NUMBER refuses, because a big one lost digits', () => {
    const admission = admitToTrading(SUBJECT, [queueRow({ floorCents: 4_800_000 })]);
    expect(admission.admitted).toBe(false);
  });

  test('garbage rows contribute no evidence and no crash', () => {
    for (const junk of [null, undefined, 0, 'row', [], {}, { status: 'confirmed' }]) {
      expect(admitToTrading(SUBJECT, [junk]).admitted).toBe(false);
    }
  });

  test('a row whose status is not in the enum refuses', () => {
    const row = { ...queueRow({}), status: 'approved' };
    expect(admitToTrading(SUBJECT, [row]).admitted).toBe(false);
  });

  test('an unconfirmed row beside a confirmed one for the SAME floor still admits', () => {
    // The duplicate-intent index makes two live rows for one intent
    // impossible, so the unconfirmed one names a retired payload. The
    // confirmed row for the current floor is the evidence.
    const admission = admitToTrading(SUBJECT, [
      queueRow({ status: 'failed', confirmedAt: null }),
      queueRow({}),
    ]);
    expect(admission.admitted).toBe(true);
  });

  test('setpointConfirmation is the only producer and it refuses everything else', () => {
    const row = {
      accountId: ACCOUNT,
      operation: 'set_risk' as const,
      status: 'delivered' as const,
      payload: { [RISK_FLOOR_CENTS_FIELD]: FLOOR.toString(10) },
      confirmedAt: new Date(),
    };
    expect(setpointConfirmation(SUBJECT, row)).toBeNull();
  });

  test('the refusal vocabulary is closed at three', () => {
    expect(ADMISSION_REFUSALS).toHaveLength(3);
  });
});

// =============================================================================
describe('compensation, and what a failed compensation leaves behind', () => {
  test('five of the seven operations have no inverse in the vocabulary', () => {
    const withInverse = PROVISIONING_OPERATIONS.filter((o) => compensationFor(o) !== null);
    expect(withInverse).toEqual(['create_account', 'set_entitlement']);
  });

  test('the inverse map is total over the seven', () => {
    expect(Object.keys(COMPENSATING_OPERATION).sort()).toEqual([...PROVISIONING_OPERATIONS].sort());
  });

  test('M02 3.6 order: disable_entitlement BEFORE disable_account', () => {
    expect(inRevocationOrder(['disable_account', 'disable_entitlement'])).toEqual([
      'disable_entitlement',
      'disable_account',
    ]);
  });

  test('an operation the revocation order does not name goes LAST', () => {
    expect(inRevocationOrder(['set_risk', 'disable_account'])).toEqual([
      'disable_account',
      'set_risk',
    ]);
  });
});

// =============================================================================
describe('the saga, with a failure seeded mid-flight', () => {
  const AT = new Date('2026-11-03T14:07:09.000Z');
  const io = (over: Partial<Parameters<typeof runProvisioningSaga>[0]>) => ({
    tx: fakeDatabase().connection().tx,
    queue: fakeQueue(),
    platform: fakePlatform(),
    rows: [] as readonly unknown[],
    ...over,
  });

  test('the happy path still refuses to admit until a confirmation lands', async () => {
    const outcome = await runProvisioningSaga(io({}), SUBJECT, [SET_RISK], AT);
    expect(outcome.failure).toBeNull();
    expect(outcome.batches).toHaveLength(1);
    // THE ROWS ARE THE EVIDENCE AND THE SAGA JUST ENQUEUED AN INTENT. An
    // enqueued setpoint is not a confirmed one.
    expect(outcome.admission.admitted).toBe(false);
  });

  test('THE SEEDED FAILURE: provision throws mid-saga and the exit is CLOSED', async () => {
    const outcome = await runProvisioningSaga(
      io({ platform: fakePlatform({ provisionThrows: 'SFTP connection reset' }) }),
      SUBJECT,
      [{ ...SET_RISK, operation: 'create_account' }],
      AT,
    );
    expect(outcome.failure).toContain('SFTP connection reset');
    expect(outcome.batches).toEqual([]);
    expect(outcome.compensation).toEqual([
      {
        kind: 'compensating_enqueued',
        operation: 'create_account',
        compensating: 'disable_account',
      },
    ]);
    expect(outcome.admission.admitted).toBe(false);
  });

  test('an enqueue that fails mid-saga leaves NO committed row and refuses', async () => {
    const db = fakeDatabase();
    const conn = db.connection();
    const outcome = await runProvisioningSaga(
      io({ tx: conn.tx, queue: fakeQueue({ failOn: 'set_risk' }) }),
      SUBJECT,
      [SET_RISK],
      AT,
    );
    conn.rollback();
    expect(outcome.failure).toContain('the queue refused set_risk');
    expect(db.committed).toHaveLength(0);
    expect(outcome.compensation).toEqual([{ kind: 'rolled_back' }]);
    expect(outcome.admission.admitted).toBe(false);
  });

  test('COMPENSATION ITSELF FAILING still leaves the account out of trading', async () => {
    // The platform fails, and then the compensating enqueue fails too. This is
    // the worst reachable state and the account is in the same place it was.
    const queue: ProvisioningJobQueue = {
      async enqueue(tx, request): Promise<string | null> {
        if (request.payload['compensates'] !== undefined) {
          throw new Error('the compensating enqueue failed too');
        }
        await tx.executeSql('insert into j (name) values ($1)', [request.queue]);
        return 'job-1';
      },
    };
    const outcome = await runProvisioningSaga(
      io({ queue, platform: fakePlatform({ provisionThrows: 'vendor down' }) }),
      SUBJECT,
      [{ ...SET_RISK, operation: 'create_account' }],
      AT,
    );
    expect(outcome.compensation).toEqual([
      {
        kind: 'compensation_failed',
        operation: 'create_account',
        compensating: 'disable_account',
        cause: 'Error: the compensating enqueue failed too',
      },
    ]);
    expect(outcome.admission.admitted).toBe(false);
  });

  test('an UNCOMPENSATABLE step is named rather than silent, and still refuses', async () => {
    const outcome = await runProvisioningSaga(
      io({ platform: fakePlatform({ provisionThrows: 'vendor down' }) }),
      SUBJECT,
      [SET_RISK],
      AT,
    );
    expect(outcome.compensation).toEqual([{ kind: 'uncompensatable', operation: 'set_risk' }]);
    expect(outcome.admission.admitted).toBe(false);
  });

  test('EVERY compensation outcome leaves the account unadmitted', async () => {
    const cases: readonly (readonly [string, Parameters<typeof runProvisioningSaga>[0]])[] = [
      ['enqueue fails', io({ queue: fakeQueue({ failOn: 'set_risk' }) })],
      ['provision fails', io({ platform: fakePlatform({ provisionThrows: 'x' }) })],
      ['nothing fails', io({})],
    ];
    for (const [name, given] of cases) {
      const outcome = await runProvisioningSaga(given, SUBJECT, [SET_RISK], AT);
      expect(outcome.admission.admitted, name).toBe(false);
    }
  });

  test('the saga names the queue ST-M2-9 drains', () => {
    expect(PROVISIONING_QUEUE_NAME).toBe('provisioning');
  });
});

// =============================================================================
describe('entitle cannot be reached without a confirmed setpoint', () => {
  const evidenceFor = (subject: AdmissionSubject): SetpointConfirmation => {
    const admission = admitToTrading(subject, [queueRow({ accountId: subject.accountId })]);
    if (!admission.admitted) throw new Error('fixture did not admit');
    return admission.evidence;
  };

  test('INV-M2-15: the confirmation is the argument, not a step somebody follows', async () => {
    const platform = fakePlatform();
    await entitleAfterSetpoint(platform, evidenceFor(SUBJECT), [
      { accountId: ACCOUNT, entitlement: 'platform_access', active: true },
    ]);
    expect(platform.entitled).toEqual([
      [{ accountId: ACCOUNT, entitlement: 'platform_access', active: true }],
    ]);
  });

  test("one account's confirmation does not entitle another", async () => {
    const other = 'a1b2c3d4-0000-4000-8000-000000000002';
    await expect(
      entitleAfterSetpoint(fakePlatform(), evidenceFor(SUBJECT), [
        { accountId: other, entitlement: 'platform_access', active: true },
      ]),
    ).rejects.toThrow(/does not carry to another/);
  });
});
