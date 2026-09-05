### purchases
| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | fk identities, not null, on delete restrict | |
| `user_id` | uuid | fk users, not null, on delete restrict | who clicked, versus who they are. Both, because they can differ after a merge and the difference is evidence |
| `plan_version_id` | uuid | fk plan_versions, not null, on delete restrict | pins the contract at purchase time (B4 #12). The account's rules are the rules on the day it was bought, forever |
| `size_cents` | bigint | not null, check > 0 | |
| `kind` | text | not null, check in (`new`,`reset`) | resets reuse the same pipeline |
| `parent_account_id` | uuid | null, **fk added in `0007`** | set for resets. One of the three ruled reference cycles (§17) |
| `list_price_cents` | bigint | not null, check >= 0 | |
| `discount_cents` | bigint | not null default 0, check >= 0 | |
| `amount_paid_cents` | bigint | not null, check >= 0 | |
| `currency` | char(3) | not null default `'USD'` | reserved for multi-currency, never used in v1 math (Wave 2 gate ruling 5) |
| `coupon_id` | uuid | fk coupons, null, on delete restrict | |
| `affiliate_id` | uuid | fk affiliates, null, on delete restrict | attribution resolved at purchase |
| `psp` | text | null, **present exactly when `payment_method` is not `wallet`** (`purchases_processor_columns_follow_method`, `0081`), check in (`psp_a`,`psp_b`) | which MID took it. **The `NOT NULL` was dropped in [`0081`](../../../packages/db/migrations/0081_purchase_processor_columns.sql) ([ADR-323](../../decisions/ADR-323.md)): a wallet-funded purchase called no processor, so it names none**, and the `CHECK` is what makes the absence exact rather than merely permitted |
| `psp_reference` | text | null, **present exactly when `payment_method` is not `wallet`** (`purchases_processor_columns_follow_method`, `0081`) | the processor's own reference for the payment. Under `psp` and `mixed` the `CHECK` still requires it AT INSERT, so this column being nullable does **not** buy the deferred stamping [ADR-323](../../decisions/ADR-323.md) finding 8 says is still owed |
| `mid_reference` | text | null | the specific merchant account, for MID health |
| `status` | `purchase_status` enum(`pending`,`paid`,`failed`,`refunded`,`charged_back`) | not null default `pending` | |
| `paid_at` | timestamptz | null | |
| `ip` | inet | null | geo triangle and velocity |
| `refundable_until` | timestamptz | null | **`SD-M3-02`** |
| `first_trade_at` | timestamptz | null | **`SD-M3-02`.** The refund window is "pre-first-trade only", which is a fact about **trading**, so it has to be recorded on the purchase when M02 sees the first fill. Otherwise the refund policy is unenforceable and becomes a support argument (FM-M3-10) |
| `checkout_ip_country` | char(2) | null | **`SD-M3-05`** |
| `card_country` | char(2) | null | **`SD-M3-05`** |
| `geo_decision` | text | null, check in (`allowed`,`warned`,`blocked`) | **`SD-M3-05`.** The decision Merit made at checkout is recorded at checkout. Reconstructing it later from an IP log is not the same artifact: it tells you where they were, not what we decided |
| `payment_method` | text | not null default `psp`, check in (`psp`,`wallet`,`mixed`) | **`SD-M3-06`, [ADR-019](../../decisions/ADR-019.md).** `mixed` exists because a trader with $60 in the wallet buying a $99 evaluation is the common case, not an edge one |
| `wallet_debit_cents` | bigint | not null default 0, check >= 0 | **`SD-M3-06`.** Server-computed from the identity's balance, never supplied by the client, for the same reason no price is |
| `wallet_ledger_transaction_id` | uuid | null, **fk added in `0011`** | **`SD-M3-06`.** One of the three ruled reference cycles (§17) |
| `rule_diff_acknowledged_at` | timestamptz | null | **`SD-M4-02`.** A reset onto a changed plan version must be explicitly acknowledged (AS-M3-05). A reset is a new contract, and a trader who did not notice is a trader who was not told |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: unique `purchases_psp_reference_uq (psp, psp_reference)`, the idempotency anchor for webhooks; `purchases_identity_created_idx (identity_id, created_at desc)`; `purchases_pending_idx (created_at)` where `status = 'pending'` (the paid-not-provisioned alarm query); `purchases_refundable_idx (refundable_until)` where `first_trade_at is null and refundable_until is not null` (the refund-window closer); `purchases_parent_account_idx (parent_account_id)` where not null.
Constraints: `purchases_price_arithmetic` (`amount_paid_cents = list_price_cents - discount_cents`); `purchases_discount_within_list`; `purchases_wallet_leg_matches_method`; `purchases_wallet_debit_is_posted` (a wallet debit that posted no ledger transaction is money that moved outside the ledger); `purchases_reset_has_parent`; `purchases_paid_has_timestamp`; `purchases_processor_columns_follow_method` (**`0081`**: both processor columns absent under `wallet`, both present under `psp` and `mixed`, and a total `CASE` so a fourth `payment_method` is refused rather than admitted by a NULL).
Retention: forever.
Why the wallet constraints are three and not one: together they make "a wallet purchase that looks like a stalled PSP purchase" **unrepresentable**, which is the whole point of `SD-M3-06`. Without an explicit method the wallet path is indistinguishable from a PSP purchase whose webhook never arrived, which is exactly the state FM-M3-01 pages on.
