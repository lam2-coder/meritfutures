import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import type { CertificateResponse } from '../src/api/types.ts';
import { UnverifiableCertificateError, toCertificateView } from '../src/view/certificates.ts';
import { MissingDisclosureError, disclosureBlock } from '../src/view/disclosure.ts';

// =============================================================================
// SC-M4-08: the row is the fact, the page is the authority, the card is a
// rendering, and the disclosure cannot be left off
// =============================================================================

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const DISCLOSURE = disclosureBlock(
  { slug: 'simulated-environment-disclosure', version: 2 },
  'All trading on Merit accounts is simulated.',
);

function certificate(over: Partial<CertificateResponse> = {}): CertificateResponse {
  return {
    certificate_id: 'cert-1',
    kind: 'payout',
    image_url: 'https://cdn.example/cards/cert-1.png?sig=abc',
    verify_url: 'https://meritfutures.com/verify/AB12CD',
    issued_at: '2026-08-01T12:00:00Z',
    claims: {
      plan_code: 'core_eod',
      size_cents: 5_000_000,
      amount_cents: 150_000,
      trading_day: '2026-07-31',
    },
    ...over,
  };
}

test('the verification route is required and a card without one is refused', () => {
  // AS-M4-03: "The verification page is the authority and the image is not." A
  // card shared without its verification route is a picture, and a picture is
  // the artifact the attack forges.
  expect(() => toCertificateView(certificate({ verify_url: '' }), DISCLOSURE)).toThrow(
    UnverifiableCertificateError,
  );
  expect(() => toCertificateView(certificate({ verify_url: '   ' }), DISCLOSURE)).toThrow(
    UnverifiableCertificateError,
  );
});

test('a pass card claims no amount and the absence is not rendered as zero', () => {
  // Rendering an absent amount as 0.00 turns a pass claim into a false payout
  // claim, which is precisely AS-M4-03's forgery direction produced by a
  // default rather than by an adversary.
  const view = toCertificateView(
    certificate({
      kind: 'pass',
      claims: { plan_code: 'core_eod', size_cents: 5_000_000, trading_day: '2026-07-31' },
    }),
    DISCLOSURE,
  );

  expect(view.kind).toBe('pass');
  expect(view.claims.amount).toBeNull();
  expect(view.claims.size).toBe('50,000.00');
});

test('a payout card renders its amount through the formatter', () => {
  const view = toCertificateView(certificate(), DISCLOSURE);
  expect(view.claims.amount).toBe('1,500.00');
  expect(view.claims.trading_day).toBe('2026-07-31');
});

test('the claims carry no identity and there is no field one could go in', () => {
  // AS-M4-03 rule 3: "no identity, no email, no cumulative totals". The absence
  // is the control, so it is asserted over the built view rather than promised.
  const view = toCertificateView(certificate(), DISCLOSURE);
  const keys = Object.keys(view.claims);

  expect(keys).toEqual(['plan_code', 'size', 'amount', 'trading_day']);
  for (const forbidden of ['identity', 'email', 'name', 'lifetime', 'total']) {
    for (const key of keys) {
      expect(key.includes(forbidden), `${key} looks like ${forbidden}`).toBe(false);
    }
  }
});

test('the disclosure cannot be a literal and cannot be blank', () => {
  // INV-M4-09 is a compliance obligation rather than a design preference, so
  // the enforcement is a brand plus a refusal and not a review checklist.
  expect(() => disclosureBlock({ slug: 'x', version: 1 }, '')).toThrow(MissingDisclosureError);
  expect(() => disclosureBlock({ slug: 'x', version: 1 }, '   ')).toThrow(MissingDisclosureError);

  const view = toCertificateView(certificate(), DISCLOSURE);
  expect(view.disclosure).toBe('All trading on Merit accounts is simulated.');
});

test('the missing-disclosure refusal names the document it came from', () => {
  try {
    disclosureBlock({ slug: 'affiliate-nfa-disclosure', version: 4 }, '');
  } catch (err) {
    expect(err).toBeInstanceOf(MissingDisclosureError);
    expect((err as MissingDisclosureError).source).toEqual({
      slug: 'affiliate-nfa-disclosure',
      version: 4,
    });
    expect((err as Error).message).toContain('affiliate-nfa-disclosure');
  }
});

test('no claim is recomputed, cross-checked, or arithmetic-ed', () => {
  // The signature is over the row and the verification page is what checks it.
  // A client-side consistency check would be the portal asserting something
  // about a signed artifact it cannot verify, and its failure would look like a
  // defect in a valid certificate.
  const code = readFileSync(join(SRC, 'view', 'certificates.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');

  for (const operator of [' - ', ' * ', ' / ', ' % ', '+=', '-=']) {
    expect(code.includes(operator), `${operator} appears in certificates.ts`).toBe(false);
  }
});

test('the two disclosure brands are distinct, and neither claims the others source', () => {
  // `CopyBlock`'s brand names `plan_versions.copy_blocks` and `DisclosureBlock`'s
  // names `content_documents`. Collapsing them would put a false statement about
  // provenance inside the one type nobody would think to check.
  const copy = readFileSync(join(SRC, 'copy', 'copy-block.ts'), 'utf8');
  const disclosure = readFileSync(join(SRC, 'view', 'disclosure.ts'), 'utf8');

  expect(copy).toContain("readonly [COPY_BLOCK_BRAND]: 'plan_versions.copy_blocks'");
  expect(disclosure).toContain("readonly [DISCLOSURE_BRAND]: 'content_documents'");

  // The brands are declared once each and neither declaration names the other's
  // table. `disclosure.ts` DISCUSSES `plan_versions.copy_blocks` at length in
  // its header, which is the argument for the separation rather than a leak, so
  // the assertion reads the declaration and not the file.
  expect(disclosure).not.toContain("readonly [DISCLOSURE_BRAND]: 'plan_versions");
});

test('no view module renders a certificate image as its authority', () => {
  // A structural read of the whole view directory: the fact worth protecting is
  // that `verify_url` exists on every path where `image_url` does, so no later
  // screen can carry the picture alone.
  const files = readdirSync(join(SRC, 'view')).filter((f) => f.endsWith('.ts'));
  expect(files.length).toBeGreaterThan(5);

  for (const file of files) {
    const code = readFileSync(join(SRC, 'view', file), 'utf8');
    if (!code.includes('image_url')) continue;
    expect(code, `${file} carries image_url without verify_url`).toContain('verify_url');
  }
});
