### evidence_packs
Export is itself an audited act, because an evidence pack contains everything about a trader.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `account_id` | uuid | fk accounts, not null, on delete restrict | |
| `requested_by` | text | not null | |
| `reason` | text | not null | |
| `content_sha256` | bytea | not null | |
| `storage_ref` | text | not null | private object storage, signed URL only. Never a public path |
| `generated_at` | timestamptz | not null default now() | |
| `audience` | text | not null, check in (`internal`,`trader`,`counsel`,`regulator`) | **`SD-M6-04`** |
| `redaction_profile` | text | not null | **`SD-M6-04`** |
| `includes_detector_detail` | boolean | not null | **`SD-M6-04`** |
| `created_at` | timestamptz | not null default now() | |

Indexes: `evidence_packs_account_idx (account_id, generated_at desc)`; `evidence_packs_audience_idx (audience, generated_at desc)`.
Constraints: **`evidence_packs_trader_gets_no_detector_detail`** (`audience <> 'trader' OR includes_detector_detail = false`).
Retention: forever.
Why the disclosure rule is DDL rather than a handler (AS-M6-01): a pack given to a trader in a dispute is a channel that discloses detector thresholds **to the adversary who triggered them**. The audience must be a declared, audited property of the export rather than a judgment made in the moment by whoever is answering the ticket. Detector internals are internal-tier always ([ADR-022](../../decisions/ADR-022.md)): the richer the graph, the more a leak is worth. That one combination must be unrepresentable, and it is the combination a hurried export would produce.
