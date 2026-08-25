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
import { type AsOf, type Reading, absent, figure, readingIsPresent, render } from './figure.ts';
import { type LiabilitySnapshot, theThreeNumbers } from './liability.ts';
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
    blockedBy:
      'OI-01 in DELTA_MANIFEST: `liability_snapshots` exists in two shapes and the reserve, ' +
      'CVaR and RCR fields of the earlier one "have no home in the folded shape and need one ' +
      'before M06 is built". DEP-M6-02 and DEP-M6-05 name the inputs; the columns do not exist',
  },
  {
    origin: 'P-M6-08',
    title: 'MID health',
    blockedBy: 'M03 SD-M3-03 routing state, and no provider metrics reach this page yet',
  },
];

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

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

function panel(
  origin: string,
  title: string,
  readings: readonly Reading[],
  renderedAt: string,
  suspect: boolean,
): PanelRendering {
  return {
    origin,
    title,
    readings,
    suspect,
    lines: readings.map((reading) => lineFor(reading, renderedAt, suspect)),
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
    pending: PENDING,
  };

  assertNamesNoSubject(panels.flatMap((rendered) => rendered.lines));
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
