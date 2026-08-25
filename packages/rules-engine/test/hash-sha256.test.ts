// =============================================================================
// packages/rules-engine/test/hash-sha256.test.ts
// =============================================================================
// THE PRIMITIVE, UNDER KNOWN-ANSWER VECTORS. ADR-081 rules that `hash.ts`
// hand-rolls SHA-256, applying the 2026-08-17 review desk section 3, and the
// desk's own sentence about what that costs is the specification for this file:
// the hand-roll owes a correctness proof, and "published NIST vectors,
// differentially testable against `node:crypto` from a test file" is how it is
// paid.
//
// THIS FILE PAYS THE FIRST HALF AND CANNOT PAY THE SECOND. This package's
// `tsconfig.json` sets `"types": []`, so `node:crypto` does not typecheck HERE
// either, in `test/` any more than in `src/`. The differential half therefore
// lives in `apps/worker/test/state-hash.test.ts`, which has `@types/node` and
// which hashes its own independent transcription of the serialization with
// `createHash`. The two files are one control in two places, and neither is
// redundant with the other: this one localises a defect to the primitive, that
// one proves the whole pipeline agrees with OpenSSL.
//
// -----------------------------------------------------------------------------
// WHERE EVERY EXPECTED VALUE CAME FROM, WHICH IS THE ONLY THING THAT MAKES A
// KNOWN-ANSWER TEST WORTH RUNNING
// -----------------------------------------------------------------------------
// A known-answer test whose answers came from the implementation under test is
// a tautology with a green tick. So not one digest below was produced by
// `hash.ts`. Each block says its source, and there are exactly two:
//
//   FIPS 180-4     the four published example messages and their digests
//                  (the empty string, "abc", the 448-bit message and the
//                  896-bit message), plus the one-million-'a' example.
//   node:crypto    OpenSSL, an implementation independent of this one,
//                  evaluated outside this package where the import is legal.
//                  Used for the block-boundary lengths and the UTF-8 cases,
//                  which FIPS does not publish.
//
// THE BLOCK-BOUNDARY LENGTHS ARE NOT DECORATION. 55 and 56 straddle the point
// where the 8-byte length no longer fits in the final block and padding spills
// into a second one, and 119/120 straddle the same seam one block later. A
// padding implementation that is wrong is usually wrong at exactly one of them.

import { describe, expect, it } from 'vitest';

import { sha256, utf8Bytes } from '../src/hash.ts';

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** ASCII only, so this helper cannot be the thing under test in the KAT block. */
const ascii = (value: string): Uint8Array =>
  Uint8Array.from([...value].map((c) => c.charCodeAt(0)));

describe('SHA-256 against FIPS 180-4 published vectors', () => {
  it('hashes the empty message', () => {
    expect(hex(sha256(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hashes "abc", the one-block example', () => {
    expect(hex(sha256(ascii('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes the 448-bit two-block example', () => {
    const message = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
    expect(message).toHaveLength(56);
    expect(hex(sha256(ascii(message)))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('hashes the 896-bit example', () => {
    const message =
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmno' +
      'ijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu';
    expect(message).toHaveLength(112);
    expect(hex(sha256(ascii(message)))).toBe(
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
    );
  });

  it('hashes one million "a", which exercises the block loop 15,625 times', () => {
    expect(hex(sha256(ascii('a'.repeat(1_000_000))))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });
});

// -----------------------------------------------------------------------------
// Padding seams, from node:crypto
// -----------------------------------------------------------------------------
/** `createHash('sha256').update('a'.repeat(n),'utf8').digest('hex')`, per n. */
const BOUNDARY: readonly (readonly [number, string])[] = [
  [1, 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'],
  [55, '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318'],
  [56, 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a'],
  [57, 'f13b2d724659eb3bf47f2dd6af1accc87b81f09f59f2b75e5c0bed6589dfe8c6'],
  [63, '7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34'],
  [64, 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb'],
  [65, '635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0'],
  [119, '31eba51c313a5c08226adf18d4a359cfdfd8d2e816b13f4af952f7ea6584dcfb'],
  [120, '2f3d335432c70b580af0e8e1b3674a7c020d683aa5f73aaaedfdc55af904c21c'],
  [127, 'c57e9278af78fa3cab38667bef4ce29d783787a2f731d4e12200270f0c32320a'],
  [128, '6836cf13bac400e9105071cd6af47084dfacad4e5e302c94bfed24e013afb73e'],
  [129, 'c12cb024a2e5551cca0e08fce8f1c5e314555cc3fef6329ee994a3db752166ae'],
];

describe('SHA-256 padding across every block seam', () => {
  it.each(BOUNDARY)('hashes %i bytes', (length, expected) => {
    expect(hex(sha256(ascii('a'.repeat(length))))).toBe(expected);
  });

  it('returns thirty-two bytes for every one of them', () => {
    for (const [length] of BOUNDARY) {
      expect(sha256(ascii('a'.repeat(length)))).toHaveLength(32);
    }
  });
});

// -----------------------------------------------------------------------------
// The UTF-8 encoder, which is the subtlest thing in `hash.ts`
// -----------------------------------------------------------------------------
// `frame` counts BYTES, and under `"types": []` there is no `Buffer` and no
// `TextEncoder` to count them with, so `hash.ts` writes the encoder out. It
// must agree with `Buffer.byteLength(s,'utf8')` and with `.update(s,'utf8')` on
// EVERY input. The cases that decide it are the ones no fixture reaches,
// because every value in a real `rule_states` row is ASCII: an unpaired
// surrogate, which both Node and the WHATWG encoder replace with `U+FFFD`.
//
// Byte sequences and digests below are `Buffer.from(s,'utf8').toString('hex')`
// and `createHash('sha256').update(s,'utf8')`, taken from Node.

interface Utf8Case {
  readonly what: string;
  readonly value: string;
  readonly bytes: string;
  readonly digest: string;
}

const UTF8: readonly Utf8Case[] = [
  {
    what: 'two-byte, U+00E9',
    value: 'é',
    bytes: 'c3a9',
    digest: '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c',
  },
  {
    what: 'three-byte, U+20AC',
    value: '€',
    bytes: 'e282ac',
    digest: 'c4cc90ed3d26f12d4b08a75140970a7904035c31cbb4515a83f19b9003c00d1d',
  },
  {
    what: 'four-byte surrogate PAIR, U+1D11E',
    value: '𝄞',
    bytes: 'f09d849e',
    digest: 'e419efd3d6046adf7662b0daadab65047e8014a523316d7ccc8710de694aa9b6',
  },
  {
    what: 'a LONE HIGH surrogate, replaced with U+FFFD',
    value: '\ud800',
    bytes: 'efbfbd',
    digest: '83d544ccc223c057d2bf80d3f2a32982c32c3c0db8e2674820da5064783fb097',
  },
  {
    what: 'a LONE LOW surrogate, replaced with U+FFFD',
    value: '\udc00',
    bytes: 'efbfbd',
    digest: '83d544ccc223c057d2bf80d3f2a32982c32c3c0db8e2674820da5064783fb097',
  },
  {
    what: 'a HIGH surrogate followed by a NON-surrogate, so the pair never forms',
    value: '\ud800a',
    bytes: 'efbfbd61',
    digest: '94b964456d33b6a0fb82bd59fb16d700eb6d2fea5366d4974e28980cc9c7144e',
  },
  {
    what: 'a valid PAIR followed by a lone low, so the greedy read must stop',
    value: '𝄞\udfff',
    bytes: 'f09d849eefbfbd',
    digest: 'bdd77583218590804805a010c7220a51e691ce102303566aeb2ace6a0dbe35f6',
  },
  {
    what: 'one, two, three and four byte code points mixed',
    value: 'aéb€c𝄞d',
    bytes: '61c3a962e282ac63f09d849e64',
    digest: '0925f45e52805ecdf7bf75c2e5d3591cb85c6d5703e24249f39f9f27d111c69a',
  },
];

describe("the UTF-8 encoder agrees with Node's, byte for byte", () => {
  it.each(UTF8)('$what', ({ value, bytes, digest }) => {
    expect(hex(utf8Bytes(value))).toBe(bytes);
    expect(utf8Bytes(value)).toHaveLength(bytes.length / 2);
    expect(hex(sha256(utf8Bytes(value)))).toBe(digest);
  });

  it('encodes the empty string as no bytes at all', () => {
    expect(utf8Bytes('')).toHaveLength(0);
  });

  it('counts BYTES and not UTF-16 units, which is the whole point of the prefix', () => {
    // '𝄞' is ONE code point, TWO UTF-16 units and FOUR utf-8 bytes. A framing
    // that counted `String.length` would frame it as 2 and be injective by
    // accident rather than by construction.
    expect('𝄞'.length).toBe(2);
    expect(utf8Bytes('𝄞')).toHaveLength(4);
  });
});
