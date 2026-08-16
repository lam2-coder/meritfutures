### identity_signals
Observed entity-resolution signals. One row per observation type per value per identity. Values are hashed, never raw, which bounds what a breach yields to "these two accounts shared something" rather than to the card number they shared.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `kind` | text | not null, check in (`device`,`ip`,`asn`,`email_normalized`,`payment`,`kyc_identity`,`rise_identity`,**`footprint_enrichment`**) | text plus check because this set grows with every detector that observes a new kind of thing. **`footprint_enrichment` is `U-04`**: [ADR-023](../../decisions/ADR-023.md)'s SEON-class checkout enrichment vendor feeding M07's D-15. Observe mode at launch, fail-open on timeout, never a silent decline |
| `value_hash` | bytea | not null | **hashed, never raw**: card BIN plus last four, device id, IP |
| `value_preview` | text | null | non-identifying display fragment for admin (for example `visa ****4242`), deliberately not enough to reconstruct what it previews |
| `first_seen_at` | timestamptz | not null default now() | |
| `last_seen_at` | timestamptz | not null default now() | |
| `observation_count` | integer | not null default 1, check > 0 | weak-signal weighting |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `identity_signals_identity_kind_value_uq (identity_id, kind, value_hash)`; `identity_signals_kind_value_idx (kind, value_hash)` for reverse lookup, which **is** the entity graph's read path (the join that finds every identity sharing a device).
Retention: 24 months rolling for `ip`; forever for `payment` and `kyc_identity` (fraud history).
