### account_adjustments
**`SD-M6-09`**. [ADR-067](../../decisions/ADR-067.md), [`0038`](../../../packages/db/migrations/0038_account_adjustments.sql). The audited admin credit or debit. **Never a balance mutation:** an adjustment posts a ledger transaction or it does not exist.

**The table is named for the OCCASION and not for the POSITION.** The position is always identity-scoped, because both permitted destinations are identity-scoped ledger classes. The account is the incident, the reconciliation difference or the dispute that produced the adjustment, and it is nullable: a goodwill credit for a support failure has no account. **No adjustment ever touches an account's trading balance**; a reconciliation difference on one is absorbed and reported through `liability_snapshots.absorbed_corrections_cents`.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `identity_id` | uuid | not null, fk `identities` | The position. Always the human |
| `account_id` | uuid | null, fk `accounts` | The occasion. Context, deliberately nullable |
| `direction` | text | not null, check in (`credit`,`debit`) | |
| `amount_cents` | bigint | not null, check `> 0` | **A MAGNITUDE.** `direction` carries the sign. `wallet_entries`' convention and deliberately **not** `ledger_entries`' signed one: reusing one convention for two different questions is the shape of error [ADR-027](../../decisions/ADR-027.md) was reversed over |
| `reason_code` | text | not null, check in (`goodwill`,`reconciliation_error`,`promotional_credit`) | **The closed vocabulary lives in the migration.** A reason column that accepts free text is one nobody can aggregate |
| `reason_note` | text | not null, check non-empty | Both are required. The emptiness check is not decoration: `INV-M6-01` calls `NOT NULL` "the whole control" and a single space satisfies it |
| `destination` | text | not null, check in (`trader_wallet`,`promotional_credit`) | **Never `trader_withdrawable`**, which is [ADR-067](../../decisions/ADR-067.md) section 2.1 |
| `ledger_transaction_id` | uuid | **not null**, unique, fk `ledger_transactions` | **The adjustment IS its posting.** Unique because an adjustment owns its transaction; two sharing one would make both assertions below ambiguous |
| `promotional_credit_grant_id` | uuid | null, unique where not null, fk `promotional_credit_grants` | Not null exactly when the destination is promotional, so [`0024`](../../../packages/db/migrations/0024_offers.sql)'s mandatory expiry stays in the path |
| `reverses_adjustment_id` | uuid | null, fk self | **The only debit that exists.** See below |
| `actor` | text | not null, check non-empty | |
| `dual_control_threshold_cents` | bigint | not null, check `> 0` | **The threshold IN FORCE when the row was written**, on `plan_breaker_state`'s precedent. Without it a later configuration change retroactively makes an uncontrolled adjustment look compliant |
| `dual_control_approval_id` | uuid | null, fk `dual_control_approvals` | |
| `evidence_pack_id` | uuid | null, fk `evidence_packs` | Optional, deliberately: a goodwill credit for a late support reply has no pack to export |
| `created_at` | timestamptz | not null default now() | |

Indexes: `account_adjustments_transaction_uq (ledger_transaction_id)`; `account_adjustments_grant_uq (promotional_credit_grant_id)` where not null; **`account_adjustments_reversal_uq (reverses_adjustment_id)`** where not null, at most one reversal per adjustment; `account_adjustments_identity_idx (identity_id, created_at DESC)`; `account_adjustments_account_idx (account_id, created_at DESC)` where not null; `account_adjustments_actor_idx (actor, created_at DESC)`.

Constraints: **`account_adjustments_reason_picks_destination`** (an equivalence, so `INV-M20-03` is unbreakable through this surface rather than defended on it); `account_adjustments_promotional_names_its_grant`; **`account_adjustments_debit_is_a_reversal`**; `account_adjustments_no_self_reversal`; **`account_adjustments_dual_control_above_threshold`**.

Assertions: **`ADJ-C1`** `assert_adjustment_reversal_is_sound`, six branches, `BEFORE INSERT`. **`ADJ-C2`** `assert_adjustment_posting_matches` and **`ADJ-C3`** `assert_adjustment_wallet_entry_matches`, both `DEFERRABLE INITIALLY DEFERRED` constraint triggers for the reason [`0027`](../../../packages/db/migrations/0027_triggers_invariants.sql)'s zero-sum trigger is deferred.

**`ADJ-C2` is the central control and `ledger_transaction_id NOT NULL` is not.** The `NOT NULL` makes an **unposted** adjustment unwritable. It does nothing about an adjustment posted against the **wrong account**, for the **wrong amount**, or in the **wrong direction**, and each of those is a balance mutation with a receipt stapled to it. `ADJ-C2` reads the transaction and asserts it **is** the adjustment: exactly two legs, the identity's destination position at the right signed magnitude, and `fees_revenue` opposite. **`fees_revenue` is the debit leg and no eighth ledger class was created**; the cost is that the revenue line nets goodwill against fees, and the remedy is a join rather than a class ([ADR-067](../../decisions/ADR-067.md) section 2.3, `OQ-F6-03`).

**A debit can only remove money Merit itself put there by adjustment, and never a cent the trader earned.** That is what keeps it clear of [M06](../../plans/M06-admin-ops-console.md) `INV-M6-03`, and it is a row the database refuses rather than a rule an operator follows. **Partial reversal is refused too**: a 50,000 cent credit that should have been 20,000 is reversed in full and re-posted, which leaves three visible postings instead of a row that quietly shrank. `SD-M5-05`'s reasoning, one table up.

**Append-only by grant** (VG-8): [`0038`](../../../packages/db/migrations/0038_account_adjustments.sql) revokes `UPDATE` and `DELETE` from `merit_app` **and `PUBLIC`**, and that revoke is what makes the rest hold. Without it every constraint above is bypassable by writing a compliant row and then editing it, because the deferred assertions are `INSERT` triggers and never fire again.

**One branch of `ADJ-C1` is unreachable and says so in the file.** `account_adjustments_debit_is_a_reversal` makes every debit a reversal, so the "must reverse a credit" branch can never be the first to fire. It is kept as a second line on `LEDGER-C2`'s stated reason, that a guarantee resting on a `CHECK` a later migration could drop is a guarantee with a dependency. **It was found by running the trigger, not by reading it** ([DELTA_MANIFEST section 21](../../../packages/db/DELTA_MANIFEST.md)).
