// =============================================================================
// packages/rail/test/settlement-bind.test.ts
// =============================================================================
// `SETTLEMENT_STEPS` IS A TRANSCRIPTION, AND A TRANSCRIPTION NOBODY CHECKS IS A
// SECOND COPY OF A SPECIFICATION.
//
// This file reads `docs/plans/M05-payout-system.md` AS TEXT, parses section
// 3.1's table, and compares it row by row against the tuple in
// `src/settlement.ts`. It cannot import the document, so it reads it, which is
// `packages/ledger`'s remedy for the same hazard and is `expiry.ts`'s idiom for
// binding a constant it cannot import.
//
// IT ASSERTS THE ROWS AND NOT THE PROSE. The paragraphs around the table are
// what section 4 of `settlement.ts` reports on; what is bound here is the seven
// ordered pairs, because those are what a receiver executes.
// =============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { PORT_PERFORMED_STEPS, SETTLEMENT_STEPS } from '../src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const M05 = readFileSync(join(ROOT, 'docs', 'plans', 'M05-payout-system.md'), 'utf8');

/**
 * Every `| S-n | action | anchor |` row in the document, in document order.
 *
 * THE PATTERN IS ANCHORED ON `S-` AT A CELL BOUNDARY rather than searching for a
 * heading, because a heading-relative parse silently returns nothing when a
 * section is renumbered and a test that found no rows would pass every
 * comparison it then did not make. `the document still has seven rows` below is
 * the guard against exactly that.
 */
const documentRows = [...M05.matchAll(/^\| (S-\d) \| (.+?) \| (.+?) \|$/gm)].map((m) => ({
  id: m[1],
  action: m[2],
  anchor: m[3],
}));

describe('the seven steps are M05 section 3.1s seven steps', () => {
  test('the document still has seven rows, so nothing below is vacuous', () => {
    expect(documentRows).toHaveLength(7);
  });

  test('the ids are S-1 through S-7, in order', () => {
    expect(documentRows.map((row) => row.id)).toStrictEqual([
      'S-1',
      'S-2',
      'S-3',
      'S-4',
      'S-5',
      'S-6',
      'S-7',
    ]);
    expect(SETTLEMENT_STEPS.map((step) => step.id)).toStrictEqual(documentRows.map((r) => r.id));
  });

  test('every action cell is transcribed verbatim', () => {
    expect(SETTLEMENT_STEPS.map((step) => step.action)).toStrictEqual(
      documentRows.map((row) => row.action),
    );
  });

  test('every idempotency anchor is transcribed verbatim', () => {
    expect(SETTLEMENT_STEPS.map((step) => step.anchor)).toStrictEqual(
      documentRows.map((row) => row.anchor),
    );
  });
});

describe('the port performs S-1 and nothing else', () => {
  test('exactly one step is the ports', () => {
    expect(PORT_PERFORMED_STEPS).toStrictEqual(['S-1']);
  });

  test('S-1 is the verification step and its anchor is that nothing has been touched', () => {
    const s1 = SETTLEMENT_STEPS[0];
    expect(s1.action).toContain('Verify webhook signature, timestamp, and nonce');
    expect(s1.anchor).toBe('rejected before any state is touched');
  });

  test('every state effect belongs to a receiver, so this package writes nothing', () => {
    const stateSteps = SETTLEMENT_STEPS.filter((step) => step.id !== 'S-1');
    expect(stateSteps).toHaveLength(6);
    expect(stateSteps.every((step) => step.performedBy === 'receiver')).toBe(true);
  });
});

describe('the leg column is DERIVED from the columns each step names', () => {
  test('S-4, S-5, S-6 and S-7 name payout_requests state and carry that leg', () => {
    const byId = new Map(SETTLEMENT_STEPS.map((step) => [step.id, step]));
    expect(byId.get('S-4')?.action).toContain('payout_requests.status');
    expect(byId.get('S-5')?.anchor).toContain('payout_request_id');
    for (const id of ['S-3', 'S-4', 'S-5', 'S-6', 'S-7'] as const) {
      expect(byId.get(id)?.leg, id).toBe('payout_request');
    }
  });

  test('S-1 and S-2 are about the delivery and the transfer, so they carry no leg', () => {
    expect(SETTLEMENT_STEPS[0].leg).toBeNull();
    expect(SETTLEMENT_STEPS[1].leg).toBeNull();
  });

  test('ADR-019s internal leg is what the document says about those same steps', () => {
    // The reported tension, held to the source rather than left as a comment: the
    // document keeps the seven steps for the EXTERNAL leg and four of them name
    // internal-leg state. `settlement.ts`'s header reports it and takes no side.
    expect(M05).toContain(
      'The steps below are the **external** leg, preserved as written because a webhook from a rail is exactly as untrustworthy as it always was.',
    );
    expect(M05).toContain('`payout_requests.status` reaches `settled` and stops.');
  });
});
