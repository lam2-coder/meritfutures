### graduation_invitations
**`SD-M18-03`**. Reserved. Only if GP-M18-01 or GP-M18-02 ever ships; no live program exists at launch (OQ-M18-01) and zero live-program copy ships until counsel rules.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `program_ref` | text | not null | |
| `issued_at` | timestamptz | not null default now() | |
| `accepted_at`, `declined_at` | timestamptz | null | |
| `expires_at` | timestamptz | not null | |
| `terms_version` | integer | not null, check > 0 | **`SD-M18-03`.** Present from the first invitation, never added after the first dispute |
| `created_at` | timestamptz | not null default now() | |

Indexes: `graduation_invitations_identity_idx (identity_id, issued_at desc)`; `graduation_invitations_open_idx (expires_at)` where unanswered.
Constraints: `graduation_invitations_one_response`; `graduation_invitations_expiry_after_issue`.
The decoupling this table sits behind matters even though the program does not exist: [ADR-024](../../decisions/ADR-024.md) removed the invitation from R-49 because **an engine that emits an invitation on ladder completion has already made the promise**, and the promise commits Merit rather than the program. Invitation is a discretionary operator action taken from the `accounts.graduation_eligible` pool (`U-02`). Retrofitting discretion onto a population that already believes the ladder leads somewhere is far more expensive than designing it in now, while the population is zero. Topstep's live selectivity is 0.71 percent, and that is the number that settles the argument.
