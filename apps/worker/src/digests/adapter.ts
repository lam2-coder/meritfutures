// =============================================================================
// apps/worker/src/digests/adapter.ts
// =============================================================================
// **THE SCHEDULED DIGEST PRODUCER'S ADAPTER, AND IT SERVES FOUR OF SIX.**
//
// `ports.ts` declared {@link DigestIo} with six members and `produce.ts` was
// written against it; `UNWIRED_DIGEST_IO`, whose six members reject, was the
// only inhabitant of that type in this workspace and `schedule.ts` recorded
// exactly that as the delivery row's blocker. This file discharges the four
// that a door and a clock can discharge and REFUSES the two that they cannot,
// each with the blocker named where a reader can check it.
//
// `recon/adapter.ts` is the idiom, one directory over, and every structural
// choice below is transcribed from it rather than invented: the transaction type
// is DERIVED from the door, every filter is rebuilt from column literals in one
// function, an unrecognised or missing column is a THROW, and the door is an
// ARGUMENT so a suite substitutes a recorder.
//
// **NO `SystemReason` MEMBER IS ADDED, NO `SqlExecutorReason` MEMBER IS ADDED,
// `pg` IS NOT IMPORTED, `drizzle-orm` IS NOT IMPORTED, AND NOTHING IS CAST PAST
// A KEY TYPE.** `test/db.test.ts` asserts that exactly one file under this
// deployable's `src/` names `@merit/db` and this file is not it; every
// capability it holds arrives through `../db.ts`.
//
// -----------------------------------------------------------------------------
// 1. THE TWO IT REFUSES, AND THEY ARE REFUSED FOR DIFFERENT KINDS OF REASON
// -----------------------------------------------------------------------------
// **`transport` HAS NO INHABITANT ANYWHERE IN THIS WORKSPACE AND THIS FILE DOES
// NOT WRITE ONE.** `DigestTransport.send` is one method, a census across `apps/`
// and `packages/` finds no value of that type, and there is no mailer, SMS or
// notification package in `packages/`. **THE TWO CHANNELS HAVE DIFFERENT
// BLOCKERS AND COLLAPSING THEM INTO "unwritten" WOULD LOSE THE ONE THAT IS A
// RULING**, so {@link DIGEST_TRANSPORT_BLOCKERS} carries them apart:
//
//   - `sftp` is **UNREACHABLE BY RULING**. `OQ-F3-04` is OPEN and it is the
//     founder's: `M06` section 3.6 and `ADR-066` section 3 both admit SFTP push
//     as SHOULD and both call it **a second credential surface**, which makes
//     "is email alone acceptable for v1" a security question rather than a
//     convenience one. A row that shipped an SFTP transport would answer an open
//     founder question by writing a file.
//   - `email` is **UNWRITTEN, AND WHAT IT WAITS ON IS A VENDOR RULING RATHER
//     THAN AN ADAPTER.** A sender exists in this workspace and it is one
//     deployable away: `apps/api/src/otp-delivery.ts`'s `postmarkOtpSender` is a
//     working credential-holding mail sender. `RI-04` forbids the import and
//     `node-linker=isolated` makes the specifier unresolvable, which is
//     `ADR-348`'s shape exactly; but the deciding fact is one register further
//     in. `ADR-229` chose Postmark for the SIGN-IN path on the sign-in path's
//     criteria, and that file's own argument is that **the credential scopes to
//     sending from ONE server**. Handing the digest run that same token widens a
//     credential that was admitted narrow, and choosing a different one is a
//     vendor decision no approved document has taken for this channel.
//
// **`content` IS TWO READS AND EACH HAS ITS OWN BLOCKER, NEITHER OF THEM AN
// ADAPTER.** `ports.ts` says both bodies are INPUTS and neither is queried
// through this handle, which is `INV-M6-10`'s boundary: a producer that could
// read `identities`, `risk_flags` or `accounts` directly is a producer one line
// away from putting a trader in an email.
//
//   - `lossRatioCusum` folds `P7-k`'s `BreakerEvaluationReport` through
//     `lossRatioBodyFrom`, and this deployment can produce no such report:
//     `UNWIRED_BREAKER_IO` is the only `BreakerIo` in the tree, **and the
//     evaluator would DECLINE even wired** because `OQ-M6-02`'s minimum sample
//     is the founder's and is unanswered. `schedule.ts`'s breaker row states
//     both and this file does not restate them differently.
//   - `flagQueue` is `P7-i`'s queue and it lives in
//     `apps/api/src/admin-source/flags.ts`. `apps/worker/package.json` declares
//     neither `@merit/api` nor any path into it.
//
// **AND THE SECOND READ IS THE ONE WHERE A PLAUSIBLE REPAIR IS THE WRONG MOVE,
// STATED HERE BECAUSE IT IS TEMPTING.** Nothing stops this deployable opening
// its own door onto `risk_flags` and folding counts by severity, and the result
// would carry no trader and would satisfy `INV-M6-10`. It is refused anyway: it
// would be a SECOND independent fold of one corpus figure, in a different
// deployable from `readFlagQueue`, with nothing making the two agree. Two
// implementations of one number that may silently disagree is the drift
// `ADR-034` exists to end, and a digest is where a wrong number gets mailed.
//
// -----------------------------------------------------------------------------
// 2. `tradingDayOf` IS SERVED AND THE WAY IT IS SERVED IS THE FINDING
// -----------------------------------------------------------------------------
// **THE PORT IS SYNCHRONOUS AND THE ONLY TRADING-DAY FACT IN THIS WORKSPACE IS
// AN ASYNCHRONOUS DATABASE READ THAT CAN REFUSE THREE WAYS.**
// `DigestIo.tradingDayOf(at: Date): string` is total and returns a value;
// `anchorLastClosedDay(db, at)` in `batch/adapter.ts` is `Promise`-returning and
// answers `{kind: 'anchored'}` or `{kind: 'refused', why}` on an empty calendar,
// an EXHAUSTED calendar, or a coverage gap. There is no way to await the second
// from inside the first, and `ports.ts` forbids the alternative in its own
// words: "a job deriving one from a UTC instant would be inventing a calendar."
//
// **SO THE RESOLUTION IS HOISTED ABOVE THE RUN AND THE PORT IS PINNED TO THE
// INSTANT IT WAS RESOLVED FOR.** {@link resolveDigestTradingDay} is the async
// half and {@link tradingDayAnchoredAt} is the pin. `job.ts`'s `resolveTradingDay`
// is the same shape one file over and for the same reason: every refusal that
// can be made about a run is made ABOVE the work, so a run that cannot say which
// day it is reporting never opens a transaction at all.
//
// **THE PIN REFUSES ANY OTHER INSTANT AND THAT REFUSAL IS THE POINT.** An
// adapter that answered one day for every instant handed to it would stamp a day
// resolved for one window onto a different window's row, and
// `report_deliveries.covers_through_trading_day` is `INV-M6-04`'s as-of column:
// "every number names its as-of moment and its source". That is `ADR-273`
// finding 1's harm -- a confident `YYYY-MM-DD` written for a night it was never
// resolved against -- moved from `rule_states` onto the digest's evidence table.
//
// -----------------------------------------------------------------------------
// 3. THE HAZARD THIS FILE CREATES, WHICH IS `DigestUnwired`'s WITH THE SIGN
//    FLIPPED, AND WHY THE JOB STAYS OFF A CLOCK
// -----------------------------------------------------------------------------
// `DigestUnwired`'s message says a `delivered` reported by an unwired producer
// is indistinguishable from one reported by a wired producer. **THE VALUE THIS
// FILE COMPOSES CANNOT PRODUCE THAT AND IT CAN PRODUCE THE MIRROR OF IT.**
// `deliverOne` CATCHES a throwing `content` and CATCHES a throwing `transport`
// and writes `outcome: 'failed'` with the reason in both cases. So a deployment
// that put this value behind a clock would write, into `report_deliveries`, one
// `failed` row per enabled schedule per window, forever, at climbing `attempt`
// ordinals -- and `0040` REVOKES `UPDATE` and `DELETE` on that table, so **every
// one of those rows is permanent.** On the day a transport lands, the delivery
// history for every window before it reads as a transport that existed and could
// not send, which is not what happened.
//
// **THAT IS A REASON TO KEEP THE JOB UNSCHEDULED AND IT IS NOT A REASON TO
// WITHHOLD THE ADAPTER**, which is `schedule.ts`'s own rule that wiring and
// scheduling are two decisions. Constructing this value writes nothing, connects
// to nothing and runs nothing; only a caller can arm it, `runDigestDeliveries`
// has no caller under any `src/`, and `test/digests-adapter.test.ts` asserts
// both of those and goes RED the day either changes.
//
// -----------------------------------------------------------------------------
// 4. THE ALARM'S READS ARE REFUSED HERE, AND THAT IS A BOUNDARY AND NOT A GAP
// -----------------------------------------------------------------------------
// {@link DigestTx} extends {@link DigestReadTx}, so the handle this file builds
// is assignable to the one `findUndeliveredWindows` takes. It still refuses the
// alarm's filter shapes. `alarm.ts` reads `reportDeliveries` by `{scheduleId}`
// alone and optionally by a `dueAt` TERM, and `produce.ts` reads it by
// `{scheduleId, dueAt}` as an equality; {@link DIGEST_READ_FILTERS} is
// transcribed from the producer's two call sites and from nothing else.
//
// **THE ALARM IS A DIFFERENT ROW AND ITS DOOR IS ITS OWN TO ARGUE FOR.**
// `ports.ts` section 1 is the reason the two runs are wired independently: a
// deployment that wired the producer and not the alarm is exactly the deployment
// where "the job reported success" is the only thing anybody has. An adapter
// that quietly served both would be one value carrying both halves, which is the
// coupling that file refuses as text.
// =============================================================================

import { atLeast } from '../db.ts';
import type { WorkerDb } from '../db.ts';
import { anchorLastClosedDay } from '../batch/adapter.ts';
import type {
  DigestFilter,
  DigestFilterTerm,
  DigestIo,
  DigestReadTable,
  DigestTerms,
  DigestTx,
  DigestValues,
  DigestWriteTable,
} from './ports.ts';
import { DigestUnwired } from './ports.ts';

/**
 * The transaction handle this deployable's one door yields.
 *
 * DERIVED FROM THE DOOR RATHER THAN IMPORTED, which is `recon/adapter.ts`'s
 * `ReconDbTx` and its reason: if the door's callback signature changes, this
 * alias changes with it and every use below stops compiling.
 */
export type DigestDbTx = Parameters<Parameters<WorkerDb['batch']>[0]>[0];

/**
 * Raised by the adapter, for an argument it will not pass to the accessor.
 *
 * SEPARATE FROM `DigestRowError` AND FROM {@link DigestUnwired}. The first says
 * the DATABASE returned a row the DDL says it cannot; the second says a
 * deployment installed no adapter at all. This one says a deployment installed
 * THIS adapter and the run asked it for something the translation below does not
 * cover, which is a code defect in the caller rather than a state of the world.
 */
export class DigestAdapterError extends Error {
  /** The table key or member the refused call named. */
  readonly key: string;

  // ASSIGNED RATHER THAN DECLARED IN THE PARAMETER LIST, on `ReconAdapterError`'s
  // measured reason: ADR-083 runs every deployable under
  // `node --experimental-strip-types`, where a TypeScript parameter property is
  // `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at load time while `tsc --noEmit`
  // accepts it.
  constructor(key: string, why: string) {
    super(
      `the digest adapter refuses a ${key} call: ${why}. report_deliveries is the one table the ` +
        'delivery alarm treats as evidence and 0040 revokes UPDATE and DELETE on it, so a read ' +
        'this adapter widened or a row it wrote wrong cannot be corrected afterwards.',
    );
    this.name = 'DigestAdapterError';
    this.key = key;
  }
}

// -----------------------------------------------------------------------------
// The columns each shape may name, as data, so the refusal can print them
// -----------------------------------------------------------------------------

/**
 * The filter shape each read table is narrowed by, by Drizzle property name.
 *
 * TRANSCRIBED FROM `produce.ts`'s TWO CALL SITES AND FROM NOTHING ELSE.
 * `runDigestDeliveries` reads `reportSchedules` by `{enabled}` and `deliverOne`
 * reads `reportDeliveries` by `{scheduleId, dueAt}`. A third shape is a caller
 * this adapter has not met, and header section 4 says why the alarm's is one of
 * them.
 */
export const DIGEST_READ_FILTERS: Readonly<Record<DigestReadTable, readonly string[]>> = {
  reportSchedules: ['enabled'],
  reportDeliveries: ['scheduleId', 'dueAt'],
};

/** Every column of a filter that is not in `allowed`, in the order they appear. */
function unexpectedColumns(where: DigestFilter, allowed: readonly string[]): readonly string[] {
  return Object.keys(where).filter((column) => !allowed.includes(column));
}

/**
 * Refuse a filter that names a column this adapter does not translate.
 *
 * **IT IS A THROW AND NEVER A DROP**, and it refuses a MISSING column as well as
 * an unknown one. `recon/adapter.ts` states the general rule and this port has
 * its own instance of it: `{scheduleId}` without `dueAt` on `reportDeliveries`
 * is a syntactically perfect read of EVERY window that schedule has ever had,
 * and `nextAttempt` folds whatever it is handed into the next ordinal. A dropped
 * `dueAt` would therefore not fail, it would return a NUMBER, and the number
 * would be the count of every attempt ever made against every window rather than
 * against this one. `report_deliveries_window_attempt_uq` would then accept it,
 * because a too-high ordinal collides with nothing.
 */
function requireExactColumns(key: string, where: DigestFilter, allowed: readonly string[]): void {
  const unexpected = unexpectedColumns(where, allowed);
  if (unexpected.length > 0)
    throw new DigestAdapterError(
      key,
      `the filter names ${JSON.stringify(unexpected)} and this adapter translates ` +
        `${JSON.stringify(allowed)} on that table`,
    );
  const missing = allowed.filter((column) => !(column in where));
  if (missing.length > 0)
    throw new DigestAdapterError(
      key,
      `the filter is missing ${JSON.stringify(missing)} and a read short of a column narrows ` +
        'less than the caller asked for, which the accessor cannot tell from a narrower question',
    );
}

/** One filter value, by name, with the key named in any refusal. */
function filterValue(key: string, where: DigestFilter, column: string): unknown {
  const value = where[column];
  if (value === undefined)
    throw new DigestAdapterError(key, `the filter carries no ${column} to translate`);
  return value;
}

// -----------------------------------------------------------------------------
// The one term, passed through untouched
// -----------------------------------------------------------------------------

/**
 * `ADR-157`'s `atLeast`, narrowed against its own discriminant.
 *
 * NOT WRAPPED. `src/db.ts`'s rule is that a term is passed through UNTOUCHED or
 * the accessor stops recognising it: `packages/db` keeps a module-private
 * `WeakSet` of the terms it minted and `isFilterTerm` reads IDENTITY rather than
 * shape (`ADR-157` clause 2). The narrowing below reads the discriminant and
 * returns the same object.
 *
 * **NOTHING IN `produce.ts` CALLS IT, AND THAT IS REPORTED RATHER THAN USED AS A
 * REASON TO OMIT IT.** A census of `io.terms` over `apps/worker/src` finds one
 * call site and it is `alarm.ts:427`, which takes `DigestAlarmIo` and not this
 * port. `DigestIo.terms` is a declared member the producer never reaches, so
 * serving it costs one line and buys the type; withholding it would make this
 * value not a `DigestIo` at all.
 */
function digestAtLeast(value: NonNullable<unknown>): DigestFilterTerm {
  const term = atLeast(value);
  if (term.term !== 'at-least') {
    throw new DigestAdapterError(
      'terms.atLeast',
      `the accessor's atLeast() minted a ${term.term} term. A history bound that became an upper ` +
        'bound would silently invert which windows the caller sees',
    );
  }
  return term;
}

/** The `DigestTerms` this deployment supplies. One member, and `ADR-157` admits it. */
export const DIGEST_TERMS: DigestTerms = { atLeast: digestAtLeast };

// -----------------------------------------------------------------------------
// One open transaction, translated
// -----------------------------------------------------------------------------

/**
 * A `DigestTx` over one open `SystemTx`.
 *
 * EVERY COLUMN LITERAL IN THIS FILE IS IN THIS FUNCTION, which is what makes the
 * translation reviewable: a reader checking that this adapter narrows what
 * `produce.ts` asked it to narrow reads one screen.
 *
 * **THERE IS NO `updateAt` AND NO `deleteAt` HERE BECAUSE THERE IS NONE ON THE
 * PORT**, which is `ports.ts` section 2 carried down from `0040`'s
 * `REVOKE UPDATE, DELETE ON report_deliveries FROM merit_app, PUBLIC`. The
 * accessor offers both on a `SystemTx` and this file names neither, so the
 * append-only log is append-only in the adapter as well as in the type and in
 * the grant.
 */
export function digestTxOver(tx: DigestDbTx): DigestTx {
  return {
    async rowsWhere(key: DigestReadTable, where: DigestFilter): Promise<unknown[]> {
      requireExactColumns(key, where, DIGEST_READ_FILTERS[key]);
      switch (key) {
        case 'reportSchedules': {
          const enabled = filterValue(key, where, 'enabled');
          return await tx.rowsWhere('reportSchedules', { enabled });
        }
        case 'reportDeliveries': {
          const scheduleId = filterValue(key, where, 'scheduleId');
          const dueAt = filterValue(key, where, 'dueAt');
          return await tx.rowsWhere('reportDeliveries', { scheduleId, dueAt });
        }
      }
    },

    async insert(key: DigestWriteTable, values: DigestValues): Promise<unknown[]> {
      switch (key) {
        case 'reportDeliveries':
          return await tx.insert('reportDeliveries', values);
      }
    },
  };
}

// -----------------------------------------------------------------------------
// The trading day, resolved above the run and pinned to its instant
// -----------------------------------------------------------------------------

/**
 * The run refused before it opened a transaction, naming the input it refused on.
 *
 * `WorkerJobRefusal`'s shape one file over and its reason: every refusal that can
 * be made ABOUT a run is made above the work, so a run that cannot say which day
 * it is reporting never opens a transaction and never writes a row.
 */
export class DigestRunRefusal extends Error {
  /** The input that refused. */
  readonly input: string;

  constructor(input: string, why: string) {
    super(`the digest run cannot proceed: ${why}`);
    this.name = 'DigestRunRefusal';
    this.input = input;
  }
}

/**
 * The last closed trading day at `at`, PROVED COVERED, or a refusal.
 *
 * **ONE DELEGATION AND NO SECOND FOLD.** `anchorLastClosedDay` is `ADR-268`'s
 * predicate in this deployable and it already answers exactly the question
 * `ports.ts` asks of `tradingDayOf`: the LAST CLOSED exchange trading day at the
 * instant it is given, proved covered by one `trading_calendar_loads` interval.
 * A second reading of the calendar here would be a second answer that could
 * disagree with the nightly batch's, and a digest whose as-of day disagrees with
 * the fold that produced the numbers is `INV-M6-04` broken in the place it is
 * hardest to see.
 *
 * **IT OPENS A TRANSACTION OF ITS OWN AND THAT IS DELIBERATE.** The read happens
 * BEFORE `runDigestDeliveries` is called, so it is not inside the run's one
 * transaction and cannot be: the port takes the day, not a promise of one.
 */
export async function resolveDigestTradingDay(db: WorkerDb, at: Date): Promise<string> {
  const anchor = await anchorLastClosedDay(db, at);
  if (anchor.kind !== 'anchored')
    throw new DigestRunRefusal(
      'tradingDayOf',
      `${anchor.why}. report_deliveries.covers_through_trading_day is INV-M6-04's as-of column ` +
        'and a digest that cannot name the day it reports has nothing true to write there',
    );
  return anchor.tradingDay;
}

/**
 * A `tradingDayOf` that answers ONE instant and refuses every other.
 *
 * Header section 2. The port is synchronous, the fact is an asynchronous
 * database read, and the resolution is therefore hoisted above the run. What is
 * left is a function that must not pretend to be more general than the value it
 * was handed.
 *
 * **THE REFUSAL IS ON THE INSTANT AND NOT ON THE DAY**, compared by
 * `getTime()` so a caller reconstructing an equal `Date` still passes. A run
 * asking for a different instant is a run whose `dueAt` moved after the anchor
 * was read, and answering it would stamp a day resolved for one window onto
 * another window's row.
 */
export function tradingDayAnchoredAt(resolvedFor: Date, tradingDay: string): (at: Date) => string {
  const pinned = resolvedFor.getTime();
  return (at: Date): string => {
    if (at.getTime() !== pinned)
      throw new DigestRunRefusal(
        'tradingDayOf',
        `the trading day ${tradingDay} was resolved for ${new Date(pinned).toISOString()} and ` +
          `this run asked for ${at.toISOString()}. The last closed trading day is a function of ` +
          'the instant and this adapter holds the answer for one of them, so answering a second ' +
          'instant would write an as-of day nobody resolved against it',
      );
    return tradingDay;
  };
}

// -----------------------------------------------------------------------------
// The two that refuse, with their blockers as data
// -----------------------------------------------------------------------------

/**
 * One member this adapter does not serve, with the blocker that stops it.
 *
 * A VALUE RATHER THAN A PARAGRAPH, on `wallet-withdrawals.test.ts`'s precedent:
 * a blocker recorded in prose goes stale silently, and a blocker recorded as
 * data can be RUN. `test/digests-adapter.test.ts` reads each `cite` and asserts
 * the artifact it names is still what it says, so the day a blocker dissolves
 * the suite goes RED and this file is due a re-decision rather than a paragraph
 * nobody re-read.
 */
export interface DigestBlocker {
  /** The `DigestIo` member, or the member and channel, the blocker stops. */
  readonly member: string;
  /**
   * `unwritten` means a place exists in this workspace where it could legally
   * live and nobody has written it. `unreachable` means the place does not
   * exist, or reaching it is refused by a rule or by an open question this row
   * may not answer. `ADR-349` ruled its fifth port unreachable rather than
   * unwritten and the distinction changed what was owed.
   */
  readonly kind: 'unwritten' | 'unreachable';
  /** Where a reader checks it. */
  readonly cite: string;
  /** What the source says, in its own words where it has them. */
  readonly why: string;
}

/**
 * Why `transport` has no inhabitant, split by channel because the two differ.
 *
 * Header section 1 is the argument. **`CHANNELS` HAS TWO MEMBERS AND SO DOES
 * THIS**, so a channel arriving in `0040`'s `CHECK` without an entry here is a
 * red suite rather than a silent omission.
 */
export const DIGEST_TRANSPORT_BLOCKERS: readonly DigestBlocker[] = [
  {
    member: 'transport.send (channel: sftp)',
    kind: 'unreachable',
    cite: 'docs/plans/M06-admin-ops-console.md:214, docs/decisions/ADR-066.md:64, docs/plans/FOLD-03-vendor-parity-gap-fill.md:261',
    why:
      'OQ-F3-04 is OPEN and it is the founder`s. M06 section 3.6 and ADR-066 section 3 both admit ' +
      'SFTP push as SHOULD and both call it a SECOND CREDENTIAL SURFACE, which makes "is email ' +
      'alone acceptable for v1" a security question rather than a convenience one. ADR-066 adds ' +
      'that it reuses no M02 code path, so the vendor SFTP one directory over is not a shortcut ' +
      'into it either. A transport shipped here would answer an open founder question by writing ' +
      'a file.',
  },
  {
    member: 'transport.send (channel: email)',
    kind: 'unwritten',
    cite: 'apps/api/src/otp-delivery.ts, docs/decisions/ADR-229.md, packages/db/src/scope.ts:1199',
    why:
      'A working credential-holding mail sender exists in this workspace and is one deployable ' +
      'away: postmarkOtpSender. RI-04 forbids the import and node-linker=isolated makes the ' +
      'specifier unresolvable, which is ADR-348`s shape. But the deciding fact is the credential: ' +
      'that file`s own argument for Postmark is that a server token SENDS FROM ONE SERVER and ' +
      'cannot manage the account, so handing the digest run the same token widens a credential ' +
      'admitted narrow. report_schedules deliberately carries no credential column ("this table ' +
      'is not a fifth credential surface arriving without a ruling"), so the credential is the ' +
      'transport`s own and naming it is a vendor decision no approved document has taken for ' +
      'this channel.',
  },
];

/**
 * Why `content` has no inhabitant, one entry per read.
 *
 * **NEITHER IS AN ADAPTER AND THAT IS THE POINT OF RECORDING THEM SEPARATELY
 * FROM THE TRANSPORT.** One waits on an unanswered founder question behind a
 * port that itself has no inhabitant; the other waits on a boundary between two
 * deployables. A single sentence saying "content is unwired" would lose both.
 */
export const DIGEST_CONTENT_BLOCKERS: readonly DigestBlocker[] = [
  {
    member: 'content.lossRatioCusum',
    kind: 'unreachable',
    cite: 'apps/worker/src/schedule.ts (plan breaker evaluation row), apps/worker/src/breaker/ports.ts',
    why:
      'The body is P7-k`s BreakerEvaluationReport folded by lossRatioBodyFrom, and this ' +
      'deployment can produce no such report. THE FIRST BLOCKER IS RETIRED AND THE SECOND ' +
      'STANDS, WHICH IS WHY THIS MEMBER STILL REFUSES. This clause read "UNWIRED_BREAKER_IO ' +
      'is the only BreakerIo in the tree" and ADR-352 made that false by writing ' +
      'breaker/adapter.ts; the sentence is kept beside its correction per RI-14 because it ' +
      'was true when written and names the step that retired it. WHAT DID NOT MOVE: THE ' +
      'EVALUATOR WOULD DECLINE EVEN WIRED, because OQ-M6-02`s minimum sample is the ' +
      'founder`s and is unanswered, so evaluateBreaker raises BreakerDeclined rather than ' +
      'inventing a floor. Two blockers, the second was never an adapter, and it is the one ' +
      'that still holds.',
  },
  {
    member: 'content.flagQueue',
    kind: 'unreachable',
    cite: 'apps/api/src/admin-source/flags.ts, apps/worker/package.json',
    why:
      'The body is P7-i`s queue, readFlagQueue, and it lives in apps/api. apps/worker/package.json ' +
      'declares neither @merit/api nor any path into it, RI-04 forbids an app depending on an ' +
      'app, and ports.ts already states the consequence: the flag queue crosses as a SUMMARY the ' +
      'deployment supplies rather than as a call this deployable makes. Folding a second queue ' +
      'here would be two implementations of one corpus figure with nothing making them agree.',
  },
];

/** A refusing port member, carrying the blocker in the message rather than a bare name. */
function refuse(member: string, blockers: readonly DigestBlocker[]): DigestUnwired {
  const mine = blockers.filter((one) => one.member.startsWith(member));
  const detail = mine
    .map((one) => `${one.member} is ${one.kind}: ${one.why} (${one.cite})`)
    .join(' ');
  const error = new DigestUnwired(member);
  error.message = `${error.message}. ${detail}`;
  return error;
}

// -----------------------------------------------------------------------------
// The composed value
// -----------------------------------------------------------------------------

/**
 * The `DigestIo` this deployment can build today: FOUR MEMBERS SERVED, TWO
 * REFUSED.
 *
 * **IT IS A `DigestIo` AND NOT A NARROWER TYPE, WHICH IS SAID BECAUSE IT LOOKS
 * LIKE A HALF-MEASURE AND IS NOT.** `UNWIRED_DIGEST_IO` is a `DigestIo` whose
 * six members reject and it is the shape this file follows: a port member that
 * cannot be served REFUSES, loudly, naming what is missing. The difference is
 * that four of these now reach a real database and a real clock, so the run's
 * refusal moves from "no adapter is installed" to the two specific things this
 * workspace does not have.
 *
 * **THREE ARGUMENTS AND NONE OF THEM HAS A DEFAULT.** The door, so a suite
 * substitutes a recorder; the clock, because `job.ts`'s rule is that "THE CLOCK
 * IS AN ARGUMENT AND NOT A CALL"; and `tradingDayOf`, because header section 2
 * is why it cannot be computed here and {@link tradingDayAnchoredAt} is how a
 * caller supplies it.
 *
 * **IT OPENS NOTHING WHEN IT IS CALLED.** `LIVE_DB.batch` calls `systemDb` and
 * `transaction` when it is INVOKED, so constructing this value connects to no
 * database and needs no `DATABASE_URL`.
 *
 * **CONSTRUCTING IT ARMS NOTHING AND A CLOCK WOULD.** Header section 3 is the
 * hazard and `schedule.ts`'s delivery row is where the decision not to take it
 * is recorded.
 */
export function postgresDigestIo(
  db: WorkerDb,
  now: () => Date,
  tradingDayOf: (at: Date) => string,
): DigestIo {
  return {
    // ONE TRANSACTION FOR THE WHOLE RUN, which `produce.ts` states as ADR-006's
    // criterion: the delivery rows commit together or none of them does. A
    // partially committed run would leave some windows recorded and some not,
    // and the alarm would report the unrecorded half as missing, which is true
    // and is not the failure that happened.
    transact<T>(fn: (tx: DigestTx) => Promise<T>): Promise<T> {
      return db.batch((tx) => fn(digestTxOver(tx)));
    },
    terms: DIGEST_TERMS,
    content: {
      lossRatioCusum: () =>
        Promise.reject(refuse('content.lossRatioCusum', DIGEST_CONTENT_BLOCKERS)),
      flagQueue: () => Promise.reject(refuse('content.flagQueue', DIGEST_CONTENT_BLOCKERS)),
    },
    transport: { send: () => Promise.reject(refuse('transport.send', DIGEST_TRANSPORT_BLOCKERS)) },
    now,
    tradingDayOf,
  };
}
