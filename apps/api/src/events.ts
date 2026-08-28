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
// THE INSERT IS STILL A PORT AND THE PORT NOW HAS AN ADAPTER, WHICH THIS SESSION
// COMPOSED. That paragraph read "no writer is composed, and installing one is a
// slice with its own fence"; this is that slice, the writer is
// `TRANSACTION_EVENT_WRITER` at the bottom of this file, and
// `makeEventSink({ writer: TRANSACTION_EVENT_WRITER, clock })` writes a row where
// `UNWIRED_EVENT_SINK` rejects. The port survives the adapter rather than being
// replaced by it: `UNWIRED_EVENT_SINK` is still the default, because refusing is
// still the correct outcome for a deployment that installs nothing.
//
// AND THE DOOR IS NARROWER THAN THE READ. ADR-191 clause 5 put `events` in
// `ScopedTableKey`, which is what `rows` and `rowsWhere` are generic over.
// `ScopedTx.insert` is generic over `OwnedTableKey` and always was, because a
// scoped insert STAMPS the tenancy column from the handle and an `either` row has
// two of them and may carry neither; `FirmTx.insert` is generic over
// `FirmTableKey`; so `SystemTx` is the ONE handle in this workspace that can
// write this table, and the writer refuses any other by brand. `apps/api`'s own
// two doors are `scoped` and `firm` and it opens no system door on purpose
// (ADR-165), so THIS DEPLOYABLE HOLDS NO TRANSACTION THAT CAN CARRY AN EVENT.
// That is the finding this slice reports and it is not a reason to widen
// anything: see `EventInsertTx` below, where it is stated where a caller meets
// it.
//
// AND WRITING THE FIRST REAL ROW FOUND A SECOND THING NO SUITE COULD, WHICH
// ADR-198 HAS NOW RULED. Session 366 wrote against a live PostgreSQL with all 58
// migrations applied and found that FOUR of these eight names wrote, ONE was
// `payout.freeze_expiring` refused by `assertTenanted` below, and THREE failed at
// the DRIVER with `TypeError: Do not know how to serialize a BigInt`.
// `events.payload` is `jsonb`, drizzle's jsonb mapping is `JSON.stringify`, and
// `JSON.stringify` refuses a `bigint` outright, while `assertPayloadRules` below
// REFUSES a `_cents` value that is NOT a `bigint`. The two rules together made
// every money payload in the catalogue unwritable, and 33 of the 102 readable
// catalogue rows carry a `_cents` field. NO UNIT TEST COULD SEE IT, because every
// writer double in every suite records what it is handed and none of them
// serialises.
//
// ADR-198 IS THE RULING AND EVENTS SECTION 13 IS THE FORMAT: a `_cents` value
// inside an `events.payload` is a DECIMAL STRING, `/^(0|-?[1-9][0-9]*)$/`. The
// reason is the type a consumer holds rather than the size of the number. The
// 2^53 ceiling is theoretical for every figure this system can produce, but a
// JSON number would hand every JavaScript reader of an append-only, forever
// retained table an IEEE-754 double, which is the one type `assertPayloadRules`
// refuses on the way in, and nothing downstream could then tell an exact value
// from one that lost digits. `encodeCentsForStorage` below applies it AT THE
// WRITER, so the domain form stays `bigint` everywhere above the column and
// `assertPayloadRules` is untouched. `assertSerialisablePayload` survives,
// narrowed to ADR-198 clause 6: a `bigint` under a key that does NOT end
// `_cents` has no declared format and is still refused by name.
//
// `payout.freeze_expiring` IS THE COUNTEREXAMPLE ADR-191 HAD TO ANSWER AND IT IS
// ANSWERED RATHER THAN CLOSED. Its catalogue payload is `{ payout_request_id,
// flag_id, expires_at, lead_hours }`: an event about one trader's frozen payout
// whose PAYLOAD names neither tenancy column. ADR-191 section 9's answer is that
// the payload and the ROW's tenancy columns are different things -- EVENTS.md
// says `wallet.credited` carries `account_id` on the row, "resolved through
// `reference_id` at write time", precisely because the trader timeline is a
// per-account view -- so a producer writing neither column on a trader-subject
// event is a PRODUCER defect and not a hole in the class. THAT ENTRY REGISTERED
// IT AS ITS SHARPEST OPEN ITEM BECAUSE THE FAILURE WAS SILENT, AND THE SILENCE
// IS WHAT IS CLOSED HERE. No constraint on this table can catch it -- both
// columns are nullable and `0058` was returned to the pool over three candidates
// that each failed -- so the write path is the only place it can be caught, and
// `assertTenanted` refuses there. `payout.freeze_expiring` REFUSES rather than
// writing a row nobody can reach, and the refusal names the repair: a field on
// the catalogue row for the producer to resolve its tenancy from, which is
// EVENTS.md's to give and not this file's to invent.
//
// AND ONE THING MEASURED HERE IS NOT IN THAT ENTRY. This name's consumers are
// ALERT and FEED, not TL, so the sharpest form of the harm -- the row never
// appearing in the trader's TIMELINE -- is not this name's; what is this name's
// is that no trader-scoped read of `events` reaches the row at all. Read across
// the whole catalogue rather than this one name: 35 of the 102 rows whose
// payload can be read name neither column, 3 more carry their payload by
// reference and are excluded rather than assumed, and EXACTLY ONE of the 35
// carries the TL consumer. It is `payout.settled`, it has no producer in this
// tree yet, and it is the second instance of this shape waiting for the slice
// that writes it. THE COUNT READ 34 UNTIL SESSION 370 DERIVED IT MECHANICALLY
// AND FOUND 35; the claim resting on it, that exactly one of the set carries
// `TL`, is unmoved. It is a case in the suite now rather than a typed figure.
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
  assertTenanted(spec.name, identityId, accountId);
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
 * Refuse a row that reaches NEITHER tenancy column.
 *
 * THE ONE THING ADR-191 LEFT OPEN, AND IT IS THE SILENCE RATHER THAN THE CLASS.
 * That entry ruled the sixth scope class `either` correct and ruled that a row
 * reaching neither leg BELONGS TO NO IDENTITY AND FALLS OUT, which is the right
 * answer for a predicate. What it named as its sharpest open item is what
 * happens next: the row is written, nothing raises, and its absence from every
 * scoped read is indistinguishable from the event never having happened -- on a
 * table that is APPEND-ONLY and retained forever, so the row cannot later be
 * given the tenancy it was written without.
 *
 * NO CONSTRAINT ON THIS TABLE CAN CATCH IT AND THAT IS SETTLED RATHER THAN
 * ASSUMED. Both columns are nullable by design, and migration `0058` was written
 * out against three candidate constraints and RETURNED TO THE POOL because the
 * disjunction CHECK forbids the firm rows the class admits, an agreement trigger
 * is false on purpose after every hard merge, and `subject_kind` does not
 * discriminate the actual counterexample. So the WRITE PATH is the only place
 * this can be caught at all, and this is that place.
 *
 * IT REFUSES RATHER THAN LOGGING, on `UNWIRED_EVENT_SINK`'s argument in this
 * file and `assertPayloadRules`' next to it. `buildEvent` runs inside `emit` and
 * therefore inside the caller's transaction (ADR-006), so a refusal rolls the
 * state change back WITH the event and a warning would commit the pair. EVENTS
 * section 1's rule is that an event exists if and only if the fact does, and a
 * row nobody can reach is not the honest half of that pair.
 *
 * WHAT THIS IS NOT. It is not a claim that every event belongs to somebody: 35
 * of the 102 catalogue rows whose payload can be read name neither column, and
 * 34 of those are consumed only by firm-level readers, where an untenanted row
 * is exactly right. A producer for one of those would DECLARE the row
 * firm-level and this would read the declaration. NO ROW IN EVENTS DECLARES ONE
 * TODAY, so the field is not invented here, on ADR-159 clause 1's rule that a
 * name is a row on the registry's authority and no other; the message below
 * names that as the second repair rather than leaving the next reader to work
 * out why the refusal is total.
 */
function assertTenanted(
  name: EventName,
  identityId: string | null,
  accountId: string | null,
): void {
  if (identityId !== null || accountId !== null) return;
  throw new EventError(
    `${name} reaches neither \`events.identity_id\` nor \`events.account_id\`, so the row it ` +
      'would write belongs to no identity and to no account. ADR-191 registered `events` under ' +
      'the scope class `either`, whose predicate is the DISJUNCTION of those two columns, so a ' +
      'row reaching neither falls out of every scoped read of a table that is append-only and ' +
      'retained forever, and nothing about the absence distinguishes it from the event never ' +
      "having happened. THE REPAIR IS IN THE PRODUCER AND NOT HERE: a row's tenancy and its " +
      'payload are different things, which is why EVENTS says `wallet.credited` resolves ' +
      '`account_id` through `reference_id` AT WRITE TIME, and a producer holding a ' +
      '`payout_request_id` holds something that names an account. Give the catalogue row a ' +
      'field to read the tenancy from, or, where the event genuinely belongs to the firm rather ' +
      'than to a trader, say so on its row in EVENTS. No row says that today and this file ' +
      'invents no field EVENTS does not carry',
  );
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
 * THE WHOLE OF WHAT WAS BLOCKED, AND IT IS ONE METHOD. The adapter is
 * `tx.insert('events', envelope)` and nothing more, and it is written:
 * {@link TRANSACTION_EVENT_WRITER}, at the bottom of this file. THIS PARAGRAPH
 * READ "except that `'events'` is not a `TableKey`, because
 * `packages/db/src/scope.ts` registers no rule for the table" AND ADR-191 MADE
 * THAT FALSE, then read "what is still missing is a composed WRITER" and this
 * slice made that false too.
 *
 * THE PORT STAYS A PORT. `makeEventSink` takes a writer rather than being one,
 * so a suite substitutes a recorder and a deployment that installs nothing holds
 * {@link UNWIRED_EVENT_SINK} and says so on its first emit.
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
        'and each was refused by a mechanical assertion or silently lossy. A composed WRITER now ' +
        'exists as well: install `makeEventSink({ writer: TRANSACTION_EVENT_WRITER, clock })` and ' +
        'this rejection goes away. What is missing is the INSTALL, which is a decision about a ' +
        'deployment rather than a file on disk. Refusing is the ' +
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

// -----------------------------------------------------------------------------
// The writer, composed. This is the slice that was owed
// -----------------------------------------------------------------------------
// `EventWriter`'s docblock above said "installing a writer is a slice with its
// own [fence]" and this is that slice. What it installs is one method over one
// table, and everything below it is the argument for why the handle it demands
// is the only handle in this workspace that can carry the write.

/**
 * The one table this file writes, spelled as a value so the suite can bind it.
 *
 * `admin-source/events.ts`'s `EVENT_READ_TABLES` idiom, for its reason: this
 * file holds no `@merit/db` import, so the string is a claim it cannot check
 * about itself, and the suite asserts it is a real `TableKey` of that package.
 * The read side names TWO tables because the disjunction has two legs; a write
 * names ONE, because a row is written where it lives and reached from wherever
 * the predicate finds it.
 */
export const EVENT_WRITE_TABLE = 'events';

/**
 * `packages/db`'s brand on the ONE handle whose `insert` reaches this table.
 *
 * READ AS A VALUE RATHER THAN IMPORTED AS A TYPE, and the value is the whole
 * control. `scoped-db.ts` stamps `__brand: 'SystemTx'`, `'ScopedTx'` and
 * `'FirmTx'` on the three transaction handles it mints, and the suite binds this
 * literal by reading that file rather than trusting this line.
 */
const EVENT_INSERT_BRAND = 'SystemTx';

/**
 * A transaction that can insert into `events`, which is NOT every transaction.
 *
 * THE NARROWING IS THE FINDING AND NOT A CONVENIENCE, so it is stated here where
 * a caller meets it. `packages/db` mints three transaction handles and their
 * `insert` methods are generic over three different key sets:
 *
 *   `ScopedTx.insert<K extends OwnedTableKey>`  `events` is registered `either`
 *                                               (ADR-191), not `owned`, so this
 *                                               handle cannot name the table
 *   `FirmTx.insert<K extends FirmTableKey>`     `events` is not `firm` either
 *   `SystemTx.insert<K extends TableKey>`       every registered table, so this
 *                                               one reaches it
 *
 * `insertUnder` IS NOT A FOURTH DOOR AND WAS CHECKED RATHER THAN ASSUMED.
 * `ParentedTableKey` is `Extract<DerivedTableKey, 'sessions'>`, a closed list of
 * one, and `insertUnderStatement` refuses a non-`derived` class in terms that
 * name this one: "an either row has one [parent] through a NULLABLE edge, so
 * proving it establishes tenancy for the rows that have a parent and nothing
 * about the rows that reach an identity the other way".
 *
 * SO THE SCOPE CLASS THAT MADE THE TABLE READABLE IS NOT THE ONE THAT MAKES IT
 * WRITABLE. ADR-191 clause 5 put `events` in `ScopedTableKey`, which is what
 * `rows` and `rowsWhere` are generic over; `insert` on the scoped handle is
 * generic over `OwnedTableKey` and always was, because a scoped insert STAMPS
 * the tenancy column from the handle and an `either` row has two of them and may
 * carry neither. That is not a gap this file may close.
 */
export interface EventInsertTx {
  insert(
    key: typeof EVENT_WRITE_TABLE,
    values: Readonly<Record<string, unknown>>,
  ): Promise<unknown[]>;
}

/**
 * Refuse a handle that cannot carry this write, BEFORE the statement is built.
 *
 * WITHOUT THIS THE WRONG HANDLE STILL FAILS, AND IT FAILS SOMEWHERE USELESS. A
 * `ScopedTx` has an `insert` method at run time, so duck-typing admits it, and
 * `scopedInsertStatement` then throws `refuseTenancyColumn`'s message: `"identityId"
 * is events' tenancy column ... and a scoped write never takes it from the
 * caller`. That sentence is true and it describes a rule about SCOPED writes to
 * somebody who was never allowed to make one, so the reader repairs the payload
 * instead of the door. This refuses at the door and names the door.
 *
 * IT IS A BRAND CHECK AND NOT A SHAPE CHECK, because the shapes do not separate:
 * all three handles carry `insert(key, values)` and the difference between them
 * is entirely in a type parameter, which is gone by the time a value arrives
 * here. The brand is the only thing on the value itself that tells them apart.
 *
 * A HANDLE CARRYING NO BRAND IS REFUSED TOO, rather than admitted as "not
 * `packages/db`'s to judge". A sink is installed once per deployment and the
 * thing on the other side of it is an append-only money record; admitting an
 * unknown object because it happens to have an `insert` is how a recorder ships
 * to production.
 */
function assertEventInsertTx(tx: object, name: EventName): asserts tx is EventInsertTx {
  const brand: unknown = '__brand' in tx ? tx.__brand : undefined;
  if (brand !== EVENT_INSERT_BRAND)
    throw new EventError(
      `${name} was handed a transaction branded ${JSON.stringify(brand)} and \`events\` is ` +
        `written through a \`${EVENT_INSERT_BRAND}\` and through nothing else. ADR-191 clause 5 ` +
        'made this table READABLE from the scoped handle and did not make it writable from one: ' +
        '`ScopedTx.insert` is generic over `OwnedTableKey` because a scoped insert STAMPS the ' +
        'tenancy column from the handle, and an `either` row has two tenancy columns and may ' +
        'carry neither, so there is nothing to stamp. `FirmTx.insert` is generic over ' +
        '`FirmTableKey` and this table is not firm. THE REPAIR IS THE DOOR AND NOT THIS CHECK: ' +
        'emit inside the transaction that already writes the fact, and where that transaction is ' +
        'a scoped one, the deployable holding it cannot record an event at all and that is the ' +
        'finding rather than a reason to widen anything here',
    );
  if (!('insert' in tx) || typeof tx.insert !== 'function')
    throw new EventError(
      `${name} was handed a \`${EVENT_INSERT_BRAND}\` with no \`insert\` method. The brand says ` +
        'this is the write handle and the shape says it is not, so `packages/db` and this file ' +
        'have drifted rather than the caller being wrong',
    );
}

/**
 * The canonical form of a `_cents` value inside `events.payload`.
 *
 * ADR-198 clause 1, and EVENTS section 13 states the same expression. An
 * optional leading `-`, then either `0` or a nonzero digit followed by any
 * digits. No `+`, no leading zeros, no `-0`, no decimal point, no exponent, no
 * thousands separator, no whitespace and never the empty string, so that ONE
 * string denotes one integer and a reader comparing two rows may compare their
 * text.
 */
export const CENTS_IN_PAYLOAD = /^(0|-?[1-9][0-9]*)$/;

/**
 * A `bigint` cents value as EVENTS section 13 declares it on the wire.
 *
 * `toString()` on a `bigint` is already canonical -- it never emits `+`, a
 * leading zero, a `-0` or an exponent -- so this asserts the property rather
 * than constructing it, and the assertion is what stands between a future
 * refactor and a format nothing checks.
 */
export function centsToPayload(value: bigint): string {
  const text = value.toString();
  if (!CENTS_IN_PAYLOAD.test(text))
    throw new EventError(
      `${text} is not the canonical form ADR-198 clause 1 declares for a \`_cents\` value. ` +
        'A `bigint` renders canonically by construction, so this firing means the value reaching ' +
        'here is not a `bigint`',
    );
  return text;
}

/**
 * The inverse, and the ONLY parse of this format in the corpus.
 *
 * ADR-198 clause 4. A reader that spells its own parse is a second
 * implementation of a format living in an append-only column, which is
 * ADR-159 clause 1's refusal one level up. It REFUSES a JSON `number` by name
 * rather than accepting it, because a `number` reaching a money parse is the
 * exact defect the string format exists to prevent and admitting it here would
 * give that defect a supported path.
 */
export function centsFromPayload(value: unknown): bigint {
  if (typeof value === 'number')
    throw new EventError(
      `a \`_cents\` value in an \`events.payload\` is a decimal STRING (ADR-198 clause 1, ` +
        'EVENTS section 13) and this one is a `number`. A JSON number reaching a money parse has ' +
        'already been through an IEEE-754 double and nothing here can tell an exact value from ' +
        'one that lost digits, which is the whole reason the format is a string',
    );
  if (typeof value !== 'string' || !CENTS_IN_PAYLOAD.test(value))
    throw new EventError(
      `${JSON.stringify(value)} is not a \`_cents\` value. EVENTS section 13 declares the ` +
        'canonical form `/^(0|-?[1-9][0-9]*)$/`: no `+`, no leading zeros, no `-0`, no decimal ' +
        'point, no exponent, no separator and never the empty string',
    );
  return BigInt(value);
}

/**
 * A payload with every `_cents` `bigint` rendered as ADR-198 clause 1's string.
 *
 * WALKED THE WAY {@link assertPayloadRules} WALKS, and for the same reason: the
 * money this rule is about is nested. `payout.approved` carries `gate_results`
 * as an object and `ledger.transaction_posted` carries an `entries` ARRAY of
 * `{ ledger_account_code, amount_cents }`, so an encoder that stopped at the top
 * level would hand the driver the exact payload the format exists for.
 *
 * IT BUILDS A NEW STRUCTURE AND MUTATES NOTHING. The caller's payload is the
 * producer's own object, often the same object it is about to use for something
 * else in the transaction it is emitting inside, and a writer that rewrote it
 * would change a value under a caller that never asked for storage.
 *
 * IT TOUCHES `_cents` KEYS AND NOTHING ELSE, which is ADR-198 clause 6. EVENTS
 * declares a format for `_cents` fields and declares none for anything else, so
 * a `bigint` anywhere else survives this walk and is refused by name below
 * rather than silently acquiring a format no document states.
 */
export function encodeCentsForStorage(
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return encodeValue(payload) as Readonly<Record<string, unknown>>;
}

/**
 * Whether a value is a plain object this walk may REBUILD.
 *
 * A `Date`, a `Map`, a `Buffer` and a class instance are all `typeof 'object'`,
 * and `Object.entries` on a `Date` is `[]`, so a walk that rebuilt one would
 * turn a timestamp into `{}` and store the loss. `JSON.stringify` renders a
 * `Date` through `toJSON` and this walk leaves it exactly where it found it, so
 * a payload carrying one serialises today the way it did before ADR-198.
 */
function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** {@link encodeCentsForStorage}'s recursion, carrying the key its value sits under. */
function encodeValue(value: unknown, key?: string): unknown {
  if (typeof value === 'bigint')
    return key !== undefined && key.endsWith('_cents') ? centsToPayload(value) : value;
  // THE KEY IS NOT CARRIED INTO AN ARRAY'S ELEMENTS, AND THAT IS ADR-198 CLAUSE 6
  // READ STRICTLY. Every `_cents` field in the catalogue is a SCALAR, so a
  // `_cents` key holding an array is a shape no row declares; encoding its
  // elements would invent a format for it. `assertPayloadRules` refuses that
  // shape at the producer and `assertSerialisablePayload` refuses it here, by
  // path. What DOES survive is the nested case the ruling is about, because an
  // OBJECT inside an array is walked on its own keys: `entries: [{
  // ledger_account_code, amount_cents }]` encodes.
  if (Array.isArray(value)) return value.map((item) => encodeValue(item));
  if (value === null || typeof value !== 'object' || !isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([name, nested]) => [name, encodeValue(nested, name)]),
  );
}

/**
 * The first `bigint` in a payload, by path, or `undefined`.
 *
 * WALKED THE WAY {@link assertPayloadRules} WALKS, and for the same reason the
 * encoder above is: a check that stopped at the top level would pass the exact
 * payload the money rule exists for.
 */
function firstBigint(value: unknown, path = 'payload'): string | undefined {
  if (typeof value === 'bigint') return path;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = firstBigint(item, `${path}[${index}]`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value === null || typeof value !== 'object') return undefined;
  for (const [key, nested] of Object.entries(value)) {
    const found = firstBigint(nested, `${path}.${key}`);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Refuse a `bigint` that survived the encoder, which is ADR-198 clause 6.
 *
 * THIS CHECK USED TO REFUSE EVERY MONEY PAYLOAD AND NOW REFUSES ALMOST NONE,
 * and the reason is the ruling rather than a loosening. `events.payload` is
 * `jsonb` (`schema.ts`), drizzle's jsonb mapper is `JSON.stringify(value)`, and
 * `JSON.stringify` THROWS on a `bigint`: `TypeError: Do not know how to
 * serialize a BigInt`. {@link assertPayloadRules} meanwhile REFUSES a `_cents`
 * value that is not a `bigint`. Session 366 found that the two rules together
 * made every money payload in the catalogue unwritable, and ADR-198 gives the
 * format that resolves it: a `_cents` value is a decimal STRING in the column
 * and stays a `bigint` everywhere above it.
 *
 * SO WHAT IS LEFT HERE IS THE CASE THE RULING DELIBERATELY DID NOT COVER. A
 * `bigint` under a key that does NOT end `_cents` is a money-sized value whose
 * wire shape no document states, and inventing one here would put a format in a
 * forever-retained column on a producer's authority, which is ADR-159 clause 1's
 * refusal. The repair is a `_cents` key or an amendment to EVENTS, and the
 * message names both rather than leaving a caller to guess.
 */
function assertSerialisablePayload(row: EventEnvelope, payload: unknown): void {
  const at = firstBigint(payload);
  if (at === undefined) return;
  throw new EventError(
    `${row.eventName} carries a bigint at \`${at}\` under a key that does not end \`_cents\`, ` +
      'and `events.payload` is a `jsonb` column whose driver mapping is `JSON.stringify`, which ' +
      'refuses a BigInt outright. ADR-198 clause 1 gives a format to `_cents` fields -- a decimal ' +
      'string, EVENTS section 13 -- and clause 6 gives one to NOTHING ELSE, so this value would ' +
      'be stored in a shape no document states, in a table that is append-only and retained ' +
      'forever. THE REPAIR IS THE KEY OR THE CATALOGUE: name the field `_cents` if it is money, ' +
      'or amend EVENTS to declare what this field is. This file invents neither',
  );
}

/**
 * The writer, over the transaction it is handed and over nothing else.
 *
 * IT OPENS NO DOOR, WHICH IS WHY IT CAN LIVE IN A FILE THAT NAMES NO PACKAGE.
 * `db.ts` is "THE ONE FILE IN THIS DEPLOYABLE THAT NAMES `@merit/db`" (ADR-120)
 * and what that convention protects is the ACQUISITION of a handle: `db.test.ts`
 * asserts that no file but that one takes `firmDb`, `scopedDb`, `systemDb` or
 * `transaction`. This takes none of them. It receives a handle the caller
 * already opened, which is `admin-source/events.ts`'s disposition three files
 * over and the same argument: a module that names a table key and a method is an
 * ADAPTER, and the suite binds both halves where `@merit/db` is reachable.
 *
 * THE ENVELOPE IS THE VALUES OBJECT AND THAT IS NOT A COINCIDENCE.
 * {@link EventEnvelope} is declared "by Drizzle property name" and every one of
 * its eleven fields is a property `schema.ts` declares on `events`; the three
 * columns it omits are `id`, `recordedAt` and `createdAt`, which are generated
 * or defaulted, and `id` REFUSES a supplied value. The suite reads `schema.ts`
 * and asserts both halves of that, so a column added to the table without a
 * field here is red rather than silently unwritten.
 *
 * ONE ROW COMES BACK OR THIS THROWS. `unscopedInsertStatement(...).returning()`
 * yields the rows it wrote, and a write that inserted nothing is the failure this
 * whole file exists to make impossible: the state change would commit and its
 * event would not, which is EVENTS section 1's rule inverted.
 */
export const TRANSACTION_EVENT_WRITER: EventWriter = {
  async insert(tx: object, row: EventEnvelope): Promise<void> {
    assertEventInsertTx(tx, row.eventName);
    const payload = encodeCentsForStorage(row.payload);
    assertSerialisablePayload(row, payload);
    const written = await tx.insert(EVENT_WRITE_TABLE, { ...row, payload });
    if (written.length !== 1)
      throw new EventError(
        `${row.eventName} wrote ${written.length} rows to \`${EVENT_WRITE_TABLE}\` where exactly ` +
          'one was expected. The insert returns what it wrote, so a count that is not one means ' +
          'the fact is about to commit without the event that records it, which is EVENTS ' +
          'section 1 read backwards',
      );
  },
};
