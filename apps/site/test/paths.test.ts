import { expect, test } from 'vitest';

import type { Cents } from '@merit/rules-engine';

import {
  SITE_SURFACES,
  contentLivePath,
  contentVersionPath,
  planVersionPath,
  planVersionRulesPath,
  planVersionSizePath,
  versionPageMeta,
} from '../src/routes/paths.ts';
import { label, sizeRow, sizeView, versionView } from './fixtures.ts';

// CI-02, the `unit` project. M9-V-nn: content versioning and permanent URLs.

// -----------------------------------------------------------------------------
// The address is a column, never a formula
// -----------------------------------------------------------------------------

test('SD-M9-01: a version address reads public_slug and nothing else', () => {
  const v1 = versionView({ version: 1, public_slug: 'merit-rapid-v1' });
  expect(planVersionPath(v1)).toBe('/plans/merit-rapid-v1');
});

// The defect this guards: an address built from `version` moves when numbering
// does, and `0004_catalog.sql` puts the reason on the column.
test('renumbering a version does not move its address', () => {
  const before = versionView({ version: 4, public_slug: 'merit-rapid-2026-08' });
  const renumbered = versionView({ version: 9, public_slug: 'merit-rapid-2026-08' });

  expect(planVersionPath(renumbered)).toBe(planVersionPath(before));
});

// OQ-M9-05 leaves `plans.name` mutable, which is exactly why no address may be
// built out of it.
test('renaming the plan does not move any address', () => {
  const before = versionView({ plan_name: 'Merit Rapid', plan_code: 'merit_rapid' });
  const renamed = versionView({ plan_name: 'Merit Express', plan_code: 'merit_rapid' });

  expect(planVersionPath(renamed)).toBe(planVersionPath(before));
  expect(planVersionRulesPath(renamed)).toBe(planVersionRulesPath(before));
});

test('the rules page is a child of the version address, so permanence is inherited', () => {
  const view = versionView();
  expect(planVersionRulesPath(view).startsWith(planVersionPath(view))).toBe(true);
});

test('M9 section 2.1: the size segment is size_cents and the label never addresses a page', () => {
  const view = versionView();
  const unlabelled = sizeView();
  const labelled = sizeView({ marketed_size_label: label('Starter') });

  expect(planVersionSizePath(view, labelled)).toBe(planVersionSizePath(view, unlabelled));
  expect(planVersionSizePath(view, unlabelled)).toContain(String(unlabelled.row.size_cents));

  const bigger = sizeView({ row: sizeRow({ size_cents: 5_000_000n as Cents }) });
  expect(planVersionSizePath(view, bigger)).not.toBe(planVersionSizePath(view, unlabelled));
});

// -----------------------------------------------------------------------------
// GS-148: the superseded version's page
// -----------------------------------------------------------------------------

test('GS-148: a superseded version resolves, names its successor, and leaves index and nav', () => {
  const v1 = versionView({
    version: 1,
    public_slug: 'merit-rapid-v1',
    superseded_by: { version: 2, public_slug: 'merit-rapid-v2' },
  });

  const meta = versionPageMeta(v1);

  expect(meta.path).toBe('/plans/merit-rapid-v1');
  expect(meta.superseded).toBe(true);
  expect(meta.successor_path).toBe('/plans/merit-rapid-v2');
  expect(meta.canonical_path).toBe('/plans/merit-rapid-v2');
  expect(meta.indexable).toBe(false);
  expect(meta.navigable).toBe(false);
});

// "Reachable by link and unreachable by browsing" is TWO booleans, not one. A
// page out of navigation but still indexed is a landing page a stranger arrives
// on from search, which is the accident INV-M9-11 forbids.
test('GS-148: exclusion is from indexing AND from navigation, never one of the two', () => {
  const superseded = versionPageMeta(
    versionView({ superseded_by: { version: 2, public_slug: 'merit-rapid-v2' } }),
  );

  expect(superseded.indexable).toBe(false);
  expect(superseded.navigable).toBe(false);
  // And the page still has an address, because removing it is FM-M9-07.
  expect(superseded.path).not.toBe('');
  expect(superseded.rules_path).not.toBe('');
});

test('the current version is the default, is indexable, and is its own canonical', () => {
  const meta = versionPageMeta(versionView({ public_visible: true, superseded_by: null }));

  expect(meta.superseded).toBe(false);
  expect(meta.successor_path).toBeNull();
  expect(meta.canonical_path).toBe(meta.path);
  expect(meta.indexable).toBe(true);
  expect(meta.navigable).toBe(true);
});

// A different cause with the same result: published-for-engine and not yet on
// sale. The page must exist, because a pinned account may already be enforced
// under it, and it must not be advertised.
test('a published but not-yet-visible version has a page and is not advertised', () => {
  const meta = versionPageMeta(versionView({ public_visible: false, superseded_by: null }));

  expect(meta.superseded).toBe(false);
  expect(meta.path).toBe('/plans/merit-rapid-v1');
  expect(meta.indexable).toBe(false);
  expect(meta.navigable).toBe(false);
});

// -----------------------------------------------------------------------------
// Content addresses
// -----------------------------------------------------------------------------

test('a legal citation addresses a version, because acceptance is recorded against one', () => {
  expect(contentVersionPath('legal', 'terms-of-service', 3)).toBe('/legal/terms-of-service/v3');
  expect(contentVersionPath('legal', 'terms-of-service', 4)).not.toBe(
    contentVersionPath('legal', 'terms-of-service', 3),
  );
});

test('the live address and the versioned address are different addresses', () => {
  expect(contentLivePath('legal', 'terms-of-service')).not.toBe(
    contentVersionPath('legal', 'terms-of-service', 3),
  );
});

// -----------------------------------------------------------------------------
// The surface inventory
// -----------------------------------------------------------------------------

test('the surfaces M09 numbers carry their PG-M9 identifier and the others carry none', () => {
  const byPath = new Map(SITE_SURFACES.map((s) => [s.path, s]));

  expect(byPath.get('/plans')?.id).toBe('PG-M9-02');
  expect(byPath.get('/stats')?.id).toBe('PG-M9-05');

  // Numbering the rest here would be allocating in a shared registry with no
  // allocation table, which is WAVE-03's duplicate-key class.
  expect(byPath.get('/faq')?.id).toBeNull();
  expect(byPath.get('/blog')?.id).toBeNull();
});

// OQ-M9-04, answered in the direction its own recommendation gives: a
// transparency page that appears once the numbers look good is not one.
test('the stats page is in the primary navigation on launch day', () => {
  const stats = SITE_SURFACES.find((s) => s.path === '/stats');
  expect(stats?.navigable).toBe(true);
  expect(stats?.indexable).toBe(true);
});

// AS-M9-04: the position is a stated policy rather than an error message.
test('the restricted-jurisdiction list is a published page', () => {
  expect(SITE_SURFACES.some((s) => s.path === '/restricted-jurisdictions')).toBe(true);
});

test('every surface has a distinct path', () => {
  const paths = SITE_SURFACES.map((s) => s.path);
  expect(new Set(paths).size).toBe(paths.length);
});
