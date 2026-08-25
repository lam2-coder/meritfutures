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
} from '../src/index.js';

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
  geoRestrictions: 'geo_restrictions',
  tosVersions: 'tos_versions',
  tosAcceptances: 'tos_acceptances',
  certificateVerifications: 'certificate_verifications',
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
  // rounded up: the other 20 are unreachable through either accessor.
  //
  // `identity_links` IS ONE OF THE 20 AND ITS ABSENCE IS DELIBERATE. It carries
  // TWO identity columns against an `owned` rule that names one, ADR-092 section
  // 9 names it as a per-table ruling and takes neither, and a transcription
  // rules nothing. Unregistered is unreachable and unreachable is safe; a chosen
  // column would be a scoped read returning a strict subset of a person's own
  // edges, selected by UUID ordering, with no error anywhere.
  // `events` IS ANOTHER OF THE 20 AND ITS ABSENCE IS ALSO DELIBERATE. It reaches
  // an identity TWO ways -- `identity_id uuid NULL` and `account_id uuid NULL`,
  // neither required and no CHECK tying them -- so an `owned` rule on the first
  // drops every account-level row and a `derived` hop through the second drops
  // every identity-level row, while the portal's timeline (EVENTS.md section 2,
  // consumer TL) reads both. Its `jsonb` payload is the second reason and it is
  // the one no scope rule reaches: `kyc.dedupe_hit` carries
  // `matched_identity_id`, so a row whose own tenancy column is right still
  // names a DIFFERENT identity inside the payload.
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
  test('91 declared tables, 91 scope rules, 0 reachable without one', () => {
    const declared = TABLE_KEYS.length;
    const rules = Object.keys(SCOPE_RULES).length;
    const withoutRule = TABLE_KEYS.filter((k) => !(k in SCOPE_RULES));

    expect(declared).toBe(91);
    expect(rules).toBe(91);
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
 * ADR-094'S FOLD. The result of replaying one table's migration history.
 *
 * `columns`  the column-name set AS OF THE LAST MIGRATION.
 * `added`    the names the replay applied, in migration order. Empty for an
 *            undrifted table, and NON-EMPTY SOMEWHERE is asserted below --
 *            a fold that quietly did nothing would leave every per-table
 *            comparison green for any table whose transcription was ALSO
 *            missing the later columns, which is ADR-084 section 7's failure.
 * `refused`  statements outside the fold's one-member vocabulary. Any of these
 *            turns the suite red, exactly as all four shapes do today.
 */
interface ColumnFold {
  readonly columns: readonly string[];
  readonly added: readonly string[];
  readonly refused: readonly string[];
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
 * ONE TABLE, REPLAYED. ADR-094.
 *
 * A transcription reads a table AS OF THE LAST MIGRATION and never as of its
 * `CREATE TABLE`. This walks the migration set in order, starts from the
 * `CREATE TABLE` column set, and folds every later `ADD COLUMN` onto it.
 *
 * THE VOCABULARY IS CLOSED AT ONE MEMBER AND THE DEFAULT IS FAIL. `DROP
 * COLUMN`, `ALTER COLUMN` and `RENAME` are REFUSED and never skipped, so the
 * refusal `schema.ts`'s header describes is narrowed rather than deleted: a
 * table whose history contains one of them still cannot be registered.
 *
 * `ALTER COLUMN` is refused even though it CANNOT change a column-name set, and
 * ADR-094 section 3 is why: the axis it does move -- type and nullability -- is
 * one this suite has never compared, on any registered table, so exempting it
 * would register a table verified on every axis except the one that changed.
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
  const refused: string[] = [];

  for (const file of files.slice(createdIn)) {
    for (const statement of alterStatementsFor(read(file), table)) {
      // A statement that touches no column at all -- ADD CONSTRAINT is the only
      // shape in this tree -- changes nothing the transcription states.
      if (!/\b(ADD|DROP|ALTER)\s+COLUMN\b|\bRENAME\b/i.test(statement)) continue;

      // THE DEFAULT IS FAIL. Everything but `ADD COLUMN` is refused, including a
      // statement that mixes one in.
      if (/\b(DROP|ALTER)\s+COLUMN\b|\bRENAME\b/i.test(statement)) {
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

  return { columns: [...columns].sort(), added, refused };
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

  // THE REFUSAL, NARROWED RATHER THAN DELETED. It used to read "no later
  // migration changes a column on any of the seven" and it was what made the
  // `CREATE TABLE` body a sound proxy for the table. The proxy is gone -- the
  // fold reads the whole history -- and what remains is the part that is still
  // true: a shape the fold does not read is a shape nothing here verifies.
  test('no later migration changes a column in a shape ADR-094 does not fold', () => {
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
      if (!/\bADD\s+COLUMN\b/i.test(statement)) continue;
      // REFUSED SHAPES ARE SKIPPED HERE AND REFUSED THERE. `foldTable` records
      // every `DROP COLUMN`, `ALTER COLUMN` and `RENAME` into `refused`, and
      // the assertion above holds that list empty over every registered table,
      // so skipping them here absorbs nothing that is not already red.
      if (/\b(DROP|ALTER)\s+COLUMN\b|\bRENAME\b/i.test(statement)) continue;

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
