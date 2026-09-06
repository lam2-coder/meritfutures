// =============================================================================
// apps/api/test/internal-ops-source.test.ts
// =============================================================================
// ADR-364. `setInternalOpsSource` IS THE THIRD OF THE THREE `null` DEFAULTS AND
// IT IS THE ONE WHERE A PARTIAL INSTALL IS EXPRESSIBLE.
//
// ADR-360 ruled `setAdminSessionSource` and found that its half-install question
// answered itself: `AdminSessionSource` declares ONE member, so there is no arm
// to get wrong. That reasoning is about the INTERFACE and it does not carry:
// `InternalOpsSource` declares FOUR, and section 3 below installs an object
// holding two throwing members, one real read and one stub and watches what the
// router does with it.
//
// WHAT THIS FILE ADDS, AND WHAT IT DELIBERATELY DOES NOT REPEAT.
// `internal.test.ts` already holds the STATUSES: an unset port is 500 on every
// row and never 503, and the batch row validates before it looks the port up so
// a malformed trigger is 400 while unwired. Neither is re-asserted here.
// What is not held anywhere is the CHANNEL, which is ADR-359's finding applied
// to an operator surface: the status is right and it is the whole of what the
// caller receives. This file measures the DOCUMENT rather than the number.
//
// THE MEMBER COUNT IS SLICED AND NOT GREPPED. The dispatch for this row records
// a prior session reading a seven-member interface as six by matching a line
// pattern, so the count here comes from a brace-balancing scanner that skips
// comments and string literals DURING the scan, and it is exercised against
// `AdminReadSource`, which is the interface that produced the miscount.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { BASE_PATH, PROBLEM_MEDIA_TYPE, buildServer, discoverRouteModules } from '../src/index.ts';
import {
  BATCH_RUN_ACCEPTED,
  BATCH_RUN_PATH,
  DEEP_HEALTH_PATH,
  INTERNAL_ENDPOINTS,
  JOBS_PATH,
  RECON_STATUS_PATH,
  setInternalOpsSource,
} from '../src/routes/internal.ts';
import type { InternalOpsSource, ReconSnapshot } from '../src/routes/internal.ts';

import type { InjectOptions } from 'fastify';

const HERE = import.meta.dirname;
const REPO = join(HERE, '..', '..', '..');

function read(...parts: readonly string[]): string {
  return readFileSync(join(REPO, ...parts), 'utf8');
}

/** Every module on disk, which is what a deployment actually composes. */
const onDisk = await discoverRouteModules();

const url = (path: string): string => `${BASE_PATH}${path}`;

const VALID_TRIGGER = {
  trading_day: '2026-08-26',
  run_id: 'ops-2026-08-26-1',
  reason: 'ingest arrived after the batch window',
};

/**
 * One request per row, in `INTERNAL_ENDPOINTS`' order, driven through the real
 * router on the operator surface.
 *
 * `payload` is SPREAD IN rather than set to `undefined`, because
 * `exactOptionalPropertyTypes` makes an explicit `undefined` a different thing
 * from an absent key. That is `internal.test.ts`'s note and it is repeated here
 * because the mistake is silent.
 */
async function everyRow(): Promise<readonly { key: string; status: number; body: unknown }[]> {
  const { app } = buildServer({ surface: 'operator', modules: onDisk });
  const out: { key: string; status: number; body: unknown }[] = [];
  for (const route of INTERNAL_ENDPOINTS) {
    const options: InjectOptions = {
      method: route.method,
      url: url(route.path),
      ...(route.method === 'POST' ? { payload: VALID_TRIGGER } : {}),
    };
    const res = await app.inject(options);
    out.push({
      key: `${route.method} ${route.path}`,
      status: res.statusCode,
      body: res.json<unknown>(),
    });
  }
  return out;
}

afterEach(() => {
  setInternalOpsSource(null);
});

// -----------------------------------------------------------------------------
// 1. The port's shape, sliced to its closing brace rather than pattern-matched
// -----------------------------------------------------------------------------

/**
 * The member names of one interface, by balancing braces.
 *
 * COMMENTS AND STRINGS ARE SKIPPED DURING THE SCAN AND NOT BEFORE OR AFTER IT.
 * A `{` inside a doc comment runs the depth past the real closing brace if
 * comments are stripped afterwards, and a member hidden behind a long doc
 * comment is exactly what the miscount this function exists to avoid was made
 * of. Members are flushed at every `;` seen AT DEPTH ONE, so a signature
 * carrying a nested object type or a generic argument list is one member and
 * not three.
 */
function interfaceMembers(source: string, name: string): readonly string[] {
  const opener = `export interface ${name} {`;
  const start = source.indexOf(opener);
  expect(start, `\`${name}\` is not declared where this file looks for it`).toBeGreaterThan(-1);

  const members: string[] = [];
  let segment = '';
  let depth = 0;
  let index = start + opener.length - 1;
  while (index < source.length) {
    const here = source[index] ?? '';
    const next = source[index + 1] ?? '';

    if (here === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (here === '/' && next === '*') {
      index = source.indexOf('*/', index + 2) + 2;
      continue;
    }
    if (here === "'" || here === '"' || here === '`') {
      index += 1;
      while (index < source.length && source[index] !== here) {
        index += source[index] === '\\' ? 2 : 1;
      }
      index += 1;
      continue;
    }

    if (here === '{') depth += 1;
    else if (here === '}') {
      depth -= 1;
      if (depth === 0) break;
    } else if (here === ';' && depth === 1) {
      members.push(segment);
      segment = '';
      index += 1;
      continue;
    } else if (depth >= 1) segment += here;

    index += 1;
  }
  expect(depth, `the body of \`${name}\` never closed`).toBe(0);

  return members
    .map((raw) => /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)/.exec(raw)?.[1] ?? '')
    .filter((member) => member !== '')
    .sort();
}

const INTERNAL_SOURCE = read('apps', 'api', 'src', 'routes', 'internal.ts');

test('the port declares four members, sliced to its closing brace', () => {
  // NAMED RATHER THAN COUNTED. A count alone goes green on the wrong four.
  expect(interfaceMembers(INTERNAL_SOURCE, 'InternalOpsSource')).toStrictEqual([
    'readDependencies',
    'readJobs',
    'readReconStatus',
    'runBatch',
  ]);
});

test('the slicer is exercised on the interface that produced the miscount', () => {
  // THE CORROBORATION, AND IT IS THE WHOLE REASON THE SLICER IS NOT TRUSTED ON
  // ITS OWN ANSWER. `AdminReadSource` is the seven-member interface a prior row
  // read as six, one of its signatures sitting behind a long doc comment. If
  // this function returns six the answer above is not to be believed either.
  const members = interfaceMembers(
    read('apps', 'api', 'src', 'routes', 'admin-reads.ts'),
    'AdminReadSource',
  );
  expect(members).toHaveLength(7);
  expect(members).toStrictEqual([
    'exportEvidence',
    'listEvents',
    'listFlags',
    'readAccount',
    'readIdentityGraph',
    'readLiability',
    'searchAccounts',
  ]);
});

/**
 * The awkwardness the slicer exists to survive, as a fixture rather than a seed.
 *
 * A doc comment carrying an UNBALANCED `{`, and a member declared behind it in
 * property form. ADR-360 records that the first draft of a slicer like this one
 * stripped comments AFTER balancing braces, so the depth ran past the real
 * closing brace and the function failed on exactly this input. Keeping the
 * input here means the defect cannot come back quietly.
 */
const AWKWARD = [
  'export interface Awkward {',
  '  /**',
  '   * An opening brace with no partner: {',
  '   *',
  '   * And a string that looks like the end of the body: "};"',
  '   */',
  '  readonly second: () => Promise<void>;',
  '  first(argument: { nested: string; also: number }): Promise<void>;',
  '}',
  '',
].join('\n');

test('the slicer survives a doc comment holding an unbalanced brace', () => {
  expect(interfaceMembers(AWKWARD, 'Awkward')).toStrictEqual(['first', 'second']);
});

test('the line-pattern derivation the constructibility suite uses agrees with the slice', () => {
  // TWO DERIVATIONS OF ONE FACT, TIED TOGETHER SO THE FRAGILE ONE IS
  // FALSIFIABLE. `internal-ops-constructibility.test.ts` derives this port's
  // members with `/^ {2}([a-zA-Z]+)\(/gm` over a slice that ends at the first
  // line holding a bare `}`. That is the shape of derivation the dispatch warns
  // about: it reads METHOD signatures at one indent and cannot see a member
  // written as a property, and its slice ends at a column-zero brace rather
  // than at a balanced one. It is right today. This case is what says so on
  // every run, and it reddens the day the two stop agreeing rather than
  // leaving one file quietly reading a short port.
  const body = INTERNAL_SOURCE.slice(
    INTERNAL_SOURCE.indexOf('export interface InternalOpsSource {'),
    INTERNAL_SOURCE.indexOf(
      '\n}\n',
      INTERNAL_SOURCE.indexOf('export interface InternalOpsSource {'),
    ),
  );
  const byPattern = [...body.matchAll(/^ {2}([a-zA-Z]+)\(/gm)]
    .map((match) => match[1] ?? '')
    .sort();
  expect(byPattern).toStrictEqual(interfaceMembers(INTERNAL_SOURCE, 'InternalOpsSource'));
});

// -----------------------------------------------------------------------------
// 2. What a request meets, and the channel it meets it on
// -----------------------------------------------------------------------------

/** API_CONTRACT section 2's `Problem`, which is the whole of what a 500 carries. */
const PROBLEM_KEYS = ['code', 'instance', 'status', 'title', 'type'];

test('an unwired row answers a problem document carrying five keys and no reason', async () => {
  // THE FINDING. `wired` throws with a sentence that names the deployment as
  // unfinished and says a retry will never succeed, and NONE OF IT REACHES THE
  // CALLER. `server.ts`'s error handler maps a status it has no canonical code
  // for onto `internal_error` and builds the document from `problem` alone, so
  // the answer is the five keys section 2 defines and nothing else. The status
  // is the entire message.
  //
  // `internal.test.ts` already holds that the status is 500 and not 503. This
  // case is about what is BESIDE the status, which nothing held.
  for (const row of await everyRow()) {
    expect(row.status, row.key).toBe(500);
    expect(Object.keys(row.body as object).sort(), row.key).toStrictEqual(PROBLEM_KEYS);
    expect(JSON.stringify(row.body), row.key).not.toContain('wired');
    expect(JSON.stringify(row.body), row.key).not.toContain('retry');
  }
});

test('all four rows answer the same document, so the wire does not say which row failed', async () => {
  // ONE CONSEQUENCE OF THE ABOVE, STATED SEPARATELY BECAUSE IT IS THE ONE AN
  // OPERATOR MEETS. The deep health probe, the queue report, the recon read and
  // the batch trigger produce byte-identical bodies once the request id is
  // removed. A reader holding the response cannot tell which of the four rows
  // they called from the document, and cannot tell an unfinished deployment
  // from a defect in a handler.
  const rendered = (await everyRow()).map((row) =>
    JSON.stringify({ ...(row.body as Record<string, unknown>), instance: '<request id>' }),
  );
  expect(new Set(rendered).size).toBe(1);
});

test('the trigger typed wrong is told more than the trigger typed right', async () => {
  // THE COMPARISON, AND IT IS THE SHARPEST WAY TO SAY WHAT THE CHANNEL COSTS.
  // Against the SAME unwired deployment, a malformed batch trigger comes back
  // with a field-level `errors[]` naming every field that is wrong, because
  // validation runs before the port is looked up. A well-formed one comes back
  // with the five keys above. The operator who typed the request correctly
  // learns strictly less than the one who typed it wrong.
  const { app } = buildServer({ surface: 'operator', modules: onDisk });
  const malformed = await app.inject({ method: 'POST', url: url(BATCH_RUN_PATH), payload: {} });
  expect(malformed.statusCode).toBe(400);
  expect(malformed.headers['content-type']).toContain(PROBLEM_MEDIA_TYPE);
  const errors = (malformed.json<{ errors?: readonly { path: string }[] }>().errors ?? []).map(
    (entry) => entry.path,
  );
  expect(errors).toStrictEqual(['trading_day', 'run_id', 'reason']);

  const wellFormed = await app.inject({
    method: 'POST',
    url: url(BATCH_RUN_PATH),
    payload: VALID_TRIGGER,
  });
  expect(wellFormed.statusCode).toBe(500);
  expect(Object.keys(wellFormed.json<object>()).sort()).toStrictEqual(PROBLEM_KEYS);
});

test('nothing this suite can reach observes the sentence the module throws', () => {
  // WHY THE CASES ABOVE MEASURE THE WIRE AND NOT THE LOG, STATED STRUCTURALLY
  // RATHER THAN LEFT AS AN OMISSION. ADR-360 measured this hole one module
  // over and it is re-measured here rather than carried: `ServerOptions`
  // declares `logger` as a BOOLEAN, and `buildServer` hands that boolean
  // straight to Fastify, so there is no sink an `inject` case can read back.
  // The error handler's own `request.log.error` is therefore unobservable from
  // any suite in this deployable, and the sentence `wired` throws reaches a
  // process log and nothing else.
  const server = read('apps', 'api', 'src', 'server.ts');
  expect(server).toContain('readonly logger?: boolean;');
  expect(server).toContain('const app = Fastify({ logger: options.logger ?? false });');
  expect(server).not.toContain('logger: FastifyBaseLogger');
});

// -----------------------------------------------------------------------------
// 3. The half-install, which this port CAN present and ADR-360's port could not
// -----------------------------------------------------------------------------

const EMPTY_RECON: ReconSnapshot = { asOf: '2026-08-27T06:00:00Z', openMismatches: [] };

/** A member a wiring slice has not written yet, in the honest shape: it throws. */
function unimplemented(): never {
  throw new Error('this member is not implemented in this deployment');
}

/**
 * The wiring slice that landed two of the four rows and left the other two.
 *
 * TYPED `InternalOpsSource` DELIBERATELY AND WITH NO CAST. The claim being
 * measured is that a half install SATISFIES this port rather than sneaking past
 * it, so `tsc` checks the object against the interface and a `runBatch` that
 * enqueues nothing is a well-typed implementation.
 */
function halfInstalled(jobId: string | null): InternalOpsSource {
  return {
    readDependencies: unimplemented,
    readJobs: unimplemented,
    readReconStatus: () => Promise.resolve(EMPTY_RECON),
    runBatch: () => Promise.resolve({ outcome: 'started', jobId }),
  };
}

test('a half-installed port is constructible, so ADR-360s impossibility does not carry', async () => {
  // THE MEASUREMENT THE ROW TURNS ON. ADR-360 ruled that `setAdminSessionSource`
  // admits no half-install because its interface declares one member. THAT IS A
  // FACT ABOUT THAT INTERFACE. This one declares four, and the object below is
  // a wiring slice that landed the recon read and the batch trigger and left
  // the two probes for later, which is precisely the deployment the port's own
  // docblock says nobody asked for.
  //
  // THE ANSWER IS 500 / 500 / 200 / 202 WHERE UNWIRED IS 500 ON ALL FOUR.
  setInternalOpsSource(halfInstalled('job-2026-08-26-1'));

  const answers = new Map((await everyRow()).map((row) => [row.key, row]));
  expect(answers.get(`POST ${BATCH_RUN_PATH}`)?.status).toBe(BATCH_RUN_ACCEPTED);
  expect(answers.get(`GET ${RECON_STATUS_PATH}`)?.status).toBe(200);
  expect(answers.get(`GET ${JOBS_PATH}`)?.status).toBe(500);
  expect(answers.get(`GET ${DEEP_HEALTH_PATH}`)?.status).toBe(500);
});

test('the half-installed batch row answers a started run with a job id, which is a success', async () => {
  // WHAT MAKES THE SHAPE ABOVE THE ONE ADR-356 PRICED RATHER THAN A SMALLER
  // VERSION OF AN UNWIRED DEPLOYMENT. The row that COMMANDS is the row that
  // turns from a refusal into an acceptance, and 202 is the contract's own
  // "accepted, the batch runs on the worker". An operator working an incident
  // reads that as the nightly batch retriggered.
  setInternalOpsSource(halfInstalled('job-2026-08-26-1'));

  const { app } = buildServer({ surface: 'operator', modules: onDisk });
  const res = await app.inject({
    method: 'POST',
    url: url(BATCH_RUN_PATH),
    payload: VALID_TRIGGER,
  });
  expect(res.statusCode).toBe(BATCH_RUN_ACCEPTED);
  expect(res.json()).toStrictEqual({
    trading_day: VALID_TRIGGER.trading_day,
    run_id: VALID_TRIGGER.run_id,
    reason: VALID_TRIGGER.reason,
    outcome: 'started',
    job_id: 'job-2026-08-26-1',
  });
});

test('the module already refuses the honest stub, and the guard is what bounds the harm', async () => {
  // THE OTHER HALF, AND IT IS THE REASON THIS ROW DOES NOT REPORT THE 202 ABOVE
  // AS AN UNGUARDED HOLE. `renderBatchRun` refuses `started` with a null job id
  // in this file's own words: "A run that started with nothing enqueued is a
  // trigger that reports success and does no work". So a stub that is HONEST
  // about having enqueued nothing is a 500, and the residue is a stub that
  // FABRICATES an id, which no guard inside this process can catch because the
  // id's truth lives in a queue this deployable cannot reach.
  setInternalOpsSource(halfInstalled(null));

  const { app } = buildServer({ surface: 'operator', modules: onDisk });
  const res = await app.inject({
    method: 'POST',
    url: url(BATCH_RUN_PATH),
    payload: VALID_TRIGGER,
  });
  expect(res.statusCode).toBe(500);
  expect(Object.keys(res.json<object>()).sort()).toStrictEqual(PROBLEM_KEYS);
});

test('a member that throws is indistinguishable on the wire from no port at all', async () => {
  // THE UNIFORMITY THE PORT'S DOCBLOCK CLAIMS, REPRODUCED, AND THE EXACT EDGE
  // IT DOES NOT COVER. "this file answers that the same way whichever method is
  // missing" is TRUE and it is measured here: a half-installed row whose member
  // throws returns the same document an unwired one returns. What the sentence
  // does not reach is a member that returns a PLAUSIBLE value, which is the 202
  // two cases above, and that is a gap in the claim rather than an error in it.
  setInternalOpsSource(null);
  const unwired = await everyRow();
  setInternalOpsSource({
    readDependencies: unimplemented,
    readJobs: unimplemented,
    readReconStatus: unimplemented,
    runBatch: unimplemented,
  });
  const throwing = await everyRow();

  const strip = (rows: readonly { key: string; status: number; body: unknown }[]): string =>
    JSON.stringify(
      rows.map((row) => ({
        key: row.key,
        status: row.status,
        body: { ...(row.body as Record<string, unknown>), instance: '<request id>' },
      })),
    );
  expect(strip(throwing)).toStrictEqual(strip(unwired));
});

// -----------------------------------------------------------------------------
// 4. What the deployment says about any of this at boot, which is nothing
// -----------------------------------------------------------------------------

test('the operator surface registers all four rows with nothing installed', async () => {
  // THE ANSWER TO "IS ANY REFUSAL PATH SILENT TO THE ONLY PERSON WHO COULD
  // ACT". The composition report is what `index.ts` prints at startup, and on
  // the operator surface it names four registered `/internal/*` routes and
  // withholds none of them. Every one of the four answers 500. So a deployment
  // that cannot serve a single operator row starts, reports four routes
  // registered, and says nothing anywhere about the port that makes all four
  // fail; the first person to learn is whoever makes a request.
  const { report } = buildServer({ surface: 'operator', modules: onDisk });
  const declared = INTERNAL_ENDPOINTS.map((route) => `${route.method} ${route.path}`);
  for (const key of declared) {
    expect(report.registered, key).toContain(key);
    expect(report.withheld, key).not.toContain(key);
  }
  expect(JSON.stringify(report)).not.toContain('setInternalOpsSource');
  for (const row of await everyRow()) expect(row.status, row.key).toBe(500);
});
