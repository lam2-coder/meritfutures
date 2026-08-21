// =============================================================================
// apps/site/src/content/documents.ts
// =============================================================================
// SD-M9-02, AS THE SITE RECEIVES IT, AND WHY BLOG POSTS SHARE A TABLE WITH THE
// TERMS OF SERVICE.
//
// OQ-M9-02 proposed "one system, database backed, from the start, on the
// reasoning that two content systems is the outcome nobody chooses and
// everybody ends up with", and SD-M9-02's own justification is sharper: "Legal
// pages are **versioned documents with acceptance consequences**... Once legal
// pages need version history, giving blog posts a different storage mechanism
// means two content systems and one of them without an audit trail."
//
// THE CHECKSUM IS THE FIELD THAT MAKES THE REST OF IT MEAN ANYTHING. SD-M9-02:
// "`checksum` is what makes 'the page a trader accepted' a provable artifact
// rather than a git blame." It is carried through to the rendered page and
// stated there, because a document whose bytes cannot be checked against the
// acceptance record is a document that can only be asserted.
//
// SUPERSEDING NEVER DELETES, and the reason is stated twice in M9 section 3.1
// at two different weights. "A legal document a trader accepted in March must
// be readable in 2031 exactly as it was, because SECURITY records acceptance
// with a version and this module is where that version resolves to words." And
// for blog content, "for a smaller reason that still matters: a post quoted by
// a community member should not be able to change under the quote."
//
// ACCEPTANCE IS NOT RECORDED HERE AND MUST NEVER BE. M9 section 1.2: "M9
// renders versioned legal documents and records nothing about acceptance.
// Acceptance is [M3](M03)'s, against `tos_versions`." INV-M9-10 makes the
// marketing origin hold no write path, and an acceptance record is a write.
// =============================================================================

/** `content_documents.kind`. The CHECK's four members, and no fifth. */
export type ContentKind = 'page' | 'post' | 'faq' | 'legal';

/** One `content_documents` row, transcribed from `0020_public_surface.sql`. */
export interface ContentDocument {
  readonly id: string;
  readonly kind: ContentKind;
  readonly slug: string;
  readonly locale: string;
  readonly title: string;
  /** The authored source. Rendering MDX is the build's, not this module's. */
  readonly body_mdx: string;
  readonly version: number;
  /** ISO-8601 UTC. `null` while the document is a draft. */
  readonly published_at: string | null;
  /** The id of the document that replaced this one. `null` while it is live. */
  readonly superseded_by: string | null;
  readonly author: string;
  /**
   * `content_documents.checksum`, hex encoded.
   *
   * A `bytea` in the database and a string here, because the site only ever
   * DISPLAYS it and comparing it is the acceptance record's job. Carrying a
   * buffer would invite a comparison at the one layer that must not perform
   * one.
   */
  readonly checksum: string;
}

/**
 * Whether this row is the one a reader lands on by default.
 *
 * The live document is published and unsuperseded, which is exactly
 * `content_documents_live_uq`'s predicate. Restating the index's condition in
 * one function rather than at each call site is what keeps the site's idea of
 * "live" and the database's from drifting; the alternative is four call sites
 * and one of them checking only `published_at`.
 */
export function isLive(document: ContentDocument): boolean {
  return document.published_at !== null && document.superseded_by === null;
}
