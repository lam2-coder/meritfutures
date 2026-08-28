import { describe, expect, test } from 'vitest';

import { TRUST_KEYS, type TrustSignal } from '../src/data-trust.ts';
import { OriginError } from '../src/origin.ts';
import { RoleError } from '../src/roles.ts';
import {
  PageError,
  ageAtRender,
  assertFloatIsNotReserve,
  assertNamesNoSubject,
  buildLiabilityHome,
  type LiabilityHomeInput,
  renderLiabilityHome,
} from '../src/page.ts';

// =============================================================================
// M6-A: the liability home page, assembled
// =============================================================================

const RENDERED_AT = '2026-08-21T13:00:00.000Z';
const TRUST_AS_OF = { instant: '2026-08-21T12:30:00.000Z', source: 'M2 recon status' };

const green = (): TrustSignal[] =>
  TRUST_KEYS.map((key) => ({ key, state: 'ok', detail: '0', asOf: TRUST_AS_OF }));

const INPUT: LiabilityHomeInput = {
  env: {
    ADMIN_ORIGIN: 'https://ops.example.invalid',
    SITE_ORIGIN: 'https://example.test',
    PORTAL_ORIGIN: 'https://app.example.test',
  },
  role: 'readonly',
  renderedAt: RENDERED_AT,
  snapshot: {
    asOfInstant: '2026-08-20T21:00:00.000Z',
    withdrawableAcrossFundedCents: 500_000n,
    walletBalancesCents: 250_000n,
    boundedNearTermCents: 150_000n,
    remainingLadderExposureCents: 900_000n,
  },
  absorbedCorrectionsCents: -1_250n,
  trustSignals: green(),
};

describe('M6-A-19: P-M6-09 is last in the list and first on the page', () => {
  const page = buildLiabilityHome(INPUT);

  test('the trust panel is the first panel', () => {
    expect(page.panels[0]?.origin).toBe('P-M6-09');
  });

  test('the banner is the trust statement, above every number', () => {
    expect(renderLiabilityHome(page)[0]).toBe('[P-M6-09] Data trust');
    expect(renderLiabilityHome(page)[1]).toBe(page.banner);
  });

  test('the three numbers follow it, each in its own panel', () => {
    expect(page.panels.map((panel) => panel.origin)).toEqual([
      'P-M6-09',
      'P-M6-01',
      'P-M6-02',
      'AS-M6-04',
      'P-M6-03',
      'P-M6-10',
    ]);
  });

  test('every trust signal renders its own as-of, as INV-M6-04 requires of any number', () => {
    for (const line of page.panels[0]?.lines.slice(1) ?? []) {
      expect(line).toContain('as of 2026-08-21T12:30:00.000Z');
    }
  });
});

describe('M6-A-20: a red board marks every number below it, in the text', () => {
  const red = buildLiabilityHome({
    ...INPUT,
    trustSignals: green().map((signal) =>
      signal.key === 'recon_mismatches_open'
        ? { ...signal, state: 'red' as const, detail: '3 mismatches open' }
        : signal,
    ),
  });

  test('the banner refuses to look healthy', () => {
    expect(red.banner).toContain('DATA TRUST IS RED');
  });

  test('every liability line carries the word, so a screenshot keeps it', () => {
    for (const panel of red.panels.slice(1)) {
      expect(panel.suspect).toBe(true);
      for (const line of panel.lines) expect(line).toContain('SUSPECT');
    }
  });

  test('the trust panel does not mark itself suspect', () => {
    expect(red.panels[0]?.suspect).toBe(false);
  });

  test('the live figure is suppressed rather than shown', () => {
    expect(red.live.kind).toBe('suppressed');
  });

  test('a green board marks nothing', () => {
    const page = buildLiabilityHome(INPUT);
    for (const panel of page.panels) expect(panel.suspect).toBe(false);
    for (const line of renderLiabilityHome(page)) expect(line).not.toContain('SUSPECT');
  });
});

describe('M6-A-21: the age is rendered and never judged', () => {
  test('each figure line states the elapsed time at render', () => {
    const page = buildLiabilityHome(INPUT);
    expect(page.panels[1]?.lines[0]).toContain('age 16h 0m at render');
  });

  test('no line calls a figure stale, because no setpoint is ruled', () => {
    const page = buildLiabilityHome(INPUT);
    for (const line of renderLiabilityHome(page)) expect(line.toLowerCase()).not.toContain('stale');
  });

  test('an as-of ahead of the render clock is surfaced, not clamped to zero', () => {
    expect(
      ageAtRender({ instant: '2026-08-21T14:00:00.000Z', source: 'x' }, RENDERED_AT),
    ).toContain('AHEAD of the render clock');
  });

  test('a render instant that is not UTC is refused', () => {
    expect(() => buildLiabilityHome({ ...INPUT, renderedAt: '2026-08-21' })).toThrow(PageError);
  });
});

describe('M6-A-22: SD-M6-01 identity max is absent, because the column is', () => {
  const page = buildLiabilityHome(INPUT);
  const eligible = page.panels.find((panel) => panel.origin === 'P-M6-03');

  test('both P-M6-03 numbers render absent when nobody supplies the forecast', () => {
    expect(eligible?.lines.every((line) => line.includes('not available'))).toBe(true);
  });

  test('the identity-max absence names the missing columns rather than showing zero', () => {
    const line = eligible?.lines.find((text) => text.includes('largest single identity'));
    expect(line).toContain('NO COLUMN');
    expect(line).toContain('eligible_next_7d_identity_max_cents');
    expect(line).not.toContain('0.00');
  });

  test('a supplied forecast renders both numbers', () => {
    const supplied = buildLiabilityHome({
      ...INPUT,
      eligibleNextSevenDays: {
        totalCents: 320_000n,
        asOfInstant: '2026-08-20T21:00:00.000Z',
        identityMaxCents: 150_000n,
      },
    });
    const panel = supplied.panels.find((p) => p.origin === 'P-M6-03');
    expect(panel?.lines[0]).toContain('3200.00');
    expect(panel?.lines[1]).toContain('1500.00');
  });
});

describe('M6-A-23: INV-M6-10, the home page names no subject', () => {
  test('the assertion catches a UUID in any rendered line', () => {
    expect(() =>
      assertNamesNoSubject(['Largest identity: 0e9c0b3a-1f2d-4c5e-8a7b-9d0e1f2a3b4c']),
    ).toThrow(PageError);
  });

  test('the assembled page passes it', () => {
    expect(() =>
      assertNamesNoSubject(renderLiabilityHome(buildLiabilityHome(INPUT))),
    ).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // WHERE THIS ASSERTION NOW RUNS, AND WHAT IT COVERED BEFORE THE PAGE EXISTED
  // ---------------------------------------------------------------------------
  // WAVE-06 section 5.2: "A React page renders a DOM, not a line array", so an
  // `assertNamesNoSubject` reading only the array after `apps/admin/src/app/`
  // exists is an assertion about something nobody serves. `W6-d` re-pointed it
  // at the served bytes and `test/render.test.ts` is where that half lives.
  //
  // THE LINES ARE NOT DELETED AND THE TWO CASES ABOVE STAY, which is the other
  // half of the same section. What is added here is the MEASUREMENT that made
  // the re-point load bearing rather than tidy.

  test('the call INSIDE `buildLiabilityHome` covers the panels and not the live line', () => {
    // `buildLiabilityHome` applies the assertion to `panels.flatMap(lines)`.
    // The live figure is not a panel, and its `source` is a string a FEED
    // supplies: `liveOpenLiability` puts `movement.feed` into the live figure's
    // `asOf.source`. So a subject name arriving that way is assembled without
    // complaint here, is printed by `renderLiabilityHome`, and is refused by
    // the served-bytes assertion in `test/render.test.ts`.
    //
    // THIS IS A MEASUREMENT OF SCOPE AND NOT A DEFECT REPORT AGAINST THIS FILE.
    // `src/page.ts` is `P5-l`'s this wave and `W6-d` may not widen the call it
    // makes; what `W6-d` can do, and did, is put the wider control on the bytes
    // an operator receives.
    const subject = '0e9c0b3a-1f2d-4c5e-8a7b-9d0e1f2a3b4c';
    const page = buildLiabilityHome({
      ...INPUT,
      live: {
        movement: {
          cents: 12_500n,
          asOfInstant: '2026-08-21T12:59:00.000Z',
          feed: `indicative feed for identity ${subject}`,
        },
        sameDayAdjustments: { cents: 0n, asOfInstant: '2026-08-21T12:00:00.000Z' },
      },
    });

    expect(page.live.kind).toBe('indicative');
    expect(page.panels.flatMap((panel) => panel.lines).join('\n')).not.toContain(subject);
    expect(renderLiabilityHome(page).join('\n')).toContain(subject);
    expect(() => assertNamesNoSubject(renderLiabilityHome(page))).toThrow(PageError);
  });
});

describe('M6-A-24: the five panels nobody fills are listed, not omitted', () => {
  const page = buildLiabilityHome(INPUT);

  test('all five are named with what blocks them', () => {
    expect(page.pending.map((pending) => pending.origin)).toEqual([
      'P-M6-04',
      'P-M6-05',
      'P-M6-06',
      'P-M6-07',
      'P-M6-08',
    ]);
    for (const pending of page.pending) expect(pending.blockedBy.length).toBeGreaterThan(20);
  });

  test('P-M6-07 names OI-01, which says the columns do not exist', () => {
    const reserve = page.pending.find((pending) => pending.origin === 'P-M6-07');
    expect(reserve?.blockedBy).toContain('OI-01');
  });

  test('they render as NOT BUILT rather than being left off the page', () => {
    const lines = renderLiabilityHome(page);
    expect(lines.filter((line) => line.includes('NOT BUILT'))).toHaveLength(5);
  });
});

describe('M6-A-25: the page refuses to assemble on a bad origin or a bad role', () => {
  test('an unset ADMIN_ORIGIN is refused', () => {
    expect(() => buildLiabilityHome({ ...INPUT, env: {} })).toThrow(OriginError);
  });

  test('an admin origin under a public host is refused', () => {
    expect(() =>
      buildLiabilityHome({
        ...INPUT,
        env: { ADMIN_ORIGIN: 'https://admin.example.test', SITE_ORIGIN: 'https://example.test' },
      }),
    ).toThrow(OriginError);
  });

  test('an unknown role is refused', () => {
    expect(() => buildLiabilityHome({ ...INPUT, role: 'support' })).toThrow(RoleError);
  });

  test.each(['owner', 'ops', 'readonly'])('%s assembles the page', (role) => {
    expect(buildLiabilityHome({ ...INPUT, role }).role).toBe(role);
  });
});

describe('M6-A-26: no live feed means no live figure, never the last close relabelled', () => {
  test('the live slot is suppressed with a reason naming INV-M6-12', () => {
    const page = buildLiabilityHome(INPUT);
    if (page.live.kind !== 'suppressed') throw new Error('expected suppression');
    expect(page.live.reason).toContain('INV-M6-12');
  });

  test('a supplied feed produces the indicative figure beside the authoritative one', () => {
    const page = buildLiabilityHome({
      ...INPUT,
      live: {
        movement: { cents: 12_500n, asOfInstant: RENDERED_AT, feed: 'indicative marks feed' },
        sameDayAdjustments: { cents: 0n, asOfInstant: RENDERED_AT },
      },
    });
    if (page.live.kind !== 'indicative') throw new Error('expected a live figure');
    expect(page.live.terms.lastClosed.cents).toBe(750_000n);
    const lines = renderLiabilityHome(page);
    expect(lines.some((line) => line.includes('INDICATIVE'))).toBe(true);
    expect(lines.some((line) => line.includes('Open liability: 7500.00'))).toBe(true);
  });
});

// =============================================================================
// M6-A: P-M6-07 on the page, and section 5.3 asserted OVER THE RENDERED BYTES
// =============================================================================
// SESSION 261'S LESSON, WHICH P6 SECTION 8 RESTATES: a value reaches a page
// through a label, a definition, a provenance clause or an error string without
// ever appearing in a visible field. So these assertions read
// `renderLiabilityHome`'s output, which is every byte the page prints, rather
// than the structured figures the panels were built from.
//
// THE BOOK IS GS-229's, "reserve coverage computed while the wallet float is
// LARGE", and the figures are the ones that flip the breaker:
//
//   reserve alone      2,000,000c / 2,500,000c =  8,000bp  ARMED
//   float folded in    3,500,000c / 2,500,000c = 14,000bp  not armed
//
// `35000.00` and `14000 bp` are therefore the two tokens that must appear
// nowhere, and `20000.00`, `15000.00` and `8000 bp` are the three that must.
// =============================================================================

const COVERAGE = {
  asOfInstant: '2026-08-20T22:00:00.000Z',
  reserveCents: 2_000_000n,
  cvar99Cents: 2_500_000n,
  rcrBp: 8_000n,
  anchor: {
    accountCode: 'payout_wallet',
    asOfInstant: '2026-08-20T21:45:00.000Z',
    source: 'provider_api',
  },
} as const;

/** The same input as above, with a large float and P-M6-07's row supplied. */
const WITH_COVERAGE: LiabilityHomeInput = {
  ...INPUT,
  snapshot: { ...INPUT.snapshot, walletBalancesCents: 1_500_000n },
  reserveCoverage: COVERAGE,
};

describe('M6-A-35: P-M6-07 renders as two panels, and leaves the pending list', () => {
  const page = buildLiabilityHome(WITH_COVERAGE);

  test('the roster gains reserve coverage and the float, in M06 own panel order', () => {
    expect(page.panels.map((panel) => panel.origin)).toEqual([
      'P-M6-09',
      'P-M6-01',
      'P-M6-02',
      'AS-M6-04',
      'P-M6-03',
      'P-M6-07',
      'P-M6-07',
      'P-M6-10',
    ]);
  });

  test('two titles, which is what DEP-M20-06 visibly separate means here', () => {
    const titles = page.panels.filter((panel) => panel.origin === 'P-M6-07').map((p) => p.title);
    expect(titles).toEqual(['Reserve coverage', 'Wallet float, reported separately']);
  });

  test('the panel is no longer listed as NOT BUILT', () => {
    expect(page.pending.map((entry) => entry.origin)).toEqual([
      'P-M6-04',
      'P-M6-05',
      'P-M6-06',
      'P-M6-08',
    ]);
  });

  test('without the row it stays pending, and the reason is a producer and not a column', () => {
    const bare = buildLiabilityHome(INPUT);
    const pending = bare.pending.find((entry) => entry.origin === 'P-M6-07');
    expect(pending?.blockedBy).toContain('no producer, and not a missing column');
    expect(pending?.blockedBy).toContain('0049_reserve_coverage_snapshots.sql');
    expect(pending?.blockedBy).not.toContain('the columns do not exist');
  });
});

describe('M6-A-36: section 5.3 in the negative, over every byte the page prints', () => {
  const lines = renderLiabilityHome(buildLiabilityHome(WITH_COVERAGE));
  const bytes = lines.join('\n');

  test('the reserve and the float are two separately labelled, separately valued lines', () => {
    // The colon, because the panel HEADING carries the title too and a page
    // that printed only headings would satisfy a bare-label search.
    const reserveLine = lines.find((line) => line.includes('Reserve, the RCR numerator: '));
    const floatLine = lines.find((line) => line.includes('Wallet float, reported separately: '));
    expect(reserveLine).toContain('20000.00');
    expect(floatLine).toContain('15000.00');
    expect(reserveLine).not.toBe(floatLine);
  });

  test('the ratio the page prints is the one computed from reserve alone', () => {
    expect(bytes).toContain('Reserve coverage ratio: 8000 bp (0.8000x)');
    expect(bytes).toContain('breaker: ARMED');
  });

  test('reserve PLUS float appears nowhere, in any field, label or clause', () => {
    expect(bytes).not.toMatch(/(?<![\d.])35000\.00(?![\d])/);
  });

  test('the ratio from float plus reserve appears nowhere', () => {
    expect(bytes).not.toMatch(/(?<!\d)14000 bp(?!\d)/);
    expect(bytes).not.toContain('1.4000x');
  });

  test('the page says in words which side of the ratio the float is on', () => {
    expect(bytes).toContain('computed from RESERVE ALONE');
    expect(bytes).toContain('exposure inside the denominator');
    expect(bytes).toContain('never counted toward reserve');
  });

  test('the float still renders as a P-M6-01 liability component, which is INV-M6-11', () => {
    // The same money, twice, deliberately: a liability component in one panel
    // and exposure in the other. It is never reserve in either.
    const walletComponent = lines.find((line) => line.includes('Open liability: wallet component'));
    expect(walletComponent).toContain('15000.00');
  });
});

describe('M6-A-37: the page refuses a rendering that folds the float into reserve', () => {
  test('a page whose reserve line carried the sum would not be built', () => {
    expect(() =>
      assertFloatIsNotReserve({
        allLines: ['Reserve coverage ratio: 8000 bp'],
        coverageLines: [
          'Reserve, the RCR numerator: 35000.00 [...] (as of ..., source ...)',
          'Wallet float, reported separately: 15000.00 [...]',
        ],
        reserveCents: 2_000_000n,
        floatCents: 1_500_000n,
        cvar99Cents: 2_500_000n,
        ratioBp: 8_000n,
      }),
    ).toThrow(/folded into it/);
  });

  test('a ratio from float plus reserve is caught anywhere on the page, not only here', () => {
    expect(() =>
      assertFloatIsNotReserve({
        // The leak surfaces on a line that is not a coverage line at all,
        // which is the case a panel-scoped scan would miss.
        allLines: ['Open liability, live: coverage stands at 14000 bp'],
        coverageLines: [
          'Reserve, the RCR numerator: 20000.00',
          'Wallet float, reported separately: 15000.00',
        ],
        reserveCents: 2_000_000n,
        floatCents: 1_500_000n,
        cvar99Cents: 2_500_000n,
        ratioBp: 8_000n,
      }),
    ).toThrow(/flatters itself|float PLUS reserve/);
  });

  test('a page that printed only one of the two figures is refused', () => {
    expect(() =>
      assertFloatIsNotReserve({
        allLines: [],
        coverageLines: ['Reserve, the RCR numerator: 20000.00'],
        reserveCents: 2_000_000n,
        floatCents: 1_500_000n,
        cvar99Cents: 2_500_000n,
        ratioBp: 8_000n,
      }),
    ).toThrow(/VISIBLY SEPARATE/);
  });

  test('at zero float the scan has nothing to tell apart, and it says so by passing', () => {
    // Stated rather than silently handled: reserve + 0 IS reserve, so a suite
    // that proved this control on an empty wallet would have proved nothing.
    expect(() =>
      assertFloatIsNotReserve({
        allLines: ['Reserve, the RCR numerator: 20000.00'],
        coverageLines: [
          'Reserve, the RCR numerator: 20000.00',
          'Wallet float, reported separately: 0.00',
        ],
        reserveCents: 2_000_000n,
        floatCents: 0n,
        cvar99Cents: 2_500_000n,
        ratioBp: 8_000n,
      }),
    ).not.toThrow();
  });

  test('a red board marks the ratio line too, so a screenshot keeps the warning', () => {
    const red = buildLiabilityHome({
      ...WITH_COVERAGE,
      trustSignals: green().map((signal) =>
        signal.key === 'recon_mismatches_open'
          ? { ...signal, state: 'red' as const, detail: '3 mismatches open' }
          : signal,
      ),
    });
    const ratioLine = renderLiabilityHome(red).find((line) =>
      line.includes('Reserve coverage ratio'),
    );
    expect(ratioLine).toContain('SUSPECT, data trust is red');
  });
});
