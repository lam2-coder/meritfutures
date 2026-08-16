### journal_entries
**`SD-M13-02`**. The trader's own notes. Merit reads them for nothing.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `account_id` | uuid | fk accounts, null, on delete restrict | |
| `scope` | text | not null, check in (`day`,`round_trip`) | |
| `reference_id` | uuid | null | the round trip, when scope is `round_trip` |
| `body` | text | not null | |
| `tags` | text[] | not null default `'{}'` | |
| `deleted_at` | timestamptz | null | **`SD-M13-02`**, INV-M13-07. The **tombstone**, not the end state |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: `journal_entries_identity_idx (identity_id, created_at desc)` where live; `journal_entries_reference_idx (reference_id)` where not null; `journal_entries_pending_purge_idx (deleted_at)` where not null, the hard-delete job's queue.
Constraints: `journal_entries_round_trip_has_reference`.
A trader who deletes a note expects it gone, and a note that survives deletion in a backup is the difference between a promise and a claim. A hard-delete job removes the row afterwards; the soft phase exists only so the delete is undoable inside a short window and so the job has something to find.
