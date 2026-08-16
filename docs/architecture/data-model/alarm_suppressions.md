### alarm_suppressions
**`SD-M6-03`**, INV-M6-06. A mandatory expiry, which is the whole delta.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `alarm_key` | text | not null | |
| `scope` | jsonb | not null default `'{}'` | what the suppression covers: an account, an identity, a plan, a detector. `jsonb` because the scope shape differs per alarm and inventing a column per alarm class is how this table becomes unmaintainable |
| `reason` | text | **not null** | a suppression nobody explained is one nobody can review |
| `suppressed_by` | text | not null | |
| `suppressed_at` | timestamptz | not null default now() | |
| `expires_at` | timestamptz | **not null** | **and there is no sentinel for "never".** The only way to suppress an alarm indefinitely is to keep renewing the suppression, which is a repeated, dated, attributed act rather than a single forgotten one |
| `released_at` | timestamptz | null | |
| `created_at` | timestamptz | not null default now() | |

Indexes: `alarm_suppressions_live_idx (alarm_key, expires_at)` where `released_at is null`.
Constraints: `alarm_suppressions_expiry_after_start`.
Constitution M1's own FM-17 names the failure this prevents: a self-audit that becomes slow becomes a self-audit that gets disabled. A mandatory expiry converts "temporarily off" from a lie people tell themselves into a dated fact.
