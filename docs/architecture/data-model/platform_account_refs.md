### platform_account_refs
**`SD-M2-02`**, INV-M2-10: a platform ref is never reused across accounts, for any reason.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `platform` | text | not null, check in (`rithmic`,`tradovate`,`cqg`), pk part | |
| `platform_account_ref` | text | not null, pk part | |
| `account_id` | uuid | fk accounts, not null, on delete restrict | |
| `assigned_at` | timestamptz | not null default now() | |
| `retired_at` | timestamptz | null | |
| `retired_reason` | text | null | |
| `created_at` | timestamptz | not null default now() | |

Primary key: composite `(platform, platform_account_ref)`. **The primary key is the burn**: a second row for the same pair cannot exist, so reassignment fails at insert rather than being detected later.
Indexes: `platform_account_refs_account_idx (account_id)`; `platform_account_refs_retired_idx (platform, platform_account_ref)` where `retired_at is not null`, which is the ingest guard's read path.
Constraints: `platform_account_refs_retirement_is_explained`.
Retention: forever. A burned ref stops being burned only if the row is deleted, which the grants forbid.
Why it exists as a second table: `accounts.platform_account_ref` is unique among **live** accounts, which does not stop a vendor recycling a retired identifier onto a new account. A recycled ref silently routes one trader's fills onto another trader's account, corrupts two accounts, one of which may be funded, and is invisible until reconciliation (FM-M2-05). An inbound row citing a retired ref **quarantines the whole file** rather than being routed anywhere. That is the one case in the system where Merit would rather lose a day of data than accept it (AS-M2-05).
Open, and not decided by assumption: if the vendor's identifier space is genuinely finite and reuse is forced (`V-M2-10`, a vendor-call question), the only safe design is a Merit-side surrogate with an explicit epoch.
