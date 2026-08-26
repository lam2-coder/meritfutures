// =============================================================================
// packages/enrichment/test/observe.test.ts
// =============================================================================
// THE APPROVAL LINE, WATCHED IN ALL THREE DIRECTIONS.
//
//   "An enrichment call that times out, errors or returns a maximal risk score
//    leaves the checkout COMMITTED and reports the outcome."
//
// "LEAVES THE CHECKOUT COMMITTED" IS ASSERTED AS TWO PROPERTIES, because those
// are the two ways this path could take a purchase down from inside the
// transaction it runs in. `observeEnrichment` must RESOLVE (a rejection inside
// checkout's transaction is a `ROLLBACK`) and it must resolve to `undefined`
// (a value is something a call site can branch to a refusal on). Both are
// asserted on every direction rather than once, because they are cheap and
// because the direction that regresses is the one nobody re-checked.

import { describe, expect, test } from 'vitest';

import { ENRICHMENT_EVENT_NAME, ENRICHMENT_FIELD_ALLOWLIST } from '../src/contract.ts';
import {
  answeringVendor,
  failingVendor,
  hangingVendor,
  lateFailingVendor,
} from '../src/fakes/vendors.ts';
import {
  ENRICHMENT_SIGNAL_KIND,
  ENRICHMENT_TIMEOUT_MS,
  observeEnrichment,
  type ObserveDeps,
  type ObserveOutcome,
} from '../src/observe.ts';
import type { ContractRow, ContractSource } from '../src/contract.ts';
import type { EnrichmentAdapter, EnrichmentSubject } from '../src/port.ts';
import { SCORE_SCALE_BP } from '../src/score.ts';
import { recordingTx, type RecordingTx } from './recording-tx.ts';

const ENABLED_ROW: ContractRow = {
  integration: 'enrichment',
  eventName: ENRICHMENT_EVENT_NAME,
  fieldAllowlist: [...ENRICHMENT_FIELD_ALLOWLIST],
  enabled: true,
  version: 1,
};

const SUBJECT: EnrichmentSubject = {
  email_footprint: 'buyer@example.test',
  ip: '203.0.113.7',
  bin: '424242',
};

function contracts(rows: readonly ContractRow[]): ContractSource {
  return { rows: () => Promise.resolve([...rows]) };
}

/** A clock that advances a fixed amount per read, so `vendorElapsedMs` is deterministic. */
function steppingClock(stepMs: number): () => Date {
  let t = 0;
  return () => {
    const at = new Date(t);
    t += stepMs;
    return at;
  };
}

interface Harness {
  readonly tx: RecordingTx;
  readonly outcomes: ObserveOutcome[];
  readonly deps: ObserveDeps;
}

function harness(
  adapter: EnrichmentAdapter,
  overrides: Partial<ObserveDeps> = {},
  txOptions: Parameters<typeof recordingTx>[0] = {},
): Harness {
  const tx = recordingTx(txOptions);
  const outcomes: ObserveOutcome[] = [];
  const deps: ObserveDeps = {
    adapter,
    contracts: contracts([ENABLED_ROW]),
    subject: SUBJECT,
    purchaseId: 'purchase-1',
    now: steppingClock(5),
    report: (outcome) => outcomes.push(outcome),
    timeoutMs: 20,
    ...overrides,
  };
  return { tx, outcomes, deps };
}

/** The one assertion every direction repeats: the call resolved and returned nothing. */
async function expectNonBlocking(tx: RecordingTx, deps: ObserveDeps): Promise<void> {
  const returned = await observeEnrichment(tx, deps);
  expect(returned).toBeUndefined();
}

describe('direction 1: the vendor does not answer inside the budget', () => {
  test('the checkout is left committed, and the outcome says so', async () => {
    const { tx, outcomes, deps } = harness(hangingVendor());

    await expectNonBlocking(tx, deps);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.kind).toBe('timed_out');
    expect(outcomes[0]?.failure).toBe('no answer within 20ms');
  });

  test('the DISPATCH row is still written, because the subject already left Merit', async () => {
    const { tx, deps } = harness(hangingVendor());

    await expectNonBlocking(tx, deps);

    const dispatches = tx.writes.filter((w) => w.key === 'integrationDispatches');
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.values['status']).toBe('failed');
    // WHAT ACTUALLY WENT. The breach question is about what left the building.
    expect(dispatches[0]?.values['fieldsSent']).toEqual(['email_footprint', 'ip', 'bin']);
  });

  test('no `identity_signals` row is written, because there is nothing to record', async () => {
    const { tx, deps } = harness(hangingVendor());

    await expectNonBlocking(tx, deps);

    expect(tx.writes.filter((w) => w.key === 'identitySignals')).toHaveLength(0);
  });

  test('a rejection arriving AFTER the budget expired is already handled', async () => {
    // The property is a process-level one: an unhandled rejection in Node is a
    // process exit, and this rejection lands with no `await` waiting on it.
    const rejections: unknown[] = [];
    const watch = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', watch);
    try {
      const { tx, deps } = harness(lateFailingVendor(10), { timeoutMs: 1 });
      await expectNonBlocking(tx, deps);
      // Two macrotask turns: one for the late rejection to fire, one for Node to
      // decide whether anybody handled it.
      await new Promise((resolve) => setTimeout(resolve, 30));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off('unhandledRejection', watch);
    }
    expect(rejections).toEqual([]);
  });
});

describe('direction 2: the vendor answers with a failure', () => {
  test('the checkout is left committed and the message is reported', async () => {
    const { tx, outcomes, deps } = harness(failingVendor('upstream 503'));

    await expectNonBlocking(tx, deps);

    expect(outcomes[0]?.kind).toBe('vendor_error');
    expect(outcomes[0]?.failure).toBe('upstream 503');
    expect(outcomes[0]?.score).toBeNull();
  });

  test('the dispatch is recorded as failed and no signal is written', async () => {
    const { tx, deps } = harness(failingVendor());

    await expectNonBlocking(tx, deps);

    expect(tx.writes.map((w) => `${w.op}:${w.key}`)).toEqual(['insert:integrationDispatches']);
  });
});

describe('direction 3: the vendor answers with a maximal risk score', () => {
  test('the checkout is left committed and NOTHING refuses it', async () => {
    const { tx, outcomes, deps } = harness(answeringVendor('maximal'));

    await expectNonBlocking(tx, deps);

    const outcome = outcomes[0];
    expect(outcome?.kind).toBe('recorded');
    expect(outcome?.score).toEqual({
      kind: 'scored',
      riskBp: SCORE_SCALE_BP,
      readings: { scored: 9, unknown: 0, refused: 0 },
    });
  });

  test('the maximal score is recorded exactly like a clean one, which is the ruling', async () => {
    const worst = harness(answeringVendor('maximal'));
    const clean = harness(answeringVendor('clean'));

    await expectNonBlocking(worst.tx, worst.deps);
    await expectNonBlocking(clean.tx, clean.deps);

    // THE SHAPE OF WHAT WAS WRITTEN IS IDENTICAL. Observe mode records and does
    // not act, so the worst buyer in the population produces the same rows as
    // the best one, and only the reported score differs.
    expect(worst.tx.writes.map((w) => `${w.op}:${w.key}`)).toEqual(
      clean.tx.writes.map((w) => `${w.op}:${w.key}`),
    );
    expect(clean.outcomes[0]?.score).toEqual({
      kind: 'scored',
      riskBp: 0,
      readings: { scored: 7, unknown: 2, refused: 0 },
    });
  });
});

describe('what is recorded when the vendor answers', () => {
  test('one `identity_signals` row per finding, hashed, with the facet as the preview', async () => {
    const { tx, outcomes, deps } = harness(answeringVendor('clean'));

    await expectNonBlocking(tx, deps);

    const inserts = tx.writes.filter((w) => w.key === 'identitySignals');
    expect(inserts).toHaveLength(3);
    expect(inserts.map((w) => w.values['valuePreview'])).toEqual(['email_footprint', 'ip', 'bin']);
    for (const write of inserts) {
      expect(write.values['kind']).toBe(ENRICHMENT_SIGNAL_KIND);
      // INV-M7-08: hashed, never raw. A sha256 digest is 32 bytes.
      expect(write.values['valueHash']).toBeInstanceOf(Uint8Array);
      expect((write.values['valueHash'] as Uint8Array).byteLength).toBe(32);
    }
    expect(outcomes[0]?.signalsInserted).toBe(3);
    expect(outcomes[0]?.signalsUpdated).toBe(0);
  });

  test('the raw subject never reaches a written value', async () => {
    const { tx, deps } = harness(answeringVendor('clean'));

    await expectNonBlocking(tx, deps);

    const written = JSON.stringify(tx.writes);
    for (const value of Object.values(SUBJECT)) expect(written).not.toContain(value);
  });

  test('a tenancy column is never named, because the handle supplies it', async () => {
    const { tx, deps } = harness(answeringVendor('clean'));

    await expectNonBlocking(tx, deps);

    for (const write of tx.writes) {
      expect(write.values).not.toHaveProperty('identityId');
      expect(write.values).not.toHaveProperty('identity_id');
    }
  });

  test('a REPEAT observation reads first and updates by `id`, which is what avoids a 23505', async () => {
    const { tx, outcomes, deps } = harness(answeringVendor('clean'));

    await expectNonBlocking(tx, deps);
    await expectNonBlocking(tx, { ...deps, purchaseId: 'purchase-2' });

    const signalOps = tx.writes.filter((w) => w.key === 'identitySignals');
    expect(signalOps.filter((w) => w.op === 'insert')).toHaveLength(3);
    expect(signalOps.filter((w) => w.op === 'updateAt')).toHaveLength(3);
    // ADDRESSED BY `id` AND BY NOTHING ELSE: the natural key is a uniqueIndex
    // and `uniqueKeys()` does not read one, so `{ kind, valueHash }` would be
    // refused by `refuseUnaddressed`.
    for (const write of signalOps.filter((w) => w.op === 'updateAt')) {
      expect(Object.keys(write.at ?? {})).toEqual(['id']);
    }
    expect(outcomes[1]?.signalsInserted).toBe(0);
    expect(outcomes[1]?.signalsUpdated).toBe(3);
    expect(tx.signals.map((s) => s.observationCount)).toEqual([2, 2, 2]);
  });

  test('the read happens before the write on every finding', async () => {
    const { tx, deps } = harness(answeringVendor('clean'));

    await expectNonBlocking(tx, deps);

    expect(tx.reads).toHaveLength(3);
    for (const read of tx.reads) {
      expect(read.key).toBe('identitySignals');
      expect(Object.keys(read.where).sort()).toEqual(['kind', 'valueHash']);
    }
  });

  test('the dispatch is keyed on the purchase, so one purchase is one disclosure', async () => {
    const { tx, deps } = harness(answeringVendor('clean'));

    await expectNonBlocking(tx, deps);

    const dispatch = tx.writes.find((w) => w.key === 'integrationDispatches');
    expect(dispatch?.values['idempotencyKey']).toBe(`${ENRICHMENT_EVENT_NAME}:purchase-1`);
    expect(dispatch?.values['status']).toBe('sent');
    // `integration_dispatches_sent_has_timestamp` CHECKs that a `sent` row has one.
    expect(dispatch?.values['dispatchedAt']).toBeInstanceOf(Date);
    expect(dispatch?.values['eventId']).toBeNull();
  });

  test('the dispatch row is written BEFORE the signals, because the disclosure happened first', async () => {
    const { tx, deps } = harness(answeringVendor('clean'));

    await expectNonBlocking(tx, deps);

    expect(tx.writes[0]?.key).toBe('integrationDispatches');
  });

  test('`ageDays` is carried into the outcome and contributes nothing to the score', async () => {
    const { tx, outcomes, deps } = harness(answeringVendor('clean'));

    await expectNonBlocking(tx, deps);

    expect(outcomes[0]?.ages).toEqual([
      { facet: 'email_footprint', ageDays: 3650 },
      { facet: 'ip', ageDays: 3650 },
      { facet: 'bin', ageDays: 3650 },
    ]);
    // The same findings with a different age score identically, because there is
    // no curve and ADR-023 rules that one is fitted on beta data.
    expect(outcomes[0]?.score).toMatchObject({ kind: 'scored', riskBp: 0 });
  });
});

describe('the contract gates the call, and its absence blocks nothing', () => {
  test('no enabled row means no call, no disclosure and no row', async () => {
    let called = 0;
    const counting: EnrichmentAdapter = {
      integration: 'enrichment',
      assess: () => {
        called += 1;
        return Promise.resolve({ findings: [] });
      },
    };
    const { tx, outcomes, deps } = harness(counting, {
      contracts: contracts([{ ...ENABLED_ROW, enabled: false }]),
    });

    await expectNonBlocking(tx, deps);

    expect(called).toBe(0);
    expect(tx.writes).toHaveLength(0);
    expect(outcomes[0]?.kind).toBe('not_configured');
  });

  test('a facet the contract does not permit never reaches the vendor', async () => {
    let seen: EnrichmentSubject = {};
    const spy: EnrichmentAdapter = {
      integration: 'enrichment',
      assess: (subject) => {
        seen = subject;
        return Promise.resolve({ findings: [] });
      },
    };
    const { tx, outcomes, deps } = harness(spy, {
      contracts: contracts([{ ...ENABLED_ROW, fieldAllowlist: ['ip'] }]),
    });

    await expectNonBlocking(tx, deps);

    expect(seen).toEqual({ ip: '203.0.113.7' });
    expect(outcomes[0]?.fieldsSent).toEqual(['ip']);
  });

  test('a contract permitting only what this checkout lacks makes no call at all', async () => {
    let called = 0;
    const counting: EnrichmentAdapter = {
      integration: 'enrichment',
      assess: () => {
        called += 1;
        return Promise.resolve({ findings: [] });
      },
    };
    const { tx, outcomes, deps } = harness(counting, {
      contracts: contracts([{ ...ENABLED_ROW, fieldAllowlist: ['phone_footprint'] }]),
    });

    await expectNonBlocking(tx, deps);

    expect(called).toBe(0);
    expect(tx.writes).toHaveLength(0);
    expect(outcomes[0]?.kind).toBe('nothing_to_send');
  });

  test('a contract read that THROWS still leaves the checkout committed', async () => {
    const { tx, outcomes, deps } = harness(answeringVendor('clean'), {
      contracts: { rows: () => Promise.reject(new Error('firm read failed')) },
    });

    await expectNonBlocking(tx, deps);

    expect(outcomes[0]?.kind).toBe('record_failed');
    expect(outcomes[0]?.failure).toBe('firm read failed');
  });
});

describe('the failures that are not the vendor', () => {
  test('a failing WRITE is caught, and the outcome names it rather than the checkout', async () => {
    const { tx, outcomes, deps } = harness(
      answeringVendor('clean'),
      {},
      { failWritesTo: 'identitySignals' },
    );

    await expectNonBlocking(tx, deps);

    expect(outcomes[0]?.kind).toBe('record_failed');
    expect(outcomes[0]?.failure).toContain('unique constraint');
  });

  test('a THROWING reporter cannot abort a purchase', async () => {
    const tx = recordingTx();
    const deps: ObserveDeps = {
      adapter: answeringVendor('clean'),
      contracts: contracts([ENABLED_ROW]),
      subject: SUBJECT,
      purchaseId: 'purchase-1',
      now: steppingClock(5),
      report: () => {
        throw new Error('the sink is down');
      },
      timeoutMs: 20,
    };

    await expect(observeEnrichment(tx, deps)).resolves.toBeUndefined();
  });

  test('an adapter that throws SYNCHRONOUSLY is caught too', async () => {
    const rude: EnrichmentAdapter = {
      integration: 'enrichment',
      assess: () => {
        throw new Error('threw instead of rejecting');
      },
    };
    const { tx, outcomes, deps } = harness(rude);

    await expectNonBlocking(tx, deps);

    expect(outcomes[0]?.kind).toBe('record_failed');
    expect(outcomes[0]?.failure).toBe('threw instead of rejecting');
  });
});

describe('the budget', () => {
  test('the exported constant is an integer number of milliseconds', () => {
    expect(Number.isInteger(ENRICHMENT_TIMEOUT_MS)).toBe(true);
    expect(ENRICHMENT_TIMEOUT_MS).toBeGreaterThan(0);
  });

  test('a hanging vendor loses the race even though it ignores the abort signal', async () => {
    const started = Date.now();
    const { tx, deps } = harness(hangingVendor(), { timeoutMs: 15 });

    await expectNonBlocking(tx, deps);

    // The property is that it returns AT ALL, promptly, against an adapter with
    // no manners. The bound is loose because a scheduler is not a clock.
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
