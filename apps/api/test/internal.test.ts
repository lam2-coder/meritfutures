import { afterEach, expect, test } from 'vitest';

import { BASE_PATH, PROBLEM_MEDIA_TYPE, buildServer, discoverRouteModules } from '../src/index.ts';
import { REQUIRED_FACTORS } from '../src/routes/auth.ts';
import type { RequiredFactor } from '../src/routes/auth.ts';
import {
  BATCH_RUN_ACCEPTED,
  BATCH_RUN_OUTCOMES,
  BATCH_RUN_PATH,
  DEEP_HEALTH_DEPENDENCIES,
  DEEP_HEALTH_PATH,
  INTERNAL_ENDPOINTS,
  INTERNAL_REQUIRED_FACTORS,
  InternalOpsError,
  JOBS_PATH,
  OPERATOR_FACTOR,
  RECON_STATUS_PATH,
  isCalendarDay,
  renderBatchRun,
  renderDeepHealth,
  renderJobs,
  renderReconStatus,
  setInternalOpsSource,
  validateBatchRunRequest,
  worstOf,
} from '../src/routes/internal.ts';
import type {
  BatchRunCommand,
  BatchRunResult,
  DependencyCheck,
  InternalOpsSource,
  JobsSnapshot,
  ReconMismatchRow,
  ReconSnapshot,
} from '../src/routes/internal.ts';

// CI-02, the `unit` project.
//
// WHAT THIS SUITE IS FOR, IN THE ORDER THE SESSION WAS DISPATCHED TO ANSWER IT.
//
// 1. THE SURFACE. The whole reason a number was held for this session was
//    whether anything refuses an `/internal/*` call arriving on the public
//    surface. Something does, in three places, and the first block below is
//    that refusal asserted against the REAL module set on disk rather than
//    against a synthetic module: `server.test.ts` and `listen.test.ts` already
//    watch the mechanism with a fabricated `/internal/jobs`, and until this
//    file landed there was no real operator route for either of them to be
//    about. The 404 here is Fastify's own, produced by nothing being
//    registered, which is ADR-083 section 4's whole claim.
// 2. THE FOUR ROWS. Each render function is asserted through the real router by
//    way of `inject`, which is the pipeline a socket reaches.
// 3. THE REFUSALS. Every throw in the module is executed, because a refusal
//    that has never fired is a refusal nobody has read.

/** Every module on disk, which is what the deployments actually compose. */
const onDisk = await discoverRouteModules();

const url = (path: string): string => `${BASE_PATH}${path}`;

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const CHECKS: readonly DependencyCheck[] = [
  { name: 'db', status: 'ok', checked_at: '2026-08-27T05:00:00Z', detail: null },
  { name: 'sftp', status: 'ok', checked_at: '2026-08-27T05:00:01Z', detail: null },
  { name: 'rise', status: 'ok', checked_at: '2026-08-27T05:00:02Z', detail: null },
  { name: 'psp', status: 'ok', checked_at: '2026-08-27T05:00:03Z', detail: null },
];

const SNAPSHOT: JobsSnapshot = {
  queues: [
    { queue: 'provisioning', depth: 3, failed: 0 },
    { queue: 'nightly-batch', depth: 0, failed: 1 },
  ],
  deadManSwitches: [
    {
      job: 'Nightly batch',
      severity: 'S2',
      expected_by: '06:00 CT',
      last_completed_at: '2026-08-27T11:00:00Z',
      firing: false,
    },
    {
      job: 'Replay self-audit',
      severity: 'S1',
      expected_by: '07:00 CT',
      last_completed_at: null,
      firing: true,
    },
  ],
};

const MISMATCH: ReconMismatchRow = {
  accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tradingDay: '2026-08-26',
  ourBalanceCents: 5_000_00n,
  platformBalanceCents: 4_999_00n,
  ourSource: 'ledger',
  sourceIngestFileId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  openedAt: '2026-08-27T05:00:00Z',
};

const RECON: ReconSnapshot = { asOf: '2026-08-27T06:00:00Z', openMismatches: [MISMATCH] };

const VALID_BODY = {
  trading_day: '2026-08-26',
  run_id: 'ops-2026-08-26-1',
  reason: 'ingest arrived after the batch window',
};

/** A source that answers everything, so a test asserts one thing at a time. */
function sourceFor(overrides: Partial<InternalOpsSource> = {}): InternalOpsSource {
  return {
    readDependencies: () => Promise.resolve(CHECKS),
    readJobs: () => Promise.resolve(SNAPSHOT),
    readReconStatus: () => Promise.resolve(RECON),
    runBatch: (command: BatchRunCommand): Promise<BatchRunResult> =>
      Promise.resolve({ outcome: 'started', jobId: `job-${command.runId}` }),
    ...overrides,
  };
}

afterEach(() => {
  setInternalOpsSource(null);
});

// -----------------------------------------------------------------------------
// 1. The surface, which is what the number was held for
// -----------------------------------------------------------------------------

test('the internal module is discovered from the directory and registers on the operator surface', () => {
  const { report } = buildServer({ surface: 'operator', modules: onDisk });
  expect(report.modules).toContain('internal');
  for (const route of INTERNAL_ENDPOINTS) {
    const endpoint = `${route.method} ${route.path}`;
    expect(report.registered).toContain(endpoint);
    expect(report.withheld).not.toContain(endpoint);
  }
});

test('every row this session declares is WITHHELD from the public surface', () => {
  // THE ASSERTION THE SESSION EXISTS FOR. `surfaceServes` is not a no-op on
  // these paths: all four are under `/internal`, so the `api` deployment
  // registers none of them and answers 404 by having nothing there rather than
  // by refusing. THE SUBJECT IS THIS MODULE'S ROUTES AND NOT THE WHOLE COMPOSED
  // SET, on `auth.test.ts`'s stated reason: seven other route sessions are open
  // and an assertion about their files would go red for a reason that has
  // nothing to do with this one.
  const { report } = buildServer({ surface: 'public', modules: onDisk });
  for (const route of INTERNAL_ENDPOINTS) {
    const endpoint = `${route.method} ${route.path}`;
    expect(report.withheld).toContain(endpoint);
    expect(report.registered).not.toContain(endpoint);
  }
});

test('the public surface answers 404 in the contracts shape for all four rows', async () => {
  // API_CONTRACT section 12: "Trader session calls `/internal/*` from the public
  // origin | `admin_sso` | 404". The source is WIRED here on purpose: a 404
  // produced by an unwired port would prove nothing, and this one is produced
  // with a working handler sitting in a module the router never heard about.
  setInternalOpsSource(sourceFor());
  const { app } = buildServer({ surface: 'public', modules: onDisk });
  for (const route of INTERNAL_ENDPOINTS) {
    const res = await app.inject({ method: route.method, url: url(route.path) });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain(PROBLEM_MEDIA_TYPE);
    expect(res.json()).toMatchObject({ code: 'not_found', status: 404 });
  }
});

test('no internal path carries the base path, so none classifies as public', () => {
  for (const route of INTERNAL_ENDPOINTS) {
    expect(route.path.startsWith(BASE_PATH)).toBe(false);
    expect(route.path.startsWith('/internal/')).toBe(true);
  }
});

test('the required-factor declaration is admin_sso on every row and covers exactly them', () => {
  expect(REQUIRED_FACTORS).toContain<RequiredFactor>(OPERATOR_FACTOR);
  expect(Object.keys(INTERNAL_REQUIRED_FACTORS)).toHaveLength(INTERNAL_ENDPOINTS.length);
  for (const route of INTERNAL_ENDPOINTS)
    expect(INTERNAL_REQUIRED_FACTORS[`${route.method} ${route.path}`]).toBe('admin_sso');
});

test('the four rows are API_CONTRACT section 9s four and no fifth', () => {
  expect(INTERNAL_ENDPOINTS.map((r) => `${r.method} ${r.path}`).sort()).toStrictEqual([
    'GET /internal/health/deep',
    'GET /internal/jobs',
    'GET /internal/recon/status',
    'POST /internal/batch/run',
  ]);
});

// -----------------------------------------------------------------------------
// 2. GET /internal/health/deep
// -----------------------------------------------------------------------------

test('the deep health row answers the four dependencies in the contracts order', async () => {
  setInternalOpsSource(sourceFor());
  const { app } = buildServer({ surface: 'operator', modules: onDisk });
  const res = await app.inject({ method: 'GET', url: url(DEEP_HEALTH_PATH) });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { status: string; dependencies: { name: string }[] };
  expect(body.status).toBe('ok');
  expect(body.dependencies.map((d) => d.name)).toStrictEqual([...DEEP_HEALTH_DEPENDENCIES]);
});

test('the order is the contracts and never the ports', () => {
  const reversed = [...CHECKS].reverse();
  expect(renderDeepHealth(reversed).dependencies.map((d) => d.name)).toStrictEqual([
    ...DEEP_HEALTH_DEPENDENCIES,
  ]);
});

test('the overall status is the worst of the four and ok only when every one is', () => {
  expect(worstOf(['ok', 'ok', 'ok', 'ok'])).toBe('ok');
  expect(worstOf(['ok', 'degraded', 'ok', 'ok'])).toBe('degraded');
  expect(worstOf(['ok', 'degraded', 'down', 'ok'])).toBe('down');
  // Through the renderer, so the fold and the response cannot disagree.
  const degraded = CHECKS.map((c) =>
    c.name === 'psp' ? { ...c, status: 'degraded' as const } : c,
  );
  expect(renderDeepHealth(degraded).status).toBe('degraded');
});

test('a missing probe is a throw and never a passing one', () => {
  expect(() => renderDeepHealth(CHECKS.filter((c) => c.name !== 'sftp'))).toThrow(
    /no result for `sftp`/,
  );
  // The direction that matters: it is not that three of four is a smaller
  // answer, it is that the response would report the estate on the strength of
  // the checks that happened to run.
  expect(() => renderDeepHealth([])).toThrow(InternalOpsError);
});

test('a duplicated, unknown or badly stamped probe is refused', () => {
  expect(() => renderDeepHealth([...CHECKS, CHECKS[0]!])).toThrow(/reported `db` twice/);
  expect(() => renderDeepHealth([...CHECKS, { ...CHECKS[0]!, name: 'redis' as never }])).toThrow(
    /not one of db, sftp, rise, psp/,
  );
  expect(() =>
    renderDeepHealth(CHECKS.map((c) => (c.name === 'db' ? { ...c, status: 'fine' as never } : c))),
  ).toThrow(/not one of ok \| degraded \| down/);
  expect(() =>
    renderDeepHealth(CHECKS.map((c) => (c.name === 'db' ? { ...c, checked_at: 'today' } : c))),
  ).toThrow(/not an ISO 8601 instant/);
});

// -----------------------------------------------------------------------------
// 3. GET /internal/jobs
// -----------------------------------------------------------------------------

test('the jobs row carries queue depth, failures and every switch, with firing derived', async () => {
  setInternalOpsSource(sourceFor());
  const { app } = buildServer({ surface: 'operator', modules: onDisk });
  const res = await app.inject({ method: 'GET', url: url(JOBS_PATH) });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toStrictEqual({
    queues: SNAPSHOT.queues,
    dead_man_switches: SNAPSHOT.deadManSwitches,
    firing: 1,
  });
});

test('firing is derived from the array beside it and cannot disagree with it', () => {
  const allFiring = SNAPSHOT.deadManSwitches.map((s) => ({ ...s, firing: true }));
  const rendered = renderJobs({ ...SNAPSHOT, deadManSwitches: allFiring });
  expect(rendered.firing).toBe(rendered.dead_man_switches.filter((s) => s.firing).length);
  expect(rendered.firing).toBe(2);
});

test('an empty switch list is a throw and an empty queue list is not', () => {
  // CRON_INVENTORY: "a job in this table without a dead-man switch is a job that
  // does not exist". Nothing firing and nothing watched are the two states this
  // page exists to tell apart.
  expect(() => renderJobs({ ...SNAPSHOT, deadManSwitches: [] })).toThrow(
    /nothing is being watched/,
  );
  expect(renderJobs({ ...SNAPSHOT, queues: [] }).queues).toStrictEqual([]);
});

test('a broken aggregate is refused rather than published as a small number', () => {
  const bad =
    (queue: Partial<JobsSnapshot['queues'][number]>): (() => unknown) =>
    () =>
      renderJobs({ ...SNAPSHOT, queues: [{ queue: 'q', depth: 0, failed: 0, ...queue }] });
  expect(bad({ depth: -1 })).toThrow(/which is not a count/);
  expect(bad({ failed: 1.5 })).toThrow(/which is not a count/);
  expect(bad({ queue: '' })).toThrow(/unnamed queue/);
  expect(() =>
    renderJobs({
      ...SNAPSHOT,
      queues: [
        { queue: 'q', depth: 0, failed: 0 },
        { queue: 'q', depth: 9, failed: 0 },
      ],
    }),
  ).toThrow(/reported twice/);
});

test('a switch with no severity, no expected-by or a duplicate name is refused', () => {
  const withSwitch =
    (patch: Record<string, unknown>): (() => unknown) =>
    () =>
      renderJobs({
        ...SNAPSHOT,
        deadManSwitches: [{ ...SNAPSHOT.deadManSwitches[0]!, ...patch }],
      });
  expect(withSwitch({ severity: 'S4' })).toThrow(/not one of S1 \| S2 \| S3/);
  expect(withSwitch({ expected_by: '' })).toThrow(/watches nothing/);
  expect(withSwitch({ job: '' })).toThrow(/unnamed job/);
  expect(withSwitch({ last_completed_at: 'yesterday' })).toThrow(/not an ISO 8601 instant/);
  expect(() =>
    renderJobs({
      ...SNAPSHOT,
      deadManSwitches: [SNAPSHOT.deadManSwitches[0]!, SNAPSHOT.deadManSwitches[0]!],
    }),
  ).toThrow(/reported twice/);
});

// -----------------------------------------------------------------------------
// 4. GET /internal/recon/status
// -----------------------------------------------------------------------------

test('the recon row carries the delta and the age, both computed here', async () => {
  setInternalOpsSource(sourceFor());
  const { app } = buildServer({ surface: 'operator', modules: onDisk });
  const res = await app.inject({ method: 'GET', url: url(RECON_STATUS_PATH) });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toStrictEqual({
    as_of: '2026-08-27T06:00:00Z',
    open_mismatches: [
      {
        account_id: MISMATCH.accountId,
        trading_day: '2026-08-26',
        our_balance_cents: 500_000,
        platform_balance_cents: 499_900,
        delta_cents: 100,
        our_source: 'ledger',
        source_ingest_file_id: MISMATCH.sourceIngestFileId,
        opened_at: '2026-08-27T05:00:00Z',
        age_seconds: 3600,
      },
    ],
  });
});

test('the delta is recomputed and is never carried, which is 0014s generated column', () => {
  // `0014` declares delta_cents GENERATED ALWAYS AS (our - platform) STORED "so
  // the two sides and their difference can never disagree". Nothing in the port
  // supplies a delta, so nothing can supply a wrong one.
  const negative = { ...MISMATCH, ourBalanceCents: 100n, platformBalanceCents: 400n };
  const [row] = renderReconStatus({ ...RECON, openMismatches: [negative] }).open_mismatches;
  expect(row?.delta_cents).toBe(-300);
});

test('an open mismatch whose two balances are equal is refused', () => {
  // `reconciliations_status_matches_delta` refuses exactly that row in the
  // database. Publishing it here would put a zero delta on the page an operator
  // reads to decide whether the estate reconciles.
  const equal = { ...MISMATCH, platformBalanceCents: MISMATCH.ourBalanceCents };
  expect(() => renderReconStatus({ ...RECON, openMismatches: [equal] })).toThrow(
    /two balances are equal/,
  );
});

test('the recon refusals are the DDLs own constraints, one for one', () => {
  const only =
    (row: ReconMismatchRow): (() => unknown) =>
    () =>
      renderReconStatus({ ...RECON, openMismatches: [row] });
  expect(only({ ...MISMATCH, tradingDay: '2026-02-30' })).toThrow(/not a YYYY-MM-DD/);
  expect(only({ ...MISMATCH, ourSource: 'vendor' as never })).toThrow(/not one of rule_state/);
  expect(only({ ...MISMATCH, openedAt: '2026-08-27T07:00:00Z' })).toThrow(/negative age/);
  expect(only({ ...MISMATCH, openedAt: 'recently' })).toThrow(/not an ISO 8601 instant/);
  expect(() => renderReconStatus({ ...RECON, asOf: 'now' })).toThrow(/not an ISO 8601 instant/);
  expect(() => renderReconStatus({ ...RECON, openMismatches: [MISMATCH, MISMATCH] })).toThrow(
    /two open mismatches/,
  );
});

test('the mismatches are ordered oldest first, with a total tie-break', () => {
  const older = {
    ...MISMATCH,
    accountId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    openedAt: '2026-08-25T05:00:00Z',
  };
  const sameAge = { ...MISMATCH, accountId: '00000000-0000-4000-8000-000000000000' };
  const rendered = renderReconStatus({
    ...RECON,
    openMismatches: [MISMATCH, older, sameAge],
  }).open_mismatches;
  expect(rendered.map((r) => r.account_id)).toStrictEqual([
    older.accountId,
    sameAge.accountId,
    MISMATCH.accountId,
  ]);
});

test('an empty mismatch set is a real answer and not a refusal', () => {
  // The estate reconciling is the normal case, and a page that threw on it
  // would be a page nobody could use on a good day.
  expect(renderReconStatus({ ...RECON, openMismatches: [] })).toStrictEqual({
    as_of: RECON.asOf,
    open_mismatches: [],
  });
});

// -----------------------------------------------------------------------------
// 5. POST /internal/batch/run
// -----------------------------------------------------------------------------

test('a valid trigger is accepted with the anchor and the reason echoed back', async () => {
  setInternalOpsSource(sourceFor());
  const { app } = buildServer({ surface: 'operator', modules: onDisk });
  const res = await app.inject({ method: 'POST', url: url(BATCH_RUN_PATH), payload: VALID_BODY });
  expect(res.statusCode).toBe(BATCH_RUN_ACCEPTED);
  expect(res.json()).toStrictEqual({
    trading_day: '2026-08-26',
    run_id: 'ops-2026-08-26-1',
    reason: 'ingest arrived after the batch window',
    outcome: 'started',
    job_id: 'job-ops-2026-08-26-1',
  });
});

test('a duplicate answers the same 202, which is the contracts replay rule', async () => {
  // Section 1: "Replaying a key with an identical body returns the original
  // response verbatim". A duplicate that answered a different status would
  // return a different response to the replay.
  setInternalOpsSource(
    sourceFor({ runBatch: () => Promise.resolve({ outcome: 'duplicate', jobId: null }) }),
  );
  const { app } = buildServer({ surface: 'operator', modules: onDisk });
  const res = await app.inject({ method: 'POST', url: url(BATCH_RUN_PATH), payload: VALID_BODY });
  expect(res.statusCode).toBe(BATCH_RUN_ACCEPTED);
  expect(res.json()).toMatchObject({ outcome: 'duplicate', job_id: null });
});

test('reason is required, and a blank one is a missing one', () => {
  const errorsFor = (body: unknown): readonly string[] => {
    const result = validateBatchRunRequest(body);
    expect(result.ok).toBe(false);
    return result.ok ? [] : result.errors.map((e) => e.path);
  };
  expect(errorsFor({ ...VALID_BODY, reason: undefined })).toStrictEqual(['reason']);
  expect(errorsFor({ ...VALID_BODY, reason: '   ' })).toStrictEqual(['reason']);
  expect(errorsFor({ ...VALID_BODY, reason: 4 })).toStrictEqual(['reason']);
});

test('both halves of the anchor are required, because an anchor is a pair', () => {
  const paths = (body: unknown): readonly string[] => {
    const result = validateBatchRunRequest(body);
    return result.ok ? [] : result.errors.map((e) => e.path);
  };
  expect(paths({ reason: 'x' })).toStrictEqual(['trading_day', 'run_id']);
  expect(paths({ ...VALID_BODY, trading_day: '2026-02-30' })).toStrictEqual(['trading_day']);
  expect(paths({ ...VALID_BODY, run_id: 'ops 1' })).toStrictEqual(['run_id']);
  expect(paths({ ...VALID_BODY, run_id: '-leading-hyphen' })).toStrictEqual(['run_id']);
  expect(paths({ ...VALID_BODY, run_id: 'x'.repeat(65) })).toStrictEqual(['run_id']);
  expect(paths({ ...VALID_BODY, run_id: 'x'.repeat(64) })).toStrictEqual([]);
  expect(paths('not an object')).toStrictEqual(['']);
  expect(paths([VALID_BODY])).toStrictEqual(['']);
});

test('an unknown field is ignored rather than refused, and reason is stored trimmed', () => {
  // API_CONTRACT section 12's own row for a client-supplied price: "field
  // ignored". That is what lets M02's `from_stage`, which the contract does not
  // carry, be sent without this route inventing a meaning for it.
  const result = validateBatchRunRequest({
    ...VALID_BODY,
    reason: '  late ingest  ',
    from_stage: 'rule_fold',
  });
  expect(result.ok).toBe(true);
  expect(result.ok && result.value).toStrictEqual({
    trading_day: '2026-08-26',
    run_id: 'ops-2026-08-26-1',
    reason: 'late ingest',
  });
});

test('the validation runs before the port, so a malformed trigger is 400 while unwired', async () => {
  // Nothing is wired. An incident-time typo must not answer 500 on an unwired
  // process and 400 on a wired one, which would be two answers to one request.
  const { app } = buildServer({ surface: 'operator', modules: onDisk });
  const res = await app.inject({
    method: 'POST',
    url: url(BATCH_RUN_PATH),
    payload: { trading_day: 'yesterday' },
  });
  expect(res.statusCode).toBe(400);
  expect(res.headers['content-type']).toContain(PROBLEM_MEDIA_TYPE);
  const body = res.json() as { code: string; errors: { path: string }[] };
  expect(body.code).toBe('validation_failed');
  expect(body.errors.map((e) => e.path)).toStrictEqual(['trading_day', 'run_id', 'reason']);
});

test('a started run with no job is refused, and so is a duplicate that produced one', () => {
  // The two sharpest assertions in the module. A trigger that reports success
  // and enqueues nothing is RB-01's failure arriving as a 202; a duplicate
  // carrying a job id is two runs under one `(trading_day, run_id)` anchor.
  expect(() => renderBatchRun(VALID_BODY, { outcome: 'started', jobId: null })).toThrow(
    /reports success and does no work/,
  );
  expect(() => renderBatchRun(VALID_BODY, { outcome: 'resumed', jobId: null })).toThrow(
    /reports success and does no work/,
  );
  expect(() => renderBatchRun(VALID_BODY, { outcome: 'duplicate', jobId: 'job-1' })).toThrow(
    /two runs standing under one anchor/,
  );
  expect(() => renderBatchRun(VALID_BODY, { outcome: 'queued' as never, jobId: 'job-1' })).toThrow(
    /not one of started \| resumed \| duplicate/,
  );
  // The three that are well formed all render.
  for (const outcome of BATCH_RUN_OUTCOMES) {
    const jobId = outcome === 'duplicate' ? null : 'job-1';
    expect(renderBatchRun(VALID_BODY, { outcome, jobId }).outcome).toBe(outcome);
  }
});

test('the port is handed the validated command in this codebases casing', async () => {
  const seen: BatchRunCommand[] = [];
  setInternalOpsSource(
    sourceFor({
      runBatch: (command) => {
        seen.push(command);
        return Promise.resolve({ outcome: 'resumed', jobId: 'job-2' });
      },
    }),
  );
  const { app } = buildServer({ surface: 'operator', modules: onDisk });
  await app.inject({
    method: 'POST',
    url: url(BATCH_RUN_PATH),
    payload: { ...VALID_BODY, reason: ' resume after RB-01 ' },
  });
  expect(seen).toStrictEqual([
    {
      tradingDay: '2026-08-26',
      runId: 'ops-2026-08-26-1',
      reason: 'resume after RB-01',
    },
  ]);
});

// -----------------------------------------------------------------------------
// 6. The unwired deployment
// -----------------------------------------------------------------------------

test('an unset port is a 500 on every row and never a 503', async () => {
  // 503 invites a retry against a process that will never succeed, and on the
  // batch row every retry is another manual trigger during an incident.
  const { app } = buildServer({ surface: 'operator', modules: onDisk });
  for (const route of INTERNAL_ENDPOINTS) {
    // `payload` is spread in rather than set to `undefined`, because
    // `exactOptionalPropertyTypes` makes an explicit `undefined` a different
    // thing from an absent key and `InjectOptions` admits only the second.
    const res = await app.inject({
      method: route.method,
      url: url(route.path),
      ...(route.method === 'POST' ? { payload: VALID_BODY } : {}),
    });
    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toContain(PROBLEM_MEDIA_TYPE);
    expect(res.json()).toMatchObject({ code: 'internal_error' });
  }
});

test('the unwire direction of the setter works, so no test reads another tests fixture', () => {
  setInternalOpsSource(sourceFor());
  setInternalOpsSource(null);
  expect(() => renderDeepHealth(CHECKS)).not.toThrow();
});

// -----------------------------------------------------------------------------
// 7. The calendar helper, which both the batch row and the recon row read
// -----------------------------------------------------------------------------

test('a calendar day is a day that exists', () => {
  expect(isCalendarDay('2026-08-26')).toBe(true);
  expect(isCalendarDay('2024-02-29')).toBe(true);
  expect(isCalendarDay('2026-02-29')).toBe(false);
  expect(isCalendarDay('2026-13-01')).toBe(false);
  expect(isCalendarDay('2026-8-26')).toBe(false);
  expect(isCalendarDay('2026-08-26T00:00:00Z')).toBe(false);
  expect(isCalendarDay('')).toBe(false);
});
