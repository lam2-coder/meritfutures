// =============================================================================
// apps/api/test/admin-payout-refusal.test.ts -- CI-02, `unit`.
// =============================================================================
// THE SURFACE ON WHICH A HUMAN BEING AT MERIT APPROVES OR REFUSES A TRADER'S
// MONEY LEAVING. `useAdminPayoutBackend` is one of the fourteen ports
// `start.ts` does not call, and the two rows behind it are
// `POST /admin/payouts/:id/release`, which posts `LT-01` and pays, and
// `POST /admin/payouts/:id/enforce`, which fails the request and frees the rung.
// What this file asserts is what a request MEETS at that port today, derived by
// driving the routes rather than by reading their docblocks.
//
// -----------------------------------------------------------------------------
// WHY THE CENSUS IS BRACE MATCHED AND NOT GREPPED
// -----------------------------------------------------------------------------
// `money-out-refusal.test.ts` is the precedent and the reason applies harder
// here. `AdminPayoutTx`'s fifth member is `readonly ledger: LedgerTx` and it
// sits behind a twenty-three line doc comment, so it matches no
// call-signature pattern and is past any windowed read. The counts below are
// taken by matching braces over a comment-stripped body, and the naive pattern
// is RUN BESIDE the real one and asserted to disagree, so the reason for the
// method is executed rather than stated. ADR-357 section 3 is the precedent for
// that shape: a probe that read a WORD classified thirteen ports correctly and
// the fourteenth wrongly.
//
// -----------------------------------------------------------------------------
// THE TWO REFUSAL PROPERTIES, WHICH ARE THE POINT OF THE FILE
// -----------------------------------------------------------------------------
// A money-out console that is not installed must do two things and this file
// asserts both as cases rather than describing them. (a) No path through the
// unwired default may quote a figure a reader could take as an amount, a
// balance or a fee. (b) No path through it may record an approval, a state
// change, or anything a later reader would treat as a decision having been
// made. Both are asserted against the SHIPPED default rather than against a
// stand-in, by wrapping its own members in counting delegates.
//
// -----------------------------------------------------------------------------
// WHAT THIS FILE CANNOT PROVE
// -----------------------------------------------------------------------------
// It drives the two rows over `app.inject` against the shipped module-scope
// default. It proves what that default does and which of its members are
// touched, in what order. It proves NOTHING about a deployment: whether the
// process serving real traffic holds this default is `start.ts`'s question, and
// `start.ts` is read here as text and never executed. It also proves nothing
// about whether a FUTURE adapter would be correct; it asserts only that no
// value in this deployable can be one today, and why.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { stripComments } from '../../../packages/tooling/checks/strip-comments.mjs';

import { LIVE_DB } from '../src/db.ts';
import adminPayouts, {
  ADMIN_PAYOUT_ENDPOINTS,
  ADMIN_PAYOUT_TABLES,
  AdminPayoutUnwired,
  PAYOUT_RELEASE_PATH,
  UNWIRED_ADMIN_PAYOUT_BACKEND,
  resetAdminPayoutBackend,
  useAdminPayoutBackend,
  type AdminPayoutBackend,
} from '../src/routes/admin-payouts.ts';
import { buildServer } from '../src/server.ts';
import { BASE_PATH } from '../src/surface.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const API_SRC = join(ROOT, 'apps/api/src');
const ADMIN_PAYOUTS_SRC = readFileSync(join(API_SRC, 'routes/admin-payouts.ts'), 'utf8');

afterEach(() => {
  resetAdminPayoutBackend();
});

// -----------------------------------------------------------------------------
// 1. THE CENSUS, TAKEN AT THE BRACES
// -----------------------------------------------------------------------------

/** The comment-stripped body of one interface, declaration line to its closer. */
function interfaceBody(source: string, name: string): readonly string[] {
  const lines = stripComments(source).split('\n');
  const start = lines.findIndex((line) => new RegExp(`\\binterface ${name}\\s*\\{`).test(line));
  if (start < 0) throw new Error(`no \`interface ${name}\` in this source`);
  let depth = 0;
  for (let i = start; i < lines.length; i += 1) {
    for (const ch of lines[i] ?? '') {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
    if (depth === 0 && i > start) return lines.slice(start + 1, i);
  }
  throw new Error(`\`interface ${name}\` is not closed`);
}

/**
 * Every member NAME an interface declares, at depth one of its own body.
 *
 * IT COUNTS `readonly x: T` AND `x(): T` ALIKE, which is the whole reason this
 * is not a pattern over signature lines: the member this port most needs a
 * reader to see is a field.
 */
function members(source: string, name: string): readonly string[] {
  const found: string[] = [];
  let depth = 0;
  for (const line of interfaceBody(source, name)) {
    const before = depth;
    for (const ch of line) {
      if (ch === '{' || ch === '(' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    }
    if (before !== 0) continue;
    const match = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*[(<:]/.exec(line);
    if (match?.[1] !== undefined) found.push(match[1]);
  }
  return found;
}

/** What a line pattern over the same body would have counted. The wrong number. */
function signatureLines(source: string, name: string): number {
  return interfaceBody(source, name).filter((line) => /^\s{2}[A-Za-z_$][\w$]*\s*[(<]/.test(line))
    .length;
}

describe('the census of the admin payout pair, matched at the braces', () => {
  it('`AdminPayoutBackend` declares three members and `AdminPayoutTx` declares five', () => {
    expect(members(ADMIN_PAYOUTS_SRC, 'AdminPayoutBackend')).toStrictEqual([
      'operator',
      'principal',
      'now',
    ]);
    expect(members(ADMIN_PAYOUTS_SRC, 'AdminPayoutTx')).toStrictEqual([
      'lockAt',
      'rowAt',
      'insert',
      'updateAt',
      'ledger',
    ]);
  });

  it('the pair carries EIGHT members, which is what a wiring slice must supply', () => {
    const total =
      members(ADMIN_PAYOUTS_SRC, 'AdminPayoutBackend').length +
      members(ADMIN_PAYOUTS_SRC, 'AdminPayoutTx').length;
    expect(total).toBe(8);
  });

  it('THE LINE PATTERN DISAGREES at SEVEN, and the member it cannot see is `ledger`', () => {
    // THIS CASE IS THE METHOD DEFENDING ITSELF. `AdminPayoutTx.ledger` is a
    // field behind a long doc comment, so a pattern over call-signature lines
    // undercounts the pair by exactly one and reports a number a reader would
    // act on. A row dispatched off SEVEN builds seven suppliers and wires
    // nothing.
    const naive =
      signatureLines(ADMIN_PAYOUTS_SRC, 'AdminPayoutBackend') +
      signatureLines(ADMIN_PAYOUTS_SRC, 'AdminPayoutTx');
    expect(naive).toBe(7);
    const seen = members(ADMIN_PAYOUTS_SRC, 'AdminPayoutTx');
    expect(seen).toContain('ledger');
    expect(seen.length - signatureLines(ADMIN_PAYOUTS_SRC, 'AdminPayoutTx')).toBe(1);
  });
});

// -----------------------------------------------------------------------------
// 2. THE UNWIRED DEFAULT, CALLED RATHER THAN READ
// -----------------------------------------------------------------------------

/** Every member of the shipped default, called, to what it produced. */
async function probeEveryMember(): Promise<readonly { member: string; error: unknown }[]> {
  const out: { member: string; error: unknown }[] = [];
  for (const member of ['operator', 'principal', 'now'] as const) {
    try {
      // `now` THROWS SYNCHRONOUSLY AND THE OTHER TWO REJECT, so both shapes
      // have to be caught by the same probe or the difference hides here.
      const produced: unknown =
        member === 'operator'
          ? await UNWIRED_ADMIN_PAYOUT_BACKEND.operator(() => Promise.resolve(null))
          : member === 'principal'
            ? await UNWIRED_ADMIN_PAYOUT_BACKEND.principal({} as never)
            : UNWIRED_ADMIN_PAYOUT_BACKEND.now();
      out.push({ member, error: { served: produced } });
    } catch (err) {
      out.push({ member, error: err });
    }
  }
  return out;
}

describe('the unwired default, every member called', () => {
  it('refuses on ALL THREE and serves nothing at all', async () => {
    // THE CONTRAST WITH `UNWIRED_WITHDRAWAL_BACKEND` IS THE REASON THIS CASE
    // EXISTS RATHER THAN BEING ASSUMED. ADR-361 section 6 found that default's
    // `now` hands out the wall clock, so its docblock's claim to refuse every
    // call is false of the first member every request touches. This default is
    // one of the four ADR-361 measured as throwing, and the claim is executed
    // here rather than inherited from that entry's table.
    const probed = await probeEveryMember();
    expect(probed.map((entry) => entry.member)).toStrictEqual(['operator', 'principal', 'now']);
    for (const { member, error } of probed) {
      expect([member, error instanceof AdminPayoutUnwired]).toStrictEqual([member, true]);
      expect([member, (error as Error).message]).toStrictEqual([
        member,
        expect.stringContaining(`AdminPayoutBackend.${member} cannot be served`),
      ]);
    }
  });

  it('REFUSAL PROPERTY (a) AT THE PORT: no member produces a number, a bigint or a digit', async () => {
    // `Cents` IS `bigint` IN THIS TREE AND MONEY IS INTEGER CENTS EVERYWHERE,
    // so a value a reader could take as an amount is a `number` or a `bigint`.
    // Neither is reachable, and the messages carry no digit either, so a 503 or
    // a 401 built from one cannot be read as quoting anything.
    for (const { member, error } of await probeEveryMember()) {
      expect([member, typeof error]).toStrictEqual([member, 'object']);
      const message = (error as Error).message;
      expect([member, /[0-9]/.test(message)]).toStrictEqual([member, false]);
    }
  });

  it('`now` refuses SYNCHRONOUSLY, and its ONE read site is inside the handler try', () => {
    // ADR-361's `OQ-361-01` IS ALREADY SATISFIED ON THIS PORT AND THAT IS
    // MEASURED HERE RATHER THAN ARGUED. That question is which convention
    // governs a clock on a fail-closed default, and its option (b) requires the
    // refusing clock AND the read inside the handler's `try`, in that order,
    // because the reverse turns a 503 into a 500 on a money-out door. This port
    // has both already: the clock throws, and every read of it sits inside
    // `adminPayoutHandler`'s try, so the refusal is a 503.
    expect(() => UNWIRED_ADMIN_PAYOUT_BACKEND.now()).toThrow(AdminPayoutUnwired);
    const stripped = stripComments(ADMIN_PAYOUTS_SRC).split('\n');
    const readSites = stripped
      .map((line, index) => ({ line, at: index + 1 }))
      .filter((entry) => /\.now\(\)/.test(entry.line));
    expect(readSites).toHaveLength(2);
    const tryAt = stripped.findIndex((line) => /^\s{4}try \{$/.test(line)) + 1;
    const handlerAt = stripped.findIndex((line) => /function adminPayoutHandler\(/.test(line)) + 1;
    expect(tryAt).toBeGreaterThan(handlerAt);
    for (const site of readSites) expect([site.at, site.at > tryAt]).toStrictEqual([site.at, true]);
  });
});

// -----------------------------------------------------------------------------
// 3. WHAT A REQUEST MEETS, DRIVEN THROUGH THE REAL ROUTER
// -----------------------------------------------------------------------------

/**
 * The shipped default with every member wrapped in a counting delegate.
 *
 * IT DELEGATES RATHER THAN SUBSTITUTING, so what the route meets is the shipped
 * value's own behaviour and the only thing added is the tally. A stand-in that
 * merely rejected the same way would be this file agreeing with its own fake.
 */
function countingDefault(touched: string[]): AdminPayoutBackend {
  return {
    operator: (fn) => {
      touched.push('operator');
      return UNWIRED_ADMIN_PAYOUT_BACKEND.operator(fn);
    },
    principal: (request) => {
      touched.push('principal');
      return UNWIRED_ADMIN_PAYOUT_BACKEND.principal(request);
    },
    now: () => {
      touched.push('now');
      return UNWIRED_ADMIN_PAYOUT_BACKEND.now();
    },
  };
}

/** Drive one row and hand back the status, the body and the members touched. */
async function drive(
  spec: (typeof ADMIN_PAYOUT_ENDPOINTS)[number],
  backend?: AdminPayoutBackend,
): Promise<{ status: number; body: unknown; touched: readonly string[] }> {
  const touched: string[] = [];
  useAdminPayoutBackend(backend ?? countingDefault(touched));
  const { app } = buildServer({ surface: 'operator', modules: [adminPayouts] });
  const response = await app.inject({
    method: spec.method,
    url: BASE_PATH + spec.path.replace(':id', '11111111-1111-4111-8111-111111111111'),
    payload: { reason: 'ticket 4711', tos_clause: '7.3(b)', evidence_pack_id: PACK_ID },
  });
  await app.close();
  return { status: response.statusCode, body: response.json(), touched };
}

const PACK_ID = '44444444-4444-4444-8444-444444444444';

/** Every value at every depth of a parsed body, flattened. */
function valuesIn(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value.flatMap((entry) => valuesIn(entry));
  if (value !== null && typeof value === 'object')
    return Object.values(value).flatMap((entry) => valuesIn(entry));
  return [value];
}

describe('what a request meets at the unwired admin payout default', () => {
  it('touches EXACTLY ONE of the three members on both rows, and it is `principal`', async () => {
    // THE ORDER IS THE WHOLE FINDING AND IT IS ASSERTED BY INDEX RATHER THAN
    // DESCRIBED. `principal(request)` is read before the transaction opens, so
    // `operator` is never reached, `now` is never reached, and a reader
    // predicting this refusal from `operator`'s message predicts the wrong
    // member. It is the shape ADR-359 found on the certificate route and
    // ADR-361 found on the trader payout row, arriving here on the ADMIN side.
    for (const spec of ADMIN_PAYOUT_ENDPOINTS) {
      const { touched } = await drive(spec);
      expect([spec.path, touched]).toStrictEqual([spec.path, ['principal']]);
    }
  });

  it('answers 401 on both rows, and the document is exactly five keys', async () => {
    // 401 AND NOT 503, WHICH IS ADR-192 CLAUSE 2 AND IS DELIBERATE. Whether
    // this process holds a backend is a fact about the deployment and an
    // unauthenticated caller may not have it. `admin-payouts.test.ts` already
    // asserts the status; what is added here is the DOCUMENT, because a status
    // with a `detail` bolted onto it is how a figure would arrive.
    for (const spec of ADMIN_PAYOUT_ENDPOINTS) {
      const { status, body } = await drive(spec);
      expect([spec.path, status]).toStrictEqual([spec.path, 401]);
      expect([spec.path, Object.keys(body as object).sort()]).toStrictEqual([
        spec.path,
        ['code', 'instance', 'status', 'title', 'type'],
      ]);
      expect([spec.path, (body as { code: string }).code]).toStrictEqual([
        spec.path,
        'unauthenticated',
      ]);
    }
  });

  it('REFUSAL PROPERTY (a): the only number anywhere in the body is the status itself', async () => {
    // A FIGURE A READER COULD TAKE AS AN AMOUNT, A BALANCE OR A FEE IS A
    // NUMBER, and the walk below reaches every value at every depth rather
    // than pattern matching the serialised text. `401` is the status and is the
    // one number the document is allowed to carry; a `detail` quoting cents, a
    // frozen `approved_cents`, or an `errors[]` echoing a body field would each
    // land here as a second number and redden the case.
    for (const spec of ADMIN_PAYOUT_ENDPOINTS) {
      const { body } = await drive(spec);
      const numbers = valuesIn(body).filter((value) => typeof value === 'number');
      expect([spec.path, numbers]).toStrictEqual([spec.path, [401]]);
      const strings = valuesIn(body).filter((value): value is string => typeof value === 'string');
      // AND NO STRING CARRIES A CENTS-SHAPED RUN EITHER, which is the leak a
      // key-set assertion alone would miss: `type` and `instance` are strings.
      for (const value of strings)
        expect([spec.path, value, /[0-9]{2,}/.test(value)]).toStrictEqual([
          spec.path,
          value,
          false,
        ]);
    }
  });

  it('REFUSAL PROPERTY (b): the transaction is never opened, so nothing is even staged', async () => {
    // THE STRONGEST FORM OF (b) AVAILABLE, AND IT IS STRONGER THAN A RECORDER
    // SHOWING NO WRITES. A recorder asserts that no write was made; this
    // asserts that the callback which would have made one was never invoked, so
    // there is no `admin_actions` row, no `payoutRequests` update, no `LT-01`
    // posting and no staging for a rollback to discard. ADR-361 seed 1 records
    // why the distinction matters: a fixture stages, and a throw discards the
    // staging, so a recorder can read empty for the wrong reason.
    for (const spec of ADMIN_PAYOUT_ENDPOINTS) {
      let entered = 0;
      const touched: string[] = [];
      const watched: AdminPayoutBackend = {
        ...countingDefault(touched),
        operator: (fn) => {
          entered += 1;
          return UNWIRED_ADMIN_PAYOUT_BACKEND.operator(fn);
        },
      };
      const { status } = await drive(spec, watched);
      expect([spec.path, status, entered, touched]).toStrictEqual([
        spec.path,
        401,
        0,
        ['principal'],
      ]);
    }
  });

  it('and the message that DOES name the port goes to the log rather than the wire', async () => {
    // THE DISCRIMINATION IS IN THE LOG, WHICH IS WHAT THE HANDLER'S OWN
    // PARAGRAPH SAYS IT DOES. So the refusal is loud where an operator can read
    // it and silent where an anonymous caller can, and neither copy carries a
    // figure: the class's message is asserted digit-free above.
    const { body } = await drive(
      ADMIN_PAYOUT_ENDPOINTS[0] as (typeof ADMIN_PAYOUT_ENDPOINTS)[number],
    );
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain('AdminPayoutBackend');
    expect(serialised).not.toContain('useAdminPayoutBackend');
    expect(new AdminPayoutUnwired('principal').message).toContain('useAdminPayoutBackend');
  });
});

// -----------------------------------------------------------------------------
// 4. THE DOOR `operator` NEEDS, WHICH `ApiDb` DOES NOT DECLARE
// -----------------------------------------------------------------------------
// THIS IS THE SECTION THE ROW TURNS ON. `wiring.test.ts`'s entry for this port
// says "ONE SUPPLIER SHORT, AND THE SUPPLIER IS NOT A DOOR". The tree says two,
// and one of them is exactly a door.

/** Every `.ts` file under `apps/api/src`, recursively. */
function sourceFiles(dir: string = API_SRC): readonly string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('the door `AdminPayoutBackend.operator` names, and whether anything yields it', () => {
  it("`operator`'s own docblock names `systemDb('operator-console')` as its authority", () => {
    // DERIVED FROM THE INTERFACE RATHER THAN FROM ANY ENTRY'S PROSE, so the
    // claim that this member wants a system handle is the module's own.
    const lines = ADMIN_PAYOUTS_SRC.split('\n');
    const declaredAt = lines.findIndex((line) => /^\s{2}operator<T>\(/.test(line));
    expect(declaredAt).toBeGreaterThan(0);
    const doc = lines.slice(Math.max(0, declaredAt - 8), declaredAt).join('\n');
    expect(doc).toContain("systemDb('operator-console')");
  });

  it('`ApiDb` declares FIVE doors and none of them yields a system handle', () => {
    // `db.test.ts` PINS THIS SET FOR ITS OWN REASON AND THIS CASE ASKS A
    // DIFFERENT QUESTION OF IT: not "is the count five", but "is the door this
    // money-out port needs among them". It is not, and `db.ts`'s own header
    // says so in the words ADR-171 clause 1 ruled.
    expect(Object.keys(LIVE_DB)).toStrictEqual([
      'scoped',
      'firm',
      'resolution',
      'establishment',
      'publicLookup',
    ]);
    for (const absent of ['operator', 'system'])
      expect([absent, Object.keys(LIVE_DB).includes(absent)]).toStrictEqual([absent, false]);
  });

  it('and NO file under `apps/api/src` can obtain one, so no adapter can be written', () => {
    // THE SECOND HALF OF THE SAME BLOCKER, AND WITHOUT IT THE FIRST IS ESCAPABLE.
    // An adapter could bypass a missing door by importing the accessor itself.
    // Nothing does, so the authority `operator` needs is unobtainable in this
    // deployable by either route, which is what makes the door a blocker rather
    // than a preference.
    //
    // THIS CASE WAS WRITTEN ONCE AS A TEXT SEARCH FOR THE NAME AND THAT VERSION
    // IS KEPT DESCRIBED HERE RATHER THAN DELETED, UNDER `RI-14`. It scanned
    // comment-stripped source for `systemDb` and reported ONE taker:
    // `routes/admin-reads.ts`, whose `READ_SOURCE_UNWIRED` message quotes the
    // door in a STRING LITERAL to say it is the one a wiring slice must take.
    // `stripComments` removes comments and not strings, so the probe hit prose
    // about the absence and read it as the absence being escaped. It is the
    // self-hit ADR-361 section 7 recorded on the rail adapter, reproduced
    // independently here, and the lesson is the same: a claim about an IMPORT
    // must read import clauses and not the name.
    const takers = sourceFiles()
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return [...source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*'@merit\/db'/g)]
          .filter((match) => match[1] === undefined)
          .flatMap((match) => (match[2] ?? '').split(','))
          .map((binding) =>
            binding
              .trim()
              .split(/\s+as\s+/)[0]
              ?.trim(),
          )
          .some((binding) => binding === 'systemDb');
      })
      .map((file) => relative(ROOT, file).split('\\').join('/'));
    expect(takers).toStrictEqual([]);
  });

  it('THE FINDING: the only `AdminPayoutBackend` in this deployable is the unwired one', () => {
    // SO THE ADMIN MONEY-OUT SIDE HAS NO ADAPTER AT ALL, AND THAT IS THE
    // CONTRAST WITH THE TRADER SIDE RATHER THAN A RESTATEMENT OF IT. ADR-361
    // measured `postgresPayoutBackend` serving SIX of the trader payout pair's
    // eight members. Here the count is ZERO of eight, because the file that
    // would hold the adapter cannot open the transaction its first member
    // promises.
    const constructors = sourceFiles()
      .filter((file) => {
        const stripped = stripComments(readFileSync(file, 'utf8'));
        return /:\s*AdminPayoutBackend\s*=/.test(stripped);
      })
      .map((file) => relative(ROOT, file).split('\\').join('/'));
    expect(constructors).toStrictEqual(['apps/api/src/routes/admin-payouts.ts']);
    const stripped = stripComments(ADMIN_PAYOUTS_SRC);
    const bindings = [...stripped.matchAll(/(\w+)\s*:\s*AdminPayoutBackend\s*=/g)].map(
      (match) => match[1],
    );
    expect(bindings).toStrictEqual(['UNWIRED_ADMIN_PAYOUT_BACKEND', 'backend']);
  });

  it('`now` is the ONE member of the eight that needs no door, and it is built here to prove it', () => {
    // THE HONEST OTHER HALF OF THE CENSUS. Seven of the eight reduce to two
    // suppliers neither of which this repository holds; the eighth is a clock
    // and is constructible in one expression. Building it is the whole proof.
    const clock: Pick<AdminPayoutBackend, 'now'> = { now: () => new Date() };
    expect(clock.now()).toBeInstanceOf(Date);
  });
});

// -----------------------------------------------------------------------------
// 5. DUAL CONTROL, AND THE VALUE THIS ROW DOES NOT INVENT
// -----------------------------------------------------------------------------

describe('dual control on the surface that releases a held payout', () => {
  it('this module names `dual_control` ZERO times, so one operator releases alone', () => {
    // MEASURED, NOT ARGUED. `ACCOUNT_ACTION_ROLES` admits `owner` and `ops`,
    // and the release row posts `LT-01` for whatever the hold froze. There is
    // no second approver, no threshold read and no quorum anywhere in the
    // module, so the port could not enforce dual control today even holding a
    // threshold. THE MISSING VALUE IS THE FOURTH ABSENCE RATHER THAN THE FIRST
    // and this case exists so that ordering cannot be lost.
    expect(ADMIN_PAYOUTS_SRC).not.toContain('dual_control');
    expect(ADMIN_PAYOUTS_SRC).not.toContain('dualControl');
  });

  it('and `ADMIN_PAYOUT_TABLES` admits no table a dual-control approval could be read from', () => {
    // THE NARROW UNION IS THE REASON THE PREVIOUS CASE CANNOT BE FIXED BY A
    // VALUE. `AdminPayoutTx` is keyed on this list, so even a wired backend
    // holding a threshold has no key with which to look up an approval: a typo
    // is a compile error here and a MISSING member is an impossibility.
    expect([...ADMIN_PAYOUT_TABLES]).toStrictEqual([
      'payoutRequests',
      'adminActions',
      'evidencePacks',
    ]);
    for (const absent of ['dualControlApprovals', 'operators', 'operatorSessions'])
      expect([absent, (ADMIN_PAYOUT_TABLES as readonly string[]).includes(absent)]).toStrictEqual([
        absent,
        false,
      ]);
  });

  it('NO THRESHOLD IS INVENTED HERE, and the release path reads none', () => {
    // THIS CASE ASSERTS AN ABSENCE ON PURPOSE AND `RI-35` IS WHY IT NAMES WHAT
    // IS ABSENT. `dual_control_threshold_cents` is a real column on
    // `account_adjustments` and on `wallet_withdrawals`; it is NOT on
    // `payout_requests`, and the value that would govern this surface is
    // founder-owed. A row that picked one would be inventing the line above
    // which a single operator may not pay a trader.
    expect(ADMIN_PAYOUTS_SRC).not.toMatch(/threshold/i);
    expect(ADMIN_PAYOUTS_SRC).not.toContain('PAYOUT_RELEASE_THRESHOLD');
    expect(PAYOUT_RELEASE_PATH).toBe('/admin/payouts/:id/release');
  });
});
