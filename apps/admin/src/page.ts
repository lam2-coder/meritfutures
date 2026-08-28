// =============================================================================
// apps/admin/src/page.ts
// =============================================================================
// THE LIABILITY HOME PAGE. M06 section 3.1, assembled.
//
// "P-M6-09 IS PLACED LAST IN THE LIST AND FIRST ON THE PAGE." That sentence is
// the page's layout and its argument: "Data trust gates every other number ...
// Rendering them adjacent, with the trust panel above, is the difference
// between a dashboard and a dashboard that misleads." So the trust panel is not
// an element in an array that happens to sort first; it is a field, and every
// other panel carries the verdict it produced.
//
// -----------------------------------------------------------------------------
// A RED BOARD MARKS EVERY NUMBER, IN THE TEXT
// -----------------------------------------------------------------------------
// FM-M6-01: "the page must REFUSE TO LOOK HEALTHY while data trust is red". A
// style cannot do that, because a screenshot of a styled page pasted into a
// message loses the style and keeps the number. Every suspect line therefore
// carries the word in the line.
//
// -----------------------------------------------------------------------------
// THE AGE IS RENDERED AND NOT JUDGED
// -----------------------------------------------------------------------------
// INV-M6-04 requires the as-of; `admin.liability_snapshot_age` is a metric with
// no ruled setpoint. So each line carries "as of <instant>" AND the elapsed time
// at render, which is arithmetic on stated data, and no line says "stale":
// picking the boundary would invent a control nobody chose. `renderedAt` is
// passed in rather than read from the clock, on the engine's own rule about
// ambient inputs.
//
// -----------------------------------------------------------------------------
// INV-M6-10, ASSERTED RATHER THAN OBSERVED
// -----------------------------------------------------------------------------
// "The admin console renders trader-identifying data only when the query names a
// specific subject." The liability home page names no subject: it is the
// aggregate screen. `SD-M6-01` carries `eligible_next_7d_identity_max_id`
// beside the amount, and that id is a LINK TARGET for the drill-down the
// operator clicks through to, which is where a subject gets named. It is not
// rendered here, and `assertNamesNoSubject` scans the produced lines for a
// UUID-shaped token and throws if one appears. A control the page asserts about
// its own output survives a later panel being added carelessly, which a comment
// does not.
// =============================================================================

import type { Cents } from '@merit/rules-engine';
import { type DataTrust, type TrustSignal, assessDataTrust } from './data-trust.ts';
import {
  type AsOf,
  type Reading,
  absent,
  figure,
  formatCents,
  readingIsPresent,
  render,
} from './figure.ts';
import {
  type LiabilitySnapshot,
  type ReserveCoverageSnapshot,
  reserveCoverage,
  theThreeNumbers,
} from './liability.ts';
import {
  type IndicativeMovement,
  type LiveOpenLiability,
  type SameDayAdjustments,
  liveOpenLiability,
} from './live-liability.ts';
import { type AdminOrigin, type Environment, resolveAdminOrigin } from './origin.ts';
import { type AdminRole, mayReadLiabilityHome, requireAdminRole } from './roles.ts';

/** Thrown when the page cannot be assembled, or when it would break an invariant. */
export class PageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageError';
  }
}

/** One panel, ready to render, with the trust verdict already applied. */
export interface PanelRendering {
  /** `P-M6-nn`, or `AS-M6-04` for the third number no panel names. */
  readonly origin: string;
  readonly title: string;
  readonly readings: readonly Reading[];
  /** True when data trust is red. Present in the lines as well as in the flag. */
  readonly suspect: boolean;
  readonly lines: readonly string[];
}

/** A panel M06 defines and this page cannot yet fill, with who owes it. */
export interface PendingPanel {
  readonly origin: string;
  readonly title: string;
  /** The dependency or open item that has to land first. Named, never "later". */
  readonly blockedBy: string;
}

/** P-M6-03's inputs, both of which may be absent. */
export interface EligibleNextSevenDays {
  /** The account-level total. */
  readonly totalCents: Cents;
  readonly asOfInstant: string;
  /**
   * The largest single identity's share, `SD-M6-01`. Optional because the
   * column does not exist: see `buildLiabilityHome`.
   */
  readonly identityMaxCents?: Cents;
}

/** Everything the page renders, supplied by its callers. Nothing is read ambiently. */
export interface LiabilityHomeInput {
  readonly env: Environment;
  readonly role: string;
  /** The instant the page is being rendered, UTC. The age beside each as-of is measured from it. */
  readonly renderedAt: string;
  readonly snapshot: LiabilitySnapshot;
  /** `0009.absorbed_corrections_cents`, signed. P-M6-10. Same row as the snapshot. */
  readonly absorbedCorrectionsCents: Cents;
  readonly trustSignals: readonly TrustSignal[];
  /** P-M6-03. Absent when nobody supplied the forecast (DEP-M6-01). */
  readonly eligibleNextSevenDays?: EligibleNextSevenDays;
  /**
   * P-M6-07's row, from `reserve_coverage_snapshots` (`0049`, ADR-128).
   *
   * A DIFFERENT TABLE ON A DIFFERENT CLOCK, which is why it is its own field
   * and not four more members of `snapshot`. Coverage is the rail's clock
   * (`SD-M5-03`) against ours, so one `as_of` over both would date two figures
   * that do not move together. Absent when nothing supplied it, and the panel
   * then stays in `pending` with the reason.
   */
  readonly reserveCoverage?: ReserveCoverageSnapshot;
  /** Section 3.5's inputs. Absent when there is no feed reading to work from. */
  readonly live?: {
    readonly movement: IndicativeMovement;
    readonly sameDayAdjustments: SameDayAdjustments;
  };
}

/** The page. */
export interface LiabilityHomePage {
  readonly origin: AdminOrigin;
  readonly role: AdminRole;
  readonly renderedAt: string;
  /** First on the page, and the verdict every panel below inherits. */
  readonly dataTrust: DataTrust;
  /** The trust statement, printed above every number. */
  readonly banner: string;
  /** In page order: trust, then section 3.1's panels. */
  readonly panels: readonly PanelRendering[];
  readonly live: LiveOpenLiability;
  /** Panels M06 defines that no supplier fills yet. */
  readonly pending: readonly PendingPanel[];
}

/**
 * The panels M06 defines whose inputs no module supplies yet.
 *
 * THEY ARE LISTED RATHER THAN OMITTED. A page that silently renders five panels
 * where the plan defines ten is a page whose reader believes they are looking at
 * the whole board, which is liability blindness produced by an incomplete
 * dashboard instead of a wrong number.
 */
const PENDING: readonly PendingPanel[] = [
  {
    origin: 'P-M6-04',
    title: 'Payout velocity',
    blockedBy:
      'M5 settled-payout series. Trailing 7 day settled cents against the 30 day average, ' +
      'alarming above 2.5x, and no module supplies the series to this page yet',
  },
  {
    origin: 'P-M6-05',
    title: 'Per-plan loss ratio',
    blockedBy:
      'SD-M6-02 `plan_breaker_state` has landed in 0016 and nothing writes it. INV-M6-07 ' +
      'requires the sample size beside every ratio, so a panel built before the writer exists ' +
      'would render a ratio with no denominator, which AS-M6-02 is exactly about',
  },
  {
    origin: 'P-M6-06',
    title: 'Pass-rate CUSUM per plan',
    blockedBy:
      'DEP-M6-05. The simulation harness supplies mu_0 and sigma, and FM-M6-07 makes an ' +
      'uncalibrated CUSUM either constant alarms or none, which is the same as no chart',
  },
  {
    origin: 'P-M6-07',
    title: 'Reserve coverage',
    // THE COLUMNS EXIST NOW AND THIS ROW SAID THEY DID NOT. `OI-01` closed
    // when `0049_reserve_coverage_snapshots.sql` landed under ADR-128, so what
    // blocks this panel is no longer a schema gap; it is that no producer
    // writes the table, which 0049's own header states as a deliberate
    // omission ("no producer, no rows"). A blockedBy that names a closed item
    // is worse than none: a reader chasing it finds the item closed and
    // concludes the panel is unblocked.
    blockedBy:
      'no producer, and not a missing column. `reserve_coverage_snapshots` landed in ' +
      '`0049_reserve_coverage_snapshots.sql` under ADR-128, which closed OI-01 and carries ' +
      'reserve_cents, cvar99_cents and a GENERATED rcr_bp. Nothing writes it: 0049 says so ' +
      'itself, and DEP-M6-02 (a live rail balance) and DEP-M6-05 (CVaR99 at rho = 0.30) name ' +
      'the two suppliers. Pass `reserveCoverage` to this page and the panel renders',
  },
  {
    origin: 'P-M6-08',
    title: 'MID health',
    blockedBy: 'M03 SD-M3-03 routing state, and no provider metrics reach this page yet',
  },
];

// THE PATTERN CARRIES NO BOUNDARY ASSERTION, AND THE OMISSION IS THE REPAIR.
//
// It was `\b[0-9a-f]{8}-...-[0-9a-f]{12}\b` until session 348. A `\b` is a WORD
// boundary, so a word character on either side of the token removes it and the
// match is lost: `linked to <uuid>`, `manual-review-<uuid>` and `ref:<uuid>` all
// threw, while `linked_to_<uuid>`, `x<uuid>` and `<uuid>y` all passed. An
// underscore is a word character, which is why the first of those three is the
// spelling a real payload carries. Session 344 found it by a SEED FAILING TO
// FIRE rather than by reading this line, which is the only way a hole in a
// refusal gets found: a guard that refuses too little is green all the way down.
//
// DROPPING BOTH BOUNDARIES RATHER THAN REPLACING THEM WITH A LOOKAROUND BUYS A
// PROPERTY. Removing an assertion from a regex can only ADD matches, so this
// pattern refuses a strict SUPERSET of what the old one refused: no line that
// used to throw now passes, and `M6-A-55` asserts that over a generated corpus
// rather than trusting the argument. A hex-digit lookbehind, `(?<![0-9a-f])`,
// was the alternative and leaves a residue this cannot afford: `d` is a hex
// digit, so `id<uuid>` would still pass, and `id` is exactly the prefix an
// operator screen glues on.
//
// WHAT THE WIDENING COSTS, STATED RATHER THAN LEFT TO BE FOUND: a uuid shape
// sitting inside a longer hex-and-dash run is now refused too, so a 16-hex first
// group or a 13-hex last group throws where it did not. That is a token this
// page has no business printing either, and refusing it is the safe direction
// for a control whose false negative is bulk PII on an aggregate screen
// (FM-M6-10) and whose false positive is a page that says so loudly.
//
// The widening is in the NEIGHBOURS and never in the SHAPE: the five groups
// still have to be 8-4-4-4-12 hex with four dashes, so a token one digit or one
// dash short is not a match here any more than it was before.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * INV-M6-10 on the page's own output.
 *
 * The home page names no subject, so a trader-identifying token in a rendered
 * line is the bulk-PII surface FM-M6-10 exists to refuse, arriving one panel at
 * a time.
 */
export function assertNamesNoSubject(lines: readonly string[]): void {
  for (const line of lines) {
    if (UUID.test(line))
      throw new PageError(
        'a rendered line on the liability home page carries an identifier that names a subject. ' +
          'INV-M6-10: the console renders trader-identifying data only when the query names one, ' +
          'and this page names none. The id belongs on the link, not in the figure',
      );
  }
}

/**
 * SECTION 5.3, ASSERTED IN THE NEGATIVE, OVER THE BYTES THE PAGE ACTUALLY
 * PRINTS.
 *
 * `reserveCoverage` already refuses an incoherent ROW, and that is a check on
 * the input. This is a check on the OUTPUT, and the two catch different
 * defects: an arithmetic guard cannot see a renderer that computes the sum
 * itself on its way to a line, and a value reaches a page through a label, a
 * definition, a provenance clause or an error string without ever being a
 * `Figure`. So the forbidden numbers are searched for in the rendered text.
 *
 * TWO SCOPES, DELIBERATELY, AND THE REASON IS FALSE POSITIVES RATHER THAN
 * THOROUGHNESS:
 *
 *   the forbidden CENTS       searched in the P-M6-07 panels only. `reserve +
 *   `reserve + float`         float` is an amount of money, and an amount of
 *                             money can legitimately equal an unrelated figure
 *                             on another panel. A page that threw on that
 *                             coincidence would be a control nobody could keep
 *
 *   the forbidden RATIO       searched over the WHOLE page. A basis-point token
 *   `(reserve + float) /      is not an amount of money and collides with
 *   cvar99`, in bp            nothing else this page prints, so the wider scope
 *                             costs nothing and catches the leak wherever it
 *                             surfaced
 *
 * BOTH SEARCHES ARE SKIPPED WHEN THE FLOAT IS ZERO, and that is stated rather
 * than silently handled: with no float, `reserve + float` IS `reserve` and
 * there is nothing for the assertion to tell apart. A suite that proved this
 * control works on a book with an empty wallet would have proved nothing, which
 * is why `GS-229` is "reserve coverage computed while the wallet float is
 * LARGE".
 */
export function assertFloatIsNotReserve(input: {
  /** Every line the page prints, in page order. */
  readonly allLines: readonly string[];
  /** The lines of the two P-M6-07 panels only. */
  readonly coverageLines: readonly string[];
  readonly reserveCents: Cents;
  readonly floatCents: Cents;
  readonly cvar99Cents: Cents;
  /** The ratio actually rendered, read from `0049`'s generated column. */
  readonly ratioBp: bigint;
}): void {
  // The label AND its colon, which is what `render` puts between a label and
  // its amount. Matching the bare label would be satisfied by a panel heading
  // or by a mention inside another figure's definition, and the claim here is
  // that each of the two was actually PRINTED AS A FIGURE.
  const reserveLabelled = input.coverageLines.some((line) =>
    line.includes('Reserve, the RCR numerator: '),
  );
  const floatLabelled = input.coverageLines.some((line) =>
    line.includes('Wallet float, reported separately: '),
  );
  if (!reserveLabelled || !floatLabelled)
    throw new PageError(
      'the reserve coverage panels do not print the reserve and the wallet float as two ' +
        'separately labelled figures. DEP-M20-06 requires M6 to render float and reserve as ' +
        'VISIBLY SEPARATE figures, and a panel that prints one of them is the panel AS-M20-08 ' +
        'describes with a step already taken',
    );

  if (input.floatCents === 0n) return;

  const forbiddenCents = formatCents(input.reserveCents + input.floatCents);
  const centsToken = new RegExp(`(?<![\\d.])${forbiddenCents.replace('.', '\\.')}(?![\\d])`);
  const offendingLine = input.coverageLines.find((line) => centsToken.test(line));
  if (offendingLine !== undefined)
    throw new PageError(
      `a reserve coverage line prints ${forbiddenCents}, which is the reserve ` +
        `(${formatCents(input.reserveCents)}) with the wallet float ` +
        `(${formatCents(input.floatCents)}) folded into it: "${offendingLine}". Wallet balances ` +
        'are NEVER counted toward reserve (INV-M20-08), the float is segregated in reporting as ' +
        'well as in fact, and this is the line AS-M20-08 is about',
    );

  const forbiddenRatioBp = ((input.reserveCents + input.floatCents) * 10_000n) / input.cvar99Cents;
  if (forbiddenRatioBp === input.ratioBp) return;
  const bpToken = new RegExp(`(?<!\\d)${forbiddenRatioBp} bp(?!\\d)`);
  const offendingRatio = input.allLines.find((line) => bpToken.test(line));
  if (offendingRatio !== undefined)
    throw new PageError(
      `a rendered line prints ${forbiddenRatioBp} bp, which is the coverage ratio computed from ` +
        `float PLUS reserve rather than from reserve alone (${input.ratioBp} bp): ` +
        `"${offendingRatio}". The RCR is computed from RESERVE ALONE (P-M6-07, INV-M20-08, ` +
        'GS-229). A ratio that flatters itself with the same money on both sides is the ' +
        'breaker at 1.0 becoming fictional, on the one screen an operator opens during an ' +
        'incident',
    );
}

function requireUtc(instant: string, field: string): Date {
  const parsed = new Date(instant);
  if (!instant.endsWith('Z') || Number.isNaN(parsed.getTime()))
    throw new PageError(`${field} is not a UTC ISO-8601 instant`);
  return parsed;
}

/**
 * The elapsed time between a figure's as-of and the render, in words.
 *
 * NO THRESHOLD AND NO VERDICT. It states the gap; the reader judges it. A
 * negative gap is reported as such rather than clamped, because a figure whose
 * as-of is in the future is a clock problem the page should surface rather than
 * hide behind a zero.
 */
export function ageAtRender(asOf: AsOf, renderedAt: string): string {
  const from = requireUtc(asOf.instant, 'as-of').getTime();
  const to = requireUtc(renderedAt, 'renderedAt').getTime();
  const totalMinutes = Math.trunc((to - from) / 60_000);
  if (totalMinutes < 0) return `as-of is ${-totalMinutes}m AHEAD of the render clock`;
  const hours = Math.trunc(totalMinutes / 60);
  return `age ${hours}h ${totalMinutes % 60}m at render`;
}

function lineFor(reading: Reading, renderedAt: string, suspect: boolean): string {
  const prefix = suspect ? 'SUSPECT, data trust is red: ' : '';
  if (!readingIsPresent(reading)) return `${prefix}${render(reading)}`;
  return `${prefix}${render(reading)} (${ageAtRender(reading.figure.asOf, renderedAt)})`;
}

/**
 * @param notes Lines that are not `Reading`s and cannot become ones.
 *
 * THE RCR IS THE REASON THIS PARAMETER EXISTS. A `Figure` carries `cents` and
 * renders through `formatCents`, and the reserve coverage ratio is INTEGER
 * BASIS POINTS: pushing it through the money renderer would print 12,500 basis
 * points as `125.00`, which reads as an amount of money on the one panel whose
 * whole subject is a ratio. So the ratio arrives already rendered, with its
 * unit in the text, and `formatRatioBp` divides by `bigint` for the same reason
 * `formatCents` does.
 */
function panel(
  origin: string,
  title: string,
  readings: readonly Reading[],
  renderedAt: string,
  suspect: boolean,
  notes: readonly string[] = [],
): PanelRendering {
  const prefix = suspect ? 'SUSPECT, data trust is red: ' : '';
  return {
    origin,
    title,
    readings,
    suspect,
    lines: [
      ...readings.map((reading) => lineFor(reading, renderedAt, suspect)),
      ...notes.map((note) => `${prefix}${note}`),
    ],
  };
}

/**
 * Assemble the liability home page.
 *
 * Every input is passed: the environment, the role, the render instant, the
 * snapshot row, the trust signals. Nothing is read from the ambient process and
 * nothing is defaulted, so a caller that has not wired a supplier gets an
 * absent panel with a reason rather than a zero.
 */
export function buildLiabilityHome(input: LiabilityHomeInput): LiabilityHomePage {
  const origin = resolveAdminOrigin(input.env);
  const role = requireAdminRole(input.role);
  if (!mayReadLiabilityHome(role))
    throw new PageError(`${role} may not read the liability home page`);
  requireUtc(input.renderedAt, 'renderedAt');

  const dataTrust = assessDataTrust(input.trustSignals);
  const suspect = dataTrust.verdict === 'red';
  const three = theThreeNumbers(input.snapshot);
  const snapshotAsOf: AsOf = { instant: input.snapshot.asOfInstant, source: 'liability_snapshots' };

  // P-M6-09 first. Its own signals are never marked suspect by themselves: the
  // trust panel reporting that it distrusts itself would say nothing.
  const trustPanel: PanelRendering = {
    origin: 'P-M6-09',
    title: 'Data trust',
    readings: [],
    suspect: false,
    lines: [
      dataTrust.statement,
      ...dataTrust.signals.map(
        (signal) =>
          `${signal.label}: ${signal.state.toUpperCase()} (${signal.detail}) ` +
          `(as of ${signal.asOf.instant}, source ${signal.asOf.source}, ` +
          `${ageAtRender(signal.asOf, input.renderedAt)})`,
      ),
      ...dataTrust.missing.map((gap) => `${gap.label}: RED, ${gap.reason}`),
    ],
  };

  const eligible = input.eligibleNextSevenDays;
  const eligibleReadings: Reading[] = [
    eligible === undefined
      ? absent({
          origin: 'P-M6-03',
          label: 'Eligible next 7 days, account total',
          definition:
            'account-level total of what becomes payout-eligible inside 7 trading days. It is ' +
            'the forecast ADR-011 same-day top-up task reads',
          reason: 'not supplied: DEP-M6-01, M1 owes the eligible-forecast projection',
        })
      : figure({
          origin: 'P-M6-03',
          label: 'Eligible next 7 days, account total',
          definition:
            'account-level total of what becomes payout-eligible inside 7 trading days. It is ' +
            'the forecast ADR-011 same-day top-up task reads',
          cents: eligible.totalCents,
          asOf: { instant: eligible.asOfInstant, source: 'M1 eligible-forecast projection' },
          authority: 'authoritative',
        }),
    eligible?.identityMaxCents === undefined
      ? absent({
          origin: 'P-M6-03',
          label: 'Eligible next 7 days, largest single identity share',
          definition:
            'the largest single identity share of the same window (SD-M6-01). It is the number ' +
            'M05 AS-M5-03 needs and an account-level total hides, and the one that triggers ' +
            'ADR-011 same-day top-up',
          reason:
            'NO COLUMN. SD-M6-01 asks liability_snapshots for ' +
            '`eligible_next_7d_identity_max_cents` and `eligible_next_7d_identity_max_id`; 0009 ' +
            'carries neither, and DELTA_MANIFEST records SD-M6-01 as landed. Rendered absent ' +
            'rather than zero, because a zero here reads as "no identity is concentrated"',
        })
      : figure({
          origin: 'P-M6-03',
          label: 'Eligible next 7 days, largest single identity share',
          definition:
            'the largest single identity share of the same window (SD-M6-01). The identity is ' +
            'named on the link and not in this figure (INV-M6-10)',
          cents: eligible.identityMaxCents,
          asOf: { instant: eligible.asOfInstant, source: 'M1 eligible-forecast projection' },
          authority: 'authoritative',
        }),
  ];

  // P-M6-07. TWO PANELS AND NOT ONE, WHICH IS THE RENDERING DECISION SECTION
  // 5.3 TURNS ON. DEP-M20-06 requires float and reserve rendered as "visibly
  // separate figures", and two panels under two titles is the strongest
  // available reading of visibly separate: a reader skimming headings sees two
  // things, and a reader who folds them has to fold two blocks rather than
  // misread one list. M20 section 8 calls the second one "the float panel" and
  // asks M6 to render it.
  //
  // BOTH CARRY ORIGIN `P-M6-07` because that is the panel M06 section 3.1
  // defines and `figure.ts` closes the roster at M06's own list. The float has
  // no `P-M6-nn` of its own: M20 supplies it TO this panel (DEP-M20-06), and
  // minting an origin for it here would widen a roster this file does not own.
  const coverage =
    input.reserveCoverage === undefined
      ? undefined
      : reserveCoverage({
          coverage: input.reserveCoverage,
          // The SAME column P-M6-01's wallet component reads. One quantity from
          // one column cannot drift between two panels on one screen.
          floatCents: input.snapshot.walletBalancesCents,
          floatAsOfInstant: input.snapshot.asOfInstant,
        });

  const coveragePanels: PanelRendering[] =
    coverage === undefined
      ? []
      : [
          panel(
            'P-M6-07',
            'Reserve coverage',
            [coverage.reserve, coverage.cvar99],
            input.renderedAt,
            suspect,
            [coverage.ratioLine, coverage.attestationLine],
          ),
          panel(
            'P-M6-07',
            'Wallet float, reported separately',
            [coverage.walletFloat, coverage.floatCoverage],
            input.renderedAt,
            suspect,
            [
              'The float is reported SEPARATELY and is never counted toward reserve ' +
                '(INV-M20-08, DEP-M20-06). The same money is a LIABILITY component in P-M6-01 ' +
                'and EXPOSURE inside the P-M6-07 denominator, and in neither is it the ' +
                'numerator. FM-M20-09 is the failure this separation exists to refuse: float ' +
                'treated as working capital, after which the firm spends money it owes and the ' +
                'RCR stops meaning anything',
            ],
          ),
        ];

  const panels: PanelRendering[] = [
    trustPanel,
    panel(
      'P-M6-01',
      'Open liability',
      [
        three.openLiability,
        three.openLiabilityComponents.withdrawable,
        three.openLiabilityComponents.wallet,
      ],
      input.renderedAt,
      suspect,
    ),
    panel(
      'P-M6-02',
      'Bounded near-term liability',
      [three.boundedNearTerm],
      input.renderedAt,
      suspect,
    ),
    panel(
      'AS-M6-04',
      'Remaining ladder exposure',
      [three.remainingLadderExposure],
      input.renderedAt,
      suspect,
    ),
    panel('P-M6-03', 'Eligible next 7 days', eligibleReadings, input.renderedAt, suspect),
    ...coveragePanels,
    panel(
      'P-M6-10',
      'Absorbed corrections',
      [
        figure({
          origin: 'P-M6-10',
          label: 'Absorbed corrections, cumulative',
          definition:
            'signed cumulative absorbed delta, per the OQ-10 ruling. Positive is a correction ' +
            'Merit absorbed in the trader favour. It is NOT a liability figure and is not part ' +
            'of any of the three',
          cents: input.absorbedCorrectionsCents,
          asOf: snapshotAsOf,
          authority: 'authoritative',
        }),
        absent({
          origin: 'P-M6-10',
          label: 'Absorbed corrections, per-identity outliers',
          definition:
            'the per-identity outliers behind the cumulative figure, which is what makes it ' +
            'actionable rather than a running total nobody can decompose',
          reason:
            'not supplied: no per-identity breakdown reaches this page, and 0009 carries the ' +
            'cumulative column only',
        }),
      ],
      input.renderedAt,
      suspect,
    ),
  ];

  const openLiabilityFigure = three.openLiability;
  if (!readingIsPresent(openLiabilityFigure))
    throw new PageError('unreachable: open liability is always a figure');

  const live: LiveOpenLiability =
    input.live === undefined
      ? {
          kind: 'suppressed',
          reason:
            'suppressed: no indicative feed reading was supplied, so there is no intraday ' +
            'movement to add. Section 3.5 figure is absent rather than equal to the last close, ' +
            'which would present an as-of-last-closed number as a live one (INV-M6-12)',
        }
      : liveOpenLiability({
          lastClosedOpenLiability: openLiabilityFigure.figure,
          movement: input.live.movement,
          sameDayAdjustments: input.live.sameDayAdjustments,
          dataTrust,
        });

  const page: LiabilityHomePage = {
    origin,
    role,
    renderedAt: input.renderedAt,
    dataTrust,
    banner: dataTrust.statement,
    panels,
    live,
    // The P-M6-07 row leaves `pending` when, and only when, the panel renders.
    // A page that listed a panel as NOT BUILT while printing it is worse than
    // either half alone.
    pending: PENDING.filter((entry) => !(entry.origin === 'P-M6-07' && coverage !== undefined)),
  };

  const allLines = panels.flatMap((rendered) => rendered.lines);
  assertNamesNoSubject(allLines);
  if (coverage !== undefined && input.reserveCoverage !== undefined)
    assertFloatIsNotReserve({
      allLines: renderLiabilityHome(page),
      coverageLines: coveragePanels.flatMap((rendered) => rendered.lines),
      reserveCents: input.reserveCoverage.reserveCents,
      floatCents: input.snapshot.walletBalancesCents,
      cvar99Cents: input.reserveCoverage.cvar99Cents,
      ratioBp: coverage.ratioBp,
    });
  return page;
}

/** Every line the page prints, in page order. The trust statement is first. */
export function renderLiabilityHome(page: LiabilityHomePage): readonly string[] {
  const liveLines =
    page.live.kind === 'suppressed'
      ? [`Open liability, live: ${page.live.reason}`]
      : page.live.reading.kind === 'figure'
        ? [lineFor(page.live.reading, page.renderedAt, false)]
        : [];

  return [
    ...page.panels.flatMap((rendered) => [
      `[${rendered.origin}] ${rendered.title}`,
      ...rendered.lines,
    ]),
    ...liveLines,
    ...page.pending.map(
      (pending) =>
        `[${pending.origin}] ${pending.title}: NOT BUILT, blocked by ${pending.blockedBy}`,
    ),
  ];
}
