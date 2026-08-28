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

// THE ONE IMPORT `src/events.ts` CANNOT HOLD, HELD HERE INSTEAD. That file names
// no package, so "`events` is a real `TableKey`" and "a `SystemTx` satisfies
// `EventInsertTx`" are claims it cannot check about itself. This is
// `admin-source-events.test.ts`'s disposition three files over and its reason:
// the binding lives where `@merit/db` is reachable. It takes no HANDLE, which is
// the property `src/db.ts`'s header is actually about and `db.test.ts` asserts
// over `src/` alone.
import { TABLE_KEYS } from '@merit/db';
import type { SystemTx, TableKey } from '@merit/db';

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
  CENTS_IN_PAYLOAD,
  centsFromPayload,
  centsToPayload,
  encodeCentsForStorage,
  makeEventSink,
  EVENT_WRITE_TABLE,
  TRANSACTION_EVENT_WRITER,
  type CatalogueRow,
  type EmitSpec,
  type EventEnvelope,
  type EventInsertTx,
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
const EVENTS_SRC = read('../src/events.ts');

/**
 * Every catalogue row in EVENTS, as its four cells.
 *
 * DERIVED FROM THE DOCUMENT AT RUN TIME rather than counted into a comment, so
 * that a row added, a payload changed or a consumer moved shows up as a moved
 * number instead of as a sentence that quietly stopped being true. The split
 * respects `\|`, which several payload cells carry inside a union of string
 * literals; splitting on a bare `|` reports those rows as five, six or seven
 * cells and drops them, which is how one derivation of these counts read 92.
 */
const CATALOGUE_ROWS: readonly string[][] = EVENTS_MD.split('\n')
  .filter((line) => /^\| `[a-z0-9_]+\.[a-z0-9_]+`/.test(line))
  .map((line) =>
    line
      .split(/(?<!\\)\|/)
      .slice(1, -1)
      .map((cell) => cell.trim()),
  )
  .filter((cells) => cells.length === 4);

/**
 * The catalogue rows whose payload is a literal.
 *
 * THE THREE EXCLUDED ARE NAMED AND NOT DROPPED: `day.closed`, `breach.detected`
 * and `payout.approved` give their payload by reference, as the word "above" or
 * "below" pointing at a fenced block. A count over the table cells alone would
 * miss `payout.approved`'s SIX `_cents` fields entirely.
 */
const READABLE_ROWS: readonly string[][] = CATALOGUE_ROWS.filter((cells) =>
  cells[2]?.startsWith('`{'),
);

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

/**
 * The names `buildEvent` can build today.
 *
 * DERIVED FROM THE ROW AND NOT NAMED. `assertTenanted` refuses a row reaching
 * neither tenancy column, so the buildable set is a property of the catalogue;
 * a case listing the one name it excludes would go stale in step with the thing
 * it excludes, which is the trap this suite's own binds exist to avoid. A second
 * row acquiring the shape leaves this set by itself, and the case that DERIVES
 * the untenanted set is what makes that visible rather than quiet.
 */
const BUILDABLE = EVENT_NAMES.filter(
  (name) => rowOf(name).identityField !== undefined || rowOf(name).accountField !== undefined,
);

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
    for (const name of BUILDABLE) expect(at(name).schemaVersion).toBe(1);
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

  test('`payout.freeze_expiring` is the ONE catalogue row that reaches neither, derived', () => {
    // DERIVED OVER THE EIGHT RATHER THAN ASSERTED ABOUT ONE, because the property
    // this file's header is about is "how many rows reach neither leg", and a
    // case naming one name cannot see the second one arrive.
    const untenanted = EVENT_NAMES.filter(
      (name) => rowOf(name).identityField === undefined && rowOf(name).accountField === undefined,
    );
    expect(untenanted).toStrictEqual(['payout.freeze_expiring']);
    // And it is a CATALOGUE row rather than this file's choice: the payload
    // EVENTS declares for it names neither column either.
    expect(catalogueText('payout.freeze_expiring')).not.toContain('identity_id');
    expect(catalogueText('payout.freeze_expiring')).not.toContain('account_id');
  });

  test('building it REFUSES, because a producer that writes an untenanted row must not be quiet', () => {
    // THE HALF ADR-191 SECTION 9 LEFT OPEN, AND IT IS THE SILENCE RATHER THAN THE
    // CLASS. That entry ruled the row a PRODUCER defect and ruled the sixth class
    // correct: a row reaching neither leg belongs to no identity and falls out of
    // every scoped read of an append-only table, forever, with nothing raised and
    // the absence indistinguishable from the event never having happened. NO
    // CONSTRAINT ON THIS TABLE CAN CATCH IT -- both columns are nullable and
    // migration `0058` was returned to the pool over exactly that -- so the write
    // path is the only place it can be caught at all, and this is that place.
    expect(() =>
      buildEvent(
        { name: 'payout.freeze_expiring', payload: PAYLOADS['payout.freeze_expiring'] },
        CLOCK,
      ),
    ).toThrow(EventError);
    expect(() =>
      buildEvent(
        { name: 'payout.freeze_expiring', payload: PAYLOADS['payout.freeze_expiring'] },
        CLOCK,
      ),
    ).toThrow(/reaches neither `events.identity_id` nor `events.account_id`/);
  });

  test('the refusal is on the ROW and not on the NAME, so a dropped tenancy field refuses too', () => {
    // THE CATALOGUE DECLARATION AND THE PAYLOAD ARE TWO WAYS TO REACH THE SAME
    // ROW, and a check that read only the declaration would pass the second one.
    // `wallet.withdrawal_halt_released` DECLARES `identity_id` and a payload
    // reaching here without it writes the identical untenanted row.
    const { identity_id: _dropped, ...withoutIdentity } =
      PAYLOADS['wallet.withdrawal_halt_released'];
    expect(() =>
      buildEvent({ name: 'wallet.withdrawal_halt_released', payload: withoutIdentity }, CLOCK),
    ).toThrow(/reaches neither/);
  });

  test('across the CATALOGUE exactly one untenanted row is read by a timeline, and it is not this one', () => {
    // THE HEADER'S CATALOGUE-WIDE CLAIM, DERIVED HERE RATHER THAN TRUSTED,
    // because it is the reason `assertTenanted` refuses TOTALLY rather than only
    // for the names a timeline reads. If most untenanted rows were trader rows
    // the refusal would be the obvious call; they are not, and the argument has
    // to survive that. A row whose payload cell carries a REFERENCE rather than
    // a shape is EXCLUDED rather than assumed, which is the discipline ADR-191's
    // own 29-row count used on the same table.
    //
    // THESE CARDINALS ARE BOUND HERE AND NOT LEFT IN PROSE. A catalogue that
    // gains a row turns this case red on purpose: the distribution is what the
    // refusal's shape rests on, and somebody re-derives it rather than
    // discovering later that it moved.
    const rows = EVENTS_MD.split('\n')
      .filter((line) => /^\| `[a-z_]+\.[a-z_]+`/.test(line))
      .map((line) =>
        line
          .split(/(?<!\\)\|/)
          .slice(1, -1)
          .map((cell) => cell.trim()),
      )
      .filter((cells) => cells.length === 4);
    expect(rows, 'catalogue rows').toHaveLength(105);

    const readable = rows.filter((cells) => cells[2]?.startsWith('`{'));
    expect(rows.length - readable.length, 'payload given by reference, excluded').toBe(3);

    const untenanted = readable.filter(
      (cells) => !cells[2]?.includes('identity_id') && !cells[2]?.includes('account_id'),
    );
    expect(untenanted, 'rows naming neither tenancy column').toHaveLength(34);

    const timeline = untenanted.filter((cells) => /\bTL\b/.test(cells[3] ?? ''));
    expect(timeline.map((cells) => cells[0])).toStrictEqual(['`payout.settled`']);

    // AND THE COUNTEREXAMPLE THIS FILE WAS HANDED IS NOT ONE OF THEM, which is
    // the thing ADR-191 section 9 does not say: its consumers are ALERT and
    // FEED, so the sharpest form of the harm it describes -- the row never
    // appearing in the trader's TIMELINE -- belongs to `payout.settled` and not
    // to this name. What belongs to this name is that no trader-scoped read
    // reaches the row at all.
    expect(catalogueRow('payout.freeze_expiring')).not.toMatch(/\bTL\b/);
    expect(catalogueRow('payout.settled')).toMatch(/\bTL\b/);
  });

  test('the other seven build, which is what keeps the refusal from being a blanket one', () => {
    // A REFUSAL ASSERTED ONLY IN THE REFUSING DIRECTION is indistinguishable from
    // a producer that refuses everything.
    for (const name of BUILDABLE)
      expect(() => buildEvent({ name, payload: PAYLOADS[name] }, CLOCK)).not.toThrow();
    expect(BUILDABLE).toHaveLength(EVENT_NAMES.length - 1);
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
      name: 'payout.hold_enforced',
      payload: PAYLOADS['payout.hold_enforced'],
      actorId: 'operator:ana',
    });

    expect(seen).toStrictEqual([tx]);
    expect(written[0]?.eventName).toBe('payout.hold_enforced');
    expect(written[0]?.occurredAt).toStrictEqual(CLOCK);
  });

  test('an untenanted row never reaches the writer, so it cannot commit', async () => {
    // THE REFUSAL WHERE IT MATTERS. `buildEvent` runs INSIDE `emit`, before the
    // writer is called at all, so the transaction carrying the state change rolls
    // back with the event rather than committing a fact no scoped read can see.
    let calls = 0;
    const sink = makeEventSink({
      writer: { insert: () => ((calls += 1), Promise.resolve()) },
      clock: () => CLOCK,
    });
    await expect(
      sink.emit(
        {},
        { name: 'payout.freeze_expiring', payload: PAYLOADS['payout.freeze_expiring'] },
      ),
    ).rejects.toThrow(/reaches neither/);
    expect(calls).toBe(0);
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
    // THE REASON HAS MOVED TWICE AND THE REFUSAL HAS NOT, which is the whole of
    // what ADR-191 and this slice did to this file. It read `/SIXTH class/`
    // while the door was shut BY THE REGISTRY; it then read `/composed WRITER/`
    // while the door was shut for want of an adapter; the adapter is
    // `TRANSACTION_EVENT_WRITER` now, so the only thing left is the INSTALL and
    // the message says so. The assertion follows the message each time rather
    // than being deleted, because what is under test is that the default names
    // its own reason and never that the reason is a particular one.
    await expect(
      UNWIRED_EVENT_SINK.emit({}, { name: 'payout.requested', payload: {} }),
    ).rejects.toThrow(/What is missing is the INSTALL/);
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

// =============================================================================
// 7. THE WRITER, AND THE DOOR THAT TURNS OUT TO BE NARROWER THAN THE READ
// =============================================================================
// `TRANSACTION_EVENT_WRITER` is the adapter section 6's default refuses for want
// of. Everything here is one of two claims: that the two strings `src/events.ts`
// retypes because it holds no import are the strings `packages/db` actually
// carries, and that the handle the writer demands is the only handle in this
// workspace whose `insert` reaches this table.

const SCOPED_DB = read('../../../packages/db/src/scoped-db.ts');

/**
 * One writable spec, reused so every case below varies the HANDLE and not the event.
 *
 * IT CARRIES NO MONEY AND THE CHOICE IS SECTION 8's. `payout.held` was the first
 * pick and it is one of the three names a `jsonb` column cannot take, so every
 * case here would have been asserting on the wrong refusal. `payout.hold_released`
 * carries both tenancy columns and no `_cents` field, so it reaches the insert.
 */
const SPEC_HELD: EmitSpec = {
  name: 'payout.hold_released',
  payload: PAYLOADS['payout.hold_released'],
};

/** A `SystemTx`-shaped double, recording what it was asked to write. */
function recorder(returning: readonly unknown[] = [{ id: 1n }]): {
  readonly tx: object;
  readonly writes: { key: string; values: Readonly<Record<string, unknown>> }[];
} {
  const writes: { key: string; values: Readonly<Record<string, unknown>> }[] = [];
  return {
    writes,
    tx: {
      __brand: 'SystemTx',
      insert: (key: string, values: Readonly<Record<string, unknown>>) => (
        writes.push({ key, values }),
        Promise.resolve([...returning])
      ),
    },
  };
}

describe('the two strings the producer retypes are the strings the accessor carries', () => {
  test('`events` is a real TableKey and the writer names exactly one table', () => {
    // `admin-source/events.ts`'s `EVENT_READ_TABLES` binding, one direction over.
    // A typo here is a `TS2345` at `tx.insert` in a file that has no `TableKey`
    // to check against, so this is the check.
    const keys: readonly string[] = TABLE_KEYS;
    expect(keys).toContain(EVENT_WRITE_TABLE);
    const witness: TableKey = 'events';
    expect(witness).toBe(EVENT_WRITE_TABLE);
  });

  test('the brand the writer demands is the brand `scoped-db.ts` stamps', () => {
    // THE ONLY THING ON THE VALUE THAT TELLS THE THREE HANDLES APART. The writer
    // compares against the literal `'SystemTx'` and cannot import it; if
    // `packages/db` renamed its brands, every handle would be refused at run time
    // and nothing would be red. This is what makes that impossible.
    expect(SCOPED_DB).toContain("__brand: 'SystemTx'");
    expect(SCOPED_DB).toContain("__brand: 'ScopedTx'");
    expect(SCOPED_DB).toContain("__brand: 'FirmTx'");
  });

  test('a SystemTx IS an EventInsertTx, which is the claim the run-time check stands on', () => {
    // ADR-191's OWN DEVICE, one file over: that entry put
    // `const EITHER_KEY_IS_SCOPED: ScopedTableKey = 'events'` in its suite as
    // "the half vitest cannot see at all". This is the same half. If
    // `SystemTx.insert` stopped accepting `'events'`, or stopped returning the
    // rows it wrote, this line stops compiling and `typecheck` reports it where
    // no assertion could.
    const SYSTEM_TX_IS_AN_EVENT_INSERT_TX: (tx: SystemTx) => EventInsertTx = (tx) => tx;
    expect(typeof SYSTEM_TX_IS_AN_EVENT_INSERT_TX).toBe('function');
  });

  test('the three inserts are generic over THREE different key sets, which is why the brand matters', () => {
    // THE LOAD-BEARING FACT OF THIS WHOLE SECTION, READ OUT OF THE SOURCE RATHER
    // THAN ASSERTED. ADR-191 clause 5 made `events` a `ScopedTableKey`, which is
    // what `rows` and `rowsWhere` take; `insert` on that same handle takes
    // `OwnedTableKey` and always did, because a scoped insert STAMPS the tenancy
    // column and an `either` row has two and may carry neither.
    expect(SCOPED_DB).toContain('insert<K extends OwnedTableKey>(key: K, values: WriteValues)');
    expect(SCOPED_DB).toContain('insert<K extends FirmTableKey>(key: K, values: WriteValues)');
    expect(SCOPED_DB).toContain('insert<K extends TableKey>(key: K, values: WriteValues)');
  });

  test('`insertUnder` is not a fourth door, and it is a closed list of one', () => {
    // THE NEAR MISS, CHECKED RATHER THAN WAVED. A reader meeting the refusal
    // above reaches for the scoped handle's other write, and `ParentedTableKey`
    // is written as an `Extract` precisely so the registry polices it.
    expect(SCOPED_DB).toContain(
      "export type ParentedTableKey = Extract<DerivedTableKey, 'sessions'>",
    );
    // And the run-time half names this exact class in its own refusal.
    expect(SCOPED_DB).toContain('an either row has one through a NULLABLE edge');
  });
});

describe('the writer refuses every handle but the one that can carry the write', () => {
  test('a ScopedTx is refused AT THE DOOR, before a statement is built', async () => {
    // WITHOUT THIS IT STILL FAILS, SOMEWHERE USELESS. A `ScopedTx` has an
    // `insert` method at run time, so duck-typing admits it and
    // `refuseTenancyColumn` then throws a sentence about scoped writes at a
    // caller who was never allowed to make one.
    const scoped = { __brand: 'ScopedTx', insert: () => Promise.resolve([{}]) };
    await expect(
      TRANSACTION_EVENT_WRITER.insert(scoped, buildEvent(SPEC_HELD, CLOCK)),
    ).rejects.toThrow(EventError);
    await expect(
      TRANSACTION_EVENT_WRITER.insert(scoped, buildEvent(SPEC_HELD, CLOCK)),
    ).rejects.toThrow(/branded "ScopedTx"/);
  });

  test('the refusal names the DOOR as the repair and never the payload', async () => {
    const scoped = { __brand: 'ScopedTx', insert: () => Promise.resolve([{}]) };
    await expect(
      TRANSACTION_EVENT_WRITER.insert(scoped, buildEvent(SPEC_HELD, CLOCK)),
    ).rejects.toThrow(/THE REPAIR IS THE DOOR AND NOT THIS CHECK/);
  });

  test('a FirmTx is refused too, and this table is not firm', async () => {
    const firm = { __brand: 'FirmTx', insert: () => Promise.resolve([{}]) };
    await expect(
      TRANSACTION_EVENT_WRITER.insert(firm, buildEvent(SPEC_HELD, CLOCK)),
    ).rejects.toThrow(/branded "FirmTx"/);
  });

  test('an UNBRANDED object with an insert method is refused, which keeps a recorder out of production', async () => {
    // THE DIRECTION A PERMISSIVE GUARD FAILS IN. Admitting anything carrying an
    // `insert` would admit the double at the top of this section, and the thing
    // on the other side of this method is an append-only money record.
    const anything = { insert: () => Promise.resolve([{}]) };
    await expect(
      TRANSACTION_EVENT_WRITER.insert(anything, buildEvent(SPEC_HELD, CLOCK)),
    ).rejects.toThrow(/branded undefined/);
  });

  test('a branded handle with no insert method reports a DRIFT rather than a caller error', async () => {
    await expect(
      TRANSACTION_EVENT_WRITER.insert({ __brand: 'SystemTx' }, buildEvent(SPEC_HELD, CLOCK)),
    ).rejects.toThrow(/`packages\/db` and this file have drifted/);
  });
});

describe('the row the writer writes', () => {
  test('it names the one table and hands the envelope through unchanged', async () => {
    const { tx, writes } = recorder();
    const envelope = buildEvent(SPEC_HELD, CLOCK);
    await TRANSACTION_EVENT_WRITER.insert(tx, envelope);

    expect(writes).toHaveLength(1);
    expect(writes[0]?.key).toBe('events');
    expect(writes[0]?.values).toStrictEqual({ ...envelope });
  });

  test('every field of the envelope is a column `schema.ts` declares, and the three it omits are the generated ones', () => {
    // ADR-159 CLAUSE 1's SHAPE ONE LEVEL FURTHER DOWN. `EventEnvelope` is
    // documented "by Drizzle property name" and the values object IS the
    // envelope, so a field here that is not a property is a run-time drizzle
    // error on the first real write, and a column added to the table with no
    // field here is a column this producer silently never writes.
    const block = SCHEMA.slice(SCHEMA.indexOf("export const events = pgTable('events', {"));
    const declared = [...block.slice(0, block.indexOf('\n});')).matchAll(/^ {2}(\w+): /gm)].flatMap(
      (match) => match[1] ?? [],
    );
    expect(declared).toHaveLength(14);

    const written = Object.keys(buildEvent(SPEC_HELD, CLOCK));
    expect(written.filter((field) => !declared.includes(field))).toStrictEqual([]);
    // `id` is `bigint GENERATED ALWAYS AS IDENTITY` and REFUSES a supplied value;
    // `recorded_at` and `created_at` are the DATABASE's clock and `occurredAt` is
    // the application's. All three absences are argued at `EventEnvelope`.
    expect(declared.filter((column) => !written.includes(column))).toStrictEqual([
      'id',
      'recordedAt',
      'createdAt',
    ]);
  });

  test('a write that did not write exactly one row THROWS rather than committing quietly', async () => {
    // THE FAILURE THIS WHOLE FILE EXISTS TO MAKE IMPOSSIBLE, READ OFF THE RETURN
    // VALUE. `unscopedInsertStatement(...).returning()` yields what it wrote, so
    // a count that is not one means the fact is about to commit without its
    // event.
    await expect(
      TRANSACTION_EVENT_WRITER.insert(recorder([]).tx, buildEvent(SPEC_HELD, CLOCK)),
    ).rejects.toThrow(/wrote 0 rows/);
    await expect(
      TRANSACTION_EVENT_WRITER.insert(recorder([{}, {}]).tx, buildEvent(SPEC_HELD, CLOCK)),
    ).rejects.toThrow(/wrote 2 rows/);
  });
});

describe('composed, the sink writes where the unwired default rejects', () => {
  test('one emit becomes one row on the transaction the caller opened', async () => {
    // THE SENTENCE THIS SLICE WAS DISPATCHED FOR, AS A CASE.
    // `UNWIRED_EVENT_SINK` rejects every emit; this composition writes.
    const { tx, writes } = recorder();
    const sink = makeEventSink({ writer: TRANSACTION_EVENT_WRITER, clock: () => CLOCK });

    await sink.emit(tx, SPEC_HELD);

    expect(writes).toHaveLength(1);
    expect(writes[0]?.values['eventName']).toBe('payout.hold_released');
    expect(writes[0]?.values['occurredAt']).toStrictEqual(CLOCK);
    expect(writes[0]?.values['identityId']).toBe(ID.identity);
    expect(writes[0]?.values['accountId']).toBe(ID.account);
  });

  test('the untenanted name still does not reach the writer, which the composition cannot route around', async () => {
    // `assertTenanted` IS NOT BYPASSED BY THE WRITER AND THAT IS THE POINT.
    // Session 358 put it inside `emit`, and `emit` builds before it writes, so
    // composing a writer cannot route around it. Which of the SEVEN buildable
    // names then reach the insert is section 8's question and not this one.
    const sink = makeEventSink({ writer: TRANSACTION_EVENT_WRITER, clock: () => CLOCK });

    const { tx, writes } = recorder();
    await expect(
      sink.emit(tx, {
        name: 'payout.freeze_expiring',
        payload: PAYLOADS['payout.freeze_expiring'],
      }),
    ).rejects.toThrow(/reaches neither/);
    expect(writes).toHaveLength(0);
  });
});

// =============================================================================
// 8. THE MONEY PAYLOAD NO `jsonb` COLUMN CAN TAKE
// =============================================================================
// FOUND BY WRITING A REAL ROW AND NOT BY READING. Against a live PostgreSQL with
// every migration applied, four of the eight names write, `payout.freeze_expiring`
// is refused by `assertTenanted`, and the other three fail at the DRIVER. Nothing
// in any suite could see it, because every writer double records what it is handed
// and none of them serialises. These cases are that gap closed.

describe('the two rules that together made a money payload unwritable, and ADR-198 which resolves them', () => {
  test('`payload` is a `jsonb` column, which is the storage half of the contradiction', () => {
    expect(SCHEMA).toContain("payload: jsonb('payload').notNull()");
  });

  test('`JSON.stringify` refuses a bigint outright, which is the serialiser half', () => {
    // DRIZZLE'S JSONB MAPPING IS `JSON.stringify(value)`, so this language fact IS
    // the driver's behaviour. Asserted here rather than cited, because the tree
    // holds no copy of that file and a version bump would silently change it.
    expect(() => JSON.stringify({ approved_cents: 150_000n })).toThrow(TypeError);
    expect(() => JSON.stringify({ approved_cents: 150_000n })).toThrow(/BigInt/);
  });

  test('`assertPayloadRules` STILL refuses a `_cents` value that is not a bigint', () => {
    // ADR-198 CLAUSE 3: THE DOMAIN RULE IS UNTOUCHED. Teaching this to accept the
    // canonical string would admit at the producer the type the whole ruling
    // exists to keep out, which is weakening a gate to pass it. The string exists
    // only from the moment the payload becomes storage.
    expect(() => assertPayloadRules({ approved_cents: 150_000 })).toThrow(/rather than a bigint/);
    expect(() => assertPayloadRules({ approved_cents: '150000' })).toThrow(/rather than a bigint/);
    expect(() => assertPayloadRules({ approved_cents: 150_000n })).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // ADR-198 clause 1, the format itself
  // ---------------------------------------------------------------------------

  test('the format EVENTS section 13 states is the expression this file carries', () => {
    // BOUND TO THE DOCUMENT AS TEXT rather than retyped, which is this suite's
    // rule everywhere else and is what keeps a format in a forever-retained
    // column from having two spellings.
    expect(EVENTS_MD).toContain('/^(0|-?[1-9][0-9]*)$/');
    expect(EVENTS_MD).toContain('A `_cents` value is a JSON STRING');
    expect(EVENTS_MD).toContain('## 13. Money in a payload: the wire format');
    expect(CENTS_IN_PAYLOAD.source).toBe('^(0|-?[1-9][0-9]*)$');
  });

  test.each([
    ['0', 0n],
    ['1', 1n],
    ['150000', 150_000n],
    ['-1', -1n],
    ['-150000', -150_000n],
    ['9007199254740993', 9_007_199_254_740_993n],
    ['170141183460469231731687303715884105727', 2n ** 127n - 1n],
  ])('%s round-trips exactly', (text, value) => {
    expect(centsToPayload(value)).toBe(text);
    expect(centsFromPayload(text)).toBe(value);
  });

  test('the canonical form refuses every near miss, one at a time', () => {
    for (const bad of ['', '+1', '01', '-0', '1.0', '1e3', '1_000', ' 1', '1 ', '0x10', '-', 'abc'])
      expect(() => centsFromPayload(bad), bad).toThrow(/is not a `_cents` value/);
  });

  test('the parse refuses a JSON `number` BY NAME rather than accepting it', () => {
    // ADR-198 CLAUSE 4. A parse that took a number would give the exact defect the
    // string format exists to prevent a supported path back in.
    expect(() => centsFromPayload(150_000)).toThrow(/is a decimal STRING/);
    expect(() => centsFromPayload(150_000)).toThrow(/IEEE-754 double/);
  });

  test('`-0n` renders `0`, so the format has one spelling for zero', () => {
    expect(centsToPayload(-0n)).toBe('0');
    expect(centsFromPayload(centsToPayload(-0n))).toBe(0n);
  });

  // ---------------------------------------------------------------------------
  // The encoder, which is where the ruling becomes a row
  // ---------------------------------------------------------------------------

  test('the encoder renders a `_cents` bigint and leaves everything else alone', () => {
    const encoded = encodeCentsForStorage({
      approved_cents: 150_000n,
      split_bp: 9000,
      clamp_reason: 'cap',
      plan_version_id: ID.planVersion,
      hold_expires_at: null,
    });
    expect(encoded).toStrictEqual({
      approved_cents: '150000',
      split_bp: 9000,
      clamp_reason: 'cap',
      plan_version_id: ID.planVersion,
      hold_expires_at: null,
    });
  });

  test('a null `_cents` stays null, so "no figure" and "zero cents" stay different rows', () => {
    // ADR-198 CLAUSE 2. `assertPayloadRules` admits a null `_cents` and encoding
    // an absence as `"0"` would collapse the two forever, on an append-only table.
    expect(encodeCentsForStorage({ approved_cents: null })).toStrictEqual({
      approved_cents: null,
    });
  });

  test('the walk is recursive, because the catalogue nests its money', () => {
    // `payout.approved` carries `gate_results` as an OBJECT and
    // `ledger.transaction_posted` carries an `entries` ARRAY of
    // `{ ledger_account_code, amount_cents }`, so an encoder that stopped at the
    // top level would hand the driver the exact payload the format exists for.
    expect(
      encodeCentsForStorage({
        gate_results: { withdrawable_cents: 214_250n },
        entries: [
          { ledger_account_code: 'trader_payable', amount_cents: -135_000n },
          { ledger_account_code: 'cash', amount_cents: 135_000n },
        ],
      }),
    ).toStrictEqual({
      gate_results: { withdrawable_cents: '214250' },
      entries: [
        { ledger_account_code: 'trader_payable', amount_cents: '-135000' },
        { ledger_account_code: 'cash', amount_cents: '135000' },
      ],
    });
  });

  test('the encoder MUTATES NOTHING, because the payload is the producer`s own object', () => {
    // A writer that rewrote the caller's object would change a value under a
    // producer that is still inside the transaction it emitted from.
    const payload = { approved_cents: 150_000n, entries: [{ amount_cents: 1n }] };
    const encoded = encodeCentsForStorage(payload);
    expect(payload.approved_cents).toBe(150_000n);
    expect(payload.entries[0]?.amount_cents).toBe(1n);
    expect(encoded).not.toBe(payload);
  });

  test('a non-plain object is left exactly where it was found', () => {
    // `Object.entries` on a `Date` is `[]`, so a walk that REBUILT one would turn
    // a timestamp into `{}` and store the loss. `JSON.stringify` renders it
    // through `toJSON`, and this walk must not get in the way of that.
    const when = new Date('2026-08-28T00:00:00.000Z');
    const encoded = encodeCentsForStorage({ occurred: when, approved_cents: 1n });
    expect(encoded['occurred']).toBe(when);
    expect(JSON.stringify(encoded)).toBe(
      '{"occurred":"2026-08-28T00:00:00.000Z","approved_cents":"1"}',
    );
  });

  test('a bigint under a key that does NOT end `_cents` is still refused, which is clause 6', async () => {
    // EVENTS DECLARES A FORMAT FOR `_cents` AND FOR NOTHING ELSE, so encoding this
    // one would put a shape no document states into a column retained forever.
    const { tx, writes } = recorder();
    const envelope = buildEvent(
      {
        name: 'payout.blocked',
        payload: { ...PAYLOADS['payout.blocked'], gate_results: { rows_scanned: 12n } },
      },
      CLOCK,
    );
    await expect(TRANSACTION_EVENT_WRITER.insert(tx, envelope)).rejects.toThrow(
      /carries a bigint at `payload\.gate_results\.rows_scanned` under a key that does not end/,
    );
    expect(writes).toHaveLength(0);
  });

  test('the clause-6 refusal names the two repairs and neither is this file inventing one', async () => {
    const { tx } = recorder();
    await expect(
      TRANSACTION_EVENT_WRITER.insert(
        tx,
        buildEvent(
          { name: 'payout.blocked', payload: { ...PAYLOADS['payout.blocked'], seq: 1n } },
          CLOCK,
        ),
      ),
    ).rejects.toThrow(/THE REPAIR IS THE KEY OR THE CATALOGUE/);
  });

  test('a `_cents` key holding an ARRAY is refused rather than given an invented format', async () => {
    // Every `_cents` field in the catalogue is a SCALAR, so the encoder does not
    // carry the key into an array's elements. `assertPayloadRules` refuses this at
    // the producer; the writer refuses it again by path.
    expect(() => assertPayloadRules({ amounts_cents: [1n] })).toThrow(/rather than a bigint/);
    expect(encodeCentsForStorage({ amounts_cents: [1n] })).toStrictEqual({ amounts_cents: [1n] });
  });

  // ---------------------------------------------------------------------------
  // The three names that could not be written, written
  // ---------------------------------------------------------------------------

  test('exactly three of the eight names carry money, and all three now WRITE', async () => {
    // DERIVED OVER THE CATALOGUE THIS FILE CARRIES rather than listed, so a name
    // gaining a `_cents` field moves this count instead of slipping past it.
    const carries = (name: EventName): boolean =>
      Object.keys(PAYLOADS[name]).some((field) => field.endsWith('_cents'));
    const money = EVENT_NAMES.filter(carries);
    expect(money).toStrictEqual(['payout.requested', 'payout.approved', 'payout.held']);

    for (const name of BUILDABLE) {
      const { tx, writes } = recorder();
      await TRANSACTION_EVENT_WRITER.insert(
        tx,
        buildEvent({ name, payload: PAYLOADS[name] }, CLOCK),
      );
      expect(writes, name).toHaveLength(1);
    }
  });

  test('the six `_cents` fields of `payout.approved` reach the row as strings and parse back', async () => {
    // THE ROW EVENTS CALLS "the single most audited event in the system", and the
    // six figures are why this name was the sharpest case.
    const { tx, writes } = recorder();
    await TRANSACTION_EVENT_WRITER.insert(
      tx,
      buildEvent({ name: 'payout.approved', payload: PAYLOADS['payout.approved'] }, CLOCK),
    );
    const stored = writes[0]?.values['payload'] as Record<string, unknown>;
    expect(stored['approved_cents']).toBe('150000');
    expect(stored['trader_cents']).toBe('135000');
    expect(stored['firm_cents']).toBe('15000');
    expect(stored['cap_cents']).toBe('150000');
    expect(stored['requested_cents']).toBe('200000');
    expect(stored['withdrawable_cents']).toBe('214250');
    // `_bp` IS UNCHANGED, which is clause 5.
    expect(stored['split_bp']).toBe(9000);
    for (const [key, value] of Object.entries(stored))
      if (key.endsWith('_cents'))
        expect(centsFromPayload(value)).toBe(PAYLOADS['payout.approved'][key]);
  });

  test('the written payload survives `JSON.stringify`, which is what the driver does to it', async () => {
    // THE DEFECT WAS A DRIVER `TypeError` AND THIS IS THE ASSERTION THAT SEES IT.
    // Every writer double in this repository records what it is handed and none of
    // them serialises, which is exactly why no suite could see the original bug.
    for (const name of BUILDABLE) {
      const { tx, writes } = recorder();
      await TRANSACTION_EVENT_WRITER.insert(
        tx,
        buildEvent({ name, payload: PAYLOADS[name] }, CLOCK),
      );
      expect(() => JSON.stringify(writes[0]?.values['payload']), name).not.toThrow();
    }
  });

  test('a value above 2^53 survives, which a JSON number could not have', async () => {
    // THE MAGNITUDE CEILING IS THEORETICAL FOR THIS SYSTEM AND THE FORMAT IS EXACT
    // ANYWAY. `Number(9007199254740993n)` is 9007199254740992, one cent short, and
    // silently so.
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + 2n;
    expect(Number(huge).toString()).not.toBe(huge.toString());
    const { tx, writes } = recorder();
    await TRANSACTION_EVENT_WRITER.insert(
      tx,
      buildEvent(
        { name: 'payout.held', payload: { ...PAYLOADS['payout.held'], approved_cents: huge } },
        CLOCK,
      ),
    );
    const stored = writes[0]?.values['payload'] as Record<string, unknown>;
    expect(stored['approved_cents']).toBe('9007199254740993');
    expect(centsFromPayload(stored['approved_cents'])).toBe(huge);
  });

  test('the encoding is the WRITER`s, so a sink over a non-serialising writer still sees `bigint`', async () => {
    // ADR-198 CLAUSE 3, AND THIS CASE IS WHY THE ENCODING IS NOT IN `buildEvent`.
    // The limit belongs to the `jsonb` column and not to the event, so the domain
    // type reaches every sink that is not writing to one.
    const written: EventEnvelope[] = [];
    const sink = makeEventSink({
      writer: { insert: (_tx, row) => (written.push(row), Promise.resolve()) },
      clock: () => CLOCK,
    });
    await sink.emit({}, { name: 'payout.approved', payload: PAYLOADS['payout.approved'] });
    expect(written[0]?.payload['approved_cents']).toBe(150_000n);
  });

  test('across the CATALOGUE the same shape is 33 of the 102 readable rows', () => {
    // THE SCALE OF THE FINDING, BOUND HERE RATHER THAN LEFT IN A PULL REQUEST
    // BODY, beside the 35 that name no tenancy column. The two sets are different
    // questions about the same 102 rows.
    expect(CATALOGUE_ROWS).toHaveLength(105);
    expect(READABLE_ROWS).toHaveLength(102);
    expect(READABLE_ROWS.filter((cells) => /_cents\b/.test(cells[2] ?? ''))).toHaveLength(33);
  });

  test('the rows naming NEITHER tenancy column are 35, and exactly one carries TL', () => {
    // THE HEADER OF `src/events.ts` AND `assertTenanted` BOTH READ 34 UNTIL THIS
    // CASE WAS WRITTEN. Derived rather than typed from here on, which is the only
    // thing that keeps a count in a comment honest.
    const neither = READABLE_ROWS.filter(
      (cells) => !/\bidentity_id\b/.test(cells[2] ?? '') && !/\baccount_id\b/.test(cells[2] ?? ''),
    );
    expect(neither).toHaveLength(35);
    const timeline = neither.filter((cells) => /\bTL\b/.test(cells[3] ?? ''));
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.[0]).toContain('payout.settled');
    expect(EVENTS_SRC).toContain('35 of the 102');
    expect(EVENTS_SRC).not.toContain('34 of the 102');
  });
});
