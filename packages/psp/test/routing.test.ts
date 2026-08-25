// =============================================================================
// packages/psp/test/routing.test.ts
// =============================================================================
// INV-M3-11 AND AS-M3-02. The states are `mid_health.state`'s three, read off
// `0006_commerce.sql`'s CHECK constraint rather than off `routing.ts`.
// =============================================================================

import { describe, expect, test } from 'vitest';

import {
  BothMidsUnhealthyError,
  chooseMidForNewAttempt,
  type MidCandidate,
  type MidState,
} from '../src/routing.ts';

/** The three members of the CHECK, so an added state fails this file loudly. */
const STATES: readonly MidState[] = ['healthy', 'degraded', 'unhealthy'];

describe('chooseMidForNewAttempt', () => {
  test('routes to the healthy MID when one is degraded', () => {
    expect(
      chooseMidForNewAttempt([
        { psp: 'psp_a', state: 'degraded' },
        { psp: 'psp_b', state: 'healthy' },
      ]),
    ).toBe('psp_b');
  });

  test('routes to the surviving MID when one is unhealthy, in either order', () => {
    expect(
      chooseMidForNewAttempt([
        { psp: 'psp_a', state: 'unhealthy' },
        { psp: 'psp_b', state: 'healthy' },
      ]),
    ).toBe('psp_b');
    expect(
      chooseMidForNewAttempt([
        { psp: 'psp_b', state: 'unhealthy' },
        { psp: 'psp_a', state: 'degraded' },
      ]),
    ).toBe('psp_a');
  });

  test('INV-M3-11: neither MID is ever REQUIRED to be up', () => {
    // Stated as a loop rather than as two cases, because the invariant is about
    // every single-survivor configuration and not about two chosen ones.
    for (const survivor of ['psp_a', 'psp_b'] as const) {
      for (const state of ['healthy', 'degraded'] as const) {
        const other = survivor === 'psp_a' ? 'psp_b' : 'psp_a';
        expect(
          chooseMidForNewAttempt([
            { psp: other, state: 'unhealthy' },
            { psp: survivor, state },
          ]),
        ).toBe(survivor);
      }
    }
  });

  test('BOTH unhealthy is the ONLY case that refuses, and it carries the contract code', () => {
    const candidates: readonly MidCandidate[] = [
      { psp: 'psp_a', state: 'unhealthy' },
      { psp: 'psp_b', state: 'unhealthy' },
    ];
    try {
      chooseMidForNewAttempt(candidates);
      expect.unreachable('both MIDs unhealthy must refuse');
    } catch (error) {
      expect(error).toBeInstanceOf(BothMidsUnhealthyError);
      const e = error as BothMidsUnhealthyError;
      // API_CONTRACT section 5: `service_unavailable` is "both MIDs unhealthy".
      expect(e.code).toBe('service_unavailable');
      expect(e.candidates).toEqual(candidates);
      expect(e.message).toContain('psp_a=unhealthy');
      expect(e.message).toContain('psp_b=unhealthy');
    }
  });

  test('an EMPTY candidate list refuses rather than returning a default', () => {
    expect(() => chooseMidForNewAttempt([])).toThrow(BothMidsUnhealthyError);
  });

  test('at equal state the earlier candidate wins, and the choice is explainable', () => {
    // Deterministic on purpose: SD-M3-03 exists so "why did this purchase go to
    // PSP-B" has an answer. A shuffle inside the router would remove one.
    for (const state of ['healthy', 'degraded'] as const) {
      expect(
        chooseMidForNewAttempt([
          { psp: 'psp_b', state },
          { psp: 'psp_a', state },
        ]),
      ).toBe('psp_b');
    }
  });

  test('every state in the CHECK constraint is decided, none falls through', () => {
    for (const state of STATES) {
      const candidates: readonly MidCandidate[] = [{ psp: 'psp_a', state }];
      if (state === 'unhealthy') {
        expect(() => chooseMidForNewAttempt(candidates)).toThrow(BothMidsUnhealthyError);
      } else {
        expect(chooseMidForNewAttempt(candidates)).toBe('psp_a');
      }
    }
  });
});
