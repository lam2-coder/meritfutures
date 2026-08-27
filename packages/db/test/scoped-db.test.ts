// =============================================================================
// packages/db/test/scoped-db.test.ts -- CI-02, the `unit` project.
// =============================================================================
// THE VALIDATING HALF OF ADR-084.
//
// WHAT IS NOT HERE, AND WHY. The two refusals ADR-084 turns on are COMPILE
// errors, and vitest cannot see one: it runs transpiled code and a type error is
// gone by then. `scripts/ci/falsify-ci.mjs` states that in its own words about
// the engine's R-17 case. Both are watched failing to compile there, at stage
// CI-01. A suite that "asserted" them would be asserting nothing.
//
// WHAT IS HERE IS THE PART A RUNTIME CAN SEE: that the registry is TOTAL, that
// every rule RESOLVES against the schema, that `traversal` is TRUE rather than
// merely written, and that the TypeScript schema has not DRIFTED from the DDL
// it transcribes.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableColumns, getTableName } from 'drizzle-orm';
import { PgDialect, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { drizzle as proxyDrizzle } from 'drizzle-orm/pg-proxy';
import type { PoolClient } from 'pg';
import { describe, expect, test } from 'vitest';

import {
  SCOPE_RULES,
  TABLES,
  TABLE_KEYS,
  atLeast,
  atMost,
  firmDb,
  isFilterTerm,
  isNull,
  scopePredicate,
  scopedDb,
  systemDb,
  type IdentityId,
  type ScopedTableKey,
  type TableKey,
} from '../src/index.ts';
// `scopedTx`, `systemTx`, `firmTx`, `uniqueKeys` and `StatementSource` are the
// builders rather than the package's public surface, so they come from the
// module the way `keyed-accessor.test.ts` takes them: ADR-112 left
// `packages/db/src/index.ts` deciding what a CALLER may name, and a suite
// asserting what the accessor BUILDS is not a caller.
import { firmTx, scopedTx, systemTx, uniqueKeys, type StatementSource } from '../src/scoped-db.ts';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));
const IDENTITY = 'i-1' as IdentityId;

/**
 * THE TABLE-TO-SQL-NAME MAP, STATED ONCE, TOTAL, AND AT MODULE SCOPE.
 *
 * ADR-092 SECTION 5 IS WHY IT IS ONE STATEMENT AND NOT TWO. This file used to
 * carry the same pairs twice: this map, total by `Record<TableKey, _>`, and a
 * `DDL_NAMES` array beside the drift assertions that was not. Deleting a
 * pair from the array left `tsc --noEmit` at exit 0 and the suite GREEN at 25
 * tests against a baseline of 26 -- a registered, scoped table silently lost
 * its per-table drift assertion and the test count went DOWN. That was the one
 * concurrent-merge hazard on this pair with no loud failure, watched happening
 * rather than predicted, and two hand-maintained statements of one map is the
 * exact drift class `src/schema.ts`'s own header says this package exists to
 * remove.
 *
 * OMITTING A TABLE HERE IS NOW A COMPILE ERROR, and `DDL_NAMES` below is
 * DERIVED from `TABLE_KEYS`, so a registered table cannot be absent from the
 * drift assertions at all.
 *
 * IT IS STILL WRITTEN BY HAND AND THAT IS DELIBERATE. Deriving it from
 * `getTableName(TABLES[key])` would remove the last hand-maintained copy and
 * would make the assertion at `every registered table maps to the SQL name the
 * DDL uses` compare `getTableName` with itself -- the schema asserted against
 * the schema, which is ADR-084 section 7's failure exactly. The independent
 * statement IS the check.
 */
const SQL_NAME: Readonly<Record<TableKey, string>> = {
  identities: 'identities',
  users: 'users',
  sessions: 'sessions',
  planVersions: 'plan_versions',
  planVersionSizes: 'plan_version_sizes',
  purchases: 'purchases',
  accounts: 'accounts',
  ledgerAccounts: 'ledger_accounts',
  ledgerEntries: 'ledger_entries',
  ledgerTransactions: 'ledger_transactions',
  ledgerHalts: 'ledger_halts',
  treasuryBalances: 'treasury_balances',
  liabilitySnapshots: 'liability_snapshots',
  dailyMarks: 'daily_marks',
  ruleStates: 'rule_states',
  contentDocuments: 'content_documents',
  pageRevalidations: 'page_revalidations',
  certificates: 'certificates',
  statisticDefinitions: 'statistic_definitions',
  publishedStatistics: 'published_statistics',
  proofLinks: 'proof_links',
  reviewRequests: 'review_requests',
  identitySignals: 'identity_signals',
  detectorDefinitions: 'detector_definitions',
  detectorRuns: 'detector_runs',
  riskFlags: 'risk_flags',
  correlationGroups: 'correlation_groups',
  coupons: 'coupons',
  couponRedemptions: 'coupon_redemptions',
  pspWebhookEvents: 'psp_webhook_events',
  midHealth: 'mid_health',
  contactChannels: 'contact_channels',
  notificationKinds: 'notification_kinds',
  notifications: 'notifications',
  notificationPreferences: 'notification_preferences',
  otpSendBudget: 'otp_send_budget',
  identityPhones: 'identity_phones',
  kycFunnelEvents: 'kyc_funnel_events',
  kycVerifications: 'kyc_verifications',
  phoneChangeRequests: 'phone_change_requests',
  sanctionsScreenings: 'sanctions_screenings',
  accountAdjustments: 'account_adjustments',
  adminActions: 'admin_actions',
  alarmSuppressions: 'alarm_suppressions',
  dualControlApprovals: 'dual_control_approvals',
  economicCalendar: 'economic_calendar',
  economicCalendarLoads: 'economic_calendar_loads',
  evidencePacks: 'evidence_packs',
  identityRestrictionEpisodes: 'identity_restriction_episodes',
  impersonationPageViews: 'impersonation_page_views',
  impersonationSessions: 'impersonation_sessions',
  planBreakerState: 'plan_breaker_state',
  reportDeliveries: 'report_deliveries',
  reportSchedules: 'report_schedules',
  affiliates: 'affiliates',
  affiliateCreatives: 'affiliate_creatives',
  affiliateClicks: 'affiliate_clicks',
  payoutRequests: 'payout_requests',
  payoutTransfers: 'payout_transfers',
  walletEntries: 'wallet_entries',
  walletWithdrawals: 'wallet_withdrawals',
  walletSpendLimits: 'wallet_spend_limits',
  walletDormancy: 'wallet_dormancy',
  plans: 'plans',
  passkeys: 'passkeys',
  integrationContracts: 'integration_contracts',
  integrationDispatches: 'integration_dispatches',
  supportContextViews: 'support_context_views',
  simulationRuns: 'simulation_runs',
  contractSpecs: 'contract_specs',
  fills: 'fills',
  roundTrips: 'round_trips',
  journalEntries: 'journal_entries',
  analyticsSnapshots: 'analytics_snapshots',
  graduationBenefits: 'graduation_benefits',
  graduationInvitations: 'graduation_invitations',
  planSizeUnlocks: 'plan_size_unlocks',
  offerExperiments: 'offer_experiments',
  priceFloors: 'price_floors',
  offers: 'offers',
  promotionalCreditGrants: 'promotional_credit_grants',
  accountStatusHistory: 'account_status_history',
  platformAccountRefs: 'platform_account_refs',
  provisioningQueue: 'provisioning_queue',
  platformEntitlements: 'platform_entitlements',
  ingestFiles: 'ingest_files',
  rawIngestRows: 'raw_ingest_rows',
  reconciliations: 'reconciliations',
  loyaltyCriteria: 'loyalty_criteria',
  loyaltyStates: 'loyalty_states',
  loyaltyBenefitGrants: 'loyalty_benefit_grants',
  discordLinks: 'discord_links',
  discordAnnouncements: 'discord_announcements',
  geoRestrictions: 'geo_restrictions',
  tosVersions: 'tos_versions',
  tosAcceptances: 'tos_acceptances',
  certificateVerifications: 'certificate_verifications',
  idempotencyKeys: 'idempotency_keys',
  tradingCalendarLoads: 'trading_calendar_loads',
  tradingCalendarRevisions: 'trading_calendar_revisions',
  identityLinks: 'identity_links',
  dedupeMatches: 'dedupe_matches',
  attributions: 'attributions',
  otpChallenges: 'otp_challenges',
  paymentDisputes: 'payment_disputes',
  payoutDestinations: 'payout_destinations',
};

/**
 * Every registered table, paired with its SQL name. DERIVED from `TABLE_KEYS`
 * and never listed: the drift assertions below iterate this, so the set they
 * cover is the set the registry declares, by construction rather than by
 * anyone remembering.
 */
const DDL_NAMES: ReadonlyArray<readonly [TableKey, string]> = TABLE_KEYS.map(
  (key) => [key, SQL_NAME[key]] as const,
);

const columnsOf = (key: TableKey): Record<string, PgColumn> =>
  getTableColumns(TABLES[key] as PgTable) as unknown as Record<string, PgColumn>;

const sqlNames = (key: TableKey): string[] =>
  Object.values(columnsOf(key))
    .map((c) => c.name)
    .sort();

const migrationFiles = (): string[] =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();

const allMigrationSql = (): string =>
  migrationFiles()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');

/**
 * The column names inside one `CREATE TABLE` body, read out of the SQL.
 *
 * READING THE SQL TO ASSERT AGAINST IT IS NOT GENERATING A SCHEMA FROM IT.
 * Nothing here is emitted and nothing is written back; the migrations stay the
 * source and `schema.ts` stays the transcription.
 */
function ddlColumns(rawSql: string, table: string): string[] {
  // COMMENTS COME OUT FIRST, BEFORE ANY SPLITTING. Stripping them per fragment
  // after splitting on commas is wrong, and wrong in a way that reads as a
  // schema drift: `-- reserved, never in v1 math` contains a comma, so the split
  // lands mid-comment and "never" is reported as a column of ledger_entries.
  const sqlText = rawSql.replace(/--[^\n]*/g, '');
  const open = new RegExp(`CREATE TABLE ${table} \\(`, 'i');
  const at = sqlText.search(open);
  if (at < 0) throw new Error(`no CREATE TABLE for ${table}`);
  const body = sqlText.slice(sqlText.indexOf('(', at) + 1);

  // Walk to the matching close paren so nested CHECK(...) does not end the body.
  let depth = 0;
  let end = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) {
        end = i;
        break;
      }
      depth--;
    }
  }
  const inner = body.slice(0, end);

  const names: string[] = [];
  let paren = 0;
  let current = '';
  for (const ch of inner) {
    if (ch === '(') paren++;
    if (ch === ')') paren--;
    if (ch === ',' && paren === 0) {
      names.push(current);
      current = '';
    } else current += ch;
  }
  names.push(current);

  return (
    names
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      // Table-level clauses are not columns.
      .filter((line) => !/^(CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY|EXCLUDE)\b/i.test(line))
      .map((line) => line.split(/\s+/)[0] ?? '')
      .filter((n) => n.length > 0)
      .sort()
  );
}

/**
 * Whole column DEFINITIONS from a `CREATE TABLE` body, keyed by column name.
 *
 * The definitions carry the inline `REFERENCES`, which is what lets a scope rule
 * be checked against the DATABASE rather than against itself.
 */
function ddlColumnDefs(rawSql: string, table: string): Map<string, string> {
  const sqlText = rawSql.replace(/--[^\n]*/g, '');
  const at = sqlText.search(new RegExp(`CREATE TABLE ${table} \\(`, 'i'));
  if (at < 0) throw new Error(`no CREATE TABLE for ${table}`);
  const body = sqlText.slice(sqlText.indexOf('(', at) + 1);
  let depth = 0;
  let end = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) {
        end = i;
        break;
      }
      depth--;
    }
  }
  const parts: string[] = [];
  let paren = 0;
  let current = '';
  for (const ch of body.slice(0, end)) {
    if (ch === '(') paren++;
    if (ch === ')') paren--;
    if (ch === ',' && paren === 0) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  parts.push(current);

  const defs = new Map<string, string>();
  for (const raw of parts) {
    const line = raw.trim().replace(/\s+/g, ' ');
    if (line.length === 0) continue;
    if (/^(CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY|EXCLUDE)\b/i.test(line)) continue;
    const name = line.split(' ')[0];
    if (name !== undefined && name.length > 0) defs.set(name, line);
  }
  return defs;
}

describe('the registry is total', () => {
  // THE APPROVAL CLAUSE'S FIGURE, COMPUTED. Reported as N of 111 rather than
  // rounded up: the other 7 are unreachable through every accessor.
  //
  // `identity_links`, `dedupe_matches` AND `attributions` WERE THREE OF THE
  // TWELVE AND ARE NOW REGISTERED `pair` (ADR-106). Their absence had been a
  // record rather than a gap since session 192: each carries TWO columns
  // declared `REFERENCES identities(id)` against an `owned` rule that names one,
  // and every choice of one returns a strict subset of a person's own rows,
  // selected by UUID ordering on the two canonical-order tables. THE CLASS DOES
  // NOT MAKE THEM SCOPED-READABLE AND THAT IS THE RULING: `PairTableKey` is
  // excluded from `ScopedTableKey`, because a scoped read is a filter rather
  // than a projection and every row it would return carries the OTHER party's
  // identity uuid out of a NOT NULL column. It is excluded from `FirmTableKey`
  // too -- `firmDb()` takes no reason on the ground that no identity is at risk,
  // and here two are -- so `systemDb(reason)` is the only door and somebody has
  // to write down why.
  //
  // `ledger_halts` WAS A FOURTH AND IT IS NO LONGER ONE. ADR-092 section 9 named
  // four tables "no session would reach" and this is the first of them to be
  // registered: `identity_id uuid NOT NULL REFERENCES identities(id)` at
  // 0016:55, so its class was never in doubt and what it lacked was a session
  // whose fence contained it. ADR-104 is that session.
  //
  // `affiliate_commissions` FOLLOWS `attributions` AND IT DOES NOT FOLLOW IT IN.
  // Its only path to an identity is `attribution_id`, and now that
  // `attributions` is a `TableKey` a `derived` rule through it COMPILES where
  // before it could not be written at all -- and then throws the first time
  // anybody reads the table, because a derivation chain terminates at `owned` or
  // at `root` and `pair` is no more a terminal than `firm` is. The assertion at
  // `every derivation chain ends at an identity` refuses it by name.
  //
  // `identity_merges` IS THE FOURTH TABLE OF THIS SHAPE IN THE TREE AND IS
  // DELIBERATELY NOT REGISTERED HERE. `surviving_identity_id` and
  // `merged_identity_id` are both `uuid NOT NULL REFERENCES identities(id)` with
  // `identity_merges_distinct` CHECKing them apart, so it is a `pair` table by
  // the same derivation and could be registered today. ADR-092's rule is that
  // the first session that NEEDS a table registers it; M18 names this one and
  // session 215 does not need it.
  //
  // `events` IS STILL ABSENT AND IT IS THE NEAR MISS. It reaches an identity TWO
  // ways -- `identity_id uuid NULL` and `account_id uuid NULL`, neither required
  // and no CHECK tying them -- which is ONE identity column beside one ACCOUNT
  // column and therefore not a pair at all. An `owned` rule on the first drops
  // every account-level row and a `derived` hop through the second drops every
  // identity-level row, while the portal's timeline (EVENTS.md section 2,
  // consumer TL) reads both. Its `jsonb` payload is the second reason and it is
  // the one no scope rule reaches: `kyc.dedupe_hit` carries
  // `matched_identity_id`, so a row whose own tenancy column is right still
  // names a DIFFERENT identity inside the payload.
  //
  // P5-b WAS DISPATCHED TO REGISTER IT BY NAME AND STOPPED AT THE SAME PLACE, so
  // the refusal is no longer "no session's fence held it". All five members of
  // the vocabulary were tried against the shape: `owned` on `identity_id`
  // compiles and drops every account-level row, `derived` through `account_id`
  // is refused by ADR-101 clauses 1 AND 2, `pair` needs a second IDENTITY column
  // and this row's second is an ACCOUNT, `firm` is refused because the row
  // declares a column against `identities(id)`, and `root` is `identities`'
  // alone. What it needs is a SIXTH CLASS, which ADR-106 is the precedent for
  // the cost of, and that slice was allocated no ADR number.
  test('106 declared tables, 106 scope rules, 0 reachable without one', () => {
    const declared = TABLE_KEYS.length;
    const rules = Object.keys(SCOPE_RULES).length;
    const withoutRule = TABLE_KEYS.filter((k) => !(k in SCOPE_RULES));

    expect(declared).toBe(106);
    expect(rules).toBe(106);
    expect(withoutRule).toEqual([]);

    // 112 since ADR-128: 0049 creates `reserve_coverage_snapshots`, and it is
    // NOT registered here. ADR-092's rule, quoted above, is that the first
    // session that NEEDS a table registers it, and no producer exists yet (M06
    // is unbuilt). It is also FIRM by construction for `liability_snapshots`'
    // reason on a different surface: a per-identity slice of the firm's reserve
    // coverage is not a smaller version of it.
    //
    // 113 SINCE ADR-164: `0050` creates `live_account_state`, ADR-020 tier 2's
    // live cache, and it is NOT registered here either, on the SAME rule and
    // not on a second one. `P6-c` writes the store, the role and the grant and
    // NO READER: the ingest is `P6-f`'s and the two live surfaces are `P6-g`'s
    // and `P6-j`'s, so the first session that needs it is not this one.
    //
    // ITS EVENTUAL RULE IS `derived` VIA `accounts` AND THAT IS NOT A GUESS.
    // `account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE RESTRICT`
    // is single-valued and NOT NULL, and API_CONTRACT section 6.1 already says
    // every live frame is scoped "through `scopedDb(identity)` exactly as the
    // account reads are". What that session ALSO has to know is that the scope
    // rule and the grant answer different questions: `0050` revokes all four
    // verbs from `merit_app`, so a correctly scoped read still fails unless the
    // process connects as `merit_live`.
    //
    // 114 SINCE ADR-169, AND THIS ONE IS REGISTERED, WHICH IS WHY THE TWO
    // COUNTS ABOVE MOVED WITH IT. `0051` creates `payout_destinations`,
    // OI-06's registry, and P5-e both wrote the DDL and registered it -- so
    // ADR-092's "the first session that needs it" and "the session that
    // created it" are the same session here, which they are not for the two
    // tables above.
    const createdTables = (allMigrationSql().match(/^CREATE TABLE /gim) ?? []).length;
    expect(createdTables).toBe(114);
  });

  // FIVE MEMBERS SINCE ADR-106, AND THE ASSERTION IS THE REASON THE FIFTH COULD
  // NOT BE ADDED QUIETLY. It compares the classes IN USE against the whole
  // vocabulary, so a member declared in `ScopeClass` and used by no table fails
  // here rather than sitting in the type as an option nobody has justified.
  test('every class in the vocabulary has at least one member, so none is vacuous', () => {
    const classes = new Set(TABLE_KEYS.map((k) => SCOPE_RULES[k].class));
    expect([...classes].sort()).toEqual(['derived', 'firm', 'owned', 'pair', 'root']);
  });

  test('every rule carries a reason and none is a placeholder', () => {
    for (const key of TABLE_KEYS) {
      const why = SCOPE_RULES[key].why;
      expect(why.length, key).toBeGreaterThan(40);
      expect(why.toLowerCase(), key).not.toMatch(/^(todo|tbd|placeholder)/);
    }
  });
});

describe('every rule resolves against the schema', () => {
  // If this fails, `columnByName`'s throw is REACHABLE, which means the registry
  // and the schema have drifted from each other.
  test('every column a rule names exists on the table it names it for', () => {
    for (const key of TABLE_KEYS) {
      const rule = SCOPE_RULES[key];
      const here = sqlNames(key);
      if (rule.class === 'root' || rule.class === 'owned') {
        expect(here, `${key}.${rule.column}`).toContain(rule.column);
      } else if (rule.class === 'pair') {
        expect(here, `${key}.${rule.columnA}`).toContain(rule.columnA);
        expect(here, `${key}.${rule.columnB}`).toContain(rule.columnB);
      } else if (rule.class === 'derived') {
        expect(here, `${key}.${rule.localColumn}`).toContain(rule.localColumn);
        expect(sqlNames(rule.via), `${rule.via}.${rule.foreignColumn}`).toContain(
          rule.foreignColumn,
        );
      }
    }
  });

  // `traversal` IS CHECKED RATHER THAN TRUSTED. A field the code reads the same
  // way whatever it says is prose, and ADR-042 already ruled prose is not a
  // control. A `hop` is safe to join because it points at the via table's
  // PRIMARY KEY; a `semi-join` is not, and that is why it must be an EXISTS.
  test('every hop names the via table primary key, and every semi-join does not', () => {
    for (const key of TABLE_KEYS) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'derived') continue;
      const viaCols = columnsOf(rule.via);
      const target = Object.values(viaCols).find((c) => c.name === rule.foreignColumn);
      expect(target, `${rule.via}.${rule.foreignColumn}`).toBeDefined();
      const isPrimary = target?.primary === true;
      if (rule.traversal === 'hop') {
        expect(
          isPrimary,
          `${key} is a hop, so ${rule.via}.${rule.foreignColumn} must be a PK`,
        ).toBe(true);
      } else {
        expect(
          isPrimary,
          `${key} is a semi-join, so ${rule.via}.${rule.foreignColumn} must NOT be a PK`,
        ).toBe(false);
      }
    }
  });

  // A DERIVATION CHAIN TERMINATES AT `owned` OR AT `root`, AND A `firm` PARENT
  // IS WHERE IT DOES NOT. SINCE ADR-106 A `pair` PARENT IS A SECOND PLACE, and
  // it is the one with a caller waiting: `affiliate_commissions.attribution_id`
  // is a NOT NULL foreign key to `attributions`, which is now a `TableKey`, so
  // `DerivedRule.via` can name it and the rule compiles at every call site.
  //
  // `scopePredicate` recurses into `rule.via` and the `firm` branch of that
  // switch THROWS, so a derived rule whose chain reaches a firm table is a
  // table that is a member of `ScopedTableKey`, compiles at every call site,
  // and raises the first time anybody reads it. The type checker cannot refuse
  // it: `DerivedRule.via` is `TableKey`, which includes every firm key by
  // construction, and narrowing it would make a rule unable to name a table
  // before that table's own class is known.
  //
  // THIS WAS UNASSERTED UNTIL `plan_version_sizes` MADE IT A PLAUSIBLE MISTAKE
  // RATHER THAN A PERVERSE ONE. Every derived rule before it hops to an owned
  // table, so the shape never came up; `plan_version_sizes.plan_version_id` is
  // a NOT NULL foreign key to `plan_versions`, which reads exactly like the
  // `hop` that `daily_marks` and `rule_states` make to `accounts` and is not
  // one, because `plan_versions` is firm. Declaring it `derived` leaves this
  // whole file GREEN, watched happening rather than predicted, which is why the
  // reason is a check here and not only a sentence in `scope.ts`.
  //
  // The walk is BOUNDED. A cycle among derived rules would otherwise recurse
  // until the stack ran out, in the suite and in `scopePredicate` alike.
  test('every derivation chain ends at an identity, so none of them ends at a firm table', () => {
    for (const key of TABLE_KEYS) {
      if (SCOPE_RULES[key].class !== 'derived') continue;
      const seen: TableKey[] = [key];
      let at: TableKey = key;
      for (let step = 0; step <= TABLE_KEYS.length; step++) {
        const rule = SCOPE_RULES[at];
        if (rule.class === 'owned' || rule.class === 'root') break;
        expect(
          rule.class,
          `${key} derives through ${seen.join(' -> ')}, and ${at} is ${rule.class}, so a ` +
            'scoped read of it constructs no predicate and throws. A chain terminates at ' +
            '`owned` or at `root`: `firm` has no identity to terminate at and `pair` has two, ' +
            'and ADR-106 refuses the second for the same reason ADR-084 refuses the first.',
        ).toBe('derived');
        if (rule.class !== 'derived') break;
        at = rule.via;
        expect(seen, `${key}'s chain revisits ${at}: ${[...seen, at].join(' -> ')}`).not.toContain(
          at,
        );
        seen.push(at);
      }
      expect(
        ['owned', 'root'],
        `${key}'s chain did not terminate within ${TABLE_KEYS.length} hops: ${seen.join(' -> ')}`,
      ).toContain(SCOPE_RULES[at].class);
    }
  });
});

describe('a scope rule is checked against the DDL, not against itself', () => {
  // THE TEST THAT WOULD HAVE CAUGHT THE SEED THAT SURVIVED. Session 145 seeded
  // `accounts` scoped by `user_id` instead of `identity_id` and ALL TWENTY-TWO
  // assertions passed, because the render test took its expected column FROM THE
  // RULE and so was asserting the code against itself.
  //
  // A USER IS A LOGIN AND AN IDENTITY IS THE PERSON, and ADR-041 is why they are
  // two columns. Scoping accounts by `user_id` returns a DIFFERENT SET OF ROWS,
  // silently, for every trader whose identity has more than one login -- which is
  // the exact failure ADR-008 scoped the wrapper to bound.
  //
  // The expectation therefore comes from the MIGRATIONS: an `owned` column must
  // be declared `REFERENCES identities(id)` in the DDL. `user_id` references
  // `users(id)` and `treasury_balances.recorded_by` references `users(id)`, so
  // both are refused by the database's own declaration rather than by a list
  // somebody remembered to update.
  const sqlText = allMigrationSql();

  test('every owned rule names a column the DDL declares REFERENCES identities(id)', () => {
    for (const key of TABLE_KEYS) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'owned') continue;
      const defs = ddlColumnDefs(sqlText, SQL_NAME[key]);
      const def = defs.get(rule.column);
      expect(def, `${SQL_NAME[key]}.${rule.column} is not a column`).toBeDefined();
      expect(
        def ?? '',
        `${SQL_NAME[key]}.${rule.column} must reference identities(id), and its DDL is: ${def ?? ''}`,
      ).toMatch(/REFERENCES\s+identities\s*\(\s*id\s*\)/i);
    }
  });

  test('the root rule is the identities table itself', () => {
    for (const key of TABLE_KEYS) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'root') continue;
      expect(SQL_NAME[key]).toBe('identities');
      expect(rule.column).toBe('id');
    }
  });

  test('every derived rule names a foreign key the DDL actually declares', () => {
    for (const key of TABLE_KEYS) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'derived') continue;
      const here = ddlColumnDefs(sqlText, SQL_NAME[key]).get(rule.localColumn);
      const there = ddlColumnDefs(sqlText, SQL_NAME[rule.via]).get(rule.foreignColumn);
      expect(here, `${SQL_NAME[key]}.${rule.localColumn}`).toBeDefined();
      expect(there, `${SQL_NAME[rule.via]}.${rule.foreignColumn}`).toBeDefined();

      // The edge is declared in ONE of the two directions and either is valid:
      // ledger_entries.ledger_account_id -> ledger_accounts(id) points forward,
      // and ledger_entries.transaction_id -> ledger_transactions(id) is the
      // reverse edge ledger_transactions traverses.
      const forward = new RegExp(`REFERENCES\\s+${SQL_NAME[rule.via]}\\s*\\(`, 'i').test(
        here ?? '',
      );
      const reverse = new RegExp(`REFERENCES\\s+${SQL_NAME[key]}\\s*\\(`, 'i').test(there ?? '');
      expect(
        forward || reverse,
        `no declared FK between ${SQL_NAME[key]}.${rule.localColumn} and ${SQL_NAME[rule.via]}.${rule.foreignColumn}`,
      ).toBe(true);
    }
  });

  test('no firm table carries a column referencing identities, so the class is not hiding one', () => {
    for (const key of TABLE_KEYS) {
      if (SCOPE_RULES[key].class !== 'firm') continue;
      const defs = [...ddlColumnDefs(sqlText, SQL_NAME[key]).values()];
      const reaching = defs.filter((d) => /REFERENCES\s+identities\s*\(/i.test(d));
      expect(reaching, `${SQL_NAME[key]} reaches identities directly`).toEqual([]);
    }
  });
});

describe('the predicates discriminate', () => {
  // RENDERED TO SQL AND READ, not merely constructed. A predicate that built
  // without throwing would satisfy a `toBeDefined()` while comparing the wrong
  // column, or no column, which is the failure this whole entry exists to bound.
  const dialect = new PgDialect();
  const render = (key: TableKey): { sql: string; params: unknown[] } =>
    dialect.sqlToQuery(scopePredicate(key, IDENTITY)) as { sql: string; params: unknown[] };

  test('root and owned compare the identity column, and bind the identity', () => {
    for (const key of TABLE_KEYS) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'root' && rule.class !== 'owned') continue;
      const { sql: text, params } = render(key);
      expect(text, key).toContain(`"${rule.column}"`);
      expect(text, key).toMatch(/=\s*\$1/);
      expect(params, key).toEqual(['i-1']);
      // A scoped read must never be a bare table scan.
      expect(text, key).not.toMatch(/^\s*(true|1\s*=\s*1)\s*$/i);
    }
  });

  test('ledger_entries reaches the identity through ledger_accounts, in one hop', () => {
    const { sql: text, params } = render('ledgerEntries');
    expect(text).toMatch(/exists/i);
    expect(text).toContain('"ledger_accounts"');
    expect(text).toContain('"identity_id"');
    expect(params).toEqual(['i-1']);
  });

  test('ledger_transactions uses EXISTS, because a join would multiply rows', () => {
    const { sql: text, params } = render('ledgerTransactions');
    expect(text).toMatch(/exists/i);
    // THE CHAIN IS TWO DEEP: transactions -> entries -> accounts, and the
    // identity is compared only at the end of it.
    expect(text).toContain('"ledger_entries"');
    expect(text).toContain('"ledger_accounts"');
    expect(text).toContain('"identity_id"');
    // AND IT IS NOT A JOIN. A join here returns the transaction once per
    // matching entry, and a transaction has a trader leg AND a firm leg.
    expect(text).not.toMatch(/\bjoin\b/i);
    expect(params).toEqual(['i-1']);
  });

  test('a firm table has no scoped reading, and says so rather than returning nothing', () => {
    expect(() => scopePredicate('treasuryBalances', IDENTITY)).toThrow(/belongs to no identity/);
    expect(() => scopePredicate('liabilitySnapshots', IDENTITY)).toThrow(/systemDb/);
    // EVERY firm table, not the two somebody remembered. `plan_versions` is the
    // third and the public rules pages read it, so the refusal is the thing
    // that says "unscoped ON PURPOSE" out loud rather than by omission.
    expect(() => scopePredicate('planVersions', IDENTITY)).toThrow(/belongs to no identity/);
  });
});

describe('the accessors', () => {
  test('the scoped accessor carries the identity it is scoped by', () => {
    expect(scopedDb(IDENTITY).identityId).toBe('i-1');
  });

  test('the unscoped reader carries a reason from a closed vocabulary', () => {
    expect(systemDb('nightly-batch').reason).toBe('nightly-batch');
    expect(systemDb('operator-console').reason).toBe('operator-console');
  });

  test('the two accessors carry disjoint brands, which is what makes them unmixable', () => {
    expect(scopedDb(IDENTITY).__brand).toBe('ScopedDb');
    expect(systemDb('nightly-batch').__brand).toBe('SystemDb');
    expect(scopedDb(IDENTITY).__brand).not.toBe(systemDb('nightly-batch').__brand);
  });
});

/**
 * ADR-094'S FOLD, WITH ADR-103'S SECOND MEMBER. The result of replaying one
 * table's migration history.
 *
 * `columns`  the column-name set AS OF THE LAST MIGRATION.
 * `added`    the names the replay applied, in migration order. Empty for an
 *            undrifted table, and NON-EMPTY SOMEWHERE is asserted below --
 *            a fold that quietly did nothing would leave every per-table
 *            comparison green for any table whose transcription was ALSO
 *            missing the later columns, which is ADR-084 section 7's failure.
 * `relaxed`  the names an `ALTER COLUMN ... DROP NOT NULL` made nullable.
 *            ADR-103. It changes no NAME, so this fold only RECORDS it and
 *            `foldTableDefs` is where the nullability actually moves.
 * `refused`  statements outside the fold's two-member vocabulary. Any of these
 *            turns the suite red, exactly as the other shapes do today.
 */
interface ColumnFold {
  readonly columns: readonly string[];
  readonly added: readonly string[];
  readonly relaxed: readonly string[];
  readonly refused: readonly string[];
}

/**
 * ADR-103. THE `ALTER COLUMN` SUB-VOCABULARY, CLOSED AT ONE SHAPE, DEFAULT FAIL.
 *
 * Returns the columns one statement makes nullable, or `null` when the statement
 * is outside the shape this fold reads -- in which case its caller REFUSES it,
 * exactly as ADR-094 refuses `DROP COLUMN` and `RENAME`.
 *
 * EVERY TOP-LEVEL CLAUSE MUST MATCH, so a statement mixing `ADD COLUMN` or
 * `SET DATA TYPE` into an `ALTER COLUMN` is refused whole rather than
 * part-folded. `SET NOT NULL`, `SET DATA TYPE`, `SET DEFAULT` and `DROP DEFAULT`
 * have ZERO instances in this migration set, so a rule for them would be written
 * against nothing, which is the defect ADR-094 item 3 forecloses by name.
 *
 * READ BY BOTH FOLDS, WHICH IS THE POINT. Two readers of one statement that
 * could disagree is ADR-092 section 5's measured hazard; `foldTable` records
 * what this returns and `foldTableDefs` applies it, off one function.
 */
function droppedNotNulls(statement: string): readonly string[] | null {
  const body = statement
    .replace(/^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?[a-z_]+"?/i, '')
    .replace(/;\s*$/, '');
  const names: string[] = [];
  for (const clause of topLevelParts(body)) {
    const named = /^ALTER\s+COLUMN\s+"?([a-z_][a-z0-9_]*)"?\s+DROP\s+NOT\s+NULL$/i.exec(
      clause.replace(/\s+/g, ' ').trim(),
    );
    if (named?.[1] === undefined) return null;
    names.push(named[1]);
  }
  return names.length > 0 ? names : null;
}

/**
 * One folded definition with its top-level `NOT NULL` removed. ADR-103.
 *
 * TWO WAYS OF APPLYING NOTHING ARE REFUSED RATHER THAN ABSORBED, because a
 * relaxation that quietly did not happen leaves the comparison asserting the
 * PRE-`ALTER` nullability, which is the stale-`CREATE` reading ADR-094 exists to
 * end, arriving one statement later.
 *
 * `PRIMARY KEY` IS THE FIRST. PostgreSQL refuses `DROP NOT NULL` on a primary
 * key column, so a fold that applied it would be replaying a history that
 * cannot have run. `declaredNotNull` reads the key as well as the words, so
 * absorbing it would also have produced a column still NOT NULL after a
 * statement whose whole purpose was to relax it.
 *
 * A DEFINITION THAT DOES NOT SAY `NOT NULL` IS THE SECOND, and `CHECK (x IS NOT
 * NULL)` is why the scan is at top level: a textual `NOT NULL` inside a
 * constraint is not the column's nullability and removing it would be a
 * mis-parse that reads as a successful fold.
 */
function withoutNotNull(def: string, where: string): string {
  if (/\bPRIMARY\s+KEY\b/i.test(def)) {
    throw new Error(
      `ALTER COLUMN ${where} DROP NOT NULL, against a definition that declares PRIMARY KEY. ` +
        `PostgreSQL refuses that statement, so the fold is replaying a history that cannot ` +
        `have happened. Its DDL is: ${def}`,
    );
  }
  let depth = 0;
  let out = '';
  let removed = 0;
  for (let i = 0; i < def.length; i++) {
    const ch = def[i] as string;
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && (i === 0 || /\s/.test(def[i - 1] as string))) {
      const hit = /^NOT\s+NULL\b/i.exec(def.slice(i));
      if (hit !== null) {
        removed++;
        i += hit[0].length - 1;
        continue;
      }
    }
    out += ch;
  }
  if (removed !== 1) {
    throw new Error(
      `ALTER COLUMN ${where} DROP NOT NULL, and the definition it applies to declares NOT NULL ` +
        `${removed} time(s) at the top level. A fold that applies nothing agrees with a ` +
        `transcription it never checked. Its DDL is: ${def}`,
    );
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Split on commas that are NOT inside parentheses. */
function topLevelParts(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * Every `ALTER TABLE <table> ...;` statement in one migration file.
 *
 * COMMENTS COME OUT FIRST, for `ddlColumns`' reason: `0043` writes
 * `-- SD-M6-11` INSIDE a statement, and a comment containing a comma splits
 * where no clause boundary is.
 *
 * THE NON-GREEDY MATCH TO THE FIRST `;` IS CHECKED RATHER THAN TRUSTED. A
 * semicolon inside parentheses would truncate the statement and the fold would
 * then read a partial clause list as a complete one, so an unbalanced statement
 * THROWS instead of being folded.
 */
function alterStatementsFor(fileSql: string, table: string): string[] {
  const sqlText = fileSql.replace(/--[^\n]*/g, '');
  const found: string[] = [];
  for (const statement of sqlText.match(
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?[a-z_]+"?[\s\S]*?;/gi,
  ) ?? []) {
    const named = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([a-z_]+)"?/i.exec(statement)?.[1];
    if (named !== table) continue;
    let depth = 0;
    for (const ch of statement) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    if (depth !== 0) {
      throw new Error(
        `ALTER TABLE ${table} statement has unbalanced parentheses, so the match to the ` +
          `first ";" truncated it and the fold cannot read it: ${statement.slice(0, 120)}`,
      );
    }
    found.push(statement);
  }
  return found;
}

/**
 * ONE TABLE, REPLAYED. ADR-094, WIDENED ONCE BY ADR-103.
 *
 * A transcription reads a table AS OF THE LAST MIGRATION and never as of its
 * `CREATE TABLE`. This walks the migration set in order, starts from the
 * `CREATE TABLE` column set, and folds every later `ADD COLUMN` onto it.
 *
 * THE VOCABULARY IS CLOSED AT TWO MEMBERS AND THE DEFAULT IS STILL FAIL. `DROP
 * COLUMN` and `RENAME` are REFUSED and never skipped, so the refusal
 * `schema.ts`'s header describes is narrowed rather than deleted: a table whose
 * history contains one of them still cannot be registered. Both have ZERO
 * instances in this migration set and ADR-094 item 3 forecloses ruling on them
 * until one arrives.
 *
 * `ALTER COLUMN ... DROP NOT NULL` IS THE SECOND MEMBER AND IT ARRIVED WITH A
 * COMPARISON RATHER THAN INSTEAD OF ONE. ADR-094 section 3 refused it as a
 * STATED PROXY: it cannot change a column-name set, so the fold would have
 * nothing to do, and the axis it does move -- nullability -- was one this suite
 * had never compared. ADR-103 wrote that comparison first and widens the
 * vocabulary second, in that order, so the refusal is replaced by the thing it
 * stood for rather than deleted. Every other `ALTER COLUMN` shape stays refused.
 */
function foldTable(table: string): ColumnFold {
  const files = migrationFiles();
  const read = (file: string): string => readFileSync(join(MIGRATIONS, file), 'utf8');
  const createdIn = files.findIndex((file) =>
    new RegExp(`CREATE TABLE ${table} \\(`, 'i').test(read(file)),
  );
  if (createdIn < 0) throw new Error(`no CREATE TABLE for ${table}`);

  // MIGRATION ORDER IS CHECKED RATHER THAN BELIEVED. Lexical filename order
  // equals numeric order only while the four-digit prefix holds, and a
  // statement folded onto a table that does not exist yet is a fold reading
  // its history backwards.
  for (const earlier of files.slice(0, createdIn)) {
    if (alterStatementsFor(read(earlier), table).length > 0) {
      throw new Error(
        `${earlier} alters ${table}, which ${files[createdIn] ?? '?'} creates. The fold ` +
          'applies files in name order and that order is wrong here.',
      );
    }
  }

  const columns = new Set(ddlColumns(read(files[createdIn] ?? ''), table));
  const added: string[] = [];
  const relaxed: string[] = [];
  const refused: string[] = [];

  for (const file of files.slice(createdIn)) {
    for (const statement of alterStatementsFor(read(file), table)) {
      // A statement that touches no column at all -- ADD CONSTRAINT is the only
      // shape in this tree -- changes nothing the transcription states.
      if (!/\b(ADD|DROP|ALTER)\s+COLUMN\b|\bRENAME\b/i.test(statement)) continue;

      // ADR-103'S MEMBER, AND ITS SUB-VOCABULARY HAS THE SAME DEFAULT OF FAIL.
      // A statement that is not entirely `ALTER COLUMN <name> DROP NOT NULL` is
      // refused whole, which covers `SET DATA TYPE`, `SET NOT NULL`, either
      // `DEFAULT` shape, and any statement mixing an `ADD COLUMN` in.
      if (/\bALTER\s+COLUMN\b/i.test(statement)) {
        const dropped = droppedNotNulls(statement);
        if (dropped === null) {
          refused.push(`${file}: ${statement.slice(0, 90).replace(/\s+/g, ' ')}`);
          continue;
        }
        for (const name of dropped) {
          // A MIS-PARSE IS LOUD RATHER THAN ABSORBED, on ADD COLUMN's own rule:
          // relaxing a column the fold has never seen means the clause reader
          // and the column set disagree, and it would otherwise change nothing.
          if (!columns.has(name)) {
            throw new Error(
              `${file}: ALTER COLUMN ${table}.${name} DROP NOT NULL, and ${name} is not in ` +
                `the folded column set of ${table}`,
            );
          }
          relaxed.push(name);
        }
        continue;
      }

      // THE DEFAULT IS FAIL. `DROP COLUMN` and `RENAME` are refused, including a
      // statement that mixes one in.
      if (/\bDROP\s+COLUMN\b|\bRENAME\b/i.test(statement)) {
        refused.push(`${file}: ${statement.slice(0, 90).replace(/\s+/g, ' ')}`);
        continue;
      }

      const body = statement.replace(/^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?[a-z_]+"?/i, '');
      const names = topLevelParts(body.replace(/;\s*$/, ''))
        .map((clause) => /^ADD\s+COLUMN\s+"?([a-z_][a-z0-9_]*)"?/i.exec(clause)?.[1])
        .filter((name): name is string => name !== undefined);

      // A MIS-PARSE IS LOUD RATHER THAN ABSORBED. A statement the shape check
      // called `ADD COLUMN` that yields no name means the clause splitter and
      // the shape check disagree, and a name already present means the same
      // column was read twice -- both would otherwise vanish into a Set.
      if (names.length === 0) {
        throw new Error(
          `${file}: an ADD COLUMN against ${table} parsed to no column name: ` +
            statement.slice(0, 120).replace(/\s+/g, ' '),
        );
      }
      for (const name of names) {
        if (columns.has(name)) {
          throw new Error(`${file}: ADD COLUMN ${table}.${name}, which is already in the set`);
        }
        columns.add(name);
        added.push(name);
      }
    }
  }

  return { columns: [...columns].sort(), added, relaxed, refused };
}

describe('the TypeScript schema has not drifted from the DDL', () => {
  // ADR-008's "types are generated from the schema so drift is a compile error"
  // is FALSE on this tree and ADR-084 supersedes it. This is what replaces it,
  // and ADR-094 is what makes it read a table's WHOLE history rather than its
  // first statement.

  test('every registered table maps to the SQL name the DDL uses', () => {
    for (const [key, sqlName] of DDL_NAMES) {
      expect(getTableName(TABLES[key] as PgTable)).toBe(sqlName);
    }
  });

  for (const [key, sqlName] of DDL_NAMES) {
    test(`${sqlName}: the TS column set equals the set as of the LAST migration`, () => {
      expect(sqlNames(key)).toEqual(foldTable(sqlName).columns);
    });
  }

  // THE REFUSAL, NARROWED TWICE RATHER THAN DELETED. It used to read "no later
  // migration changes a column on any of the seven" and it was what made the
  // `CREATE TABLE` body a sound proxy for the table. ADR-094 replaced that proxy
  // with the fold, and ADR-103 removed the second one: `ALTER COLUMN` stood in
  // for a comparison that did not exist and now does. What remains is the part
  // that is still true: a shape the fold does not read is a shape nothing here
  // verifies, and `DROP COLUMN` and `RENAME` are still red.
  test('no later migration changes a column in a shape ADR-103 does not fold', () => {
    const refused = DDL_NAMES.flatMap(([, sqlName]) => foldTable(sqlName).refused);
    expect(refused).toEqual([]);
  });

  // THE FOLD IS WATCHED WORKING RATHER THAN ASSUMED TO. A fold that returned
  // each `CREATE TABLE` set unchanged would leave every assertion above green
  // for any table whose transcription ALSO omitted the later columns, because
  // both sides would be wrong in the same direction. This is the one assertion
  // that fails in that case, and it is ADR-094's checkable clause.
  test('the fold is not vacuous: a registered table gains columns after its CREATE', () => {
    const gained = DDL_NAMES.filter(([, sqlName]) => foldTable(sqlName).added.length > 0).map(
      ([, sqlName]) => sqlName,
    );
    expect(
      gained.length,
      `no registered table replays an ADD COLUMN: ${gained.join(', ')}`,
    ).toBeGreaterThan(0);
  });

  test('every registered table is created exactly once, so there is one CREATE to fold onto', () => {
    for (const [, sqlName] of DDL_NAMES) {
      const matches = allMigrationSql().match(new RegExp(`CREATE TABLE ${sqlName} \\(`, 'gi'));
      expect(matches?.length, sqlName).toBe(1);
    }
  });
});

// =============================================================================
// ADR-101. WHICH CLASS IS AVAILABLE, AND WHAT A NULLABLE HOP MEANS.
// =============================================================================
// The vocabulary answers HOW a row reaches an identity. Nothing in it asked
// WHETHER `derived` was allowed to be the answer on a row that already carries
// its own identity column, and nothing asked whether the hop it names is even
// PRESENT on every row.
//
// Three rules were seeded through those two gaps, on this tree, and every
// mechanical check in this repository agreed with all three: `pnpm run
// typecheck` at exit 0 with zero `error TS`, and this file green at 101 of 101.
//
//   wallet_entries      derived via ledger_transactions on ledger_transaction_id
//                       answers WHOSE LEDGER ACCOUNTS APPEAR ON THIS TRANSACTION
//                       rather than whose wallet holds this entry. The two agree
//                       only while no transaction touches two identities'
//                       accounts, which nothing enforces and which double entry
//                       makes the ordinary case rather than the exception. The
//                       row's own `identity_id` is NOT NULL and answers it.
//   wallet_withdrawals  derived via risk_flags on freeze_flag_id reaches the
//                       CORRECT identity and still returns the FROZEN SUBSET,
//                       because the column is NULL on every withdrawal nobody
//                       froze. A nullable FK to a correctly scoped table is not
//                       a milder error than a nullable FK to a firm one.
//   sessions            derived via identity_signals on device_fingerprint_id is
//                       THIS FILE'S OWN NAMED TRAP written as a rule -- scope.ts
//                       names it in its first twenty lines -- and it reaches
//                       whoever SHARES A DEVICE, on the rows where the column is
//                       not null.
//
// All three terminate at an identity, so session 188's bounded-chain assertion
// is satisfied. All three name a foreign key the DDL declares, so the existing
// derived assertion is satisfied. All three are the BOLA failure ADR-008 scoped
// the accessor to bound, arriving through the accessor itself, and the direction
// all three fail in is SILENCE.
//
// THE READER IS THE FOLD AND NEVER THE `CREATE TABLE`, on ADR-094: a table is
// read AS OF THE LAST MIGRATION. Every identity-column reader above this line
// stops at the CREATE, and `admin_actions.on_behalf_of_identity_id` -- added by
// `ALTER TABLE` in 0043 -- is invisible to all of them. ADR-101 section 8
// records that as a finding against the `firm` assertion and does not repair it
// there, because `admin_actions` is correctly `firm` and the repair is a ruling
// about what the `firm` class promises rather than about this one.

/**
 * ONE TABLE'S COLUMN DEFINITIONS, REPLAYED. ADR-101, on ADR-094's fold.
 *
 * `foldTable` folds NAMES and that is all its own assertions need. A scope rule
 * is checked against the `REFERENCES` clause and against `NOT NULL`, which live
 * in the DEFINITION, so this folds the definition text on the same walk.
 *
 * THE TWO FOLDS ARE BOUND BY AN ASSERTION RATHER THAN BY CARE. A second reader
 * of the same migrations that could disagree with the first is the hazard
 * ADR-092 section 5 names on `SQL_NAME` and `DDL_NAMES`: two hand-kept
 * statements of one fact, where deleting from one leaves the suite green. The
 * first test below compares the two key sets on every registered table, so a
 * divergence is red rather than silent.
 */
function foldTableDefs(table: string): Map<string, string> {
  const files = migrationFiles();
  const read = (file: string): string => readFileSync(join(MIGRATIONS, file), 'utf8');
  const createdIn = files.findIndex((file) =>
    new RegExp(`CREATE TABLE ${table} \\(`, 'i').test(read(file)),
  );
  if (createdIn < 0) throw new Error(`no CREATE TABLE for ${table}`);

  const defs = ddlColumnDefs(read(files[createdIn] ?? ''), table);
  for (const file of files.slice(createdIn)) {
    for (const statement of alterStatementsFor(read(file), table)) {
      // ADR-103. THIS IS WHERE THE NULLABILITY ACTUALLY MOVES. `foldTable`
      // records the relaxation and changes no name; the definition is what
      // carries `NOT NULL`, so the statement is APPLIED here off the same
      // reader, never re-parsed by a second one.
      if (/\bALTER\s+COLUMN\b/i.test(statement)) {
        for (const name of droppedNotNulls(statement) ?? []) {
          const def = defs.get(name);
          if (def === undefined) {
            throw new Error(
              `${file}: ALTER COLUMN ${table}.${name} DROP NOT NULL, and ${name} has no ` +
                `folded definition on ${table}`,
            );
          }
          defs.set(name, withoutNotNull(def, `${table}.${name}`));
        }
        continue;
      }
      if (!/\bADD\s+COLUMN\b/i.test(statement)) continue;
      // REFUSED SHAPES ARE SKIPPED HERE AND REFUSED THERE. `foldTable` records
      // every `DROP COLUMN`, `RENAME` and unreadable `ALTER COLUMN` into
      // `refused`, and the assertion above holds that list empty over every
      // registered table, so skipping them here absorbs nothing already red.
      if (/\bDROP\s+COLUMN\b|\bRENAME\b/i.test(statement)) continue;

      const body = statement
        .replace(/^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?[a-z_]+"?/i, '')
        .replace(/;\s*$/, '');
      for (const clause of topLevelParts(body)) {
        const name = /^ADD\s+COLUMN\s+"?([a-z_][a-z0-9_]*)"?/i.exec(clause)?.[1];
        if (name === undefined) continue;
        defs.set(
          name,
          clause
            .replace(/^ADD\s+COLUMN\s+/i, '')
            .replace(/\s+/g, ' ')
            .trim(),
        );
      }
    }
  }
  return defs;
}

/** Every column on `table`'s folded row that the DDL declares against `identities(id)`. */
const identityColumnsOf = (table: string): string[] =>
  [...foldTableDefs(table).entries()]
    .filter(([, def]) => /REFERENCES\s+identities\s*\(\s*id\s*\)/i.test(def))
    .map(([name]) => name)
    .sort();

/**
 * Whether the DDL declares this column NOT NULL.
 *
 * `PRIMARY KEY` IMPLIES IT AND THE WORDS ARE OFTEN ABSENT. `wallet_dormancy`
 * is `identity_id uuid PRIMARY KEY REFERENCES identities(id)` with no `NOT
 * NULL` text at all, and session 202 recorded reading its flag off the key
 * rather than off the words. A reader that matched only the words would call
 * that column nullable and refuse a correct rule.
 */
const declaredNotNull = (def: string | undefined): boolean =>
  /\bNOT NULL\b/i.test(def ?? '') || /\bPRIMARY KEY\b/i.test(def ?? '');

/**
 * THE COLUMN THAT CARRIES THE EDGE, which is not always this row's.
 *
 * A forward edge declares `REFERENCES` on `localColumn`, and a NULL there is a
 * row of THIS table that reaches nobody. A reverse edge -- `ledger_transactions`
 * is the one on this tree -- declares it on `via.foreignColumn`, and a NULL
 * there is a child that vouches for nobody, which drops this row from its own
 * owner's read just as surely. The nullability that matters is the FK-bearing
 * column's in both directions, so the direction is resolved the same way the
 * existing derived assertion resolves it.
 */
function derivedEdge(key: TableKey): { where: string; def: string | undefined } {
  const rule = SCOPE_RULES[key];
  if (rule.class !== 'derived') throw new Error(`${key} is not derived`);
  const here = foldTableDefs(SQL_NAME[key]).get(rule.localColumn);
  const there = foldTableDefs(SQL_NAME[rule.via]).get(rule.foreignColumn);
  const forward = new RegExp(`REFERENCES\\s+${SQL_NAME[rule.via]}\\s*\\(`, 'i').test(here ?? '');
  return forward
    ? { where: `${SQL_NAME[key]}.${rule.localColumn}`, def: here }
    : { where: `${SQL_NAME[rule.via]}.${rule.foreignColumn}`, def: there };
}

// WHAT THESE ASSERTIONS DO NOT REFUSE, STATED HERE RATHER THAN LEFT TO BE
// DISCOVERED. ADR-101 section 7.
//
// A `semi-join` traverses the REVERSE edge: the foreign key is declared on the
// via table, pointing back at this one. Clause 2 below checks that column's
// nullability, which is the right check and is not the whole property.
// `NOT NULL` constrains the CHILD -- every child names a parent -- and the
// traversal needs the reverse: that every PARENT has a child. SQL declares the
// first and has no way to declare the second, so no assertion over these
// migrations can verify it.
//
//   raw_ingest_rows  derived via fills on the reverse edge
//                    `fills.raw_row_id bigint NOT NULL REFERENCES
//                    raw_ingest_rows(id)` resolves, terminates at an owned
//                    table, and PASSES EVERYTHING BELOW. It is wrong because an
//                    EOD balance row, an unparsed row, and every row of a
//                    quarantined file become no fill at all, so the read drops
//                    exactly the rows a dispute is argued from. Seeded and
//                    watched passing at 113 of 113 with these clauses running.
//
// `ledger_transactions` IS THE REGISTRY'S ONLY `semi-join` RULE AND IT RESTS ON
// THE SAME UNSTATED PROPERTY. 0009_ledger.sql declares no trigger and no
// constraint requiring a transaction to have entries. What separates it from the
// seed is semantic: there the entries ARE the tenancy, and a transaction with no
// entries correctly belongs to nobody, whereas a raw ingest row HAS an owner --
// inside `raw jsonb`, where no scope rule reaches it. A parser cannot tell a
// relation that is CONSTITUTIVE of tenancy from one merely CORRELATED with it.
//
// The remedy ADR-101 section 7 prices is an ATTESTATION on reverse-edge rules,
// and it is the exact inverse of clause 3 below: `nullable` gets no field
// because the DDL declares it, and reverse-edge totality gets one because the
// DDL cannot. A field earns its place exactly when the fact is absent from the
// primary source. It is not written here because it edits a table's row.

describe('a class is REFUSED as well as declared', () => {
  test('a folded definition set names exactly the folded column set, so the two folds cannot disagree', () => {
    for (const [, sqlName] of DDL_NAMES) {
      expect([...foldTableDefs(sqlName).keys()].sort(), sqlName).toEqual(
        foldTable(sqlName).columns,
      );
    }
  });

  // ADR-101 CLAUSE 1. Measured against all eighty rules before it was ruled:
  // it refuses ZERO of the fourteen registered `derived` rules, so no green row
  // turns red and there is no exemption to write down.
  test('no derived rule stands on a row that carries its own identity column', () => {
    for (const key of TABLE_KEYS) {
      if (SCOPE_RULES[key].class !== 'derived') continue;
      expect(
        identityColumnsOf(SQL_NAME[key]),
        `${SQL_NAME[key]} is registered derived and its own row declares an identity ` +
          'column. A derivation can then only answer a DIFFERENT question from the one ' +
          'that column already answers, and it answers it by returning rows rather than ' +
          'by raising. Register it owned on that column, or leave the table ' +
          'unregistered: unregistered is unreachable and unreachable is safe.',
      ).toEqual([]);
    }
  });

  // THE REFUSAL ABOVE IS NOT VACUOUS AND THIS IS WHAT SAYS SO. It passes today
  // by finding nothing on fourteen tables, and a reader that had stopped
  // matching -- a DDL style change, a regex edited in passing -- would find
  // nothing on all eighty and stay just as green. Every owned rule names a
  // column this same reader must see.
  test('the identity-column reader finds the column every owned rule names, so the refusal is not vacuous', () => {
    const owned = TABLE_KEYS.filter((key) => SCOPE_RULES[key].class === 'owned');
    expect(owned.length).toBeGreaterThan(0);
    for (const key of owned) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'owned') continue;
      expect(identityColumnsOf(SQL_NAME[key]), SQL_NAME[key]).toContain(rule.column);
    }
  });

  // ADR-101 CLAUSE 2, and it is the half clause 1 does not cover: a row with no
  // identity column of its own, hopping a column that is NULL on most of them.
  // Refuses ZERO of the fourteen, measured before it was ruled.
  test('no derived rule traverses a nullable edge, because the null rows are a subset it returns in silence', () => {
    for (const key of TABLE_KEYS) {
      if (SCOPE_RULES[key].class !== 'derived') continue;
      const edge = derivedEdge(key);
      expect(edge.def, `${key} derives through ${edge.where}, which is not a column`).toBeDefined();
      expect(
        declaredNotNull(edge.def),
        `${key} derives through ${edge.where}, which the DDL does not declare NOT NULL. ` +
          'Every row where it is null reaches no identity, so the rule returns a strict ' +
          "subset of that person's rows and raises nothing on the rest. There is no " +
          'admissible derived reading of a nullable edge: the DDL says the relationship ' +
          `is optional and a scope rule may not answer "whose row is this" with silence. ` +
          `Its DDL is: ${edge.def ?? ''}`,
      ).toBe(true);
    }
  });

  // ADR-101 CLAUSE 3, AND IT CHECKS A FIELD THIRTY-FOUR RULES HAVE STATED SINCE
  // THE REGISTRY EXISTED. `OwnedRule.nullable` is read by NOTHING: `scopePredicate`
  // says in its own comment that a nullable identity column needs no second
  // predicate, and no assertion in this file compared the flag to the DDL. That
  // is why ADR-101 adds no `nullable` to `DerivedRule` -- a second field nothing
  // reads and nothing checks is a second thing asserting itself, which is
  // session 145's failure, and the nullability that matters is read from the
  // migrations by the clause above.
  test('every owned rule states the nullability the DDL declares, which nothing checked before ADR-101', () => {
    for (const key of TABLE_KEYS) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'owned') continue;
      const def = foldTableDefs(SQL_NAME[key]).get(rule.column);
      expect(def, `${SQL_NAME[key]}.${rule.column} is not a column`).toBeDefined();
      expect(
        rule.nullable,
        `${SQL_NAME[key]}.${rule.column} is declared "${def ?? ''}" and the rule states ` +
          `nullable: ${String(rule.nullable)}`,
      ).toBe(!declaredNotNull(def));
    }
  });
});

// =============================================================================
// ADR-106. A ROW THAT BELONGS TO TWO IDENTITIES, AND THE CLASS THAT SAYS SO.
// =============================================================================
// EVERY ASSERTION ABOVE THIS LINE ASKS ABOUT THE ONE COLUMN A RULE NAMES.
// ADR-101 clause 1 refuses `derived` on a row that carries its own identity
// column and clause 3 checks the nullability of the single column an `owned`
// rule names; neither asks how MANY identity columns the row has, and four
// tables in this tree have two.
//
// THE FOUR ARE MEASURED AND NOT LISTED. `identity_links`, `dedupe_matches` and
// `attributions` are registered `pair` by ADR-106; `identity_merges` is the
// fourth and is left to the session that needs it. Nothing below names any of
// them: the reader finds them.
//
// WHAT `pair` DECIDES IS NOT ONLY THE PREDICATE. `columnA = $1 OR columnB = $1`
// would return precisely the rows that are one person's, so the refusal is not a
// limitation of the vocabulary. It is that every row such a read returns carries
// the OTHER party's identity uuid out of a NOT NULL column, which is the
// cross-identity read `correlation_groups`' own `why` already refuses at arity
// three -- "returning the row to each member would tell every member which OTHER
// accounts the detector grouped them with" -- and it is worse at arity two,
// where the party learns precisely who rather than a set. So `PairTableKey` is
// excluded from `ScopedTableKey`, excluded from `FirmTableKey`, and served only
// by `systemDb(reason)`, where a word has to be written.

describe('a row that belongs to two identities is scoped to neither', () => {
  const sqlText = allMigrationSql();

  // THE REFUSAL THAT WOULD HAVE CAUGHT THE WRONG ANSWER, and the wrong answer is
  // the one four sessions declined to write: an `owned` rule naming ONE of the
  // two columns. IT ASSERTS EXACTLY ONE RATHER THAN NOT-MORE-THAN-ONE, which is
  // the direction it can fail in: a reader that stopped matching would find zero
  // on every table and a not-more-than-one assertion would stay green on all
  // forty of them. Every existing assertion accepts it -- the column IS declared
  // `REFERENCES identities(id)`, it IS `NOT NULL`, the rendered predicate DOES
  // compare it and DOES bind the identity -- so the suite was green on a rule
  // that returns a strict subset of a person's own rows, selected by UUID
  // ordering, with no error anywhere.
  //
  // MEASURED AGAINST ALL FORTY `owned` RULES BEFORE IT WAS ADOPTED, on ADR-101
  // clause 1's method: it refuses ZERO of them, so no green row turns red and
  // there is no exemption to write down. Exactly four tables in 111 declare more
  // than one identity column and none of the four was ever registered `owned`.
  test('every owned rule stands on a row that declares EXACTLY ONE identity column', () => {
    for (const key of TABLE_KEYS) {
      if (SCOPE_RULES[key].class !== 'owned') continue;
      expect(
        identityColumnsOf(SQL_NAME[key]),
        `${SQL_NAME[key]} is registered owned and its own row declares more than one column ` +
          'REFERENCES identities(id). An owned rule names ONE, so it answers "whose row is ' +
          'this" with one of two true answers and returns a strict subset of that person\'s ' +
          'rows -- on a canonical-order table, the subset chosen by UUID ordering. Register ' +
          'it `pair`, or leave the table unregistered.',
      ).toHaveLength(1);
    }
  });

  // THE REFUSAL ABOVE IS NOT VACUOUS AND THIS IS WHAT SAYS SO. It passes today by
  // finding exactly one column on forty tables, and a reader that had stopped
  // matching would find zero on all of them and pass just as quietly -- which is
  // why it asserts a LENGTH OF ONE rather than "not more than one". This is the
  // other half: the same reader must find TWO on every table the registry calls
  // a pair, so the two directions cannot both degrade into agreement.
  test('the identity-column reader finds exactly two on every pair table, so the refusal can fire', () => {
    const pairs = TABLE_KEYS.filter((key) => SCOPE_RULES[key].class === 'pair');
    expect(
      pairs.length,
      'the pair class has no members, so nothing below asserts anything',
    ).toBeGreaterThan(0);
    for (const key of pairs) {
      expect(identityColumnsOf(SQL_NAME[key]), SQL_NAME[key]).toHaveLength(2);
    }
  });

  // THE TWO COLUMNS ARE THE ONES THE DDL DECLARES, CHECKED AGAINST THE
  // MIGRATIONS AND NOT AGAINST THE RULE. This is session 145's lesson on the new
  // class: a rule asserted against itself asserts nothing, so the expectation
  // comes from the folded `REFERENCES` clause. It also refuses a rule that named
  // two of three, and a rule that named the same column twice -- which would be
  // an `owned` rule wearing the new class's name.
  test('every pair rule names the two distinct columns the DDL declares against identities(id)', () => {
    for (const key of TABLE_KEYS) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'pair') continue;
      expect(rule.columnA, `${SQL_NAME[key]} names one column twice`).not.toBe(rule.columnB);
      expect([rule.columnA, rule.columnB].sort(), SQL_NAME[key]).toEqual(
        identityColumnsOf(SQL_NAME[key]),
      );
    }
  });

  // ADR-101 CLAUSE 2 IN THE PAIR DIRECTION. A nullable identity column on a pair
  // row is a row that reaches ONE person through one side and nobody through the
  // other, so the disjunction would be answering "whose row is this" with
  // silence on half of it -- and the disclosure argument would be weaker on
  // exactly the rows where the tenancy is weakest. All three tables declare both
  // columns NOT NULL and the DDL is what says so.
  test('every pair rule stands on two columns the DDL declares NOT NULL', () => {
    for (const key of TABLE_KEYS) {
      const rule = SCOPE_RULES[key];
      if (rule.class !== 'pair') continue;
      const defs = foldTableDefs(SQL_NAME[key]);
      for (const column of [rule.columnA, rule.columnB]) {
        const def = defs.get(column);
        expect(def, `${SQL_NAME[key]}.${column} is not a column`).toBeDefined();
        expect(
          declaredNotNull(def),
          `${SQL_NAME[key]}.${column} is one of two tenancy columns and the DDL does not ` +
            `declare it NOT NULL. Its DDL is: ${def ?? ''}`,
        ).toBe(true);
      }
    }
  });

  // THE DOOR, AND THE MESSAGE THAT NAMES IT. `firm` and `pair` both refuse a
  // scoped read and they refuse it for opposite reasons, so a caller that
  // reaches either through a cast is told which one it hit. The type is the real
  // refusal and vitest cannot see a type error at all; this is the runtime half.
  test('a pair table has no scoped reading, and says two identities own it rather than none', () => {
    const pairs = TABLE_KEYS.filter((key) => SCOPE_RULES[key].class === 'pair');
    expect(pairs.length).toBeGreaterThan(0);
    for (const key of pairs) {
      expect(() => scopePredicate(key, IDENTITY), key).toThrow(/belongs to TWO identities/);
      expect(() => scopePredicate(key, IDENTITY), key).toThrow(/systemDb/);
      expect(() => scopePredicate(key, IDENTITY), key).not.toThrow(/belongs to no identity/);
    }
  });

  // THE DISCLOSURE IS A FACT ABOUT THE DDL AND NOT A JUDGEMENT, and this is
  // where it is read out of the migrations rather than argued in a comment. Two
  // of the three declare a CHECK that the pair is DISTINCT, so on those tables
  // every row hands a reader somebody else's uuid by construction. `attributions`
  // is the one that does not, and the exception is itself constrained: the pair
  // may collapse only on a VOIDED row, which is the self-deal the constraint
  // exists to record.
  test('the pair is distinct by CHECK, or its collapse is itself constrained', () => {
    // THE CONSTRAINT NAME IS PART OF EVERY PATTERN AND THAT IS DELIBERATE. The
    // two canonical-order tables declare the SAME predicate, so a pattern
    // matching only the predicate would pass for both while one of them had
    // lost it. Every name here is table-qualified in the DDL.
    const distinctness = new Map<string, RegExp>([
      [
        'identity_links',
        /CONSTRAINT identity_links_canonical_order CHECK \(identity_a < identity_b\)/i,
      ],
      [
        'dedupe_matches',
        /CONSTRAINT dedupe_matches_canonical_order CHECK \(identity_a < identity_b\)/i,
      ],
      [
        'attributions',
        /CONSTRAINT attributions_literal_self_deal_is_void CHECK \( buyer_identity_id <> affiliate_identity_id OR voided = true \)/i,
      ],
    ]);
    const pairs = TABLE_KEYS.filter((key) => SCOPE_RULES[key].class === 'pair').map(
      (key) => SQL_NAME[key],
    );
    // THE MAP IS HELD TO THE REGISTRY IN BOTH DIRECTIONS, so a fourth pair table
    // registered without a line here is red rather than silently uncovered.
    expect([...distinctness.keys()].sort()).toEqual([...pairs].sort());
    for (const [table, pattern] of distinctness) {
      expect(
        sqlText.replace(/--[^\n]*/g, '').replace(/\s+/g, ' '),
        `${table}'s pair-distinctness constraint`,
      ).toMatch(pattern);
    }
  });
});

// =============================================================================
// ADR-103. THE TYPE AND THE NULLABILITY, WHICH THE NAME SET NEVER SAW.
// =============================================================================
// EVERYTHING ABOVE THIS LINE COMPARES NAMES. `foldTable` replays a table's
// migration history and the per-table assertion holds `sqlNames(key)` equal to
// the folded column-NAME set; `foldTableDefs` folds the whole definition text
// and ADR-101's clauses read exactly two things out of it, `REFERENCES
// identities(id)` and `NOT NULL`, and only on the ONE column a scope rule
// names. So a column transcribed `text()` where the DDL says `bytea`, or
// `.notNull()` where the DDL says nullable, agrees on names, is invisible to
// every rule assertion, and is GREEN.
//
// ADR-094 SECTION 3 NAMED THIS GAP, PRICED CLOSING IT AS ITS OWN SESSION, AND
// LEFT `ALTER COLUMN` REFUSING TWO TABLES AS A STATED PROXY IN ITS PLACE:
// "Column TYPE and NULLABILITY are transcribed into `schema.ts` and asserted
// nowhere ... Until it exists, `ALTER COLUMN` refusing a table is the only
// thing standing where that comparison should be." This is that comparison, and
// the refusal stops being a proxy in the same entry that writes it.
//
// WHY IT IS NOT COSMETIC. `bytea` versus `text` is ADR-046's seal:
// `contact_channels.value_hash` is a DIGEST and `value_ciphertext` is envelope
// encrypted under a key that is not in this database, and a digest transcribed
// as a string is a digest an application can read as one. Money is integer
// cents, so a wrong integer width is a wrong balance. `identity_status` read as
// `text` is a closed vocabulary read as an open one.
//
// THE READER IS THE FOLD AND NEVER THE `CREATE TABLE`, on ADR-094:
// `contact_channels.value_ciphertext` is `ALTER`-added in `0034` and a reader
// that stopped at the CREATE would not see the column this entry is most for.

/**
 * WHERE A COLUMN'S TYPE ENDS. Everything from the first constraint keyword on
 * is not the type, and the list is the one the DDL in this tree actually uses.
 *
 * A MISSED KEYWORD FAILS LOUD RATHER THAN QUIET. If the split does not cut, the
 * reader returns `text NOT NULL DEFAULT ...` and no `getSQLType()` in
 * drizzle-orm returns that, so the comparison goes RED. The silent direction is
 * a reader that returns the EMPTY STRING for everything, and the assertion at
 * `the type reader is not degenerate` is what stands there.
 */
const TYPE_ENDS_AT =
  /\s+(?=NOT\s+NULL\b|NULL\b|PRIMARY\s+KEY\b|REFERENCES\b|DEFAULT\b|UNIQUE\b|CHECK\b|CONSTRAINT\b|GENERATED\b|COLLATE\b|DEFERRABLE\b)/i;

/**
 * The two spellings PostgreSQL itself treats as one type.
 *
 * THE TABLE IS CLOSED AND EVERY ENTRY IS A POSTGRES ALIAS RATHER THAN A
 * JUDGEMENT, and that is the whole discipline: an entry here makes two
 * DIFFERENT spellings compare EQUAL, so a wrong entry is the one edit that can
 * make this comparison agree with a wrong transcription. `timestamptz` is what
 * the migrations write and `timestamp with time zone` is what drizzle-orm's
 * `timestamp(_, { withTimezone: true })` renders; they are one type in the
 * catalog. NOTHING ELSE IN THIS TREE NEEDS ONE -- `bytea`, `citext`, `jsonb`,
 * `char(n)`, `numeric`, `inet`, every enum and every array spell identically on
 * both sides, measured rather than assumed.
 */
const TYPE_ALIASES: Readonly<Record<string, string>> = {
  timestamptz: 'timestamp with time zone',
  'timestamptz[]': 'timestamp with time zone[]',
};

/** One spelling, so whitespace and case cannot make two equal types disagree. */
const canonicalType = (raw: string): string => {
  const spelled = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*\)\s*/g, ')')
    .replace(/\s*,\s*/g, ', ');
  return TYPE_ALIASES[spelled] ?? spelled;
};

/** The SQL type one folded column definition declares, with its name removed. */
const ddlType = (def: string): string =>
  canonicalType(
    def.trim().replace(/\s+/g, ' ').split(' ').slice(1).join(' ').split(TYPE_ENDS_AT)[0] ?? '',
  );

/** The SQL type the TRANSCRIPTION declares, which drizzle-orm renders itself. */
const tsType = (column: PgColumn): string => canonicalType(column.getSQLType());

/**
 * COLUMNS WHOSE TYPE IS THE POINT, STATED BY HAND AND CHECKED AGAINST BOTH
 * READERS.
 *
 * THIS IS THE NON-VACUITY GUARD AND IT IS A THIRD INDEPENDENT STATEMENT. The
 * per-table comparison below reads the DDL with `ddlType` and the transcription
 * with `getSQLType()`, and if BOTH degraded in the same direction -- a reader
 * that returned the empty string, a splitter that stopped matching -- the
 * comparison would agree with itself and stay green, which is ADR-084 section
 * 7's failure and ADR-094's seed B. These rows are written out in full, so a
 * degraded reader disagrees with a LITERAL rather than with its twin.
 *
 * The set is chosen for what a wrong transcription would COST, not for
 * coverage: two ADR-046 digests, two money columns, a closed enum, and one of
 * each remaining spelling so no branch of the reader is unexercised.
 * `contact_channels.value_ciphertext` is `ALTER`-added in `0034`, so it also
 * proves these rows are read out of the FOLD and not out of the `CREATE`.
 */
const TYPE_SENTINELS: ReadonlyArray<readonly [TableKey, string, string, boolean]> = [
  // ADR-046. A digest and an envelope ciphertext, neither of them a string.
  ['contactChannels', 'value_hash', 'bytea', true],
  ['contactChannels', 'value_ciphertext', 'bytea', false],
  // Money is integer cents, so the WIDTH is the balance.
  ['purchases', 'list_price_cents', 'bigint', true],
  ['walletEntries', 'amount_cents', 'bigint', true],
  // A closed vocabulary read as an open one is ADR-041's three members lost.
  ['identities', 'status', 'identity_status', true],
  // ADR-041 again: casing never creates a duplicate human, and `text` would.
  ['users', 'email', 'citext', true],
  // The remaining spellings, one each.
  ['contactChannels', 'created_at', 'timestamp with time zone', true],
  ['passkeys', 'transports', 'text[]', false],
  ['sessions', 'created_ip', 'inet', false],
  ['detectorDefinitions', 'parameters', 'jsonb', true],
  ['detectorDefinitions', 'effective_from', 'date', true],
  ['riskFlags', 'severity', 'smallint', true],
  ['correlationGroups', 'statistic', 'numeric', true],
  ['purchases', 'currency', 'char(3)', true],
];

/** Every type spelling the reader must still be able to produce. */
const TYPE_VOCABULARY: readonly string[] = [
  'bigint',
  'boolean',
  'bytea',
  'char(2)',
  'char(3)',
  'citext',
  'date',
  'inet',
  'integer',
  'jsonb',
  'numeric',
  'smallint',
  'text',
  'text[]',
  'timestamp with time zone',
  'uuid',
];

describe('the transcription states the DDL type and nullability, not only the column names', () => {
  for (const [key, sqlName] of DDL_NAMES) {
    test(`${sqlName}: every column's TYPE and NULLABILITY equal the DDL as of the LAST migration`, () => {
      const defs = foldTableDefs(sqlName);
      for (const column of Object.values(columnsOf(key))) {
        const def = defs.get(column.name);
        expect(def, `${sqlName}.${column.name} is not a column of the folded table`).toBeDefined();
        expect(
          tsType(column),
          `${sqlName}.${column.name} is transcribed as a different TYPE from the one the ` +
            `migration set declares. Its DDL is: ${def ?? ''}`,
        ).toBe(ddlType(def ?? ''));
        expect(
          column.notNull,
          `${sqlName}.${column.name} is transcribed as ` +
            `${column.notNull ? 'NOT NULL' : 'nullable'} and the migration set declares it ` +
            `${declaredNotNull(def) ? 'NOT NULL' : 'nullable'}. Its DDL is: ${def ?? ''}`,
        ).toBe(declaredNotNull(def));
      }
    });
  }

  // THE SILENT DIRECTION, AND THE ONLY ONE THIS COMPARISON HAS. A reader that
  // returned the empty string for every column would compare '' with a rendered
  // type and go red; a reader that returned the empty string on BOTH sides
  // could not, and nothing else in this file would notice. So the reader is
  // asserted to produce a type for every column of every registered table, and
  // asserted not to have swallowed the constraint text with it.
  test('the type reader is not degenerate: it reads a real type for every registered column', () => {
    let read = 0;
    for (const [, sqlName] of DDL_NAMES) {
      for (const [name, def] of foldTableDefs(sqlName)) {
        const declared = ddlType(def);
        expect(
          declared,
          `${sqlName}.${name} has DDL "${def}" and the reader returned nothing`,
        ).not.toBe('');
        expect(
          declared,
          `${sqlName}.${name}: the type reader swallowed constraint text, so it did not cut ` +
            `where a type ends. Its DDL is: ${def}`,
        ).not.toMatch(
          /\b(NOT NULL|PRIMARY KEY|REFERENCES|DEFAULT|CHECK|UNIQUE|GENERATED|COLLATE)\b/i,
        );
        read++;
      }
    }
    const declared = TABLE_KEYS.reduce((n, key) => n + Object.keys(columnsOf(key)).length, 0);
    expect(read, 'the comparison did not visit every column the transcription declares').toBe(
      declared,
    );
    expect(read).toBeGreaterThan(TABLE_KEYS.length);
  });

  // THE COMPARISON IS WATCHED DISCRIMINATING RATHER THAN ASSUMED TO. Both sides
  // of every assertion above are READERS, and two readers that degrade together
  // agree. These rows are literals: a degraded reader disagrees with one.
  test('the columns whose type is the point hold exactly the type and nullability written here', () => {
    for (const [key, name, type, notNull] of TYPE_SENTINELS) {
      const column = Object.values(columnsOf(key)).find((c) => c.name === name);
      expect(column, `${SQL_NAME[key]}.${name} is not a transcribed column`).toBeDefined();
      expect(
        column === undefined ? '' : tsType(column),
        `${SQL_NAME[key]}.${name} in schema.ts`,
      ).toBe(type);
      expect(column?.notNull, `${SQL_NAME[key]}.${name} in schema.ts`).toBe(notNull);

      const def = foldTableDefs(SQL_NAME[key]).get(name);
      expect(def, `${SQL_NAME[key]}.${name} is not a folded column`).toBeDefined();
      expect(ddlType(def ?? ''), `${SQL_NAME[key]}.${name} in the migrations`).toBe(type);
      expect(declaredNotNull(def), `${SQL_NAME[key]}.${name} in the migrations`).toBe(notNull);
    }
  });

  // ---------------------------------------------------------------------------
  // ADR-103'S SECOND HALF: `ALTER COLUMN` STOPS BEING A PROXY REFUSAL.
  // ---------------------------------------------------------------------------
  // ONE OF THE TWO TABLES BELOW IS NOW REGISTERED AND THESE ASSERTIONS ARE KEPT,
  // WHICH IS THE PART WORTH READING. `otp_challenges` and `trading_calendar` are
  // the only two tables in 47 migrations carrying an `ALTER COLUMN`. Under
  // ADR-103 neither was registered, so nothing in `DDL_NAMES` exercised the
  // fold's new member and `foldTable(...).relaxed` was EMPTY on all 99 -- a
  // vocabulary member no assertion runs is a vocabulary member nobody has
  // checked, which is ADR-094's own seed-B argument about a fold that folds
  // nothing. ADR-106 registers `otp_challenges` and the assertion above is where
  // the member now runs on the registered path. THESE TWO STAY BECAUSE
  // `trading_calendar` IS STILL UNREGISTERED and because a by-name fold is the
  // only thing that can see an UNREGISTERED carrier at all, which is what the
  // closure assertion below depends on.

  const ALTER_COLUMN_TABLES: ReadonlyArray<readonly [string, readonly string[]]> = [
    // 0029_phone_identity_and_auth.sql, SD-M16-05. An SMS challenge has no
    // email address, and 0002 made the column NOT NULL when no other kind of
    // challenge existed.
    ['otp_challenges', ['email_normalized']],
    // 0032_trading_calendar_holidays_coverage_revisions.sql. A holiday has no
    // session to contain fills in, and R-01 is a containment lookup, so the
    // fabricated interval 0004 forced was not inert.
    ['trading_calendar', ['session_open_at', 'session_close_at']],
  ];

  test('ALTER COLUMN DROP NOT NULL is FOLDED, and the column it names comes out nullable', () => {
    for (const [table, relaxedColumns] of ALTER_COLUMN_TABLES) {
      const fold = foldTable(table);
      expect(fold.refused, `${table} still carries a refused statement`).toEqual([]);
      expect([...fold.relaxed].sort(), `${table} relaxed`).toEqual([...relaxedColumns].sort());

      const folded = foldTableDefs(table);
      const created = ddlColumnDefs(allMigrationSql(), table);
      for (const name of relaxedColumns) {
        // IT WAS NOT NULL AT ITS CREATE, WHICH IS WHAT MAKES THIS A CHANGE. A
        // fold applying nothing to a column that was already nullable would
        // satisfy the line below and prove nothing.
        expect(declaredNotNull(created.get(name)), `${table}.${name} at its CREATE`).toBe(true);
        expect(declaredNotNull(folded.get(name)), `${table}.${name} after the fold`).toBe(false);
        // AND ONLY THE NULLABILITY MOVED. The type is the other axis this entry
        // compares and `DROP NOT NULL` does not touch it.
        expect(ddlType(folded.get(name) ?? ''), `${table}.${name} type`).toBe(
          ddlType(created.get(name) ?? ''),
        );
      }
    }
  });

  // SESSION 214's NAMED GAP, CLOSED BY ADR-106 RATHER THAN BY A NEW MECHANISM.
  // ADR-103 shipped the fold's second member with NO registered table
  // exercising it: `otp_challenges` and `trading_calendar` were the only two
  // carriers in 47 migrations and neither was registered, so
  // `foldTable(...).relaxed` was empty on all 99 and the only thing running the
  // member was the pair of assertions that fold those two BY NAME. Registering
  // `otp_challenges` moves it onto the registered path, where the per-table
  // TYPE-and-NULLABILITY comparison reads the relaxed column against the
  // transcription. THE ASSERTION IS A COMMAND: at least one REGISTERED table
  // must replay a relaxation, and its transcription must agree.
  test('the fold second member now runs on a REGISTERED table, which it did not under ADR-103', () => {
    const relaxedTables = DDL_NAMES.filter(([, sqlName]) => foldTable(sqlName).relaxed.length > 0);
    expect(
      relaxedTables.length,
      'no registered table replays an ALTER COLUMN ... DROP NOT NULL, so the fold member ' +
        'is exercised only by the two tables the suite folds by name',
    ).toBeGreaterThan(0);
    for (const [key, sqlName] of relaxedTables) {
      const folded = foldTableDefs(sqlName);
      const created = ddlColumnDefs(allMigrationSql(), sqlName);
      for (const name of foldTable(sqlName).relaxed) {
        expect(declaredNotNull(created.get(name)), `${sqlName}.${name} at its CREATE`).toBe(true);
        expect(declaredNotNull(folded.get(name)), `${sqlName}.${name} after the fold`).toBe(false);
        // AND THE TRANSCRIPTION AGREES WITH THE FOLD AND NOT WITH THE CREATE,
        // which is the whole point of registering a drifted table: a reader who
        // transcribed this column from `0002` would have written `.notNull()`.
        const column = Object.values(columnsOf(key)).find((c) => c.name === name);
        expect(column, `${sqlName}.${name} is transcribed`).toBeDefined();
        expect(column?.notNull, `${sqlName}.${name} in schema.ts`).toBe(false);
      }
    }
  });

  // THE VOCABULARY IS CLOSED AND THIS IS WHAT KEEPS IT MEASURED RATHER THAN
  // BELIEVED. ADR-094 counted the `ALTER COLUMN` statements in this tree and
  // ruled against what it found; ADR-103 widened the fold on the same
  // measurement. The day a fourth one lands -- a `SET DATA TYPE`, a `SET NOT
  // NULL`, or a `DROP NOT NULL` on a third table -- this is RED and the next
  // session reads the ruling before writing a regex. It covers UNREGISTERED
  // tables too, which the refusal assertion above cannot.
  test('the migration set carries exactly the ALTER COLUMN statements this fold was ruled against', () => {
    const carriers = new Set<string>();
    let statements = 0;
    for (const file of migrationFiles()) {
      const sqlText = readFileSync(join(MIGRATIONS, file), 'utf8').replace(/--[^\n]*/g, '');
      for (const statement of sqlText.match(
        /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?[a-z_]+"?[\s\S]*?;/gi,
      ) ?? []) {
        if (!/\bALTER\s+COLUMN\b/i.test(statement)) continue;
        statements++;
        const named = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([a-z_]+)"?/i.exec(statement)?.[1];
        expect(named, `an ALTER COLUMN statement names no table: ${statement}`).toBeDefined();
        expect(
          droppedNotNulls(statement),
          `a shape ADR-103 does not fold: ${statement.replace(/\s+/g, ' ')}`,
        ).not.toBeNull();
        if (named !== undefined) carriers.add(named);
      }
    }
    expect([...carriers].sort()).toEqual(ALTER_COLUMN_TABLES.map(([t]) => t).sort());
    expect(statements, 'the ALTER COLUMN statement count this fold was ruled against').toBe(3);
  });

  // A READER THAT COLLAPSED ONTO ONE SPELLING WOULD PASS EVERY COMPARISON ABOVE
  // FOR EVERY COLUMN OF THAT TYPE AND FAIL HERE. The list is a command: each of
  // these must still come out of the reader somewhere in the registry.
  test('the type reader still spans every spelling the registered tables declare', () => {
    const produced = new Set(
      DDL_NAMES.flatMap(([, sqlName]) => [...foldTableDefs(sqlName).values()].map(ddlType)),
    );
    for (const spelling of TYPE_VOCABULARY) {
      expect([...produced], `no registered column reads as ${spelling}`).toContain(spelling);
    }
  });
});

// =============================================================================
// ADR-157: THE RANGE TERM, THE NULL TERM AND THE ROW LOCK
// =============================================================================
// ADR-112 refused a range and an `IS NULL` and named its own way out: "every one
// of them is a diff on this file with an argument attached when a caller needs
// it". P5 is that argument. `P5-j` sweeps three expiry clocks, `readLiveHalts`
// reads every released halt on every posting, and `GS-230` is a claim about two
// concurrent transactions that nothing in this tree could make one of lose.
//
// NOTHING HERE EXECUTES AGAINST A DATABASE and the suite says so, exactly as
// ADR-102's and ADR-112's do: `ci.yml`'s `integration` job runs on bare
// `ubuntu-latest` with no services block. Every statement assertion reads the
// SQL the accessor BUILDS, over a driverless Drizzle handle that records what it
// is asked to run. ADR-157 section 9 is the round trip EXECUTED against
// PostgreSQL 16, once, by hand, and it is evidence rather than a control.
//
// THE DIRECTION THIS BLOCK FAILS IN IS A FOLD THAT COVERS NOTHING, which is
// ADR-112 section 8's own warning about `handlePinnedColumns`: a guard with
// nothing to find looks exactly like a guard finding nothing wrong. So every
// fold below counts what it covered and asserts the count is non-zero, and the
// BOLA assertion is PAIRED with the case that legitimately succeeds, because a
// lock that refused everything would pass every refusal test in this file.

/** A driverless source that records the SQL and the parameters it is handed. */
function recordingSource(): {
  source: StatementSource;
  sent: { sql: string; params: unknown[] }[];
} {
  const sent: { sql: string; params: unknown[] }[] = [];
  const source = proxyDrizzle(async (sql: string, params: unknown[]) => {
    sent.push({ sql, params });
    return { rows: [] };
  }) as unknown as StatementSource;
  return { source, sent };
}

const stubConnection = (): PoolClient =>
  ({ query: async () => ({ rows: [] as unknown[] }) }) as unknown as PoolClient;

/** The one statement a call sent, or a failure naming how many it sent instead. */
async function statementOf(
  run: (source: StatementSource, conn: PoolClient) => Promise<unknown>,
): Promise<{ sql: string; params: unknown[] }> {
  const { source, sent } = recordingSource();
  await run(source, stubConnection());
  expect(sent, 'exactly one statement per call').toHaveLength(1);
  return sent[0] as { sql: string; params: unknown[] };
}

const OTHER_IDENTITY = 'i-2' as IdentityId;

/** The columns a SCOPED handle pins: the caller may not name them and they count. */
function pinnedColumnsFor(key: TableKey): readonly string[] {
  const rule = SCOPE_RULES[key];
  return rule.class === 'root' || rule.class === 'owned' ? [rule.column] : [];
}

function propertyNamed(key: TableKey, sqlName: string): string | undefined {
  const columns = getTableColumns(TABLES[key] as PgTable) as unknown as Record<string, PgColumn>;
  return Object.entries(columns).find(([, column]) => column.name === sqlName)?.[0];
}

function sampleFor(column: PgColumn): unknown {
  switch (column.dataType) {
    case 'date':
      return new Date(0);
    case 'number':
      return 1;
    case 'bigint':
      return 1n;
    case 'boolean':
      return true;
    case 'json':
      return {};
    case 'buffer':
      return Buffer.from('addr', 'utf8');
    default:
      return 'addr';
  }
}

/**
 * An address a SCOPED caller could write on this table, or `undefined`.
 *
 * A SECOND READING OF ADR-112's RULE AND NOT A CALL INTO IT: it walks the
 * unique keys `schema.ts` declares, drops the columns the handle pins, and
 * returns what is left. A coverage fold built on the accessor's own answer would
 * be the accessor agreeing with itself.
 */
function callerAddressFor(key: TableKey): Record<string, unknown> | undefined {
  const pinned = pinnedColumnsFor(key);
  const columns = getTableColumns(TABLES[key] as PgTable) as unknown as Record<string, PgColumn>;
  for (const candidate of uniqueKeys(key)) {
    const address: Record<string, unknown> = {};
    let resolved = true;
    for (const sqlName of candidate) {
      if (pinned.includes(sqlName)) continue;
      const property = propertyNamed(key, sqlName);
      if (property === undefined) {
        resolved = false;
        break;
      }
      address[property] = sampleFor(columns[property] as PgColumn);
    }
    if (resolved && Object.keys(address).length > 0) return address;
  }
  return undefined;
}

/** The first nullable column a caller may name on this table, for the null term. */
function nullableColumnOf(key: TableKey): string | undefined {
  const pinned = pinnedColumnsFor(key);
  const columns = getTableColumns(TABLES[key] as PgTable) as unknown as Record<string, PgColumn>;
  for (const [property, column] of Object.entries(columns)) {
    if (pinned.includes(column.name)) continue;
    if (!column.notNull) return property;
  }
  return undefined;
}

const SCOPED = TABLE_KEYS.filter(
  (key): key is ScopedTableKey =>
    SCOPE_RULES[key].class !== 'firm' && SCOPE_RULES[key].class !== 'pair',
);

describe('a term narrows a read and is refused everywhere that writes', () => {
  test('the vocabulary is CLOSED at three shapes, read from the source rather than restated', () => {
    // ADR-102's instrument, pointed at this file's own new vocabulary. Widening
    // `FilterTerm` is a diff that turns this red, which is what makes "one line
    // with an argument attached" a control rather than a hope.
    const source = readFileSync(
      fileURLToPath(new URL('../src/scoped-db.ts', import.meta.url)),
      'utf8',
    );
    const declared = /export type FilterTerm =([\s\S]*?);\n/.exec(source)?.[1] ?? '';
    const shapes = [...declared.matchAll(/term: '([a-z-]+)'/g)].map((m) => m[1] as string);
    expect(shapes.sort()).toEqual(['at-least', 'at-most', 'is-null']);
  });

  test('a term is recognised by IDENTITY, so an object that merely looks like one is a VALUE', () => {
    // THE ASSERTION THAT KEEPS `TERMS` LOAD BEARING. A `jsonb` column can hold
    // `{ term: 'at-most', value: 1 }`, and a shape check would read it as a
    // range and silently return a different set of rows.
    expect(isFilterTerm(atMost(1))).toBe(true);
    expect(isFilterTerm(atLeast(1))).toBe(true);
    expect(isFilterTerm(isNull())).toBe(true);
    expect(isFilterTerm({ term: 'at-most', value: 1 })).toBe(false);
    expect(isFilterTerm({ term: 'is-null' })).toBe(false);
    expect(isFilterTerm(JSON.parse(JSON.stringify(atMost(1))))).toBe(false);
    expect(isFilterTerm(null)).toBe(false);
    expect(isFilterTerm('at-most')).toBe(false);
  });

  test('a null bound is refused by the constructor rather than rendered as a no-op', () => {
    expect(() => atMost(null as never)).toThrow(/is not a bound/);
    expect(() => atLeast(undefined as never)).toThrow(/is not a bound/);
  });

  test('a term is frozen, so a caller cannot mutate one after the accessor has read it', () => {
    const term = atMost(1) as { value?: unknown };
    expect(Object.isFrozen(term)).toBe(true);
  });

  test('the three terms render <=, >= and IS NULL, and bind the caller`s bound', async () => {
    const range = await statementOf((source, conn) =>
      scopedTx(source, conn, IDENTITY).rowsWhere('ledgerHalts', {
        escalateAt: atMost(new Date(0)),
      }),
    );
    expect(range.sql).toMatch(/"escalate_at"\s*<=\s*\$2/);
    // THE BOUND GOES THROUGH THE COLUMN'S OWN MAPPER, which is what `eq` has
    // always done and is why a term is built with `lte` rather than with an
    // `sql` template: a `Date` handed to a `timestamptz` arrives as the string
    // Postgres parses, and a bound assembled by hand would not.
    expect(range.params).toEqual(['i-1', new Date(0).toISOString()]);

    const above = await statementOf((source, conn) =>
      scopedTx(source, conn, IDENTITY).rowsWhere('ledgerHalts', {
        escalateAt: atLeast(new Date(0)),
      }),
    );
    expect(above.sql).toMatch(/"escalate_at"\s*>=\s*\$2/);

    const absent = await statementOf((source, conn) =>
      scopedTx(source, conn, IDENTITY).rowsWhere('ledgerHalts', { releasedAt: isNull() }),
    );
    expect(absent.sql).toMatch(/"released_at"\s+is\s+null/i);
    // A NULL TERM BINDS NOTHING, which is the whole reason it is a term and not
    // an equality: `col = NULL` would bind a parameter and match no row.
    expect(absent.params).toEqual(['i-1']);
  });

  test('EVERY scoped table ANDs the tenancy narrowing with a term, and binds the HANDLE`s identity first', async () => {
    let covered = 0;
    for (const key of SCOPED) {
      const property = nullableColumnOf(key);
      if (property === undefined) continue;
      covered += 1;
      const { sql: text, params } = await statementOf((source, conn) =>
        scopedTx(source, conn, IDENTITY).rowsWhere(key, { [property]: isNull() }),
      );
      const rule = SCOPE_RULES[key];
      if (rule.class === 'root' || rule.class === 'owned') {
        expect(text, key).toContain(`"${rule.column}" = $1`);
      } else {
        expect(text, key).toMatch(/exists/i);
      }
      expect(text, key).toMatch(/is\s+null/i);
      // THE TENANCY VALUE IS THE HANDLE'S AND IT IS FIRST. A term is appended to
      // a predicate that already names this identity, never substituted for one.
      expect(params[0], key).toBe('i-1');
    }
    // THE FOLD COVERED SOMETHING. A `nullableColumnOf` that stopped resolving
    // would leave every assertion above unrun and this block green.
    expect(covered).toBeGreaterThan(20);
  });

  test('a term in an ADDRESS is refused at every authority, on the read and on both writes', async () => {
    const { source } = recordingSource();
    const conn = stubConnection();
    const scoped = scopedTx(source, conn, IDENTITY);
    const system = systemTx(source, conn, 'nightly-batch');
    const firm = firmTx(source, conn);

    await expect(scoped.rowAt('ledgerHalts', { id: atMost('h') } as never)).rejects.toThrow(
      /term in an ADDRESS/,
    );
    await expect(scoped.lockAt('ledgerHalts', { id: isNull() } as never)).rejects.toThrow(
      /term in an ADDRESS/,
    );
    await expect(
      scoped.updateAt('ledgerHalts', { id: atLeast('h') } as never, { reasonNote: 'x' }),
    ).rejects.toThrow(/term in an ADDRESS/);
    await expect(scoped.deleteAt('ledgerHalts', { id: atMost('h') } as never)).rejects.toThrow(
      /term in an ADDRESS/,
    );
    await expect(system.rowAt('ledgerHalts', { id: atMost('h') } as never)).rejects.toThrow(
      /term in an ADDRESS/,
    );
    await expect(system.updateAt('ledgerHalts', { id: atMost('h') } as never, {})).rejects.toThrow(
      /term in an ADDRESS/,
    );
    await expect(firm.rowAt('coupons', { id: atMost('c') } as never)).rejects.toThrow(
      /term in an ADDRESS/,
    );
  });

  test('a term in a VALUES object is refused, which is the hazard this entry CREATES', async () => {
    // Before ADR-157 no caller held an object a filter treated specially. Now
    // one does, and `{ releasedAt: isNull() }` in a SET is somebody meaning
    // "clear this column" and writing a row of JSON into a timestamptz.
    const { source } = recordingSource();
    const conn = stubConnection();
    await expect(
      scopedTx(source, conn, IDENTITY).updateAt(
        'ledgerHalts',
        { id: 'h' },
        { releasedAt: isNull() },
      ),
    ).rejects.toThrow(/term in a write/);
    await expect(
      scopedTx(source, conn, IDENTITY).insert('ledgerHalts', { reasonNote: atMost('x') }),
    ).rejects.toThrow(/term in a write/);
    await expect(
      systemTx(source, conn, 'nightly-batch').insert('ledgerHalts', { reasonNote: isNull() }),
    ).rejects.toThrow(/term in a write/);
  });
});

describe('a row lock reaches exactly what the matching read reaches, and no further', () => {
  test('THE BOLA PAIR: a scoped lock carries the HANDLE`s identity and the CALLER`s address', async () => {
    // THE ONE THAT MATTERS, and it is a PAIR because a lock that refused
    // everything would pass the refusal half on its own.
    //
    // The refusal is not visible in the SQL, because the SQL is the same
    // statement either way: what changes is the parameter the accessor binds
    // into the tenancy conjunct, and it is ALWAYS the handle's. So a caller
    // scoped to `i-1` naming a row of `i-2`'s sends `identity_id = 'i-1' AND id
    // = <i-2's row>`, which matches nothing and therefore locks nothing.
    // ADR-157 section 9 row 8 is that statement executed against PostgreSQL 16,
    // where it returned zero rows rather than an error or the other row.
    const mine = await statementOf((source, conn) =>
      scopedTx(source, conn, IDENTITY).lockAt('ledgerHalts', { id: 'halt-of-i-1' }),
    );
    const theirs = await statementOf((source, conn) =>
      scopedTx(source, conn, IDENTITY).lockAt('ledgerHalts', { id: 'halt-of-i-2' }),
    );

    expect(mine.sql).toBe(theirs.sql);
    expect(mine.params).toEqual(['i-1', 'halt-of-i-1']);
    expect(theirs.params).toEqual(['i-1', 'halt-of-i-2']);
    expect(theirs.params).not.toContain(OTHER_IDENTITY);
    expect(mine.sql).toContain('"identity_id" = $1');
    expect(mine.sql).toContain('"id" = $2');
    expect(mine.sql).toMatch(/for update\s*$/i);
  });

  test('a lock composes the SAME predicate the matching read composes, on EVERY scoped table', async () => {
    let covered = 0;
    for (const key of SCOPED) {
      const address = callerAddressFor(key);
      if (address === undefined) continue;
      covered += 1;
      const read = await statementOf((source, conn) =>
        scopedTx(source, conn, IDENTITY).rowAt(key, address),
      );
      const lock = await statementOf((source, conn) =>
        scopedTx(source, conn, IDENTITY).lockAt(key, address),
      );
      // The lock is the read plus `for update` and nothing else. A lock whose
      // predicate drifted from the read's would be a lock on a row somebody
      // else's read returns, which is the failure with no visible symptom.
      expect(lock.sql, key).toBe(`${read.sql} for update`);
      expect(lock.params, key).toEqual(read.params);
      expect(lock.params[0], key).toBe('i-1');
    }
    expect(covered).toBeGreaterThan(20);
  });

  test('lockScope takes NO argument and names the registry`s only root table', async () => {
    const locked = await statementOf((source, conn) =>
      scopedTx(source, conn, IDENTITY).lockScope(),
    );
    expect(locked.sql).toContain('from "identities"');
    expect(locked.sql).toContain('"identities"."id" = $1');
    expect(locked.sql).toMatch(/for update\s*$/i);
    // ONE PARAMETER, AND IT IS THE HANDLE'S. There is no caller half at all, so
    // there is no address to point at another identity.
    expect(locked.params).toEqual(['i-1']);
    expect(scopedTx({} as StatementSource, stubConnection(), IDENTITY).lockScope).toHaveLength(0);
    expect(SCOPE_RULES.identities.class).toBe('root');
  });

  test('the unscoped lock carries the address ALONE, which is what that door is for', async () => {
    const locked = await statementOf((source, conn) =>
      systemTx(source, conn, 'nightly-batch').lockAt('ledgerHalts', { id: 'halt-of-i-2' }),
    );
    expect(locked.params).toEqual(['halt-of-i-2']);
    expect(locked.sql).not.toContain('"identity_id" = $');
    expect(locked.sql).toMatch(/for update\s*$/i);
  });

  test('a lock still has to NAME A ROW, so the unaddressed lock is refused at both authorities', async () => {
    const { source } = recordingSource();
    const conn = stubConnection();
    await expect(
      scopedTx(source, conn, IDENTITY).lockAt('ledgerHalts', { reasonCode: 'manual' }),
    ).rejects.toThrow(/must name a row/);
    await expect(
      systemTx(source, conn, 'nightly-batch').lockAt('ledgerHalts', { reasonCode: 'manual' }),
    ).rejects.toThrow(/must name a row/);
  });

  test('there is no lock on a read handle and none on the firm door', () => {
    // A row lock is released at COMMIT, so a lock taken outside a transaction is
    // released before the next statement runs. `FirmTx` is excluded for a
    // different reason: a firm row belongs to nobody and no invariant in the
    // corpus names a lock on one.
    const source = {} as StatementSource;
    const conn = stubConnection();
    for (const handle of [scopedDb(IDENTITY), systemDb('nightly-batch'), firmDb()]) {
      for (const verb of ['lockAt', 'lockScope']) {
        expect(handle, `${handle.__brand} carries ${verb}`).not.toHaveProperty(verb);
      }
    }
    expect(firmTx(source, conn)).not.toHaveProperty('lockAt');
    expect(systemTx(source, conn, 'nightly-batch')).not.toHaveProperty('lockScope');
  });
});

describe('what ADR-157 REFUSED to widen, watched rather than only written down', () => {
  const accessorSource = (): string =>
    readFileSync(fileURLToPath(new URL('../src/scoped-db.ts', import.meta.url)), 'utf8');

  test('`SqlExecutorReason` is still exactly one member, so the raw-SQL door did not move', () => {
    // P5 section 11 rule 10 and P7 section 11 rule 10 both foreclose adding a
    // member here, and both say the reach-around is one line. This is that rule
    // made mechanical rather than remembered.
    const declared = /export type SqlExecutorReason =([^;]+);/.exec(accessorSource())?.[1] ?? '';
    const members = [...declared.matchAll(/'([a-z-]+)'/g)].map((m) => m[1] as string);
    expect(members).toEqual(['job-enqueue']);
  });

  test('`SystemReason` is still exactly two members, so a request handler is still neither', () => {
    const declared = /export type SystemReason =([^;]+);/.exec(accessorSource())?.[1] ?? '';
    const members = [...declared.matchAll(/'([a-z-]+)'/g)].map((m) => m[1] as string);
    expect(members.sort()).toEqual(['nightly-batch', 'operator-console']);
  });

  test('THE AGGREGATE P7 ASKED FOR IS NOT HERE, and no handle carries a join either', () => {
    // P7 section 10 item 1 asked this slice for an aggregate and said every
    // wave-2 slice is blocked without it. ADR-157 section 5 REFUSES it, on the
    // evidence that P7's own section 3.1 names a JOIN as the blocker and that a
    // scalar aggregate would not have served one detector. This assertion is
    // that refusal, so a later session that adds one does so by editing a test
    // that says why it is not there.
    const source = accessorSource();
    const conn = stubConnection();
    for (const verb of ['countWhere', 'sumWhere', 'aggregate', 'joinOn']) {
      expect(scopedTx({} as StatementSource, conn, IDENTITY), verb).not.toHaveProperty(verb);
      expect(systemTx({} as StatementSource, conn, 'nightly-batch'), verb).not.toHaveProperty(verb);
    }
    // And no SQL aggregate is rendered anywhere in the accessor.
    expect(source).not.toMatch(/\bcount\(\*\)/i);
    expect(source).not.toMatch(/\bsql`\s*sum\(/i);
  });
});

// =============================================================================
// P5-b. A SCOPE RULE IS A CLAIM ABOUT TENANCY AND THIS IS WHAT MAKES IT ONE.
// =============================================================================
// EVERY ASSERTION ABOVE THIS LINE ASKS WHETHER A RULE RESOLVES, WHETHER IT
// MATCHES THE DDL, AND WHETHER ITS CLASS IS ADMISSIBLE. None of them asks the
// question a BOLA failure is: can a handle scoped to one person reach a row
// belonging to another? The generic folds above cover it across every scoped
// table at once, and the two tables below are named because P5-b's whole
// subject is their tenancy and a fold nobody can point at is a fold nobody
// reads when the answer changes.
//
// THE REFUSAL IS NOT VISIBLE IN THE SQL AND THAT IS THE POINT, which is
// ADR-157's own framing at the lock. The statement is the SAME statement either
// way; what changes is the parameter the accessor binds into the tenancy
// conjunct, and it is ALWAYS the handle's. So a caller scoped to `i-1` naming a
// row of `i-2`'s sends a predicate that matches nothing, rather than one that
// errors -- and an assertion that only watched it throw would pass against an
// accessor that returned the row.
describe('P5-b: a handle for one identity cannot reach another identity`s row', () => {
  test('payment_disputes: the tenancy conjunct is the EXISTS through purchases, and its parameter is the handle`s', async () => {
    // THE BOLA PAIR. Two reads, one naming a dispute of this identity's and one
    // naming a dispute of somebody else's, and the caller's half is the ONLY
    // thing that differs.
    const mine = await statementOf((source, conn) =>
      scopedTx(source, conn, IDENTITY).rowAt('paymentDisputes', { id: 'dispute-of-i-1' }),
    );
    const theirs = await statementOf((source, conn) =>
      scopedTx(source, conn, IDENTITY).rowAt('paymentDisputes', { id: 'dispute-of-i-2' }),
    );

    expect(mine.sql).toBe(theirs.sql);
    // THE HANDLE'S IDENTITY IS BOUND AND THE OTHER ONE IS NOWHERE. A caller
    // cannot put `i-2` into the tenancy position, because the tenancy position
    // is not a thing a caller writes.
    expect(theirs.params).toContain('i-1');
    expect(theirs.params).not.toContain(OTHER_IDENTITY);

    // AND THE NARROWING IS THE ONE THE RULE CLAIMS, read off the SQL rather
    // than trusted: an EXISTS into `purchases`, comparing `identity_id` there.
    // A rule that had drifted to `ledger_transaction_id` -- the trap this
    // table's `why` names -- would reach `ledger_transactions` instead, and
    // this assertion is what says which one is rendered.
    expect(mine.sql).toMatch(/exists/i);
    expect(mine.sql).toContain('"purchases"');
    expect(mine.sql).toContain('"identity_id"');
    expect(mine.sql).toContain('"purchase_id"');
    expect(mine.sql).not.toContain('"ledger_transactions"');
    // A HOP, NOT A JOIN. A join would return the dispute once per matching
    // parent, and `traversal: 'hop'` is what claims it cannot.
    expect(mine.sql).not.toMatch(/\bjoin\b/i);
  });

  test('payment_disputes: the derivation terminates at an OWNED rule one hop out, and never at the row itself', () => {
    const rule = SCOPE_RULES.paymentDisputes;
    expect(rule.class).toBe('derived');
    if (rule.class !== 'derived') throw new Error('unreachable');
    expect(rule.via).toBe('purchases');
    expect(rule.traversal).toBe('hop');
    // THE TERMINUS IS ASSERTED RATHER THAN ASSUMED. `purchases` being `owned`
    // and NOT NULL is the whole reason this rule returns a person all of their
    // disputes rather than a subset of them.
    //
    // AND THIS NARROWING IS A COMPILE-TIME CONTROL AS WELL AS A RUNTIME ONE,
    // which was found by seeding it rather than predicted. `SCOPE_RULES` is
    // `as const`, so `SCOPE_RULES[rule.via]` has a literal type: re-pointing
    // `via` at `ledgerTransactions` -- the trap this table's `why` names --
    // makes the two lines below `TS2367` and `TS2339` at typecheck, before
    // ADR-101 clause 2 gets to refuse the nullable edge at runtime.
    const via = SCOPE_RULES[rule.via];
    expect(via.class).toBe('owned');
    if (via.class !== 'owned') throw new Error('unreachable');
    expect(via.nullable).toBe(false);
    // AND THE ROW ITSELF REACHES NOBODY DIRECTLY, which is ADR-101 clause 1
    // holding for this table specifically rather than across the fold.
    expect(identityColumnsOf('payment_disputes')).toEqual([]);
  });

  test('wallet_spend_limits: INV-M20-07`s storage is narrowed by `identity_id` and by nothing a caller supplies', async () => {
    // THE REGISTRATION IS SESSION 202'S AND IS NOT RE-ARGUED (ADR-092 section 2
    // clause 1). What P5-b adds is the tenancy assertion, because the velocity
    // limit is read on the checkout path in `P5-i` and a limit read for the
    // wrong person is a spend cap applied to the wrong wallet.
    //
    // THE GRAIN IS `(identity_id, effective_from)` AND `identity_id` IS PINNED,
    // so the only half of the key a caller may name is the timestamp -- and a
    // caller naming somebody else's timestamp still gets their own row set.
    const mine = await statementOf((source, conn) =>
      scopedTx(source, conn, IDENTITY).rowAt('walletSpendLimits', {
        effectiveFrom: new Date(0),
      }),
    );
    const theirs = await statementOf((source, conn) =>
      scopedTx(source, conn, IDENTITY).rowAt('walletSpendLimits', {
        effectiveFrom: new Date(86_400_000),
      }),
    );

    expect(mine.sql).toBe(theirs.sql);
    expect(mine.sql).toContain('"identity_id" = $1');
    expect(mine.params[0]).toBe('i-1');
    expect(theirs.params[0]).toBe('i-1');
    expect(theirs.params).not.toContain(OTHER_IDENTITY);
    // NOT NARROWED BY `set_by`, AND THE PREDICATE IS WHERE THAT IS TRUE. The
    // first draft of this assertion read the WHOLE statement and failed,
    // because `set_by` is in the SELECT list like every other column; the claim
    // is about what NARROWS the read, so it is made against the WHERE clause
    // alone. `set_by` is an operator name in 0002's `actor` idiom and not a
    // `users` row, so it reaches no identity and must not appear here.
    const where = mine.sql.slice(mine.sql.indexOf(' where '));
    expect(where).not.toContain('"set_by"');
    expect(where).not.toContain('"reason"');
    // And the predicate is exactly the two conjuncts: the handle's tenancy and
    // the caller's address. Nothing else narrows it.
    expect(where).toContain('"identity_id" = $1');
    expect(where).toContain('"effective_from" = $2');
    expect(mine.params).toHaveLength(2);
  });

  test('wallet_spend_limits: a caller may not name the tenancy column, so there is no way to ask for another identity`s limit', async () => {
    // THE REFUSAL THAT MATTERS IS AT THE ADDRESS. `identity_id` is pinned by the
    // handle, so a caller that writes it is not narrowing a read, it is trying
    // to re-parent one -- and ADR-112 clause 4 refuses that at both authorities.
    const { source } = recordingSource();
    const conn = stubConnection();
    await expect(
      scopedTx(source, conn, IDENTITY).rowAt('walletSpendLimits', {
        identityId: OTHER_IDENTITY,
        effectiveFrom: new Date(0),
      } as never),
    ).rejects.toThrow();
  });

  test('both tables are members of ScopedTableKey, which is what having a rule at all buys them', () => {
    // A table with no rule is not reachable through EITHER accessor, so this is
    // the assertion that says the registration did the thing it was for.
    expect(SCOPED).toContain('paymentDisputes');
    expect(SCOPED).toContain('walletSpendLimits');
  });
});
