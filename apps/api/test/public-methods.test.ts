import { afterEach, expect, test } from 'vitest';

import { BASE_PATH, PROBLEM_MEDIA_TYPE, buildServer, discoverRouteModules } from '../src/index.ts';
import {
  MethodPageError,
  PUBLIC_METHODS_PATH,
  renderMethodPage,
  setMethodDefinitionSource,
} from '../src/routes/public-methods.ts';
import type {
  MethodDefinitionSource,
  StatisticDefinitionRow,
} from '../src/routes/public-methods.ts';

// CI-02, the `unit` project.
//
// WHAT THIS SUITE IS FOR. ADR-110 rules that `GET /public/methods/:statCode`
// answers with EVERY version of a definition, names the unsuperseded one, reads
// no clock, and refuses rather than guessing when the rows it is handed cannot
// be rendered. Each of those is asserted here through Fastify's real router by
// way of `inject`, which is the same pipeline a socket reaches, so a 404 in
// this file is produced the way a deployment's is.

/** Every module on disk, which is what the deployments actually compose. */
const onDisk = await discoverRouteModules();

/** The address, as a caller writes it. */
const url = (statCode: string): string => `${BASE_PATH}/public/methods/${statCode}`;

/**
 * ST-01, in two versions, which is the shape the whole design exists for.
 *
 * Version 1 is superseded by version 2. Version 2 is unsuperseded AND its
 * `effective_from` is in the future, which is `INV-M12-07`'s normal case rather
 * than an edge one: "definitions are frozen before the data exists" and
 * `effective_from` is always future at write time.
 */
const V1: StatisticDefinitionRow = {
  id: '11111111-1111-4111-8111-111111111111',
  stat_code: 'ST-01',
  version: 1,
  title: 'Evaluation pass rate',
  numerator_spec: 'accounts that passed evaluation in the window',
  denominator_spec: 'accounts that started evaluation in the window',
  exclusions: ['accounts closed for fraud'],
  window_spec: 'trailing 90 trading days',
  grain: 'per plan, and lineup total',
  min_sample: 250,
  measures: ['rate'],
  method_body_mdx: '# Evaluation pass rate\n\nThe denominator is the argument.',
  adr_ref: 'ADR-031',
  effective_from: '2026-09-01',
  superseded_by: '22222222-2222-4222-8222-222222222222',
};

const V2: StatisticDefinitionRow = {
  ...V1,
  id: '22222222-2222-4222-8222-222222222222',
  version: 2,
  exclusions: ['accounts closed for fraud', 'accounts that never traded'],
  adr_ref: 'ADR-032',
  effective_from: '2027-01-04',
  superseded_by: null,
};

/** A source over a fixed set of rows, filtering by code exactly as stored. */
function sourceOf(...rows: readonly StatisticDefinitionRow[]): MethodDefinitionSource {
  return {
    readDefinitions: (statCode: string) =>
      Promise.resolve(rows.filter((row) => row.stat_code === statCode)),
  };
}

// A source set by one test and read by the next is a suite that passes for the
// wrong reason, so the wiring is cleared after every case.
afterEach(() => {
  setMethodDefinitionSource(null);
});

// -----------------------------------------------------------------------------
// The module, as the directory listing hands it over
// -----------------------------------------------------------------------------

test('the route is on disk under its own name, and ADR-100s discovery accepts it', () => {
  const module = onDisk.find((m) => m.name === 'public-methods');
  expect(module).toBeDefined();
  expect(module?.routes).toStrictEqual([
    { method: 'GET', path: PUBLIC_METHODS_PATH, handler: expect.any(Function) },
  ]);
});

test('the public deployment registers it and the operator deployment withholds it', () => {
  const endpoint = `GET ${PUBLIC_METHODS_PATH}`;

  const publicSide = buildServer({ surface: 'public', modules: onDisk });
  expect(publicSide.report.registered).toContain(endpoint);
  expect(publicSide.report.withheld).not.toContain(endpoint);

  const operatorSide = buildServer({ surface: 'operator', modules: onDisk });
  // ADR-083: the admin origin answers 404 for this path by having nothing
  // there. A public path is not a path both deployments serve; only `/health`
  // is, and it is the only one.
  expect(operatorSide.report.withheld).toContain(endpoint);
  expect(operatorSide.report.registered).not.toContain(endpoint);
});

// -----------------------------------------------------------------------------
// The answer
// -----------------------------------------------------------------------------

test('every version is served, ascending, with the ADR reference for every change', async () => {
  setMethodDefinitionSource(sourceOf(V2, V1));
  const { app } = buildServer({ surface: 'public', modules: onDisk });

  const res = await app.inject({ method: 'GET', url: url('ST-01') });
  expect(res.statusCode).toBe(200);
  const body = res.json() as {
    stat_code: string;
    live_version: number;
    versions: Array<Record<string, unknown>>;
  };

  // M12 section 4: "The method page, all versions, with the ADR reference for
  // every change". The source handed them over newest first on purpose.
  expect(body.stat_code).toBe('ST-01');
  expect(body.versions.map((v) => v.version)).toStrictEqual([1, 2]);
  expect(body.versions.map((v) => v.adr_ref)).toStrictEqual(['ADR-031', 'ADR-032']);
  expect(body.versions[0]?.superseded_by_version).toBe(2);
  expect(body.versions[1]?.superseded_by_version).toBeNull();
  expect(body.versions[0]?.exclusions).toStrictEqual(['accounts closed for fraud']);
  expect(body.versions[1]?.min_sample).toBe(250);
  expect(body.versions[1]?.measures).toStrictEqual(['rate']);

  await app.close();
});

test('live_version is the unsuperseded row even when it has not taken effect yet', async () => {
  setMethodDefinitionSource(sourceOf(V1, V2));
  const { app } = buildServer({ surface: 'public', modules: onDisk });

  const res = await app.inject({ method: 'GET', url: url('ST-01') });
  const body = res.json() as { live_version: number; versions: Array<{ effective_from: string }> };

  // INV-M12-07: `effective_from` is always in the future at write time, so the
  // unsuperseded row is regularly one that is not yet in force. The response
  // names supersession, which the schema decides, and carries the date, which
  // the reader decides on. NO CLOCK IS READ, which is what keeps one cached
  // response true for every caller who shares it.
  expect(body.live_version).toBe(2);
  expect(body.versions[1]?.effective_from).toBe('2027-01-04');

  await app.close();
});

test('neither surrogate key reaches the response, which is section 1s allowlist', async () => {
  setMethodDefinitionSource(sourceOf(V1, V2));
  const { app } = buildServer({ surface: 'public', modules: onDisk });

  const res = await app.inject({ method: 'GET', url: url('ST-01') });
  const raw = res.body;
  expect(raw).not.toContain('11111111-1111-4111-8111-111111111111');
  expect(raw).not.toContain('22222222-2222-4222-8222-222222222222');
  expect(raw).not.toContain('superseded_by"');

  const body = res.json() as { versions: Array<Record<string, unknown>> };
  expect(Object.keys(body.versions[0] ?? {}).sort()).toStrictEqual([
    'adr_ref',
    'denominator_spec',
    'effective_from',
    'exclusions',
    'grain',
    'measures',
    'method_body_mdx',
    'min_sample',
    'numerator_spec',
    'superseded_by_version',
    'title',
    'version',
    'window_spec',
  ]);

  await app.close();
});

test('the stat code reaches the source verbatim, because an address is exact', async () => {
  const seen: string[] = [];
  setMethodDefinitionSource({
    readDefinitions: (statCode: string) => {
      seen.push(statCode);
      return Promise.resolve([]);
    },
  });
  const { app } = buildServer({ surface: 'public', modules: onDisk });

  await app.inject({ method: 'GET', url: url('st-01') });
  await app.inject({ method: 'GET', url: url('ST-01') });
  // Not upper-cased, not trimmed, not otherwise repaired. A normalising route
  // turns two addresses into one silently, and the published `method_path`
  // already carries the code as it is stored.
  expect(seen).toStrictEqual(['st-01', 'ST-01']);

  await app.close();
});

// -----------------------------------------------------------------------------
// The two failures, and the one a caller can cause
// -----------------------------------------------------------------------------

test('an unknown stat code is a 404 problem document and means exactly one thing', async () => {
  setMethodDefinitionSource(sourceOf(V1, V2));
  const { app } = buildServer({ surface: 'public', modules: onDisk });

  const res = await app.inject({ method: 'GET', url: url('ST-99') });
  expect(res.statusCode).toBe(404);
  expect(res.headers['content-type']).toContain(PROBLEM_MEDIA_TYPE);
  const body = res.json() as { code: string; status: number; type: string };
  expect(body.code).toBe('not_found');
  expect(body.status).toBe(404);
  expect(body.type).toBe('https://meritfutures.com/problems/not_found');

  await app.close();
});

test('an unwired source is a 500 and never a 404, because the statistic may exist', async () => {
  // The default. Nothing in this tree wires a source, so this is the state a
  // deployment built today is in.
  const { app } = buildServer({ surface: 'public', modules: onDisk });

  const res = await app.inject({ method: 'GET', url: url('ST-01') });
  expect(res.statusCode).toBe(500);
  expect(res.headers['content-type']).toContain(PROBLEM_MEDIA_TYPE);
  expect((res.json() as { code: string }).code).toBe('internal_error');

  await app.close();
});

// -----------------------------------------------------------------------------
// The refusals, asserted directly on the renderer
// -----------------------------------------------------------------------------

test('a row for another statistic is refused rather than published', () => {
  expect(() => renderMethodPage('ST-01', [V2, { ...V1, stat_code: 'ST-02' }])).toThrow(
    MethodPageError,
  );
});

test('two rows at one version are refused, which the code-version index forbids', () => {
  expect(() => renderMethodPage('ST-01', [V2, { ...V1, version: 2, superseded_by: null }])).toThrow(
    /two rows at version 2/,
  );
});

test('two unsuperseded versions are refused, which the partial unique index forbids', () => {
  expect(() => renderMethodPage('ST-01', [{ ...V1, superseded_by: null }, V2])).toThrow(
    /two unsuperseded versions/,
  );
});

test('a supersession pointing outside this statistics own versions is refused', () => {
  // Rendering `null` here would publish a superseded definition as the live
  // one, which is the wrong method beside a number rather than a missing field.
  expect(() =>
    renderMethodPage('ST-01', [{ ...V1, superseded_by: '33333333-3333-4333-8333-333333333333' }]),
  ).toThrow(/cannot render a supersession it cannot name/);
});

test('a chain in which every version is superseded is refused', () => {
  expect(() =>
    renderMethodPage('ST-01', [
      { ...V1, superseded_by: V2.id },
      { ...V2, superseded_by: V1.id },
    ]),
  ).toThrow(/every one of them is superseded/);
});
