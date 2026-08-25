// =============================================================================
// packages/db/src/schema.ts
// =============================================================================
// TWENTY-SIX TABLES OF 111, AND THAT IS REPORTED RATHER THAN ROUNDED UP. The
// other 85 are not reachable through either accessor: `SCOPE_RULES` is total
// over the keys of this file, so a table that is not here is a COMPILE ERROR at
// the call site rather than an unscoped read at runtime.
//
// THE TWENTY-SIX ARE NOT ONE PHASE'S SET AND WILL NEVER BE. ADR-092 makes the
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
// one lands the check fails rather than silently reading a stale CREATE. FIVE
// of the twenty-six below carry later columns -- `sessions`, `plan_versions`,
// `rule_states`, `identity_phones` and `phone_change_requests` -- and none of
// them could be registered at all before ADR-094, which is why the ruling came
// before the transcription rather than after it.
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
  pgEnum,
  pgTable,
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
// 0001_extensions_and_enums.sql. THE FIVE-VALUE KYC VOCABULARY, and it is the
// one `kyc_verifications.state` is declared against. `pending` is a member here
// and `kyc.pending` is NOT an event name in the approved catalogue, which is a
// divergence session 168 recorded as D1 and which nothing in this file resolves:
// this is the ENUM and the enum says `pending`.
export const kycStatus = pgEnum('kyc_status', [
  'kyc_required',
  'pending',
  'verified',
  'rejected',
  'expired',
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
// kyc_verifications -- 0003_kyc.sql. OWNED: `identity_id`, NOT NULL.
// -----------------------------------------------------------------------------
// A REFERENCE TO A VERIFICATION AND NEVER THE VERIFICATION'S CONTENTS. Merit
// never proxies identity documents: the client goes to the provider's hosted
// flow, and `0003`'s own header states what this table therefore holds --
// "STATUS AND REFERENCES ONLY. Documents, images and biometric templates never
// touch Merit storage (VG-10). Every jsonb column below holds provider decision
// metadata and never document data." `provider_applicant_id` is the pointer and
// `raw_result` is the decision metadata; neither is a document.
//
// WHAT IS DELIBERATELY ABSENT IS PART OF THE TRANSCRIPTION. There is no
// `dedupe_matched_identity_id` column here, and its absence is ADR-029's ruling
// rather than an oversight: a face matching three identities is not expressible
// in one column, so `dedupe_matches` is authoritative and this table keeps only
// the fast boolean `biometric_dedupe_hit`, which can be stale and can never
// contradict the set.
//
// `state` IS THE `kyc_status` ENUM AND `placement`, `verification_purpose` AND
// `liveness_method` ARE `text`. 0003 constrains the latter three with CHECKs
// rather than `CREATE TYPE`, and the transcription follows the DDL. 0029 later
// DROPs and re-ADDs the `verification_purpose` CHECK to admit
// `reverify_phone_change` (SD-M19-07): that is a CONSTRAINT change and not a
// column change, so the fold reads it and discards it, and no column set moves.
export const kycVerifications = pgTable('kyc_verifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  provider: text('provider').notNull(),
  providerApplicantId: text('provider_applicant_id').notNull(),
  state: kycStatus('state').notNull(),
  // U-05. ADR-021's ruled trigger set as a stored value. `pre_eval` is NOT a
  // member: 0003 retires it into `first_purchase` and the CHECK refuses it.
  placement: text('placement').notNull(),
  // The geo-consistency triangle, recorded separately so the disagreement is
  // visible rather than resolved silently. INV-M19-10 is signal-only.
  documentCountry: char('document_country', { length: 2 }),
  ipCountry: char('ip_country', { length: 2 }),
  paymentCountry: char('payment_country', { length: 2 }),
  biometricDedupeHit: boolean('biometric_dedupe_hit').notNull().default(false),
  rejectionReason: text('rejection_reason'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  rawResult: jsonb('raw_result').notNull(),
  // SD-M19-01. A re-verification is a NEW ROW linked to the one it supersedes.
  verificationPurpose: text('verification_purpose').notNull(),
  supersedes: uuid('supersedes').references((): AnyPgColumn => kycVerifications.id),
  livenessPassed: boolean('liveness_passed'),
  livenessMethod: text('liveness_method'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// sanctions_screenings -- 0003_kyc.sql. OWNED: `identity_id`, NOT NULL.
// -----------------------------------------------------------------------------
// THE ONE OUTCOME MERIT MUST ACT ON, AND THE ONE MOST LIKELY TO BE A NAME
// COLLISION. It has its own table rather than living in
// `kyc_verifications.rejection_reason` because folding it in would put a legally
// mandatory refusal in the same field as a blurry-photo rejection.
//
// `list_refs` IS `text[]` AND IS TRANSCRIBED AS AN ARRAY. It names which lists
// were screened and holds no name of any person, which is INV-M19-05's own
// posture: no name in any payload.
export const sanctionsScreenings = pgTable('sanctions_screenings', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  provider: text('provider').notNull(),
  listRefs: text('list_refs').array().notNull(),
  // Basis points, 0 to 10000. Integer, like every other threshold in the corpus.
  matchStrength: integer('match_strength'),
  // 'cleared_on_review' is a DISTINCT terminal state from 'clear': "we looked
  // and it was not them" is a different fact from "nothing matched", and only
  // the first needs a reviewer's name attached.
  status: text('status').notNull(),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNote: text('review_note'),
  screenedAt: timestamp('screened_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// kyc_funnel_events -- 0003_kyc.sql. OWNED: `identity_id`, NOT NULL.
// -----------------------------------------------------------------------------
// THE ABANDONMENT IS THE MEASUREMENT (AS-M19-08). Drop-off per placement cannot
// be reconstructed from `kyc_verifications`, because the traders who matter most
// are the ones who never created a verification row at all -- so `step` carries
// 'abandoned' as a first-class member and `0026_roles_and_grants.sql` REVOKES
// UPDATE and DELETE on this table, which is what makes the record append-only.
//
// `placement` HERE RECORDS WHICH TRIGGER FIRED and never which set was
// configured (ADR-026 widening SD-M19-03). Under ADR-021 the placement is a set
// and the triggers race; storing the configured set would answer a question
// nobody asked and lose the one that decides the post-beta adjudication.
export const kycFunnelEvents = pgTable('kyc_funnel_events', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  placement: text('placement').notNull(),
  planCode: text('plan_code').notNull(),
  step: text('step').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  attemptNumber: integer('attempt_number').notNull().default(1),
  // INTEGER CENTS, like every other money column. This is what turns "a $2
  // identity check in front of a $79 impulse purchase" into a measured figure.
  costCents: bigint('cost_cents', { mode: 'bigint' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// identity_phones -- 0029_phone_identity_and_auth.sql, PLUS THREE COLUMNS FROM
// 0034_reversible_contact_addresses.sql. ADR-094's shape. OWNED: `identity_id`.
// -----------------------------------------------------------------------------
// THE COLUMN SET BELOW IS THE TABLE AS OF THE LAST MIGRATION AND NOT AS OF ITS
// `CREATE TABLE`. `0034` adds `phone_ciphertext`, `phone_key_id` and
// `phone_encrypted_at` (ADR-046); the suite folds those forward and compares the
// whole effective set.
//
// A VERIFIED PHONE IS AN IDENTITY SIGNAL AND NOT A CONTACT FIELD, which is why
// this table is here and not beside `contact_channels`: the delivery address is
// a preference and this is an identity node, and collapsing the two is how a
// contact-preference edit becomes an identity change (M19 section 2, ADR-039).
//
// `phone_hash` IS `bytea` AND IS DECLARED AS ONE. Approximating it as `text`
// would compile and would satisfy the column-name comparison, and it would be a
// wrong transcription of the column the whole hashing discipline turns on.
// `phone_ciphertext` is `bytea` for the same reason and is a SEPARATE fact: the
// hash is what matches, the ciphertext is what can be read back to send to.
//
// SUPERSESSION AND RELEASE ARE DIFFERENT ENDINGS AND A ROW HAS AT MOST ONE.
// Superseded means the trader replaced it; released means the carrier took the
// number back. `ported`, `footprint_present` and `liveness`-style booleans here
// are NULLABLE ON PURPOSE and the NULL is not a `false`: null is "we do not
// know" and false is "the vendor looked and there is none".
export const identityPhones = pgTable('identity_phones', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  phoneHash: bytea('phone_hash').notNull(),
  phonePreview: text('phone_preview'),
  countryCode: char('country_code', { length: 2 }).notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  supersededAt: timestamp('superseded_at', { withTimezone: true }),
  supersededBy: uuid('superseded_by').references((): AnyPgColumn => identityPhones.id),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  releaseEvidence: jsonb('release_evidence').notNull(),
  lineType: text('line_type').notNull().default('unknown'),
  carrierName: text('carrier_name'),
  carrierCountry: char('carrier_country', { length: 2 }),
  ported: boolean('ported'),
  lastPortedAt: timestamp('last_ported_at', { withTimezone: true }),
  footprintPresent: boolean('footprint_present'),
  lookupProvider: text('lookup_provider'),
  lookupAt: timestamp('lookup_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // 0034_reversible_contact_addresses.sql, ADR-046. SUPERSEDED AND RELEASED
  // ROWS KEEP THEIRS, because ADR-039 (c) requires notifying the PRIOR number.
  phoneCiphertext: bytea('phone_ciphertext'),
  phoneKeyId: text('phone_key_id'),
  phoneEncryptedAt: timestamp('phone_encrypted_at', { withTimezone: true }),
});

// -----------------------------------------------------------------------------
// phone_change_requests -- 0029_phone_identity_and_auth.sql, PLUS FIVE COLUMNS
// FROM 0034_reversible_contact_addresses.sql. OWNED: `identity_id`, NOT NULL.
// -----------------------------------------------------------------------------
// THE COLUMN SET BELOW IS THE TABLE AS OF THE LAST MIGRATION. `0034` adds
// `new_phone_ciphertext`, `new_phone_key_id`, `new_phone_encrypted_at`,
// `prior_notified_sms_dispatch_id` and `prior_notified_email_notification_id`.
//
// THE CEREMONY AS STATE, so ADR-039 (c)'s three controls are a precondition of
// the write rather than steps a handler is trusted to take:
// `phone_change_requests_applied_is_complete` requires dual-channel
// verification, prior-number notification and a still-running withdrawal hold
// before `state` may reach 'applied'.
//
// THE TWO NOTIFICATION CITATIONS CARRY NO `.references()` HERE AND THAT IS THE
// FILE'S RULE RATHER THAN AN OMISSION. Both columns are added by `ALTER TABLE
// ... ADD COLUMN` in 0034 and their foreign keys by `ADD CONSTRAINT`, which the
// fold reads and discards, and `integration_dispatches` and `notifications` are
// not tables this file declares. `old_phone_id` DOES carry one: 0029 declares it
// inline and `identity_phones` is above.
export const phoneChangeRequests = pgTable('phone_change_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  state: text('state').notNull().default('pending'),
  // NOT NULL. A change request with no prior phone is not a change, it is a
  // registration, and registration writes `identity_phones` directly.
  oldPhoneId: uuid('old_phone_id')
    .notNull()
    .references(() => identityPhones.id),
  newPhoneHash: bytea('new_phone_hash').notNull(),
  dualChannelVerifiedAt: timestamp('dual_channel_verified_at', { withTimezone: true }),
  priorNotifiedAt: timestamp('prior_notified_at', { withTimezone: true }),
  withdrawalHoldUntil: timestamp('withdrawal_hold_until', { withTimezone: true }),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledReason: text('cancelled_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // 0034_reversible_contact_addresses.sql, ADR-046.
  newPhoneCiphertext: bytea('new_phone_ciphertext'),
  newPhoneKeyId: text('new_phone_key_id'),
  newPhoneEncryptedAt: timestamp('new_phone_encrypted_at', { withTimezone: true }),
  priorNotifiedSmsDispatchId: uuid('prior_notified_sms_dispatch_id'),
  priorNotifiedEmailNotificationId: uuid('prior_notified_email_notification_id'),
});
