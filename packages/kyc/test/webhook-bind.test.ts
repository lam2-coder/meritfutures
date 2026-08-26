// =============================================================================
// packages/kyc/test/webhook-bind.test.ts
// =============================================================================
// ONE ORDERING RULE, TWO IMPLEMENTATIONS, BOUND BY READING THE OTHER ONE.
//
// API_CONTRACT section 10 states one rule for every inbound webhook, in
// capitals: "HMAC signature verified BEFORE parsing, timestamp within a 5
// minute window". `packages/psp/src/webhook.ts` implements it once and
// `packages/kyc/src/webhook.ts` implements it again, and the duplication is
// FORCED rather than chosen: `HmacWebhookScheme` declares `readonly psp: PspId`
// and `PspId` is closed at `'psp_a' | 'psp_b'` by a CHECK on `purchases.psp`,
// so calling the first from an identity path would mean writing a payment
// provider's id into a KYC verification.
//
// TWO IMPLEMENTATIONS OF ONE ORDERING IS TWO CHANCES TO GET THE ORDERING WRONG,
// and this file is the instrument that makes it one. It reads
// `packages/psp/src/webhook.ts` and fails if the refusal vocabulary drifts or
// if either file's steps stop happening in the same order. A change to the PSP
// verifier that this package should have copied fails a test HERE, which is
// where somebody who has never read this package will be sent.
//
// IT ASSERTS AGREEMENT AND NOT SAMENESS. The KYC identity carries an applicant
// id and the PSP one does not, because API_CONTRACT section 10's own table
// anchors the two rows differently. What must agree is the ORDER and the
// REFUSALS, and those are what is read.
//
// ADR-114 section 4 records what would end the duplication, and why a neutral
// package neither provider set brands is not this slice's to create.
// =============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { KYC_WEBHOOK_WINDOW_SECONDS } from '../src/webhook.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PSP_SRC = join(HERE, '..', '..', 'psp', 'src');
const KYC_SRC = join(HERE, '..', 'src');

const psp = readFileSync(join(PSP_SRC, 'webhook.ts'), 'utf8');
const kyc = readFileSync(join(KYC_SRC, 'webhook.ts'), 'utf8');
const pspPort = readFileSync(join(PSP_SRC, 'port.ts'), 'utf8');
const kycPort = readFileSync(join(KYC_SRC, 'port.ts'), 'utf8');

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
const kycVerify = functionBody(kyc, 'verifyKycWebhook', 'packages/kyc/src/webhook.ts');

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

describe('the refusal vocabulary is the same set in both packages', () => {
  test('member for member, in the same order', () => {
    const theirs = unionMembers(pspPort, 'WebhookRefusal', 'packages/psp/src/port.ts');
    const ours = unionMembers(kycPort, 'KycWebhookRefusal', 'packages/kyc/src/port.ts');
    // A closed set is what lets a route switch on a refusal, and two closed
    // sets that disagree are two routes that report different security events
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

  test('packages/kyc holds every step, in order', () => {
    expect(isAscending(orderOf(kycVerify, markers, 'packages/kyc/src/webhook.ts'))).toBe(true);
  });

  test('the length comparison guards `timingSafeEqual` in both, which THROWS on a mismatch', () => {
    for (const [file, source] of [
      ['packages/psp/src/webhook.ts', pspVerify],
      ['packages/kyc/src/webhook.ts', kycVerify],
    ] as const) {
      const guard = source.indexOf('presented.mac.length !== expected.length');
      const compare = source.indexOf('timingSafeEqual(');
      expect(guard, `${file} no longer compares the MAC length first`).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(compare);
    }
  });
});

describe('the window is the contract`s five minutes in both packages', () => {
  test('both declare 300 seconds, and neither folds it into the comparison', () => {
    expect(KYC_WEBHOOK_WINDOW_SECONDS).toBe(300);
    expect(psp).toMatch(/export const WEBHOOK_WINDOW_SECONDS = 300;/);
    expect(kyc).toMatch(/export const KYC_WEBHOOK_WINDOW_SECONDS = 300;/);
  });
});

describe('the reason the duplication exists is still true', () => {
  test('packages/psp brands its scheme with PspId, which no KYC provider can be', () => {
    // The day this stops being true, the two verifiers can become one and this
    // file is the place that says so.
    expect(pspPort + psp).toMatch(/readonly psp: PspId;/);
  });

  test('packages/kyc brands its scheme with a plain string, as its column is', () => {
    expect(kyc).toMatch(/readonly provider: string;/);
  });
});
