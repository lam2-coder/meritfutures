// =============================================================================
// apps/api/test/admin-wallet.test.ts
// =============================================================================
// WHAT THIS SUITE IS FOR, IN ONE SENTENCE: the lock comes first, the precondition
// is re-read under it, the `admin_actions` row is written BEFORE the append, and
// a refusal that happens before the transaction leaves the recorder EMPTY.
//
// -----------------------------------------------------------------------------
// THE ASSERTIONS THAT MATTER MOST ARE THE ONES AGAINST THE PRIMARY SOURCES
// -----------------------------------------------------------------------------
// Two of the three endpoints here stop at a refusal, and a suite that only
// exercised the handlers would report two working endpoints and one gap. So the
// disagreements are asserted AT THE MIGRATION AND AT THE CONTRACT rather than
// described in prose:
//
//   `0011_wallet.sql` declares `reference_id uuid NOT NULL` and `id bigint
//   GENERATED ALWAYS AS IDENTITY`, `0038_account_adjustments.sql` requires
//   `wallet_entries.reference_id = account_adjustments.id`, and API_CONTRACT no
//   longer says `corrects_entry_id` "Becomes `reference_id`" because ADR-173
//   ruled that sentence unexecutable. All three are read out of their own files
//   and compared here, so the day one of them moves this suite says so rather
//   than a later author rediscovering it inside a money-path diff.
//
// That is CLAUDE.md's own remedy for the class of error the reconciliation
// session paid for -- "prefer a new CI gate over a bigger model whenever the
// error is checkable" -- reached with a test rather than a model.
//
// -----------------------------------------------------------------------------
// WHAT A RECORDER CAN AND CANNOT PROVE, STATED RATHER THAN ASSUMED
// -----------------------------------------------------------------------------
// The fake transaction proves what is THIS module's: which accessor was called,
// in which order, with which key, which address and which values. It proves
// NOTHING about whether `lockAt`'s predicate takes a row lock, which is
// `packages/db`'s and is asserted in that package's own suite, and nothing about
// whether `NOT NULL` refuses, which is Postgres's. A suite that asserted either
// here would be agreeing with its own fake.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { TABLE_KEYS } from '@merit/db';
import type { TableKey } from '@merit/db';

import adminWallet, {
  ADMIN_WALLET_ENDPOINTS,
  ADMIN_WALLET_ROLES,
  ADMIN_WALLET_TABLES,
  AdminWalletMoneyError,
  AdminWalletUnwired,
  CORRECTION_PROVENANCE,
  DUAL_CONTROL_THRESHOLD_CENTS,
  INSUFFICIENT_FUNDS_STATUS,
  WALLET_CORRECT_PATH,
  WALLET_RECONCILIATION_PATH,
  WALLET_SPEND_LIMIT_PATH,
  assertReconciliation,
  limitInForce,
  resetAdminWalletBackend,
  useAdminWalletBackend,
} from '../src/routes/admin-wallet.ts';
import type {
  AdminWalletBackend,
  AdminWalletTx,
  SpendLimitResponse,
  SpendLimitRow,
  WalletCorrectionResponse,
  WalletReconciliationResponse,
} from '../src/routes/admin-wallet.ts';
import type { AdminPrincipal, AdminRole } from '../src/routes/admin-writes.ts';
import { buildServer } from '../src/server.ts';
import { BASE_PATH } from '../src/surface.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

const IDENTITY_ID = '22222222-2222-4222-8222-222222222222';
const LEDGER_TX = 'bbbbbbbb-0001-4000-8000-000000000001';

const AT = new Date('2026-08-27T18:00:00.000Z');
const EFFECTIVE_FROM = '2026-09-01T00:00:00.000Z';
const EXISTING_FROM = '2026-08-01T00:00:00.000Z';

const ENDPOINTS = ADMIN_WALLET_ENDPOINTS.map((spec) => `${spec.method} ${spec.path}`);

afterEach(() => {
  resetAdminWalletBackend();
});

// -----------------------------------------------------------------------------
// 0. The list of tables this module names is a list of tables that exist
// -----------------------------------------------------------------------------
// The module holds no `@merit/db` import (`src/db.ts` is this deployable's one
// door onto it), so `AdminWalletTable` is a hand-written union. THE BINDING IS
// HERE, where `@merit/db` is reachable.

describe('the tables the module names', () => {
  it('are all keys packages/db registers', () => {
    const keys: readonly TableKey[] = ADMIN_WALLET_TABLES;
    for (const key of keys) expect(TABLE_KEYS).toContain(key);
  });

  it('names no ledger table and no adjustment table, because it writes neither', () => {
    for (const key of ADMIN_WALLET_TABLES) {
      expect(key.startsWith('ledger')).toBe(false);
      expect(key).not.toBe('accountAdjustments');
    }
  });
});

// -----------------------------------------------------------------------------
// 0b. THE MODULE LOADS UNDER THE RUNTIME THAT ACTUALLY SERVES IT
// -----------------------------------------------------------------------------
// `apps/api`'s `start` script is `node --experimental-strip-types src/start.ts`,
// which ERASES types rather than compiling them, so a construct needing emitted
// code type-checks, passes under Vitest, and throws
// `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` when the process starts.
// `discoverRouteModules` imports EVERY file in `routes/`, so one of them takes
// the whole deployable down. `admin-writes.ts` shipped with exactly that defect
// and every other assertion in its suite was green.

describe('the runtime that actually serves this module', () => {
  it('imports it under `node --experimental-strip-types`, which does not transpile', () => {
    const module = join(HERE, '..', 'src', 'routes', 'admin-wallet.ts');
    const out = execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        `const m = await import(${JSON.stringify(module)});
         if (typeof m.default?.name !== 'string') throw new Error('no route module');
         process.stdout.write(m.default.name);`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(out).toBe('admin-wallet');
  });
});

// -----------------------------------------------------------------------------
// 1. THE THREE ROWS ARE THE CONTRACT'S THREE ROWS
// -----------------------------------------------------------------------------
// API_CONTRACT is the primary source and it is READ rather than remembered.

const CONTRACT = readFileSync(join(REPO, 'docs/architecture/API_CONTRACT.md'), 'utf8');

describe('API_CONTRACT section 8', () => {
  it('declares all three headings this module registers', () => {
    expect(CONTRACT).toContain(`### GET ${WALLET_RECONCILIATION_PATH}`);
    expect(CONTRACT).toContain(`### POST ${WALLET_CORRECT_PATH}`);
    expect(CONTRACT).toContain(`### POST ${WALLET_SPEND_LIMIT_PATH}`);
    expect([...ENDPOINTS].sort()).toEqual(
      [
        `GET ${WALLET_RECONCILIATION_PATH}`,
        `POST ${WALLET_CORRECT_PATH}`,
        `POST ${WALLET_SPEND_LIMIT_PATH}`,
      ].sort(),
    );
  });

  it('gives `correct` to owner ALONE, and the module narrows exactly there', () => {
    const auth = authLineFor(WALLET_CORRECT_PATH);
    expect(auth).toContain('`admin_sso`, role `owner`');
    expect(auth).not.toContain('roles `owner` and `ops`');
    expect(ADMIN_WALLET_ROLES[`POST ${WALLET_CORRECT_PATH}`]).toEqual(['owner']);
  });

  it('gives `spend-limit` to owner and ops and refuses readonly', () => {
    const auth = authLineFor(WALLET_SPEND_LIMIT_PATH);
    expect(auth).toContain('`admin_sso`, roles `owner` and `ops`');
    expect(auth).toContain('`forbidden` (`readonly` role)');
    expect(ADMIN_WALLET_ROLES[`POST ${WALLET_SPEND_LIMIT_PATH}`]).toEqual(['owner', 'ops']);
  });

  it('gives `reconciliation` to all three roles including readonly', () => {
    const auth = authLineFor(WALLET_RECONCILIATION_PATH);
    expect(auth).toContain('all roles including `readonly`');
    expect(ADMIN_WALLET_ROLES[`GET ${WALLET_RECONCILIATION_PATH}`]).toEqual([
      'owner',
      'ops',
      'readonly',
    ]);
  });

  it('names `insufficient_funds` on `correct` and defines it in NO code table', () => {
    // THE FINDING, ASSERTED RATHER THAN DESCRIBED. Section 2 calls its table
    // closed and `insufficient_funds` is not a row in it, so the status this
    // module answers with is an assumption. The day the contract defines it,
    // this assertion fails and the constant is re-read against the definition.
    expect(authLineFor(WALLET_CORRECT_PATH)).toContain('`insufficient_funds`');
    expect(CONTRACT).not.toMatch(/\|\s*`insufficient_funds`\s*\|\s*\d{3}\s*\|/);
    expect(INSUFFICIENT_FUNDS_STATUS).toBe(422);
  });

  it('says `set_by` comes from the session and never from the body', () => {
    expect(CONTRACT).toContain('the admin actor, from the session. NEVER from the body');
  });

  it('says `divergent` carries only the rows that diverge', () => {
    expect(CONTRACT).toContain('only the rows where either divergence is non-zero');
  });
});

/**
 * The body block of `POST /admin/wallet/:identityId/correct`, sliced out of the
 * contract.
 *
 * SCOPED RATHER THAN DOCUMENT-WIDE, because `reason_code` appears in section 3.2
 * as a column of `impersonation_sessions` and a document-wide `not.toContain`
 * would be asserting something true about a different endpoint. What is claimed
 * here is that THIS row's body has no such field.
 *
 * NARROWED FURTHER TO THE FENCED `ts` BODY BY ADR-173, WHICH IS THE LANDMINE
 * SESSION 298 RECORDED ARRIVING. That session's own note reads: a widening grep
 * that does not strip the prose "will get a test that fails on the file
 * documenting a refusal and passes on the file making one". ADR-173 added a
 * paragraph BELOW this row's body naming `account_adjustments.reason_code` in
 * order to explain why the wire carries no such field, and the row-wide slice
 * read that explanation as the field itself. Every assertion below already
 * targets content inside the fence, so the narrowing removes the false positive
 * and weakens no claim: what is asserted is still that THIS row's BODY has no
 * such field, which is what the paragraph above always said was meant.
 */
const CORRECTION_BLOCK = (() => {
  const start = CONTRACT.indexOf(`### POST ${WALLET_CORRECT_PATH}`);
  const end = CONTRACT.indexOf('### POST /admin/wallet/:identityId/spend-limit', start);
  const row = CONTRACT.slice(start, end);
  const open = row.indexOf('```ts');
  const close = row.indexOf('```', open + 5);
  return row.slice(open, close);
})();

/** The `Auth:` paragraph of one contract row, which carries the roles and the error set. */
function authLineFor(path: string): string {
  const heading = CONTRACT.indexOf(
    `### ${path.startsWith('/admin/wallet/recon') ? 'GET' : 'POST'} ${path}`,
  );
  expect(heading).toBeGreaterThan(-1);
  const section = CONTRACT.slice(heading);
  const auth = section.indexOf('Auth:');
  return section.slice(auth, section.indexOf('\n\n', auth));
}

// -----------------------------------------------------------------------------
// 2. WHY `correct` CANNOT BE WRITTEN, READ OUT OF THE TWO MIGRATIONS
// -----------------------------------------------------------------------------
// THIS IS THE SECTION THE SESSION EXISTS FOR. The contract instructs a write that
// four constraints refuse, and every one of the four is read at its own source
// here so that "the endpoint is unwired" cannot be mistaken for "nobody got round
// to it".
//
// ADR-173 RULED THE FIRST OF THE FOUR AND THREE STILL STAND, SO THE APPEND IS
// STILL UNWRITABLE. What moved is the CONTRACT half of item 1, not the schema
// half: `wallet_entries.reference_id` is still a uuid bound to the adjustment's
// id, and what a correction corrects is recorded in
// `admin_actions.before.corrected_entry` rather than in any column.
//
// THE RULING IS NOW APPLIED IN `admin-wallet.ts` AND THE SCHEMA HALF OF ITEM 1
// IS ASSERTED HARDER RATHER THAN SOFTER. `corrects_entry_id` is optional, the
// `conflict` check is conditioned on its presence, and the binding a wiring
// slice must not get wrong -- `reference_id` is the ADJUSTMENT's id and nothing
// else -- is asserted directly below at both migrations and at the port's own
// documentation. Items 2, 3 and 4 are untouched, and item 3's threshold still
// has no source anywhere in this tree.

describe('the four constraints that refuse the correction as the contract writes it', () => {
  const wallet = readFileSync(join(REPO, 'packages/db/migrations/0011_wallet.sql'), 'utf8');
  const adjustments = readFileSync(
    join(REPO, 'packages/db/migrations/0038_account_adjustments.sql'),
    'utf8',
  );

  it('1. `reference_id` is a uuid and `wallet_entries.id` is a bigint', () => {
    expect(wallet).toContain('reference_id           uuid NOT NULL');
    expect(wallet).toContain('id                     bigint GENERATED ALWAYS AS IDENTITY');
    // ADJ-C3 requires that column to be the ADJUSTMENT's id, which is a uuid, so
    // the two claims on one column are not merely differently typed: they are
    // two different rows.
    expect(adjustments).toContain('w.reference_id           = NEW.id');
    // THE SCHEMA FACTS ABOVE ARE UNCHANGED AND THE CONTRACT'S CLAIM IS NOT.
    // This assertion read `toContain('the entry being compensated. Becomes
    // `reference_id`')` until ADR-173 ruled that sentence wrong and deleted it:
    // the write it instructs fails on `invalid input syntax for type uuid`
    // before any constraint is reached, so it was never possible in any
    // deployment. The pin is INVERTED rather than dropped, because a deleted
    // assertion is how the sentence would come back.
    expect(CORRECTION_BLOCK).not.toContain('Becomes `reference_id`');
    expect(CORRECTION_BLOCK).toContain('it does NOT become `reference_id`');
    // AND THE FIELD IS OPTIONAL, which is the half of ADR-173 the dispatch did
    // not predict: a `goodwill` adjustment corrects no entry at all and the
    // database accepts one, so a REQUIRED field would make a case `0038` built
    // for unreachable through the only endpoint that reaches it.
    expect(CORRECTION_BLOCK).toContain('corrects_entry_id?: string;');
  });

  it('1a. `reference_id` is the ADJUSTMENT"s id and nothing else', () => {
    // THE EXACT THING THE OLD CONTRACT GOT WRONG, ASSERTED DIRECTLY RATHER THAN
    // INFERRED FROM THE TWO TYPES. ADJ-C3 counts wallet_entries rows by the
    // adjustment's own id and by four further equalities, and raises by name
    // when the count is not one. A wiring slice that put any other uuid in that
    // column -- the corrected entry's, the ledger transaction's, the
    // identity's -- would be well typed and would fail at COMMIT.
    expect(adjustments).toContain('FROM wallet_entries w');
    expect(adjustments).toContain('WHERE w.reference_id           = NEW.id');
    expect(adjustments).toContain('AND w.ledger_transaction_id  = NEW.ledger_transaction_id');
    expect(adjustments).toContain("AND w.provenance             = 'correction'");
    expect(adjustments).toContain(
      "'ADJ-C3: adjustment % has % matching wallet_entries row(s) and must '",
    );
    // The migration states the binding in prose as well, and calls the
    // adjustment a FOURTH referent rather than one of `0011`'s three.
    expect(adjustments).toContain('`reference_id` MUST be the adjustment');
    // AND `NEW` IS AN `account_adjustments` ROW, which is what makes `NEW.id` a
    // uuid rather than a bigint. Asserted at the trigger declaration so the
    // claim is not resting on the function name reading like one.
    expect(adjustments).toContain('AFTER INSERT ON account_adjustments');
    // NOTHING ELSE IN THE SCHEMA HOLDS A CORRECTED ENTRY. `0011` names the
    // corrected entry only in a COMMENT on a uuid column, which is prose rather
    // than a constraint and was never writable: ADR-173 section 6 item 2.
    expect(wallet).toContain('-- polymorphic: payout_request,');
    expect(wallet).toContain('-- purchase, or the corrected entry');
  });

  it('1b. the record of which entry was corrected is the `admin_actions` row', () => {
    // ADR-173 clause 2 and clause 3: no column is owed because the durable
    // record already exists and holds strictly more. The two halves of that
    // claim are the contract's statement of it and the grant that makes it as
    // durable as the wallet entry it describes.
    const row = CONTRACT.slice(
      CONTRACT.indexOf(`### POST ${WALLET_CORRECT_PATH}`),
      CONTRACT.indexOf('### POST /admin/wallet/:identityId/spend-limit'),
    );
    expect(row).toContain('admin_actions');
    expect(row).toContain('before.corrected_entry');
    expect(row).toContain('`evidence_refs` entry of kind `wallet_entry`');
    // `0026` revokes UPDATE and DELETE on `admin_actions` from `merit_app` and
    // from PUBLIC, exactly as it does on `wallet_entries`. Read at the file that
    // executes the revoke rather than off the ADR that cites it.
    const grants = readFileSync(
      join(REPO, 'packages/db/migrations/0026_roles_and_grants.sql'),
      'utf8',
    );
    const revoke = grants.slice(grants.indexOf('REVOKE UPDATE, DELETE ON'));
    const list = revoke.slice(0, revoke.indexOf('FROM merit_app, PUBLIC'));
    for (const table of ['admin_actions', 'wallet_entries']) expect(list).toContain(table);
  });

  it('2. a correcting debit must exactly reverse a prior adjustment credit', () => {
    expect(adjustments).toContain('CONSTRAINT account_adjustments_debit_is_a_reversal CHECK (');
    expect(adjustments).toContain("(direction = 'debit') = (reverses_adjustment_id IS NOT NULL)");
    // The contract's body offers a free `direction` and no `reverses_adjustment_id`.
    expect(CORRECTION_BLOCK).toContain('direction: "credit" | "debit";');
    expect(CORRECTION_BLOCK).not.toContain('reverses_adjustment_id');
  });

  it('3. dual control is an approvals row and a threshold column, not a name', () => {
    expect(adjustments).toContain('dual_control_threshold_cents bigint NOT NULL');
    expect(adjustments).toContain('dual_control_approval_id     uuid NULL REFERENCES');
    expect(CORRECTION_BLOCK).toContain('second_approver: string;');
    expect(CORRECTION_BLOCK).not.toContain('dual_control_threshold_cents');
  });

  it('4. `reason_code` is NOT NULL over a closed three-member vocabulary', () => {
    expect(adjustments).toContain(
      'reason_code                  text NOT NULL CHECK (reason_code IN (',
    );
    for (const member of ['goodwill', 'reconciliation_error', 'promotional_credit'])
      expect(adjustments).toContain(`'${member}'`);
    expect(CORRECTION_BLOCK).not.toContain('reason_code');
  });

  it('and the provenance this endpoint writes is the only one it may write', () => {
    expect(wallet).toContain("'correction'");
    expect(CORRECTION_BLOCK).toContain('provenance: "correction";           // the only value');
    expect(CORRECTION_PROVENANCE).toBe('correction');
  });
});

// -----------------------------------------------------------------------------
// 3. WHY `reconciliation` CANNOT BE READ, AT ADR-157 RATHER THAN IN PROSE
// -----------------------------------------------------------------------------

/** The module as it is on disk, comments and all. */
const SOURCE = readFileSync(join(HERE, '..', 'src', 'routes', 'admin-wallet.ts'), 'utf8');

/**
 * The module with every comment removed, which is what a claim about what the
 * CODE does has to be made against.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// -----------------------------------------------------------------------------
// 2a. THE DUAL-CONTROL THRESHOLD, ADR-228
// -----------------------------------------------------------------------------
// Item 3 of the header used to say the threshold had "no wire field and no
// configured source in this tree". The founder answered on 2026-08-29 and the
// second half is discharged. THREE THINGS ARE ASSERTED HERE AND EACH HAS A REAL
// FAILURE MODE:
//
//   1. THE NUMBER, AND THAT IT IS AN INTEGER-CENTS `bigint`. A threshold that
//      became a `number` would be a float on the money path.
//
//   2. THE CEILING AGREES WITH THE CONSTANT. Two copies of one number in two
//      languages is ADR-092 section 5's hazard, and the only defence is a
//      comparison. If a later session moves the constant and not the migration,
//      the constant becomes a value the database refuses; if it moves the
//      migration and not the constant, the ceiling stops being the answer.
//      Either way this fails.
//
//   3. THE THRESHOLD IS NEVER A WIRE FIELD. This is the whole of ruling 2: a
//      caller who names the threshold names the right-hand side of
//      `amount_cents < dual_control_threshold_cents`, and can therefore satisfy
//      it at any amount with no approval row.
//
// AND THE PAYOUT-PATH FINDING IS ASSERTED RATHER THAN WRITTEN DOWN, because it
// is the claim most likely to quietly stop being true and the one a reader is
// most likely to assume the opposite of.

const MIGRATION_0068 = readFileSync(
  join(REPO, 'packages/db/migrations/0068_dual_control_threshold_ceiling.sql'),
  'utf8',
);

/**
 * `0068` with its comments stripped, which is what a claim about the DDL has to
 * be made against. `CODE`'s shape, one language over.
 */
const DDL_0068 = MIGRATION_0068.replace(/^--.*$/gm, '');

describe('the dual-control threshold the founder answered', () => {
  const ADJUSTMENTS = readFileSync(
    join(REPO, 'packages/db/migrations/0038_account_adjustments.sql'),
    'utf8',
  );

  it('is 500000 integer cents, as a bigint, so no float touches it', () => {
    expect(DUAL_CONTROL_THRESHOLD_CENTS).toBe(500_000n);
    expect(typeof DUAL_CONTROL_THRESHOLD_CENTS).toBe('bigint');
  });

  it('records the question it answers, verbatim, beside the number', () => {
    // A threshold whose reasoning is lost is a threshold the next session moves.
    expect(SOURCE).toContain('above what payout amount should a second human have to approve it');
    expect(SOURCE).toContain(
      'without adding friction to normal trader withdrawals, which typically',
    );
    expect(SOURCE).toContain('run $500-$3,000');
    // AND IT RECORDS THAT THE REASONING SHOWN IS NOT THE REASONING THIS COLUMN
    // CARRIES. Deleting that sentence is how the mismatch gets forgotten.
    expect(SOURCE).toContain('IS NOT THE REASONING THIS NUMBER');
  });

  it('is bounded above in DDL by 0068, and 0038 is not edited to do it', () => {
    expect(MIGRATION_0068).toContain('ALTER TABLE account_adjustments');
    expect(MIGRATION_0068).toContain(
      'ADD CONSTRAINT account_adjustments_dual_control_threshold_ceiling CHECK (',
    );
    // `0038` STILL SAYS EXACTLY WHAT IT SAID. A merged migration is never
    // edited, only superseded (constitution E2).
    expect(ADJUSTMENTS).toContain('dual_control_threshold_cents bigint NOT NULL');
    expect(ADJUSTMENTS).toContain('CHECK (dual_control_threshold_cents > 0)');
    expect(ADJUSTMENTS).not.toContain('threshold_ceiling');
  });

  it('bounds the column at exactly the constant, which is the anti-drift assertion', () => {
    const ceiling = /dual_control_threshold_cents <= (\d+)/.exec(DDL_0068)?.[1];
    expect(ceiling).toBeTypeOf('string');
    expect(BigInt(ceiling ?? '-1')).toBe(DUAL_CONTROL_THRESHOLD_CENTS);
  });

  it('is a CEILING and deliberately not an EQUALITY', () => {
    // An equality CHECK constrains historical rows too, so it would make every
    // row written at the old threshold unrepresentable the first time the
    // threshold moved -- destroying the property `0038:279` created the column
    // for in order to defend it.
    //
    // THE CLAIM IS ABOUT THE DDL AND SO IS THE ASSERTION. Read against the whole
    // file this matched the ATTACK the header describes (`dual_control_threshold
    // _cents = 9223372036854775807`), which is prose arguing FOR the ceiling, so
    // a whole-file match would have failed the file for explaining itself.
    expect(DDL_0068).toContain('dual_control_threshold_cents <= 500000');
    expect(DDL_0068).not.toMatch(/dual_control_threshold_cents\s*=/);
    expect(MIGRATION_0068).toContain('A CEILING, AND DELIBERATELY NOT AN EQUALITY');
  });

  it('is never a wire field, on either the contract row or the port draft', () => {
    // The contract's body carries `second_approver` and no threshold.
    expect(CORRECTION_BLOCK).not.toContain('dual_control_threshold');
    expect(CORRECTION_BLOCK).not.toContain('threshold');
    // AND THE DRAFT THE PORT RECEIVES CARRIES NONE EITHER. A caller-supplied
    // threshold is a caller-supplied right-hand side for
    // `amount_cents < dual_control_threshold_cents`.
    const open = SOURCE.indexOf('export interface WalletCorrectionDraft {');
    expect(open).toBeGreaterThan(-1);
    const draft = SOURCE.slice(open, SOURCE.indexOf('\n}', open));
    expect(draft.toLowerCase()).not.toContain('threshold');
  });

  it('has no writer at all, so the constraint it bounds has never run on a row', () => {
    // `ADMIN_WALLET_TABLES` excludes the adjustment table by construction, and
    // nothing else in either deployable inserts one. The ceiling is live from
    // the moment a writer exists and not before, and this suite says so rather
    // than letting a green run read as coverage.
    for (const key of ADMIN_WALLET_TABLES) expect(key).not.toBe('accountAdjustments');
    expect(CODE).not.toContain('accountAdjustments');
  });
});

// -----------------------------------------------------------------------------
// 2b. THE FINDING: THE THRESHOLD IS UNDISCHARGED ON THE PATH THE QUESTION NAMED
// -----------------------------------------------------------------------------
// The founder was asked about a PAYOUT amount. `dual_control_threshold_cents`
// is the only amount-denominated dual-control threshold in the estate and it
// exists on ONE table, which is the ADMIN adjustment table. Every assertion in
// this block is a claim ADR-228 section 5 makes, pinned so that the day one of
// them stops being true this suite says so.

describe('what the payout and withdrawal paths carry, which is the finding', () => {
  const ROUTES = ['payouts.ts', 'admin-payouts.ts', 'wallet-withdrawals.ts', 'wallet.ts'] as const;

  it('is no dual control at all, on any of the four money-out routes', () => {
    for (const file of ROUTES) {
      const body = readFileSync(join(REPO, 'apps/api/src/routes', file), 'utf8');
      expect({ file, matches: (body.match(/dual_control|dualControl/g) ?? []).length }).toEqual({
        file,
        matches: 0,
      });
    }
  });

  it('and `dual_channel` on the withdrawal route is an AUTH FACTOR, not a second human', () => {
    // The one near-miss a reader is likely to mistake for the control. It is a
    // step-up factor for the SAME person, and it appears on `required:`.
    const withdrawals = readFileSync(
      join(REPO, 'apps/api/src/routes/wallet-withdrawals.ts'),
      'utf8',
    );
    expect(withdrawals).toContain("required: 'passkey or dual_channel'");
    expect(withdrawals).not.toContain('dual_control');
  });

  it('and neither payout table declares a dual-control column of any kind', () => {
    for (const file of ['0010_payouts.sql', '0011_wallet.sql']) {
      const sql = readFileSync(join(REPO, 'packages/db/migrations', file), 'utf8');
      expect({ file, dual: sql.includes('dual_control') }).toEqual({ file, dual: false });
    }
  });

  it('so the only amount threshold in the estate is on the admin adjustment table', () => {
    const dir = join(REPO, 'packages/db/migrations');
    const carriers = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => readFileSync(join(dir, f), 'utf8').includes('dual_control_threshold_cents'));
    // `0038` declares it and `0068` bounds it. A third file here means a second
    // threshold exists and this suite's claim needs re-deriving.
    expect(carriers).toEqual([
      '0038_account_adjustments.sql',
      '0068_dual_control_threshold_ceiling.sql',
    ]);
  });
});

describe('the refusal reconciliation stops at', () => {
  it('is ADR-157 clause 6 and section 7 item 1, read out of the entry', () => {
    const adr = readFileSync(join(REPO, 'docs/decisions/ADR-157.md'), 'utf8');
    expect(adr).toContain('THE AGGREGATE IS REFUSED');
    expect(adr).toContain('THE AGGREGATE AND THE JOIN ARE BOTH STILL UNAVAILABLE');
    expect(adr).toContain(
      'a joined read has two tables and the tenancy narrowing has to hold on BOTH',
    );
  });

  it('and the module widens nothing to get round it', () => {
    // THE COMMENTS ARE STRIPPED FIRST AND THAT IS NOT A CONVENIENCE. The module's
    // header names every one of these identifiers in order to say it does not use
    // one, so a substring test over the raw file asserts the opposite of what it
    // reads: it would fail on the file that documents the refusal and pass on a
    // file that made the widening silently. Session 292 found the same shape and
    // the note is carried rather than rediscovered.
    expect(CODE).not.toContain('SqlExecutorReason');
    expect(CODE).not.toContain('SystemReason');
    expect(CODE).not.toContain('sqlExecutor');
    expect(CODE).not.toContain('pg_advisory');
    // No `pg`, no drizzle, and no `@merit/db`: this module reaches the database
    // only through the port it declares.
    expect(CODE).not.toMatch(/from '(pg|drizzle-orm[^']*|@merit\/db)'/);
    // AND THE STRIPPER IS NOT VACUOUS. A guard with nothing to find looks exactly
    // like a guard finding nothing wrong (ADR-112 section 8), so the reader is
    // watched keeping the code and dropping the prose that names it.
    expect(CODE).toContain('export const ADMIN_WALLET_ENDPOINTS');
    expect(SOURCE).toContain('SqlExecutorReason');
  });
});

// -----------------------------------------------------------------------------
// 3a. THE ONE THING ABOUT THE APPEND ADR-173 SETTLED, CARRIED IN THE MODULE
// -----------------------------------------------------------------------------
// The append is still refused, so no test can watch it write. What CAN be
// asserted is that the module hands a wiring slice the ruling rather than the
// contract's error, and that the two ways of getting the referent wrong are
// named where a later author will read them.

describe('the referent the append must use', () => {
  it('is stated at the port as the ADJUSTMENT"s id and nothing else', () => {
    expect(SOURCE).toContain(
      '`wallet_entries.reference_id` IS `account_adjustments.id` AND NOTHING ELSE.',
    );
    // The three wrong answers are named, because "and nothing else" is the part
    // a reader skims. The corrected entry's id is the one the contract used to
    // instruct and the one that is not even expressible.
    expect(SOURCE).toContain(
      "It is never the corrected entry's id, never the ledger transaction's and",
    );
  });

  it('and the module no longer requires the field the ruling made optional', () => {
    // AGAINST THE CODE AND NOT THE PROSE. The header names
    // `corrects_entry_id` in order to say what it is not, so a substring test
    // over the raw file would pass on a handler that still demanded it.
    expect(CODE).toContain("textField(ctx.body, 'corrects_entry_id', errors, false)");
    expect(CODE).not.toContain("textField(ctx.body, 'corrects_entry_id', errors, true)");
    // `second_approver` IS STILL REQUIRED, which is what makes the assertion
    // above a statement about one field rather than about `textField`.
    expect(CODE).toContain("textField(ctx.body, 'second_approver', errors, true)");
  });
});

// -----------------------------------------------------------------------------
// 4. THE SURFACE BOUNDARY
// -----------------------------------------------------------------------------
// ADR-083 section 4: the public deployment answers 404 for an operator path BY
// HAVING NOTHING THERE. `withheld` being non-empty is the mechanism and the 404
// is the consequence, so both are asserted rather than one standing in for the
// other.

describe('the surface boundary', () => {
  it('withholds all three routes from the public deployment', () => {
    const { report } = buildServer({ surface: 'public', modules: [adminWallet] });
    expect(report.registered).toEqual([]);
    expect([...report.withheld].sort()).toEqual([...ENDPOINTS].sort());
  });

  it('registers all three routes on the operator deployment', () => {
    const { report } = buildServer({ surface: 'operator', modules: [adminWallet] });
    expect(report.withheld).toEqual([]);
    expect([...report.registered].sort()).toEqual([...ENDPOINTS].sort());
  });

  it('answers 404 on the public origin, from the router and not from a check', async () => {
    const { app } = buildServer({ surface: 'public', modules: [adminWallet] });
    // NO BACKEND IS INSTALLED. If this 404 came from a permission check the check
    // would have needed a principal, and asking for one would have thrown
    // `AdminWalletUnwired` and answered 401 (ADR-192 clause 2). A 404 here
    // therefore proves the route was never registered.
    for (const spec of ADMIN_WALLET_ENDPOINTS) {
      const url = urlFor(spec.path);
      const response = await app.inject({
        method: spec.method,
        url,
        ...(spec.method === 'GET' ? {} : { payload: {} }),
      });
      expect([url, response.statusCode]).toEqual([url, 404]);
      expect(response.headers['content-type']).toContain('application/problem+json');
    }
    await app.close();
  });

  it('names no admin hostname anywhere in the module', () => {
    // ADR-012: the admin console's real apex domain never enters the corpus, the
    // repository, or any public artifact. The module classifies by PREFIX and
    // holds no origin literal at all.
    const source = readFileSync(join(HERE, '..', 'src', 'routes', 'admin-wallet.ts'), 'utf8');
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toMatch(/ADMIN_ORIGIN\s*=/);
  });
});

// -----------------------------------------------------------------------------
// The recorder
// -----------------------------------------------------------------------------

/** One call the fake transaction saw. In order. */
interface Written {
  readonly kind: 'lock' | 'read' | 'rows' | 'insert' | 'correction';
  readonly table: string;
  readonly at?: Record<string, unknown>;
  readonly values: Record<string, unknown>;
}

interface FakeOptions {
  /** `undefined` makes the identity absent, which is the contract's 404. */
  readonly missing?: boolean;
  /** This identity's `wallet_entries`, newest `id` last. */
  readonly entries?: readonly Record<string, unknown>[];
  /** This identity's `wallet_spend_limits`. */
  readonly limits?: readonly Record<string, unknown>[];
  /** What `reconcile` answers with. */
  readonly reconciliation?: WalletReconciliationResponse;
  /** Make `writeCorrection` throw what a Drizzle-wrapped `pg` error looks like. */
  readonly correctionFailure?: unknown;
}

const ENTRY = {
  id: 41n,
  direction: 'credit',
  amountCents: 250_000n,
  provenance: 'payout',
  cause: 'payout 7712 settled',
  referenceId: '55555555-5555-4555-8555-555555555555',
  ledgerTransactionId: LEDGER_TX,
  balanceAfterCents: 250_000n,
  occurredAt: new Date('2026-08-20T10:00:00.000Z'),
};

const HEALTHY_RECONCILIATION: WalletReconciliationResponse = {
  as_of: AT.toISOString(),
  identities_checked: 12,
  float: { total_cents: 4_250_000, identities_with_balance: 9 },
  divergent: [],
};

function fakeBackend(
  role: AdminRole,
  written: Written[] = [],
  options: FakeOptions = {},
): AdminWalletBackend {
  const tx: AdminWalletTx = {
    lockAt: (table, at) => {
      written.push({ kind: 'lock', table, at: { ...at }, values: {} });
      if (table === 'identities' && options.missing !== true && at['id'] === IDENTITY_ID)
        return Promise.resolve({ id: IDENTITY_ID, status: 'active' });
      return Promise.resolve(undefined);
    },
    rowAt: (table, at) => {
      written.push({ kind: 'read', table, at: { ...at }, values: {} });
      return Promise.resolve(undefined);
    },
    rowsWhere: (table, where) => {
      written.push({ kind: 'rows', table, at: { ...where }, values: {} });
      if (table === 'walletEntries') return Promise.resolve([...(options.entries ?? [ENTRY])]);
      if (table === 'walletSpendLimits') return Promise.resolve([...(options.limits ?? [])]);
      return Promise.resolve([]);
    },
    insert: (table, values) => {
      written.push({ kind: 'insert', table, values: { ...values } });
      return Promise.resolve([{ ...values, createdAt: AT }]);
    },
  };

  const principal: AdminPrincipal = { actor: `sso:${role}@merit`, role };
  return {
    operator: (fn) => fn(tx),
    principal: () => Promise.resolve(principal),
    now: () => AT,
    writeCorrection: (_tx, draft) => {
      written.push({ kind: 'correction', table: 'walletEntries', values: { ...draft } });
      if (options.correctionFailure !== undefined) return Promise.reject(options.correctionFailure);
      const balance =
        draft.direction === 'credit'
          ? draft.balanceBeforeCents + draft.amountCents
          : draft.balanceBeforeCents - draft.amountCents;
      return Promise.resolve({
        entryId: 42n,
        ledgerTransactionId: LEDGER_TX,
        balanceAfterCents: balance,
        occurredAt: AT.toISOString(),
      });
    },
    reconcile: () => Promise.resolve(options.reconciliation ?? HEALTHY_RECONCILIATION),
  };
}

const CORRECTION_BODY: Record<string, unknown> = {
  direction: 'credit',
  amount_cents: 5_000,
  cause: 'reconciliation difference on payout 7712',
  corrects_entry_id: '41',
  reason: 'ticket 4711: Merit under-credited by 5,000 cents',
  second_approver: 'sso:ops@merit',
};

const SPEND_LIMIT_BODY: Record<string, unknown> = {
  daily_cents: 25_000,
  rolling_7d_cents: 100_000,
  effective_from: EFFECTIVE_FROM,
  reason: 'ticket 4712: account takeover under investigation',
};

function bodyFor(path: string): Record<string, unknown> {
  return path === WALLET_CORRECT_PATH ? { ...CORRECTION_BODY } : { ...SPEND_LIMIT_BODY };
}

function urlFor(path: string, id: string = IDENTITY_ID): string {
  return BASE_PATH + path.replace(':identityId', id);
}

async function callAs(
  role: AdminRole,
  spec: (typeof ADMIN_WALLET_ENDPOINTS)[number],
  written: Written[] = [],
  body?: Record<string, unknown>,
  options: FakeOptions = {},
  id: string = IDENTITY_ID,
): Promise<{ statusCode: number; json: () => unknown }> {
  useAdminWalletBackend(fakeBackend(role, written, options));
  const { app } = buildServer({ surface: 'operator', modules: [adminWallet] });
  const response = await app.inject({
    method: spec.method,
    url: urlFor(spec.path, id),
    ...(spec.method === 'GET' ? {} : { payload: body ?? bodyFor(spec.path) }),
  });
  await app.close();
  return response;
}

/**
 * The spec for one contract path.
 *
 * BOUND BY PATH AND NOT BY POSITION. `ADMIN_WALLET_ENDPOINTS[0]` would keep
 * compiling if the three rows were ever reordered, and every assertion below
 * would then exercise a different endpoint while still passing. A lookup that
 * throws cannot do that.
 */
function endpointAt(path: string): (typeof ADMIN_WALLET_ENDPOINTS)[number] {
  const spec = ADMIN_WALLET_ENDPOINTS.find((candidate) => candidate.path === path);
  if (spec === undefined) throw new Error(`no endpoint in this module declares \`${path}\``);
  return spec;
}

const CORRECT = endpointAt(WALLET_CORRECT_PATH);
const SPEND_LIMIT = endpointAt(WALLET_SPEND_LIMIT_PATH);
const RECONCILIATION = endpointAt(WALLET_RECONCILIATION_PATH);

/** The two MUTATING rows. `reconciliation` writes nothing and is excluded on purpose. */
const WRITES = [CORRECT, SPEND_LIMIT];

// -----------------------------------------------------------------------------
// 5. AN AUTHORIZATION REFUSAL IS NEVER A GATE RESULT (INV-M5-23's shape)
// -----------------------------------------------------------------------------
// The property is that the 401 and the 403 happen before `operator()` is called,
// so there is no lock, no `admin_actions` row and no append to roll back. IT IS
// ASSERTED BY THE RECORDER BEING EMPTY and not by the status code alone: a
// handler that refused after opening a transaction would answer the same 403.

describe('the authorization refusals', () => {
  it('refuses a readonly principal both writes and touches the database not at all', async () => {
    for (const spec of WRITES) {
      const written: Written[] = [];
      const response = await callAs('readonly', spec, written);
      expect([spec.path, response.statusCode]).toEqual([spec.path, 403]);
      expect(response.json()).toMatchObject({ code: 'forbidden' });
      // THE ASSERTION THAT MATTERS. No lock, no read, no audit row, nothing.
      expect([spec.path, written]).toEqual([spec.path, []]);
    }
  });

  it('refuses `ops` the correction, which is `owner` alone, and records nothing', async () => {
    const written: Written[] = [];
    const response = await callAs('ops', CORRECT, written);
    expect(response.statusCode).toBe(403);
    expect(written).toEqual([]);
  });

  it('admits `ops` the spend limit, which is the other half of the same check', async () => {
    const response = await callAs('ops', SPEND_LIMIT);
    expect(response.statusCode).toBe(200);
  });

  it('admits `readonly` the reconciliation read', async () => {
    const response = await callAs('readonly', RECONCILIATION);
    expect(response.statusCode).toBe(200);
  });

  it('answers 401 before 403 when there is no principal at all', async () => {
    for (const spec of ADMIN_WALLET_ENDPOINTS) {
      const written: Written[] = [];
      const backend = fakeBackend('owner', written);
      useAdminWalletBackend({ ...backend, principal: () => Promise.resolve(null) });
      const { app } = buildServer({ surface: 'operator', modules: [adminWallet] });
      const response = await app.inject({
        method: spec.method,
        url: urlFor(spec.path),
        ...(spec.method === 'GET' ? {} : { payload: bodyFor(spec.path) }),
      });
      await app.close();
      expect([spec.path, response.statusCode]).toEqual([spec.path, 401]);
      expect([spec.path, written]).toEqual([spec.path, []]);
    }
  });

  it('answers 403 for a role string outside the closed set rather than defaulting', async () => {
    for (const spec of ADMIN_WALLET_ENDPOINTS) {
      const written: Written[] = [];
      const backend = fakeBackend('owner', written);
      useAdminWalletBackend({
        ...backend,
        principal: () =>
          Promise.resolve({ actor: 'sso:nobody@merit', role: 'auditor' as AdminRole }),
      });
      const { app } = buildServer({ surface: 'operator', modules: [adminWallet] });
      const response = await app.inject({
        method: spec.method,
        url: urlFor(spec.path),
        ...(spec.method === 'GET' ? {} : { payload: bodyFor(spec.path) }),
      });
      await app.close();
      expect([spec.path, response.statusCode]).toEqual([spec.path, 403]);
      expect([spec.path, written]).toEqual([spec.path, []]);
    }
  });

  // ADR-192 clause 2. THE 503 DID NOT GO AWAY; IT MOVED BEHIND THE 401. Which
  // of this deployment's ports are uncomposed is a fact about the deployment,
  // and an anonymous caller may not have it, so `principal`'s refusal answers
  // 401 and every other port member's refusal answers 503.
  it('answers 401 and not 503 when no backend is installed, disclosing no deployment state', async () => {
    for (const spec of ADMIN_WALLET_ENDPOINTS) {
      resetAdminWalletBackend();
      const { app } = buildServer({ surface: 'operator', modules: [adminWallet] });
      const response = await app.inject({
        method: spec.method,
        url: urlFor(spec.path),
        ...(spec.method === 'GET' ? {} : { payload: bodyFor(spec.path) }),
      });
      await app.close();
      expect([spec.path, response.statusCode]).toEqual([spec.path, 401]);
      expect([spec.path, (response.json() as { code: string }).code]).toEqual([
        spec.path,
        'unauthenticated',
      ]);
    }
  });

  it('answers 503 to an authenticated operator whose deployment wired no `operator` or `reconcile`', async () => {
    // The leg that would pass by accident if the module simply stopped sending
    // 503 at all. Both mutating routes meet an unwired `operator` and the read
    // route meets an unwired `reconcile`, so every route of this module is
    // covered by one of the two.
    for (const spec of ADMIN_WALLET_ENDPOINTS) {
      useAdminWalletBackend({
        ...fakeBackend('owner'),
        operator: () => Promise.reject(new AdminWalletUnwired('operator')),
        reconcile: () => Promise.reject(new AdminWalletUnwired('reconcile')),
      });
      const { app } = buildServer({ surface: 'operator', modules: [adminWallet] });
      const response = await app.inject({
        method: spec.method,
        url: urlFor(spec.path),
        ...(spec.method === 'GET' ? {} : { payload: bodyFor(spec.path) }),
      });
      await app.close();
      expect([spec.path, response.statusCode]).toEqual([spec.path, 503]);
      expect(response.json()).toMatchObject({ code: 'service_unavailable' });
    }
  });
});

// -----------------------------------------------------------------------------
// 6. THE ORDER INSIDE THE TRANSACTION, WHICH IS THE CONTROL
// -----------------------------------------------------------------------------
// lock, then the precondition re-read, then `admin_actions`, then the append.
// Each of the three seeded defects the dispatch names is a reordering or an
// omission here, and each of them turns one of these assertions red.

describe('the order inside every transaction', () => {
  it('locks the identity row FIRST, before any read of any other table', async () => {
    for (const spec of WRITES) {
      const written: Written[] = [];
      const response = await callAs('owner', spec, written);
      expect([spec.path, response.statusCode]).toEqual([spec.path, 200]);
      expect([spec.path, written[0]?.kind, written[0]?.table]).toEqual([
        spec.path,
        'lock',
        'identities',
      ]);
      expect([spec.path, written[0]?.at]).toEqual([spec.path, { id: IDENTITY_ID }]);
    }
  });

  it('re-reads the precondition UNDER the lock, before it writes anything', async () => {
    for (const spec of WRITES) {
      const written: Written[] = [];
      await callAs('owner', spec, written);
      const firstWrite = written.findIndex((w) => w.kind === 'insert' || w.kind === 'correction');
      const reRead = written.findIndex((w) => w.kind === 'rows');
      expect([spec.path, reRead]).toEqual([spec.path, 1]);
      expect([spec.path, reRead < firstWrite]).toEqual([spec.path, true]);
    }
  });

  it('writes the `admin_actions` row BEFORE the append, on every mutating row', async () => {
    for (const spec of WRITES) {
      const written: Written[] = [];
      await callAs('owner', spec, written);
      const audit = written.findIndex((w) => w.kind === 'insert' && w.table === 'adminActions');
      const append = written.findIndex(
        (w) => w.kind === 'correction' || (w.kind === 'insert' && w.table === 'walletSpendLimits'),
      );
      expect([spec.path, audit]).not.toEqual([spec.path, -1]);
      expect([spec.path, append]).not.toEqual([spec.path, -1]);
      expect([spec.path, audit < append]).toEqual([spec.path, true]);
    }
  });

  it('answers 404 and appends nothing when the identity does not exist', async () => {
    for (const spec of WRITES) {
      const written: Written[] = [];
      const response = await callAs('owner', spec, written, undefined, { missing: true });
      expect([spec.path, response.statusCode]).toEqual([spec.path, 404]);
      expect([spec.path, written.map((w) => w.kind)]).toEqual([spec.path, ['lock']]);
    }
  });

  it('answers 404 for an identityId that is not a uuid, without opening a transaction', async () => {
    for (const spec of WRITES) {
      const written: Written[] = [];
      const response = await callAs('owner', spec, written, undefined, {}, 'not-a-uuid');
      expect([spec.path, response.statusCode]).toEqual([spec.path, 404]);
      expect([spec.path, written]).toEqual([spec.path, []]);
    }
  });

  it('opens NO transaction for the reconciliation read', async () => {
    const written: Written[] = [];
    const response = await callAs('readonly', RECONCILIATION, written);
    expect(response.statusCode).toBe(200);
    expect(written).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// 7. THE SPEND LIMIT, WHICH IS THE ONE ROW THAT COMPLETES
// -----------------------------------------------------------------------------

describe('POST /admin/wallet/:identityId/spend-limit', () => {
  it('appends the row the contract describes and answers the response it describes', async () => {
    const written: Written[] = [];
    const response = await callAs('owner', SPEND_LIMIT, written);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      identity_id: IDENTITY_ID,
      daily_cents: 25_000,
      rolling_7d_cents: 100_000,
      effective_from: EFFECTIVE_FROM,
      set_by: 'sso:owner@merit',
      created_at: AT.toISOString(),
    } satisfies SpendLimitResponse);

    const append = written.find((w) => w.kind === 'insert' && w.table === 'walletSpendLimits');
    expect(append?.values).toEqual({
      identityId: IDENTITY_ID,
      dailyCents: 25_000n,
      rolling7dCents: 100_000n,
      reason: SPEND_LIMIT_BODY['reason'],
      setBy: 'sso:owner@merit',
      effectiveFrom: new Date(EFFECTIVE_FROM),
    });
  });

  it('writes MONEY AS BIGINT into the row and never as a JSON number', async () => {
    const written: Written[] = [];
    await callAs('owner', SPEND_LIMIT, written);
    const append = written.find((w) => w.kind === 'insert' && w.table === 'walletSpendLimits');
    expect(typeof append?.values['dailyCents']).toBe('bigint');
    expect(typeof append?.values['rolling7dCents']).toBe('bigint');
  });

  it('takes `set_by` from the SESSION and ignores a body that supplies one', async () => {
    // API_CONTRACT: "the admin actor, from the session. NEVER from the body."
    const written: Written[] = [];
    const response = await callAs('ops', SPEND_LIMIT, written, {
      ...SPEND_LIMIT_BODY,
      set_by: 'sso:attacker@merit',
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as SpendLimitResponse).set_by).toBe('sso:ops@merit');
    const append = written.find((w) => w.kind === 'insert' && w.table === 'walletSpendLimits');
    expect(append?.values['setBy']).toBe('sso:ops@merit');
  });

  it('admits `daily_cents: 0`, which means no wallet spend and not "no limit"', async () => {
    const response = await callAs('owner', SPEND_LIMIT, [], {
      ...SPEND_LIMIT_BODY,
      daily_cents: 0,
      rolling_7d_cents: 0,
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as SpendLimitResponse).daily_cents).toBe(0);
  });

  it('refuses a rolling weekly limit below the daily one, which is the CHECK', async () => {
    const response = await callAs('owner', SPEND_LIMIT, [], {
      ...SPEND_LIMIT_BODY,
      daily_cents: 100_000,
      rolling_7d_cents: 25_000,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'validation_failed',
      errors: [{ path: 'rolling_7d_cents' }],
    });
  });

  it('refuses a negative or fractional figure', async () => {
    for (const [key, value] of [
      ['daily_cents', -1],
      ['daily_cents', 12.5],
      ['rolling_7d_cents', -1],
    ] as const) {
      const response = await callAs('owner', SPEND_LIMIT, [], {
        ...SPEND_LIMIT_BODY,
        [key]: value,
      });
      expect([key, value, response.statusCode]).toEqual([key, value, 400]);
    }
  });

  it('answers `conflict` when a row already exists at this `effective_from`', async () => {
    const written: Written[] = [];
    const response = await callAs('owner', SPEND_LIMIT, written, undefined, {
      limits: [
        {
          dailyCents: 10_000n,
          rolling7dCents: 50_000n,
          effectiveFrom: new Date(EFFECTIVE_FROM),
          setBy: 'sso:ops@merit',
        },
      ],
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'conflict' });
    // AND NOTHING WAS WRITTEN. The re-read is the refusal, so the audit row and
    // the append are both absent.
    expect(written.filter((w) => w.kind === 'insert')).toEqual([]);
  });

  it('records the SUPERSEDED limit in `admin_actions.before`, under database names', async () => {
    const written: Written[] = [];
    await callAs('owner', SPEND_LIMIT, written, undefined, {
      limits: [
        {
          dailyCents: 10_000n,
          rolling7dCents: 50_000n,
          effectiveFrom: new Date(EXISTING_FROM),
          setBy: 'sso:ops@merit',
        },
      ],
    });
    const audit = written.find((w) => w.kind === 'insert' && w.table === 'adminActions');
    expect(audit?.values['before']).toEqual({
      daily_cents: 10_000,
      rolling_7d_cents: 50_000,
      effective_from: EXISTING_FROM,
      set_by: 'sso:ops@merit',
    });
    expect(audit?.values['after']).toEqual({
      daily_cents: 25_000,
      rolling_7d_cents: 100_000,
      effective_from: EFFECTIVE_FROM,
      set_by: 'sso:owner@merit',
    });
    expect(audit?.values['subjectKind']).toBe('identity');
    expect(audit?.values['subjectId']).toBe(IDENTITY_ID);
    expect(audit?.values['initiative']).toBe('operational');
  });

  it('records `null` in `before` when this is the first limit this identity has had', async () => {
    const written: Written[] = [];
    await callAs('owner', SPEND_LIMIT, written);
    const audit = written.find((w) => w.kind === 'insert' && w.table === 'adminActions');
    expect(audit?.values['before']).toEqual({ wallet_spend_limits: null });
  });

  it('OMITS `reason` rather than defaulting it, so the NOT NULL is the control', async () => {
    const written: Written[] = [];
    const body = { ...SPEND_LIMIT_BODY };
    delete body['reason'];
    await callAs('owner', SPEND_LIMIT, written, body);
    const audit = written.find((w) => w.kind === 'insert' && w.table === 'adminActions');
    expect(audit).toBeDefined();
    expect('reason' in (audit?.values ?? {})).toBe(false);
  });

  it('refuses an EMPTY reason here, because a NOT NULL column admits one', async () => {
    const response = await callAs('owner', SPEND_LIMIT, [], { ...SPEND_LIMIT_BODY, reason: '  ' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ path: 'reason' }] });
  });
});

// -----------------------------------------------------------------------------
// 8. `limitInForce`, which is the fold the accessor's missing ORDER BY costs
// -----------------------------------------------------------------------------

describe('limitInForce', () => {
  const row = (from: string, daily: bigint): SpendLimitRow => ({
    dailyCents: daily,
    rolling7dCents: daily * 4n,
    effectiveFrom: from,
    setBy: 'sso:ops@merit',
  });

  it('is null when nothing has taken effect yet', () => {
    expect(limitInForce([], EFFECTIVE_FROM)).toBeNull();
    expect(limitInForce([row('2026-12-01T00:00:00.000Z', 1n)], EFFECTIVE_FROM)).toBeNull();
  });

  it('is the greatest `effective_from` that has arrived and NOT the newest row', () => {
    const rows = [
      row('2026-07-01T00:00:00.000Z', 1n),
      row('2026-12-01T00:00:00.000Z', 3n),
      row(EXISTING_FROM, 2n),
    ];
    expect(limitInForce(rows, EFFECTIVE_FROM)?.dailyCents).toBe(2n);
  });

  it('includes a row effective at exactly this instant', () => {
    expect(limitInForce([row(EFFECTIVE_FROM, 7n)], EFFECTIVE_FROM)?.dailyCents).toBe(7n);
  });
});

// -----------------------------------------------------------------------------
// 9. THE CORRECTION, UP TO THE APPEND IT CANNOT COMPOSE
// -----------------------------------------------------------------------------

describe('POST /admin/wallet/:identityId/correct', () => {
  it('answers the contract response when a backend supplies the write', async () => {
    const response = await callAs('owner', CORRECT);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      entry_id: '42',
      provenance: 'correction',
      direction: 'credit',
      amount_cents: 5_000,
      balance_after_cents: 255_000,
      ledger_transaction_id: LEDGER_TX,
      occurred_at: AT.toISOString(),
    } satisfies WalletCorrectionResponse);
  });

  it('renders `entry_id` as a DECIMAL STRING and never as a JSON number', async () => {
    // ADR-158 clause 3: `wallet_entries.id` is a `bigint` identity, and a JSON
    // number would lose digits past 2^53 with every type in the workspace green.
    const response = await callAs('owner', CORRECT);
    const body = response.json() as WalletCorrectionResponse;
    expect(typeof body.entry_id).toBe('string');
    expect(body.entry_id).toMatch(/^[0-9]+$/);
  });

  it('refuses a `corrects_entry_id` that is not a decimal string', async () => {
    for (const value of ['41.0', '0x29', 'not-a-number', '55555555-5555-4555-8555-555555555555'])
      expect([
        value,
        (await callAs('owner', CORRECT, [], { ...CORRECTION_BODY, corrects_entry_id: value }))
          .statusCode,
      ]).toEqual([value, 400]);
  });

  it('answers `conflict` when the corrected entry is not this identity"s', async () => {
    const written: Written[] = [];
    const response = await callAs('owner', CORRECT, written, {
      ...CORRECTION_BODY,
      corrects_entry_id: '9999',
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'conflict' });
    // AND NOTHING WAS WRITTEN, because the re-read is the refusal.
    expect(written.filter((w) => w.kind === 'insert' || w.kind === 'correction')).toEqual([]);
  });

  it('refuses SELF-APPROVAL with `precondition_failed` and appends nothing', async () => {
    const written: Written[] = [];
    const response = await callAs('owner', CORRECT, written, {
      ...CORRECTION_BODY,
      second_approver: 'sso:owner@merit',
    });
    expect(response.statusCode).toBe(412);
    expect(response.json()).toMatchObject({ code: 'precondition_failed' });
    // THE LOCK IS TAKEN AND NOTHING ELSE HAPPENS, which is the difference between
    // this refusal and the 403 above. A dual-control failure is a BUSINESS
    // refusal decided inside the transaction, exactly as every other body
    // validation in this module and in `admin-payouts.ts` is, and the throw rolls
    // it back. `INV-M5-23`'s empty-recorder property is about the AUTHORIZATION
    // refusals and is asserted on those; asserting it here would be asserting a
    // different invariant under its name.
    expect(written.map((w) => w.kind)).toEqual(['lock']);
  });

  it('requires `second_approver` at all', async () => {
    const body = { ...CORRECTION_BODY };
    delete body['second_approver'];
    const response = await callAs('owner', CORRECT, [], body);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ path: 'second_approver' }] });
  });

  it('refuses a zero, negative or fractional amount', async () => {
    for (const value of [0, -1, 12.5])
      expect([
        value,
        (await callAs('owner', CORRECT, [], { ...CORRECTION_BODY, amount_cents: value }))
          .statusCode,
      ]).toEqual([value, 400]);
  });

  it('refuses a direction outside the column"s own CHECK', async () => {
    const response = await callAs('owner', CORRECT, [], {
      ...CORRECTION_BODY,
      direction: 'reversal',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ path: 'direction' }] });
  });

  it('answers `insufficient_funds` for a debit below the balance floor', async () => {
    const written: Written[] = [];
    const response = await callAs('owner', CORRECT, written, {
      ...CORRECTION_BODY,
      direction: 'debit',
      amount_cents: 999_000,
    });
    expect(response.statusCode).toBe(INSUFFICIENT_FUNDS_STATUS);
    expect(response.json()).toMatchObject({ code: 'insufficient_funds' });
    // The refusal is made from the balance the lock froze, so no append is
    // attempted at all: "the remedy is a debt rather than a negative wallet".
    expect(written.filter((w) => w.kind === 'correction')).toEqual([]);
  });

  it('admits a debit up to exactly the balance, which the CHECK admits', async () => {
    const response = await callAs('owner', CORRECT, [], {
      ...CORRECTION_BODY,
      direction: 'debit',
      amount_cents: 250_000,
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as WalletCorrectionResponse).balance_after_cents).toBe(0);
  });

  it('computes the balance off the greatest `id` and NOT the greatest `occurred_at`', async () => {
    // `wallet.ts`'s header calls this "the one thing in this file most likely to
    // be 'fixed' into a defect". A backdated correction carries a past
    // `occurred_at` and still holds the current running balance.
    const written: Written[] = [];
    await callAs('owner', CORRECT, written, undefined, {
      entries: [
        {
          ...ENTRY,
          id: 41n,
          balanceAfterCents: 250_000n,
          occurredAt: new Date('2026-08-26T00:00:00.000Z'),
        },
        {
          ...ENTRY,
          id: 42n,
          provenance: 'correction',
          balanceAfterCents: 90_000n,
          occurredAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
    });
    const draft = written.find((w) => w.kind === 'correction');
    expect(draft?.values['balanceBeforeCents']).toBe(90_000n);
  });

  it('records the frozen balance and the corrected entry in `admin_actions.before`', async () => {
    const written: Written[] = [];
    await callAs('owner', CORRECT, written);
    const audit = written.find((w) => w.kind === 'insert' && w.table === 'adminActions');
    expect(audit?.values['before']).toEqual({
      balance_after_cents: 250_000,
      corrected_entry: {
        id: '41',
        direction: 'credit',
        amount_cents: 250_000,
        provenance: 'payout',
        cause: 'payout 7712 settled',
        balance_after_cents: 250_000,
        occurred_at: '2026-08-20T10:00:00.000Z',
      },
    });
    expect(audit?.values['evidenceRefs']).toEqual([
      { kind: 'second_approver', ref: 'sso:ops@merit' },
      { kind: 'wallet_entry', ref: '41' },
    ]);
    expect(audit?.values['initiative']).toBe('operational');
    // `on_behalf_of_identity_id` is admitted only under `trader_request` by
    // `admin_actions_on_behalf_matches_initiative`, and this act is not the
    // trader's.
    expect('onBehalfOfIdentityId' in (audit?.values ?? {})).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // ADR-173 clauses 4 and 5, applied. `corrects_entry_id` IS OPTIONAL
  // ---------------------------------------------------------------------------
  // A `goodwill` adjustment corrects no entry at all, the database accepts one,
  // and it lands as `provenance = 'correction'` because `0011`'s closed list
  // offers no other value for an adjustment. ADR-173 confirmed that by
  // execution, so a REQUIRED field here would make a case `0038` built its
  // nullable `account_id` for unreachable through the only endpoint that
  // reaches it.

  const WITHOUT_CORRECTED_ENTRY = (() => {
    const body = { ...CORRECTION_BODY };
    delete body['corrects_entry_id'];
    return body;
  })();

  it('admits a correction that names NO entry, which is the goodwill case', async () => {
    const response = await callAs('owner', CORRECT, [], WITHOUT_CORRECTED_ENTRY);
    expect(response.statusCode).toBe(200);
    // AND IT IS STILL A CORRECTION. There is no other provenance an adjustment
    // may claim, so "corrects nothing" and "is not a correction" are different
    // statements and only the first one is true here.
    expect((response.json() as WalletCorrectionResponse).provenance).toBe('correction');
  });

  it('hands the port `undefined` rather than a placeholder when no entry is named', async () => {
    const written: Written[] = [];
    await callAs('owner', CORRECT, written, WITHOUT_CORRECTED_ENTRY);
    const draft = written.find((w) => w.kind === 'correction');
    expect(draft).toBeDefined();
    expect('correctsEntryId' in (draft?.values ?? {})).toBe(true);
    expect(draft?.values['correctsEntryId']).toBeUndefined();
  });

  it('OMITS `corrected_entry` and the `wallet_entry` ref rather than nulling them', async () => {
    // A `corrected_entry` of `null` would be this handler asserting that an
    // entry was looked for and not found, which is a different claim from the
    // operator naming none. `admin_actions` is append-only, so the row cannot be
    // corrected afterwards and the distinction is permanent.
    const written: Written[] = [];
    await callAs('owner', CORRECT, written, WITHOUT_CORRECTED_ENTRY);
    const audit = written.find((w) => w.kind === 'insert' && w.table === 'adminActions');
    expect(audit?.values['before']).toEqual({ balance_after_cents: 250_000 });
    expect(audit?.values['evidenceRefs']).toEqual([
      { kind: 'second_approver', ref: 'sso:ops@merit' },
    ]);
  });

  it('takes the lock and writes the audit row for a correction that names no entry', async () => {
    // THE ORDER IS THE CONTROL AND OPTIONALITY DOES NOT MOVE IT. A body that
    // omits the field skips the `conflict` comparison and nothing else: the
    // lock is still first and the `admin_actions` row is still before the
    // append.
    const written: Written[] = [];
    await callAs('owner', CORRECT, written, WITHOUT_CORRECTED_ENTRY);
    expect(written.map((w) => w.kind)).toEqual(['lock', 'rows', 'insert', 'correction']);
  });

  it('still refuses a `corrects_entry_id` that is PRESENT and malformed', async () => {
    // Optional widens what the endpoint accepts and weakens nothing about what
    // it accepts. ADR-173 clause 5: an operator who names an entry gets it
    // validated, and an operator who names none has nothing to validate.
    const response = await callAs('owner', CORRECT, [], {
      ...CORRECTION_BODY,
      corrects_entry_id: 'not-a-number',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errors: [{ path: 'corrects_entry_id' }] });
  });

  it('hands the port MONEY AS BIGINT and never as a JSON number', async () => {
    const written: Written[] = [];
    await callAs('owner', CORRECT, written);
    const draft = written.find((w) => w.kind === 'correction');
    expect(typeof draft?.values['amountCents']).toBe('bigint');
    expect(typeof draft?.values['balanceBeforeCents']).toBe('bigint');
    expect(typeof draft?.values['correctsEntryId']).toBe('bigint');
  });

  it('turns the balance-floor CHECK into `insufficient_funds` and not `validation_failed`', async () => {
    // The second line, for the writer this transaction could not see. The error
    // arrives Drizzle-wrapped, which is why the cause chain is walked.
    const response = await callAs('owner', CORRECT, [], undefined, {
      correctionFailure: new Error('query failed', {
        cause: {
          code: '23514',
          table: 'wallet_entries',
          constraint: 'wallet_entries_balance_after_cents_check',
          message: 'new row violates check constraint',
        },
      }),
    });
    expect(response.statusCode).toBe(INSUFFICIENT_FUNDS_STATUS);
    expect(response.json()).toMatchObject({ code: 'insufficient_funds' });
  });

  it('turns a NOT NULL refusal into `validation_failed` naming the column', async () => {
    const response = await callAs('owner', CORRECT, [], undefined, {
      correctionFailure: new Error('query failed', {
        cause: {
          code: '23502',
          table: 'admin_actions',
          column: 'reason',
          message: 'null value in column "reason"',
        },
      }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'validation_failed',
      errors: [{ path: 'reason' }],
    });
  });
});

// -----------------------------------------------------------------------------
// 10. THE RECONCILIATION READ, AND THE ARITHMETIC IT ASSERTS ABOUT ITSELF
// -----------------------------------------------------------------------------
// This is the half of the endpoint this fence can build. Every assertion here is
// one an adapter written six weeks from now would otherwise be free to break.

describe('GET /admin/wallet/reconciliation', () => {
  const row = {
    identity_id: IDENTITY_ID,
    entries_position_cents: 250_000,
    ledger_position_cents: 240_000,
    divergence_cents: 10_000,
    stored_balance_cents: 250_000,
    recomputed_balance_cents: 250_000,
    balance_divergence_cents: 0,
  };

  it('serves the healthy answer, which is an empty array and a denominator', async () => {
    const response = await callAs('readonly', RECONCILIATION);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(HEALTHY_RECONCILIATION);
  });

  it('reports BOTH comparisons, which is ADR-158 clause 11', async () => {
    const response = await callAs('owner', RECONCILIATION, [], undefined, {
      reconciliation: { ...HEALTHY_RECONCILIATION, divergent: [row] },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as WalletReconciliationResponse;
    expect(body.divergent[0]).toMatchObject({
      divergence_cents: 10_000,
      balance_divergence_cents: 0,
    });
  });

  it('keeps float as its own object and never folds it into a coverage figure', async () => {
    const response = await callAs('owner', RECONCILIATION);
    const body = response.json() as WalletReconciliationResponse;
    expect(Object.keys(body).sort()).toEqual(
      ['as_of', 'divergent', 'float', 'identities_checked'].sort(),
    );
    expect(body.float).toEqual({ total_cents: 4_250_000, identities_with_balance: 9 });
  });

  it('refuses a response whose `divergence_cents` is not the subtraction', () => {
    expect(() =>
      assertReconciliation({
        ...HEALTHY_RECONCILIATION,
        divergent: [{ ...row, divergence_cents: 1 }],
      }),
    ).toThrow(AdminWalletMoneyError);
  });

  it('refuses a response whose `balance_divergence_cents` is not the subtraction', () => {
    expect(() =>
      assertReconciliation({
        ...HEALTHY_RECONCILIATION,
        divergent: [{ ...row, balance_divergence_cents: 5 }],
      }),
    ).toThrow(AdminWalletMoneyError);
  });

  it('refuses a HEALTHY row inside `divergent`, which is a dump wearing an alarm"s name', () => {
    expect(() =>
      assertReconciliation({
        ...HEALTHY_RECONCILIATION,
        divergent: [
          {
            ...row,
            entries_position_cents: 250_000,
            ledger_position_cents: 250_000,
            divergence_cents: 0,
          },
        ],
      }),
    ).toThrow(AdminWalletMoneyError);
  });

  it('refuses a denominator below its own numerator', () => {
    expect(() =>
      assertReconciliation({ ...HEALTHY_RECONCILIATION, identities_checked: 0, divergent: [row] }),
    ).toThrow(AdminWalletMoneyError);
  });

  it('refuses a float on any `_cents` member, wherever it appears', () => {
    expect(() =>
      assertReconciliation({
        ...HEALTHY_RECONCILIATION,
        float: { total_cents: 4_250_000.5, identities_with_balance: 9 },
      }),
    ).toThrow(AdminWalletMoneyError);
    expect(() =>
      assertReconciliation({
        ...HEALTHY_RECONCILIATION,
        divergent: [{ ...row, entries_position_cents: 250_000.5 }],
      }),
    ).toThrow(AdminWalletMoneyError);
  });

  it('answers 500 rather than a wrong number when the adapter contradicts the contract', async () => {
    // `assertReconciliation` throws, `server.ts`'s default handler maps an
    // unmapped throw to `internal_error`, and an operator sees a failure rather
    // than a reconciliation they would act on.
    const response = await callAs('owner', RECONCILIATION, [], undefined, {
      reconciliation: { ...HEALTHY_RECONCILIATION, divergent: [{ ...row, divergence_cents: 1 }] },
    });
    expect(response.statusCode).toBe(500);
  });
});
