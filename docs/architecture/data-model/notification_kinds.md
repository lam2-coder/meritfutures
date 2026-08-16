### notification_kinds
**`SD-M16-01`**, INV-M16-01, INV-M16-02, INV-M16-08.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `kind` | text | pk | |
| `class` | text | not null, check in (`security`,`money`,`account_state`,`marketing`,**`pre_identity_auth`**) | **the policy.** `security` and `money` are never silenceable; `account_state` is silenceable; `marketing` is silenceable and requires consent to send at all. **`pre_identity_auth` is `SD-M16-07`**, [ADR-039](../../decisions/ADR-039.md) amendment 2: unauthenticated OTP addressed to a number nobody has proven yet |
| `title` | text | not null | |
| `template_code` | text | not null | |
| `template_version` | integer | not null default 1, check > 0 | |
| `default_channels` | text[] | not null default `'{in_app}'` | |
| `mutable` | boolean | **generated always as** `class IN ('account_state','marketing')` **stored** | **`SD-M16-01`.** Generated, never written independently. As an ordinary column a money notification could be marked mutable by a single careless insert and nothing would object |
| `rate_limit_exempt` | boolean | **generated always as** `class IN ('security','money')` **stored** | **`SD-M16-07`.** `INV-M16-11`'s exemption, made unforgeable on `mutable`'s pattern. As an ordinary boolean, one seed row marking the registration-OTP kind exempt would restore SMS pumping and nothing would object |
| `coalesce_key_spec` | text | null | how to collapse a burst into one message. Null means never coalesce, which is correct for security and money: three payout events are three facts |
| `created_at`, `updated_at` | timestamptz | not null default now() | |

Indexes: `notification_kinds_class_idx (class)`; `notification_kinds_rate_limit_exempt_idx (rate_limit_exempt)`.
Constraints: `notification_kinds_class_allowed`; `notification_kinds_immutable_never_coalesced` (widened by `SD-M16-07` to cover the new class); `notification_kinds_has_channels`.
The class is the module's entire policy, and it belongs in data where it can be reviewed in one query rather than distributed across handlers. The generated `mutable` column is what stops the sort of drift that produces a silenceable money notification eighteen months from now.

**`INV-M16-11` is confirmed and not amended, in those words.** It exempts the security and money classes from rate limiting and it stays exactly as written. What `SD-M16-07` changes is that a **fifth class exists which is not either of them**, so the exemption no longer reaches the pre-identity surface by default. `rate_limit_exempt` is generated, so `pre_identity_auth` is **non-exempt by construction**.

**The existing `mutable` column already gives the right answer for the new class without being touched**: `pre_identity_auth` is not in `('account_state','marketing')`, so it is not silenceable, which is correct. Nobody may opt out of the OTP that proves they own the number they are registering. That is what a generated column buys, and it is worth naming.

**An OTP is never coalesced.** Three OTP requests are three codes, and collapsing a burst of them into one message delivers one code for three challenges, which is a broken login rather than a tidy inbox. `notification_kinds_immutable_never_coalesced` is dropped and re-added to cover `pre_identity_auth` rather than joined by a second constraint, so there stays exactly one place that answers this question.

**[`notifications`](notifications.md)`.class` is deliberately not widened, and the reason is structural rather than an omission.** `notifications.identity_id` is not null, so a pre-identity message **cannot be a `notifications` row at all**: there is no identity yet, which is what "pre-identity" means. The kind exists here as **policy**, read by the SMS sender to decide whether to consult [`otp_send_budget`](otp_send_budget.md); the delivery record is [`otp_challenges`](otp_challenges.md) plus an [`integration_dispatches`](integration_dispatches.md) row. A later session "completing the pair" would be adding a value no row can ever legally carry.
