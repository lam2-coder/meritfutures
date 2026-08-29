---
status: approved
depends_on: [README.md]
last_updated: 2026-08-29
---

### operators

**[ADR-237](../../decisions/ADR-237.md)**, [`0073`](../../../packages/db/migrations/0073_operator_directory.sql). **Merit's record of who may act on its own surface, and the referent [`admin_actions`](admin_actions.md)`.actor` did not have.** `0017` declares that column `text NOT NULL` with no foreign key, so its own stated control, *"NO UNEXPLAINED ADMIN ACTION, EVER"*, rested on a `NOT NULL` that any string satisfies, including a string naming nobody.

**This table is a directory and it is deliberately not a login.** There is no password column, no secret and no local credential. Merit is passwordless by [ADR-039](../../decisions/ADR-039.md) and [`0002`](../../../packages/db/migrations/0002_identity.sql) states it for the whole schema. `SECURITY` `C-08` is amended by ADR-237 to say which half of the sentence is the identity provider's: proving **who** someone is, and never **which** operators exist or **what role** each holds.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk default `gen_random_uuid()` | |
| `actor` | text | **not null, unique**, non-blank and untrimmed-rejecting | **The join column rather than a label.** `admin_actions.actor` is `text` and `0017` is merged, so the referent has to be reachable from a `text` column. **Immutable once used**, by the `ON UPDATE RESTRICT` on that foreign key: renaming it would rewrite what an append-only audit row says about a past act |
| `role` | text | not null, check in (`owner`,`ops`,`readonly`) | [API_CONTRACT](../API_CONTRACT.md) section 8's closed set. A `CHECK` rather than an enum type on [`0043`](../../../packages/db/migrations/0043_admin_attributed_actions.sql)'s precedent: an enum label cannot be removed and a role set is exactly the vocabulary a later ruling narrows |
| `status` | text | not null default `active`, check in (`active`,`suspended`) | **Whether they may act today, which is not whether they exist.** The row can never be deleted once it has acted, so without this column offboarding would be impossible rather than awkward. Two values and no third: a departure and a suspension are the same fact to an authorization decision |
| `display_name` | text | not null, non-blank | An operator console's own screens. **Never an authorization input** |
| `idp_issuer`, `idp_subject` | text, text | **null**, unique together where present | What a verified assertion is matched against. **Not a credential**: a subject claim is an identifier the provider asserts, the way `passkeys.credential_id` is. **Scoped by issuer** because a subject is unique only within one, so a second provider added later cannot resolve to the first one's operator. **NULL means this operator cannot sign in at all**, which is the correct state for a row provisioned before the provider has seen the person and for an actor that must be nameable in the audit trail without holding a session; NULL is **unreachable rather than claimable**, because the lookup is an equality and SQL equality never matches NULL |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: `operators_idp_identity_idx (idp_issuer, idp_subject)` **unique and partial**, `where idp_issuer is not null`.
Constraints: `operators_idp_link_is_whole` (`(idp_issuer IS NULL) = (idp_subject IS NULL)`; a subject with no issuer is a claim with no claimant, and either half alone makes the two-column match silently unsatisfiable).

**An operator is not a `users` row, and [`0042`](../../../packages/db/migrations/0042_impersonation_sessions.sql) already said otherwise.** `impersonation_sessions.admin_user_id uuid NOT NULL REFERENCES users(id)` models an operator as a trader-side row. **That edge is refused here on a credential rather than on a taste**: a [`users`](users.md) row is authenticable by an emailed OTP, because [`otp_challenges`](otp_challenges.md) keys off `email_normalized` and `POST /auth/verify` mints a [`sessions`](sessions.md) row from one, so an operator holding a `users` row already holds a login this deployable can mint. `SECURITY` says the opposite in terms: *"Admin auth stays hardware-key SSO (C-08) with no SMS path, ever."* `0042` is merged and is not edited; ADR-237 section 6 records the finding with the slice that owns the repair.

Retention: **forever.** An operator who has acted is named in an append-only audit trail and cannot be deleted out from under it.
