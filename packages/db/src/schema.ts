// =============================================================================
// packages/db/src/schema.ts
// =============================================================================
// ONE HUNDRED AND ELEVEN TABLES OF 115, PLUS ONE VIEW, AND THAT IS REPORTED
// RATHER THAN ROUNDED UP. The other 4 tables are not reachable through ANY
// accessor: `SCOPE_RULES` is total over the keys of this file, so a relation
// that is not here is a COMPILE ERROR at the call site rather than an unscoped
// read at runtime.
//
// THE ONE VIEW IS `economic_calendar_current` AND ADR-209 IS WHY IT IS COUNTED
// SEPARATELY. It is the only `CREATE VIEW` in the migration set, so "of 115" is
// a count of `CREATE TABLE` and the view is outside that denominator in both
// directions: it is not one of the 115 and it is one of the 112 keys.
//
// THE DENOMINATOR HAS BEEN STALE TWICE AND IS RECOMPUTED HERE RATHER THAN
// INCREMENTED. It read "111" while `0049`, `0050` and `0051` had taken the tree
// to 114, and it then read "109 of 114" while `tradingCalendar` and `0065` had
// taken it to 110 of 115 -- so four sessions in a row moved one of these figures
// and left this sentence behind. Every number in this header is recomputed:
// `TABLE_KEYS.length`, a count of `CREATE TABLE` across `packages/db/migrations`,
// and the class tallies over `SCOPE_RULES`. `test/scoped-db.test.ts` asserts the
// first, which is why the staleness could survive here and not there, and the
// rest are asserted nowhere, which is why they went stale in company.
//
// NOT ALL 112 ARE REACHABLE THROUGH THE SCOPED ONE, AND THE GAP IS TWO CLASSES
// RATHER THAN ONE. 45 are `firm` and 3 are `pair` (ADR-106), so 64 of
// the 112 are served by `scopedDb`. A `pair` table belongs to TWO identities and
// is scoped to neither: it is excluded from `ScopedTableKey` because returning
// the row to either party hands them the other party's identity uuid, and from
// `FirmTableKey` because `firmDb()` takes no reason on the ground that no
// identity is at risk. `systemDb(reason)` is its only door.
//
// ONE OF THE 64 IS THE ONLY MEMBER OF A SIXTH CLASS AND IS SERVED RATHER THAN
// REFUSED (ADR-191). The sentence used to name it by ORDINAL, which made it a
// figure that moves every time anything else is registered, and it had already
// moved once. `events` is `either`: one nullable identity column of its
// own beside one nullable account column, so a row reaches an identity the
// `owned` way, or the `derived` way, or neither, and the predicate is the
// DISJUNCTION of the two legs. It is in `ScopedTableKey` where `pair` is not,
// because no row that predicate returns discloses a second party through a
// tenancy column. It is the only table of that shape in the 115: seven others
// carry both an identities edge and an accounts edge and every one of the seven
// declares its identity column NOT NULL, which makes them `owned` with no
// disjunction to write.
//
// THE ONE HUNDRED AND TWELVE ARE NOT ONE PHASE'S SET AND WILL NEVER BE. ADR-092 makes the
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
// which is ADR-094. That entry ruled the replay's vocabulary CLOSED at one
// member with a default of FAIL, and ADR-103 WIDENED IT TO TWO: `ADD COLUMN` is
// folded, `ALTER COLUMN ... DROP NOT NULL` is folded and moves the NULLABILITY,
// and `DROP COLUMN` and `RENAME` stay offenders that turn the suite red -- so
// the day one of those lands the check fails rather than silently reading a
// stale CREATE. THIS SENTENCE READ "`ALTER COLUMN` STAYS AN OFFENDER" UNTIL
// ADR-106, WHICH IS FALSE ABOUT THIS TREE AND WOULD HAVE TOLD A READER THAT
// `otp_challenges` COULD NOT BE REGISTERED; ADR-094's clause was superseded by
// ADR-103 and the sentence outlived it by one session. THE SAME SENTENCE SURVIVED
// IN TWO MORE PLACES AND COST A SECOND TABLE TEN WAVES: the `trading_calendar_loads`
// and `trading_calendar_revisions` headers below both said the neighbour
// `trading_calendar` "cannot be registered" for that reason, and it is registered
// here. A REFUSAL IN A COMMENT OUTLIVES THE RULING THAT SUPERSEDED IT, and the
// only defence is that a comment naming a ruling is read against it. ELEVEN of
// the 109 below carry later columns -- `sessions`, `plan_versions`, `rule_states`,
// `contact_channels`, `notification_kinds`, `identity_phones`,
// `phone_change_requests`, `admin_actions`, `payout_requests`,
// `promotional_credit_grants` and `otp_challenges` -- and none of them could be
// registered at all before ADR-094, which is why the ruling came before the
// transcription rather than after it. `otp_challenges` IS THE ONLY ONE OF THE
// ELEVEN THAT ALSO CARRIES AN `ALTER COLUMN`, and until it was registered the
// fold's second member ran on no registered table at all. `trading_calendar` IS
// THE SECOND REGISTERED CARRIER AND IS NOT ONE OF THE ELEVEN: it takes TWO
// relaxations and no `ADD COLUMN` at all, so it is a table whose CREATE body is
// its column set and whose NULLABILITY still moved. `events` IS NOT ONE OF
// THE ELEVEN: `0017` is the whole of its DDL and no later migration touches it,
// so the fold replays nothing onto it and the CREATE body is the column set.
// `reserve_coverage_snapshots` IS NOT ONE OF THEM EITHER, and it is the table
// that makes the distinction worth stating twice: `0049` both CREATEs it and
// ALTERs `liability_snapshots` in the same file, so the fold replays a column
// onto a NEIGHBOUR out of the migration that created this one and nothing onto
// this one. `grep 'ALTER TABLE reserve_coverage_snapshots'` over
// `packages/db/migrations` is empty (ADR-199).
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

import { sql } from 'drizzle-orm';
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
  unique,
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

// ADR-028. THE RULED PAYOUT ENUM, AND WHAT IS ABSENT FROM IT IS THE RULING.
// There is no `denied` member and there never may be one (INV-M5-01), and there
// is no `settled_to_wallet`: settlement to the wallet is the only settlement the
// internal leg has, and a status naming its destination invites a second one.
// `transferring` is NOT here either -- it belongs to `wallet_withdrawals`, which
// is the external leg's own object, because two tables tracking one transfer is
// how they disagree. `held_pending_review` is 0030's addition, ADR-040's bounded
// review state, and it sits BEFORE approval rather than between approval and
// settlement, so nothing was inserted into the space INV-M5-01 protects.
export const payoutStatus = pgEnum('payout_status', [
  'approved',
  'settled',
  'failed',
  'frozen',
  'held_pending_review',
]);
// ADR-019's external leg. `wallet_withdrawals` owns the states `payout_requests`
// gave up, plus the two the external rail actually needs. `cooling` is a status
// with no clock of its own on the row, which session 159 recorded and which a
// transcription does not repair.
export const walletWithdrawalStatus = pgEnum('wallet_withdrawal_status', [
  'requested',
  'cooling',
  'approved',
  'transferring',
  'settled',
  'failed',
  'cancelled',
]);

// 0001_extensions_and_enums.sql. THE PROVISIONING SAGA'S SIX STATES, and
// `confirmed_inferred` is a DISTINCT state rather than a synonym for
// `confirmed` (U-06, M02 section 3.2). An inferred confirmation means Merit
// believes the account exists because the vendor reported on it, which is
// strong evidence for `create_account` and WORTHLESS for `set_risk`: you
// cannot infer that a risk setting applied from an account appearing in a
// report. `provisioning_queue_set_risk_never_inferred` in 0007 is where that
// is enforced, and this type is why the enforcement can be written at all.
export const provisioningStatus = pgEnum('provisioning_status', [
  'queued',
  'written',
  'delivered',
  'confirmed',
  'confirmed_inferred',
  'failed',
]);
// 0001_extensions_and_enums.sql. THE QUARANTINE MACHINE'S VOCABULARY (B4 #4).
// `quarantined` is a terminal state a whole FILE reaches, never a row: 0013
// processes a file in one transaction so that a quarantined file has committed
// no downstream rows at all.
export const ingestFileStatus = pgEnum('ingest_file_status', [
  'received',
  'parsing',
  'parsed',
  'quarantined',
  'applied',
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
  // 0004:59 declares this FK inline and `plans` is one of this file's tables as
  // of session 195, so the reference is claimed here rather than left bare.
  planId: uuid('plan_id')
    .notNull()
    .references((): AnyPgColumn => plans.id),
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
export const planVersionSizes = pgTable(
  'plan_version_sizes',
  {
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
  },
  // THE SIZE GRID'S KEY IS `(plan_version_id, size_cents)` AND IT IS TRANSCRIBED
  // HERE FOR `coupons.code`'s REASON, ONE SPELLING FURTHER OUT.
  // `0004_catalog.sql:220` declares it as a standalone `CREATE UNIQUE INDEX
  // plan_version_sizes_version_size_uq`, which is the spelling `getTableConfig`
  // cannot see at all, so this table sat in the set `keyed-accessor.test.ts`
  // measures as "the transcription is behind the DDL somewhere" and
  // `{ planVersionId, sizeCents }` was refused as an address that can match more
  // than one row.
  //
  // IT IS WRITTEN AS A CONSTRAINT WHERE THE DDL WRITES AN INDEX, AND THE
  // DIFFERENCE IS STATED RATHER THAN GLOSSED. `uniqueKeys()` reads
  // `config.uniqueConstraints` and does not read `config.indexes`, and this file
  // generates no DDL -- the migrations are hand written and merged (constitution
  // E2) -- so what is transcribed is the PROPERTY the accessor needs, which is
  // that this column set bounds the row count to one. A unique index does that
  // exactly as a unique constraint does. `certificates.code` took the same move
  // on one column (ADR-231); this is the two-column spelling of it. ADR-233.
  (table) => [
    unique('plan_version_sizes_version_size_uq').on(table.planVersionId, table.sizeCents),
  ],
);

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
// firm rows -- `firm_treasury`, `psp_clearing`, `fees_revenue`, `reserve` and
// `withdrawals_in_flight` (ADR-187) -- fall out of a scoped read WITHOUT a
// second predicate. That is why the class is `owned` and not something weaker.
// The eighth code strengthens rather than weakens the argument: it is the
// external leg's in-flight obligation, a FIRM position that no identity may see,
// and it falls out of a scoped read by the same NULL.
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
  // OI-01, ADR-128, added by 0049. NOT NULL with no default in the DDL, which is
  // the point of it: a defaulted zero is a number the dashboard would render and
  // nobody counted. P-M6-01 is a sum "across funded accounts" and this is the
  // count that says whether that sum is one account or a thousand.
  fundedAccounts: integer('funded_accounts').notNull(),
});

// -----------------------------------------------------------------------------
// reserve_coverage_snapshots -- 0049_reserve_coverage_snapshots.sql. FIRM, and
// the class is the DDL's rather than a judgement.
// -----------------------------------------------------------------------------
// ADR-199. THE NUMBER THAT DECIDES WHETHER SALES PAUSE, and it is the firm's
// against the firm's own floor: `reserve / CVaR99 at rho = 0.30`, below 1.0 the
// circuit breaker pauses new sales and never pauses payouts (GLOSSARY). This is
// `liability_snapshots`' reason on a different surface -- a per-identity slice
// of a firm-wide coverage RATIO is not a smaller version of it -- and the row
// declares no column against `identities(id)` for the assertion to find.
//
// ITS ONE FOREIGN KEY REACHES `treasury_balances`, WHICH IS FIRM, so a `derived`
// rule through it would be `affiliate_commissions`' refusal in a second dress: a
// derivation chain terminates at `owned` or at `root`. It could not be written
// in any case, because the edge is COMPOSITE -- `(treasury_account_code,
// treasury_as_of)` against `treasury_balances(account_code, as_of)` -- and
// `DerivedRule` names ONE `localColumn` against ONE `foreignColumn`.
//
// THE ANCHOR COLUMNS CARRY NO `.references()` AND THAT IS THIS FILE'S OWN RULE.
// The header admits `.references()` only where the `CREATE TABLE` body declares
// the FK INLINE; `reserve_coverage_snapshots_anchor_fk` is a table-level
// CONSTRAINT, so the constraint is left to the database and the COLUMNS alone
// are transcribed. `0049`'s foreign key is verified in `scoped-db.test.ts`
// against the migration text rather than claimed here.
//
// `rcr_bp` IS GENERATED AND IS THEREFORE NULLABLE, which is `0049` header item 2
// rather than an omission: `NULLIF(cvar99_cents, 0)` is load-bearing, because a
// generated column is computed BEFORE the row's CHECK constraints run, so
// without it a zero denominator raises a bare `division by zero` and
// `reserve_coverage_snapshots_cvar99_is_positive` never fires at all. The
// expression is INTEGER ARITHMETIC on bigint cents: no float enters the reserve
// path.
//
// `breaker_armed` IS NOT A COLUMN AND NEVER WILL BE. Armed is `rcr_bp < 10000`,
// a rendering against a threshold the GLOSSARY fixes at 1.0, and storing it
// would recreate in one column exactly the drift the generated ratio removes
// from another.
export const reserveCoverageSnapshots = pgTable('reserve_coverage_snapshots', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  // THE RAIL'S CLOCK, and the second of the three reasons `0049` gives for this
  // being a table rather than a column set on `liability_snapshots`: one row
  // would force one `as_of` onto two sources that do not move together.
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  // THE NUMERATOR. The rail's reported balance, copied from the row named below
  // and asserted equal to it at write time by `RESERVE-C1`, which is a trigger
  // and therefore not expressible here. INV-M5-11: reported against a LIVE
  // balance, never one derived from our own ledger.
  reserveCents: bigint('reserve_cents', { mode: 'bigint' }).notNull(),
  // THE ANCHOR, as a reference rather than a restatement. `treasury_balances` is
  // keyed `(account_code, as_of)`, and naming the row is what makes P-M6-07's
  // attestation staleness a join instead of two more columns that can disagree
  // with their source (ADR-047).
  treasuryAccountCode: text('treasury_account_code').notNull(),
  treasuryAsOf: timestamp('treasury_as_of', { withTimezone: true }).notNull(),
  // THE DENOMINATOR, AND IT IS THE FLOOR RATHER THAN THE ESTIMATE. P-M6-07's
  // CVaR99 at rho = 0.30, never the simulation harness's central estimate, and
  // ADR-019 put wallet balances inside it (GS-130).
  cvar99Cents: bigint('cvar99_cents', { mode: 'bigint' }).notNull(),
  // GENERATED, and NULLABLE for the reason the block above gives. Integer basis
  // points, so a stored ratio cannot disagree with the two numbers beside it.
  rcrBp: integer('rcr_bp').generatedAlwaysAs(
    sql`(reserve_cents * 10000) / NULLIF(cvar99_cents, 0)`,
  ),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
// `phase` IS `account_phase` FROM `0067` (ADR-216) AND WAS BARE `text` BEFORE
// IT. This comment said the DDL and the type disagreed and that the DDL wins;
// what it recorded was a DEFECT rather than a decision. `0001:45` had declared
// `account_phase` as exactly the engine's four `Phase` members since the estate
// began and `0015:47` typed this column `text` with no CHECK, so the table
// replay compares against admitted ANY STRING as a phase, on a column that is
// hash input 3. `0067` moves the column onto the type it should always have
// carried; `0015` is not edited (constitution E2). The type IS the vocabulary
// and there is no second copy of it here.
//
// `state_hash` IS STILL DELIBERATELY NOT A NUMBER OR AN ENUM: it is `bytea`
// with a CHECK that its length is 32. There the transcription does follow the
// DDL, which is the source and which this file transcribes.
export const ruleStates = pgTable('rule_states', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  tradingDay: date('trading_day').notNull(),
  // 0067, ADR-216. `account_phase`, the type 0001:45 declares as the engine
  // `Phase` union; `text` until then, admitting any string.
  phase: accountPhase('phase').notNull(),
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
  // 0065_rule_state_lifetime_and_breach.sql, ADR-207. THE THREE FIELDS
  // `RuleState` REQUIRES AND `0015` NEVER DECLARED. Until 0065 the engine's own
  // type was not persistable in this schema.
  //
  // `readEligibility` STILL REJECTS AND THIS IS NO LONGER WHY. Session 405
  // measured it and left the repair to this fence: the storage gap 0065 closed
  // is spent, and the refusal survives on grounds this file is not the record
  // of. `rule_states` holds ZERO rows and no deployable schedules the batch
  // that would write one; `RuleStateWriterIo.encodeEngineGates` has no
  // implementation and `UNWIRED_RULE_STATE_WRITER_IO` refuses it by name
  // (`apps/worker/src/batch/state-writer.ts`); and the same absence binds the
  // READ side, because `RuleState.engineGates` is `EngineGateResults` while
  // `engine_gates` above is `jsonb`, so an adapter handed a row would have to
  // INVENT a decoding. That encoding is `B5` term 2 and is a corpus amendment
  // rather than a line of code.
  //
  // `breached` IS DERIVABLE FROM `breachKind` AND IS STORED ANYWAY. The pair is
  // bound by `rule_states_breach_flag_matches_kind`, so a mapping that carries
  // one and drops the other is refused at the store rather than writing a row
  // that says a breached account is not breached.
  //
  // `breachKind` IS TYPED `text` AND NOT AN ENUM, and the vocabulary lives in a
  // CHECK. `packages/db/test/rule-state-breach-vocabulary.test.ts` derives
  // `BreachKind` from `packages/rules-engine/src/types.ts` and compares it to
  // the migration, so the copy has a comparator rather than a reader.
  //
  // NONE OF THE THREE IS A `state_hash` INPUT TODAY and none is ruled excluded
  // either: ADR-026 C-07's nineteen stand because `HASHED_COLUMNS` lives in
  // `packages/rules-engine`, and ADR-207 section 5 is the open question.
  lifetimeSettledCents: bigint('lifetime_settled_cents', { mode: 'bigint' }).notNull().default(0n),
  breached: boolean('breached').notNull().default(false),
  breachKind: text('breach_kind'),
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
  // SD-M11-01. THE UNIQUE IS `certificates_code_uq`, AND IT IS TRANSCRIBED HERE
  // RATHER THAN LEFT TO THE MIGRATION BECAUSE `uniqueKeys()` READS THIS FILE.
  // `0020_public_surface.sql` declares the key as a separate `CREATE UNIQUE
  // INDEX` rather than inline, which is a spelling `getTableConfig` cannot see,
  // so this column sat in the set `keyed-accessor.test.ts` measures as "the
  // transcription is behind the DDL somewhere" and `{ code }` was refused as an
  // address that "can match more than one row". The database has bounded it to
  // one row since 0020; only the transcription did not say so. ADR-231.
  code: text('code').notNull().unique('certificates_code_uq'),
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
  // THE UNIQUE IS TRANSCRIBED HERE BECAUSE `uniqueKeys()` READS THIS FILE AND
  // NOT THE DDL. `0006_commerce.sql:38` declares `code citext NOT NULL UNIQUE`
  // inline and unnamed, so Postgres names the constraint `coupons_code_key`;
  // `getTableConfig` sees a Drizzle column's `isUnique` flag and nothing about a
  // migration, so before this line `{ code }` was refused by `refuseUnaddressed`
  // as an address that "can match more than one row". The database has bounded
  // it to one row since `0006`; only the transcription did not say so. This is
  // `certificates.code`'s repair one table over (ADR-231), and the address
  // `CheckoutTx.couponByCode` needs. ADR-233.
  code: citext('code').notNull().unique('coupons_code_key'),
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

// -----------------------------------------------------------------------------
// notification_kinds -- 0019_notifications_and_community.sql, PLUS ONE COLUMN
// FROM 0029. FIRM.
// -----------------------------------------------------------------------------
// THE POLICY CATALOGUE, AND THERE IS NO IDENTITY COLUMN BECAUSE THERE IS NO
// CORRECT ONE. A kind is the same kind for every trader: `class` decides what a
// preference may silence, and it decides it once for the estate rather than per
// person. The link runs the other way, `notifications.kind` naming the kind a
// message was sent under, so ownership flows FROM the catalogue exactly as it
// does from `plan_versions`.
//
// IT IS THE PLAUSIBLE VERSION OF `plan_version_sizes`' MISTAKE AND IT IS WORTH
// SAYING HERE AS WELL AS IN `scope.ts`. `notifications.kind` and
// `notification_preferences.kind` are both `NOT NULL REFERENCES
// notification_kinds(kind)`, which reads exactly like the `hop` `daily_marks`
// makes to `accounts` and is not one: this table is firm, `scopePredicate`
// raises on a firm via, and both tables carry `identity_id` on the row anyway.
//
// TWO GENERATED COLUMNS, AND BOTH ARE THE MODULE'S POLICY IN DDL. `mutable` is
// `class IN ('account_state','marketing')` (SD-M16-01) and `rate_limit_exempt`
// is `class IN ('security','money')` (SD-M16-07, 0029). As ordinary booleans one
// careless row could mark a money notification silenceable or the registration
// OTP kind exempt, and nothing would object; generated, the two facts cannot
// disagree at all. They are transcribed as generated for the same reason `bytea`
// is not transcribed as `text`: a writable boolean here would be a false
// statement about a column nothing else in this package checks.
//
// `class` GAINED `pre_identity_auth` IN 0029 and `rate_limit_exempt` is the
// column that came with it. The value is a CHECK rather than a `CREATE TYPE`, so
// the transcription follows the DDL and the column is `text`.
export const notificationKinds = pgTable('notification_kinds', {
  kind: text('kind').primaryKey(),
  class: text('class').notNull(),
  title: text('title').notNull(),
  templateCode: text('template_code').notNull(),
  templateVersion: integer('template_version').notNull().default(1),
  defaultChannels: text('default_channels').array().notNull().default(['in_app']),
  // SD-M16-01. GENERATED ALWAYS, never written independently.
  mutable: boolean('mutable').generatedAlwaysAs(sql`class IN ('account_state', 'marketing')`),
  coalesceKeySpec: text('coalesce_key_spec'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // 0029_phone_identity_and_auth.sql, SD-M16-07. GENERATED ALWAYS, and INV-M16-11
  // written as a column: the security and money classes are exempt from rate
  // limiting, and NC-M16-05's pre-identity class is not, by construction.
  rateLimitExempt: boolean('rate_limit_exempt').generatedAlwaysAs(
    sql`class IN ('security', 'money')`,
  ),
});

// -----------------------------------------------------------------------------
// notifications -- 0019_notifications_and_community.sql. OWNED: `identity_id`
// is on the row, NOT NULL.
// -----------------------------------------------------------------------------
// EVERY MESSAGE MERIT HAS SENT ONE PERSON, one row each. `identity_id uuid NOT
// NULL REFERENCES identities(id) ON DELETE RESTRICT` is the tenancy and the row
// is about that person.
//
// `kind` IS THE TRAP AND IT IS NOT THE SCOPE. It is `NOT NULL REFERENCES
// notification_kinds(kind)`, and `notification_kinds` is FIRM: a `derived` rule
// through it compiles at every call site, is a member of `ScopedTableKey`, and
// throws the first time anybody reads the table. The direct column is the rule.
//
// `class` AND `template_version` ARE DENORMALIZED AT SEND TIME AND THAT IS THE
// POINT. The class a message was sent under is a historical fact; the kind's
// class today is a current policy, and reclassifying a kind must not rewrite
// what was already sent under the old one. `rendered_body` is what makes a
// message reproducible years later (INV-M16-05), and `sent_at`,
// `delivery_status`/`delivered_at` and `read_at` are THREE DIFFERENT FACTS,
// which is what makes INV-M16-09's distinction between dispatch, delivery and
// reading expressible at all.
//
// `dispatch_ref` CARRIES NO `references()` AND IT IS NOT AN OMISSION: it points
// at `integration_dispatches`, which nobody has registered, so the COLUMN is
// transcribed and the constraint stays the database's.
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  kind: text('kind')
    .notNull()
    .references(() => notificationKinds.kind),
  channel: text('channel').notNull(),
  payload: jsonb('payload').notNull().default({}),
  readAt: timestamp('read_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  // SD-M16-02.
  class: text('class').notNull(),
  templateVersion: integer('template_version').notNull(),
  renderedBody: text('rendered_body'),
  coalesceKey: text('coalesce_key'),
  dispatchRef: uuid('dispatch_ref'),
  deliveryStatus: text('delivery_status').notNull().default('pending'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// notification_preferences -- 0019_notifications_and_community.sql. OWNED:
// `identity_id` is on the row, NOT NULL.
// -----------------------------------------------------------------------------
// ONE ROW PER IDENTITY PER KIND PER CHANNEL, and the row is that person's
// answer. `identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE
// RESTRICT` is the tenancy; `kind` is `notifications`' trap again and is again
// not the scope.
//
// THE COMPOSITE PRIMARY KEY IS THE GRAIN AND IT IS TRANSCRIBED. `PRIMARY KEY
// (identity_id, kind, channel)` is a table-level clause in the DDL, so the
// column comparison the suite runs would be satisfied without it and the
// declaration would still be saying this table has no key.
//
// WHAT A PREFERENCE MAY DO IS NOT DECIDED HERE. A row against an immutable kind
// is PERMITTED TO EXIST and is ignored by the send path, because refusing to
// store it produces a settings screen that lies about what it saved. The
// deciding column is `notification_kinds.mutable`, one table over and generated.
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    identityId: uuid('identity_id')
      .notNull()
      .references(() => identities.id),
    kind: text('kind')
      .notNull()
      .references(() => notificationKinds.kind),
    channel: text('channel').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.identityId, table.kind, table.channel] })],
);

// -----------------------------------------------------------------------------
// contact_channels -- 0019_notifications_and_community.sql, PLUS FOUR COLUMNS
// FROM 0034 AND 0041. OWNED: `identity_id` is on the row, NOT NULL.
// -----------------------------------------------------------------------------
// THE PREVIOUS CONTACT EXISTS AS A ROW, which is the entire reason this table is
// not a column on `users`. INV-M16-03's account-takeover countermeasure is to
// notify the PRIOR contacts for a window after a change, and that is impossible
// against a value somebody overwrote. Supersession rather than update, for
// `daily_marks`' reason on a different surface, so a scoped read returns the
// superseded rows as well as the live one and that is correct: they are the same
// person's addresses.
//
// FOUR LATER COLUMNS, AND THE FOLD IS WHY THEY ARE HERE. `0034` adds
// `value_ciphertext`, `value_key_id` and `value_encrypted_at`; `0041` adds
// `complained_at`. ADR-094 is what makes the set below comparable at all.
//
// ADR-046 IS THE ONE TO READ BEFORE BELIEVING `value_hash` IS THE WHOLE STORY.
// The address is held REVERSIBLY: `value_ciphertext` is envelope-encrypted under
// a key named by `value_key_id` AND NOT PRESENT IN THIS DATABASE, the hash stays
// for matching and uniqueness, and a dump yields the same nothing it yielded
// before. `merit_app` can read the ciphertext and cannot decrypt one, so a
// scoped read of this table returns a sealed blob rather than an address.
// All three columns are NULLABLE and the null is load bearing in two directions:
// a row written before `0034` has a hash and no ciphertext, and ERASURE IS A
// NULL that leaves the hash, the lineage and the evidence standing.
//
// `complained_at` IS A FACT ABOUT THE DESTINATION AND NOT A PREFERENCE
// (INV-M16-13). It suppresses the marketing class and nothing else; a send path
// consulting it before a security-class message locks a trader out of OTP login
// for having once reported a newsletter.
//
// `superseded_by` IS A SELF-REFERENCE and carries drizzle's explicit
// `(): AnyPgColumn =>` return type, without which the inference is circular and
// `tsc` refuses the file.
export const contactChannels = pgTable('contact_channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  kind: text('kind').notNull(),
  // `bytea` rather than `text`, on this file's own rule: the digest is what
  // makes matching possible without a second plaintext copy of every address.
  valueHash: bytea('value_hash').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  supersededAt: timestamp('superseded_at', { withTimezone: true }),
  supersededBy: uuid('superseded_by').references((): AnyPgColumn => contactChannels.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // 0034_reversible_contact_addresses.sql, ADR-046.
  valueCiphertext: bytea('value_ciphertext'),
  valueKeyId: text('value_key_id'),
  valueEncryptedAt: timestamp('value_encrypted_at', { withTimezone: true }),
  // 0041_contact_channel_complaints.sql, SD-M16-08.
  complainedAt: timestamp('complained_at', { withTimezone: true }),
});

// -----------------------------------------------------------------------------
// otp_send_budget -- 0029_phone_identity_and_auth.sql. FIRM.
// -----------------------------------------------------------------------------
// PRE-IDENTITY BY CONSTRUCTION, WHICH IS A STRONGER STATEMENT THAN "no identity
// column". INV-M16-12 splits INV-M16-11: a message to an authenticated recipient
// at an address Merit already holds is exempt from rate limiting, and a message
// to an ATTACKER-SUPPLIED DESTINATION BEFORE ANY IDENTITY EXISTS is not. This
// table is the second one's control, so there is no identity to own a row and
// there could not be: the whole point of the rows is that nobody has proved who
// they are yet.
//
// `scope_key` IS THE COLUMN A DERIVATION WOULD REACH FOR AND IT IS NOT AN
// IDENTITY. For `phone` it is `encode(phone_hash,'hex')` and never the number,
// for `ip` the address, for `country` the alpha-2, for `global` the literal
// 'global'. It declares no foreign key and there is nothing to traverse.
//
// THE COMPOSITE PRIMARY KEY IS THE GRAIN: one row per scope per evaluation day,
// on `plan_breaker_state`'s pattern from 0016 rather than a new idiom. Daily
// granularity is deliberate; sub-minute velocity belongs at the edge, where a
// send can be refused before it is paid for.
//
// `state` HAS THREE MEMBERS AND THE MISSING FOURTH IS THE FOUNDER'S RULING.
// There is no stopping value: a tripped breaker DEGRADES, registration still
// completes with verification deferred, and `deferred_registrations` is the
// figure that has to be reported because a queue nobody drains is a fail-open
// with extra steps.
export const otpSendBudget = pgTable(
  'otp_send_budget',
  {
    scopeKind: text('scope_kind').notNull(),
    scopeKey: text('scope_key').notNull(),
    evaluatedOn: date('evaluated_on').notNull(),
    sends: integer('sends').notNull().default(0),
    sendLimit: integer('send_limit').notNull(),
    // Integer cents, per the constitution and DATA_MODEL section 1.
    spendCents: bigint('spend_cents', { mode: 'bigint' }).notNull().default(0n),
    budgetCents: bigint('budget_cents', { mode: 'bigint' }).notNull(),
    state: text('state').notNull().default('armed'),
    trippedAt: timestamp('tripped_at', { withTimezone: true }),
    // THE ALARM IS NOT OPTIONAL. `otp_send_budget_degraded_is_alarmed` refuses to
    // store a silent trip, because a degraded mode nobody is watching becomes the
    // normal mode.
    alarmRaisedAt: timestamp('alarm_raised_at', { withTimezone: true }),
    recoveredAt: timestamp('recovered_at', { withTimezone: true }),
    deferredRegistrations: integer('deferred_registrations').notNull().default(0),
    overrideReason: text('override_reason'),
    overrideExpiresAt: timestamp('override_expires_at', { withTimezone: true }),
    changedBy: text('changed_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.scopeKind, table.scopeKey, table.evaluatedOn] })],
);

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

// -----------------------------------------------------------------------------
// events -- 0017_events_and_audit.sql. EITHER: `identity_id` on the row, or
// `account_id` -> accounts, one hop. ADR-191.
// -----------------------------------------------------------------------------
// THE APPEND-ONLY SPINE, AND THE FIRST TABLE IN THIS FILE WHOSE TENANCY IS A
// PROPERTY OF THE ROW RATHER THAN OF THE TABLE. `identity_id uuid NULL` and
// `account_id uuid NULL` are both declared, neither is required, and there is no
// CHECK tying them, so one row reaches an identity through its own column, the
// next through the account's, and a third through neither.
//
// THIS TABLE WAS DELIBERATELY NOT DECLARED HERE FOR SIXTEEN SESSIONS, which is
// why it arrives with an entry rather than as a transcription. Session 195 left
// it out of this file ON PURPOSE, on session 192's model: a declared but
// unregistered `pgTable` is one no drift assertion compares, because `DDL_NAMES`
// is derived from `TABLE_KEYS`. Leaving it out of `SCOPE_RULES` alone would have
// been half the refusal. ADR-191 is the ruling that ends it.
//
// NO LATER MIGRATION TOUCHES IT. `0017` is the whole of this table's DDL, so the
// fold has nothing to replay and the CREATE body IS the column set as of the
// last migration. That is checked rather than stated: the drift assertion reads
// the migrations and would fail here if a later `ADD COLUMN` existed.
//
// `identity_id` AND `account_id` BOTH CARRY `.references()` because both foreign
// keys are declared INLINE in the `CREATE TABLE` body and both targets are this
// file's tables, which is the rule stated at the top of this file.
//
// `subject_kind` / `subject_id` ARE NOT THE TENANCY AND THE DISTINCTION IS THE
// ONE A LATER SESSION WILL GET WRONG. `0017`'s own comment calls the pair a
// "polymorphic subject", not a foreign key, "because the subject can be any of a
// dozen kinds"; a plan version and a payout request are subjects and neither is
// a person. `subject_id uuid NOT NULL` is on EVERY row including the firm ones,
// so a rule reading it would return every event ever written to whoever's uuid
// happened to match, which is the confidently-wrong derivation this package's
// registry docblock opens by refusing.
//
// `payload` HOLDS A THIRD PARTY'S UUID ON EXACTLY TWO EVENT NAMES AND NO SCOPE
// RULE REACHES INSIDE ONE. `kyc.dedupe_hit` carries `matched_identity_id` and
// `identity.merged` carries `merged_identity_id` (EVENTS.md section 3). ADR-191
// section 6 rules that a scope rule states which ROWS reach an identity and
// nothing about what is inside one -- `idempotency_keys`' own words, out of this
// same migration set -- and registers the two names as a projection's obligation
// rather than a class's.
export const events = pgTable('events', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  eventName: text('event_name').notNull(),
  // PAYLOADS EVOLVE AND CONSUMERS MUST KNOW WHICH SHAPE THEY HOLD. A consumer
  // that infers the shape from the fields present breaks silently the day a
  // field becomes optional.
  schemaVersion: smallint('schema_version').notNull().default(1),
  // WHEN THE FACT HAPPENED versus WHEN WE LEARNED IT. Both, because they diverge
  // on exactly the events where the difference matters: vendor corrections, late
  // webhooks, backfills.
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  // THE TWO LEGS OF THE `either` RULE. Both nullable, and the nullability is the
  // class rather than a gap: a firm event carries neither.
  identityId: uuid('identity_id').references(() => identities.id),
  accountId: uuid('account_id').references(() => accounts.id),
  subjectKind: text('subject_kind').notNull(),
  subjectId: uuid('subject_id').notNull(),
  payload: jsonb('payload').notNull(),
  actorKind: text('actor_kind').notNull(),
  actorId: text('actor_id'),
  correlationId: uuid('correlation_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// admin_actions -- 0017_events_and_audit.sql, 0043_admin_attributed_actions.sql.
// FIRM.
// -----------------------------------------------------------------------------
// MERIT'S RECORD OF ITS OWN OPERATORS, and `reason text NOT NULL` is the whole
// control: 0017's own words are "NO UNEXPLAINED ADMIN ACTION, EVER".
//
// TWO LATER COLUMNS, AND THIS IS THE FIRST REGISTERED TABLE WHOSE DRIFT IS
// M06's. `initiative` and `on_behalf_of_identity_id` arrive in 0043 as two
// `ADD COLUMN` statements, which ADR-094's fold replays; the third statement in
// that file is an `ADD CONSTRAINT` carrying the biconditional, which the fold
// reads and discards.
//
// `on_behalf_of_identity_id` CARRIES NO `.references()` AND THAT IS THE FILE'S
// RULE RATHER THAN AN OVERSIGHT. Its `REFERENCES identities(id)` is declared
// inline on an `ALTER TABLE ... ADD COLUMN`, not in the `CREATE TABLE` body,
// and the fold extracts the column NAME from an `ADD COLUMN` clause and nothing
// else. Claiming the edge here would be claiming something nothing in this
// package checks.
export const adminActions = pgTable('admin_actions', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  // POLYMORPHIC AND UNCONSTRAINED. `subject_id` is a bare uuid with no foreign
  // key, discriminated by `subject_kind`: a session, a phone-change request, a
  // payout request, a plan version. It does not name an identity.
  subjectKind: text('subject_kind').notNull(),
  subjectId: uuid('subject_id').notNull(),
  reason: text('reason').notNull(),
  before: jsonb('before').notNull(),
  after: jsonb('after').notNull(),
  evidenceRefs: jsonb('evidence_refs').notNull().default([]),
  ip: inet('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // SD-M6-11, 0043. ON WHOSE INITIATIVE, which is not who performed it.
  initiative: text('initiative').notNull(),
  // SD-M6-11, 0043. Set exactly when `initiative = 'trader_request'`, by the
  // biconditional CHECK in the same migration.
  onBehalfOfIdentityId: uuid('on_behalf_of_identity_id'),
});

// -----------------------------------------------------------------------------
// evidence_packs -- 0008_risk.sql. DERIVED: `account_id` -> accounts, one hop.
// -----------------------------------------------------------------------------
// AN EXPORT OF ONE ACCOUNT'S EVIDENCE, so the row is about whoever holds that
// account. `account_id uuid NOT NULL REFERENCES accounts(id)` is the only path
// and it is single-valued, so the hop cannot multiply rows.
//
// `audience` AND `includes_detector_detail` ARE THE COMBINATION 0008 MAKES
// UNREPRESENTABLE (SD-M6-04): a pack destined for a trader may never carry
// detector detail, because a pack given to a trader in a dispute is a channel
// that discloses thresholds to the adversary who triggered them.
export const evidencePacks = pgTable('evidence_packs', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  requestedBy: text('requested_by').notNull(),
  reason: text('reason').notNull(),
  contentSha256: bytea('content_sha256').notNull(),
  // Private object storage, signed URL only. Never a public path.
  storageRef: text('storage_ref').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  // SD-M6-04.
  audience: text('audience').notNull(),
  redactionProfile: text('redaction_profile').notNull(),
  includesDetectorDetail: boolean('includes_detector_detail').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// identity_restriction_episodes -- 0031_payout_hold_and_identity_restriction.sql.
// OWNED: `identity_id`, NOT NULL.
// -----------------------------------------------------------------------------
// ONE ROW PER TIME MERIT RESTRICTED A PERSON, and the row is about that person.
// `identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` is on
// it, and `identity_restriction_open_uq` allows at most one open episode per
// identity, so a second restriction on a restricted human is a database refusal
// rather than a duplicate record.
//
// `flag_id` CARRIES NO `.references()` because `risk_flags` is not one of this
// file's tables. The column is transcribed and the edge is left to the database.
//
// THE RESTORE IS THE HALF THAT GETS SKIPPED UNDER PRESSURE (INV-M6-14), and
// `identity_restriction_restore_is_complete` makes `restored_at`, `restored_by`
// and `restore_evidence` all-or-none. `sla_due_at` is one of INV-M6-13's three
// clocks and no admin route may write it after the row exists.
export const identityRestrictionEpisodes = pgTable('identity_restriction_episodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  flagId: uuid('flag_id').notNull(),
  tosClause: text('tos_clause').notNull(),
  reason: text('reason').notNull(),
  openedBy: uuid('opened_by')
    .notNull()
    .references(() => users.id),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  // ADR-040's 48 hour SLA, where a payout is pending. Null when none is.
  slaDueAt: timestamp('sla_due_at', { withTimezone: true }),
  restoredAt: timestamp('restored_at', { withTimezone: true }),
  restoredBy: uuid('restored_by').references(() => users.id),
  restoreEvidence: text('restore_evidence'),
  evidencePackId: uuid('evidence_pack_id').references(() => evidencePacks.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// ledger_halts -- 0016_treasury_controls.sql. OWNED, AND THE COLUMN IS NOT NULL.
// -----------------------------------------------------------------------------
// `identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` at
// 0016:55, and the DDL states the requirement in the direction that decides the
// rule in its own comment: "null is not permitted, because a halt with no
// subject is the global halt and the global halt is not a row, it is an
// incident." So the class is `owned` and it needed no per-table ruling; what it
// needed was a session that reached it, and ADR-092 section 9 named it as one of
// four nobody would.
//
// THE OTHER COLUMNS ARE EVIDENCE AND CLOCKS AND NONE OF THEM REACHES A PERSON.
// `halted_by` and `released_by` are `text` -- a detector name or an operator --
// and not `uuid REFERENCES users(id)`, which is what would otherwise look like a
// second path to an identity. `evidence jsonb` holds whatever tripped the
// detector; a scope rule states which ROWS reach an identity and nothing about
// what is inside one.
export const ledgerHalts = pgTable('ledger_halts', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  reasonCode: text('reason_code').notNull(),
  reasonNote: text('reason_note').notNull(),
  evidence: jsonb('evidence').notNull().default({}),
  haltedAt: timestamp('halted_at', { withTimezone: true }).notNull().defaultNow(),
  haltedBy: text('halted_by').notNull(),
  escalateAt: timestamp('escalate_at', { withTimezone: true }).notNull(),
  escalatedAt: timestamp('escalated_at', { withTimezone: true }),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  releasedBy: text('released_by'),
  releaseNote: text('release_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// plan_breaker_state -- 0016_treasury_controls.sql. FIRM.
// -----------------------------------------------------------------------------
// ONE ROW PER PLAN PER EVALUATION DAY, and a per-plan loss ratio is an aggregate
// over every account on the plan. There is no identity column and there is no
// correct one: a per-identity slice of a plan's loss ratio is not a smaller
// version of it, which is `published_statistics`' reason on an internal surface.
//
// `plan_id` NOW CARRIES `.references()`, and it did not before session 195.
// This file's rule is that a column carries one only when its `CREATE TABLE`
// body declares the FK inline AND the target is one of this file's tables;
// 0016:127 always declared it inline, and `plans` became one of this file's
// tables when M04's slice registered it. The second half of the condition
// changed, not the first.
//
// `sample_size` BESIDE `min_sample` IS SD-M6-02 AND INV-M6-07: below its own
// minimum the only honest state is `insufficient_data`, and
// `plan_breaker_state_respects_min_sample` makes that structural rather than
// procedural. An `insufficient_data` breaker is never a breach.
//
// THE PRIMARY KEY DOES NOT WIDEN AND THE PASS-RATE CUSUM DOES NOT LIVE HERE
// (ADR-167). `metric text NOT NULL` sits OUTSIDE `(plan_id, evaluated_on)` in
// 0016 and stays outside it: one plan-day is one row and one row is one metric.
// API_CONTRACT's `per_plan` carries a `cusum: { statistic, threshold, alarm }`
// object beside the four fields this table does hold, 0049 dispositioned the
// whole field as needing nothing, and it checked four of the five. ADR-167 rules
// that `S_t` is FOLDED AT READ TIME from the account series and is never stored,
// so NO CUSUM VALUE IS EVER WRITTEN INTO `ratio_bp`, `threshold_bp`,
// `numerator_cents`, `denominator_cents` OR `sample_size` -- those are the loss
// ratio's columns and their names are load-bearing.
//
// THE FORECLOSURE IS WRITTEN HERE BECAUSE THIS IS WHERE ITS VIOLATOR WOULD BE
// STANDING. A session adding a CUSUM column to this declaration, or adding
// `metric` to the `primaryKey` below, is superseding ADR-167 rather than
// extending a table, and what it has to answer is that `state`'s `'paused'`
// value would then govern the added rows: `per_plan.sales_paused` derives from
// `state = 'paused'`, so a second metric sharing this key gets a column that
// spells a REVENUE PAUSE for a statistic whose own panel gloss is "inspect".
//
// `scope.ts` carries none of this on purpose: that file's rule is that every
// `why` states the TABLE's tenancy and never the reader's use, and a CUSUM is a
// use.
export const planBreakerState = pgTable(
  'plan_breaker_state',
  {
    planId: uuid('plan_id')
      .notNull()
      .references((): AnyPgColumn => plans.id),
    evaluatedOn: date('evaluated_on').notNull(),
    metric: text('metric').notNull(),
    numeratorCents: bigint('numerator_cents', { mode: 'bigint' }).notNull(),
    denominatorCents: bigint('denominator_cents', { mode: 'bigint' }).notNull(),
    // SD-M6-02.
    sampleSize: integer('sample_size').notNull(),
    ratioBp: integer('ratio_bp').notNull(),
    thresholdBp: integer('threshold_bp').notNull(),
    // SD-M6-02.
    minSample: integer('min_sample').notNull(),
    state: text('state').notNull(),
    // An override is dated and expires. An indefinite override is a disabled
    // breaker with a nicer name.
    overrideReason: text('override_reason'),
    overrideExpiresAt: timestamp('override_expires_at', { withTimezone: true }),
    changedBy: text('changed_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.planId, table.evaluatedOn] })],
);

// -----------------------------------------------------------------------------
// alarm_suppressions -- 0016_treasury_controls.sql. FIRM.
// -----------------------------------------------------------------------------
// MERIT MUTING ITS OWN ALARM. The row is about an operational decision Merit
// made about its own monitoring, never about a person: `scope jsonb` may NAME an
// account or an identity, and a jsonb payload is not a column a predicate can be
// written against.
//
// `expires_at NOT NULL` IS THE CONTROL (SD-M6-03, INV-M6-06) and it is real. The
// UNSUPPRESSIBLE SET IS NOT: `alarm_key text NOT NULL` carries no CHECK and no
// reference list, so this table will accept a row muting the ledger-imbalance
// alarm as readily as any other. That is M06 section 3.5's own stated limit and
// OQ-M6-05 is the open question; nothing here closes it.
export const alarmSuppressions = pgTable('alarm_suppressions', {
  id: uuid('id').primaryKey().defaultRandom(),
  alarmKey: text('alarm_key').notNull(),
  scope: jsonb('scope').notNull().default({}),
  reason: text('reason').notNull(),
  suppressedBy: text('suppressed_by').notNull(),
  suppressedAt: timestamp('suppressed_at', { withTimezone: true }).notNull().defaultNow(),
  // SD-M6-03.
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// dual_control_approvals -- 0016_treasury_controls.sql. FIRM.
// -----------------------------------------------------------------------------
// TWO OPERATORS, ONE SENSITIVE ACT. The row is about Merit's own authorisation
// procedure. `subject_id uuid NOT NULL` is polymorphic and carries no foreign
// key, discriminated by `subject_kind`, so it does not name an identity.
//
// `dual_control_approvals_second_person` IS THE CONTROL ITSELF, IN DDL: the
// approver is not the requester. Without it the table records two clicks by one
// session and calls it dual control, which Appendix D names as worse than
// nothing because it reads as a control in an audit.
export const dualControlApprovals = pgTable('dual_control_approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  subjectKind: text('subject_kind').notNull(),
  subjectId: uuid('subject_id').notNull(),
  requestedBy: text('requested_by').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  // SD-M6-05. Pins WHAT is being approved, so an approval cannot travel to a
  // different payload.
  payloadHash: bytea('payload_hash').notNull(),
  approvedBy: text('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// account_adjustments -- 0038_account_adjustments.sql. OWNED: `identity_id`,
// NOT NULL. MONEY.
// -----------------------------------------------------------------------------
// THE FIRST ADMIN SURFACE IN THIS CORPUS THAT MOVES MONEY TO A NAMED PERSON, and
// the first table that permits taking it back (ADR-067). `identity_id uuid NOT
// NULL REFERENCES identities(id) ON DELETE RESTRICT` is on the row and
// `account_id` is NULLABLE, so the identity is the scope and the account is not:
// an adjustment may name no account at all and would then be unreachable under
// an account-derived rule.
//
// `amount_cents` IS A MAGNITUDE AND `direction` CARRIES THE SIGN, checked
// positive in the DDL. NEVER A BALANCE MUTATION: `ledger_transaction_id uuid NOT
// NULL UNIQUE` means an adjustment posts a ledger transaction or it does not
// exist.
//
// `promotional_credit_grant_id` CARRIES NO `.references()` because
// `promotional_credit_grants` is not one of this file's tables.
export const accountAdjustments = pgTable('account_adjustments', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  accountId: uuid('account_id').references(() => accounts.id),
  direction: text('direction').notNull(),
  amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
  reasonCode: text('reason_code').notNull(),
  reasonNote: text('reason_note').notNull(),
  // NEVER `trader_withdrawable`: the engine computes withdrawable from the
  // trading balance, so a ledger credit there would buy no eligibility and only
  // make the ledger disagree with the engine.
  destination: text('destination').notNull(),
  ledgerTransactionId: uuid('ledger_transaction_id')
    .notNull()
    .references(() => ledgerTransactions.id),
  promotionalCreditGrantId: uuid('promotional_credit_grant_id'),
  // A debit is only ever the exact reversal of a credit this table posted.
  reversesAdjustmentId: uuid('reverses_adjustment_id').references(
    (): AnyPgColumn => accountAdjustments.id,
  ),
  actor: text('actor').notNull(),
  dualControlThresholdCents: bigint('dual_control_threshold_cents', { mode: 'bigint' }).notNull(),
  dualControlApprovalId: uuid('dual_control_approval_id').references(() => dualControlApprovals.id),
  evidencePackId: uuid('evidence_pack_id').references(() => evidencePacks.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// economic_calendar_loads -- 0039_economic_calendar.sql. FIRM.
// -----------------------------------------------------------------------------
// ONE ROW PER INGESTED PUBLICATION OF A THIRD PARTY'S RELEASE SCHEDULE. There is
// no identity column and there is no correct one: a load is the same load for
// every reader, and `actor text NOT NULL` is a loader or an operator rather than
// a `users` row, which is 0002's `actor` idiom.
//
// THE COVERAGE WINDOW IS WHAT MAKES STALENESS ANSWERABLE (FM-M7-08). A D-04 run
// over a day outside every load's coverage must REFUSE rather than report no
// releases, because "no releases" and "we never loaded that week" produce the
// same empty result set and mean opposite things.
export const economicCalendarLoads = pgTable('economic_calendar_loads', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  sourceId: text('source_id').notNull(),
  coverageStartDay: date('coverage_start_day').notNull(),
  coverageEndDay: date('coverage_end_day').notNull(),
  sourceDigest: bytea('source_digest').notNull(),
  actor: text('actor').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// economic_calendar -- 0039_economic_calendar.sql. FIRM.
// -----------------------------------------------------------------------------
// WHEN A TIER-1 MACRO RELEASE IS SCHEDULED, which is a fact about the world and
// not about anybody. Every identity reads the same calendar, and D-04's news
// windows are computed from it for all of them at once.
//
// `revision` IS THE LOAD-BEARING COLUMN. 0 is the original publication and each
// revision of a release time is a NEW ROW at the next number, so "what did the
// calendar say when D-04 read it" is answerable forever. A flag raised against a
// trader has to be defensible months later.
export const economicCalendar = pgTable('economic_calendar', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  loadId: bigint('load_id', { mode: 'bigint' })
    .notNull()
    .references(() => economicCalendarLoads.id),
  eventKey: text('event_key').notNull(),
  occurrenceKey: text('occurrence_key').notNull(),
  tier: smallint('tier').notNull(),
  // One instant, in UTC, no timezone column. Rendered per trader.
  scheduledReleaseAt: timestamp('scheduled_release_at', { withTimezone: true }).notNull(),
  releaseTradingDay: date('release_trading_day').notNull(),
  revision: integer('revision').notNull(),
  // Required on a revision, refused on an original, by an equivalence CHECK.
  revisionReason: text('revision_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// economic_calendar_current -- 0039_economic_calendar.sql. FIRM. A VIEW.
// -----------------------------------------------------------------------------
// THE FIRST RELATION IN THIS FILE THAT IS NOT A TABLE, AND ADR-209 IS WHY IT IS
// HERE AT ALL. `0039` declares exactly one `CREATE VIEW` and it is the only one
// in the sixty migrations: `SELECT DISTINCT ON (event_key, occurrence_key) ...
// ORDER BY event_key, occurrence_key, revision DESC` over `economic_calendar`,
// which the migration calls "the only definition of that anywhere".
//
// IT IS TRANSCRIBED BECAUSE THE READER READS IT AND NEVER THE BASE TABLE.
// `apps/api/src/routes/economic-calendar.ts` declares `EconomicCalendarSource`
// against this view in its own words, and an adapter that read
// `economic_calendar` instead would have to re-derive the maximum revision --
// which is the second-source-of-truth failure `FM-M7-08` guards and the exact
// thing `0039` created the view to make impossible. Refusing to register it does
// not keep the derivation out of the tree; it moves it into an adapter where
// nothing compares it to the view.
//
// A VIEW HAS NO KEY, NO FOREIGN KEY AND NO CONSTRAINT, AND THE OMISSIONS BELOW
// ARE THE DDL RATHER THAN AN OVERSIGHT. `id` is `bigint GENERATED ALWAYS AS
// IDENTITY PRIMARY KEY` on the base table and is a plain projected column here,
// so `uniqueKeys` finds nothing and every addressed write is refused before it
// reaches the database -- which is the safe direction, and it is also what the
// database would have said, because a `DISTINCT ON` view is not auto-updatable.
//
// THE TYPES AND NULLABILITY ARE THE BASE TABLE'S, BECAUSE THE ROWS ARE. The
// projection renames nothing and computes nothing, so each column below is
// `economic_calendar`'s column unchanged, and `packages/db/test/scoped-db.test.ts`
// asserts that against `economic_calendar`'s folded DDL rather than against a
// `CREATE TABLE` this relation does not have.
export const economicCalendarCurrent = pgTable('economic_calendar_current', {
  id: bigint('id', { mode: 'bigint' }).notNull(),
  loadId: bigint('load_id', { mode: 'bigint' }).notNull(),
  eventKey: text('event_key').notNull(),
  occurrenceKey: text('occurrence_key').notNull(),
  tier: smallint('tier').notNull(),
  scheduledReleaseAt: timestamp('scheduled_release_at', { withTimezone: true }).notNull(),
  releaseTradingDay: date('release_trading_day').notNull(),
  revision: integer('revision').notNull(),
  revisionReason: text('revision_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// -----------------------------------------------------------------------------
// report_schedules -- 0040_report_schedules.sql. FIRM.
// -----------------------------------------------------------------------------
// WHAT MERIT SENDS ITSELF, ON WHAT CADENCE, TO WHICH OPERATOR MAILBOX. The
// recipients are Merit's own staff and the row is about the firm's C8 weekly
// risk ritual, not about any trader.
//
// `cadence` IS A GENERATED COLUMN AND THAT IS THE POINT (SD-M6-07): the cadence
// is a PROPERTY OF THE DIGEST rather than a choice, so as an ordinary column a
// daily liability digest could be scheduled monthly by one careless insert and
// nothing would object.
//
// NO CREDENTIAL IS STORED HERE and there is deliberately no column that could
// hold one. `recipients` is a mailbox for `email` and a configured destination
// name for `sftp`.
export const reportSchedules = pgTable('report_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  digest: text('digest').notNull(),
  cadence: text('cadence')
    .notNull()
    .generatedAlwaysAs(
      sql`CASE ${sql.identifier('digest')} WHEN 'daily_liability' THEN 'daily' WHEN 'weekly_loss_ratio_cusum' THEN 'weekly' WHEN 'weekly_flag_queue' THEN 'weekly' WHEN 'monthly_revenue_cohort' THEN 'monthly' END`,
    ),
  format: text('format').notNull(),
  channel: text('channel').notNull(),
  recipients: text('recipients').array().notNull(),
  // Turned off rather than deleted: a deleted schedule takes its delivery
  // history's referent with it and the alarm's question stops being answerable.
  enabled: boolean('enabled').notNull().default(true),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// report_deliveries -- 0040_report_schedules.sql. FIRM.
// -----------------------------------------------------------------------------
// ONE ROW PER ATTEMPT TO DELIVER A DIGEST. Its only foreign key is
// `schedule_id -> report_schedules(id)`, and `report_schedules` is FIRM, so a
// `derived` rule here would not be a milder mistake: `scopePredicate` recurses
// into the via table and a chain terminates at `owned` or at `root` or it does
// not terminate. A firm parent makes the whole chain firm.
//
// THE DELIVERY-FAILURE ALARM READS THIS TABLE AND NEVER THE JOB'S OWN REPORT.
// `due_at` is what makes absence detectable at all: without it "nothing arrived"
// and "not due yet" are the same empty result set.
//
// `artifact_digest bytea NULL` IS THE SHA-256 AND NEVER THE ARTIFACT. A table of
// rendered digest bodies would be the bulk export, sitting behind an admin
// route, created by the feature admitted on the promise that it was not one.
export const reportDeliveries = pgTable('report_deliveries', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  scheduleId: uuid('schedule_id')
    .notNull()
    .references(() => reportSchedules.id),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  // A retry is a NEW ROW rather than an update of the failed one.
  attempt: integer('attempt').notNull(),
  // INV-M6-04: every number names its as-of moment and its source.
  coversThroughTradingDay: date('covers_through_trading_day').notNull(),
  // Transcribed at attempt time rather than joined from the mutable schedule.
  channel: text('channel').notNull(),
  format: text('format').notNull(),
  recipientsAttempted: text('recipients_attempted').array().notNull(),
  recipientsOmitted: text('recipients_omitted').array().notNull().default([]),
  omissionReason: text('omission_reason'),
  // Two values. There is no `skipped`.
  outcome: text('outcome').notNull(),
  failureReason: text('failure_reason'),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  artifactDigest: bytea('artifact_digest'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// impersonation_sessions -- 0042_impersonation_sessions.sql. OWNED:
// `subject_identity_id`, NOT NULL. AUTH.
// -----------------------------------------------------------------------------
// THE ROW IS ABOUT THE TRADER WHO WAS IMPERSONATED, and `admin_user_id` is this
// package's own named trap: `scope.ts`'s header says a mechanical foreign-key
// walk reaches THE ADMIN'S IDENTITY, not the subject's, and returns rows for the
// wrong person with no error anywhere. `subject_identity_id uuid NOT NULL
// REFERENCES identities(id) ON DELETE RESTRICT` is the column the database
// declares against `identities(id)`, and it is the one a dispute turns on.
//
// THE TABLE CARRIES NO `user_id`, NO `auth_factor`, NO `elevated_at` AND NO
// `elevated_by_factor`, WHICH IS STRUCTURAL AND NOT AN OMISSION (ADR-068). The
// trader auth path resolves a bearer token by `refresh_token_hash` on
// `sessions`, so a token minted here cannot satisfy a trader authorization by
// construction rather than by rule.
//
// NO `created_at`. `started_at` is the row's clock and the two-hour ceiling is
// measured from it by `impersonation_box_is_bounded`; a configurable duration
// with no ceiling is a setting rather than a bound.
export const impersonationSessions = pgTable('impersonation_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminUserId: uuid('admin_user_id')
    .notNull()
    .references(() => users.id),
  subjectIdentityId: uuid('subject_identity_id')
    .notNull()
    .references(() => identities.id),
  tokenHash: bytea('token_hash').notNull(),
  reasonCode: text('reason_code').notNull(),
  reasonDetail: text('reason_detail').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  endedBy: uuid('ended_by').references(() => users.id),
  endReason: text('end_reason'),
});

// -----------------------------------------------------------------------------
// impersonation_page_views -- 0042_impersonation_sessions.sql. DERIVED:
// `impersonation_session_id` -> impersonation_sessions, one hop.
// -----------------------------------------------------------------------------
// EVERY PAGE AN OPERATOR SAW WHILE WEARING A TRADER'S SESSION, and it reaches an
// identity through the session's SUBJECT rather than through its admin. The
// chain is one hop to `impersonation_sessions`, which is `owned` by
// `subject_identity_id`, so it terminates at an identity and the trap the parent
// table names is not re-entered here.
//
// `route` IS THE COLUMN NAME. M06 section 11 specifies `path`; 0042 writes
// `route`, and the DDL is the source.
export const impersonationPageViews = pgTable('impersonation_page_views', {
  id: uuid('id').primaryKey().defaultRandom(),
  impersonationSessionId: uuid('impersonation_session_id')
    .notNull()
    .references(() => impersonationSessions.id),
  route: text('route').notNull(),
  viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// affiliates -- 0005_affiliate_program.sql. OWNED: `identity_id`, NOT NULL.
// -----------------------------------------------------------------------------
// AN AFFILIATE IS AN IDENTITY, and that is the table's own DDL comment rather
// than an inference: `identity_id uuid NOT NULL REFERENCES identities(id) ON
// DELETE RESTRICT`. It is what makes the self-deal check possible at all (B4
// #16), and it is what makes "the affiliate is a human Merit has restricted"
// (INV-M8-12) a query rather than a guess.
//
// `parent_id` IS THE TRAP AND IT IS NOT THE SCOPE. It references this same
// table, reserved for sub-IB trees and unused in v1, so a derived rule through
// it would scope a person's own affiliate row to their RECRUITER. The direct
// column the database declares against `identities(id)` is the rule.
//
// `balance_cents` IS MONEY AND IT IS SIGNED. Negative is owed to Merit, which
// is the case SD-M8-04 exists for, and `affiliates_negative_balance_has_clock`
// ties it to `negative_balance_since` in both directions. Integer cents,
// transcribed as `bigint` with `mode: 'bigint'`, never a float.
//
// `tos_version_id` CARRIES NO `.references()` HERE. `tos_versions` is not one
// of this file's tables, and this file's rule is that a claimed constraint
// nothing in this package checks is worse than the column alone.
export const affiliates = pgTable('affiliates', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  // `citext` and NOT `text`: a referral code that differs only in casing is the
  // same code to every human who types it.
  code: citext('code').notNull().unique(),
  parentId: uuid('parent_id').references((): AnyPgColumn => affiliates.id),
  level: smallint('level').notNull().default(0),
  commissionBp: integer('commission_bp').notNull(),
  status: text('status').notNull().default('active'),
  tosVersionId: uuid('tos_version_id').notNull(),
  // The fast gate. SD-M8-03 gives it a record of WHAT was approved; this stays
  // as the boolean.
  creativeApproved: boolean('creative_approved').notNull().default(false),
  chargebackRateBp: integer('chargeback_rate_bp').notNull().default(0),
  // SD-M8-04. INV-M8-06. Signed integer cents.
  balanceCents: bigint('balance_cents', { mode: 'bigint' }).notNull().default(0n),
  // SD-M8-04. The clock on a carried debt. A debt with no start date is one
  // nobody escalates, and the escalation is the enforcement.
  negativeBalanceSince: date('negative_balance_since'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// affiliate_creatives -- 0005_affiliate_program.sql. DERIVED: `affiliate_id`
// -> affiliates, one hop.
// -----------------------------------------------------------------------------
// SD-M8-03, INV-M8-08. WHAT WAS APPROVED, rather than the bare boolean on the
// parent row: NFA I-26-12 requires the disclosure to accompany the claim, and
// that is a PER-CREATIVE fact. `affiliate_id uuid NOT NULL REFERENCES
// affiliates(id) ON DELETE RESTRICT` is the only path to an identity and it is
// single-valued, so the hop cannot multiply rows.
//
// `reviewed_by` IS `text` AND NOT A `users` FOREIGN KEY. The DDL declares it
// `text NULL` with no reference, so there is nothing here a derived rule could
// traverse even if the reviewer were the tenancy, and the reviewer is not: a
// creative belongs to the affiliate who submitted it and not to the operator
// who read it.
//
// `disclosure_version_id` CARRIES NO `.references()`, for `affiliates`' reason:
// its target `tos_versions` is not one of this file's tables.
export const affiliateCreatives = pgTable('affiliate_creatives', {
  id: uuid('id').primaryKey().defaultRandom(),
  affiliateId: uuid('affiliate_id')
    .notNull()
    .references(() => affiliates.id),
  kind: text('kind').notNull(),
  // The URL, or a storage reference for something that has none.
  urlOrRef: text('url_or_ref').notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').notNull().default('pending'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  disclosureVersionId: uuid('disclosure_version_id'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// affiliate_clicks -- 0005_affiliate_program.sql. DERIVED: `affiliate_id` ->
// affiliates, one hop.
// -----------------------------------------------------------------------------
// THE 30-DAY COOKIE WINDOW'S RAW EVENTS. High volume and never in a URL, so the
// key is `bigint GENERATED ALWAYS AS IDENTITY` rather than a uuid.
//
// A CLICK BELONGS TO THE AFFILIATE AND NOT TO THE PERSON WHO CLICKED, and the
// DDL is what says so: there is no identity column, no `user_id` and no
// `purchase_id` on this table at all. `ip`, `user_agent` and
// `click_fingerprint` are the closest things to a clicker and NONE of them is a
// tenancy -- an IP reaches whoever shares a network and a fingerprint reaches
// whoever shares a browser, which is `sessions.device_fingerprint_id`'s trap
// arriving on a different table.
//
// `click_fingerprint` IS `bytea` AND IS TRANSCRIBED AS ONE. Declaring it
// `text()` would compile and would satisfy the column-name comparison the suite
// runs, which is exactly the axis ADR-094 section 3 records is checked nowhere.
//
// `suspicious_reason` IS SET BY THE DETECTOR AND NOT BY THE CLICK HANDLER. Null
// means "not examined", which is a different state from "examined and clean",
// and SD-M8-02 is why the four provenance columns exist at all: last-touch
// attribution over a 30 day window is stealable by volume, and the theft is
// invisible without knowing where a click came from (AS-M8-03).
//
// NO `updated_at`. A click is an observation and observations are not edited.
export const affiliateClicks = pgTable('affiliate_clicks', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  affiliateId: uuid('affiliate_id')
    .notNull()
    .references(() => affiliates.id),
  clickToken: uuid('click_token').notNull().defaultRandom(),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  landingPath: text('landing_path'),
  clickedAt: timestamp('clicked_at', { withTimezone: true }).notNull().defaultNow(),
  // SD-M8-02. The single highest-value one: a click with no referrer arriving
  // at a deep product path is the signature of an injected pixel rather than a
  // person who read something and followed a link.
  referrerHost: text('referrer_host'),
  landingIsDirect: boolean('landing_is_direct').notNull().default(false),
  clickFingerprint: bytea('click_fingerprint'),
  suspiciousReason: text('suspicious_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// affiliate_statements -- 0012_disputes_and_affiliate_settlement.sql. DERIVED:
// `affiliate_id` -> affiliates, one hop.
// -----------------------------------------------------------------------------
// SD-M8-01. WHAT MERIT OWES ONE AFFILIATE FOR ONE PERIOD, monthly and immutable
// once issued. `0012` creates it BEFORE `affiliate_commissions` because that
// table's `paid_in_statement_id` references it.
//
// THE CLASS IS `affiliate_creatives`' AND `affiliate_clicks`' AND IT NEEDED NO
// RULING: `affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE
// RESTRICT` is the only path to an identity, it is single-valued so the hop
// cannot multiply rows, and `affiliates` carries the identity. Two siblings on
// this exact shape were registered `derived` by earlier sessions and this is the
// third, which is why `ADR-209` rules on the OTHER relation in its slice and not
// on this one.
//
// `total_cents` IS SIGNED AND THAT IS WHAT MAKES THE TENANCY MATTER. A
// clawback-heavy month is negative, so a wrong rule here shows one affiliate the
// money another is owed, or owes. `affiliates.balance_cents` one hop out is
// signed for the same reason and is already `owned`.
//
// `paid_transfer_ref` IS `text NULL` WITH NO FOREIGN KEY and is the only column
// that reads like a second path. It names a row in a payment provider's
// database rather than one in this one, which is `payout_destinations`'
// `destination_ref` arriving on the affiliate rail.
//
// `affiliate_statements_period_uq` IS TRANSCRIBED RATHER THAN LEFT OUT, and
// `treasury_balances` is why: a key the DDL declares and `schema.ts` does not is
// an address ADR-112 refuses, so the period a caller actually names would be
// unaddressable while the database was bounding it all along.
export const affiliateStatements = pgTable(
  'affiliate_statements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    affiliateId: uuid('affiliate_id')
      .notNull()
      .references(() => affiliates.id),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    // Signed: a clawback-heavy month is negative.
    totalCents: bigint('total_cents', { mode: 'bigint' }).notNull(),
    status: text('status').notNull().default('draft'),
    paidTransferRef: text('paid_transfer_ref'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('affiliate_statements_period_uq').on(table.affiliateId, table.periodStart)],
);

// -----------------------------------------------------------------------------
// payout_requests -- 0010_payouts.sql, PLUS FIVE COLUMNS FROM 0031. ADR-094's
// shape. OWNED: `identity_id` is on the row, NOT NULL.
// -----------------------------------------------------------------------------
// THE COLUMN SET BELOW IS THE TABLE AS OF THE LAST MIGRATION AND NOT AS OF ITS
// `CREATE TABLE`. `0031_payout_hold_and_identity_restriction.sql` adds `held_at`,
// `hold_flag_id`, `hold_expires_at`, `hold_tos_clause` and `hold_reason`, all
// five in one `ADD COLUMN` statement; the suite folds them forward and compares
// the whole effective set, which is why this table could not be registered at
// all before ADR-094.
//
// TWO COLUMNS REACH THE SAME IDENTITY AND THE DIRECT ONE IS THE RULE.
// `account_id` reaches it one hop out through `accounts`; `identity_id` is
// declared `REFERENCES identities(id)` on this row and 0010's own comment says
// it is DENORMALIZED DELIBERATELY, because the aggregate-exposure question
// "how much is this human extracting right now" cannot be a join if it is being
// asked inside the race it is protecting against. That is `certificates`'
// reading on the money table, and getting it wrong here returns another
// identity's payout history.
//
// `status` IS THE `payout_status` TYPE AND `balance_reflection_status` IS `text`
// WITH A CHECK. The transcription follows the DDL in both cases rather than
// promoting the second to an enum it does not have.
//
// `hold_flag_id` CARRIES NO `.references()` AND THAT IS THIS FILE'S RULE RATHER
// THAN AN OMISSION: the header states that a column carries one only when its
// `CREATE TABLE` body declares the FK inline. This one is declared inside
// 0031's `ADD COLUMN`, which the fold reads for its column NAME alone, so a
// constraint claimed here would be a claim nothing in this package checks.
// `freeze_flag_id`, whose FK is in the `CREATE TABLE` body, does carry one.
export const payoutRequests = pgTable('payout_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  requestedCents: bigint('requested_cents', { mode: 'bigint' }).notNull(),
  // After the clamp: min(requested, withdrawable, cap). The clamp can only
  // reduce, by `payout_requests_approved_within_requested`.
  approvedCents: bigint('approved_cents', { mode: 'bigint' }).notNull(),
  // The split legs. `trader_cents` becomes the WALLET payable and `firm_cents`
  // becomes revenue, and `trader_cents + firm_cents = approved_cents` is a CHECK
  // on the row rather than an arithmetic fact anybody has to remember.
  traderCents: bigint('trader_cents', { mode: 'bigint' }).notNull(),
  firmCents: bigint('firm_cents', { mode: 'bigint' }).notNull(),
  // The LAST CLOSED DAY the decision used. Not a wall clock.
  basisTradingDay: date('basis_trading_day').notNull(),
  // The contract in force, COPIED for provability.
  planVersionId: uuid('plan_version_id')
    .notNull()
    .references(() => planVersions.id),
  // Written exactly once, always read with its parent. A join here would add a
  // way for THE PROOF AND THE DECISION to disagree.
  eligibilitySnapshot: jsonb('eligibility_snapshot').notNull(),
  status: payoutStatus('status').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  // 1-based per account, DERIVED FROM SETTLEMENTS RATHER THAN FROM ATTEMPTS.
  payoutOrdinal: integer('payout_ordinal').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  // SD-03. Two different dates, and the difference is load bearing.
  settledTradingDay: date('settled_trading_day'),
  effectiveTradingDay: date('effective_trading_day'),
  // SD-M5-01. The freeze, with a cited flag and a clock. All three together or
  // none, by `payout_requests_freeze_is_complete`.
  frozenAt: timestamp('frozen_at', { withTimezone: true }),
  freezeFlagId: uuid('freeze_flag_id').references(() => riskFlags.id),
  freezeExpiresAt: timestamp('freeze_expires_at', { withTimezone: true }),
  // SD-M5-04. 'missing' is a real state and not an error: the money left our
  // ledger and did not arrive in theirs, and somebody has to be told.
  balanceReflectionStatus: text('balance_reflection_status').notNull().default('pending'),
  reflectedOnTradingDay: date('reflected_on_trading_day'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // 0031_payout_hold_and_identity_restriction.sql, SD-M5-08. FIVE COLUMNS AND
  // NOT ONE: `payout_requests_hold_is_complete` makes a clockless hold
  // unwritable, which is what stops a bounded review becoming an indefinite one.
  heldAt: timestamp('held_at', { withTimezone: true }),
  holdFlagId: uuid('hold_flag_id'),
  holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
  holdTosClause: text('hold_tos_clause'),
  holdReason: text('hold_reason'),
});

// -----------------------------------------------------------------------------
// payout_transfers -- 0010_payouts.sql. DERIVED: `payout_request_id` ->
// payout_requests, one hop.
// -----------------------------------------------------------------------------
// THE TABLE CARRIES NO IDENTITY COLUMN AT ALL. It reaches one through
// `payout_requests`, which is `owned`, so the chain terminates at an identity
// rather than at a firm table. `payout_request_id uuid NOT NULL REFERENCES
// payout_requests(id)` is single-valued and points at that table's PRIMARY KEY,
// so the join cannot multiply rows and the traversal is a `hop`.
//
// `destination_ref` IS A PROVIDER-SIDE DESTINATION ID AND NEVER BANK DETAILS.
// Merit does not hold them, which is the point, and there is deliberately no
// column here that could.
//
// `status` IS `text` WITH A CHECK AND NOT `payout_status`. The rail's states are
// its own -- queued, sent, settled, failed, retrying -- and the DDL is the
// source: where the DDL and a neighbouring type disagree, the DDL wins.
export const payoutTransfers = pgTable('payout_transfers', {
  id: uuid('id').primaryKey().defaultRandom(),
  payoutRequestId: uuid('payout_request_id')
    .notNull()
    .references(() => payoutRequests.id),
  provider: text('provider').notNull().default('rise'),
  providerTransferId: text('provider_transfer_id'),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
  destinationRef: text('destination_ref').notNull(),
  // Rise identity versus KYC identity. False freezes and flags.
  destinationNameMatch: boolean('destination_name_match'),
  status: text('status').notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  // SD-M5-02. REAL NAME MATCHING IS NOT BOOLEAN: transliteration, married names
  // and common names make a strict comparison produce false freezes on
  // legitimate traders, and a score with no method is a number nobody can
  // re-derive when the matcher is replaced.
  nameMatchScore: integer('name_match_score'),
  nameMatchMethod: text('name_match_method'),
  nameMatchReviewedBy: text('name_match_reviewed_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// wallet_entries -- 0011_wallet.sql. OWNED: `identity_id` is on the row, NOT
// NULL.
// -----------------------------------------------------------------------------
// APPEND-ONLY, AND THE LEDGER IS NOT A SUBSTITUTE FOR IT. The ledger records
// that money moved into `trader_wallet`; only this table records that it arrived
// as a payout rather than as a refund of a wallet-funded purchase, and without
// that distinction every provenance rule in M20 is unenforceable because the
// system cannot tell the two apart once both are in the same integer.
//
// THE TRAP IS `ledger_transaction_id`, WHICH IS NOT NULL AND POINTS AT A
// REGISTERED TABLE, so a `derived` rule through it reads exactly like a
// legitimate hop. It is not the scope: `ledger_transactions` carries no identity
// column and reaches one only through its entries by a semi-join, so deriving
// through it would replace a direct NOT NULL identity column with a two-step
// chain that answers the same question more expensively and can only be wrong.
//
// `provenance` IS A CLOSED LIST WITH NO DEPOSIT MEMBER AND NONE MAY BE ADDED
// (INV-WALLET-NO-DEPOSITS). `promotional_credit` is not in it either and must
// not be: the loyalty perk lives in its own ledger class and in
// `promotional_credit_grants`, and is never withdrawable.
export const walletEntries = pgTable('wallet_entries', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  direction: text('direction').notNull(),
  // Magnitude. Always positive; `direction` carries the sign. Deliberately NOT
  // the ledger's signed convention, because reusing one convention for two
  // different questions is the shape of error ADR-027 was reversed over.
  amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
  provenance: text('provenance').notNull(),
  cause: text('cause').notNull(),
  // Polymorphic: a payout request, a purchase, or the corrected entry. It
  // declares no foreign key, so there is nothing a derived rule could traverse.
  referenceId: uuid('reference_id').notNull(),
  ledgerTransactionId: uuid('ledger_transaction_id')
    .notNull()
    .references(() => ledgerTransactions.id),
  // The running balance AFTER this entry, stored so a divergence between it and
  // the recomputed one is a detectable tamper indication rather than an
  // invisible one.
  balanceAfterCents: bigint('balance_after_cents', { mode: 'bigint' }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// wallet_withdrawals -- 0011_wallet.sql. OWNED: `identity_id` is on the row, NOT
// NULL.
// -----------------------------------------------------------------------------
// THE EXTERNAL LEG IS A DIFFERENT OBJECT FROM A PAYOUT REQUEST (SD-M5-06). A
// payout request is a CLAIM AGAINST AN ACCOUNT evaluated by the engine; a
// withdrawal is a MOVEMENT OF AN ALREADY-SETTLED BALANCE evaluated against KYC
// and destination rules. That is why the row is `owned` by `identity_id`
// directly and carries no `account_id` to be tempted by: the money is the
// person's by the time it is here, and no account is party to the movement.
//
// `status` IS `wallet_withdrawal_status` AND THE HALT IS NOT IN IT. 0031 makes
// a live freeze refuse settlement with a CHECK rather than with a status value,
// deliberately, because the halt is orthogonal to the rail state and collapsing
// an orthogonal hold into the rail's status column is SD-M5-06's own named
// mistake. Before 0031 the halt was representable and unenforced.
export const walletWithdrawals = pgTable('wallet_withdrawals', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
  // Provider-side destination id, never bank details.
  destinationRef: text('destination_ref').notNull(),
  status: walletWithdrawalStatus('status').notNull().default('requested'),
  idempotencyKey: text('idempotency_key').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  // SD-M5-06 carries SD-M5-01's freeze columns, for the same reason and with the
  // same clock: the zero-denial policy must not permit itself an indefinite hold
  // on either leg.
  frozenAt: timestamp('frozen_at', { withTimezone: true }),
  freezeFlagId: uuid('freeze_flag_id').references(() => riskFlags.id),
  freezeExpiresAt: timestamp('freeze_expires_at', { withTimezone: true }),
  // SD-M5-06 carries SD-M5-02's name-match columns too. THIS is the leg with a
  // destination, so this is where the destination name actually gets compared.
  destinationNameMatch: boolean('destination_name_match'),
  nameMatchScore: integer('name_match_score'),
  nameMatchMethod: text('name_match_method'),
  nameMatchReviewedBy: text('name_match_reviewed_by'),
  // SD-M20-03. WHAT IS THIS WITHDRAWAL MADE OF, AND HOW LONG HAS THAT VALUE
  // BEEN HERE. The provenance rule cannot be evaluated against a balance, only
  // against a composition, and `earliest_credit_at` is the chargeback-window
  // hold's input: paying out a refund credit that is still inside the window in
  // which its funding purchase can be charged back is how a wallet becomes a
  // cash-out rail for a stolen card.
  sourceProvenanceSummary: jsonb('source_provenance_summary').notNull().default({}),
  earliestCreditAt: timestamp('earliest_credit_at', { withTimezone: true }),
  // ADR-232, 0070. THE APPROVAL EDGE'S OWN COLUMNS. `0011` gave this table
  // `requested_at` and `settled_at` and nothing for the transition between
  // them, so a row that reached `approved` recorded WHEN only through the
  // generic `updated_at` -- which the halt release moves without touching the
  // rail status at all -- and WHO not at all.
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  // WHICH HAND MOVED THE ROW, and the column the dual-control constraints are
  // written over. NULL is a MACHINE approval: `G-WITHDRAWAL-CLEARED` and
  // `G-COOLING-ELAPSED` are both predicates naming no human, so an approval
  // satisfying them has no operator to record and takes no dual control. A
  // non-NULL value is a named operator in 0002's `actor` idiom, not a `users`
  // row.
  approvedBy: text('approved_by'),
  // SD-M6-05's second person. The FOREIGN KEY proves a row exists and nothing
  // about what it says; `assert_withdrawal_dual_control_is_real` (0070) is what
  // makes it an approval OF THIS WITHDRAWAL, in status `approved`, whose
  // requester is this row's own `approved_by`.
  dualControlApprovalId: uuid('dual_control_approval_id').references(() => dualControlApprovals.id),
  // The threshold IN FORCE when the row was approved, not the current one,
  // which is why it is per row. `0038` shipped the same column with `> 0` as
  // its only bound and `0068` bounded it eleven days later; here the ceiling
  // (`<= 500000`) arrives in the same migration as the column, so a writer may
  // lower it and may not raise it.
  dualControlThresholdCents: bigint('dual_control_threshold_cents', { mode: 'bigint' }),
  // ADR-234, 0072. THE THIRD TERMINAL CLOCK, and the last of the three to be
  // added. `0011` gave `settled` its `settled_at`; `0070` gave `approved` its
  // `approved_at` and, by exempting only `requested`, `cooling` and `cancelled`
  // from `wallet_withdrawals_approved_has_timestamp`, requires one on `failed`
  // too. `cancelled` was the terminal status with no clock of its own,
  // recording WHEN only through `updated_at` -- which the halt release at
  // `apps/worker/src/sweeps/expiry.ts` moves without touching the rail status
  // at all. `wallet_withdrawals_uncancelled_records_no_cancellation` is the
  // other half of `0070`'s pair shape: the status requires the clock and the
  // clock requires the status.
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// wallet_spend_limits -- 0011_wallet.sql. OWNED: `identity_id` is on the row,
// NOT NULL and half of the primary key.
// -----------------------------------------------------------------------------
// PER IDENTITY RATHER THAN GLOBAL, AND THE REASON IS THE WHOLE DESIGN: the limit
// that matters is the one on THE COMPROMISED SESSION, and a global limit either
// throttles legitimate traders or is set so high it does nothing. In practice it
// is set so high it does nothing.
//
// THE GRAIN IS (identity, effective_from) AND SUPERSESSION IS A NEW ROW. A
// scoped read therefore returns the whole history of limits set on a person,
// which is what makes a contested throttle explicable months later; the current
// one is the greatest `effective_from` that has arrived, not the only row.
export const walletSpendLimits = pgTable(
  'wallet_spend_limits',
  {
    identityId: uuid('identity_id')
      .notNull()
      .references(() => identities.id),
    dailyCents: bigint('daily_cents', { mode: 'bigint' }).notNull(),
    // A rolling weekly limit below the daily limit is a daily limit with a
    // confusing name, refused by `wallet_spend_limits_weekly_exceeds_daily`.
    rolling7dCents: bigint('rolling_7d_cents', { mode: 'bigint' }).notNull(),
    reason: text('reason').notNull(),
    // An operator name, 0002's `actor` idiom. Not a `users` row.
    setBy: text('set_by').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.identityId, table.effectiveFrom] })],
);

// -----------------------------------------------------------------------------
// wallet_dormancy -- 0011_wallet.sql. OWNED: `identity_id` is on the row, and it
// is the whole primary key.
// -----------------------------------------------------------------------------
// UNCLAIMED-PROPERTY OBLIGATIONS ARE JURISDICTIONAL AND REAL, and the
// alternative to a state machine is DISCOVERING THE OBLIGATION DURING AN AUDIT.
// One row per identity, so the scoped read returns a person exactly their own
// dormancy state.
//
// OWNED AND NOT `root`, ALTHOUGH THE COLUMN IS THE PRIMARY KEY. `root` means the
// row IS the identity and its column is `id`; this row is a fact ABOUT an
// identity that happens to be keyed by it, and `identities` is the only table
// this vocabulary's `root` may name.
//
// `notified_at` IS AN ARRAY BECAUSE THE SCHEDULE IS A SEQUENCE. "Did we notify
// them" is answered by the whole sequence rather than by the last one, and a
// single timestamp would make the second notice overwrite the proof of the
// first. 0028 supersedes the completeness CHECK -- `cardinality` for
// `array_length`, so an empty array can no longer reach `escheat_review` -- and
// that is constraint work the fold reads and discards, leaving the column set
// unchanged.
export const walletDormancy = pgTable('wallet_dormancy', {
  identityId: uuid('identity_id')
    .primaryKey()
    .references(() => identities.id),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull(),
  notifiedAt: timestamp('notified_at', { withTimezone: true }).array().notNull().default([]),
  state: text('state').notNull().default('active'),
  // A HINT, not a determination. The jurisdiction that governs an unclaimed
  // balance is a legal question and this column records our best guess so
  // counsel has something to correct rather than nothing to look at.
  jurisdictionHint: text('jurisdiction_hint'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// plans -- 0004_catalog.sql. FIRM.
// -----------------------------------------------------------------------------
// THE CATALOGUE'S ROOT, and it is firm for `plan_versions`' reason one level up:
// every identity is offered the SAME plan, and the link runs the other way -- a
// version names its plan and an account names its version -- so ownership flows
// FROM the catalogue rather than to it. The public plan pages read it unscoped
// and that is not a leak: a listed plan is what the firm offers in public.
//
// `is_active` DELISTS AND NEVER DELETES, and 0004's own comment gives a records
// reason rather than a UI one: a plan nobody can buy still has to explain the
// accounts sold under it. A delisted row stays readable and stays firm.
//
// `code` IS THE M1-GATE VOCABULARY AND `rapid_daily` IS NOT IN IT. ADR-013
// renamed it to `direct` with no row to migrate, and the retired alias is not
// carried forward here either, because a retired alias is a second name for one
// thing.
export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// passkeys -- 0002_identity.sql. DERIVED: `user_id` -> users, one hop.
// -----------------------------------------------------------------------------
// A CREDENTIAL BELONGS TO A LOGIN AND NOT TO A PERSON, so the row reaches an
// identity through `users` and there is no second candidate column on it to get
// wrong. ADR-041 is why the login and the person are two things: an identity
// holding two logins holds passkeys under both, and a scoped read returns both,
// which is the same answer `sessions` gives for the same reason.
//
// `credential_id` AND `public_key` ARE `bytea` AND ARE DECLARED AS THE CUSTOM
// TYPE. Either one as `text()` would compile and would satisfy the column-name
// comparison the suite runs, and it would be a wrong statement about the one
// axis this suite does not check (ADR-094 section 3).
//
// `sign_count` IS CLONE DETECTION AND NOT BOOKKEEPING: a signature counter that
// goes BACKWARDS means the credential exists in two places. 0002 declares it
// `bigint`, so it is transcribed as one.
//
// `transports` IS A `text[]` AND IS TRANSCRIBED AS AN ARRAY. The authenticator
// reports several, the column stores several, and a scalar here would be the
// same class of wrong statement as `text` for `bytea`.
export const passkeys = pgTable('passkeys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  credentialId: bytea('credential_id').notNull().unique(),
  publicKey: bytea('public_key').notNull(),
  signCount: bigint('sign_count', { mode: 'bigint' }).notNull().default(0n),
  transports: text('transports').array(),
  label: text('label'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// integration_contracts -- 0018_integrations.sql. FIRM.
// -----------------------------------------------------------------------------
// WHAT MERIT IS ALLOWED TO SEND A VENDOR, one row per integration per event per
// version. The row is about a CONTRACT WITH A THIRD PARTY and never about a
// trader: it carries no identity column and there is no correct one, because
// the same contract governs every dispatch to that vendor for every identity.
//
// `field_allowlist` HOLDS FIELD NAMES AND NEVER VALUES, which is why a contract
// is reviewable by someone who does not read the repository. It is an ALLOWLIST
// rather than a denylist because a denylist defaults to sending: a field added
// to an event next year reaches no vendor until somebody adds it here.
//
// `approved_by text NOT NULL` IS 0002'S ACTOR IDIOM AND NOT A `users` ROW, so
// there is no reference to walk and `treasury_balances.recorded_by`'s trap does
// not arise. It records WHO AUTHORISED THE DISCLOSURE, which is a fact about
// Merit's own approval procedure.
//
// `integration_contracts_enabled_has_fields` WAS DROPPED AND RE-ADDED UNDER ITS
// OWN NAME BY 0028, `cardinality` for `array_length`, and that is constraint
// work rather than a column change: ADR-094's fold reads the statement, finds no
// column shape in it, and discards it.
export const integrationContracts = pgTable('integration_contracts', {
  id: uuid('id').primaryKey().defaultRandom(),
  integration: text('integration').notNull(),
  eventName: text('event_name').notNull(),
  fieldAllowlist: text('field_allowlist').array().notNull(),
  // Defaults to OFF. A contract that arrived enabled would be a disclosure that
  // began the moment the row was inserted.
  enabled: boolean('enabled').notNull().default(false),
  // Evaluated over the allowlisted fields only, and at SEND time (INV-M10-08).
  guardExpression: text('guard_expression'),
  version: integer('version').notNull().default(1),
  approvedBy: text('approved_by').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// integration_dispatches -- 0018_integrations.sql. OWNED: `identity_id`,
// NULLABLE.
// -----------------------------------------------------------------------------
// WHAT MERIT TOLD A VENDOR ABOUT A PERSON. The row is ABOUT the identity named
// on it rather than about whoever's action produced the event, and the endpoint
// M10 section 4 owns says so in its own name: `GET
// /admin/identities/:identityId/disclosures` is every field ever sent about
// this identity, per vendor, read from this table.
//
// `identity_id` IS NULLABLE AND THAT IS `ledger_accounts`' SHAPE RATHER THAN A
// GAP. Not every dispatch is about a person -- a MID health change and an
// uptime alert are about the firm -- and filtering `identity_id = $1` excludes
// those rows WITHOUT a second predicate, because SQL NULL never equals
// anything. The DDL's own comment states the requirement in that direction: the
// dispatches that are not about a person must not be findable by an identity
// search that returns them anyway.
//
// THE NULLABILITY HERE IS A PERMANENT PROPERTY OF THE DISPATCH AND NOT A LATE
// BINDING, WHICH IS WHERE THIS TABLE PARTS FROM `psp_webhook_events`. That
// table's `purchase_id` is bound by the handler DURING processing, so a derived
// rule would make a row's tenancy a function of whether a job has run yet;
// `identity_id` here is decided when the dispatch row is written and no status
// transition moves it. `status` runs over `queued`, `sent`, `failed` and
// `dropped_by_guard`, and none of the four changes whose disclosure it is.
//
// `event_id` REFERENCES `events(id)`, WHICH IS NOW ONE OF THIS FILE'S TABLES,
// AND THE SECOND HALF OF THIS PARAGRAPH IS THE HALF THAT SURVIVED. The column
// read "transcribed alone and carries no `.references()`" until ADR-191
// registered `events`; the FK is declared inline in `0018`'s `CREATE TABLE`
// body and the target is now here, so the file's own rule claims the edge.
// THE OTHER HALF IS UNCHANGED AND IS NOW LOAD BEARING RATHER THAN INCIDENTAL:
// `events` being registered means a `derived` rule through it COMPILES where
// before it could not be written at all, which is exactly what ADR-106 reports
// about `affiliate_commissions` and `attributions`. It is still refused, and on
// the substantive ground rather than on the type: the event is Merit's own fact
// and this row is the DISCLOSURE of it, so a chain through `events` would answer
// a different question from the one the breach and privacy requests ask.
//
// `fields_sent` IS WHAT ACTUALLY WENT rather than what the contract permitted,
// and it is field NAMES rather than values (INV-M10-12), so the audit trail of
// a telephone number's disclosure never becomes a second copy of the number.
export const integrationDispatches = pgTable('integration_dispatches', {
  id: uuid('id').primaryKey().defaultRandom(),
  integration: text('integration').notNull(),
  eventId: bigint('event_id', { mode: 'bigint' }).references(() => events.id),
  identityId: uuid('identity_id').references(() => identities.id),
  fieldsSent: text('fields_sent').array().notNull(),
  status: text('status').notNull(),
  // A retry re-uses the idempotency key rather than writing a second row, so
  // the count lives on the row it belongs to.
  attempts: integer('attempts').notNull().default(0),
  responseCode: integer('response_code'),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// support_context_views -- 0018_integrations.sql. OWNED: `identity_id`, NOT
// NULL.
// -----------------------------------------------------------------------------
// ONE ROW PER TIME A SUPPORT AGENT READ A TRADER'S IDENTITY GRAPH, and the row
// is about THE TRADER WHO WAS READ. That is `impersonation_sessions`' question
// asked one surface out, and it has the same answer: the identity a row is
// ABOUT is the subject of the read, never the actor who caused it.
//
// THERE IS NO SECOND IDENTITY COLUMN TO CHOOSE BETWEEN, WHICH IS STRUCTURAL.
// `agent_ref text NOT NULL` is an actor string and not a `users` row, so the
// agent side declares no foreign key and there is nothing a predicate could
// walk -- unlike `impersonation_sessions.admin_user_id`, which does reference
// `users` and is this package's own named trap. `identity_id uuid NOT NULL
// REFERENCES identities(id) ON DELETE RESTRICT` is the one identity column the
// database declares here.
//
// `fields_returned` IS WHAT WAS RETURNED AND NOT WHAT WAS REQUESTED. A view
// that logged the request cannot answer what the agent actually saw, which is
// the question a social-engineering incident asks (AS-M10-01, dossier item 9).
//
// `ip_hash bytea NULL` IS A DIGEST AND NEVER AN ADDRESS. This is an audit of
// Merit's own staff and the audit must not itself become a second store of
// personal data about them.
export const supportContextViews = pgTable('support_context_views', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentRef: text('agent_ref').notNull(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  fieldsReturned: text('fields_returned').array().notNull(),
  conversationRef: text('conversation_ref'),
  viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  ipHash: bytea('ip_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// simulation_runs -- 0045_simulation_runs.sql. FIRM.
// -----------------------------------------------------------------------------
// A MONTE CARLO RUN OVER A PROPOSED PLAN CONFIG, recorded so a published version
// can be traced to the projection it was decided on (M21 `INV-M21-05`). There is
// no identity column and there is no correct one: the subject of a run is a
// PARAMETER SET, the population it simulates is synthetic, and no person's rows
// are read to produce it.
//
// `requested_by` IS THE TRAP AND IT IS WEAKER THAN THE ONE `treasury_balances`
// CARRIES, NOT STRONGER. It is bare `text NOT NULL` with no foreign key at all,
// on `dual_control_approvals.requested_by`'s precedent, so it does not even name
// a `users` row -- and if it did, scoping by it would return the firm's plan
// economics to whichever operator pressed the button, which is this file's own
// named `recorded_by` failure in a second costume.
//
// A `derived` RULE THROUGH `plan_versions` WOULD THROW RATHER THAN MISLEAD, and
// it is the available mistake here: `plan_version_id` reads like a hop and is
// not one, because `plan_versions` is firm and a chain terminates at `owned` or
// at `root` or it does not terminate. It is also NULLABLE by design -- the run
// is over a DRAFT, which may not yet be a row -- so the digests beside it are
// what say which config was actually simulated.
//
// `seed` IS `text` AND NOT A NUMBER, transcribed rather than preferred:
// `Provenance.seed` is typed `string`, and a seed stored as a bigint would
// round-trip some seeds and not others. `sample_size` is `integer` with a
// `>= 0` CHECK because `provenanceFor` throws only below zero, so a zero-sample
// run is legal in the harness and has to be storable.
//
// `calibration_observed_at` IS A `date` AND THE DAY THE FIGURES WERE OBSERVED,
// never the day of the run. The three digests are `bytea`, on the same
// convention `rule_states.state_hash` and `dual_control_approvals.payload_hash`
// already hold, each with a `length = 32` CHECK the database keeps.
export const simulationRuns = pgTable('simulation_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  planVersionId: uuid('plan_version_id').references(() => planVersions.id),
  rulesDigest: bytea('rules_digest').notNull(),
  sizesDigest: bytea('sizes_digest').notNull(),
  calibrationId: text('calibration_id').notNull(),
  calibrationDigest: bytea('calibration_digest').notNull(),
  calibrationObservedAt: date('calibration_observed_at').notNull(),
  harnessVersion: text('harness_version').notNull(),
  engineVersion: text('engine_version').notNull(),
  seed: text('seed').notNull(),
  sampleSize: integer('sample_size').notNull(),
  // ALL THREE OR NONE, kept by `simulation_runs_sweep_arm_is_whole`. An arm
  // naming a parameter but no sweep is an arm of nothing.
  sweepId: uuid('sweep_id'),
  sweptParameter: text('swept_parameter'),
  // THE NAME IS THE PLAN'S AND IS NOT ALWAYS TRUE: M21 section 3.4 sweeps
  // `max_payouts`, which is a count and not a basis point. 0045 kept the plan's
  // name deliberately and this is a transcription of that column.
  sweptValueBp: bigint('swept_value_bp', { mode: 'bigint' }),
  // `text` WITH A CHECK, NOT A pg ENUM. 0045 declares
  // `status text NOT NULL CHECK (status IN ('queued','running','complete','failed'))`
  // and 0001 mints no enum for it, so the four values live in the constraint.
  status: text('status').notNull(),
  outputs: jsonb('outputs').notNull().default({}),
  requestedBy: text('requested_by').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

// -----------------------------------------------------------------------------
// contract_specs -- 0004_catalog.sql. FIRM.
// -----------------------------------------------------------------------------
// THE INSTRUMENT CATALOGUE. What a tick is worth, per symbol, per effective
// date. No identity owns a contract specification and there is no column that
// could carry one: the row is a fact about `ES` between two dates, identical for
// every trader who ever traded it.
//
// THE PRIMARY KEY IS COMPOSITE, `(symbol, effective_from)`, and it is
// transcribed rather than replaced by a surrogate. A spec change is ANOTHER ROW
// with its own effective date, not an UPDATE, which is what makes a per-
// instrument figure computed months ago reproducible today.
//
// `tick_size` IS AN EXACT RATIONAL AND `tick_value_cents` IS AN INTEGER, the
// same discipline `fills` applies to price and for the same reason: a tick value
// that rounds is a per-instrument result that disagrees with the mark.
export const contractSpecs = pgTable(
  'contract_specs',
  {
    symbol: text('symbol').notNull(),
    exchange: text('exchange').notNull(),
    tickSizeNumerator: bigint('tick_size_numerator', { mode: 'bigint' }).notNull(),
    tickSizeDenominator: bigint('tick_size_denominator', { mode: 'bigint' }).notNull(),
    tickValueCents: bigint('tick_value_cents', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    isMicro: boolean('is_micro').notNull().default(false),
    // `effective_to` NULL means current.
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.effectiveFrom] })],
);

// -----------------------------------------------------------------------------
// fills -- 0013_ingest.sql. DERIVED: `account_id` -> accounts, one hop.
// -----------------------------------------------------------------------------
// ONE EXECUTION, AS THE VENDOR REPORTED IT. The row reaches an identity through
// its account and through nothing else; every other reference on it points at
// the ingest machinery -- `ingest_file_id`, `raw_row_id` -- or at another fill.
//
// PRICE IS AN EXACT RATIONAL, NEVER A FLOAT, and the pair of bigints is the
// whole reason: a price that rounds is a P&L that disagrees with the vendor's.
// The constitution's no-floats rule reaches this table through the marks it
// feeds.
//
// `trading_day` IS OURS AND `trading_day_vendor` IS THEIRS (SD-M2-04), with
// `trading_day_source` recording which produced the stored value. Both are kept
// because "when did it happen" and "when did we learn it" are different
// questions and a correction is exactly where they diverge.
//
// `correction_of` REFERENCES THIS SAME TABLE, so the correction chain never
// leaves the account it belongs to and a scoped read returns the corrected fill
// beside the correction. That is `daily_marks.superseded_by`'s shape exactly and
// it is why neither column widens the tenancy.
//
// `ingest_file_id` and `raw_row_id` reference `ingest_files` and
// `raw_ingest_rows`, which are not this file's tables, so the COLUMN alone is
// transcribed and the foreign key is left to the database.
export const fills = pgTable('fills', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  platform: text('platform').notNull().default('rithmic'),
  platformFillId: text('platform_fill_id').notNull(),
  // B3 reservations, used rather than added: round-trip derivation reads all
  // three of `order_id`, `venue` and `correction_of` (M13 section 2).
  orderId: text('order_id'),
  venue: text('venue'),
  // Joins `contract_specs`, which is the tick value's only source (DEP-M13-03).
  symbol: text('symbol').notNull(),
  // `text` with a CHECK rather than an enum, and the transcription follows the
  // DDL: where the DDL and a neighbouring type disagree, the DDL wins.
  side: text('side').notNull(),
  quantity: integer('quantity').notNull(),
  priceNumerator: bigint('price_numerator', { mode: 'bigint' }).notNull(),
  priceDenominator: bigint('price_denominator', { mode: 'bigint' }).notNull(),
  executedAt: timestamp('executed_at', { withTimezone: true }).notNull(),
  // RESOLVED THROUGH THE CALENDAR, never from the timestamp's UTC date.
  tradingDay: date('trading_day').notNull(),
  correctionOf: bigint('correction_of', { mode: 'bigint' }).references((): AnyPgColumn => fills.id),
  isCorrected: boolean('is_corrected').notNull().default(false),
  // References `ingest_files`, which is not one of this file's tables.
  ingestFileId: uuid('ingest_file_id').notNull(),
  // References `raw_ingest_rows`, which is not one of this file's tables.
  rawRowId: bigint('raw_row_id', { mode: 'bigint' }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  tradingDayVendor: date('trading_day_vendor'),
  tradingDaySource: text('trading_day_source').notNull().default('calendar'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// round_trips -- 0022_analytics_journal.sql. DERIVED: `account_id` -> accounts,
// one hop.
// -----------------------------------------------------------------------------
// FILLS GROUPED INTO TRADES, ONCE AND VERSIONED. The grouping IS the finding:
// scaling in and out, reversals and overnight positions make "how many trades
// did I take" ambiguous, so `derivation_version` pins which rule produced the
// row and a change to that rule is a dated event rather than a trade count that
// quietly moved (INV-M13-10).
//
// `net_result_cents` IS PRESENTATIONAL AND NEVER RECONCILES THE ACCOUNT. The
// money number is `daily_marks`' (INV-M13-02), and the column carries a DDL
// comment saying so. Registering this table makes it READABLE and nothing else:
// no scope rule enforces that separation.
//
// `entry_fills` AND `exit_fills` ARE `bigint[]`, matching `fills.id`, which is
// `bigint GENERATED ALWAYS AS IDENTITY`. M13 section 2's `SD-M13-01` cell says
// `uuid[]` and the DDL is the source; the plan's cell could never have
// referenced a fill.
//
// THE TWO ARRAY CONSTRAINTS IN `0022` READ `array_length` AND ARE NOT WHAT THE
// DATABASE ENFORCES: `0028_supersede_plan_version_immutability.sql` re-states
// `round_trips_has_entry` and `round_trips_closed_has_exit` on `cardinality`, so
// an empty array is refused. Both statements are `ADD CONSTRAINT` work, which
// ADR-094's fold reads and discards, so neither touches the column set below.
export const roundTrips = pgTable('round_trips', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  instrument: text('instrument').notNull(),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
  // NULL while the position is open.
  closedAt: timestamp('closed_at', { withTimezone: true }),
  tradingDay: date('trading_day').notNull(),
  direction: text('direction').notNull(),
  maxSize: integer('max_size').notNull(),
  entryFills: bigint('entry_fills', { mode: 'bigint' }).array().notNull(),
  exitFills: bigint('exit_fills', { mode: 'bigint' }).array().notNull().default([]),
  grossResultCents: bigint('gross_result_cents', { mode: 'bigint' }).notNull(),
  feeCents: bigint('fee_cents', { mode: 'bigint' }).notNull().default(0n),
  // PRESENTATIONAL. NEVER RECONCILES THE ACCOUNT (INV-M13-02).
  netResultCents: bigint('net_result_cents', { mode: 'bigint' }).notNull(),
  derivationVersion: integer('derivation_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// journal_entries -- 0022_analytics_journal.sql. OWNED: `identity_id`.
// -----------------------------------------------------------------------------
// THE TRADER'S OWN NOTES. Merit reads them for nothing: M13 section 3.4 is an
// absence rather than a state machine -- journal text is never a detector input,
// never a default support view, never in the internal evidence tier.
//
// TWO COLUMNS REACH A PERSON AND ONLY ONE OF THEM IS TOTAL. `identity_id` is
// `NOT NULL REFERENCES identities(id)` and is the author; `account_id` is
// NULLABLE, because a `day`-scoped entry need name no account. Scoping by the
// account would silently drop every entry that names none, which is a wrong
// answer that returns rows.
//
// `deleted_at` IS A TOMBSTONE AND NOT THE END STATE. A hard-delete job removes
// the row afterwards, which is what makes deletion a promise rather than a
// claim (INV-M13-07); the soft phase exists so the delete is undoable inside a
// short window and so the job has something to find. A scoped read that ignored
// it would return deleted entries, and no scope rule prevents that: registering
// this table makes it readable and nothing else.
//
// `reference_id` NAMES A ROUND TRIP WHEN `scope` IS `round_trip` AND CARRIES NO
// FOREIGN KEY, so it is transcribed as a bare `uuid`.
export const journalEntries = pgTable('journal_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  accountId: uuid('account_id').references(() => accounts.id),
  scope: text('scope').notNull(),
  referenceId: uuid('reference_id'),
  body: text('body').notNull(),
  tags: text('tags').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // SD-M13-02. THE TOMBSTONE, not the end state.
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// -----------------------------------------------------------------------------
// analytics_snapshots -- 0022_analytics_journal.sql. DERIVED: `account_id` ->
// accounts, one hop.
// -----------------------------------------------------------------------------
// THE EXPENSIVE SHAPES, COMPUTED ONCE PER ACCOUNT PER CLOSED DAY in the batch
// rather than per page load (INV-M13-06, AS-M13-07).
//
// `inputs_digest` IS WHAT MAKES INV-M13-10 CHECKABLE: if the digest changed, the
// marks changed, and the trader is told why. Without it a corrected mark
// silently moves a trader's historical statistics and the only evidence is that
// they remember a different number. It is `bytea` and is transcribed as one.
//
// THE PRIMARY KEY IS COMPOSITE, `(account_id, as_of_trading_day)`, which is the
// grain: one snapshot per account per closed day, replaced rather than
// accumulated.
export const analyticsSnapshots = pgTable(
  'analytics_snapshots',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    asOfTradingDay: date('as_of_trading_day').notNull(),
    payload: jsonb('payload').notNull(),
    inputsDigest: bytea('inputs_digest').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.asOfTradingDay] })],
);

// -----------------------------------------------------------------------------
// graduation_benefits -- 0023_loyalty_and_graduation.sql. OWNED: `identity_id`,
// NOT NULL. SD-M18-02.
// -----------------------------------------------------------------------------
// THE ROW REACHES AN IDENTITY TWICE AND THE DIRECT COLUMN IS THE RULE, which is
// `certificates`' shape and its unrepaired finding in a third place (after
// `contact_channels.superseded_by` and `phone_change_requests.old_phone_id`).
// `identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` and
// `account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT` both
// reach an identity, `accounts` is itself `owned` on `identity_id`, and NO
// CONSTRAINT TIES THE TWO: nothing in the DDL says this row's `identity_id` is
// the same identity that owns its `account_id`. The direct column is the rule
// because a derived rule would make the tenancy depend on a join rather than on
// a column the database declares against `identities(id)`.
//
// `accrued_cents` IS THE VAULT NUMBER AND `basis` IS WHY IT IS NOT A PROJECTION.
// Both are NOT NULL together (INV-M18-06): a number on a screen with no stated
// derivation is read as a promise. `basis` is `text` and `accrued_cents` is
// `bigint`, integer cents, never a float.
//
// `conferred_at` AND `withheld_reason` ARE BOTH NULLABLE AND BOTH DECIDED. The
// table's own `graduation_benefits_not_both_conferred_and_withheld` CHECK is
// what makes them exclusive, and it is the database's rather than this file's:
// a CHECK constraint is not a column, so nothing in `packages/db` compares it.
// A withheld benefit HOLDS rather than disappears, which is INV-M18-10.
export const graduationBenefits = pgTable('graduation_benefits', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  benefitCode: text('benefit_code').notNull(),
  accruedCents: bigint('accrued_cents', { mode: 'bigint' }).notNull(),
  basis: text('basis').notNull(),
  conferredAt: timestamp('conferred_at', { withTimezone: true }),
  withheldReason: text('withheld_reason'),
  criteriaVersion: integer('criteria_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// graduation_invitations -- 0025_reserved_sequence.sql. OWNED: `identity_id`,
// NOT NULL. SD-M18-03.
// -----------------------------------------------------------------------------
// RESERVED AND EMPTY AT LAUNCH, AND THAT IS A FACT ABOUT THE ROWS RATHER THAN
// ABOUT THE RULE. `0025`'s own `COMMENT ON TABLE` says no live program exists
// (OQ-M18-01), and a scope rule states how a row WOULD reach an identity, so an
// empty table gets the same rule a full one would. Registering it does not ship
// a program and confers no read on anybody: ADR-092 section 9 is explicit that
// registration makes a table readable through the scoped accessor and nothing
// else.
//
// ONE IDENTITY COLUMN AND NO SECOND PATH. Unlike `graduation_benefits` one
// table up, this row names no account: an invitation is issued to the PERSON
// rather than earned by one of their accounts, which is why `identity_id` is
// the only reference in the body.
//
// NO `updated_at`, AND IT IS STRUCTURAL. `accepted_at` and `declined_at` are the
// row's clocks and `graduation_invitations_one_response` makes them exclusive,
// so a response is a column that fills rather than a row that is edited.
export const graduationInvitations = pgTable('graduation_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  programRef: text('program_ref').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  declinedAt: timestamp('declined_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  termsVersion: integer('terms_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// plan_size_unlocks -- 0044_fee_back_and_ladder_unlock.sql. OWNED:
// `identity_id`, NOT NULL. SD-M18-04.
// -----------------------------------------------------------------------------
// THE ROW CARRIES THIS PACKAGE'S NAMED TRAP AND IS NOT DERIVED THROUGH IT.
// `plan_version_id uuid NOT NULL REFERENCES plan_versions(id) ON DELETE
// RESTRICT` reads exactly like the `hop` `daily_marks` and `rule_states` make to
// `accounts`, and it is not one: `plan_versions` is FIRM, so a derivation
// through it constructs no predicate and throws the first time anybody reads
// this table. A LADDER'S RUNGS ARE THE SAME FOR EVERYONE AND A TRADER'S POSITION
// ON IT IS THEIR OWN, and the FK to the rung definition is what makes the two
// look alike in a column list.
//
// `identity_id` IS ADR-070 SECTION 3'S RULING IN DDL RATHER THAN A FIELD THE
// RULING CONSTRAINS. `identities.id` is the hard-merged grain -- a merge
// repoints ownership into that row -- and nothing in this table reaches
// `identity_links`, so a soft-linked pair sharing an unlock is UNREPRESENTABLE
// rather than forbidden (INV-M18-11).
//
// `earned_account_id` IS THE SECOND PATH AND IS NOT THE RULE, for
// `graduation_benefits`' reason exactly: it is `NOT NULL REFERENCES
// accounts(id)`, `accounts` is `owned`, and no constraint ties the account's
// identity to this row's. It records WHICH LADDER COMPLETED, which is what a
// dispute is argued from, and says nothing about who holds the entitlement.
//
// `unlocked_size_cents` NAMES A `plan_version_sizes.size_cents` AND IS
// DELIBERATELY NOT A FOREIGN KEY TO THAT ROW. The entitlement is to the SIZE, so
// a later version publishing the same size honours an unlock earned against it.
// `bigint`, integer cents.
//
// THE ROW IS THE ENTITLEMENT AND THERE IS NO STATE MACHINE. `revoked_at` and
// `revoked_reason` are nullable together and tied by
// `plan_size_unlocks_revocation_is_explained`, a CHECK this file does not
// transcribe and nothing in `packages/db` compares.
export const planSizeUnlocks = pgTable('plan_size_unlocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  planVersionId: uuid('plan_version_id')
    .notNull()
    .references(() => planVersions.id),
  unlockedSizeCents: bigint('unlocked_size_cents', { mode: 'bigint' }).notNull(),
  earnedAccountId: uuid('earned_account_id')
    .notNull()
    .references(() => accounts.id),
  earnedAt: timestamp('earned_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: text('revoked_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// offer_experiments -- 0024_offers.sql. FIRM.
// -----------------------------------------------------------------------------
// AN EXPERIMENT IS A THING MERIT RUNS, NOT A THING ANYBODY OWNS. There is no
// identity column and there is no correct one: an arm is assigned to a
// population and its hypothesis is about the population, so a per-identity slice
// of an experiment is not a smaller version of it. The row a person holds is the
// `offers` row that names `experiment_id`, and that table carries the identity.
//
// `varies` IS THE RULE IN DDL, checked to `price`, `presentation` and
// `bundle_contents` with NO fourth value, so an experiment that varies a rule, a
// gate or a plan parameter cannot be written down at all (AS-M17-07). Adding a
// member is an ADR, which is 0024's own header.
//
// `winner_arm` and `arms` NAME NOBODY. `arms jsonb` holds arm definitions rather
// than enrolments, and there is no enrolment table in this tree, so nothing here
// reaches an identity even one hop out.
export const offerExperiments = pgTable('offer_experiments', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  hypothesis: text('hypothesis').notNull(),
  arms: jsonb('arms').notNull(),
  varies: text('varies').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  winnerArm: text('winner_arm'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// price_floors -- 0024_offers.sql. FIRM.
// -----------------------------------------------------------------------------
// THE HARD STOP UNDER STACKING ARITHMETIC, AND IT IS THE FIRM'S NUMBER. The row
// says what a product may never be sold below; it declares no foreign key at
// all, carries no identity column, and there is no correct one, because a floor
// that differed per trader would not be a floor. `approved_by text NOT NULL` is
// an approver rather than a `users` row, which is 0002's `actor` idiom.
//
// THE GRAIN IS `(product_ref, effective_from)` AND IT IS THE WHOLE PRIMARY KEY,
// so the table has no `uuid` of its own. Session 166 read the consequence and it
// is a FINDING rather than anything this transcription may act on:
// `dual_control_approvals.subject_id` is `uuid NOT NULL` (0016:227), so the dual
// control M17:150, EC-119 and `data-model/price_floors.md:2` all assert over this
// table cannot name its subject. A repair is a migration and a transcription
// holds none.
//
// `product_ref` IS BARE TEXT ON BOTH SIDES OF THE CLAMP. `offers.product_ref` is
// bare text too, with no FK, no domain and no shared CHECK, so the floor lookup
// is a text join. Transcribed as it is written.
export const priceFloors = pgTable(
  'price_floors',
  {
    productRef: text('product_ref').notNull(),
    // Integer cents, per the constitution and DATA_MODEL section 1.
    floorCents: bigint('floor_cents', { mode: 'bigint' }).notNull(),
    // NOT NULL. For a Direct plan the floor is a LIABILITY decision, and one
    // with no written rationale is one nobody can defend at the next review.
    reason: text('reason').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    approvedBy: text('approved_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.productRef, table.effectiveFrom] })],
);

// -----------------------------------------------------------------------------
// offers -- 0024_offers.sql. OWNED: `identity_id`, NULLABLE. MONEY.
// -----------------------------------------------------------------------------
// AN OFFER CHANGES THE PRICE OF A KNOWN THING AND MAY NEVER CHANGE THE THING
// (INV-M17-02, INV-M17-03).
//
// NULLABLE ON PURPOSE, AND THE DDL MAKES IT BICONDITIONAL.
// `offers_identity_scope_matches` CHECKs `(scope = 'identity' AND identity_id IS
// NOT NULL) OR (scope <> 'identity' AND identity_id IS NULL)`, so filtering
// `identity_id = $1` returns EXACTLY the rows the schema says are that person's
// and excludes every `public` and `segment` row without a second predicate,
// because SQL NULL never equals anything. That is `ledger_accounts`' shape, not
// `coupons`': a coupon has no identity column and no correct one, and this table
// has one the DDL declares against `identities(id)`.
//
// `experiment_id` IS THE TRAP AND IT IS THE ONE THIS MODULE MAKES PLAUSIBLE. It
// is a foreign key to `offer_experiments`, which is FIRM, so a `derived` rule
// through it would compile at every call site -- `DerivedRule.via` is `TableKey`
// and includes every firm key -- and throw the first time anybody read it.
// `loyalty_grant_id` is the same shape one table further out and is not even
// registrable: `loyalty_benefit_grants` is not one of this file's tables, so the
// column carries no `.references()`.
//
// `criteria_version` IS A BARE `integer` THAT CANNOT ADDRESS THE ROW IT NAMES.
// `loyalty_criteria`'s primary key is `(benefit_code, version)`, so a version
// number alone selects nothing. Transcribed as written; it is 0024's shape and
// not this file's to repair.
export const offers = pgTable('offers', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Bare `text` with NO CHECK. The six OF-M17-nn values are unrepresented in
  // DDL, in the same file whose header argues that a CHECK is the schema
  // enforcing the rule. The argument was applied to `varies` and not here.
  offerType: text('offer_type').notNull(),
  scope: text('scope').notNull(),
  identityId: uuid('identity_id').references(() => identities.id),
  productRef: text('product_ref').notNull(),
  // STATED CONTENTS BEFORE PAYMENT (ADR-019a). Explicit, never derived at
  // redemption: a bundle whose contents are computed when it is redeemed is a
  // bundle whose contents were not stated.
  contents: jsonb('contents').notNull(),
  priceCents: bigint('price_cents', { mode: 'bigint' }).notNull(),
  // Stored beside `price_cents` so the discount is a FACT rather than a
  // comparison against a list price that may since have moved.
  listPriceCents: bigint('list_price_cents', { mode: 'bigint' }).notNull(),
  currency: char('currency', { length: 3 }).notNull().default('USD'),
  maxRedemptions: integer('max_redemptions'),
  redemptionsUsed: integer('redemptions_used').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  criteriaVersion: integer('criteria_version'),
  // NO `.references()`: `loyalty_benefit_grants` is not one of this file's
  // tables.
  loyaltyGrantId: uuid('loyalty_grant_id'),
  experimentArm: text('experiment_arm'),
  experimentId: uuid('experiment_id').references(() => offerExperiments.id),
  createdBy: text('created_by').notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// promotional_credit_grants -- 0024_offers.sql, later columns from
// 0044_fee_back_and_ladder_unlock.sql. OWNED: `identity_id`, NOT NULL. MONEY.
// -----------------------------------------------------------------------------
// THIS IS THE TABLE THAT MINTS VALUE, and `identity_id uuid NOT NULL REFERENCES
// identities(id) ON DELETE RESTRICT` is on the row. A grant is a named person's
// entitlement from the moment it exists; there is no unowned grant and the DDL
// has no way to write one.
//
// NEVER WITHDRAWABLE (OQ-FREEZE-01). Promotional credit is rendered inside the
// wallet screen and is NOT wallet value: it has its own ledger class
// (`promotional_credit`, 0009) and no `wallet_entries.provenance` value (0011).
//
// `funding_purchase_id` IS THE DELTA'S REAL CONTENT AND IT IS NOT THE SCOPE. A
// credit needs to know what funded it or a chargeback cannot claw back the
// credit it paid for (AS-M17-06). It is NULLABLE -- a loyalty-issued or
// fee-back-issued grant has no funding purchase -- so a derivation through
// `purchases` would return only the grants somebody bought, and the rows it
// would drop are exactly the ones no purchase funded.
//
// `source_offer_id` IS THE OTHER TRAP AND IT IS THIS MODULE'S CHARACTERISTIC
// ONE. A redemption pointing at its catalogue row reads like a legitimate hop,
// and here the hop would be to `offers`, whose own rule is `owned` with a
// NULLABLE column: a grant issued from a `public` offer would reach nobody at
// all. The column is nullable besides. The identity is on the row and nothing
// else is needed.
//
// `source_payout_request_id` IS 0044's LATER COLUMN, folded by ADR-094's
// one-member vocabulary. It carries no `.references()`: the FK was added by
// `ALTER TABLE ... ADD COLUMN` rather than declared in the `CREATE TABLE` body,
// and `payout_requests` is not one of this file's tables either.
export const promotionalCreditGrants = pgTable('promotional_credit_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
  sourceOfferId: uuid('source_offer_id').references(() => offers.id),
  fundingPurchaseId: uuid('funding_purchase_id').references(() => purchases.id),
  // NOT NULL. Promotional credit expires; that is what distinguishes it from a
  // payable. An unexpiring promotional balance is a liability wearing a
  // marketing label.
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedCents: bigint('consumed_cents', { mode: 'bigint' }).notNull().default(0n),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: text('revoked_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // SD-M20-05, 0044. The settled payout that triggered a fee-back credit, NULL
  // on every offer-issued grant.
  sourcePayoutRequestId: uuid('source_payout_request_id'),
});

// -----------------------------------------------------------------------------
// account_status_history -- 0007_accounts.sql. DERIVED: `account_id` -> accounts.
// -----------------------------------------------------------------------------
// THE ACCOUNT'S OWN STATE LOG AND NOTHING ELSE'S. `account_id uuid NOT NULL
// REFERENCES accounts(id) ON DELETE RESTRICT` is the row's only reference, and
// `accounts` carries the identity, so the row reaches a person through its
// account in one hop and through no other path.
//
// EVERY OTHER COLUMN IS A STATE NAME RATHER THAN AN ACTOR. `from_status`,
// `to_status`, `from_phase` and `to_phase` are bare `text` with no CHECK and no
// enum, though `account_status` and `account_phase` both exist as types in 0001
// and `accounts` itself is declared against them. That is 0007's shape and not
// this file's to repair; the transcription follows the DDL, which is the same
// rule `fills.side` is transcribed under.
//
// `reason` IS THE ONLY FREE TEXT AND IT NAMES NOBODY. There is no `changed_by`
// on this table, so the log records WHAT MOVED and never WHO MOVED IT --
// `admin_actions` is where the actor lives -- and no column here reads like the
// `recorded_by` trap `scope.ts`'s header names.
export const accountStatusHistory = pgTable('account_status_history', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  fromPhase: text('from_phase'),
  toPhase: text('to_phase'),
  reason: text('reason'),
  // The transition's own clock, distinct from `created_at`'s write clock.
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// platform_account_refs -- 0007_accounts.sql, SD-M2-02. DERIVED: `account_id`.
// -----------------------------------------------------------------------------
// THE BURN LIST. INV-M2-10: a platform ref is never reused across accounts, for
// any reason, and the PRIMARY KEY IS THE BURN -- `(platform,
// platform_account_ref)` -- so a reassignment fails at insert rather than being
// detected later. FM-M2-05 is the worst outcome in M02 and this table is what
// forecloses it: a recycled ref silently routes one trader's fills onto another
// trader's account.
//
// THE TABLE HAS NO `id` OF ITS OWN, which is `price_floors`' and
// `contract_specs`' shape: the grain IS the composite key. `account_id uuid NOT
// NULL REFERENCES accounts(id) ON DELETE RESTRICT` is the tenancy and the ref
// pair is the identifier, so the hop is to `accounts` and the primary key
// contributes nothing to who may read the row.
//
// A RETIRED ROW IS STILL THAT ACCOUNT'S ROW. `retired_at` and `retired_reason`
// are nullable and tied by `platform_account_refs_retirement_is_explained`;
// retirement is what makes the ref permanently unusable, not what detaches it
// from the account it burned it.
//
// `platform` IS `text` WITH A THREE-VALUE CHECK (`rithmic`, `tradovate`, `cqg`)
// AND NOT AN ENUM, transcribed as the DDL writes it.
export const platformAccountRefs = pgTable(
  'platform_account_refs',
  {
    platform: text('platform').notNull(),
    platformAccountRef: text('platform_account_ref').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    retiredReason: text('retired_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.platform, t.platformAccountRef] })],
);

// -----------------------------------------------------------------------------
// provisioning_queue -- 0007_accounts.sql, SD-M2-01. DERIVED: `account_id`.
// -----------------------------------------------------------------------------
// ONE ROW PER INTENT, so partial success is legible: a batch that half-applied
// is M02's normal failure and it has to be readable operation by operation.
// `account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT`, and
// M02 section 3.6 states the consequence out loud -- the queue is per account
// and a restriction is per human, so there is no identity-level row to enqueue
// and there should not be.
//
// `payload_hash` IS `bytea` AND IS DECLARED AS A CUSTOM TYPE FOR THAT REASON.
// drizzle-orm 0.45.2's pg-core has no builtin, and `text()` would compile,
// would satisfy the column-name comparison, and would be a wrong transcription
// of a digest column. It is also deliberately NOT a generated column in the
// DDL: a generated one would need an immutable cast of `jsonb`, whose
// immutability is a Postgres version question, and SD-M2-01's duplicate-intent
// guard must not rest on that.
//
// `status` IS THE `provisioning_status` ENUM AND `operation` IS BARE `text`
// WITH A SEVEN-VALUE CHECK. The asymmetry is 0007's and is transcribed as
// found. The binding rule over the pair -- `set_risk` may never reach
// `confirmed_inferred` (AS-M2-03, INV-M2-13) -- is a table CHECK, so it is the
// database's and not this file's; nothing here restates it as a type.
export const provisioningQueue = pgTable('provisioning_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  operation: text('operation').notNull(),
  // The exact field values rendered into CSV.
  payload: jsonb('payload').notNull(),
  // SD-M2-01. Written by the enqueue path over a canonical serialization.
  payloadHash: bytea('payload_hash').notNull(),
  // The idempotent name, assigned at batch build.
  fileName: text('file_name'),
  status: provisioningStatus('status').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// platform_entitlements -- 0007_accounts.sql, SD-M2-05. DERIVED: `account_id`.
// -----------------------------------------------------------------------------
// THE HYGIENE LEDGER BEHIND REAL MONTHLY COST. `monthly_cost_cents` exists to
// make THE COST OF FORGETTING VISIBLE IN A QUERY, which is the only reason an
// entitlement leak ever gets closed (FM-M2-11).
//
// `account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT` IS THE
// TENANCY AND `platform_user_ref` IS NOT A SECOND PATH TO ONE. The latter is
// `text NULL` with no foreign key: it is the VENDOR's identifier for a login,
// used to group the invoice the way the vendor bills rather than the way Merit
// models, and it names no row in this database at all. SD-M2-05 adds it
// precisely because Rithmic bills per login-month per user while the row stays
// per account, so the two units sit side by side and only one of them is a
// reference.
//
// A DEACTIVATED ENTITLEMENT IS STILL THAT ACCOUNT'S ROW.
// `platform_entitlements_active_matches_dates` makes `active` and
// `deactivated_on` biconditional, so the history stays readable and the alarm's
// question -- any entitlement still active on a closed account -- stays
// answerable.
export const platformEntitlements = pgTable('platform_entitlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  entitlement: text('entitlement').notNull(),
  active: boolean('active').notNull().default(true),
  activatedOn: date('activated_on').notNull(),
  deactivatedOn: date('deactivated_on'),
  monthlyCostCents: bigint('monthly_cost_cents', { mode: 'bigint' }).notNull().default(0n),
  // SD-M2-05. THE VENDOR'S login identifier, not a `users` row and not a FK.
  platformUserRef: text('platform_user_ref'),
  billingUnit: text('billing_unit'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// ingest_files -- 0013_ingest.sql, SD-M2-03. FIRM: no identity, and no correct
// one.
// -----------------------------------------------------------------------------
// THE QUARANTINE MACHINE for B4 #4. A file in `quarantined` has committed NO
// downstream rows, enforced by processing the whole file in one transaction.
//
// A FILE IS A DELIVERY AND A DELIVERY IS NOT A PERSON'S. The table declares
// exactly one foreign key, `replaces_ingest_file_id`, and it points at ITSELF;
// no column reaches an account, an identity or a user, and there is no correct
// one, because one vendor file carries rows for every account that traded that
// session. The tenancy runs the other way: `fills.ingest_file_id`,
// `raw_ingest_rows.ingest_file_id` and `reconciliations.source_ingest_file_id`
// all point IN, and each of those tables carries its own `account_id`.
//
// `sha256` IS `bytea` AND IS THE IDEMPOTENCE GUARANTEE, not a helper for one:
// `ingest_files_sha256_uq` is what makes INV-M2-02's byte-identical redelivery
// a no-op. It is a custom type for the same reason `payload_hash` is.
//
// `disposition` IS SD-M2-03 AND IT IS THE MOST DANGEROUS BRANCH IN M02. A
// redelivery that is not byte-identical is otherwise indistinguishable from a
// new file, and a corrected redelivery treated as new DOUBLE-APPLIES A DAY.
// `ingest_files_applied_has_disposition` is what makes the decision explicit
// rather than default. **PROVISIONAL (ADR-005)**: the `kind` set and the
// correction arrival semantics are V-M2-01, V-M2-03 and V-M2-04, and 0013's own
// header says so. NOTHING THE VENDOR CALL CAN CHANGE ABOUT EITHER GIVES THIS
// TABLE AN OWNER, which is why the class is written now rather than deferred.
export const ingestFiles = pgTable('ingest_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileName: text('file_name').notNull(),
  sha256: bytea('sha256').notNull(),
  // PROVISIONAL: the real set depends on what the vendor delivers.
  kind: text('kind').notNull(),
  // Parsed from content, null until known.
  tradingDay: date('trading_day'),
  byteSize: bigint('byte_size', { mode: 'bigint' }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  status: ingestFileStatus('status').notNull().default('received'),
  rowCount: integer('row_count'),
  quarantineReason: text('quarantine_reason'),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  // SD-M2-03. Points at THIS table: a replacement supersedes rather than
  // deletes, so the replaced file stays readable and the audit chain has no
  // holes.
  replacesIngestFileId: uuid('replaces_ingest_file_id').references(
    (): AnyPgColumn => ingestFiles.id,
  ),
  disposition: text('disposition'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// raw_ingest_rows -- 0013_ingest.sql. FIRM, and it is a CONSEQUENCE of
// `ingest_files` being firm rather than a second judgment.
// -----------------------------------------------------------------------------
// IMMUTABLE LANDING ZONE. Merit keeps the vendor's bytes because OUR
// NORMALIZATION CAN BE WRONG AND THEIR FILE IS THE EVIDENCE. Append-only;
// 24 months hot, then archived with the file digest.
//
// ITS ONLY REFERENCE IS `ingest_file_id uuid NOT NULL REFERENCES
// ingest_files(id)`, AND `ingest_files` IS FIRM. A `derived` rule through it is
// the trap `DerivedRule.via` cannot refuse -- the via type is `TableKey` and
// includes every firm key -- so it would compile at every call site and throw
// the first time anybody read the table.
//
// THE REVERSE EDGE IS THE PLAUSIBLE MISTAKE AND IT IS WORSE THAN THE FORWARD
// ONE. `fills.raw_row_id bigint NOT NULL REFERENCES raw_ingest_rows(id)` is a
// declared foreign key in the direction the derived-rule assertion accepts, so
// a rule deriving this table through `fills` resolves, terminates at an owned
// table, and passes every mechanical check in the package. It is still wrong:
// only SOME raw rows become fills -- an EOD balance row becomes a `daily_marks`
// input, an unparsed row becomes nothing, and a quarantined file's rows become
// nothing BY DESIGN -- so the reading would silently drop exactly the rows a
// dispute is argued from. `raw` is `jsonb` holding the vendor's verbatim
// columns for whichever account the line concerns, and no column on this row
// says which.
export const rawIngestRows = pgTable('raw_ingest_rows', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  ingestFileId: uuid('ingest_file_id')
    .notNull()
    .references(() => ingestFiles.id),
  lineNumber: integer('line_number').notNull(),
  // Parsed columns, verbatim values.
  raw: jsonb('raw').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// reconciliations -- 0014_marks.sql, SD-M2-06. DERIVED: `account_id`.
// -----------------------------------------------------------------------------
// ONE ACCOUNT'S BALANCE, OURS BESIDE THEIRS, FOR ONE TRADING DAY. `account_id
// uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT`, so this is
// `daily_marks`' hop exactly and the day contributes nothing to who may read
// the row.
//
// `source_ingest_file_id` IS THE TRAP AND IT IS THIS MODULE'S CHARACTERISTIC
// ONE. It is a foreign key to `ingest_files`, which is FIRM, and it reads
// exactly like a legitimate hop; a rule through it would compile everywhere and
// throw on first read. It is NULLABLE besides, so even a firm-free version of
// the reading would drop every row reconciled before SD-M2-06 landed.
//
// `delta_cents` IS GENERATED, so the two sides and their difference can never
// disagree, and `reconciliations_status_matches_delta` makes `match` mean a
// zero delta BY CONSTRUCTION rather than by the writer's care.
export const reconciliations = pgTable('reconciliations', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  tradingDay: date('trading_day').notNull(),
  ourBalanceCents: bigint('our_balance_cents', { mode: 'bigint' }).notNull(),
  platformBalanceCents: bigint('platform_balance_cents', { mode: 'bigint' }).notNull(),
  deltaCents: bigint('delta_cents', { mode: 'bigint' }).generatedAlwaysAs(
    sql`our_balance_cents - platform_balance_cents`,
  ),
  status: text('status').notNull(),
  resolvedBy: text('resolved_by'),
  resolutionNote: text('resolution_note'),
  // SD-M2-06. WHICH FILE CARRIED THE VENDOR'S NUMBER. Nullable, and firm.
  sourceIngestFileId: uuid('source_ingest_file_id').references(() => ingestFiles.id),
  // SD-M2-06. Which of Merit's two internal derivations was compared.
  ourSource: text('our_source'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// reconciliation_runs -- 0064_reconciliation_runs.sql. FIRM.
// -----------------------------------------------------------------------------
// ONE ROW PER SWEEP, OVER THE WHOLE POPULATION, INSIDE ONE NIGHTLY BATCH RUN.
// The neighbour above is one COMPARISON and this is the CHECK that made it:
// there is no identity column and there is no correct one, because the accounts
// the sweep disagreed with are its OUTPUT, recorded on `reconciliations`, rather
// than its owner. That is `detector_runs`' sentence exactly.
//
// `batch_run_id` IS THE TRAP HERE AND IT IS NOT A HOP. It is a `uuid NOT NULL`
// with NO foreign key, because no batch run is a row anywhere in this schema:
// EVENTS section 5.3 declares the `run_id` in three payloads and stores it
// nowhere. A `derived` rule needs a declared edge and there is none, and if the
// table it named existed the chain would terminate at a firm run record in any
// case, which is `reserve_coverage_snapshots`' refusal.
//
// `reconciliation_runs_completed_is_whole` IS THE CONTROL AND NOTHING IN THIS
// FILE IS. `status = 'completed'` requires `accounts_done = accounts_total`, so
// a sweep killed at the account boundary cannot claim it covered the book --
// ADR-199 section 5's refusal of a fold over per-account clocks, written as a
// constraint instead of as prose.
//
// `status` IS `text` AND NOT AN ENUM because 0064 constrains it with a CHECK
// over 'running', 'completed' and 'failed' rather than a `CREATE TYPE`, and the
// transcription follows the DDL. 'running' is not decoration: a process that
// dies mid-sweep updates nothing, so a row left at 'running' with an old
// `started_at` is the only way a crashed run is visible at all.
export const reconciliationRuns = pgTable('reconciliation_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  // EVENTS 5.3's `run_id`. No `.references()`: there is no table to name.
  batchRunId: uuid('batch_run_id').notNull(),
  tradingDay: date('trading_day').notNull(),
  // NOT NULL where `detector_runs`' pair is nullable: the row is created BY the
  // start of the sweep, so the instant is always known.
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  // EVENTS 5.3's own names, from `batch.completed`'s payload. `accounts_total`
  // has no default on purpose: `0 of 0` would satisfy the completion control
  // vacuously.
  accountsTotal: integer('accounts_total').notNull(),
  accountsDone: integer('accounts_done').notNull().default(0),
  // What THIS RUN saw, which is not `mismatches_open`, a count of the current
  // state of `reconciliations` that moves when a human resolves one.
  mismatchesFound: integer('mismatches_found').notNull().default(0),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// loyalty_criteria -- 0023_loyalty_and_graduation.sql. FIRM. SD-M14-03.
// -----------------------------------------------------------------------------
// VERSIONED PROMISES, AND A PROMISE BELONGS TO NOBODY UNTIL IT IS EARNED. The
// table holds the PUBLISHED DEFINITION of a benefit and not an instance of one:
// `loyalty_benefit_grants` is where a named person appears, and it cites this
// table by `(benefit_code, criteria_version)` rather than being reached from it.
// There is no identity column here and no correct one, because criteria that
// differed per trader would not be published criteria.
//
// THE GRAIN IS `(benefit_code, version)` AND IT IS THE WHOLE PRIMARY KEY, so
// the table has no `uuid` of its own. That is `price_floors`' shape and it has
// the same consequence, stated rather than repaired: a version number alone
// cannot address a row here, which is why `offers.criteria_version` is a bare
// `integer` that selects nothing on its own.
//
// `superseded_by` IS A `benefit_code` AND NOT A ROW REFERENCE. The DDL declares
// it `text NULL` with no foreign key at all -- it names the successor CODE when
// a benefit is renamed, so it cannot address the `(code, version)` pair -- and it
// is transcribed as the bare `text` it is.
//
// `breaks_on` IS ENUMERATED RATHER THAN IMPLIED (INV-M14-07). "What breaks my
// streak" is the question a trader asks after it breaks, and answering it then
// is too late (AS-M14-07), so the array is `NOT NULL DEFAULT '{}'` and an empty
// promise says nothing breaks it rather than saying nothing.
export const loyaltyCriteria = pgTable(
  'loyalty_criteria',
  {
    benefitCode: text('benefit_code').notNull(),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    criteriaSpec: jsonb('criteria_spec').notNull(),
    termsBodyMdx: text('terms_body_mdx').notNull(),
    expiryRule: text('expiry_rule').notNull(),
    breaksOn: text('breaks_on').array().notNull().default([]),
    effectiveFrom: date('effective_from').notNull(),
    // NO `.references()`: it is a `benefit_code` rather than a row, and the DDL
    // declares no foreign key on it.
    supersededBy: text('superseded_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.benefitCode, t.version] })],
);

// -----------------------------------------------------------------------------
// loyalty_states -- 0023_loyalty_and_graduation.sql. OWNED: `identity_id`,
// NOT NULL. SD-M14-01.
// -----------------------------------------------------------------------------
// DERIVED PER DAY, NEVER A MUTABLE BALANCE (INV-M14-03). A mutable counter
// cannot be explained to a trader and cannot be audited: it says what it says.
// A derived state reproduces from the event stream, so a tier change is
// explicable and a hand edit is visible as a divergence.
//
// `identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` is on
// the row and it is the ONLY column that reaches a person. Every other column is
// a counter, and INV-M14-12 is why the grain is the identity rather than the
// account: cross-account loyalty is computed at the identity grain, from
// completed ladders.
//
// THE GRAIN IS `(identity_id, as_of_trading_day)` AND THE DAY CONTRIBUTES
// NOTHING TO WHO MAY READ IT, which is `analytics_snapshots`' and `daily_marks`'
// shape one table over: ONE STATE PER IDENTITY PER DAY, so the composite key is
// a history rather than a second owner.
//
// `inputs_digest` IS THE TAMPER INDICATION AND IT IS `bytea`. Recompute, compare,
// and a mismatch is a finding. Transcribed as a custom `bytea` rather than
// approximated as `text`, on this file's own header rule.
//
// `ladders_completed_lifetime` IS NOT A SEPARATE DELTA. It is inside SD-M14-01's
// own column list, and 0023 says so in the column's own comment because the
// corpus once recorded it as an addition (DELTA_MANIFEST section 7).
export const loyaltyStates = pgTable(
  'loyalty_states',
  {
    identityId: uuid('identity_id')
      .notNull()
      .references(() => identities.id),
    asOfTradingDay: date('as_of_trading_day').notNull(),
    payoutsLifetime: integer('payouts_lifetime').notNull(),
    consecutivePayoutCycles: integer('consecutive_payout_cycles').notNull(),
    accountsFundedLifetime: integer('accounts_funded_lifetime').notNull(),
    laddersCompletedLifetime: integer('ladders_completed_lifetime').notNull().default(0),
    resetsLifetime: integer('resets_lifetime').notNull(),
    tenureDays: integer('tenure_days').notNull(),
    derivationVersion: integer('derivation_version').notNull(),
    inputsDigest: bytea('inputs_digest').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.identityId, t.asOfTradingDay] })],
);

// -----------------------------------------------------------------------------
// loyalty_benefit_grants -- 0023_loyalty_and_graduation.sql. OWNED:
// `identity_id`, NOT NULL. SD-M14-02.
// -----------------------------------------------------------------------------
// `identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` is on
// the row. A grant is a named person's entitlement from the moment it exists,
// which is `promotional_credit_grants`' shape and its reason.
//
// `benefit_code` AND `criteria_version` CARRY NO `.references()` AND THAT IS THE
// FILE'S RULE RATHER THAN AN OMISSION. Their foreign key is real -- 0023 declares
// `loyalty_benefit_grants_criteria_fk` against `loyalty_criteria (benefit_code,
// version)` -- but it is a table-level CONSTRAINT rather than an inline column
// reference, and the header limits `.references()` to inline declarations. The
// fold reads `ADD COLUMN` and deliberately ignores `ADD CONSTRAINT`, so a
// constraint claimed here would be a claim nothing in this package checks.
//
// `consumed_ref` IS POLYMORPHIC AND IS NOT A SCOPE. It holds an M17 offer id or
// an M03 purchase id, it is deliberately NOT a foreign key because it is two
// kinds, and the single-spend guarantee is the partial unique index
// `loyalty_benefit_grants_consumed_ref_uq` rather than a reference. A bare `uuid`
// naming two possible parents reaches neither of them, so nothing here is
// derivable through it.
//
// A REVOKED GRANT IS STILL THIS IDENTITY'S ROW. `revoked_at` and `revoked_reason`
// are tied by `loyalty_benefit_grants_revocation_is_explained`, and
// `loyalty_benefit_grants_not_both_consumed_and_revoked` refuses the row that
// was both spent and withdrawn, which is INV-M14-09 in both directions.
export const loyaltyBenefitGrants = pgTable('loyalty_benefit_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  benefitCode: text('benefit_code').notNull(),
  criteriaVersion: integer('criteria_version').notNull(),
  earnedOnTradingDay: date('earned_on_trading_day').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  // NOT a foreign key: an offer id or a purchase id, per 0023's own comment.
  consumedRef: uuid('consumed_ref'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: text('revoked_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// discord_links -- 0019_notifications_and_community.sql. OWNED: `identity_id`,
// NOT NULL. SD-M15-01.
// -----------------------------------------------------------------------------
// `identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT` is on
// the row and it is the table's only reference. A LINK IS A CONSENT AND CONSENT
// IS THE PERSON'S, so the identity is the grain even though the primary key is
// the pair `(identity_id, discord_user_id)`: the second half is the FOREIGN
// account's id, which is Discord's key and not Merit's, and it names no row here.
//
// THE LINK IS NEVER AN AUTHENTICATION FACTOR (INV-M15-03). Registering this table
// makes it READABLE through the scoped accessor and nothing else -- ADR-092
// section 9 draws that boundary -- and INV-M15-03's actual enforcement is
// structural, by grant, outside this package entirely.
//
// `role_opt_ins` IS AN ARRAY BECAUSE CONSENT IS PER ROLE (INV-M15-01). A trader
// may be happy to be publicly "Funded" and not at all happy to be publicly
// "Recently Paid", and a single boolean would force one answer onto both.
//
// `link_nonce_hash` IS `bytea` AND IS TRANSCRIBED AS ONE. The nonce is stored
// HASHED so a stolen database yields no live link tokens; declaring it `text`
// would compile, would satisfy the column-name comparison, and would be a wrong
// transcription of the column's type.
//
// `revoked_at` IS THE END STATE AND THE ROW SURVIVES IT. A revoked link is still
// this identity's record that the link existed, and `discord_links_live_discord_user_uq`
// is partial on `revoked_at IS NULL`, so revocation frees the Discord account
// rather than deleting the history.
export const discordLinks = pgTable(
  'discord_links',
  {
    identityId: uuid('identity_id')
      .notNull()
      .references(() => identities.id),
    discordUserId: text('discord_user_id').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    roleOptIns: text('role_opt_ins').array().notNull().default([]),
    linkNonceHash: bytea('link_nonce_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.identityId, t.discordUserId] })],
);

// -----------------------------------------------------------------------------
// discord_announcements -- 0019_notifications_and_community.sql. FIRM.
// SD-M15-02.
// -----------------------------------------------------------------------------
// EVERY MESSAGE MERIT HAS EVER POSTED IN ITS OWN COMMUNITY, REPRODUCIBLE, WITH
// THE EVENT THAT CAUSED IT (INV-M15-04, INV-M15-05). THE ROW IS MERIT SPEAKING,
// so there is no identity column and there is no correct one: a post to a public
// channel is addressed to the room, and a per-identity slice of it is not a
// smaller version of it.
//
// `event_id` IS THE ONE COLUMN THAT LOOKS LIKE A PATH AND IT IS STILL NOT ONE,
// AND THE REASON IS NOW THE ONLY REASON. It is `bigint NULL REFERENCES
// events(id) ON DELETE RESTRICT`, and it read "carries no `.references()`
// because `events` is not one of this file's tables" until ADR-191 registered
// that table; the edge is claimed now, because the FK is inline in `0019`'s
// `CREATE TABLE` body and the target is here. WHAT DID NOT MOVE IS THE CLASS:
// this row is MERIT SPEAKING and the causing event is not its tenancy, so the
// `derived` rule that ADR-191 makes WRITABLE is refused on the same ground it
// was described by before it could be written. It is NULLABLE besides -- a
// status post has no causing event -- so ADR-101 clause 2 refuses it a second
// time. `integration_dispatches.event_id` is the same column with the same
// treatment, one migration earlier.
//
// ANNOUNCEMENTS ARE TEMPLATE-ONLY. `template_code` is NOT NULL, so there is no
// path by which a free-text post reaches the channel through this system, which
// is what INV-M15-04 buys: a compromised bot token cannot speak a rule change
// into existence in Merit's own voice.
//
// `rendered_body` IS STORED RATHER THAN RE-RENDERED, which is what makes the
// table evidence: what was said is a fact about the past and a template that has
// since changed cannot restate it. `discord_announcements_posted_has_ref` makes
// `posted_at` imply `provider_message_ref`, so a row claiming to have been posted
// names the message it claims to be.
export const discordAnnouncements = pgTable('discord_announcements', {
  id: uuid('id').primaryKey().defaultRandom(),
  // `.references()` SINCE ADR-191: `events` is one of this file's tables now,
  // and the FK is inline in the CREATE TABLE body. It is still not a scope.
  eventId: bigint('event_id', { mode: 'bigint' }).references(() => events.id),
  templateCode: text('template_code').notNull(),
  channelId: text('channel_id').notNull(),
  renderedBody: text('rendered_body').notNull(),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  providerMessageRef: text('provider_message_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// geo_restrictions -- 0004_catalog.sql. FIRM.
// -----------------------------------------------------------------------------
// COUNSEL'S EXCLUSION LIST, ONE ROW PER COUNTRY. There is no identity column
// and there is no correct one: a restriction is a statement about a
// JURISDICTION and it is identical for every person in it, which is the
// property DEP-M9-04 depends on when it makes this table the single source for
// checkout enforcement, campaign targeting and the site notice at once. A
// per-identity slice of a country's rule is not a smaller version of it.
//
// THE PRIMARY KEY IS `country_code` AND THE TABLE HAS NO `uuid` OF ITS OWN, so
// there is no surrogate id for anything to point at, and no foreign key in the
// tree points here. Nothing reaches an identity even one hop out.
//
// `reason` IS COUNSEL'S RATIONALE AND `effective_from` IS A DATE RATHER THAN A
// TIMESTAMP, both in 0004's own words: "why is this country blocked" is a
// question with a legal answer, versioned by row history in `events`. That
// history lives in another table and is not a second path to a person here.
export const geoRestrictions = pgTable('geo_restrictions', {
  countryCode: char('country_code', { length: 2 }).primaryKey(),
  // Bare `text` with a CHECK to ('block_purchase', 'block_all', 'warn'). The
  // three values are in the DDL and there is no enum type for them.
  rule: text('rule').notNull(),
  reason: text('reason').notNull(),
  effectiveFrom: date('effective_from').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// tos_versions -- 0004_catalog.sql. FIRM.
// -----------------------------------------------------------------------------
// WHAT THE FIRM PUBLISHED. One row per (document, version) of the ToS, the
// privacy policy, the risk disclosure and the affiliate terms. There is no
// identity column and there is no correct one: EVERY identity is shown the same
// version, and the link runs the other way -- `tos_acceptances.tos_version_id`
// names the version a person accepted -- so ownership flows FROM the published
// document rather than to it. That is `plan_versions`' reason exactly, on the
// legal catalogue instead of the commercial one.
//
// THIS TABLE AND `tos_acceptances` ARRIVE IN THE SAME MIGRATION AND TAKE
// DIFFERENT CLASSES, WHICH IS THE POINT RATHER THAN AN INCONSISTENCY. A version
// row is a thing Merit published to the world; an acceptance row is a thing one
// named person did, on a date, from an address. M09 section 1.2 draws the line
// in the corpus's own words: the site "renders versioned legal documents and
// records nothing about acceptance". A shared class here would either hide a
// public document behind an identity that does not exist, or hand a person's
// signature to everyone the document was shown to.
//
// A PUBLIC READ OF THIS TABLE IS NOT A LEAK. `body_md` is the text Merit
// publishes, and a superseded version stays readable forever because the
// version a trader accepted has to remain quotable (FM-M9-06, INV-M9-11).
export const tosVersions = pgTable('tos_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Bare `text` with a CHECK to ('tos', 'privacy', 'risk_disclosure',
  // 'affiliate_tos'). Four values, no enum type.
  document: text('document').notNull(),
  // CHECKed `> 0`. A version is an ordinal and never an id.
  version: integer('version').notNull(),
  bodyMd: text('body_md').notNull(),
  // NOT NULL and NOT defaulted: a version has an effective moment that is
  // decided rather than observed, so it is never `now()` by accident.
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// tos_acceptances -- 0004_catalog.sql. OWNED: `identity_id`, NOT NULL.
// -----------------------------------------------------------------------------
// WHAT A PERSON DID. `identity_id uuid NOT NULL REFERENCES identities(id) ON
// DELETE RESTRICT` is on the row, and `ON DELETE RESTRICT` is the DDL saying an
// acceptance outlives every convenience: the identity cannot be deleted out
// from under the signature. There is no unowned acceptance and the table has no
// way to write one.
//
// `tos_version_id` IS THE TRAP AND IT IS THE ONE THIS PAIR MAKES PLAUSIBLE. It
// is `uuid NOT NULL REFERENCES tos_versions(id)`, single-valued, declared
// inline -- it reads exactly like `daily_marks`' hop to `accounts` and it is not
// one, because `tos_versions` is FIRM. `DerivedRule.via` is `TableKey` and
// includes every firm key, so a `derived` rule through it compiles at every
// call site and throws the first time anybody reads this table. The identity is
// on the row and no hop is needed.
//
// `ip` AND `user_agent` ARE THE EVIDENCE AND NEITHER IS A SECOND PATH TO A
// PERSON. `ip inet NOT NULL` is stored in the clear here, unlike
// `certificate_verifications.ip_hash`, because this row is a party's own record
// of their own act rather than telemetry about strangers; it references
// nothing. `user_agent` is the only nullable column on the table.
//
// A SCOPED READ RETURNS EVERY VERSION THIS PERSON EVER ACCEPTED, not the
// current one: DEP-M16-06 keeps acceptance a positive act with a history, and
// the history is what FM-M9-06's pinned-version argument is settled from.
export const tosAcceptances = pgTable('tos_acceptances', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id')
    .notNull()
    .references(() => identities.id),
  tosVersionId: uuid('tos_version_id')
    .notNull()
    .references(() => tosVersions.id),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
  ip: inet('ip').notNull(),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// certificate_verifications -- 0025_reserved_sequence.sql. FIRM.
// -----------------------------------------------------------------------------
// THE VERIFY ENDPOINT'S ACCESS LOG, AND THE ROWS ARE THE VERIFIERS' RATHER THAN
// THE HOLDER'S. `GET /verify/:code` is public, unauthenticated and rate limited
// (M11 section 6), so whoever produced a row here is an outsider Merit has no
// identity for and never will. There is no identity column, and the table
// declares NO FOREIGN KEY AT ALL.
//
// THE HOP TO `certificates` DOES NOT EXIST, AND THAT IS WORTH SAYING BECAUSE
// `certificates` IS REGISTERED AND WOULD MAKE A PLAUSIBLE `via`. The column is
// `code_hash bytea`, a DIGEST OF THE ATTEMPTED CODE, and 0025 says why in the
// column's own comment: storing the codes in the clear would make this table a
// list of valid tokens for anyone who reached it. A hash addresses no row, most
// attempts resolve to no certificate at all -- `unknown` is one of the four
// results -- and a rule cannot be written through a join the schema refuses to
// declare.
//
// AND THE CLASS WOULD BE WRONG EVEN IF THE JOIN EXISTED. The signal this table
// carries is the RATE of `unknown` across all verifiers, which is an
// enumeration campaign in progress (AS-M11-04, FM-M11-04). That is estate-wide
// security telemetry; a per-certificate slice of it is not a smaller version of
// it, and handing a holder the list of who looked their card up would publish
// the verifiers instead of the certificate.
//
// `ip_hash` IS NULLABLE AND `user_agent_class` IS A CLASS AND NEVER THE STRING,
// both in 0025's words. Hashed inputs only, 90 day retention.
export const certificateVerifications = pgTable('certificate_verifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  codeHash: bytea('code_hash').notNull(),
  // Bare `text` with a CHECK to ('valid', 'unknown', 'revoked', 'deferred').
  result: text('result').notNull(),
  ipHash: bytea('ip_hash'),
  userAgentClass: text('user_agent_class'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// idempotency_keys -- 0017_events_and_audit.sql. OWNED: `identity_id`, NULLABLE.
// -----------------------------------------------------------------------------
// THE IDENTITY IS ON THE ROW AND IT IS NULLABLE, WHICH IS THE `ledger_accounts`
// AND `offers` SHAPE RATHER THAN A GAP. `identity_id uuid NULL REFERENCES
// identities(id) ON DELETE RESTRICT` is the only column in the body that reaches
// a person: `key` is the client's own token, `endpoint` is a route and
// `request_hash` is a digest. A key replayed by an unauthenticated caller -- a
// PSP webhook is the shape 0017 exists for -- carries no identity and no correct
// one, so filtering `identity_id = $1` excludes it without a second predicate,
// because SQL NULL never equals anything. The DDL agrees in its own index:
// `idempotency_keys_identity_idx (identity_id)` is declared WHERE NOT NULL, so
// the database itself treats the null rows as a different population.
//
// THERE IS NO CHECK MAKING THE NULLABILITY BICONDITIONAL, AND THAT IS STATED
// RATHER THAN GLOSSED. `offers` has `offers_identity_scope_matches` tying its
// null to `scope`; this table has nothing of the kind, so `identity_id IS NULL`
// means "no identity was recorded" and never "the firm owns it". A scoped read
// therefore returns a person's own replays and nothing else, which is the right
// answer, and the unowned rows stay reachable only through `systemDb`.
//
// `response_body` HOLDS A STORED RESPONSE VERBATIM AND A SCOPE RULE SAYS
// NOTHING ABOUT WHAT IS INSIDE ONE. 0017's own comment is "replaying a key
// returns the stored response VERBATIM", so the projection is what bounds what
// a replay hands back; registering the table decides which ROWS reach an
// identity and decides nothing else.
//
// `request_hash` IS THE `bytea` CUSTOM TYPE AND NOT `text`. A digest declared as
// `text` would compile and would satisfy the column-name comparison, which is
// exactly the axis ADR-094 section 3 records this suite does not check.
//
// NO `updated_at`. The body declares `created_at` alone, and the row is written
// once and read back; a 30-day retention is the whole of its lifecycle.
export const idempotencyKeys = pgTable('idempotency_keys', {
  // Scoped by endpoint prefix, which is why the key alone is the primary key
  // and `endpoint` is stored beside it rather than composed into one.
  key: text('key').primaryKey(),
  identityId: uuid('identity_id').references(() => identities.id),
  endpoint: text('endpoint').notNull(),
  // THE SAME KEY WITH A DIFFERENT BODY IS A CLIENT BUG AND RETURNS 409. Not a
  // new request, and not a silent overwrite of the first one: those are the two
  // ways an idempotency layer becomes a duplicate-payment machine.
  requestHash: bytea('request_hash').notNull(),
  responseStatus: integer('response_status'),
  responseBody: jsonb('response_body'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// trading_calendar -- 0004_catalog.sql, relaxed by
// 0032_trading_calendar_holidays_coverage_revisions.sql. FIRM.
// -----------------------------------------------------------------------------
// THE TRADING DAY IS DATA, NEVER ARITHMETIC (B4 #1). Session boundaries are
// stored as UTC instants derived from the CT session definitions, so DST is a
// row rather than a calculation, and no engine rule derives a trading day from
// a timestamp's UTC date.
//
// IT IS REGISTERED, AND THE TWO BLOCKS BELOW USED TO SAY IT COULD NOT BE. 0032
// carries `ALTER TABLE trading_calendar ALTER COLUMN session_open_at DROP NOT
// NULL` and the same for `session_close_at`, which ADR-094's one-member fold
// refused. ADR-103 clause 2 SUPERSEDED that clause and only that clause: the
// fold's vocabulary gained a SECOND member, `ALTER COLUMN <name> DROP NOT NULL`
// is folded and moves the nullability, and that entry names this table by name
// as one of the two the widening makes REGISTRABLE. The refusal outlived the
// ruling that superseded it and is discharged here.
//
// THE SUB-VOCABULARY IS STILL CLOSED AT ONE SHAPE WITH A DEFAULT OF FAIL
// (ADR-103 clause 3), so this registration rests on a reading rather than on a
// permission. Replayed across every migration, each `ALTER TABLE
// trading_calendar` statement is one of those two `DROP NOT NULL`s or a
// CONSTRAINT statement the fold deliberately ignores: no `ADD COLUMN`, no
// `SET DATA TYPE`, no `SET NOT NULL`, no `DROP COLUMN` and no `RENAME`. So
// 0004's CREATE body IS this column set, with exactly two nullabilities moved.
//
// FIRM IS THE READING OF THE DDL AND NOT A DEFAULT. The primary key is
// `trading_day date`, which is a DAY; the row declares NO foreign key at all
// and no column against `identities(id)` or `accounts(id)`, so `owned`, `pair`
// and `either` have no column to name, `derived` has no edge to traverse, and
// `root` is `identities`' alone. Every trader gets the same exchange calendar,
// which is the reason its two satellites below are firm as well.
//
// BOTH SESSION COLUMNS ARE NULLABLE, WHICH IS THE FOLD AND NOT THE CREATE: a
// reader transcribing 0004 alone writes `.notNull()` on both and is wrong as of
// 0032. `trading_calendar_holiday_has_no_session` makes the nullability
// BICONDITIONAL with `is_holiday` -- `is_holiday = (session_open_at IS NULL)`
// -- so a NULL session means A HOLIDAY here and never "nothing was recorded",
// which is the opposite of `idempotency_keys.identity_id` two blocks above.
// This file transcribes no CHECK, so that biconditional is the database's and a
// reader of the declaration alone does not have it.
//
// WHAT THIS TABLE DOES NOT SAY IS WHICH DAYS IT KNOWS ABOUT. Coverage is in
// `trading_calendar_loads`, and a day outside it is UNKNOWN rather than a
// holiday (ADR-042 F-4), which is what makes an exhausted calendar an answer
// instead of an unbroken silent holiday. A row is CORRECTED and never removed:
// 0033 installs CALENDAR-C1 and CALENDAR-C2 and 0048 installs CALENDAR-C3, all
// three of them triggers and none of them expressible here.
export const tradingCalendar = pgTable('trading_calendar', {
  // The exchange's CT trading day, never a UTC calendar date.
  tradingDay: date('trading_day').primaryKey(),
  // NULLABLE SINCE 0032, and exactly when the day is a holiday. A holiday row
  // had to carry a FABRICATED session interval before that, under a CHECK whose
  // own comment said a holiday has no session to contain fills in -- and R-01
  // is a containment lookup, so a fabricated interval is an interval a fill can
  // fall inside.
  sessionOpenAt: timestamp('session_open_at', { withTimezone: true }),
  // On an early-close day this is the LATEST close across the product groups
  // `contract_specs` lists (ADR-042 F-3), because the latest close is the one
  // that cannot orphan a fill. The per-group times are in `notes`.
  sessionCloseAt: timestamp('session_close_at', { withTimezone: true }),
  // A half day counts as a FULL DAY (B4 #3). A half day that counted as half a
  // day would make the minimum-trading-days gate a different promise in
  // November.
  isHalfDay: boolean('is_half_day').notNull().default(false),
  isHoliday: boolean('is_holiday').notNull().default(false),
  // Day counters advance, win days do NOT (B4 #2).
  halted: boolean('halted').notNull().default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // THE ROW MOVES, which is why this table carries an `updated_at` and its two
  // satellites carry none: a correction is an UPDATE, and 0033's trigger is
  // what makes it leave a prior image.
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// trading_calendar_loads -- 0032_trading_calendar_holidays_coverage_revisions.sql.
// FIRM.
// -----------------------------------------------------------------------------
// THE EXCHANGE'S CALENDAR BELONGS TO NO TRADER, AND THIS ROW IS THE PROVENANCE
// OF ONE LOAD OF IT. There is no identity column, no account column and nothing
// that reaches either: `source_id` names a source publication, the two coverage
// bounds are dates, `source_digest` is a SHA-256 of the file, and `actor` is a
// free-text operator string on 0002's `actor` idiom rather than a `users`
// reference. `firm` here is the reading of the DDL and not a default.
//
// ITS NEIGHBOUR `trading_calendar` IS REGISTERED, AND THIS PARAGRAPH USED TO
// SAY IT COULD NOT BE. It read that 0032's two `ALTER TABLE trading_calendar
// ALTER COLUMN ... DROP NOT NULL` statements are refused by ADR-094's one-member
// vocabulary, "so `trading_calendar` cannot be registered". ADR-103 CLAUSE 2
// SUPERSEDED EXACTLY THAT CLAUSE: the fold's vocabulary gained a second member,
// `ALTER COLUMN <name> DROP NOT NULL` is folded, and the entry names the
// neighbour as one of the two tables the widening makes REGISTRABLE. The
// sentence outlived the ruling that superseded it; the declaration is above.
//
// THE FOLD STATUS IS STILL DERIVED PER TABLE RATHER THAN INHERITED, which is
// what the old paragraph had right. Replayed across every migration with the
// suite's own multiline match, `trading_calendar_loads` carries NO `ALTER TABLE`
// of any shape at all -- not `ADD COLUMN`, not `ADD CONSTRAINT` -- so its
// `CREATE TABLE` body IS its column set as of the last migration, and a
// neighbour's history says nothing about it. All three tables of this family
// have DIFFERENT histories and the block below is the third one.
//
// THE COVERAGE BOUNDS ARE TRADING DAYS AND NOT UTC CALENDAR DATES, which is why
// they are `date` in the same domain as `trading_calendar.trading_day`. A day
// inside these bounds with no calendar row is a bug in the load; a day OUTSIDE
// them is UNKNOWN, and unknown is not a holiday. That distinction is what makes
// an exhausted calendar an answer rather than an unbroken silent holiday.
//
// NO `loaded_at`, AND ITS ABSENCE IS RULED. DATA_MODEL section 1 permits three
// exceptions to every-table-carries-`created_at`, each carrying a MORE SPECIFIC
// timestamp instead. Here the row's creation IS the load, so a second timestamp
// would be a second answer to one question.
export const tradingCalendarLoads = pgTable('trading_calendar_loads', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  // `text` rather than an enum: the set grows about once a year, which is the
  // case DATA_MODEL section 1 sends to `text` with a check.
  sourceId: text('source_id').notNull(),
  coverageStartDay: date('coverage_start_day').notNull(),
  coverageEndDay: date('coverage_end_day').notNull(),
  // SHA-256 of the source file as committed, `length = 32` in the DDL. The
  // loader re-reads the rows it wrote, re-canonicalizes and asserts the digests
  // match, which is what catches a truncated load and a partial transaction.
  sourceDigest: bytea('source_digest').notNull(),
  actor: text('actor').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// trading_calendar_revisions -- 0032_trading_calendar_holidays_coverage_revisions.sql.
// FIRM.
// -----------------------------------------------------------------------------
// A CORRECTION TO THE EXCHANGE CALENDAR IS A STATEMENT ABOUT A DAY, AND A DAY
// BELONGS TO NOBODY. No column reaches an identity or an account: `trading_day`
// is a date, `prior_row` is `to_jsonb(OLD)` of a `trading_calendar` row,
// `source_digest` is a digest, `incident_ref` is an incident label, and `actor`
// is the same free-text operator string its sibling carries, written by the
// loader and by an operator, neither of which is a `users` row.
//
// `dependent_row_count` IS THE COLUMN MOST LIKELY TO BE MISREAD AS TENANCY AND
// IT IS A COUNT. It is the number of rows in `fills`, `daily_marks` and
// `rule_states` that depend on this trading day, counted by the loader BEFORE
// the write and asserted a second time by `0033`'s trigger under ADR-045. Those
// three tables are each scoped to an identity; this number is not, because a
// count across every account is a property of the DAY. Zero is an ordinary data
// change and non-zero is an incident, which is what the `incident_ref` CHECK
// reads.
//
// `trading_day` STILL CARRIES NO `.references()` AND THE REASON CHANGED
// ENTIRELY. It used to be that `trading_calendar` "is not one of this file's
// tables and cannot become one", ADR-094's fold refusing it; ADR-103 clause 2
// superseded that clause and the table is declared above. THE REASON NOW IS
// THIS FILE'S OTHER RULE AND IT IS 0048 THAT DECIDES IT: 0032 declares this FK
// INLINE in the CREATE body, and 0048 DROPS that constraint and re-ADDS it under
// the same name as `DEFERRABLE INITIALLY DEFERRED`, through
// `ALTER TABLE ... ADD CONSTRAINT`. This file admits `.references()` only for an
// FK the CREATE body declares inline, and the constraint standing as of the last
// migration is an ALTER-added one, which the drift assertion deliberately does
// not read. It would also be a NARROWER claim than the constraint it named:
// drizzle-orm cannot state DEFERRABLE at all, and WHEN the referenced day has to
// exist is the whole of what 0048 changed, which is what lets a backfill record
// the absence before it adds the day. The COLUMN alone is transcribed and the
// constraint is left to the database.
//
// THIS TABLE DOES CARRY `ALTER TABLE` STATEMENTS AND THAT SENTENCE SAID IT DID
// NOT. It read "replayed across all 47 migrations, this table carries no
// `ALTER TABLE` of any shape", and 0048 carries two of them: the DROP CONSTRAINT
// and ADD CONSTRAINT pair the paragraph above describes. THE CONCLUSION SURVIVES
// AND THE STATED REASON DOES NOT. Neither statement touches a column, so the
// fold passes over both and the `CREATE TABLE` body is still this table's column
// set as of the last migration. A constraint is not a column, which is the same
// distinction the paragraph above draws about `.references()`.
export const tradingCalendarRevisions = pgTable('trading_calendar_revisions', {
  id: bigint('id', { mode: 'bigint' }).generatedAlwaysAsIdentity().primaryKey(),
  // NO `.references()`: `trading_calendar` is not one of this file's tables.
  tradingDay: date('trading_day').notNull(),
  // THE PRIOR IMAGE IS DERIVED, NOT LISTED. `to_jsonb(OLD)` of the whole row, so
  // a column a future migration adds to `trading_calendar` is captured
  // automatically. The image must be built by the database: an image assembled
  // in application code renders timestamps differently and does not equal it.
  priorRow: jsonb('prior_row').notNull(),
  actor: text('actor').notNull(),
  // Required, because a prior image with no reason records that the calendar
  // moved and not that anybody decided it should.
  reason: text('reason').notNull(),
  // SHA-256 of the source file that produced the NEW value, `length = 32` in the
  // DDL, so a revision traces to the transcription that caused it.
  sourceDigest: bytea('source_digest').notNull(),
  dependentRowCount: integer('dependent_row_count').notNull(),
  // NULL is legal only when nothing depended on the day, which
  // `trading_calendar_revisions_incident_named_when_dependent` is what enforces.
  incidentRef: text('incident_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// identity_links -- 0002_identity.sql, PLUS FOUR COLUMNS FROM SD-M7-04
// -----------------------------------------------------------------------------
// `pair` (ADR-106). TWO identity columns and both are true. The `create` body
// already carried the dispute columns when the schema-delta reconciliation
// folded SD-M7-04 into it, so this table takes no `ALTER TABLE` of any shape;
// replayed across all 47 migrations it carries none.
//
// `identity_links_canonical_order` CHECKs `identity_a < identity_b`, which is
// why an `owned` rule on either column returns a strict subset of a person's own
// edges SELECTED BY UUID ORDERING. The registry refuses the disjunction as well,
// and `scope.ts` is where that ruling lives.
export const identityLinks = pgTable('identity_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityA: uuid('identity_a')
    .notNull()
    .references(() => identities.id),
  identityB: uuid('identity_b')
    .notNull()
    .references(() => identities.id),
  // `text` with NO CHECK in the DDL: shared_device, shared_payment,
  // biometric_match and behavioural_correlation are the values 0002 names in a
  // comment, and FOLD-01 adds the phone edge as a vocabulary value rather than
  // as a migration. A closed set here would be a claim the database does not
  // make.
  linkKind: text('link_kind').notNull(),
  // ADR-022 made the graph SCORED and never boolean: hard links auto-enforce and
  // soft clusters queue a pre-funding review, and a boolean edge cannot carry
  // the distinction. Basis points, integer, CHECKed 0 to 10000.
  confidenceBp: integer('confidence_bp').notNull(),
  // The specific observations behind the edge. An edge without its evidence is
  // an accusation without a reason, and it is detector output, which is half of
  // why this table is not scoped.
  evidence: jsonb('evidence').notNull(),
  // A detector name, or 'admin'. 0002's `actor` idiom, not a `users` reference.
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // SD-M7-04, INV-M7-09. `suppressed` is the operative field: a suppressed edge
  // stays visible as history and stops contributing to enforcement, and the edge
  // is never deleted because "we decided this edge was wrong" is itself
  // evidence.
  disputedAt: timestamp('disputed_at', { withTimezone: true }),
  disputeNote: text('dispute_note'),
  suppressed: boolean('suppressed').notNull().default(false),
  suppressedBy: text('suppressed_by'),
});

// -----------------------------------------------------------------------------
// dedupe_matches -- 0003_kyc.sql, SD-M19-04
// -----------------------------------------------------------------------------
// `pair` (ADR-106), and `identity_links`' shape one module over. ADR-029 ruled
// this table AUTHORITATIVE and ruled `kyc_verifications.dedupe_matched_identity_id`
// never created, because a dedupe hit is an auto-enforcement input and two
// sources for that decision eventually enforce on whichever is read first.
//
// Replayed across all 47 migrations this table carries no `ALTER TABLE` of any
// shape.
export const dedupeMatches = pgTable('dedupe_matches', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityA: uuid('identity_a')
    .notNull()
    .references(() => identities.id),
  identityB: uuid('identity_b')
    .notNull()
    .references(() => identities.id),
  // Basis points on the same 0 to 10000 scale as `identity_links.confidence_bp`,
  // CHECKed in the DDL. `integer` and not `smallint`: the DDL says integer.
  matchStrength: integer('match_strength').notNull(),
  providerRef: text('provider_ref').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  // CHECKed in the DDL to open, confirmed_same_person, distinct_persons,
  // inconclusive. `open` is FIRST because it is the default and because a
  // disposition list whose first value is a conclusion invites defaulting to
  // one. Not a pgEnum: 0003 declares a CHECK and this file transcribes the
  // column's type, which is `text`.
  disposition: text('disposition').notNull().default('open'),
  dispositionNote: text('disposition_note'),
  // The provider's decision metadata: scores, method, timestamps. NEVER images
  // (AS-M19-07, VG-10). This is what makes an enforcement survive the provider
  // relationship ending, which is the difference between evidence Merit holds
  // and evidence Merit rents.
  evidenceSnapshot: jsonb('evidence_snapshot').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// attributions -- 0012_disputes_and_affiliate_settlement.sql, PLUS SD-M8-05
// -----------------------------------------------------------------------------
// `pair` (ADR-106), and the two identities are the ONE thing SD-M8-05 added them
// for: the self-deal check has to record WHAT IT FOUND and not only its verdict,
// or an argument about a voided commission has no evidence on either side.
//
// THE PAIR MAY COLLAPSE HERE AND ON NO OTHER PAIR TABLE.
// `attributions_literal_self_deal_is_void` is `buyer_identity_id <>
// affiliate_identity_id OR voided = true`, so the two columns may name one
// person on a voided row, and that row is the self-deal rather than an exception
// to the class.
//
// Replayed across all 47 migrations this table carries no `ALTER TABLE` of any
// shape: SD-M8-05's three columns were folded into the `CREATE TABLE` body by
// the schema-delta reconciliation.
export const attributions = pgTable('attributions', {
  id: uuid('id').primaryKey().defaultRandom(),
  // UNIQUE in the DDL, and the unique is what stops two affiliates being paid
  // for one sale (INV-M8-01). Attribution resolves once, at checkout.
  purchaseId: uuid('purchase_id')
    .notNull()
    .unique()
    .references(() => purchases.id),
  affiliateId: uuid('affiliate_id')
    .notNull()
    .references(() => affiliates.id),
  // CHECKed in the DDL to last_touch, code_override. INV-M8-02 records the
  // resolution order on this column: code override first, then last touch.
  model: text('model').notNull(),
  // `affiliate_clicks.id` is `bigint GENERATED ALWAYS AS IDENTITY`, so this is a
  // bigint and not a uuid. NULL when the attribution came from a typed code.
  clickId: bigint('click_id', { mode: 'bigint' }).references(() => affiliateClicks.id),
  // A self-purchase VOIDS attribution and raises a flag (B4 #16). Voiding rather
  // than deleting, because the attempt is the signal.
  voided: boolean('voided').notNull().default(false),
  voidReason: text('void_reason'),
  // SD-M8-05. Both identities are STORED rather than joined, because the row is
  // a statement about the two of them AT THE MOMENT OF PURCHASE and an affiliate
  // can be reassigned or an identity merged afterwards.
  buyerIdentityId: uuid('buyer_identity_id')
    .notNull()
    .references(() => identities.id),
  affiliateIdentityId: uuid('affiliate_identity_id')
    .notNull()
    .references(() => identities.id),
  // The link-graph score (ADR-022) that produced the verdict. NULL when the two
  // identities are literally the same row, because that case needs no score.
  selfDealLinkConfidenceBp: integer('self_deal_link_confidence_bp'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// otp_challenges -- 0002_identity.sql, PLUS TWO COLUMNS AND ONE RELAXATION
// FROM 0029_phone_identity_and_auth.sql (SD-M16-05)
// -----------------------------------------------------------------------------
// `firm`, and it is the first firm table whose reason is TIMING rather than
// ownership: `POST /auth/otp` is the only endpoint in the contract at required
// factor `none`, so the row is written before this database holds an identity
// for the caller at all.
//
// THIS IS THE TABLE ADR-094's `ALTER COLUMN` REFUSAL STOOD IN FRONT OF, AND
// ADR-103 IS WHY IT CAN BE TRANSCRIBED. `0029` writes `ALTER COLUMN
// email_normalized DROP NOT NULL`, which was a proxy refusal for the fact that
// nullability was compared nowhere; the comparison exists now and the fold
// applies the relaxation, so `email_normalized` below is NULLABLE and the suite
// checks that against the migration set rather than against this line.
export const otpChallenges = pgTable('otp_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  // NULLABLE AS OF 0029 AND NOT AS OF ITS CREATE. An SMS challenge has no email
  // address; `otp_challenges_exactly_one_destination` is what keeps exactly one
  // destination on every row. `citext` for `users.email`'s reason: casing never
  // creates a duplicate human.
  emailNormalized: citext('email_normalized'),
  // NEVER the code itself.
  codeHash: bytea('code_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  // Lockout WITHOUT enabling user enumeration: the counter is on the CHALLENGE
  // and not on the account, so a locked-out attacker learns nothing about
  // whether the address exists. CHECKed 0 to 5 in the DDL.
  attempts: smallint('attempts').notNull().default(0),
  requestIp: inet('request_ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // SD-M16-05. NO DEFAULT, deliberately: a `DEFAULT 'email'` would let a handler
  // that forgot to set the channel write a well-formed email challenge, and the
  // exactly-one-destination CHECK would be the only thing that noticed, which is
  // a constraint doing a type's job. CHECKed to email, sms.
  channel: text('channel').notNull(),
  // SD-M16-05. The SMS destination, HASHED. Never the number: an OTP table is
  // not a reason to keep a plaintext copy of every number ever entered,
  // including every number entered by an attacker.
  destinationHash: bytea('destination_hash'),
});

// -----------------------------------------------------------------------------
// payment_disputes -- 0012_disputes_and_affiliate_settlement.sql. DERIVED: the
// row carries NO identity column and reaches one through `purchases` alone.
// -----------------------------------------------------------------------------
// P-3'S CHARGEBACK-WINDOW INPUT. A dispute is a statement about a PURCHASE, and
// the purchase is what carries the person: `purchase_id uuid NOT NULL REFERENCES
// purchases(id) ON DELETE RESTRICT` is the only column here that reaches
// anybody, and it is NOT NULL, so there is no row that reaches no identity.
//
// `ledger_transaction_id` IS THE AVAILABLE MISTAKE AND IT IS NAMED HERE RATHER
// THAN LEFT TO BE RE-DERIVED. It is `uuid NULL REFERENCES
// ledger_transactions(id)`, and `ledger_transactions` is registered `derived`
// rather than `firm`, so a rule through it TERMINATES and COMPILES -- which is
// session 202's `wallet_entries` trap in a second dress. It is wrong twice: the
// column is NULLABLE, so it would return a person only the disputes that
// already moved money and drop every OPEN one in silence, and it answers a
// different question besides -- whose ledger accounts appear on the compensating
// reversal, rather than whose purchase was disputed.
//
// THE COMPENSATING REVERSAL IS A POINTER AND NEVER AN UPDATE (SD-M5-05), which
// is why `ledger_transaction_id` exists at all and why
// `payment_disputes_loss_is_posted` CHECKs that a lost or refunded dispute names
// the transaction that recorded it while a won one names nothing.
//
// MONEY IS INTEGER CENTS: `amount_cents bigint NOT NULL CHECK (amount_cents > 0)`
// is transcribed `mode: 'bigint'`, which is post.ts's own rule.
export const paymentDisputes = pgTable('payment_disputes', {
  id: uuid('id').primaryKey().defaultRandom(),
  purchaseId: uuid('purchase_id')
    .notNull()
    .references(() => purchases.id),
  // CHECKed to chargeback, refund in the DDL.
  kind: text('kind').notNull(),
  amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
  reasonCode: text('reason_code'),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  // CHECKed to lost, won, refunded, and tied to `resolved_at` in both directions
  // by `payment_disputes_resolved_has_outcome`.
  outcome: text('outcome'),
  ledgerTransactionId: uuid('ledger_transaction_id').references(() => ledgerTransactions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// payout_destinations -- 0051_payout_destinations.sql. OWNED: `identity_id` is
// on the row, NOT NULL, and the first half of the primary key.
// -----------------------------------------------------------------------------
// ADR-169, OI-06. THE DESTINATION NAMESPACE, GIVEN A TABLE FOR THE FIRST TIME.
// Before `0051`, `destination_ref` existed only as a column on
// `payout_transfers` and `wallet_withdrawals`, where it is the destination OF A
// TRANSFER: nothing recorded that a destination changed or when, and C-11,
// C-24, SECURITY section 4 item 1, `WF-M20-02` and M04's destination-cooling
// scenario all cited a control whose input did not exist.
//
// `coolingUntil` IS `.notNull()` AND THAT IS THE CONTROL RATHER THAN A STYLE.
// DELTA_MANIFEST's recommendation named the column and said nothing about
// nullability, and nullability is the whole of it: under a nullable column an
// INSERT that omits the value writes a destination that is usable the instant
// it exists, because the gate reads `cooling_until > now()` and a NULL compares
// to nothing. That is a fail-OPEN on exactly the row an attacker who has just
// added their own destination has caused to be written. A reader tempted to
// relax this here should note that the DDL would then disagree with the
// transcription and `scoped-db.test.ts`'s drift assertion is a NAME-SET check,
// so it would NOT catch it -- which is this file's own header warning about
// what replaces ADR-008's "drift is a compile error", operating on the one
// axis nothing asserts.
//
// THE DURATION IS NOT HERE AND IS NOT MISSING. 48 hours is a launch candidate
// that lives in config (ADR-037), so the database asserts the ORDERING and
// never the length; `payout_destinations_cooling_follows_first_seen` is that
// assertion and it is a CHECK, which this file deliberately does not transcribe
// for the reason its header gives about `ADD CONSTRAINT`.
//
// NO `updatedAt`, and its absence is the DDL's. Nothing in the merged migration
// set maintains one, so every such column is a value a handler is trusted to
// write; `coolingUntil` moving forward under `PAYOUT-DEST-C1` is the record of
// the re-arm, and the trigger is what protects it.
export const payoutDestinations = pgTable(
  'payout_destinations',
  {
    identityId: uuid('identity_id')
      .notNull()
      .references(() => identities.id),
    // The provider-side destination id, NEVER bank details. Byte-exact `text`
    // rather than `citext`: an opaque provider id may legitimately be
    // case-sensitive, and folding case would collide two genuinely different
    // destinations onto one row, handing the second a window it never earned.
    destinationRef: text('destination_ref').notNull(),
    // The DESTINATION's clock. `first_seen_at` is immutable after insert by
    // PAYOUT-DEST-C1, which is a trigger and therefore not expressible here.
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    // THE CONTROL. See the block above before making this optional.
    coolingUntil: timestamp('cooling_until', { withTimezone: true }).notNull(),
    // The ROW's clock, beside the destination's. Equal to `first_seen_at` on
    // every row a live registration writes, and different on exactly the rows a
    // backfill or a reconciliation writes.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.identityId, table.destinationRef] })],
);

// -----------------------------------------------------------------------------
// operators -- 0073_operator_directory.sql. FIRM.
// -----------------------------------------------------------------------------
// MERIT'S RECORD OF WHO MAY ACT ON ITS OWN SURFACE, and the referent
// `admin_actions.actor` did not have until ADR-237. `0017` declares that column
// `text NOT NULL` with no foreign key, so "NO UNEXPLAINED ADMIN ACTION, EVER"
// rested on a `NOT NULL` any string satisfies; `0073` adds
// `admin_actions_actor_is_an_operator` against `actor` below.
//
// NO COLUMN AUTHENTICATES ANYBODY AND THAT IS THE TABLE'S DESIGN. There is no
// password, no secret and no local credential here or anywhere in this schema
// (`0002:280`, ADR-039). `idpIssuer` and `idpSubject` are what a VERIFIED
// assertion is matched against, which is a lookup key rather than a credential:
// possession of a subject claim proves nothing to anything.
//
// `idpSubject` IS NULLABLE AND THE NULL IS NOT A HOLE. The pair is unique only
// where it is present (`operators_idp_identity_idx`, partial), the seam resolves
// by equality, and SQL equality never matches NULL, so a NULL row is unreachable
// rather than claimable. It is the correct state for an operator provisioned
// before the provider has seen them and for an actor that must be nameable in
// the audit trail without ever holding a session.
//
// THE `CHECK` CONSTRAINTS ARE NOT TRANSCRIBED, on this file's own rule about
// `ADD CONSTRAINT`. The role vocabulary is asserted against the DDL and against
// API_CONTRACT by `test/operator-role-vocabulary.test.ts` instead, which reads
// all three and carries no list of its own.
export const operators = pgTable('operators', {
  id: uuid('id').primaryKey().defaultRandom(),
  actor: text('actor').notNull(),
  role: text('role').notNull(),
  status: text('status').notNull().default('active'),
  displayName: text('display_name').notNull(),
  idpIssuer: text('idp_issuer'),
  idpSubject: text('idp_subject'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// operator_sessions -- 0073_operator_directory.sql. FIRM.
// -----------------------------------------------------------------------------
// WHAT A VERIFIED ASSERTION TURNS INTO, AND NOTHING IN THIS REPOSITORY WRITES A
// ROW HERE. The minter needs the C-08 identity provider, which is a purchase
// rather than a slice, so this transcription describes a shape with no producer
// and says so rather than reading as an unused accessor.
//
// `idpAssertionId` IS `.notNull()` AND IT IS THE CONTROL RATHER THAN A LABEL.
// A row has to name the assertion it came from, so a session nobody proved has
// nothing to write there. That column is the whole difference between this
// table and a login.
//
// THE HASH, NEVER THE TOKEN, which is `sessions.refreshTokenHash`'s declaration
// and `impersonationSessions.tokenHash`'s in the same shape.
export const operatorSessions = pgTable('operator_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  operatorId: uuid('operator_id')
    .notNull()
    .references(() => operators.id),
  tokenHash: bytea('token_hash').notNull(),
  idpAssertionId: text('idp_assertion_id').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdIp: inet('created_ip'),
  createdUserAgent: text('created_user_agent'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  lastSeenIp: inet('last_seen_ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
