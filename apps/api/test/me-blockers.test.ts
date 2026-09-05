import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { databaseAuthBackend } from '../src/auth-backend.ts';
import { AuthBackendUnwired } from '../src/routes/auth.ts';
import type { AuthSession } from '../src/routes/auth.ts';
import { UNWIRED_KYC_BACKEND, currentKycDeps } from '../src/routes/kyc.ts';
import { recordingDb } from './db-recorder.ts';

// CI-02, the `unit` project.
//
// =============================================================================
// WHAT REFUSES `GET /me`, PINNED AT ITS OWN PRIMARY SOURCE. ADR-341
// =============================================================================
// THE ENTRY THIS FILE EXISTS TO STOP FROM DRIFTING SAID ONE THING TOO FEW.
// `auth-backend.ts`'s `readMe` blocker has been narrowed twice, by ADR-252 and
// then by ADR-265, and after the second narrowing its closing sentence read
// "every other field of `Me` is reachable through the scoped door, which is what
// makes this one worth reporting rather than working around". That sentence is
// TRUE about the door and it was READ as saying the cap was the last thing
// between the method and a response. It is not. REACHABLE IS NOT RESOLVABLE:
// two more fields have a reachable row and no reader, and a session dispatched
// to write the cap row would have landed it and found the endpoint still
// refusing, which is `checkout-backend-blockers.test.ts`'s own founding story
// one port over.
//
// SO THE THREE ABSENCES ARE ASSERTED HERE RATHER THAN DESCRIBED THERE, each
// read at the file it is a fact about:
//
//   1. `Me.max_accounts` HAS A SOURCE, A READER AND NO ROW, and the row is not
//      landable by this repository even with a ruled number (ADR-284's write
//      control). ADR-238 ruling 1, ADR-252, ADR-265, ADR-284.
//   2. `Me.kyc.placement` IS NON-NULLABLE AND HAS NO READER on an identity with
//      no verification. The settled fill needs a `KycBackend` this deployable
//      does not have.
//   3. `Me.accounts_count` HAS ONE READER AND NO PRODUCER, and no ruling says
//      which of `account_status`'s seven members are live.
//
// EVERY CASE NAMES THE CLAUSE IT PINS, so a reader who turns one red learns
// which absence they closed rather than which string they broke. The day all
// three go, this file is what says so.
//
// -----------------------------------------------------------------------------
// WHY IT READS SOURCE AS TEXT AND WHERE IT DOES NOT
// -----------------------------------------------------------------------------
// Three of these facts are about SOURCE TEXT: which factories a deployable
// declares, which rows a migration set writes, and what a corpus document
// states. There is no value to import for any of them, and `wiring.test.ts`'s
// header already settles the idiom: reading the file is the observation that is
// available. WHERE A VALUE EXISTS THIS FILE USES IT INSTEAD, which is why the
// port refusal and the KYC backend's identity are EXECUTED rather than grepped.
//
// WHAT THIS FILE DELIBERATELY DOES NOT RESTATE. That an absent `firm_parameters`
// row makes the cap door THROW, and that one row is all it takes to make the
// door answer, is `packages/db/test/account-cap-door.test.ts`'s, watched under
// its own seeded defects. A second copy here would be the second statement of
// one fact that ADR-092 section 5 names as the money-path hazard. THE ONE CASE
// BELOW THAT REACHES ACROSS reads that file for the PAIR rather than re-running
// it, so deleting the pair turns this finding red too.
// -----------------------------------------------------------------------------

const HERE = import.meta.dirname;
const ROOT = join(HERE, '..', '..', '..');

const read = (...parts: readonly string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

const AUTH_BACKEND = read('apps', 'api', 'src', 'auth-backend.ts');
const ME_ROUTE = read('apps', 'api', 'src', 'routes', 'me.ts');
const KYC_ROUTE = read('apps', 'api', 'src', 'routes', 'kyc.ts');
const CHECKOUT = read('apps', 'api', 'src', 'routes', 'checkout.ts');
const ENUMS = read('packages', 'db', 'migrations', '0001_extensions_and_enums.sql');
const WRITE_CONTROL = read('packages', 'db', 'migrations', '0076_firm_parameter_write_control.sql');
const CAP_DOOR_SUITE = read('packages', 'db', 'test', 'account-cap-door.test.ts');
const CONSTITUTION = read('MERIT_BUILD_MASTER_PROMPT.md');
const M01 = read('docs', 'plans', 'M01-rules-engine.md');
const API_CONTRACT = read('docs', 'architecture', 'API_CONTRACT.md');

const MIGRATIONS = join(ROOT, 'packages', 'db', 'migrations');

/** Every `.sql` body in the migration set, keyed by file name. */
function migrationBodies(): ReadonlyMap<string, string> {
  const bodies = new Map<string, string>();
  for (const name of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')))
    bodies.set(name, readFileSync(join(MIGRATIONS, name), 'utf8'));
  return bodies;
}

/** Every shipped `.ts` under one deployable's `src`, recursively. */
function shippedSources(...parts: readonly string[]): readonly string[] {
  const base = join(ROOT, ...parts);
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith('.ts')) out.push(abs);
    }
  };
  walk(base);
  return out;
}

const ALICE = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-09-05T12:00:00.000Z');
const clock = (): Date => NOW;

const session = (): AuthSession => ({
  id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  identityId: ALICE,
  userId: ALICE,
  authFactor: 'email_otp',
  elevated: false,
  elevatedByFactor: null,
});

// -----------------------------------------------------------------------------
// THE PORT ITSELF. Executed rather than read
// -----------------------------------------------------------------------------

test('ADR-341: `readMe` refuses, and it refuses before any door is opened', async () => {
  // THE ENDPOINT IS THE PORTAL'S FIRST CALL ON EVERY PAGE LOAD (`routes/me.ts`
  // header), so this refusal is the whole trader surface answering 503 rather
  // than one field being absent. It is EXECUTED here because a value exists to
  // execute; the reasons below are text because registry classes and absent
  // factories are erased before any value does.
  const { db, calls } = recordingDb();
  const error: unknown = await databaseAuthBackend(db, clock)
    .readMe(session())
    .then(
      () => null,
      (e: unknown) => e,
    );

  expect(error).toBeInstanceOf(AuthBackendUnwired);
  // AND IT SPENT NO CONNECTION DOING IT. A refusal that opened a transaction
  // first is a 503 the pool already paid for.
  expect(calls).toStrictEqual([]);
});

test('ADR-341: the refusal names all THREE absences and not only the cap', () => {
  // THE REGRESSION THIS CASE EXISTS FOR IS THE ONE THAT ALREADY HAPPENED: the
  // entry named the cap alone, and a reader took the other two for discharged
  // because the sentence beside them was about a DOOR. Each needle is a
  // different absence, so losing one is losing a finding rather than a word.
  const reason = (
    databaseAuthBackend(recordingDb().db, clock) as unknown as {
      readMe: () => Promise<never>;
    }
  ).readMe;
  expect(typeof reason).toBe('function');

  expect(AUTH_BACKEND).toContain('`Me.max_accounts` has a source, has a READER, and has no ROW.');
  expect(AUTH_BACKEND).toContain('REACHABLE IS NOT RESOLVABLE');
  expect(AUTH_BACKEND).toContain('`Me.kyc.placement` is ');
  expect(AUTH_BACKEND).toContain('`Me.accounts_count` is projected in ');
  // AND THE CORRECTED SENTENCE IS KEPT BESIDE ITS CORRECTION, which is RI-14's
  // property applied to an entry RI-14 does not read: a claim deleted is a
  // claim a later session makes again.
  expect(AUTH_BACKEND).toContain('Every other field of `Me` is reachable through the scoped door');
});

// -----------------------------------------------------------------------------
// ABSENCE 1. A CAP WITH A SOURCE, A READER, NO ROW, AND NO WAY TO WRITE ONE
// -----------------------------------------------------------------------------

test('ADR-341: no migration in the set writes a `firm_parameters` row', () => {
  // DERIVED AT RUN TIME OVER THE WHOLE SET rather than asserted about the two
  // files a reader would think of. The day a seed appears this case is where it
  // is met, and the session that wrote it holds the entry.
  const offenders = [...migrationBodies()]
    .filter(([, body]) => /INSERT\s+INTO\s+firm_parameters\b/i.test(body))
    .map(([name]) => name);
  expect(offenders).toStrictEqual([]);
});

test('ADR-341: nothing shipped under either deployable writes the row or an operator', () => {
  // BOTH HALVES, BECAUSE ONE WITHOUT THE OTHER IS NOT A CAP. `approved_by` is a
  // foreign key to `operators(actor)`, so a cap row with no operator behind it
  // is unwritable at the database, and an operator with no cap row is a
  // directory entry that caps nothing.
  const sources = [
    ...shippedSources('apps', 'api', 'src'),
    ...shippedSources('apps', 'worker', 'src'),
  ];
  const writers = sources
    .filter((abs) => {
      const body = readFileSync(abs, 'utf8');
      return (
        /insert[A-Za-z]*\([\s\S]{0,40}['"]firmParameters['"]/.test(body) ||
        /insert[A-Za-z]*\([\s\S]{0,40}['"]operators['"]/.test(body)
      );
    })
    .map((abs) => abs.slice(ROOT.length + 1));
  expect(writers).toStrictEqual([]);
});

test('ADR-341: the row needs an approval, two owners and an audit row, so it is a DEPLOY act', () => {
  // ADR-284 IS WHY THIS SESSION TOOK NO MIGRATION NUMBER. A seed migration
  // cannot satisfy any of the three, and `0076`'s own header refuses to invent
  // the operator that would: "a real operator's identifiers are not this
  // repository's to hold". So even a founder-ruled number lands through the
  // control at deploy time rather than through this tree.
  expect(WRITE_CONTROL).toContain('CREATE CONSTRAINT TRIGGER firm_parameters_dual_control_is_real');
  expect(WRITE_CONTROL).toContain('CREATE CONSTRAINT TRIGGER firm_parameters_change_is_audited');
  expect(WRITE_CONTROL).toContain('IT WRITES NO OPERATOR.');
  const ownerLegs = WRITE_CONTROL.split('\n').filter((line) => line.includes("role <> 'owner'"));
  expect(ownerLegs).toHaveLength(2);
});

test('ADR-341: the corpus states three PER-PLAN maxima and no firm-wide base', () => {
  // THE VALUE IS FOUNDER-OWED AND THIS CASE IS THE DERIVATION RATHER THAN THE
  // CLAIM. Constitution 0.4 gives Core EOD ten and the other two five, M01
  // appendix A repeats all three per size, and ADR-238 ruling 1 refuses every
  // way of reading a per-plan number as the per-identity base. THREE DISTINCT
  // NUMBERS IS EXACTLY WHY THERE IS NO FOURTH TO READ: a session that picked one
  // would be picking a plan on the buyer's behalf, which is the maximum-over-
  // versions reading the ruling names first.
  expect(CONSTITUTION).toContain('Max 10 accounts.');
  const perPlan = M01.split('\n')
    .filter((line) => line.startsWith('| Maximum accounts per entity |'))
    .map((line) => line.split('|')[3]?.trim());
  expect(perPlan).toStrictEqual(['10', '5', '5']);

  // AND NO ROW, NO CONSTANT AND NO CONFIGURED VALUE ANYWHERE NAMES A BASE. The
  // needle is the parameter's own name, so a value arriving under it is met
  // here rather than in a deployment.
  const assignments = [...shippedSources('apps', 'api', 'src'), ...shippedSources('packages')]
    .filter((abs) => /base_account_cap['"]?\s*[:=]\s*\d/.test(readFileSync(abs, 'utf8')))
    .map((abs) => abs.slice(ROOT.length + 1));
  expect(assignments).toStrictEqual([]);
});

test('ADR-341: the row-present and row-absent pair still exists, one package over', () => {
  // THE CASE THAT FAILS WITHOUT THE ROW IS NOT WRITTEN TWICE. It is
  // `account-cap-door.test.ts`'s, where a seeded `firm_parameters` row makes the
  // door answer a bare integer and its absence makes the door throw, and that is
  // the whole distance between `GET /me` refusing and `GET /me` quoting a cap.
  // THIS CASE PINS THE PAIR RATHER THAN REPEATING IT, so deleting either half
  // turns the `Me` finding red as well as the door's own suite.
  expect(CAP_DOOR_SUITE).toContain('no override gives the firm base');
  expect(CAP_DOOR_SUITE).toContain('no effective row throws');
});

// -----------------------------------------------------------------------------
// ABSENCE 2. `Me.kyc.placement` HAS NO READER THIS DEPLOYABLE CAN CALL
// -----------------------------------------------------------------------------

test('ADR-341: the contract makes `placement` non-nullable, so no row is not no value', () => {
  // A NULLABLE FIELD WOULD HAVE NO FINDING HERE. `verified_at` beside it is
  // `string | null` and an identity with no verification simply has none;
  // `placement` is a bare `string`, so an unverified trader still needs one and
  // the response cannot omit it.
  expect(API_CONTRACT).toContain(
    'kyc: { state: "kyc_required"|"pending"|"verified"|"rejected"|"expired"; placement: string; verified_at: string | null };',
  );
  expect(ME_ROUTE).toContain('placement: me.kyc.placement,');
});

test('ADR-341: the settled fill is `pendingTrigger`, and it is computed from gate facts', () => {
  // WHICH IS WHY A SECOND FILL WRITTEN IN `auth-backend.ts` WOULD BE A SECOND
  // STATEMENT OF ADR-021's TRIGGER RULING. `effectiveTriggers` applies the
  // firing order and INV-M19-02's imposed member, and `kyc.ts` says in its own
  // words that a second ordering there would be a second statement of one
  // ruling. The same sentence binds this file.
  expect(KYC_ROUTE).toContain('function pendingTrigger(gate: GateFacts): KycTrigger {');
  expect(KYC_ROUTE).toContain('const effective = effectiveTriggers(gate);');
  expect(KYC_ROUTE).toContain('`KycStatus.placement` is a non-nullable string in the contract');
});

test('ADR-341: this deployable has NO database `KycBackend`, executed and not read', () => {
  // THE OBSTRUCTION IS AN ABSENT ADAPTER RATHER THAN AN ABSENT DECISION, and
  // that is the difference between this absence and the cap's. The identity of
  // the installed backend is a VALUE, so it is asserted as one.
  expect(currentKycDeps().backend).toBe(UNWIRED_KYC_BACKEND);

  // AND THERE IS NOTHING TO INSTALL. `wiring.test.ts` reads every
  // `export function databaseX` in this deployable; none of them is a KYC one,
  // so a wiring slice has no argument to pass.
  const factories = shippedSources('apps', 'api', 'src').flatMap((abs) => [
    ...readFileSync(abs, 'utf8').matchAll(/^export (?:function|const) (database[A-Za-z]+)\b/gm),
  ]);
  const kycFactories = factories.map((m) => m[1]).filter((name) => /Kyc/i.test(name ?? ''));
  expect(kycFactories).toStrictEqual([]);
});

// -----------------------------------------------------------------------------
// ABSENCE 3. `Me.accounts_count` HAS ONE READER AND NO PRODUCER
// -----------------------------------------------------------------------------

test('ADR-341: `accounts_count` is projected once and computed nowhere', () => {
  // THE FIELD IS NOT HARD, IT IS UNRULED, and those are different absences with
  // the same symptom. The rows are `owned` and a count over them is one
  // statement; what nobody has written down is WHICH accounts count.
  expect(ME_ROUTE).toContain('accounts_count: me.accounts_count,');

  // TWO SITES IN THE WHOLE DEPLOYABLE AND NEITHER PRODUCES A NUMBER: the field's
  // DECLARATION on `Me` and the projection that copies it across. A third site
  // is either the producer this finding says does not exist, or a second
  // declaration, and both are worth meeting here.
  //
  // THE THIRD SITE IS THIS FINDING'S OWN BLOCKER TEXT and it is listed rather
  // than filtered out, so a session that deletes the finding meets this case on
  // the way past instead of after.
  const sites = shippedSources('apps', 'api', 'src')
    .filter((abs) => readFileSync(abs, 'utf8').includes('accounts_count'))
    .map((abs) => abs.slice(ROOT.length + 1))
    .sort();
  expect(sites).toStrictEqual([
    'apps/api/src/auth-backend.ts',
    'apps/api/src/routes/auth.ts',
    'apps/api/src/routes/me.ts',
  ]);
  expect(read('apps', 'api', 'src', 'routes', 'auth.ts')).toContain(
    '  readonly accounts_count: number;',
  );
});

test('ADR-341: `liveAccounts` is a port field on a blocked port and nothing derives it', () => {
  // ADR-238's OWN APPROVAL BLOCK REGISTERED THIS AND IT IS STILL TRUE: "no
  // implementation of `accountCap` exists to confirm it". The field is declared,
  // it is compared, and no line in this tree produces the number it is compared
  // with.
  expect(CHECKOUT).toContain('readonly liveAccounts: number;');

  // ONE FILE HOLDS EVERY MENTION, AND INSIDE IT THE ONLY `liveAccounts:` IS THE
  // TYPE. An object literal writing the field is a producer, and there is none:
  // the other mentions are two comparisons and the prose beside them.
  const holders = shippedSources('apps', 'api', 'src')
    .filter((abs) => readFileSync(abs, 'utf8').includes('liveAccounts'))
    .map((abs) => abs.slice(ROOT.length + 1))
    .sort();
  expect(holders).toStrictEqual([
    // This finding's own blocker text, listed for the reason the case above
    // lists it: a finding deleted quietly is a finding made again.
    'apps/api/src/auth-backend.ts',
    'apps/api/src/routes/checkout.ts',
  ]);

  const assignments = CHECKOUT.split('\n').filter((line) => /liveAccounts\s*:/.test(line));
  expect(assignments).toStrictEqual(['  readonly liveAccounts: number;']);
});

test('ADR-341: `account_status` declares SEVEN members and no ruling says which are live', () => {
  // SEVEN IS THE REASON THE COUNT IS A RULING RATHER THAN A QUERY. `graduated`
  // and `provisioning_pending` are the two a reader would disagree about, and
  // ADR-260 already refused to widen an engine union to make a map total rather
  // than deciding what a half-provisioned account is worth. The same refusal
  // binds a cap the account is counted against.
  const declaration = ENUMS.slice(
    ENUMS.indexOf('CREATE TYPE account_status AS ENUM ('),
    ENUMS.indexOf(');', ENUMS.indexOf('CREATE TYPE account_status AS ENUM (')),
  );
  const members = [...declaration.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  expect(members).toStrictEqual([
    'provisioning_pending',
    'active',
    'breached',
    'expired',
    'closed_admin',
    'closed_chargeback',
    'graduated',
  ]);
});
