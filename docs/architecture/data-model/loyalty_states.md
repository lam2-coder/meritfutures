### loyalty_states
**`SD-M14-01`**, INV-M14-03. Derived per day, never a mutable balance.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `identity_id` | uuid | fk identities, not null, on delete restrict, pk part | |
| `as_of_trading_day` | date | not null, pk part | |
| `payouts_lifetime` | integer | not null, check >= 0 | |
| `consecutive_payout_cycles` | integer | not null, check >= 0 | |
| `accounts_funded_lifetime` | integer | not null, check >= 0 | |
| `ladders_completed_lifetime` | integer | not null default 0, check >= 0 | already inside `SD-M14-01`'s column list and **not a separate delta** (manifest section 7). This is the counter the cross-account programme keys off: the Nth **completed ladder** earns reset discounts, promotional credit and review-pool priority |
| `resets_lifetime` | integer | not null, check >= 0 | |
| `tenure_days` | integer | not null, check >= 0 | |
| `derivation_version` | integer | not null, check > 0 | |
| `inputs_digest` | bytea | not null | the tamper indication. Recompute, compare, and a mismatch is a finding |
| `created_at` | timestamptz | not null default now() | |

Primary key: composite `(identity_id, as_of_trading_day)`.
Indexes: `loyalty_states_identity_idx (identity_id, as_of_trading_day desc)`.
Constraints: `loyalty_states_ladders_within_accounts`; `loyalty_states_cycles_within_payouts`. Both bounds are arithmetic rather than policy.
A mutable counter cannot be explained to a trader and cannot be audited: it says what it says. A derived state reproduces from the event stream, so a tier change is explicable and a hand edit is visible as a divergence.
