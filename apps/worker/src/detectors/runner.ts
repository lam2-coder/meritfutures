// =============================================================================
// apps/worker/src/detectors/runner.ts
// =============================================================================
// `detector_runs` GETS ITS FIRST PRODUCER, AND EVERY RUN PROVES IT STILL WORKS
// BEFORE IT IS BELIEVED. `P7` section 8's `P7-e`, `P7`'s first done-gate.
//
// -----------------------------------------------------------------------------
// THE ONE SENTENCE THIS FILE EXISTS TO MAKE FALSE
// -----------------------------------------------------------------------------
// "`detector_runs` records `status: ok`, `rows_scanned: 0`, `flags_raised: 0`.
// THAT IS INDISTINGUISHABLE FROM A GENUINELY QUIET NIGHT, and quiet nights are
// the normal case, so nobody looks." (`AS-M7-05`, `M07:343`.)
//
// `INV-M7-07` is the invariant: "Every detector run is recorded, including runs
// that raised nothing, and a run that finds no synthetic canary is a FAILURE."
// `GS-122` is the scenario. `FM-M7-01` calls it the worst failure in the module,
// because "everything downstream reads a green dashboard."
//
// -----------------------------------------------------------------------------
// WHAT A RUN DOES, IN ORDER, AND WHY THE ORDER IS THE DESIGN
// -----------------------------------------------------------------------------
//  1. **Read the registry row.** `INV-M7-04`. A detector with no current
//     `detector_definitions` row does not run at all, because a run that cannot
//     record the parameters it ran under cannot answer "why did this not fire in
//     March". The version and the thresholds both come from the row and never
//     from a constant in a detector's own module.
//  2. **Read the windows.** `ADR-157` section 5's grant: a range term, an
//     `IS NULL` term, and the join done here rather than in SQL. The cost is the
//     window's rows rather than the match's and it is reported per stream.
//  3. **Mint the canaries.** From THIS run's nonce, and every identifier is
//     checked against it, so a memorized battery cannot pass (`AS-M7-05` note
//     2).
//  4. **Merge, and hand the detector one indistinguishable input.** A detector
//     that could tell a canary from a real subject could pass by finding only
//     canaries.
//  5. **Partition the findings by identifier.** Canary hits count towards
//     `synthetic_found`; real findings become `risk_flags`. A finding naming
//     BOTH is refused and fails the run.
//  6. **Record the run, then the flags, then the events**, in one transaction,
//     with the run row first because every flag references it.
//
// -----------------------------------------------------------------------------
// THE SYNTHETIC SUBJECTS ARE EXCLUDED FROM EVERY AGGREGATE BY NEVER EXISTING
// -----------------------------------------------------------------------------
// `AS-M7-05`'s first implementation note, and `canary.ts`'s header is the
// argument. A canary is minted in memory and discarded when the run ends; there
// is no row to exclude, so every aggregate excludes it, including the ones
// nobody has written yet. What this file adds on top is three assertions the
// suite reads:
//
//   (a) `rows_scanned` counts the REAL rows only. The canary rows are added to
//       the detector's input after the count is taken.
//   (b) `flags_raised` counts the REAL findings only, and a canary hit writes no
//       `risk_flags` row at all.
//   (c) A row arriving FROM the database carrying a canary identifier fails the
//       run on {@link DetectorCanaryLeak}. That is the check that would catch a
//       future session persisting a battery.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE MUST NOT GROW
// -----------------------------------------------------------------------------
// No `SqlExecutorReason` member, no `SystemReason` member, no `pg` import, no
// `@merit/db` import at all, and no cast past a key type. `P7` section 11 rule
// 10, `ADR-157` section 5, and `ADR-165`: `apps/worker/src/db.ts` is this
// deployable's one door and `test/db.test.ts` asserts it by walking `src/`.
//
// No path to `enforced`, ever. `ADR-155`, `INV-M7-02`, `P7` rule 11. The port
// has no addressed write and the finding has no `status`, so there is nothing
// here to remember not to do.
// =============================================================================

import type { CanaryNonce, CanarySubject } from './canary.ts';
import { canaryMint, canarySubjectOf, carriesNonce, isCanaryId } from './canary.ts';
import type {
  Detector,
  DetectorDefinition,
  DetectorEvent,
  DetectorFinding,
  DetectorGroup,
  DetectorRow,
  DetectorRunStatus,
  DetectorRunnerIo,
  DetectorScanRequest,
  DetectorTx,
} from './ports.ts';
import { FLAG_SOURCE_INTERNAL, FLAG_STATUS_ON_RAISE, SLA_REQUIRED_AT_SEVERITY } from './ports.ts';

/**
 * Raised when a synthetic subject and a real one meet somewhere they must not.
 *
 * THREE PLACES CAN RAISE IT AND ALL THREE ARE THE SAME FAILURE SEEN FROM A
 * DIFFERENT SIDE: a row read from the database carries a canary identifier
 * (somebody persisted a battery), a finding names both a real and a synthetic
 * actor (the detector's input assembly is wrong), or a finding names a canary
 * this run did not mint (the detector is holding a battery from somewhere else).
 *
 * **IT FAILS THE WHOLE RUN RATHER THAN THE FINDING.** A detector that can mix
 * them is a detector none of whose other findings are trustworthy, and the cost
 * of a `failed` run is a page; the cost of writing the finding is a `risk_flags`
 * row accusing a trader on evidence Merit manufactured.
 */
export class DetectorCanaryLeak extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DetectorCanaryLeak';
  }
}

/**
 * Raised when the battery itself is unusable.
 *
 * A detector minting NO canaries is the headline case and it is the cheap
 * implementation this gate exists to refuse: `detector_runs_synthetics_match_
 * status` reads "status <> 'ok' OR synthetic_found >= synthetic_expected", so a
 * run seeding zero reports `ok` at `0 >= 0` every night forever. The DDL cannot
 * see it. The other cases are a subject whose identifiers do not carry this
 * run's nonce (`AS-M7-05` note 2: a memorized battery) and two subjects sharing
 * an identifier, which would make `synthetic_found` uncountable.
 */
export class DetectorBatteryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DetectorBatteryError';
  }
}

/**
 * Raised when a finding cannot become a `risk_flags` row.
 *
 * **IT IS RAISED AT THE PORT AND NOT AT THE DATABASE, DELIBERATELY.** Every
 * condition here is a CHECK in `0008_risk.sql`, and letting the database refuse
 * them produces a `23514` naming a constraint at 02:00, inside a transaction
 * that rolls back the run row too, so `INV-M7-07`'s "every run is recorded"
 * fails at the same moment. Refusing here names the detector and the finding,
 * and the run is still recorded as `failed`.
 */
export class DetectorFindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DetectorFindingError';
  }
}

/**
 * Raised when the registry cannot say what a detector would have run under.
 *
 * `INV-M7-04`. Two shapes: no current row, and MORE THAN ONE current row.
 *
 * **THE SECOND IS REACHABLE AND THE SCHEMA DOES NOT STOP IT.**
 * `0008_risk.sql:52` creates `detector_definitions_current_idx ON
 * detector_definitions (detector) WHERE effective_to IS NULL` and that index is
 * NOT UNIQUE, so two overlapping current rows are insertable. A runner picking
 * one of them would record a version, and the version it recorded would be a
 * coin toss nobody could reconstruct, which is `INV-M7-04` failing while
 * appearing to hold. The code path is the control until somebody makes the index
 * unique, and that is a migration this slice does not hold.
 */
export class DetectorUnregistered extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DetectorUnregistered';
  }
}

/** What one detector's run came to. */
export interface DetectorRunOutcome {
  readonly detector: string;
  /** From the registry row. `undefined` only when the registry read failed. */
  readonly detectorVersion: string | undefined;
  readonly status: DetectorRunStatus;
  /** REAL rows only. The canaries are added after this is counted. */
  readonly rowsScanned: number;
  /** REAL rows per declared stream, so a window that is too wide is legible. */
  readonly rowsByStream: Readonly<Record<string, number>>;
  /** REAL findings written as `risk_flags`, at `open`. */
  readonly flagsRaised: number;
  /** REAL groups written as `correlation_groups`. */
  readonly groupsRecorded: number;
  readonly syntheticExpected: number;
  readonly syntheticFound: number;
  /** The canary subjects this run seeded and did not find. `GS-122`'s subject. */
  readonly syntheticMissing: readonly string[];
  /** Whether the `detector_runs` row was written. `INV-M7-07`. */
  readonly recorded: boolean;
  readonly runId: string | undefined;
  readonly error: string | undefined;
}

/** What the whole invocation came to. */
export interface DetectorRunReport {
  readonly tradingDay: string;
  /** The nonce every canary in this report was minted under. */
  readonly nonce: CanaryNonce;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly outcomes: readonly DetectorRunOutcome[];
  /** Detectors that found fewer canaries than they seeded. Each one pages. */
  readonly degraded: readonly string[];
  /** Detectors that did not produce an answer. */
  readonly failed: readonly string[];
  /** Detectors whose `detector_runs` row could not be written. */
  readonly unrecorded: readonly string[];
}

/** What the caller supplies per invocation. */
export interface DetectorRunConfig {
  /** The trading day the run is FOR, `YYYY-MM-DD`. */
  readonly tradingDay: string;
}

/**
 * Run a set of detectors for one trading day.
 *
 * **ONE TRANSACTION TO READ AND ONE TO WRITE, PER DETECTOR, AND THE SPLIT IS
 * `INV-M7-07`.** A read that throws poisons its transaction, and a run whose
 * read failed is exactly the run that most needs a row: "a query that used to
 * scan 200,000 rows now scans zero" is `AS-M7-05`'s first sentence. So the read
 * is attempted, the failure is caught, and the `failed` row is written through a
 * transaction of its own.
 *
 * **ONE DETECTOR'S FAILURE NEVER STOPS ANOTHER'S.** Each is caught, recorded and
 * reported, because a runner that aborted on the first bad detector would give
 * the estate one bad detector and seventeen absent ones, and the dead-man switch
 * cannot tell an absent run from a run nobody scheduled.
 */
export async function runDetectors(
  detectors: readonly Detector[],
  config: DetectorRunConfig,
  io: DetectorRunnerIo,
): Promise<DetectorRunReport> {
  const startedAt = io.now();
  // ONE NONCE PER INVOCATION. A run is the unit AS-M7-05 says the battery is
  // regenerated per, and the detector's own identifier is already a segment of
  // every canary identifier, so one nonce still gives every detector a battery
  // of its own.
  const nonce = io.nonce();
  const outcomes: DetectorRunOutcome[] = [];
  for (const detector of detectors) {
    outcomes.push(await runOne(detector, config, io, nonce));
  }
  return {
    tradingDay: config.tradingDay,
    nonce,
    startedAt,
    finishedAt: io.now(),
    outcomes,
    degraded: outcomes.filter((o) => o.status === 'degraded').map((o) => o.detector),
    failed: outcomes.filter((o) => o.status === 'failed').map((o) => o.detector),
    unrecorded: outcomes.filter((o) => !o.recorded).map((o) => o.detector),
  };
}

/** What the read leg produced, or why it did not. */
interface ScanResult {
  readonly definition: DetectorDefinition | undefined;
  readonly rowsByStream: Record<string, number>;
  readonly rowsScanned: number;
  readonly findings: readonly DetectorFinding[];
  readonly groups: readonly DetectorGroup[];
  readonly expected: readonly CanarySubject[];
  readonly found: ReadonlySet<string>;
  readonly error: Error | undefined;
}

async function runOne(
  detector: Detector,
  config: DetectorRunConfig,
  io: DetectorRunnerIo,
  nonce: CanaryNonce,
): Promise<DetectorRunOutcome> {
  const startedAt = io.now();
  const scan = await attemptScan(detector, config, io, nonce);
  const finishedAt = io.now();

  const expected = scan.expected.length;
  const found = scan.found.size;
  const missing = scan.expected.filter((s) => !scan.found.has(s.id)).map((s) => s.id);

  // THE STATE MACHINE, AND IT HAS THREE STATES BECAUSE `0008_risk.sql:87` HAS
  // THREE. `failed` is a run that produced no answer; `degraded` is a run that
  // produced an answer nobody may trust, which is why SD-M7-01 made them
  // distinct -- "a single failure state hides one inside the other".
  const status: DetectorRunStatus =
    scan.error !== undefined ? 'failed' : found < expected ? 'degraded' : 'ok';

  const findings = status === 'ok' || status === 'degraded' ? scan.findings : [];
  const groups = status === 'ok' || status === 'degraded' ? scan.groups : [];
  const version = scan.definition?.version;

  let recorded = false;
  let runId: string | undefined;
  let writeError: Error | undefined;
  try {
    runId = await io.transact(async (tx) => {
      const id = await insertRun(tx, {
        detector: detector.id,
        detectorVersion: version ?? UNREGISTERED_VERSION,
        tradingDay: config.tradingDay,
        startedAt,
        finishedAt,
        rowsScanned: scan.rowsScanned,
        flagsRaised: findings.length,
        syntheticExpected: expected,
        syntheticFound: found,
        status,
      });
      for (const finding of findings) {
        await insertFlag(tx, io, detector.id, version, config, id, finding);
      }
      for (const group of groups) {
        await insertGroup(tx, config, id, group);
      }
      await emitRunEvents(tx, io, {
        detector: detector.id,
        version,
        tradingDay: config.tradingDay,
        rowsScanned: scan.rowsScanned,
        flagsRaised: findings.length,
        syntheticExpected: expected,
        syntheticFound: found,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        status,
      });
      return id;
    });
    recorded = true;
  } catch (cause) {
    writeError = asError(cause);
  }

  return {
    detector: detector.id,
    detectorVersion: version,
    status,
    rowsScanned: scan.rowsScanned,
    rowsByStream: scan.rowsByStream,
    flagsRaised: recorded ? findings.length : 0,
    groupsRecorded: recorded ? groups.length : 0,
    syntheticExpected: expected,
    syntheticFound: found,
    syntheticMissing: missing,
    recorded,
    runId,
    error: describe(scan.error, writeError),
  };
}

/**
 * The version recorded when the registry could not be read.
 *
 * `detector_runs.detector_version` is `text NOT NULL` and there is nothing
 * honest to put in it when the row that would have supplied it could not be
 * found. **A BLANK STRING WOULD SATISFY THE COLUMN AND LOOK LIKE A VERSION**, so
 * the value says what happened instead, and the run's `status` is `failed`
 * beside it. It is deliberately not a plausible version string: nothing should
 * ever join on it.
 */
export const UNREGISTERED_VERSION = 'unregistered';

async function attemptScan(
  detector: Detector,
  config: DetectorRunConfig,
  io: DetectorRunnerIo,
  nonce: CanaryNonce,
): Promise<ScanResult> {
  const empty = {
    rowsByStream: {},
    rowsScanned: 0,
    findings: [],
    groups: [],
    expected: [],
    found: new Set<string>(),
  };
  let definition: DetectorDefinition | undefined;
  try {
    const read = await io.transact(async (tx) => {
      const def = await readDefinition(tx, io, detector.id);
      definition = def;
      const request: DetectorScanRequest = {
        detector: detector.id,
        tradingDay: config.tradingDay,
        definition: def,
        terms: io.terms,
        now: io.now(),
      };
      const rows: Record<string, DetectorRow[]> = {};
      const rowsByStream: Record<string, number> = {};
      for (const stream of detector.streams(request)) {
        const window = (await tx.rowsWhere(stream.table, stream.where)) as DetectorRow[];
        // (c). A REAL ROW CARRYING A CANARY IDENTIFIER MEANS A BATTERY WAS
        // PERSISTED, which is the one way "excluded from every aggregate" can
        // stop being true of a design that never writes one.
        refuseCanaryRows(detector.id, stream.name, window);
        const into = (rows[stream.name] ??= []);
        into.push(...window);
        rowsByStream[stream.name] = (rowsByStream[stream.name] ?? 0) + window.length;
      }
      return { request, rows, rowsByStream };
    });

    // (a). THE COUNT IS TAKEN BEFORE THE CANARIES ARE ADDED. `rows_scanned` is a
    // statistic about real data and AS-M7-05's first note is unqualified:
    // "excluded from every aggregate, statistic, and published number".
    const rowsScanned = Object.values(read.rowsByStream).reduce((a, b) => a + b, 0);

    const expected = mintBattery(detector, nonce);
    const merged: Record<string, readonly DetectorRow[]> = { ...read.rows };
    for (const subject of expected) {
      for (const [stream, canaryRows] of Object.entries(subject.rows)) {
        merged[stream] = [...(merged[stream] ?? []), ...canaryRows];
      }
    }

    const outcome = await detector.scan({ request: read.request, rows: merged });
    const byId = new Map(expected.map((s) => [s.id, s]));
    const found = new Set<string>();
    const findings = outcome.findings.filter((f) =>
      partition(detector.id, f.subjects, byId, found, nonce),
    );
    const groups = (outcome.groups ?? []).filter((g) =>
      partition(detector.id, g.subjects, byId, found, nonce),
    );
    for (const finding of findings) {
      validateFinding(detector.id, finding);
    }
    for (const group of groups) {
      validateGroup(detector.id, group);
    }
    return {
      definition,
      rowsByStream: read.rowsByStream,
      rowsScanned,
      findings,
      groups,
      expected,
      found,
      error: undefined,
    };
  } catch (cause) {
    return { ...empty, definition, error: asError(cause) };
  }
}

/**
 * The battery, minted and then checked against this run's nonce.
 *
 * `AS-M7-05` NOTE 2 IS ENFORCED HERE AND NOWHERE ELSE. A detector answering
 * `canaries()` with an array built at module load, or with a fixture reused
 * between runs, returns identifiers carrying some other nonce, and the run is
 * refused rather than counting them. A detector cannot satisfy this by being
 * careful; it can only satisfy it by having minted from the mint it was handed.
 */
function mintBattery(detector: Detector, nonce: CanaryNonce): readonly CanarySubject[] {
  const subjects = detector.canaries(canaryMint(nonce));
  if (subjects.length === 0) {
    throw new DetectorBatteryError(
      `${detector.id} seeded no synthetic subjects. A run that seeds none satisfies ` +
        "detector_runs_synthetics_match_status at 0 >= 0 and reports 'ok' every night forever, " +
        'which is the green dashboard AS-M7-05 exists to refuse. M07 section 8 rows the synthetic ' +
        'canary suite at one per detector, every run, in prod.',
    );
  }
  const seen = new Set<string>();
  for (const subject of subjects) {
    if (seen.has(subject.id)) {
      throw new DetectorBatteryError(
        `${detector.id} minted two synthetic subjects with the identifier ${subject.id}. ` +
          'synthetic_found counts distinct subjects, so a duplicate makes the count that decides ' +
          'degraded unreadable.',
      );
    }
    seen.add(subject.id);
    if (!carriesNonce(subject.id, nonce)) {
      throw new DetectorBatteryError(
        `${detector.id} returned the synthetic subject ${subject.id}, which does not carry this ` +
          "run's nonce. AS-M7-05: the subjects must be regenerated per run rather than static, or " +
          'a detector that has memorized them passes while broken for real data.',
      );
    }
    for (const actor of subject.actors) {
      if (!carriesNonce(actor, nonce)) {
        throw new DetectorBatteryError(
          `${detector.id}'s synthetic subject ${subject.id} names the actor ${actor}, which does ` +
            "not carry this run's nonce.",
        );
      }
    }
  }
  return subjects;
}

/**
 * True when a finding is REAL and must become a row; false when it is a canary
 * hit.
 *
 * **A MIXED FINDING IS REFUSED AND THAT IS THE LOAD-BEARING LINE IN THIS FILE.**
 * Counting it real would put a `risk_flags` row against a trader whose evidence
 * is partly a subject Merit manufactured. Counting it synthetic would suppress a
 * real flag and hand a ring a way to hide behind the canary battery.
 */
function partition(
  detector: string,
  subjects: readonly string[],
  battery: ReadonlyMap<string, CanarySubject>,
  found: Set<string>,
  nonce: CanaryNonce,
): boolean {
  const canaries = new Set<string>();
  let real = 0;
  for (const subject of subjects) {
    const owner = canarySubjectOf(subject);
    if (owner === undefined) {
      real += 1;
      continue;
    }
    if (!carriesNonce(subject, nonce) || !battery.has(owner)) {
      throw new DetectorCanaryLeak(
        `${detector} produced a finding naming ${subject}, which is a canary identifier this run ` +
          'did not mint. A detector holding a battery from somewhere else can report found ' +
          'canaries while its real query is broken, which is AS-M7-05 with an extra step.',
      );
    }
    canaries.add(owner);
  }
  if (canaries.size > 0 && real > 0) {
    throw new DetectorCanaryLeak(
      `${detector} produced a finding naming both real and synthetic subjects ` +
        `(${subjects.join(', ')}). It is refused rather than rounded either way: counting it real ` +
        'accuses a person on evidence Merit manufactured, and counting it synthetic suppresses a ' +
        'real flag.',
    );
  }
  for (const owner of canaries) {
    found.add(owner);
  }
  return canaries.size === 0;
}

/** (c). A row from the database may never carry a canary identifier. */
function refuseCanaryRows(detector: string, stream: string, rows: readonly DetectorRow[]): void {
  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (isCanaryId(value)) {
        throw new DetectorCanaryLeak(
          `${detector} read a row on stream "${stream}" carrying the canary identifier ` +
            `${value}. A synthetic subject is minted in memory and never written, so a canary ` +
            'reaching the database means one was persisted, and AS-M7-05 requires them excluded ' +
            'from every aggregate, statistic and published number.',
        );
      }
    }
  }
}

function validateFinding(detector: string, finding: DetectorFinding): void {
  if (finding.identityId.length === 0 || isCanaryId(finding.identityId)) {
    throw new DetectorCanaryLeak(
      `${detector} produced a finding whose identityId is ${JSON.stringify(finding.identityId)} ` +
        'while its subjects are real. risk_flags.identity_id is who gets enforced against.',
    );
  }
  if (finding.accountId !== undefined && isCanaryId(finding.accountId)) {
    throw new DetectorCanaryLeak(
      `${detector} produced a finding whose accountId is the canary ${finding.accountId} while ` +
        'its subjects are real.',
    );
  }
  if (!Number.isInteger(finding.severity) || finding.severity < 1 || finding.severity > 5) {
    throw new DetectorFindingError(
      `${detector} produced a finding at severity ${String(finding.severity)}. ` +
        'risk_flags.severity is a smallint CHECKed BETWEEN 1 AND 5, and severity is a money ' +
        'decision every time it is written: 4 and 5 is the band G-HOLD-REQUIRED reads to hold a ' +
        'payout for 48 hours under ADR-040 (M07 section 3.3).',
    );
  }
  if (finding.severity >= SLA_REQUIRED_AT_SEVERITY && finding.slaDueAt === undefined) {
    throw new DetectorFindingError(
      `${detector} produced a severity ${String(finding.severity)} finding with no slaDueAt. ` +
        'risk_flags_high_severity_has_sla requires the clock at 4 and 5, because a severity-scored ' +
        'queue with no clock is a queue that grows (SD-M7-02), and evidence nobody acts on is ' +
        'worse than no detection because it is documented negligence.',
    );
  }
  if (Object.keys(finding.evidence).length === 0) {
    throw new DetectorFindingError(
      `${detector} produced a finding with empty evidence. INV-M7-03: every flag carries the ` +
        'numbers behind the accusation, never a bare label, and a flag with an empty evidence ' +
        'object is rejected at write.',
    );
  }
}

function validateGroup(detector: string, group: DetectorGroup): void {
  if (group.memberAccountIds.length < 3) {
    throw new DetectorFindingError(
      `${detector} produced a correlation group of ${String(group.memberAccountIds.length)} ` +
        'members. correlation_groups_is_a_group requires at least three: a group of one is a pair ' +
        "detector with extra steps and a group of two is identity_links' job (0008_risk.sql:220).",
    );
  }
  for (const value of [group.statistic, group.threshold]) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new DetectorFindingError(
        `${detector} produced a correlation group whose statistic or threshold is not an exact ` +
          'decimal string. Both columns are numeric, and pg hands a numeric back as a string ' +
          'because the naive Number() on one is lossy (ADR-157 section 5 finding 8).',
      );
    }
  }
}

// -----------------------------------------------------------------------------
// The registry read, which is `INV-M7-04`
// -----------------------------------------------------------------------------

async function readDefinition(
  tx: DetectorTx,
  io: DetectorRunnerIo,
  detector: string,
): Promise<DetectorDefinition> {
  // `effective_to IS NULL` IS WHAT "CURRENT" MEANS IN THE LANDED DDL.
  // `0008_risk.sql:52` indexes exactly that predicate, and `P7-d`'s seed says so
  // in its own `row_defaults`: "null IS the definition of current".
  const rows = await tx.rowsWhere('detectorDefinitions', {
    detector,
    effectiveTo: io.terms.isNull(),
  });
  if (rows.length === 0) {
    throw new DetectorUnregistered(
      `${detector} has no current detector_definitions row, so this run could not record the ` +
        'parameters it ran under and INV-M7-04 could not be satisfied. "Why did this not fire in ' +
        'March" must be answerable from data, and it cannot be if parameters live only in code. ' +
        "P7-d's seed at packages/db/src/seed/detectors is what fills the table.",
    );
  }
  if (rows.length > 1) {
    throw new DetectorUnregistered(
      `${detector} has ${String(rows.length)} current detector_definitions rows. ` +
        'detector_definitions_current_idx is NOT UNIQUE, so overlapping current rows are ' +
        'insertable, and a runner that picked one of them would record a version nobody could ' +
        'reconstruct. That is INV-M7-04 failing while appearing to hold, so the run is refused.',
    );
  }
  const row = rows[0] as Record<string, unknown>;
  const version = row['version'];
  const parameters = row['parameters'];
  if (typeof version !== 'string' || version.length === 0) {
    throw new DetectorUnregistered(
      `${detector}'s current detector_definitions row carries no version. It is half the primary ` +
        'key and it is what a flag joins back through.',
    );
  }
  if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) {
    throw new DetectorUnregistered(
      `${detector}'s current detector_definitions row carries no parameters object. The column is ` +
        'jsonb NOT NULL and every value in it is {state, value, unit, cite, quote} rather than a ' +
        "bare number, which is P7-d's seed shape.",
    );
  }
  return {
    detector,
    version,
    parameters: parameters as Readonly<Record<string, unknown>>,
    // `is_sensitive boolean NOT NULL DEFAULT true` (SD-M7-03). It is P7-j's
    // strip list under INV-M7-10 and this runner only carries it forward.
    isSensitive: row['isSensitive'] !== false,
  };
}

// -----------------------------------------------------------------------------
// The writes, and there are exactly three shapes of them
// -----------------------------------------------------------------------------

interface RunRow {
  readonly detector: string;
  readonly detectorVersion: string;
  readonly tradingDay: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly rowsScanned: number;
  readonly flagsRaised: number;
  readonly syntheticExpected: number;
  readonly syntheticFound: number;
  readonly status: DetectorRunStatus;
}

async function insertRun(tx: DetectorTx, values: RunRow): Promise<string> {
  const written = await tx.insert('detectorRuns', { ...values });
  const id = (written[0] as Record<string, unknown> | undefined)?.['id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new DetectorFindingError(
      `${values.detector}'s detector_runs insert returned no id. Every risk_flags row references ` +
        'it, and a flag with no run is a flag whose parameters nobody can reconstruct ' +
        '(INV-M7-04).',
    );
  }
  return id;
}

async function insertFlag(
  tx: DetectorTx,
  io: DetectorRunnerIo,
  detector: string,
  version: string | undefined,
  config: DetectorRunConfig,
  runId: string,
  finding: DetectorFinding,
): Promise<void> {
  const written = await tx.insert('riskFlags', {
    identityId: finding.identityId,
    ...(finding.accountId === undefined ? {} : { accountId: finding.accountId }),
    flagType: finding.flagType,
    severity: finding.severity,
    // THE ONE STATUS, STAMPED HERE AND READ FROM NOWHERE. ADR-155, INV-M7-02,
    // STATE_MACHINES section 7, P7 rule 11. DetectorFinding has no status field,
    // so there is no value a detector could have supplied instead.
    status: FLAG_STATUS_ON_RAISE,
    source: FLAG_SOURCE_INTERNAL,
    detectorRunId: runId,
    evidence: finding.evidence,
    firstDetectedOn: config.tradingDay,
    ...(finding.slaDueAt === undefined ? {} : { slaDueAt: finding.slaDueAt }),
  });
  const flagId = (written[0] as Record<string, unknown> | undefined)?.['id'];
  await io.events.emit(tx, {
    name: 'flag.raised',
    payload: {
      flag_id: flagId,
      identity_id: finding.identityId,
      account_id: finding.accountId,
      flag_type: finding.flagType,
      severity: finding.severity,
      detector,
      detector_version: version,
      // THE NAMES OF THE NUMBERS RATHER THAN THE NUMBERS.
      //
      // EVENTS section 8 gives the field as `evidence_summary` and defines it
      // nowhere, and its consumers include FEED. INV-M7-10 keeps detector
      // parameters away from a trader audience and INV-M7-03 keeps the numbers
      // ON the flag, where the admin console reads them. Sending the keys
      // carries what kind of accusation this is without carrying a threshold
      // into a consumer nobody has written yet; the numbers are one join away
      // for anything entitled to them. The field's definition is a finding for
      // the pull-request body rather than a decision this file may take.
      evidence_summary: Object.keys(finding.evidence).sort(),
    },
  });
}

async function insertGroup(
  tx: DetectorTx,
  config: DetectorRunConfig,
  runId: string,
  group: DetectorGroup,
): Promise<void> {
  await tx.insert('correlationGroups', {
    tradingDay: config.tradingDay,
    memberAccountIds: [...group.memberAccountIds],
    method: group.method,
    statistic: group.statistic,
    threshold: group.threshold,
    detectorRunId: runId,
    evidence: group.evidence,
  });
}

interface RunEventFacts {
  readonly detector: string;
  readonly version: string | undefined;
  readonly tradingDay: string;
  readonly rowsScanned: number;
  readonly flagsRaised: number;
  readonly syntheticExpected: number;
  readonly syntheticFound: number;
  readonly durationMs: number;
  readonly status: DetectorRunStatus;
}

/**
 * `detector.run_completed` on every run, and `detector.run_degraded` beside it
 * when the battery came back short.
 *
 * **BOTH, RATHER THAN ONE OR THE OTHER.** `EVENTS` section 8 gives
 * `run_completed` the consumers "BI, ALERT on failure", so BI's series has a
 * point for every run including the bad ones, and a degraded run that emitted
 * only the page would leave a hole in the series exactly where the interesting
 * night is. `detector.run_degraded`'s consumers are "ALERT (page), FEED"
 * (`M07` section 5) and its payload below is that row's, field for field.
 */
async function emitRunEvents(
  tx: DetectorTx,
  io: DetectorRunnerIo,
  facts: RunEventFacts,
): Promise<void> {
  const completed: DetectorEvent = {
    name: 'detector.run_completed',
    payload: {
      detector: facts.detector,
      detector_version: facts.version,
      trading_day: facts.tradingDay,
      rows_scanned: facts.rowsScanned,
      flags_raised: facts.flagsRaised,
      duration_ms: facts.durationMs,
    },
  };
  await io.events.emit(tx, completed);
  if (facts.status !== 'degraded') {
    return;
  }
  await io.events.emit(tx, {
    name: 'detector.run_degraded',
    payload: {
      detector: facts.detector,
      detector_version: facts.version,
      trading_day: facts.tradingDay,
      synthetic_expected: facts.syntheticExpected,
      synthetic_found: facts.syntheticFound,
      rows_scanned: facts.rowsScanned,
    },
  });
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function describe(scan: Error | undefined, write: Error | undefined): string | undefined {
  const parts = [scan, write]
    .filter((e): e is Error => e !== undefined)
    .map((e) => `${e.name}: ${e.message}`);
  return parts.length === 0 ? undefined : parts.join(' | ');
}
