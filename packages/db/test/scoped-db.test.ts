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
import { describe, expect, test } from 'vitest';

import {
  SCOPE_RULES,
  TABLES,
  TABLE_KEYS,
  scopePredicate,
  scopedDb,
  systemDb,
  type IdentityId,
  type TableKey,
} from '../src/index.ts';

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
  // rounded up: the other 12 are unreachable through either accessor.
  //
  // `identity_links` IS ONE OF THE 12 AND ITS ABSENCE IS DELIBERATE. It carries
  // TWO identity columns against an `owned` rule that names one, ADR-092 section
  // 9 names it as a per-table ruling and takes neither, and a transcription
  // rules nothing. Unregistered is unreachable and unreachable is safe; a chosen
  // column would be a scoped read returning a strict subset of a person's own
  // edges, selected by UUID ordering, with no error anywhere.
  // `events` IS ANOTHER OF THE 12 AND ITS ABSENCE IS ALSO DELIBERATE. It reaches
  // an identity TWO ways -- `identity_id uuid NULL` and `account_id uuid NULL`,
  // neither required and no CHECK tying them -- so an `owned` rule on the first
  // drops every account-level row and a `derived` hop through the second drops
  // every identity-level row, while the portal's timeline (EVENTS.md section 2,
  // consumer TL) reads both. Its `jsonb` payload is the second reason and it is
  // the one no scope rule reaches: `kyc.dedupe_hit` carries
  // `matched_identity_id`, so a row whose own tenancy column is right still
  // names a DIFFERENT identity inside the payload.
  //
  // `ledger_halts` WAS A FOURTH AND IT IS NO LONGER ONE. ADR-092 section 9 named
  // four tables "no session would reach" and this is the first of them to be
  // registered: `identity_id uuid NOT NULL REFERENCES identities(id)` at
  // 0016:55, so its class was never in doubt and what it lacked was a session
  // whose fence contained it. ADR-104 is that session, and the table is now
  // reachable through a scoped read for the first time.
  //
  // `attributions` IS THE SIBLING ADR-092 SECTION 9 NAMES BESIDE IT AND IT IS
  // ABSENT FOR THE SAME REASON. `buyer_identity_id` and `affiliate_identity_id`
  // are both `uuid NOT NULL REFERENCES identities(id)` and they are TWO
  // DIFFERENT PEOPLE by construction -- `attributions_literal_self_deal_is_void`
  // exists to refuse the row where they are one -- so an `owned` rule naming
  // either returns a row to a person the other column names. Naming the
  // affiliate hands a buyer's purchase attribution to their referrer, which
  // returns rows, raises nothing, and is ADR-008's BOLA failure.
  //
  // `affiliate_commissions` FOLLOWS IT OUT, and that is the registry's totality
  // rather than a second judgment: its only path to an identity is
  // `attribution_id`, `DerivedRule.via` is `TableKey`, and an unregistered
  // table has no key to name.
  test('100 declared tables, 100 scope rules, 0 reachable without one', () => {
    const declared = TABLE_KEYS.length;
    const rules = Object.keys(SCOPE_RULES).length;
    const withoutRule = TABLE_KEYS.filter((k) => !(k in SCOPE_RULES));

    expect(declared).toBe(100);
    expect(rules).toBe(100);
    expect(withoutRule).toEqual([]);

    const createdTables = (allMigrationSql().match(/^CREATE TABLE /gim) ?? []).length;
    expect(createdTables).toBe(111);
  });

  test('every class in the vocabulary has at least one member, so none is vacuous', () => {
    const classes = new Set(TABLE_KEYS.map((k) => SCOPE_RULES[k].class));
    expect([...classes].sort()).toEqual(['derived', 'firm', 'owned', 'root']);
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
  // IS WHERE IT DOES NOT.
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
          `${key} derives through ${seen.join(' -> ')}, and ${at} is firm, so a scoped ` +
            'read of it constructs no predicate and throws',
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
  // NEITHER TABLE BELOW IS REGISTERED, AND THAT IS EXACTLY WHY THESE ASSERTIONS
  // EXIST. `otp_challenges` and `trading_calendar` are the only two tables in 47
  // migrations carrying an `ALTER COLUMN`, so nothing in `DDL_NAMES` exercises
  // the fold's new member and `foldTable(...).relaxed` is EMPTY on all 99. A
  // vocabulary member no assertion runs is a vocabulary member nobody has
  // checked, which is ADR-094's own seed-B argument about a fold that folds
  // nothing. These fold the two tables BY NAME, register neither, and watch the
  // relaxation happen. Session 215 registers `otp_challenges` under this fold
  // and inherits a member already watched working on its own table.

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
