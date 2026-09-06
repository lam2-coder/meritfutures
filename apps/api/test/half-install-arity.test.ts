import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { FastifyReply, FastifyRequest } from 'fastify';
import { afterEach, expect, test } from 'vitest';

import {
  ADMIN_READ_ENDPOINTS,
  ADMIN_SESSION_COOKIE,
  adminHandler,
  setAdminReadSource,
  setAdminSessionSource,
} from '../src/routes/admin-reads.ts';
import type {
  AdminEndpointSpec,
  AdminReadSource,
  AdminSessionLookup,
  AdminSessionSource,
} from '../src/routes/admin-reads.ts';

// CI-02, the `unit` project. ADR-368.
//
// WHAT THIS SUITE IS FOR. Two merged ADRs written four hours apart disagree
// about a general rule, and this file is the executed half of the ruling that
// settles them.
//
// `ADR-360` ruled that `setAdminSessionSource` admits no half-install "and the
// reason is the interface rather than a judgement", on the ground that
// ADR-356's shape "needs at least two members" and this port declares one.
// `ADR-364` ruled that the claim "DOES NOT CARRY, and the reason is the
// interface rather than a judgement", on the ground that ITS port declares
// four. Both entries locate the arms in the MEMBER LIST, and both are wrong
// about where they live.
//
// THE ARMS ARE IN THE RETURN TYPE. `AdminSessionSource` declares one member
// whose return type is a closed THREE-arm union, and this module renders each
// arm as a different status: `unknown` is 401, `not-an-operator` is 403, and
// `operator` carrying an admitted role reaches the read source and is 503. So a
// single member presents live arms beside refusing ones, keyed on the token it
// is handed, and ADR-356's shape arises on a ONE-member port. Member count is
// neither necessary nor sufficient, and section 3 below is the measurement.
//
// WHAT DOES CARRY IS THE OTHER HALF OF ADR-356, AND IT IS ARITY-BLIND.
// `adminHandler` emits the port's only run-time name on the `installed === null`
// branch, so ANY non-null source silences it whatever arm it returns. That is
// the channel loss ADR-356 priced and ADR-360 measured correctly on its own
// port. Section 4 holds it against all three arms.
//
// THE REFUTED REASONING IS KEPT BESIDE ITS CORRECTION AND IS NEVER DELETED
// (`RI-14`). Following ADR-367's remedy for the collision ADR-358 predicted,
// the entries below NAME the retired figure rather than reproducing the
// sentence that carried it, so a prose-matching case is not handed two answers.
//
// DRIVEN THROUGH THE EXPORTED HANDLER RATHER THAN THROUGH `inject`, on
// `test/admin-session-source.test.ts`' precedent (ADR-360, ADR-359).
// `adminHandler` is the same function `toAdminRoutes` wraps every one of
// `ADMIN_READ_ENDPOINTS` with, so what is exercised here is what is served.

const APP = import.meta.dirname;

/** A real declared endpoint, so this is the handler a deployment registers. */
function firstSpec(): AdminEndpointSpec {
  const spec = ADMIN_READ_ENDPOINTS[0];
  if (spec === undefined) throw new Error('ADMIN_READ_ENDPOINTS is empty');
  return spec;
}

const SPEC = firstSpec();

/** One `request.log.error` call: its structured payload and its message. */
interface LogLine {
  readonly payload: unknown;
  readonly message: unknown;
}

interface Driven {
  readonly sent: readonly unknown[];
  readonly logged: readonly LogLine[];
}

/** The `status` the sent problem document carries, or `null` if it carries none. */
function statusOf(driven: Driven): number | null {
  const body = driven.sent[0];
  if (typeof body !== 'object' || body === null) return null;
  const status = (body as { readonly status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

/**
 * Run the handler once against one cookie and record both channels.
 *
 * THE COOKIE IS NOT OPTIONAL HERE AND THAT IS DELIBERATE. `adminHandler` reads
 * the cookie BEFORE it consults the source and short-circuits to `unknown` when
 * there is no token, so a case that installs a source and sends no cookie never
 * reaches `lookup` at all. ADR-360 section 6 records a first draft that did
 * exactly that and left the comparison vacuous. Every case below presents a
 * token AND asserts the call landed.
 */
async function drive(cookie: string | null): Promise<Driven> {
  const sent: unknown[] = [];
  const logged: LogLine[] = [];

  const reply: FastifyReply = {
    code: () => reply,
    type: () => reply,
    send: (body: unknown) => {
      sent.push(body);
      return reply;
    },
  } as unknown as FastifyReply;

  const request = {
    id: 'req-368',
    params: {},
    query: {},
    headers: cookie === null ? {} : { cookie },
    log: {
      error: (payload: unknown, message: unknown) => {
        logged.push({ payload, message });
      },
    },
  } as unknown as FastifyRequest;

  await adminHandler(SPEC)(request, reply);
  return { sent, logged };
}

/** Every access raises, so "was it consulted" is answered by a failure. */
const REFUSING_READ_SOURCE = new Proxy(
  {},
  {
    get: () => {
      throw new Error('the read source was consulted');
    },
  },
) as AdminReadSource;

/** A one-member source that answers one fixed arm and counts its calls. */
function answering(
  arm: AdminSessionLookup,
): AdminSessionSource & { readonly calls: readonly string[] } {
  const calls: string[] = [];
  return {
    calls,
    lookup: (token: string) => {
      calls.push(token);
      return Promise.resolve(arm);
    },
  };
}

const cookieFor = (token: string): string => `${ADMIN_SESSION_COOKIE}=${token}`;

/**
 * The three arms `AdminSessionLookup` declares, as values.
 *
 * `role` IS A PLAIN STRING ON `AdminPrincipal` AND THAT IS THE MODULE'S OWN
 * RULING (`admin-reads.ts:179-184`): the value crosses a boundary with an
 * identity provider, which hands over text, so it is resolved by
 * `resolveAdminRole` at the one place a request is authorized. Nothing in the
 * type stops an implementation minting one, which is why the `operator` arm
 * below is well-typed with no cast.
 */
const UNKNOWN: AdminSessionLookup = { kind: 'unknown' };
const NOT_AN_OPERATOR: AdminSessionLookup = { kind: 'not-an-operator' };
const OPERATOR: AdminSessionLookup = {
  kind: 'operator',
  principal: { actorId: 'op-368', role: 'owner' },
};

afterEach(() => {
  setAdminSessionSource(null);
  setAdminReadSource(null);
});

// -----------------------------------------------------------------------------
// 1. The slicer, held against the shape it exists to survive
// -----------------------------------------------------------------------------

/**
 * The members one interface declares, sliced to its closing brace.
 *
 * COMMENTS AND STRINGS ARE SKIPPED DURING THE SCAN AND NOT BEFORE OR AFTER IT.
 * ADR-360 section 3 records a first draft that stripped comments AFTER
 * balancing braces, so a `{` inside a doc comment ran the depth past the real
 * closing brace. The corrected order is kept beside the record of what it got
 * wrong (`RI-14`), and the fixture below is the shape that caught it.
 */
function interfaceMembers(source: string, name: string): readonly string[] {
  const start = source.indexOf(`interface ${name} {`);
  if (start < 0) throw new Error(`no interface ${name} in this source`);

  const open = source.indexOf('{', start);
  let depth = 0;
  let i = open;
  let body = '';
  for (; i < source.length; i += 1) {
    const two = source.slice(i, i + 2);
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (two === '//') {
      const end = source.indexOf('\n', i + 2);
      i = end < 0 ? source.length : end;
      continue;
    }
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      for (i += 1; i < source.length && source[i] !== ch; i += 1) if (source[i] === '\\') i += 1;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
    if (depth >= 1 && !(depth === 1 && ch === '{')) body += ch;
  }
  if (depth !== 0) throw new Error(`interface ${name} never closed`);

  return body
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const declared = part.replace(/^readonly\s+/, '');
      const cut = declared.search(/[(<:?]/);
      return cut < 0 ? declared : declared.slice(0, cut);
    })
    .filter((part) => part !== '');
}

/**
 * The `kind` discriminants one closed union type alias declares.
 *
 * THE ARMS THIS ROW IS ABOUT ARE THESE AND NOT THE MEMBER LIST, so they are
 * derived by the same discipline: sliced from the alias to the semicolon that
 * TERMINATES it rather than grepped out of the file at large.
 *
 * THE DEPTH TEST IS THIS FUNCTION'S OWN FIRST DRAFT CORRECTED, AND IT IS KEPT
 * BESIDE THE RECORD OF WHAT IT GOT WRONG (`RI-14`). That draft took the first
 * `;` after the alias, and the first `;` in this union sits INSIDE the
 * `operator` arm separating `kind` from `principal`, so it sliced one arm of
 * three and reported the union as closed over one. It is the mirror of the
 * defect ADR-360 section 3 records in its own slicer: a delimiter read at the
 * wrong nesting depth, once running past the terminator and once stopping
 * short of it. A union whose FIRST arm happens to carry no second property
 * would have hidden it, which is why the fixture below carries one that does.
 */
function unionArms(source: string, name: string): readonly string[] {
  const start = source.indexOf(`export type ${name} =`);
  if (start < 0) throw new Error(`no type ${name} in this source`);

  let depth = 0;
  let end = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === ';' && depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error(`type ${name} never terminated`);

  const body = source.slice(start, end);
  return [...body.matchAll(/kind:\s*'([a-z-]+)'/g)].map((m) => m[1] ?? '');
}

const ADMIN_READS = readFileSync(join(APP, '..', 'src', 'routes', 'admin-reads.ts'), 'utf8');
const INTERNAL = readFileSync(join(APP, '..', 'src', 'routes', 'internal.ts'), 'utf8');

test('the slicer survives a doc comment carrying a brace, so every count below is not luck', () => {
  // THE DEFECT ADR-360 RECORDS ITS OWN FIRST DRAFT HAVING, REPRODUCED AS A
  // FIXTURE RATHER THAN RUN ONCE AS A SEED, so it cannot come back quietly.
  const fixture = [
    'export interface Probe {',
    '  first(a: string): Promise<void>;',
    '  /**',
    '   * A long doc comment carrying a semicolon; and a brace { to be awkward.',
    '   */',
    '  readonly second: number;',
    '  // a line comment naming third',
    '  third?: { readonly nested: string };',
    '}',
  ].join('\n');
  expect(interfaceMembers(fixture, 'Probe')).toStrictEqual(['first', 'second', 'third']);

  // AND ON THE INTERFACE THAT CAUGHT A PRIOR ROW OUT, where a line-anchored
  // pattern read seven members as six. Both prior rows report SEVEN here
  // independently, and this is the third derivation.
  expect(interfaceMembers(ADMIN_READS, 'AdminReadSource')).toHaveLength(7);
});

test('the union slicer runs past a semicolon inside an arm, which its first draft did not', () => {
  // THIS FIXTURE IS THIS ROW'S OWN DEFECT, KEPT RATHER THAN QUIETLY FIXED
  // (`RI-14`). The first arm carries a second property, so the alias contains a
  // `;` at brace depth 1 before the one that terminates it. The draft that took
  // the first `;` reported ONE arm where there are three, and reported it while
  // every wire case in section 3 was already green: the count was wrong in the
  // same file whose measurement was right.
  const fixture = [
    'export type Verdict =',
    "  | { readonly kind: 'admitted'; readonly principal: Who }",
    "  | { readonly kind: 'refused' }",
    "  | { readonly kind: 'unknown' };",
  ].join('\n');
  expect(unionArms(fixture, 'Verdict')).toStrictEqual(['admitted', 'refused', 'unknown']);
});

// -----------------------------------------------------------------------------
// 2. Where the arms actually live
// -----------------------------------------------------------------------------

test('the one-member port declares THREE arms, and they are in the return type', () => {
  // BOTH MERGED ENTRIES COUNTED THE MEMBER LIST AND STOPPED THERE. This case is
  // the two numbers side by side, and the second is the one that decides.
  expect(interfaceMembers(ADMIN_READS, 'AdminSessionSource')).toStrictEqual(['lookup']);
  expect(unionArms(ADMIN_READS, 'AdminSessionLookup')).toStrictEqual([
    'operator',
    'not-an-operator',
    'unknown',
  ]);
});

test('member count does not order the two ports by how many arms they present', () => {
  // THE GENERALISATION, FALSIFIED BY ARITHMETIC OVER THE TWO PORTS THEMSELVES.
  // One port declares one member and presents three arms; the other declares
  // four members. A rule reading "at least two members" off the member list
  // orders these two the wrong way round, because the one-member port presents
  // MORE arms than its arity and the count of arms is what ADR-356 priced.
  const admin = interfaceMembers(ADMIN_READS, 'AdminSessionSource');
  const internal = interfaceMembers(INTERNAL, 'InternalOpsSource');
  expect(admin).toHaveLength(1);
  expect(internal).toHaveLength(4);

  const adminArms = unionArms(ADMIN_READS, 'AdminSessionLookup');
  expect(adminArms.length).toBeGreaterThan(admin.length);

  // AND THE INTERNAL PORT'S ARMS ARE IN ITS RETURN TYPES TOO, which is the same
  // finding arriving on the port that was said to differ in kind.
  // `BATCH_RUN_OUTCOMES` is the closed set `renderBatchRun` validates against,
  // and it is what turns one member into more than one answer. The executed
  // 500/500/200/202 measurement is `test/internal-ops-source.test.ts`' and is
  // not re-run here.
  expect(INTERNAL).toContain('BATCH_RUN_OUTCOMES');
});

// -----------------------------------------------------------------------------
// 3. Each arm of the ONE member renders a different status
// -----------------------------------------------------------------------------

test('the unknown arm answers 401, which is the arm an honest empty directory returns', async () => {
  setAdminReadSource(REFUSING_READ_SOURCE);
  const source = answering(UNKNOWN);
  setAdminSessionSource(source);

  const driven = await drive(cookieFor('any-token'));
  expect(source.calls).toHaveLength(1);
  expect(statusOf(driven)).toBe(401);
});

test('the not-an-operator arm answers 403, so one member already has an arm to get wrong', async () => {
  // THE ARM ADR-360 RAN AS A FALSIFICATION SEED AND DID NOT CARRY INTO ITS
  // RULING. That row's seed table records "the installed source answers
  // `not-an-operator` instead of `unknown`" reddening two cases, which is an
  // arm of a ONE-member port changing an observable answer. Measured here as a
  // case rather than as a seed.
  setAdminReadSource(REFUSING_READ_SOURCE);
  const source = answering(NOT_AN_OPERATOR);
  setAdminSessionSource(source);

  const driven = await drive(cookieFor('any-token'));
  expect(source.calls).toHaveLength(1);
  expect(statusOf(driven)).toBe(403);
});

test('the operator arm reaches the read source and answers 503, from one member', async () => {
  // NOTHING IS INSTALLED ON THE READ PORT HERE, which is the tree's own state.
  // `authorizeAdmin` returns `allowed`, `adminHandler` reaches the statement
  // after it, finds no read source and sends the module's only 503.
  const source = answering(OPERATOR);
  setAdminSessionSource(source);

  const driven = await drive(cookieFor('any-token'));
  expect(source.calls).toHaveLength(1);
  expect(statusOf(driven)).toBe(503);
});

test('one installed member presents a live arm beside a refusing one, keyed on the token', async () => {
  // THIS IS ADR-356's SHAPE ON A ONE-MEMBER PORT AND IT IS THE CASE THE RULING
  // TURNS ON. A single object, installed through the single setter, well-typed
  // with no cast, answers a refusal to one token and admits another. An
  // implementation reading a PARTIALLY populated directory does exactly this,
  // and nothing in the interface can express a preference about it.
  const calls: string[] = [];
  const partialDirectory: AdminSessionSource = {
    lookup: (token: string) => {
      calls.push(token);
      return Promise.resolve(token === 'admitted' ? OPERATOR : UNKNOWN);
    },
  };
  setAdminSessionSource(partialDirectory);

  const refused = await drive(cookieFor('stranger'));
  const admitted = await drive(cookieFor('admitted'));

  expect(calls).toStrictEqual(['stranger', 'admitted']);
  expect(statusOf(refused)).toBe(401);
  expect(statusOf(admitted)).toBe(503);
  expect(statusOf(refused)).not.toBe(statusOf(admitted));
});

// -----------------------------------------------------------------------------
// 4. What DOES carry, and it is arity-blind
// -----------------------------------------------------------------------------

test('any non-null source silences the port name, whichever arm it returns', async () => {
  // THE HALF OF ADR-356 THAT SURVIVES BOTH PORTS. The channel is gated on
  // `installed === null` and on nothing else, so the loss is caused by the
  // install being non-null rather than by which arms it fills. ADR-360
  // measured this correctly on its own port and this row does not reopen it.
  setAdminReadSource(REFUSING_READ_SOURCE);
  const unwired = await drive(cookieFor('any-token'));
  expect(unwired.logged).toHaveLength(1);
  expect(unwired.logged[0]?.payload).toStrictEqual({ port: 'setAdminSessionSource' });

  for (const arm of [UNKNOWN, NOT_AN_OPERATOR]) {
    setAdminSessionSource(answering(arm));
    const driven = await drive(cookieFor('any-token'));
    expect(driven.logged).toStrictEqual([]);
  }

  // THE OPERATOR ARM IS DRIVEN WITHOUT A READ SOURCE, because installing the
  // refusing proxy would raise once authorization passes. It logs the OTHER
  // port rather than this one, which is the same silence measured on the arm
  // that reaches furthest.
  setAdminReadSource(null);
  setAdminSessionSource(answering(OPERATOR));
  const admitted = await drive(cookieFor('any-token'));
  expect(admitted.logged).toHaveLength(1);
  expect(admitted.logged[0]?.payload).toStrictEqual({ port: 'setAdminReadSource' });
});
