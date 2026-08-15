### content_documents
**`SD-M9-02`**.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `kind` | text | not null, check in (`page`,`post`,`faq`,`legal`) | |
| `slug` | text | not null | |
| `locale` | text | not null default `'en'` | |
| `title` | text | not null | |
| `body_mdx` | text | not null | |
| `version` | integer | not null default 1, check > 0 | |
| `published_at` | timestamptz | null | |
| `superseded_by` | uuid | fk content_documents, null, on delete restrict | supersession rather than update, the same discipline as `daily_marks` and `contact_channels` and for the same reason: the previous answer is evidence |
| `author` | text | not null | |
| `checksum` | bytea | not null | **`SD-M9-02`.** What makes "the page a trader accepted" a provable artifact rather than a git blame |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `content_documents_slug_version_uq (kind, slug, locale, version)`; unique `content_documents_live_uq (kind, slug, locale)` where live and published, the site's read path.
Constraints: `content_documents_no_self_supersede`.
Why legal pages and blog posts share one table: legal pages are versioned documents **with acceptance consequences**, and once they need version history, giving blog posts a different storage mechanism means two content systems and one of them without an audit trail.
