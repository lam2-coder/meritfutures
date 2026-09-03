// =============================================================================
// apps/api/src/payout-backend.ts
// =============================================================================
// THE FIRST LINE OF PAYOUT PERSISTENCE THIS TREE HAS EVER HAD, AND IT IS FIVE
// MEMBERS OF EIGHT ON PURPOSE.
//
// `wiring.test.ts`'s `usePayoutBackend` entry has carried one clause longer than
// any other: "NOTHING IN THIS TREE IMPLEMENTS `PayoutTx`". ADR-287 enumerated
// what implementing it would cost and found nine sessions, of which this file is
// slice 3. ADR-291 is this file's ruling, ADR-295 added slice 6, ADR-301 added
// the lock ADR-293 ruled and ADR-295's fence could not reach, ADR-306 built
// three of `subject()`'s four legs, and ADR-308 built the fourth and the size
// decode inside the third. `subject()` ANSWERS WHOLE.
//
// -----------------------------------------------------------------------------
// WHAT ANSWERS, AND WHAT REFUSES
// -----------------------------------------------------------------------------
// `PayoutBackend` and `PayoutTx` carry EIGHT members between them. SIX answer
// here and TWO reject with `PayoutBackendUnwired`:
//
//   transact            ANSWERS. The scoped door, opened once per request.
//   lockScope           ANSWERS. `ScopedTx.lockScope`, delegated in one line.
//                       ADR-293 section 3.5, built by ADR-301. THE LOCK IS NOT
//                       TAKEN IN `transact` and the decision function calls it.
//   identityStatus      ANSWERS. `identities.status`, decoded to one of three.
//   insertPayoutRequest ANSWERS ON THE APPROVAL BRANCH ONLY. ADR-287 slice 6,
//                       ruled by ADR-295. ITS HOLD BRANCH REFUSES, and that is
//                       slice 8, whose supplier is COUNSEL and not a session.
//   subject             ANSWERS, AND IT IS THE ONE THAT TOOK TWO ROWS. ADR-287
//                       slices 4 and 5. ADR-306 built the `null` arm, `gates`
//                       and `plan` up to the size decode; ADR-308 built `state`
//                       and the size decode, so all four legs read. NOTHING IN
//                       IT IS SYNTHESISED: every leg answers from a row it read
//                       or throws, and there is no shape here that holds half
//                       of either value.
//   listPayouts         ANSWERS. ADR-287 slice 7, ruled by ADR-311. TEN wire
//                       fields, EIGHT off columns of `payout_requests` and TWO
//                       served as the RULED ABSENCES ADR-290 decided. It is the
//                       only member outside every write path.
//   holdFlag            REFUSES. ADR-287 slice 8, whose supplier is COUNSEL.
//   idempotency         REFUSES, AND IT IS THE ONE THAT COULD ANSWER TODAY.
//
// THE LAST LINE IS THE ONE WORTH READING TWICE, BECAUSE IT IS A CHOICE RATHER
// THAN AN ABSENCE. `databaseIdempotencyStore` (`src/idempotency-store.ts:144`)
// exists, has its own suite, and would satisfy this field on this tree today.
// It is NOT installed here, and the WHOLE-REFUSAL RULING is what keeps it out:
// a partial backend refuses AS A WHOLE or it is a fixture serving real traffic.
//
// AND THAT RULING STILL BINDS WITH `listPayouts` ANSWERING, WHICH IS ADR-311's
// SECTION 4 AND IS NOT AN EXCEPTION CARVED FOR THIS MEMBER. The sentence
// `wiring.test.ts` wrote it in names its own condition -- installing these two
// "beside a `transact` whose `subject` rejects" -- and `subject` STOPPED
// REJECTING when ADR-308 built it. What keeps the backend partial is `holdFlag`,
// whose supplier is counsel rather than a session, so the property still has a
// live witness and nothing was weakened to let this member through. THE ORDER IS
// THE PLAN'S OWN: ADR-287 section 7 schedules slice 7 as a BUILD blocked only on
// slice 2, and slice 9 as BLOCKED on slices 1 to 7, so 7 precedes 9 by the
// governing document rather than by this file's preference.
//
// -----------------------------------------------------------------------------
// THIS FILE IS NOT INSTALLED AND THE COUNT DOES NOT MOVE
// -----------------------------------------------------------------------------
// `start.ts` DOES NOT CALL `usePayoutBackend`, and that is ADR-287 slice 9's act
// behind a founder `E2` read, not this one's. The wired count stays at TEN of
// TWENTY-FOUR declared with FOURTEEN blocked. A module that exists and is not
// reached changes no deployment, which is exactly what building the port ahead
// of the ruling that installs it is supposed to cost.
//
// AND THAT SENTENCE IS WORTH MORE NOW THAN IT WAS, BECAUSE THE MEMBER ANSWERS.
// TWO members still refuse, so `usePayoutBackend`'s own closing ruling still
// binds: a partial backend refuses AS A WHOLE or it is a fixture serving real
// traffic. Installing this file is slice 9 and slice 9 alone.
//
// -----------------------------------------------------------------------------
// TWO REFUSAL VOCABULARIES, AND THE DIFFERENCE IS THE STATUS CODE
// -----------------------------------------------------------------------------
// `PayoutBackendUnwired` is caught by `unwiredOrThrow` (`routes/payouts.ts`) and
// becomes 503, which is the contract's "dependency down, safe to retry". An
// unbuilt member is exactly that.
//
// `PayoutRowError` is DELIBERATELY NOT A `PayoutBackendUnwired` and is therefore
// NOT caught, so it stays a 500. This is `RuleStateUnreadable`'s ruling applied
// one door over: a row whose columns disagree with the schema that wrote them is
// an internal error, and a retryable status would tell a trader to retry what no
// retry can fix.
//
// -----------------------------------------------------------------------------
// THE MEMBER THAT REFUSED BY NAME, AND WHAT ITS NAMES BOUGHT
// -----------------------------------------------------------------------------
// `subject()` refused wholesale for three revisions, on one line, under a comment
// naming ADR-287 slices 4 AND 5 together. That is a blanket rejection and it
// COSTS A SESSION: a reader cannot tell a member nobody has started from a member
// whose last leg is missing, and row 306 was dispatched only after re-deriving at
// source that slice 4 had never been built while both records said slice 5 was
// next. It then threw `subject.state and subject.plan.size`, which was the
// remainder as ADR-287 section 7 sizes it, and named BOTH rather than whichever
// one the body reached first, so the row that followed read the whole remainder
// instead of half of it. THAT IS WHAT THE NAMES BOUGHT AND THEY ARE SPENT: both
// legs read now, and the record of what they cost is ADR-306 and ADR-308.
//
// -----------------------------------------------------------------------------
// THE STATE LEG READS AND DOES NOT FOLD, AND THAT IS THE ONE TO GUARD
// -----------------------------------------------------------------------------
// `PayoutSubject.state` requires a backend to CALL `ruleStateOn` and NOT to fold
// a state in the request path, on `INV-M5-02` and ADR-239; the day comes from
// `ScopedTx.lastClosedTradingDay()` on ADR-268 and never from a calendar folded
// here. A REQUEST-PATH FOLD IS THE DIVERGENCE ADR-026 `C-07`'s `state_hash`
// EXISTS TO MAKE DETECTABLE, computed on the one path no replay audit reads. A
// session that "optimises" `stateLeg` into a fold has not made this file faster;
// it has made the API and the worker two evaluators of one rule.
//
// NO SYNTHESISED DEFAULT ON EITHER PATH. A status outside `identity_status`'s
// three members raises; it never falls back to `restricted` (which would deny a
// trader on a value nobody wrote) and never to `active` (which would open the
// money door on one). ADR-041 refused a fourth member and ADR-140's predicate is
// `= 'active'` precisely so a fourth arriving later fails CLOSED.
// =============================================================================

import type { ScopedTx } from '@merit/db';
import {
  decodeCapScheduleCents,
  decodePlanRules,
  resolveExternalGates,
  resolvePlan,
} from '@merit/rules-engine';
import type {
  ExternalGates,
  PlanVersionSizeRow,
  ResolvedPlan,
  RuleState,
} from '@merit/rules-engine';

import type { ApiDb } from './db.ts';
import type { IdempotencyStore } from './idempotency.ts';
import { ruleStateOn } from './rule-state-reader.ts';
import { centsToJson, PayoutBackendUnwired } from './routes/payouts.ts';
import type {
  IdentityStatus,
  PayoutBackend,
  PayoutHold,
  PayoutListItem,
  PayoutSubject,
  PayoutTx,
} from './routes/payouts.ts';

/**
 * A row this backend read that the schema says cannot exist.
 *
 * NOT A `PayoutBackendUnwired`, so `unwiredOrThrow` rethrows it and the route
 * answers 500. See the header: an unbuilt member is retryable and a malformed
 * row is not.
 */
export class PayoutRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoutRowError';
  }
}

/**
 * `identity_status`, `0001_extensions_and_enums.sql:27`, re-derived at the
 * migration rather than carried from ADR-287.
 *
 * THE ENUM HAS EXACTLY THREE MEMBERS AND NO MIGRATION ALTERS IT: a recursive
 * read of `packages/db/migrations` for `ALTER TYPE identity_status` returns
 * nothing, and `identities.status` is `identity_status NOT NULL DEFAULT
 * 'active'` (`0002_identity.sql:42`). So this list and `IdentityStatus`
 * (`routes/payouts.ts`) transcribe one column, and a value outside it is a
 * database this code does not recognise rather than a case to handle.
 */
const IDENTITY_STATUSES: readonly IdentityStatus[] = ['active', 'restricted', 'closed'];

/** The accessor hands back `unknown`. This is the narrowing, not a cast. */
function asRow(value: unknown, table: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new PayoutRowError(`a scoped read of \`${table}\` returned something that is not a row`);
  return value as Record<string, unknown>;
}

/** One `NOT NULL` text column, or a refusal naming what was read. */
function text(row: Record<string, unknown>, column: string, table: string): string {
  const value = row[column];
  if (typeof value !== 'string')
    throw new PayoutRowError(
      `\`${table}.${column}\` did not read back as text. It is \`NOT NULL\` in the schema that ` +
        'wrote it, so an absent value is a row this code does not recognise and never a value ' +
        'to substitute for',
    );
  return value;
}

/** One member of a closed enum, or a refusal naming what was read. */
function member<T extends string>(
  row: Record<string, unknown>,
  column: string,
  table: string,
  allowed: readonly T[],
): T {
  const value = row[column];
  if (typeof value !== 'string')
    throw new PayoutRowError(`\`${table}.${column}\` did not read back as text`);
  if (!(allowed as readonly string[]).includes(value))
    throw new PayoutRowError(
      `\`${table}.${column}\` is \`${value}\`, which is outside the enum's own members ` +
        `(${allowed.join(' | ')}). A value outside them is a REFUSAL and never a default: ` +
        'ADR-041 refused a fourth so that a fourth arriving later fails closed on this door',
    );
  return value as T;
}

/** One nullable text column, kept nullable. `kyc_verifications.supersedes`. */
function textOrNull(row: Record<string, unknown>, column: string, table: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string')
    throw new PayoutRowError(
      `\`${table}.${column}\` read back as a ${typeof value} and the column is a nullable text`,
    );
  return value;
}

/**
 * One `boolean NOT NULL` column, or a refusal naming what was read.
 *
 * IT DOES NOT COERCE, AND ON THIS DOOR THAT IS THE WHOLE POINT. Every flag this
 * reads is an `R-41` VETO: a truthy string read as `true` is a veto firing on
 * the wrong account, and a falsy one is a veto that never fires at all.
 * `eligible-next-7d.ts`'s `flag` states the same rule one read over.
 */
function flag(row: Record<string, unknown>, column: string, table: string): boolean {
  const value = row[column];
  if (typeof value !== 'boolean')
    throw new PayoutRowError(
      `\`${table}.${column}\` read back as ${JSON.stringify(value)} and the column is a ` +
        '`boolean NOT NULL`. It is an R-41 veto, and a coerced one is a veto that fires on the ' +
        'wrong account or never fires at all',
    );
  return value;
}

/**
 * One `bigint NOT NULL` money column, AS A VALUE RATHER THAN AS A COLUMN OF A
 * BAG, because the typed catalogue door hands back a row and not a bag.
 *
 * **IT IS CHECKED AT RUN TIME EVEN WHERE `tsc` ALREADY SAYS `bigint`, AND THAT
 * IS ADR-303's OWN LIMIT 1 RATHER THAN CAUTION.** `CatalogRow<K>` is derived
 * from `schema.ts`, which is a TRANSCRIPTION of the DDL, and ADR-112 foreclosure
 * 4 records that nothing in this tree compares a transcribed column TYPE against
 * the migration that declares it. That door's own docblock states the rule this
 * function keeps: "a caller that reads money off one of these rows still checks
 * the value it read".
 *
 * **AND IT DOES NOT COERCE.** `INV-02` is that money is `bigint` integer cents
 * AT EVERY BOUNDARY, and a `number` arriving on a payout basis has already been
 * through a float. `routes/catalog.ts`'s `cents` states the same rule one read
 * over, on the same table.
 */
function centsOf(value: unknown, at: string): bigint {
  if (typeof value !== 'bigint')
    throw new PayoutRowError(
      `\`${at}\` did not read back as a bigint. Money is integer cents at every boundary ` +
        '(INV-02), and a money column that arrives as anything else has already lost precision ' +
        'somewhere. It is refused rather than coerced, because a coerced payout basis is a ' +
        'number nobody published',
    );
  return value;
}

/**
 * One NULLABLE `bigint` money column, KEPT NULLABLE.
 *
 * **THE NULL IS A VALUE AND NEVER A ZERO**, and `0004_catalog.sql` says why on
 * the column this reads most often: "Null on Direct: there is no evaluation, so
 * there is no profit target. A ZERO HERE WOULD BE A TARGET OF ZERO, which is a
 * different and reachable thing." `resolveProfitTarget` in the engine refuses
 * the null where the eval phase is enabled, on `CV-03`, and that refusal is only
 * reachable if this reader hands the null through unchanged.
 */
function centsOrNullOf(value: unknown, at: string): bigint | null {
  if (value === null || value === undefined) return null;
  return centsOf(value, at);
}

/**
 * One `boolean NOT NULL` column of the typed catalogue row, uncoerced.
 *
 * `floor_lock_enabled` is MATERIALIZED from `plan_versions.rules` because a
 * CHECK constraint cannot read another table (`schema.ts`), and `SD-10`'s trio
 * is complete exactly when it is true. A truthy string read as `true` here is a
 * floor lock this plan never published.
 */
function boolOf(value: unknown, at: string): boolean {
  if (typeof value !== 'boolean')
    throw new PayoutRowError(
      `\`${at}\` read back as ${JSON.stringify(value)} and the column is a \`boolean NOT ` +
        'NULL`. It is `SD-10`s materialized flag and a coerced one is a floor lock nobody ' +
        'published',
    );
  return value;
}

/** One `text NOT NULL` column of the typed catalogue row. */
function textOf(value: unknown, at: string): string {
  if (typeof value !== 'string')
    throw new PayoutRowError(
      `\`${at}\` did not read back as text. It is \`NOT NULL\` in the schema that wrote it`,
    );
  return value;
}

/**
 * `PayoutSubject.state`. ADR-287 SLICE 5, AND IT READS RATHER THAN FOLDS.
 *
 * **THE TWO CONSTRAINTS ON THIS BODY ARE RULED AND ARE NOT PREFERENCES.**
 * `PayoutSubject.state`'s docblock (`routes/payouts.ts`) requires a backend
 * implementing `subject()` to CALL `ruleStateOn` (`./rule-state-reader.ts`) and
 * NOT to fold a state in the request path, on `INV-M5-02` and ADR-239: the API
 * reads the state the WORKER wrote. **A REQUEST-PATH FOLD IS THE DIVERGENCE
 * ADR-026 `C-07`'s `state_hash` EXISTS TO MAKE DETECTABLE**, computed on the one
 * path no replay audit reads, so a fold here would be a payout basis that looks
 * identical to the stored one and agrees with nothing. And the day is
 * `ScopedTx.lastClosedTradingDay()` on ADR-268 and never a calendar folded here.
 *
 * **THE DAY IS READ BEFORE THE ROWS, AND `R-06` IS WHY RATHER THAN STYLE.** "No
 * endpoint may evaluate eligibility against anything other than the last closed
 * day, whatever the batch is doing at the time." The day SELECTS the row, so it
 * is asked for first and there is no arm here that picks a row and then names
 * the day it came from. `ruleStateOn` has no `latest` function for the same
 * reason and its header says so.
 *
 * **BOTH READS ARE ON THIS TRANSACTION AND NEITHER OPENS A SECOND DOOR.**
 * `ruleStates` is scope class `derived` via `accounts` on `account_id`
 * (`packages/db/src/scope.ts`), so the rows are one hop out on the handle the
 * account was already resolved on; `lastClosedTradingDay()` runs on the same
 * `source` and its own docblock states the reason: a day read on a second
 * connection is a basis day the transaction recording the payout never saw.
 *
 * **THE PREDICATE IS `{ accountId }` AND THE DAY IS `ruleStateOn`'s ARGUMENT,
 * WHICH IS `eligible-next-7d.ts`'s CALL UNCHANGED.** That reader makes the same
 * call one door over in this same deployable, and the selection belongs to the
 * function that owns `R-06` rather than to a predicate stated beside it. The
 * duplicate-row refusal `rule_states_account_day_uq` backstops is a property of
 * the SET on that day, and it is that function's to raise.
 *
 * @throws RuleStateAbsent from the reader, UNCAUGHT ON PURPOSE, and its escape
 * is ORDERED rather than merely permitted. ADR-285 ruling 4: the ownership
 * answer is FIRST, so this leg runs only for an account the handle can already
 * see and a prober naming another identity's account meets section 1's 404
 * rather than the 503 an unfolded day earns. `decidePayout`'s caller catches
 * this class and answers `stateNotFolded`; `RuleStateUnreadable` is deliberately
 * not caught anywhere and stays a 500.
 *
 * @throws Error from `lastClosedTradingDay()` on an empty, exhausted or holed
 * calendar. `ADR-042` F-4 is that an uncovered day is UNKNOWN rather than a
 * holiday, and `PayoutSubject.state`'s own docblock already rules where that
 * lands: "the refusal reaches this route as a throw inside the payout
 * transaction, which rolls back". Not a `PayoutBackendUnwired`, so it is a 500.
 */
async function stateLeg(handle: ScopedTx, accountId: string): Promise<RuleState> {
  const tradingDay = await handle.lastClosedTradingDay();
  const stateRows = await handle.rowsWhere('ruleStates', { accountId });
  return ruleStateOn(stateRows, accountId, tradingDay);
}

/**
 * `PayoutSubject.plan`, WHOLE. ADR-287 SLICES 4 AND 5.
 *
 * **THE BLOB HALF IS ADR-283's AND THE SIZE HALF IS THIS ROW'S.**
 * `plan_versions.rules` is decoded by the ENGINE's `decodePlanRules`, because
 * `PayoutSubject.plan`'s own docblock forbids a fourth transcription of that
 * blob in this deployable (`FM-16` on the money path, ADR-269's refusal one port
 * over). `plan_version_sizes` is read at the account's OWN size and mapped onto
 * the engine's `PlanVersionSizeRow` below, and `resolvePlan` is then the one
 * function that turns the pair into a `ResolvedPlan`.
 *
 * **WHAT MADE THE SIZE HALF BUILDABLE IS A DOOR AND NOT A RULING.** ADR-286
 * ruling 4 measured that the payout path is on the DRIVER side of the two
 * spellings and needs no rename from anybody, and its section 5 named the
 * remedy: "`packages/db` handing out a typed catalogue row instead of
 * `unknown` ... whoever takes it is amending a door, not writing a decoder".
 * ADR-303 took it. So `catalogRowAt` returns `CatalogRow<'planVersionSizes'>`,
 * every property below is checked by `tsc` against `schema.ts`, and a key that
 * does not exist is `TS2339` rather than a runtime throw on a money read.
 *
 * **THE RUNTIME CHECKS DO NOT COME OFF ON THE STRENGTH OF THAT TYPE, AND THAT
 * IS ADR-303's OWN LIMIT 1.** `CatalogRow<K>` is derived from a TRANSCRIPTION of
 * the DDL and nothing in this tree compares a transcribed column type against
 * the migration. `centsOf` is the check the door's docblock requires of a caller
 * that reads money off one of these rows.
 *
 * **THE MAPPING IS AN ACCEPTED `FM-16` AND IS REGISTERED RATHER THAN HIDDEN.**
 * ADR-303 limit 2 states it: the typed row is not a decoder, it SHRINKS one, and
 * a driver-side caller still writes a field mapping onto the engine's row type
 * once per caller. `toSizeRow` (`apps/worker/src/batch/adapter.ts`) is the same
 * mapping and `apps/api` cannot import `apps/worker`, which is exactly the shape
 * `rule-state-reader.ts` registers in its own header for `toRuleState`. **THE
 * ONE PART THAT IS NOT DUPLICATED IS THE `jsonb`**: `decodeCapScheduleCents` is
 * the engine's single statement of it since ADR-302, and this is its fourth
 * caller rather than a fourth statement.
 *
 * **SIX COLUMNS ARE NOT READ AND THEIR ABSENCE IS THE ENGINE'S RULE RATHER THAN
 * AN OVERSIGHT.** `price_cents` and `reset_price_cents` are columns and
 * `types.ts` says why they are absent from `PlanVersionSizeRow`: no `CV-nn`
 * mentions either, no rule reads a price, and M01 section 1.2 puts commerce
 * outside the engine, so a reader that could see the price could grow a rule
 * about it. `id`, `created_at` and the account's own `size_cents` echo are the
 * database's.
 *
 * @throws PlanRulesCodecError and CapScheduleCodecError from the engine,
 * UNCAUGHT ON PURPOSE. Neither is a `PayoutBackendUnwired`, so a stored document
 * this build cannot read is a 500 rather than a retryable 503: a `rules` blob or
 * a cap schedule that disagrees with the codec that reads it is Merit's records
 * disagreeing with Merit's engine, and no retry fixes it.
 */
async function planLeg(handle: ScopedTx, account: Record<string, unknown>): Promise<ResolvedPlan> {
  const planVersionId = text(account, 'planVersionId', 'accounts');
  const sizeCents = centsOf(account['sizeCents'], 'accounts.size_cents');

  const version = await handle.catalogRowAt('planVersions', { id: planVersionId });
  if (version === undefined)
    throw new PayoutRowError(
      `\`accounts.plan_version_id\` names \`${planVersionId}\` and \`plan_versions\` carries no ` +
        'such row on this transaction. The column is `uuid NOT NULL REFERENCES plan_versions` ' +
        '(`0007_accounts.sql`), so an empty read is the catalogue disagreeing with the account ' +
        'rather than a version to substitute for',
    );
  const rules = decodePlanRules(version.rules, `plan_versions[${planVersionId}].rules`);

  // **THE ADDRESS IS THE GRID'S OWN UNIQUE KEY AND NOT A FILTER.**
  // `plan_version_sizes_version_size_uq` is `(plan_version_id, size_cents)`
  // (`0004_catalog.sql`, transcribed at `schema.ts`), so this names AT MOST ONE
  // ROW and `refuseUnaddressed` is what enforces that rather than this comment.
  const size = await handle.catalogRowAt('planVersionSizes', { planVersionId, sizeCents });

  // **AN ABSENT SIZE ROW IS A REFUSAL, AND THIS IS THE RULE ADR-306 NAMED AS
  // UNWRITTEN.** There is NO composite foreign key from `accounts` to this grid:
  // `0007_accounts.sql` declares `plan_version_id uuid NOT NULL REFERENCES
  // plan_versions(id)` and `size_cents bigint NOT NULL CHECK (size_cents > 0)`
  // as two independent columns, and `0044` states in its own words that a
  // `size_cents` "names a plan_version_sizes.size_cents; it is not a foreign key
  // to that row". So the pair CAN fail to resolve, and when it does it is Merit's
  // account disagreeing with Merit's catalogue.
  //
  // IT IS A `PayoutRowError` AND SO A 500, WHICH IS THE READ ABOVE IT ANSWERED
  // THE SAME WAY. An account pinned to a size its own plan version does not
  // publish has no drawdown, no buffer and no payout ceiling anywhere in this
  // database; there is no neighbouring row to fall back to, because a grid is
  // not an interpolation, and picking one would hand a trader a floor rule
  // nobody published. A 503 would tell them to retry what no retry can fix.
  if (size === undefined)
    throw new PayoutRowError(
      `\`plan_version_sizes\` carries no row at version \`${planVersionId}\` and size ` +
        `${String(sizeCents)} cents on this transaction, and the account is pinned to both. ` +
        'There is no composite foreign key holding the pair together (`0007_accounts.sql`), so ' +
        'this is the catalogue disagreeing with the account rather than a size to substitute ' +
        'for: no neighbouring rung is this rung, and a payout resolved against one would be ' +
        'decided on a plan nobody published',
    );

  const at = `plan_version_sizes[${planVersionId}:${String(sizeCents)}]`;
  const sizeRow: PlanVersionSizeRow = {
    // **THE IDENTITY IS CARRIED AND NEVER CHOSEN, WHICH IS `INV-16` IN THE
    // SIGNATURE.** `ResolvedPlan.planVersionId` is `size.plan_version_id` inside
    // `resolvePlan`, so it is read off THE ROW here rather than handed the local
    // above it: the address makes the two equal and the engine's rule is that
    // the value travels with the row it came from. The brand is asserted at this
    // one boundary, exactly as `toSizeRow` asserts it one deployable over.
    plan_version_id: textOf(
      size.planVersionId,
      `${at}.planVersionId`,
    ) as PlanVersionSizeRow['plan_version_id'],
    size_cents: centsOf(size.sizeCents, `${at}.sizeCents`),
    drawdown_cents: centsOf(size.drawdownCents, `${at}.drawdownCents`),
    profit_target_cents: centsOrNullOf(size.profitTargetCents, `${at}.profitTargetCents`),
    buffer_cents: centsOf(size.bufferCents, `${at}.bufferCents`),
    win_day_floor_cents: centsOf(size.winDayFloorCents, `${at}.winDayFloorCents`),
    // THE ENGINE'S CODEC AND NOT A FOURTH STATEMENT OF IT. ADR-286 ruling 5
    // measured this blob as the one real `FM-16` in this area, at three
    // statements that had already diverged on the money; ADR-302 collapsed them
    // into `decodeCapScheduleCents`, which admits a safe-integer JSON number or
    // a base-10 string of digits and REFUSES a number past
    // `Number.MAX_SAFE_INTEGER` rather than handing back the rounded double.
    payout_cap_schedule_cents: decodeCapScheduleCents(
      size.payoutCapScheduleCents,
      `${at}.payoutCapScheduleCents`,
    ),
    daily_loss_limit_cents: centsOrNullOf(size.dailyLossLimitCents, `${at}.dailyLossLimitCents`),
    floor_lock_enabled: boolOf(size.floorLockEnabled, `${at}.floorLockEnabled`),
    floor_lock_at_profit_cents: centsOrNullOf(
      size.floorLockAtProfitCents,
      `${at}.floorLockAtProfitCents`,
    ),
    floor_lock_floor_at_cents: centsOrNullOf(
      size.floorLockFloorAtCents,
      `${at}.floorLockFloorAtCents`,
    ),
  };

  // THE RESOLVER IS THE ENGINE'S AND APPLIES NO PERCENTAGE, which is its own
  // stated discipline: every `_bp` field is read for STRUCTURE and every cents
  // value is COPIED from the size row, so the marketing page and the engine
  // agree to the cent. Nothing in this file multiplies a money value by a rate.
  return resolvePlan(rules, sizeRow);
}

/**
 * `PayoutSubject.gates`. ADR-287 SLICE 4, AND IT ANSWERS.
 *
 * **THE RESOLVER IS THE ENGINE'S AND THE READINGS ARE NOT REPEATED HERE.**
 * `PayoutSubject.gates`'s docblock requires a backend to call
 * `resolveExternalGates` and not to write the record out, and `external-gates.ts`
 * says why in its own words: every member handed over is the RAW column, because
 * a narrowing here would be a second place the seven-versus-six
 * `accounts.status` question is answered. `eligible-next-7d.ts`'s `gatesOf` is
 * the same call one door over and this body is deliberately its shape.
 *
 * **THE KYC READ IS THE WHOLE CHAIN AND NOT THE HEAD.** `SD-M19-01` makes a
 * re-verification a NEW ROW pointing at the one it supersedes, so the head is a
 * property of the SET and cannot be addressed. **THE PAYOUT READ IS EVERY ROW
 * AND THE STATUS FILTER IS THE ENGINE'S**: a filter here would be another copy
 * of `payout_requests_no_in_flight_uq`'s predicate with nothing comparing it.
 *
 * **NEITHER READ NAMES A TENANCY COLUMN AND NEITHER NEEDS TO.**
 * `kycVerifications` and `payoutRequests` are both scope class `owned` on
 * `identity_id` (`packages/db/src/scope.ts`), so the handle's own predicate is
 * the identity conjunct; `rowsWhere('payoutRequests', { accountId })` narrows to
 * the SUBJECT ACCOUNT and nothing else. `identities` is `root` on `id`, so
 * `rows('identities')` is the caller's own row, which is `identityStatus`'s
 * argument unchanged.
 *
 * **THE IDENTITY ROW IS READ AGAIN RATHER THAN CARRIED FROM `identityStatus()`.**
 * That member's docblock forbids memoisation for ADR-140's ordering reason, and
 * a value cached across two members would make the order an accident of which
 * one ran first. Two reads of one row inside one transaction is the cheap half
 * of that trade.
 *
 * @throws ExternalGatesRefusal from the engine, UNCAUGHT ON PURPOSE. It is not a
 * `PayoutBackendUnwired`, so `unwiredOrThrow` rethrows it and the route answers
 * 500 rather than 503: a column outside its own enum is Merit's records
 * disagreeing with Merit's schema, which no retry fixes. `R-41` conjoins all
 * five gates as vetoes, so a defaulted leg is either a veto that never fires or
 * one that denies an eligible trader while reading as a working gate.
 */
async function externalGatesFor(
  handle: ScopedTx,
  accountId: string,
  account: Record<string, unknown>,
): Promise<ExternalGates> {
  const identities = await handle.rows('identities');
  const identity = identities[0];
  if (identities.length !== 1 || identity === undefined)
    throw new PayoutRowError(
      `a scoped read of \`identities\` returned ${String(identities.length)} rows. The rule is ` +
        "`root` on `id`, so it returns the caller's own row and exactly one",
    );

  const kycChain = (await handle.rows('kycVerifications')).map((value, index) => {
    const at = `kyc_verifications[${String(index)}]`;
    const row = asRow(value, at);
    return {
      id: text(row, 'id', at),
      state: text(row, 'state', at),
      supersedes: textOrNull(row, 'supersedes', at),
    };
  });

  const payoutRequestStatuses = (await handle.rowsWhere('payoutRequests', { accountId })).map(
    (value, index) => {
      const at = `payout_requests[${String(index)}]`;
      return text(asRow(value, at), 'status', at);
    },
  );

  return resolveExternalGates({
    accountId,
    accountStatus: text(account, 'status', 'accounts'),
    identityPayoutsFrozen: flag(asRow(identity, 'identities'), 'payoutsFrozen', 'identities'),
    accountPayoutsFrozen: flag(account, 'payoutsFrozen', 'accounts'),
    reconBlocked: flag(account, 'reconBlocked', 'accounts'),
    kycChain,
    payoutRequestStatuses,
  });
}

// -----------------------------------------------------------------------------
// `listPayouts`. ADR-287 SLICE 7, AND THE COUNT IS TEN, EIGHT AND TWO
// -----------------------------------------------------------------------------
// `PayoutListItem` (`routes/payouts.ts`) declares TEN fields, one per line.
// EIGHT resolve off columns of `payout_requests` and TWO have no column at all,
// and ADR-311 re-derived that from the declaration and the DDL rather than
// carrying ADR-290's number: `0010_payouts.sql:42-124` declares TWENTY-FOUR
// columns, `0031_payout_hold_and_identity_restriction.sql:46-52` adds FIVE, and
// `grep -rn 'ALTER TABLE payout_requests' packages/db/migrations` returns those
// two lines and no others. TWENTY-NINE, and neither `failure_note` nor any
// history column is among them.
//
// THE TWO WITHOUT COLUMNS ARE SERVED AS RULED ABSENCES AND ARE NOT SYNTHESISED,
// WHICH IS THE WHOLE REASON THIS MEMBER NEEDED A RULING BEFORE IT NEEDED CODE.
// `failure_note` is `null` on every row and `timeline` is `[]` on every row, and
// in both cases API_CONTRACT section 6 states it in its own words, so this file
// TRANSCRIBES a decision rather than making one. An implementer who reached for
// the obvious value in either place would have shipped something worse than
// nothing, and ADR-290 sections 2 and 3 are why:
//
//   `failure_note` DESCRIBES `failed` AND NOTHING ELSE, and both edges into that
//   status are enforcement acts. It is null BY CONSTRUCTION rather than by
//   omission: no `payout_requests` row on this tree can reach `failed`. The
//   three candidate suppliers are each refused in writing, and the nearest one,
//   `admin_actions.reason`, is refused because API_CONTRACT section 6 excludes
//   admin reasoning from every trader projection IN TERMS and the portal renders
//   this field VERBATIM. A note composed for an audit trail would reach a trader
//   unedited, beside a closure for cause.
//
//   `timeline`'s SOURCE IS `events` (`0017_events_and_audit.sql:26-62`),
//   projected on `subject_kind = 'payout_request'` and `subject_id`, AND THAT
//   PROJECTION IS EMPTY: no deployable in this tree constructs an event writer,
//   so `[]` is what the named source returns rather than a placeholder standing
//   in for it. THIS MEMBER DOES NOT QUERY `events`, deliberately: a query
//   against a relation nothing writes, carrying a name-to-state mapping nobody
//   ruled, is code that has never once been true and that no seeded test can
//   exercise honestly.
//
// AND THE FOLD OVER THIS TABLE'S OWN TIMESTAMPS IS REFUSED, WHICH IS THE ONE AN
// IMPLEMENTER WOULD HAVE REACHED FOR FIRST. `payout_requests` carries four state
// timestamps and looks like a history. TWO OF THE FOUR ARE NULLED BY CONSTRAINT
// ON EXIT: `payout_requests_hold_is_complete` (`0031:62-72`) and
// `payout_requests_freeze_is_complete` (`0010:141-149`) are biconditionals on
// their statuses, so a settled payout that was held for forty hours folds to a
// two-entry timeline WITH NO HOLD IN IT, rendered as if it were complete. A
// partial history that reads as a complete one is worse than an empty one, and
// the trader it hides the hold from is the trader who was held.

/**
 * `payout_status`, transcribed at the two migrations that declare it.
 *
 * FOUR MEMBERS AT `0001_extensions_and_enums.sql:91`, which ADR-028 ruled, AND
 * A FIFTH AT `0030_payout_hold_enum.sql:57`, which is the `ALTER TYPE` ADR-040
 * added for `held_pending_review`. FIVE, and `PayoutListItem.status`'s own union
 * is the same five.
 *
 * A VALUE OUTSIDE THEM IS A REFUSAL AND NEVER A DEFAULT, and the direction
 * matters on this read rather than only in principle: `status` selects whether
 * `approved_at` is suppressed and whether the `hold` block is served, so a
 * status this code does not recognise is a row whose two conditional fields
 * cannot be decided at all. It is not `identity_status`'s reader, because that
 * one's refusal cites ADR-041 and this enum's history is ADR-028's.
 */
const PAYOUT_STATUSES = [
  'approved',
  'held_pending_review',
  'settled',
  'failed',
  'frozen',
] as const satisfies readonly PayoutListItem['status'][];

/** One member of `payout_status`, or a refusal naming what was read. */
function payoutStatusOf(row: Record<string, unknown>, at: string): PayoutListItem['status'] {
  const value = row['status'];
  if (typeof value !== 'string')
    throw new PayoutRowError(
      `\`${at}.status\` did not read back as text. The column is \`payout_status NOT NULL\``,
    );
  if (!(PAYOUT_STATUSES as readonly string[]).includes(value))
    throw new PayoutRowError(
      `\`${at}.status\` is \`${value}\`, which is outside \`payout_status\`'s own members ` +
        `(${PAYOUT_STATUSES.join(' | ')}). The status decides whether \`approved_at\` is ` +
        'suppressed and whether the `hold` block is served, so an unrecognised one is a row ' +
        'whose two conditional fields cannot be decided rather than a case to default',
    );
  // The narrowing `includes` does not perform, on `member`'s own idiom above.
  // It is reached only past the guard, so it asserts nothing the line before it
  // has not already refused.
  return value as PayoutListItem['status'];
}

/**
 * One `timestamptz` as API_CONTRACT section 1's RFC 3339 UTC string.
 *
 * IT DOES NOT PARSE A STRING, which is where this differs from
 * `admin-source/events.ts`'s reader one door over. That one accepts either
 * because its port is fed by an admin projection; this one reads the driver
 * directly, where `schema.ts` declares every one of these columns as
 * `timestamp(..., { withTimezone: true })` and the driver hands back a `Date`.
 * A string arriving here is the driver configured differently from the schema
 * this code was written against, and coercing it would hide that.
 */
function instant(value: unknown, at: string): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    throw new PayoutRowError(
      `\`${at}\` is not a Date. The column is a \`timestamptz\`, and a value that is not one ` +
        "cannot be rendered as API_CONTRACT section 1's RFC 3339 UTC string",
    );
  return value.toISOString();
}

/** One NULLABLE `timestamptz`, KEPT NULLABLE. The null is a value. */
function instantOrNull(value: unknown, at: string): string | null {
  return value === null || value === undefined ? null : instant(value, at);
}

/**
 * Section 6's `hold` block, and THE PREDICATE IS TWO SIDED ON PURPOSE.
 *
 * It matches `payout_requests_hold_is_complete` (`0031:62-72`), which is a
 * BICONDITIONAL on `status = 'held_pending_review'`: all five hold columns are
 * NOT NULL on that status and NULL on every other. So a row that is half of
 * either arm is refused here rather than served, in both directions. Serving one
 * direction only would publish a hold the database has already erased, or drop
 * one it says must be there.
 *
 * API_CONTRACT:517 puts the block on that status alone and the wire's own null
 * arm agrees with the constraint without anybody deciding anything, which is the
 * only field of the ten where that is true.
 *
 * THREE OF THE FIVE HOLD COLUMNS ARE READ AND TWO ARE NOT. `hold_flag_id` and
 * `hold_reason` have no slot on `PayoutHold`, and API_CONTRACT section 6 is why
 * rather than an oversight: the trader is shown the fact, the ToS clause and the
 * date it resolves, NEVER the evidence and NEVER the detector.
 */
function holdOf(
  row: Record<string, unknown>,
  status: PayoutListItem['status'],
  at: string,
): PayoutHold | null {
  const heldAt = row['heldAt'];
  const expiresAt = row['holdExpiresAt'];
  const tosClause = row['holdTosClause'];
  const present = (value: unknown): boolean => value !== null && value !== undefined;

  if (status !== 'held_pending_review') {
    if (present(heldAt) || present(expiresAt) || present(tosClause))
      throw new PayoutRowError(
        `\`${at}\` is in status \`${status}\` and carries a hold column. ` +
          '`payout_requests_hold_is_complete` (`0031:62-72`) is a biconditional, so every hold ' +
          'column is NULL off `held_pending_review` and a row carrying one is a row the schema ' +
          'says cannot exist',
      );
    return null;
  }

  if (typeof tosClause !== 'string')
    throw new PayoutRowError(
      `\`${at}.hold_tos_clause\` did not read back as text on a \`held_pending_review\` row. ` +
        'The same biconditional makes all five hold columns NOT NULL on that status, so an ' +
        'absent one is a row this code does not recognise and never a value to substitute for',
    );

  return {
    held_at: instant(heldAt, `${at}.held_at`),
    resolves_by: instant(expiresAt, `${at}.hold_expires_at`),
    tos_clause: tosClause,
  };
}

/**
 * One `payout_requests` row as `PayoutListItem`. A spread would be `SELECT *`.
 *
 * `approved_at` IS SUPPRESSED ON `held_pending_review` AND THAT IS ADR-290
 * FINDING `F6` RATHER THAN A PREFERENCE. The column is `timestamptz NOT NULL
 * DEFAULT now()` (`0010:89`) and `0031` relaxed nothing, by its own stated
 * design: adding columns keeps every existing NOT NULL and CHECK on the money
 * table intact. SO A HELD ROW CARRIES A NON-NULL `approved_at` WHOSE VALUE IS
 * THE INSERT TIME AND NOT AN APPROVAL TIME. API_CONTRACT:515 types it
 * `string | null` and says "null while held: the hold is PRE-approval", which
 * the declaration's own docblock repeats. A straight column read publishes a
 * false approval time on the one state that most needs to render correctly.
 *
 * `settled_at` IS CHECKED PRESENT ON `settled` AND NOT ON ANY OTHER STATUS,
 * which is `payout_requests_settled_has_days` (`0010:152-157`) read in the one
 * direction it actually runs. The constraint is an implication and not a
 * biconditional, so the reverse is not asserted here either.
 *
 * MONEY GOES THROUGH `centsOf` AND THEN `centsToJson`, AND NEITHER STEP IS
 * DECORATION. The first refuses a column that did not arrive as a `bigint`,
 * because `INV-02` is that money is integer cents at every boundary and a
 * `number` on a payout basis has already been through a float. The second
 * refuses past `Number.MAX_SAFE_INTEGER` rather than serialising a wrong one.
 * There is no `Number()` on this path.
 */
function toPayoutListItem(value: unknown, index: number): PayoutListItem {
  const at = `payout_requests[${String(index)}]`;
  const row = asRow(value, at);
  const status = payoutStatusOf(row, at);

  const settledAt = instantOrNull(row['settledAt'], `${at}.settled_at`);
  if (status === 'settled' && settledAt === null)
    throw new PayoutRowError(
      `\`${at}\` is in status \`settled\` and \`settled_at\` read back empty. ` +
        '`payout_requests_settled_has_days` (`0010:152-157`) makes it NOT NULL on that status, ' +
        'so an absent settlement time is a row the schema says cannot exist',
    );

  return {
    payout_request_id: text(row, 'id', at),
    account_id: text(row, 'accountId', at),
    approved_cents: centsToJson(centsOf(row['approvedCents'], `${at}.approved_cents`)),
    trader_cents: centsToJson(centsOf(row['traderCents'], `${at}.trader_cents`)),
    status,
    approved_at:
      status === 'held_pending_review' ? null : instant(row['approvedAt'], `${at}.approved_at`),
    settled_at: settledAt,
    hold: holdOf(row, status, at),

    // ADR-290 section 3.6 and API_CONTRACT section 6. THE LITERAL IS THE
    // PROJECTION OF `events` AND NOT A DEFAULT: that relation has no producer in
    // this tree, so the empty array is what its named source returns. When a
    // producer lands, this reads it and the ruling is spent.
    timeline: [],

    // ADR-290 section 2.5 and API_CONTRACT section 6. NULL BY CONSTRUCTION AND
    // NOT BY OMISSION: no row this endpoint can return is in `failed`, which is
    // the only status the field describes. The column it is owed is specified in
    // ADR-290 section 2.4 and not written, and so is the endpoint field that
    // would supply it.
    failure_note: null,
  };
}

/**
 * The store this backend does NOT install.
 *
 * `UNWIRED_PAYOUT_BACKEND`'s own store, restated here rather than imported
 * because `routes/payouts.ts` keeps it module-private. The three method names
 * are spelled into the error the way that file spells them, so a 503 names the
 * member a reader can go and look at.
 */
const UNWIRED_STORE: IdempotencyStore = {
  find: () => Promise.reject(new PayoutBackendUnwired('idempotency.find')),
  begin: () => Promise.reject(new PayoutBackendUnwired('idempotency.begin')),
  complete: () => Promise.reject(new PayoutBackendUnwired('idempotency.complete')),
};

/**
 * The postgres `PayoutBackend`. Six members answer and two refuse.
 *
 * THE `db` IS A PARAMETER AND NOT `LIVE_DB` REACHED FOR, on
 * `databaseAuthBackend`'s and `databaseWithdrawalBackend`'s shape: the door is
 * handed in, so the suite drives this adapter against a recorder and slice 9
 * hands it the live one in the one file that composes the deployable.
 */
export function postgresPayoutBackend(db: ApiDb): PayoutBackend {
  return {
    /**
     * ONE TRANSACTION, AND IT IS THE ONE EVERY LATER SLICE READS ON.
     *
     * THE IDENTITY IS BOUND ONCE, FROM THE SESSION, AND `PayoutTx` CARRIES NO
     * IDENTITY PARAMETER BECAUSE OF IT. That is the port's own docblock relied
     * on rather than restated: a member taking an account id could be handed one
     * the caller does not own, and a scoped read of a foreign account's rows is
     * EMPTY, which is how `subject()` returning `null` becomes section 1's 404.
     *
     * IT COMMITS ONLY IF `fn` RETURNS, and that is `packages/db`'s property
     * rather than one restated here: `db.scoped` is `transaction(scopedDb(id))`,
     * which issues `BEGIN`, `ROLLBACK`s on a throw without replacing the error
     * that caused it, and `COMMIT`s on the one path where `fn` returned
     * (`packages/db/src/scoped-db.ts`). This file adds no second commit rule.
     *
     * NO SECOND UUID PREDICATE. `db.scoped` refuses a non-uuid before the
     * accessor with `DbDoorError`, and a check here would be a second statement
     * of one fact on the money path.
     *
     * NO LOCK IS TAKEN HERE, AND THAT IS NOW A DECISION RATHER THAN A REPORT.
     * ADR-293 section 3.5 ruled that the payout path DOES take the per-identity
     * lock, and that it takes it the way both existing precedents do: as a port
     * member the DECISION FUNCTION calls, never as a line inside `transact`.
     * `decideWithdrawal` takes `await tx.lockScope()` as its first statement
     * (`routes/wallet-withdrawals.ts`) and `checkout.ts`'s handler does the
     * same; a lock hidden in `transact` would put the ordering that makes the
     * gate a control outside the one function a reader checks orderings in.
     *
     * THE SENTENCE THAT STOOD HERE WAS FALSE AND IS CORRECTED RATHER THAN
     * DELETED. It read that `databaseWithdrawalBackend` calls `tx.lockScope()`
     * first. Read at source, that adapter EXPOSES the member and
     * `decideWithdrawal` calls it. ADR-291, row 293 and this file all repeated
     * the imprecise version, which is exactly the class of error
     * `MERIT_BUILD_MASTER_PROMPT`'s "caution learned the hard way" names.
     *
     * AND THE RULED MEMBER IS BUILT NOW, WHICH IS WHERE THIS PARAGRAPH USED TO
     * SAY IT WAS OWED. ADR-301 landed `PayoutTx.lockScope()`, the delegation
     * below it, and the call as `decidePayout`'s first statement, so the
     * read-then-write this file's `insertPayoutRequest` creates is serialised
     * by the lock rather than backstopped by
     * `payout_requests_no_in_flight_uq` alone. ADR-293 section 3.3 measured
     * that index as a BACKSTOP and not the control, in two directions: it
     * turns a contract-specified 409 into a 500, and it is keyed PER ACCOUNT
     * where the exposure question the schema denormalises `identity_id` for is
     * PER IDENTITY. Both directions are the lock's now.
     *
     * THE HANDLE DOES NOT ESCAPE, AND IT IS HELD BY SHAPE RATHER THAN BY A
     * FLAG. `transact` takes the unit of work instead of handing a `PayoutTx`
     * back, which is `ApiDb`'s own property ("a transaction cannot outlive the
     * function that opened it") extended one layer out. A runtime validity flag
     * would be a second mechanism for a thing the signature already carries.
     */
    transact: (session, fn) =>
      db.scoped(session.identityId, (handle) => {
        /**
         * THE ANNOTATION IS LOAD-BEARING AND IS NOT DECORATION.
         *
         * `rule-state-producibility.test.ts` tracks whether anything in this
         * tree implements `PayoutTx` by looking for `: PayoutTx` under a
         * deployable's `src/`, and an implementation the census cannot see is
         * worse than none: `wiring.test.ts`'s clause FIVE would keep reading as
         * live to every grep while being false. Contextual typing alone would
         * check this object just as well and would leave that census blind.
         */
        const tx: PayoutTx = {
          /**
           * `INV-M20-01`'s per-identity lock, and the WHOLE BODY IS THE
           * DELEGATION.
           *
           * IT IS `ScopedTx.lockScope` AND NOTHING ELSE, exactly as
           * `databaseWithdrawalBackend` (`routes/wallet-withdrawals.ts`) writes
           * the same member: the handle is already bound to one identity, the
           * accessor's verb takes no argument, and there is therefore no
           * address anywhere on this path a caller could point at somebody
           * else. An advisory lock through `sqlExecutor` says the same thing
           * without the tenancy conjunct and is refused by name in ADR-157.
           *
           * NOTHING IS DECIDED HERE AND THAT IS THE POINT. `decidePayout` calls
           * this as its first statement and the ORDER is the control; this
           * object only makes the member callable.
           */
          lockScope: async (): Promise<void> => {
            await handle.lockScope();
          },

          /**
           * `identities.status` for the caller. ADR-140's door.
           *
           * READ PER CALL AND NEVER MEMOISED. ADR-287 section 2: an
           * implementation that read the identity row lazily inside
           * `subject()` and cached it would satisfy the type and break
           * ADR-140's ordering, which is `INV-M5-23`'s placement argument.
           * `decidePayout` calls this FIRST, before anything about the account
           * is read, and a cache would make the order an accident of which
           * member ran first.
           *
           * EXACTLY ONE ROW OR IT RAISES. `identities` is scope class `root`
           * on `id` (`packages/db/src/scope.ts`), so this predicate is
           * `identities.id = $1` and the answer is the caller's own row. Zero
           * rows is Merit's records disagreeing with the session it just
           * authenticated, which is not the trader's fault and is not a
           * refusal to hand them.
           */
          identityStatus: async (): Promise<IdentityStatus> => {
            const rows = await handle.rows('identities');
            const row = rows[0];
            if (rows.length !== 1 || row === undefined)
              throw new PayoutRowError(
                `a scoped read of \`identities\` returned ${String(rows.length)} rows. The ` +
                  "rule is `root` on `id`, so it returns the caller's own row and exactly one",
              );
            return member(asRow(row, 'identities'), 'status', 'identities', IDENTITY_STATUSES);
          },

          /**
           * FOUR LEGS OF FOUR (ADR-287 slices 4 AND 5). THE MEMBER ANSWERS.
           *
           * ADR-306 BUILT THREE AND LEFT TWO REFUSING BY NAME, and ADR-308
           * retired both: `state` reads the stored row through `ruleStateOn` and
           * `plan` resolves at the account's own size. **THE `SubjectLeg<T>`
           * SCAFFOLDING WENT WITH THEM AND ITS RULE DID NOT.** That type existed
           * so that an unbuilt leg could refuse by name without ever carrying a
           * partial value; with no unbuilt leg left, its `ok: false` arm had no
           * producer, and a dead union arm on the money path is an invitation to
           * fill one in. What holds the rule now is the return types themselves:
           * `stateLeg` answers `RuleState` or throws and `planLeg` answers
           * `ResolvedPlan` or throws, so there is no shape here that can hold
           * half of either. **A SYNTHESISED `RuleState` IS A PAYOUT BASIS NOBODY
           * COMPUTED**, and that sentence has stood on this member since it was
           * one line of rejection.
           *
           * -------------------------------------------------------------------
           * THE ORDER IS THE CONTROL AND IT IS ADR-285 RULING 4
           * -------------------------------------------------------------------
           * THE OWNERSHIP ANSWER IS FIRST. `accounts` is scope class `owned` on
           * `identity_id`, so a scoped read cannot tell a foreign account from an
           * absent one and `null` is section 1's 404 for both. An implementation
           * that read anything else first would hand a prober a different status
           * for another identity's account than for one that does not exist,
           * which section 1 requires this API not to do. Every read below happens
           * only for an account this handle can already see.
           *
           * **AND THAT IS NOW LOAD BEARING RATHER THAN TIDY, BECAUSE `state` CAN
           * REFUSE.** `ruleStateOn` raises `RuleStateAbsent` for a day the
           * nightly fold has not closed and the route answers it `503`. A
           * state-first implementation would answer a prober `503` for every
           * account of another identity, where a scoped read is empty and an
           * empty list IS `RuleStateAbsent`, and 404 and 503 are
           * distinguishable. Until this row that hazard was hypothetical; from
           * this row it is the read order below.
           *
           * -------------------------------------------------------------------
           * THE `null` ARM IS THE READ ANSWERING EMPTY AND IS NEVER A CATCH
           * -------------------------------------------------------------------
           * `rowAt` answers `undefined` when the scoped predicate matches
           * nothing, and that is the only thing this arm reads. A `null` returned
           * because a LATER read threw would be a 404 for an account that exists,
           * which on this door is telling a trader their funded account is gone.
           */
          subject: async (accountId): Promise<PayoutSubject | null> => {
            const found = await handle.rowAt('accounts', { id: accountId });
            if (found === undefined) return null;
            const account = asRow(found, 'accounts');

            const gates = await externalGatesFor(handle, accountId, account);
            const plan = await planLeg(handle, account);
            const state = await stateLeg(handle, accountId);

            return { accountId, state, plan, gates };
          },

          // ADR-287 slice 8, WHICH CANNOT BE SCHEDULED. `HoldFlag.tosClause`
          // has no value space in this repository and `DEP-M7-05` owes the
          // clauses to counsel; `risk_flags` carries neither `tos_clause` nor
          // `reason` among its seventeen columns. A hold citing a clause Merit
          // has not published is worse than an unwired route.
          holdFlag: () => Promise.reject(new PayoutBackendUnwired('holdFlag')),

          /**
           * ADR-287 slice 6, THE APPROVAL BRANCH AND NOT THE HOLD BRANCH.
           *
           * IT RETURNS NOTHING, AND THE COMMENT THAT USED TO STAND HERE SAID
           * THE OPPOSITE. It read that this member "must return
           * `{ eligibilitySnapshotId }`" and that nothing in this repository
           * supplies one. The second half was true and is why ADR-289 deleted
           * the field from the frozen contract and ruled the member
           * `Promise<void>`; the first half outlived that ruling by two
           * sessions. Corrected where it was made, on ADR-293 section 4D.
           *
           * THE HOLD BRANCH REFUSES AND IS NOT STUBBED. A row carrying a hold
           * is ADR-287 slice 8, WHICH CANNOT BE SCHEDULED: `HoldFlag.tosClause`
           * has no value space in this repository and `DEP-M7-05` owes the
           * clauses to counsel. No clause id is invented here, no enum of
           * clause names is written and no default string is chosen. THE
           * REFUSAL IS `PayoutBackendUnwired` AND SO IT IS A 503, which is the
           * honest answer for an unbuilt member. THE PREDICATE IS TWO SIDED ON
           * PURPOSE, matching `payout_requests_hold_is_complete`
           * (`0031_payout_hold_and_identity_restriction.sql:61-72`): the
           * database admits `hold` present WITH `held_pending_review` or
           * neither, so a row that is half of either is refused here rather
           * than sent to a CHECK constraint to become a 500.
           *
           * `plan_version_id` IS DERIVED AND THAT IS ADR-287 FINDING F3'S OTHER
           * DIRECTION. The column is `uuid NOT NULL REFERENCES plan_versions`
           * (`0010_payouts.sql:68`) and `PayoutRequestInsert` does not carry
           * it, so it is read off `accounts` ON THIS TRANSACTION. THE COPY
           * CANNOT GO STALE, and that is a property the database enforces
           * rather than one this comment hopes for: `0007_accounts.sql:12`
           * states "plan_version_id NEVER CHANGES, for the life of the
           * account" as a numbered property of the table, and
           * `0027_triggers_invariants.sql:272` is the trigger that raises on an
           * attempt to move it. AN ABSENT ACCOUNT ROW IS A REFUSAL AND NEVER A
           * DEFAULT: `accounts` is scope class `owned` on `identity_id`, so a
           * read that returns nothing is either a foreign account or a missing
           * one, and both are conditions under which no payout row may be
           * written.
           *
           * `splitBp` AND `clampReason` ARE NAMED NOWHERE, AND THAT IS ADR-287
           * FINDING F3'S LANDMINE ANSWERED. Neither has a column:
           * `grep -rn split_bp packages/db/migrations` and the same for
           * `clamp_reason` each return ZERO lines. BOTH VALUES ARE ALREADY
           * STORED, inside `eligibilitySnapshot`, which this body passes
           * through untouched into `eligibility_snapshot jsonb NOT NULL`.
           * Writing them anywhere else would state one money fact twice on the
           * money path, and the second statement is the one that can disagree.
           *
           * `identity_id` IS NAMED NOWHERE EITHER, AND THAT IS THE DOOR
           * WORKING. `payout_requests` is scope class `owned` on `identity_id`,
           * and a scoped write STAMPS its tenancy column from the handle:
           * naming it in an insert's values is REFUSED by `packages/db`. Its
           * absence from `PayoutRequestInsert` is not a field somebody forgot.
           *
           * EVERY MONEY FIELD IS PASSED THROUGH AS THE `bigint` IT ARRIVES AS.
           * `Cents` is `bigint` (`@merit/rules-engine`), the four columns are
           * `bigint NOT NULL` in `0010_payouts.sql`, and there is no `Number()`
           * anywhere on this path: a float on the money path is the defect the
           * whole corpus is written against.
           */
          insertPayoutRequest: async (row): Promise<void> => {
            if (row.hold !== null || row.status !== 'approved')
              throw new PayoutBackendUnwired('insertPayoutRequest.hold');

            const account = await handle.rowAt('accounts', { id: row.accountId });
            if (account === undefined)
              throw new PayoutRowError(
                'the `accounts` row this payout is written against reads back empty on this ' +
                  'transaction. The handle is scoped, so that is a foreign account or an absent ' +
                  'one, and `payout_requests.plan_version_id` is `NOT NULL`: there is no value ' +
                  'to write and none to invent',
              );

            await handle.insert('payoutRequests', {
              id: row.id,
              accountId: row.accountId,
              planVersionId: text(asRow(account, 'accounts'), 'planVersionId', 'accounts'),
              requestedCents: row.requestedCents,
              approvedCents: row.approvedCents,
              traderCents: row.traderCents,
              firmCents: row.firmCents,
              basisTradingDay: row.basisTradingDay,
              eligibilitySnapshot: row.eligibilitySnapshot,
              status: row.status,
              idempotencyKey: row.idempotencyKey,
              payoutOrdinal: row.ordinal,
            });
          },
        };
        return fn(tx);
      }),

    /**
     * `GET /payouts`. ADR-287 SLICE 7, AND IT IS THE ONE MEMBER OUTSIDE EVERY
     * WRITE PATH.
     *
     * **IT OPENS ITS OWN DOOR AND IS DELIBERATELY NOT ON `PayoutTx`.** The port
     * declares it on `PayoutBackend` beside `idempotency` rather than inside the
     * transaction, and `readCertificates` (`routes/certificates.ts`) is the same
     * shape one deployable member over: a read that decides nothing has no
     * business inside the transaction that approves payouts, and putting it
     * there would give a list endpoint the lock ordering a write path owns.
     *
     * **THE SCOPE IS THE WHOLE OF THE PREDICATE AND THERE IS NO `WHERE` HERE.**
     * `payoutRequests` is scope class `owned` on `identity_id`
     * (`packages/db/src/scope.ts`), which that registry's own entry argues for
     * on this exact endpoint: `account_id` is present and is NOT the scope,
     * because a derived rule through it would make the payout table's tenancy
     * depend on a join rather than on a column the database declares against
     * `identities(id)`, and a wrong answer here "returns another identity's
     * payout history and, through `hold_flag_id` and `eligibility_snapshot`, the
     * reasons Merit paid or held them". So `rows('payoutRequests')` is the
     * caller's own history across their own accounts and nobody else's, and this
     * member names no identity anywhere for a caller to point at somebody else.
     *
     * **NO ORDER IS APPLIED, AND THAT IS A GAP REPORTED RATHER THAN FILLED.**
     * API_CONTRACT section 6 states no ordering for this endpoint, the accessor
     * has none to give (ADR-112 foreclosure 3 forecloses `ORDER BY` and `LIMIT`
     * on it), and the portal declares that it renders in server order and
     * deliberately does not sort (`apps/portal/src/app/payouts/view.ts`).
     * `readCertificates` serves its list the same way on the same accessor.
     * Choosing a sort key and a tie-break HERE would be this adapter ruling an
     * ordering the frozen contract does not state, on a list whose wire shape
     * carries no ordinal to sort on. ADR-311 raises it to the founder instead.
     */
    listPayouts: (session) =>
      db.scoped(session.identityId, async (handle) =>
        (await handle.rows('payoutRequests')).map(toPayoutListItem),
      ),

    // THE MEMBER THAT COULD ANSWER AND DOES NOT. See the header.
    idempotency: UNWIRED_STORE,
  };
}
