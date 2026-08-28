// =============================================================================
// apps/api/src/events.ts
// =============================================================================
// THE EVENT PRODUCER: THE HALF ABOVE THE SINK. THE SINK IS STILL A PORT AND THE
// REASON IS NO LONGER THE SCOPE REGISTRY.
//
// P5 section 8's `P5-n` row says the producer "is the harder half and it is this
// slice's subject", and it is, but not for the reason the row anticipated. The
// hard half turned out to be that `events` WAS NOT A `TableKey`. `P5-b` (session
// 274) was dispatched to register it, tried all five members of the scope
// vocabulary against it, and stopped:
//
//   `owned` on `identity_id`      compiles and DROPS EVERY ACCOUNT-LEVEL ROW
//   `derived` through `account_id` refused by ADR-101 clauses 1 and 2
//   `pair`                        needs a SECOND IDENTITY column; the second
//                                 column here is an ACCOUNT
//   `firm`                        refused by the suite, because the row declares
//                                 a column against `identities(id)`
//   `root`                        is `identities`' alone
//
// THAT BLOCKER IS DISCHARGED AND THIS FILE IS NOT THE SLICE THAT SPENDS IT.
// ADR-191 adds the sixth class -- `either`, one nullable identity column of its
// own beside one nullable account column, with the predicate their disjunction
// -- and registers `events` under it. So `events` IS a `TableKey` from that
// entry, and every sentence in this header that said otherwise is corrected
// above rather than left standing.
//
// WHAT HAS NOT MOVED IS WHY THE INSERT IS A PORT. `db.ts` is "THE ONE FILE IN
// THIS DEPLOYABLE THAT NAMES `@merit/db`" (ADR-120), no writer is composed, and
// installing one is a slice with its own fence. A registered table removes the
// REGISTRY's refusal and installs nothing; the sink below still refuses, and
// refusing is still the correct outcome for a deployment with no writer.
//
// `payout.freeze_expiring` IS THE COUNTEREXAMPLE ADR-191 HAD TO ANSWER AND IT IS
// ANSWERED RATHER THAN CLOSED. Its catalogue payload is `{ payout_request_id,
// flag_id, expires_at, lead_hours }`: an event about one trader's frozen payout
// whose PAYLOAD names neither tenancy column. ADR-191 section 9's answer is that
// the payload and the ROW's tenancy columns are different things -- EVENTS.md
// says `wallet.credited` carries `account_id` on the row, "resolved through
// `reference_id` at write time", precisely because the trader timeline is a
// per-account view -- so a producer writing neither column on a trader-subject
// event is a PRODUCER defect and not a hole in the class. It is registered as
// that entry's sharpest open item, because the failure is SILENT: the row
// belongs to nobody and simply never appears in the trader's timeline. No
// constraint on this table can catch it, which is why migration `0058` was
// returned to the pool rather than spent on one.
//
// -----------------------------------------------------------------------------
// WHY THIS FILE NAMES NO PACKAGE AND OPENS NO DOOR
// -----------------------------------------------------------------------------
// `db.ts` is "THE ONE FILE IN THIS DEPLOYABLE THAT NAMES `@merit/db`", by
// ADR-120, and a `grep -rln '@merit/db' apps/api/src` that returns one path is
// the whole of that convention. So this file imports NOTHING, declares its
// shapes structurally, and takes the write as a port -- which is
// `apps/worker/src/sweeps/ports.ts`'s disposition one deployable over, arrived
// at from a different direction and for a compatible reason.
//
// NOTHING HERE ADDS A `SqlExecutorReason` MEMBER, ADDS A `SystemReason` MEMBER,
// IMPORTS `pg`, OR CASTS PAST A KEY TYPE (P5 section 11 rule 10).
//
// -----------------------------------------------------------------------------
// ADR-006, RELIED ON RATHER THAN RESTATED: THE SINK TAKES THE TRANSACTION
// -----------------------------------------------------------------------------
// EVENTS section 1: "Events are written in the same transaction as the state
// change that caused them, so an event exists if and only if the fact does."
// `EventSink.emit` therefore takes the open transaction as its first argument
// and has no other way to reach a database. There is no `flush`, no queue and no
// buffer: a producer that could hold an event past the commit is a producer that
// can tell a trader about a release that rolled back.
//
// -----------------------------------------------------------------------------
// ADR-159 CLAUSE 1 IS THIS FILE'S WHOLE AUTHORITY OVER NAMES
// -----------------------------------------------------------------------------
// "A NAME BECOMES A ROW ONLY WHERE EVERY FIELD IS A COLUMN A MIGRATION DECLARES
// OR A FIELD OF A MIRROR A PLAN NAMES." A producer is one step further down: a
// name is emittable here only where the CATALOGUE already carries it as a row.
// So `EVENT_CATALOGUE` below carries no name EVENTS does not, no field an
// EVENTS payload does not, and the suite binds every one of both to
// `docs/architecture/EVENTS.md` by reading that file as text. A name added here
// without its row turns the suite red, which is `ADR-159` F-2's shape one level
// down: F-2 asks for a gate binding a DRAWING to the registry, and this binds a
// PRODUCER to it.
//
// THE SET IS THE NAMES THIS TREE HAS A PRODUCER FOR, AND IT IS EIGHT. The
// catalogue's payout and wallet families are far larger; a producer table
// carrying names no code emits is a table whose rows nothing asserts, and the
// first one that turns out to be wrong will be wrong quietly. The three
// producers are `routes/payouts.ts`, `routes/admin-payouts.ts` and
// `apps/worker/src/sweeps/expiry.ts`, and every row below names which.
//
// -----------------------------------------------------------------------------
// THE THREE COLUMNS A PAYLOAD CANNOT SUPPLY, AND WHERE EACH COMES FROM
// -----------------------------------------------------------------------------
// `events` declares `subject_kind`, `subject_id` and `actor_kind` all NOT NULL,
// and a catalogue payload names none of them. Deriving them is what this file
// IS.
//
//   subject_kind  a CONSTANT of the name. Derived, not invented: this tree
//                 already spells these on `admin_actions` -- `payout_request`
//                 (`admin-payouts.ts`), `account`, `risk_flag`, `plan_version`
//                 (`admin-writes.ts`) -- and every one is the SINGULAR OF THE
//                 TABLE. The suite asserts that rule against `schema.ts`'s SQL
//                 names rather than trusting the four spellings.
//   subject_id    a payload FIELD the name selects. `payout.blocked` is the row
//                 that proves this cannot be one field for the family: it
//                 carries no `payout_request_id` at all, because M05 rules that
//                 a blocked request leaves NO ROW OUTSTANDING, so its subject is
//                 the account.
//   actor_kind    a constant of the name EXCEPT where the catalogue puts a
//                 discriminator in the payload. `payout.hold_released` carries
//                 `released_by: "expiry" | "actor"` precisely so that "the SLA
//                 working" and "a human deciding early" are distinguishable
//                 (EVENTS section 6), and reading `system` for both would
//                 collapse the distinction the field exists to make.
//
// -----------------------------------------------------------------------------
// TWO REFUSALS ON THE PAYLOAD, AND ONE THAT WAS CONSIDERED AND IS NOT TAKEN
// -----------------------------------------------------------------------------
// MONEY. EVENTS section 1: "integer cents in `_cents` fields, basis points in
// `_bp` fields". `Cents` is `bigint` and `BasisPoints` is `number`
// (`packages/rules-engine/src/types.ts`), and the constitution's rule is that no
// float enters a financial path. So a `_cents` value that is not a `bigint` is
// REFUSED rather than coerced -- a `number` that reached here may already have
// lost digits and coercing it would store the loss -- and a `_bp` value that is
// not a safe integer is refused too. `0027`'s NO-FLOATS block asserts the schema
// half; the payload half is `jsonb` and no constraint reaches inside it, so this
// is the only place it can be asserted at all.
//
// PII. Section 1: "No email addresses, no names, no document data, no card
// details, no IP addresses inside a payload." A string value shaped like an
// email address is refused. THE CHECK IS ON VALUES AND DELIBERATELY NOT ON KEY
// NAMES, because the catalogue's own legitimate keys defeat a key check:
// `destination_name_match`, `name_match_score`, `name_match_method`,
// `kyc_name_hash` and `rise_name_hash` are all rows in EVENTS and none of them
// carries a name. IT IS A FLOOR AND NOT THE RULE: it catches the accident, not a
// determined caller, and the rule stays the catalogue's.
//
// NOT TAKEN: a check that the payload's fields MATCH the catalogue row's field
// list exactly. Section 1 permits a payload to "add optional fields at the same
// version", so an exact match would refuse a legal payload, and a subset check
// would refuse nothing a real caller does. What IS asserted is narrower and
// true: every field THIS FILE READS is a field the catalogue's row carries.
// =============================================================================

/** Thrown when an event cannot be built, or when a payload breaks a rule the catalogue states. */
export class EventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventError';
  }
}

// -----------------------------------------------------------------------------
// `events.actor_kind`, read out of the CHECK rather than chosen
// -----------------------------------------------------------------------------

/**
 * `0017_events_and_audit.sql`: `actor_kind text NOT NULL CHECK (actor_kind IN
 * ('system', 'trader', 'admin', 'vendor'))`.
 *
 * TRANSCRIBED FROM THE CONSTRAINT AND BOUND TO IT BY THE SUITE, which reads the
 * CHECK out of the migration. A fifth member added to this list without the
 * migration is a `23514` in production on the append-only table the audit is
 * argued from.
 */
export const ACTOR_KINDS = ['system', 'trader', 'admin', 'vendor'] as const;

/** One of {@link ACTOR_KINDS}. */
export type ActorKind = (typeof ACTOR_KINDS)[number];

// -----------------------------------------------------------------------------
// The catalogue rows this tree has a producer for
// -----------------------------------------------------------------------------

/**
 * How one catalogue row becomes one `events` row.
 *
 * EVERY FIELD NAMED HERE IS A FIELD OF THAT ROW'S PAYLOAD IN
 * `docs/architecture/EVENTS.md`, and the suite asserts exactly that, name by
 * name and field by field. This record is therefore a DERIVATION and not a
 * second copy of the catalogue: it says which of the catalogue's fields fills
 * which of the table's columns, and it may say nothing else.
 */
export interface CatalogueRow {
  /** `events.subject_kind`. The singular of the table the subject lives in. */
  readonly subjectKind: string;
  /** The payload field holding `events.subject_id`. Must be a uuid. */
  readonly subjectField: string;
  /** The payload field holding `events.identity_id`, where the row carries one. */
  readonly identityField?: string;
  /** The payload field holding `events.account_id`, where the row carries one. */
  readonly accountField?: string;
  /** `events.actor_kind`, where the name fixes it. */
  readonly actorKind?: ActorKind;
  /**
   * The payload field that DECIDES `actor_kind`, where the catalogue put the
   * decision in the payload rather than in the name.
   *
   * Exactly one of {@link CatalogueRow.actorKind} and this is present, and the
   * suite asserts the exclusivity: a row carrying both would have two answers to
   * one column and the precedence between them would be this file's invention.
   */
  readonly actorFrom?: {
    readonly field: string;
    readonly map: Readonly<Record<string, ActorKind>>;
    /** The payload field holding `events.actor_id` on the arms that have one. */
    readonly actorIdField: string;
  };
  /** The producer, as EVENTS' own Producer column names it. Prose, for the reader. */
  readonly producer: string;
}

/**
 * The eight names, each a row in EVENTS and each with a producer in this tree.
 *
 * ORDERED AS THE CATALOGUE ORDERS THEM, so a reader comparing the two reads down
 * both at once.
 */
export const EVENT_CATALOGUE = {
  // --- EVENTS section 6, produced by `routes/payouts.ts` ---
  'payout.requested': {
    subjectKind: 'payout_request',
    subjectField: 'payout_request_id',
    identityField: 'identity_id',
    accountField: 'account_id',
    // THE TRADER ASKED. The approval one row down is the engine's and is
    // `system`; conflating the two would make every payout look self-served.
    actorKind: 'trader',
    producer: 'API',
  },
  'payout.approved': {
    subjectKind: 'payout_request',
    subjectField: 'payout_request_id',
    identityField: 'identity_id',
    accountField: 'account_id',
    actorKind: 'system',
    producer: 'API (engine)',
  },
  'payout.blocked': {
    // THE ONE ROW IN THE FAMILY WHOSE SUBJECT IS NOT A PAYOUT REQUEST. EVENTS
    // section 6: `payout.blocked` "says the request was refused and no row is
    // outstanding", and its payload carries no `payout_request_id` to name.
    subjectKind: 'account',
    subjectField: 'account_id',
    identityField: 'identity_id',
    accountField: 'account_id',
    actorKind: 'system',
    producer: 'API',
  },
  'payout.held': {
    subjectKind: 'payout_request',
    subjectField: 'payout_request_id',
    identityField: 'identity_id',
    accountField: 'account_id',
    // INV-M6-03 as amended by ADR-040: the console "cannot open a hold
    // (`G-HOLD-REQUIRED` is evaluated at request time from the flag state, not
    // by a human)". An `admin` actor here would record a judgment nobody made.
    actorKind: 'system',
    producer: 'API (engine)',
  },

  // --- EVENTS section 6, produced by `routes/admin-payouts.ts` and the sweep ---
  'payout.hold_released': {
    subjectKind: 'payout_request',
    subjectField: 'payout_request_id',
    identityField: 'identity_id',
    accountField: 'account_id',
    // TWO PRODUCERS, TWO ACTORS, AND THE CATALOGUE PUT THE DISCRIMINATOR IN THE
    // PAYLOAD FOR EXACTLY THIS REASON: "`expiry` is a first-class value rather
    // than a null actor ... one is the SLA working and the other is a human
    // deciding early" (EVENTS section 6).
    actorFrom: {
      field: 'released_by',
      map: { expiry: 'system', actor: 'admin' },
      actorIdField: 'actor',
    },
    producer: 'Worker (the expiry sweep), Admin',
  },
  'payout.hold_enforced': {
    subjectKind: 'payout_request',
    subjectField: 'payout_request_id',
    identityField: 'identity_id',
    accountField: 'account_id',
    // `actor_id` IS NULL ON THIS ROW AND THE ASYMMETRY IS REPORTED RATHER THAN
    // PAPERED OVER: `payout.hold_released` carries `actor` and this payload
    // carries none, so the most consequential act in the family reaches `events`
    // without naming who took it. The record is intact one table over --
    // `admin_actions.actor` is NOT NULL and `0017` says the duplication is the
    // point -- and an `actor` field invented here would be a field ADR-159
    // clause 1 gives no authority for. See {@link EmitSpec.actorId}.
    actorKind: 'admin',
    producer: 'Admin',
  },
  'payout.freeze_expiring': {
    subjectKind: 'payout_request',
    subjectField: 'payout_request_id',
    // NO TENANCY COLUMN AT ALL, AND THIS FILE'S HEADER IS ABOUT WHY THAT
    // MATTERS. The payload is `{ payout_request_id, flag_id, expires_at,
    // lead_hours }` and neither `identity_id` nor `account_id` is in it.
    actorKind: 'system',
    producer: 'Worker (the hourly sweep)',
  },

  // --- EVENTS section 6, the wallet's halt ---
  'wallet.withdrawal_halt_released': {
    // The singular of `wallet_withdrawals`.
    subjectKind: 'wallet_withdrawal',
    subjectField: 'withdrawal_id',
    identityField: 'identity_id',
    // NO `account_id`, WHICH IS CORRECT AND NOT AN OMISSION: a wallet is
    // identity-level (ADR-019), and `wallet_withdrawals` declares no account
    // column for one to be read from.
    actorFrom: {
      field: 'released_by',
      map: { expiry: 'system', actor: 'admin' },
      actorIdField: 'actor',
    },
    producer: 'Worker (the expiry sweep), Admin',
  },
} as const satisfies Readonly<Record<string, CatalogueRow>>;

/** A name this producer may emit. Every one is a row in EVENTS. */
export type EventName = keyof typeof EVENT_CATALOGUE;

/** The names, as an array, in the catalogue's order. */
export const EVENT_NAMES = Object.keys(EVENT_CATALOGUE) as readonly EventName[];

// -----------------------------------------------------------------------------
// One `events` row, column for column
// -----------------------------------------------------------------------------

/**
 * One row of `events` (`0017_events_and_audit.sql`), by Drizzle property name.
 *
 * `recorded_at` IS ABSENT AND ITS ABSENCE IS THE POINT. The column is
 * `timestamptz NOT NULL DEFAULT now()`, so it is the DATABASE's clock and it
 * records when we learned the fact. `occurredAt` is the APPLICATION's and
 * records when the fact happened. EVENTS section 1: "Corrections make these
 * differ, and analytics that confuse them will silently lie." A producer that
 * wrote both from one instant would make every row's two clocks agree by
 * construction and leave a consumer no way to tell a correction from a live
 * write.
 *
 * `id` IS ABSENT TOO. `bigint GENERATED ALWAYS AS IDENTITY` refuses a supplied
 * value, and it is the only total order this append-only table has.
 */
export interface EventEnvelope {
  readonly eventName: EventName;
  /** `schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version > 0)`. */
  readonly schemaVersion: number;
  readonly occurredAt: Date;
  readonly identityId: string | null;
  readonly accountId: string | null;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly actorKind: ActorKind;
  readonly actorId: string | null;
  readonly correlationId: string | null;
}

// -----------------------------------------------------------------------------
// The shape of a uuid, and the two payload rules
// -----------------------------------------------------------------------------

/**
 * What every id column in this schema is.
 *
 * The same expression `db.ts` uses and for the same reason it gives: version and
 * variant nibbles are NOT pinned, because refusing anything but v4 would be this
 * file inventing a constraint the database does not carry.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A value shaped like an email address.
 *
 * DELIBERATELY LOOSE. The question is not whether a string is deliverable mail,
 * it is whether a payload carries something that reads as a person's address,
 * and a stricter expression refuses fewer of them.
 */
const EMAIL_SHAPED = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** Whether a value can address a row at all. Exported for the suite. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * Refuse a payload that breaks a rule EVENTS section 1 states.
 *
 * WALKED RECURSIVELY, because `payout.approved` carries `gate_results` as a
 * nested object and `ledger.transaction_posted` carries an `entries` array of
 * `{ ledger_account_code, amount_cents }`. A check that stopped at the top level
 * would pass the exact payload the money rule exists for.
 */
export function assertPayloadRules(payload: unknown, path = 'payload'): void {
  if (typeof payload === 'string') {
    if (EMAIL_SHAPED.test(payload))
      throw new EventError(
        `${path} holds a value shaped like an email address. EVENTS section 1: a payload carries ` +
          'ids and numbers and never PII, and this table is retained forever, so the value would ' +
          'outlive every privacy deletion request that could reach it',
      );
    return;
  }
  if (Array.isArray(payload)) {
    payload.forEach((item, index) => assertPayloadRules(item, `${path}[${index}]`));
    return;
  }
  if (payload === null || typeof payload !== 'object') return;

  for (const [key, value] of Object.entries(payload)) {
    const at = `${path}.${key}`;
    if (key.endsWith('_cents') && value !== null && typeof value !== 'bigint')
      throw new EventError(
        `${at} is a money field and holds a ${typeof value} rather than a bigint. Cents are ` +
          '`bigint` everywhere in this tree and a `number` reaching here may already have lost ' +
          'digits, so it is refused rather than coerced: coercing it would store the loss',
      );
    if (
      key.endsWith('_bp') &&
      value !== null &&
      !(typeof value === 'number' && Number.isSafeInteger(value))
    )
      throw new EventError(
        `${at} is a basis-point field and holds ${JSON.stringify(value)}. EVENTS section 1 puts ` +
          'ratios in `_bp` fields and BasisPoints is an integer `number`; a fraction here is a ' +
          'float in a financial path',
      );
    assertPayloadRules(value, at);
  }
}

// -----------------------------------------------------------------------------
// The derivation
// -----------------------------------------------------------------------------

/** What a producer hands the sink. */
export interface EmitSpec {
  readonly name: EventName;
  readonly payload: Readonly<Record<string, unknown>>;
  /**
   * WHEN THE FACT HAPPENED, which is not always when it is written.
   *
   * OPTIONAL ONLY SO THAT `ExpiryEventPort` IS SATISFIABLE, and the default is
   * named rather than silent: {@link makeEventSink} fills it from the clock the
   * WIRING injected, never from the database's. An emitter whose fact happened
   * earlier -- a session close, a vendor correction, a late webhook, anything
   * EVENTS section 1 lists as making the two instants diverge -- MUST pass this,
   * because the default is only defensible where the fact occurs inside the
   * transaction that records it. Every one of the eight rows above is such a
   * fact today, and the day one is not, this field is why it can say so.
   */
  readonly occurredAt?: Date;
  /** EVENTS section 1's saga thread. Nullable in the column and optional here. */
  readonly correlationId?: string;
  /**
   * `events.actor_id`, where the catalogue's payload does not carry it.
   *
   * `payout.hold_enforced` is the row that needs it: an admin acted and the
   * payload names no actor. Supplied by the CALLER, which is the route that
   * already resolved the operator for the `admin_actions` row it writes in the
   * same transaction, so this reads the same value rather than inventing one.
   * Where the catalogue DOES carry the actor, the payload wins and this is
   * refused, so one row can never carry two answers.
   */
  readonly actorId?: string;
}

/**
 * One catalogue row plus one payload becomes one `events` row, or it throws.
 *
 * NOTHING HERE IS OPTIONAL-BY-DEFAULT. Every refusal below is a column this
 * table declares `NOT NULL` reached with nothing to put in it, and returning a
 * plausible envelope instead would write a permanent row asserting something
 * nobody established.
 */
export function buildEvent(spec: EmitSpec, defaultOccurredAt: Date): EventEnvelope {
  const row: CatalogueRow | undefined = EVENT_CATALOGUE[spec.name];
  if (row === undefined)
    throw new EventError(
      `${JSON.stringify(spec.name)} is not a row in this producer's catalogue. ADR-159 clause 1: ` +
        "a name is a row on the registry's authority and no other, so a name this table does " +
        'not carry is a finding for a pull-request body rather than a row to add here',
    );

  assertPayloadRules(spec.payload);

  const subjectId = spec.payload[row.subjectField];
  if (!isUuid(subjectId))
    throw new EventError(
      `${spec.name} takes its subject from the payload's \`${row.subjectField}\`, which holds ` +
        `${JSON.stringify(subjectId)}. \`events.subject_id\` is \`uuid NOT NULL\` and there is ` +
        'nothing else on this row to address the fact by',
    );

  const identityId = tenancy(spec, row.identityField, 'identity_id');
  const accountId = tenancy(spec, row.accountField, 'account_id');
  const { actorKind, actorId } = actor(spec, row);

  return {
    eventName: spec.name,
    // ONE VERSION EXISTS AND IT IS THE COLUMN'S OWN DEFAULT. EVENTS section 1
    // bumps it on "any removal, rename, or semantic change", which is a decision
    // about a catalogue row and never about a producer, so this file has no
    // business carrying a second number.
    schemaVersion: 1,
    occurredAt: spec.occurredAt ?? defaultOccurredAt,
    identityId,
    accountId,
    subjectKind: row.subjectKind,
    subjectId,
    payload: spec.payload,
    actorKind,
    actorId,
    correlationId: spec.correlationId ?? null,
  };
}

/**
 * A tenancy column, read from the payload field the catalogue names, or null.
 *
 * THE VALUE COMES FROM THE PAYLOAD AND FROM NOWHERE ELSE, which is the whole
 * reason this is a function rather than a parameter. A caller that could pass
 * `identityId` beside a payload could write a row whose column says one person
 * and whose `jsonb` says another, and no constraint in this schema would catch
 * it: `identity_id` is nullable, the payload is opaque, and the row is retained
 * forever.
 */
function tenancy(spec: EmitSpec, field: string | undefined, column: string): string | null {
  if (field === undefined) return null;
  const value = spec.payload[field];
  if (value === undefined || value === null) return null;
  if (!isUuid(value))
    throw new EventError(
      `${spec.name} fills \`events.${column}\` from the payload's \`${field}\`, which holds ` +
        `${JSON.stringify(value)} rather than a uuid. The column REFERENCES a row, so a value ` +
        'that names none is a foreign-key failure at write time and a lie in the index until then',
    );
  return value;
}

/** `actor_kind` and `actor_id`, from the name or from the discriminator the catalogue put in the payload. */
function actor(
  spec: EmitSpec,
  row: CatalogueRow,
): { actorKind: ActorKind; actorId: string | null } {
  if (row.actorFrom === undefined) {
    if (row.actorKind === undefined)
      throw new EventError(
        `${spec.name}'s catalogue row fixes neither an actor kind nor a field to read one from. ` +
          '`events.actor_kind` is NOT NULL over a closed CHECK and there is no default that is ' +
          'not a guess about who acted',
      );
    return { actorKind: row.actorKind, actorId: spec.actorId ?? null };
  }

  const { field, map, actorIdField } = row.actorFrom;
  const discriminator = spec.payload[field];
  if (typeof discriminator !== 'string' || !(discriminator in map))
    throw new EventError(
      `${spec.name} reads its actor from the payload's \`${field}\`, which holds ` +
        `${JSON.stringify(discriminator)}. The catalogue closes that field at ` +
        `${Object.keys(map).join(' | ')}, and a value outside it means the two arms this event ` +
        'exists to tell apart cannot be told apart',
    );
  const actorKind = map[discriminator];
  if (actorKind === undefined)
    throw new EventError(`unreachable: ${discriminator} is in the map and did not resolve`);

  if (spec.actorId !== undefined)
    throw new EventError(
      `${spec.name} carries its actor in the payload's \`${actorIdField}\`, so an \`actorId\` on ` +
        'the emit refuses rather than overriding it. One row with two answers about who acted is ' +
        'worse than one row with none',
    );
  const payloadActor = spec.payload[actorIdField];
  if (payloadActor !== undefined && payloadActor !== null && typeof payloadActor !== 'string')
    throw new EventError(
      `${spec.name}'s \`${actorIdField}\` holds a ${typeof payloadActor}. \`events.actor_id\` is ` +
        "`text NULL` and is an actor string rather than a `users` row, on `admin_actions.actor`'s " +
        'precedent',
    );
  return { actorKind, actorId: typeof payloadActor === 'string' ? payloadActor : null };
}

// -----------------------------------------------------------------------------
// The sink, and the one thing under it that this fence cannot build
// -----------------------------------------------------------------------------

/**
 * The insert, on THIS transaction.
 *
 * THE WHOLE OF WHAT IS BLOCKED, AND IT IS ONE METHOD. An adapter for it is
 * `tx.insert('events', envelope)` and nothing more -- except that `'events'` is
 * not a `TableKey`, because `packages/db/src/scope.ts` registers no rule for the
 * table and says at length why it cannot get one from the five classes that
 * exist. So the adapter is not written here, it is not faked here, and the
 * capability is not reached around: this file's fence is `apps/api/src/events.ts`
 * and the repair is an ADR minting a sixth scope class.
 *
 * THE TRANSACTION IS `object` AND THAT IS NOT LAZINESS. This deployable's
 * handles come from `@merit/db`, which this file may not name (ADR-120), and the
 * worker's come from `apps/worker/src/sweeps/ports.ts`, which is a different
 * deployable and unimportable besides. A producer that does not read the handle
 * has no business narrowing it, and the widest supertype is what lets ONE
 * producer serve both without either one casting.
 */
export interface EventWriter {
  insert(tx: object, row: EventEnvelope): Promise<void>;
}

/**
 * The event sink, as every producer in this estate sees it.
 *
 * ITS SHAPE IS `apps/worker/src/sweeps/ports.ts`'s `ExpiryEventPort`, SATISFIED
 * RATHER THAN RESTATED. That file declared `emit(tx: ExpiryTx, event:
 * ExpiryEvent): Promise<void>` and said in terms that "`P5-n` is the slice that
 * builds the producer", so this is that producer and NOT a second port beside
 * it. The parameters are widened exactly as far as assignability needs and no
 * further: `ExpiryTx` is assignable to `object` and `ExpiryEvent` is assignable
 * to {@link EmitSpec}, so an `EventSink` IS an `ExpiryEventPort` with no adapter
 * between them. The suite asserts that by reading that file as text, because
 * `apps/api` cannot import `apps/worker` and `RI-04` is why.
 *
 * THE DECLARED SHAPE WAS FOUND CORRECT AND THIN IN TWO PLACES, AND NEITHER IS A
 * DEFECT. `ExpiryEvent` carries no `occurredAt`, so a sweep's events take the
 * recording instant as their occurrence instant -- admissible because a release
 * occurs inside the transaction that records it, and named at
 * {@link EmitSpec.occurredAt} rather than assumed. It carries no
 * `correlationId`, so a release cannot be threaded to the request that caused it
 * (EVENTS section 1), on a table retained forever. Both are one optional field
 * on a shape this fence does not hold, and both are reported rather than worked
 * around.
 */
export interface EventSink {
  emit(tx: object, event: EmitSpec): Promise<void>;
}

/** Raised by a sink that is not installed. */
export class EventSinkUnwired extends Error {
  constructor() {
    super(
      'no event writer is installed, so this deployment cannot record an event. The reason is no ' +
        'longer the scope registry: `events` IS a TableKey since ADR-191, which added the SIXTH ' +
        'scope class `either` for it after all five earlier members were tried against the shape ' +
        'and each was refused by a mechanical assertion or silently lossy. What is missing is a ' +
        'composed WRITER, and installing one is a slice with its own fence. Refusing is the ' +
        'correct outcome: the state change is inside the same ' +
        'transaction (ADR-006), so a sink that swallowed the event would roll the fact back with ' +
        "it, and a sink that returned quietly would commit a transition EVENTS' universal rule 1 " +
        'does not admit',
    );
    this.name = 'EventSinkUnwired';
  }
}

/**
 * The unwired default, which serves nothing.
 *
 * IT REFUSES RATHER THAN LOGGING AND RETURNING, on `UNWIRED_EXPIRY_SWEEP_IO`'s
 * argument next door: a silent no-op is indistinguishable from a working sink,
 * and here the thing it would be silent about is that the append-only record of
 * a money movement was never written. A route wired to this one fails loudly on
 * its first emit, which is what a deployment missing its event writer should do.
 */
export const UNWIRED_EVENT_SINK: EventSink = {
  emit: () => Promise.reject(new EventSinkUnwired()),
};

/**
 * The producer, over a writer the wiring supplies.
 *
 * `clock` IS INJECTED AND IS NEVER THE DATABASE'S, which is ADR-157's rule about
 * `now()` in a money path arriving one layer up: a producer that rendered the
 * database's clock would put a value no fixture can pin into a forever-retained
 * row, and `recorded_at`'s DEFAULT is where the database's clock belongs.
 *
 * IT VALIDATES BEFORE IT WRITES AND THERE IS NO PATH THAT DOES NOT. `0017`'s own
 * comment on the payload column is "Validated against the event's zod schema AT
 * WRITE TIME", and {@link buildEvent} is that validation for the eight rows this
 * tree produces.
 */
export function makeEventSink(deps: { writer: EventWriter; clock: () => Date }): EventSink {
  return {
    async emit(tx: object, event: EmitSpec): Promise<void> {
      await deps.writer.insert(tx, buildEvent(event, deps.clock()));
    },
  };
}
