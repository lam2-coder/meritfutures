### accounts
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `user_id` | uuid | fk users, not null, on delete restrict | |
| `purchase_id` | uuid | fk purchases, not null, unique, on delete restrict | one account per purchase. The unique index is what makes a duplicate provisioning run impossible to complete rather than merely unlikely |
| `plan_version_id` | uuid | fk plan_versions, not null, on delete restrict | **never changes**, for the life of the account (ToS clause 12, B4 #12, GS-041). Enforced by trigger in `0027` |
| `size_cents` | bigint | not null, check > 0 | |
| `phase` | `account_phase` enum(`eval`,`funded`,`closed`,`graduated`) | not null | the lifecycle the engine executes ([STATE_MACHINES](../STATE_MACHINES.md)) |
| `status` | `account_status` enum(`provisioning_pending`,`active`,`breached`,`expired`,`closed_admin`,`closed_chargeback`,`graduated`) | not null | operational state, distinct from phase. An account can be phase `funded` and status `breached`; collapsing the two loses which fact is being asserted |
| `platform` | text | not null default `rithmic`, check in (`rithmic`,`tradovate`,`cqg`) | **B3 reservation.** v1 is always rithmic; the column is what makes a second platform adapter a config change rather than a migration against live accounts |
| `platform_account_ref` | text | null | unique among **live** accounts only (see `platform_account_refs`) |
| `feed` | text | null, check in (`rithmic`,`cqg`,`dxfeed`) | **B3 reservation.** Marketing needs it even when ingest does not |
| `front_end_permissions` | jsonb | not null default `'[]'` | NinjaTrader, Quantower, ATAS and friends; a provisioning input |
| `opened_on` | date | not null | trading day, not a timestamp. The calendar is authoritative (B4 #1) |
| `funded_on` | date | null | set at eval pass |
| `closed_on` | date | null | |
| `close_reason` | text | null | |
| `payouts_frozen` | boolean | not null default false | account-level freeze, in addition to the identity-level flag. Both exist because an investigation can be about one account or about a person |
| `recon_blocked` | boolean | not null default false | set by a failed [reconciliation](../../GLOSSARY.md#reconciliation); a **context gate**, never part of the replayed state (INV-23) |
| `expires_on` | date | null | eval expiry when configured (v1 unlimited on all three) |
| `graduated_at` | timestamptz | null | **`SD-M18-01`** |
| `graduation_path` | text | null, check in (`continuation`,`third_party_intro`,`live_program`) | **`SD-M18-01`.** `live_program` is in the vocabulary and **no live program exists at launch** (OQ-M18-01 as ruled at the FREEZE gate). The value is present so the shape is decided before commercial pressure decides it, and zero live-program copy ships until counsel rules |
| `terminal_settlement_id` | uuid | null, **fk added in `0010`** | **`SD-M18-01`.** Without it, a graduated account holding a balance is indistinguishable from one that paid out fully (INV-M18-05). One of the three ruled reference cycles (§17) |
| `graduation_eligible` | boolean | not null default false | **`U-02`.** [ADR-024](../../decisions/ADR-024.md), M01 R-49: the engine sets phase `graduated` plus this review-pool flag and emits **no** invitation event. An engine that emits an invitation on ladder completion has already made the promise, and the promise commits Merit rather than the program |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: `accounts_identity_status_idx (identity_id, status)`; unique `accounts_platform_ref_uq (platform, platform_account_ref)` where not null; `accounts_funded_idx (phase)` where `phase = 'funded'` (the open-liability scan); `accounts_provisioning_idx (created_at)` where `status = 'provisioning_pending'`; `accounts_graduation_pool_idx (identity_id)` where `graduation_eligible`.
Constraints: `accounts_funded_has_date`; `accounts_terminal_has_close_date`; `accounts_graduation_is_complete` (**`SD-M18-01`**: a graduation is dated and has a path, or it did not happen); `accounts_closed_is_explained`.
Retention: forever.
Trader-facing exposure of the graduation pool is forbidden: it is an admin queue, and a pool a trader can see is a promise. The ladder is "the maximum payout level, not a guaranteed minimum for live eligibility" (ToS clause 8).
