### users
The authentication principal. One identity may own several users only through a merge; the normal case is one to one.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | every user belongs to a resolved identity |
| `email` | citext | not null, unique | citext so casing never creates a duplicate human |
| `email_normalized` | citext | not null | dots and plus-tags stripped; the entity-resolution key. Indexed but **not** unique: two people can legitimately share a normalized form, so it is a signal, not a constraint, and making it unique would refuse service to the second of them |
| `email_verified_at` | timestamptz | null | |
| `country_code` | char(2) | null, check `~ '^[A-Z]{2}$'` | geo-block and KYC triangle. The check is a shape check, not an ISO-3166 membership test; membership belongs to the application's country table |
| `timezone` | text | null | display only; never used in rule math, because the trading day comes from the exchange session calendar (B4 #1) |
| `marketing_consent` | boolean | not null default false | |
| `last_login_at` | timestamptz | null | |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: unique on `(email)` (inline); `users_email_normalized_idx (email_normalized)`; `users_identity_idx (identity_id)`.
Retention: forever, subject to the deletion runbook (privacy requests redact PII columns and retain the financial spine).
