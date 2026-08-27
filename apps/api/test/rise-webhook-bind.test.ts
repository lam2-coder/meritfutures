// =============================================================================
// apps/api/test/rise-webhook-bind.test.ts
// =============================================================================
// ONE ORDERING RULE, THREE IMPLEMENTATIONS, BOUND BY READING THE FIRST ONE.
//
// API_CONTRACT section 10 states one rule for every inbound webhook, in
// capitals: "HMAC signature verified BEFORE parsing, timestamp within a 5 minute
// window". `packages/psp/src/webhook.ts` implements it once,
// `packages/kyc/src/webhook.ts` implements it again, and
// `apps/api/src/rise-webhook.ts` implements it a third time. Every duplication
// is FORCED by the same type: `HmacWebhookScheme` declares `readonly psp: PspId`
// and `PspId` is closed at `'psp_a' | 'psp_b'` by a CHECK on `purchases.psp`, so
// calling the first from the payout rail would mean writing a payment
// processor's id into a transfer.
//
// THREE IMPLEMENTATIONS OF ONE ORDERING IS THREE CHANCES TO GET THE ORDERING
// WRONG, and this file is the instrument that makes the third one. It reads
// `packages/psp/src/webhook.ts` and fails if the refusal vocabulary drifts or if
// either file's steps stop happening in the same order. A change to the PSP
// verifier that this port should have copied fails a test HERE, which is where
// somebody who has never read this port will be sent.
//
// IT IS THE INSTRUMENT `packages/kyc/test/webhook-bind.test.ts` ALREADY IS, one
// deployable over, and it deliberately reads the SAME primary source rather than
// reading the KYC copy: binding to a copy would make a drift in that copy
// propagate silently, which is the failure the whole idea exists to prevent.
//
// IT ASSERTS AGREEMENT AND NOT SAMENESS. The Rise identity carries a transfer id
// and the PSP one does not, because API_CONTRACT section 10's own table anchors
// the two rows differently. What must agree is the ORDER and the REFUSALS.
//
// ADR-114 section 4 records what would end the duplication, and ADR-146 section
// 3 records that the condition it named for lifting has receded rather than
// arrived.
// =============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { RISE_WEBHOOK_WINDOW_SECONDS } from '../src/rise-webhook.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PSP_SRC = join(HERE, '..', '..', '..', 'packages', 'psp', 'src');
const RISE_FILE = join(HERE, '..', 'src', 'rise-webhook.ts');

const psp = readFileSync(join(PSP_SRC, 'webhook.ts'), 'utf8');
const pspPort = readFileSync(join(PSP_SRC, 'port.ts'), 'utf8');
const rise = readFileSync(RISE_FILE, 'utf8');

/**
 * The body of one `export function name(...)`, as written.
 *
 * THE ORDER IS READ FROM THE BODY AND NOT FROM THE FILE, and the difference is
 * not pedantry: every step below is also NAMED in an interface declaration or a
 * doc comment higher up, so a whole-file scan would report the order the
 * documentation happens to be written in rather than the order the code runs.
 */
function functionBody(source: string, name: string, file: string): string {
  const at = source.indexOf(`export function ${name}(`);
  if (at < 0) throw new Error(`${file} no longer declares a function named ${name}`);
  const open = source.indexOf('{', source.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`${file}: unbalanced braces in ${name}`);
}

const pspVerify = functionBody(psp, 'verifyHmacWebhook', 'packages/psp/src/webhook.ts');
const riseVerify = functionBody(rise, 'verifyRiseWebhook', 'apps/api/src/rise-webhook.ts');

/** The members of one `export type Name = 'a' | 'b'` union, as written. */
function unionMembers(source: string, name: string, file: string): readonly string[] {
  const at = source.indexOf(`export type ${name} =`);
  if (at < 0) throw new Error(`${file} no longer declares a union named ${name}`);
  const end = source.indexOf(';', at);
  if (end < 0) throw new Error(`${file}: ${name} has no terminating semicolon`);
  return [...source.slice(at, end).matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? '');
}

/** The index of each marker in a source, refusing one that is absent. */
function orderOf(source: string, markers: readonly string[], file: string): readonly number[] {
  return markers.map((marker) => {
    const at = source.indexOf(marker);
    if (at < 0) throw new Error(`${file} no longer contains \`${marker}\``);
    return at;
  });
}

function isAscending(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || value > (values[index - 1] ?? -1));
}

describe('the refusal vocabulary is the same set in both files', () => {
  test('member for member, in the same order', () => {
    const theirs = unionMembers(pspPort, 'WebhookRefusal', 'packages/psp/src/port.ts');
    const ours = unionMembers(rise, 'RiseWebhookRefusal', 'apps/api/src/rise-webhook.ts');
    // A closed set is what lets a receiver switch on a refusal, and two closed
    // sets that disagree are two receivers reporting different security events
    // for the same thing.
    expect(ours).toEqual(theirs);
    expect(ours.length).toBe(7);
  });
});

describe('the ordering rule happens in the same order in both files', () => {
  // API_CONTRACT section 10's sequence, expressed as the operations that
  // implement it. The digest FIRST, because an attacker controls the timestamp
  // bytes; the window SECOND; the parse LAST, so everything a caller holds was
  // covered by the MAC.
  const STEPS: readonly (readonly [string, string])[] = [
    ['the vendor extraction', 'scheme.presentedSignature('],
    ['the digest', "createHmac('sha256', secret)"],
    ['the constant time comparison', 'timingSafeEqual('],
    ['the freshness window', 'nowEpochSeconds'],
    ['the strict decode', "new TextDecoder('utf-8', { fatal: true })"],
    ['the parse', 'JSON.parse(text)'],
    ['the event identity', 'scheme.eventIdentity('],
  ];
  const markers = STEPS.map(([, marker]) => marker);

  test('packages/psp holds every step, in order', () => {
    expect(isAscending(orderOf(pspVerify, markers, 'packages/psp/src/webhook.ts'))).toBe(true);
  });

  test('apps/api/src/rise-webhook.ts holds every step, in order', () => {
    expect(isAscending(orderOf(riseVerify, markers, 'apps/api/src/rise-webhook.ts'))).toBe(true);
  });

  test('the length comparison guards `timingSafeEqual` in both, which THROWS on a mismatch', () => {
    for (const [file, source] of [
      ['packages/psp/src/webhook.ts', pspVerify],
      ['apps/api/src/rise-webhook.ts', riseVerify],
    ] as const) {
      const guard = source.indexOf('presented.mac.length !== expected.length');
      const compare = source.indexOf('timingSafeEqual(');
      expect(guard, `${file} no longer compares the MAC length first`).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(compare);
    }
  });

  test('both check the window in BOTH directions, which is what bounds a capture', () => {
    for (const source of [pspVerify, riseVerify]) {
      expect(source).toContain('Math.abs(nowEpochSeconds - presented.timestampEpochSeconds)');
    }
  });
});

describe('the window is the contract`s five minutes in both files', () => {
  test('both declare 300 seconds, and neither folds it into the comparison', () => {
    expect(RISE_WEBHOOK_WINDOW_SECONDS).toBe(300);
    expect(psp).toMatch(/export const WEBHOOK_WINDOW_SECONDS = 300;/);
    expect(rise).toMatch(/export const RISE_WEBHOOK_WINDOW_SECONDS = 300;/);
  });
});

describe('the reason the duplication exists is still true', () => {
  test('packages/psp brands its scheme with PspId, which the payout rail cannot be', () => {
    // The day this stops being true, the verifiers can become one and this file
    // is the place that says so.
    expect(pspPort + psp).toMatch(/readonly psp: PspId;/);
    expect(pspPort).toMatch(/export type PspId = 'psp_a' \| 'psp_b';/);
  });

  test('the Rise scheme brands nothing, because payout_transfers.provider is text', () => {
    // `0010_payouts.sql`: `provider text NOT NULL DEFAULT 'rise'`, with no CHECK.
    // A closed union here would be choosing a vendor in a type.
    expect(rise).not.toMatch(/^\s*readonly psp:/m);
    expect(rise).toMatch(/export const RISE_PROVIDER = 'rise';/);
  });

  test('the Rise port imports nothing from the payment package', () => {
    // The whole point of the duplication is that it CANNOT import it. If this
    // ever passes an import through, the duplication has stopped being forced
    // and the neutral package ADR-114 section 4 names is owed immediately.
    expect(rise).not.toMatch(/@merit\/psp/);
  });
});
