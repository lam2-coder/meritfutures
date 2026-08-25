import { expect, test } from 'vitest';

import { derivedPaths } from '../src/routes/paths.ts';
import { geoNotice } from '../src/routes/geo.ts';
import { sizeRow, sizeView, versionView } from './fixtures.ts';

import type { Cents } from '@merit/rules-engine';

// CI-02, the `unit` project. AS-M9-04 and INV-M9-04's path derivation.

// -----------------------------------------------------------------------------
// GS-145: the restricted-country visitor
// -----------------------------------------------------------------------------

test('GS-145: a restricted country gets the notice and the call to action is suppressed', () => {
  const notice = geoNotice('CU', ['CU', 'IR', 'KP']);

  expect(notice.disposition).toBe('restricted');
  expect(notice.show_call_to_action).toBe(false);
  expect(notice.notice).toContain('CU');
  expect(notice.notice).toContain('does not accept traders');
});

// AS-M9-04: "You are welcome to read the plans and the rules". The pages stay
// readable, because the notice is disclosure and the ban is on selling.
test('GS-145: the notice suppresses the call to action and not the content', () => {
  const notice = geoNotice('IR', ['CU', 'IR']);

  expect(notice.show_call_to_action).toBe(false);
  expect(notice.restricted_list_path).toBe('/restricted-jurisdictions');
});

test('an unrestricted country sees the normal page', () => {
  const notice = geoNotice('US', ['CU', 'IR']);

  expect(notice.disposition).toBe('unrestricted');
  expect(notice.notice).toBeNull();
  expect(notice.show_call_to_action).toBe(true);
});

// FM-M9-04: fail open on the notice and closed at checkout. A site that hard
// blocked on a failed lookup would convert a courtesy into an outage for every
// visitor on earth.
test('FM-M9-04: an unavailable lookup fails open', () => {
  const notice = geoNotice(null, ['CU', 'IR']);

  expect(notice.disposition).toBe('unknown');
  expect(notice.show_call_to_action).toBe(true);
  expect(notice.notice).toBeNull();
});

// DEP-M9-04: the same table checkout and campaign targeting read. A country
// code typed into the module would be that drift created deliberately.
test('the restricted list is an argument, so an empty one restricts nobody', () => {
  expect(geoNotice('CU', []).disposition).toBe('unrestricted');
});

test('matching is case insensitive on an ISO code and does nothing cleverer', () => {
  expect(geoNotice('cu', ['CU']).disposition).toBe('restricted');
  expect(geoNotice(' CU ', ['cu']).disposition).toBe('restricted');
  // No partial match: a site that restricted "CUW" because "CU" is listed would
  // differ from checkout while both read the same table.
  expect(geoNotice('CUW', ['CU']).disposition).toBe('unrestricted');
});

// -----------------------------------------------------------------------------
// INV-M9-04: every page derived from the version
// -----------------------------------------------------------------------------

test('a publish invalidates the version page, the rules page, and every size page', () => {
  const small = sizeView({ row: sizeRow({ size_cents: 2_500_000n as Cents }) });
  const large = sizeView({ row: sizeRow({ size_cents: 5_000_000n as Cents }) });
  const version = versionView({ sizes: [small, large] });

  expect(derivedPaths(version)).toEqual([
    '/plans',
    '/plans/merit-rapid-v1',
    '/plans/merit-rapid-v1/rules',
    '/plans/merit-rapid-v1/rules/2500000',
    '/plans/merit-rapid-v1/rules/5000000',
  ]);
});

// A publish that revalidated only the version's own pages would leave the
// pricing page quoting the previous one, which is FM-M9-01 exactly.
test('the index is a derived path, because it is the page the version appears on', () => {
  expect(derivedPaths(versionView())).toContain('/plans');
});

// The paths come from the same functions that address the pages, so a surface
// cannot be added without passing through one of them.
test('adding a size adds a path, with no list to remember to update', () => {
  const one = derivedPaths(versionView({ sizes: [sizeView()] }));
  const two = derivedPaths(
    versionView({
      sizes: [sizeView(), sizeView({ row: sizeRow({ size_cents: 5_000_000n as Cents }) })],
    }),
  );

  expect(two).toHaveLength(one.length + 1);
});

// `page_revalidations_has_paths` requires at least one.
test('a version with no sizes still derives paths', () => {
  expect(derivedPaths(versionView({ sizes: [] })).length).toBeGreaterThan(0);
});
