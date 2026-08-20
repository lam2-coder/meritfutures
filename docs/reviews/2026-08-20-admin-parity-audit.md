# Admin capability parity audit, 2026-08-20

**A review verdict under [ADR-033](../decisions/ADR-033.md), not a plan and not a ruling.**
This file is a review record. It sits deliberately outside the corpus
([`gates.mjs:167`](../../scripts/corpus/gates.mjs) excludes `docs/reviews/` from
`isCorpusDocument`), so it carries no frontmatter, appears in no INDEX, and binds
nothing by existing. **It writes no module plan, no ADR and no migration.** What it
produces is the gap list that [`ADR-069`](../plans/FOLD-04-impersonation-and-admin-parity.md)
is the ruling on, and which cannot be drafted before this table exists.

**Session `I1` of [FOLD-04](../plans/FOLD-04-impersonation-and-admin-parity.md).**
[FOLD-04:99](../plans/FOLD-04-impersonation-and-admin-parity.md) states the dependency
in its own words: *"`ADR-069` cannot be written before the matrix is built, because its
content is the gap list."*

---

## 0. The count, stated first so the rest can be audited against it

| | |
|---|---|
| **N, trader-side mutating actions enumerated** | **34** |
| **M, with an existing `owner`-role admin equivalent** | **2** |
| **K, gaps** (no admin equivalent, replicable in principle) | **18** |
| **J, proposed narrow exceptions** (capabilities that genuinely cannot be replicated admin-side) | **2**, covering **4** rows |
| **Rows classed NOT-PARITY** (an admin equivalent would be a different and worse capability) | **10** |

`34 = 2 + 18 + 4 + 10`. Every row below carries its enumeration source at `file:line`
so the next reader checks the route rather than the answer.

**The headline, and it is blunt.** The admin surface as it stands contains **zero**
endpoints that perform a trader action on a trader's behalf. Every admin mutation in
the corpus is enforcement (`freeze`, `unfreeze`, `close`, `flags/:id/status`,
`sanctions/:id/review`, `certificates/:id/revoke`, `offers/:id/revoke`), correction
(`wallet/:identityId/correct`, `loyalty/recompute`), configuration
(`plans/:planId/versions`, `plans/versions/:versionId/publish`, `price-floors`,
`wallet/:identityId/spend-limit`), conferral (`accounts/:accountId/graduation-benefit`,
`dedupe-matches/:id/disposition`) or annotation (`accounts/:accountId/note`). **None of
them is the trader's own act performed by an admin.** The two rows counted as `M` below
are actions that were never trader routes in the first place.

---

## 1. The rationale, restated because it is the whole argument

**Actions taken through impersonation are attributed to the trader.**
[FOLD-04:85](../plans/FOLD-04-impersonation-and-admin-parity.md) puts it exactly:
*"That corrupts the audit trail, and it weakens an evidence pack precisely where an
evidence pack is worth most: a dispute, or a chargeback representment where Merit must
show who did what. An admin-attributed action preserves provenance; an impersonated one
destroys it."*

**So parity is not a nicety that makes read-only tolerable. It is the thing that makes
read-only correct.** A read-only impersonation session is defensible only if the work a
support agent needs to do can be done from the admin surface, attributed to the admin,
with a mandatory reason. Where it cannot, read-only is not a principled boundary but a
missing feature wearing one, and the pressure to widen it will arrive from a real
support case rather than from a design argument.

**The audit surface for the attribution claim already exists.** Every mutating admin
endpoint writes an `admin_actions` row with actor, reason, before and after, and
requires a non-empty `reason`
([API_CONTRACT.md:516](../architecture/API_CONTRACT.md)). That is the machinery an
admin-attributed action would inherit, and it is the machinery an impersonated action
bypasses by construction, because the actor recorded is the trader.

**A precedent already in the corpus, pointing the same way.**
[EC-086:3](../edge-cases/EC-086.md) rules on the Chatwoot support sidebar that
*"Support cannot mutate identity, destination, or KYC state at all, as a code-level
absence rather than a permission setting."* Merit has already decided once that a
support surface's write capability is an absence rather than a setting. This audit is
the enumeration of what that absence costs.

---

## 2. One correction carried into this audit

**`D5` is the matrix, not a test identifier.**
[API_CONTRACT.md:658](../architecture/API_CONTRACT.md) heads section 12
*"Negative-authz test matrix (D5, required in CI)"*, and
[M06:329](../plans/M06-admin-ops-console.md) reads
*"RBAC and negative authz across all three roles | `M6-N-nn` | one per mutating route
per role, enumerated from the router"*. Negative-authz tests are **`M6-N-nn` entries in
the D5 matrix**. Any document saying *"a D5 test"* is wrong. This audit names no test
identifiers, because reserving `M6-N-nn` numbers is `I2`'s and `I4`'s work.

---

## 3. Scope and method

**Enumerated from the router surface as the corpus records it**, meaning
[API_CONTRACT.md](../architecture/API_CONTRACT.md) sections 3 through 7 plus the
surface tables of the module plans that own routes the contract does not carry. Not
from memory.

**A trader-side mutating action** is any non-public, non-webhook, non-`/internal/`
route that changes state and is reachable by a trader or affiliate session, plus any
state-changing act the corpus commits to that has no route at all. Reads are out of
scope. Webhooks are provider-to-Merit and are out of scope. `/internal/*` is
`admin_sso` already ([API_CONTRACT.md:671](../architecture/API_CONTRACT.md)).

**Parity is an `owner`-role question.** The role set is closed:
[API_CONTRACT.md:516](../architecture/API_CONTRACT.md) reads *"Roles: `owner` (all),
`ops` (read plus account actions, no config or role changes), `readonly`."* Where a row
notes that `ops` would also plausibly need the capability, that is an observation for
`ADR-069` and not a proposal.

**One row per corpus surface-table line**, so the count is reproducible by anyone
re-running the same enumeration. Where a single line names two verbs
(`POST /me/contact-channels` and `DELETE`, `accept` and `/decline`), it stays one row
and the note says so.

**Four classes, and the fourth is the one that keeps this audit honest:**

| Class | Meaning |
|---|---|
| **E** | An `owner`-role admin equivalent exists today |
| **GAP** | No admin equivalent. The capability is replicable admin-side in principle. **The gap is named, the fix is not proposed** |
| **OQ** | The capability genuinely may not be replicable admin-side. Recorded as an open question carrying a **narrow** exception proposal |
| **NOT-PARITY** | An admin equivalent would be a **different and worse act** than the trader's, usually credential forgery or evidence corruption. Recorded with its reason, and **put to the founder for confirmation rather than ruled here** |

---

## 4. The matrix

### 4.1 Authentication and session, rows 1 to 7

| # | Trader route | Source | `owner` admin equivalent | Class | What is missing, or why not |
|---|---|---|---|---|---|
| 1 | `POST /auth/otp` | [API_CONTRACT.md:80](../architecture/API_CONTRACT.md) | none | **NOT-PARITY** | An admin issuing a trader's OTP is not the trader's act performed by an admin. It is the manufacture of a login factor for an account the admin does not hold. **An admin equivalent here would be strictly worse than impersonation**, because it produces a session indistinguishable from the trader's own with no impersonation record attached at all |
| 2 | `POST /auth/verify` | [API_CONTRACT.md:104](../architecture/API_CONTRACT.md) | none | **NOT-PARITY** | Same as row 1. Consuming the challenge is the credential-establishing half |
| 3 | `POST /auth/elevate` | [API_CONTRACT.md:116](../architecture/API_CONTRACT.md) | none | **NOT-PARITY** | Elevation is `passkey or dual_channel` ([API_CONTRACT.md:670](../architecture/API_CONTRACT.md), C-27 at [SECURITY.md:45](../architecture/SECURITY.md)). An admin cannot hold either on the trader's behalf, and a path that let one be asserted admin-side would delete C-27 |
| 4 | `POST /auth/passkey/register/options`, `/verify` | [API_CONTRACT.md:127](../architecture/API_CONTRACT.md) | none | **NOT-PARITY** | Registering a credential on a trader's identity is credential forgery under any attribution |
| 5 | `POST /auth/passkey/login/options`, `/verify` | [API_CONTRACT.md:128](../architecture/API_CONTRACT.md) | none | **NOT-PARITY** | Same as row 4 |
| 6 | `POST /auth/logout` | [API_CONTRACT.md:136](../architecture/API_CONTRACT.md) | none | **NOT-PARITY** | Ending one's own session is not a support act. The support-shaped version of it is row 7 and is classed differently on purpose |
| 7 | `POST /sessions/:id/revoke` | [API_CONTRACT.md:215](../architecture/API_CONTRACT.md) | none | **GAP** | **Missing: an admin-attributed revoke of a trader's sessions.** This is a real and predictable support case (*"I think my account is compromised"*), the surface exists trader-side precisely because [API_CONTRACT.md:696](../architecture/API_CONTRACT.md) rules *"a session you cannot see is one you cannot revoke"*, and there is no `/admin/` counterpart to any of it. **A compromised trader who cannot reach their own portal has no path to revocation at all.** Note for `ADR-069`: the trader route is C-27 tagged (`contact change`, [API_CONTRACT.md:693](../architecture/API_CONTRACT.md)), so an admin route would assert under `admin_sso` what the trader asserts under `passkey or dual_channel`. See section 6 |

### 4.2 Contact and identity, rows 8 to 11

| # | Trader route | Source | `owner` admin equivalent | Class | What is missing, or why not |
|---|---|---|---|---|---|
| 8 | `POST /phone/verify` | [API_CONTRACT.md:180](../architecture/API_CONTRACT.md) | none | **NOT-PARITY** | Completes an OTP challenge and writes the `identity_phones` row plus the ADR-022 graph edge. **The whole value of the row is that the holder of the handset produced the code.** An admin-completed verification writes a hard-link edge asserting a possession nobody demonstrated, which corrupts [M07](../plans/M07-risk-abuse.md)'s graph rather than the audit trail |
| 9 | `POST /phone/change` | [API_CONTRACT.md:196](../architecture/API_CONTRACT.md) | none | **GAP** | **Missing: an admin-attributed open of the D4 phone-change ceremony.** The trader route requires an elevated session, and a trader who has lost the number is exactly the person who cannot elevate. Today there is no admin path and no documented manual path. Note: the ceremony sets `withdrawal_hold_until`, a 48 hour external-withdrawal hold read by the payout and wallet paths ([API_CONTRACT.md:213](../architecture/API_CONTRACT.md)), so an admin route inherits a money-path side effect |
| 10 | `POST /phone/change/:id/cancel` | [API_CONTRACT.md:196](../architecture/API_CONTRACT.md) | none | **GAP** | **Missing: an admin-attributed cancel.** The cancel is the abuse-response half of the ceremony: it is what a trader does when a change they did not start is running against their number. A support agent who is told about it on the phone cannot stop it |
| 11 | `POST /me/contact-channels` and `DELETE` | [M16:196](../plans/M16-notification-center.md) | none | **GAP** | **Missing: an admin-attributed add or removal of a contact channel.** Section 3.2's ceremony is trader-only. `GET /admin/notifications/:identityId` ([M16:197](../plans/M16-notification-center.md)) lets an admin see what was sent to which channel and is read-only, so the console can prove a notice went to a dead address and can do nothing about it |

### 4.3 Commerce, rows 12 to 15

| # | Trader route | Source | `owner` admin equivalent | Class | What is missing, or why not |
|---|---|---|---|---|---|
| 12 | `POST /checkout` | [API_CONTRACT.md:267](../architecture/API_CONTRACT.md) | none | **GAP** | **Missing: an admin-attributed purchase.** No `/admin/` route creates a purchase or an account. Every admin plan route ([API_CONTRACT.md:602](../architecture/API_CONTRACT.md), [:611](../architecture/API_CONTRACT.md)) configures the catalogue and none of them buys from it. **This row carries a dependent OQ**: the request requires `accept_tos_version_ids` ([API_CONTRACT.md:274](../architecture/API_CONTRACT.md)), which is row 32 |
| 13 | `POST /checkout` with `payment_method = wallet` | [M20:208](../plans/M20-wallet.md) | none | **GAP** | **Missing: an admin-attributed wallet spend.** Counted separately from row 12 because M20 supplies a distinct authorization path (section 3.2) and a distinct refusal surface. `POST /admin/wallet/:identityId/correct` ([M20:210](../plans/M20-wallet.md)) is compensating entries only, explicitly *"no update path and no delete path"*, and `POST /admin/wallet/:identityId/spend-limit` ([M20:211](../plans/M20-wallet.md)) sets a ceiling. **Neither spends** |
| 14 | `POST /accounts/:accountId/reset` | [API_CONTRACT.md:290](../architecture/API_CONTRACT.md) | none | **GAP** | **Missing: an admin-attributed reset.** Same shape as row 12 and the same dependent OQ, since `ResetRequest` also carries `accept_tos_version_ids` ([API_CONTRACT.md:293](../architecture/API_CONTRACT.md)). Note: reset velocity is a risk signal ([API_CONTRACT.md:296](../architecture/API_CONTRACT.md)), so an admin-originated reset needs to be distinguishable from a trader-originated one in that signal or it poisons it |
| 15 | `POST /offers/redeem` | [M14:217](../plans/M14-loyalty-retention.md) | none | **GAP** | **Missing: an admin-attributed redemption.** `POST /admin/offers/:id/revoke` ([M17:149](../plans/M17-offers-engine.md)) can take an offer away and nothing can apply one. **A second finding on this row, recorded because the enumeration surfaced it**: M14:217 names M17 as the owner of redemption, and [M17](../plans/M17-offers-engine.md)'s own surface table (lines 146 to 151) does not carry `POST /offers/redeem` at all. The route is cited by its consumer and absent from its owner |

### 4.4 Money out, rows 16 and 17

| # | Trader route | Source | `owner` admin equivalent | Class | What is missing, or why not |
|---|---|---|---|---|---|
| 16 | `POST /accounts/:accountId/payout` | [API_CONTRACT.md:409](../architecture/API_CONTRACT.md) | **partial, and it is not equivalence** | **GAP** | `POST /admin/payouts/:id/release` and `/enforce` ([M05:306](../plans/M05-payout-system.md)) resolve a request **the trader already made**, and `release` explicitly *"posts the stored decision unchanged and re-evaluates nothing"*. **Missing: origination.** No admin route creates a payout request. A trader locked out of the portal with an eligible account and a live cadence window cannot be paid, and the cadence clock does not pause for support latency |
| 17 | `POST /wallet/withdrawals` | [M05:307](../plans/M05-payout-system.md), [M20:207](../plans/M20-wallet.md) | none | **GAP** | **Missing: an admin-attributed external withdrawal.** The trader route is C-27 tagged (`external withdrawal`, [API_CONTRACT.md:694](../architecture/API_CONTRACT.md)) and carries KYC-verified, destination cooling window, name-match score, $100 minimum and G-NO-IN-FLIGHT. **This is the highest-consequence gap in the matrix and the one most likely to generate pressure to widen impersonation**, since it is money leaving the firm on a route only the trader can fire |

### 4.5 KYC, rows 18 and 19

| # | Trader route | Source | `owner` admin equivalent | Class | What is missing, or why not |
|---|---|---|---|---|---|
| 18 | `POST /kyc/session` | [API_CONTRACT.md:484](../architecture/API_CONTRACT.md), [M19:220](../plans/M19-kyc-identity.md) | none | **OQ, see OQ-P-02** | Returns the provider's hosted URL, and *"Merit never proxies documents"* (INV-M19-07, [M19:220](../plans/M19-kyc-identity.md)). **The identity assertion is made to the provider, not to Merit**, so an admin-side equivalent is a vendor question before it is a policy one. The admin KYC surface is read (`GET /admin/identities/:identityId/kyc`, [M19:224](../plans/M19-kyc-identity.md)) plus adjudication (`POST /admin/dedupe-matches/:id/disposition` [M19:225](../plans/M19-kyc-identity.md), `POST /admin/sanctions/:id/review` [M19:226](../plans/M19-kyc-identity.md)). **Nothing initiates** |
| 19 | `POST /kyc/reverify` | [M19:223](../plans/M19-kyc-identity.md) | none | **OQ, see OQ-P-02** | *"Creates a new verification with a `verification_purpose`"*. Same question as row 18, and it is the re-submission leg [FOLD-04:93](../plans/FOLD-04-impersonation-and-admin-parity.md) names explicitly. **Recorded separately because the answers may differ**: initiating a first assertion and re-running an assertion the subject already made are not obviously the same act |

### 4.6 Affiliate, rows 20 and 21

| # | Trader route | Source | `owner` admin equivalent | Class | What is missing, or why not |
|---|---|---|---|---|---|
| 20 | `POST /affiliate/links` | [API_CONTRACT.md:508](../architecture/API_CONTRACT.md), [M08:159](../plans/M08-affiliate-system.md) | none | **GAP** | **Missing: an admin-attributed link issue.** `GET /admin/flags` ([M08:162](../plans/M08-affiliate-system.md)) supplies `affiliate_self_deal` flags and is the only admin touchpoint on the affiliate surface. **There is no admin affiliate console at all**, which is a wider observation than this row |
| 21 | `POST /affiliate/creatives` | [M08:160](../plans/M08-affiliate-system.md) | none | **GAP** | **Missing: both halves.** No admin route submits a creative, and, separately, **no admin route approves one**. M08:160 says creatives are *"submitted for approval"* and names no approver endpoint anywhere in the corpus. Recorded here because the parity enumeration is what surfaced it, and it is a gap in the admin surface with or without `ADR-069` |

### 4.7 Preferences and presence, rows 22 to 27

| # | Trader route | Source | `owner` admin equivalent | Class | What is missing, or why not |
|---|---|---|---|---|---|
| 22 | `PATCH /me/notification-preferences` | [M16:195](../plans/M16-notification-center.md) | none | **GAP** | **Missing: an admin-attributed preference change.** Note for `ADR-069`, and it cuts against closing this one casually: [M16:262](../plans/M16-notification-center.md) makes `notification.preferences_changed` followed by a destination change a high-severity risk pattern (EC-115, GS-193). **An admin-attributed preference change is indistinguishable from that pattern unless the actor is on the signal**, so closing this gap without touching the detector would create false positives on Merit's own support staff |
| 23 | `POST /notifications/:id/read` | [M16:193](../plans/M16-notification-center.md) | none | **NOT-PARITY** | `read_at` is the input to the proof-of-notice query (AS-M16-05, [M16:197](../plans/M16-notification-center.md)). **An admin marking a trader's notification read manufactures evidence that the trader saw it**, which is the audit-trail corruption this whole fold exists to prevent, arriving through the parity door rather than the impersonation one. INV-M16-09 already calls the endpoint *"explicitly a convenience"* |
| 24 | `POST /me/discord/link` | [M15:151](../plans/M15-discord-integration.md) | none | **NOT-PARITY** | *"Issues the nonce. Session scoped, portal initiated only."* The confirming half happens on Discord under the trader's Discord identity ([M15:154](../plans/M15-discord-integration.md)). **An admin cannot complete it, so this is impossible rather than forbidden** |
| 25 | `DELETE /me/discord/link` | [M15:152](../plans/M15-discord-integration.md) | none | **GAP** | **Missing: an admin-attributed unlink.** Unlinking is entirely Merit-side and *"removes every synced role in the next batch window"*. This is a live enforcement need: a restricted or closed identity keeps its synced Discord roles until the trader themself unlinks, and the console cannot reach it |
| 26 | `PATCH /me/discord/roles` | [M15:153](../plans/M15-discord-integration.md) | none | **GAP** | **Missing: an admin-attributed role opt-out.** Same shape as row 25, one granularity finer |
| 27 | `PATCH /me/leaderboard` | [M11:159](../plans/M11-certificates-social-proof.md) | none | **GAP** | **Missing: an admin-attributed opt-out.** *"Opt out takes effect on the next publish and removes historical entries (INV-M11-10)."* A trader asking support to take their name off a public page is a routine request and there is no route for it. `POST /admin/certificates/:id/revoke` ([M11:158](../plans/M11-certificates-social-proof.md)) reaches certificates and not the leaderboard |

### 4.8 Data and program, rows 28 to 31

| # | Trader route | Source | `owner` admin equivalent | Class | What is missing, or why not |
|---|---|---|---|---|---|
| 28 | `POST`, `PATCH /journal` | [M13:145](../plans/M13-trader-analytics-journal.md) | none | **NOT-PARITY** | The journal is the trader's private reflection. **An admin writing in it is not a support action under any attribution**, and [M13:351](../plans/M13-trader-analytics-journal.md) treats journal entries as belonging to the identity rather than to the account. Recorded rather than assumed, because *"an admin can do every trader action"* stated without exception would include this one |
| 29 | `DELETE /journal` | [M13:145](../plans/M13-trader-analytics-journal.md) | none | **GAP** | **Missing: an admin-attributed soft delete and purge.** Counted separately from row 28 because the delete leg *"soft deletes and schedules the purge"* and is therefore an erasure path. The privacy runbook (constitution section 6, cited at [M13:146](../plans/M13-trader-analytics-journal.md)) makes erasure an obligation Merit owes rather than a convenience the trader enjoys, **and an obligation with no operator route is an obligation Merit cannot discharge for a trader who cannot log in** |
| 30 | `POST /me/invitations/:id/accept` and `/decline` | [M18:195](../plans/M18-graduation-track.md) | none | **OQ, see OQ-P-01** | *"Records `terms_version`."* **This is a terms acceptance wearing a program-invitation shape**, and it belongs to the contract-signature question rather than beside it. The `decline` leg may separate from the `accept` leg, since declining accepts nothing |
| 31 | `POST /me/review-requests/opt-out` | [M12:221](../plans/M12-transparency-platform.md) | none | **GAP** | **Missing: an admin-attributed opt-out.** *"Session scoped, permanent, honored across all triggers."* [M12:315](../plans/M12-transparency-platform.md) fires review requests on breach, refund, account closure and rejected KYC, which is precisely the population most likely to ask support to stop contacting them, and least likely to still be logging in |

### 4.9 The three named in FOLD-04 that are not routes, rows 32 to 34

| # | Trader action | Source | `owner` admin equivalent | Class | What is missing, or why not |
|---|---|---|---|---|---|
| 32 | **Contract signature**, that is `accept_tos_version_ids` | [API_CONTRACT.md:274](../architecture/API_CONTRACT.md) (checkout), [:293](../architecture/API_CONTRACT.md) (reset) | none | **OQ, see OQ-P-01** | **There is no signature route.** Acceptance is a required field on rows 12 and 14, recorded to append-only `tos_acceptances` with IP and timestamp (INV-M3-09, [M03:59](../plans/M03-billing-checkout.md)), and M03 calls it *"the first artifact any enforcement dispute asks for."* **So the contract-signature question is not separable from the purchase question**: rows 12 and 14 cannot be closed admin-side without answering this one, which makes OQ-P-01 a blocker on two GAP rows and not only on itself |
| 33 | **Account-closure request** | [API_CONTRACT.md:560](../architecture/API_CONTRACT.md), [:562](../architecture/API_CONTRACT.md) | **`POST /admin/accounts/:accountId/close`** | **E** | **No gap, and no trader route either.** `CloseRequest` carries `kind: "enforcement" \| "trader_request" \| "operational"`, so the corpus already models trader-requested closure as an **admin-executed, admin-attributed** action with a mandatory reason. **This row is the shape the other 18 gaps would take if they were closed**, and it is the existence proof that the pattern works |
| 34 | **Any plan-config-affecting action** | [API_CONTRACT.md:602](../architecture/API_CONTRACT.md), [:611](../architecture/API_CONTRACT.md) | **`POST /admin/plans/:planId/versions`, `POST /admin/plans/versions/:versionId/publish`** | **E** | **No gap, and no trader route by construction.** Plan config is `owner`-only and dual-controlled on cap, split and cadence gap per D4 and [ADR-010](../decisions/ADR-010.md). A trader's only influence on config is choosing which published version to buy, which is row 12. **Noted for completeness because [FOLD-04:93](../plans/FOLD-04-impersonation-and-admin-parity.md) names it, and the honest answer is that it was never a parity question** |

---

## 5. The gap list, which is `ADR-069`'s content

**18 gaps, grouped by what an operator would call them.** No fix is proposed for any of
them. The grouping is offered because `ADR-069` will need one and this is the ordering
the enumeration produced, not a recommendation about sequence.

| Group | Rows | The capability the console does not have |
|---|---|---|
| **Account recovery** | 7, 9, 10, 11 | Revoke a compromised trader's sessions; open or cancel the phone-change ceremony; add or remove a contact channel. **A trader who cannot log in cannot be helped back in** |
| **Money out** | 16, 17 | Originate a payout request; originate an external withdrawal. Release and enforce exist; origination does not |
| **Commerce** | 12, 13, 14, 15 | Purchase, wallet spend, reset, offer redemption. All four are blocked behind OQ-P-01 as well as being gaps in their own right |
| **Presence and contact** | 22, 25, 26, 27, 31 | Notification preferences, Discord unlink and roles, leaderboard opt-out, review-request opt-out. **Every one of these is a "please stop" a trader makes to support and support cannot execute** |
| **Erasure** | 29 | Journal soft delete and purge, which is a privacy-runbook obligation with no operator route |
| **Affiliate** | 20, 21 | Link issue, creative submit. And, separately surfaced, **creative approval has no route on either side** |

---

## 6. One structural finding that applies across the gap list

**Nine of the trader routes in this matrix are C-27 sensitive actions requiring
`passkey or dual_channel`** ([SECURITY.md:45](../architecture/SECURITY.md),
[API_CONTRACT.md:670](../architecture/API_CONTRACT.md)). The admin surface authenticates
under a different token entirely: `admin_sso`, *"hardware-key SSO under C-08, which has
no SMS path, ever"* ([API_CONTRACT.md:671](../architecture/API_CONTRACT.md)).

**So closing any C-27-tagged gap admin-side is a substitution of factor, not a
replication of it.** The trader route asserts *"the human holding this account proved
possession on a second channel."* The admin route would assert *"an operator holding a
hardware key asserts that the human asked."* Those are different claims with different
evidentiary weight, and the second one is the claim an evidence pack would carry into a
dispute.

**This is stated as a finding and not as an objection.** It may well be the right trade,
and it is plainly better than the impersonated version, where the claim recorded is
*"the trader did it"* and is simply false. But `ADR-069` should say which claim each
admin-attributed action makes, because a reviewer reading `admin_actions` two years
later will otherwise have to reconstruct it. **The dual-timeline audit
[FOLD-04:95](../plans/FOLD-04-impersonation-and-admin-parity.md) specifies is where
this belongs**: the trader's timeline entry is the one that needs to say an operator
acted and on what basis.

---

## 7. Open questions, each carrying a NARROW exception proposal

**Neither exception is pre-approved and blanket write access is not proposed.**
[FOLD-04:101](../plans/FOLD-04-impersonation-and-admin-parity.md): *"A capability
nobody has enumerated is not a capability anybody can scope."* The enumeration is now
done, so these two are scoped, and scoped is not approved.

### OQ-P-01. Contract and terms acceptance. Rows 30 and 32, blocking rows 12, 13, 14

**The question.** Can an `owner` admin record acceptance of a ToS version on a trader's
behalf, or is acceptance legally personal? [FOLD-04:139](../plans/FOLD-04-impersonation-and-admin-parity.md)
asks it as `OQ-F4-01` and this audit adds two things it did not have.

**First, the scope is wider than "contract signature".** There is no signature route.
Acceptance is `accept_tos_version_ids` on checkout and reset
([API_CONTRACT.md:274](../architecture/API_CONTRACT.md), [:293](../architecture/API_CONTRACT.md)),
so **this question gates the entire commerce group.** Rows 12, 13, 14 and 15 cannot be
closed admin-side while it is open, whatever is decided about the purchase itself.

**Second, `tos_acceptances` is append-only and revoked at the database role**
([DATA_MODEL:51](../architecture/data-model/README.md)), and INV-M3-09 makes it
*"the first artifact any enforcement dispute asks for"* ([M03:59](../plans/M03-billing-checkout.md)).
**An admin-recorded acceptance is therefore permanent and is the row Merit produces in a
dispute.** If it can be admin-recorded, the table needs to say which rows were, or the
artifact loses the property that makes it worth producing.

**Proposed narrow exception, if and only if acceptance is ruled personal:**

| | |
|---|---|
| **Who** | `owner` role only. Not `ops`, which [API_CONTRACT.md:516](../architecture/API_CONTRACT.md) already bounds to *"read plus account actions, no config or role changes"* |
| **What** | **Write-enabled impersonation scoped to the acceptance step alone**, not to checkout as a whole and not to the session as a whole |
| **Audit** | Elevated: the impersonation record, the `admin_actions` row, **and** a marker on the `tos_acceptances` row itself, because that is the row a dispute reads and an unmarked row is a false claim about who accepted |
| **Control** | Dual control, on the [ADR-010](../decisions/ADR-010.md) footing |
| **Not proposed** | Any write capability beyond the acceptance step, and any use of it outside a trader request the support record can show |

**The alternative that avoids the exception entirely, recorded so the founder is
choosing between two things rather than approving one**: an admin-attributed purchase
that records **no** acceptance, leaving the account unusable until the trader accepts on
first login. That is a product decision more than a legal one, and it is outside this
audit's fence to choose.

### OQ-P-02. KYC assertion. Rows 18 and 19

**The question.** Can an `owner` admin initiate or re-initiate a KYC verification on a
trader's behalf? [FOLD-04:140](../plans/FOLD-04-impersonation-and-admin-parity.md) asks
it as `OQ-F4-02` and correctly calls it *"a vendor question as much as a policy one."*

**What this audit adds.** *"Merit never proxies documents"* (INV-M19-07,
[M19:220](../plans/M19-kyc-identity.md)), and `POST /kyc/session` returns a **hosted
URL**. So the act being replicated is narrower than it first looks: **an admin would be
creating a provider session, not making an identity assertion.** The assertion is still
made by whoever appears in the provider's hosted flow. That may make an admin-initiated
session harmless and it may make it worthless, and **which one it is depends on the
provider's answer, not Merit's**, which is why this stays open.

**Rows 18 and 19 are recorded separately and may rule differently.** Re-verification
([M19:223](../plans/M19-kyc-identity.md)) creates a new verification with a
`verification_purpose`, and a purpose an operator sets is different from a purpose a
trader sets.

**Proposed narrow exception, if and only if provider policy permits it:**

| | |
|---|---|
| **Who** | `owner` role only |
| **What** | **Session creation and dispatch of the hosted URL to the trader's verified contact channel.** Not submission, which Merit cannot perform in any case |
| **Audit** | Elevated: `admin_actions` plus a `kyc_funnel_events` entry marking operator origination, so [M19:227](../plans/M19-kyc-identity.md)'s funnel telemetry does not silently count operator-initiated sessions as trader-initiated ones |
| **Control** | Dual control **not** proposed here, on the reasoning [M05:305](../plans/M05-payout-system.md) uses for freeze: the act is reversible and creates no obligation. Stated so the asymmetry with OQ-P-01 is deliberate rather than an oversight |
| **Not proposed** | Anything touching `POST /admin/sanctions/:id/review` or `POST /admin/dedupe-matches/:id/disposition`, which are adjudication and already exist with their own controls |
| **Prerequisite** | **A vendor answer, in writing, before the ADR rules.** [M02](../plans/M02-rithmic-bridge.md) holds at `review` for exactly this reason under [ADR-005](../decisions/ADR-005.md), and this is the same shape |

---

## 8. Three observations for `ADR-069` that are not gaps

Recorded because the enumeration produced them and dropping them would waste the pass.

1. **`POST /offers/redeem` is cited by its consumer and absent from its owner.**
   [M14:217](../plans/M14-loyalty-retention.md) names M17 as owning redemption;
   [M17](../plans/M17-offers-engine.md)'s surface table, lines 146 to 151, does not
   carry the route. Row 15.
2. **Affiliate creative approval has no route anywhere.**
   [M08:160](../plans/M08-affiliate-system.md) says creatives are submitted *"for
   approval"* and no endpoint approves them, on either surface. Row 21.
3. **The `ops` role's boundary will be tested by whatever `ADR-069` adds.**
   [API_CONTRACT.md:516](../architecture/API_CONTRACT.md) gives `ops` *"read plus
   account actions."* Most of section 5's account-recovery group reads naturally as
   account actions, and most of the money-out group does not. **The audit does not
   propose where the line falls**; it records that 18 new mutating routes would each
   need placing on it, and that [M06:329](../plans/M06-admin-ops-console.md) requires
   *"one per mutating route per role"* in the D5 matrix, so the placement decision has a
   test count attached to it.

---

## 9. What this audit did not do

- **No module plan.** [M06](../plans/M06-admin-ops-console.md) is frozen and its matrix
  needs `ADR-069`, whose content is section 5 above.
- **No ADR.** `ADR-069` is session `I4`.
- **No migration.** `0043` remains contingent per
  [FOLD-04:28](../plans/FOLD-04-impersonation-and-admin-parity.md), and this audit does
  not spend or release it.
- **No test identifiers reserved.** No `M6-N-nn`, no `GS-3nn`.
- **`CI06U_REGISTER` untouched.**
- **No fix proposed for any gap**, per the fence. Sections 5 and 6 name what is missing
  and section 7 scopes the two exceptions, which is the narrowest form the definition of
  done permits.
