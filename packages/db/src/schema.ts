// =============================================================================
// packages/db/src/schema.ts
// =============================================================================
// THIRTY TABLES OF 111, AND THAT IS REPORTED RATHER THAN ROUNDED UP. The
// other 81 are not reachable through either accessor: `SCOPE_RULES` is total
// over the keys of this file, so a table that is not here is a COMPILE ERROR at
// the call site rather than an unscoped read at runtime.
//
// THE THIRTY ARE NOT ONE PHASE'S SET AND WILL NEVER BE. ADR-092 makes the
// owner the TABLE rather than the module: a table is registered ONCE, by the
// first session that needs it, and the registration is never re-argued. Every
// `why` in `scope.ts` therefore states that TABLE's tenancy and never the
// reader's use.
//
// THIS FILE IS A SECOND STATEMENT OF THE DDL, AND THE DRIFT IS REAL. ADR-008's
// consequences say "Types are generated from the schema so drift is a compile
// error". ON THIS TREE THAT SENTENCE IS FALSE AND ADR-084 SUPERSEDES IT.
// Drizzle generates types from the TYPESCRIPT schema, so here the SQL is the
// source and this file is the transcription: the generation runs the opposite
// way from the one the clause assumed, and drift is a WRONG ANSWER AT RUNTIME
// rather than a compile error.
//
// WHAT REPLACES IT IS MECHANICAL AND LIVES IN `test/scoped-db.test.ts`: the
// suite reads each registered table's `CREATE TABLE` body out of
// `packages/db/migrations/`, REPLAYS every later `ADD COLUMN` onto it in
// migration order, and asserts column-name-set agreement with the declarations
// below.
//
// A TABLE IS READ AS OF THE LAST MIGRATION AND NEVER AS OF ITS `CREATE TABLE`,
// which is ADR-094. That entry rules the replay's vocabulary CLOSED at one
// member with a default of FAIL: `ADD COLUMN` is folded, and `DROP COLUMN`,
// `ALTER COLUMN` and `RENAME` stay offenders that turn the suite red, so the day
// one lands the check fails rather than silently reading a stale CREATE. THREE
// of the thirty below carry later columns -- `sessions`, `plan_versions` and
// `rule_states` -- and none of them could be registered at all before ADR-094,
// which is why the ruling came before the transcription rather than after it.
//
// A COLUMN CARRIES `.references()` HERE ONLY WHEN ITS `CREATE TABLE` BODY
// DECLARES THE FK INLINE AND THE TARGET IS ONE OF THIS FILE'S TABLES. Every
// other foreign key -- one added later by `ALTER TABLE ... ADD CONSTRAINT`, or
// one pointing at a table nobody has registered -- is left to the database and
// the COLUMN alone is transcribed. That is what the drift assertion compares:
// the fold reads `ADD COLUMN` and deliberately ignores `ADD CONSTRAINT`, so a
// constraint claimed here would be a claim nothing in this package checks.
//
// READING THE SQL TO ASSERT AGAINST IT IS NOT GENERATING A SCHEMA FROM IT.
// Nothing here is emitted, and `drizzle-kit generate` is foreclosed permanently:
// the migrations are the source and this file is the transcription, which is the
// inverse of the flow drizzle-kit exists to run. Migrations are sacred: once
// merged, never edited, only superseded (constitution E2).

import {
  bigint,
  boolean,
  char,
  customType,
  date,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// -----------------------------------------------------------------------------
// Two SQL types the DDL uses and drizzle-orm 0.45.2's pg-core has no builtin for
// -----------------------------------------------------------------------------
// TRANSCRIBED RATHER THAN APPROXIMATED. Declaring `refresh_token_hash` as
// `text()` or `email` as `text()` would compile, would satisfy the column-name
// comparison the suite runs, and would be a WRONG TRANSCRIPTION of the column's
// type -- which is precisely the axis ADR-094 section 3 records that this suite
// does not yet check. A custom type costs four lines and does not lie.
//
// `citext` is why casing never creates a duplicate human (0002_identity.sql) and
// `bytea` is why the token and the state hash are stored as digests rather than
// as strings; both facts are in the columns' own DDL comments.
const bytea = customType<{ data: Uint8Array }>({
  dataType: () => 'bytea',
});

const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

// -----------------------------------------------------------------------------
// Enums, transcribed from 0001_extensions_and_enums.sql
// -----------------------------------------------------------------------------
// `identity_status` HAS NO `suspended` MEMBER and ADR-041 refused to add one.
// It is written out here so a reader reaching for one finds the three that exist.
export const identityStatus = pgEnum('identity_status', ['active', 'restricted', 'closed']);
export const accountPhase = pgEnum('account_phase', ['eval', 'funded', 'closed', 'graduated']);
export const planVersionStatus = pgEnum('plan_version_status', ['draft', 'published', 'retired']);
export const accountStatus = pgEnum('account_status', [
  'provisioning_pending',
  'active',
  'breached',
  'expired',
  'closed_admin',
  'closed_chargeback',
  'graduated',
]);
export const purchaseStatus = pgEnum('purchase_status', [
  'pending',
  'paid',
  'failed',
  'refunded',
  'charged_back',
]);
// ADR-031. THE UNIT IS FORCED BY THE TYPE AND IS NOT AN EXTRA COLUMN BESIDE IT:
// a bare bigint is ambiguous between 1470 basis points and 1470 cents, on a
// surface Merit cannot restate quietly. One vocabulary, used by both the
// published figure and its numerator, because two vocabularies for one concept
// is how they drift.
export const statisticUnit = pgEnum('statistic_unit', ['count', 'bp', 'cents', 'duration_seconds']);
// ADR-032. WHICH FIGURE A PUBLISHED ROW CARRIES. Three of the seven ruled
// statistics publish two figures at once -- ST-04 mean AND median, ST-05 and
// ST-06 p50 AND p95 -- and one row per statistic per window cannot express that.
export const statisticMeasure = pgEnum('statistic_measure', [
  'rate',
  'total',
  'mean',
  'median',
  'p50',
  'p95',
  'count',
]);
// 0001_extensions_and_enums.sql. `risk_flags.status` is the ONE column in this
// file's risk set that is an enum rather than `text` plus a CHECK, and the
// difference is the DDL's and not a preference: `detector_runs.status` takes a
// CHECK list in 0008 and is transcribed as `text` for that reason.
//
// INV-M7-02 IS NOT IN THIS TYPE AND NOTHING HERE IMPLIES IT IS. M07 says a
// detector may write no status other than 'open' and names a PERMISSION as the
// enforcement; the enum carries all four members because a reviewer legitimately
// moves a flag through them. Session 161 measured that the permission does not
// exist yet (0026 creates three roles and no detector role), and a transcription
// does not repair a grant.
export const riskFlagStatus = pgEnum('risk_flag_status', [
  'open',
  'investigating',
  'dismissed',
  'enforced',
]);

// -----------------------------------------------------------------------------
// identities -- 0002_identity.sql. The ROOT: the row IS the identity.
// -----------------------------------------------------------------------------
export const identities = pgTable('identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name'),
  leaderboardOptIn: boolean('leaderboard_opt_in').notNull().default(false),
  status: identityStatus('status').notNull().default('active'),
  statusReason: text('status_reason'),
  maxAccountsOverride: integer('max_accounts_override'),
  payoutsFrozen: boolean('payouts_frozen').notNull().default(false),
  frozenReason: text('frozen_reason'),
  frozenAt: timestamp('frozen_at', { withTimezone: true }),
  supportContactRef: text('support_contact_ref'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// users -- 0002_identity.sql. OWNED: `identity_id` is on the row, NOT NULL.
// -----------------------------------------------------------------------------
// A USER IS A LOGIN AND AN IDENTITY IS THE PERSON, and ADR-041 is why they are
// two tables. An identity may hold more than one user, which is the whole reason
// `accounts` is scoped by `identity_id` and not by `user_id`: session 145 seeded
// exactly that substitution and all twenty-two assertions passed.
//
// THIS TABLE IS NOT IN P4's READS AND IS REGISTERED ANYWAY. `sessions` reaches
// an identity only through it, `DerivedRule.via` is typed `TableKey`, and a rule
// naming an unregistered table does not compile. ADR-092 makes the owner the
// TABLE, so the `why` below states this table's tenancy and not P4's use of it.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  email: citext('email').notNull().unique(),
  emailNormalized: citext('email_normalized').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  countryCode: char('country_code', { length: 2 }),
  timezone: text('timezone'),
  marketingConsent: boolean('marketing_consent').notNull().default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// sessions -- 0002_identity.sql, PLUS THREE COLUMNS FROM 0029. ADR-094's shape.
// -----------------------------------------------------------------------------
// THE COLUMN SET BELOW IS THE TABLE AS OF THE LAST MIGRATION AND NOT AS OF ITS
// `CREATE TABLE`. `0029_phone_identity_and_auth.sql` adds `auth_factor`,
// `elevated_at` and `elevated_by_factor`; the suite folds those forward and
// compares the whole effective set, which is ADR-094's ruling in the one place
// it is visible from here.
//
// DERIVED, AND THE OTHER CANDIDATE COLUMN IS A TRAP `scope.ts`'s header already
// names: `device_fingerprint_id` references `identity_signals`, so a mechanical
// derivation through it reaches WHOEVER SHARES A DEVICE. The row reaches an
// identity through `users` and through nothing else.
//
// `elevated_by_factor` is `text` and not an enum: 0029 constrains it with a
// CHECK rather than a `CREATE TYPE`, and the transcription follows the DDL.
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  refreshTokenHash: bytea('refresh_token_hash').notNull().unique(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  // References `identity_signals`, which is NOT one of this file's tables, so
  // the column is transcribed and the constraint stays the database's. Same
  // treatment as `accounts.terminal_settlement_id` below and the same reason.
  deviceFingerprintId: uuid('device_fingerprint_id'),
  createdIp: inet('created_ip'),
  createdUserAgent: text('created_user_agent'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  lastSeenIp: inet('last_seen_ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // 0029_phone_identity_and_auth.sql, SD-M4-04.
  authFactor: text('auth_factor').notNull(),
  elevatedAt: timestamp('elevated_at', { withTimezone: true }),
  elevatedByFactor: text('elevated_by_factor'),
});

// -----------------------------------------------------------------------------
// plan_versions -- 0004_catalog.sql, PLUS THREE COLUMNS FROM 0044 and 0045.
// -----------------------------------------------------------------------------
// FIRM. There is no identity column and there is no correct one: every identity
// is sold the SAME plan version, and the link runs the other way -- an account
// names the version it was bought under, so ownership flows FROM the catalogue.
//
// THE MOST-DRIFTED TABLE IN P4 and the reason ADR-094 exists as a ruling rather
// than as three transcriptions: `0044` adds `fee_back_repeats` and `0045` adds
// `decided_on_simulation_run_id` and `simulation_waiver_reason`.
//
// `rules` IS THE CONFIG AND NOT A SHAPE THIS FILE STATES. ADR-030 ruled two of
// its key names load bearing and every parameter inside it is a launch candidate
// re-confirmed at launch, never a constant. There is no plan parameter anywhere
// in application code and there is none here.
export const planVersions = pgTable('plan_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').notNull(),
  version: integer('version').notNull(),
  status: planVersionStatus('status').notNull().default('draft'),
  rules: jsonb('rules').notNull(),
  copyBlocks: jsonb('copy_blocks').notNull().default({}),
  publicSlug: text('public_slug').notNull(),
  publicVisible: boolean('public_visible').notNull().default(false),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // 0044_fee_back_and_ladder_unlock.sql.
  feeBackRepeats: boolean('fee_back_repeats').notNull().default(false),
  // 0045_simulation_runs.sql. References `simulation_runs`, not one of this
  // file's tables, so the column is transcribed and the constraint is the
  // database's.
  decidedOnSimulationRunId: uuid('decided_on_simulation_run_id'),
  simulationWaiverReason: text('simulation_waiver_reason'),
});

// -----------------------------------------------------------------------------
// plan_version_sizes -- 0004_catalog.sql. FIRM, and it inherits the reason.
// -----------------------------------------------------------------------------
// THE PRICE AND RISK GRID OF A PUBLISHED PLAN VERSION, one row per size. There
// is no identity column and there is no correct one, for `plan_versions`' own
// reason exactly one hop out: every identity is sold the same grid, and an
// account names the version it was bought under rather than the grid naming a
// buyer.
//
// A `derived` RULE THROUGH `plan_versions` WOULD NOT BE A SMALLER MISTAKE, IT
// WOULD THROW. `scopePredicate` recurses into the via table, `plan_versions` is
// `firm`, and the firm branch of that switch raises. A derivation chain
// terminates at `owned` or at `root` or it does not terminate, so a firm parent
// makes the whole chain firm rather than making the child derivable.
//
// `payout_cap_schedule_cents` IS AN ARRAY FROM DAY ONE holding a single flat
// step in v1, ADR-025 having rejected progressive cap release. The shape is the
// DDL's; no plan parameter is stated in application code and none is here.
export const planVersionSizes = pgTable('plan_version_sizes', {
  id: uuid('id').primaryKey().defaultRandom(),
  planVersionId: uuid('plan_version_id')
    .notNull()
    .references(() => planVersions.id),
  sizeCents: bigint('size_cents', { mode: 'bigint' }).notNull(),
  priceCents: bigint('price_cents', { mode: 'bigint' }).notNull(),
  resetPriceCents: bigint('reset_price_cents', { mode: 'bigint' }).notNull(),
  drawdownCents: bigint('drawdown_cents', { mode: 'bigint' }).notNull(),
  // NULL ON DIRECT: there is no evaluation, so there is no profit target. A
  // zero here would be a target of zero, which is a different and reachable
  // thing.
  profitTargetCents: bigint('profit_target_cents', { mode: 'bigint' }),
  bufferCents: bigint('buffer_cents', { mode: 'bigint' }).notNull(),
  winDayFloorCents: bigint('win_day_floor_cents', { mode: 'bigint' }).notNull(),
  payoutCapScheduleCents: jsonb('payout_cap_schedule_cents').notNull(),
  dailyLossLimitCents: bigint('daily_loss_limit_cents', { mode: 'bigint' }),
  // SD-10. The enabling flag is MATERIALIZED here from the parent's `rules`
  // jsonb because a CHECK constraint cannot read another table, and the
  // completeness of the trio is a constraint rather than a trigger.
  floorLockEnabled: boolean('floor_lock_enabled').notNull(),
  floorLockAtProfitCents: bigint('floor_lock_at_profit_cents', { mode: 'bigint' }),
  floorLockFloorAtCents: bigint('floor_lock_floor_at_cents', { mode: 'bigint' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// purchases -- 0006_commerce.sql. OWNED: `identity_id` is on the row, NOT NULL.
// -----------------------------------------------------------------------------
// `user_id` IS PRESENT AND IS NOT THE SCOPE, which is the same trap `accounts`
// carries and the same answer: a user is a login and an identity is the person
// (ADR-041). This table's own DDL says the two columns exist because they CAN
// DIFFER AFTER A MERGE and the difference is evidence, which is precisely why
// scoping by the login would return a strict subset of the person's purchases.
//
// FOUR COLUMNS CARRY NO `references()` AND NONE OF THEM IS AN OMISSION.
// `parent_account_id` takes its FK in 0007 and `wallet_ledger_transaction_id`
// in 0011, both by `ALTER TABLE ... ADD CONSTRAINT`, which the fold reads and
// discards; `coupon_id` and `affiliate_id` point at `coupons` and `affiliates`,
// which nobody has registered. The COLUMN is what the drift assertion compares.
export const purchases = pgTable('purchases', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  // PINS THE CONTRACT AT PURCHASE TIME (B4 #12). The account's rules are the
  // rules on the day it was bought, forever.
  planVersionId: uuid('plan_version_id')
    .notNull()
    .references(() => planVersions.id),
  sizeCents: bigint('size_cents', { mode: 'bigint' }).notNull(),
  kind: text('kind').notNull(),
  parentAccountId: uuid('parent_account_id'),
  listPriceCents: bigint('list_price_cents', { mode: 'bigint' }).notNull(),
  discountCents: bigint('discount_cents', { mode: 'bigint' }).notNull().default(0n),
  amountPaidCents: bigint('amount_paid_cents', { mode: 'bigint' }).notNull(),
  // Reserved for multi-currency, NEVER used in v1 math (Wave 2 gate ruling 5).
  currency: char('currency', { length: 3 }).notNull().default('USD'),
  couponId: uuid('coupon_id'),
  affiliateId: uuid('affiliate_id'),
  psp: text('psp').notNull(),
  pspReference: text('psp_reference').notNull(),
  midReference: text('mid_reference'),
  status: purchaseStatus('status').notNull().default('pending'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  ip: inet('ip'),
  // SD-M3-02. The refund window is "pre-first-trade only", which is A FACT
  // ABOUT TRADING, so it is recorded on the purchase when M02 sees the first
  // fill. Without these two the policy is unenforceable and becomes a support
  // argument.
  refundableUntil: timestamp('refundable_until', { withTimezone: true }),
  firstTradeAt: timestamp('first_trade_at', { withTimezone: true }),
  // SD-M3-05. THE DECISION MERIT MADE AT CHECKOUT, RECORDED AT CHECKOUT.
  // Reconstructing it later from an IP log is a different artifact: it says
  // where they were, not what we decided.
  checkoutIpCountry: char('checkout_ip_country', { length: 2 }),
  cardCountry: char('card_country', { length: 2 }),
  geoDecision: text('geo_decision'),
  // SD-M3-06. ADR-019. The wallet as a checkout payment method. The wallet leg
  // is SERVER-COMPUTED from the identity's balance and never supplied by the
  // client, for the same reason no price is.
  paymentMethod: text('payment_method').notNull().default('psp'),
  walletDebitCents: bigint('wallet_debit_cents', { mode: 'bigint' }).notNull().default(0n),
  walletLedgerTransactionId: uuid('wallet_ledger_transaction_id'),
  // SD-M4-02. A reset onto a CHANGED plan version is a new contract, and a
  // trader who did not notice is a trader who was not told.
  ruleDiffAcknowledgedAt: timestamp('rule_diff_acknowledged_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// accounts -- 0007_accounts.sql. OWNED: `identity_id` is on the row, NOT NULL.
// -----------------------------------------------------------------------------
// `terminal_settlement_id` carries no `references()` here and the reason is not
// an omission: 0010 adds the FK by ALTER TABLE ADD CONSTRAINT, and
// `payout_requests` is not one of this file's seven. The COLUMN is transcribed,
// which is what the drift assertion compares; the constraint is the database's.
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  userId: uuid('user_id').notNull(),
  purchaseId: uuid('purchase_id').notNull().unique(),
  planVersionId: uuid('plan_version_id').notNull(),
  sizeCents: bigint('size_cents', { mode: 'bigint' }).notNull(),
  phase: accountPhase('phase').notNull(),
  status: accountStatus('status').notNull(),
  platform: text('platform').notNull().default('rithmic'),
  platformAccountRef: text('platform_account_ref'),
  feed: text('feed'),
  frontEndPermissions: jsonb('front_end_permissions').notNull().default([]),
  openedOn: date('opened_on').notNull(),
  fundedOn: date('funded_on'),
  closedOn: date('closed_on'),
  closeReason: text('close_reason'),
  payoutsFrozen: boolean('payouts_frozen').notNull().default(false),
  reconBlocked: boolean('recon_blocked').notNull().default(false),
  expiresOn: date('expires_on'),
  graduatedAt: timestamp('graduated_at', { withTimezone: true }),
  graduationPath: text('graduation_path'),
  terminalSettlementId: uuid('terminal_settlement_id'),
  graduationEligible: boolean('graduation_eligible').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// ledger_accounts -- 0009_ledger.sql. OWNED, AND THE COLUMN IS NULLABLE.
// -----------------------------------------------------------------------------
// `scope` is CHECKed to ('firm','identity') and the table's own constraint ties
// it to `identity_id`: an identity row has one, a firm row has NULL. A scoped
// read filters `identity_id = $1`, and SQL NULL never equals anything, so the
// firm rows -- `firm_treasury`, `psp_clearing`, `fees_revenue`, `reserve` -- fall
// out of a scoped read WITHOUT a second predicate. That is why the class is
// `owned` and not something weaker.
export const ledgerAccounts = pgTable('ledger_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull(),
  kind: text('kind').notNull(),
  scope: text('scope').notNull(),
  identityId: uuid('identity_id').references(() => identities.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// ledger_transactions -- 0009_ledger.sql. DERIVED, BY SEMI-JOIN.
// -----------------------------------------------------------------------------
// THE TABLE CARRIES NO IDENTITY COLUMN AT ALL. It reaches one through its
// entries, and a transaction has MORE THAN ONE: double-entry means a trader leg
// and a firm leg on the same transaction, so a plain JOIN through
// `ledger_entries` returns the transaction once PER MATCHING ENTRY. The rule is
// an EXISTS semi-join for that reason and the reason is arithmetic, not style.
export const ledgerTransactions = pgTable('ledger_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  referenceKind: text('reference_kind').notNull(),
  referenceId: uuid('reference_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  reversalOf: uuid('reversal_of'),
  postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// ledger_entries -- 0009_ledger.sql. DERIVED, ONE DECLARED HOP.
// -----------------------------------------------------------------------------
export const ledgerEntries = pgTable('ledger_entries', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  transactionId: uuid('transaction_id')
    .notNull()
    .references(() => ledgerTransactions.id),
  ledgerAccountId: uuid('ledger_account_id')
    .notNull()
    .references(() => ledgerAccounts.id),
  amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
  currency: char('currency', { length: 3 }).notNull().default('USD'),
  memo: text('memo'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// treasury_balances -- 0009_ledger.sql. FIRM, AND THE TRAP IS `recorded_by`.
// -----------------------------------------------------------------------------
// A MECHANICAL "walk the FK to something carrying identity_id" DERIVATION GETS
// THIS TABLE WRONG. `recorded_by` references `users`, so an automatic rule would
// scope THE FIRM'S TREASURY to whichever admin typed the attestation. The column
// records WHO ASSERTED THE BALANCE and says nothing about whose money it is.
// This is the table the registry is declared rather than derived for.
export const treasuryBalances = pgTable('treasury_balances', {
  accountCode: text('account_code').notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  balanceCents: bigint('balance_cents', { mode: 'bigint' }).notNull(),
  source: text('source').notNull(),
  recordedBy: uuid('recorded_by'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// liability_snapshots -- 0009_ledger.sql. FIRM by construction.
// -----------------------------------------------------------------------------
// EC-095's three named numbers, aggregated across every identity. There is no
// identity column and there is no correct one: a per-identity slice of a
// firm-wide liability total is not a smaller version of it.
export const liabilitySnapshots = pgTable('liability_snapshots', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  openLiabilityCents: bigint('open_liability_cents', { mode: 'bigint' }).notNull(),
  boundedNearTermCents: bigint('bounded_near_term_cents', { mode: 'bigint' }).notNull(),
  remainingLadderExposureCents: bigint('remaining_ladder_exposure_cents', {
    mode: 'bigint',
  }).notNull(),
  walletBalancesCents: bigint('wallet_balances_cents', { mode: 'bigint' }).notNull(),
  absorbedCorrectionsCents: bigint('absorbed_corrections_cents', { mode: 'bigint' })
    .notNull()
    .default(0n),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// daily_marks -- 0014_marks.sql. DERIVED, ONE DECLARED HOP TO `accounts`.
// -----------------------------------------------------------------------------
// `account_id` is NOT NULL and single-valued, so a join cannot multiply rows.
// The grain is one row per account per trading day and the tenancy is the
// ACCOUNT'S: the day says nothing about who may read it.
//
// A CORRECTION PRODUCES A NEW ROW AND POINTS THE OLD ONE AT IT, never an
// UPDATE, so `superseded_by` is a self-reference and carries the explicit
// return type drizzle needs to break the circular inference.
//
// `adjustment_cents` IS SIGNED AND IS THE MONEY-PATH COLUMN HERE. Without it a
// settled payout of $2,500 leaving the platform balance is indistinguishable
// from a $2,500 trading loss, and the breach check would breach the account
// that earned the payout (EC-034).
export const dailyMarks = pgTable('daily_marks', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  tradingDay: date('trading_day').notNull(),
  openingBalanceCents: bigint('opening_balance_cents', { mode: 'bigint' }).notNull(),
  closingBalanceCents: bigint('closing_balance_cents', { mode: 'bigint' }).notNull(),
  highBalanceCents: bigint('high_balance_cents', { mode: 'bigint' }).notNull(),
  // THE BREACH COMPARISON INPUT: the day's low against the floor that was open
  // at the start of the day (`rule_states.floor_open_cents`, SD-04).
  lowBalanceCents: bigint('low_balance_cents', { mode: 'bigint' }).notNull(),
  // SIGNED. This is a movement, so it may be negative.
  realizedPnlCents: bigint('realized_pnl_cents', { mode: 'bigint' }).notNull(),
  fillCount: integer('fill_count').notNull().default(0),
  tradedDay: boolean('traded_day').notNull(),
  winDay: boolean('win_day').notNull(),
  // SD-01. Non-trading balance movements. SIGNED.
  adjustmentCents: bigint('adjustment_cents', { mode: 'bigint' }).notNull().default(0n),
  sourceHash: bytea('source_hash').notNull(),
  // `text` with a CHECK rather than an enum, and the transcription follows the
  // DDL: where the DDL and a neighbouring type disagree, the DDL wins.
  source: text('source').notNull(),
  // References `ingest_files`, which is not one of this file's tables.
  ingestFileId: uuid('ingest_file_id'),
  supersededBy: bigint('superseded_by', { mode: 'bigint' }).references(
    (): AnyPgColumn => dailyMarks.id,
  ),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// rule_states -- 0015_rule_states.sql, PLUS ONE COLUMN FROM 0035.
// -----------------------------------------------------------------------------
// DERIVED, ONE DECLARED HOP TO `accounts`. `account_id` is NOT NULL and
// single-valued, so a join cannot multiply rows. The grain is one row per
// account per trading day: the DAY is the grain and the tenancy is the
// ACCOUNT'S, so this is `accounts`' rule one hop out and nothing more.
//
// `0035_rule_states_calendar_revision.sql` adds `calendar_revision_id`, which is
// why this table needed ADR-094 before it could be registered at all.
//
// TWO COLUMNS ARE DELIBERATELY NOT AN ENUM AND NOT A NUMBER. `phase` is `text`
// in the DDL even though `account_phase` exists as a type, and `state_hash` is
// `bytea` with a CHECK that its length is 32. The transcription follows the DDL
// in both cases; where the DDL and a neighbouring type disagree, the DDL wins,
// because the DDL is the source and this file is the transcription.
export const ruleStates = pgTable('rule_states', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  tradingDay: date('trading_day').notNull(),
  phase: text('phase').notNull(),
  floorCents: bigint('floor_cents', { mode: 'bigint' }).notNull(),
  floorLocked: boolean('floor_locked').notNull().default(false),
  floorOpenCents: bigint('floor_open_cents', { mode: 'bigint' }).notNull(),
  highWaterBalanceCents: bigint('high_water_balance_cents', { mode: 'bigint' }).notNull(),
  balanceCents: bigint('balance_cents', { mode: 'bigint' }).notNull(),
  withdrawableCents: bigint('withdrawable_cents', { mode: 'bigint' }).notNull(),
  tradedDaysCount: integer('traded_days_count').notNull(),
  winDaysCount: integer('win_days_count').notNull(),
  consistencyBestDayCents: bigint('consistency_best_day_cents', { mode: 'bigint' })
    .notNull()
    .default(0n),
  consistencyPeriodProfitCents: bigint('consistency_period_profit_cents', { mode: 'bigint' })
    .notNull()
    .default(0n),
  consistencyPeriodStartDay: date('consistency_period_start_day'),
  payoutsSettledCount: integer('payouts_settled_count').notNull(),
  // SD-02. TWO ANCHORS AND THEY ARE DIFFERENT DATES. They coincide under
  // ADR-019 today, and that is the trap: one column would work perfectly until
  // the anchor moved back, at which point the gap between payouts changes and
  // nothing in the schema records that two facts had been merged.
  payoutAnchorDay: date('payout_anchor_day'),
  cadenceAnchorDay: date('cadence_anchor_day'),
  engineEligible: boolean('engine_eligible').notNull(),
  engineGates: jsonb('engine_gates').notNull(),
  contextGates: jsonb('context_gates').notNull(),
  stateHash: bytea('state_hash').notNull(),
  engineVersion: text('engine_version').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // 0035_rule_states_calendar_revision.sql. References
  // `trading_calendar_revisions`, not one of this file's tables.
  calendarRevisionId: bigint('calendar_revision_id', { mode: 'bigint' }),
});

// -----------------------------------------------------------------------------
// content_documents -- 0020_public_surface.sql. FIRM.
// -----------------------------------------------------------------------------
// THE PUBLISHED PAGES, POSTS, FAQS AND LEGAL TEXTS. There is no identity column
// and there is no correct one: a legal document is the same document for every
// reader, and an identity that ACCEPTED one is recorded on the acceptance and
// not on the text.
//
// SUPERSESSION RATHER THAN UPDATE, the same discipline as `daily_marks` and for
// the same reason: the previous answer is evidence. `checksum` is what makes
// "the page a trader accepted" a provable artifact (SD-M9-02), which is only
// worth anything while the superseded row still exists to be checksummed.
export const contentDocuments = pgTable('content_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  slug: text('slug').notNull(),
  locale: text('locale').notNull().default('en'),
  title: text('title').notNull(),
  bodyMdx: text('body_mdx').notNull(),
  version: integer('version').notNull().default(1),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  supersededBy: uuid('superseded_by').references((): AnyPgColumn => contentDocuments.id),
  author: text('author').notNull(),
  // SD-M9-02.
  checksum: bytea('checksum').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// page_revalidations -- 0020_public_surface.sql. FIRM.
// -----------------------------------------------------------------------------
// A CACHE-INVALIDATION LOG FOR THE PUBLIC SURFACE. No identity owns a request
// to re-render a public path, and `reference_id` is deliberately untyped in the
// DDL -- it names whatever the `trigger` was about, a plan version or a content
// document -- so it reaches nothing a rule could traverse and carries no
// `references()` for exactly that reason.
export const pageRevalidations = pgTable('page_revalidations', {
  id: uuid('id').primaryKey().defaultRandom(),
  trigger: text('trigger').notNull(),
  referenceId: uuid('reference_id'),
  paths: text('paths').array().notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// certificates -- 0020_public_surface.sql. OWNED, AND IT CARRIES TWO PATHS.
// -----------------------------------------------------------------------------
// `identity_id uuid NOT NULL REFERENCES identities(id)` is on the row, and
// `account_id` reaches the same identity one hop out through `accounts`. THE
// DIRECT COLUMN IS THE RULE and the hop is not a second opinion: an `owned`
// rule compares a column the database itself declares against `identities(id)`,
// which is the check `scoped-db.test.ts` runs, while a derived rule through
// `accounts` would make this table's tenancy depend on a JOIN that can be
// wrong in a way nothing here would see.
//
// `code` IS DISTINCT FROM `id` ON PURPOSE (SD-M11-01): the public token can be
// ROTATED after an incident without rewriting a primary key, and `signing_key_id`
// is why the first key rotation does not make every historical signature
// unverifiable (INV-M11-06).
//
// `payout_request_id` references `payout_requests`, which is not one of this
// file's tables, so the column is transcribed and the constraint stays the
// database's.
export const certificates = pgTable('certificates', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  kind: text('kind').notNull(),
  payoutRequestId: uuid('payout_request_id'),
  // What Merit actually issued. The public verification page states these FROM
  // THE SIGNED ROW, never from the image.
  claims: jsonb('claims').notNull(),
  signature: bytea('signature').notNull(),
  // SD-M11-01. INV-M11-06.
  signingKeyId: text('signing_key_id').notNull(),
  // SD-M11-01.
  code: text('code').notNull(),
  // SD-M11-01. INV-M11-05.
  claimsSchemaVersion: integer('claims_schema_version').notNull().default(1),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  // INTERNAL free text. The CLASS below is what drives the published sentence,
  // because free text on a public page is how one enforcement gets described
  // inconsistently twice (SD-M11-02, AS-M11-05).
  revokedReason: text('revoked_reason'),
  revocationClass: text('revocation_class'),
  // SD-M11-03. INV-M11-09. An achievement earned while a flag is open is still
  // an achievement, so a deferral needs a state rather than a suppression.
  deferredUntil: timestamp('deferred_until', { withTimezone: true }),
  deferredReason: text('deferred_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// statistic_definitions -- 0021_transparency.sql. FIRM.
// -----------------------------------------------------------------------------
// WHAT A PUBLISHED STATISTIC IS, versioned and superseded rather than edited.
// There is no identity column and there is no correct one: a definition is the
// same definition for every reader, and it is the METHOD rather than a number
// about anybody.
//
// `measures` LIVES ON THE DEFINITION RATHER THAN IN CODE because it is part of
// what the statistic IS (ADR-032). ST-04 is not "average payout, and median as
// a nice extra"; it is a definition whose published form is two figures, and a
// version of it that published one would be a different definition. Declaring
// the set here is what lets 0027's deferred trigger enforce "neither is
// published alone" instead of a reviewer remembering it.
//
// `min_sample` IS A PUBLICATION POLICY AND NOT AN IMPLEMENTATION DETAIL
// (SD-M12-01): below it the statistic is suppressed rather than published with
// a wide error bar nobody reads.
export const statisticDefinitions = pgTable('statistic_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  statCode: text('stat_code').notNull(),
  version: integer('version').notNull(),
  title: text('title').notNull(),
  // THE TWO SPECS ARE THE STATISTIC. Both required, and the denominator is
  // always on the surface.
  numeratorSpec: text('numerator_spec').notNull(),
  denominatorSpec: text('denominator_spec').notNull(),
  exclusions: text('exclusions').array().notNull().default([]),
  windowSpec: text('window_spec').notNull(),
  grain: text('grain').notNull(),
  // SD-M12-01.
  minSample: integer('min_sample').notNull(),
  // ADR-032.
  measures: statisticMeasure('measures').array().notNull(),
  methodBodyMdx: text('method_body_mdx').notNull(),
  adrRef: text('adr_ref'),
  effectiveFrom: date('effective_from').notNull(),
  supersededBy: uuid('superseded_by').references((): AnyPgColumn => statisticDefinitions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// published_statistics -- 0021_transparency.sql. FIRM BY CONSTRUCTION.
// -----------------------------------------------------------------------------
// AN AGGREGATE OVER EVERY IDENTITY, published on a public page. There is no
// identity column and there is no correct one, which is `liability_snapshots`'
// reason on a different surface: a per-identity slice of a firm-wide pass rate
// is not a smaller version of it, it is a different statistic with a sample
// size of one.
//
// `value` IS `bigint` AND THE NO-FLOATS EXEMPTION THIS COLUMN HELD IS GONE
// (ADR-031). It was `value_numeric numeric` on the reading that a published
// rate is not expressible as an integer; all seven ruled statistics are exactly
// representable as integers under the corpus's own conventions -- rates in
// basis points, money in cents, durations in whole seconds. THE CENTS CASE IS
// WHAT DECIDED IT: for ST-03 and ST-04 this column holds MONEY ON A PUBLIC
// SURFACE, and an exemption that covers a money column is a hole with a ruling
// attached.
//
// A SUPPRESSED ROW EXISTS, which is what makes suppression visible rather than
// a gap in a series, and a correction is a NEW ROW pointing at what it
// restates.
export const publishedStatistics = pgTable('published_statistics', {
  id: uuid('id').primaryKey().defaultRandom(),
  statCode: text('stat_code').notNull(),
  definitionVersion: integer('definition_version').notNull(),
  windowStartDay: date('window_start_day').notNull(),
  windowEndDay: date('window_end_day').notNull(),
  asOfTradingDay: date('as_of_trading_day').notNull(),
  // ADR-032. WHICH FIGURE THIS ROW CARRIES. Without it ST-04's mean and median
  // collide on the window uniqueness index and the second is unwritable.
  measure: statisticMeasure('measure').notNull(),
  // ADR-031.
  value: bigint('value', { mode: 'bigint' }),
  valueUnit: statisticUnit('value_unit'),
  // SD-M12-02. A published ratio without its components cannot be checked by
  // the reader.
  numerator: bigint('numerator', { mode: 'bigint' }),
  numeratorUnit: statisticUnit('numerator_unit'),
  denominator: bigint('denominator', { mode: 'bigint' }),
  sampleSize: integer('sample_size').notNull(),
  grainKey: text('grain_key'),
  suppressedReason: text('suppressed_reason'),
  restatementOf: uuid('restatement_of').references((): AnyPgColumn => publishedStatistics.id),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  // SD-M12-02. Makes reproduction VERIFIABLE rather than merely possible.
  inputDigest: bytea('input_digest').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// proof_links -- 0021_transparency.sql. FIRM.
// -----------------------------------------------------------------------------
// THE PUBLISHED LIST OF THINGS A READER CAN VERIFY THEMSELVES. No identity owns
// a link Merit publishes about itself. `scope_note` is NOT NULL because a proof
// link with no stated scope is a claim the reader gets to interpret (SD-M12-04),
// and `enabled` defaults to false so a row exists before it is shown.
export const proofLinks = pgTable('proof_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  url: text('url').notNull(),
  // SD-M12-04.
  scopeNote: text('scope_note').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  addedBy: text('added_by').notNull(),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// review_requests -- 0021_transparency.sql. OWNED: `identity_id`, NOT NULL.
// -----------------------------------------------------------------------------
// ONE ROW PER TIME MERIT ASKED A PERSON FOR A PUBLIC REVIEW, and the row is
// about that person. `identity_id uuid NOT NULL REFERENCES identities(id)` is
// on it.
//
// `trigger_class` IS THE WHOLE DELTA. 'unfavorable' rows are the ones that make
// the set representative, and they are exactly the ones a review-farming design
// would omit (SD-M12-03). A row that was NOT sent still exists and says why,
// which is what makes the omissions countable.
export const reviewRequests = pgTable('review_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  triggerEvent: text('trigger_event').notNull(),
  // SD-M12-03.
  triggerClass: text('trigger_class').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  suppressedReason: text('suppressed_reason'),
  providerRef: text('provider_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// identity_signals -- 0002_identity.sql. OWNED: `identity_id`, NOT NULL.
// -----------------------------------------------------------------------------
// THE ENTITY GRAPH'S NODES, AND ONE ROW IS ONE IDENTITY'S OBSERVATION OF ONE
// THING. `identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE
// RESTRICT` is on the row, so two identities behind one coffee-shop IP produce
// TWO rows and the `owned` rule returns each identity exactly its own.
//
// THIS TABLE IS THE OTHER END OF `scope.ts`'s NAMED TRAP AND IS NOT THE TRAP
// ITSELF. `sessions.device_fingerprint_id` references this table, so deriving
// SESSIONS through it reaches whoever shares a device; that is a defect in a
// rule for `sessions` and says nothing about this table, whose own identity
// column is direct, single and NOT NULL.
//
// `value_hash` IS `bytea` AND IS NOT APPROXIMATED AS `text`. INV-M7-08: the
// card BIN, the device id and the IP are stored as digests and never raw, which
// is the column's own DDL comment. ADR-094 section 3 records that this package
// compares column NAMES and never types, so a `text` here would be a wrong
// transcription that every assertion in the suite would pass.
//
// `kind` IS `text` WITH A CHECK AND THE LIVE CHECK IS WIDER THAN 0002's. 0029
// supersedes it with `identity_signals_kind_allowed` over TEN values, adding
// 'phone' and 'phone_carrier' for ADR-039. That is a CONSTRAINT change and not
// a column change, so ADR-094's fold reads it and discards it; it is written
// here because the table is read AS OF THE LAST MIGRATION and a reader taking
// the 0002 list as current would be eight of ten.
//
// THE SUPERSEDED CONSTRAINT IS DELIBERATELY NOT NAMED. `CI-06/retired-constraints`
// found the first draft of this comment naming it, correctly: a retired name may
// appear only where the appearance retires it or records it, and this file
// describes the LIVE schema. Registering `schema.ts` as a recording site to keep
// the name would be widening a register to fit a comment.
export const identitySignals = pgTable('identity_signals', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  kind: text('kind').notNull(),
  // INV-M7-08. HASHED, never raw.
  valueHash: bytea('value_hash').notNull(),
  // The only human-readable half, deliberately not enough to reconstruct the
  // value it previews.
  valuePreview: text('value_preview'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  observationCount: integer('observation_count').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// detector_definitions -- 0008_risk.sql. FIRM.
// -----------------------------------------------------------------------------
// A DETECTOR'S PARAMETERS, VERSIONED, WITH AN EFFECTIVE DATE. No identity owns
// a threshold Merit tunes about its whole population, and the link runs the
// other way: a `detector_runs` row names the detector and version it ran under.
//
// `is_sensitive` DEFAULTS TO TRUE AND THE DEFAULT IS THE POINT (SD-M7-03): a
// detector parameter that leaks tells the adversary exactly where the line is,
// so a new detector is protected before anybody remembers to protect it.
//
// THE PRIMARY KEY IS COMPOSITE, `(detector, version)`, and it is transcribed
// rather than replaced by a surrogate. A version is not a revision of a row, it
// is another row, which is what makes tuning a threshold a DATA change with a
// recorded effective date rather than a deploy.
export const detectorDefinitions = pgTable(
  'detector_definitions',
  {
    detector: text('detector').notNull(),
    version: text('version').notNull(),
    parameters: jsonb('parameters').notNull(),
    description: text('description').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    // SD-M7-03. Marks the parameters that MUST NEVER REACH A TRADER.
    isSensitive: boolean('is_sensitive').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.detector, t.version] })],
);

// -----------------------------------------------------------------------------
// detector_runs -- 0008_risk.sql. FIRM.
// -----------------------------------------------------------------------------
// ONE ROW PER DETECTOR PER NIGHT, OVER THE WHOLE POPULATION. There is no
// identity column and there is no correct one: a run scans every account and
// the identities it touches are its OUTPUT, recorded on `risk_flags`, rather
// than its owner.
//
// `synthetic_expected` AND `synthetic_found` ARE INV-M7-07 (SD-M7-01). A
// detector whose query silently returns nothing looks exactly like a clean
// night, and seeded synthetic positives are the only way to tell. 0008's
// `detector_runs_synthetics_match_status` makes the counters and the state
// agree in the DATABASE -- `status <> 'ok' OR synthetic_found >=
// synthetic_expected` -- so a run that missed a seeded positive cannot claim
// 'ok'. That constraint is the control; nothing in this file is.
//
// `status` IS `text` AND NOT AN ENUM because 0008 constrains it with a CHECK
// over 'ok', 'failed' and 'degraded' rather than a `CREATE TYPE`, and the
// transcription follows the DDL. 'degraded' is distinct from 'failed' on
// purpose: a run that completed and found fewer synthetics than it seeded did
// not fail, it produced an answer that must not be trusted.
export const detectorRuns = pgTable('detector_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  detector: text('detector').notNull(),
  detectorVersion: text('detector_version').notNull(),
  tradingDay: date('trading_day').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  rowsScanned: integer('rows_scanned').notNull().default(0),
  flagsRaised: integer('flags_raised').notNull().default(0),
  // SD-M7-01. INV-M7-07.
  syntheticExpected: integer('synthetic_expected').notNull().default(0),
  syntheticFound: integer('synthetic_found').notNull().default(0),
  // SD-M7-01 adds 'degraded' to the CHECK list.
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// risk_flags -- 0008_risk.sql. OWNED: `identity_id`, NOT NULL.
// -----------------------------------------------------------------------------
// A FLAG IS ABOUT A PERSON AND THE ROW SAYS SO: `identity_id uuid NOT NULL
// REFERENCES identities(id) ON DELETE RESTRICT`. `account_id` is also present,
// is NULLABLE, and is NOT the scope -- a flag can be about the identity with no
// account named at all (entity_cap, payment_velocity, name_mismatch), so
// deriving through `accounts` would drop exactly the flags that are about the
// person rather than about one of their accounts.
//
// REGISTERING A TABLE MAKES IT READABLE AND NOTHING ELSE, and on this table the
// distinction is worth stating out loud. A scope rule answers HOW A ROW REACHES
// AN IDENTITY; it does not answer who may read it. INV-M7-10 says a trader's
// evidence pack carries no detector detail, and 0008's
// `evidence_packs_trader_gets_no_detector_detail` is where that is enforced --
// on `evidence_packs`, which is not this table and is not registered here.
// Nothing in this rule grants a trader a read of `evidence` or of `flag_type`.
//
// `severity` IS `smallint` WITH `CHECK (severity BETWEEN 1 AND 5)`. A SCORED
// QUEUE, NOT A BOOLEAN, and since ADR-040 severity 4 is load bearing:
// `G-HOLD-REQUIRED` holds a payout on an unresolved 4+ flag, which is why this
// table is money-ADJACENT even though nothing here writes money.
//
// `sla_due_at` AND `first_touched_at` ARE SD-M7-02 AND ARE BOTH NULLABLE. The
// promise is not the columns, it is `risk_flags_high_severity_has_sla` --
// `severity < 4 OR sla_due_at IS NOT NULL` -- so severity 4 and 5 carry a clock
// and 1 to 3 do not. `first_touched_at` is separate from `resolved_at` on
// purpose: "someone looked" and "someone decided" are different service levels
// and only the first can be promised in hours.
export const riskFlags = pgTable('risk_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  accountId: uuid('account_id').references(() => accounts.id),
  flagType: text('flag_type').notNull(),
  // A SCORED QUEUE, NOT A BOOLEAN.
  severity: smallint('severity').notNull(),
  status: riskFlagStatus('status').notNull().default('open'),
  // Reserved: 'internal' or 'vendor:<name>', so a vendor detector plugs in
  // without a migration.
  source: text('source').notNull().default('internal'),
  detectorRunId: uuid('detector_run_id').references(() => detectorRuns.id),
  // THE NUMBERS BEHIND THE ACCUSATION, NEVER A BARE LABEL.
  evidence: jsonb('evidence').notNull(),
  firstDetectedOn: date('first_detected_on').notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: text('resolved_by'),
  resolutionNote: text('resolution_note'),
  // SD-M7-02.
  slaDueAt: timestamp('sla_due_at', { withTimezone: true }),
  firstTouchedAt: timestamp('first_touched_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// correlation_groups -- 0008_risk.sql. FIRM.
// -----------------------------------------------------------------------------
// A GROUP-LEVEL FINDING SPANNING THREE OR MORE ACCOUNTS, AND NO IDENTITY OWNS
// ONE. `correlation_groups_is_a_group` starts the table at three members -- a
// group of one is a pair detector with extra steps and a group of two is
// `identity_links`' job -- and M07 section 3.4 filters same-identity clustering
// AT THE DETECTOR, so a row that exists is a finding ABOUT MORE THAN ONE
// identity by construction.
//
// THE `firm` CLASS HERE IS A REFUSAL AND NOT A DEFAULT. `member_account_ids` is
// `uuid[]`, which the four-class vocabulary cannot traverse in any case --
// `DerivedRule` names one `localColumn` against one `foreignColumn` and an array
// is neither a `hop` nor a `semi-join` -- but the reason it must not be
// traversed is stronger than the reason it cannot be: returning the row to each
// member would tell every member which OTHER accounts the detector grouped them
// with, which is a cross-identity read and the BOLA failure ADR-008 scoped the
// accessor to bound. Firm makes it `systemDb`-only, and `scopePredicate` says so
// by throwing rather than by returning nothing.
//
// `statistic` AND `threshold` ARE `numeric` AND THAT IS NOT A NO-FLOATS
// VIOLATION. The rule governs FINANCIAL paths; a correlation coefficient is not
// one, and rounding it to cents would be the actual error. 0008's own comment
// says this.
export const correlationGroups = pgTable('correlation_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  tradingDay: date('trading_day').notNull(),
  // The group AS A SET. Decomposing it into rows would make "which accounts did
  // this result cover" a query rather than a fact.
  memberAccountIds: uuid('member_account_ids').array().notNull(),
  method: text('method').notNull(),
  statistic: numeric('statistic').notNull(),
  threshold: numeric('threshold').notNull(),
  detectorRunId: uuid('detector_run_id').references(() => detectorRuns.id),
  evidence: jsonb('evidence').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// coupons -- 0006_commerce.sql. FIRM: no identity column, and no correct one.
// -----------------------------------------------------------------------------
// A DISCOUNT CODE IS THE FIRM'S OFFER AND NOT A BUYER'S ROW. What a buyer holds
// is the REDEMPTION, which is the next table down and carries `identity_id`.
//
// `affiliate_id` CARRIES NO `references()` AND IT IS NOT AN OMISSION: it names
// `affiliates`, which nobody has registered, so the rule this file's header
// states applies and the COLUMN alone is transcribed.
//
// `code` IS `citext` AND THAT IS THE POINT OF THE COLUMN. Redemption is
// case-insensitive, so `LAUNCH50` and `launch50` are one code rather than two,
// and a `text()` here would compile, would satisfy the column-name comparison,
// and would be a wrong transcription on the one axis nothing checks.
export const coupons = pgTable('coupons', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: citext('code').notNull(),
  discountKind: text('discount_kind').notNull(),
  discountBp: integer('discount_bp'),
  discountCents: bigint('discount_cents', { mode: 'bigint' }),
  affiliateId: uuid('affiliate_id'),
  // Null means unlimited, which is why the column is nullable rather than
  // defaulted to a large number.
  maxRedemptions: integer('max_redemptions'),
  redemptionCount: integer('redemption_count').notNull().default(0),
  // PER IDENTITY, NOT PER EMAIL: an email limit is a limit on typing.
  perIdentityLimit: integer('per_identity_limit').notNull().default(1),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  isActive: boolean('is_active').notNull().default(true),
  // SD-M3-04. Reset pricing and new-purchase pricing are DIFFERENT PRODUCTS
  // WITH DIFFERENT MARGINS, and without these two one leaked launch code
  // discounts resets forever (AS-M3-04).
  appliesToKind: text('applies_to_kind').notNull().default('any'),
  firstPurchaseOnly: boolean('first_purchase_only').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// coupon_redemptions -- 0006_commerce.sql. OWNED: `identity_id`, NOT NULL.
// -----------------------------------------------------------------------------
// THE ROW IS AN ATOMIC CLAIM AND NOT A READ-THEN-WRITE (B4 #11), which is why
// two tabs cannot both win a single-use code: the insert is the race and
// `coupon_redemptions_live_claim_uq` decides it.
//
// `purchase_id` IS NULLABLE BY DESIGN -- null while the claim is HELD and the
// payment is in flight -- and it is NOT the scope. A row that was claimed and
// abandoned never gets one, and it is still that identity's row: a rule through
// `purchases` would hide exactly the claim-and-abandon pattern this table is
// shaped to keep.
export const couponRedemptions = pgTable('coupon_redemptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  couponId: uuid('coupon_id')
    .notNull()
    .references(() => coupons.id),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  purchaseId: uuid('purchase_id').references(() => purchases.id),
  claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
  // The row SURVIVES a release, so claim-and-abandon is visible rather than
  // erased.
  releasedAt: timestamp('released_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// psp_webhook_events -- 0006_commerce.sql. FIRM: a third party's assertion.
// -----------------------------------------------------------------------------
// KEPT SEPARATELY FROM `events` BECAUSE THESE ARE THIRD-PARTY ASSERTIONS AND
// NOT FACTS MERIT GENERATED, which is the table's own DDL comment and is what
// decides the class. The buyer's row is `purchases`; this is Merit's log of what
// a processor said, including what it said that did not verify.
//
// `purchase_id` IS THE TRAP AND IT IS NULLABLE. It is written by the PROCESSING
// path, so a derived rule would make a row's tenancy a function of whether the
// handler has run yet: the same event would belong to nobody while deferred and
// to somebody once applied. A `rejected_signature` row belongs to nobody at all,
// permanently, and a class that answers "who owns this" differently before and
// after a job runs is not an answer.
export const pspWebhookEvents = pgTable('psp_webhook_events', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  psp: text('psp').notNull(),
  providerEventId: text('provider_event_id').notNull(),
  eventType: text('event_type').notNull(),
  // RECORDED, NOT ASSUMED. A payload whose signature did not verify is still
  // stored, and stored with the fact that it did not verify.
  signatureVerified: boolean('signature_verified').notNull(),
  payload: jsonb('payload').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  processingResult: text('processing_result'),
  // SD-M3-01. Somewhere to park a deferred event and something to drive its
  // re-evaluation (INV-M3-04). The canonical case is a refund arriving before
  // its payment (FM-M3-03): applying it would record a refund against nothing.
  purchaseId: uuid('purchase_id').references(() => purchases.id),
  deferredUntil: timestamp('deferred_until', { withTimezone: true }),
  deferAttempts: integer('defer_attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// mid_health -- 0006_commerce.sql. FIRM: one row per PSP per window.
// -----------------------------------------------------------------------------
// SD-M3-03. Failover needs A DECISION RECORD rather than a live computation, and
// the row is about a PROCESSOR rather than about a person. There is no identity
// column and there is no correct one.
//
// THE COMPOSITE PRIMARY KEY IS `(psp, window_start)` and it is a table-level
// clause in the DDL, so it is declared here in the table config rather than on a
// column. `attempts` is the denominator for `decline_rate_bp` and
// `card_settled_count` is the denominator for `chargeback_rate_bp`: both rates
// are computed against CARD volume and never total volume, because wallet
// purchases carry no chargeback exposure and a healthy shift toward wallet
// funding would otherwise look like a deteriorating ratio and trip failover for
// no reason at all (AS-M3-02). The column names carry that rule and this
// transcription keeps them.
export const midHealth = pgTable(
  'mid_health',
  {
    psp: text('psp').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    declines: integer('declines').notNull().default(0),
    cardSettledCount: integer('card_settled_count').notNull().default(0),
    chargebacks: integer('chargebacks').notNull().default(0),
    // Basis points, integer, like every ratio in this schema.
    declineRateBp: integer('decline_rate_bp').notNull(),
    chargebackRateBp: integer('chargeback_rate_bp').notNull(),
    state: text('state').notNull(),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.psp, t.windowStart] })],
);
