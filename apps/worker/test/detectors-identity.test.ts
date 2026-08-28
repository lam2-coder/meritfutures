// =============================================================================
// apps/worker/test/detectors-identity.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF `src/detectors/identity.ts`. `P7` section 8's `P7-h`.
//
// **THE SENTENCE THIS SUITE EXISTS TO MAKE FALSE IS `M07` SECTION 8's**: *"A
// detector tested only against a case that should fire proves nothing about its
// threshold, and threshold errors are how a detector becomes either noise or
// nothing."* So every one of the seven detectors here carries a POSITIVE fixture
// and a NEAR-MISS fixture, and the near-miss is the one that is written first.
//
// **`D-18`'s NEAR-MISS IS NAMED IN THE PLAN BECAUSE IT IS THE ONE A READER WOULD
// BUILD WRONG** (`M07` section 8): *"The positive is the four-leg fleet
// signature. The near-miss is A VENDOR TIMEOUT: `line_type = 'unknown'`,
// `footprint_present IS NULL`, everything else identical. It must NOT fire, and
// a detector written against `footprint_present IS NOT TRUE` fires on it."*
//
// It is asserted at BOTH levels, because the predicate runs at both and a suite
// that pinned only one would go green on half a mutation:
//
//   AT THE ACCESSOR  the window narrows on `footprintPresent: false`, so the
//                    timeout row never crosses. Section 8 drives a `rowsWhere`
//                    that APPLIES the filter rather than ignoring it, because a
//                    fake that returns everything cannot tell `IS FALSE` from
//                    `IS NOT TRUE` at all.
//   IN THE DETECTOR  the canary rows are merged into the stream AFTER the read
//                    and never travel through `rowsWhere`, so a battery row
//                    bypasses the accessor's predicate entirely and
//                    `fleetSignatureRows` is the only thing standing between a
//                    null and a flag.
//
// -----------------------------------------------------------------------------
// WHAT THIS SUITE READS RATHER THAN RESTATES
// -----------------------------------------------------------------------------
// Every constant `identity.ts` declares because it cannot import it is BOUND to
// its source by reading that source as text, which is `detector-runner.test.ts`'s
// idiom one file over and is why a rename in the corpus goes red here rather
// than going quiet:
//
//   the `risk_flags.flag_type` vocabulary   docs/architecture/data-model/risk_flags.md
//   the `consistency` gate name             packages/rules-engine/src/hash.ts
//   `D-18`'s `IS FALSE` test                packages/db/src/seed/detectors/*.rows.json
//   the registry's own unstated values      the same seed, read as data
//
// -----------------------------------------------------------------------------
// NOTHING HERE REACHES A DATABASE
// -----------------------------------------------------------------------------
// `ci.yml`'s `integration` job runs on bare `ubuntu-latest` with no services
// block. What IS asserted is the property at the resolution it lives at: which
// port was called, with what filter, and what the run committed. The honest
// bound `detector-runner.test.ts` states applies here unchanged: this proves the
// predicate and the window shape, and proves nothing about a nightly production
// run.
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { canaryNonce, isCanaryId } from '../src/detectors/canary.ts';
import type { CanaryMint, CanaryNonce, CanarySubject } from '../src/detectors/canary.ts';
import { canaryMint } from '../src/detectors/canary.ts';
import {
  CANARY_MAGNITUDE,
  CONSISTENCY_GATE,
  CentsRangeError,
  D07_ENTITY_CAP,
  D08_PAYMENT_VELOCITY,
  D09_DESTINATION_CONCENTRATION,
  D10_AFFILIATE_SELF_DEAL,
  D11_DILUTION_TIMING,
  D16_LINK_CONFIDENCE,
  D18_REGISTRATION_PHONE,
  DETECTOR_BLOCKERS,
  DOCUMENTED_FLAG_TYPES,
  FLAG_TYPE_BY_DETECTOR,
  FLEET_SIGNATURE_LEGS,
  IDENTITY_DETECTORS,
  IDENTITY_DETECTOR_IDS,
  MIN_CORRELATION_DAYS,
  accountOwners,
  cents,
  detectorBlockerSummary,
  dilutionCandidates,
  failingGates,
  flagTypeOf,
  fleetSignatureRows,
  hardLinkEdges,
  hasNoFootprint,
  isVoipLine,
  liveEdges,
  overCapEntities,
  paymentVelocityBreaches,
  pearsonBp,
  registryBlockers,
  registryParameter,
  related,
  relatedComponents,
  selfDealAttributions,
  sharedDestinations,
  statedInteger,
  statedValue,
} from '../src/detectors/identity.ts';
import type { IdentityDetectorId } from '../src/detectors/identity.ts';
import { runDetectors } from '../src/detectors/runner.ts';
import type {
  Detector,
  DetectorDefinition,
  DetectorEvent,
  DetectorFilter,
  DetectorRow,
  DetectorScanRequest,
  DetectorTx,
  DetectorValues,
} from '../src/detectors/ports.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, 'utf8');

const SEED_ROWS = (
  JSON.parse(read('packages/db/src/seed/detectors/m07-detectors-v1.rows.json')) as {
    readonly rows: readonly unknown[];
  }
).rows as readonly {
  readonly detector: string;
  readonly version: string;
  readonly parameters: Record<string, unknown>;
  readonly is_sensitive?: boolean;
}[];

/** The registry row `P7-d` actually seeded, as the runner would hand it over. */
function seededDefinition(detector: IdentityDetectorId): DetectorDefinition {
  const row = SEED_ROWS.find((each) => each.detector === detector);
  if (row === undefined) {
    throw new Error(`the seed carries no row for ${detector}`);
  }
  return {
    detector,
    version: row.version,
    parameters: row.parameters,
    isSensitive: row.is_sensitive !== false,
  };
}

/** A registry row with values the seed does not yet state, for the fire-path cases. */
function completedDefinition(
  detector: IdentityDetectorId,
  extra: Record<string, unknown>,
): DetectorDefinition {
  const seeded = seededDefinition(detector);
  const parameters: Record<string, unknown> = { ...seeded.parameters };
  for (const [name, value] of Object.entries(extra)) {
    parameters[name] = { state: 'stated', value, unit: 'fixture' };
  }
  return { ...seeded, parameters };
}

const NOW = new Date('2026-01-09T02:00:00.000Z');

function requestFor(
  detector: IdentityDetectorId,
  definition: DetectorDefinition,
): DetectorScanRequest {
  return {
    detector,
    tradingDay: '2026-01-09',
    definition,
    terms: {
      atMost: (value) => ({ term: 'at-most', value }),
      atLeast: (value) => ({ term: 'at-least', value }),
      isNull: () => ({ term: 'is-null' }),
    },
    now: NOW,
  };
}

/** The mint the runner would hand a detector, on a fixed nonce. */
function mintFor(raw = 'nonce-p7h-0001'): CanaryMint {
  return canaryMint(canaryNonce(raw));
}

// -----------------------------------------------------------------------------
// A `rowsWhere` that APPLIES the filter, which is what makes section 8 mean
// something
// -----------------------------------------------------------------------------

interface Written {
  readonly table: string;
  readonly values: DetectorValues;
}

/**
 * `ADR-157`'s terms, evaluated the way Postgres evaluates them.
 *
 * **THE EQUALITY IS THE HALF THAT MATTERS HERE AND IT IS `===`.** `IS FALSE` on
 * a `null` is `false` in SQL and `null === false` is `false` in JavaScript, so
 * a fake that filters faithfully reproduces the exact behaviour `D-18` rests on.
 * A fake that ignored the filter would return the vendor-timeout row to every
 * detector and the near-miss case would pass under a mutation.
 */
function matches(row: DetectorRow, where: DetectorFilter): boolean {
  for (const [column, expected] of Object.entries(where)) {
    const actual = row[column];
    if (typeof expected === 'object' && expected !== null && 'term' in expected) {
      const term = expected as { term: string; value?: unknown };
      if (term.term === 'is-null') {
        if (actual !== null && actual !== undefined) {
          return false;
        }
        continue;
      }
      if (actual === null || actual === undefined) {
        return false;
      }
      const left = actual instanceof Date ? actual.getTime() : actual;
      const right = term.value instanceof Date ? term.value.getTime() : term.value;
      if (typeof left === 'string' && typeof right === 'string') {
        if (term.term === 'at-most' ? left > right : left < right) {
          return false;
        }
        continue;
      }
      if (typeof left !== 'number' || typeof right !== 'number') {
        return false;
      }
      if (term.term === 'at-most' ? left > right : left < right) {
        return false;
      }
      continue;
    }
    if (actual !== expected) {
      return false;
    }
  }
  return true;
}

interface HarnessOptions {
  readonly rows?: Readonly<Record<string, readonly DetectorRow[]>>;
  readonly definitions?: readonly Record<string, unknown>[];
  readonly nonce?: readonly string[];
}

function harness(options: HarnessOptions = {}) {
  const writes: Written[] = [];
  const events: DetectorEvent[] = [];
  const reads: { table: string; where: DetectorFilter }[] = [];
  const pool = [...(options.nonce ?? ['nonce-p7h-0001', 'nonce-p7h-0002'])];
  let sequence = 0;
  let tick = 0;

  const handle: DetectorTx = {
    rowsWhere: (table, where) => {
      reads.push({ table, where });
      if (table === 'detectorDefinitions') {
        const wanted = where['detector'];
        return Promise.resolve(
          (options.definitions ?? []).filter((row) => row['detector'] === wanted),
        );
      }
      return Promise.resolve((options.rows?.[table] ?? []).filter((row) => matches(row, where)));
    },
    insert: (table, values) => {
      sequence += 1;
      const row = { ...values, id: `written-${String(sequence)}` };
      writes.push({ table, values: row });
      return Promise.resolve([row]);
    },
  };

  return {
    writes,
    events,
    reads,
    io: {
      transact: <T>(fn: (tx: DetectorTx) => Promise<T>): Promise<T> => fn(handle),
      terms: {
        atMost: (value: NonNullable<unknown>) => ({ term: 'at-most' as const, value }),
        atLeast: (value: NonNullable<unknown>) => ({ term: 'at-least' as const, value }),
        isNull: () => ({ term: 'is-null' as const }),
      },
      events: {
        emit: (_tx: DetectorTx, event: DetectorEvent): Promise<void> => {
          events.push(event);
          return Promise.resolve();
        },
      },
      now: (): Date => {
        tick += 1000;
        return new Date(NOW.getTime() + tick);
      },
      nonce: (): CanaryNonce => canaryNonce(pool.shift() ?? 'nonce-exhausted'),
    },
  };
}

/** A registry row in the shape `readDefinition` reads, from a real seeded row. */
function definitionRow(detector: IdentityDetectorId, extra: Record<string, unknown> = {}) {
  const definition = completedDefinition(detector, extra);
  return {
    detector,
    version: definition.version,
    parameters: definition.parameters,
    isSensitive: definition.isSensitive,
    effectiveTo: null,
  };
}

/** Every stream a detector declares, as a name -> filter map. */
function streamsOf(detector: Detector, definition: DetectorDefinition) {
  const request = requestFor(detector.id as IdentityDetectorId, definition);
  return detector.streams(request);
}

/** Every value the run wrote, flattened, so a canary anywhere in it is visible. */
function everyWrittenValue(writes: readonly Written[]): unknown[] {
  const out: unknown[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === 'object' && value !== null) {
      Object.values(value).forEach(walk);
      return;
    }
    out.push(value);
  };
  writes.forEach((write) => {
    walk(write.values);
  });
  return out;
}

// =============================================================================
// 1. THE CONSTANTS, BOUND TO THEIR SOURCES RATHER THAN TO A COPY OF THEMSELVES
// =============================================================================

describe('the corpus values this module transcribes', () => {
  it('DOCUMENTED_FLAG_TYPES is the vocabulary risk_flags.md carries, in its order', () => {
    const doc = read('docs/architecture/data-model/risk_flags.md');
    const row = doc.split('\n').find((line) => line.startsWith('| `flag_type` |'));
    expect(row).toBeDefined();
    const declared = [...(row ?? '').matchAll(/`([a-z_]+)`/g)]
      .map((match) => match[1])
      .filter((name) => name !== 'flag_type' && name !== 'text');
    expect(declared).toEqual([...DOCUMENTED_FLAG_TYPES]);
  });

  it('every flag_type this module can write is a member of that vocabulary', () => {
    for (const value of Object.values(FLAG_TYPE_BY_DETECTOR)) {
      expect(DOCUMENTED_FLAG_TYPES).toContain(value);
    }
  });

  it('FOUR of the seven have no documented flag_type, and none is invented for them', () => {
    const undocumented = IDENTITY_DETECTOR_IDS.filter(
      (id) => FLAG_TYPE_BY_DETECTOR[id] === undefined,
    );
    expect(undocumented).toEqual(['D-09', 'D-11', 'D-16', 'D-18']);
    // The column has no CHECK, so any string would insert. The refusal is the
    // control, and it names the registry as where a new member is claimed.
    for (const id of undocumented) {
      expect(() => flagTypeOf(id, seededDefinition(id))).toThrow(/no risk_flags.flag_type/u);
      expect(() => flagTypeOf(id, seededDefinition(id))).toThrow(/registry row/u);
    }
  });

  it('a flag_type stated by the registry wins over the documented mapping', () => {
    const definition = completedDefinition('D-07', { flag_type: 'entity_cap_v2' });
    expect(flagTypeOf('D-07', definition)).toBe('entity_cap_v2');
  });

  it('CONSISTENCY_GATE names a real leaf of ENGINE_GATE_LEAVES', () => {
    const hash = read('packages/rules-engine/src/hash.ts');
    const leaves = [...hash.matchAll(/path: '([a-zA-Z.]+)'/g)].map((match) => match[1] ?? '');
    expect(leaves.length).toBeGreaterThan(0);
    expect(leaves).toContain(`${CONSISTENCY_GATE}.pass`);
    // And `skipped` is a real leaf too, which is why `failingGates` reads it: a
    // skipped gate is not a failing gate.
    expect(leaves).toContain(`${CONSISTENCY_GATE}.skipped`);
  });

  it("D-18's IS FALSE test is the value the seed states, and the seed refuses IS NOT TRUE", () => {
    const parameters = seededDefinition('D-18').parameters;
    const test = registryParameter(
      { ...seededDefinition('D-18'), parameters },
      'footprint_present_test',
    );
    expect(statedValue(test)).toBe('IS FALSE');
    // The seed's `note` QUOTES the wrong spelling in order to refuse it, which
    // is why the assertion is on the value and not on the absence of a phrase.
    expect(
      JSON.stringify(registryParameter(seededDefinition('D-18'), 'leg_no_footprint')),
    ).toContain('footprint_present = false');
  });

  it('the seed leaves both of D-09 severity-5 and the hold band where M07 put them', () => {
    // `contextual` with exactly one case, at 5, cited to the severity-5 row.
    const severity = registryParameter(seededDefinition('D-09'), 'severity');
    expect(severity?.state).toBe('contextual');
    expect(severity?.cases).toHaveLength(1);
    expect(statedInteger(severity)).toBe(5);
  });

  it('a contextual parameter with more than one case does NOT resolve', () => {
    // Choosing between two bands is the money decision M07 puts on a dated data
    // change, so a detector that picked one would be making it by running.
    expect(
      statedValue({ state: 'contextual', cases: [{ value: 4 }, { value: 5 }] }),
    ).toBeUndefined();
    expect(statedValue({ state: 'unstated', value: null })).toBeUndefined();
    expect(statedValue({ state: 'not_applicable', value: null })).toBeUndefined();
    expect(statedValue({ state: 'stated', value: 3 })).toBe(3);
  });
});

// =============================================================================
// 2. ADR-155. NO PATH TO `enforced`, AND IT IS THE TYPE THAT STOPS IT
// =============================================================================

describe('ADR-155 clause 2: no detector writes a risk_flags.status other than open', () => {
  it('every flag this module can raise is written at open and at nothing else', async () => {
    const run = harness({
      definitions: [
        definitionRow('D-16', {
          hard_link_confidence_ceiling_bp: 9000,
          sla_hours: 24,
          flag_type: 'inverse_pair',
        }),
      ],
      rows: {
        identityLinks: [
          {
            id: 'link-1',
            identityA: 'identity-a',
            identityB: 'identity-b',
            linkKind: 'biometric_match',
            confidenceBp: 9500,
            suppressed: false,
          },
        ],
      },
    });
    const report = await runDetectors([D16_LINK_CONFIDENCE], { tradingDay: '2026-01-09' }, run.io);
    const flags = run.writes.filter((write) => write.table === 'riskFlags');

    expect(report.outcomes[0]?.status).toBe('ok');
    expect(flags.length).toBeGreaterThan(0);
    for (const flag of flags) {
      expect(flag.values['status']).toBe('open');
    }
  });

  it('the word enforced appears in no value the run committed, at severity 5', async () => {
    const run = harness({
      definitions: [
        definitionRow('D-16', {
          hard_link_confidence_ceiling_bp: 9000,
          sla_hours: 24,
          flag_type: 'inverse_pair',
        }),
      ],
      rows: {
        identityLinks: [
          {
            id: 'link-1',
            identityA: 'identity-a',
            identityB: 'identity-b',
            linkKind: 'biometric_match',
            confidenceBp: 10000,
            suppressed: false,
          },
        ],
      },
    });
    await runDetectors([D16_LINK_CONFIDENCE], { tradingDay: '2026-01-09' }, run.io);
    const flags = run.writes.filter((write) => write.table === 'riskFlags');
    expect(flags.every((flag) => flag.values['severity'] === 5)).toBe(true);
    for (const value of everyWrittenValue(run.writes)) {
      expect(String(value)).not.toContain('enforced');
    }
  });

  it('DETECTOR_WRITE_TABLES has no identity_links door, so no hard link is written here', async () => {
    const ports = read('apps/worker/src/detectors/ports.ts');
    expect(ports).toMatch(
      /DETECTOR_WRITE_TABLES = \['detectorRuns', 'riskFlags', 'correlationGroups'\]/u,
    );
    const run = harness({
      definitions: [
        definitionRow('D-16', {
          hard_link_confidence_ceiling_bp: 9000,
          sla_hours: 24,
          flag_type: 'inverse_pair',
        }),
      ],
      rows: {
        identityLinks: [
          {
            id: 'link-1',
            identityA: 'identity-a',
            identityB: 'identity-b',
            linkKind: 'biometric_match',
            confidenceBp: 10000,
            suppressed: false,
          },
        ],
      },
    });
    await runDetectors([D16_LINK_CONFIDENCE], { tradingDay: '2026-01-09' }, run.io);
    expect(run.writes.map((write) => write.table).sort()).toEqual(
      expect.not.arrayContaining(['identityLinks']),
    );
  });

  it('the module never names a risk_flags status other than open in its own code', () => {
    const source = read('apps/worker/src/detectors/identity.ts');
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/u.test(line))
      .join('\n');
    for (const forbidden of ["'enforced'", '"enforced"', "'investigating'", "'dismissed'"]) {
      expect(code).not.toContain(forbidden);
    }
  });
});

// =============================================================================
// 3. D-07  ENTITY CAP AGGREGATION
// =============================================================================

describe('D-07 entity cap aggregation', () => {
  const accounts = (identityId: string, count: number, from = 0): DetectorRow[] =>
    Array.from({ length: count }, (_unused, n) => ({
      id: `${identityId}-account-${String(from + n)}`,
      identityId,
      closedOn: null,
    }));

  it('POSITIVE: one more account than the plan maximum is over cap', () => {
    const hits = overCapEntities(accounts('identity-a', 4), [], 3);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.identityId).toBe('identity-a');
    expect(hits[0]?.maxAccounts).toBe(3);
    expect(hits[0]?.capSource).toBe('plan_maximum');
    expect(hits[0]?.accountIds).toHaveLength(4);
  });

  it('NEAR-MISS: exactly the plan maximum is not over cap', () => {
    expect(overCapEntities(accounts('identity-a', 3), [], 3)).toEqual([]);
  });

  it('NEAR-MISS: a granted override raises the cap and the entity stops being over it', () => {
    // THE ROW THE `identities` WINDOW IS PAID FOR. A detector blind to the
    // override flags exactly the customers who were granted an exception.
    const identities = [{ id: 'identity-a', maxAccountsOverride: 6 }];
    expect(overCapEntities(accounts('identity-a', 4), identities, 3)).toEqual([]);
  });

  it('an override BELOW the plan maximum still binds, and the source is recorded', () => {
    const identities = [{ id: 'identity-a', maxAccountsOverride: 1 }];
    const hits = overCapEntities(accounts('identity-a', 2), identities, 99);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.maxAccounts).toBe(1);
    expect(hits[0]?.capSource).toBe('override');
  });

  it('a closed account is not held, so it does not count toward the cap', () => {
    const rows = [
      ...accounts('identity-a', 3),
      { id: 'closed', identityId: 'identity-a', closedOn: '2026-01-01' },
    ];
    expect(overCapEntities(rows, [], 3)).toEqual([]);
  });

  it('the window is live accounts and every identity, and the identity narrowing is the run instant', () => {
    const streams = streamsOf(D07_ENTITY_CAP, seededDefinition('D-07'));
    expect(streams.map((stream) => stream.table)).toEqual(['accounts', 'identities']);
    expect(streams[0]?.where).toEqual({ closedOn: { term: 'is-null' } });
    expect(streams[1]?.where).toEqual({ createdAt: { term: 'at-most', value: NOW } });
    // NOT narrowed by `status`: a restricted identity's override is still the
    // cap that binds its accounts.
    expect(JSON.stringify(streams[1]?.where)).not.toContain('status');
  });

  it('its canary is threshold-independent, because it carries its own override of one', () => {
    const [subject] = D07_ENTITY_CAP.canaries(mintFor());
    expect(subject).toBeDefined();
    const identityRow = subject?.rows['identities']?.[0];
    expect(identityRow?.['maxAccountsOverride']).toBe(1);
    expect(subject?.rows['accounts']).toHaveLength(2);
    for (const plausibleMaximum of [1, 2, 3, 5, 10, 100]) {
      const hits = overCapEntities(
        subject?.rows['accounts'] ?? [],
        subject?.rows['identities'] ?? [],
        plausibleMaximum,
      );
      expect(hits).toHaveLength(1);
    }
  });
});

// =============================================================================
// 4. D-08  PAYMENT VELOCITY
// =============================================================================

describe('D-08 payment velocity', () => {
  const signal = (identityId: string, valueHash: string): DetectorRow => ({
    id: `${identityId}-${valueHash}`,
    identityId,
    kind: 'payment',
    valueHash,
  });

  it('POSITIVE: an identity holding one card more than the maximum', () => {
    const rows = ['a', 'b', 'c', 'd'].map((card) => signal('identity-a', card));
    const hits = paymentVelocityBreaches(rows, 3, 99);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.statistic).toBe('cards_per_identity');
    expect(hits[0]?.observed).toBe(4);
  });

  it('NEAR-MISS: exactly the maximum number of cards does not fire', () => {
    const rows = ['a', 'b', 'c'].map((card) => signal('identity-a', card));
    expect(paymentVelocityBreaches(rows, 3, 99)).toEqual([]);
  });

  it('POSITIVE: one fingerprint reaching one identity more than the maximum', () => {
    const rows = ['a', 'b', 'c'].map((identity) => signal(`identity-${identity}`, 'card-1'));
    const hits = paymentVelocityBreaches(rows, 99, 2);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.statistic).toBe('identities_per_fingerprint');
    expect(hits[0]?.identityIds).toEqual(['identity-a', 'identity-b', 'identity-c']);
  });

  it('NEAR-MISS: the same card seen many times by ONE identity is not a velocity', () => {
    // `identity_signals_identity_kind_value_uq` makes this one row in reality,
    // and the detector counts DISTINCT values so a duplicate cannot inflate it.
    const rows = [signal('identity-a', 'card-1'), signal('identity-a', 'card-1')];
    expect(paymentVelocityBreaches(rows, 1, 1)).toEqual([]);
  });

  it('the window is one signal kind bounded by last_seen_at, and window_days is its bound', () => {
    const definition = completedDefinition('D-08', { window_days: 30 });
    const streams = streamsOf(D08_PAYMENT_VELOCITY, definition);
    expect(streams).toHaveLength(1);
    expect(streams[0]?.table).toBe('identitySignals');
    expect(streams[0]?.where['kind']).toBe('payment');
    expect(streams[0]?.where['lastSeenAt']).toEqual({
      term: 'at-least',
      value: new Date(NOW.getTime() - 30 * 86400000),
    });
  });

  it('with NO window_days the detector reads nothing at all rather than reading unbounded', () => {
    expect(streamsOf(D08_PAYMENT_VELOCITY, seededDefinition('D-08'))).toEqual([]);
  });

  it('its two canaries are one per statistic and both sit at CANARY_MAGNITUDE', () => {
    const subjects = D08_PAYMENT_VELOCITY.canaries(mintFor());
    expect(subjects).toHaveLength(2);
    const hits = paymentVelocityBreaches(
      subjects.flatMap((subject) => [...(subject.rows['signals'] ?? [])]),
      CANARY_MAGNITUDE - 1,
      CANARY_MAGNITUDE - 1,
    );
    expect(hits.map((hit) => hit.statistic).sort()).toEqual([
      'cards_per_identity',
      'identities_per_fingerprint',
    ]);
  });
});

// =============================================================================
// 5. D-09  DESTINATION CONCENTRATION, AND THE INPUT IT DOES NOT HAVE
// =============================================================================

describe('D-09 destination concentration', () => {
  const transfer = (id: string, identityId: string, destinationRef: string): DetectorRow => ({
    id,
    identityId,
    destinationRef,
  });

  it('POSITIVE: one destination receiving from two unrelated identities', () => {
    const hits = sharedDestinations(
      [transfer('t1', 'identity-a', 'dest-1'), transfer('t2', 'identity-b', 'dest-1')],
      liveEdges([]),
      1,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.unrelatedGroups).toBe(2);
    expect(hits[0]?.identityIds).toEqual(['identity-a', 'identity-b']);
  });

  it('NEAR-MISS: one destination receiving many payouts from ONE identity', () => {
    const hits = sharedDestinations(
      [transfer('t1', 'identity-a', 'dest-1'), transfer('t2', 'identity-a', 'dest-1')],
      liveEdges([]),
      1,
    );
    expect(hits).toEqual([]);
  });

  it('NEAR-MISS: two identities already LINKED are one entity and do not fire', () => {
    // AS-M7-04's population. A married couple settling to a joint account is not
    // a mule ring, and counting them as two would make the strongest detector in
    // the module also its loudest false positive.
    const links = liveEdges([
      { id: 'l1', identityA: 'identity-a', identityB: 'identity-b', suppressed: false },
    ]);
    expect(
      sharedDestinations(
        [transfer('t1', 'identity-a', 'dest-1'), transfer('t2', 'identity-b', 'dest-1')],
        links,
        1,
      ),
    ).toEqual([]);
  });

  it('a SUPPRESSED link does not relate two identities, so the pair fires again', () => {
    // SD-M7-04: a suppressed edge stops contributing to enforcement, and it
    // cuts BOTH ways. A withdrawn edge cannot go on excusing a shared
    // destination either.
    const links = liveEdges([
      { id: 'l1', identityA: 'identity-a', identityB: 'identity-b', suppressed: true },
    ]);
    expect(
      sharedDestinations(
        [transfer('t1', 'identity-a', 'dest-1'), transfer('t2', 'identity-b', 'dest-1')],
        links,
        1,
      ),
    ).toHaveLength(1);
  });

  it('a chain of links collapses transitively into one group', () => {
    const links = liveEdges([
      { id: 'l1', identityA: 'identity-a', identityB: 'identity-b', suppressed: false },
      { id: 'l2', identityA: 'identity-b', identityB: 'identity-c', suppressed: false },
    ]);
    expect(relatedComponents(['identity-a', 'identity-b', 'identity-c'], links)).toBe(1);
    // THE PATH RUNS THROUGH `identity-b`, WHO HOLDS NO DESTINATION HERE, and it
    // still relates a to c. A household of three is not two unrelated parties
    // because the person who owns the card did not withdraw this week.
    expect(relatedComponents(['identity-a', 'identity-c', 'identity-d'], links)).toBe(2);
    expect(related(links, 'identity-a', 'identity-a')).toBe(true);
  });

  it('DEP-M7-04: it declines because payout_transfers reaches no identity', () => {
    const blockers = registryBlockers('D-09', seededDefinition('D-09'));
    const input = blockers.find((blocker) => blocker.parameter === 'input');
    expect(input).toBeDefined();
    expect(input?.why).toContain('DEP-M7-04');
    expect(input?.why).toContain('payoutRequests');
    expect(DETECTOR_BLOCKERS['D-09']).toContain('DEP-M7-04');
  });

  it('it declines through the runner even with its threshold and severity both stated', async () => {
    // The threshold IS stated (more than one) and the severity IS stated (5).
    // What is missing is the identity, and no seeded value can supply it.
    const run = harness({
      definitions: [definitionRow('D-09', { sla_hours: 24, flag_type: 'inverse_pair' })],
      rows: { payoutTransfers: [], identityLinks: [] },
    });
    const report = await runDetectors(
      [D09_DESTINATION_CONCENTRATION],
      { tradingDay: '2026-01-09' },
      run.io,
    );
    expect(report.outcomes[0]?.status).toBe('failed');
    expect(report.outcomes[0]?.error).toContain('DEP-M7-04');
    expect(run.writes.filter((write) => write.table === 'riskFlags')).toEqual([]);
    // The run is still RECORDED, which is INV-M7-07.
    expect(run.writes.filter((write) => write.table === 'detectorRuns')).toHaveLength(1);
  });

  it('its window is the transfers and the graph, and its canary is canary.ts own shape', () => {
    const streams = streamsOf(D09_DESTINATION_CONCENTRATION, seededDefinition('D-09'));
    expect(streams.map((stream) => stream.table)).toEqual(['payoutTransfers', 'identityLinks']);
    const [subject] = D09_DESTINATION_CONCENTRATION.canaries(mintFor());
    expect(subject?.shape).toBe('shared-destination');
    // AND THE FINDING SECTION 5 REPORTS: the battery already mints `identityId`
    // onto a `payoutTransfers` row and that column does not exist on that table.
    expect(subject?.rows['transfers']?.[0]?.['identityId']).toBeDefined();
    const schema = read('packages/db/src/schema.ts');
    const table = schema.slice(
      schema.indexOf("export const payoutTransfers = pgTable('payout_transfers'"),
      schema.indexOf(
        '});',
        schema.indexOf("export const payoutTransfers = pgTable('payout_transfers'"),
      ),
    );
    expect(table).not.toContain("identityId: uuid('identity_id')");
    expect(table).toContain("payoutRequestId: uuid('payout_request_id')");
    // So the predicate is proven against the shape the join WOULD produce.
    expect(sharedDestinations(subject?.rows['transfers'] ?? [], liveEdges([]), 1)).toHaveLength(1);
  });

  it('payoutRequests really is absent from DETECTOR_READ_TABLES, measured at source', () => {
    const ports = read('apps/worker/src/detectors/ports.ts');
    const union = ports.slice(
      ports.indexOf('export const DETECTOR_READ_TABLES'),
      ports.indexOf('] as const;', ports.indexOf('export const DETECTOR_READ_TABLES')),
    );
    expect(union).toContain("'payoutTransfers'");
    expect(union).not.toContain("'payoutRequests'");
    // And the reason the join is needed at all, from the accessor's own words.
    const scope = read('packages/db/src/scope.ts');
    expect(scope).toContain('THE TABLE CARRIES NO IDENTITY COLUMN AT ALL');
  });
});

// =============================================================================
// 6. D-10  AFFILIATE SELF-DEAL
// =============================================================================

describe('D-10 affiliate self-deal', () => {
  const attribution = (
    id: string,
    buyerIdentityId: string,
    affiliateIdentityId: string,
    voided = false,
  ): DetectorRow => ({ id, buyerIdentityId, affiliateIdentityId, voided });

  const link = (a: string, b: string, suppressed = false): DetectorRow => ({
    id: `${a}-${b}`,
    identityA: a,
    identityB: b,
    suppressed,
  });

  it('POSITIVE: a purchase attributed to an affiliate linked to the buyer', () => {
    const edges = liveEdges([link('identity-a', 'identity-b')]);
    const hits = selfDealAttributions([attribution('att-1', 'identity-a', 'identity-b')], edges);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.relation).toBe('linked');
  });

  it('POSITIVE: the affiliate IS the buyer, which needs no edge at all', () => {
    const hits = selfDealAttributions(
      [attribution('att-1', 'identity-a', 'identity-a')],
      liveEdges([]),
    );
    expect(hits[0]?.relation).toBe('same_identity');
  });

  it('NEAR-MISS: an affiliate with no edge to the buyer is an ordinary referral', () => {
    expect(
      selfDealAttributions([attribution('att-1', 'identity-a', 'identity-b')], liveEdges([])),
    ).toEqual([]);
  });

  it('NEAR-MISS: a SUPPRESSED edge does not void a commission', () => {
    // INV-M7-09 and SD-M7-04. Voiding a commission on an edge the trader
    // successfully disputed is enforcement on a withdrawn accusation.
    const edges = liveEdges([link('identity-a', 'identity-b', true)]);
    expect(selfDealAttributions([attribution('att-1', 'identity-a', 'identity-b')], edges)).toEqual(
      [],
    );
  });

  it('NEAR-MISS: an already-voided attribution is not re-found every night', () => {
    const edges = liveEdges([link('identity-a', 'identity-b')]);
    expect(
      selfDealAttributions([attribution('att-1', 'identity-a', 'identity-b', true)], edges),
    ).toEqual([]);
  });

  it('the edge is unordered, so identity_links_canonical_order is not relied on', () => {
    const edges = liveEdges([link('identity-b', 'identity-a')]);
    expect(
      selfDealAttributions([attribution('att-1', 'identity-a', 'identity-b')], edges),
    ).toHaveLength(1);
  });

  it('the window is unvoided attributions and live links', () => {
    const streams = streamsOf(D10_AFFILIATE_SELF_DEAL, seededDefinition('D-10'));
    expect(streams.map((stream) => stream.table)).toEqual(['attributions', 'identityLinks']);
    expect(streams[0]?.where).toEqual({ voided: false });
  });

  it('its canary carries both the attribution and the edge that makes it self-dealt', () => {
    const [subject] = D10_AFFILIATE_SELF_DEAL.canaries(mintFor());
    const edges = liveEdges(subject?.rows['links'] ?? []);
    const hits = selfDealAttributions(subject?.rows['attributions'] ?? [], edges);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.relation).toBe('linked');
  });
});

// =============================================================================
// 7. D-11  DILUTION TIMING
// =============================================================================

describe('D-11 dilution timing', () => {
  const DAYS = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09'];
  const gates = (failing: readonly string[]): Record<string, unknown> =>
    Object.fromEntries(
      ['tradedDays', 'winDays', 'buffer', 'consistency', 'cadenceGap', 'minimumAmount'].map(
        (name) => [name, { pass: !failing.includes(name) }],
      ),
    );

  const marksFor = (accountId: string, series: readonly number[]): DetectorRow[] =>
    series.map((pnl, index) => ({
      id: `${accountId}-${String(index)}`,
      accountId,
      tradingDay: DAYS[index],
      realizedPnlCents: BigInt(pnl),
    }));

  const options = {
    maxDailyProfitCents: 5000,
    siblingCorrelationFloorBp: -8000,
    siblingWindowDays: 5,
  };

  const diluter = [40000, -25000, 90000, -60000, 1];
  const sibling = diluter.map((pnl) => -pnl);

  it('POSITIVE: a small positive day, consistency the only failing gate, an inverse sibling', () => {
    const hits = dilutionCandidates(
      [
        {
          id: 's1',
          accountId: 'account-a',
          tradingDay: '2026-01-09',
          engineGates: gates(['consistency']),
        },
      ],
      [...marksFor('account-a', diluter), ...marksFor('account-b', sibling)],
      options,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.siblingAccountId).toBe('account-b');
    expect(hits[0]?.correlationBp).toBe(-10000);
    expect(hits[0]?.realizedPnlCents).toBe(1);
    expect(hits[0]?.failingGates).toEqual(['consistency']);
  });

  it('NEAR-MISS: consistency is failing but so is another gate, so the timing is not precise', () => {
    // "precisely while consistency is the ONLY failing gate". An account failing
    // two gates is not manufacturing a consistency pass.
    const hits = dilutionCandidates(
      [
        {
          id: 's1',
          accountId: 'account-a',
          tradingDay: '2026-01-09',
          engineGates: gates(['consistency', 'buffer']),
        },
      ],
      [...marksFor('account-a', diluter), ...marksFor('account-b', sibling)],
      options,
    );
    expect(hits).toEqual([]);
  });

  it('NEAR-MISS: a day just above max_daily_profit_cents is not a SMALL positive day', () => {
    const justOver = [40000, -25000, 90000, -60000, options.maxDailyProfitCents + 1];
    const hits = dilutionCandidates(
      [
        {
          id: 's1',
          accountId: 'account-a',
          tradingDay: '2026-01-09',
          engineGates: gates(['consistency']),
        },
      ],
      [
        ...marksFor('account-a', justOver),
        ...marksFor(
          'account-b',
          justOver.map((pnl) => -pnl),
        ),
      ],
      options,
    );
    expect(hits).toEqual([]);
    // Exactly AT the maximum still fires, so the boundary is inclusive and named.
    const atMaximum = [40000, -25000, 90000, -60000, options.maxDailyProfitCents];
    expect(
      dilutionCandidates(
        [
          {
            id: 's1',
            accountId: 'account-a',
            tradingDay: '2026-01-09',
            engineGates: gates(['consistency']),
          },
        ],
        [
          ...marksFor('account-a', atMaximum),
          ...marksFor(
            'account-b',
            atMaximum.map((pnl) => -pnl),
          ),
        ],
        options,
      ),
    ).toHaveLength(1);
  });

  it('NEAR-MISS: no inverse sibling, which is what separates dilution from discipline', () => {
    // M01 AS-02's counter. Without the third condition this detector flags every
    // disciplined trader grinding out a consistency requirement.
    const uncorrelated = [40000, -25000, 90000, -60000, 1];
    const hits = dilutionCandidates(
      [
        {
          id: 's1',
          accountId: 'account-a',
          tradingDay: '2026-01-09',
          engineGates: gates(['consistency']),
        },
      ],
      [...marksFor('account-a', diluter), ...marksFor('account-b', uncorrelated)],
      options,
    );
    expect(hits).toEqual([]);
  });

  it('NEAR-MISS: a NEGATIVE day is not a positive one however inverse the sibling', () => {
    const negative = [40000, -25000, 90000, -60000, -1];
    expect(
      dilutionCandidates(
        [
          {
            id: 's1',
            accountId: 'account-a',
            tradingDay: '2026-01-09',
            engineGates: gates(['consistency']),
          },
        ],
        [
          ...marksFor('account-a', negative),
          ...marksFor(
            'account-b',
            negative.map((pnl) => -pnl),
          ),
        ],
        options,
      ),
    ).toEqual([]);
  });

  it('a SKIPPED gate is not a failing gate', () => {
    expect(failingGates({ consistency: { pass: false, skipped: true } })).toEqual([]);
    expect(failingGates({ consistency: { pass: false } })).toEqual(['consistency']);
    expect(failingGates({ consistency: { pass: true } })).toEqual([]);
    expect(failingGates(null)).toEqual([]);
    expect(failingGates('consistency')).toEqual([]);
  });

  it('fewer than MIN_CORRELATION_DAYS paired days produces no candidate at all', () => {
    // A Pearson correlation over two points is exactly +1 or -1 for any two
    // distinct values, so a two-day window clears any floor and measures nothing.
    expect(MIN_CORRELATION_DAYS).toBe(3);
    const two = [40000, 1];
    const hits = dilutionCandidates(
      [
        {
          id: 's1',
          accountId: 'account-a',
          tradingDay: '2026-01-06',
          engineGates: gates(['consistency']),
        },
      ],
      [
        ...marksFor('account-a', two),
        ...marksFor(
          'account-b',
          two.map((pnl) => -pnl),
        ),
      ],
      { ...options, siblingWindowDays: 2 },
    );
    expect(hits).toEqual([]);
  });

  it('pearsonBp is basis points, and a constant series has NO correlation rather than zero', () => {
    expect(pearsonBp([1, 2, 3], [-1, -2, -3])).toBe(-10000);
    expect(pearsonBp([1, 2, 3], [1, 2, 3])).toBe(10000);
    expect(pearsonBp([1, 1, 1], [1, 2, 3])).toBeUndefined();
    expect(pearsonBp([1, 2], [1])).toBeUndefined();
  });

  it('a cents value too wide for an exact Number is REFUSED rather than rounded', () => {
    // ADR-157 section 5 finding 8. A float in a financial path with every type
    // in the workspace green is the defect that entry declined to take in
    // passing.
    expect(cents(1234n)).toBe(1234);
    expect(cents(null)).toBeUndefined();
    expect(() => cents(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(CentsRangeError);
  });

  it('a flag attaches to a HUMAN, so the owners window is read and an account is never the identity', () => {
    const streams = streamsOf(
      D11_DILUTION_TIMING,
      completedDefinition('D-11', { sibling_window_days: 5 }),
    );
    expect(streams.map((stream) => stream.name)).toEqual(['states', 'owners', 'marks']);
    expect(streams[1]?.table).toBe('accounts');
    expect(accountOwners([{ id: 'account-a', identityId: 'identity-a' }]).get('account-a')).toBe(
      'identity-a',
    );
  });

  it('the marks window is one-sided, which is an accessor limit and not a choice', () => {
    const streams = streamsOf(
      D11_DILUTION_TIMING,
      completedDefinition('D-11', { sibling_window_days: 5 }),
    );
    const marks = streams.find((stream) => stream.name === 'marks');
    expect(marks?.where).toEqual({ tradingDay: { term: 'at-least', value: '2026-01-05' } });
    // ONE key, because a filter is one value per column ANDed and `atLeast` and
    // `atMost` on `trading_day` cannot both appear in one call.
    expect(Object.keys(marks?.where ?? {})).toEqual(['tradingDay']);
  });

  it('the finding names the CANDIDATE and never the pair, so the join cannot straddle', async () => {
    // THE CASE THAT FOUND THIS. `D-11` is the one detector here whose join
    // crosses rows, the runner merges the battery into the same stream, and a
    // real account inverse-correlated with the canary's manufactured series
    // would put a synthetic subject and a real one in one finding.
    // `DetectorCanaryLeak` refuses that and fails the whole run; naming only the
    // candidate makes it unreachable. The fixture below is the canary's own
    // series mirrored onto a real account, which is the collision exactly.
    const canarySeries = [40000, -25000, 90000, -60000, 1];
    const run = harness({
      definitions: [
        definitionRow('D-11', {
          max_daily_profit_cents: 5000,
          sibling_correlation_floor_bp: -8000,
          sibling_window_days: 5,
          severity: 3,
          flag_type: 'velocity',
        }),
      ],
      rows: {
        ruleStates: [],
        accounts: [
          {
            id: 'account-b',
            identityId: 'identity-b',
            createdAt: new Date('2025-01-01T00:00:00.000Z'),
          },
        ],
        dailyMarks: canarySeries.map((pnl, index) => ({
          id: `mark-b-${String(index)}`,
          accountId: 'account-b',
          tradingDay: `2026-01-0${String(5 + index)}`,
          realizedPnlCents: BigInt(-pnl),
        })),
      },
    });
    const report = await runDetectors([D11_DILUTION_TIMING], { tradingDay: '2026-01-09' }, run.io);
    expect(report.outcomes[0]?.status).toBe('ok');
    expect(report.outcomes[0]?.error).toBeUndefined();
    expect(report.outcomes[0]?.syntheticFound).toBe(1);
  });

  it('no evidence object names a registry parameter, so INV-M7-10 is not load bearing twice', () => {
    // The observed numbers and never the value they were compared against.
    // INV-M7-04's chain reconstructs the parameter from data, so a copy inside
    // the flag would be a second source for a fact the registry already holds.
    const source = read('apps/worker/src/detectors/identity.ts');
    const evidenceKeys = [...source.matchAll(/evidence: \{([^}]*)\}/gs)]
      .flatMap((match) => [...(match[1] ?? '').matchAll(/^\s*([a-z_]+):/gm)])
      .map((match) => match[1] ?? '');
    expect(evidenceKeys.length).toBeGreaterThan(10);
    const registryKeys = new Set(
      IDENTITY_DETECTOR_IDS.flatMap((id) =>
        Object.keys(seededDefinition(id).parameters).filter((key) => key !== '_meta'),
      ),
    );
    for (const key of evidenceKeys) {
      expect(registryKeys.has(key)).toBe(false);
    }
  });

  it('its canary is threshold-independent under any plausible registry values', () => {
    const [subject] = D11_DILUTION_TIMING.canaries(mintFor());
    expect(subject).toBeDefined();
    for (const maxDailyProfitCents of [1, 100, 100000]) {
      for (const siblingCorrelationFloorBp of [-9999, -8000, -5000]) {
        for (const siblingWindowDays of [5, 20]) {
          const hits = dilutionCandidates(
            subject?.rows['states'] ?? [],
            subject?.rows['marks'] ?? [],
            {
              maxDailyProfitCents,
              siblingCorrelationFloorBp,
              siblingWindowDays,
            },
          );
          expect(hits).toHaveLength(1);
        }
      }
    }
  });
});

// =============================================================================
// 8. D-16  LINK CONFIDENCE, v1 HALF
// =============================================================================

describe("D-16 link confidence, ADR-022's v1 tier", () => {
  const edge = (confidenceBp: number, suppressed = false): DetectorRow => ({
    id: 'link-1',
    identityA: 'identity-a',
    identityB: 'identity-b',
    linkKind: 'biometric_match',
    confidenceBp,
    suppressed,
  });

  it('POSITIVE: an edge at the ceiling, and a flag opens against BOTH identities', () => {
    const hits = hardLinkEdges([edge(9000)], 9000);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.confidenceBp).toBe(9000);
  });

  it('NEAR-MISS: one basis point below the ceiling is a soft link and does not fire', () => {
    expect(hardLinkEdges([edge(8999)], 9000)).toEqual([]);
  });

  it('NEAR-MISS: a suppressed edge at the ceiling does not fire', () => {
    expect(hardLinkEdges([edge(10000, true)], 9000)).toEqual([]);
  });

  it("the ceiling is the discriminator and link_kind is not, which is INV-M7-01's own wording", () => {
    // An edge of a "hard" kind but a soft confidence does NOT fire, and an edge
    // of an unremarkable kind at the ceiling DOES.
    expect(hardLinkEdges([{ ...edge(4000), linkKind: 'biometric_match' }], 9000)).toEqual([]);
    expect(hardLinkEdges([{ ...edge(9500), linkKind: 'shared_device' }], 9000)).toHaveLength(1);
  });

  it('the finding names both identities and the counterparty is on each side of it', async () => {
    const run = harness({
      definitions: [
        definitionRow('D-16', {
          hard_link_confidence_ceiling_bp: 9000,
          sla_hours: 24,
          flag_type: 'inverse_pair',
        }),
      ],
      rows: { identityLinks: [edge(9500)] },
    });
    await runDetectors([D16_LINK_CONFIDENCE], { tradingDay: '2026-01-09' }, run.io);
    const flags = run.writes.filter((write) => write.table === 'riskFlags');
    expect(flags).toHaveLength(2);
    expect(flags.map((flag) => flag.values['identityId']).sort()).toEqual([
      'identity-a',
      'identity-b',
    ]);
    const evidence = flags.map((flag) => flag.values['evidence'] as Record<string, unknown>);
    expect(evidence.map((each) => each['counterparty_identity_id']).sort()).toEqual([
      'identity-a',
      'identity-b',
    ]);
  });

  it('severity 5 carries the SLA clock the DDL requires, computed from the run instant', async () => {
    const run = harness({
      definitions: [
        definitionRow('D-16', {
          hard_link_confidence_ceiling_bp: 9000,
          sla_hours: 24,
          flag_type: 'inverse_pair',
        }),
      ],
      rows: { identityLinks: [edge(9500)] },
    });
    await runDetectors([D16_LINK_CONFIDENCE], { tradingDay: '2026-01-09' }, run.io);
    const flag = run.writes.find((write) => write.table === 'riskFlags');
    expect(flag?.values['severity']).toBe(5);
    const due = flag?.values['slaDueAt'];
    expect(due).toBeInstanceOf(Date);
    // The run's own clock and never the database's.
    expect((due as Date).getTime() - NOW.getTime()).toBeGreaterThanOrEqual(24 * 3600000);
  });

  it('the window is live edges only', () => {
    const streams = streamsOf(D16_LINK_CONFIDENCE, seededDefinition('D-16'));
    expect(streams).toHaveLength(1);
    expect(streams[0]?.where).toEqual({ suppressed: false });
  });

  it('its canary sits at 10000, which is at or above ANY ceiling the registry can state', () => {
    const [subject] = D16_LINK_CONFIDENCE.canaries(mintFor());
    const row = subject?.rows['links']?.[0];
    expect(row?.['confidenceBp']).toBe(10000);
    for (const ceiling of [1, 5000, 9000, 9999, 10000]) {
      expect(hardLinkEdges(subject?.rows['links'] ?? [], ceiling)).toHaveLength(1);
    }
  });
});

// =============================================================================
// 9. D-18  REGISTRATION PHONE LOOKUP. `IS FALSE` AND NEVER `IS NOT TRUE`
// =============================================================================

describe('D-18 registration phone lookup', () => {
  const phone = (overrides: Record<string, unknown> = {}): DetectorRow => ({
    id: 'phone-1',
    identityId: 'identity-a',
    lineType: 'voip',
    footprintPresent: false,
    releasedAt: null,
    supersededAt: null,
    ...overrides,
  });

  it('POSITIVE on the legs that have input: VoIP and no digital footprint', () => {
    const hits = fleetSignatureRows([phone()]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.legs.voip_line_type).toBe(true);
    expect(hits[0]?.legs.no_digital_footprint).toBe(true);
  });

  it("NEAR-MISS, AND IT IS M07's OWN: a vendor timeout, footprint_present NULL", () => {
    // "line_type = 'unknown', footprint_present IS NULL, everything else
    // identical. It must NOT fire, and a detector written against
    // footprint_present IS NOT TRUE fires on it."
    expect(fleetSignatureRows([phone({ footprintPresent: null, lineType: 'unknown' })])).toEqual(
      [],
    );
    // And the half of that near-miss that isolates the column: a VoIP line
    // whose lookup timed out is still not a fleet member.
    expect(fleetSignatureRows([phone({ footprintPresent: null })])).toEqual([]);
    expect(fleetSignatureRows([phone({ footprintPresent: undefined })])).toEqual([]);
  });

  it('NEAR-MISS: a customer the vendor DID reach and who has a footprint', () => {
    expect(fleetSignatureRows([phone({ footprintPresent: true })])).toEqual([]);
  });

  it('NEAR-MISS: a mobile line with no footprint is a young person, not a fleet', () => {
    expect(fleetSignatureRows([phone({ lineType: 'mobile' })])).toEqual([]);
  });

  it('hasNoFootprint IS the difference between IS FALSE and IS NOT TRUE, spelled once', () => {
    // THE ONE COMPARISON THE WHOLE RELIABILITY OF THIS DETECTOR SITS ON. Every
    // case below is one a `value !== true` implementation gets wrong.
    expect(hasNoFootprint(false)).toBe(true);
    expect(hasNoFootprint(null)).toBe(false);
    expect(hasNoFootprint(undefined)).toBe(false);
    expect(hasNoFootprint(true)).toBe(false);
    expect(hasNoFootprint(0)).toBe(false);
    expect(hasNoFootprint('')).toBe(false);
    expect(isVoipLine('voip')).toBe(true);
    expect(isVoipLine(null)).toBe(false);
    expect(isVoipLine('VOIP')).toBe(false);
  });

  it('the WINDOW narrows on an equality against false, which a null does not match', async () => {
    // The first of the two places the predicate runs. `IS FALSE` is an equality
    // and that is why ADR-157's refused `isNotNull` term costs this detector
    // nothing.
    const run = harness({
      definitions: [definitionRow('D-18')],
      rows: {
        identityPhones: [
          phone({ id: 'fleet' }),
          phone({ id: 'timeout', footprintPresent: null }),
          phone({ id: 'has-footprint', footprintPresent: true }),
          phone({ id: 'released', releasedAt: new Date('2026-01-01T00:00:00.000Z') }),
        ],
      },
    });
    const streams = streamsOf(D18_REGISTRATION_PHONE, seededDefinition('D-18'));
    expect(streams[0]?.where['footprintPresent']).toBe(false);
    expect(streams[0]?.where['lineType']).toBe('voip');
    expect(streams[0]?.where['releasedAt']).toEqual({ term: 'is-null' });
    expect(streams[0]?.where['supersededAt']).toEqual({ term: 'is-null' });

    const returned = await run.io.transact((tx) =>
      tx.rowsWhere('identityPhones', streams[0]?.where ?? {}),
    );
    expect((returned as DetectorRow[]).map((row) => row['id'])).toEqual(['fleet']);
  });

  it('the DETECTOR re-tests the legs, because a canary row never crosses the accessor', () => {
    // The second of the two places, and the one a reader would miss. The runner
    // merges the battery into the stream AFTER the read.
    const [subject] = D18_REGISTRATION_PHONE.canaries(mintFor());
    expect(subject?.rows['phones']?.[0]?.['footprintPresent']).toBe(false);
    const merged = [
      ...(subject?.rows['phones'] ?? []),
      phone({ id: 'timeout', footprintPresent: null }),
    ];
    expect(fleetSignatureRows(merged).map((hit) => hit.phoneId)).toEqual(
      merged.filter((row) => row['footprintPresent'] === false).map((row) => row['id']),
    );
  });

  it('all FOUR legs are required, and the two D-15 owns report as unsatisfied and not absent', () => {
    expect(FLEET_SIGNATURE_LEGS).toHaveLength(4);
    const [hit] = fleetSignatureRows([phone()]);
    expect(hit?.legs.fresh_email).toBe(false);
    expect(hit?.legs.datacenter_ip).toBe(false);
    // So `legsSatisfied` can never reach four, which is why the detector
    // declines rather than scoring two legs out of four.
    expect(hit?.legsSatisfied).toBeLessThan(FLEET_SIGNATURE_LEGS.length);
  });

  it('it declines on the two legs with no input even when every parameter is stated', async () => {
    const run = harness({
      definitions: [definitionRow('D-18', { severity: 3, flag_type: 'entity_cap' })],
      rows: { identityPhones: [phone()] },
    });
    const report = await runDetectors(
      [D18_REGISTRATION_PHONE],
      { tradingDay: '2026-01-09' },
      run.io,
    );
    expect(report.outcomes[0]?.status).toBe('failed');
    expect(report.outcomes[0]?.error).toContain('Four legs, all four required');
    expect(run.writes.filter((write) => write.table === 'riskFlags')).toEqual([]);
    expect(DETECTOR_BLOCKERS['D-18']).toContain('D-15');
  });
});

// =============================================================================
// 10. THE REGISTRY IS THE REGISTRY. WHAT EACH DETECTOR IS WAITING FOR
// =============================================================================

describe('INV-M7-04: every threshold comes from detector_definitions and none from a literal', () => {
  it('the seed carries a current row for all seven of this slice', () => {
    for (const id of IDENTITY_DETECTOR_IDS) {
      expect(() => seededDefinition(id)).not.toThrow();
    }
    expect(IDENTITY_DETECTORS.map((detector) => detector.id)).toEqual([...IDENTITY_DETECTOR_IDS]);
  });

  it('ALL SEVEN decline under the seed as it stands, and each names what it waits for', () => {
    const summary = detectorBlockerSummary(
      Object.fromEntries(IDENTITY_DETECTOR_IDS.map((id) => [id, seededDefinition(id)])),
    );
    expect(summary).toEqual({
      'D-07': ['max_accounts_per_entity', 'severity'],
      'D-08': [
        'max_distinct_cards_or_bins_per_identity',
        'max_identities_per_payment_fingerprint',
        'window_days',
        'severity',
      ],
      // D-09's severity IS stated, at 5, so its blockers are the input it does
      // not have and the clock that band needs.
      'D-09': ['input', 'sla_hours'],
      'D-10': ['severity'],
      'D-11': [
        'max_daily_profit_cents',
        'sibling_correlation_floor_bp',
        'sibling_window_days',
        'severity',
      ],
      'D-16': ['hard_link_confidence_ceiling_bp', 'sla_hours'],
      'D-18': ['input', 'severity'],
    });
  });

  it('severity is a MONEY decision and is the blocker five of the seven share', () => {
    const waiting = IDENTITY_DETECTOR_IDS.filter((id) =>
      registryBlockers(id, seededDefinition(id)).some(
        (blocker) => blocker.parameter === 'severity',
      ),
    );
    expect(waiting).toEqual(['D-07', 'D-08', 'D-10', 'D-11', 'D-18']);
    const why = registryBlockers('D-07', seededDefinition('D-07')).find(
      (blocker) => blocker.parameter === 'severity',
    )?.why;
    expect(why).toContain('never a deploy');
    expect(why).toContain('ADR-040');
  });

  it('OQ-M7-03 is open, so the severity-5 band has no clock and sla_hours is NAMED not defaulted', () => {
    const m07 = read('docs/plans/M07-risk-abuse.md');
    expect(m07).toContain('OQ-M7-03. What is the SLA on severity 5?');
    expect(m07).toContain('Proposed:');
    for (const id of ['D-09', 'D-16'] as const) {
      expect(JSON.stringify(seededDefinition(id).parameters)).not.toContain('sla_hours');
      expect(
        registryBlockers(id, seededDefinition(id)).map((blocker) => blocker.parameter),
      ).toContain('sla_hours');
    }
  });

  it('a declining detector is recorded as failed and raises no flag at all', async () => {
    const run = harness({
      definitions: IDENTITY_DETECTOR_IDS.map((id) => {
        const definition = seededDefinition(id);
        return {
          detector: id,
          version: definition.version,
          parameters: definition.parameters,
          isSensitive: definition.isSensitive,
          effectiveTo: null,
        };
      }),
      rows: {},
      nonce: ['nonce-p7h-seed1'],
    });
    const report = await runDetectors(
      [...IDENTITY_DETECTORS],
      { tradingDay: '2026-01-09' },
      run.io,
    );

    expect(report.failed).toEqual([...IDENTITY_DETECTOR_IDS]);
    expect(report.degraded).toEqual([]);
    expect(run.writes.filter((write) => write.table === 'riskFlags')).toEqual([]);
    // Every run is still RECORDED, which is INV-M7-07: "including runs that
    // raised nothing". A declined detector is visible to the morning read on the
    // day it happens, through detector_runs_unhealthy_idx.
    expect(run.writes.filter((write) => write.table === 'detectorRuns')).toHaveLength(7);
    for (const write of run.writes.filter((each) => each.table === 'detectorRuns')) {
      expect(write.values['status']).toBe('failed');
    }
  });

  it('the decline message names the parameter, so a reader is not sent to the code for it', async () => {
    const run = harness({ definitions: [definitionRow('D-07')], rows: {} });
    const report = await runDetectors([D07_ENTITY_CAP], { tradingDay: '2026-01-09' }, run.io);
    expect(report.outcomes[0]?.error).toContain('max_accounts_per_entity');
    expect(report.outcomes[0]?.error).toContain('OQ-M7-02');
    expect(report.outcomes[0]?.error).toContain('declined to run');
  });

  it('a detector with no registry row at all is refused before it reads a thing', async () => {
    const run = harness({ definitions: [], rows: {} });
    const report = await runDetectors([D07_ENTITY_CAP], { tradingDay: '2026-01-09' }, run.io);
    expect(report.outcomes[0]?.status).toBe('failed');
    expect(report.outcomes[0]?.error).toContain('no current detector_definitions row');
  });
});

// =============================================================================
// 11. THE FIRE PATH. WITH A COMPLETE REGISTRY ROW, EACH ONE RUNS
// =============================================================================

describe('with the registry stating what it owes, each detector fires and finds its canary', () => {
  const cases: {
    readonly detector: Detector;
    readonly id: IdentityDetectorId;
    readonly extra: Record<string, unknown>;
    readonly rows: Record<string, readonly DetectorRow[]>;
    readonly flags: number;
  }[] = [
    {
      detector: D07_ENTITY_CAP,
      id: 'D-07',
      extra: { max_accounts_per_entity: 3, severity: 2 },
      rows: {
        accounts: Array.from({ length: 4 }, (_unused, n) => ({
          id: `account-${String(n)}`,
          identityId: 'identity-a',
          closedOn: null,
        })),
        identities: [{ id: 'identity-a', createdAt: new Date('2025-01-01T00:00:00.000Z') }],
      },
      flags: 1,
    },
    {
      detector: D08_PAYMENT_VELOCITY,
      id: 'D-08',
      extra: {
        max_distinct_cards_or_bins_per_identity: 3,
        max_identities_per_payment_fingerprint: 3,
        window_days: 30,
        severity: 3,
      },
      rows: {
        identitySignals: ['a', 'b', 'c', 'd'].map((card) => ({
          id: `signal-${card}`,
          identityId: 'identity-a',
          kind: 'payment',
          valueHash: card,
          lastSeenAt: new Date('2026-01-08T00:00:00.000Z'),
        })),
      },
      flags: 1,
    },
    {
      detector: D10_AFFILIATE_SELF_DEAL,
      id: 'D-10',
      extra: { severity: 3 },
      rows: {
        attributions: [
          {
            id: 'att-1',
            buyerIdentityId: 'identity-a',
            affiliateIdentityId: 'identity-b',
            voided: false,
          },
        ],
        identityLinks: [
          {
            id: 'link-1',
            identityA: 'identity-a',
            identityB: 'identity-b',
            suppressed: false,
            createdAt: new Date('2025-06-01T00:00:00.000Z'),
          },
        ],
      },
      flags: 1,
    },
    {
      detector: D11_DILUTION_TIMING,
      id: 'D-11',
      extra: {
        max_daily_profit_cents: 5000,
        sibling_correlation_floor_bp: -8000,
        sibling_window_days: 5,
        severity: 3,
        flag_type: 'velocity',
      },
      rows: {
        ruleStates: [
          {
            id: 'state-1',
            accountId: 'account-a',
            tradingDay: '2026-01-09',
            engineGates: {
              tradedDays: { pass: true },
              winDays: { pass: true },
              buffer: { pass: true },
              consistency: { pass: false },
              cadenceGap: { pass: true },
              minimumAmount: { pass: true },
            },
          },
        ],
        accounts: [
          {
            id: 'account-a',
            identityId: 'identity-a',
            createdAt: new Date('2025-01-01T00:00:00.000Z'),
          },
          {
            id: 'account-b',
            identityId: 'identity-b',
            createdAt: new Date('2025-01-01T00:00:00.000Z'),
          },
        ],
        dailyMarks: [
          ...[40000, -25000, 90000, -60000, 1].flatMap((pnl, index) => [
            {
              id: `mark-a-${String(index)}`,
              accountId: 'account-a',
              tradingDay: `2026-01-0${String(5 + index)}`,
              realizedPnlCents: BigInt(pnl),
            },
            {
              id: `mark-b-${String(index)}`,
              accountId: 'account-b',
              tradingDay: `2026-01-0${String(5 + index)}`,
              realizedPnlCents: BigInt(-pnl),
            },
          ]),
        ],
      },
      flags: 1,
    },
    {
      detector: D16_LINK_CONFIDENCE,
      id: 'D-16',
      extra: { hard_link_confidence_ceiling_bp: 9000, sla_hours: 24, flag_type: 'inverse_pair' },
      rows: {
        identityLinks: [
          {
            id: 'link-1',
            identityA: 'identity-a',
            identityB: 'identity-b',
            linkKind: 'biometric_match',
            confidenceBp: 9500,
            suppressed: false,
          },
        ],
      },
      flags: 2,
    },
  ];

  for (const each of cases) {
    it(`${each.id} raises its flag at open, finds its canary and reports ok`, async () => {
      const run = harness({
        definitions: [definitionRow(each.id, each.extra)],
        rows: each.rows,
      });
      const report = await runDetectors([each.detector], { tradingDay: '2026-01-09' }, run.io);
      const outcome = report.outcomes[0];

      expect([outcome?.status, outcome?.error]).toEqual(['ok', undefined]);
      expect(outcome?.syntheticFound).toBe(outcome?.syntheticExpected);
      expect(outcome?.syntheticExpected).toBeGreaterThan(0);
      expect(outcome?.flagsRaised).toBe(each.flags);

      const flags = run.writes.filter((write) => write.table === 'riskFlags');
      expect(flags).toHaveLength(each.flags);
      for (const flag of flags) {
        expect(flag.values['status']).toBe('open');
        expect(flag.values['source']).toBe('internal');
        expect(Object.keys(flag.values['evidence'] as object).length).toBeGreaterThan(0);
      }
    });

    it(`${each.id} writes NO canary identifier into any value or counter`, async () => {
      const run = harness({
        definitions: [definitionRow(each.id, each.extra)],
        rows: each.rows,
      });
      const report = await runDetectors([each.detector], { tradingDay: '2026-01-09' }, run.io);
      // AS-M7-05 note 1, over the run's WRITES, which is what a run's aggregates
      // are. A canary is minted in memory and discarded and never reaches a row.
      for (const value of everyWrittenValue(run.writes)) {
        expect(isCanaryId(value)).toBe(false);
      }
      expect(report.outcomes[0]?.syntheticMissing).toEqual([]);
    });

    it(`${each.id} mints a DIFFERENT battery on a second run`, () => {
      // AS-M7-05 note 2. A detector that memorised its subjects cannot pass.
      const first = each.detector.canaries(mintFor('nonce-first-run'));
      const second = each.detector.canaries(mintFor('nonce-second-run'));
      const ids = (subjects: readonly CanarySubject[]): string[] => subjects.map((one) => one.id);
      expect(ids(first).length).toBeGreaterThan(0);
      expect(ids(first).some((id) => ids(second).includes(id))).toBe(false);
    });
  }

  it('a detector that finds nothing REAL still finds its canary and reports ok at zero rows', async () => {
    // AS-M7-05's opening sentence, still reachable and pinned rather than
    // claimed otherwise: the battery arrives in memory on both sides of a broken
    // read, which is what bounds what it proves (P7-e landmine 1).
    const run = harness({
      definitions: [
        definitionRow('D-16', {
          hard_link_confidence_ceiling_bp: 9000,
          sla_hours: 24,
          flag_type: 'inverse_pair',
        }),
      ],
      rows: { identityLinks: [] },
    });
    const report = await runDetectors([D16_LINK_CONFIDENCE], { tradingDay: '2026-01-09' }, run.io);
    expect(report.outcomes[0]?.status).toBe('ok');
    expect(report.outcomes[0]?.rowsScanned).toBe(0);
    expect(report.outcomes[0]?.flagsRaised).toBe(0);
  });

  it('every detector seeds at least one canary, which the DDL cannot check', async () => {
    // `detector_runs_synthetics_match_status` is satisfied at 0 >= 0, so a
    // detector seeding none reports ok forever.
    for (const detector of IDENTITY_DETECTORS) {
      expect(detector.canaries(mintFor()).length).toBeGreaterThan(0);
    }
  });

  it('every canary identifier and actor carries the run nonce, which the runner enforces', () => {
    const nonce = 'nonce-p7h-check';
    for (const detector of IDENTITY_DETECTORS) {
      for (const subject of detector.canaries(mintFor(nonce))) {
        expect(subject.id.split(':')[2]).toBe(nonce);
        for (const actor of subject.actors) {
          expect(actor.startsWith(`${subject.id}#`)).toBe(true);
        }
      }
    }
  });
});

// =============================================================================
// 12. THE FENCE
// =============================================================================

describe('the fence this slice was given', () => {
  it('the module imports only its two siblings and nothing else', () => {
    const source = read('apps/worker/src/detectors/identity.ts');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    expect([...new Set(imports)].sort()).toEqual(['./canary.ts', './ports.ts']);
  });

  it('ADR-165: this module does not open a second door onto the database', () => {
    // OVER THE CODE AND NOT OVER THE HEADER, which NAMES both vocabularies in
    // order to say it does not touch them.
    const source = read('apps/worker/src/detectors/identity.ts')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/u.test(line))
      .join('\n');
    for (const forbidden of [
      "from '@merit/db'",
      "from 'pg'",
      'SqlExecutorReason',
      'SystemReason',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('it declares every detector P7-h was given and no others', () => {
    expect([...IDENTITY_DETECTOR_IDS]).toEqual([
      'D-07',
      'D-08',
      'D-09',
      'D-10',
      'D-11',
      'D-16',
      'D-18',
    ]);
    const plan = read('docs/plans/P7-risk-and-abuse.md');
    expect(plan).toContain(
      'The identity and payment detectors: `D-07`, `D-08`, `D-09`, `D-10`, `D-11`',
    );
  });
});
