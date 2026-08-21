// =============================================================================
// apps/portal/src/format/money.ts
// =============================================================================
// THE ONLY PLACE IN THIS APPLICATION WHERE A MONEY VALUE IS DIVIDED.
//
// INV-M4-01: "No money value displayed anywhere is computed client side | Lint
// rule banning arithmetic operators on any field whose name ends `_cents` or
// `_bp`; A FORMATTING HELPER IS THE ONLY PERMITTED CONSUMER."
//
// This file is that helper. Everything else in apps/portal reads a `_cents` or
// `_bp` field, hands it to one of the two functions below, and stores the
// STRING. The view models in ../view carry formatted strings rather than
// numbers for exactly that reason: a string cannot be added to another string
// without the result looking obviously wrong in a diff, so the invariant stops
// depending on a reviewer noticing a `+`.
//
// THE LINT RULE INV-M4-01 NAMES DOES NOT EXIST YET, AND THIS FILE DOES NOT
// CLAIM IT DOES. packages/eslint-plugin-merit holds three rules
// (`engine-purity`, `no-raw-db-client`, `no-calendar-in-expiry-path`) and none
// of them is this one. Writing it means writing a rule package, which is
// outside this session's fence. What stands in for it meanwhile is
// ../../test/inv-m4-01.test.ts, which reads this app's own source and fails on
// an arithmetic operator beside a money-suffixed identifier. That is a weaker
// control than an ESLint rule (it sees one application rather than every app
// path) and it is a real one, and the difference is recorded rather than
// glossed: the rule is still owed.
//
// -----------------------------------------------------------------------------
// WHY THE DIVISION HERE IS NOT THE THING THE INVARIANT BANS
// -----------------------------------------------------------------------------
// M04's governing sentence is "render exactly what the engine computed, never
// recompute it, AND NEVER ROUND IT." Cents are exact integers, and rendering an
// exact integer with a decimal point two places from the right is a change of
// notation rather than a change of value: 150000 and "1,500.00" are the same
// quantity written differently, and the operation is reversible. Every function
// below is integer-only for that reason. THERE IS NO FLOATING-POINT DIVISION IN
// THIS FILE and `150000 / 100` never appears.
//
// THE OBVIOUS ARGUMENT FOR THAT IS WRONG AND IS RECORDED HERE SO THE NEXT
// SESSION DOES NOT REACH FOR IT. It is tempting to say `(cents / 100)
// .toFixed(2)` drifts by a cent. It does not: over every integer from 0 to
// 2,000,000 cents the two agree exactly, checked before this file was written.
// The real argument is narrower and survives: that agreement holds only inside
// the safe-integer range, it is not a property a reader can verify at a call
// site, and `Number(9007199254740993n) / 100` reports ...409.92 where the exact
// answer is ...409.93. An integer implementation needs no range to be true on,
// which is what M01 INV-02's "bigint at every boundary" is about.

/**
 * Refuses anything that is not an exact integer, and returns it as `bigint`.
 *
 * WHAT THIS CATCHES. A money value that has been through a floating-point
 * expression somewhere upstream arrives here with a fractional part, and this
 * throws instead of rendering `1,234.5600000000001` or, worse, rendering
 * `1,234.56` and hiding it.
 *
 * WHAT IT DOES NOT CATCH, said plainly because a control whose limits are not
 * stated gets trusted past them: an addition of two integers is still an
 * integer, so `formatCents(a_cents + b_cents)` passes this check. That case is
 * the source-level check's (../../test/inv-m4-01.test.ts) and eventually the
 * lint rule's. This function guards the arithmetic that changes the VALUE's
 * kind; the source check guards the arithmetic that should not have happened.
 */
function exactInteger(value: number | bigint, unit: string): bigint {
  if (typeof value === 'bigint') return value;
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `${unit} must be an exact integer, received ${String(value)}. ` +
        'A money value with a fractional part means arithmetic happened somewhere ' +
        'it should not have (INV-M4-01), and rendering it would hide that.',
    );
  }
  return BigInt(value);
}

/**
 * Thousands separators, inserted from the right over a digit string.
 *
 * THE SEPARATOR IS HARD-CODED AND THE CORPUS HAS NOT RULED IT. `grep -i
 * currency docs/architecture/API_CONTRACT.md docs/design/DESIGN_SYSTEM.md`
 * returns nothing: there is no currency field on any response and no ruled
 * display locale. So this renders the digits and NOT a symbol, because a
 * currency symbol the corpus never chose would be a claim invented in the
 * client, which is FM-M4-05's shape pointed at a unit instead of at a rule.
 * The symbol and the locale belong with the design system.
 */
function group(digits: bigint): string {
  const text = digits.toString();
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (i > 0 && (text.length - i) % 3 === 0) out += ',';
    out += text[i];
  }
  return out;
}

/**
 * Integer cents to a fixed two-place decimal string. Exact, and never rounded.
 *
 * The sign is rendered because a negative floor distance is a real state: a
 * breached account's balance is below its floor, and a display that dropped the
 * minus sign there would show the trader the magnitude of a loss as though it
 * were headroom.
 *
 * @example formatCents(150000)  === '1,500.00'
 * @example formatCents(-4207)   === '-42.07'
 * @example formatCents(5)       === '0.05'
 */
export function formatCents(value: number | bigint): string {
  const cents = exactInteger(value, 'cents');
  const negative = cents < 0n;
  const magnitude = negative ? -cents : cents;
  const whole = magnitude / 100n;
  const remainder = magnitude % 100n;
  return `${negative ? '-' : ''}${group(whole)}.${remainder.toString().padStart(2, '0')}`;
}

/**
 * Basis points to a percentage string. One hundredth of one percent, exactly.
 *
 * The consistency meter's share and its limit are both `_bp` (M04 section 3.3,
 * and `best_day_share_bp` / `max_bp` on the eligibility response), so this is
 * the meter's only renderer.
 *
 * @example formatBasisPoints(3400) === '34.00%'
 * @example formatBasisPoints(50)   === '0.50%'
 */
export function formatBasisPoints(value: number | bigint): string {
  const bp = exactInteger(value, 'basis points');
  const negative = bp < 0n;
  const magnitude = negative ? -bp : bp;
  const whole = magnitude / 100n;
  const remainder = magnitude % 100n;
  return `${negative ? '-' : ''}${group(whole)}.${remainder.toString().padStart(2, '0')}%`;
}

/**
 * A money field that may legitimately be absent, rendered as an absence.
 *
 * `profit_target_cents`, `buffer_cents` and `profit_needed_to_dilute_cents` are
 * all `number | null` on the contract, and null means "this gate does not apply
 * to this account" rather than "zero". Rendering a null as `0.00` would state a
 * fact the server did not send, and it would do it in the one place where zero
 * is the most consequential possible number: a `profit_needed_to_dilute_cents`
 * of `0.00` reads as "nothing further is needed", which is the opposite of "the
 * consistency gate was not evaluated for you" (INV-M4-05).
 */
export function formatOptionalCents(value: number | bigint | null): string | null {
  return value === null ? null : formatCents(value);
}

/** `formatOptionalCents` for basis points. Same reasoning, same absence. */
export function formatOptionalBasisPoints(value: number | bigint | null): string | null {
  return value === null ? null : formatBasisPoints(value);
}
