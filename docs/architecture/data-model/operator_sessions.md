---
status: approved
depends_on: [README.md]
last_updated: 2026-08-29
---

### operator_sessions

**[ADR-237](../../decisions/ADR-237.md)**, [`0073`](../../../packages/db/migrations/0073_operator_directory.sql). **What a verified assertion turns into, and nothing in this repository writes a row here.** The minter needs the `C-08` identity provider, which is a purchase rather than a slice. That is the point rather than a gap: **a table an unfinished deployment can fill is a login**, and this is not one.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk default `gen_random_uuid()` | |
| `operator_id` | uuid | not null -> [`operators`](operators.md)`(id)` on delete restrict | |
| `token_hash` | bytea | **not null, unique** | **The hash, never the token**, on [`sessions`](sessions.md)`.refresh_token_hash` and `impersonation_sessions.token_hash`. The same declaration in the same shape, so a reader comparing the three surfaces finds one convention rather than three |
| `idp_assertion_id` | text | **not null**, non-blank | **Which verified assertion this session came from, and the whole difference between this table and a login.** A row has to name the assertion it was minted from, so a session nobody proved has nothing to write here. The provider's assertion identifier, not a secret; the assertion itself is never stored |
| `issued_at` | timestamptz | not null default now() | |
| `expires_at` | timestamptz | not null | |
| `revoked_at` | timestamptz | null | |
| `created_ip`, `created_user_agent`, `last_seen_at`, `last_seen_ip` | inet, text, timestamptz, inet | null | `SD-M4-03`'s pair, for the reason `sessions` carries it: a session that moved address mid-life is only expressible if the creation values and the last-seen values are separate columns |
| `created_at` | timestamptz | not null default now() | |

Indexes: `operator_sessions_operator_idx (operator_id, issued_at DESC)`; `operator_sessions_live_idx (expires_at)` where `revoked_at is null`, partial on `sessions_live_idx`'s precedent.
Constraints: `operator_sessions_expires_after_issue`; `operator_sessions_revoked_within_life`.

**A floor and deliberately no ceiling, which is the one control this table owes and does not carry.** `impersonation_box_is_bounded` carries a two-hour ceiling because [M06](../../plans/M06-admin-ops-console.md)'s `SD-M6-10` states one, and *"a configurable duration with no ceiling is a setting, not a bound"* is that plan's own sentence. **The corpus states no ceiling for an operator session**, `sessions` carries none either, and a number invented here would be the setting the sentence warns about. ADR-237 section 7 registers it as owed and names the slice that rules it: whichever one lands the minter, because that is the first slice with a number to defend.

**No trigger ties `token_hash` to `sessions.refresh_token_hash`, and that is deliberate.** `IMPERSONATION-C1` exists because `0042` mints a token **intended** to be presented on the trader path. No token here is ever presented there, so the only way the two could collide is a repeated draw from a CSPRNG.

Retention: **90 days after expiry**, on `sessions`' precedent.
