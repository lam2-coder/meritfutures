// =============================================================================
// apps/worker/src/breaker/ports.ts
// =============================================================================
// THE BREAKER EVALUATOR'S I/O BOUNDARY. `SD-M6-02`'s daily producer, declared
// structurally, importing nothing.
//
// `detectors/ports.ts`, `sweeps/ports.ts`, `batch/ports.ts` and
// `provisioning/ports.ts` are the idiom and `ADR-165` is the reason it is
// REQUIRED rather than merely conventional: one door and one acquisition point,
// `src/db.ts`, checked by `grep -rlE "from '@merit/db'" apps/worker/src`
// printing that file AND NOTHING ELSE. `@merit/db`'s `SystemTx` is assignable
// to {@link BreakerTx} with no import in either direction.
//
// NOTHING HERE ADDS A `SqlExecutorReason` MEMBER, ADDS A `SystemReason` MEMBER,
// IMPORTS `pg`, OR CASTS PAST A KEY TYPE (`P7` section 11 rule 10, `ADR-157`
// section 5, `ADR-165`, and `merit/no-raw-db-client` is attached to `apps/**`).
//
// -----------------------------------------------------------------------------
// 1. `INV-M5-12` IS THE WRITE UNION, AND THAT IS THE STRONGEST FORM AVAILABLE
// -----------------------------------------------------------------------------
// `M05` `INV-M5-12`: "The circuit breaker pauses sales and can never pause
// payouts", with the evidence column "Structural: the breaker's only effect is a
// flag read by M3's checkout. There is no code path from any liability signal to
// a payout block."
//
// A comment saying that is a convention. {@link BREAKER_WRITE_TABLES} having
// EXACTLY ONE MEMBER is a property of the type: `payoutRequests`,
// `walletWithdrawals`, `payoutTransfers`, `ledgerHalts` and
// `identityRestrictionEpisodes` are not in the union, so there is no `key` this
// port will accept that reaches any of them, and a slice that wants one is
// editing this line with an argument attached rather than passing a string.
//
// **THE READ SIDE CARRIES `payoutRequests` AND THE ASYMMETRY IS THE WHOLE
// POINT.** The loss ratio's NUMERATOR is settled payouts (`P-M6-05`: "trailing
// 30 day settled payouts divided by fees"), so the breaker MUST read them and
// must never be able to write one. A port that could not read payouts would have
// no ratio; a port that could write one would be the code path `INV-M5-12` says
// does not exist. Read many, write one.
//
// `test/breaker.test.ts` seeds the defect in both directions: a write key that
// names a payout table, and a `BreakerDecision` grown a payout-shaped effect.
//
// -----------------------------------------------------------------------------
// 2. THE READ SHAPE IS `ADR-157`'s AND THE JOIN IS THIS FILE'S COST
// -----------------------------------------------------------------------------
// `ADR-157` clause 1 admits `atMost`, `atLeast` and `isNull` on the READ path
// and nothing else; clause 6 REFUSED the scalar aggregate `P7` section 10 item 1
// asked for. `ADR-167` section 4's last paragraph inherits that refusal to this
// slice by name: "whether the pass-rate series is read as rows or as an
// aggregate is `scoped-db.ts`'s question, that file is `P5-a`'s, and `ADR-157`
// section 5 refused the aggregate on evidence".
//
// SO THE FOLD IS IN TYPESCRIPT AND THE ROWS CROSS THE BOUNDARY. Three things
// follow, and every one is a cost stated rather than discovered:
//
//   (a) **NEITHER `purchases` NOR `payout_requests` CARRIES A `plan_id`**, which
//       is a fact about the merged schema and not a shape this file chose.
//       `purchases.plan_version_id` and `payout_requests.plan_version_id` both
//       reach `plan_versions.plan_id`, so a per-plan window is a THREE TABLE
//       JOIN and the accessor renders none. The evaluator reads `plan_versions`
//       for the plan, then one window read PER VERSION, and joins in memory.
//   (b) **`IN` IS REFUSED** (`ADR-157` clause 1, and section 3's table refuses it
//       by name), so the per-version reads cannot be collapsed into one. A plan
//       with `n` versions costs `2n` reads per evaluation. That is the price of
//       the door staying closed and it is small: `plan_versions` is a catalogue.
//   (c) **THE WINDOW IS AN `atLeast` TERM AND THE BOUND IS INCLUSIVE**
//       (`ADR-157` clause 1). A row exactly on the window's first instant is IN
//       the window, every day, which is a duplicate at the boundary rather than
//       a gap, and the evaluation is a fold over a set rather than a cursor so
//       the duplicate costs nothing.
//
// **IF THE WINDOW READ EVER STOPS BEING AFFORDABLE THE REMEDY IS AN ENTRY AND
// NOT A WIDENING HERE**, which is `detectors/ports.ts`'s disposition one
// directory over and `ADR-157` section 5's own question: "a joined read has two
// tables and the tenancy narrowing has to hold on BOTH of them, or the accessor
// is a BOLA hole with an extra table in it."
//
// -----------------------------------------------------------------------------
// 3. NO NUMBER IN THIS FILE IS THIS SLICE'S, AND THE UNSTATED ONES STAY UNSTATED
// -----------------------------------------------------------------------------
// `OQ-M6-02` is the founder's (`M06:538`: "This is a judgment about how much
// evidence is enough to pause revenue"), and `P7` section 5.4 says this plan
// "cites the number and does not choose it". So {@link LOSS_RATIO_POLICY} ships
// with both minimum terms `null` and every stated number carrying its citation,
// and `test/breaker.test.ts` asserts the nulls are still null, so a later
// session cannot quietly fill one in.
//
// The evaluator DECLINES rather than running on an invented minimum, which is
// `DetectorDeclined`'s shape one directory over and its reason: a breaker
// running without a floor is `AS-M6-02` produced deliberately.
// =============================================================================

// -----------------------------------------------------------------------------
// The tables, and no others
// -----------------------------------------------------------------------------

/**
 * The tables an evaluation may READ, as a closed union.
 *
 * A NARROW UNION RATHER THAN THE WHOLE KEY SPACE, on `detectors/ports.ts`'s and
 * `sweeps/ports.ts`'s argument: `SystemTx.rowsWhere` is declared over `TableKey`
 * and reaches every table in the estate with one word, and a handle that is
 * wider is assignable to a shape that is narrower, so the narrowing costs the
 * caller nothing.
 *
 * `plans` and `planVersions` are the subject and the bridge (section 2a).
 * `purchases` is the DENOMINATOR (fees) and `payoutRequests` is the NUMERATOR
 * (settled payouts), which is `P-M6-05` read literally. `planBreakerState` is
 * read because the evaluation needs YESTERDAY: a state change is a comparison
 * against the previous row, and a live override is carried forward by this job
 * and an expired one is dropped by it, which is
 * `CRON_INVENTORY`'s exemption for `plan_breaker_state.override_expires_at`
 * ("the override lapses by being recomputed rather than by being released").
 */
export const BREAKER_READ_TABLES = [
  'plans',
  'planVersions',
  'purchases',
  'payoutRequests',
  'planBreakerState',
] as const;

/** One of {@link BREAKER_READ_TABLES}. */
export type BreakerReadTable = (typeof BREAKER_READ_TABLES)[number];

/**
 * The tables an evaluation may WRITE. EXACTLY ONE, and that is `INV-M5-12`.
 *
 * Section 1 of this file's header. The absences are the ruling and they are
 * enumerated there rather than left to be noticed: no payout table, no wallet
 * table, no halt table and no restriction table is reachable through this port,
 * so "there is no code path from any liability signal to a payout block" is a
 * property of the type rather than of a value somebody remembered not to set.
 *
 * `events` is absent for `detectors/ports.ts`'s reason: it is registered in
 * neither `schema.ts` nor `scope.ts`, naming an unregistered table is a compile
 * error, and `P5-b` holds it. The alert goes through {@link BreakerEventPort}.
 */
export const BREAKER_WRITE_TABLES = ['planBreakerState'] as const;

/** One of {@link BREAKER_WRITE_TABLES}. */
export type BreakerWriteTable = (typeof BREAKER_WRITE_TABLES)[number];

/**
 * `plan_breaker_state.state`, transcribed from the merged `CHECK`.
 *
 * `0016_treasury_controls.sql`: `state text NOT NULL CHECK (state IN ('armed',
 * 'paused', 'insufficient_data', 'manually_overridden'))`. A TRANSCRIPTION and
 * not a design, and `test/breaker.test.ts` reads the migration as text and
 * asserts this tuple against it, so a fifth name cannot drift in on either side.
 *
 * **`insufficient_data` IS FIRST CLASS AND IS NOT AN ERROR**, which `0016`'s own
 * header says in words: "It is what the breaker says during launch week, and
 * saying it is the correct behaviour."
 */
export const BREAKER_STATES = [
  'armed',
  'paused',
  'insufficient_data',
  'manually_overridden',
] as const;

/** One of {@link BREAKER_STATES}. */
export type BreakerState = (typeof BREAKER_STATES)[number];

/**
 * The one state that pauses a plan's new sales, spelled once.
 *
 * `API_CONTRACT`'s `per_plan.sales_paused` is this comparison and nothing else,
 * and `ADR-167` clause 3 forecloses any other writer of the value: "The CUSUM
 * never writes `plan_breaker_state.state`. That column is the loss-ratio
 * breaker's and `'paused'` is a sales pause."
 *
 * **IT PAUSES SALES. IT DOES NOT PAUSE PAYOUTS AND CANNOT** (`INV-M5-12`).
 */
export const SALES_PAUSED_STATE = 'paused' as const;

// -----------------------------------------------------------------------------
// `ADR-157`'s terms, as this file must be able to name them
// -----------------------------------------------------------------------------

/**
 * One column's narrowing when it is not an equality, as `ADR-157` minted it.
 *
 * DECLARED AND NEVER CONSTRUCTED HERE, on `detectors/ports.ts`'s reasoning:
 * `packages/db` keeps a module-private `WeakSet` of the terms it minted and
 * `isFilterTerm` reads IDENTITY rather than shape, so a caller cannot hand-roll
 * one and nothing that crossed a process boundary is in the set.
 */
export type BreakerFilterTerm =
  | { readonly term: 'at-most'; readonly value: unknown }
  | { readonly term: 'at-least'; readonly value: unknown }
  | { readonly term: 'is-null' };

/**
 * The two READ-PATH constructors this evaluation needs, supplied by the wiring.
 *
 * INJECTED RATHER THAN IMPORTED, for {@link BreakerFilterTerm}'s reason.
 *
 * **THERE IS NO `isNull` HERE AND THE ABSENCE IS DELIBERATE.** `ADR-157`
 * admitted three terms; this evaluation needs one window bound on each of two
 * tables and nothing else, and a port declaring a term no caller uses is a door
 * held open for a caller who has not argued for it.
 */
export interface BreakerTerms {
  /** `column >= value`, INCLUSIVE. The window's lower bound. */
  atLeast(value: NonNullable<unknown>): BreakerFilterTerm;
  /** `column <= value`, INCLUSIVE. The window's upper bound. */
  atMost(value: NonNullable<unknown>): BreakerFilterTerm;
}

/** A filter, by Drizzle property name. `ADR-112`'s shape. */
export type BreakerFilter = Readonly<Record<string, unknown>>;

/** A set of values to write, by Drizzle property name. */
export type BreakerValues = Readonly<Record<string, unknown>>;

/** One row as the evaluation sees it. */
export type BreakerRow = Readonly<Record<string, unknown>>;

// -----------------------------------------------------------------------------
// One open transaction, as an evaluation needs to see it
// -----------------------------------------------------------------------------

/**
 * One open transaction.
 *
 * **`updateAt` AND `deleteAt` ARE ABSENT.** `ADR-112` removed `update` and
 * `delete` from every transaction handle in this workspace; what this port
 * removes on top is the ADDRESSED write, so an evaluation cannot reach back and
 * rewrite a previous plan-day. `plan_breaker_state` is keyed
 * `(plan_id, evaluated_on)` and one plan-day is one row: the record of what the
 * breaker said on a day is what an override argument is later settled from, and
 * a job that could rewrite it is a job that could rewrite the argument.
 *
 * **THERE IS NO `lockAt`.** `ADR-157` clause 4's row lock buys nothing here: the
 * only writer of `plan_breaker_state` is this job, and two concurrent runs on
 * the same plan-day contend on the PRIMARY KEY, which refuses the second at the
 * database rather than letting both through. A lost second run is the correct
 * outcome, because both computed the same day from the same rows.
 */
export interface BreakerTx {
  /** Rows matching a filter. The READ path is the only place a term may appear. */
  rowsWhere(key: BreakerReadTable, where: BreakerFilter): Promise<unknown[]>;
  /** Write one row, returning it. */
  insert(key: BreakerWriteTable, values: BreakerValues): Promise<unknown[]>;
}

// -----------------------------------------------------------------------------
// The policy, and every number in it carries a citation or a null
// -----------------------------------------------------------------------------

/**
 * A number the corpus states, with the source it was read from.
 *
 * `P7-d`'s seed shape one deployable over: each value is
 * `{state, value, cite, quote}` rather than a bare number, and a value the
 * corpus does not state is `unstated` with a `null` rather than absent. A reader
 * asking "where does 6000 come from" gets the answer from the value.
 */
export type PolicyNumber =
  | {
      readonly state: 'stated';
      readonly value: number;
      readonly cite: string;
      readonly quote: string;
    }
  | {
      readonly state: 'unstated';
      readonly value: null;
      readonly cite: string;
      readonly quote: string;
    };

/**
 * What the loss-ratio breaker runs under.
 *
 * **TWO OF THE FIVE ARE `unstated` AND BOTH ARE `OQ-M6-02`'s**, which is
 * `P7` section 5.4's discipline applied rather than restated: "This plan cites
 * the number and does not choose it."
 *
 * `minSample` IS THE DENOMINATOR'S COUNT AND `ADR-167` SECTION 5 RULES IT.
 * `min_sample integer NOT NULL CHECK (min_sample > 0)` is ONE scalar and
 * `plan_breaker_state_respects_min_sample` is ONE comparison against ONE
 * `sample_size`, while `OQ-M6-02`'s proposal is a CONJUNCTION of two counts over
 * two different populations ("20 purchases and 3 settled payouts on the plan in
 * the window"). The row can express one of the two terms and `ADR-167` rules
 * which: the DENOMINATOR's count, sourced from `0016`'s own header
 * ("a loss-ratio breaker with no minimum sample fires on a two-transaction
 * denominator"), because a floor on the numerator's count would leave a
 * denominator of one permitted.
 *
 * **SO {@link minSettledPayouts} LIVES HERE OR IT DOES NOT EXIST**, which is
 * `ADR-167` section 5's closing sentence. It is applied by the evaluator and it
 * is NOT written to a column, and `P7-k` "may not quietly put the other one in
 * the column": a row whose `sample_size` held the settled-payout count would
 * satisfy every `CHECK` in `0016` and describe the wrong population, and no gate
 * in this repository can see which count an integer is.
 */
export interface LossRatioPolicy {
  /** `plan_breaker_state.metric`. One plan-day is one row and one row is one metric. */
  readonly metric: string;
  readonly windowDays: PolicyNumber;
  readonly thresholdBp: PolicyNumber;
  readonly minSample: PolicyNumber;
  readonly minSettledPayouts: PolicyNumber;
}

/**
 * The shipped policy. Three numbers stated, two `unstated`, none chosen here.
 *
 * `test/breaker.test.ts` asserts both `unstated` members are still `unstated`,
 * so filling one in is a red suite rather than a quiet commit.
 */
export const LOSS_RATIO_POLICY: LossRatioPolicy = {
  metric: 'loss_ratio_30d',
  windowDays: {
    state: 'stated',
    value: 30,
    cite: 'M06:95 (P-M6-05)',
    quote: 'Trailing 30 day settled payouts divided by fees, per plan',
  },
  thresholdBp: {
    state: 'stated',
    value: 6000,
    cite: 'M06:95 (P-M6-05)',
    quote: "Breaker at 6000bp pauses that plan's new sales (SD-M6-02)",
  },
  minSample: {
    state: 'unstated',
    value: null,
    cite: 'M06:313 (OQ-M6-02), M06:538',
    quote:
      'Proposed minimum: 20 purchases and 3 settled payouts on the plan in the window (OQ-M6-02). ' +
      'The number is a judgment; having one is not.',
  },
  minSettledPayouts: {
    state: 'unstated',
    value: null,
    cite: 'M06:313 (OQ-M6-02), ADR-167 section 5',
    quote:
      'The row can express one of the two terms, and the second lives in the evaluator or it does ' +
      'not exist.',
  },
};

// -----------------------------------------------------------------------------
// The event, as a port that takes the transaction
// -----------------------------------------------------------------------------

/**
 * The one event this evaluation emits, by its registry name.
 *
 * **IT IS NOT YET A ROW IN `EVENTS.md` AND THAT IS REPORTED RATHER THAN
 * REPAIRED**, which is `detectors/ports.ts`'s disposition of
 * `detector.run_degraded` and its reason: `EVENTS.md` is outside this fence and
 * `ADR-159` clause 1 makes the authority for a name the registry rather than a
 * producer. `M06:265` is the payload's authority and it is transcribed field for
 * field into {@link BreakerStateChanged}.
 */
export const BREAKER_STATE_CHANGED = 'breaker.state_changed' as const;

/**
 * `breaker.state_changed`'s payload, transcribed from `M06:265` field for field.
 *
 * > `{ plan_id, metric, from_state, to_state, ratio_bp, threshold_bp,
 * >    sample_size, min_sample }`. A breaker that pauses sales is a revenue event
 * > and belongs on the feed with its **sample size attached**, so the reader can
 * > see immediately whether it fired on real data (AS-M6-02)
 *
 * **`sample_size` AND `min_sample` ARE BOTH REQUIRED FIELDS AND NEITHER IS
 * OPTIONAL**, which is the whole of `AS-M6-02`'s counter: "an alert that omits
 * it invites exactly the override that destroys the control." A `number` rather
 * than `number | undefined` is what makes omitting one a compile error.
 *
 * `from_state` is `null` on a plan's FIRST evaluation, because there is no
 * previous row and inventing `armed` would report a transition that did not
 * happen.
 */
export interface BreakerStateChanged {
  readonly plan_id: string;
  readonly metric: string;
  readonly from_state: BreakerState | null;
  readonly to_state: BreakerState;
  readonly ratio_bp: number;
  readonly threshold_bp: number;
  readonly sample_size: number;
  readonly min_sample: number;
}

/** One event, name and payload. */
export interface BreakerEvent {
  readonly name: typeof BREAKER_STATE_CHANGED;
  readonly payload: BreakerStateChanged;
}

/**
 * The event sink.
 *
 * IT TAKES THE TRANSACTION, which is `ADR-006`'s criterion relied on rather than
 * restated: the alert commits with the row that changed state, or neither does.
 * A sales pause whose alert was lost because the emit succeeded and the
 * transaction rolled back is a plan that stopped selling with nobody told.
 *
 * NOTHING IN THIS WORKSPACE WRITES AN EVENT YET (`P5-n` builds the producer,
 * `P5-b` registers `events`), so this file declares WHAT is emitted and refuses
 * to invent a sink.
 */
export interface BreakerEventPort {
  emit(tx: BreakerTx, event: BreakerEvent): Promise<void>;
}

// -----------------------------------------------------------------------------
// Everything the evaluation cannot do for itself
// -----------------------------------------------------------------------------

/**
 * The evaluation's whole outside world.
 *
 * `transact` TAKES THE UNIT OF WORK rather than handing back a handle, which is
 * `WorkerDb.batch`'s shape and its reason: a transaction cannot outlive the
 * function that opened it and no caller has a `commit` to forget.
 * **`apps/worker/src/db.ts` ALREADY SATISFIES IT** and `SystemReason` gains no
 * member: `LIVE_DB.batch` is `transaction(systemDb('nightly-batch'), fn)`, and a
 * daily recomputation is a scheduled job, which is what `'nightly-batch'` names.
 *
 * `now` IS INJECTED AND IS THE ONLY CLOCK. `evaluated_on`, the window's lower
 * bound and every override-expiry comparison derive from it, so a fixture pins
 * the whole evaluation and the database never supplies an instant.
 *
 * **`tradingDayOf` IS INJECTED AND IS NOT COMPUTED HERE.** `evaluated_on` is a
 * `date` and the trading day follows the exchange session calendar maintained as
 * data (`CLAUDE.md`, `ADR-042`); a job deriving one from a UTC instant would be
 * inventing a calendar. `merit/no-calendar-in-expiry-path` is attached by glob
 * to the expiry sweep one directory over, and the same reasoning applies here by
 * hand: what a breaker evaluation knows is which day it was told it is.
 */
export interface BreakerIo {
  transact<T>(fn: (tx: BreakerTx) => Promise<T>): Promise<T>;
  readonly terms: BreakerTerms;
  readonly events: BreakerEventPort;
  now(): Date;
  /** The exchange trading day, as `YYYY-MM-DD`. Supplied, never derived. */
  tradingDayOf(at: Date): string;
}

/**
 * Raised when the evaluation cannot run under the policy it was given.
 *
 * **IT IS A NAMED WAY TO SAY "I HAVE NO FLOOR" AND IT IS NOT A STATE.**
 * `OQ-M6-02` is unanswered, so {@link LOSS_RATIO_POLICY}'s two minimum terms are
 * `null`, and an evaluator that ran anyway would either invent a floor or use
 * zero. Zero is the worse of the two: `min_sample integer NOT NULL CHECK
 * (min_sample > 0)` refuses it at the database, and a floor of one is
 * `AS-M6-02`'s launch-week outage with a `CHECK` satisfied.
 *
 * Writing `insufficient_data` instead would be worse still, because that state
 * means "the sample is below the floor" and there is no floor to be below.
 */
export class BreakerDeclined extends Error {
  readonly why: string;
  constructor(why: string) {
    super(`the breaker evaluation declined to run: ${why}`);
    this.name = 'BreakerDeclined';
    this.why = why;
  }
}

/**
 * Raised by a port that is not installed.
 *
 * AN EVALUATOR THAT RETURNED PLAUSIBLE VALUES WOULD BE A FIXTURE REPORTING THAT
 * MERIT'S REVENUE CONTROL IS HEALTHY. `armed` on an unwired deployment is
 * indistinguishable from `armed` on a real one, and it is the answer a reader
 * takes as evidence that the breaker is watching. So the default refuses.
 */
export class BreakerUnwired extends Error {
  constructor(what: string) {
    super(
      `BreakerIo.${what} cannot be served by this deployment: no adapter is installed. The ` +
        'breaker evaluator refuses rather than returning a plausible value: an `armed` reported by ' +
        'an unwired evaluator is indistinguishable from one reported by a wired evaluator, and ' +
        "sentence CRON_INVENTORY's dead-man switch for this row exists to make false.",
    );
    this.name = 'BreakerUnwired';
  }
}

/**
 * The unwired default, which serves nothing.
 *
 * `CRON_INVENTORY`'s breaker-evaluation row alarms on the evaluation's ABSENCE,
 * so a deployment holding this default is a deployment whose breaker evaluations
 * are absent and is alarmed as such.
 */
export const UNWIRED_BREAKER_IO: BreakerIo = {
  transact: () => Promise.reject(new BreakerUnwired('transact')),
  terms: {
    atLeast: () => {
      throw new BreakerUnwired('terms.atLeast');
    },
    atMost: () => {
      throw new BreakerUnwired('terms.atMost');
    },
  },
  events: { emit: () => Promise.reject(new BreakerUnwired('events.emit')) },
  now: () => {
    throw new BreakerUnwired('now');
  },
  tradingDayOf: () => {
    throw new BreakerUnwired('tradingDayOf');
  },
};
