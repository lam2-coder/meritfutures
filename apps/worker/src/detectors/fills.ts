// =============================================================================
// apps/worker/src/detectors/fills.ts
// =============================================================================
// THE THREE DETECTORS WHOSE INPUT IS `fills`: `D-01` FILL CLUSTERING, `D-04`
// NEWS-WINDOW CLUSTERING AND `D-05` MARTINGALE SEQUENCE. `P7` section 8's
// `P7-f`, written against `P7-e`'s ports and changing none of them.
//
// -----------------------------------------------------------------------------
// 1. THE THREE THINGS `P7` SAYS A CARELESS IMPLEMENTATION GETS WRONG
// -----------------------------------------------------------------------------
//  (a) **`D-01` RUNS ON INGEST AS WELL AS NIGHTLY** (`AS-M7-01` counter 2:
//      "Same-second fill clustering is computable the moment fills land and does
//      not need to wait for a batch"), and it **FILTERS SAME-IDENTITY PAIRS AT
//      THE DETECTOR** rather than dismissing them in the queue (`M07` section
//      3.4). Section 3 below is the ingest mode and section 4 is the filter.
//  (b) **`D-04` FIRES AS A PATTERN ACROSS MANY EVENTS AND NEVER ON ONE**
//      (`M07:111`, "never a single event"). The minimum is a registry parameter
//      and a registry that states `1` is REFUSED here rather than obeyed,
//      because `fires_on_single_event: false` is a stated row of the same
//      registry and the two cannot both be honoured.
//  (c) **EVERY ONE OF THE THREE SHIPS A NEAR-MISS FIXTURE BESIDE ITS POSITIVE**
//      (`M07` section 8). That is `test/detectors-fills.test.ts`'s subject and
//      the shapes here exist to make a near-miss expressible: every threshold
//      comparison below is an INTEGER cross-multiplication rather than a
//      division, so "just inside" and "just outside" differ by one unit and not
//      by a rounding.
//
// -----------------------------------------------------------------------------
// 2. EVERY THRESHOLD COMES FROM `detector_definitions` AND NONE FROM THIS FILE
// -----------------------------------------------------------------------------
// `INV-M7-04`: "Every flag names the detector AND ITS VERSION AND PARAMETERS AS
// OF THAT RUN ... 'Why did this not fire in March' must be answerable from data,
// and it cannot be if parameters live only in code." `P7-d` seeded the registry
// and the seed IS the registry.
//
// **SO ELEVEN OF THE SEVENTEEN NUMBERS THESE THREE DETECTORS NEED ARE `null`
// TODAY AND THAT IS THE HONEST STATE RATHER THAN A GAP THIS FILE FILLS.**
// `packages/db/src/seed/detectors/m07-detectors-v1.rows.json` carries
// `{state, value, unit, cite, quote}` per parameter and writes no number it
// cannot cite to `M07`, because `OQ-M7-02` is the founder's. Read at the seed:
//
//   D-01  window_seconds                 stated 2
//         min_shared_fill_share_bp       UNSTATED   "more than a configured share"
//   D-04  release_window_seconds         UNSTATED   "within a configured window"
//         min_events_in_pattern          UNSTATED   "as a pattern across many events"
//   D-05  size_after_loss_slope_bp       UNSTATED
//         min_sequences                  UNSTATED   "over a minimum number of sequences"
//         severity                       UNSTATED
//
// A detector reading `{state: 'unstated', value: null}` and running anyway would
// either invent a threshold or match nothing, and matching nothing is `FM-M7-01`
// exactly: "detection appears healthy and is absent." So each of the three
// **DECLINES** ({@link DetectorDeclined}), the run is recorded `failed`, and
// `detector_runs_unhealthy_idx` and `CRON_INVENTORY`'s dead-man switch both see
// it on the morning it happens. **The day the founder answers `OQ-M7-02` these
// three detectors run with no code change**, which is the whole point of
// `SD-M7-03` being a data change with an effective date.
//
// -----------------------------------------------------------------------------
// 3. WHAT THE WINDOWS COST, SAID HERE RATHER THAN DISCOVERED AT 02:00
// -----------------------------------------------------------------------------
// `ADR-157` section 5 granted the range term and refused the aggregate, and
// named the price in its own words: "THE ROWS CROSSING THE BOUNDARY ARE THE
// WINDOW'S RATHER THAN THE MATCH'S, so a detector over a wide window pays for
// every row it did not match."
//
// | Detector | Streams, per run | What crosses |
// |---|---|---|
// | `D-01` nightly | `fills` for the trading day; `accounts` opened on or before it | one day of fills, plus the account book |
// | `D-01` on ingest | the above, plus `fills` for the day from `at - window_seconds` | the same day AGAIN plus a 2 second slice |
// | `D-04` | `fills` since the lookback cutoff; tier-1 `economic_calendar` since it; `accounts` | **the widest read in this file**, `lookback_days` of fills |
// | `D-05` | `fills` since the cutoff; `daily_marks` since it; `accounts` | `lookback_days` of fills and of marks |
//
// **`D-01`'s TWO SECOND WINDOW IS THE FRIENDLIEST CASE IN THE PHASE AND THE
// ON-INGEST MODE STILL READS THE WHOLE DAY.** That is not an oversight and it is
// the one non-obvious thing in this file: the statistic is "more than a
// configured share OF BOTH ACCOUNTS' FILLS", so the SHARE'S DENOMINATOR is the
// account's fills for the day and a two second read cannot supply it. A detector
// that took its denominator from the two second window would compute a share
// near 10000bp for every coincidence and fire on all of them. **So the ingest
// mode buys DETECTION LATENCY and not read cost**, which is exactly what
// `AS-M7-01` counter 2 asks for: the margin that scenario computes is thin
// because "the detector runs nightly, so day 3 is really the night after day 3".
//
// **THE ACCOUNT BOOK CROSSES ON EVERY RUN AND THE NARROWING IS `openedOn <=
// tradingDay`.** It is exact rather than approximate -- an account cannot have a
// fill before it was opened -- and it is one range term rather than a join.
// **`accounts` is read because `fills` HAS NO `identity_id` COLUMN**
// (`packages/db/src/schema.ts:3077`), so the account-to-identity edge every one
// of these three needs is a second table and `ADR-157` refused the join. **IF
// THAT READ STOPS BEING AFFORDABLE THE REMEDY IS AN ENTRY AGAINST
// `scoped-db.ts` ARGUING A JOIN ON ITS OWN TERMS, AND NOT A WIDENING HERE**, and
// that entry's question is already written down in `ADR-157` section 5: "a
// joined read has two tables and the tenancy narrowing has to hold on BOTH of
// them, or the accessor is a BOLA hole with an extra table in it."
//
// -----------------------------------------------------------------------------
// 4. WHAT THE EVIDENCE CARRIES, AND WHAT IT DELIBERATELY DOES NOT
// -----------------------------------------------------------------------------
// `INV-M7-03`: "Every flag carries the numbers behind the accusation, never a
// bare label." `M07` section 3.4 says which numbers, for `D-01`, and the
// sentence generalises to all three:
//
//   "the evidence is the conduct: these fills, on these accounts, held by these
//   two identities, at these timestamps, against this ToS clause. That is
//   exactly the form AS-M7-07 says survives a public argument, and IT DISCLOSES
//   NO THRESHOLD."
//
// **SO EVERY `evidence` OBJECT BELOW CARRIES OBSERVATIONS AND NO PARAMETER.**
// The fills, the counts, the instants and the two identities are in it; the
// window, the share floor, the release window, the minimum event count, the
// slope and the minimum sequence count are NOT, and the seed says why in its own
// `is_sensitive_reason`: "A ring told the window is 2 seconds spaces its entries
// by 3", and for `D-04` the event count "is the number that says how many times
// you may do this before the pattern becomes a pattern." The parameters are one
// join away through `detector_runs.(detector, detector_version)` for anything
// entitled to them, which is `INV-M7-04`'s chain and `P7-j`'s redaction problem
// rather than this file's.
//
// -----------------------------------------------------------------------------
// 5. SEVERITY IS A MONEY DECISION AND THIS FILE REFUSES TO WRITE THE BAND THAT
//    HOLDS A PAYOUT
// -----------------------------------------------------------------------------
// `M07` section 3.3: "moving a detector's output from 3 to 4 changes who gets
// held", because 4 and 5 is the band `G-HOLD-REQUIRED` reads to hold a payout
// for 48 hours under `ADR-040`, and `risk_flags_high_severity_has_sla` makes
// `sla_due_at` mandatory there.
//
// **NOTHING IN THE CORPUS STATES A DURATION FOR THAT CLOCK.** `OQ-M7-03` is
// OPEN and PROPOSES "4 hours to first touch during business hours, 24 hours
// otherwise" for severity **5**, proposes nothing for severity 4, and `M07`
// section 3.3 records that `ADR-040` moved the footing the question was answered
// against. The seed carries no `sla_hours` parameter for any of the eighteen
// rows.
//
// So {@link scoreSeverity} does two things and both are stated rather than
// implied. It reads `sla_hours` from the registry and computes the clock from
// the run's own `now` when it is there. **When it is not there, a finding that
// would score 4 or 5 is CAPPED AT 3 and the cap is recorded in the evidence**
// (`severity_capped_from` and `severity_cap_reason`), because the alternatives
// are worse in both directions: raising a 4 with an invented clock holds a real
// trader's payout on a number nobody chose, and dropping the finding loses the
// detection entirely. **The cap is visible to the operator who reads the flag
// and it lifts with a seed row rather than with a deploy.**
//
// -----------------------------------------------------------------------------
// 6. WHAT THIS FILE DOES NOT DO
// -----------------------------------------------------------------------------
// No `SqlExecutorReason` member, no `SystemReason` member, no `pg` import, no
// `@merit/db` import, no cast past a key type (`P7` section 11 rule 10,
// `ADR-157` section 5, `ADR-165`). No `risk_flags.status` other than `open`, and
// nothing here could write one: {@link DetectorFinding} has no `status` field
// and `DetectorTx` has no addressed write (`ADR-155`, `INV-M7-02`, `P7` rule
// 11). No canary is written, because a canary is minted in memory per run and
// the runner never inserts one (`AS-M7-05`, and section 7 below is where this
// file's canaries are built).
//
// -----------------------------------------------------------------------------
// 7. THE CANARIES, AND WHY TWO OF THE THREE ARE BUILT HERE RATHER THAN MINTED
// -----------------------------------------------------------------------------
// `AS-M7-05` requires one synthetic subject per detector, regenerated per run,
// constructed to trip exactly that detector, and `canary.ts` mints its four
// shapes. **`D-01` USES `mint.sameSecondFillCluster` AND WRAPS IT; `D-04` AND
// `D-05` BUILD THEIR OWN FROM `mint.subject`**, which `canary.ts`'s own header
// admits by name: "A detector needing a fifth builds one from
// {@link CanaryMint.subject} and states why." The three reasons, stated:
//
//   D-01  The minted cluster is exactly right and is used unchanged. What it
//         cannot carry is the `accounts` rows the identity edge is resolved
//         through, because a `CanarySubject` names one stream and this detector
//         reads two. {@link withAccountRows} adds them, derived from the minted
//         rows rather than from a role name, so a change in `canary.ts` breaks
//         the battery loudly instead of silently.
//   D-04  None of the four shapes carries an `economic_calendar` row, and a
//         news-window canary is a fill cluster AND the releases it sits on.
//   D-05  **`mint.martingaleSequence` PUTS `realizedPnlCents` AND
//         `sequenceOrdinal` ON A `fills` ROW AND `fills` HAS NEITHER COLUMN.**
//         `realized_pnl_cents` is `daily_marks`' (`schema.ts:652`) and
//         `sequenceOrdinal` is no table's. A detector written against that shape
//         would read a column real fills never carry, so it would find its
//         canary every night and never fire on a real martingale, which is
//         `AS-M7-05`'s failure with a green dashboard on top. **The defect is in
//         `canary.ts`, which is outside this slice's fence, so it is REPORTED
//         and worked around rather than repaired**: `D-05`'s canary is built
//         here over the columns that exist, `fills.quantity` and
//         `daily_marks.realized_pnl_cents`.
//
// **EVERY CANARY IN THIS FILE SITS AT {@link CANARY_INSTANT}, WHICH IS A
// SATURDAY AT 03:00 UTC.** That is 21:00 Friday CT, after the week's close and
// before Sunday's open, so no real fill can exist within any of these three
// detectors' windows of it. The reason is not tidiness: `D-01` pairs ACCOUNTS
// and `D-04` pairs an account with a RELEASE, so a canary sitting inside live
// trading could pair a synthetic actor with a real one, and the runner refuses
// that finding by failing the whole run (`DetectorCanaryLeak`). Putting the
// battery where the market is shut is what makes that refusal a real guard
// against a real bug rather than a nightly false alarm.
// =============================================================================

import type { CanaryMint, CanaryRow, CanarySubject } from './canary.ts';
import type {
  Detector,
  DetectorDefinition,
  DetectorFinding,
  DetectorOutcome,
  DetectorRow,
  DetectorScanInput,
  DetectorScanRequest,
  DetectorStream,
} from './ports.ts';
import { DetectorDeclined, SLA_REQUIRED_AT_SEVERITY } from './ports.ts';

// -----------------------------------------------------------------------------
// The registry, read as `P7-d` wrote it
// -----------------------------------------------------------------------------

/**
 * One parameter of a `detector_definitions.parameters` object.
 *
 * `P7-d`'s seed shape: every value is `{state, value, unit, cite, quote}` rather
 * than a bare number, and a `contextual` value carries `cases` instead. The
 * shape is read defensively because it arrives as `jsonb` and nothing in the
 * type system connects this file to that file.
 */
interface SeedParameter {
  readonly state?: unknown;
  readonly value?: unknown;
  readonly cases?: unknown;
}

/** The parameter named `name`, or `undefined` when the registry has no such key. */
function parameterOf(definition: DetectorDefinition, name: string): SeedParameter | undefined {
  const raw = definition.parameters[name];
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as SeedParameter)
    : undefined;
}

/**
 * A parameter's stated integer, or a decline naming the parameter.
 *
 * **THE DECLINE IS THE DELIVERABLE HERE AND NOT A FALLBACK.** `P7-d`'s seed
 * writes no number it cannot cite to `M07` and eleven of its eighteen rows carry
 * none at all, so this path is the one the shipped registry takes today. The
 * message names the parameter and `OQ-M7-02` so that the run's `failed` row
 * leads to the founder's question rather than to this file.
 */
function statedInteger(detector: string, definition: DetectorDefinition, name: string): number {
  const parameter = parameterOf(definition, name);
  if (parameter === undefined) {
    throw new DetectorDeclined(
      detector,
      `its detector_definitions row carries no "${name}" parameter at all. INV-M7-04 makes the ` +
        'registry the only source of a threshold, so a parameter that is not there is not a ' +
        'number this detector may choose.',
    );
  }
  const { state, value } = parameter;
  if (state !== 'stated' || typeof value !== 'number' || !Number.isInteger(value)) {
    throw new DetectorDeclined(
      detector,
      `its "${name}" parameter is ${JSON.stringify(state)} with value ${JSON.stringify(value)} ` +
        "and this detector needs a stated integer. OQ-M7-02 is the founder's on every value in " +
        'the seed, and a detector that invented one here would either match nothing, which is ' +
        'FM-M7-01 ("detection appears healthy and is absent"), or match everything.',
    );
  }
  return value;
}

/** A parameter's stated boolean, or `undefined` when the registry does not state one. */
function statedBoolean(definition: DetectorDefinition, name: string): boolean | undefined {
  const parameter = parameterOf(definition, name);
  if (parameter === undefined || parameter.state !== 'stated') {
    return undefined;
  }
  return typeof parameter.value === 'boolean' ? parameter.value : undefined;
}

/**
 * The severity `wanted` becomes once the clock the database requires is
 * accounted for.
 *
 * Section 5 of this file's header is the argument. `sla_hours` is read from the
 * registry and is absent from every row of the shipped seed, so the cap is what
 * happens today and the clock is what happens the day `OQ-M7-03` is answered and
 * seeded.
 */
interface ScoredSeverity {
  readonly severity: number;
  readonly slaDueAt?: Date;
  /** Set only when the cap fired, and copied into the evidence when it did. */
  readonly cappedFrom?: number;
}

/** The highest severity that carries no clock, which is what the cap caps to. */
const SEVERITY_WITHOUT_A_CLOCK = SLA_REQUIRED_AT_SEVERITY - 1;

function scoreSeverity(definition: DetectorDefinition, wanted: number, now: Date): ScoredSeverity {
  if (wanted < SLA_REQUIRED_AT_SEVERITY) {
    return { severity: wanted };
  }
  const hours = parameterOf(definition, 'sla_hours');
  if (
    hours !== undefined &&
    hours.state === 'stated' &&
    typeof hours.value === 'number' &&
    Number.isInteger(hours.value) &&
    hours.value > 0
  ) {
    return { severity: wanted, slaDueAt: new Date(now.getTime() + hours.value * 3600 * 1000) };
  }
  return { severity: SEVERITY_WITHOUT_A_CLOCK, cappedFrom: wanted };
}

/** What the cap puts in the evidence, so an operator reads the reason on the flag. */
const SEVERITY_CAP_REASON =
  'risk_flags_high_severity_has_sla requires sla_due_at at severity 4 and 5, the band ' +
  'G-HOLD-REQUIRED reads to hold a payout for 48 hours (ADR-040). OQ-M7-03 is open and no ' +
  'sla_hours parameter is seeded, so this flag is capped rather than raised on an invented clock.';

// -----------------------------------------------------------------------------
// Rows, read defensively because they cross an untyped boundary
// -----------------------------------------------------------------------------

/** A row's column as a string, or `undefined`. `bigint` ids included. */
function text(row: DetectorRow, column: string): string | undefined {
  const value = row[column];
  if (typeof value === 'string') {
    return value.length === 0 ? undefined : value;
  }
  return typeof value === 'bigint' || typeof value === 'number' ? String(value) : undefined;
}

/** A row's column as an epoch millisecond, or `undefined`. */
function instant(row: DetectorRow, column: string): number | undefined {
  const value = row[column];
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/** A row's column as a non-negative integer, or `undefined`. */
function count(row: DetectorRow, column: string): number | undefined {
  const value = row[column];
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  return undefined;
}

/**
 * A row's column as a SIGNED `bigint` of cents, or `undefined`.
 *
 * `daily_marks.realized_pnl_cents` is `bigint` and money is integer cents
 * everywhere in this repository, so it is compared as a `bigint` and never
 * passed through `Number()`. `ADR-157` section 5 finding 8 is the neighbouring
 * case: the naive `Number()` on a `numeric` is lossy above 2^53.
 */
function cents(row: DetectorRow, column: string): bigint | undefined {
  const value = row[column];
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  return undefined;
}

/** What `accounts` supplies, which is the identity edge and the phase. */
interface AccountFacts {
  readonly identityId: string;
  readonly phase: string | undefined;
}

/** The account book as a map, built from the `accounts` stream. */
function accountBook(rows: readonly DetectorRow[]): Map<string, AccountFacts> {
  const book = new Map<string, AccountFacts>();
  for (const row of rows) {
    const id = text(row, 'id');
    const identityId = text(row, 'identityId');
    if (id === undefined || identityId === undefined) {
      continue;
    }
    book.set(id, { identityId, phase: text(row, 'phase') });
  }
  return book;
}

/** The stream name every detector here resolves its identity edge through. */
const ACCOUNTS_STREAM = 'accounts';

/**
 * The `accounts` stream, narrowed by the one term that cannot drop a row this
 * file needs.
 *
 * An account cannot have a fill before it was opened, so `openedOn <=
 * tradingDay` is EXACT rather than approximate. Section 3 of the header is what
 * it costs.
 */
function accountsStream(request: DetectorScanRequest): DetectorStream {
  return {
    name: ACCOUNTS_STREAM,
    table: 'accounts',
    where: { openedOn: request.terms.atMost(request.tradingDay) },
  };
}

// -----------------------------------------------------------------------------
// The canaries
// -----------------------------------------------------------------------------

/**
 * A Saturday at 03:00 UTC, which is 21:00 Friday CT: after the week's close and
 * before Sunday's open.
 *
 * Section 7 of the header is why every canary in this file sits here. It is a
 * constant instant rather than a derived one because the NONCE is what
 * `AS-M7-05` note 2 requires to be fresh, and it is; a fresh timestamp would
 * change nothing about that and would make a fixture unpinnable.
 */
export const CANARY_INSTANT = new Date('2026-01-03T03:00:00.000Z');

/**
 * The `n`-th canary instant: {@link CANARY_INSTANT} plus whole WEEKS.
 *
 * WEEKS RATHER THAN DAYS, so that every row of every battery in this file sits
 * on a Saturday at 03:00 UTC and the "no session is open" argument holds for the
 * whole battery rather than only for its first row. A daily step would put the
 * second release of a `D-04` canary at 21:00 Monday CT, which is inside a live
 * session, and a real account trading there could pair with a synthetic release.
 */
function canaryInstant(n: number): Date {
  return new Date(CANARY_INSTANT.getTime() + n * 7 * 24 * 60 * 60 * 1000);
}

/** `YYYY-MM-DD` of an instant, which is what a `date` column holds. */
function tradingDayOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * `subject` with the `accounts` rows its own fills imply.
 *
 * DERIVED FROM THE MINTED ROWS AND NOT FROM A ROLE NAME. `canary.ts` names its
 * actors `a-leader`, `i-leader` and so on, and a copy of those strings here
 * would keep type-checking on the day that file changed one. Reading the rows
 * means a change there breaks the battery loudly -- the canary stops being found
 * and the run reports `degraded` -- which is the failure this whole mechanism is
 * for.
 */
function withAccountRows(subject: CanarySubject, fillsStream: string): CanarySubject {
  const book = new Map<string, CanaryRow>();
  for (const row of subject.rows[fillsStream] ?? []) {
    const accountId = text(row, 'accountId');
    const identityId = text(row, 'identityId');
    if (accountId === undefined || identityId === undefined || book.has(accountId)) {
      continue;
    }
    book.set(accountId, { id: accountId, identityId, phase: 'eval', openedOn: '2026-01-01' });
  }
  return { ...subject, rows: { ...subject.rows, [ACCOUNTS_STREAM]: [...book.values()] } };
}

// =============================================================================
// D-01: FILL CLUSTERING
// =============================================================================
// `M07:108`: "Two accounts with fills on the same symbol and side within a 2
// second window, more than a configured share of both accounts' fills.
// Same-identity pairs are filtered at the detector, not dismissed in the queue
// (section 3.4)". Evidence of "Cross-identity copy trading, which is now itself
// a ToS violation".
//
// **THE SAME-IDENTITY FILTER IS THE RULING AND IT IS APPLIED BEFORE A FINDING
// EXISTS.** `M07` section 3.4: "A trader with five accounts running one strategy
// generates near-perfect same-second clustering across all ten pairs, every day,
// forever. Under the old design each of those was a technically correct flag
// that an operator had to open and dismiss, which is AS-M7-03's attention attack
// arriving without an attacker."
//
// **"AT THE QUERY" IS SATISFIED BY THE JOIN BEING IN THE RUNNER, WHICH IS WHERE
// `ADR-157` PUT IT.** That entry refused the aggregate and granted "a detector
// can pull its window through `rowsWhere` and DO THE JOIN IN THE RUNNER", so a
// same-identity pair never reaches a `risk_flags` row and never reaches an
// operator. The distinction `M07` section 3.4 draws is DETECTOR versus QUEUE and
// this is the detector side of it; the SQL-versus-memory question is `ADR-157`'s
// and is already answered.
// =============================================================================

/** `D-01`'s registry identifier and `risk_flags.flag_type`. */
export const D01 = 'D-01';

/** `0008_risk.sql:119`'s vocabulary: `copy_cluster` is `D-01`'s. */
const D01_FLAG_TYPE = 'copy_cluster';

/** How `D-01` was invoked. */
export interface FillClusteringOptions {
  /**
   * The instant a fill just landed, which puts this detector in ON-INGEST mode.
   *
   * `AS-M7-01` counter 2. Omitted, the detector is the nightly one. Supplied, it
   * adds a `cluster` stream narrowed to `[at - window_seconds, the day's end]`
   * through `ADR-157`'s `atLeast`, and keeps the day stream because the share's
   * denominator is the day. Section 3 of the header.
   */
  readonly at?: Date;
}

/** One fill, as `D-01` pairs them. */
interface ClusterFill {
  readonly id: string;
  readonly accountId: string;
  readonly at: number;
  readonly key: string;
}

/** One account pair that clustered. */
interface ClusterPair {
  readonly shared: Map<string, Set<string>>;
  readonly instants: number[];
  readonly symbols: Set<string>;
}

function clusterFills(rows: readonly DetectorRow[]): ClusterFill[] {
  const fills: ClusterFill[] = [];
  for (const row of rows) {
    const id = text(row, 'id');
    const accountId = text(row, 'accountId');
    const at = instant(row, 'executedAt');
    const symbol = text(row, 'symbol');
    const side = text(row, 'side');
    if (
      id === undefined ||
      accountId === undefined ||
      at === undefined ||
      symbol === undefined ||
      side === undefined
    ) {
      continue;
    }
    fills.push({ id, accountId, at, key: `${symbol}|${side}` });
  }
  return fills;
}

/**
 * `D-01`, in either mode.
 *
 * `fillClustering()` is the nightly detector `CRON_INVENTORY` rows;
 * `fillClustering({at})` is `AS-M7-01` counter 2's on-ingest one. **NOTHING IN
 * THIS TREE CALLS THE SECOND ONE YET AND THAT IS A FENCE RATHER THAN AN
 * OVERSIGHT**: the live ingest path is `apps/worker/src/live/`, `P7-f`'s fence
 * holds this file, its suite and the barrel, and reaching into the ingest
 * pipeline to add the call is the widening `P7` section 11 rule 5 forecloses.
 * The constructor and its narrowed window are what this slice owes; the call
 * site is one line in a file this session may not open, and it is reported.
 */
export function fillClustering(options: FillClusteringOptions = {}): Detector {
  const at = options.at;
  return {
    id: D01,

    streams: (request) => {
      const windowSeconds = statedInteger(D01, request.definition, 'window_seconds');
      const streams: DetectorStream[] = [
        // THE POPULATION, AND IT IS THE SHARE'S DENOMINATOR IN BOTH MODES.
        { name: 'fills', table: 'fills', where: { tradingDay: request.tradingDay } },
        accountsStream(request),
      ];
      if (at !== undefined) {
        streams.push({
          name: 'cluster',
          table: 'fills',
          where: {
            tradingDay: request.tradingDay,
            // ONE TERM AND NOT TWO. A filter is one narrowing per column
            // (`ADR-112`'s shape, unmoved by `ADR-157`), so a two-sided range on
            // `executed_at` is not expressible and is not needed: a fill later
            // than the instant that just landed has not been ingested yet, so
            // the lower bound IS the window.
            executedAt: request.terms.atLeast(new Date(at.getTime() - windowSeconds * 1000)),
          },
        });
      }
      return streams;
    },

    canaries: (mint: CanaryMint) => {
      const subject = withAccountRows(
        mint.sameSecondFillCluster(D01, 0, { stream: 'fills', at: CANARY_INSTANT }),
        'fills',
      );
      if (at === undefined) {
        return [subject];
      }
      // ON INGEST THE BATTERY SITS IN BOTH STREAMS, exactly as a real fill does:
      // a fill that just landed is in the day's population AND in the two second
      // window. A canary present only in the population would never pair, so
      // every ingest run would report `degraded` and page -- which is how a
      // canary battery gets switched off.
      return [{ ...subject, rows: { ...subject.rows, cluster: subject.rows['fills'] ?? [] } }];
    },

    scan: (input) => scanFillClustering(input, at !== undefined),
  };
}

/** `D-01` nightly, which is the one a scheduled run holds. */
export const fillClusteringNightly: Detector = fillClustering();

function scanFillClustering(input: DetectorScanInput, onIngest: boolean): DetectorOutcome {
  const { definition, now } = input.request;
  const windowMs = statedInteger(D01, definition, 'window_seconds') * 1000;
  const shareBp = statedInteger(D01, definition, 'min_shared_fill_share_bp');
  if (shareBp < 0 || shareBp >= 10_000) {
    throw new DetectorDeclined(
      D01,
      `its min_shared_fill_share_bp is ${String(shareBp)}bp and a share floor at or above 10000bp ` +
        'can never be exceeded: the statistic is "MORE THAN a configured share" (M07:108), so a ' +
        'floor of 10000bp is a detector that cannot fire, including on its own canary.',
    );
  }

  const population = clusterFills(input.rows['fills'] ?? []);
  // THE CANARY ROWS ARRIVE ON `fills` AND, IN INGEST MODE, ON `cluster` TOO,
  // exactly as a real fill sits in both the day and the window.
  const cluster = onIngest ? clusterFills(input.rows['cluster'] ?? []) : population;
  const book = accountBook(input.rows[ACCOUNTS_STREAM] ?? []);

  const totals = new Map<string, number>();
  for (const fill of population) {
    totals.set(fill.accountId, (totals.get(fill.accountId) ?? 0) + 1);
  }

  // PAIRED WITHIN THE WINDOW, ON THE SAME SYMBOL AND SIDE. The rows are the
  // window's rather than the match's (ADR-157 section 5), so the pairing is
  // ordinary code over an array and its cost is visible right here: one sort per
  // (symbol, side) group and a forward scan bounded by the window.
  const groups = new Map<string, ClusterFill[]>();
  for (const fill of cluster) {
    const group = groups.get(fill.key);
    if (group === undefined) {
      groups.set(fill.key, [fill]);
    } else {
      group.push(fill);
    }
  }
  const pairs = new Map<string, ClusterPair>();
  for (const [key, group] of groups) {
    const symbol = key.slice(0, key.lastIndexOf('|'));
    group.sort((a, b) => a.at - b.at);
    for (let i = 0; i < group.length; i += 1) {
      const left = group[i];
      if (left === undefined) {
        continue;
      }
      for (let j = i + 1; j < group.length; j += 1) {
        const right = group[j];
        if (right === undefined || right.at - left.at > windowMs) {
          break;
        }
        if (left.accountId === right.accountId) {
          continue;
        }
        const [a, b] = left.accountId < right.accountId ? [left, right] : [right, left];
        const pairKey = `${a.accountId}|${b.accountId}`;
        let pair = pairs.get(pairKey);
        if (pair === undefined) {
          pair = { shared: new Map(), instants: [], symbols: new Set() };
          pairs.set(pairKey, pair);
        }
        for (const fill of [a, b]) {
          const seen = pair.shared.get(fill.accountId) ?? new Set<string>();
          seen.add(fill.id);
          pair.shared.set(fill.accountId, seen);
        }
        pair.instants.push(left.at, right.at);
        pair.symbols.add(symbol);
      }
    }
  }

  const findings: DetectorFinding[] = [];
  for (const [pairKey, pair] of pairs) {
    const [accountA, accountB] = pairKey.split('|');
    if (accountA === undefined || accountB === undefined) {
      continue;
    }
    const factsA = book.get(accountA);
    const factsB = book.get(accountB);
    // NO IDENTITY, NO FLAG. `risk_flags.identity_id` is NOT NULL and is who
    // enforcement acts against; a pair whose identity edge this run could not
    // resolve is not an accusation this run may make.
    if (factsA === undefined || factsB === undefined) {
      continue;
    }
    // ------------------------------------------------------------------------
    // THE SAME-IDENTITY FILTER, AND IT IS THE ONE LINE `M07` SECTION 3.4 IS
    // ABOUT. Copy trading between accounts of ONE verified identity is ALLOWED,
    // so this is not a flag an operator dismisses; it is not a flag.
    // ------------------------------------------------------------------------
    if (factsA.identityId === factsB.identityId) {
      continue;
    }
    const sharedA = pair.shared.get(accountA)?.size ?? 0;
    const sharedB = pair.shared.get(accountB)?.size ?? 0;
    const totalA = totals.get(accountA) ?? 0;
    const totalB = totals.get(accountB) ?? 0;
    if (totalA === 0 || totalB === 0) {
      continue;
    }
    // "MORE THAN a configured share of BOTH accounts' fills" (M07:108). Integer
    // cross-multiplication rather than a division, so "just inside" and "just
    // outside" the floor differ by one shared fill and never by a rounding, and
    // no float appears in a threshold comparison.
    if (sharedA * 10_000 <= shareBp * totalA || sharedB * 10_000 <= shareBp * totalB) {
      continue;
    }

    // SEVERITY. `M07` section 3.3 gives D-01 two cited cases: 3 for "clustering
    // across evaluations" and 5 for "the same pattern with a funded member
    // ELIGIBLE THIS WEEK". The second case's condition is not readable from
    // DETECTOR_READ_TABLES -- payout eligibility is neither `accounts` nor any
    // other member -- so this detector scores the case it can evaluate and
    // records the fact that would raise it rather than inferring the case from
    // `phase` alone. A funded account is not a funded account eligible this
    // week, and the difference is 48 hours of somebody's payout.
    const fundedMember = [factsA, factsB].some((facts) => facts.phase === 'funded');
    const scored = scoreSeverity(definition, 3, now);
    const instants = [...pair.instants].sort((a, b) => a - b);
    const first = instants[0];
    const last = instants[instants.length - 1];
    const conduct = {
      accounts: [accountA, accountB],
      identities: [factsA.identityId, factsB.identityId],
      symbols: [...pair.symbols].sort(),
      shared_fills: { [accountA]: sharedA, [accountB]: sharedB },
      total_fills: { [accountA]: totalA, [accountB]: totalB },
      first_clustered_at: first === undefined ? undefined : new Date(first).toISOString(),
      last_clustered_at: last === undefined ? undefined : new Date(last).toISOString(),
      detected_on: onIngest ? 'ingest' : 'nightly',
      funded_member_present: fundedMember,
      ...(fundedMember
        ? {
            severity_case_unreachable:
              'M07 section 3.3 scores a funded member ELIGIBLE THIS WEEK at severity 5. Payout ' +
              'eligibility has no read in DETECTOR_READ_TABLES, so this flag carries the funded ' +
              'fact and not the inference.',
          }
        : {}),
      ...(scored.cappedFrom === undefined
        ? {}
        : { severity_capped_from: scored.cappedFrom, severity_cap_reason: SEVERITY_CAP_REASON }),
    };
    // ONE FLAG PER IDENTITY. Flags attach to humans (`0008_risk.sql:113`) and
    // the conduct implicates two of them; `M19` `INV-M19-04`'s neighbouring case
    // "raises a flag against BOTH identities" is the same shape, and `AS-M7-03`
    // orders the queue by detector families per IDENTITY, which a single flag
    // naming one of the two would under-count for the other.
    for (const [facts, accountId] of [
      [factsA, accountA],
      [factsB, accountB],
    ] as const) {
      findings.push({
        subjects: [accountA, accountB],
        identityId: facts.identityId,
        accountId,
        flagType: D01_FLAG_TYPE,
        severity: scored.severity,
        ...(scored.slaDueAt === undefined ? {} : { slaDueAt: scored.slaDueAt }),
        evidence: conduct,
      });
    }
  }
  return { findings };
}

// =============================================================================
// D-04: NEWS-WINDOW CLUSTERING
// =============================================================================
// `M07:111`: "Entries within a configured window of a scheduled release, AS A
// PATTERN ACROSS MANY EVENTS, never a single event". Evidence of "Straddle
// farming. The pattern qualifier is load bearing: one trade around a release is
// a normal trading day."
//
// **THE PATTERN QUALIFIER IS ENFORCED TWICE AND DELIBERATELY SO.** Once as the
// threshold -- an account fires only when it entered near at least
// `min_events_in_pattern` DISTINCT releases -- and once as a refusal: a registry
// stating a minimum below 2 is DECLINED rather than obeyed, because the same
// registry row states `fires_on_single_event: false` and the two cannot both be
// honoured. A detector that quietly took `1` would be the exact defect `M07`
// warns about, wearing a cited parameter.
// =============================================================================

/** `D-04`'s registry identifier. */
export const D04 = 'D-04';

/** `0008_risk.sql:119`'s vocabulary: `news_window` is `D-04`'s. */
const D04_FLAG_TYPE = 'news_window';

/** The tier `M07:111` names: a MAINTAINED TIER-1 economic calendar (`DEP-M7-06`). */
const TIER_ONE = 1;

/**
 * The lookback both `D-04` and `D-05` read, in CALENDAR days.
 *
 * **IT IS A PARAMETER `M07` DOES NOT NAME AND THAT IS REPORTED RATHER THAN
 * CHOSEN.** "A pattern across many events" and "over a minimum number of
 * sequences" both need history and neither states how much, so the registry is
 * asked for `lookback_days` and the detector declines when it is absent, on the
 * same footing as every other unstated threshold. It is CALENDAR days rather
 * than trading days because the trading calendar is not a member of
 * `DETECTOR_READ_TABLES` and inventing a member to convert one to the other
 * would be a wider reach than the number is worth.
 */
const LOOKBACK = 'lookback_days';

/** The cutoff instant a lookback implies, from the trading day the run is FOR. */
function lookbackCutoff(tradingDay: string, days: number): Date {
  const start = Date.parse(`${tradingDay}T00:00:00.000Z`);
  return new Date(start - days * 24 * 60 * 60 * 1000);
}

/** One scheduled release, as `D-04` matches against it. */
interface Release {
  readonly key: string;
  readonly at: number;
}

/** `D-04`. */
export function newsWindowClustering(): Detector {
  return {
    id: D04,

    streams: (request) => {
      const days = statedInteger(D04, request.definition, LOOKBACK);
      const cutoff = lookbackCutoff(request.tradingDay, days);
      return [
        // THE WIDEST READ IN THIS FILE. Section 3 of the header prices it.
        { name: 'fills', table: 'fills', where: { executedAt: request.terms.atLeast(cutoff) } },
        {
          name: 'releases',
          table: 'economicCalendar',
          where: { tier: TIER_ONE, scheduledReleaseAt: request.terms.atLeast(cutoff) },
        },
        accountsStream(request),
      ];
    },

    canaries: (mint) => [newsWindowCanary(mint, 0)],

    scan: (input) => scanNewsWindow(input),
  };
}

/** `D-04` as a scheduled run holds it. */
export const newsWindowClusteringNightly: Detector = newsWindowClustering();

/**
 * `D-04`'s synthetic subject: one account entering on several releases.
 *
 * BUILT HERE BECAUSE NONE OF `AS-M7-05`'s FOUR SHAPES CARRIES A CALENDAR ROW,
 * which section 7 of the header states. It seeds SIX releases rather than two so
 * that the canary clears any plausible `min_events_in_pattern` the founder
 * later sets: a canary whose outcome turns on an unset threshold is a canary
 * that pages the night the threshold is finally chosen, which is `canary.ts`'s
 * own argument for minting four martingale sequences rather than one.
 */
function newsWindowCanary(mint: CanaryMint, ordinal: number): CanarySubject {
  const subject = mint.subject(D04, ordinal);
  const account = subject.actor('a-straddle');
  const identity = subject.actor('i-straddle');
  const fills: CanaryRow[] = [];
  const releases: CanaryRow[] = [];
  const events = 6;
  for (let n = 0; n < events; n += 1) {
    // One release a week, and an entry ON the release instant, so the match
    // holds for any window a founder may choose down to a second.
    const at = canaryInstant(n);
    releases.push({
      id: subject.row(fills.length + releases.length),
      occurrenceKey: `${subject.id}#release-${String(n)}`,
      tier: TIER_ONE,
      scheduledReleaseAt: at,
      releaseTradingDay: tradingDayOf(at),
    });
    fills.push({
      // EVERY KEY IS A REAL `fills` COLUMN. The identity edge is on the
      // `accounts` row below, because `fills` HAS NO `identity_id`
      // (`schema.ts:3005`), and a canary carrying a column the table does not
      // have is a canary a detector could find by reading something no real row
      // ever supplies.
      id: subject.row(fills.length + releases.length),
      accountId: account,
      symbol: 'ESH6',
      side: 'buy',
      quantity: 2,
      executedAt: at,
      tradingDay: tradingDayOf(at),
    });
  }
  return {
    id: subject.id,
    detector: D04,
    nonce: mint.nonce,
    // The shape is AS-M7-05's second one: a cluster of fills. What this subject
    // adds is the calendar the cluster sits on, which is D-04's other input.
    shape: 'same-second-fill-cluster',
    actors: [account, identity],
    rows: {
      fills,
      releases,
      [ACCOUNTS_STREAM]: [{ id: account, identityId: identity, phase: 'eval' }],
    },
  };
}

function scanNewsWindow(input: DetectorScanInput): DetectorOutcome {
  const { definition, now } = input.request;
  const windowMs = statedInteger(D04, definition, 'release_window_seconds') * 1000;
  const minEvents = statedInteger(D04, definition, 'min_events_in_pattern');
  const single = statedBoolean(definition, 'fires_on_single_event');
  if (minEvents < 2) {
    throw new DetectorDeclined(
      D04,
      `its min_events_in_pattern is ${String(minEvents)}. M07:111 makes the pattern qualifier ` +
        'load bearing -- "as a pattern across many events, NEVER A SINGLE EVENT" -- and the same ' +
        `registry row states fires_on_single_event: ${String(single)}. A minimum below 2 is a ` +
        'detector that fires on one trade around a release, which M07 calls a normal trading day.',
    );
  }

  const releases: Release[] = [];
  for (const row of input.rows['releases'] ?? []) {
    const at = instant(row, 'scheduledReleaseAt');
    const key = text(row, 'occurrenceKey') ?? text(row, 'id');
    if (at === undefined || key === undefined) {
      continue;
    }
    releases.push({ key, at });
  }
  releases.sort((a, b) => a.at - b.at);

  // WHICH RELEASES EACH ACCOUNT ENTERED NEAR, as a set so that ten entries on
  // one release stay ONE event. That is the whole content of "across many
  // events": the count that matters is of RELEASES and never of fills.
  const nearby = new Map<string, Set<string>>();
  const entries = new Map<string, number>();
  const fills = [...(input.rows['fills'] ?? [])].sort(
    (a, b) => (instant(a, 'executedAt') ?? 0) - (instant(b, 'executedAt') ?? 0),
  );
  let lower = 0;
  for (const row of fills) {
    const accountId = text(row, 'accountId');
    const at = instant(row, 'executedAt');
    if (accountId === undefined || at === undefined) {
      continue;
    }
    while (lower < releases.length && (releases[lower]?.at ?? 0) < at - windowMs) {
      lower += 1;
    }
    for (let i = lower; i < releases.length; i += 1) {
      const release = releases[i];
      if (release === undefined || release.at > at + windowMs) {
        break;
      }
      const seen = nearby.get(accountId) ?? new Set<string>();
      seen.add(release.key);
      nearby.set(accountId, seen);
      entries.set(accountId, (entries.get(accountId) ?? 0) + 1);
    }
  }

  const book = accountBook(input.rows[ACCOUNTS_STREAM] ?? []);
  const findings: DetectorFinding[] = [];
  for (const [accountId, matched] of nearby) {
    if (matched.size < minEvents) {
      continue;
    }
    const facts = book.get(accountId);
    if (facts === undefined) {
      continue;
    }
    // SEVERITY 1, which is the only value `M07` section 3.3 cites for D-04 and
    // the only one the registry carries. It is the digest band -- "Informational,
    // aggregated in a digest rather than queued" -- and `FM-M7-04` is why that is
    // right for this detector: "Severity 1 goes to a digest rather than the
    // queue, so the queue only ever holds actionable items." **THE CITED CASE IS
    // WORDED FOR SINGLE-WINDOW OBSERVATIONS AND THIS DETECTOR NEVER FIRES ON
    // ONE**, which is a mismatch reported to the founder rather than repaired by
    // choosing a higher number here: a detector's own author picking its severity
    // is the money decision `M07` section 3.3 says it is.
    const scored = scoreSeverity(definition, 1, now);
    findings.push({
      subjects: [accountId],
      identityId: facts.identityId,
      accountId,
      flagType: D04_FLAG_TYPE,
      severity: scored.severity,
      ...(scored.slaDueAt === undefined ? {} : { slaDueAt: scored.slaDueAt }),
      evidence: {
        account: accountId,
        identity: facts.identityId,
        releases_entered_near: matched.size,
        release_keys: [...matched].sort(),
        entries_near_releases: entries.get(accountId) ?? 0,
        ...(scored.cappedFrom === undefined
          ? {}
          : { severity_capped_from: scored.cappedFrom, severity_cap_reason: SEVERITY_CAP_REASON }),
      },
    });
  }
  return { findings };
}

// =============================================================================
// D-05: MARTINGALE SEQUENCE
// =============================================================================
// `M07:112`: "Size-after-loss regression at strategy level, over a minimum
// number of sequences ... Strategy level, never a single sequence". Evidence of
// "Eval brute-forcing".
//
// **`fills` HAS NO REALIZED P&L AND THAT DECIDES THE SHAPE OF THIS DETECTOR.**
// `M07`'s Input cell for `D-05` is `fills` and `packages/db/src/schema.ts:3077`
// gives that table no P&L column of any kind; `realized_pnl_cents` is
// `daily_marks`' (`schema.ts:652`) and round-trip results live in `round_trips`,
// which is not a member of `DETECTOR_READ_TABLES`. So "after loss" has exactly
// one readable meaning here: **THE DAY BEFORE WAS A LOSING DAY**, and the series
// is the account's traded days rather than its individual fills.
//
// A sequence is a maximal run of consecutive traded days on which the account
// escalated size by at least `size_after_loss_slope_bp` after a losing day. The
// detector fires when an account holds at least `min_sequences` of them, and a
// registry stating fewer than 2 is DECLINED on "never a single sequence".
//
// **THE ALTERNATIVE WAS TO READ THE CANARY'S OWN SHAPE AND IT WOULD HAVE BEEN
// THE WORST BUG AVAILABLE IN THIS PHASE.** `canary.ts`'s `martingaleSequence`
// writes `realizedPnlCents` and `sequenceOrdinal` onto `fills` rows. A detector
// fitting a regression to those two fields would find its canary every single
// night and would never once fire on a real martingale, because no real fill row
// carries either column. Section 7 of the header reports it.
// =============================================================================

/** `D-05`'s registry identifier. */
export const D05 = 'D-05';

/** `0008_risk.sql:119`'s vocabulary: `martingale` is `D-05`'s. */
const D05_FLAG_TYPE = 'martingale';

/** One trading day of one account, as `D-05` reads it. */
interface SizeDay {
  readonly day: string;
  readonly contracts: number;
  readonly loss: boolean;
}

/** `D-05`. */
export function martingaleSequences(): Detector {
  return {
    id: D05,

    streams: (request) => {
      const days = statedInteger(D05, request.definition, LOOKBACK);
      const cutoff = lookbackCutoff(request.tradingDay, days);
      return [
        { name: 'fills', table: 'fills', where: { executedAt: request.terms.atLeast(cutoff) } },
        {
          name: 'marks',
          table: 'dailyMarks',
          where: { tradingDay: request.terms.atLeast(tradingDayOf(cutoff)) },
        },
        accountsStream(request),
      ];
    },

    canaries: (mint) => [martingaleCanary(mint, 0)],

    scan: (input) => scanMartingale(input),
  };
}

/** `D-05` as a scheduled run holds it. */
export const martingaleSequencesNightly: Detector = martingaleSequences();

/**
 * `D-05`'s synthetic subject, over the columns that exist.
 *
 * FOUR SEQUENCES, EACH A LOSING DAY AT ONE CONTRACT FOLLOWED BY A DAY AT A
 * HUNDRED. `canary.ts`'s own reasoning for minting four rather than one is
 * adopted verbatim: `min_sequences` is `unstated` in the registry, so a canary of
 * one sequence would be found or not found depending on a number nobody has
 * chosen yet. The escalation is 990000bp for the same reason -- it clears any
 * plausible slope -- and both numbers are integers, contracts and basis points,
 * with no float anywhere in the shape.
 */
function martingaleCanary(mint: CanaryMint, ordinal: number): CanarySubject {
  const subject = mint.subject(D05, ordinal);
  const account = subject.actor('a-martingale');
  const identity = subject.actor('i-martingale');
  const fills: CanaryRow[] = [];
  const marks: CanaryRow[] = [];
  const sequences = 4;
  let day = 0;
  for (let sequence = 0; sequence < sequences; sequence += 1) {
    for (const contracts of [1, 100]) {
      const at = canaryInstant(day);
      const tradingDay = tradingDayOf(at);
      day += 1;
      fills.push({
        id: subject.row(fills.length),
        accountId: account,
        symbol: 'ESH6',
        side: 'buy',
        quantity: contracts,
        executedAt: at,
        tradingDay,
      });
      marks.push({
        // A LOSING DAY EVERY DAY. The escalation is what the detector reads and
        // the loss is what qualifies it; a run breaks on the drop from 100 back
        // to 1, which is what makes these four sequences rather than one.
        id: `${subject.id}#mark-${String(marks.length)}`,
        accountId: account,
        tradingDay,
        realizedPnlCents: -125_00n,
        tradedDay: true,
      });
    }
  }
  return {
    id: subject.id,
    detector: D05,
    nonce: mint.nonce,
    shape: 'martingale-sequence',
    actors: [account, identity],
    rows: {
      fills,
      marks,
      [ACCOUNTS_STREAM]: [{ id: account, identityId: identity, phase: 'eval' }],
    },
  };
}

function scanMartingale(input: DetectorScanInput): DetectorOutcome {
  const { definition, now } = input.request;
  const slopeBp = statedInteger(D05, definition, 'size_after_loss_slope_bp');
  const minSequences = statedInteger(D05, definition, 'min_sequences');
  if (minSequences < 2) {
    throw new DetectorDeclined(
      D05,
      `its min_sequences is ${String(minSequences)}. M07:112 is "at STRATEGY level, over a ` +
        'minimum number of sequences ... never a single sequence", and a minimum below 2 makes ' +
        'this a single-sequence detector, which is a bad week rather than a strategy.',
    );
  }
  if (slopeBp <= 0) {
    throw new DetectorDeclined(
      D05,
      `its size_after_loss_slope_bp is ${String(slopeBp)}bp. A non-positive escalation floor ` +
        'makes every held-or-reduced size after a loss a martingale step, which fires on ' +
        'everybody who traded twice.',
    );
  }
  // SEVERITY IS READ BEFORE A ROW IS TOUCHED, so a decline is a property of the
  // registry rather than of whether this particular night had a match. `M07`
  // section 3.3 cites NO case for D-05 and the seed's severity is `unstated`, so
  // this is the line the shipped registry stops at today.
  const wanted = statedInteger(D05, definition, 'severity');

  // THE DAY SERIES, per account: contracts traded and whether the day lost.
  const contracts = new Map<string, Map<string, number>>();
  for (const row of input.rows['fills'] ?? []) {
    const accountId = text(row, 'accountId');
    const day = text(row, 'tradingDay');
    const quantity = count(row, 'quantity');
    if (accountId === undefined || day === undefined || quantity === undefined) {
      continue;
    }
    const days = contracts.get(accountId) ?? new Map<string, number>();
    days.set(day, (days.get(day) ?? 0) + quantity);
    contracts.set(accountId, days);
  }
  const losses = new Map<string, Set<string>>();
  for (const row of input.rows['marks'] ?? []) {
    const accountId = text(row, 'accountId');
    const day = text(row, 'tradingDay');
    const pnl = cents(row, 'realizedPnlCents');
    if (accountId === undefined || day === undefined || pnl === undefined || pnl >= 0n) {
      continue;
    }
    const days = losses.get(accountId) ?? new Set<string>();
    days.add(day);
    losses.set(accountId, days);
  }

  const book = accountBook(input.rows[ACCOUNTS_STREAM] ?? []);
  const findings: DetectorFinding[] = [];
  for (const [accountId, days] of contracts) {
    const series: SizeDay[] = [...days.entries()]
      .map(([day, size]) => ({
        day,
        contracts: size,
        loss: losses.get(accountId)?.has(day) === true,
      }))
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

    // A SEQUENCE IS A MAXIMAL RUN OF ESCALATIONS AFTER A LOSS. The comparison is
    // an integer cross-multiplication: `next * 10000 >= previous * (10000 +
    // slope)`, so a near-miss is one contract short rather than a rounding, and
    // no ratio is ever computed as a float.
    let sequencesFound = 0;
    let inSequence = false;
    let steps = 0;
    const escalations: { from: string; to: string; contracts: [number, number] }[] = [];
    for (let i = 1; i < series.length; i += 1) {
      const previous = series[i - 1];
      const day = series[i];
      if (previous === undefined || day === undefined) {
        continue;
      }
      const escalated =
        previous.loss &&
        previous.contracts > 0 &&
        day.contracts * 10_000 >= previous.contracts * (10_000 + slopeBp);
      if (!escalated) {
        inSequence = false;
        continue;
      }
      steps += 1;
      escalations.push({
        from: previous.day,
        to: day.day,
        contracts: [previous.contracts, day.contracts],
      });
      if (!inSequence) {
        sequencesFound += 1;
        inSequence = true;
      }
    }
    if (sequencesFound < minSequences) {
      continue;
    }
    const facts = book.get(accountId);
    if (facts === undefined) {
      continue;
    }
    // `scoreSeverity` still refuses to write a 4 or a 5 without a clock, even
    // when the registry states one. Section 5 of the header.
    const scored = scoreSeverity(definition, wanted, now);
    findings.push({
      subjects: [accountId],
      identityId: facts.identityId,
      accountId,
      flagType: D05_FLAG_TYPE,
      severity: scored.severity,
      ...(scored.slaDueAt === undefined ? {} : { slaDueAt: scored.slaDueAt }),
      evidence: {
        account: accountId,
        identity: facts.identityId,
        sequences: sequencesFound,
        escalating_days: steps,
        escalations,
        traded_days: series.length,
        ...(scored.cappedFrom === undefined
          ? {}
          : { severity_capped_from: scored.cappedFrom, severity_cap_reason: SEVERITY_CAP_REASON }),
      },
    });
  }
  return { findings };
}

// -----------------------------------------------------------------------------
// The set, as a scheduled run holds it
// -----------------------------------------------------------------------------

/**
 * `P7-f`'s three, in `M07` section 3.2's order.
 *
 * A PLAIN ARRAY AND NOT A REGISTRY. `P7` section 5.5: `apps/worker` has no route
 * registry to inherit `ADR-100`'s shape from, so the convention is reached by
 * hand -- one module per detector family, one exported set per module -- and
 * `runDetectors` is agnostic about which detectors it is handed.
 *
 * **`DEP-M7-01` IS A RESIDUAL AND NOT A BLOCKER, AND THE ASSUMPTION IS STATED.**
 * All three of these read `fills`, which `M02` supplies contingent on `V-M2-11`,
 * and `M02` holds at `review` pending the Rithmic vendor call. What is assumed
 * here is that a fill row arrives with `account_id`, `symbol`, `side`,
 * `quantity` and `executed_at` populated, which is what `0008`-era `fills`
 * declares `NOT NULL` today. If the vendor cannot supply fill-level data at all,
 * these three detectors have no input and the code is unaffected: they would
 * read empty windows and raise nothing, and their canaries would still be found,
 * which is `AS-M7-05`'s own opening sentence and the reason the canary battery
 * is not the whole control.
 */
export const FILL_DETECTORS: readonly Detector[] = [
  fillClusteringNightly,
  newsWindowClusteringNightly,
  martingaleSequencesNightly,
];
