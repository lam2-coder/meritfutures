---
status: approved
depends_on: [../decisions/ALLOCATION.md, M06-admin-ops-console.md, M04-trader-portal.md, M05-payout-system.md, M19-kyc-identity.md, M20-wallet.md, ../architecture/SECURITY.md, ../architecture/API_CONTRACT.md]
last_updated: 2026-08-20
---

# FOLD-04: impersonation, and the admin parity that makes it acceptable

**A fold plan, not a module plan.** Two rulings, both reserved and unwritten, and the fold of neither: **`ADR-068` is auth and therefore money path**, so it takes its own session under ADR-003, and `ADR-069` depends on an audit whose result nobody has yet.

**Nothing like this exists in the corpus today.** A grep for `impersonat`, `view as`, `log in as`, `support access` and `act as` across `docs/` returns nothing relevant. This is entirely new scope in five frozen module plans.

## 1. Why it is necessary, recorded because the reason is not obvious

**Merit is passwordless.** [ADR-039](../decisions/ADR-039.md) made OTP and passkeys the whole of trader authentication, so **there is no password to share and no password-reset path a support agent can walk a trader down.** Every prop-firm support organisation that has ever said *"read me what you see on screen"* has been leaning on a shared secret that Merit deliberately does not have.

**So impersonation is not a convenience here. It is the only support-visibility path into what a trader is actually seeing**, and the alternative is a support function that can only ask the trader to describe their own screen. That is the necessity note, and it belongs in `ADR-068` because a future reader will otherwise ask why a fintech built an impersonation feature at all.

---

## 2. Number allocation, claimed BEFORE anything is written

| Registry | Claim |
|---|---|
| **`ADR-068`** | Impersonation. **AUTH, money path** |
| **`ADR-069`** | Admin capability parity |
| **`0042`** | `0042_impersonation_sessions.sql`. **Money path** |
| **`0043`** | `0043_admin_attributed_actions.sql`. **CONTINGENT**, see section 5 |
| **GS-300 to GS-304** | Registered as golden-scenario section 37 |

**Reserved in [ALLOCATION](../decisions/ALLOCATION.md) in its own commit before this document existed**, and on the branch carrying `061` to `067`, because a ref without them shows seven holes and fails `CI-06f`.

---

## 3. What the primary sources say, checked rather than recalled

| Referral said | Tree says |
|---|---|
| "a named negative authz test per D5" | **D5 is the matrix; `M6-N-nn` is the test identifier.** [M06](M06-admin-ops-console.md):329 reads *"RBAC and negative authz across all three roles \| `M6-N-nn` \| one per mutating route per role, enumerated from the router"*. The new tests are `M6-N-nn` entries **in** the D5 matrix |
| "owner-role admin" | **Correct, and the role set is closed.** [API_CONTRACT](../architecture/API_CONTRACT.md):516 reads *"Roles: `owner` (all), `ops` (read plus account actions, no config or role changes), `readonly`"* |
| "impersonation of a suspended identity" | **There is no `suspended` identity.** [`0001`](../../packages/db/migrations/0001_extensions_and_enums.sql):27 declares `identity_status AS ENUM ('active','restricted','closed')` and [ADR-041](../decisions/ADR-041.md) **refused** to add one. **The scenario is a `restricted` identity**, and `closed` deserves its own case |

**That is the third time this fold cycle that a referral has named a `suspended` identity**, after [FOLD-03](FOLD-03-vendor-parity-gap-fill.md) section 3 and [WAVE-03](WAVE-03-duplicate-registry-keys.md) section 1. **The value does not exist and the corpus refused it on the record.** A scenario written against it would be unwritable, and a specification written against it would be unimplementable.

---

## 4. `ADR-068`, impersonation, specified

**MONEY PATH. Its own session, plan mode, ADR-003 strict.** This section is what that session transcribes.

### 4.1 The seven requirements

| | |
|---|---|
| **Read-only and money-blind** | **Server-side rejection, never UI hiding.** While a session carries the impersonation flag the API refuses: payout request, wallet spend, external withdrawal, payout-destination change, contact / email / phone change, purchase, and KYC submission. **Each gets a named `M6-N-nn` negative-authz test in the D5 matrix**, per [M06](M06-admin-ops-console.md):329's one-per-mutating-route-per-role rule |
| **A distinct session type** | It **never inherits or intercepts** the trader's OTP or passkey. Initiated only from the admin origin (`ADMIN_ORIGIN`, [ADR-012](../decisions/ADR-012.md)) under hardware-key SSO. **A token minted here cannot satisfy a trader authorization**, and that is a database constraint in `0042` rather than a middleware convention |
| **Time-boxed** | **30 minutes by default, configurable.** Auto-expiry, plus an explicit exit that is its own audited event |
| **Visibly banner-ed** | A persistent visual banner for the whole session. **It is not a dismissible toast** |
| **Reasoned** | A **mandatory controlled-vocabulary reason at initiation**, in the shape `ADR-067`'s adjustment vocabulary takes |
| **Audited** | Actor, reason, start, end, and **pages viewed**. Internal tier |
| **Not disclosed to the trader** | **The trader is NOT notified, in-app or otherwise.** Impersonation events are **internal tier only** and do not surface in a trader-facing evidence pack |

### 4.2 The non-disclosure ruling, and the argument that has to survive being written down

**The ruling: no trader-facing disclosure.** The rationale to record is that it is an internal support-visibility tool, fully audited internally, and that a notification would be noise on a support contact the trader themselves opened.

**`ADR-068` must state the counter-argument rather than omit it**, because this is the requirement a future reader will challenge first. **Merit's whole differentiator is that the trader can check the firm's work**: the transparency platform, the replay determinism, the evidence pack. **A silent view of a trader's account is the one place where the firm sees and the trader cannot.** The ADR should say plainly that this is a deliberate exception, that the compensating control is the internal audit trail, and that the exception's scope is exactly "read-only" — which is why section 5's parity work is a **condition of the ruling and not a follow-on**.

**If parity is not delivered, the pressure to grant write access to impersonation becomes irresistible**, and at that point a silent, unnotified, trader-attributed write path exists. **That is the failure mode this fold is really guarding**, and the ADR should name it.

### 4.3 Golden scenarios

| ID | Scenario |
|---|---|
| **GS-300** | An impersonation session attempts a payout request. **Rejected server side, and alerted** |
| **GS-301** | A session reaches its expiry mid-view. The next request is refused rather than the page silently continuing |
| **GS-302** | Impersonation of a **`restricted`** identity, not a suspended one. Permitted for visibility, and every money surface already blocked stays blocked |
| **GS-303** | **Negative: an impersonation token cannot be replayed as a trader token.** The one that pins the session-type boundary |
| **GS-304** | **Parity-matrix coverage: every enumerated trader action has an admin equivalent.** `ADR-069`'s |

---

## 5. `ADR-069`, admin capability parity, and why it is the load-bearing half

**The referral's own rationale is the strongest argument in this fold and it is worth restating exactly.** Actions taken through impersonation are **attributed to the trader**. That corrupts the audit trail, and it weakens an evidence pack precisely where an evidence pack is worth most: a dispute, or a chargeback representment where Merit must show who did what. **An admin-attributed action preserves provenance; an impersonated one destroys it.**

**So parity is not a nicety that makes read-only tolerable. It is the thing that makes read-only correct.**

### 5.1 The matrix

**A table in [M06](M06-admin-ops-console.md) enumerating every trader-side mutating action against its `owner`-role admin equivalent.** The trader-side set, enumerated from [API_CONTRACT](../architecture/API_CONTRACT.md) rather than from memory:

payout request (`POST /accounts/:id/payout`), wallet spend and external withdrawal ([M20](M20-wallet.md)), purchase (`POST /checkout`), reset (`POST /accounts/:id/reset`), contact / email / phone change (`POST /phone/change` and its cancel), KYC submission **and re-submission** (`POST /kyc/session`), contract signature, notification preferences, account-closure request, and any plan-config-affecting action.

**Every gap closes**: an `owner`-role admin can perform any trader action from the admin surface, **attributed to the admin**, with a **mandatory reason** and a **dual-timeline audit** so the action appears on both the admin's record and the trader's account timeline.

### 5.2 The audit comes first, and the exception clause is deliberately narrow

**`ADR-069` cannot be written before the matrix is built**, because its content is the gap list. **If the audit finds a trader capability that genuinely cannot be replicated admin-side**, it is recorded as an open question with a **proposed narrow exception**: `owner` role only, write-enabled impersonation, elevated audit, dual control.

**Blanket write access is not granted in advance and the exception is not pre-approved.** A capability nobody has enumerated is not a capability anybody can scope.

**Two candidates are already visible and the audit should expect them.** A **contract signature** may be legally personal, and an admin signing on a trader's behalf is a different act with a different evidentiary weight. And **KYC submission** is an identity assertion whose whole value is that the subject made it; [M19](M19-kyc-identity.md) governs, and an admin-submitted KYC may be worthless to the provider. **Neither is decided here.**

---

## 6. Session sequence

| Rank | # | Session | Fence | Regime |
|---|---|---|---|---|
| **1** | **I1** | **The parity audit.** Build the matrix, list the gaps, change nothing. Log **88** | `docs/reviews/` only | non-money |
| **2** | **I2** | **`ADR-068`** and `0042`. Log **95** | `docs/decisions/ADR-068.md`, `docs/plans/M06-admin-ops-console.md`, `packages/db/migrations/0042_*` | **MONEY PATH, plan mode** |
| **2** | **I3** | Log **96**. The touchpoints: M04 banner, M05 / M19 / M20 rejection surfaces, SECURITY's D5 entries | `docs/plans/M04-*`, `M05-*`, `M19-*`, `M20-*`, `docs/architecture/SECURITY.md` | non-money |
| **3** | **I4** | **`ADR-069`** and the gap closure. Log **97** | `docs/decisions/ADR-069.md`, `docs/plans/M06-admin-ops-console.md`, `packages/db/migrations/0043_*` | non-money |

**`I1` writes its matrix to `docs/reviews/`, NOT into [M06](M06-admin-ops-console.md), and that is the difference between a session that can start today and one that cannot.** M06 is frozen, so a matrix written into it is an amendment needing `ADR-069`, and `ADR-069`'s content **is** the gap list the audit produces. **The audit would be blocked on its own output.** Writing the verdict to `docs/reviews/` is what [ADR-033](../decisions/ADR-033.md) made that directory for, `ADR-069` then cites it, and `I4` folds the matrix into M06 under that ruling.

**So `I1` runs first, and it runs concurrently with everything, because it writes one new file in a directory nobody else holds.** `ADR-069` cannot be drafted before it, and `ADR-068`'s non-disclosure ruling is weaker without it, because the read-only constraint is only defensible if the admin surface can do the work instead.

**`I2` and `I3` are concurrent.** `I2` holds M06 and the migration; `I3` holds the four other module plans and SECURITY. **`I3` writes no rejection logic**, only the surfaces that must show it.

**`I4` last.** It needs `I1`'s gap list and `I2`'s session type.

---

## 7. Definition of done

- `ADR-068` and `ADR-069` exist, `status: proposed`, **unsigned approval lines**.
- **GS-300 to GS-304** exist, and `GS-302` says `restricted`.
- **One `M6-N-nn` negative-authz test per blocked route**, in the D5 matrix, each named in [M06](M06-admin-ops-console.md) section 8.
- The parity matrix is complete, with **every gap either closed or an open question carrying the narrow-exception proposal**.
- `node scripts/corpus/gates.mjs check` green. `pnpm vitest run` green.
- **`0043` is spent or released, and the row says which.**

---

## 8. Open questions for the founder

| # | Question |
|---|---|
| **OQ-F4-01** | **Contract signature.** Can an `owner` admin sign on a trader's behalf, or is that legally personal? If it cannot be replicated, it is the first narrow-exception candidate |
| **OQ-F4-02** | **KYC submission.** An identity assertion whose value is that the subject made it. An admin-submitted KYC may be worthless to the provider, which makes this a vendor question as much as a policy one |
| **OQ-F4-03** | **Does non-disclosure survive a regulator asking?** The ruling is internal-tier-only, and evidence packs have a declared audience including `regulator` (`SD-M6-04`). **A pack that omits impersonation for a regulator audience is a different decision from one that omits it for the trader**, and the ADR should separate them |
| **OQ-F4-04** | **`closed` identities.** `GS-302` covers `restricted`. Impersonating a `closed` identity is a support case that will happen and the ruling should say whether it is permitted |
