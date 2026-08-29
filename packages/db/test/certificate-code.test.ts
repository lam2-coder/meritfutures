// =============================================================================
// The mint for `certificates.code`
// =============================================================================
// `RI-22` measures the DRAWS on every `CI-01` pass and is the deliverable of
// ADR-235. This suite asserts the CONTRACT the issuance slice will build on,
// which is the half a statistical measurement cannot state: which names are
// exported, what they mean, and which of them a caller may not expect to find.
//
// IT DELIBERATELY DOES NOT RESTATE `RI-22`'s ARITHMETIC IN A SECOND PLACE. The
// one number it checks is the corpus commitment, read from `M11` rather than
// typed, because a suite that hardcoded 128 would agree with itself forever
// after the corpus moved.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  CERTIFICATE_CODE_ALPHABET,
  CERTIFICATE_CODE_ENTROPY_BITS,
  CERTIFICATE_CODE_LENGTH,
  mintCertificateCode,
} from '../src/certificate-code.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** `INV-M11-05`'s own figure, read rather than retyped. */
function committedBits(): number {
  const m11 = readFileSync(join(REPO_ROOT, 'docs/plans/M11-certificates-social-proof.md'), 'utf8');
  const match = /(\d+) bits of entropy/.exec(m11);
  if (!match?.[1]) throw new Error('M11 states no bit count for the certificate code');
  return Number(match[1]);
}

describe('the code carries the entropy the corpus commits to', () => {
  test('the alphabet is distinct, so the bit count is taken over a real symbol set', () => {
    expect(new Set(CERTIFICATE_CODE_ALPHABET).size).toBe(CERTIFICATE_CODE_ALPHABET.length);
  });

  test('the exported bit count is the arithmetic and not a claim', () => {
    expect(CERTIFICATE_CODE_ENTROPY_BITS).toBe(
      Math.floor(CERTIFICATE_CODE_LENGTH * Math.log2(new Set(CERTIFICATE_CODE_ALPHABET).size)),
    );
  });

  test('it clears INV-M11-05, whose figure is read out of M11', () => {
    expect(CERTIFICATE_CODE_ENTROPY_BITS).toBeGreaterThanOrEqual(committedBits());
  });

  test('one position fewer would MISS it, which is why the length is 26', () => {
    // THE MARGIN IS TWO BITS AND THAT IS STATED RATHER THAN LEFT TO BE
    // DISCOVERED. A later author trimming the token for a prettier card is one
    // character away from a code the whole corpus overstates.
    const perSymbol = Math.log2(new Set(CERTIFICATE_CODE_ALPHABET).size);
    expect(Math.floor((CERTIFICATE_CODE_LENGTH - 1) * perSymbol)).toBeLessThan(committedBits());
  });
});

describe('the alphabet is the one a person reads off a card', () => {
  test('no I, L, O or U, which is Crockford Base32 and is why', () => {
    // `SD-M11-01`: the token "appears in the image". `1/I/l` and `0/O` mistyped
    // resolves as `INV-M11-03`'s honest unknown, which is indistinguishable from
    // a forged card to the person holding it.
    for (const confusable of ['I', 'L', 'O', 'U'])
      expect(CERTIFICATE_CODE_ALPHABET).not.toContain(confusable);
  });

  test('it is uppercase and alphanumeric, with no separator to structure it', () => {
    expect(CERTIFICATE_CODE_ALPHABET).toMatch(/^[0-9A-Z]+$/);
  });
});

describe('a minted code', () => {
  test('is the declared length, drawn only from the declared alphabet', () => {
    const symbols = new Set(CERTIFICATE_CODE_ALPHABET);
    for (let i = 0; i < 200; i += 1) {
      const code = mintCertificateCode();
      expect(code).toHaveLength(CERTIFICATE_CODE_LENGTH);
      for (const ch of code) expect(symbols.has(ch)).toBe(true);
    }
  });

  test('carries no sequence and no structure', () => {
    // `M11:246`: "128 bits of entropy, no sequence, NO STRUCTURE". Two draws
    // sharing a prefix, a suffix or an ordering are all the same defect.
    const draws = Array.from({ length: 200 }, () => mintCertificateCode());
    expect(new Set(draws).size).toBe(draws.length);
    expect(new Set(draws.map((d) => d.charAt(0))).size).toBeGreaterThan(1);
    expect(new Set(draws.map((d) => d.charAt(CERTIFICATE_CODE_LENGTH - 1))).size).toBeGreaterThan(
      1,
    );
    expect([...draws]).not.toEqual([...draws].sort());
  });
});

describe('what this module refuses to export, which is a ruling', () => {
  test('no shape predicate, because the verify route must not have a fast path', async () => {
    // `API_CONTRACT:833`: "a shape check ahead of the lookup is a faster path,
    // and it hands an attacker the token's alphabet and length for free, which
    // is `INV-M11-05`'s non-enumerability half failing beside its timing half".
    // An exported validator is the function that makes that easy to add, so it
    // is not written. A caller that wants to know whether a code is real asks
    // the table.
    const surface = Object.keys(await import('../src/certificate-code.ts')).sort();
    expect(surface).toEqual([
      'CERTIFICATE_CODE_ALPHABET',
      'CERTIFICATE_CODE_ENTROPY_BITS',
      'CERTIFICATE_CODE_LENGTH',
      'mintCertificateCode',
    ]);
  });
});
