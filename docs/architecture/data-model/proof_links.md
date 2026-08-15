### proof_links
**`SD-M12-04`**, INV-M12-11, AS-M12-02.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `kind` | text | not null, check in (`onchain_address`,`onchain_tx`,`third_party_tracker`,`certificate_verify`) | |
| `label` | text | not null | |
| `url` | text | not null | |
| `scope_note` | text | **not null** | what this link does and does not prove. A proof link with no stated scope is a claim the reader gets to interpret |
| `enabled` | boolean | not null default false | |
| `added_by` | text | not null | |
| `added_at` | timestamptz | not null default now() | |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `proof_links_url_uq (url)`; `proof_links_enabled_idx (kind)` where `enabled`.
An on-chain address published as proof is a permanent, irrevocable disclosure. It cannot be unpublished, it cannot be scoped after the fact, and everything that address ever does becomes public commentary on Merit. The decision to publish one needs an audited row with a written scope note rather than a link somebody added to a template.

**Analytics and journal (`0022`).** Not a money-path file, and one line in it is load bearing anyway: `round_trips.net_result_cents` is **presentational and never reconciles the account**. `daily_marks` does that (INV-M13-02). Two numbers that both look like "what this account made" is exactly how a second rulebook appears, which is also why the analytics database role cannot read plan config at all (`0026`). The separation is enforced by permission rather than by care.
