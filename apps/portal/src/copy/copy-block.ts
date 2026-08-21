// =============================================================================
// apps/portal/src/copy/copy-block.ts
// =============================================================================
// THE PORTAL CANNOT AUTHOR A RULE SENTENCE, AND THIS FILE IS WHY IT CANNOT.
//
// INV-M4-08: "Every rule sentence on any screen comes from `copy_blocks` on the
// account's pinned plan version | No rule text is authored in the portal. This
// is the mechanism behind constitution 0.4's 'marketing must equal
// implementation to the tick'."
//
// FM-M4-05's detection column asks for "a build-time check that no rule-shaped
// string literal exists in portal source". A check like that has to decide what
// "rule-shaped" means, and every version of that decision is a heuristic
// somebody argues with. THE TYPE SYSTEM CAN DECIDE IT INSTEAD. `CopyBlock` is a
// branded string with a private brand, so the only expression in this codebase
// whose type is `CopyBlock` is a call to `copyBlock()` below, and a view model
// that declares a field as `CopyBlock` cannot be constructed from a literal.
// The sentence has to have come out of the pinned plan version, or the file
// does not compile.
//
// THE BRAND IS THE IDIOM INV-M4-02 AND INV-M4-11 ALREADY USE, one level down.
// Those two make a required PROP the enforcement ("a component that renders a
// balance without `as_of_trading_day` does not compile"). This makes a required
// PROVENANCE the enforcement, which is the same move applied to the string
// instead of to its neighbours.
//
// WHAT IT DOES NOT DO. It cannot stop a builder typing a rule sentence into a
// field typed `string`, and there are legitimate `string` fields on these view
// models (an account id, a trading day, a formatted amount). So the brand
// raises the cost of the mistake from "nobody noticed" to "somebody changed a
// type to allow it", which is a diff a reviewer reads. FM-M4-05's build-time
// check is still owed and this is not it.
//
// `plan_versions.copy_blocks` is `jsonb NOT NULL DEFAULT '{}'` in
// packages/db/migrations/0004_catalog.sql:84, commented "Published rule text
// keyed by rule path, so marketing copy and engine parameters ship together. A
// version cannot be published with copy that describes a different number."

declare const COPY_BLOCK_BRAND: unique symbol;

/**
 * A sentence that came out of `plan_versions.copy_blocks`, and could not have
 * come from anywhere else.
 *
 * It is a `string` at runtime and carries no wrapper, so it renders wherever a
 * string renders and costs nothing at the point of display. The brand exists
 * only during type checking, which is where the mistake it prevents is made.
 */
export type CopyBlock = string & { readonly [COPY_BLOCK_BRAND]: 'plan_versions.copy_blocks' };

/**
 * The account's PINNED plan version and its published rule text.
 *
 * Pinned, never current: M04 section 4's obligation against
 * `GET /plans/:id/versions/:v` is "the rules page for an account reads the
 * pinned version, not the current one", and 1.2's boundary table says the
 * portal does not know a plan's rules at all. Carrying the version number
 * beside the blocks is what lets a missing key name the version it was missing
 * from, which is the difference between a bug report and a support ticket.
 */
export type PinnedPlanCopy = {
  readonly plan_id: string;
  readonly version: number;

  /** Keyed by rule path, exactly as the column stores it. */
  readonly blocks: Readonly<Record<string, string>>;
};

/** A rule sentence the pinned plan version does not carry. FM-M4-05's moment. */
export class MissingCopyBlockError extends Error {
  constructor(
    readonly plan_id: string,
    readonly version: number,
    readonly key: string,
  ) {
    super(
      `plan ${plan_id} version ${version} has no copy_blocks entry for "${key}". ` +
        'The portal may not substitute a sentence of its own (INV-M4-08): the fix is ' +
        'to publish the copy on the plan version, where it ships with the rules it ' +
        'describes (FM-M4-05).',
    );
    this.name = 'MissingCopyBlockError';
  }
}

/**
 * Read one published rule sentence, or fail loudly.
 *
 * IT THROWS RATHER THAN RETURNING NULL, AND THAT IS THE DESIGN. A null would be
 * rendered as an empty space by every caller that forgot to handle it, and an
 * empty space where a rule sentence belongs is the failure INV-M4-08 exists to
 * prevent, arrived at by omission instead of by invention. DEP-M4-02 says the
 * same thing from the other side: "copy_blocks exists for every rule on every
 * published plan version | M3 publish gate", so a missing key is a publish-gate
 * defect upstream, and the portal's job is to make it visible rather than to
 * paper over it.
 *
 * A BLANK STRING IS TREATED AS MISSING, on 0042's `reason_detail` precedent:
 * `NOT NULL` plus a non-blank check, because a column that accepts a space is a
 * column that will hold one.
 */
export function copyBlock(pinned: PinnedPlanCopy, key: string): CopyBlock {
  const value = Object.prototype.hasOwnProperty.call(pinned.blocks, key)
    ? pinned.blocks[key]
    : undefined;
  if (value === undefined || value.trim() === '') {
    throw new MissingCopyBlockError(pinned.plan_id, pinned.version, key);
  }
  return value as CopyBlock;
}

/**
 * The keys this application reads, named in one place.
 *
 * NAMING THEM HERE IS NOT A CONVENIENCE. M04 section 3.4 says the funded-reset
 * sentence must appear in three places and this module owns two of them, and
 * section 3.4's last line is "the wording is a `copy_blocks` entry, not portal
 * source, so it ships with the plan version it describes". A key spelled two
 * ways in two components is a sentence that renders on one screen and throws on
 * the other, and the placement obligation is then half met with nothing to
 * show for it.
 *
 * THE KEY STRINGS ARE THIS SESSION'S AND ARE NOT TRANSCRIBED FROM ANYWHERE.
 * `grep -r copy_blocks docs/` returns prose and no key vocabulary: the corpus
 * says what must be published and never what the keys are called. So these are
 * proposals, they are collected here rather than scattered so that reconciling
 * them against M3's publish gate is a diff on one constant, and the session log
 * records that the vocabulary is owed.
 */
export const COPY_KEYS = {
  /**
   * M04 section 3.4 placement 2: the funded phase starts at the account size
   * and eval profit is not carried (R-31), stated on the eval progress card
   * "because that is the exact moment a trader is forming the belief that the
   * number they are watching is money they will keep".
   */
  funded_reset: 'eval.funded_reset',
} as const;
