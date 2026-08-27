// =============================================================================
// apps/worker/src/detectors/canary.ts
// =============================================================================
// `AS-M7-05`'s SEEDED SYNTHETIC POSITIVES, MINTED PER RUN AND NEVER PERSISTED.
//
// -----------------------------------------------------------------------------
// THE FAILURE THIS FILE EXISTS FOR, IN M07'S OWN WORDS
// -----------------------------------------------------------------------------
// "A schema change renames a column, a null-handling path swallows a case, a
// threshold stops matching the data's shape after a plan config changes, or a
// query that used to scan 200,000 rows now scans zero because a join condition
// drifted. `detector_runs` records `status: ok`, `rows_scanned: 0`,
// `flags_raised: 0`. THAT IS INDISTINGUISHABLE FROM A GENUINELY QUIET NIGHT,
// and quiet nights are the normal case, so nobody looks."
// (`docs/plans/M07-risk-abuse.md:343`, `AS-M7-05`; `FM-M7-01` names it the
// worst failure in the module.)
//
// The counter is a battery of subjects constructed to trip exactly that
// detector, which the run asserts it found (`SD-M7-01`, `INV-M7-07`). A run
// that finds fewer than it seeded is `degraded` and pages (`GS-122`).
//
// -----------------------------------------------------------------------------
// THE COLUMN `AS-M7-05` NAMES DOES NOT EXIST, AND THIS FILE TAKES THE STRONGER
// READING RATHER THAN THE MISSING ONE
// -----------------------------------------------------------------------------
// `AS-M7-05` says the subjects are "flagged `is_synthetic`", citing the
// discipline `M02 OQ-M2-01` PROPOSES for simulator accounts: "yes, with a hard
// `is_synthetic` flag on the identity and a CI test asserting every aggregate
// query excludes it". **`OQ-M2-01` IS AN OPEN QUESTION AND NO MIGRATION IN THIS
// TREE DECLARES SUCH A COLUMN.** Measured: `grep -rn 'is_synthetic'
// packages/db/migrations/` returns nothing, and the only `synthetic` columns in
// the estate are `detector_runs.synthetic_expected` and `synthetic_found`, which
// are COUNTERS about a run rather than a marker on a subject.
//
// So the column reading needs a migration, and this slice holds no migration
// number and may not take one. What it takes instead is the reading that makes
// the same assertion UNCONDITIONALLY TRUE:
//
//   **A CANARY IS NEVER WRITTEN TO THE DATABASE AT ALL.** It is minted in
//   memory, handed to the detector alongside the real rows the run read, and
//   discarded when the run ends.
//
// A marker column makes "excluded from every aggregate, statistic and published
// number" a property every present and FUTURE query has to honour, and the CI
// test `AS-M7-05` asks for is the thing that watches them. A row that was never
// inserted is excluded from every aggregate by construction, including the ones
// nobody has written yet. That is strictly stronger, and it is cheaper: there is
// no column to add, no query to audit, and no day on which somebody adds the
// nineteenth aggregate and forgets.
//
// **WHAT IT COSTS IS NAMED RATHER THAN WAVED AT.** A canary that is never
// persisted does not exercise the read path: it proves the detector's PREDICATE
// still matches, and proves nothing about whether `rowsWhere` still returns the
// rows it used to. A schema change that renames `fills.executed_at` breaks the
// read and this battery would still find its canaries, because the canaries
// arrive through the same in-memory door on either side of the rename. THAT
// HALF OF `AS-M7-05` IS NOT DISCHARGED HERE and is reported rather than implied:
// closing it needs a persisted subject, which needs the marker column, which
// needs a migration and the ruling that goes with it.
//
// -----------------------------------------------------------------------------
// REGENERATED PER RUN, AND IT IS A GUARD RATHER THAN A COMMENT
// -----------------------------------------------------------------------------
// `AS-M7-05`'s second implementation note: the subjects "must be REGENERATED PER
// RUN rather than static, or a detector that has memorized them passes while
// broken for real data."
//
// Every identifier this file mints CARRIES THE RUN'S NONCE, and
// {@link carriesNonce} is what the runner checks every returned subject against.
// A detector that answers `canaries()` with a frozen array built at module load
// returns identifiers carrying some OTHER run's nonce, and the runner refuses
// the run rather than counting them. That turns "regenerated per run" from a
// convention a reviewer has to notice into a state the run cannot reach.
//
// -----------------------------------------------------------------------------
// THIS FILE IMPORTS NOTHING
// -----------------------------------------------------------------------------
// `apps/worker/package.json` declares `@merit/rules-engine` and nothing else,
// and `apps/worker/src/db.ts` is this deployable's ONE door onto `@merit/db`
// (`ADR-165`), asserted by `test/db.test.ts` walking the tree. So the rows here
// are structural records with the Drizzle property names the accessor returns,
// read out of `packages/db/src/schema.ts` and cited at each shape.
// =============================================================================

/**
 * One row as a detector sees it: Drizzle property names, opaque values.
 *
 * A CANARY ROW IS DELIBERATELY NOT A VALID DATABASE ROW. Its `id` and its
 * `accountId` are canary identifiers rather than UUIDs, so if one of these ever
 * reached an `insert` the column type would refuse it. That is the third line of
 * defence behind "never written" and "the runner refuses a mixed finding", and
 * it costs nothing.
 */
export type CanaryRow = Readonly<Record<string, unknown>>;

/**
 * The prefix every identifier this file mints begins with.
 *
 * IT IS A NAMESPACE RATHER THAN A FLAG. Every identity, account and row
 * identifier in the trader database is a `uuid`, and no UUID contains a colon,
 * so a canary identifier cannot collide with a real one and a real identifier
 * cannot be mistaken for a canary. The runner asserts BOTH directions: a finding
 * mixing the two is refused, and a row arriving from the database carrying this
 * prefix means a canary was persisted, which is the failure this whole design
 * exists to make impossible.
 */
export const CANARY_PREFIX = 'canary';

/**
 * The four shapes `AS-M7-05` names, and no fifth.
 *
 * M07 line 347, verbatim: "a hedged pair with correlation -0.95, a same-second
 * fill cluster, a martingale sequence, a destination shared by two identities".
 *
 * THEY ARE NAMED HERE RATHER THAN IN EACH DETECTOR because a shape invented at
 * the detector is a shape nobody reviewed against `AS-M7-05`, and because the
 * four span the four input families M07 section 3.2 gives the detector set:
 * `fills`, `daily_marks`, `payout_transfers` and the identity graph. A detector
 * needing a fifth builds one from {@link CanaryMint.subject} and states why.
 */
export const CANARY_SHAPES = [
  'hedged-pair',
  'same-second-fill-cluster',
  'martingale-sequence',
  'shared-destination',
] as const;

/** One of {@link CANARY_SHAPES}. */
export type CanaryShape = (typeof CANARY_SHAPES)[number];

/**
 * A run's nonce, which is the whole of "regenerated per run".
 *
 * IT IS BRANDED SO THAT A CALLER CANNOT PASS A LITERAL. The brand's symbol is
 * module local, so {@link canaryNonce} is the only producer and a detector
 * cannot fabricate one to mint identifiers outside the run it is in.
 */
export type CanaryNonce = string & { readonly __canaryNonce: unique symbol };

/** The shortest value {@link canaryNonce} accepts. */
export const CANARY_NONCE_MIN_LENGTH = 8;

/**
 * Raised when a nonce cannot be used, or when a minted identifier is malformed.
 */
export class CanaryNonceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanaryNonceError';
  }
}

/**
 * The one producer of a {@link CanaryNonce}.
 *
 * **IT REFUSES A SHORT OR STRUCTURED VALUE RATHER THAN ACCEPTING IT.** A nonce
 * is the only thing standing between "regenerated per run" and a battery that
 * looks fresh and is not, and the two ways to get it wrong are a value with too
 * little entropy and a value carrying a separator that would make one canary's
 * identifier parse as another's. Both are refused here, once, rather than at
 * eighteen call sites.
 *
 * THIS FUNCTION DOES NOT GENERATE THE NONCE AND THAT IS DELIBERATE. The source
 * is `DetectorRunnerIo.nonce()`, supplied by the wiring, so a suite can pin it
 * and a production adapter can take it from the run's own identifier. A
 * generator here would put a random source in a module every test imports.
 */
export function canaryNonce(raw: string): CanaryNonce {
  if (raw.length < CANARY_NONCE_MIN_LENGTH) {
    throw new CanaryNonceError(
      `a canary nonce must be at least ${String(CANARY_NONCE_MIN_LENGTH)} characters and this one ` +
        `is ${String(raw.length)}. AS-M7-05 requires the synthetic subjects to be regenerated per ` +
        'run, and a nonce a caller could collide by accident is a battery that goes stale without ' +
        'anybody noticing.',
    );
  }
  if (raw.includes(':') || raw.includes('#')) {
    throw new CanaryNonceError(
      `a canary nonce may not contain ":" or "#" and this one is ${JSON.stringify(raw)}. Both are ` +
        "identifier separators here, and a nonce carrying one would let one canary's identifier " +
        "parse as another's subject.",
    );
  }
  return raw as CanaryNonce;
}

/**
 * A synthetic subject: what it is, what run minted it, and the rows that carry
 * it into the detector.
 */
export interface CanarySubject {
  /** `canary:<detector>:<nonce>:<ordinal>`. */
  readonly id: string;
  /** The detector this subject was constructed to trip. */
  readonly detector: string;
  /** The run that minted it. */
  readonly nonce: CanaryNonce;
  /** Which of `AS-M7-05`'s four this is. */
  readonly shape: CanaryShape;
  /**
   * The identifiers this subject occupies, which is what a finding names.
   *
   * A hedged pair holds two account identifiers; a shared destination holds two
   * identity identifiers. The runner partitions findings by asking whether a
   * finding's subjects are in here.
   */
  readonly actors: readonly string[];
  /**
   * The rows, by the stream name the detector declared.
   *
   * THESE ARE MERGED INTO THE REAL ROWS THE RUN READ AND ARE NEVER WRITTEN. See
   * the header: not persisting them is what makes "excluded from every
   * aggregate" true of queries nobody has written yet.
   */
  readonly rows: Readonly<Record<string, readonly CanaryRow[]>>;
}

/**
 * The minting surface a detector is handed when the runner asks for its
 * canaries.
 *
 * THE DETECTOR MINTS ITS OWN BECAUSE IT IS THE ONLY THING THAT KNOWS WHAT TRIPS
 * IT (`AS-M7-05`: "constructed to trip exactly that detector"). What the runner
 * keeps is the discipline: every identifier carries this run's nonce, and the
 * runner checks it rather than trusting it.
 */
export interface CanaryMint {
  /** The run's nonce, so a detector can build a shape this file does not name. */
  readonly nonce: CanaryNonce;
  /**
   * An identifier for the `ordinal`-th subject of this detector, and the actor
   * identifiers under it.
   */
  subject(detector: string, ordinal: number): CanarySubjectId;
  /** {@link hedgedPair}, bound to this run's nonce. */
  hedgedPair(detector: string, ordinal: number, options?: HedgedPairOptions): CanarySubject;
  /** {@link sameSecondFillCluster}, bound to this run's nonce. */
  sameSecondFillCluster(
    detector: string,
    ordinal: number,
    options?: FillClusterOptions,
  ): CanarySubject;
  /** {@link martingaleSequence}, bound to this run's nonce. */
  martingaleSequence(detector: string, ordinal: number, options?: MartingaleOptions): CanarySubject;
  /** {@link sharedDestination}, bound to this run's nonce. */
  sharedDestination(
    detector: string,
    ordinal: number,
    options?: SharedDestinationOptions,
  ): CanarySubject;
}

/** A subject's identifier, and the actor identifiers derived under it. */
export interface CanarySubjectId {
  /** `canary:<detector>:<nonce>:<ordinal>`. */
  readonly id: string;
  /** `<id>#<role>`, which is what a row's `accountId` or `identityId` carries. */
  actor(role: string): string;
  /** `<id>#row-<n>`, which is what a row's own `id` carries. */
  row(ordinal: number): string;
}

/** True when `value` is a string this file minted. */
export function isCanaryId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(`${CANARY_PREFIX}:`);
}

/**
 * True when `value` is a canary identifier minted under `nonce`.
 *
 * **THIS IS THE `AS-M7-05` NOTE-2 GUARD.** The runner calls it on every actor of
 * every subject a detector returns, so a memorized battery -- a frozen array
 * built once at module load, or a fixture reused between runs -- carries some
 * other run's nonce and is refused. A detector cannot pass this by being
 * careful; it can only pass it by having minted from this run's mint.
 */
export function carriesNonce(value: unknown, nonce: CanaryNonce): boolean {
  return isCanaryId(value) && value.split(':')[2] === nonce;
}

/**
 * The subject identifier a canary actor or row belongs to, or `undefined`.
 *
 * `canary:D-01:abcdefgh:0#a1` resolves to `canary:D-01:abcdefgh:0`, which is how
 * the runner maps a finding's subjects back onto the battery it seeded.
 */
export function canarySubjectOf(value: unknown): string | undefined {
  if (!isCanaryId(value)) {
    return undefined;
  }
  const hash = value.indexOf('#');
  return hash === -1 ? value : value.slice(0, hash);
}

/**
 * `canary:<detector>:<nonce>:<ordinal>`, and the actor and row identifiers under
 * it.
 */
export function canarySubjectId(
  detector: string,
  nonce: CanaryNonce,
  ordinal: number,
): CanarySubjectId {
  if (!Number.isInteger(ordinal) || ordinal < 0) {
    throw new CanaryNonceError(
      `a canary ordinal must be a non-negative integer and this one is ${String(ordinal)}.`,
    );
  }
  if (detector.includes(':') || detector.includes('#') || detector.length === 0) {
    throw new CanaryNonceError(
      `a detector identifier may not be blank or contain ":" or "#" and this one is ` +
        `${JSON.stringify(detector)}. It is a segment of the canary identifier and a separator in ` +
        'it would make the identifier parse wrong.',
    );
  }
  const id = `${CANARY_PREFIX}:${detector}:${nonce}:${String(ordinal)}`;
  return {
    id,
    actor: (role: string) => `${id}#${role}`,
    row: (n: number) => `${id}#row-${String(n)}`,
  };
}

// -----------------------------------------------------------------------------
// `AS-M7-05`'s four shapes
// -----------------------------------------------------------------------------
//
// EVERY COLUMN NAME BELOW IS A DRIZZLE PROPERTY OF `packages/db/src/schema.ts`,
// which is what `rowsWhere` returns, so a canary row and a real row are the same
// shape to a detector. They are transcribed rather than imported for the reason
// this file's header gives: this deployable has one door onto `@merit/db` and it
// is not this file.
//
// EVERY NUMBER IS AN INTEGER. Money is `bigint` cents, sizes are contract
// counts, and correlations are expressed by MIRRORING a series rather than by
// writing a coefficient, so no float appears here at all
// (`MERIT_BUILD_MASTER_PROMPT` Appendix, and `P7` section 11 rule 17).

/** {@link hedgedPair}'s knobs. */
export interface HedgedPairOptions {
  /** The stream the rows go into. Default `dailyMarks`. */
  readonly stream?: string;
  /** How many trading days the pair runs for. Default 5, which is `D-13`'s window. */
  readonly days?: number;
  /** The first trading day, `YYYY-MM-DD`. Default `2026-01-05`. */
  readonly from?: string;
  /** The magnitude of day one's move, in integer cents. Default 250000. */
  readonly amplitudeCents?: number;
}

/**
 * A HEDGED PAIR: two accounts whose daily realized P&L is EXACTLY mirrored.
 *
 * `AS-M7-05` names "a hedged pair with correlation -0.95". This mints a pair at
 * correlation **-1.0000**, which is stronger, and it is stronger deliberately:
 * the two floors in the registry are `D-02`'s -8000 bp and `D-13`'s -9500 bp
 * (`m07-detectors-v1.rows.json`), and a canary sitting AT -9500 would pass one
 * detector and sit exactly on the other's boundary, where an inclusive-versus-
 * exclusive comparison decides whether the battery is found. A canary must fail
 * for one reason only, which is that the detector is broken.
 *
 * IT IS BUILT BY MIRRORING A SERIES RATHER THAN BY WRITING A COEFFICIENT, which
 * is what keeps every value in it an integer number of cents.
 *
 * The magnitudes vary by day, because a pair of CONSTANT series has zero
 * variance and an undefined Pearson correlation: a detector dividing by a
 * standard deviation would get `NaN` from a flat canary and could report "not
 * found" while working perfectly.
 */
export function hedgedPair(
  detector: string,
  nonce: CanaryNonce,
  ordinal: number,
  options: HedgedPairOptions = {},
): CanarySubject {
  const subject = canarySubjectId(detector, nonce, ordinal);
  const stream = options.stream ?? 'dailyMarks';
  const days = options.days ?? 5;
  const amplitude = options.amplitudeCents ?? 250000;
  const long = subject.actor('a-long');
  const short = subject.actor('a-short');
  const rows: CanaryRow[] = [];
  for (let day = 0; day < days; day += 1) {
    // A varying magnitude, so the series has variance. Integer cents throughout.
    const move = amplitude * (day + 1) - amplitude * 2 * (day % 2);
    const tradingDay = addDays(options.from ?? '2026-01-05', day);
    rows.push({
      id: subject.row(rows.length),
      accountId: long,
      tradingDay,
      realizedPnlCents: BigInt(move),
      winDay: move > 0,
      tradedDay: true,
    });
    rows.push({
      id: subject.row(rows.length),
      accountId: short,
      tradingDay,
      realizedPnlCents: BigInt(-move),
      winDay: -move > 0,
      tradedDay: true,
    });
  }
  return {
    id: subject.id,
    detector,
    nonce,
    shape: 'hedged-pair',
    actors: [long, short],
    rows: { [stream]: rows },
  };
}

/** {@link sameSecondFillCluster}'s knobs. */
export interface FillClusterOptions {
  /** The stream the rows go into. Default `fills`. */
  readonly stream?: string;
  /** How many mirrored fills each account takes. Default 6. */
  readonly fills?: number;
  /** The instant the cluster sits on. Default `2026-01-05T14:30:00.000Z`. */
  readonly at?: Date;
  /** The symbol. Default `ESH6`. */
  readonly symbol?: string;
}

/**
 * A SAME-SECOND FILL CLUSTER: two accounts, one symbol, one side, one instant.
 *
 * `AS-M7-05`'s second shape, and `D-01`'s subject: "two accounts with fills on
 * the same symbol and side within a 2 second window, more than a configured
 * share of both accounts' fills" (`M07:108`).
 *
 * **BOTH HALVES OF `D-01`'s STATISTIC ARE SATISFIED AND THE SECOND IS THE ONE A
 * READER WOULD MISS.** The window is trivially satisfied by putting the fills on
 * the same instant. The SHARE is satisfied by these being the only fills either
 * canary account has, so the shared share is 100 percent and clears any
 * configured floor. A canary that satisfied the window and not the share would
 * go unfound by a correct detector, which is a page at 02:00 for nothing and is
 * how a canary battery gets switched off.
 *
 * **THE TWO ACCOUNTS BELONG TO TWO IDENTITIES, AND THAT IS NOT DECORATION.**
 * `M07` section 3.4 makes `D-01` filter SAME-identity pairs at the query rather
 * than dismissing them in the queue, so a canary whose two accounts shared an
 * identity would be correctly filtered out and correctly not found.
 */
export function sameSecondFillCluster(
  detector: string,
  nonce: CanaryNonce,
  ordinal: number,
  options: FillClusterOptions = {},
): CanarySubject {
  const subject = canarySubjectId(detector, nonce, ordinal);
  const stream = options.stream ?? 'fills';
  const count = options.fills ?? 6;
  const at = options.at ?? new Date('2026-01-05T14:30:00.000Z');
  const symbol = options.symbol ?? 'ESH6';
  const tradingDay = at.toISOString().slice(0, 10);
  const leader = subject.actor('a-leader');
  const follower = subject.actor('a-follower');
  const rows: CanaryRow[] = [];
  for (let n = 0; n < count; n += 1) {
    for (const [account, identity] of [
      [leader, subject.actor('i-leader')],
      [follower, subject.actor('i-follower')],
    ] as const) {
      rows.push({
        id: subject.row(rows.length),
        accountId: account,
        identityId: identity,
        symbol,
        side: 'buy',
        quantity: 2,
        executedAt: new Date(at.getTime() + n * 1000),
        tradingDay,
      });
    }
  }
  return {
    id: subject.id,
    detector,
    nonce,
    shape: 'same-second-fill-cluster',
    actors: [leader, follower, subject.actor('i-leader'), subject.actor('i-follower')],
    rows: { [stream]: rows },
  };
}

/** {@link martingaleSequence}'s knobs. */
export interface MartingaleOptions {
  /** The stream the rows go into. Default `fills`. */
  readonly stream?: string;
  /** How many losing-then-doubling sequences. Default 4. */
  readonly sequences?: number;
  /** How many doublings inside each sequence. Default 4. */
  readonly steps?: number;
  /** The first sequence's opening size, in contracts. Default 1. */
  readonly openingContracts?: number;
  /** The first instant. Default `2026-01-05T14:30:00.000Z`. */
  readonly at?: Date;
}

/**
 * A MARTINGALE SEQUENCE: size doubling after every loss, over several sequences.
 *
 * `AS-M7-05`'s third shape, and `D-05`'s subject: "size-after-loss regression at
 * strategy level, over a minimum number of sequences ... Strategy level, never a
 * single sequence" (`M07:112`).
 *
 * **IT MINTS FOUR SEQUENCES RATHER THAN ONE FOR THAT REASON.** `D-05`'s
 * `min_sequences` is `unstated` in the registry, so a canary of one sequence
 * would be found or not found depending on a number nobody has chosen yet, and a
 * canary whose outcome turns on an unset threshold is a canary that pages when
 * the threshold is finally set. Four is above any plausible minimum and the cost
 * of the extra rows is nothing.
 *
 * SIZES ARE CONTRACT COUNTS AND DOUBLE EXACTLY, so the regression a detector
 * fits has slope one in log space with no residual at all.
 */
export function martingaleSequence(
  detector: string,
  nonce: CanaryNonce,
  ordinal: number,
  options: MartingaleOptions = {},
): CanarySubject {
  const subject = canarySubjectId(detector, nonce, ordinal);
  const stream = options.stream ?? 'fills';
  const sequences = options.sequences ?? 4;
  const steps = options.steps ?? 4;
  const opening = options.openingContracts ?? 1;
  const at = options.at ?? new Date('2026-01-05T14:30:00.000Z');
  const account = subject.actor('a-martingale');
  const rows: CanaryRow[] = [];
  let minute = 0;
  for (let sequence = 0; sequence < sequences; sequence += 1) {
    for (let step = 0; step < steps; step += 1) {
      const executedAt = new Date(at.getTime() + minute * 60000);
      minute += 1;
      rows.push({
        id: subject.row(rows.length),
        accountId: account,
        symbol: 'ESH6',
        side: step % 2 === 0 ? 'buy' : 'sell',
        // Doubles after each loss. Integer contracts, never a fraction.
        quantity: opening * 2 ** step,
        // The loss that provokes the next double. Integer cents.
        realizedPnlCents: BigInt(-10000 * 2 ** step),
        executedAt,
        tradingDay: executedAt.toISOString().slice(0, 10),
        sequenceOrdinal: sequence,
      });
    }
  }
  return {
    id: subject.id,
    detector,
    nonce,
    shape: 'martingale-sequence',
    actors: [account],
    rows: { [stream]: rows },
  };
}

/** {@link sharedDestination}'s knobs. */
export interface SharedDestinationOptions {
  /** The stream the rows go into. Default `payoutTransfers`. */
  readonly stream?: string;
  /** How many identities share the destination. Default 2, which is `D-09`'s "more than one". */
  readonly identities?: number;
  /** Each transfer's amount, in integer cents. Default 150000. */
  readonly amountCents?: number;
}

/**
 * A DESTINATION SHARED BY TWO IDENTITIES.
 *
 * `AS-M7-05`'s fourth shape, and `D-09`'s subject: "one `destination_ref`
 * receiving payouts from more than one unrelated identity ... THE STRONGEST MULE
 * DETECTOR AVAILABLE, and it is a query rather than an inference" (`M07:118`).
 *
 * **`payout_transfers` HAS NO IDENTITY COLUMN AND THAT IS A FINDING FOR `P7-h`
 * RATHER THAN A DEFECT HERE.** Its Drizzle declaration carries
 * `payoutRequestId` and reaches an identity only through `payout_requests`,
 * which is the JOIN `ADR-157` section 5 refused and left as an entry somebody
 * owes. So this shape puts `identityId` ON the row beside `payoutRequestId`: a
 * detector that gets its identity by joining in the runner sets that property as
 * it assembles its input, and one that never resolves an identity finds a canary
 * with two transfers to one destination and cannot tell they are two people,
 * which is `D-09` not working.
 */
export function sharedDestination(
  detector: string,
  nonce: CanaryNonce,
  ordinal: number,
  options: SharedDestinationOptions = {},
): CanarySubject {
  const subject = canarySubjectId(detector, nonce, ordinal);
  const stream = options.stream ?? 'payoutTransfers';
  const count = options.identities ?? 2;
  const amount = options.amountCents ?? 150000;
  const destination = subject.actor('d-shared');
  const actors: string[] = [];
  const rows: CanaryRow[] = [];
  for (let n = 0; n < count; n += 1) {
    const identity = subject.actor(`i-${String(n)}`);
    actors.push(identity);
    rows.push({
      id: subject.row(rows.length),
      identityId: identity,
      payoutRequestId: subject.actor(`p-${String(n)}`),
      destinationRef: destination,
      amountCents: BigInt(amount),
      status: 'settled',
    });
  }
  return {
    id: subject.id,
    detector,
    nonce,
    shape: 'shared-destination',
    actors,
    rows: { [stream]: rows },
  };
}

/**
 * The mint the runner hands a detector, bound to one run's nonce.
 *
 * IT IS THE ONLY WAY A DETECTOR GETS A NONCE-BEARING IDENTIFIER, which is what
 * makes {@link carriesNonce} an assertion about the battery rather than about
 * the detector's manners.
 */
export function canaryMint(nonce: CanaryNonce): CanaryMint {
  return {
    nonce,
    subject: (detector, ordinal) => canarySubjectId(detector, nonce, ordinal),
    hedgedPair: (detector, ordinal, opts) => hedgedPair(detector, nonce, ordinal, opts),
    sameSecondFillCluster: (detector, ordinal, opts) =>
      sameSecondFillCluster(detector, nonce, ordinal, opts),
    martingaleSequence: (detector, ordinal, opts) =>
      martingaleSequence(detector, nonce, ordinal, opts),
    sharedDestination: (detector, ordinal, opts) =>
      sharedDestination(detector, nonce, ordinal, opts),
  };
}

/**
 * `YYYY-MM-DD` plus `days`, on the proleptic Gregorian calendar.
 *
 * **THIS IS NOT A TRADING CALENDAR AND MUST NEVER BE MISTAKEN FOR ONE.** There
 * is no `TradingCalendar` in this tree, and a canary's days only need to be
 * distinct and ordered so the series has variance: nothing about a canary
 * depends on whether the exchange was open. A detector whose own window is in
 * trading days resolves those days through the calendar it reads, not here.
 */
function addDays(from: string, days: number): string {
  const at = new Date(`${from}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
