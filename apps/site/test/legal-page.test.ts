import { expect, test } from 'vitest';

import type { ContentDocument } from '../src/content/documents.js';
import { isLive } from '../src/content/documents.js';
import { DisclosureError } from '../src/render/disclosure.js';
import { contentPage, legalIndex } from '../src/routes/legal.js';
import { BUILT_AT } from './fixtures.js';

// CI-02, the `unit` project. M9-V-nn: content versioning and permanent URLs.

const disclosure = {
  form: 'short' as const,
  body: 'Counsel drafts this.',
  document_version: 3,
  document_slug: 'terms-of-service',
};

const doc = (overrides: Partial<ContentDocument> = {}): ContentDocument => ({
  id: '00000000-0000-4000-8000-0000000000f1',
  kind: 'legal',
  slug: 'terms-of-service',
  locale: 'en',
  title: 'Terms of Service',
  body_mdx: 'Counsel drafts this.',
  version: 3,
  published_at: '2026-08-14T00:00:00.000Z',
  superseded_by: null,
  author: 'counsel',
  checksum: 'a1b2c3d4',
  ...overrides,
});

// -----------------------------------------------------------------------------
// Two addresses, and they mean different things
// -----------------------------------------------------------------------------

test('a document has a permanent citation address and a live address', () => {
  const rendered = contentPage({ document: doc(), disclosure, built_at: BUILT_AT });

  expect(rendered.version_path).toBe('/legal/terms-of-service/v3');
  expect(rendered.live_path).toBe('/legal/terms-of-service');
  expect(rendered.envelope.path).toBe(rendered.version_path);
});

// FM-M9-06: `tos_versions` is pinned into the checkout session at open, and what
// this surface owes that mechanism is that the pinned version still resolves to
// the words it had.
test('a superseded version still resolves, at the same address it always had', () => {
  const v3 = contentPage({
    document: doc({ version: 3, superseded_by: '00000000-0000-4000-8000-0000000000f2' }),
    disclosure,
    built_at: BUILT_AT,
  });

  expect(v3.version_path).toBe('/legal/terms-of-service/v3');
  expect(v3.body_mdx).toBe('Counsel drafts this.');
  expect(v3.supersession_notice).not.toBeNull();
  expect(v3.envelope.indexable).toBe(false);
});

test('publishing a new version does not move the old address', () => {
  const before = contentPage({ document: doc({ version: 3 }), disclosure, built_at: BUILT_AT });
  const after = contentPage({
    document: doc({ version: 3, superseded_by: 'newer' }),
    disclosure,
    built_at: BUILT_AT,
  });

  expect(after.version_path).toBe(before.version_path);
});

test('a version address addresses one version and no other', () => {
  const v3 = contentPage({ document: doc({ version: 3 }), disclosure, built_at: BUILT_AT });
  const v4 = contentPage({ document: doc({ version: 4 }), disclosure, built_at: BUILT_AT });

  expect(v3.version_path).not.toBe(v4.version_path);
});

// -----------------------------------------------------------------------------
// SD-M9-02's checksum
// -----------------------------------------------------------------------------

test('the checksum reaches the page, because a document that cannot be checked can only be asserted', () => {
  const rendered = contentPage({
    document: doc({ checksum: 'deadbeef' }),
    disclosure,
    built_at: BUILT_AT,
  });
  expect(rendered.checksum).toBe('deadbeef');
});

// -----------------------------------------------------------------------------
// isLive is the index's predicate, restated once
// -----------------------------------------------------------------------------

test("live means published and unsuperseded, which is the unique index's own predicate", () => {
  expect(isLive(doc())).toBe(true);
  expect(isLive(doc({ published_at: null }))).toBe(false);
  expect(isLive(doc({ superseded_by: 'newer' }))).toBe(false);
});

test('a draft is not indexable, for a different reason with the same result', () => {
  const draft = contentPage({
    document: doc({ published_at: null }),
    disclosure,
    built_at: BUILT_AT,
  });
  expect(draft.envelope.indexable).toBe(false);
  expect(draft.supersession_notice).toBeNull();
});

// -----------------------------------------------------------------------------
// The legal index
// -----------------------------------------------------------------------------

test('the index lists one entry per live legal document', () => {
  const index = legalIndex(
    [
      doc({ slug: 'terms-of-service', title: 'Terms of Service' }),
      doc({ slug: 'privacy-policy', title: 'Privacy Policy', id: 'p1' }),
      doc({ slug: 'risk-disclosure', title: 'Risk Disclosure', id: 'r1' }),
    ],
    disclosure,
    BUILT_AT,
  );

  expect(index.documents.map((d) => d.slug)).toEqual([
    'privacy-policy',
    'risk-disclosure',
    'terms-of-service',
  ]);
});

// Reachable by link, unreachable by browsing. A legal index listing every
// version of every document makes the current terms harder to find.
test('a superseded version is not listed and is not gone', () => {
  const superseded = doc({ version: 2, superseded_by: 'v3', id: 'old' });
  const current = doc({ version: 3 });

  const index = legalIndex([superseded, current], disclosure, BUILT_AT);

  expect(index.documents).toHaveLength(1);
  expect(index.documents[0]!.version).toBe(3);

  const stillThere = contentPage({ document: superseded, disclosure, built_at: BUILT_AT });
  expect(stillThere.version_path).toBe('/legal/terms-of-service/v2');
});

test('a blog post is not a legal document, even though it shares a table', () => {
  const index = legalIndex(
    [doc({ kind: 'post', slug: 'launch', title: 'We are live', id: 'b1' }), doc()],
    disclosure,
    BUILT_AT,
  );

  expect(index.documents.map((d) => d.slug)).toEqual(['terms-of-service']);
});

test('the index order is deterministic across builds', () => {
  const docs = [
    doc({ slug: 'b', id: '2' }),
    doc({ slug: 'a', id: '1' }),
    doc({ slug: 'c', id: '3' }),
  ];

  const first = legalIndex(docs, disclosure, BUILT_AT).documents.map((d) => d.slug);
  const second = legalIndex(docs, disclosure, BUILT_AT).documents.map((d) => d.slug);

  expect(first).toEqual(second);
  expect(first).toEqual(['a', 'b', 'c']);
});

test('INV-M9-05: a legal page cannot be built without a disclosure', () => {
  expect(() => contentPage({ document: doc(), disclosure: null, built_at: BUILT_AT })).toThrow(
    DisclosureError,
  );
  expect(() => legalIndex([doc()], null, BUILT_AT)).toThrow(DisclosureError);
});
