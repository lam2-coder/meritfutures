// =============================================================================
// apps/worker/src/detectors/ports.ts
// =============================================================================
// THE DETECTOR RUNNER'S I/O BOUNDARY, AND THE SHAPE `P7-f`, `P7-g` AND `P7-h`
// EACH WRITE A DETECTOR AGAINST. DECLARED STRUCTURALLY, IMPORTING ONLY THE
// CANARY TYPES BESIDE IT.
//
// `batch/ports.ts`, `provisioning/ports.ts` and `sweeps/ports.ts` are the idiom
// and the reason is the one all three state: `apps/worker/package.json` declares
// `@merit/rules-engine` and nothing else, `node-linker=isolated` makes an
// undeclared import unresolvable, and the manifest is not in this slice's fence.
// `apps/worker/src/db.ts` is additionally this deployable's ONE door onto
// `@merit/db` (`ADR-165`), asserted by `test/db.test.ts` walking `src/`. So
// every shape here is DECLARED and SATISFIED structurally by the accessor the
// wiring supplies: `@merit/db`'s `SystemTx` is assignable to {@link DetectorTx}
// with no import in either direction.
//
// NOTHING HERE ADDS A `SqlExecutorReason` MEMBER, ADDS A `SystemReason` MEMBER,
// IMPORTS `pg`, OR CASTS PAST A KEY TYPE (`P7` section 11 rule 10, `ADR-157`
// section 5, and `merit/no-raw-db-client` is attached to `apps/**`).
//
// -----------------------------------------------------------------------------
// 1. THE READ SHAPE IS `ADR-157`'s, AND ITS COST IS DESIGNED FOR RATHER THAN
//    COMPLAINED ABOUT
// -----------------------------------------------------------------------------
// `ADR-157` section 5 REFUSED the aggregate `P7` section 10 item 1 asked for,
// and refused it on evidence rather than on scope: `P7`'s own section 3.1 names
// a JOIN as every wave-2 detector's blocker, so a scalar aggregate would have
// spent the widening and unblocked nothing. What it granted instead is quoted
// here because it is the whole of this file's read design:
//
//   "`D-01`'s two second window IS a range term and it lands here; a detector
//   can pull its window through `rowsWhere` and do the join in the runner. What
//   that costs is real and is named rather than waved at: THE ROWS CROSSING THE
//   BOUNDARY ARE THE WINDOW'S RATHER THAN THE MATCH'S, so a detector over a wide
//   window pays for every row it did not match."
//
// So a detector declares STREAMS -- a table, a filter and a name -- the runner
// reads each one through `rowsWhere`, and the detector does its join over the
// rows in memory. Three consequences are built into the shapes below rather than
// left to each detector to rediscover:
//
//   (a) {@link DetectorStream} carries `where` and NOT a projection, because the
//       accessor has none. Every column of every row in the window crosses.
//   (b) {@link DetectorScanInput} hands the detector an ARRAY per stream, so the
//       join is ordinary code and the cost is visible at the call site.
//   (c) {@link DetectorRunReport} reports `rowsScanned` per stream, so a
//       detector whose window is too wide is a number somebody can read rather
//       than a slow night.
//
// **IF THE WINDOW READ IS NOT AFFORDABLE, THE REMEDY IS AN ENTRY AND NOT A
// WIDENING HERE**, and `ADR-157` section 5 already wrote that entry's question
// down: "a joined read has two tables and the tenancy narrowing has to hold on
// BOTH of them, or the accessor is a BOLA hole with an extra table in it."
//
// -----------------------------------------------------------------------------
// 2. NO DETECTOR CAN WRITE A `risk_flags.status`, AND IT IS THE TYPE THAT STOPS
//    IT
// -----------------------------------------------------------------------------
// `INV-M7-02`: "No detector transitions a flag past `open`. Enforced by the
// writer: the detector service has no grant to write `status` values other than
// `open`. Not a convention, a permission." `ADR-155` and `P7` section 11 rule 11
// say the same from the plan's side, and `STATE_MACHINES` section 7 makes the
// absence of an automatic path to `enforced` binding.
//
// **THE GRANT DOES NOT EXIST.** `P7` section 10 item 2 measured it:
// `0026_roles_and_grants.sql` creates one role an application can hold, and the
// per-service grant the invariant describes is a migration that is nobody's. So
// the code path is the control today, and this file makes it a control of the
// SHAPE rather than of a value somebody remembered to set:
//
//   1. {@link DetectorTx} HAS NO `updateAt` AND NO `deleteAt`. A flag can be
//      inserted and can never be moved, so there is no method on this port a
//      transition could be written through. (`ADR-112` already deleted `update`
//      and `delete` from every transaction handle in the workspace; what this
//      port removes on top is the ADDRESSED write.)
//   2. {@link DetectorFinding} HAS NO `status` FIELD. `enforced` is not a value
//      a detector can fail to avoid; it is a word with nowhere to go. The runner
//      stamps {@link FLAG_STATUS_ON_RAISE} and reads nothing from the finding.
//
// A later session that adds a `status` to the finding, or an `updateAt` to this
// port, is doing the thing `P7` calls the phase's temptation, and the suite goes
// red on both.
//
// -----------------------------------------------------------------------------
// 3. SEVERITY IS A MONEY DECISION AND THIS PORT MAKES IT CARRY ITS CLOCK
// -----------------------------------------------------------------------------
// `M07` section 3.3: severity is contextual rather than per-detector, and moving
// a detector from 3 to 4 changes who gets held. `ADR-040` is why: a flag at
// severity 4 or 5 is the band `G-HOLD-REQUIRED` reads to HOLD A PAYOUT for 48
// hours. `0008_risk.sql`'s `risk_flags_high_severity_has_sla` makes the clock
// mandatory at that band -- "severity < 4 OR sla_due_at IS NOT NULL" -- so a
// detector raising a 4 without an SLA is a `23514` at 02:00 that rolls back a
// whole run.
//
// {@link DetectorFinding} therefore carries `slaDueAt` and the runner REFUSES a
// finding that omits it above the band, at the port rather than at the database.
// The refusal is `DetectorFindingError` and it is stated as a rule the detector
// author reads, because the alternative is that the first person to learn about
// the constraint is whoever reads the nightly failure.
// =============================================================================

import type { CanaryMint, CanaryNonce, CanarySubject } from './canary.ts';

// -----------------------------------------------------------------------------
// The tables, and no others
// -----------------------------------------------------------------------------

/**
 * The tables a detector run may READ, as a closed union.
 *
 * A NARROW UNION RATHER THAN THE WHOLE KEY SPACE, on `sweeps/ports.ts`'s and
 * `provisioning/ports.ts`'s argument: `SystemTx.rowsWhere` is declared over
 * `TableKey` and reaches all 105 tables in the estate with one word, which
 * `ADR-102` section 8 prices as a widening it accepts for the batch. A detector
 * accepting the same reach would spend that budget again for nothing, and the
 * narrowing costs the caller nothing because a wider handle is assignable to a
 * narrower shape.
 *
 * **EVERY MEMBER IS AN `Input` CELL OF `M07` SECTION 3.2**, plus
 * `detectorDefinitions`, which is `INV-M7-04`'s registry and is read on every
 * run before anything else. `attributions` is `D-10`'s, `economicCalendar` is
 * `D-04`'s maintained Tier-1 calendar, `ruleStates` is `D-11`'s
 * `engine_gates`, and `identityPhones` is `D-18`'s.
 *
 * **ONE `Input` CELL HAS NO TABLE AND IT IS REPORTED RATHER THAN INVENTED.**
 * `D-14`'s input is "live and end-of-day positions across a `D-12` clique"
 * (`M07:136`) and there is no `positions` key in `packages/db/src/scope.ts`.
 * Whether that is `daily_marks` read differently or a table nobody has declared
 * is `P7-g`'s finding to make, and adding a speculative member here would settle
 * it by being written.
 */
export const DETECTOR_READ_TABLES = [
  'detectorDefinitions',
  'fills',
  'dailyMarks',
  'identities',
  'accounts',
  'purchases',
  'identityLinks',
  'identitySignals',
  'identityPhones',
  'payoutTransfers',
  'attributions',
  'ruleStates',
  'economicCalendar',
] as const;

/** One of {@link DETECTOR_READ_TABLES}. */
export type DetectorReadTable = (typeof DETECTOR_READ_TABLES)[number];

/**
 * The tables a detector run may WRITE, as a closed union of three.
 *
 * `detectorRuns` is `INV-M7-07`'s record and this slice is its first producer.
 * `riskFlags` is the output, at `open` and only at `open`. `correlationGroups`
 * is `SD-M7-05`'s group result and is `P7-g`'s to produce: it is in this union
 * because `P7-g`'s fence holds `detectors/graph.ts` and its test and does NOT
 * hold this file, so a door left out here is a slice blocked later.
 *
 * **NO OTHER TABLE IS WRITABLE AND THE ABSENCES ARE THE RULING.**
 * `identity_links` is absent: `M07` section 3.1's resolution tiers are entity
 * RESOLUTION rather than detection, `P7-h` writes hard links at the ceiling
 * under `ADR-155`, and a link written by this runner would be a graph edge with
 * a detector run as its author. `identity_restriction_episodes` is absent
 * because it is an ENFORCEMENT record and `M07` section 1.2 puts enforcement
 * outside this module. `admin_actions` is absent for `sweeps/ports.ts`'s reason
 * one directory over: it is an operator's record of an operator's decision and a
 * detector run is nobody's decision.
 */
export const DETECTOR_WRITE_TABLES = ['detectorRuns', 'riskFlags', 'correlationGroups'] as const;

/** One of {@link DETECTOR_WRITE_TABLES}. */
export type DetectorWriteTable = (typeof DETECTOR_WRITE_TABLES)[number];

/**
 * The one `risk_flags.status` a detector may cause, spelled once.
 *
 * `INV-M7-02`, `ADR-155`, `STATE_MACHINES` section 7, `P7` section 11 rule 11.
 * The runner stamps it and reads nothing from the finding, and
 * {@link DetectorFinding} has no field it could read.
 */
export const FLAG_STATUS_ON_RAISE = 'open' as const;

/**
 * The `risk_flags.source` a detector run writes.
 *
 * `0008_risk.sql:130` reserves `'internal'` or `'vendor:<name>'` so that a
 * QuantSentry-class detector plugs in without a migration. Everything this
 * deployable runs is internal by construction.
 */
export const FLAG_SOURCE_INTERNAL = 'internal' as const;

/** The severity at and above which `risk_flags` requires an SLA clock. */
export const SLA_REQUIRED_AT_SEVERITY = 4;

/** `detector_runs.status`, as `0008_risk.sql:87` declares it. */
export const DETECTOR_RUN_STATUSES = ['ok', 'failed', 'degraded'] as const;

/** One of {@link DETECTOR_RUN_STATUSES}. */
export type DetectorRunStatus = (typeof DETECTOR_RUN_STATUSES)[number];

// -----------------------------------------------------------------------------
// `ADR-157`'s terms, as this file must be able to name them
// -----------------------------------------------------------------------------

/**
 * One column's narrowing when it is not an equality, as `ADR-157` minted it.
 *
 * DECLARED AND NEVER CONSTRUCTED HERE, on `sweeps/ports.ts`'s reasoning:
 * `packages/db` keeps a module-private `WeakSet` of the terms it minted and
 * `isFilterTerm` reads identity rather than shape, so a caller cannot hand-roll
 * one. A `jsonb` column holding an object that looks like a term is a VALUE, and
 * a shape check would read it as a range.
 */
export type DetectorFilterTerm =
  | { readonly term: 'at-most'; readonly value: unknown }
  | { readonly term: 'at-least'; readonly value: unknown }
  | { readonly term: 'is-null' };

/**
 * `ADR-157`'s three READ-PATH constructors, supplied by the wiring.
 *
 * INJECTED RATHER THAN IMPORTED because a term is only a term if `packages/db`
 * minted it, and this app cannot import that package. What a detector is
 * responsible for is WHICH term goes on WHICH column, and that is what the suite
 * asserts.
 *
 * **`atLeast` AND `atMost` TOGETHER ARE `D-01`'s TWO SECOND WINDOW**, which is
 * the one thing `ADR-157` section 5 granted `P7` by name, and both bounds are
 * INCLUSIVE: clause 6 forecloses a half-open interval, so a detector paging
 * through a series re-reads its boundary row and must be idempotent about it.
 *
 * **THERE IS NO `isNotNull` AND NONE IS REACHED FOR.** `ADR-157` refuses it by
 * name. `D-18` needs `footprint_present IS FALSE` rather than `IS NOT TRUE`
 * (`M07:141`, and it is the difference between a supplier outage and a flood of
 * flags against real customers), and `IS FALSE` is an EQUALITY on `false`, which
 * the accessor has always had. Nothing in the detector set needs the term
 * `ADR-157` withheld.
 */
export interface DetectorTerms {
  /** `column <= value`, inclusive. */
  atMost(value: NonNullable<unknown>): DetectorFilterTerm;
  /** `column >= value`, inclusive. */
  atLeast(value: NonNullable<unknown>): DetectorFilterTerm;
  /** `column IS NULL`. */
  isNull(): DetectorFilterTerm;
}

/** A filter, by Drizzle property name. `ADR-112`'s shape. */
export type DetectorFilter = Readonly<Record<string, unknown>>;

/** A set of values to write, by Drizzle property name. */
export type DetectorValues = Readonly<Record<string, unknown>>;

/** One row as a detector sees it. */
export type DetectorRow = Readonly<Record<string, unknown>>;

// -----------------------------------------------------------------------------
// One open transaction, as a detector run needs to see it
// -----------------------------------------------------------------------------

/**
 * One open transaction.
 *
 * **`updateAt` AND `deleteAt` ARE ABSENT AND THAT IS SECTION 2 OF THIS FILE'S
 * HEADER.** `ADR-112` removed `update` and `delete` from every transaction
 * handle in this workspace; what this port removes on top is the ADDRESSED
 * write, so `INV-M7-02` is a property of the type rather than of a value
 * somebody remembered not to set. A detector run inserts and reads and does
 * nothing else.
 *
 * **THERE IS NO `lockAt` EITHER, AND ITS ABSENCE IS DIFFERENT IN KIND.** The
 * expiry sweep one directory over locks because it is the third door onto a
 * transition two route handlers also write. A detector run writes rows nobody
 * else writes -- a new `detector_runs` row, new `risk_flags` rows -- so there is
 * no row to contend for and `ADR-157` clause 4's row lock buys nothing. Two
 * concurrent runs of the same detector on the same day produce two run rows,
 * which is correct: `detector_runs` has no unique key on `(detector,
 * trading_day)` and `0008_risk.sql`'s index is `DESC` on the day precisely so
 * the newest is the one read.
 */
export interface DetectorTx {
  /**
   * Rows matching a filter. MANY rows, and the READ path is the only place a
   * term may appear (`ADR-157`).
   */
  rowsWhere(key: DetectorReadTable, where: DetectorFilter): Promise<unknown[]>;
  /** Write one row, returning it. */
  insert(key: DetectorWriteTable, values: DetectorValues): Promise<unknown[]>;
}

// -----------------------------------------------------------------------------
// The registry, which is `P7-d`'s seed and `INV-M7-04`'s answer
// -----------------------------------------------------------------------------

/**
 * The `detector_definitions` row a run executes under.
 *
 * **`INV-M7-04` IS WHY THE RUNNER READS THIS RATHER THAN TAKING A VERSION FROM
 * THE DETECTOR'S OWN CODE**: "Every flag names the detector AND ITS VERSION AND
 * PARAMETERS AS OF THAT RUN ... 'Why did this not fire in March' must be
 * answerable from data, and it cannot be if parameters live only in code."
 *
 * A detector whose thresholds are constants in a `.ts` file has no version and
 * no effective date, so the chain `risk_flags.detector_run_id ->
 * detector_runs.(detector, detector_version) -> detector_definitions.parameters`
 * is only unbroken if the version the run records is a version that EXISTS. The
 * runner refuses to run a detector with no current registry row rather than
 * inventing one, and `P7-d`'s seed is what fills the table
 * (`packages/db/src/seed/detectors/`).
 *
 * `parameters` IS OPAQUE HERE AND STRUCTURED THERE. Each value in the seed is
 * `{state, value, unit, cite, quote}` rather than a bare number, and eleven of
 * the eighteen rows are `unstated` throughout, so a detector reading a threshold
 * has to handle a `null` it cannot run without. {@link DetectorDeclined} is the
 * named way to say so.
 */
export interface DetectorDefinition {
  readonly detector: string;
  readonly version: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly isSensitive: boolean;
}

// -----------------------------------------------------------------------------
// What a detector declares, and what it returns
// -----------------------------------------------------------------------------

/**
 * One window a detector reads.
 *
 * `name` IS THE DETECTOR'S OWN LABEL AND NOT THE TABLE. A detector reading
 * `fills` twice -- one window for the cluster and one for the population it
 * compares against -- names them separately, and the canary rows a subject
 * carries are merged into the stream of the same name. `table` is what crosses
 * to the accessor.
 */
export interface DetectorStream {
  readonly name: string;
  readonly table: DetectorReadTable;
  readonly where: DetectorFilter;
}

/** Everything a detector knows before it reads a row. */
export interface DetectorScanRequest {
  readonly detector: string;
  /** The trading day the run is FOR, `YYYY-MM-DD`. */
  readonly tradingDay: string;
  /** The registry row, which is where every threshold comes from. */
  readonly definition: DetectorDefinition;
  /** `ADR-157`'s constructors, so a detector can build its window. */
  readonly terms: DetectorTerms;
  /** The run's instant. The only clock a detector has. */
  readonly now: Date;
}

/** What a detector is handed to compute over. */
export interface DetectorScanInput {
  readonly request: DetectorScanRequest;
  /**
   * The rows, by stream name, REAL AND SYNTHETIC TOGETHER AND INDISTINGUISHABLE.
   *
   * That indistinguishability is the entire value of the battery: a detector
   * that could tell a canary from a real subject could pass by finding only
   * canaries, which is `AS-M7-05`'s failure wearing a green dashboard. The
   * runner separates them AFTERWARDS, by the identifiers a finding names.
   */
  readonly rows: Readonly<Record<string, readonly DetectorRow[]>>;
}

/**
 * One thing a detector found.
 *
 * **THERE IS NO `status` FIELD AND THERE MUST NEVER BE ONE.** Section 2 of this
 * file's header. `enforced` is not a value a detector avoids; it is a word with
 * nowhere to go.
 *
 * **THERE IS NO `detectorRunId` FIELD EITHER**, and that absence is
 * `INV-M7-04`'s. The run identifier does not exist until the run row is written,
 * so a detector could not supply it, and a detector that could would be able to
 * attribute its finding to somebody else's run.
 */
export interface DetectorFinding {
  /**
   * The identifiers this finding is ABOUT, which is how the runner tells a real
   * finding from a canary hit.
   *
   * **A FINDING NAMING BOTH A REAL AND A SYNTHETIC ACTOR IS REFUSED RATHER THAN
   * ROUNDED EITHER WAY.** Counting it as real would accuse a trader on evidence
   * partly manufactured by Merit, which is the worst outcome available here;
   * counting it as synthetic would suppress a real flag. `DetectorCanaryLeak`
   * is the refusal, and it fails the whole run rather than the finding, because
   * a detector that can mix them has an input-assembly bug and none of its other
   * findings are trustworthy either.
   */
  readonly subjects: readonly string[];
  /** `risk_flags.identity_id`. Flags attach to humans, never to accounts. */
  readonly identityId: string;
  /** `risk_flags.account_id`, when the finding is account-specific. */
  readonly accountId?: string;
  /** `risk_flags.flag_type`. `0008_risk.sql:119` lists the vocabulary. */
  readonly flagType: string;
  /**
   * `risk_flags.severity`, 1 to 5.
   *
   * **A MONEY DECISION EVERY TIME IT IS WRITTEN.** `M07` section 3.3: severity
   * is contextual rather than per-detector and moving a detector from 3 to 4
   * changes who gets held, because 4 and 5 is the band `G-HOLD-REQUIRED` reads
   * to hold a payout for 48 hours under `ADR-040`.
   */
  readonly severity: number;
  /**
   * `risk_flags.evidence`. THE NUMBERS BEHIND THE ACCUSATION, NEVER A BARE
   * LABEL.
   *
   * `INV-M7-03`: not null, schema-validated per `flag_type`, and a flag with an
   * empty evidence object is rejected at write. The runner rejects the empty
   * object here; the per-type schema is `P7-i`'s and `P7-j`'s and is not
   * pretended at.
   */
  readonly evidence: Readonly<Record<string, unknown>>;
  /**
   * `risk_flags.sla_due_at`. REQUIRED at severity 4 and 5.
   *
   * `0008_risk.sql`'s `risk_flags_high_severity_has_sla`. The runner refuses the
   * finding rather than letting the database refuse the transaction, so the
   * error names the detector instead of naming a constraint.
   */
  readonly slaDueAt?: Date;
}

/**
 * One `correlation_groups` row, which is `SD-M7-05` and is `P7-g`'s to produce.
 *
 * **`statistic` AND `threshold` ARE STRINGS AND A `number` IS REFUSED RATHER
 * THAN COERCED.** Both columns are `numeric` in `0008_risk.sql:213`, which that
 * migration justifies in its own words -- "numeric rather than bigint because
 * these are STATISTICS, not money ... rounding it to cents would be the actual
 * error" -- and `pg` hands a `numeric` back as a string for the reason
 * `ADR-157` section 5 finding 8 states: the naive `Number()` on one is lossy.
 * An exact decimal written as a string round-trips; a `number` written into a
 * `numeric` has already been through a binary float.
 *
 * **`memberAccountIds` MUST HOLD AT LEAST THREE.**
 * `correlation_groups_is_a_group` requires it, and `0008_risk.sql:220` gives the
 * reason: "A group of one is a pair detector with extra steps; a group of two is
 * `identity_links`' job." The runner refuses a shorter group rather than
 * producing a `23514`.
 */
export interface DetectorGroup {
  readonly subjects: readonly string[];
  readonly memberAccountIds: readonly string[];
  readonly method: string;
  readonly statistic: string;
  readonly threshold: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

/** What a detector returns. */
export interface DetectorOutcome {
  readonly findings: readonly DetectorFinding[];
  readonly groups?: readonly DetectorGroup[];
}

/**
 * One detector.
 *
 * `P7-f`, `P7-g` and `P7-h` each implement several of these in one module, and
 * the runner is agnostic about which. That is `ADR-100`'s shape applied one
 * deployable over, reached by hand because `apps/worker` has no route registry
 * to inherit it from (`P7` section 5.5).
 */
export interface Detector {
  /** `D-01` to `D-18`, and it must match a `detector_definitions.detector`. */
  readonly id: string;
  /**
   * The windows this detector reads, given the registry row and `ADR-157`'s
   * constructors.
   *
   * IT MAY RETURN NONE. A detector whose whole input is its canaries is a
   * detector under construction, and the run is still recorded.
   */
  streams(request: DetectorScanRequest): readonly DetectorStream[];
  /**
   * This run's synthetic subjects, minted from `mint` and never from a constant.
   *
   * **IT MUST RETURN AT LEAST ONE AND THE RUNNER REFUSES A DETECTOR THAT
   * RETURNS NONE.** `detector_runs_synthetics_match_status` reads
   * "status <> 'ok' OR synthetic_found >= synthetic_expected", so a detector
   * seeding zero canaries reports `ok` at `0 >= 0` FOREVER, which is exactly the
   * green dashboard `AS-M7-05` exists to refuse. The DDL cannot catch it, so the
   * runner does. `M07` section 8 rows the synthetic-canary suite at one per
   * detector, every run, in prod.
   */
  canaries(mint: CanaryMint): readonly CanarySubject[];
  /** Compute over the rows. */
  scan(input: DetectorScanInput): Promise<DetectorOutcome> | DetectorOutcome;
}

// -----------------------------------------------------------------------------
// The events, as a port that takes the transaction
// -----------------------------------------------------------------------------

/**
 * The two events a detector run emits, by their registry names.
 *
 * `flag.raised` is `EVENTS` section 8's row, producer "Detector".
 * `detector.run_completed` is the same section's row, producer "Worker".
 * `detector.run_degraded` is `M07` section 5's row, marked NEW, with the payload
 * "{ detector, detector_version, trading_day, synthetic_expected,
 * synthetic_found, rows_scanned }" and consumers "ALERT (page), FEED".
 *
 * **`detector.run_degraded` IS NOT YET A ROW IN `EVENTS.md` AND THAT IS
 * REPORTED RATHER THAN REPAIRED.** `docs/architecture/EVENTS.md` section 8
 * carries `detector.run_completed` and not the degraded name; `M07` section 5
 * carries it as one of three NEW events, and `docs/sessions/session-161` already
 * recorded that all three "appear in no `.ts` or `.mjs`". `EVENTS.md` is outside
 * this slice's fence and `ADR-159` clause 1 makes the authority for a name the
 * registry rather than a producer, so the payload here is transcribed from
 * `M07` section 5 field for field and the catalogue gap is a finding in the
 * pull-request body.
 */
export type DetectorEventName = 'detector.run_completed' | 'detector.run_degraded' | 'flag.raised';

/** One event, name and payload. */
export interface DetectorEvent {
  readonly name: DetectorEventName;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * The event sink.
 *
 * IT TAKES THE TRANSACTION, which is `ADR-006`'s criterion relied on rather than
 * restated: `detector.run_degraded` commits with the run row that is degraded,
 * or neither does. **A degraded run whose page was lost because the emit
 * succeeded and the transaction rolled back is `AS-M7-05` with an extra step**,
 * and the whole subject of that entry is a failure nobody learns about.
 *
 * NOTHING IN THIS WORKSPACE WRITES AN EVENT YET. `P5-n` is the slice that builds
 * the producer and `events` is registered by `P5-b`; both are outside this
 * fence. This file declares WHAT is emitted and refuses to invent a sink, which
 * is `sweeps/ports.ts`'s disposition one directory over.
 */
export interface DetectorEventPort {
  emit(tx: DetectorTx, event: DetectorEvent): Promise<void>;
}

// -----------------------------------------------------------------------------
// Everything the runner cannot do for itself
// -----------------------------------------------------------------------------

/**
 * The run's whole outside world.
 *
 * `transact` TAKES THE UNIT OF WORK rather than handing back a handle, which is
 * `ApiDb`'s, `AdminPayoutBackend`'s and `WorkerDb.batch`'s shape and their
 * reason: a transaction cannot outlive the function that opened it and no caller
 * has a `commit` to forget. **`apps/worker/src/db.ts` ALREADY SATISFIES IT**:
 * `LIVE_DB.batch` is `transaction(systemDb('nightly-batch'), fn)`, and `M07`
 * section 1.1 makes a detector run nightly, so the reason `ADR-165` spent is the
 * one this job needs and `SystemReason` gains no member (`P7` section 11 rule
 * 10, `ADR-165`'s own header).
 *
 * `now` IS INJECTED AND IS THE ONLY CLOCK. The run's `started_at` and
 * `finished_at`, and every `sla_due_at` a finding carries, are derived from it,
 * so a fixture pins the whole run and the database never supplies an instant.
 *
 * `nonce` IS CALLED ONCE PER RUN AND ITS FRESHNESS IS THE ADAPTER'S PROMISE.
 * `AS-M7-05` note 2: a static battery lets a detector that memorized it pass
 * while broken. The runner enforces that every subject carries THIS run's nonce
 * (`carriesNonce`), which makes a memorized BATTERY unusable; what it cannot see
 * from inside one run is an adapter that returns the same nonce twice, so the
 * adapter must draw from a source with real entropy and the suite asserts
 * disjointness across two runs.
 */
export interface DetectorRunnerIo {
  transact<T>(fn: (tx: DetectorTx) => Promise<T>): Promise<T>;
  readonly terms: DetectorTerms;
  readonly events: DetectorEventPort;
  now(): Date;
  nonce(): CanaryNonce;
}

/**
 * Raised by a detector that cannot run under the registry row it was given.
 *
 * **IT IS A NAMED WAY TO SAY "I HAVE NO THRESHOLD" AND IT IS NOT `ok`.** Eleven
 * of the eighteen rows in `P7-d`'s seed carry no number at all -- every
 * parameter `unstated`, with the `M07` phrase that names the knob and no value
 * -- because `OQ-M7-02` is the founder's and the seed writes no number it cannot
 * cite. A detector reading `{state: 'unstated', value: null}` and running anyway
 * would either invent a threshold or match nothing, and matching nothing is
 * `FM-M7-01` exactly: "detection appears healthy and is absent."
 *
 * The runner records the run as `failed`. **THERE IS NO FOURTH `detector_runs`
 * STATUS AND NONE IS INVENTED HERE**: `0008_risk.sql:87` gives three, this slice
 * holds no migration number, and `failed` is the honest one of the three,
 * because the run did not produce an answer. `CRON_INVENTORY`'s dead-man switch
 * and `detector_runs_unhealthy_idx` both read `status <> 'ok'`, so a declined
 * run is visible to the morning read on the day it happens.
 */
export class DetectorDeclined extends Error {
  readonly detector: string;
  constructor(detector: string, why: string) {
    super(`${detector} declined to run: ${why}`);
    this.name = 'DetectorDeclined';
    this.detector = detector;
  }
}

/**
 * Raised by a port that is not installed.
 *
 * A RUNNER THAT RETURNED PLAUSIBLE VALUES WOULD BE A FIXTURE REPORTING
 * DETECTION HEALTH, and the value it would have to invent is whether Merit is
 * currently detecting anything at all. That is `AS-M7-05`'s failure produced
 * deliberately, so the default refuses rather than returning an empty report:
 * an empty report is indistinguishable from a clean night, which is the sentence
 * this entire slice exists to make false.
 */
export class DetectorRunnerUnwired extends Error {
  constructor(what: string) {
    super(
      `DetectorRunnerIo.${what} cannot be served by this deployment: no adapter is installed. The ` +
        'detector runner refuses rather than returning a plausible value, because an empty report ' +
        'is indistinguishable from a clean night and that is exactly the failure AS-M7-05 names.',
    );
    this.name = 'DetectorRunnerUnwired';
  }
}

/**
 * The unwired default, which serves nothing.
 *
 * `CRON_INVENTORY`'s detector-runs row alarms on the run's ABSENCE as well as on
 * canaries not found, so a deployment holding this default is a deployment whose
 * detector runs are absent and is alarmed as such.
 */
export const UNWIRED_DETECTOR_RUNNER_IO: DetectorRunnerIo = {
  transact: () => Promise.reject(new DetectorRunnerUnwired('transact')),
  terms: {
    atMost: () => {
      throw new DetectorRunnerUnwired('terms.atMost');
    },
    atLeast: () => {
      throw new DetectorRunnerUnwired('terms.atLeast');
    },
    isNull: () => {
      throw new DetectorRunnerUnwired('terms.isNull');
    },
  },
  events: { emit: () => Promise.reject(new DetectorRunnerUnwired('events.emit')) },
  now: () => {
    throw new DetectorRunnerUnwired('now');
  },
  nonce: () => {
    throw new DetectorRunnerUnwired('nonce');
  },
};

/** Re-exported so a detector module names one import for the canary types. */
export type { CanaryMint, CanaryNonce, CanarySubject };
