// =============================================================================
// certificates.code: the mint
// =============================================================================
// `GET /verify/:code` is public and unauthenticated, and the code is the ONLY
// thing a caller presents. `INV-M11-05` fixes that token at "128 bits of
// entropy, no sequence" (`M11:54`), `M11:246` calls the entropy the whole
// defence -- "the code space is not walkable, which makes the attack infeasible
// rather than merely rate limited" -- and `API_CONTRACT:1473` spends the
// catalog's rate budget on the strength of that number. THIS FILE IS WHERE THAT
// NUMBER IS MADE TRUE. ADR-235.
//
// IT LANDS BEFORE THE ISSUER, ON PURPOSE, AND THAT IS THE ORDER ADR-231 SECTION
// 6 ASKED FOR. That entry ruled that "the slice that first writes a
// `certificates` row owes the 128-bit mint in the same slice", and named the
// safer alternative in the same breath: land the bound first, "before anything
// can write a weak code". A mint that exists before any issuer does means the
// issuance slice INHERITS a measured token instead of inventing one under
// deadline, and `RI-22` is what makes the inheritance mandatory rather than
// hoped for.
//
// WHY THIS PACKAGE, AND IT IS A MEASUREMENT RATHER THAN A PREFERENCE. `M11:111`
// puts the issuer in the WORKER ("participant Iss as Issuer (worker)") and
// ADR-231 put the verifier in the API, so the mint has to be reachable from two
// deployables that may not import each other (`RI-04`). `@merit/db` is the ONLY
// package `apps/api/package.json` and `apps/worker/package.json` BOTH declare,
// so this is the one home that costs no new dependency and no `VG-12`
// admission. It also puts the mint one import from `PUBLIC_LOOKUP_ADDRESS`,
// whose whole safety claim is that this column's value cannot be guessed.
//
// -----------------------------------------------------------------------------
// THE ARITHMETIC, WRITTEN OUT BECAUSE A SLOGAN IS WHAT WENT STALE
// -----------------------------------------------------------------------------
// 32 DISTINCT symbols is 5 bits each, and 26 positions is 130 bits. That clears
// `INV-M11-05`'s 128 with two bits to spare, and 25 positions would give 125 and
// miss it, which is why the length is 26 and not the rounder 24 or 32.
//
// THE COUNT IS COMPUTED FROM THE ALPHABET AND NEVER TYPED. `130` appears in no
// constant here. An alphabet edited without a length edit moves
// `CERTIFICATE_CODE_ENTROPY_BITS` by itself, and `RI-22` reads the corpus's own
// "128 bits" sentence out of `M11` and fails when the computed figure drops
// under it. That is ADR-034's remedy applied to a security parameter: generate
// the value or delete it and point at the source.
//
// AND IT IS COMPUTED OVER THE DISTINCT SYMBOL COUNT RATHER THAN THE STRING
// LENGTH, which is the defect this file is most likely to acquire. An alphabet
// that repeats one character is still 32 characters long and is 31 symbols of
// entropy, and every arithmetic written over `.length` would report the loss as
// no loss at all. The module refuses to load on a repeat rather than reporting
// a number it cannot support.
//
// -----------------------------------------------------------------------------
// `randomInt` AND NOT `randomBytes` WITH A MODULO
// -----------------------------------------------------------------------------
// This is `auth-backend.ts`'s ruling for `mintOtpCode` taken deliberately
// rather than copied: "the bias is removed by not writing the arithmetic".
//
// AND HERE THE MODULO WOULD ACTUALLY BE SAFE TODAY, WHICH IS THE REASON TO
// REFUSE IT. 32 divides 256 exactly, so `randomBytes(26)` with `byte % 32` is
// uniform -- for THIS alphabet size. It stops being uniform the day somebody
// drops a confusable symbol and leaves 31, and it does so silently, with the
// low symbols fractionally likelier and nothing in the tree saying so. Safety
// that holds only while a constant nobody re-checks keeps its value is the
// exact class of defect this file exists to end. `randomInt` rejection-samples
// in the runtime and is documented uniform at every bound.
//
// -----------------------------------------------------------------------------
// NO SEQUENCE, NO STRUCTURE, AND NO VALIDATOR
// -----------------------------------------------------------------------------
// `M11:246` reads "128 bits of entropy, no sequence, NO STRUCTURE". So there is
// no prefix, no checksum digit, no separator, no issue-time component and no
// per-kind marker. Every one of those is a free hint about the space, and a
// checksum in particular hands an enumerator a local reject test that cuts the
// search it is supposed to bound.
//
// NO SHAPE PREDICATE IS EXPORTED AND THE REFUSAL IS A RULING RATHER THAN AN
// OVERSIGHT. `API_CONTRACT:833` states of the verify route that "a shape check
// ahead of the lookup is a faster path, and it hands an attacker the token's
// alphabet and length for free, which is `INV-M11-05`'s non-enumerability half
// failing beside its timing half". An exported `isCertificateCode` is the thing
// a later implementer would reach for to add exactly that fast path, so the
// function that would make it easy is not written. A caller that wants to know
// whether a code is real asks the table.
//
// THE ALPHABET IS CROCKFORD BASE32 and the four it omits are the reason: `I`,
// `L`, `O` and `U`. The token is rendered INTO A CARD IMAGE (`SD-M11-01`, "the
// short unguessable token that appears in the image") and read back off it by a
// person, and `1/I/l` and `0/O` mistyped is a support ticket that looks exactly
// like `INV-M11-03`'s honest unknown. Dropping them costs no bits, because the
// arithmetic above is taken over what is left.

import { randomInt } from 'node:crypto';

/**
 * The symbols a certificate code is drawn from. Crockford Base32, uppercase.
 *
 * THE ORDER IS IRRELEVANT AND THE SIZE IS NOT. Every draw is uniform over the
 * whole string, so nothing reads a position; what the length of this constant
 * decides is {@link CERTIFICATE_CODE_ENTROPY_BITS}.
 */
export const CERTIFICATE_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * How many symbols a code carries. TWENTY-SIX, and the number is load bearing:
 * at 5 bits a symbol, 25 gives 125 bits and misses `INV-M11-05`'s 128.
 */
export const CERTIFICATE_CODE_LENGTH = 26;

/**
 * The distinct symbols, which is the only count the entropy may be taken over.
 */
const DISTINCT_SYMBOLS = new Set(CERTIFICATE_CODE_ALPHABET).size;

// A REPEATED SYMBOL IS AN ENTROPY LOSS THAT LOOKS LIKE A TYPO, so it is a
// refusal to load rather than a smaller number quietly reported. The alternative
// is a deployment that mints codes weaker than every document says they are,
// which is the situation ADR-235 was opened to end.
if (DISTINCT_SYMBOLS !== CERTIFICATE_CODE_ALPHABET.length)
  throw new Error(
    `CERTIFICATE_CODE_ALPHABET repeats a symbol: ${String(CERTIFICATE_CODE_ALPHABET.length)} ` +
      `characters and ${String(DISTINCT_SYMBOLS)} distinct. Entropy is taken over the distinct ` +
      `count, so a repeat weakens every code minted while every arithmetic over the string ` +
      `length reports no loss at all (INV-M11-05, ADR-235)`,
  );

/**
 * The real bit count of a code this module mints, computed rather than claimed.
 *
 * `floor(length * log2(distinct symbols))`. `RI-22` reads `INV-M11-05`'s own
 * "128 bits" sentence out of `M11` and refuses a tree where this figure is
 * under it, so the corpus sentence is the threshold and this file is the
 * measurement.
 */
export const CERTIFICATE_CODE_ENTROPY_BITS = Math.floor(
  CERTIFICATE_CODE_LENGTH * Math.log2(DISTINCT_SYMBOLS),
);

/**
 * One certificate code.
 *
 * `charAt` RATHER THAN AN INDEX, because an index into a string is
 * `string | undefined` under this workspace's `noUncheckedIndexedAccess` and the
 * repair a hurried author reaches for is a non-null assertion. `randomInt`'s
 * bound is exclusive and is the alphabet's own length, so no draw can be out of
 * range; `charAt` states that in the type rather than asserting it.
 */
export function mintCertificateCode(): string {
  let code = '';
  for (let i = 0; i < CERTIFICATE_CODE_LENGTH; i += 1)
    code += CERTIFICATE_CODE_ALPHABET.charAt(randomInt(0, CERTIFICATE_CODE_ALPHABET.length));
  return code;
}
