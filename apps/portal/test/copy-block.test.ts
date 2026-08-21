import { expect, test } from 'vitest';

import { COPY_KEYS, MissingCopyBlockError, copyBlock } from '../src/copy/copy-block.js';
import type { PinnedPlanCopy } from '../src/copy/copy-block.js';

// =============================================================================
// INV-M4-08: no rule text is authored in the portal
// =============================================================================

const PINNED: PinnedPlanCopy = {
  plan_id: 'plan_core_eod',
  version: 7,
  blocks: {
    'eval.funded_reset':
      'Your funded account starts at the account size. Profit from the evaluation is not carried over.',
    'eval.blank': '   ',
  },
};

test('a published sentence is returned exactly, with nothing added', () => {
  const sentence = copyBlock(PINNED, COPY_KEYS.funded_reset);
  expect(sentence).toBe(PINNED.blocks['eval.funded_reset']);
});

test('a missing key throws, and the error names the version it was missing from', () => {
  // DEP-M4-02 puts the obligation on M3's publish gate. The portal's job is to
  // make the gap visible rather than to fill it, so this failure has to carry
  // enough to act on: which plan, which version, which key.
  expect(() => copyBlock(PINNED, 'funded.buffer_is_loss_room')).toThrow(MissingCopyBlockError);
  try {
    copyBlock(PINNED, 'funded.buffer_is_loss_room');
    expect.unreachable('copyBlock returned for a key the pinned version does not carry');
  } catch (error) {
    const message = String(error);
    expect(message).toContain('plan_core_eod');
    expect(message).toContain('version 7');
    expect(message).toContain('funded.buffer_is_loss_room');
    expect(message).toContain('INV-M4-08');
  }
});

test('a blank entry is missing, not published', () => {
  // 0042's `reason_detail` precedent: NOT NULL plus a non-blank check, because
  // a column that accepts a space is a column that will hold one. A rule
  // sentence that renders as whitespace is INV-M4-08 failing by omission.
  expect(() => copyBlock(PINNED, 'eval.blank')).toThrow(MissingCopyBlockError);
});

test('an inherited property is not a published sentence', () => {
  // `blocks` is a plain object parsed from jsonb. Without the own-property
  // check, `copyBlock(pinned, 'constructor')` returns a function's source text
  // and the portal renders it as a rule.
  expect(() => copyBlock(PINNED, 'constructor')).toThrow(MissingCopyBlockError);
  expect(() => copyBlock(PINNED, 'toString')).toThrow(MissingCopyBlockError);
  expect(() => copyBlock(PINNED, '__proto__')).toThrow(MissingCopyBlockError);
});

test('the brand cannot be produced from a literal', () => {
  // THE COMPILE-TIME HALF, ASSERTED AT RUNTIME BECAUSE THAT IS WHERE A SUITE
  // CAN STAND. The following two lines are the mistake INV-M4-08 forbids, and
  // `tsc` rejects both: a `string` is not assignable to `CopyBlock`.
  //
  //   const invented: CopyBlock = 'Your daily loss limit is 3% of the account.';
  //   const cast: CopyBlock = someApiString;
  //
  // What this test can check is that the brand is erased at runtime, so the
  // enforcement costs nothing at the point of display and no caller is tempted
  // to unwrap it.
  const sentence = copyBlock(PINNED, COPY_KEYS.funded_reset);
  expect(typeof sentence).toBe('string');
  expect(JSON.stringify({ sentence })).toBe(
    JSON.stringify({ sentence: PINNED.blocks['eval.funded_reset'] }),
  );
});
