### notification_kinds
**`SD-M16-01`**, INV-M16-01, INV-M16-02, INV-M16-08.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `kind` | text | pk | |
| `class` | text | not null, check in (`security`,`money`,`account_state`,`marketing`) | **the policy.** `security` and `money` are never silenceable; `account_state` is silenceable; `marketing` is silenceable and requires consent to send at all |
| `title` | text | not null | |
| `template_code` | text | not null | |
| `template_version` | integer | not null default 1, check > 0 | |
| `default_channels` | text[] | not null default `'{in_app}'` | |
| `mutable` | boolean | **generated always as** `class IN ('account_state','marketing')` **stored** | **`SD-M16-01`.** Generated, never written independently. As an ordinary column a money notification could be marked mutable by a single careless insert and nothing would object |
| `coalesce_key_spec` | text | null | how to collapse a burst into one message. Null means never coalesce, which is correct for security and money: three payout events are three facts |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: `notification_kinds_class_idx (class)`.
Constraints: `notification_kinds_immutable_never_coalesced`; `notification_kinds_has_channels`.
The class is the module's entire policy, and it belongs in data where it can be reviewed in one query rather than distributed across handlers. The generated `mutable` column is what stops the sort of drift that produces a silenceable money notification eighteen months from now.
