// =============================================================================
// packages/db/src/scope.ts
// =============================================================================
// THE REGISTRY IS DECLARED AND NEVER DERIVED, and that is the whole design.
//
// A mechanical "walk the foreign keys until something carries identity_id"
// derivation returns 25 of the 111 tables on this tree, and it is WRONG ON AT
// LEAST THREE of them:
//
//   treasury_balances.recorded_by -> users   scopes THE FIRM'S TREASURY to
//                                            whichever admin typed the
//                                            attestation.
//   impersonation_sessions.admin_user_id     reaches the ADMIN'S identity, not
//                                            the subject's.
//   sessions.device_fingerprint_id           reaches whoever SHARES A DEVICE.
//     -> identity_signals
//
// Auto-derivation here is not conservative, it is confidently wrong: each of
// those three produces a scoped query that RETURNS ROWS, for the wrong identity,
// with no error anywhere. So every rule below is written by a person and every
// one carries its reason.
//
// TOTALITY IS A COMPILE ERROR, NOT A TEST. `SCOPE_RULES` is declared against a
// mapped type over `TableKey`, so a table added to `schema.ts` without a rule
// here does not compile, and a rule naming a table that does not exist does not
// compile either. The unregistered table is unreachable through either accessor
// rather than reachable and unscoped.

import {
  accounts,
  certificates,
  contentDocuments,
  couponRedemptions,
  coupons,
  dailyMarks,
  identities,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
  liabilitySnapshots,
  midHealth,
  pageRevalidations,
  planVersionSizes,
  planVersions,
  proofLinks,
  pspWebhookEvents,
  publishedStatistics,
  purchases,
  reviewRequests,
  ruleStates,
  sessions,
  statisticDefinitions,
  treasuryBalances,
  users,
} from './schema.js';

/**
 * The registry. `TableKey` is exactly `keyof` this object, by construction.
 *
 * TWENTY-FIVE OF 111, AND THE SET IS NOT A PHASE'S. ADR-092 makes the owner the
 * TABLE: a table is registered ONCE by the first session that needs it, the
 * registration is never re-argued, and a session computes its own slice from
 * `TABLE_KEYS` on the tree it opened rather than from a roster.
 */
export const TABLES = {
  identities,
  users,
  sessions,
  planVersions,
  planVersionSizes,
  purchases,
  accounts,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
  treasuryBalances,
  liabilitySnapshots,
  dailyMarks,
  ruleStates,
  contentDocuments,
  pageRevalidations,
  certificates,
  statisticDefinitions,
  publishedStatistics,
  proofLinks,
  reviewRequests,
  coupons,
  couponRedemptions,
  pspWebhookEvents,
  midHealth,
} as const;

export type TableKey = keyof typeof TABLES;

/**
 * The four classes, partitioning one question: HOW DOES A ROW REACH AN IDENTITY?
 *
 * The question has exactly these four answers on this schema, which is what
 * makes the vocabulary closed rather than merely short.
 */
export type ScopeClass = 'root' | 'owned' | 'derived' | 'firm';

export interface RootRule {
  readonly class: 'root';
  /** The column that IS the identity. */
  readonly column: 'id';
  readonly why: string;
}

export interface OwnedRule {
  readonly class: 'owned';
  /** The identity column carried on the row itself. */
  readonly column: string;
  /** True when the column is nullable, which is how firm rows are excluded. */
  readonly nullable: boolean;
  readonly why: string;
}

export interface DerivedRule {
  readonly class: 'derived';
  /** The table this row reaches an identity THROUGH. */
  readonly via: TableKey;
  /** This row's column holding `via`'s key. */
  readonly localColumn: string;
  /** `via`'s column that `localColumn` points at. */
  readonly foreignColumn: string;
  /**
   * `hop` is a single-valued reference and a join is safe.
   * `semi-join` means the relationship is one-to-MANY in the direction being
   * traversed, so a join MULTIPLIES ROWS and the predicate must be an EXISTS.
   */
  readonly traversal: 'hop' | 'semi-join';
  readonly why: string;
}

export interface FirmRule {
  readonly class: 'firm';
  /** Why no identity owns these rows. A reason, never a placeholder. */
  readonly why: string;
}

export type ScopeRule = RootRule | OwnedRule | DerivedRule | FirmRule;

/**
 * THE REGISTRY. Total over `TableKey` by the `satisfies` clause below: omit a
 * table and this file does not compile; name one that is not in `TABLES` and it
 * does not compile either.
 */
export const SCOPE_RULES = {
  identities: {
    class: 'root',
    column: 'id',
    why: 'The row IS the identity. `identity_merges` repoints ownership, so `identities.id` is the hard-merged grain and the only correct root.',
  },

  users: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: '`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0002_identity.sql). A USER IS A LOGIN AND AN IDENTITY IS THE PERSON, and ADR-041 is why they are two tables: an identity may hold MORE THAN ONE user, so scoping this table by its own `id` would return a strict subset of the person and scoping by `identity_id` returns all of their logins.',
  },

  sessions: {
    class: 'derived',
    via: 'users',
    localColumn: 'user_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "THE ROW REACHES AN IDENTITY THROUGH `users` AND THROUGH NOTHING ELSE, and the other candidate column is this file's own named trap: `device_fingerprint_id` references `identity_signals`, so a derivation through it reaches WHOEVER SHARES A DEVICE rather than whoever logged in. `user_id uuid NOT NULL REFERENCES users(id)` is single-valued, so the hop cannot multiply rows. A session belongs to a LOGIN, so an identity holding two logins has sessions under both and a scoped read returns both, which is what the trader-visible active-sessions list (SD-M4-03) is for.",
  },

  planVersions: {
    class: 'firm',
    why: 'The published product catalogue. There is no identity column and there is no correct one: EVERY identity is sold the same plan version, and the link runs the other way -- `accounts.plan_version_id` names the version an account was bought under -- so ownership flows FROM the catalogue rather than to it. The public rules pages read it unscoped and that is not a leak: a published plan version is the contract the firm offers in public.',
  },

  planVersionSizes: {
    class: 'firm',
    why: "The price and risk grid of a published plan version, one row per size. There is no identity column and there is no correct one, for `plan_versions`' reason exactly one hop out: EVERY identity is sold the same grid, and an account names the version it was bought under rather than the grid naming a buyer. A `derived` rule through `plan_versions` is not a milder mistake, it THROWS: `scopePredicate` recurses into the via table, the via table is `firm`, and a derivation chain terminates at `owned` or at `root` or it does not terminate. A firm parent makes the whole chain firm rather than making the child derivable.",
  },

  purchases: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0006_commerce.sql). `user_id` is also present, is also NOT NULL, and is NOT the scope: a user is a login and an identity is the person (ADR-041), and this table's own DDL says the two are recorded separately because THEY CAN DIFFER AFTER A MERGE and the difference is evidence. Scoping by the login would therefore return a strict subset of a merged person's purchase history, silently, which is exactly the reading `accounts` refuses for the same pair of columns.",
  },

  accounts: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: '`identity_id uuid NOT NULL REFERENCES identities(id)` on the row (0007_accounts.sql). `user_id` is also present and is NOT the scope: a user is a login and an identity is the person, and ADR-041 is why they are two columns.',
  },

  ledgerAccounts: {
    class: 'owned',
    column: 'identity_id',
    nullable: true,
    why: "NULLABLE ON PURPOSE. `scope` is CHECKed to ('firm','identity') and the table's own constraint ties it to `identity_id`: an identity row has one, a firm row has NULL. Filtering `identity_id = $1` excludes `firm_treasury`, `psp_clearing`, `fees_revenue` and `reserve` WITHOUT a second predicate, because SQL NULL never equals anything.",
  },

  ledgerEntries: {
    class: 'derived',
    via: 'ledgerAccounts',
    localColumn: 'ledger_account_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: 'One declared hop to `ledger_accounts`, which carries the identity. `ledger_account_id` is NOT NULL and single-valued, so a join cannot multiply rows.',
  },

  ledgerTransactions: {
    class: 'derived',
    via: 'ledgerEntries',
    localColumn: 'id',
    foreignColumn: 'transaction_id',
    traversal: 'semi-join',
    why: 'THE TABLE CARRIES NO IDENTITY COLUMN AT ALL and reaches one only through its entries -- of which it has MORE THAN ONE. Double-entry means a trader leg and a firm leg on the same transaction, so a plain join through `ledger_entries` returns the transaction ONCE PER MATCHING ENTRY. The predicate is an EXISTS for that reason, and the reason is arithmetic rather than style.',
  },

  treasuryBalances: {
    class: 'firm',
    why: "Merit's own bank and PSP balances. No identity owns them. THE TRAP IS `recorded_by`, which references `users`: a derived rule would scope the firm's treasury to whichever admin typed the attestation. That column records WHO ASSERTED THE BALANCE and says nothing about whose money it is.",
  },

  liabilitySnapshots: {
    class: 'firm',
    why: "EC-095's three named numbers, aggregated across every identity. There is no identity column and there is no correct one: a per-identity slice of a firm-wide liability total is not a smaller version of it.",
  },

  dailyMarks: {
    class: 'derived',
    via: 'accounts',
    localColumn: 'account_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT` (0014_marks.sql), and `accounts` carries the identity. NOT NULL and single-valued, so a join cannot multiply rows. The grain is ONE ROW PER ACCOUNT PER TRADING DAY and a correction is a NEW row pointing the old one at it rather than an UPDATE, so a scoped read returns the superseded rows as well as the current one -- which is correct: what Merit believed on the day is the trader's own evidence, and `superseded_by` reaches only other rows of this same table, so the supersession chain never leaves the account it belongs to.",
  },

  ruleStates: {
    class: 'derived',
    via: 'accounts',
    localColumn: 'account_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT` (0015_rule_states.sql), and `accounts` carries the identity. NOT NULL and single-valued, so a join cannot multiply rows. The grain is ONE ROW PER ACCOUNT PER TRADING DAY: the day is the grain and the tenancy is the account's, so this is `accounts`' rule exactly one hop out and the day contributes nothing to who may read it.",
  },

  contentDocuments: {
    class: 'firm',
    why: 'The published pages, posts, FAQs and legal texts. There is no identity column and there is no correct one: a legal document is the SAME document for every reader, and an identity that ACCEPTED one is recorded on the acceptance rather than on the text. Supersession rather than update is the discipline here, so the row a trader accepted is still readable after it stops being current, and `checksum` is what makes that a provable artifact (SD-M9-02).',
  },

  pageRevalidations: {
    class: 'firm',
    why: 'A cache-invalidation log for the public surface: one row per request to re-render a set of public paths. No identity owns a re-render of a page every reader sees. `reference_id` is deliberately untyped in the DDL -- it names whatever the `trigger` was about, a plan version or a content document -- so it declares no foreign key and there is nothing a derived rule could traverse even if the rows belonged to somebody.',
  },

  certificates: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0020_public_surface.sql). THE ROW CARRIES TWO PATHS TO AN IDENTITY AND THE DIRECT COLUMN IS THE RULE: `account_id` reaches the same identity one hop out through `accounts`, and a derived rule through it would make this table's tenancy depend on a join rather than on a column the database itself declares against `identities(id)`. `code` is the public verification token and is DISTINCT from `id` so it can be rotated after an incident (SD-M11-01); a revoked or deferred certificate is still this identity's row, which is why revocation is a column here and never a deletion.",
  },

  statisticDefinitions: {
    class: 'firm',
    why: 'WHAT A PUBLISHED STATISTIC IS: the two specs, the window, the exclusions, the declared measure set and the methodology page. There is no identity column and there is no correct one -- a definition is the method rather than a number about anybody, and it is the same method for every reader. Rows are versioned and superseded, never edited in place, so the definition a figure was published under stays readable after it stops being current.',
  },

  publishedStatistics: {
    class: 'firm',
    why: "An aggregate over EVERY identity, published on a public page. There is no identity column and there is no correct one, which is `liability_snapshots`' reason on a different surface: a per-identity slice of a firm-wide pass rate is not a smaller version of it, it is a different statistic with a sample size of one. A suppressed row EXISTS rather than being omitted, so the suppression is visible rather than a gap in a series, and a correction is a new row pointing at what it restates.",
  },

  proofLinks: {
    class: 'firm',
    why: 'The published list of things a reader can verify for themselves: chain addresses, third-party trackers, the certificate verification page. No identity owns a link Merit publishes about itself. `scope_note` is NOT NULL because a proof link with no stated scope is a claim the reader gets to interpret (SD-M12-04), and that is a property of the published row rather than of any reader.',
  },

  reviewRequests: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0021_transparency.sql). One row per time Merit asked a person for a public review, and the row is ABOUT THAT PERSON. `trigger_class` carries 'unfavorable' as a first-class member and a row that was never sent still exists carrying `suppressed_reason` (SD-M12-03), so the rows a review-farming design would omit are the ones this table is shaped to keep -- and they are the asked person's rows exactly as the sent ones are.",
  },

  coupons: {
    class: 'firm',
    why: "The firm's discount codes. There is no identity column and there is no correct one: a coupon is an OFFER MERIT MAKES, and the thing a buyer holds is the REDEMPTION, which is `coupon_redemptions` and carries `identity_id NOT NULL`. THE TRAP IS `affiliate_id`: it references `affiliates`, so a derived rule through it would scope a launch code to whoever is CREDITED for it, which says who gets paid when the code is used and nothing about whose row it is -- and the column is NULLABLE, so most codes name no affiliate and would reach nobody at all. `redemption_count` and `max_redemptions` are counters over every identity, so a per-identity slice of this row is not a smaller version of it.",
  },

  couponRedemptions: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: '`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0006_commerce.sql), and the DDL states why the column is the identity rather than the email: LIMITS ARE PER IDENTITY, because an email limit is a limit on typing and not on people. `purchase_id` is also present and is NOT the scope: it is NULLABLE, null while the claim is HELD and the payment is in flight, so a derivation through `purchases` would return only the redemptions that were paid for -- and the rows it would drop are exactly the claim-and-abandon ones this table keeps on purpose, since a release writes `released_at` rather than deleting the row.',
  },

  pspWebhookEvents: {
    class: 'firm',
    why: "Raw inbound payment events, kept SEPARATELY from `events` because these are THIRD-PARTY ASSERTIONS rather than facts Merit generated (0006_commerce.sql), and the distinction matters the day one of them turns out to be wrong. No identity owns a processor's statement about a payment; the buyer's row is `purchases`. THE TRAP IS `purchase_id`, AND IT IS NULLABLE AND WRITTEN LATE: the handler binds it during processing, so a derived rule would make a row's tenancy a function of whether a job has run yet, the same event belonging to nobody while it is `out_of_order_deferred` and to somebody once it is `applied`. A `rejected_signature` row is stored precisely because its signature did NOT verify, so it belongs to nobody permanently. A class that answers 'whose row is this' differently before and after a re-drive is not an answer.",
  },

  midHealth: {
    class: 'firm',
    why: "SD-M3-03. One row per PSP per window: attempts, declines, chargebacks, and the two basis-point rates the failover decision is made from. There is no identity column and there is no correct one -- the row is about a PROCESSOR, and its counters are aggregates over every identity's card volume, so a per-identity slice of a decline rate is not a smaller version of it. The denominator rule the column names carry (both rates against CARD volume, never total volume, because wallet purchases carry no chargeback exposure) is a property of the published row rather than of any reader.",
  },
} as const satisfies { readonly [K in TableKey]: ScopeRule };

/** Tables that belong to no identity. The scoped accessor REFUSES these. */
export type FirmTableKey = {
  [K in TableKey]: (typeof SCOPE_RULES)[K]['class'] extends 'firm' ? K : never;
}[TableKey];

/**
 * Tables the scoped accessor will serve.
 *
 * A `firm` table passed to `scopedDb` is a COMPILE ERROR because it is not a
 * member of this type. That refusal is watched failing to compile in
 * `scripts/ci/falsify-ci.mjs` at stage CI-01: vitest cannot see a type error at
 * all, because it runs transpiled code and the error is gone by then.
 */
export type ScopedTableKey = Exclude<TableKey, FirmTableKey>;

/** Every table in the registry. Used by the totality assertion in the suite. */
export const TABLE_KEYS = Object.keys(TABLES) as readonly TableKey[];
