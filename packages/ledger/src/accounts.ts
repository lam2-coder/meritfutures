// =============================================================================
// packages/ledger/src/accounts.ts
// =============================================================================
// THE EIGHT v1 CLASSES, AND WHICH OF THEM BELONG TO A PERSON.
//
// The migration set declares the vocabulary twice -- once as
// `ledger_accounts_code_is_declared` and once inside `LEDGER-C2`'s trigger body
// -- and it says in its own comment why: "a class that appears first in a
// migration is a class nobody defined", after a first draft of ADR-027 invented
// `firm_payable` and reached a committed document. This file is a THIRD
// statement of that list and it earns its place only because it is CHECKED
// against both of the others: `accounts.test.ts` reads the CHECK constraint and
// the trigger's class list OUT OF THE MIGRATION THAT INSTALLS EACH IN FORCE and
// asserts all three sets are equal. A third hand-kept copy would be ADR-092
// section 5's two-statements-of-one-fact hazard with an extra statement.
//
// `0009` AND `0027` ARE NO LONGER THOSE MIGRATIONS AND NAMING THEM HERE WOULD BE
// WRONG. `0056` supersedes both, by DROP and re-ADD for the CHECK and by
// `CREATE OR REPLACE FUNCTION` for the trigger body, because a merged migration
// is never edited. A reader who wants the vocabulary in force reads the LAST
// migration that declares it, which is what `accounts.test.ts` now does.
//
// WHAT THIS FILE STATES THAT NO MIGRATION DOES is which codes are firm-scoped
// and which are per identity. The DDL constrains `scope` to `('firm',
// 'identity')` and ties it to `identity_id` in both directions, and it never
// ties either to `code`: `ledger_accounts` would accept a firm-scoped
// `trader_wallet` row. The fact lives in `0009`'s comments -- "per identity.
// What the engine says is drawable", "per identity. SD-M5-07" -- and in the two
// PARTIAL UNIQUE INDEXES, which is prose and an index rather than a constraint.
// ADR-101's rule for when a field earns its place is exactly this shape: a fact
// absent from the primary source in checkable form gets stated, and one present
// in it does not.

/** The whole permitted vocabulary. `0009`'s CHECK and `0027`'s LEDGER-C2. */
export type LedgerAccountCode =
  | 'firm_treasury'
  | 'psp_clearing'
  | 'fees_revenue'
  | 'reserve'
  | 'trader_withdrawable'
  | 'trader_wallet'
  | 'promotional_credit'
  | 'withdrawals_in_flight';

/**
 * Whose position each class is.
 *
 * `trader_withdrawable` and `trader_wallet` are TWO DISTINCT per-identity
 * positions and neither supersedes the other, which `0009` records as the
 * ruling that was made, folded, committed and REVERSED in one session: a payout
 * approval reduces withdrawable by `approved_cents` while the wallet payable
 * moves by `trader_cents`, and `approved_cents != trader_cents`. Collapsing them
 * balances perfectly and is wrong, which is what `LEDGER-C1` exists to catch.
 *
 * `promotional_credit` is per identity and is NEVER WITHDRAWABLE
 * (`OQ-FREEZE-01`, which overruled ADR-025's literal wording).
 *
 * `withdrawals_in_flight` IS FIRM-SCOPED AND IT IS THE ONLY FIRM-SCOPED
 * `liability` IN THE CHART (ADR-187, `0056`). It carries the external leg's
 * in-flight obligation: `LT-06` credits it when a wallet withdrawal is approved
 * and the trader's wallet claim is extinguished, and `LT-07` debits it when the
 * cash leaves, so it stands at a credit balance for exactly the interval
 * STATE_MACHINES section 3.2 draws as `transferring`. It is FIRM-scoped because
 * ADR-174 clause 3 rules that `LT-07` stays firm-only; no identity opens a
 * position in it and `0054`'s provisioning trigger does not write one.
 */
export const LEDGER_ACCOUNT_SCOPE = {
  firm_treasury: 'firm',
  psp_clearing: 'firm',
  fees_revenue: 'firm',
  reserve: 'firm',
  trader_withdrawable: 'identity',
  trader_wallet: 'identity',
  promotional_credit: 'identity',
  withdrawals_in_flight: 'firm',
} as const satisfies Readonly<Record<LedgerAccountCode, 'firm' | 'identity'>>;

/** Every declared code, in the order `0009` declares them. */
export const LEDGER_ACCOUNT_CODES = Object.keys(
  LEDGER_ACCOUNT_SCOPE,
) as readonly LedgerAccountCode[];

/** A code whose account belongs to nobody. Passing one to `identityAccount` is a compile error. */
export type FirmAccountCode = {
  [K in LedgerAccountCode]: (typeof LEDGER_ACCOUNT_SCOPE)[K] extends 'firm' ? K : never;
}[LedgerAccountCode];

/** A code whose account belongs to one person. Passing one to `firmAccount` is a compile error. */
export type IdentityAccountCode = {
  [K in LedgerAccountCode]: (typeof LEDGER_ACCOUNT_SCOPE)[K] extends 'identity' ? K : never;
}[LedgerAccountCode];

/** The identity a per-identity account belongs to. A uuid, as the DDL declares it. */
export type IdentityId = string;

/**
 * ONE SIDE OF A TRANSFER, NAMED THE WAY THE CHART NAMES IT.
 *
 * A reference is a `code` plus, for the three per-identity classes, the person.
 * It is NOT a `ledger_accounts.id`, and that is deliberate: a caller holding a
 * uuid has already resolved the chart somewhere this library cannot see, and
 * "which account is this" is the question `LEDGER-C2` exists because somebody
 * got wrong. Resolution happens in one place (`chart.ts`) against rows read
 * from the database.
 */
export type AccountRef =
  | { readonly scope: 'firm'; readonly code: FirmAccountCode }
  | {
      readonly scope: 'identity';
      readonly code: IdentityAccountCode;
      readonly identityId: IdentityId;
    };

/** A firm-scoped reference. `identity_id` is NULL on the row and the DDL requires it to be. */
export function firmAccount(code: FirmAccountCode): AccountRef {
  return { scope: 'firm', code };
}

/** A per-identity reference. The DDL requires `identity_id IS NOT NULL` on these. */
export function identityAccount(code: IdentityAccountCode, identityId: IdentityId): AccountRef {
  if (identityId.length === 0) {
    throw new Error(
      `an identity-scoped ${code} account needs an identity, and "" is not one. ` +
        'ledger_accounts_scope_identity CHECKs that the column is NOT NULL on these rows.',
    );
  }
  return { scope: 'identity', code, identityId };
}

/**
 * THE KEY THE TWO PARTIAL UNIQUE INDEXES MAKE UNIQUE, as one string.
 *
 * `ledger_accounts_firm_code_uq` is `(code) WHERE scope = 'firm'` and
 * `ledger_accounts_identity_code_uq` is `(code, identity_id) WHERE scope =
 * 'identity'`, so this is the database's own notion of "the same account"
 * rather than a second one. `LEDGER-C1` is stated over it, and so is the
 * chart's index.
 *
 * THE SCOPE WORD IS PART OF THE KEY rather than implied by the code, because
 * the codes are partitioned by this file and not by the DDL: were a firm-scoped
 * `trader_wallet` row ever to exist -- which `ledger_accounts` would accept --
 * it must not collide with the per-identity accounts of the same class.
 */
export function accountKey(ref: AccountRef): string {
  return ref.scope === 'firm' ? `firm ${ref.code}` : `identity ${ref.code} ${ref.identityId}`;
}

/** The identity a reference names, or `undefined` for a firm account. */
export function identityOf(ref: AccountRef): IdentityId | undefined {
  return ref.scope === 'identity' ? ref.identityId : undefined;
}
