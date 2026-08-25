import { describe, expect, test } from 'vitest';

import { FigureError } from '../src/figure.ts';
import {
  DataTrustError,
  TRUST_KEYS,
  type TrustSignal,
  assessDataTrust,
} from '../src/data-trust.ts';

// =============================================================================
// M6-A: P-M6-09, the panel that gates the other nine
// =============================================================================

const AS_OF = { instant: '2026-08-21T06:00:00.000Z', source: 'M2 recon status' };

const ok = (key: TrustSignal['key']): TrustSignal => ({
  key,
  state: 'ok',
  detail: '0',
  asOf: AS_OF,
});

const ALL_FIVE = TRUST_KEYS.map(ok);

describe('M6-A-09: green requires all five answered and none bad', () => {
  test('five ok inputs are green', () => {
    const trust = assessDataTrust(ALL_FIVE);
    expect(trust.verdict).toBe('ok');
    expect(trust.missing).toHaveLength(0);
    expect(trust.signals).toHaveLength(5);
  });

  test('the signals come back in the panel own order, not the caller order', () => {
    const shuffled = [...ALL_FIVE].reverse();
    expect(assessDataTrust(shuffled).signals.map((s) => s.key)).toEqual([...TRUST_KEYS]);
  });

  test('one red input turns the verdict red', () => {
    const trust = assessDataTrust([
      ...ALL_FIVE.slice(0, 4),
      {
        key: 'batch_last_success',
        state: 'red',
        detail: 'no success since 2026-08-19',
        asOf: AS_OF,
      },
    ]);
    expect(trust.verdict).toBe('red');
  });

  test('a red page says so in words a screenshot preserves', () => {
    const trust = assessDataTrust([{ ...ok('replay_divergences'), state: 'red', detail: '2' }]);
    expect(trust.statement).toContain('DATA TRUST IS RED');
    expect(trust.statement).toContain('suspect');
  });
});

describe('M6-A-10: DEP-M6-04, a signal nobody supplied is red and never green', () => {
  test('an empty input is red, not a clean board', () => {
    const trust = assessDataTrust([]);
    expect(trust.verdict).toBe('red');
    expect(trust.missing).toHaveLength(5);
  });

  test('four ok inputs and one absent is still red', () => {
    const trust = assessDataTrust(ALL_FIVE.slice(0, 4));
    expect(trust.verdict).toBe('red');
    expect(trust.missing.map((m) => m.key)).toEqual(['batch_last_success']);
  });

  test('every missing row names who owes it', () => {
    for (const gap of assessDataTrust([]).missing) {
      expect(gap.reason).toContain('not supplied by');
      expect(gap.reason).toContain('a check that cannot run is not a check that passed');
    }
  });
});

describe('M6-A-11: the panel refuses inputs it cannot defend', () => {
  test('an unknown key is refused rather than ignored', () => {
    const rogue = {
      ...ok('replay_divergences'),
      key: 'vendor_feed_healthy',
    } as unknown as TrustSignal;
    expect(() => assessDataTrust([rogue])).toThrow(DataTrustError);
  });

  test('two answers for one input are refused', () => {
    expect(() => assessDataTrust([ok('replay_divergences'), ok('replay_divergences')])).toThrow(
      DataTrustError,
    );
  });

  test('a state with no detail is refused: a verdict a reader cannot check gets muted', () => {
    expect(() => assessDataTrust([{ ...ok('replay_divergences'), detail: '  ' }])).toThrow(
      DataTrustError,
    );
  });

  test('INV-M6-04 binds a trust signal exactly as it binds a liability figure', () => {
    expect(() =>
      assessDataTrust([{ ...ok('replay_divergences'), asOf: { ...AS_OF, source: '' } }]),
    ).toThrow(FigureError);
    expect(() =>
      assessDataTrust([{ ...ok('replay_divergences'), asOf: { ...AS_OF, instant: '2026-08-21' } }]),
    ).toThrow(FigureError);
  });
});
