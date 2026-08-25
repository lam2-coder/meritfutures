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
  accountAdjustments,
  accounts,
  adminActions,
  affiliateClicks,
  affiliateCreatives,
  affiliates,
  alarmSuppressions,
  certificates,
  contactChannels,
  contentDocuments,
  correlationGroups,
  couponRedemptions,
  coupons,
  dailyMarks,
  detectorDefinitions,
  detectorRuns,
  dualControlApprovals,
  economicCalendar,
  economicCalendarLoads,
  evidencePacks,
  identities,
  identityPhones,
  identityRestrictionEpisodes,
  identitySignals,
  impersonationPageViews,
  impersonationSessions,
  kycFunnelEvents,
  kycVerifications,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
  liabilitySnapshots,
  midHealth,
  notificationKinds,
  notificationPreferences,
  notifications,
  offerExperiments,
  offers,
  otpSendBudget,
  pageRevalidations,
  phoneChangeRequests,
  planBreakerState,
  planVersions,
  planVersionSizes,
  priceFloors,
  promotionalCreditGrants,
  proofLinks,
  pspWebhookEvents,
  publishedStatistics,
  purchases,
  reportDeliveries,
  reportSchedules,
  reviewRequests,
  riskFlags,
  ruleStates,
  sanctionsScreenings,
  sessions,
  statisticDefinitions,
  treasuryBalances,
  users,
} from './schema.js';

/**
 * The registry. `TableKey` is exactly `keyof` this object, by construction.
 *
 * SIXTY OF 111, AND THE SET IS NOT A PHASE'S. ADR-092 makes the owner the
 * TABLE: a table is registered ONCE by the first session that needs it, the
 * registration is never re-argued, and a session computes its own slice from
 * `TABLE_KEYS` on the tree it opened rather than from a roster.
 *
 * `identity_links` IS DELIBERATELY ABSENT AND ITS ABSENCE IS A RECORD RATHER
 * THAN A GAP. It carries TWO identity columns -- `identity_a` and `identity_b`,
 * both `uuid NOT NULL REFERENCES identities(id)`, under a canonical-order CHECK
 * `identity_a < identity_b` -- against an `owned` rule that names ONE column.
 * Either choice returns a strict subset of a person's own edges, selected by
 * UUID ordering, which is a wrong answer that returns rows rather than an error.
 * ADR-092 section 9 names this as a PER-TABLE ruling and takes neither column,
 * and a transcription rules nothing, so the table is left unregistered:
 * unregistered is unreachable, and unreachable is safe.
 *
 * `attributions` IS ABSENT FOR THE SAME REASON AND IT IS THE SIBLING ADR-092
 * SECTION 9 NAMES BESIDE `identity_links`. It carries `buyer_identity_id` AND
 * `affiliate_identity_id`, both `uuid NOT NULL REFERENCES identities(id) ON
 * DELETE RESTRICT` (0012_disputes_and_affiliate_settlement.sql, SD-M8-05), and
 * both are stored rather than joined precisely BECAUSE they are two different
 * people: the row is a statement about the pair at the moment of purchase, and
 * `attributions_literal_self_deal_is_void` exists to refuse the case where they
 * are one. An `owned` rule names ONE column. Naming the buyer hides the
 * referral from the affiliate who earned it; naming the affiliate returns a
 * buyer's own purchase attribution to somebody else. Neither is an error, both
 * return rows, and the second is the BOLA failure ADR-008 scoped the accessor
 * to bound. ADR-092 takes neither and a transcription rules nothing.
 *
 * `affiliate_commissions` IS ABSENT AS A CONSEQUENCE RATHER THAN AS A JUDGMENT,
 * and the type checker is what says so. Its only path to an identity is
 * `attribution_id uuid NOT NULL REFERENCES attributions(id)`; `paid_in_statement_id`
 * reaches `affiliate_statements`, which ADR-092 section 9 records as belonging
 * to no module plan, and no other column reaches a person at all. `DerivedRule.via`
 * is `TableKey`, so a rule through `attributions` cannot be written while
 * `attributions` is unregistered. This is ADR-092's "a session cannot know its
 * own slice size before it runs" in the direction ADR-094 section 6 did not
 * name: totality forced a table OUT of a slice rather than into one.
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
  identitySignals,
  detectorDefinitions,
  detectorRuns,
  riskFlags,
  correlationGroups,
  coupons,
  couponRedemptions,
  pspWebhookEvents,
  midHealth,
  contactChannels,
  notificationKinds,
  notifications,
  notificationPreferences,
  otpSendBudget,
  identityPhones,
  kycFunnelEvents,
  kycVerifications,
  phoneChangeRequests,
  sanctionsScreenings,
  accountAdjustments,
  adminActions,
  alarmSuppressions,
  dualControlApprovals,
  economicCalendar,
  economicCalendarLoads,
  evidencePacks,
  identityRestrictionEpisodes,
  impersonationPageViews,
  impersonationSessions,
  planBreakerState,
  reportDeliveries,
  reportSchedules,
  affiliates,
  affiliateCreatives,
  affiliateClicks,
  offerExperiments,
  priceFloors,
  offers,
  promotionalCreditGrants,
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

  identitySignals: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0002_identity.sql). THE ENTITY GRAPH'S NODES, AND A SHARED VALUE PRODUCES TWO ROWS RATHER THAN ONE SHARED ROW: two identities behind one coffee-shop IP each get their own row carrying their own `identity_id`, so the `owned` rule returns each of them exactly their own observations and never the other's. THIS TABLE IS THE OTHER END OF THIS FILE'S NAMED TRAP AND IS NOT THE TRAP: `sessions.device_fingerprint_id` references it, so deriving SESSIONS through it reaches whoever shares a device, which is a defect in a rule for `sessions` and says nothing about this table, whose own identity column is direct, single and NOT NULL. `value_hash` is `bytea` because the observation is stored as a digest and never raw (INV-M7-08), which is why a row is evidence of a MATCH rather than a copy of the value that matched.",
  },

  detectorDefinitions: {
    class: 'firm',
    why: "A DETECTOR'S PARAMETERS, VERSIONED, WITH AN EFFECTIVE DATE. There is no identity column and there is no correct one: a threshold is tuned about the whole population and is the same threshold for every trader, and the link runs the other way -- a `detector_runs` row names the detector and version it ran under. `is_sensitive` defaults to true because a leaked parameter tells the adversary exactly where the line is (SD-M7-03), which is a reason this table must not be trader-readable at all rather than a reason it belongs to some trader.",
  },

  detectorRuns: {
    class: 'firm',
    why: "ONE ROW PER DETECTOR PER NIGHT, OVER THE WHOLE POPULATION. There is no identity column and there is no correct one: a run scans every account, and the identities it touched are its OUTPUT -- recorded on `risk_flags`, which carries its own `identity_id` -- rather than its owner. `synthetic_expected` and `synthetic_found` make a silent detector a FAILURE STATE rather than a clean night (INV-M7-07, SD-M7-01), and that is a property of the run and of the firm's own detection health, which no trader owns and none may read.",
  },

  riskFlags: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0008_risk.sql). A FLAG IS ABOUT A PERSON AND `account_id` IS NOT THE SCOPE: it is NULLABLE, because a flag can be about the identity with no account named at all -- entity_cap, payment_velocity and name_mismatch are identity-level findings -- so a derived rule through `accounts` would silently drop exactly the flags that are about the person. REGISTERING A TABLE MAKES IT READABLE AND NOTHING ELSE, and this rule answers HOW A ROW REACHES AN IDENTITY rather than who may read it: INV-M7-10's no-detector-detail promise is enforced on `evidence_packs` by `evidence_packs_trader_gets_no_detector_detail`, which is a different table and is not registered here. Severity 4 is why the table is money-ADJACENT: ADR-040's `G-HOLD-REQUIRED` holds a payout on an unresolved 4+ flag, so a rule returning another identity's flags would hold the wrong person's money.",
  },

  correlationGroups: {
    class: 'firm',
    why: 'A GROUP-LEVEL FINDING SPANNING THREE OR MORE ACCOUNTS, AND THE `firm` CLASS HERE IS A REFUSAL RATHER THAN A DEFAULT. `correlation_groups_is_a_group` starts the table at three members and M07 section 3.4 filters same-identity clustering AT THE DETECTOR, so a row that exists is a finding about MORE THAN ONE identity by construction and no single identity owns it. `member_account_ids` is `uuid[]`, which this vocabulary cannot traverse in any case -- `DerivedRule` names one `localColumn` against one `foreignColumn`, and an array is neither a `hop` nor a `semi-join` -- but the reason it MUST NOT be traversed is stronger than the reason it cannot: returning the row to each member would tell every member which OTHER accounts the detector grouped them with, which is a cross-identity read and the BOLA failure ADR-008 scoped the accessor to bound. `systemDb` reads it and `scopePredicate` says so by throwing rather than by returning nothing.',
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
  contactChannels: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0019_notifications_and_community.sql). THE ADDRESSES ONE PERSON HAS USED, INCLUDING THE ONES THEY NO LONGER USE, and the superseded rows are the point rather than residue: INV-M16-03's account-takeover countermeasure notifies the PRIOR contact for a window after a change, which is impossible against a value somebody overwrote. So a scoped read returns the live row and every superseded one, and all of them are this identity's. WHAT THE READ RETURNS IS SEALED RATHER THAN LEGIBLE, per ADR-046: `value_hash` is a digest and `value_ciphertext` is envelope-encrypted under a key named by `value_key_id` AND NOT PRESENT IN THIS DATABASE, so scoping this table grants the rows and not the addresses. `complained_at` is a fact about the DESTINATION rather than a preference (INV-M16-13) and moves nothing here either.",
  },

  notificationKinds: {
    class: 'firm',
    why: "THE POLICY CATALOGUE, one row per kind of message Merit sends. There is no identity column and there is no correct one: a kind is the SAME kind for every trader, `class` decides what a preference may silence and decides it once for the estate, and the link runs the other way -- `notifications.kind` names the kind a message was sent under -- so ownership flows FROM the catalogue exactly as it does from `plan_versions`. THIS TABLE IS THE PLAUSIBLE VERSION OF `plan_version_sizes`' MISTAKE: `notifications.kind` and `notification_preferences.kind` are both `NOT NULL REFERENCES notification_kinds(kind)` (0019_notifications_and_community.sql), which reads exactly like the `hop` `daily_marks` makes to `accounts` and is not one, because a derivation chain terminates at `owned` or at `root` and a firm parent makes the whole chain firm. Both of those tables carry `identity_id` on the row and are scoped by it.",
  },

  notifications: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0019_notifications_and_community.sql). ONE ROW PER MESSAGE MERIT SENT ONE PERSON, and the row is about that person. `kind` IS THE OTHER CANDIDATE COLUMN AND IT IS A TRAP: it is a NOT NULL foreign key to `notification_kinds`, which is FIRM, so a derived rule through it compiles at every call site, is a member of `ScopedTableKey`, and throws the first time anybody reads the table. `class` and `template_version` are denormalized here at send time because the class a message was SENT under is a historical fact and the kind's class today is a current policy; reclassifying a kind must not rewrite what was already sent, and neither column moves the tenancy. `read_at` is a convenience and never evidence of notice (INV-M16-09), so a scoped read returns unread, undelivered and suppressed rows alike: they are all this identity's record of what Merit tried to tell them.",
  },

  notificationPreferences: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0019_notifications_and_community.sql), and it is the first column of the composite primary key `(identity_id, kind, channel)`. THE ROW IS A PERSON'S ANSWER ABOUT ONE KIND ON ONE CHANNEL. `kind` is `notifications`' trap repeated and is again not the scope, for the same reason: `notification_kinds` is firm. WHAT A PREFERENCE MAY DO IS DECIDED ONE TABLE OVER AND NOT HERE -- a row against an immutable kind is permitted to exist and is ignored by the send path, because refusing to store it produces a settings screen that lies about what it saved -- so this table's tenancy says nothing about whether the preference binds.",
  },

  otpSendBudget: {
    class: 'firm',
    why: "PRE-IDENTITY BY CONSTRUCTION, which is a stronger statement than 'no identity column'. INV-M16-12 splits INV-M16-11: a message to an authenticated recipient at an address Merit already holds is exempt from rate limiting, and a message to an ATTACKER-SUPPLIED DESTINATION BEFORE ANY IDENTITY EXISTS is not. This table is the second one's control, so there is nobody to own a row and there could not be -- the whole premise of the rows is that nobody has proved who they are yet. THE COLUMN A DERIVATION WOULD REACH FOR IS `scope_key` AND IT IS NOT AN IDENTITY: for 'phone' it holds `encode(phone_hash,'hex')` and never the number, for 'ip' the address, for 'country' the alpha-2 and for 'global' the literal 'global'. It declares no foreign key, so there is nothing to traverse even if the rows belonged to somebody, and a per-identity slice of a global cost circuit breaker is not a smaller version of it.",
  },
  identityPhones: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0029_phone_identity_and_auth.sql). A VERIFIED PHONE IS AN IDENTITY NODE AND NOT A CONTACT FIELD, which is ADR-039 (a) and (b) and is why this table is not `contact_channels`: the delivery address is a preference and this is an identity signal, and collapsing the two is how a contact-preference edit becomes an identity change. SUPERSESSION AND RELEASE RATHER THAN UPDATE, so a prior number remains a row -- ADR-039 (c) requires notifying it -- and a scoped read returns the superseded and released rows as well as the live one, which is correct: the history is the person's own evidence, and `superseded_by` reaches only other rows of this same table. THE PHONE -> IDENTITY DIRECTION IS DELIBERATELY NOT UNIQUE (`identity_phones_live_number_idx`), so one number may be live on more than one identity and a rule scoping by `phone_hash` would return STRANGERS' ROWS; the identity column is the only correct one and the non-uniqueness is what makes that a real distinction rather than a pedantic one.",
  },

  kycFunnelEvents: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0003_kyc.sql). Telemetry ABOUT ONE PERSON'S PASSAGE THROUGH THE GATE, one row per step, and the step vocabulary carries 'abandoned' as a first-class member because THE ABANDONMENT IS THE MEASUREMENT (AS-M19-08): the traders who matter most to the adjudication are the ones who never created a verification row at all, so drop-off cannot be reconstructed from `kyc_verifications` and this table exists to hold what that one cannot. `0026_roles_and_grants.sql` revokes UPDATE and DELETE on it, so the record is append-only; that makes the rows immutable and does not make them firm -- an aggregate over every identity would be a different table, and the grain here is one identity's own funnel.",
  },

  kycVerifications: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0003_kyc.sql). THE ROW IS A REFERENCE TO A VERIFICATION AND NEVER THE VERIFICATION ITSELF: Merit never proxies identity documents, the client goes to the provider's hosted flow, and 0003's header states what is therefore stored -- status and references only, with every jsonb column holding provider decision metadata and never document data (VG-10). That is what makes the tenancy simple and it is also why the tenancy matters most here: these are the most sensitive rows in the estate and the only thing standing between one identity's verification history and another's is this column. A RE-VERIFICATION IS A NEW ROW AND NOT A RE-READ (SD-M19-01, INV-M19-06), so `supersedes` reaches only other rows of this same table and the supersession chain never leaves the identity it belongs to -- a scoped read returns the whole chain, which is correct, because what Merit believed at each check is the person's own record.",
  },

  phoneChangeRequests: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0029_phone_identity_and_auth.sql). THE ROW CARRIES TWO PATHS TO AN IDENTITY AND THE DIRECT COLUMN IS THE RULE: `old_phone_id` is `NOT NULL REFERENCES identity_phones(id)` and reaches the same identity one hop out, and a derived rule through it would make this table's tenancy depend on a join rather than on a column the database itself declares against `identities(id)`. That is `certificates`' shape and it carries `certificates`' unclosed gap with it -- nothing in the schema forces `old_phone_id`'s identity to equal `identity_id`, so a row whose prior phone belongs to A while its `identity_id` says B is representable, and under this rule it is B's request. Naming that here rather than repairing it, because a repair is a migration. The ceremony is state and not steps (ADR-039 (c) and (d)): dual-channel verification, prior-number notification and a still-running withdrawal hold are preconditions of reaching 'applied', asserted by `phone_change_requests_applied_is_complete`.",
  },

  sanctionsScreenings: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0003_kyc.sql). ONE ROW PER TIME MERIT SCREENED A PERSON, and the row is ABOUT THAT PERSON. It is a separate table from `kyc_verifications` rather than a field on it because folding it in would put a legally mandatory refusal in the same column as a blurry-photo rejection (INV-M19-05), and the separation is a tenancy fact as well as a review-path one: `reviewed_by` names a MERIT REVIEWER and is deliberately NOT a second path to an identity, for `treasury_balances.recorded_by`'s reason exactly -- it records who asserted the outcome and says nothing about whose screening it is. `list_refs` names which lists were screened and carries no person's name at all.",
  },
  accountAdjustments: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: '`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0038_account_adjustments.sql), and THE IDENTITY IS THE SCOPE BECAUSE THE ACCOUNT IS NULLABLE: `account_id uuid NULL` means an adjustment may name no account at all, so a derived rule through `accounts` would leave every accountless adjustment unreachable while looking correct on the ones that have one. This is the first table in the corpus that moves money to a named person and the first that permits taking it back (ADR-067), so the rows a scoped read returns are exactly the credits and reversals against that human -- which is the point: an adjustment nobody can see is a correction nobody can contest.',
  },

  adminActions: {
    class: 'firm',
    why: 'MERIT\'S RECORD OF ITS OWN OPERATORS. `reason text NOT NULL` is the control and 0017 states it as "NO UNEXPLAINED ADMIN ACTION, EVER"; the audience for that record is an auditor and never the subject. THE TEMPTING RULE IS `owned` ON `on_behalf_of_identity_id` AND IT IS WRONG IN THE DIRECTION THAT RETURNS ROWS: 0043 sets that column exactly when `initiative = trader_request`, by a biconditional CHECK, so a scoped read would return the actions Merit took FOR a person and silently omit every enforcement action it took AGAINST them -- a strict subset of the rows about that human, presented as all of them, which is `purchases`\' refusal on a different pair of columns. There is no column naming the identity an enforcement row is about: `subject_id uuid NOT NULL` is polymorphic, discriminated by `subject_kind`, and declares no foreign key at all.',
  },

  alarmSuppressions: {
    class: 'firm',
    why: "MERIT MUTING ITS OWN ALARM. The row records an operational decision about Merit's monitoring, and `expires_at NOT NULL` (SD-M6-03, INV-M6-06) is the control that makes the mute temporary. `scope jsonb NOT NULL` MAY NAME AN ACCOUNT OR AN IDENTITY AND THAT DOES NOT MAKE THE ROW THEIRS: a jsonb payload declares no foreign key, so there is nothing a predicate could compare, and a suppression is Merit's decision not to look rather than a fact about whoever it covers. THE UNSUPPRESSIBLE SET IS ENFORCED BY NOTHING TODAY -- `alarm_key text NOT NULL` carries no CHECK and no reference list -- which is M06 section 3.5's own stated limit and OQ-M6-05's open question, and nothing here closes it.",
  },

  dualControlApprovals: {
    class: 'firm',
    why: "TWO OPERATORS, ONE SENSITIVE ACT. The row is about Merit's own authorisation procedure and `dual_control_approvals_second_person` puts the control in DDL: the approver is not the requester. `subject_id uuid NOT NULL` is polymorphic, discriminated by `subject_kind`, and declares no foreign key, so it names the OBJECT being approved -- a price floor, a treasury movement, an adjustment -- rather than a person. `requested_by` and `approved_by` are `text` actor strings and not `users` rows, so there is no identity column here in either direction.",
  },

  economicCalendar: {
    class: 'firm',
    why: "WHEN A TIER-1 MACRO RELEASE IS SCHEDULED, which is a fact about the world rather than about anybody. Every identity reads the same calendar and D-04's news windows are computed from it for all of them at once. `load_id` reaches `economic_calendar_loads`, which is itself firm, so a derived rule would terminate at a firm parent and throw rather than being a milder mistake. `revision` makes each moved release time a NEW row, so what the calendar said when a detector read it is answerable forever -- which is what makes a flag raised against a trader defensible, and it is still a property of the calendar and not of the trader.",
  },

  economicCalendarLoads: {
    class: 'firm',
    why: "ONE ROW PER INGESTED PUBLICATION OF A THIRD PARTY'S RELEASE SCHEDULE. There is no identity column and there is no correct one: a load is the same load for every reader. `actor text NOT NULL` is 0002's actor idiom -- a loader or an operator, not a `users` row -- so it is not a path to anybody. The coverage window is what makes staleness answerable (FM-M7-08): a D-04 run over a day outside every load's coverage must refuse rather than report no releases, and that refusal is firm-wide.",
  },

  evidencePacks: {
    class: 'derived',
    via: 'accounts',
    localColumn: 'account_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT` (0008_risk.sql), and `accounts` carries the identity. NOT NULL and single-valued, so a join cannot multiply rows. A pack is an EXPORT OF ONE ACCOUNT'S EVIDENCE and the row is about whoever holds that account, which is why `audience` exists at all: SD-M6-04 makes a trader a possible recipient of a pack about themselves, and `evidence_packs_trader_gets_no_detector_detail` is what stops that channel from disclosing detector thresholds to the adversary who triggered them. REGISTERING THIS TABLE MAKES IT READABLE AND NOTHING ELSE -- the redaction profile is a property of the export and no scope rule enforces it.",
  },

  identityRestrictionEpisodes: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0031_payout_hold_and_identity_restriction.sql). ONE ROW PER TIME MERIT RESTRICTED A PERSON, and the row is ABOUT THAT PERSON rather than about the operator who opened it: `opened_by` and `restored_by` both reference `users` and are `treasury_balances.recorded_by`'s trap exactly -- they record WHO ACTED and say nothing about whose restriction it is. `identity_restriction_open_uq` allows at most one OPEN episode per identity, so the closed ones accumulate and a scoped read returns the whole history, which is what makes a contested enforcement defensible months later.",
  },

  impersonationPageViews: {
    class: 'derived',
    via: 'impersonationSessions',
    localColumn: 'impersonation_session_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`impersonation_session_id uuid NOT NULL REFERENCES impersonation_sessions(id) ON DELETE RESTRICT` (0042_impersonation_sessions.sql). NOT NULL and single-valued, so a join cannot multiply rows. EVERY PAGE AN OPERATOR SAW WHILE WEARING A TRADER'S SESSION, reaching an identity through the session's SUBJECT rather than through its admin, so the parent's trap is not re-entered one hop out. `impersonation_page_view_within_box` bounds every view to its session's two-hour box, which is what makes the read log complete rather than merely present.",
  },

  impersonationSessions: {
    class: 'owned',
    column: 'subject_identity_id',
    nullable: false,
    why: "`subject_identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` (0042_impersonation_sessions.sql). THE OTHER CANDIDATE COLUMN IS THIS FILE'S OWN NAMED TRAP: `admin_user_id` references `users`, so a derivation through it reaches THE ADMIN'S IDENTITY rather than the subject's and returns rows for the wrong person with no error anywhere. The row is about the trader who was worn, and ADR-069's whole argument is that provenance is what an evidence pack turns on: an admin-attributed action preserves it and an impersonated one destroys it, so the record of who was impersonated, by whom, for how long and why must be the SUBJECT'S row. The table carries no `user_id`, no `auth_factor`, no `elevated_at` and no `elevated_by_factor`, which is structural rather than an omission.",
  },

  planBreakerState: {
    class: 'firm',
    why: "ONE ROW PER PLAN PER EVALUATION DAY, and a per-plan loss ratio is an aggregate over every account on that plan. There is no identity column and there is no correct one: a per-identity slice of a plan's loss ratio is not a smaller version of it, which is `published_statistics`' reason on an internal surface. `plan_id` reaches `plans`, the product catalogue, so a derived rule would not be a milder mistake -- it would terminate at a firm parent and throw. The breaker is a control on MERIT'S OWN EXPOSURE and the trader-visible consequence of it is a plan being paused, which is a fact about the plan.",
  },

  reportDeliveries: {
    class: 'firm',
    why: 'ONE ROW PER ATTEMPT TO DELIVER A DIGEST TO MERIT\'S OWN STAFF. Its only foreign key is `schedule_id -> report_schedules(id)` and that parent is FIRM, so a derived rule here is `plan_version_sizes`\' refused shape exactly: `scopePredicate` recurses into the via table, the via table is firm, and a chain terminates at `owned` or at `root` or it does not terminate. The delivery-failure alarm reads this table and never the job\'s own report, and `due_at` is what makes absence detectable at all, because without it "nothing arrived" and "not due yet" are the same empty result set.',
  },

  reportSchedules: {
    class: 'firm',
    why: "WHAT MERIT SENDS ITSELF, ON WHAT CADENCE, TO WHICH OPERATOR MAILBOX. `recipients text[] NOT NULL` holds Merit's own staff addresses or a configured SFTP destination, never a trader's, and the row exists to give the C8 weekly risk ritual an input other than a human remembering to look. There is no identity column and there is no correct one. NO CREDENTIAL IS STORED HERE and there is deliberately no column that could hold one, so this table is not a fifth credential surface arriving without a ruling.",
  },

  affiliates: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "`identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` on the row (0005_affiliate_program.sql), and AN AFFILIATE IS AN IDENTITY is the table's own DDL comment rather than an inference from the column: it is what makes the self-deal check possible at all (B4 #16) and what makes INV-M8-12's 'the affiliate is a human Merit has restricted' a query. THE TRAP IS `parent_id`, which references THIS TABLE for the sub-IB trees that are unused in v1: a derived rule through it would scope a person's own affiliate row to their RECRUITER, and on a null parent it would scope it to nobody. `balance_cents` is SIGNED money and negative is owed to Merit, so a wrong rule here is a debt shown to the wrong human.",
  },

  affiliateCreatives: {
    class: 'derived',
    via: 'affiliates',
    localColumn: 'affiliate_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT` (0005_affiliate_program.sql), and `affiliates` carries the identity. NOT NULL and single-valued, so a join cannot multiply rows. `reviewed_by` IS NOT THE TENANCY AND COULD NOT BE: the DDL declares it `text NULL` with no foreign key, so there is nothing to traverse, and a creative belongs to the affiliate who submitted it rather than to the operator who read it -- a rejected or withdrawn creative is still that affiliate's row, which is the compliance evidence INV-M8-08 is about.",
  },

  affiliateClicks: {
    class: 'derived',
    via: 'affiliates',
    localColumn: 'affiliate_id',
    foreignColumn: 'id',
    traversal: 'hop',
    why: "`affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT` (0005_affiliate_program.sql), and `affiliates` carries the identity. NOT NULL and single-valued, so a join cannot multiply rows. A CLICK BELONGS TO THE AFFILIATE AND NOT TO THE PERSON WHO CLICKED, and the DDL is what decides that: the table has no identity column, no `user_id` and no `purchase_id`, because a click happens before anybody has signed in. The three columns that look like a clicker are the trap and none of them is a tenancy -- `ip` reaches whoever shares a network, `user_agent` reaches whoever shares a browser build, and `click_fingerprint` is `sessions.device_fingerprint_id`'s named trap arriving on a different table.",
  },
  offerExperiments: {
    class: 'firm',
    why: "AN EXPERIMENT IS A THING MERIT RUNS AND NOT A THING ANYBODY OWNS. There is no identity column and there is no correct one: an arm is assigned to a POPULATION and the hypothesis is about the population, so a per-identity slice of an experiment is not a smaller version of it. `arms jsonb` holds arm DEFINITIONS rather than enrolments and there is no enrolment table in this tree, so nothing here reaches an identity even one hop out. The row a person actually holds is the `offers` row naming `experiment_id`, and that table carries the identity. `varies` is CHECKed to price, presentation and bundle_contents with no fourth value, which is 0024's own header: an experiment that varies a rule, a gate or a plan parameter cannot be written down at all (AS-M17-07).",
  },

  priceFloors: {
    class: 'firm',
    why: "THE HARD STOP UNDER STACKING ARITHMETIC, AND IT IS THE FIRM'S NUMBER (0024_offers.sql). The table declares no foreign key at all, carries no identity column, and there is no correct one, because a floor that differed per trader would not be a floor; `approved_by text NOT NULL` is an approver rather than a `users` row, on 0002's `actor` idiom. THE GRAIN IS `(product_ref, effective_from)` AND IT IS THE WHOLE PRIMARY KEY, so the table has no `uuid` of its own, and `dual_control_approvals.subject_id` is `uuid NOT NULL` (0016:227) -- so the dual control M17:150, EC-119 and `data-model/price_floors.md:2` all assert over this table cannot name its subject. THAT IS A FINDING AND NOT A REPAIR: a repair is a migration and a transcription holds none. Registering the table changes nothing about it either way, because a firm table is refused by the scoped accessor at compile time.",
  },

  offers: {
    class: 'owned',
    column: 'identity_id',
    nullable: true,
    why: "NULLABLE ON PURPOSE, AND THE DDL MAKES IT BICONDITIONAL. `offers_identity_scope_matches` CHECKs `(scope = 'identity' AND identity_id IS NOT NULL) OR (scope <> 'identity' AND identity_id IS NULL)`, so filtering `identity_id = $1` returns EXACTLY the rows the schema says are that person's and excludes every `public` and `segment` row without a second predicate, because SQL NULL never equals anything. THIS IS `ledger_accounts`' SHAPE AND NOT `coupons`': a coupon has no identity column and no correct one, while this row has one the DDL declares `REFERENCES identities(id)`, which is also why `firm` is refused here by the suite's own assertion rather than by taste. THE TRAP IS `experiment_id`: it is a foreign key to `offer_experiments`, which is FIRM, so a `derived` rule through it compiles at every call site -- `DerivedRule.via` is `TableKey` and includes every firm key -- and throws the first time anybody reads it. `loyalty_grant_id` is the same shape one table further out. WHAT THIS RULE DOES NOT RETURN IS SAID OUT LOUD: a `segment` offer names no segment, because the table has no segment column at all, so it is unreachable from any identity under any class in this vocabulary, and a scoped read of this table is THE OFFERS ADDRESSED TO A PERSON rather than the offers available to them.",
  },

  promotionalCreditGrants: {
    class: 'owned',
    column: 'identity_id',
    nullable: false,
    why: "THE TABLE THAT MINTS VALUE, and `identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` is on the row (0024_offers.sql). A grant is a named person's entitlement from the moment it exists and the DDL has no way to write an unowned one. NEVER WITHDRAWABLE (OQ-FREEZE-01): its own ledger class `promotional_credit` at 0009, and no `wallet_entries.provenance` value at 0011. `funding_purchase_id` IS THE DELTA'S CONTENT AND IS NOT THE SCOPE: it is NULLABLE, because a loyalty-issued or fee-back-issued grant has no funding purchase, so a derivation through `purchases` would return only the grants somebody bought and would drop exactly the ones no purchase funded. `source_offer_id` IS THE OTHER TRAP AND IT IS THIS MODULE'S CHARACTERISTIC ONE -- a redemption pointing at its catalogue row reads like a legitimate hop -- and it is nullable besides, so a grant issued from a `public` offer would reach nobody at all through it. `source_payout_request_id` is 0044's later column, folded by ADR-094, and is a settlement rather than a person.",
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
