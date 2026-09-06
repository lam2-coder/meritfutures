import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { FastifyReply, FastifyRequest } from 'fastify';
import { afterEach, expect, test } from 'vitest';

import { PROBLEM_TYPE_PREFIX } from '../src/server.ts';
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
  AdminSessionSource,
} from '../src/routes/admin-reads.ts';

// CI-02, the `unit` project. ADR-360.
//
// WHAT THIS SUITE IS FOR, AND WHY IT IS NOT IN `admin-reads.test.ts`.
// `test/admin-reads.test.ts` holds the WIRE through `buildServer` and `inject`,
// and its `ANSWER_TABLE` already enumerates the eight states of one operator
// route. It cannot hold what is asserted here, and the reason is structural
// rather than a matter of where somebody chose to type: `ServerOptions.logger`
// is `boolean` (`src/server.ts:154`) and `buildServer` passes it straight to
// Fastify (`:170`), so A BOOLEAN SINK CANNOT BE READ BACK. No case that reaches
// this module through `inject` can observe a log line at all.
//
// THAT IS THE FINDING THIS FILE EXISTS FOR. `adminHandler` answers an unwired
// session source with the SAME BYTES it answers a genuinely anonymous caller
// with, deliberately, on ADR-192 clause 2's disclosure rule as ADR-343 clause 1
// re-argued it. So the discrimination is not on the wire; it is the one
// `request.log.error` at `src/routes/admin-reads.ts:1295`. Nothing executed was
// holding that line, and nothing reaching the module the ordinary way COULD.
// A refactor that dropped it would leave this deployment with no channel at all
// distinguishing "this deployment cannot authenticate anybody" from "your
// credentials were rejected", and every case in every other file would stay
// green.
//
// DRIVEN THROUGH THE EXPORTED HANDLER RATHER THAN THROUGH `inject`, on
// `test/admin-certificates.test.ts`' precedent (ADR-359). `adminHandler` is the
// same function `toAdminRoutes` wraps every one of `ADMIN_READ_ENDPOINTS`
// with, so what is exercised here is what is served.

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

/**
 * Run the handler once and record both channels.
 *
 * THE READ SOURCE INSTALLED HERE THROWS ON EVERY PROPERTY ACCESS, which is what
 * makes the ordering assertion below an assertion rather than a comment: if
 * `adminHandler` ever reached `spec.handle` on this path, the stub would raise
 * instead of the case passing quietly.
 */
async function drive(options: { readonly cookie?: string } = {}): Promise<Driven> {
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
    id: 'req-360',
    params: {},
    query: {},
    headers: options.cookie === undefined ? {} : { cookie: options.cookie },
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

/**
 * A source a deployment could install today: honest, and over an empty table.
 *
 * IT COUNTS ITS OWN CALLS, and that is not decoration. `adminHandler` reads the
 * cookie BEFORE it consults the source and short-circuits to `unknown` when
 * there is no token, so a case that installs a source and sends no cookie never
 * reaches `lookup` at all and would compare two paths that both refuse early.
 * The first draft of this file did exactly that and a seed proved it vacuous.
 * Every wired case below sends a cookie AND asserts the call landed.
 */
function emptyDirectory(): AdminSessionSource & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    lookup: (token: string) => {
      calls.push(token);
      // `operators` and `operator_sessions` exist and NOTHING IN THIS TREE
      // WRITES EITHER, so the only honest verdict over the real directory is
      // that no row matched. `resolveOperatorSession(null, now)` is this value.
      return Promise.resolve({ kind: 'unknown' as const });
    },
  };
}

/** What a caller presents. Any value: no row can match it. */
const COOKIE = `${ADMIN_SESSION_COOKIE}=whatever-it-is`;

const UNAUTHENTICATED = {
  type: `${PROBLEM_TYPE_PREFIX}unauthenticated`,
  title: 'Unauthenticated',
  status: 401,
  code: 'unauthenticated',
  instance: 'req-360',
};

afterEach(() => {
  setAdminSessionSource(null);
  setAdminReadSource(null);
});

// -----------------------------------------------------------------------------
// 1. The channel, in both directions
// -----------------------------------------------------------------------------

test('an unwired session source answers 401 and puts the discrimination in the log', async () => {
  setAdminReadSource(REFUSING_READ_SOURCE);
  const { sent, logged } = await drive();

  expect(sent).toStrictEqual([UNAUTHENTICATED]);

  // ONE LINE, and the two things that make it actionable: WHICH port is
  // uncomposed, carried as a structured field a log query can select on, and
  // the sentence saying that this is an unfinished deployment rather than a
  // failed request.
  expect(logged).toHaveLength(1);
  expect(logged[0]?.payload).toStrictEqual({ port: 'setAdminSessionSource' });
  expect(String(logged[0]?.message)).toContain(
    'no admin session source is wired, so this deployment cannot tell an operator from anybody else',
  );
});

test('a wired session source logs nothing, so the line above is not unconditional', async () => {
  // THE OTHER DIRECTION, and it is what stops the case above passing vacuously.
  // A handler that logged on every request would satisfy the first assertion
  // and would carry no information at all.
  const source = emptyDirectory();
  setAdminSessionSource(source);
  setAdminReadSource(REFUSING_READ_SOURCE);
  const { sent, logged } = await drive({ cookie: COOKIE });

  // THE SOURCE WAS ACTUALLY CONSULTED. Without this the case would pass on a
  // path that never reached the port, which is the vacuity a seed caught here.
  expect(source.calls).toHaveLength(1);
  expect(sent).toStrictEqual([UNAUTHENTICATED]);
  expect(logged).toStrictEqual([]);
});

test('the cookie changes neither channel, so a prober learns nothing by sending one', async () => {
  // ADR-343 clause 1 in the dimension its own suite cannot reach. The wire half
  // is held by `admin-reads.test.ts`; this is the half that says a caller who
  // presents a cookie does not get a DIFFERENT log line either, so the log
  // records the deployment's state rather than the caller's behaviour.
  setAdminReadSource(REFUSING_READ_SOURCE);
  const without = await drive();
  const with_ = await drive({ cookie: `${ADMIN_SESSION_COOKIE}=whatever-it-is` });

  expect(with_.sent).toStrictEqual(without.sent);
  expect(with_.logged).toStrictEqual(without.logged);
});

// -----------------------------------------------------------------------------
// 2. What installing the port today would buy, measured rather than assumed
// -----------------------------------------------------------------------------

test('installing a source over the empty directory changes the wire by nothing at all', async () => {
  // THE HALF-INSTALL QUESTION, EXECUTED. `0073_operator_directory.sql` creates
  // `operators` and `operator_sessions` and NOTHING IN THIS TREE WRITES EITHER,
  // so the best source a deployment could install today resolves every token to
  // `unknown`. This case is the two documents laid beside each other.
  //
  // THEY ARE THE SAME BYTES. So wiring the port buys no observable change and
  // COSTS THE ONE CHANNEL: the case above measures that the log line stops.
  // That is the direction the trade actually runs, and it is why ADR-360 rules
  // the install a REGRESSION rather than partial progress.
  setAdminReadSource(REFUSING_READ_SOURCE);
  const unwired = await drive({ cookie: COOKIE });

  const source = emptyDirectory();
  setAdminSessionSource(source);
  const wired = await drive({ cookie: COOKIE });

  // BOTH ARMS PRESENT A COOKIE, so the wired arm really does run the lookup and
  // the comparison is between a deployment that queried and one that could not.
  expect(source.calls).toHaveLength(1);
  expect(wired.sent).toStrictEqual(unwired.sent);
  expect(unwired.logged).toHaveLength(1);
  expect(wired.logged).toHaveLength(0);
});

test('the read source is never consulted while the session source is unwired', async () => {
  // THE ORDERING, AND WHAT IT COSTS. `adminHandler` returns at the authorization
  // refusal one statement BEFORE it fetches the read source, so with the SSO
  // port unwired the module's only 503 and `READ_SOURCE_UNWIRED`'s own log line
  // are BOTH unreachable, whatever `setAdminReadSource` holds.
  //
  // `REFUSING_READ_SOURCE` raises on any property access, so reaching it would
  // surface here as an error rather than as a passing case. The 401 coming back
  // clean is the measurement.
  setAdminReadSource(REFUSING_READ_SOURCE);
  const { sent } = await drive();
  expect(sent).toStrictEqual([UNAUTHENTICATED]);
});

// -----------------------------------------------------------------------------
// 3. The port's shape, sliced from source rather than pattern-matched
// -----------------------------------------------------------------------------

/**
 * The member names of one interface, read by slicing its body to the brace that
 * closes it.
 *
 * NOT A LINE PATTERN AND NOT A GREP COUNT, deliberately. A sibling row
 * miscounted a seven-member interface as six because one signature sat behind a
 * long doc comment and the pattern it matched on was anchored to a line. This
 * balances braces and strips comments, so a member is counted wherever it is
 * written and however it is documented.
 */
function membersOf(source: string, name: string): readonly string[] {
  const opener = `export interface ${name} {`;
  const start = source.indexOf(opener);
  if (start < 0) throw new Error(`\`${name}\` is not declared in the file read`);

  // BRACES ARE COUNTED ONLY WHERE THEY ARE CODE, and this is the correction the
  // fixture case below forced. Stripping comments AFTER balancing was the first
  // shape of this function, and a `{` inside a doc comment then ran the depth
  // past the real closing brace: the slicer failed on precisely the awkwardness
  // it was written to survive. So comments and string literals are skipped
  // DURING the scan, and the body is accumulated as it goes.
  let depth = 0;
  let end = -1;
  let body = '';
  for (let i = start + opener.length - 1; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '*') {
      const close = source.indexOf('*/', i + 2);
      i = close < 0 ? source.length : close + 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      const nl = source.indexOf('\n', i + 2);
      i = nl < 0 ? source.length : nl - 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) j += source[j] === '\\' ? 2 : 1;
      i = j;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      if (depth === 1) continue;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    body += ch;
  }
  if (end < 0) throw new Error(`\`${name}\` has no closing brace`);

  return body
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const declared = part.replace(/^readonly\s+/, '');
      const cut = declared.search(/[(<:?]/);
      return cut < 0 ? declared : declared.slice(0, cut);
    });
}

test('AdminSessionSource declares exactly one member, so there is no partial install', () => {
  // ADR-356 measured that a HALF-INSTALLED port answers 200/500 where an
  // unwired one answers 503/503, and ruled the half-install worse. THAT SHAPE
  // CANNOT ARISE HERE AND THE REASON IS THE INTERFACE ITSELF: a port with one
  // member is installed or it is not. There is no arrangement of live arms
  // beside refusing ones to get wrong.
  //
  // Read off disk rather than off the imported symbol, because a TypeScript
  // interface is erased at runtime and there is nothing to count at run time.
  const source = readFileSync(join(APP, '..', 'src', 'routes', 'admin-reads.ts'), 'utf8');
  expect(membersOf(source, 'AdminSessionSource')).toStrictEqual(['lookup']);

  // THE SLICER, EXERCISED ON THE INTERFACE THAT CAUGHT A PRIOR ROW OUT. A
  // sibling row read `AdminReadSource` as six members because it matched a line
  // pattern and one signature sat behind a long doc comment. Sliced to its
  // closing brace it is SEVEN, and naming them here means the next reader gets
  // the list rather than a number to re-derive.
  expect(membersOf(source, 'AdminReadSource')).toStrictEqual([
    'searchAccounts',
    'readAccount',
    'readIdentityGraph',
    'listFlags',
    'readLiability',
    'exportEvidence',
    'listEvents',
  ]);
});

test('the slicer finds a member behind a doc comment, so the count above is not luck', () => {
  // THE SLICER'S OWN FALSIFICATION. The failure it exists to avoid is a member
  // that a line-anchored pattern skips, so it is exercised against exactly that
  // shape before its answer above is trusted.
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
  expect(membersOf(fixture, 'Probe')).toStrictEqual(['first', 'second', 'third']);
});
