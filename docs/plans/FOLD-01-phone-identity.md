---
status: approved
depends_on: [../decisions/README.md, ../architecture/SECURITY.md, ../architecture/DATA_MODEL.md, ../legal/PRIVACY_POLICY.md, ../legal/COUNSEL_PACKET.md, ../testing/STRATEGY.md, M03-billing-checkout.md, M04-trader-portal.md, M07-risk-abuse.md, M10-integrations.md, M16-notification-center.md, M19-kyc-identity.md, ../../packages/db/DELTA_MANIFEST.md]
last_updated: 2026-08-15
---

# FOLD-01: passwordless auth and phone as identity

**A fold plan, not a module plan.** The `FOLD-nn` series exists because a founder ruling that touches nine documents and the first post-merge migration is too large to fold from a prompt and too small to be a module. It is approved before the fold begins and it is what the fold is scored against.

**The ruling itself becomes an ADR during the fold.** Its number is claimed in [DECISIONS](../decisions/README.md)'s allocation table before it is written, per [ADR-034](../decisions/ADR-034.md) and [ADR-036](../decisions/ADR-036.md), and this plan deliberately does not bake a number into a filename it cannot rename later.

---

## 1. The ruling, and the four amendments folded with it

Auth is passkeys plus email OTP plus SMS OTP, any single factor sufficient for login. **No passwords are retained, credential-stuffing immunity is preserved, and that immunity is the reason.**

**Phone verification is mandatory at registration and is a first-class identity signal rather than a contact field.** Emails are free to mint and real mobile numbers are scarce, so phone is a high-weight node in [ADR-022](../decisions/ADR-022.md)'s link-confidence graph.

| Point | Ruling |
|---|---|
| **(a)** | Carrier and line-type lookup at capture: VoIP and burner detection, portability history, digital-footprint presence. **VoIP is scored, never rejected.** VoIP plus a fresh email plus a datacenter IP plus no footprint is recorded as the **fleet signature** |
| **(b)** | **One verified phone per identity**, enforced as a hard graph link |
| **(c)** | Phone change carries D4 controls: dual-channel verification, notification to the prior number **and** email, and a 48 hour external-withdrawal hold |
| **(d)** | Sensitive actions (payout destination change, contact change, external withdrawal) require a passkey or dual channel. **Never SMS alone.** SIM-swap defense, and it is the reason |
| **(e)** | SMS delivery is security-critical per [M16](M16-notification-center.md). Cost and deliverability enter [M03](M03-billing-checkout.md)'s Cost Stack |

**The four amendments.**

1. **(e) is a confirmation rather than an amendment.** `INV-M16-11` already exempts the security and money classes. It is recorded as **confirmed**, in those words.
2. **But the class splits.** `INV-M16-11` was written for **post-identity** messages. Registration OTP is **pre-identity**, unauthenticated, and addressed to an attacker-supplied number. Rate-limit-exempt SMS there is **SMS pumping**: the attacker owns premium-rate numbers, drives volume, takes the carrier share, and Merit pays. Pre-identity OTP keeps per-number, per-IP and per-country velocity plus a **cost circuit breaker**. Post-identity security messages keep `INV-M16-11` unchanged. Two classes.
3. **(b)'s hard link needs the recycling guard the ruling already pays for.** Carriers reassign numbers. A banned identity's number, reassigned later, would auto-link an innocent owner with no review, because no review is what a hard link means. **Portability history, already bought by (a), is wired to the decision:** reassignment after the linked identity's ban date means it is not the same node.
4. **The session and authority boundary becomes an invariant.** Any single factor logs in, and (d) means a SIM-swapped session can **see everything and change nothing**. That is the design and it is written down rather than left as an emergent property of two rules.

---

## 2. What the primary sources say, checked rather than recalled

Five readings changed this plan. Each is a live contradiction or a gap, not a nuance.

| # | Finding | Source | Consequence |
|---|---|---|---|
| **1** | **[SECURITY section 2.7](../architecture/SECURITY.md) says "no SMS-based second factor anywhere in the stack"** | `SECURITY.md:122` | The ruling adds SMS OTP for traders. A direct textual contradiction, resolved explicitly in the ADR rather than glossed. **Section 2.7 sits under "The founder (the human asset)" and is rescoped to founder and admin credentials.** Admin auth stays hardware-key SSO (C-08) with no SMS path, ever |
| **2** | **C-01 reads "Passwordless only: passkeys plus email OTP"** | `SECURITY.md:19` | C-01 widens to three factors. **The stuffing-immunity claim in section 2.6 is unchanged and is the reason**, and the ADR says so in those words so a later reader cannot mistake a widening for a weakening |
| **3** | **[ADR-023](../decisions/ADR-023.md)'s vendor already buys phone footprint**: "email and **phone** digital-footprint... device, IP, VPN and datacenter detection" | `DECISIONS.md:483`, restated at `M03:311` and [M07](M07-risk-abuse.md) D-15 | Decision 1 below resolves on this evidence rather than on preference |
| **4** | **`contact_channels.kind check in ('email','push')`**, and its live-uniqueness index is per `(identity_id, kind)` | [DATA_MODEL](../architecture/DATA_MODEL.md), `0019` | **The `INV-M16-03` prior-contact countermeasure cannot notify a prior number today.** (c) is unbuildable until `sms` joins that check |
| **5** | **`OI-06`. There is no `payout_destinations` table anywhere in the merged 96 tables.** `destination_ref` is a column on `payout_transfers` (`0010:243`) and `wallet_withdrawals` (`0011:132`), the destination **of a transfer** | grep of `packages/db/migrations` | **C-11, C-24, [SECURITY section 4](../architecture/SECURITY.md) item 1, [M20](M20-wallet.md) `WF-M20-02` and [M04](M04-trader-portal.md)'s destination-cooling scenario all require "destination outside its 48 hour cooling window", and nothing in the schema can answer when a destination changed.** Found by trying to model (c) on the control (c) says to copy. See section 8 |

---

## 3. The two decisions this plan takes rather than defers

### 3.1 The registration lookup is [ADR-023](../decisions/ADR-023.md)'s existing vendor, scope widened. No second sub-processor.

ADR-023 already purchases phone digital-footprint, VPN and datacenter detection, and device and IP reputation from a SEON-class vendor. **Three of (a)'s four signals sit inside that purchased scope; only portability history is a genuinely separable product.** [M19](M19-kyc-identity.md) OQ-M19-04's corpus-splitting argument and ADR-022's identity-replacement-cost framing both cut against buying a second vendor for one signal class.

**Two conditions, and the first is load bearing.**

1. **Portability history becomes a disqualifying selection criterion in ADR-023's procurement**, recorded as a new condition of acceptance. **Amendment 3's recycling guard has no input without it**, and that guard is what makes (b)'s hard link safe to bind automatically. A vendor that cannot supply portability history cannot be selected.
2. **The call site is new even though the vendor is not.** Registration is not checkout: a new moment, and a new field crossing the boundary, since the phone number never left Merit before. It therefore takes **its own `integration_contracts` row** under [M10](M10-integrations.md)'s `SD-M10-01` field allowlist (`INV-M10-02`, `INV-M10-04`), its own `identity_signals.kind`, and checkout's failure posture inherited verbatim: **non-blocking, fail-open on timeout, VoIP scored and never rejected.**

**And SMS delivery is an M10 integration, which is new and not optional.** [M16 section 1.3](M16-notification-center.md) assigns "delivering to a vendor" to M10, and M10's list is five integrations with no SMS sender. A sixth is added.

### 3.2 Carrier metadata joins counsel packet item 3.

The privacy policy is the output; **the lawful basis is the question.** [COUNSEL_PACKET](../legal/COUNSEL_PACKET.md) item 3 gains **3d, telecom metadata lawful basis**, asking for the basis for carrier, line-type and portability lookup on a number supplied for authentication, the legitimate-interest balancing test, whether the EU ePrivacy angle changes it, and **whether portability history is a heightened category anywhere**, given that it reveals when a person changed carrier. The [privacy policy](../legal/PRIVACY_POLICY.md) gains its collection-category row in the same fold, and that row **cites 3d rather than asserting a basis**.

### 3.3 The hard link binds the graph and never enforces alone (founder ruling at plan approval)

(b) says "auto-enforced like KYC face-dedupe", and the corpus holds two readings of that phrase: `INV-M19-04` says a dedupe hit **raises a flag against both identities and changes no state**, while ADR-022 says hard links **auto-enforce**. [DELTA_MANIFEST](../../packages/db/DELTA_MANIFEST.md) already recorded the tension. Ruled:

| Direction | Behavior |
|---|---|
| **identity to phone** (uncontested) | **One live verified phone per identity**, a partial unique index on `identity_id`. A genuine database constraint |
| **phone to identity** (the contested half) | A second identity verifying a number already live on another **completes verification**. The edge is written at the hard-link confidence ceiling and a **severity-5 flag opens against both identities**. No state changes automatically |

**The reason is amendment 3.** Refusing at the door puts the innocent owner of a recycled number into a support ticket before the portability check can rescue them. Binding the graph and queuing a human keeps them inside a review queue, which is where [AS-M19-05](M19-kyc-identity.md) already says this class of person belongs.

---

## 4. Migration `0029`, and the number is claimed before the file is written

`0029_phone_identity_and_auth.sql`, carrying an `E2 READ: MONEY PATH` header naming what in it needs the founder's line-by-line read and why. **The row in [DECISIONS](../decisions/README.md)'s migration allocation table, which today reads "Nothing is reserved and `0029` is the next free number", is written in the same commit that creates the file.**

**It supersedes and never edits.** Constitution E2.

**Nine changes. The delta identifiers are allocated in session 3, not here, and the reason is a finding in its own right.** This plan first named them inline and [ADR-026](../decisions/ADR-026.md)'s completeness gate refused all ten, correctly: **only ADR numbers and migration numbers have an allocation table.** A delta identifier is claimed by its DELTA_MANIFEST row existing, so a plan that writes one before the row exists has pre-claimed in a registry with no claim mechanism, which is the exact drift ADR-034 and ADR-036 were built to stop. Each change below therefore names its owning module and its table, and takes the next free number in that module's series when the manifest row is written.

| # | Change | Owner | Serves |
|---|---|---|---|
| 1 | new `identity_phones`: `identity_id`, `phone_hash`, `phone_preview`, `country_code`, `verified_at`, `superseded_at` and `superseded_by`, `released_at` and `release_evidence` (the recycling guard's output), plus carrier metadata at capture: `line_type check in ('mobile','landline','voip','prepaid','unknown')`, `carrier_name`, `carrier_country`, `ported`, `last_ported_at`, `footprint_present`, `lookup_provider`, `lookup_at` | [M19](M19-kyc-identity.md) | (a), (b), amendment 3 |
| 2 | new `phone_change_requests`: (c)'s ceremony as state. `state`, `old_phone_id`, `new_phone_hash`, `dual_channel_verified_at`, `prior_notified_at`, `withdrawal_hold_until`, `applied_at`, `cancelled_at` | [M19](M19-kyc-identity.md) | (c), (d) |
| 3 | new `otp_send_budget`: per-number, per-IP and per-country velocity plus the **cost circuit breaker**, on `plan_breaker_state`'s pattern from `0016` rather than a new idiom | [M16](M16-notification-center.md) | amendment 2 |
| 4 | `otp_challenges` gains `channel check in ('email','sms')` and `destination_hash`; `email_normalized` relaxed to nullable under a check that **exactly one** destination is set | [M16](M16-notification-center.md) | SMS OTP |
| 5 | `sessions` gains `auth_factor`, `elevated_at`, `elevated_by_factor` | [M04](M04-trader-portal.md) | **Amendment 4 is unenforceable without this.** A handler cannot refuse an SMS-established session for a sensitive action if the session never recorded how it was established |
| 6 | `contact_channels.kind` check widened to include `sms`, as a named constraint dropped and re-added | [M16](M16-notification-center.md) | Finding 4. `INV-M16-03` on a prior **number** |
| 7 | `identity_signals.kind` check widened: `phone`, `phone_carrier` | unnumbered | The ADR-022 graph node. The same shape as the enrichment kind ADR-023 added, and it takes the next free unnumbered slot |
| 8 | `notification_kinds.class` gains `pre_identity_auth`, and a new **`rate_limit_exempt boolean` generated from `class`** | [M16](M16-notification-center.md) | Amendment 2, made unforgeable the way `mutable` already is |
| 9 | `kyc_verifications.verification_purpose` check widened: `reverify_phone_change` | [M19](M19-kyc-identity.md) | (c)'s re-verification, `INV-M19-06` |

**Two disciplines inherited from defects this corpus already paid for.** Every `CHECK` over an array uses `cardinality()` and never `array_length`, because a `CHECK` evaluating to `NULL` passes. Every trigger body names only columns the migrations declare, which is what [CI-06j](../testing/STRATEGY.md) asserts from the tree after [ADR-035](../decisions/ADR-035.md).

---

## 5. The invariant amendment 4 exists to write down

**C-27, the authentication and authority boundary.**

> Any single factor establishes a session sufficient for **every read surface**. No single factor, and **specifically never SMS alone**, is sufficient for a sensitive action: payout destination change, contact change of either kind, or external withdrawal. Each requires a **passkey assertion or a dual-channel confirmation**, which **elevates** the session rather than re-establishing it. A SIM-swapped session can therefore see everything and change nothing.

Enforced by a server-side required-factor declaration per endpoint, recorded on the session by section 4's `sessions` delta, and asserted by the gate in section 7. **Not by discipline.**

---

## 6. The fold, by file

The ruling named nine documents. **The corpus's own gates force twenty-one, and the count is stated here rather than discovered mid-session.** Every addition below is forced by a named gate.

### 6.1 The nine the ruling named

| File | What lands |
|---|---|
| [DECISIONS](../decisions/README.md) | The ADR itself, its allocation row, the `0029` allocation row, and the amendments by citation to **ADR-022** (the hard-link class gains verified phone) and **ADR-023** (the registration call site, and portability history as a selection criterion) |
| [SECURITY](../architecture/SECURITY.md) | C-01 widened with the immunity reason preserved verbatim; **C-27** the authority boundary; **C-28** pre-identity OTP velocity and the cost breaker; section 2.6 gains SIM-swap and OTP-interception rows; **section 2.7 rescoped** per finding 1; a **new section 4.8**, phone-change hardening under D4 |
| [M19](M19-kyc-identity.md) | The three M19 deltas from section 4; two new invariants, that the phone hard link binds the graph and never enforces alone, and that the recycling guard is wired to portability history; section 3.2 gains the phone-change trigger; **a new adversarial scenario, the recycled number** |
| [M07](M07-risk-abuse.md) | Sections 3.1 and 7.9 hard-link tables gain verified phone; **D-18**, the registration lookup, carrying the **fleet signature** as a named composite scored by D-16; the M7 delta wiring portability history to the recycling decision |
| [M16](M16-notification-center.md) | **`INV-M16-11` recorded as CONFIRMED rather than amended**; a new invariant carrying the pre-identity split; a **fifth notification class**; the `contact_channels` delta widened for `sms`; section 3.2's ceremony gains the phone leg; **a new adversarial scenario, the pumping attempt** |
| [M04](M04-trader-portal.md) | the `sessions` delta from section 4; AS-M4-05 gains the SIM-swap shape; the active-sessions view shows the establishing factor; **the boundary is shown rather than hit**, so a non-elevated session sees a sensitive action disabled with its reason instead of failing after the fact |
| [M03](M03-billing-checkout.md) | Section 7.9 gains the registration lookup as one vendor's second call site, and **SMS delivery and lookup costs enter the Cost Stack** per (e) |
| [M10](M10-integrations.md) | **a sixth integration**, the SMS sender; the registration lookup as a governed egress with its own `integration_contracts` row |
| [PRIVACY_POLICY](../legal/PRIVACY_POLICY.md) | Collection categories gain **phone number and telephony metadata**; sharing gains **communication delivery providers**; the carrier row cites counsel item 3d |

### 6.2 The twelve a gate forces, and which gate

| File | Forced by |
|---|---|
| [COUNSEL_PACKET](../legal/COUNSEL_PACKET.md) | Section 3.2. Item 3 gains **3d** |
| [DATA_MODEL](../architecture/DATA_MODEL.md) | **CI-06i, both directions.** Three new `### <table>` sections plus amended columns on five existing tables. A new table with no design record fails the gate |
| [DELTA_MANIFEST](../../packages/db/DELTA_MANIFEST.md) | **[ADR-026](../decisions/ADR-026.md)'s completeness gate.** Every new delta appears exactly once with a disposition and takes its number here, the sequence table gains `0029`, and `manifest_changes` regenerates |
| [EDGE_CASES](../EDGE_CASES.md) | **CI-06e.** New entries continue from the registry's maximum, each naming a golden scenario that resolves |
| [GOLDEN_SCENARIOS](../testing/GOLDEN_SCENARIOS.md) | **CI-06d.** New scenarios continue from the registry's maximum in a new section, one per (a) to (e) plus amendments 2 and 3 plus the authority boundary. **Eight minimum** |
| [STRATEGY](../testing/STRATEGY.md) | The new suites, and the gate in section 7 |
| [API_CONTRACT](../architecture/API_CONTRACT.md) | The auth surface moves: `POST /auth/otp` gains a channel, phone verification and change endpoints are new, section 11's rate-limit table gains rows, and **section 12's negative-authz matrix gains a required-factor column.** No gate catches its absence, which is exactly why it is named here |
| [EVENTS](../architecture/EVENTS.md) | `phone.verified`, `phone.change_requested`, `phone.reassignment_detected`, `sms.budget_breaker_tripped`. M16 and M7 both consume them |
| [STATE_MACHINES](../architecture/STATE_MACHINES.md) | The phone-change machine that section 4's request table stores |
| [INDEX](../INDEX.md) | **CI-06c and CI-06g** |
| [STATE](../STATE.md), [SESSION_LOG](../SESSION_LOG.md) | The end ritual |

---

## 7. One new CI gate

The [session brain](../../CLAUDE.md)'s caution is to prefer a gate over a bigger model whenever the error is checkable. **Two of the four amendments are checkable from the tree and one gate covers both.**

**`CI-06k`, declared authority.** Every endpoint in API_CONTRACT section 12's matrix carries a required-factor cell; every sensitive action C-27 names declares a non-single factor; and **no `notification_kinds` class outside the post-identity security and money classes is `rate_limit_exempt`**. It reads the corpus and the DDL, needs no database, and catches the two errors a reading would otherwise have to catch: a sensitive endpoint added later with no factor declared, and a pre-identity kind quietly inheriting the exemption.

**It must be watched failing on a seeded violation before it is trusted, and failing on the seeded finding rather than merely non-zero**, per [`falsify.mjs`](../../scripts/corpus/falsify.mjs) and the two gates that failed off-target on a truncated tree.

---

## 8. `OI-06`, surfaced with a recommendation and deliberately not decided

**The 48 hour payout-destination cooling window has no storage.** Finding 5. `destination_ref` on `payout_transfers` and `wallet_withdrawals` is the destination of a transfer, and no table records that a destination changed or when. Every document citing the control cites a control whose input does not exist.

**Recommendation, offered without deciding it:** a `payout_destinations` registry keyed on `(identity_id, destination_ref)` carrying `first_seen_at` and `cooling_until`, read by both payout legs and by the affiliate rail under C-24, in its own migration after its own session.

**`0029` builds the phone hold on its own storage and does not touch this.** It is a proven gap in a shipped control rather than a design preference, and folding it in under this ruling's cover would put a change nobody asked for inside the diff the founder reads line by line.

---

## 9. Session sequence

[ADR-003](../decisions/ADR-003.md) strict. **This is not one session.**

| # | Session | Scope |
|---|---|---|
| 1 | **This plan** | Landed. Stops here |
| 2 | The ADR plus both allocation rows | **Money path.** The number is claimed before `0029` exists, and it lands alone so a sibling branch can read it |
| 3 | `0029`, DATA_MODEL, DELTA_MANIFEST | **Money path, fresh session.** The E2 read happens on this diff, incrementally, per read-early-merge-late |
| 4 | SECURITY, M19, M07, M16 | The invariants and the adversarial scenarios |
| 5 | M04, M03, M10, privacy policy, counsel packet | Non-money. May compound |
| 6 | EDGE_CASES, GOLDEN_SCENARIOS, STRATEGY, `CI-06k`, API_CONTRACT, EVENTS, STATE_MACHINES, INDEX | The registries and the gates |

**Sessions 2 and 3 are money path and take a fresh session each, no exceptions.**

---

## 10. Definition of done

Nothing below is a claim. Each is a command.

1. `node scripts/corpus/gates.mjs check`, all gates green, twelve once `CI-06k` exists.
2. `node scripts/corpus/gates.mjs generate` regenerates every span the fold moves: `adr_count`, `ec_count`, `gs_count`, `migration_files`, `manifest_changes`, `e2_files`, `sql_tables`. **CI fails if the tree changes after a regenerate**, so it runs before the commit rather than after.
3. `node scripts/corpus/falsify.mjs`, every gate watched failing on its own seeded violation and **on the seeded finding**.
4. **The full 29-file set applies forward-only from empty against PostgreSQL 16 with `ON_ERROR_STOP=1`**, re-applying it is rejected, and the install job emits the new object counts. Those counts are emitted, never stated.
5. `scripts/db/probe_phone_identity.sql` **leads with the success case**, which is `0028`'s transferable lesson: a probe that only ever attempts forbidden things passes against a guard that rejects everything. It asserts that a second identity verifying a live number **completes and raises the flag**, that the one-phone-per-identity index binds, that a released row frees it, and that `pre_identity_auth` is generated non-exempt.
6. **The founder's E2 read on `0029`.** No merge without it.
