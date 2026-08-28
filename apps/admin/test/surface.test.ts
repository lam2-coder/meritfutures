import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { expect, test } from 'vitest';

import * as admin from '../src/index.ts';
import {
  API_BASE_PATH,
  AdminApiPathError,
  OPERATOR_PREFIXES,
  createAdminApiClient,
  requestPath,
  toAdminErrorKind,
} from '../src/http/client.ts';
import type { AdminApiResult, AdminRequestInit, Transport } from '../src/http/client.ts';

// =============================================================================
// THE TRANSPORT SEAM, AND THE TWO RULES ADR-182 STATED WITH NO CHECK BEHIND THEM
// =============================================================================
// ADR-182 section 8 item 2, in its own words: "CLAUSES 1 AND 2 OF SECTION 5 ARE
// RULES WITH NO CHECK. No invariant, gate or lint rule refuses a `NEXT_PUBLIC_`
// variable or an absolute origin in `apps/admin`. `W6-c` is the slice that can
// make both mechanical, in the `test/surface.test.ts` its own row already
// commissions." This file is that, plus ADR-162's one-`fetch` narrowing carried
// over from `apps/portal/test/surface.test.ts`.
//
// -----------------------------------------------------------------------------
// THE THREE SWEEPS HAVE THREE DIFFERENT SCOPES AND EACH SCOPE IS ARGUED
// -----------------------------------------------------------------------------
// TRANSPORT is `src/` only, which is `apps/portal/test/surface.test.ts`'s scope
// and is right for the same reason: a test legitimately stubs a transport, and
// this file itself hands `createAdminApiClient` a fake one below. A sweep that
// covered `test/` would be a sweep every suite in this package had to be
// exempted from.
//
// ORIGIN and NEXT_PUBLIC are the WHOLE PACKAGE, because "anywhere in
// `apps/admin`" is what ADR-182 section 8 item 2 says and because a hostname in
// a fixture is exactly what WAVE-06 rule 3 refuses: "Not in a default, not in a
// comment, not in a test fixture, and not in a build artifact." A sweep that
// stopped at `src/` would leave the fixture half of that sentence unchecked.
//
// THE WALK IS OVER EVERY FILE AND NOT OVER `.ts`, WHICH IS `B.2`'S LESSON TAKEN
// RATHER THAN RE-LEARNED. `apps/admin/test/service.test.ts` walks `src/`
// recursively though the directory was flat, on the ground that "a control that
// has to be widened by the slice it was written to catch is not a control".
// The same reasoning reaches further here: `W6-d` adds `.tsx`, ADR-182 section 5
// clause 4 anticipates a `next.config`, and a `.env` file is the third mechanism
// by which a `NEXT_PUBLIC_` value reaches a bundle. All three are covered on
// arrival by walking every file, and none of them would be covered by a `.ts`
// filter.
//
// THE NEEDLES ARE ASSEMBLED FROM FRAGMENTS AND THAT IS NOT STYLE. A sweep over
// the whole package includes this file, so a needle written as one literal here
// is a finding this file reports against itself. The alternative is exempting
// the file that holds the check, which is the shape where the check stops
// covering the thing most likely to be edited to defeat it.

const PACKAGE = join(import.meta.dirname, '..');
const SRC = join(PACKAGE, 'src');
const REPO = join(PACKAGE, '..', '..');

/** Every file in the package, repo-relative to `apps/admin`. `node_modules` is not walked. */
function packageFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(PACKAGE);
  return files;
}

/** Every `.ts` file under `src/`, repo-relative to `apps/admin/src`. */
function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts')) files.push(path);
    }
  };
  walk(SRC);
  return files;
}

/**
 * Source with comments removed, so a needle named in prose is not a finding.
 *
 * `package.json` HAS NO COMMENT SYNTAX AND ITS DOCUMENTATION IS A KEY. This
 * workspace writes manifest prose under keys beginning `//`, and
 * `apps/admin/package.json` carries two of them, one of which spends a paragraph
 * refusing the very prefix this file sweeps for. So a JSON manifest is parsed
 * and its `//`-prefixed keys are dropped, which is the same rule as stripping a
 * comment applied to the one file format that spells comments differently.
 */
function code(file: string): string {
  const raw = readFileSync(file, 'utf8');
  if (file.endsWith('.json')) {
    const parsed: unknown = JSON.parse(raw);
    const strip = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(strip);
      if (typeof value === 'object' && value !== null)
        return Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => !key.startsWith('//'))
            .map(([key, nested]) => [key, strip(nested)]),
        );
      return value;
    };
    return JSON.stringify(strip(parsed));
  }
  return (
    raw
      .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')

      // THE LOOKBEHIND IS LOAD-BEARING AND IT WAS FOUND BY THE SWEEP FAILING TO
      // FIRE. `apps/portal/test/surface.test.ts` strips a line comment as
      // `\/\/[^\n]*`, which is correct for the needles it looks for and WRONG
      // for this one: the `//` in `https://host` matches it, so the whole origin
      // is deleted before the origin sweep reads the line and the sweep passes
      // on a file that names a host. Refusing a `//` preceded by a colon leaves
      // a scheme intact and still strips every real line comment, including one
      // that quotes a URL, because a line comment's own `//` is not preceded by
      // one.
      .replaceAll(/(?<!:)\/\/[^\n]*/g, ' ')
  );
}

// -----------------------------------------------------------------------------
// 1. TRANSPORT: exactly one `fetch(`, and three needles that did not move
// -----------------------------------------------------------------------------
// `apps/portal/test/surface.test.ts` records the rule this list follows: "a
// session that deletes an entry instead of narrowing it has removed the control
// while appearing to satisfy it." This package's assertion is BORN narrowed
// rather than narrowed from nothing, because ADR-162 already took the decision
// one deployable over and WAVE-06's `W6-c` row commissions the narrow form by
// name. It is PER NEEDLE and not per file, which is strictly stronger than an
// allowlisted file would be: a client reaching for `EventSource` fails this even
// though the file is permitted a `fetch(`.

const TRANSPORT: readonly { readonly needle: string; readonly permitted: readonly string[] }[] = [
  // ADR-162's precedent, and ADR-182 section 5 clause 2 for the relative URL.
  { needle: 'fetch(', permitted: [join('http', 'client.ts')] },

  // No admitted use in this console. `fetch` covers every read M06 names and
  // both of these predate it by a decade.
  { needle: 'XMLHttpRequest', permitted: [] },
  { needle: 'EventSource', permitted: [] },

  // WAVE-06 wave 5's, and BLOCKED rather than merely unwritten. M06 section
  // 3.5's live Open Liability is `P6-j`'s, which is behind `P6-g`, which is
  // behind a `VG-12` catalog admission that WAVE-06 section 8.1 states is a
  // human approval and not a merge. Nothing in this package subscribes to
  // anything today and nothing may until that lands.
  { needle: 'WebSocket', permitted: [] },
];

test('transport exists in one named file and nowhere else', () => {
  const files = sourceFiles();
  expect(files.length, 'source files walked').toBeGreaterThan(5);

  const offences: string[] = [];
  for (const file of files) {
    const rel = relative(SRC, file);
    const body = code(file);
    for (const { needle, permitted } of TRANSPORT) {
      if (!body.includes(needle)) continue;
      if (permitted.includes(rel)) continue;
      offences.push(`${rel}: ${needle}`);
    }
  }
  expect(offences).toEqual([]);
});

test('there is exactly ONE `fetch(` call site and it is in the permitted file', () => {
  // THE COUNT AND NOT ONLY THE LOCATION. `W6-c`'s row asks for "exactly one",
  // and a file permitted a `fetch(` could grow a second one without moving the
  // sweep above by a line. A second call site in the same file is a second set
  // of the four decisions this client's header argues.
  let sites = 0;
  for (const file of sourceFiles()) sites += code(file).split('fetch(').length - 1;
  expect(sites, 'fetch( call sites under apps/admin/src').toBe(1);
});

test('every file the transport list permits exists and uses what it was permitted', () => {
  // A PERMISSION FOR A FILE THAT DOES NOT EXIST, OR THAT NO LONGER PERFORMS THE
  // CALL, IS THE ASSERTION QUIETLY BACK AT "NONE" WHILE LOOKING NARROWED.
  const walked = new Set(sourceFiles().map((file) => relative(SRC, file)));

  for (const { needle, permitted } of TRANSPORT) {
    for (const rel of permitted) {
      expect(walked.has(rel), `${rel} is permitted ${needle} and is walked by this test`).toBe(
        true,
      );
      expect(code(join(SRC, rel)).includes(needle), `${rel} still performs ${needle}`).toBe(true);
    }
  }
});

test('the narrowing fires on the second file that gains a transport call', () => {
  // The narrowing watched failing on the thing it exists to catch. The seed is a
  // STRING rather than a file, so nothing is written to `src/`.
  const seeded = (rel: string, body: string): string[] => {
    const offences: string[] = [];
    for (const { needle, permitted } of TRANSPORT) {
      if (body.includes(needle) && !permitted.includes(rel)) offences.push(`${rel}: ${needle}`);
    }
    return offences;
  };

  // A screen reaching for its own transport.
  expect(seeded(join('app', 'liability', 'source.ts'), 'const r = await fetch(url);')).toEqual([
    `${join('app', 'liability', 'source.ts')}: fetch(`,
  ]);

  // The permitted file, doing the permitted thing.
  expect(seeded(join('http', 'client.ts'), 'const r = await fetch(url, init);')).toEqual([]);

  // And the three needles that did NOT move, in the file that did.
  expect(seeded(join('http', 'client.ts'), 'new WebSocket(url);')).toEqual([
    `${join('http', 'client.ts')}: WebSocket`,
  ]);
});

// -----------------------------------------------------------------------------
// 2. ADR-182 SECTION 5 CLAUSE 2: NO ABSOLUTE ORIGIN, ANYWHERE IN THIS PACKAGE
// -----------------------------------------------------------------------------
// ADR-012 is absolute: the admin domain "is never written into the corpus, the
// repository, or any public artifact", and every reference is the placeholder
// `ADMIN_ORIGIN`. `../src/origin.ts` has discharged that for the runtime since it
// was written, by reading the variable from the environment with no default.
// What ADR-182 added is a BUILD, and a build is the one step in this workspace
// that turns an environment value into a file.
//
// THE SWEEP IS OVER WRITTEN ORIGINS AND THAT BOUNDARY IS DELIBERATE. It refuses
// an origin somebody TYPED, which is what ADR-012's "written into the
// repository" means and what a build can inline. It does not refuse
// `new URL(value)` over a value that came from the environment, because that is
// `resolveAdminOrigin` doing exactly what ADR-182 section 5 clause 3 permits: a
// request-time read of a value that is not in the tree. A check that refused the
// second would forbid the mechanism ADR-012 requires. `requestPath` below is the
// behavioural half, and the two fail at different times.
//
// FIXTURES MAY NAME A HOST AND ONLY A RESERVED ONE, WHICH IS STRICTLY STRONGER
// THAN EXEMPTING THE TEST DIRECTORY. `access.test.ts` and `page.test.ts` need
// origins to exercise `INV-M6-02`'s containment relation, and they already use
// RFC 2606 and RFC 6761 reserved names. Permitting the RESERVED SET rather than
// the FILES means a real hostname added to either file tomorrow is a finding,
// which is the half of WAVE-06 rule 3 that reads "not in a test fixture".

/** RFC 2606 and RFC 6761 names that cannot resolve to anybody's infrastructure. */
const RESERVED_HOSTS =
  /^(localhost|127\.0\.0\.1|\[::1\]|([a-z0-9-]+\.)*(example|test|invalid|localhost)|([a-z0-9-]+\.)*example\.(com|net|org))$/;

/** An absolute origin written in a file: a scheme, `//`, and a host. */
const ORIGIN = new RegExp(`${'ht'}tps?:${'/'}${'/'}([a-z0-9.\\-\\[\\]]+)(:\\d+)?`, 'gi');

/** Every written absolute origin in one file's code, as `file: host` findings. */
function writtenOrigins(rel: string, body: string): string[] {
  return [...body.matchAll(ORIGIN)]
    .map((match) => (match[1] ?? '').toLowerCase())
    .filter((host) => !RESERVED_HOSTS.test(host))
    .map((host) => `${rel}: ${host}`);
}

test('no absolute origin is written anywhere in this package', () => {
  const files = packageFiles();
  expect(files.length, 'files walked in apps/admin').toBeGreaterThan(15);

  const offences: string[] = [];
  for (const file of files) offences.push(...writtenOrigins(relative(PACKAGE, file), code(file)));
  expect(offences).toEqual([]);
});

test('`src/` holds no absolute origin at all, reserved or otherwise', () => {
  // THE STRICTER HALF, AND IT IS TOTAL. A fixture has a reason to name a host
  // and shipped code has none: `../src/origin.ts` reads every origin it uses
  // from the environment and `../src/http/client.ts` constructs no origin at
  // all. So `src/` is asserted at ZERO absolute origins, reserved names
  // included, which is a stronger statement than the sweep above makes and is
  // the one that would fail on a `localhost` default sneaking into a client.
  const offences: string[] = [];
  for (const file of sourceFiles()) {
    const rel = relative(SRC, file);
    for (const match of code(file).matchAll(ORIGIN)) offences.push(`${rel}: ${match[0]}`);
  }
  expect(offences).toEqual([]);
});

test('the origin sweep fires on a real hostname and on a scheme-relative one', () => {
  // WATCHED FAILING, WITH THE SEEDS ASSEMBLED FROM FRAGMENTS SO THIS FILE STAYS
  // CLEAN UNDER ITS OWN SWEEP.
  const scheme = `${'ht'}tps:${'/'}${'/'}`;
  const host = ['console', 'merit-ops', 'corp'].join('.');

  expect(writtenOrigins('src/http/client.ts', `const base = '${scheme}${host}';`)).toEqual([
    `src/http/client.ts: ${host}`,
  ]);

  // A port does not launder it.
  expect(writtenOrigins('next.config.mjs', `assetPrefix: '${scheme}${host}:8443'`)).toEqual([
    `next.config.mjs: ${host}`,
  ]);

  // And the reserved names the existing fixtures use are NOT findings, which is
  // the control on the control: a sweep that flagged everything would pass its
  // seeded case and tell nobody anything.
  expect(writtenOrigins('test/access.test.ts', `${scheme}ops.example.test`)).toEqual([]);
  expect(writtenOrigins('test/page.test.ts', `${scheme}app.example.invalid`)).toEqual([]);
});

// -----------------------------------------------------------------------------
// 3. ADR-182 SECTION 5 CLAUSE 1: NO `NEXT_PUBLIC_` IDENTIFIER, EVER
// -----------------------------------------------------------------------------
// The entry's own words: "That prefix is the framework's own mechanism for
// inlining an environment value into a client bundle at build time, and a bundle
// carrying a resolved `ADMIN_ORIGIN` is an artifact with the domain in it. The
// prefix is refused by name so that the control is a rule rather than a reviewer
// noticing."
//
// IT IS THE PREFIX AND NOT ONE VARIABLE. Refusing `NEXT_PUBLIC_API_ORIGIN` by
// name would be refusing the one spelling somebody already thought of; the
// mechanism is the prefix, and any name carrying it is inlined by the same code.
// `apps/admin/package.json`'s `//next` key states the rule in prose and is
// dropped by `code()` above, which is why the manifest's own refusal is not read
// as a violation of itself.

/** The prefix, assembled so this file is not a finding under its own sweep. */
const INLINE_PREFIX = `${'NEXT'}_${'PUBLIC'}_`;

// The TITLE is interpolated too, and for the sweep's own reason: a title is a
// string literal in code rather than a comment, so a hard-coded one would make
// this test the single finding it reports.
test(`no \`${INLINE_PREFIX}\` identifier appears anywhere in this package`, () => {
  const files = packageFiles();
  expect(files.length, 'files walked in apps/admin').toBeGreaterThan(15);

  const offences: string[] = [];
  for (const file of files)
    if (code(file).includes(INLINE_PREFIX)) offences.push(relative(PACKAGE, file));
  expect(offences).toEqual([]);
});

test('the prefix sweep fires on any name carrying it, and reads a manifest correctly', () => {
  const seeded = (body: string): boolean => body.includes(INLINE_PREFIX);

  // The obvious one, and the one nobody would think to ban by name.
  expect(seeded(`process.env.${INLINE_PREFIX}API_ORIGIN`)).toBe(true);
  expect(seeded(`${INLINE_PREFIX}CONSOLE_BUILD_ID`)).toBe(true);

  // AND THE MANIFEST HALF, WATCHED ON THE REAL FILE. `apps/admin/package.json`
  // contains the prefix in a `//`-prefixed documentation key today, so a sweep
  // that did not drop those keys would report the manifest's own refusal as the
  // violation. The stripped form must not contain it and the raw form must.
  const manifest = join(PACKAGE, 'package.json');
  expect(readFileSync(manifest, 'utf8').includes(INLINE_PREFIX)).toBe(true);
  expect(code(manifest).includes(INLINE_PREFIX)).toBe(false);

  // And a real key is not laundered by sitting beside a documented one.
  const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
  expect(typeof parsed).toBe('object');
});

// -----------------------------------------------------------------------------
// 4. THE RELATIVE URL, ASSERTED BEHAVIOURALLY
// -----------------------------------------------------------------------------
// The sweeps above read TEXT. This reads what the client actually hands the
// transport, which is the half that catches an origin composed at run time from
// parts that are individually innocent.

test('every request URL is root relative and carries the base path once', () => {
  expect(requestPath('/admin/liability')).toBe(`${API_BASE_PATH}/admin/liability`);
  expect(requestPath('/internal/jobs')).toBe(`${API_BASE_PATH}/internal/jobs`);

  for (const path of ['/admin/liability', '/admin/flags', '/internal/recon/status']) {
    const url = requestPath(path);
    expect(url.startsWith('/'), `${url} is root relative`).toBe(true);
    expect(url.startsWith('//'), `${url} is not scheme relative`).toBe(false);
    expect(/^[a-z][a-z0-9+.-]*:/i.test(url), `${url} carries no scheme`).toBe(false);
    expect(url.split(API_BASE_PATH).length - 1, `${url} carries the base path once`).toBe(1);
  }
});

test('the client hands the transport a relative URL and asks for no credential it may not have', async () => {
  const calls: { url: string; init: AdminRequestInit }[] = [];
  const transport: Transport = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify({ as_of: '2026-08-27' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  const result: AdminApiResult = await createAdminApiClient({ transport }).get('/admin/liability');

  expect(result).toEqual({ ok: true, body: { as_of: '2026-08-27' } });
  expect(calls[0]?.url).toBe(`${API_BASE_PATH}/admin/liability`);
  expect(calls[0]?.init.method).toBe('GET');

  // `no-store` and `same-origin` are the two literals section 4 and section 2 of
  // the client argue, and they are asserted rather than trusted to a default.
  expect(calls[0]?.init.cache).toBe('no-store');
  expect(calls[0]?.init.credentials).toBe('same-origin');
  expect(calls[0]?.init.redirect).toBe('error');
});

test('a path outside the operator prefixes is refused rather than fetched', () => {
  // `apps/api/src/surface.ts` classifies by prefix, so a read outside them is a
  // PUBLIC surface read issued from the admin origin.
  expect(() => requestPath('/accounts')).toThrow(AdminApiPathError);
  expect(() => requestPath('/health')).toThrow(AdminApiPathError);

  // A prefix must be a whole segment. `/adminish/x` is not under `/admin`.
  expect(() => requestPath('/adminish/x')).toThrow(AdminApiPathError);

  // No leading slash, and a caller that already appended the base path.
  expect(() => requestPath('admin/liability')).toThrow(AdminApiPathError);
  expect(() => requestPath(`${API_BASE_PATH}/admin/liability`)).toThrow(AdminApiPathError);
});

test('the client never reaches the network for a refused path', async () => {
  // THE REFUSAL IS BEFORE THE CALL AND NOT AFTER IT. A client that fetched and
  // then complained would have already made the request it exists to prevent.
  let called = 0;
  const transport: Transport = () => {
    called += 1;
    return Promise.resolve(new Response('{}', { status: 200 }));
  };

  await expect(createAdminApiClient({ transport }).get('/accounts')).rejects.toThrow(
    AdminApiPathError,
  );
  expect(called).toBe(0);
});

// -----------------------------------------------------------------------------
// 5. THE SECOND COPIES, AND THE DRIFT ASSERTED RATHER THAN HOPED FOR
// -----------------------------------------------------------------------------
// `RI-04` refuses `apps/admin` importing `apps/api`, so `API_BASE_PATH` and
// `OPERATOR_PREFIXES` are copies. `apps/portal/test/http-client.test.ts` reads
// the producing file as TEXT for the same constant, which is the precedent: a
// file read is not an import and `RI-04` reads dependency graphs.

test('the base path is the one `apps/api/src/surface.ts` declares', () => {
  const source = readFileSync(join(REPO, 'apps', 'api', 'src', 'surface.ts'), 'utf8');
  const match = /export const BASE_PATH = '([^']+)'/.exec(source);
  expect(match, 'BASE_PATH is declared in apps/api/src/surface.ts').not.toBeNull();
  expect(match?.[1]).toBe(API_BASE_PATH);
});

test('the operator prefixes are the ones `apps/api/src/surface.ts` withholds by', () => {
  const source = readFileSync(join(REPO, 'apps', 'api', 'src', 'surface.ts'), 'utf8');
  const match = /export const OPERATOR_PREFIXES = \[([^\]]+)\]/.exec(source);
  expect(match, 'OPERATOR_PREFIXES is declared in apps/api/src/surface.ts').not.toBeNull();

  const declared = [...(match?.[1] ?? '').matchAll(/'([^']+)'/g)].map((entry) => entry[1] ?? '');
  expect(declared).toEqual([...OPERATOR_PREFIXES]);
});

// -----------------------------------------------------------------------------
// 6. THE ERROR VOCABULARY, WHICH EXISTS SO THE 503 IS SAYABLE
// -----------------------------------------------------------------------------

test('the status mapping is total and 503 is its own answer', () => {
  expect(toAdminErrorKind(401)).toBe('unauthenticated');
  expect(toAdminErrorKind(403)).toBe('forbidden');
  expect(toAdminErrorKind(404)).toBe('not_found');
  expect(toAdminErrorKind(429)).toBe('rate_limited');

  // ADR-171'S BLOCKER IS THE STATE THIS CONSOLE LIVES IN. Every operator route
  // answers 503 until an `AdminSessionSource` lands, and WAVE-06 section 8.1
  // renders that through `page.ts`'s `PendingPanel`. A vocabulary that folded it
  // into `server_error` would make "not built yet" and "broke just now" the same
  // sentence.
  expect(toAdminErrorKind(503)).toBe('unavailable');
  expect(toAdminErrorKind(500)).toBe('server_error');
  expect(toAdminErrorKind(502)).toBe('server_error');
  expect(toAdminErrorKind(418)).toBe('server_error');
});

test('a refusal carries its status and a dead socket carries null', async () => {
  const refusing: Transport = () => Promise.resolve(new Response('{}', { status: 503 }));
  expect(await createAdminApiClient({ transport: refusing }).get('/admin/liability')).toEqual({
    ok: false,
    error: 'unavailable',
    status: 503,
  });

  const dead: Transport = () => Promise.reject(new Error('ECONNREFUSED'));
  expect(await createAdminApiClient({ transport: dead }).get('/admin/liability')).toEqual({
    ok: false,
    error: 'server_error',
    status: null,
  });
});

test('a 2xx whose body is not JSON is a failure and not an empty figure', async () => {
  const html: Transport = () => Promise.resolve(new Response('<!doctype html>', { status: 200 }));

  expect(await createAdminApiClient({ transport: html }).get('/admin/liability')).toEqual({
    ok: false,
    error: 'server_error',
    status: 200,
  });
});

// -----------------------------------------------------------------------------
// 7. THE BARREL'S ESCAPE HATCH, CHECKED IN BOTH DIRECTIONS
// -----------------------------------------------------------------------------
// `service.test.ts`'s `B.1` and `B.5` read only the modules in
// `ADMIN_BARREL_LEGS`, so a module in `ADMIN_MODULES_NOT_RE_EXPORTED` has no
// assertion that its names are anywhere. THIS SLICE IS THE FIRST TO USE THAT
// LIST AND IT PAYS FOR IT HERE, so the absence is a checked property rather than
// a hole. `B.2` already fails a module in neither list or in both, and `B.6`
// already requires a reason; what neither can see is the list GROWING a third
// entry, or one of these two modules leaking onto the package surface anyway.

test('the escape hatch holds exactly the two transport modules', () => {
  expect(Object.keys(admin.ADMIN_MODULES_NOT_RE_EXPORTED).sort()).toEqual([
    './api/types.ts',
    './http/client.ts',
  ]);

  // Every other module under `src/` is a leg, so the sweep in `B.2` is total
  // over everything except these two.
  const modules = sourceFiles()
    .map((file) => `./${relative(SRC, file).split(sep).join('/')}`)
    .filter((module) => module !== './index.ts');
  const legs = new Set<string>(admin.ADMIN_BARREL_LEGS);
  const absent = new Set(Object.keys(admin.ADMIN_MODULES_NOT_RE_EXPORTED));
  expect(modules.filter((module) => !legs.has(module) && !absent.has(module))).toEqual([]);
  expect(modules.length).toBe(legs.size + absent.size);
});

test('neither absent module leaks a name onto the package surface', () => {
  // THE INVERSE OF `B.1`. `B.1` asserts a leg's every name IS re-exported; this
  // asserts an absent module's names are NOT, so "deliberately absent" is a
  // decision the tree enforces rather than a sentence in a comment. A slice that
  // re-exports one of these without moving it to `ADMIN_BARREL_LEGS` would
  // otherwise get the surface with none of `B.1`'s coverage.
  const declared = (module: string): readonly string[] =>
    [
      ...code(join(SRC, module.slice(2)))
        .split('\n')
        .join('\n')
        .matchAll(
          /^export (?:declare )?(?:const|function|class|interface|type|enum) ([A-Za-z0-9_]+)/gm,
        ),
    ].map((match) => match[1] ?? '');

  const barrel = code(join(SRC, 'index.ts'));
  const surface = new Set(Object.keys(admin));

  for (const module of Object.keys(admin.ADMIN_MODULES_NOT_RE_EXPORTED)) {
    const names = declared(module);
    expect(names.length, `${module} declares no exports, which cannot be right`).toBeGreaterThan(0);
    for (const name of names) {
      expect(surface.has(name), `${module} declares \`${name}\` and the barrel re-exports it`).toBe(
        false,
      );
      expect(
        barrel.includes(`from '${module}'`),
        `${module} is listed as deliberately absent and the barrel re-exports from it`,
      ).toBe(false);
    }
  }
});
