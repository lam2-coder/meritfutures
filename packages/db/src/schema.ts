// =============================================================================
// packages/db/src/schema.ts
// =============================================================================
// ELEVEN TABLES OF 111, AND THAT IS REPORTED RATHER THAN ROUNDED UP. The other
// 100 are not reachable through either accessor: `SCOPE_RULES` is total over the
// keys of this file, so a table that is not here is a COMPILE ERROR at the call
// site rather than an unscoped read at runtime.
//
// THE ELEVEN ARE NOT ONE PHASE'S SET AND WILL NEVER BE. ADR-092 makes the owner
// the TABLE rather than the module: a table is registered ONCE, by the first
// session that needs it, and the registration is never re-argued. Every `why` in
// `scope.ts` therefore states that TABLE's tenancy and never the reader's use.
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
// of the eleven below carry later columns -- `sessions`, `plan_versions` and
// `rule_states` -- and none of them could be registered at all before ADR-094,
// which is why the ruling came before the transcription rather than after it.
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
