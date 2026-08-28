// =============================================================================
// apps/api/test/events.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF `src/events.ts`.
//
// **THE SENTENCE THIS SUITE EXISTS TO MAKE FALSE IS "A NAME NOBODY RULED ON".**
// ADR-159 clause 1 is the rule -- "a name becomes a row only where every field
// is a column a migration declares or a field of a mirror a plan names" -- and
// F-2 of that same entry is its own finding that NOTHING IN THE TREE CHECKS IT:
// "the disagreement measurement 4 found survived two `approved` documents and
// every gate, and was caught by a plan reading both. This is checkable and
// therefore belongs in a gate rather than in an entry."
//
// This suite is that check one level down. F-2 asks for a runner binding a
// DRAWING to the registry; section 1 below binds a PRODUCER to it, name by name
// and field by field, by reading `docs/architecture/EVENTS.md` as text. A name
// added to `EVENT_CATALOGUE` without its catalogue row turns this red. A field
// the producer reads that the catalogue's payload does not carry turns this red.
// **IT IS NOT THE GATE F-2 ASKS FOR AND IT DOES NOT CLAIM A `CI-06` LETTER**: it
// covers one file's eight rows and not every drawing in the corpus, and the
// entry that claims that letter is somebody else's.
//
// -----------------------------------------------------------------------------
// WHAT THIS SUITE READS RATHER THAN RESTATES
// -----------------------------------------------------------------------------
// Every constant `src/events.ts` declares because it cannot import it is BOUND
// to its source by reading that source as text. A retyped constant that drifts
// is what these binds exist to catch, and the worst of them is `ACTOR_KINDS`: a
// fifth member added here and not in the migration is a `23514` on the
// append-only table the audit is argued from, arriving in production on the
// first event of a kind nobody could write.
//
//   packages/db/migrations/0017_events_and_audit.sql  the columns, and the
//                                                     actor_kind CHECK
//   packages/db/src/schema.ts                         the subject tables exist
//   docs/architecture/EVENTS.md                       the eight rows, their
//                                                     producers and their fields
//   apps/worker/src/sweeps/ports.ts                   the port shape this
//                                                     producer must satisfy
//
// -----------------------------------------------------------------------------
// NOTHING HERE REACHES A DATABASE, AND THAT IS NOT A LIMIT OF THE FIXTURE
// -----------------------------------------------------------------------------
// `src/events.ts` reaches none either. Its writer is a port because no writer is
// COMPOSED and `db.ts` is the one file in this deployable that names `@merit/db`
// (ADR-120). IT READ "precisely because `events` is not a `TableKey`" until
// ADR-191 registered that table, and the correction matters to a reader of this
// file: the registry's refusal is discharged and the port is unchanged, so what
// is asserted below is still the whole of what the producer owns -- which
// envelope one payload becomes, which payloads are refused, and that the sink
// hands the transaction through untouched.
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import {
  ACTOR_KINDS,
  EVENT_CATALOGUE,
  EVENT_NAMES,
  EventError,
  EventSinkUnwired,
  UNWIRED_EVENT_SINK,
  assertPayloadRules,
  buildEvent,
  isUuid,
  makeEventSink,
  type CatalogueRow,
  type EmitSpec,
  type EventEnvelope,
  type EventName,
  type EventSink,
  type EventWriter,
} from '../src/events.ts';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const MIGRATION = read('../../../packages/db/migrations/0017_events_and_audit.sql');
const SCHEMA = read('../../../packages/db/src/schema.ts');
const EVENTS_MD = read('../../../docs/architecture/EVENTS.md');
const SWEEP_PORTS = read('../../../apps/worker/src/sweeps/ports.ts');

// -----------------------------------------------------------------------------
// Fixtures: the catalogue's own payloads, transcribed
// -----------------------------------------------------------------------------
// EVERY ONE IS EVENTS SECTION 6 FIELD FOR FIELD, and section 1 below is what
// keeps that claim true rather than asserted: it reads the same rows out of the
// document. Money is `bigint` because `Cents` is, which is also the rule under
// test.

const ID = {
  payoutRequest: '11111111-1111-4111-8111-111111111111',
  account: '22222222-2222-4222-8222-222222222222',
  identity: '33333333-3333-4333-8333-333333333333',
  holdFlag: '44444444-4444-4444-8444-444444444444',
  planVersion: '55555555-5555-4555-8555-555555555555',
  withdrawal: '66666666-6666-4666-8666-666666666666',
  evidencePack: '77777777-7777-4777-8777-777777777777',
  ledgerTransaction: '88888888-8888-4888-8888-888888888888',
} as const;

const PAYLOADS: Readonly<Record<EventName, Readonly<Record<string, unknown>>>> = {
  'payout.requested': {
    payout_request_id: ID.payoutRequest,
    account_id: ID.account,
    identity_id: ID.identity,
    requested_cents: 200_000n,
    idempotency_key: 'POST /accounts/:accountId/payout:abc',
  },
  'payout.approved': {
    payout_request_id: ID.payoutRequest,
    account_id: ID.account,
    identity_id: ID.identity,
    payout_ordinal: 3,
    requested_cents: 200_000n,
    approved_cents: 150_000n,
    clamp_reason: 'cap',
    trader_cents: 135_000n,
    firm_cents: 15_000n,
    split_bp: 9000,
    cap_cents: 150_000n,
    withdrawable_cents: 214_250n,
    basis_trading_day: '2026-11-27',
    plan_version_id: ID.planVersion,
    gate_results: { kyc: true, recon: true },
    engine_version: '1.0.0',
    ledger_transaction_id: ID.ledgerTransaction,
  },
  'payout.blocked': {
    account_id: ID.account,
    identity_id: ID.identity,
    blocker: 'kyc',
    gate_results: { kyc: false },
  },
  'payout.held': {
    payout_request_id: ID.payoutRequest,
    account_id: ID.account,
    identity_id: ID.identity,
    hold_flag_id: ID.holdFlag,
    tos_clause: 'TOS-7.3',
    hold_expires_at: '2026-08-29T04:00:00.000Z',
    approved_cents: 150_000n,
    payout_ordinal: 3,
    plan_version_id: ID.planVersion,
  },
  'payout.hold_released': {
    payout_request_id: ID.payoutRequest,
    account_id: ID.account,
    identity_id: ID.identity,
    released_by: 'expiry',
    hold_flag_id: ID.holdFlag,
    held_at: '2026-08-27T04:00:00.000Z',
    hold_expires_at: '2026-08-29T04:00:00.000Z',
  },
  'payout.hold_enforced': {
    payout_request_id: ID.payoutRequest,
    account_id: ID.account,
    identity_id: ID.identity,
    hold_flag_id: ID.holdFlag,
    tos_clause: 'TOS-7.3',
    evidence_pack_id: ID.evidencePack,
    reason: 'the position was opened after the freeze',
    freed_ordinal: 3,
  },
  'payout.freeze_expiring': {
    payout_request_id: ID.payoutRequest,
    flag_id: ID.holdFlag,
    expires_at: '2026-08-29T04:00:00.000Z',
    lead_hours: 12,
  },
  'wallet.withdrawal_halt_released': {
    withdrawal_id: ID.withdrawal,
    identity_id: ID.identity,
    released_by: 'actor',
    actor: 'ops@merit',
    rail_status: 'approved',
  },
};

const CLOCK = new Date('2026-08-27T21:00:00.000Z');
const at = (name: EventName): EventEnvelope => buildEvent({ name, payload: PAYLOADS[name] }, CLOCK);

/** The catalogue row for a name, as `src/events.ts` records it. */
const rowOf = (name: EventName): CatalogueRow => EVENT_CATALOGUE[name];

// =============================================================================
// 1. THE PRODUCER IS BOUND TO THE REGISTRY, WHICH IS ADR-159 CLAUSE 1 MADE
//    MECHANICAL
// =============================================================================

/**
 * The `| ... |` row for one event in EVENTS, or nothing.
 *
 * Names appear in prose too, so the match is anchored to a table row opening
 * with the name in backticks. `**NEW**` follows the name on the rows ADR-040 and
 * ADR-159 added and is part of the first cell.
 */
function catalogueRow(name: string): string | undefined {
  return EVENTS_MD.split('\n').find((line) => line.startsWith(`| \`${name}\``));
}

/**
 * Everything EVENTS says about one event, for a field search.
 *
 * `payout.approved`'s payload cell is the word "above", because that row's shape
 * is given as a fenced `jsonc` block instead. THE FENCE IS FOUND BY THE NAME IT
 * DECLARES rather than special-cased by name, so a second row given the same
 * treatment is covered without an edit here.
 */
function catalogueText(name: string): string {
  const row = catalogueRow(name) ?? '';
  const fences = EVENTS_MD.split('```');
  const block = fences.find((fence) => fence.startsWith('jsonc') && fence.includes(`// ${name},`));
  return `${row}\n${block ?? ''}`;
}

describe('every name this producer carries is a row in the catalogue', () => {
  test('the eight names are the keys, and the array agrees with the record', () => {
    expect(EVENT_NAMES).toHaveLength(8);
    expect([...EVENT_NAMES].sort()).toStrictEqual(Object.keys(EVENT_CATALOGUE).sort());
  });

  test.each(EVENT_NAMES)('%s is a table row in EVENTS.md', (name) => {
    expect(catalogueRow(name)).toBeDefined();
  });

  test.each(EVENT_NAMES)('%s records the producer EVENTS names, verbatim', (name) => {
    // Cell 2 of `| event | producer | payload | consumers |`. Splitting on the
    // pipe leaves an empty cell 0.
    const cells = (catalogueRow(name) ?? '').split('|').map((cell) => cell.trim());
    expect(cells[2]).toBe(rowOf(name).producer);
  });

  test.each(EVENT_NAMES)('every payload field %s reads is a field of its catalogue row', (name) => {
    const row = rowOf(name);
    const text = catalogueText(name);
    const fields = [
      row.subjectField,
      row.identityField,
      row.accountField,
      row.actorFrom?.field,
      row.actorFrom?.actorIdField,
    ].filter((field): field is string => field !== undefined);
    for (const field of fields) expect(text, `${name} reads \`${field}\``).toContain(field);
  });

  test.each(EVENT_NAMES)(
    'every actor discriminator value %s maps is one the row closes on',
    (name) => {
      const from = rowOf(name).actorFrom;
      if (from === undefined) return;
      const text = catalogueText(name);
      for (const value of Object.keys(from.map))
        expect(text, `${name}'s \`${from.field}\` admits "${value}"`).toContain(`"${value}"`);
    },
  );

  test('a row fixes an actor kind or names a field to read one from, never both and never neither', () => {
    for (const name of EVENT_NAMES) {
      const row = rowOf(name);
      const fixed = row.actorKind !== undefined;
      const read_ = row.actorFrom !== undefined;
      expect(fixed !== read_, `${name} has exactly one answer for actor_kind`).toBe(true);
    }
  });

  test('every actor kind this producer can write is a member of the CHECK', () => {
    for (const name of EVENT_NAMES) {
      const row = rowOf(name);
      const kinds =
        row.actorKind !== undefined ? [row.actorKind] : Object.values(row.actorFrom!.map);
      for (const kind of kinds) expect(ACTOR_KINDS).toContain(kind);
    }
  });
});

// =============================================================================
// 2. THE COLUMNS, READ OUT OF THE MIGRATION RATHER THAN RETYPED
// =============================================================================

describe('the envelope is `events` as 0017 declares it', () => {
  /** The `CREATE TABLE events ( ... );` body, and no other table in the file. */
  const body = MIGRATION.slice(
    MIGRATION.indexOf('CREATE TABLE events ('),
    MIGRATION.indexOf('CREATE INDEX events_account_time_idx'),
  );

  test('the file really holds that table, so the slice above is not empty', () => {
    expect(body).toContain('CREATE TABLE events (');
    expect(body.length).toBeGreaterThan(500);
  });

  test('ACTOR_KINDS is the CHECK, member for member and in its order', () => {
    const check = /actor_kind IN \(\s*([^)]*)\)/.exec(body);
    expect(check).not.toBeNull();
    const members = (check?.[1] ?? '')
      .split(',')
      .map((member) => member.trim().replace(/'/g, ''))
      .filter((member) => member.length > 0);
    expect(members).toStrictEqual([...ACTOR_KINDS]);
  });

  test.each([
    ['eventName', 'event_name'],
    ['schemaVersion', 'schema_version'],
    ['occurredAt', 'occurred_at'],
    ['identityId', 'identity_id'],
    ['accountId', 'account_id'],
    ['subjectKind', 'subject_kind'],
    ['subjectId', 'subject_id'],
    ['payload', 'payload'],
    ['actorKind', 'actor_kind'],
    ['actorId', 'actor_id'],
    ['correlationId', 'correlation_id'],
  ])('the envelope key %s names the column %s', (key, column) => {
    expect(Object.keys(at('payout.approved'))).toContain(key);
    expect(body).toContain(column);
  });

  test('the envelope writes neither `recorded_at` nor `id`, and both absences are load bearing', () => {
    const keys = Object.keys(at('payout.approved'));
    // `recorded_at` is the DATABASE's clock and the divergence from
    // `occurred_at` is what EVENTS section 1 says analytics lie about. `id` is
    // GENERATED ALWAYS AS IDENTITY and refuses a supplied value.
    expect(keys).not.toContain('recordedAt');
    expect(keys).not.toContain('id');
    expect(body).toContain('recorded_at     timestamptz NOT NULL DEFAULT now()');
    expect(body).toContain('GENERATED ALWAYS AS IDENTITY');
  });

  test('schema_version is the column default and this producer carries no second number', () => {
    expect(body).toContain('DEFAULT 1');
    for (const name of EVENT_NAMES) expect(at(name).schemaVersion).toBe(1);
  });

  test('every subject kind is the singular of a table `schema.ts` registers', () => {
    for (const name of EVENT_NAMES) {
      const kind = rowOf(name).subjectKind;
      expect(SCHEMA, `${kind}s is a table`).toContain(`pgTable('${kind}s'`);
    }
  });
});

// =============================================================================
// 3. THE PORT THIS PRODUCER MUST SATISFY, READ OUT OF THE SLICE THAT DECLARED IT
// =============================================================================
// `apps/api` CANNOT IMPORT `apps/worker`. RI-04 forbids an app depending on an
// app, `.npmrc`'s `node-linker=isolated` makes it unresolvable anyway, and the
// two are separate deployables. So the binding is by reading the source, which
// is the idiom `apps/worker/test/expiry.test.ts` established against this
// package's own route files.

describe('the sink satisfies `ExpiryEventPort` rather than standing beside it', () => {
  test('the sweep still declares the port, so this whole section is about something real', () => {
    expect(SWEEP_PORTS).toContain('export interface ExpiryEventPort {');
    expect(SWEEP_PORTS).toContain('emit(tx: ExpiryTx, event: ExpiryEvent): Promise<void>;');
  });

  test('every name the sweep emits is a name this producer carries', () => {
    const declaration = /export type ExpiryEventName =([^;]*);/.exec(SWEEP_PORTS);
    expect(declaration).not.toBeNull();
    const names = [...(declaration?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(names).toHaveLength(3);
    for (const name of names) expect(EVENT_NAMES).toContain(name);
  });

  test('`ExpiryEvent` carries a name and a payload and nothing else, which is the reported thinness', () => {
    const block = SWEEP_PORTS.slice(
      SWEEP_PORTS.indexOf('export interface ExpiryEvent {'),
      SWEEP_PORTS.indexOf('export interface ExpiryEventPort'),
    );
    expect(block).toContain('readonly name: ExpiryEventName;');
    expect(block).toContain('readonly payload: Readonly<Record<string, unknown>>;');
    // THE TWO FIELDS THE PRODUCER REPORTS AS MISSING. When a session holding
    // that file adds either, this assertion is what tells the next reader here
    // that the report was acted on rather than forgotten.
    expect(block).not.toContain('occurredAt');
    expect(block).not.toContain('correlationId');
  });

  test('an EventSink IS an ExpiryEventPort, structurally, with no adapter between them', () => {
    // The sweep's two shapes, restated at their DECLARED width -- narrower than
    // the producer's on both parameters, which is what assignability needs.
    interface ExpiryTxShape {
      rowsWhere(key: string, where: Readonly<Record<string, unknown>>): Promise<unknown[]>;
    }
    interface ExpiryEventShape {
      readonly name:
        'payout.hold_released' | 'wallet.withdrawal_halt_released' | 'payout.freeze_expiring';
      readonly payload: Readonly<Record<string, unknown>>;
    }
    interface ExpiryEventPortShape {
      emit(tx: ExpiryTxShape, event: ExpiryEventShape): Promise<void>;
    }

    const written: EventEnvelope[] = [];
    const sink = makeEventSink({
      writer: { insert: (_tx, row) => (written.push(row), Promise.resolve()) },
      clock: () => CLOCK,
    });
    // THE ASSIGNMENT IS THE ASSERTION. It does not compile if the producer
    // narrowed either parameter past what the sweep hands it.
    const port: ExpiryEventPortShape = sink;
    expect(port).toBe(sink);
  });
});

// =============================================================================
// 4. ONE PAYLOAD BECOMES ONE ROW
// =============================================================================

describe('the three NOT NULL columns a payload cannot supply', () => {
  test('subject_kind is a constant of the name', () => {
    expect(at('payout.approved').subjectKind).toBe('payout_request');
    expect(at('wallet.withdrawal_halt_released').subjectKind).toBe('wallet_withdrawal');
  });

  test("`payout.blocked`'s subject is the ACCOUNT, because no payout request is outstanding", () => {
    const row = at('payout.blocked');
    expect(row.subjectKind).toBe('account');
    expect(row.subjectId).toBe(ID.account);
    // The proof that this is not a transcription slip: the catalogue's payload
    // for this row genuinely carries no payout request to name.
    expect(catalogueText('payout.blocked')).not.toContain('payout_request_id');
  });

  test('actor_kind separates the trader who asked from the engine that decided', () => {
    expect(at('payout.requested').actorKind).toBe('trader');
    expect(at('payout.approved').actorKind).toBe('system');
    expect(at('payout.held').actorKind).toBe('system');
  });

  test('`released_by` decides the actor, which is the distinction the field exists for', () => {
    expect(at('payout.hold_released').actorKind).toBe('system');
    expect(at('payout.hold_released').actorId).toBeNull();

    const byHand = buildEvent(
      {
        name: 'payout.hold_released',
        payload: { ...PAYLOADS['payout.hold_released'], released_by: 'actor', actor: 'ops@merit' },
      },
      CLOCK,
    );
    expect(byHand.actorKind).toBe('admin');
    expect(byHand.actorId).toBe('ops@merit');
  });

  test('`payout.hold_enforced` takes its actor from the caller, because the payload names none', () => {
    expect(at('payout.hold_enforced').actorId).toBeNull();
    const withActor = buildEvent(
      {
        name: 'payout.hold_enforced',
        payload: PAYLOADS['payout.hold_enforced'],
        actorId: 'ops@merit',
      },
      CLOCK,
    );
    expect(withActor.actorKind).toBe('admin');
    expect(withActor.actorId).toBe('ops@merit');
  });
});

describe('the tenancy columns come from the payload and from nowhere else', () => {
  test('both are lifted where the catalogue row carries them', () => {
    const row = at('payout.held');
    expect(row.identityId).toBe(ID.identity);
    expect(row.accountId).toBe(ID.account);
  });

  test('a wallet withdrawal has an identity and no account, and that is not an omission', () => {
    const row = at('wallet.withdrawal_halt_released');
    expect(row.identityId).toBe(ID.identity);
    expect(row.accountId).toBeNull();
    expect(catalogueText('wallet.withdrawal_halt_released')).not.toContain('account_id');
  });

  test('`payout.freeze_expiring` reaches the table with NEITHER, which is the blocker in one row', () => {
    const row = at('payout.freeze_expiring');
    expect(row.identityId).toBeNull();
    expect(row.accountId).toBeNull();
    expect(rowOf('payout.freeze_expiring').identityField).toBeUndefined();
    expect(rowOf('payout.freeze_expiring').accountField).toBeUndefined();
    // Both columns are nullable, so this row is legal and unreachable by any
    // rule naming either column. It is the counterexample a sixth scope class
    // has to answer, and it is a catalogue row rather than this file's choice.
    expect(catalogueText('payout.freeze_expiring')).not.toContain('identity_id');
  });

  test('there is no way to pass a tenancy id beside a payload that disagrees with it', () => {
    const spec: EmitSpec = { name: 'payout.held', payload: PAYLOADS['payout.held'] };
    expect(Object.keys(spec)).not.toContain('identityId');
    expect(Object.keys(spec)).not.toContain('accountId');
  });
});

describe('the two instants', () => {
  test('the occurrence instant defaults to the injected clock and is never the database', () => {
    expect(at('payout.approved').occurredAt).toStrictEqual(CLOCK);
  });

  test('an emitter whose fact happened earlier says so and wins', () => {
    const earlier = new Date('2026-08-20T00:00:00.000Z');
    const row = buildEvent(
      { name: 'payout.approved', payload: PAYLOADS['payout.approved'], occurredAt: earlier },
      CLOCK,
    );
    expect(row.occurredAt).toStrictEqual(earlier);
  });

  test('the correlation id is carried when given and null when not', () => {
    expect(at('payout.approved').correlationId).toBeNull();
    const threaded = buildEvent(
      { name: 'payout.approved', payload: PAYLOADS['payout.approved'], correlationId: ID.account },
      CLOCK,
    );
    expect(threaded.correlationId).toBe(ID.account);
  });
});

test('the payload reaches the row unchanged, because the row IS the payload plus its addressing', () => {
  expect(at('payout.approved').payload).toBe(PAYLOADS['payout.approved']);
});

// =============================================================================
// 5. THE REFUSALS
// =============================================================================

describe('a name the catalogue does not carry is refused', () => {
  test('an unregistered name throws rather than writing a row nobody ruled on', () => {
    expect(() =>
      buildEvent({ name: 'wallet.withdrawal_cancelled' as EventName, payload: {} }, CLOCK),
    ).toThrow(EventError);
  });

  test('the name it refuses is the one ADR-159 clause 5 reports as having no transition', () => {
    // Not decoration: `wallet.withdrawal_cancelled` is the exact name that entry
    // declined to invent, so this is the producer declining the same invention.
    expect(EVENTS_MD).toContain('wallet_withdrawal_status');
    expect(EVENT_NAMES).not.toContain('wallet.withdrawal_cancelled' as EventName);
  });
});

describe('the subject, which the table declares NOT NULL', () => {
  test('a missing subject field is refused', () => {
    const { payout_request_id: _omitted, ...rest } = PAYLOADS['payout.held'];
    expect(() => buildEvent({ name: 'payout.held', payload: rest }, CLOCK)).toThrow(/subject_id/);
  });

  test('a subject that is not a uuid is refused rather than stored', () => {
    expect(() =>
      buildEvent(
        { name: 'payout.held', payload: { ...PAYLOADS['payout.held'], payout_request_id: 'PR-3' } },
        CLOCK,
      ),
    ).toThrow(EventError);
  });
});

describe('a tenancy column that names no row', () => {
  test('a non-uuid identity is refused', () => {
    expect(() =>
      buildEvent(
        { name: 'payout.held', payload: { ...PAYLOADS['payout.held'], identity_id: 'someone' } },
        CLOCK,
      ),
    ).toThrow(/uuid/);
  });

  test('an absent one is null and not an error, because the column is nullable', () => {
    const { identity_id: _omitted, ...rest } = PAYLOADS['payout.held'];
    expect(buildEvent({ name: 'payout.held', payload: rest }, CLOCK).identityId).toBeNull();
  });
});

describe("EVENTS section 1's money convention, which no constraint reaches inside jsonb to assert", () => {
  test('a `_cents` field holding a number is refused rather than coerced', () => {
    expect(() =>
      buildEvent(
        {
          name: 'payout.approved',
          payload: { ...PAYLOADS['payout.approved'], approved_cents: 150000 },
        },
        CLOCK,
      ),
    ).toThrow(/bigint/);
  });

  test('THE WALK IS RECURSIVE, so a nested money field is caught too', () => {
    // `ledger.transaction_posted` carries `entries: [{ ledger_account_code,
    // amount_cents }]`, which a top-level check would pass straight through.
    expect(() =>
      assertPayloadRules({ entries: [{ ledger_account_code: '2100', amount_cents: 1.5 }] }),
    ).toThrow(/amount_cents/);
  });

  test('a fractional basis-point value is refused', () => {
    expect(() =>
      buildEvent(
        { name: 'payout.approved', payload: { ...PAYLOADS['payout.approved'], split_bp: 90.5 } },
        CLOCK,
      ),
    ).toThrow(/basis-point/);
  });

  test('a null in either kind of field is admitted, because the catalogue has optional fields', () => {
    expect(() => assertPayloadRules({ amount_cents: null, split_bp: null })).not.toThrow();
  });
});

describe('the PII floor', () => {
  test('an email-shaped value anywhere in the payload is refused', () => {
    expect(() =>
      buildEvent(
        { name: 'payout.held', payload: { ...PAYLOADS['payout.held'], tos_clause: 'a@b.co' } },
        CLOCK,
      ),
    ).toThrow(/email/);
  });

  test('it is a check on VALUES, so the catalogue rows that carry `name` in a KEY still build', () => {
    // `destination_name_match`, `name_match_score`, `name_match_method`,
    // `kyc_name_hash` and `rise_name_hash` are all rows in EVENTS. A key check
    // would refuse every one of them.
    expect(() =>
      assertPayloadRules({
        destination_name_match: true,
        name_match_score: 97,
        name_match_method: 'fuzzy',
        kyc_name_hash: 'deadbeef',
      }),
    ).not.toThrow();
    for (const field of ['destination_name_match', 'name_match_score', 'kyc_name_hash'])
      expect(EVENTS_MD).toContain(field);
  });
});

describe('the actor discriminator', () => {
  test('a value outside the closed pair is refused', () => {
    expect(() =>
      buildEvent(
        {
          name: 'payout.hold_released',
          payload: { ...PAYLOADS['payout.hold_released'], released_by: 'somehow' },
        },
        CLOCK,
      ),
    ).toThrow(EventError);
  });

  test('an `actorId` beside a payload that carries one is refused, never merged', () => {
    expect(() =>
      buildEvent(
        { name: 'payout.hold_released', payload: PAYLOADS['payout.hold_released'], actorId: 'ops' },
        CLOCK,
      ),
    ).toThrow(/two answers/);
  });
});

test('isUuid refuses what a predicate would match no row for', () => {
  expect(isUuid(ID.identity)).toBe(true);
  expect(isUuid('nonsense')).toBe(false);
  expect(isUuid(undefined)).toBe(false);
  expect(isUuid(12)).toBe(false);
});

// =============================================================================
// 6. THE SINK, AND THE DOOR THAT IS NOT OPEN
// =============================================================================

describe('the sink takes the transaction, which is ADR-006 and not a convenience', () => {
  test('the writer receives the very handle the caller opened', async () => {
    const seen: object[] = [];
    const written: EventEnvelope[] = [];
    const writer: EventWriter = {
      insert: (tx, row) => (seen.push(tx), written.push(row), Promise.resolve()),
    };
    const tx = { marker: 'the open transaction' };
    const sink: EventSink = makeEventSink({ writer, clock: () => CLOCK });

    await sink.emit(tx, {
      name: 'payout.freeze_expiring',
      payload: PAYLOADS['payout.freeze_expiring'],
    });

    expect(seen).toStrictEqual([tx]);
    expect(written[0]?.eventName).toBe('payout.freeze_expiring');
    expect(written[0]?.occurredAt).toStrictEqual(CLOCK);
  });

  test('there is no buffer, no queue and no flush to forget', () => {
    const sink = makeEventSink({ writer: { insert: () => Promise.resolve() }, clock: () => CLOCK });
    expect(Object.keys(sink)).toStrictEqual(['emit']);
  });

  test('a refused payload never reaches the writer, so an invalid event cannot commit', async () => {
    let calls = 0;
    const sink = makeEventSink({
      writer: { insert: () => ((calls += 1), Promise.resolve()) },
      clock: () => CLOCK,
    });
    await expect(
      sink.emit(
        {},
        { name: 'payout.held', payload: { ...PAYLOADS['payout.held'], identity_id: 'x' } },
      ),
    ).rejects.toThrow(EventError);
    expect(calls).toBe(0);
  });

  test('the unwired default REFUSES, and it names why the door is shut', async () => {
    await expect(
      UNWIRED_EVENT_SINK.emit({}, { name: 'payout.requested', payload: {} }),
    ).rejects.toThrow(EventSinkUnwired);
    // THE REASON MOVED AND THE REFUSAL DID NOT, which is the whole of ADR-191's
    // effect on this file. It read `/SIXTH class/` while the door was shut BY
    // THE REGISTRY; the sixth class exists now, so the message names the writer
    // instead and this assertion follows it rather than being deleted.
    await expect(
      UNWIRED_EVENT_SINK.emit({}, { name: 'payout.requested', payload: {} }),
    ).rejects.toThrow(/composed WRITER/);
  });

  test('`events` really is REGISTERED now, so the refusal above is about the writer and not the registry', () => {
    const SCOPE = read('../../../packages/db/src/scope.ts');
    // THE ASSERTION IS INVERTED RATHER THAN DELETED, and the inversion is the
    // measurement. It read `not.toContain("pgTable('events'")` and
    // `toContain('SIXTH CLASS, and ADR-106 is the precedent')`, both of which
    // were true for sixteen sessions and are false from ADR-191. Deleting it
    // would have left this file with no statement of the fact its own header
    // argues from.
    expect(SCHEMA).toContain("pgTable('events'");
    expect(SCOPE).toContain("class: 'either'");
    expect(SCOPE).toContain('events: {');
  });
});
