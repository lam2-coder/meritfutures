### tos_versions
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `document` | text | not null, check in (`tos`,`privacy`,`risk_disclosure`,`affiliate_tos`) | |
| `version` | integer | not null, check > 0 | |
| `body_md` | text | not null | |
| `effective_at` | timestamptz | not null | |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `tos_versions_document_version_uq (document, version)`.
Immutable once `effective_at` has passed: a document a trader accepted cannot be edited into one they did not.
Retention: forever.
