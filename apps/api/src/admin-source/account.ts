// =============================================================================
// apps/api/src/admin-source/account.ts
// =============================================================================
// `AdminReadSource.readAccount`, WHICH IS EIGHT SECTIONS AND HAD TO BE ALL EIGHT
// OR NONE.
//
// Session 353 was dispatched to write this and measured why it could not:
// `routes/admin-reads.ts`'s `projectAccountDetail` refuses a response that omits
// a section the contract names, in its own words, "a drill-down missing a
// section renders as a complete answer with a hole in it". Seven of the eight
// read registered tables and the eighth read `events`, which was not a
// `TableKey`, so **seven of eight was a REJECTED RESPONSE rather than a smaller
// adapter and there was no partial to land.** ADR-191 registered the table and
// there is a whole one.
//
// -----------------------------------------------------------------------------
// `gate_results` IS THE SECTION THE CORPUS WARNS ABOUT HARDEST AND IT IS NOT A
// TABLE
// -----------------------------------------------------------------------------
// `M06` section 3.2: "The `gate_results` per day is the load-bearing part. A
// trader disputing an outcome is disputing a specific day, and the drill-down
// must show what every gate said on that day, FROM THE STORED ROW rather than
// from a recomputation, because a recomputation is an assertion and the stored
// row is a record."
//
// There is no `gate_results` table in this tree. `SD-06` split it into
// `rule_states.engine_gates` and `rule_states.context_gates`, both
// `jsonb NOT NULL` (`packages/db/src/schema.ts`), and `ruleStates` is a
// registered key. **So the section that reads as the blocker is the one that
// needed no ruling at all**, and both columns are carried VERBATIM out of the
// stored row. Nothing in this module derives an eligibility, recomputes a gate
// or summarises one: `engine_eligible` is the stored boolean and the two bags
// are the stored bags.
//
// -----------------------------------------------------------------------------
// EVERY SECTION IS PROJECTED FIELD BY FIELD, AND THE CONTRACT TYPES NONE OF THEM
// -----------------------------------------------------------------------------
// `GET /admin/accounts/:accountId` is THE ONE ROUTE OF THE SEVEN THE CORPUS DOES
// NOT TYPE: API_CONTRACT section 8 gives it a sentence where every other row
// gives a `ts` block, and `admin-reads.ts` records the field-level schema as a
// DEBT owed by whoever types the drill-down. This module is the server half of
// that debt and it discharges it the only way that is not inventing a contract:
// **every field is the DDL's own column, in the DDL's own name, snake_cased.** A
// spread would be `SELECT *`, a renamed field would be this module designing a
// response and then believing it, and a derived field would be the
// recomputation section 3.2 refuses.
//
// -----------------------------------------------------------------------------
// TWO COLUMNS THE SCALAR SWEEP CANNOT ADMIT UNDER THEIR OWN NAMES, AND THEY ARE
// OMITTED RATHER THAN RENAMED
// -----------------------------------------------------------------------------
// **`daily_marks.traded_day` AND `daily_marks.win_day` ARE BOOLEANS WHOSE NAMES
// END `_day`.** `assertContractScalars` reads the NAME and refuses anything
// under a `_day` or `_on` key that is not a `YYYY-MM-DD` exchange trading day,
// which is correct for every typed response in section 8 and collides with the
// schema here, on the one route the corpus does not type.
//
// Three answers were available and two are worse. Carrying them is a 500 on
// every drill-down that has a mark. Renaming them puts a field name in an
// operator's hands that no column has, on the screen whose whole discipline is
// that it shows the stored row. **So they are OMITTED, the omission is asserted
// rather than incidental, and it is reported to whoever owns the sweep**: this
// module's fence does not reach `admin-reads.ts` and a gate is never weakened to
// pass it. Every other column of `daily_marks` is here.
//
// **A NULL TRADING DAY IS AN ABSENT KEY FOR THE SAME REASON.** The sweep refuses
// `null` under a day-shaped name too, and eleven nullable `date` columns feed
// these sections. A nullable day is therefore present when the row has one and
// absent when it does not, which is the only shape the sweep admits and is
// stated here because "absent" and "null" are different answers everywhere else
// in this codebase.
//
// -----------------------------------------------------------------------------
// WHICH ROWS EACH SECTION READS, WHERE THE CONTRACT SAYS ONLY "EVERY"
// -----------------------------------------------------------------------------
// `M06` section 3.2 and API_CONTRACT section 8 both name the sections and not
// their predicates. Six are unambiguous keyed reads on `account_id`. **Two are
// not, and both are decided here rather than left to read as oversights:**
//
//   `flags` READS THE OWNER'S FLAGS AND KEEPS THIS ACCOUNT'S AND THE PERSON'S.
//   `risk_flags.identity_id` is `NOT NULL` and `account_id` is NULLABLE, which
//   is the schema saying a flag is about the person and MAY be about one
//   account. `M06` section 3.3 is why the difference matters on this screen:
//   entering `investigating` "sets `payouts_frozen` on the IDENTITY", so an
//   identity-level flag is the cause of an account-level outcome and a
//   drill-down that answered "why did this account get this outcome" without it
//   would be missing the answer. **The owner's OTHER accounts' flags are not
//   here**, which is the same rule read the other way.
//
//   `admin_actions` READS THIS ACCOUNT'S ACTIONS AND NOT THE PERSON'S.
//   `subject_kind`/`subject_id` is a POLYMORPHIC pair with no foreign key, and
//   `routes/admin-writes.ts` writes `subjectKind: 'account'` with the account's
//   own id for freeze, unfreeze and close. Both terms are equalities so the
//   filter pushes down whole. **An action recorded against the IDENTITY is the
//   identity drill-down's row**, and reaching for it would mean deciding that an
//   `identity`-kind subject relates to this account, which is the read
//   `scope.ts` calls the available mistake about this pair.
//
// -----------------------------------------------------------------------------
// EVERY LIST SECTION IS CHRONOLOGICAL, OLDEST FIRST, TIE-BROKEN ON THE ROW'S ID
// -----------------------------------------------------------------------------
// ONE RULE FOR ALL SIX, so a reader does not have to remember which list runs
// which way. It is oldest-first because this screen is read FORWARDS: `EVENTS.md`
// section 2 rows the `TL` consumer as a per-account CHRONOLOGICAL view, and a
// dispute about a specific day is worked from before it to after it.
//
// **THAT IS THE OPPOSITE OF THE FEED AND THE DIFFERENCE IS THE SURFACE RATHER
// THAN A DRIFT.** `GET /admin/events` is ordered `recorded_at` DESCENDING because
// it is an incident watch and what matters is what we just learned; this is a
// history and what matters is the sequence. The tie-break is the row's own id in
// both, because it is the only total order these tables have.
//
// -----------------------------------------------------------------------------
// THERE IS NO PAGE AND NO CAP, WHICH IS THE CONTRACT'S ASK AND IS PRICED
// -----------------------------------------------------------------------------
// "Every mark, every rule state per day, every event." The port's signature
// returns a detail and not an `AdminPage`, so there is nowhere to put a cursor,
// and an account traded for two years is two years of marks and rule states in
// one response. {@link AccountDetailCost} reports what one read cost rather than
// leaving it to be discovered, which is `readFlagQueue`'s and
// `readIdentityGraph`'s choice for their reason. **A cap is not invented here**:
// truncating a drill-down silently is the shape `graph.ts` refuses by name, and
// a cap the contract does not state is a ruling rather than a default.
// =============================================================================

import { AdminReadError } from '../routes/admin-reads.ts';
import type { AdminAccountDetail } from '../routes/admin-reads.ts';
import type { AdminRowFilter } from './flags.ts';

// -----------------------------------------------------------------------------
// The port onto the database
// -----------------------------------------------------------------------------

/**
 * The tables this module reads, and no others. ONE PER SECTION.
 *
 * Eight sections and eight tables, and `accounts` serves the `account` section
 * while `identities` is reached through the row it hands back. Session 353
 * seeded this tuple and watched `tsc` refuse `'events'` with `TS2322`; that is
 * the line ADR-191 moved.
 */
export const ACCOUNT_READ_TABLES = [
  'accounts',
  'adminActions',
  'dailyMarks',
  'events',
  'identities',
  'payoutRequests',
  'riskFlags',
  'ruleStates',
] as const;

/** One of {@link ACCOUNT_READ_TABLES}. */
export type AccountReadTable = (typeof ACCOUNT_READ_TABLES)[number];

/**
 * ADR-112's keyed accessor, READ HALF ONLY, over this module's eight tables.
 *
 * `FlagsTx`'s shape and `FlagsTx`'s reason: `insert`, `updateAt`, `deleteAt` and
 * `sqlExecutor` are ABSENT rather than unused, `SystemTx` satisfies this
 * structurally, and the widest read in the console cannot write through it.
 */
export interface AccountTx {
  rowsWhere(key: AccountReadTable, where: AdminRowFilter): Promise<unknown[]>;
  rowAt(key: AccountReadTable, at: AdminRowFilter): Promise<unknown>;
}

// -----------------------------------------------------------------------------
// The columns, read defensively
// -----------------------------------------------------------------------------

function field(row: unknown, name: string): unknown {
  if (typeof row !== 'object' || row === null)
    throw new AdminReadError(
      `the accessor returned a ${typeof row} where a row was expected. A drill-down built out of ` +
        'that is the screen a payout decision gets explained from, explaining something else',
    );
  return (row as Record<string, unknown>)[name];
}

function text(row: unknown, name: string, at: string): string {
  const value = field(row, name);
  if (typeof value !== 'string' || value === '')
    throw new AdminReadError(
      `${at} carries no \`${name}\`, and the column is \`NOT NULL\` in the schema. That is the ` +
        'transcription disagreeing with the database rather than a row to render',
    );
  return value;
}

function optionalText(row: unknown, name: string, at: string): string | null {
  const value = field(row, name);
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value === '')
    throw new AdminReadError(
      `${at} carries \`${name}\` as ${JSON.stringify(value)}. The column is nullable, so the two ` +
        'answers are a value and no value, and an empty string is neither',
    );
  return value;
}

function boolean(row: unknown, name: string, at: string): boolean {
  const value = field(row, name);
  if (typeof value !== 'boolean')
    throw new AdminReadError(
      `${at} carries \`${name}\` as ${JSON.stringify(value)}, and the column is ` +
        '`boolean NOT NULL`. A guessed boolean on this screen is a frozen account rendered as a ' +
        'live one',
    );
  return value;
}

/**
 * A `bigint` money column as the contract's JSON integer.
 *
 * API_CONTRACT section 1: "`*_cents` are JSON integers ... No floats, no
 * formatted strings", and `assertContractScalars` refuses the response
 * otherwise. `graph.ts`'s `cents`, for `graph.ts`'s reason: a value past 2^53
 * silently rounded is wrong in its low digits and right in every digit an
 * operator reads.
 */
function cents(value: unknown, at: string): number {
  const asNumber =
    typeof value === 'bigint'
      ? Number(value)
      : typeof value === 'number'
        ? value
        : typeof value === 'string' && /^-?\d+$/.test(value)
          ? Number(value)
          : Number.NaN;
  if (!Number.isSafeInteger(asNumber))
    throw new AdminReadError(
      `${at} is ${JSON.stringify(typeof value === 'bigint' ? value.toString() : value)}, which ` +
        'is not a safe integer number of cents. API_CONTRACT section 1 types every `_cents` ' +
        'member as a JSON integer and a rounded one is wrong where it is hardest to notice',
    );
  return asNumber;
}

/** A plain `integer` column. A count is a count and never a fraction of one. */
function count(row: unknown, name: string, at: string): number {
  const value = field(row, name);
  const asNumber = typeof value === 'bigint' ? Number(value) : value;
  if (typeof asNumber !== 'number' || !Number.isSafeInteger(asNumber))
    throw new AdminReadError(
      `${at} carries \`${name}\` as ${JSON.stringify(value)}, and the column is an integer`,
    );
  return asNumber;
}

/**
 * A `bigint` surrogate key as a string.
 *
 * `events.id`, `daily_marks.id`, `rule_states.id` and `admin_actions.id` are all
 * `bigint GENERATED ALWAYS AS IDENTITY`, and a JSON number loses their ordering
 * past 2^53. API_CONTRACT section 8 already types `AdminEventItem.id` a string
 * for exactly that reason and this module carries the other three the same way.
 */
function serial(row: unknown, name: string, at: string): string {
  const value = field(row, name);
  const asString = typeof value === 'bigint' || typeof value === 'number' ? String(value) : value;
  if (typeof asString !== 'string' || !/^\d+$/.test(asString))
    throw new AdminReadError(
      `${at} carries \`${name}\` as ${JSON.stringify(value)}, which is not the ` +
        '`bigint GENERATED ALWAYS AS IDENTITY` the schema declares. It is the only total order ' +
        'these rows have and the list sections are tie-broken on it',
    );
  return asString;
}

function optionalSerial(row: unknown, name: string, at: string): string | null {
  const value = field(row, name);
  if (value === null || value === undefined) return null;
  return serial(row, name, at);
}

const TRADING_DAY = /^\d{4}-\d{2}-\d{2}$/;

function asDay(value: unknown, name: string, at: string): string {
  if (typeof value === 'string' && TRADING_DAY.test(value)) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const year = String(value.getUTCFullYear()).padStart(4, '0');
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const date = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${date}`;
  }
  throw new AdminReadError(
    `${at} carries \`${name}\` as ${JSON.stringify(value)}, which is not an exchange trading day`,
  );
}

/** A `date NOT NULL` column. */
function day(row: unknown, name: string, at: string): string {
  return asDay(field(row, name), name, at);
}

/**
 * A NULLABLE `date` column, as a key that is present or a key that is not.
 *
 * See the header: `assertContractScalars` refuses `null` under a day-shaped
 * name, so the two shapes this response can carry are the day and no key at all.
 * The spread is at the call site so a reader sees which columns are nullable.
 */
function optionalDay(
  row: unknown,
  property: string,
  wire: string,
  at: string,
): Record<string, string> {
  const value = field(row, property);
  if (value === null || value === undefined) return {};
  return { [wire]: asDay(value, property, at) };
}

/** A `timestamptz NOT NULL` column, as section 1's RFC 3339 instant. */
function instant(row: unknown, name: string, at: string): string {
  const value = field(row, name);
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value;
  throw new AdminReadError(
    `${at} carries \`${name}\` as ${JSON.stringify(value)}, which is not an instant`,
  );
}

function optionalInstant(row: unknown, name: string, at: string): string | null {
  const value = field(row, name);
  if (value === null || value === undefined) return null;
  return instant(row, name, at);
}

/**
 * A `jsonb NOT NULL` column, verbatim.
 *
 * VERBATIM IS THE POINT ON THIS SCREEN. `engine_gates` and `context_gates` are
 * what `M06` section 3.2 calls the load-bearing part, and the whole of that
 * sentence is that the drill-down shows the STORED row rather than a
 * recomputation.
 */
function json(row: unknown, name: string, at: string): unknown {
  const value = field(row, name);
  if (value === null || value === undefined || typeof value !== 'object')
    throw new AdminReadError(
      `${at} carries \`${name}\` as ${JSON.stringify(value)}, and the column is ` +
        '`jsonb NOT NULL`. On this screen a missing bag is a gate result nobody can read',
    );
  return value;
}

/**
 * A `bytea NOT NULL` column, as hex.
 *
 * `daily_marks.source_hash` and `rule_states.state_hash` are the two, and both
 * are what a dispute is settled against. A `Buffer` serialises as
 * `{"type":"Buffer","data":[...]}`, which is the same bytes rendered as
 * something nobody can compare by eye to a hash written down anywhere else.
 */
function hash(row: unknown, name: string, at: string): string {
  const value = field(row, name);
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (typeof value === 'string' && value !== '') return value;
  throw new AdminReadError(
    `${at} carries \`${name}\` as ${JSON.stringify(value)}, and the column is \`bytea NOT NULL\``,
  );
}

// -----------------------------------------------------------------------------
// The sections, one projector each
// -----------------------------------------------------------------------------

function projectAccount(row: unknown, accountId: string): Record<string, unknown> {
  const at = `account \`${accountId}\``;
  return {
    // NAMED `account_id` AND NOT `id`, which is `AdminAccountSearchItem`'s name
    // for the same column one row of section 8 over. It is also the field a
    // drill-down needs in order to check its own root against the path it was
    // requested at, which `apps/admin` records as missing.
    account_id: text(row, 'id', at),
    identity_id: text(row, 'identityId', at),
    user_id: text(row, 'userId', at),
    purchase_id: text(row, 'purchaseId', at),
    plan_version_id: text(row, 'planVersionId', at),
    size_cents: cents(field(row, 'sizeCents'), `${at}'s \`size_cents\``),
    phase: text(row, 'phase', at),
    status: text(row, 'status', at),
    platform: text(row, 'platform', at),
    platform_account_ref: optionalText(row, 'platformAccountRef', at),
    feed: optionalText(row, 'feed', at),
    front_end_permissions: field(row, 'frontEndPermissions'),
    opened_on: day(row, 'openedOn', at),
    ...optionalDay(row, 'fundedOn', 'funded_on', at),
    ...optionalDay(row, 'closedOn', 'closed_on', at),
    close_reason: optionalText(row, 'closeReason', at),
    payouts_frozen: boolean(row, 'payoutsFrozen', at),
    recon_blocked: boolean(row, 'reconBlocked', at),
    ...optionalDay(row, 'expiresOn', 'expires_on', at),
    graduated_at: optionalInstant(row, 'graduatedAt', at),
    graduation_path: optionalText(row, 'graduationPath', at),
    terminal_settlement_id: optionalText(row, 'terminalSettlementId', at),
    graduation_eligible: boolean(row, 'graduationEligible', at),
    created_at: instant(row, 'createdAt', at),
    updated_at: instant(row, 'updatedAt', at),
  };
}

function projectIdentity(row: unknown, identityId: string): Record<string, unknown> {
  const at = `identity \`${identityId}\``;
  const maxAccounts = field(row, 'maxAccountsOverride');
  return {
    identity_id: text(row, 'id', at),
    display_name: optionalText(row, 'displayName', at),
    leaderboard_opt_in: boolean(row, 'leaderboardOptIn', at),
    status: text(row, 'status', at),
    status_reason: optionalText(row, 'statusReason', at),
    max_accounts_override:
      maxAccounts === null || maxAccounts === undefined
        ? null
        : count(row, 'maxAccountsOverride', at),
    payouts_frozen: boolean(row, 'payoutsFrozen', at),
    frozen_reason: optionalText(row, 'frozenReason', at),
    frozen_at: optionalInstant(row, 'frozenAt', at),
    support_contact_ref: optionalText(row, 'supportContactRef', at),
    first_seen_at: instant(row, 'firstSeenAt', at),
    created_at: instant(row, 'createdAt', at),
    updated_at: instant(row, 'updatedAt', at),
  };
}

function projectMark(row: unknown): Record<string, unknown> {
  const id = serial(row, 'id', 'a daily_marks row');
  const at = `daily mark \`${id}\``;
  return {
    mark_id: id,
    account_id: text(row, 'accountId', at),
    trading_day: day(row, 'tradingDay', at),
    opening_balance_cents: cents(field(row, 'openingBalanceCents'), `${at}'s opening balance`),
    closing_balance_cents: cents(field(row, 'closingBalanceCents'), `${at}'s closing balance`),
    high_balance_cents: cents(field(row, 'highBalanceCents'), `${at}'s high balance`),
    low_balance_cents: cents(field(row, 'lowBalanceCents'), `${at}'s low balance`),
    realized_pnl_cents: cents(field(row, 'realizedPnlCents'), `${at}'s realized pnl`),
    fill_count: count(row, 'fillCount', at),
    // `traded_day` AND `win_day` ARE ABSENT AND THAT IS THE HEADER'S SECTION ON
    // the scalar sweep, not an oversight: both are `boolean NOT NULL` columns
    // whose names end `_day`, and `assertContractScalars` refuses anything under
    // that shape of name which is not a `YYYY-MM-DD`.
    adjustment_cents: cents(field(row, 'adjustmentCents'), `${at}'s adjustment`),
    source_hash: hash(row, 'sourceHash', at),
    source: text(row, 'source', at),
    ingest_file_id: optionalText(row, 'ingestFileId', at),
    superseded_by: optionalSerial(row, 'supersededBy', at),
    computed_at: instant(row, 'computedAt', at),
    created_at: instant(row, 'createdAt', at),
  };
}

function projectRuleState(row: unknown): Record<string, unknown> {
  const id = serial(row, 'id', 'a rule_states row');
  const at = `rule state \`${id}\``;
  return {
    rule_state_id: id,
    account_id: text(row, 'accountId', at),
    trading_day: day(row, 'tradingDay', at),
    phase: text(row, 'phase', at),
    floor_cents: cents(field(row, 'floorCents'), `${at}'s floor`),
    floor_locked: boolean(row, 'floorLocked', at),
    floor_open_cents: cents(field(row, 'floorOpenCents'), `${at}'s open floor`),
    high_water_balance_cents: cents(field(row, 'highWaterBalanceCents'), `${at}'s high water`),
    balance_cents: cents(field(row, 'balanceCents'), `${at}'s balance`),
    withdrawable_cents: cents(field(row, 'withdrawableCents'), `${at}'s withdrawable`),
    traded_days_count: count(row, 'tradedDaysCount', at),
    win_days_count: count(row, 'winDaysCount', at),
    consistency_best_day_cents: cents(
      field(row, 'consistencyBestDayCents'),
      `${at}'s best consistency day`,
    ),
    consistency_period_profit_cents: cents(
      field(row, 'consistencyPeriodProfitCents'),
      `${at}'s consistency period profit`,
    ),
    ...optionalDay(row, 'consistencyPeriodStartDay', 'consistency_period_start_day', at),
    payouts_settled_count: count(row, 'payoutsSettledCount', at),
    ...optionalDay(row, 'payoutAnchorDay', 'payout_anchor_day', at),
    ...optionalDay(row, 'cadenceAnchorDay', 'cadence_anchor_day', at),
    engine_eligible: boolean(row, 'engineEligible', at),
    // SD-06's two halves of `gate_results`, VERBATIM. See the header.
    engine_gates: json(row, 'engineGates', at),
    context_gates: json(row, 'contextGates', at),
    state_hash: hash(row, 'stateHash', at),
    engine_version: text(row, 'engineVersion', at),
    calendar_revision_id: optionalSerial(row, 'calendarRevisionId', at),
    computed_at: instant(row, 'computedAt', at),
    created_at: instant(row, 'createdAt', at),
  };
}

function projectEvent(row: unknown): Record<string, unknown> {
  const id = serial(row, 'id', 'an events row');
  const at = `event \`${id}\``;
  return {
    event_id: id,
    event_name: text(row, 'eventName', at),
    schema_version: count(row, 'schemaVersion', at),
    occurred_at: instant(row, 'occurredAt', at),
    recorded_at: instant(row, 'recordedAt', at),
    identity_id: optionalText(row, 'identityId', at),
    account_id: optionalText(row, 'accountId', at),
    subject_kind: text(row, 'subjectKind', at),
    subject_id: text(row, 'subjectId', at),
    actor_kind: text(row, 'actorKind', at),
    actor_id: optionalText(row, 'actorId', at),
    correlation_id: optionalText(row, 'correlationId', at),
    // VERBATIM, AND NOTHING HERE GATES IT. See {@link readAccountDetail}: the
    // `INV-M6-10` projection is on the RESPONSE, in `routes/admin-reads.ts`, and
    // a second gate inside an adapter is the shape ADR-184 ruling 3 refused.
    payload: json(row, 'payload', at),
    created_at: instant(row, 'createdAt', at),
  };
}

function projectFlag(row: unknown): Record<string, unknown> {
  const id = text(row, 'id', 'a risk_flags row');
  const at = `risk flag \`${id}\``;
  return {
    flag_id: id,
    identity_id: text(row, 'identityId', at),
    account_id: optionalText(row, 'accountId', at),
    flag_type: text(row, 'flagType', at),
    severity: count(row, 'severity', at),
    status: text(row, 'status', at),
    source: text(row, 'source', at),
    detector_run_id: optionalText(row, 'detectorRunId', at),
    // "FLAGS WITH EVIDENCE" IS THE CONTRACT'S OWN PHRASE and this is the
    // evidence. `risk_flags.evidence` is `jsonb NOT NULL` because "an edge
    // without its evidence is an accusation without a reason", and the queue
    // one file over carries only the KEYS of it; a drill-down carries the bag,
    // because this is the screen the accusation is examined on.
    evidence: json(row, 'evidence', at),
    first_detected_on: day(row, 'firstDetectedOn', at),
    resolved_at: optionalInstant(row, 'resolvedAt', at),
    resolved_by: optionalText(row, 'resolvedBy', at),
    resolution_note: optionalText(row, 'resolutionNote', at),
    sla_due_at: optionalInstant(row, 'slaDueAt', at),
    first_touched_at: optionalInstant(row, 'firstTouchedAt', at),
    created_at: instant(row, 'createdAt', at),
    updated_at: instant(row, 'updatedAt', at),
  };
}

function projectPayout(row: unknown): Record<string, unknown> {
  const id = text(row, 'id', 'a payout_requests row');
  const at = `payout request \`${id}\``;
  return {
    payout_request_id: id,
    account_id: text(row, 'accountId', at),
    identity_id: text(row, 'identityId', at),
    requested_cents: cents(field(row, 'requestedCents'), `${at}'s requested amount`),
    approved_cents: cents(field(row, 'approvedCents'), `${at}'s approved amount`),
    // BOTH LEGS, BECAUSE `approved_cents = trader_cents + firm_cents` IS A CHECK
    // ON THE ROW. A drill-down carrying the total and not the split cannot
    // explain what the trader actually received.
    trader_cents: cents(field(row, 'traderCents'), `${at}'s trader leg`),
    firm_cents: cents(field(row, 'firmCents'), `${at}'s firm leg`),
    basis_trading_day: day(row, 'basisTradingDay', at),
    plan_version_id: text(row, 'planVersionId', at),
    // "PAYOUTS WITH THEIR IMMUTABLE SNAPSHOTS", VERBATIM. This bag is what the
    // eligibility decision was made on, and re-deriving it would be the
    // recomputation section 3.2 refuses one section over.
    eligibility_snapshot: json(row, 'eligibilitySnapshot', at),
    status: text(row, 'status', at),
    payout_ordinal: count(row, 'payoutOrdinal', at),
    approved_at: instant(row, 'approvedAt', at),
    settled_at: optionalInstant(row, 'settledAt', at),
    ...optionalDay(row, 'settledTradingDay', 'settled_trading_day', at),
    ...optionalDay(row, 'effectiveTradingDay', 'effective_trading_day', at),
    frozen_at: optionalInstant(row, 'frozenAt', at),
    freeze_flag_id: optionalText(row, 'freezeFlagId', at),
    freeze_expires_at: optionalInstant(row, 'freezeExpiresAt', at),
    balance_reflection_status: text(row, 'balanceReflectionStatus', at),
    ...optionalDay(row, 'reflectedOnTradingDay', 'reflected_on_trading_day', at),
    created_at: instant(row, 'createdAt', at),
    updated_at: instant(row, 'updatedAt', at),
  };
}

function projectAdminAction(row: unknown): Record<string, unknown> {
  const id = serial(row, 'id', 'an admin_actions row');
  const at = `admin action \`${id}\``;
  return {
    admin_action_id: id,
    actor: text(row, 'actor', at),
    action: text(row, 'action', at),
    subject_kind: text(row, 'subjectKind', at),
    subject_id: text(row, 'subjectId', at),
    // `0017`'s OWN WORDS ARE "NO UNEXPLAINED ADMIN ACTION, EVER", and the
    // column is `NOT NULL` because of it. An action rendered without its reason
    // on this screen would be the record without the control.
    reason: text(row, 'reason', at),
    before: json(row, 'before', at),
    after: json(row, 'after', at),
    evidence_refs: json(row, 'evidenceRefs', at),
    ip: optionalText(row, 'ip', at),
    initiative: text(row, 'initiative', at),
    on_behalf_of_identity_id: optionalText(row, 'onBehalfOfIdentityId', at),
    created_at: instant(row, 'createdAt', at),
  };
}

// -----------------------------------------------------------------------------
// The read
// -----------------------------------------------------------------------------

/**
 * What one drill-down cost.
 *
 * THERE IS NO PAGE ON THIS RESPONSE, so these are the only numbers anybody has
 * about how large it was. `marks` and `ruleStates` are the two that grow with
 * the age of the account rather than with anything a caller chose.
 */
export interface AccountDetailCost {
  readonly marks: number;
  readonly ruleStates: number;
  readonly events: number;
  readonly identityFlags: number;
  readonly flags: number;
  readonly payouts: number;
  readonly adminActions: number;
}

/** {@link readAccountDetail}'s answer, plus what it cost. */
export interface AccountDetailResult {
  readonly detail: AdminAccountDetail;
  readonly cost: AccountDetailCost;
}

/** Oldest first, tie-broken on the row's own id. See the header: one rule, six lists. */
function chronologically<T extends Record<string, unknown>>(
  rows: readonly T[],
  instantKey: string,
  idKey: string,
): readonly T[] {
  return [...rows].sort((left, right) => {
    const a = String(left[instantKey] ?? '');
    const b = String(right[instantKey] ?? '');
    if (a !== b) return a < b ? -1 : 1;
    const leftId = String(left[idKey] ?? '');
    const rightId = String(right[idKey] ?? '');
    if (leftId === rightId) return 0;
    // Both surrogate keys and both uuids compare correctly here for different
    // reasons: a uuid is text and a `bigint` id is compared as a number,
    // because "10" sorts before "9" as text.
    if (/^\d+$/.test(leftId) && /^\d+$/.test(rightId))
      return BigInt(leftId) < BigInt(rightId) ? -1 : 1;
    return leftId < rightId ? -1 : 1;
  });
}

/**
 * `AdminReadSource.readAccount`, with the cost attached.
 *
 * `null` WHEN THE ACCOUNT IS NOT THERE, which the route turns into a 404. An
 * account with no marks is NOT that case: it is a drill-down whose list sections
 * are empty, and answering 404 for it would tell an operator that an account
 * opened this morning does not exist.
 *
 * **ALL EIGHT SECTIONS OR NONE, AND THE ROUTE ENFORCES IT SEPARATELY.**
 * `projectAccountDetail` refuses a response that omits one and refuses one the
 * contract does not name, in both directions. This function fills all eight, and
 * the two checks are independent on purpose: a section dropped here is a 500
 * there rather than a hole an operator reads as an answer.
 *
 * **NOTHING THIS FUNCTION RETURNS IS WITHHELD, AND THAT IS STILL DELIBERATE
 * RATHER THAN OUTSTANDING.** Session 356 measured what it cost: the `events`
 * section carries payloads verbatim, including the two the catalogue writes with
 * a third party's uuid in them (`kyc.dedupe_hit`'s `matched_identity_id` and
 * `identity.merged`'s `merged_identity_id`, `scope.ts`), so a second person's
 * identity reached a response about the first. **`routes/admin-reads.ts` now
 * carries the projection that stops it**, on the RESPONSE and over the
 * SERIALIZED body, which is ADR-184 ruling 3 in its own words: the withholding
 * is "a property of the response and not of the renderer". **A gate here would
 * be the second place that rule can be slightly different from the feed's**, so
 * this adapter still hands its rows over exactly as the database holds them and
 * the two unit cases that say so are kept rather than retired.
 */
export async function readAccountDetail(
  tx: AccountTx,
  accountId: string,
): Promise<AccountDetailResult | null> {
  const accountRow = await tx.rowAt('accounts', { id: accountId });
  if (accountRow === undefined || accountRow === null) return null;
  const account = projectAccount(accountRow, accountId);
  const identityId = String(account['identity_id']);

  const identityRow = await tx.rowAt('identities', { id: identityId });
  // AN ACCOUNT WHOSE IDENTITY IS NOT THERE IS A REFUSAL AND NOT AN EMPTY
  // SECTION. `accounts.identity_id` REFERENCES `identities(id)`, so this cannot
  // happen while the constraint holds, and a drill-down rendering the estate and
  // the database disagreeing as a blank panel is the hole `projectAccountDetail`
  // exists to refuse one layer up.
  if (identityRow === undefined || identityRow === null)
    throw new AdminReadError(
      `account \`${accountId}\` names identity \`${identityId}\`, which has no \`identities\` ` +
        'row. `accounts.identity_id` references that table, so the estate and the database ' +
        'disagree and this drill-down cannot be built',
    );

  const marks = (await tx.rowsWhere('dailyMarks', { accountId })).map(projectMark);
  const ruleStates = (await tx.rowsWhere('ruleStates', { accountId })).map(projectRuleState);
  const events = (await tx.rowsWhere('events', { accountId })).map(projectEvent);
  const payouts = (await tx.rowsWhere('payoutRequests', { accountId })).map(projectPayout);
  const adminActions = (
    await tx.rowsWhere('adminActions', { subjectKind: 'account', subjectId: accountId })
  ).map(projectAdminAction);

  // THE OWNER'S FLAGS, KEPT WHERE THEY ARE THIS ACCOUNT'S OR THE PERSON'S. See
  // the header: the filter is a conjunction of equalities and `IS NULL` is a
  // term this directory cannot mint, so the narrowing is a keyed read on the
  // identity plus one predicate in memory.
  const identityFlags = (await tx.rowsWhere('riskFlags', { identityId })).map(projectFlag);
  const flags = identityFlags.filter((flag) => {
    const on = flag['account_id'];
    return on === null || on === accountId;
  });

  return {
    detail: {
      account,
      identity: projectIdentity(identityRow, identityId),
      marks: chronologically(marks, 'trading_day', 'mark_id'),
      rule_states: chronologically(ruleStates, 'trading_day', 'rule_state_id'),
      events: chronologically(events, 'occurred_at', 'event_id'),
      flags: chronologically(flags, 'first_detected_on', 'flag_id'),
      payouts: chronologically(payouts, 'basis_trading_day', 'payout_request_id'),
      admin_actions: chronologically(adminActions, 'created_at', 'admin_action_id'),
    },
    cost: {
      marks: marks.length,
      ruleStates: ruleStates.length,
      events: events.length,
      identityFlags: identityFlags.length,
      flags: flags.length,
      payouts: payouts.length,
      adminActions: adminActions.length,
    },
  };
}
