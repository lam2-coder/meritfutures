import { describe, expect, test } from 'vitest';

import { TRUST_KEYS, type TrustSignal } from '../src/data-trust.ts';
import { OriginError } from '../src/origin.ts';
import { RoleError } from '../src/roles.ts';
import {
  PageError,
  ageAtRender,
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
