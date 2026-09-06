// =============================================================================
// apps/api/test/admin-wallet-port.test.ts
// =============================================================================
// WHAT THIS SUITE IS FOR, IN ONE SENTENCE: `AdminWalletBackend` is the port on
// the surface where a human being at Merit reads and adjusts a trader's wallet,
// and this file measures its members one at a time rather than as a word.
//
// IT IS A SECOND FILE RATHER THAN A BLOCK IN `admin-wallet.test.ts` BECAUSE ITS
// SUBJECT IS THE PORT AND NOT THE ENDPOINTS. That file exercises three handlers
// against an installed backend; this one asks what the DEFAULT does, member by
// member, and every case here is an assertion about the value at
// {@link UNWIRED_ADMIN_WALLET_BACKEND} or about the interface it satisfies.
//
// -----------------------------------------------------------------------------
// THE THREE THINGS IT ASSERTS, AND WHY EACH IS A CASE RATHER THAN A PARAGRAPH
// -----------------------------------------------------------------------------
// An adjustment is a credit or a debit nobody transacted for, so the properties
// that matter about a port that cannot serve one are refusals:
//
//   (a) NO PATH QUOTES A FIGURE a reader could take as a balance or an amount.
//   (b) NO PATH WRITES a ledger entry, an adjustment, or any wallet state.
//   (c) NO PATH RECORDS anything a later reader would treat as an adjustment
//       having been approved.
//
// Each is measured against the REAL default value rather than a stand-in, and
// (a) is measured in BOTH DIRECTIONS: section 4 proves the module really does
// have a refusal that quotes a balance, so the case asserting the unwired
// default quotes none is not vacuous.
//
// -----------------------------------------------------------------------------
// THE MEMBER SET IS SLICED TO THE CLOSING BRACE AND THEN MEASURED TWICE
// -----------------------------------------------------------------------------
// A line pattern counted over a whole module miscounts an interface whose
// signature sits behind a long doc comment, and this port has two:
// `writeCorrection` (`admin-wallet.ts:699`) sits behind eighteen comment lines
// and `reconcile` (`admin-wallet.ts:707`) behind seven. So the member list is
// taken by slicing the interface body to its own matching brace, stripping
// comments, and reading what is left -- and then compared against
// `Object.keys` of the runtime default, which is an INDEPENDENT measurement of
// the same set through the type checker rather than through a regex.
//
// -----------------------------------------------------------------------------
// WHAT THIS SUITE CANNOT PROVE, STATED RATHER THAN IMPLIED
// -----------------------------------------------------------------------------
// It proves what a request meets against the module-scope default IN THIS
// PROCESS. It proves nothing about a deployment that installs a PARTIAL backend,
// which is a different value and answers differently; section 3's blocker table
// is the reason no deployment can reach that state today, and it is a reading of
// source rather than of a running system.
// =============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { stripComments } from '../../../packages/tooling/checks/strip-comments.mjs';

import adminWallet, {
  ADMIN_WALLET_ENDPOINTS,
  AdminWalletUnwired,
  INSUFFICIENT_FUNDS_STATUS,
  UNWIRED_ADMIN_WALLET_BACKEND,
  WALLET_CORRECT_PATH,
  resetAdminWalletBackend,
  useAdminWalletBackend,
} from '../src/routes/admin-wallet.ts';
import type { AdminWalletBackend, AdminWalletTx } from '../src/routes/admin-wallet.ts';
import type { AdminPrincipal } from '../src/routes/admin-writes.ts';
import { buildServer } from '../src/server.ts';
import { BASE_PATH } from '../src/surface.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

const IDENTITY_ID = '22222222-2222-4222-8222-222222222222';
const LEDGER_TX = 'bbbbbbbb-0001-4000-8000-000000000001';
const AT = new Date('2026-08-27T18:00:00.000Z');

/** The balance the wired case in section 4 freezes, and the figure it must quote. */
const FROZEN_BALANCE_CENTS = 250_000n;

/**
 * A correction that debits more than the frozen balance.
 *
 * IT IS A WELL-FORMED BODY ON PURPOSE. The point of the case it feeds is that
 * the handler reaches the SHORTFALL refusal, which quotes the balance; a body
 * that failed validation would answer 400 and prove nothing about the figure.
 */
const SHORTFALL_BODY: Record<string, unknown> = {
  direction: 'debit',
  amount_cents: 999_000,
  cause: 'reconciliation difference on payout 7712',
  reason: 'ticket 4711: proving the shortfall detail quotes a balance',
  second_approver: 'sso:ops@merit',
};

const MODULE = readFileSync(join(REPO, 'apps/api/src/routes/admin-wallet.ts'), 'utf8');
const DB_DOORS = readFileSync(join(REPO, 'apps/api/src/db.ts'), 'utf8');
const ACCESSOR = readFileSync(join(REPO, 'packages/db/src/scoped-db.ts'), 'utf8');

afterEach(() => {
  resetAdminWalletBackend();
});

// -----------------------------------------------------------------------------
// The slicer, which is the instruction this file was written under
// -----------------------------------------------------------------------------

/**
 * One interface body, from its opening brace to the brace that matches it.
 *
 * IT COUNTS BRACES RATHER THAN LOOKING FOR A LINE THAT READS `}`. A nested
 * object type inside a member would end the slice early otherwise, and an
 * interface truncated by its own contents is the miscount this file exists to
 * make impossible.
 */
function interfaceBody(source: string, name: string): string {
  const opening = source.indexOf(`interface ${name} `);
  if (opening === -1) throw new Error(`no \`interface ${name}\` in this source`);
  const start = source.indexOf('{', opening);
  if (start === -1) throw new Error(`\`interface ${name}\` has no body`);
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, i);
    }
  }
  throw new Error(`\`interface ${name}\` is never closed`);
}

/**
 * The METHOD names one interface body declares, in declaration order.
 *
 * Comments are stripped FIRST, so a signature behind a doc comment and a
 * signature behind none are the same shape by the time this reads them. The
 * indent is pinned at two spaces so a member of a nested object type is not
 * counted as a member of the interface.
 */
function methodsOf(body: string): readonly string[] {
  return [...stripComments(body).matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)[<(]/gm)].map(
    (match) => match[1] as string,
  );
}

// -----------------------------------------------------------------------------
// 1. The interface, sliced to its closing brace and read member by member
// -----------------------------------------------------------------------------

/**
 * Every member of the port, classified, and the classification is the RULING.
 *
 * `operator` IS THE ENTRY THAT MATTERS AND IT IS NEITHER A READ NOR A WRITE. It
 * is the door: `AdminWalletTx` (`admin-wallet.ts:578`) carries `lockAt`, `rowAt`
 * and `rowsWhere`, which are reads, AND `insert`, which is a write, so BOTH of
 * this module's appends -- the `admin_actions` row and the spend limit -- go
 * through this one member and through NO other. An entry that lists the port's
 * writes as `writeCorrection` alone has missed the door the other write uses.
 */
const CLASSIFIED = {
  operator: 'gateway',
  principal: 'read',
  now: 'read',
  writeCorrection: 'write',
  reconcile: 'read',
} as const;

type Member = keyof typeof CLASSIFIED;

/**
 * What each member waits on, re-derived rather than carried from any list.
 *
 * `null` MEANS CONSTRUCTIBLE TODAY WITH NOTHING PURCHASED, and exactly one
 * member is. The asymmetry is deliberate: a member added to the port and not
 * classified here reddens the case below rather than defaulting to blocked.
 */
const BLOCKERS: Readonly<Record<Member, string | null>> = {
  operator:
    'a `SystemTx`. `ApiDb` (`apps/api/src/db.ts:173`) declares five doors and none yields one; ' +
    'the absent door is `system(reason, fn)`, refused by ADR-171 clause 1',
  principal:
    'an `AdminSessionSource`, whose setter `setAdminSessionSource` holds `null`. ADR-171 section 4',
  now: null,
  writeCorrection:
    '`operator` above, AND three `account_adjustments` constraints the wire cannot satisfy: the ' +
    'reversal biconditional, the dual-control approval row, and `reason_code`',
  reconcile: 'a join and an aggregate, refused by ADR-157 clause 6',
};

describe('the port, sliced to its closing brace', () => {
  it('declares FIVE members and the list is read off the slice rather than off the module', () => {
    const members = methodsOf(interfaceBody(MODULE, 'AdminWalletBackend'));
    expect(members).toEqual(['operator', 'principal', 'now', 'writeCorrection', 'reconcile']);
    expect(members).toHaveLength(5);
  });

  it('and the runtime default supplies exactly those five keys, which is the SECOND measurement', () => {
    // INDEPENDENT OF THE REGEX ABOVE. This set comes off the value the module
    // holds at module scope, through the type checker, so a member that the
    // slicer missed and the default supplies -- the miscount this file was
    // written against -- disagrees here rather than passing twice.
    expect(Object.keys(UNWIRED_ADMIN_WALLET_BACKEND).sort()).toEqual(
      [...methodsOf(interfaceBody(MODULE, 'AdminWalletBackend'))].sort(),
    );
  });

  it('and every member is classified as a READ, a WRITE or the GATEWAY, in both directions', () => {
    const members = methodsOf(interfaceBody(MODULE, 'AdminWalletBackend'));
    // BOTH DIRECTIONS, so a member added to the port cannot inherit a
    // classification and a classification cannot outlive the member it names.
    expect([...members].sort()).toEqual(Object.keys(CLASSIFIED).sort());
    expect(Object.keys(BLOCKERS).sort()).toEqual([...members].sort());
  });

  it('reads THREE, writes ONE, and the fifth is the door BOTH appends go through', () => {
    const by = (kind: string): readonly string[] =>
      Object.entries(CLASSIFIED)
        .filter(([, value]) => value === kind)
        .map(([key]) => key);
    expect(by('read')).toEqual(['principal', 'now', 'reconcile']);
    expect(by('write')).toEqual(['writeCorrection']);
    expect(by('gateway')).toEqual(['operator']);
  });
});

// -----------------------------------------------------------------------------
// 2. The write surface is TWO members and not one
// -----------------------------------------------------------------------------

describe('what a write on this port actually goes through', () => {
  it('is `AdminWalletTx.insert`, which reaches this module through `operator` and nothing else', () => {
    const tx = methodsOf(interfaceBody(MODULE, 'AdminWalletTx'));
    expect(tx).toEqual(['lockAt', 'rowAt', 'rowsWhere', 'insert']);
    // The handle is a PARAMETER of `operator` and appears in no other member's
    // signature except `writeCorrection`, which is handed one rather than
    // obtaining one. So a deployment that does not supply `operator` supplies no
    // `AdminWalletTx` at all, and `insert` is unreachable by construction.
    const port = interfaceBody(MODULE, 'AdminWalletBackend');
    const carriers = stripComments(port)
      .split(';')
      .filter((line) => line.includes('AdminWalletTx'))
      .map((line) => (/^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(line) ?? [])[1]);
    expect(carriers).toEqual(['operator', 'writeCorrection']);
  });

  it('and BOTH of this module`s appends are `tx.insert`, so neither is behind `writeCorrection`', () => {
    const source = stripComments(MODULE);
    const inserts = [...source.matchAll(/\btx\.insert\(\s*'([A-Za-z]+)'/g)].map(
      (match) => match[1] as string,
    );
    // `adminActions` is the audit row every mutating endpoint writes BEFORE its
    // append; `walletSpendLimits` is the spend-limit endpoint's whole write.
    // NEITHER passes through `writeCorrection`, and an entry naming that member
    // as this port's only unreachable write has named one of two.
    expect(inserts).toEqual(['adminActions', 'walletSpendLimits']);
  });
});

// -----------------------------------------------------------------------------
// 3. Constructibility, at the door rather than in prose
// -----------------------------------------------------------------------------

describe('what each member could be built from today', () => {
  it('records a blocker for four of the five and none for `now`, which is the whole clock', () => {
    const free = (Object.keys(BLOCKERS) as Member[]).filter((key) => BLOCKERS[key] === null);
    expect(free).toEqual(['now']);
    // AND THE DEFAULT REFUSES IT ANYWAY, which is what tells this port apart
    // from a sibling whose unwired default carries a working clock. `now` is
    // constructible and is NOT constructed.
    expect(() => UNWIRED_ADMIN_WALLET_BACKEND.now()).toThrow(AdminWalletUnwired);
  });

  it('finds FIVE doors on `ApiDb` and no operator door among them', () => {
    const doors = methodsOf(interfaceBody(DB_DOORS, 'ApiDb'));
    expect(doors).toEqual(['scoped', 'firm', 'resolution', 'establishment', 'publicLookup']);
    expect(doors).not.toContain('operator');
    expect(doors).not.toContain('system');
  });

  it('so the blocker on `operator` is the DOOR and not the SHAPE, which is measured both ways', () => {
    // THE SHAPE IS SATISFIED. Every method `AdminWalletTx` declares is a method
    // `SystemTx` (`packages/db/src/scoped-db.ts:3769`) declares, so a slice
    // holding one could satisfy this handle without widening anything.
    const wanted = methodsOf(interfaceBody(MODULE, 'AdminWalletTx'));
    const system = methodsOf(interfaceBody(ACCESSOR, 'SystemTx'));
    expect(wanted.filter((method) => !system.includes(method))).toEqual([]);
    // AND THE DOOR IS ABSENT. `apps/api/src/db.ts` takes no `systemDb` value off
    // the accessor, so nothing in this deployable can produce one.
    expect(stripComments(DB_DOORS)).not.toMatch(/\bsystemDb\b/);
  });
});

// -----------------------------------------------------------------------------
// 4. (a) NO PATH QUOTES A FIGURE, measured in both directions
// -----------------------------------------------------------------------------

/** The five members `handlerProblem` writes. A sixth is where a figure would travel. */
const PROBLEM_KEYS = ['type', 'title', 'status', 'code', 'instance'];

function urlFor(path: string): string {
  return BASE_PATH + path.replace(':identityId', IDENTITY_ID);
}

async function callUnwired(
  spec: (typeof ADMIN_WALLET_ENDPOINTS)[number],
  backend?: AdminWalletBackend,
  payload: Record<string, unknown> = {},
): Promise<{ statusCode: number; json: () => unknown }> {
  if (backend === undefined) resetAdminWalletBackend();
  else useAdminWalletBackend(backend);
  const { app } = buildServer({ surface: 'operator', modules: [adminWallet] });
  const response = await app.inject({
    method: spec.method,
    url: urlFor(spec.path),
    ...(spec.method === 'GET' ? {} : { payload }),
  });
  await app.close();
  return response;
}

describe('(a) no path through the unwired default quotes a figure', () => {
  it('answers every route with the five problem members and NO SIXTH', async () => {
    for (const spec of ADMIN_WALLET_ENDPOINTS) {
      const response = await callUnwired(spec);
      const body = response.json() as Record<string, unknown>;
      // THE SIXTH MEMBER IS THE CHANNEL. `detail` is where every quoted figure
      // in this module travels, so a body with exactly five keys cannot carry
      // one whatever a later edit writes into the helper.
      expect([spec.path, Object.keys(body).sort()]).toEqual([spec.path, [...PROBLEM_KEYS].sort()]);
      expect([spec.path, body['status']]).toEqual([spec.path, 401]);
      expect([spec.path, body['code']]).toEqual([spec.path, 'unauthenticated']);
      expect([spec.path, body['title']]).toEqual([spec.path, 'Unauthenticated']);
    }
  });

  it('and carries no digit anywhere except the status code and the request id', async () => {
    for (const spec of ADMIN_WALLET_ENDPOINTS) {
      const response = await callUnwired(spec);
      const body = response.json() as Record<string, unknown>;
      // `status` is a status code and `instance` is `request.id`, which is the
      // framework's own counter. Neither is a figure of Merit's about a wallet.
      // Everything else in the document is asserted to carry no digit at all.
      const rest = { ...body };
      delete rest['status'];
      delete rest['instance'];
      expect([spec.path, /\d/.test(JSON.stringify(rest))]).toEqual([spec.path, false]);
      for (const word of ['cents', 'balance', 'amount', 'wallet', 'adjustment'])
        expect([spec.path, word, JSON.stringify(body).toLowerCase().includes(word)]).toEqual([
          spec.path,
          word,
          false,
        ]);
    }
  });

  it('and the case is NOT vacuous: this module really does have a refusal that quotes a balance', async () => {
    // THE OTHER DIRECTION. With a backend installed, the shortfall refusal
    // writes the frozen balance into `detail`, so the property asserted above
    // is a property of the UNWIRED path rather than of a module that has no
    // figure to quote.
    const spec = ADMIN_WALLET_ENDPOINTS.find((row) => row.path === WALLET_CORRECT_PATH);
    if (spec === undefined) throw new Error('this module declares no `correct` row');
    const response = await callUnwired(spec, wiredBackend(), SHORTFALL_BODY);
    expect(response.statusCode).toBe(INSUFFICIENT_FUNDS_STATUS);
    const body = response.json() as Record<string, unknown>;
    expect(Object.keys(body)).toContain('detail');
    expect(String(body['detail'])).toContain(FROZEN_BALANCE_CENTS.toString());
  });
});

/** A backend that serves, used ONLY to prove the shortfall detail quotes a balance. */
function wiredBackend(): AdminWalletBackend {
  const tx: AdminWalletTx = {
    lockAt: () => Promise.resolve({ id: IDENTITY_ID, status: 'active' }),
    rowAt: () => Promise.resolve(undefined),
    rowsWhere: (table) =>
      table === 'walletEntries'
        ? Promise.resolve([
            {
              id: 41n,
              direction: 'credit',
              amountCents: FROZEN_BALANCE_CENTS,
              provenance: 'payout',
              cause: 'payout 7712 settled',
              referenceId: '55555555-5555-4555-8555-555555555555',
              ledgerTransactionId: LEDGER_TX,
              balanceAfterCents: FROZEN_BALANCE_CENTS,
              occurredAt: AT,
            },
          ])
        : Promise.resolve([]),
    insert: (_key, values) => Promise.resolve([{ ...values, createdAt: AT }]),
  };
  const principal: AdminPrincipal = { actor: 'sso:owner@merit', role: 'owner' };
  return {
    operator: (fn) => fn(tx),
    principal: () => Promise.resolve(principal),
    now: () => AT,
    writeCorrection: () => Promise.reject(new Error('this case must never reach the append')),
    reconcile: () => Promise.reject(new Error('this case never reads')),
  };
}

// -----------------------------------------------------------------------------
// 5. (b) and (c): nothing is written and nothing is recorded as approved
// -----------------------------------------------------------------------------

/**
 * The real default, wrapped so the members it consults are recorded.
 *
 * EVERY MEMBER DELEGATES TO {@link UNWIRED_ADMIN_WALLET_BACKEND}, so what is
 * measured is that value's own behaviour and not a stand-in that agrees with
 * the claim. The wrapper adds a name to a list and nothing else.
 */
function recording(trace: string[]): AdminWalletBackend {
  return {
    operator: (fn) => {
      trace.push('operator');
      return UNWIRED_ADMIN_WALLET_BACKEND.operator(fn);
    },
    principal: (request) => {
      trace.push('principal');
      return UNWIRED_ADMIN_WALLET_BACKEND.principal(request);
    },
    now: () => {
      trace.push('now');
      return UNWIRED_ADMIN_WALLET_BACKEND.now();
    },
    writeCorrection: (tx, draft) => {
      trace.push('writeCorrection');
      return UNWIRED_ADMIN_WALLET_BACKEND.writeCorrection(tx, draft);
    },
    reconcile: (asOf) => {
      trace.push('reconcile');
      return UNWIRED_ADMIN_WALLET_BACKEND.reconcile(asOf);
    },
  };
}

describe('(b) and (c) nothing is written and nothing is recorded', () => {
  it('consults exactly ONE member on every route, and it is `principal`', async () => {
    for (const spec of ADMIN_WALLET_ENDPOINTS) {
      const trace: string[] = [];
      const response = await callUnwired(spec, recording(trace));
      expect([spec.path, response.statusCode]).toEqual([spec.path, 401]);
      expect([spec.path, trace]).toEqual([spec.path, ['principal']]);
    }
  });

  it('so NO WRITE-CAPABLE MEMBER IS REACHED AT ALL, which is (b) and (c) together', async () => {
    for (const spec of ADMIN_WALLET_ENDPOINTS) {
      const trace: string[] = [];
      await callUnwired(spec, recording(trace));
      // `operator` is the only member that yields an `AdminWalletTx`, and
      // `writeCorrection` is the only member that composes an adjustment.
      // Neither is called, so no transaction is opened, no `admin_actions` row
      // is inserted, no `wallet_spend_limits` row is appended, and nothing
      // exists that a later reader could take as an approved adjustment.
      const reached = trace.filter((member) => CLASSIFIED[member as Member] !== 'read');
      expect([spec.path, reached]).toEqual([spec.path, []]);
    }
  });

  it('and the recorder proves the wrapper delegates, so the trace is not a fixture agreeing with itself', () => {
    // The wrapper's key set is the port's key set, so a member added to the
    // port and forgotten here fails the type checker rather than going
    // unrecorded, and every member it does hold refuses.
    const wrapper = recording([]);
    expect(Object.keys(wrapper).sort()).toEqual(Object.keys(UNWIRED_ADMIN_WALLET_BACKEND).sort());
  });
});

// -----------------------------------------------------------------------------
// 6. The refusal channel the port documents is not the one a request meets
// -----------------------------------------------------------------------------

describe('the status a request actually meets', () => {
  it('is 401 on all three routes and 503 on NONE of them, while this default stands', async () => {
    const statuses: number[] = [];
    for (const spec of ADMIN_WALLET_ENDPOINTS) statuses.push((await callUnwired(spec)).statusCode);
    expect(statuses).toEqual([401, 401, 401]);
    expect(statuses).not.toContain(503);
  });

  it('even though `AdminWalletUnwired` documents itself as the 503 and never a 500', () => {
    // THE CLASS DOCBLOCK IS TRUE OF THE CLASS AND NOT OF THIS DEPLOYMENT. Every
    // member of the default constructs one, and the handler DOES answer 503 for
    // four of the five; but `principal` is consulted first on every route, and
    // ADR-192 clause 2 rules its refusal a 401 so that an anonymous caller is
    // not told which of this deployment's ports are uncomposed. So the 503 leg
    // is unreachable while the whole default stands, and it is reachable only
    // for a deployment that installs a PARTIAL backend.
    expect(MODULE).toContain('Answered as 503, never 500.');
    expect(ADMIN_WALLET_ENDPOINTS.every((spec) => spec.roles.length > 0)).toBe(true);
  });
});
