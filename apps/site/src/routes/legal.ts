// =============================================================================
// apps/site/src/routes/legal.ts
// =============================================================================
// THE VERSIONED DOCUMENT SURFACE, WHICH IS WHERE AN ACCEPTANCE RECORD RESOLVES
// TO WORDS.
//
// FM-M9-06 is the failure this surface exists inside: "Legal page superseded
// while a checkout is open... A trader accepts a version they did not read."
// The mechanism that prevents it is not here and is not new: "`tos_versions` is
// pinned into the checkout session at open ([M3](M03)), exactly as the plan
// version is (B4 #12). The pinned version wins. The mechanism already exists for
// prices and is reused rather than reinvented." What this file owes that
// mechanism is that the pinned version still resolves to the words it had.
//
// SO EVERY DOCUMENT HAS TWO ADDRESSES AND THEY MEAN DIFFERENT THINGS. The live
// address is for a reader; the versioned address is for a citation, and it is
// the one an acceptance record, an evidence pack and a trader's own email
// history point at. A single address whose content changed under a citation is
// the same defect as a rules page that silently became a different document at
// the same URL, which is AS-M9-07 in the other half of the estate.
//
// THE ALARM ON THIS SURFACE IS A PAGE-LEVEL ONE AND SECTION 9.2 SAYS WHY:
// "Legal page 404 or checksum mismatch | any | **page**. An unreachable ToS
// version is an evidentiary failure." Not a marketing failure. `M9-K-01` walks
// every legal version nightly for the same reason it walks every `public_slug`.
// =============================================================================

import type { BuiltAt } from '../catalog/types.ts';
import type { ContentDocument } from '../content/documents.ts';
import { isLive } from '../content/documents.ts';
import type { SimulatedEnvironmentDisclosure } from '../render/disclosure.ts';
import type { PageEnvelope } from './page.ts';
import { page } from './page.ts';
import { contentLivePath, contentVersionPath } from './paths.ts';

/** A versioned document, rendered. */
export interface ContentPage {
  readonly envelope: PageEnvelope;
  readonly kind: ContentDocument['kind'];
  readonly slug: string;
  readonly version: number;
  readonly title: string;
  readonly body_mdx: string;
  readonly author: string;
  readonly published_at: string | null;
  /** SD-M9-02. Displayed, never compared here. */
  readonly checksum: string;
  /** The permanent citation address for this exact version. */
  readonly version_path: string;
  /** The address of whatever is live now. Equal to `version_path` when this is. */
  readonly live_path: string;
  /** `null` while this version is the live one. */
  readonly supersession_notice: string | null;
}

/**
 * One version of one content document.
 *
 * `indexable` follows `isLive`, which is the same shape as a plan version's
 * page: a superseded legal version stays reachable forever at its permanent
 * address and is not the document a stranger should land on from search. An
 * unpublished draft is not indexable for the different reason that it is not
 * published, and the two collapse to one boolean here because they collapse to
 * one boolean in `content_documents_live_uq`.
 */
export function contentPage(input: ContentPageInput): ContentPage {
  const { document } = input;
  const version_path = contentVersionPath(document.kind, document.slug, document.version);
  const live = isLive(document);

  return {
    envelope: page({
      path: version_path,
      title: document.title,
      indexable: live,
      built_at: input.built_at,
      disclosure: input.disclosure,
    }),
    kind: document.kind,
    slug: document.slug,
    version: document.version,
    title: document.title,
    body_mdx: document.body_mdx,
    author: document.author,
    published_at: document.published_at,
    checksum: document.checksum,
    version_path,
    live_path: contentLivePath(document.kind, document.slug),
    supersession_notice: supersessionNotice(document),
  };
}

/** What a caller supplies to render one version of one document. */
export interface ContentPageInput {
  readonly document: ContentDocument;
  readonly disclosure: SimulatedEnvironmentDisclosure | null;
  readonly built_at: BuiltAt;
}

/**
 * The legal index: one entry per live document.
 *
 * SUPERSEDED VERSIONS ARE NOT LISTED AND ARE NOT GONE. INV-M9-11's shape
 * applied to content: reachable by link, unreachable by browsing. A legal index
 * that listed every version of every document would make the current terms
 * harder to find, which is the opposite of what a legal index is for, and
 * removing the old ones from the index does not remove them from the web.
 */
export function legalIndex(
  documents: readonly ContentDocument[],
  disclosure: SimulatedEnvironmentDisclosure | null,
  built_at: BuiltAt,
): LegalIndexPage {
  const live = documents.filter((d) => d.kind === 'legal' && isLive(d));

  return {
    envelope: page({
      path: '/legal',
      title: 'Legal',
      indexable: true,
      built_at,
      disclosure,
    }),
    documents: live
      .map((d) => ({
        slug: d.slug,
        title: d.title,
        version: d.version,
        published_at: d.published_at,
        version_path: contentVersionPath(d.kind, d.slug, d.version),
        live_path: contentLivePath(d.kind, d.slug),
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug)),
  };
}

/** One row of the legal index. */
export interface LegalIndexEntry {
  readonly slug: string;
  readonly title: string;
  readonly version: number;
  readonly published_at: string | null;
  readonly version_path: string;
  readonly live_path: string;
}

/** The legal index's model. */
export interface LegalIndexPage {
  readonly envelope: PageEnvelope;
  readonly documents: readonly LegalIndexEntry[];
}

/**
 * The label a superseded document carries.
 *
 * IT DOES NOT NAME THE SUCCESSOR'S VERSION and a plan version's notice does,
 * which is a difference in the data rather than in the policy.
 * `content_documents.superseded_by` is an id, not a version number, so naming
 * the successor's number here would mean either resolving a second row (which a
 * page cannot do at render) or printing an id at a reader. The live address is
 * what a reader needs and it is stable, so the notice points there.
 */
function supersessionNotice(document: ContentDocument): string | null {
  if (document.superseded_by === null) return null;

  return (
    `This is version ${document.version} of ${document.title}, kept at its own ` +
    'permanent address because it is the version some agreements were made ' +
    'against. The current version is linked below.'
  );
}
