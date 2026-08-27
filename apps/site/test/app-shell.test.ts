// =============================================================================
// apps/site/test/app-shell.test.ts
// =============================================================================
// THE SHELL, WHICH IS THE PART OF THIS APP THAT DECIDES WHETHER A PAGE MAY
// RENDER AT ALL.
//
// The page models are already covered by `plans-page`, `rules-page`,
// `stats-page` and `legal-page`. What arrives with the App Router is the layer
// UNDER them: where the API address comes from, where the build stamp comes
// from, what happens when neither is configured, and whether a surface that
// `routes/paths.ts` publishes actually has a file to serve it.
// =============================================================================

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import type { SiteEnv } from '../src/app/build.ts';
import {
  API_BASE_URL_VAR,
  BUILT_AT_VAR,
  DISCLOSURE_ADDRESS,
  siteBuild,
  siteBuiltAt,
  siteDisclosure,
} from '../src/app/build.ts';
import { envelopeMetadata } from '../src/app/chrome.tsx';
import { page } from '../src/routes/page.ts';
import { SITE_SURFACES } from '../src/routes/paths.ts';
import { BUILT_AT } from './fixtures.ts';

/** A configured environment, so each test states only what it changes. */
const wired = (overrides: Record<string, string | undefined> = {}): SiteEnv => ({
  [API_BASE_URL_VAR]: 'https://api.example/api/v1',
  [BUILT_AT_VAR]: '2026-08-21T00:00:00.000Z',
  ...overrides,
});

describe('the build stamp is supplied and never read from a clock', () => {
  test('an ISO-8601 UTC instant is accepted', () => {
    expect(siteBuiltAt(wired())).toBe('2026-08-21T00:00:00.000Z');
  });

  test('a missing or blank stamp is null rather than now', () => {
    expect(siteBuiltAt({})).toBeNull();
    expect(siteBuiltAt(wired({ [BUILT_AT_VAR]: '   ' }))).toBeNull();
  });

  test('a value that is not an instant is refused rather than rendered at a reader', () => {
    for (const raw of ['yesterday', '2026-08-21', '2026-08-21T00:00:00+02:00', 'null']) {
      expect(siteBuiltAt(wired({ [BUILT_AT_VAR]: raw })), raw).toBeNull();
    }
  });
});

describe('an unconfigured build is a state and not a crash', () => {
  test('no API address gives a reason naming the variable', () => {
    const build = siteBuild(wired({ [API_BASE_URL_VAR]: undefined }));
    expect(build.kind).toBe('unconfigured');
    if (build.kind !== 'unconfigured') throw new Error('unreachable');
    expect(build.reason).toContain(API_BASE_URL_VAR);
  });

  test('no build stamp gives a reason naming INV-M9-03', () => {
    const build = siteBuild(wired({ [BUILT_AT_VAR]: undefined }));
    expect(build.kind).toBe('unconfigured');
    if (build.kind !== 'unconfigured') throw new Error('unreachable');
    expect(build.reason).toContain('INV-M9-03');
  });

  test('an address the adapter refuses is caught rather than thrown at the build', () => {
    const build = siteBuild(wired({ [API_BASE_URL_VAR]: 'api.example/api/v1' }));
    expect(build.kind).toBe('unconfigured');
  });

  test('a trailing slash is refused, because two configs would build two digests', () => {
    expect(siteBuild(wired({ [API_BASE_URL_VAR]: 'https://api.example/api/v1/' })).kind).toBe(
      'unconfigured',
    );
  });

  test('both variables present resolve the four ports', () => {
    const build = siteBuild(wired());
    expect(build.kind).toBe('wired');
    if (build.kind !== 'wired') throw new Error('unreachable');
    expect(Object.keys(build.ports).sort()).toEqual(['catalog', 'content', 'geo', 'stats']);
  });
});

describe('the disclosure is read and never minted', () => {
  test('an unconfigured build has no disclosure rather than a stand-in one', async () => {
    await expect(
      siteDisclosure(siteBuild(wired({ [API_BASE_URL_VAR]: undefined }))),
    ).resolves.toBeNull();
  });

  test('the address is the one the adapter suite asserts against', () => {
    // `test/adapter.test.ts` builds "the disclosure INV-M9-05 requires" from
    // this kind, slug and locale. Two spellings would be the drift that suite
    // exists to catch, found on a page a year later instead.
    expect(DISCLOSURE_ADDRESS).toEqual({
      kind: 'legal',
      slug: 'simulated-environment',
      locale: 'en',
    });
  });
});

describe("the envelope's indexability is what reaches a crawler", () => {
  const envelope = (indexable: boolean) =>
    page({
      path: '/plans',
      title: 'Plans and pricing',
      indexable,
      built_at: BUILT_AT,
      disclosure: {
        form: 'short',
        body: 'Simulated environment.',
        document_version: 3,
        document_slug: 'simulated-environment',
      },
    });

  test('an indexable page is indexed and followed', () => {
    expect(envelopeMetadata(envelope(true)).robots).toEqual({ index: true, follow: true });
  });

  test('GS-148: a page the envelope excludes is excluded in both directions', () => {
    expect(envelopeMetadata(envelope(false)).robots).toEqual({ index: false, follow: false });
  });

  test("the canonical address is the envelope's and not the path argument", () => {
    expect(envelopeMetadata(envelope(true)).alternates.canonical).toBe('/plans');
  });
});

describe('every published surface has a file that serves it', () => {
  const appDir = join(fileURLToPath(new URL('../src/app/', import.meta.url)));

  // `SITE_SURFACES` is the inventory `routes/paths.ts` publishes and the root
  // layout builds its navigation from. A surface listed there with no `page`
  // file is a link in Merit's own navigation that answers 404, which is
  // FM-M9-07's shape applied to the static surfaces.
  test.each(SITE_SURFACES.map((surface) => [surface.path, surface.title] as const))(
    '%s (%s) resolves to a page module',
    (path) => {
      const segment = path === '/' ? '' : path.slice(1);
      expect(existsSync(join(appDir, segment, 'page.tsx')), `${path} has no page.tsx`).toBe(true);
    },
  );

  test('the three per-version surfaces derivedPaths names each have one too', () => {
    for (const rel of [
      '[slug]/page.tsx',
      '[slug]/rules/page.tsx',
      '[slug]/rules/[size]/page.tsx',
    ]) {
      expect(existsSync(join(appDir, 'plans', rel)), rel).toBe(true);
    }
  });
});
