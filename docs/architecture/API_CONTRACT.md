---
status: approved
depends_on: [MERIT_BUILD_MASTER_PROMPT.md, ../GLOSSARY.md, data-model/README.md, STATE_MACHINES.md, SECURITY.md, ../decisions/ADR-039.md, ../plans/FOLD-01-phone-identity.md, ../../research/SECURITY_LANDSCAPE.md]
last_updated: 2026-08-27
---

# API Contract (Constitution B2)

Every endpoint: auth, request schema, response schema, error shapes, idempotency, and rate limits. The portal, admin console, and site are the first clients of this API and have no privileged back door: **anything the UI can do, it does through these endpoints**, which is what makes the [Enrichlead failure](../../research/VIBE_FAILURE_POSTMORTEMS.md) untestable-by-omission impossible here.

Schemas are written as TypeScript types because they map one to one onto the zod validators that enforce them at runtime. Terms from [GLOSSARY.md](../GLOSSARY.md), tables from [DATA_MODEL.md](data-model/README.md).

## 1. Conventions

**Base path** `/api/v1`. Version is in the path; a breaking change means `/api/v2`, never a silent shape change.

**Content type** `application/json` for requests and successful responses; `application/problem+json` for errors.

**Auth.** Session cookie (httpOnly, Secure, SameSite=Lax) carrying a short-lived access token, with refresh rotation. There are no API keys for traders and no bearer tokens in local storage. Admin endpoints require an admin session **and** the request must arrive on the admin origin from an allowlisted IP.

**Identity scoping.** Every authenticated handler resolves the caller to an [identity](../GLOSSARY.md#trader-identity) and reads through `scopedDb(identity)`. A path parameter naming a resource the caller does not own returns `404` (not `403`) on trader surfaces, so the API does not confirm the existence of other people's resources. Admin surfaces return `403` because existence is not a secret from an authorized operator.

**Idempotency.** Every mutating endpoint accepts `Idempotency-Key` and it is **required** on `POST /checkout`, `POST /accounts/:id/payout`, `POST /accounts/:id/reset`, and `POST /wallet/withdrawals`. **The last of those is required by the schema rather than by this sentence**: `wallet_withdrawals.idempotency_key` is `text NOT NULL` under a unique `(identity_id, idempotency_key)`, so a withdrawal without a key cannot be written at all. Replaying a key with an identical body returns the original response verbatim; replaying with a different body returns `409 idempotency_key_reuse`.

**Pagination.** Cursor only, never offset: `?limit=50&cursor=<opaque>`. Responses carry `{ data, next_cursor }`. `limit` maximum 100, default 25.

**Rate limits.** Per IP and per identity, enforced at the edge and in the app. Exceeding returns `429` with `Retry-After`. Limits are stated per endpoint below.

**Response shape policy.** Responses list fields explicitly (allowlist), never `SELECT *` serialized. This is the [API3](../../research/SECURITY_LANDSCAPE.md) control: a field that is not in the schema below is not in the response, so an added column never leaks by default.

**Money and ratios.** `*_cents` are JSON integers. `*_bp` are JSON integers. No floats, no formatted strings; formatting happens in the client.

**Time.** `*_at` are RFC 3339 UTC strings. `*_day` and `*_on` are `YYYY-MM-DD` **exchange trading days**, never UTC dates.

**OpenAPI.** Generated from the same zod schemas. In production `/docs`, `/openapi.json`, and `/swagger` return `404` (test D0-10 asserts it against the production build).

## 2. Error model

All errors are RFC 9457 problem documents:

```ts
type Problem = {
  type: string;        // "https://meritfutures.com/problems/<code>"
  title: string;       // short human summary, stable
  status: number;      // HTTP status
  code: string;        // machine-readable, stable, snake_case
  detail?: string;     // human detail, never leaks internals or other users' data
  instance?: string;   // request id for support correlation
  errors?: Array<{ path: string; message: string }>;  // validation failures only
  required_factor?: RequiredFactor;  // 403 only; section 12's vocabulary. ADR-111
};

// Section 12's required-factor vocabulary, closed at six tokens, spelled as that
// table spells them. The space in "passkey or dual_channel" is part of the token.
type RequiredFactor =
  | "none" | "session" | "passkey" | "dual_channel" | "passkey or dual_channel" | "admin_sso";
```

**`required_factor` is an RFC 9457 extension member and never a code** ([ADR-111](../decisions/ADR-111.md) clause 4). Section 12 requires that the `403` on a sensitive action *"names the factor required so the client can offer it"*, and the canonical code table below is closed, so the code stays `forbidden` and the factor rides beside it. It appears on a `403` and on no other status: a `401` has no session to describe and a `200` is not a refusal.

**It does not discharge `DEP-M4-07` and it does not discharge `INV-M4-14`** ([ADR-111](../decisions/ADR-111.md) clause 5). Those two need the declaration on a **read**, so that a control the session cannot use renders disabled **before** the trader acts; a field that arrives on a refusal is by construction too late for that, and [M04 section 3.7](../plans/M04-trader-portal.md) is written against exactly the failure of learning a boundary by hitting it. The read-surface half belongs to `GET /me` and is **not written yet**.

Canonical codes:

| Code | Status | Meaning |
|---|---|---|
| `validation_failed` | 400 | Body or query failed schema validation; `errors[]` lists paths |
| `unauthenticated` | 401 | No valid session |
| `forbidden` | 403 | Authenticated but not permitted (admin surfaces, RBAC) |
| `not_found` | 404 | Unknown resource, or a resource the caller does not own |
| `conflict` | 409 | State conflict (already claimed, already exists) |
| `idempotency_key_reuse` | 409 | Same key, different body |
| `precondition_failed` | 412 | Client acted on stale state (for example a retired plan version) |
| `payout_not_eligible` | 422 | Gates not satisfied; body carries the full gate breakdown |
| `payouts_frozen` | 422 | Account or identity under investigation |
| `kyc_required` | 422 | Verification needed before this action |
| `geo_restricted` | 422 | Jurisdiction blocked at checkout |
| `account_cap_reached` | 422 | Entity-level cap would be exceeded |
| `identity_restricted` | 422 | The identity is restricted. Refused **server side** at the resolved-identity step, on **every** payment method and on every surface [ADR-041](../decisions/ADR-041.md) enumerates |
| `rate_limited` | 429 | Too many requests |
| `internal_error` | 500 | Unexpected; correlation id in `instance` |
| `service_unavailable` | 503 | Dependency down (PSP, Rise), safe to retry |

Errors never include stack traces, SQL, vendor payloads, or another identity's data.

**`identity_restricted` is a distinct code and not a reuse of `payouts_frozen`, and the distinction is load-bearing in two directions.** `payouts_frozen` is **per account or per payment** and blocks one door; a restriction is **per human**, halts every surface at once, and is reversed by a documented restore. A client that cannot tell them apart renders the wrong remedy, and the remedies are genuinely different. **It was proposed in [M03](../plans/M03-billing-checkout.md) section 3.5 and stated in one direction only until this fold**: the plan refused with a code this contract did not define, which is the shape where an implementer either invents a second spelling or reuses the nearest existing code. It is defined here now, and checkout, payouts, wallet spend, external withdrawal and affiliate settlement all refuse with this one code rather than with five near-synonyms.

## 3. Auth

### POST /auth/otp
Request a one-time code. Deliberately does not reveal whether the destination exists.

**`channel` takes no default** ([ADR-039](../decisions/ADR-039.md), `SD-M16-05`). The schema below mirrors `otp_challenges_exactly_one_destination`: exactly one destination is set and it is the one the channel names. A default would let a caller that forgot the field write a well-formed email challenge and leave a `CHECK` doing a type's job.

```ts
// request. Exactly one of email / phone, and it must match `channel`.
type OtpRequest = {
  channel: "email" | "sms";
  email?: string;
  phone?: string;              // E.164
  turnstile_token: string;
};
// response 202 (always, whether or not the account exists)
type OtpResponse = { sent: true; expires_in_seconds: number };
```
Auth: none. Rate limit: see §11; the `sms` channel is **pre-identity** and carries per-number, per-IP and per-country velocity plus the cost breaker (`INV-M16-12`, [SECURITY](SECURITY.md) C-28). Errors: `validation_failed`, `rate_limited`.

**A `202` on the `sms` channel does not mean a message was sent.** When `otp_send_budget` is degraded the response is unchanged and `deferred` is set, because [ADR-039](../decisions/ADR-039.md)'s breaker **degrades rather than stopping**: registration continues and phone verification is deferred to the `pre_funded` funding gate. Distinguishing the degraded response for an unauthenticated caller would tell an attacker exactly when their own traffic tripped the breaker.

```ts
type OtpResponse202 = { sent: true; expires_in_seconds: number; deferred?: true };
```

### POST /auth/verify
```ts
type VerifyRequest = { channel: "email" | "sms"; email?: string; phone?: string; code: string };
type VerifyResponse = {
  identity_id: string;
  user_id: string;
  is_new: boolean;
  auth_factor: "email_otp" | "sms_otp" | "passkey";   // sessions.auth_factor
};
```
Sets the session cookie and records `sessions.auth_factor`, which is what makes C-27 enforceable: a handler cannot refuse an SMS-established session for a sensitive action if the session never recorded how it was established. Auth: none. Rate limit: 10 per hour per IP; the challenge locks after 5 attempts. Errors: `validation_failed`, `unauthenticated` (bad or expired code, deliberately indistinguishable), `rate_limited`.

### POST /auth/elevate
Elevates the current session for a sensitive action. **It does not re-establish the session and it never issues a new one.**

```ts
type ElevateRequest =
  | { factor: "passkey"; credential: PublicKeyCredentialJSON }
  | { factor: "dual_channel"; challenge_id: string; code: string };
type ElevateResponse = { elevated_at: string; elevated_by_factor: "passkey" | "dual_channel" };
```
**The factor vocabulary is C-27 and it is closed.** `sessions.elevated_by_factor` admits `passkey` and `dual_channel` and nothing else, so **an SMS-established session cannot elevate itself at all**: "never SMS alone" is a vocabulary rather than a handler, and a SIM-swapped session can see everything and change nothing because the database has no value for the thing it would have to write. Auth: session. Errors: `validation_failed`, `unauthenticated`, `forbidden` (a single factor offered where C-27 requires elevation), `rate_limited`.

### POST /auth/passkey/register/options, /auth/passkey/register/verify
### POST /auth/passkey/login/options, /auth/passkey/login/verify
WebAuthn ceremonies. Options endpoints return the challenge; verify endpoints complete it and (for login) set the session.
```ts
type PasskeyVerifyRequest = { credential: PublicKeyCredentialJSON; label?: string };
type PasskeyVerifyResponse = { credential_id: string; label: string | null; created_at: string };
```
Auth: register requires a session; login does not. Rate limit: 20 per hour per IP.

### POST /auth/logout
Revokes the current session. Response `204`.

### GET /me
```ts
type Me = {
  identity_id: string;
  user_id: string;
  email: string;
  country_code: string | null;
  kyc: { state: "kyc_required"|"pending"|"verified"|"rejected"|"expired"; placement: string; verified_at: string | null };
  identity_status: "active" | "restricted" | "closed";
  payouts_frozen: boolean;
  frozen_reason: string | null;      // ToS-cited, trader-safe text

  // FOLD-02, ADR-041. The state was already here and said nothing about itself.
  // A trader reading `restricted` learned that something had happened and not
  // what, which surfaces are affected, or whether it ends.
  restriction: {
    reason: string;                  // ToS-cited, trader-safe. Never the detector
    tos_clause: string;
    opened_at: string;
    resolves_by: string | null;      // sla_due_at: set only where a payout is pending
  } | null;
  accounts_count: number;
  max_accounts: number;
  affiliate: { is_affiliate: boolean; code: string | null };

  // FOLD-01. The boundary is SHOWN rather than hit: the client reads what this
  // session may do from one server declaration instead of inferring it.
  phone: { verified: boolean; preview: string | null; verified_at: string | null };
  session: {
    auth_factor: "email_otp" | "sms_otp" | "passkey";
    elevated: boolean;
    elevated_by_factor: "passkey" | "dual_channel" | null;
  };
};
```
Auth: session. Rate limit: 120 per minute.

### 3.1 Phone verification and change (FOLD-01)

[ADR-039](../decisions/ADR-039.md) (b), (c) and (d). The tables are `identity_phones` and `phone_change_requests` (`0029`), and the machine is [STATE_MACHINES §12](STATE_MACHINES.md).

#### POST /phone/verify
Completes verification of a number challenged through `POST /auth/otp` with `channel: "sms"`. Writes the `identity_phones` row and the ADR-022 graph edge.

```ts
type PhoneVerifyRequest = { challenge_id: string; code: string };
type PhoneVerifyResponse = {
  phone_id: string;
  preview: string;                  // enough to recognise, never enough to reconstruct
  verified_at: string;
  line_type: "mobile" | "landline" | "voip" | "prepaid" | "unknown";
};
```
**A `voip` line type is returned and never refused** ((a): VoIP is scored, never rejected). Auth: session. Errors: `validation_failed`, `unauthenticated`, `conflict` (this identity already holds a live verified phone; the change ceremony below is the only way to replace one), `rate_limited`.

**A number already live on another identity still verifies.** `INV-M19-13`: the edge is written at the hard-link confidence ceiling and a severity-5 flag opens against both identities, and no state changes automatically. **The response is indistinguishable from an ordinary success**, because telling this caller that the number belongs to another account discloses the prior holder, which `AS-M19-05` counter 4 forbids.

#### POST /phone/change, GET /phone/change, POST /phone/change/:id/cancel
(c)'s D4 ceremony as a resource. Opening a request is a sensitive action: it requires an **elevated** session, and `phone_change_requests_open_per_identity_uq` means a second open request is a `conflict` rather than a second ceremony.

```ts
type PhoneChangeRequest = { new_phone: string };            // E.164
type PhoneChange = {
  id: string;
  state: "pending" | "dual_channel_verified" | "applied" | "cancelled";
  new_phone_preview: string;
  dual_channel_verified_at: string | null;
  prior_notified_at: string | null;
  withdrawal_hold_until: string | null;                     // the 48 hour external-withdrawal hold
  applied_at: string | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
};
```
`GET` is a read and takes any single factor. **The hold is exposed rather than inferred**: `withdrawal_hold_until` is the same value the payout and wallet-withdrawal paths read before they move money, so the portal shows the trader the running hold instead of surprising them with a refusal at the end of it. Errors: `validation_failed`, `unauthenticated`, `forbidden` (session not elevated), `conflict`, `rate_limited`.

#### GET /sessions, POST /sessions/:id/revoke
The active-sessions surface `AS-M4-05` has required since it was approved, and **the establishing factor is shown on every row**, which is what makes a SIM-swapped session visible to the person it was taken from.

```ts
type SessionRow = {
  id: string;
  auth_factor: "email_otp" | "sms_otp" | "passkey";
  elevated: boolean;
  created_at: string;
  last_seen_at: string;
  user_agent_family: string;        // coarse, never the raw string
  is_current: boolean;
};
```
`GET` is a read and takes any single factor, deliberately: **a session you cannot see is one you cannot revoke**, and requiring elevation to look would lock a compromised account's real owner out of the one screen that helps them. Revoking another session is a **contact-class sensitive action** and requires elevation. Errors: `unauthenticated`, `forbidden`, `not_found`.

### 3.2 The impersonation session ([ADR-068](../decisions/ADR-068.md), [ADR-111](../decisions/ADR-111.md))

**A SHAPE WITH NO ENDPOINT YET, AND THIS PARAGRAPH IS THAT STATEMENT RATHER THAN AN OMISSION.** [M04 section 3.9](../plans/M04-trader-portal.md)'s banner renders from *"the session the server resolved, never from client state"*, and its carrier is **`Me.impersonation` on `GET /me`**: the portal's first call on every page load, so the banner and the session it describes arrive on one response and cannot disagree by the width of a request. **That member is not declared above**, because the auth surface that would serve it is in flight and is not this row's to write ([ADR-111](../decisions/ADR-111.md) clause 6). The shape is declared here so the slice that lands the member transcribes it rather than designing it.

```ts
type ImpersonationSession = {
  admin_user_id: string;         // impersonation_sessions.admin_user_id
  subject_identity_id: string;   // impersonation_sessions.subject_identity_id
  reason_code: string;           // closed vocabulary, NOT NULL. ADR-068 requirement 5
  reason_detail: string;         // NOT NULL and non-blank, so there is always something true
  expires_at: string;            // the box, displayed and never authoritative
};
```

Every field is a column on [`impersonation_sessions`](../../packages/db/migrations/0042_impersonation_sessions.sql) rather than a string the server composes, and **the absences are the specification**: no dismiss affordance, no admin origin ([ADR-012](../decisions/ADR-012.md) keeps `ADMIN_ORIGIN` a placeholder), no exit URL, and no field a third divergence from the trader's screen could be written into (`INV-M4-17`). **`null` means this is not an impersonation session**, which is the ordinary case and is what a trader's own session reads; requirement 7's non-disclosure is a consequence of `IMPERSONATION-C1` refusing an impersonation token on `sessions` in both directions, not of anything a client chooses to render.

**A dedicated endpoint for this shape is refused rather than merely not chosen.** A second read is a second session resolution, and a banner rendered from a resolution other than the one that authorised the page is `GS-301`: a session that reaches expiry mid-view, on a page that still looks live.

## 4. Catalog (public)

### GET /plans
```ts
type PlansResponse = {
  data: Array<{
    plan_id: string;
    code: "core_eod" | "merit_rapid" | "direct";   // renamed at the M1 gate, ADR-013
    name: string;
    current_version: { plan_version_id: string; version: number };
    sizes: Array<{
      size_cents: number; price_cents: number; reset_price_cents: number;
      drawdown_cents: number; profit_target_cents: number | null; buffer_cents: number;
      win_day_floor_cents: number; payout_cap_cents: number; min_payout_cents: number;
    }>;
  }>;
};
```
Auth: none. Cacheable (60s). This is the endpoint the marketing site renders from, which is how "marketing equals implementation to the tick" is structurally true rather than a promise.

### GET /plans/:planId/versions/:version
Returns the full rules object plus published copy, including for retired versions, so a trader can always retrieve the contract they bought.
```ts
type PlanVersionResponse = {
  plan_version_id: string; plan_id: string; version: number;
  status: "published" | "retired";
  published_at: string; retired_at: string | null;
  rules: PlanRules;                  // exact JSON from DATA_MODEL §11
  copy_blocks: Record<string, string>;
  sizes: PlanSize[];
};
```
Auth: none. Errors: `not_found`.

### GET /public/methods/:statCode
The method page for one published statistic: **every version of its definition**, with the ruling that fixed each one. [M12](../plans/M12-transparency-platform.md) owns the endpoint; [ADR-110](../decisions/ADR-110.md) is the ruling that put this row into an `approved` document and states every choice below.
```ts
type MethodPageResponse = {
  stat_code: string;
  live_version: number;              // the unsuperseded definition, not "the effective one"
  versions: Array<{                  // ascending by version, superseded ones included
    version: number;
    title: string;
    numerator_spec: string;          // the two specs ARE the statistic
    denominator_spec: string;
    exclusions: string[];
    window_spec: string;
    grain: string;
    min_sample: number;              // a publication policy (SD-M12-01), not an implementation detail
    measures: Array<"rate" | "total" | "mean" | "median" | "p50" | "p95" | "count">;
    method_body_mdx: string;
    adr_ref: string | null;
    effective_from: string;          // YYYY-MM-DD, always future at write time (INV-M12-07)
    superseded_by_version: number | null;
  }>;
};
```
Auth: none. Cacheable; no rate limit beyond edge protection, as [M12 section 4](../plans/M12-transparency-platform.md) states it for the sibling public read. No TTL is stated, because M12 states none and a method page quotes no purchasable term (contrast `GET /plans`, whose 60s bounds a stale price). Errors: `not_found`, and it means **no statistic is published under this code**, never "not yours": this table carries no identity column and there is no correct one.

**`:statCode` alone is half an address and the response is why that is enough.** `(stat_code, version)` is unique in `statistic_definitions`, `published_statistics.definition_version` names the version a figure was computed under, and the whole set comes back here, so a caller resolves a version out of a response it already holds rather than through a second address. `live_version` is the row with no successor, which the schema makes unique; it is not "the definition in force today", because a version is written before it takes effect ([M12 section 3.2](../plans/M12-transparency-platform.md)). Historical values are never recomputed under a new definition, so the page shows every version and a chart drawn across a boundary renders the discontinuity.

## 5. Commerce

### POST /checkout
```ts
type CheckoutRequest = {
  plan_id: string;
  size_cents: number;
  coupon_code?: string;
  affiliate_click_token?: string;    // last-touch attribution
  accept_tos_version_ids: string[];  // explicit acceptance, recorded with IP
};
type CheckoutResponse = {
  purchase_id: string;
  plan_version_id: string;           // resolved now and pinned (B4 #12)
  amount_cents: number;
  discount_cents: number;
  psp: "psp_a" | "psp_b";
  payment_session: { provider_session_id: string; redirect_url: string; expires_at: string };
};
```
Auth: session. Idempotency: **required**. Rate limit: 10 per hour per identity, 20 per hour per IP. Anti-bot: Turnstile.
Errors: `validation_failed`, `geo_restricted`, `account_cap_reached`, `kyc_required` (only when placement is `pre_eval` or the plan is Direct), `conflict` (coupon exhausted or already claimed by this identity), `precondition_failed` (plan version retired between page load and submit), `service_unavailable` (both MIDs unhealthy).

Server-authoritative rules that the client cannot influence: price comes from `plan_version_sizes`, never from the request; the coupon discount is recomputed server-side; the account cap is checked against the resolved [identity](../GLOSSARY.md#entity-resolution), not the email.

### POST /accounts/:accountId/reset
Repurchase on a breached or expired account.
```ts
type ResetRequest = { coupon_code?: string; accept_tos_version_ids: string[] };
type ResetResponse = CheckoutResponse & { parent_account_id: string };
```
Auth: session, owner. Idempotency: required. Rate limit: 10 per day per identity (reset velocity is also a risk signal). Errors: `not_found`, `conflict` (account is not resettable), `geo_restricted`.

### GET /purchases
Cursor list of the caller's purchases.
```ts
type PurchaseListItem = {
  purchase_id: string; created_at: string; kind: "new" | "reset";
  plan: { plan_id: string; code: string; version: number };
  size_cents: number; amount_paid_cents: number; discount_cents: number;
  status: "pending" | "paid" | "failed" | "refunded" | "charged_back";
  account_id: string | null;
};
```

## 6. Accounts

### GET /accounts
```ts
type AccountListItem = {
  account_id: string;
  plan: { plan_id: string; code: string; name: string; version: number };
  size_cents: number;
  phase: "eval" | "funded" | "closed" | "graduated";
  status: "provisioning_pending" | "active" | "breached" | "expired" | "closed_admin" | "closed_chargeback" | "graduated";
  balance_cents: number;
  floor_cents: number;
  floor_distance_cents: number;      // balance - floor, the number traders actually watch
  withdrawable_cents: number;
  as_of_trading_day: string;          // the last closed day; every number above is as of this date
  blocked: { payouts_frozen: boolean; recon_blocked: boolean; kyc_required: boolean };
};
```
Auth: session. Rate limit: 120 per minute.

### GET /accounts/:accountId
Everything the dashboard card needs, computed server-side so the client never re-derives a rule.
```ts
type AccountDetail = AccountListItem & {
  platform: "rithmic" | "tradovate" | "cqg";
  platform_account_ref: string | null;
  front_end_permissions: string[];
  opened_on: string; funded_on: string | null; closed_on: string | null; close_reason: string | null;
  progress: {
    // eval only
    profit_target_cents: number | null;
    profit_cents: number | null;
    // funded only
    buffer_cents: number | null;
    buffer_progress_cents: number | null;
    win_days: { have: number; need: number; floor_cents: number };
    traded_days: { have: number; need: number };
    consistency: { best_day_share_bp: number | null; max_bp: number | null; skipped: boolean };
    cadence: { days_since_last_payout: number | null; need: number; next_eligible_trading_day: string | null };
    ladder: { payouts_settled: number; payouts_to_graduate: number };
  };
  rules_url: string;                  // the account's pinned plan version, rendered
};
```
Errors: `not_found` (including for accounts owned by someone else, deliberately).

### GET /accounts/:accountId/marks
```ts
type MarkListItem = {
  trading_day: string;
  opening_balance_cents: number; closing_balance_cents: number;
  high_balance_cents: number; low_balance_cents: number;
  realized_pnl_cents: number;
  traded_day: boolean; win_day: boolean;
  floor_cents: number; withdrawable_cents: number;
  corrected: boolean;                 // true when this day has a superseding mark
};
```
Cursor paginated by `trading_day` descending. This is the equity chart source.

### GET /accounts/:accountId/timeline
Chronological, trader-safe projection of [events](EVENTS.md) for the account.
```ts
type TimelineItem = {
  occurred_at: string; trading_day: string | null;
  kind: string;                       // event_name, trader-safe subset only
  summary: string;                    // rendered from the payload, never raw internals
  detail: Record<string, number | string | boolean | null>;
};
```
Excluded from the trader projection: detector internals, flag evidence, admin reasoning, other identities' ids.

### GET /accounts/:accountId/eligibility
The gate-by-gate breakdown. This endpoint is the differentiator identified in [TOP10_FIRMS](../../research/TOP10_FIRMS.md): competitors show progress bars, this shows the whole rule.
```ts
type EligibilityResponse = {
  account_id: string;
  as_of_trading_day: string;
  eligible: boolean;
  max_payout_cents: number;           // min(withdrawable, cap) after clamp, 0 when not eligible
  min_payout_cents: number;
  gates: {
    account_active:   { pass: boolean };
    kyc_verified:     { pass: boolean; state: string };
    not_frozen:       { pass: boolean; reason: string | null };
    recon_clear:      { pass: boolean };
    traded_days:      { pass: boolean; have: number; need: number };
    win_days:         { pass: boolean; have: number; need: number; floor_cents: number };
    buffer:           { pass: boolean; have_cents: number; need_cents: number };
    consistency:      { pass: boolean; skipped: boolean; best_day_share_bp: number | null; max_bp: number | null; profit_needed_to_dilute_cents: number | null };
    cadence_gap:      { pass: boolean; days_since_last_payout: number | null; need: number; next_eligible_trading_day: string | null };
    minimum_amount:   { pass: boolean; withdrawable_cents: number; min_payout_cents: number };
  };
  cap: { cap_cents: number; ordinal: number; schedule_note: string };
};
```
Auth: session, owner. Rate limit: 60 per minute.
`profit_needed_to_dilute_cents` is computed rather than left as an exercise: telling a trader "your best day is 34% of profit" without telling them how much more profit fixes it is the kind of half-transparency that generates support tickets.

### POST /accounts/:accountId/payout
```ts
// Idempotency-Key required. amount_cents is OPTIONAL (ADR-009): omitted means
// "pay the maximum I am eligible for", which is the number the eligibility
// endpoint already displayed. A supplied amount is a ceiling, never an instruction.
type PayoutRequestBody = { amount_cents?: number };
type PayoutResponse = {
  payout_request_id: string;
  status: "approved" | "held_pending_review";   // there is still no denial value
  requested_cents: number;            // echoes the effective request: the supplied amount, or max_payout_cents when omitted
  amount_supplied: boolean;           // false when the caller took the default
  approved_cents: number;
  clamp_reason: "none" | "cap" | "withdrawable" | "requested";
  trader_cents: number; firm_cents: number; split_bp: number;
  basis_trading_day: string;
  payout_ordinal: number;
  estimated_settlement: { min_business_days: number; max_business_days: number };
  eligibility_snapshot_id: string;
  hold: {                             // present only when status is held_pending_review
    held_at: string;
    resolves_by: string;              // hold_expires_at, 48 hours. ADR-040
    tos_clause: string;
  } | null;
};
```
Auth: session, owner. Idempotency: required. Rate limit: 10 per day per account, 20 per day per identity. Anti-bot: Turnstile.
Errors: `payout_not_eligible` (422, body includes the full `gates` object so the client shows exactly what is missing), `payouts_frozen`, `identity_restricted`, `kyc_required`, `validation_failed` (amount non-integer, zero, or negative), `conflict` (a payout is already in flight for this account, **and a held request is in flight**).

**A hold is a 200 carrying `held_pending_review`, not an error.** [ADR-040](../decisions/ADR-040.md): the hold is entered when an unresolved high-severity flag stands at request time, and **the request succeeded** — it exists, it holds its ordinal, it carries a full evaluated decision, and it has a deadline. Returning a 422 would put a state with a clock into the vocabulary of a refusal, which is the reading zero denial exists to prevent. **Every money field is populated on a held response**, because the decision is computed and frozen at request time and only the ledger posting is deferred: release is mechanical and re-evaluates nothing, which is `INV-M5-02`, the number shown is the number sent.

**`conflict` now covers a held request too**, since the widened `payout_requests_no_in_flight_uq` predicate makes a held request **outstanding**. That is the same liability control stated below, one state wider.

Server behavior, in order: re-evaluate eligibility against the last closed day, resolve the effective request (`amount_cents` when supplied, otherwise `max_payout_cents`), clamp server-side, persist the immutable snapshot, post the ledger transaction, approve, enqueue the transfer. The clamp is `approved_cents = min(effective_request, cap_cents_for_ordinal, withdrawable_cents)` and the result must satisfy `approved_cents >= min_payout_cents`; a supplied amount that clamps below the minimum returns `payout_not_eligible` with `minimum_amount` failing, never a partial payment and never a denial. The client's `amount_cents` can only ever reduce the payout, never increase it.

**One payout in flight per account.** The `conflict` above is a liability control, not a convenience: [win days](../GLOSSARY.md#win-day) and the [consistency period](../GLOSSARY.md#consistency-period) reset on settlement, so allowing a second request before the first settles would let one qualifying stretch fund several capped extractions. The rule is stated here, enforced by a unique partial index in [DATA_MODEL](data-model/payout_requests.md), and tested as a named golden scenario.

### GET /payouts
```ts
type PayoutListItem = {
  payout_request_id: string; account_id: string;
  approved_cents: number; trader_cents: number;
  status: "approved" | "held_pending_review" | "settled" | "failed" | "frozen";
  approved_at: string | null;         // null while held: the hold is PRE-approval
  settled_at: string | null;
  hold: {                             // present only when status is held_pending_review
    held_at: string;
    resolves_by: string;              // hold_expires_at. The date, always
    tos_clause: string;
  } | null;
  timeline: Array<{ state: string; at: string }>;
  failure_note: string | null;        // honest, trader-readable
};
```

**This union typed `transferring` and not `held_pending_review` until [ADR-040](../decisions/ADR-040.md)**, and it is one of the four sites [ADR-028](../decisions/ADR-028.md)'s own sweep named and did not reach. `transferring` left `payout_requests` on 2026-08-14 and is owned by `wallet_withdrawals`, so this field advertised a value the table cannot hold while omitting the one it can. **A client written against it would have had a branch that never fires and no branch for the state that does.**

**`approved_at` becomes nullable in the same edit, and that is the hold's whole shape in one field.** The hold is entered **before** approval, so a held request has no approval time; a client that types it as non-null will render an epoch date or crash on the one state that most needs to render correctly.

**`resolves_by` is required in the response and is not optional.** [M05](../plans/M05-payout-system.md) section 3.4: a review the trader cannot see the end of is indistinguishable from a refusal. The trader is shown **the fact, the ToS clause and the date it resolves**, never the evidence and never the detector, and [M04](../plans/M04-trader-portal.md)'s copy rule binds so it is **never worded as a rejection**.

### GET /accounts/:accountId/certificate?kind=pass|payout
Returns a signed, verifiable share card.
```ts
type CertificateResponse = {
  certificate_id: string; kind: "pass" | "payout";
  image_url: string;                  // signed, time-limited
  verify_url: string;                 // the public verification page, `GET /verify/:code` in section 6.3
  issued_at: string;
  claims: { plan_code: string; size_cents: number; amount_cents?: number; trading_day: string };
};
```
Certificates carry the simulated-environment disclosure by construction.

### 6.1 Dashboard panels

**A subsection rather than a new top-level section, on purpose.** Section 12 is cited by NUMBER ([`CI-06k`](../testing/STRATEGY.md) reads it, [M04](../plans/M04-trader-portal.md) `DEP-M4-07` cites it, [ADR-039](../decisions/ADR-039.md) amendment 4 is written against it), so inserting a section ahead of it would renumber it and break every one of those citations silently ([ADR-111](../decisions/ADR-111.md) clause 2).

#### GET /economic-calendar
The dashboard's Tier-1 economic calendar panel ([M04 section 3.8](../plans/M04-trader-portal.md), [ADR-066](../decisions/ADR-066.md) section 5.1, `DEP-M4-09`, `GS-285`).
```ts
type EconomicCalendarOccurrence = {
  event_key: string; occurrence_key: string;
  tier: number;                       // 1 to 3. A column, not an import filter (0039 header item 3)
  scheduled_release_at: string;       // the one stored UTC instant
  release_trading_day: string;        // stored, never derived (0039 header item 5)
  revision: number;                   // a revision is a ROW, not an update. `> 0` means the time moved
  revision_reason: string | null;
};
type EconomicCalendarPanelResponse = {
  freshness: { stale: boolean; covered_through_day: string | null };
  occurrences: EconomicCalendarOccurrence[];
};
```
Auth: **session**. Nothing in the response is per-trader and a public row would work; it is authenticated anyway, because widening later is a decision and narrowing later is a break ([ADR-111](../decisions/ADR-111.md) clause 3). Errors: `unauthenticated`.

**There is no timezone field and there must never be one.** One row, one UTC instant, converted per viewer at the point of display. `GS-285` is exactly the assertion that the same row renders correctly on two dashboards in two timezones, so a stored zone would be a second answer to "when was the news", which is the failure `FM-M7-08` guards, reached from inside the building instead of from an embed.

**`freshness` is the whole reason the panel is safe to render, and `DEP-M4-09` says why in one line: *"the dangerous failure is not the empty panel, it is the confident one."*** Without it an uncovered week and a quiet week produce the same empty list and mean opposite things. `covered_through_day` is the last day any `economic_calendar_loads` row covers, or `null` when nothing has ever been loaded. **`stale` is the server's own answer against its own threshold**; the portal reads it and evaluates nothing.

**The source is `economic_calendar_current` and no external origin** (`INV-M4-16`). There is no URL on any type above and nothing for one to be assigned to: an embed cannot carry a revision, cannot be staleness-monitored, and cannot be joined to `fills`, so one rendered beside this panel would satisfy the display and satisfy none of `DEP-M7-06`, `D-04` or `FM-M7-08`.

#### The live dashboard channel ([ADR-020](../decisions/ADR-020.md) tier 2, [ADR-161](../decisions/ADR-161.md))

**This subsection specifies a PAYLOAD and deliberately carries no `METHOD /path` heading.** Every other surface in this document is a request and a response, and section 1's conventions each presume a client that asked: a base path, a content type, an `Idempotency-Key`, a cursor, and a rate limit stated per endpoint. **Tier 2 is server-initiated delivery of a value nobody requested**, [`registry.ts`](../../apps/api/src/registry.ts) closes the verb list at the five this contract uses and keys on `METHOD /path`, and a socket upgrade is none of them. **Where the channel lives and how it is framed are two rulings [P6](../plans/P6-live-tier.md) gives to other slices**, and neither changes what is below: the payload, the labeling and the degradation are what [ADR-020](../decisions/ADR-020.md)'s hard rule, `INV-M4-11` and `INV-M4-12` are about.

**This is section 6, and the section is what classifies the surface.** [`surface.ts`](../../apps/api/src/surface.ts) says `public` *"serves API_CONTRACT sections 3 to 7 and 10"* and `operator` *"serves sections 8 and 9"*, and it enforces that by PREFIX rather than by an endpoint list: `OPERATOR_PREFIXES` is `['/admin', '/internal']`. So the trader's live channel belongs here and the operator's live figure belongs in section 8, and **an operator live path that carries neither prefix is withheld from the public deployment by nothing at all** ([ADR-083](../decisions/ADR-083.md) section 4).

```ts
type LiveFreshness = {
  stale: boolean;                            // the SERVER's own answer against its own threshold
  feed: string;                              // which feed the value came from
  as_of_instant: string;                     // when that feed was last read
};

type LiveDashboardFrame =
  | {
      tier: "indicative";
      account_id: string;
      sequence: number;                      // 1-based per account per trading day, in delivery order
      freshness: LiveFreshness;
      live_pnl_cents: number;                // signed
      projected_floor_distance_cents: number;// signed; negative is through the floor
    }
  | {
      tier: "authoritative";
      account_id: string;
      reason: string;                        // why there is no live value. Names the supplier, never "unavailable"
      as_of_trading_day: string;             // this account's last closed day
      closed_through_day: string;            // the day the firm has closed through
      pnl_cents: number;
      floor_distance_cents: number;
    };
```

Auth: **session**. Every frame is scoped to the caller's own accounts through `scopedDb(identity)` exactly as the account reads are, and `account_id` names which one. Errors: `unauthenticated`.

**The two values of `tier` are the portal's `Tier` union, one to one**, and the two arms carry different field names for the same quantity on purpose. `INV-M4-12` requires that on feed loss a live surface falls back to last-closed values **and changes its label in the same render**: a frame carries the tier and the numbers in one object, so a component cannot render either number without narrowing past the label, and cannot read `live_pnl_cents` off a fallback frame because the field is not there. This is [`figure.ts`](../../apps/admin/src/figure.ts)'s idiom on the trader's side, where an absent figure *"carries no `cents` field, which is the point ... a caller that wants the amount must narrow the union first, and narrowing forces it past the reason"*. **A second message carrying the label is refused**: two messages are two renders, which is what `GS-133` exists to fail.

**The first frame on any subscription is an `authoritative` frame**, because it is the value the surface falls back TO. A client sent only live frames that then loses its transport holds no last-closed values and either renders nothing or holds the last live number, which is `INV-M4-12`'s named failure. **The one thing a client may act on by itself is its own transport closing**, which is an observation; a timeout is a computation over a clock and there is none in this contract to hold.

**Freshness is the server's claim and the client evaluates nothing** ([ADR-152](../decisions/ADR-152.md) clause 1), in the same idiom as `EconomicCalendarPanelResponse.freshness` above. **`sequence` is for ordering and de-duplication and is never a staleness input**: a consumer may discard a frame older than one it holds and may conclude nothing about freshness from the ordinal, because a quiet market and a dead feed produce the same absent successor. `closed_through_day` is the firm's day and `as_of_trading_day` is this account's, which is the pair [ADR-152](../decisions/ADR-152.md) clause 2 orders as strings; **it is published on this surface and on no other**, so clause 5's gap survives everywhere else in this document.

**Live win-day and consistency tracking is not in this payload.** [M04 section 3.6](../plans/M04-trader-portal.md) rows it as indicative and no document says what it is a projection OF ([P6](../plans/P6-live-tier.md) section 10 item 3). When it is ruled it arrives as a field on the indicative arm rather than as a third arm.

**Nothing here is ever an input to a request the portal sends** (`INV-M4-13`). The payout centre re-fetches authoritative eligibility as section 6 already specifies, and the channel being entirely down changes nothing about it. **The channel's connection limit is owed and is not in section 11**, which states limits per endpoint and this subsection defines none.
### 6.2 The wallet, where [ADR-019](../decisions/ADR-019.md)'s internal leg settles

**A subsection rather than a new top-level section, for 6.1's own recorded reason.** Sections 12 and 13 are cited by NUMBER, so a section inserted ahead of them renumbers both and breaks every citation silently ([ADR-111](../decisions/ADR-111.md) clause 2). It sits under section 6 because [ADR-019](../decisions/ADR-019.md) made `POST /accounts/:accountId/payout` credit this balance: `GET /payouts` one heading up and `GET /wallet` here are the two halves of one movement.

**A wallet balance is not an account balance and the two are never summed.** [M20](../plans/M20-wallet.md) section 1.2: it is money already earned, already through every gate, owed unconditionally, and spendable on Merit products or takeable as cash. `wallet_entries.balance_after_cents` is `bigint NOT NULL CHECK (balance_after_cents >= 0)` ([`0011`](../../packages/db/migrations/0011_wallet.sql)), so **no response below can carry a negative wallet figure and a client need not branch on one**.

#### GET /wallet
```ts
// M20 P-3 is the only rule that holds a BALANCE. P-1 holds a WITHDRAWAL and
// appears on POST /wallet/withdrawals, not here: it routes the withdrawal to
// review and leaves the value spendable, so it subtracts nothing from the
// figure below.
type WalletHold = {
  rule: "chargeback_window";          // P-3. A closed union with one member today
  cents: number;
  since: string;                      // the oldest held credit's occurred_at
  available_at: string | null;        // see the paragraph below: null is the honest answer today
};
type WalletResponse = {
  balance_cents: number;              // >= 0 by CHECK, never negative
  withdrawable_cents: number;
  held_cents: number;
  holds: WalletHold[];                // empty when held_cents is 0
  as_of: string;
};
```
Auth: **session**, owner. Rate limit: authenticated reads. Errors: `unauthenticated`.

`balance_cents` equals `withdrawable_cents + held_cents` and the sum is stated rather than left to a client, because the two components are computed from different inputs and a client that derived one by subtraction would render a stale figure whenever the other moved.

**An identity with no `wallet_entries` row is `0` and not a `404`, and the asymmetry with [ADR-139](../decisions/ADR-139.md) clause 6 is deliberate.** There an account with no `rule_states` row is ABSENT, because a zero balance beside a zero floor renders as an account sitting on its breach line. Here absence means exactly zero: no credit and no debit has ever been written, `INV-M20-09` makes the balance payable on demand forever, and a `404` on a wallet would tell a trader they have none.

**`available_at` is `null` under `chargeback_window` and it is not an omission.** P-3 holds payout credits whose funding purchase is still inside the card networks' dispute window, and **no landed column carries that window's end for a purchase**. `wallet_withdrawals.earliest_credit_at` is Merit's own clock on the credit rather than the networks' clock on the purchase; `affiliate_commissions.chargeback_window_ends_on` is `date NOT NULL` ([`0012`](../../packages/db/migrations/0012_disputes_and_affiliate_settlement.sql)) and is the shape the wallet lacks for the same rule one rail over; [M20](../plans/M20-wallet.md) `OQ-M20-02` asks how long the hold is and is open; `DEP-M20-03` asks `M3` for the chargeback-window state of every purchase and is unbuilt. **A date computed by adding a chosen number of days to `earliest_credit_at` would be a number this repository invented**, on [ADR-139](../decisions/ADR-139.md) clause 3's rule, so the field states absence instead.

**Promotional credit is never a field on this response.** `wallet_entries.provenance` is a closed three-member CHECK and `promotional_credit` is deliberately not in it ([`0011`](../../packages/db/migrations/0011_wallet.sql) header item 3, `OQ-FREEZE-01`): the perk lives in `promotional_credit_grants` and is never withdrawable. A `promotional_credit_cents` field beside `balance_cents` is one client-side addition away from `AS-M20-01`, credit converted to cash, so the wallet screen composes two reads rather than one response mixing two kinds of money.

**Dormancy is not on this response either.** `wallet_dormancy_review_was_noticed` requires at least one recorded notification before `escheat_review` is reachable, so the disclosure path is a notification channel that the database already refuses to let anyone skip, and it is not this read.

#### GET /wallet/entries
```ts
// The itemized statement. DIRECTION CARRIES THE SIGN AND amount_cents IS A
// MAGNITUDE: `wallet_entries.amount_cents` is `CHECK (amount_cents > 0)` and
// 0011 states why it is deliberately NOT the ledger's signed convention.
// A signed amount on the wire would collapse the two questions back together.
type WalletEntryBase = {
  entry_id: string;                   // DECIMAL STRING, see below. Also the cursor's anchor
  amount_cents: number;               // magnitude, always > 0
  cause: string;                      // the business event, human readable
  reference_id: string;               // polymorphic: payout_request, purchase, or the corrected entry
  ledger_transaction_id: string;      // every wallet movement is posted; there is no unposted entry
  balance_after_cents: number;        // >= 0 by CHECK. The running balance AFTER this entry
  occurred_at: string;
};
type WalletCredit = WalletEntryBase & {
  direction: "credit";
  // The CLOSED credit list. There is no deposit value and there may not be one
  // (INV-WALLET-NO-DEPOSITS), and there is no promotional value on purpose.
  provenance: "payout" | "refund_wallet_funded" | "correction";
};
type WalletDebit = WalletEntryBase & {
  direction: "debit";
  // NO `provenance`, and the omission is the schema reported honestly rather
  // than a field forgotten. The column is NOT NULL on every row and its three
  // members are the CREDIT list, so a debit is stored carrying a class that
  // does not describe it. What a debit MEANS is `cause` and `reference_id`,
  // whose own declaration enumerates `purchase` among its referents.
};
type WalletEntry = WalletCredit | WalletDebit;
type WalletEntriesResponse = { data: WalletEntry[]; next_cursor: string | null };
```
Auth: **session**, owner. Pagination: cursor only, section 1's `limit` and `cursor`. Ordering: `occurred_at` descending, which is `wallet_entries_identity_idx`'s own order. Errors: `unauthenticated`, `validation_failed` (`limit` above 100).

**`entry_id` is a STRING and it is the only identifier in this document that is not a uuid.** `wallet_entries.id` is `bigint GENERATED ALWAYS AS IDENTITY`, and a `bigint` on the wire as a JSON `number` is the defect [ADR-122](../decisions/ADR-122.md) refuses in the digest for the same reason: it admits a value above `Number.MAX_SAFE_INTEGER` that has already lost digits by the time anything reads it. It is a decimal string of digits, never an integer, and a client must not parse it.

**The union is written out rather than typed `string`**, on [ADR-113](../decisions/ADR-113.md) clause 3's precedent: a closed CHECK list that reaches the wire as `string` is a contract admitting a value the database refuses.

#### POST /wallet/withdrawals
```ts
// Idempotency-Key REQUIRED. `wallet_withdrawals.idempotency_key` is `text NOT
// NULL` under a unique `(identity_id, idempotency_key)`, so a withdrawal
// without a key is unwritable rather than merely undesirable.
type WithdrawalRequestBody = {
  amount_cents: number;               // integer cents, > 0, and >= the minimum below
  destination_ref: string;            // the provider-side destination id. NEVER bank details
};
type WithdrawalResponse = {
  withdrawal_id: string;
  // The creation's reachable states, per STATE_MACHINES section 3.2. `cooling`
  // is a 200 and not a refusal: a destination inside its window ENTERS the
  // machine and waits, it does not fail.
  status: "requested" | "cooling";
  amount_cents: number;
  destination_ref: string;
  requested_at: string;
  cooling_until: string | null;       // the destination registry's clock; see below
  // `wallet_withdrawals_approved_has_provenance` permits an EMPTY summary at
  // `requested` and `cooling` and forbids one from `approved` on. So this is
  // null on the common creation, and a client typing it non-null renders an
  // empty breakdown on the one screen where the breakdown is the point.
  composition: Array<{ provenance: "payout" | "refund_wallet_funded" | "correction"; cents: number }> | null;
  earliest_credit_at: string | null;
  // P-1. A composition containing payout credits from accounts purchased with
  // promotional credit routes the withdrawal to review ONCE. It is a hold on
  // this withdrawal and never a hold on the balance, and the value stays
  // spendable inside Merit throughout.
  provenance_review: boolean;
  halt: null;                         // a withdrawal cannot be created halted
};
```
Auth: **session**, and **elevated**: `passkey or dual_channel`, `C-27: external withdrawal`, which section 12 already carries as a row. Idempotency: **required**. Errors: `validation_failed` (non-integer, zero, negative, or below the minimum), `kyc_required`, `payouts_frozen`, `identity_restricted` (`identities.status` is not `active`, [ADR-075](../decisions/ADR-075.md)), `insufficient_funds` (the request exceeds `withdrawable_cents`), `conflict` (a withdrawal is already open for this identity, or the key was replayed with a different body), `forbidden` (session not elevated, or a phone-change hold is running).

**The minimum is `10000` integer cents** ([M05](../plans/M05-payout-system.md) section 4, stated there as `$100`), and **there is no fee**. Whether the minimum is a plan parameter or a firm-wide constant is stated by no approved document; it is written here as the constant M05 states.

**`cooling_until` reads from a registry that does not exist yet.** `G-DESTINATION-COOLING` is a drawn transition and `wallet_withdrawals` carries a `cooling` status with nothing landed to compute it from: no table records that a destination changed or when. `OI-06` is open and `payout_destinations` is unlanded, so the field is `null` until that registry exists. **The field is declared now rather than added later** because widening a response later is a decision and narrowing one is a break ([ADR-111](../decisions/ADR-111.md) clause 3).

**`conflict` on an open withdrawal is served by the handler alone on this leg, and that is asymmetric with the internal one.** `payout_requests_no_in_flight_uq` is a **unique** partial index, deliberately, because *"the engine is not the only writer"*. `wallet_withdrawals_open_idx` has the same predicate and is **not unique**: it is a scan index for the sweep. So `G-NO-IN-FLIGHT` is a database constraint on the leg that moves no cash and an application check on the leg that does. Stated here so an implementer does not read the two indexes as the same control.

**The halt is not a status and never becomes one.** A halted withdrawal keeps its rail status and gains `frozen_at`, `freeze_flag_id` and `freeze_expires_at`, all three together or none (`wallet_withdrawals_freeze_is_complete`), and `wallet_withdrawals_live_freeze_blocks_settlement` refuses `settled` while the halt is live. Release **resumes the rail and never re-pays**, because `LT-06` already debited the wallet and the money is already the trader's (`INV-M20-14`). The trader-facing halt block on a subsequent read is `{ halted_at, resolves_by } | null` and carries **no ToS clause**: `payout_requests.hold_tos_clause` exists and **`wallet_withdrawals` has no equivalent column**, so a clause rendered here would be one the row cannot store.

**There is no endpoint that cancels a withdrawal.** `G-TRADER-CANCELS` is drawn from both `requested` and `cooling` in [STATE_MACHINES section 3.2](STATE_MACHINES.md) and `cancelled` is in `wallet_withdrawal_status`, and no approved document states a route, a body or an error set for it. It is named here as owed rather than invented, on [ADR-113](../decisions/ADR-113.md) clause 5's precedent for the operator half it could not write.

### 6.3 Certificates, and the public surface that is inside an authenticated section

**A subsection rather than a new top-level section, for 6.1's and 6.2's recorded reason.** Sections 12 and 13 are cited by NUMBER, so a section inserted ahead of them renumbers both and breaks every citation silently ([ADR-111](../decisions/ADR-111.md) clause 2). It sits under section 6 because `GET /accounts/:accountId/certificate?kind=pass|payout` is already here: that row and these three are one surface, and the certificate is issued against an account.

**TWO OF THE THREE ROWS BELOW ARE PUBLIC AND UNAUTHENTICATED, INSIDE THE SECTION WHOSE OTHER ROWS ALL REQUIRE A SESSION.** That is a placement forced by the renumbering rule above and not a claim about auth. Auth is stated per row here as it is everywhere else, and [`surface.ts`](../../apps/api/src/surface.ts) withholds by PREFIX rather than by section, so no row here is withheld from the public deployment by its address and all three are reachable there. The authenticated one is protected by its session and by nothing about where it is written down. **This paragraph read "ONE OF THE TWO ROWS BELOW IS PUBLIC ... so neither row is withheld" until [ADR-170](../decisions/ADR-170.md)**, and it is corrected rather than deleted because it was true of the section [ADR-168](../decisions/ADR-168.md) wrote and false the moment the verification page landed beside it.

**The state a certificate is in is DERIVED and there is no status column.** [`certificates`](data-model/certificates.md) ([`0020`](../../packages/db/migrations/0020_public_surface.sql)) carries `deferred_until`, `revoked_at`, `revocation_class` and `deferred_reason` and no `status`, so `deferred_until IS NOT NULL` is deferred, `revoked_at IS NOT NULL` is revoked, and neither is issued. **[M11 section 3.1](../plans/M11-certificates-social-proof.md) draws a fourth state, `withheld`, and the table cannot hold it**: there is no column that distinguishes "Merit never made the claim" from a row that does not exist. **So `state` below is a three-member union and not a four-member one**, on [ADR-040](../decisions/ADR-040.md)'s rule applied to `PayoutListItem` in this same section: a union that advertises a value the table cannot hold gives a client a branch that never fires. `withheld` is named as owed to the slice that gives it a column, and is not typed here.

#### GET /certificates
The caller's own certificates, including the deferred ones ([M11 section 4](../plans/M11-certificates-social-proof.md), **NEW** there and defined by no section of this contract until now; `INV-M11-09`).
```ts
type CertificateListItem = {
  certificate_id: string;
  kind: "pass" | "payout";
  state: "issued" | "deferred" | "revoked";   // DERIVED. See above
  issued_at: string;
  claims: { plan_code: string; size_cents: number; amount_cents?: number; trading_day: string };

  // WITHHELD WHILE DEFERRED, and the column is NOT NULL underneath.
  code: string | null;
  verify_url: string | null;             // `GET /verify/:code` below
  image_url: string | null;                   // signed, time-limited, as section 6's singular row

  deferred: { reason: string; until: string | null } | null;
  revoked: {
    at: string;
    class: "fact_untrue" | "account_enforced" | "issued_in_error" | "trader_request";
  } | null;
};
type CertificateListResponse = { data: CertificateListItem[]; next_cursor: string | null };
```
Auth: **session**, scoped to the caller's [identity](../GLOSSARY.md#trader-identity). Idempotency: not applicable. Rate limit: authenticated reads, section 11. Errors: `validation_failed` (a malformed cursor).

**The envelope is typed and the item is not typed alone, which is a departure from `GET /purchases` one section up.** Section 1 rules pagination cursor-only with `{ data, next_cursor }` and `GET /purchases` states "cursor list" while typing only its item, and the cost of that was paid on this exact surface: `apps/portal/src/app/(purchases)/ports.ts` declares `readPurchases()` with **no cursor argument** because "the paging token's shape is not settled on this ref" and a parameter invented there would be a guess the screen renders paging controls against. **Typing the envelope costs one line and is what stops the same port being written blind twice.** Nothing about `GET /purchases` is changed by this paragraph.

**`code`, `verify_url` and `image_url` are `null` while the state is `deferred`, and the row underneath always has a code.** `certificates.code` is `text NOT NULL` under `certificates_code_uq`, so the row is addressable from the moment it is written; the response withholds the token, which is section 1's allowlist policy doing what it is for. **The reason is that a deferred certificate is a claim Merit has NOT made yet** ([M11 section 3.1](../plans/M11-certificates-social-proof.md): `deferred --> issued` on the flag closing), and handing the trader a shareable token for an unmade claim is the wider of the two readings. `INV-M11-09`'s visible reason is served by `deferred.reason`, which is the field the trader needs, and `certificates_deferral_is_explained` makes it non-null exactly when `deferred_until` is set.

**`revoked.class` is published and `revoked_reason` is never in this response.** [`certificates`](data-model/certificates.md) calls `revoked_reason` **internal** free text and `certificates_revocation_is_complete` writes the two together, so a response carrying both would publish the internal half by the one route nobody audits. `INV-M11-07` and `AS-M11-05`: the class drives the sentence, and collapsing the class into free text is how an enforcement gets described inconsistently twice.

#### GET /certificates/:code/image.png
The public card, re-rendered on fetch from the live row ([M11 section 4](../plans/M11-certificates-social-proof.md), **NEW, public**; `INV-M11-08`).

**Auth: none.** Request: the path token only, no query, no body. **Success response: `image/png` bytes, and this is the first row in this contract whose successful response is not `application/json`** (section 1). Errors keep `application/problem+json`: `not_found` (`INV-M11-03`, "no certificate with this code", never "this is fake"), `rate_limited`.

`Cache-Control` is **measured in minutes and never in days** ([M11 section 4](../plans/M11-certificates-social-proof.md)), and the value is config rather than a number stated here. **A revoked certificate renders as revoked**, which is the whole reason this endpoint exists rather than a static asset: `INV-M11-08` and `AS-M11-02` make the re-render the only path by which a revocation reaches an image already in circulation.

**WHAT A CODE LEAKS TO WHOEVER HOLDS IT, STATED BECAUSE A CERTIFICATE NAMES A REAL TRADER'S REAL RESULT.** It leaks the claim and the state, and the claim is bounded by `INV-M11-01`: the account's plan, size, trading day and the kind-specific value, plus the simulated-environment disclosure `INV-M11-04` renders by template. **It carries no identity, no email, no display name, no cumulative total and no lifetime figure**, so a held code names a result and does not name a person. What makes that acceptable is four things and each is a control that already exists rather than an assurance: the claim is minimal by construction, so a code that escapes cannot be composed into an aggregate (`AS-M11-07`, and [M12](../plans/M12-transparency-platform.md) owns aggregates); the token is 128 bits with no sequence (`INV-M11-05`), so possession is evidence that somebody was given it; the surface is rate limited and instrumented below; and **a trader who wants it to stop can have it stopped**, because `trader_request` is a member of `certificates.revocation_class`'s CHECK and a revoked row renders as revoked on the next fetch.

**This endpoint is inside `INV-M11-05`'s rate-limit and non-enumerability clauses and OUTSIDE its constant-time clause.** `INV-M11-05` names the **verify** endpoint and says "no timing difference between known and unknown", and this surface cannot honour that half: a render is orders of magnitude slower than a 404, and `FM-M11-05`'s own remedy caches rendered bytes keyed by `(code, row_version)`, which puts a timing difference between two **valid** codes before an attacker asks about an invalid one. **So the enumeration control here is the entropy, the limit and the anomaly signal, and it is not the clock.** Stated rather than left implied, because an implementer reading `INV-M11-05` as covering every public certificate surface would either build a constant-time renderer that cannot exist or record its absence as a defect.

**Every fetch writes [`certificate_verifications`](data-model/certificate_verifications.md)** (`SD-M11-04`) with `code_hash` and never `code`, `result` in that table's own four-member CHECK, and hashed inputs only. **A public read keyed on `code` is one oracle however it is dressed**, and an image endpoint outside that table would be an unmetered second door onto the book `AS-M11-04` and `FM-M11-04` exist to watch. Rate limit: section 11.

#### GET /verify/:code
The public verification page's data ([M11 section 4](../plans/M11-certificates-social-proof.md), **NEW, public**; `INV-M11-02`, `INV-M11-03`, `INV-M11-05`, `AS-M11-04`). **This is the page `verify_url` addresses**, in section 6's singular row and in `CertificateListItem` above. That field shipped against a row no section of this document defined until [ADR-170](../decisions/ADR-170.md); [ADR-153](../decisions/ADR-153.md) is the same defect's first instance and [ADR-168](../decisions/ADR-168.md) is where this one was found.

**Auth: none.** Request: the path token only, no query, no body.
```ts
type VerifyResponse = {
  // THREE members, and `certificate_verifications.result`'s CHECK has FOUR.
  // A code whose row is DEFERRED answers `unknown`. See below.
  result: "valid" | "revoked" | "unknown";

  // The ONLY user-visible sentence this endpoint produces, rendered SERVER SIDE
  // on every result. INV-M11-03 fixes the unknown wording; INV-M11-07 fixes
  // that the class drives the revoked one.
  statement: string;

  // null exactly when `result` is "unknown".
  certificate: {
    code: string;                     // the token looked up, echoed. NEVER `certificates.id`
    kind: "pass" | "payout";
    issued_at: string;
    claims: { plan_code: string; size_cents: number; amount_cents?: number; trading_day: string };
    claims_schema_version: number;    // SD-M11-01. Which claim shape was signed
    signature: string;                // base64url over the canonical claims
    signing_key_id: string;           // INV-M11-06. Rotation never invalidates history
    disclosure: string;               // INV-M11-04, rendered by template
  } | null;

  // Non-null exactly when `result` is "revoked". `certificates.revocation_class`'s
  // CHECK, in the CHECK's order. The class is for BRANCHING, never for composing copy.
  revoked: {
    at: string;
    class: "fact_untrue" | "account_enforced" | "issued_in_error" | "trader_request";
  } | null;
};
```
Errors: `rate_limited`, **and that is the whole error set**. Idempotency: not applicable. Rate limit: section 11.

**A DEFERRED CODE ANSWERS `unknown`, WHICH IS WHY THIS UNION IS THREE MEMBERS AND THE LOG'S IS FOUR.** Nobody legitimately holds a deferred code: `code`, `verify_url` and `image_url` are `null` while deferred, one row up, so a lookup that hits a deferred row is somebody holding a token they were not issued. The trader's own need is already served authenticated, by `GET /certificates`' `deferred.reason`. And `INV-M11-09` defers exactly on **an open severity 4+ flag**, so a public `deferred` answer would tell whoever holds the token that the account behind it is under risk review, which [M07](../plans/M07-risk-abuse.md) does not publish. **The log keeps the fourth value precisely because the response does not**: a `deferred` row in [`certificate_verifications`](data-model/certificate_verifications.md) is a leaked token or a 128-bit guess that hit, and an `unknown` row is a typo or `FM-M11-04` in progress. Those are different incidents and only the table can tell them apart. **This is an allowlist decision under section 1 and NOT [ADR-040](../decisions/ADR-040.md)'s defect**, which is a union advertising a value the table cannot hold; here the table holds it and the response declines to carry it.

**`withheld` is not typed here either**, for the reason stated at the head of this subsection, and on this surface the missing column costs nothing: a withheld certificate is one Merit never made, and the answer to a lookup on a claim never made is `INV-M11-03`'s exact wording, which is what the absent column produces anyway.

**A REVOKED CERTIFICATE STILL RETURNS ITS CLAIMS, ON ALL FOUR CLASSES.** `AS-M11-05`: for `account_enforced` *"the claim stands and the account was later closed under a named ToS clause ... It does not say the certificate is invalid, because it is not"*. A page that withheld the claim on revocation would be the retroactive denial that scenario exists to prevent, and on `fact_untrue` it would leave a holder comparing a printed card against a blank page. **`statement` is what distinguishes the four classes and the shape does not**, so the response's shape never discloses more than `result` already does. **`statement`'s `account_enforced` wording is `OQ-M11-02` and is owed**: the field is typed here and the copy is a legal and brand question.

**`Cache-Control: no-store`, and the revocation design requires that before the clock does.** `FM-M11-05`'s remedy caches **rendered bytes** keyed by `(code, row_version)` and is the image row's; this row renders no bytes and does not inherit it. The stronger reason is `FM-M11-02`: the verify code inside a circulating image **is** the recovery path when the image itself was screenshotted, so an intermediary serving a cached `valid` for a code revoked five minutes ago fails at the one surface that was supposed to be authoritative. `INV-M11-02`: the row is the authority, and a cached answer is not the row.

**THIS ENDPOINT IS INSIDE `INV-M11-05`'s CONSTANT-TIME CLAUSE, WHICH NAMES IT, AND THE MECHANISM IS A FLOOR RATHER THAN EQUAL WORK.** Equalising the work cannot honour it: with no response cache and one indexed equality on `certificates_code_uq`, a hit on a warm row and a hit on a cold one still differ, because the database's own buffer cache reproduces `FM-M11-05`'s tension a layer below any application ruling. **So the response is emitted at a fixed time floor that dominates a warm hit, a cold hit, a miss and a malformed token alike**, set above the measured p99 of the slowest of those, held as config rather than as a number here. **A floor set from a p50 is worse than no floor**, because it advertises compliance and leaks on exactly the tail an attacker samples.

**There is therefore no `validation_failed` on this row, and its absence is the control.** A token of the wrong length or alphabet answers `unknown`, identically and at the same floor. A shape check ahead of the lookup is a faster path, and it hands an attacker the token's alphabet and length for free, which is `INV-M11-05`'s non-enumerability half failing beside its timing half. **The response SIZE still differs between a hit and a miss and no padding of the clock closes that**; it is named rather than chased, because the size only separates a hit from a miss for a caller who already sent a code, and such a caller learns the same thing from the body. It is redundant with the answer.

**WHAT A CODE LEAKS HERE, AND IT IS A LARGER SET THAN THE IMAGE ROW'S.** The claim is bounded by `INV-M11-01` exactly as one row up, and three things are added and each is forced: the **revocation half as structured data**, because `INV-M11-07` requires the two revocation kinds be distinguishable; the **signature half**, because `INV-M11-02` makes an offline check a convenience for third parties and this is the only row that serves it, and `INV-M11-06` requires the key id to travel with the certificate; and `issued_at` and `code` as fields rather than as printed text. **It withholds `INV-M11-01`'s set unchanged, and three more.** No `certificates.id`, because [`0020`](../../packages/db/migrations/0020_public_surface.sql) keeps it *"DISTINCT FROM `id` so the public token can be ROTATED AFTER AN INCIDENT"* and publishing the immutable key beside the rotatable one defeats the rotation. No `payout_request_id`, because it names a row in the book `AS-M11-04` is about. No `revoked_reason`, which [`certificates`](data-model/certificates.md) types **internal** free text. **A held code names a result and does not name a person.**

**Every lookup writes [`certificate_verifications`](data-model/certificate_verifications.md)** (`SD-M11-04`) on every path including `unknown` and including a malformed token, whose `code_hash` is the hash of whatever arrived: `code_hash` and never `code`, hashed inputs only, `result` in that table's own four-member CHECK per the mapping above. **The write is inside the floor's budget**, so it costs nothing observable and the anomaly detector sees the whole population rather than the resolvable part of it. `certificate.verify_anomaly` fires on the distinct-code and unknown-rate signature.

## 7. KYC and affiliate

### POST /kyc/session
```ts
type KycSessionResponse = { provider: string; hosted_url: string; expires_at: string; applicant_ref: string };
```
Merit never proxies documents; the client goes to the provider's hosted flow. Auth: session.

### GET /kyc/status
```ts
type KycStatus = { state: string; placement: string; verified_at: string | null; expires_at: string | null; action_required: string | null };
```

### GET /affiliate/stats
```ts
type AffiliateStats = {
  code: string; commission_bp: number; status: string;
  clicks_30d: number; conversions_30d: number;
  earned_cents_lifetime: number; payable_cents: number; paid_cents_lifetime: number;
  chargeback_rate_bp: number;
};
```

### GET /affiliate/statements
Cursor list of monthly statements with `statement_id`, period, `total_cents`, `status`, and a signed download URL.

### POST /affiliate/creatives
Submit a creative for approval ([ADR-113](../decisions/ADR-113.md), [M8](../plans/M08-affiliate-system.md) section 4, `SD-M8-03`).
```ts
type CreateCreativeRequest = {
  kind: "landing" | "video" | "post" | "email" | "other";
  url_or_ref: string;
  notes?: string;
};
type CreateCreativeResponse = {
  creative: {
    creative_id: string; kind: string; url_or_ref: string;
    status: "pending"; submitted_at: string;
  };
  required_disclosure: { tos_version_id: string; version: string; text: string };
};
```
Auth: session. Idempotency: accepted. Rate limit: 20 per day per identity.
Errors: `validation_failed`, `forbidden` (the caller is not an affiliate), `conflict` (this affiliate already has an open submission for the same `url_or_ref`).

`required_disclosure` is **the disclosure the review will require**, not one this row already carries. `affiliate_creatives.disclosure_version_id` is nullable and `affiliate_creatives_approved_has_disclosure` binds it to **approval**, so a submission pins nothing and the two are separate fields for that reason ([ADR-113](../decisions/ADR-113.md) section 3). `INV-M8-08`, NFA I-26-12.

Approval, rejection and the automatic withdrawal that follows a superseded disclosure are **operator** acts on the admin origin and have no row here yet ([ADR-113](../decisions/ADR-113.md) section 5).

### POST /affiliate/links
```ts
type CreateLinkRequest = { landing_path: string; campaign?: string };
type CreateLinkResponse = { url: string; click_token: string };
```

## 8. Admin (RBAC, admin origin only)

Roles: `owner` (all), `ops` (read plus account actions, no config or role changes), `readonly`. Every mutating admin endpoint writes an [`admin_actions`](data-model/admin_actions.md) row with actor, reason, before, and after, and requires a non-empty `reason`.

### GET /admin/liability
```ts
type LiabilityResponse = {
  as_of: string;
  open_liability_cents: number;
  funded_accounts: number;
  eligible_next_7d: { total_cents: number; account_count: number; by_day: Array<{ trading_day: string; cents: number; accounts: number }> };
  payout_velocity: { last_7d_cents: number; avg_30d_cents: number; ratio_bp: number; alarm: boolean };
  reserve: { reserve_cents: number; cvar99_cents: number; rcr_bp: number; breaker_armed: boolean };
  per_plan: Array<{ plan_id: string; code: string; loss_ratio_bp: number; threshold_bp: number; sales_paused: boolean; cusum: { statistic: number; threshold: number; alarm: boolean } }>;
  integrations: { mid_health: Array<{ psp: string; decline_rate_bp: number; chargeback_rate_bp: number; healthy: boolean }>; recon: { last_run_at: string; mismatches_open: number }; batch: { last_success_at: string; last_duration_ms: number } };
};
```

#### The live Open Liability ([ADR-020](../decisions/ADR-020.md) tier 2, [ADR-161](../decisions/ADR-161.md))

Section 3.5's live figure ([M06 section 3.5](../plans/M06-admin-ops-console.md)). **A payload rather than a `METHOD /path` heading, for section 6.1's reason and applied to both surfaces rather than to one**: whether the operator's live figure arrives on a route or on the same channel the trader's frames do is the transport ruling [P6](../plans/P6-live-tier.md) gives to another slice, and a path fixed here would take it. **What this section does fix is that the path carries an operator prefix**, because [`surface.ts`](../../apps/api/src/surface.ts) withholds by prefix and a live operator path outside `['/admin', '/internal']` is withheld from the public deployment by nothing at all.

```ts
type AdminLiveLiability =
  | { kind: "suppressed"; reason: string }
  | {
      kind: "indicative";
      live_open_liability_cents: number;              // the sum. One indicative term makes the total indicative
      terms: {
        last_closed_open_liability_cents: number;     // authoritative, P-M6-01
        same_day_adjustments_cents: number;           // authoritative, signed. Same-day postings at par
        intraday_movement_cents: number;              // indicative, signed
      };
      freshness: LiveFreshness;                       // section 6.1's type
    };
```
Auth: **`admin_sso`**, admin origin only, RBAC per this section's header. Errors: `unauthenticated`, `forbidden`.

**It is never a field on `GET /admin/liability` above.** That response is the one an operator opens during an incident, and a live field on it makes the number Merit is most often disputed about depend on a feed that is down. `INV-M6-12` says no breaker, alarm, or task threshold reads the live figure; a response that cannot be served without it is the same coupling in a different shape.

**`suppressed` is a value and not an empty response.** When data trust is red the figure is refused and the reason is printed where the number would have been (`P-M6-09`), because *"a live number derived from a feed we already distrust is worse than no number"*. A figure that silently vanishes on a red day is one the reader assumes is still being computed.

**The three terms are carried separately because two of them are authoritative**, and hiding which one was the feed would make the whole figure look like a vendor feed when most of it is not. **It sits beside the as-of figure and never replaces it**: [M06 section 3.5](../plans/M06-admin-ops-console.md), *"Two numbers, both labeled, is the entire design."* No liability snapshot is written from it.

**`freshness` is section 6.1's type and not a second one.** The operator's live figure goes stale for the same reason the trader's does, and a second shape here would be a second answer to one question.

#### The three focused projections

`GET /admin/eligible-forecast`, `GET /admin/loss-ratios` and `GET /admin/cusum` are focused projections of
`GET /admin/liability`'s underlying data for charting, all cursor-free and cached for 60 seconds. Auth,
RBAC and errors are this section's, and all three carry the `/admin` prefix, so
[`surface.ts`](../../apps/api/src/surface.ts) withholds each from the public deployment by the same rule
([ADR-161](../decisions/ADR-161.md) clause 2).

**They are three headings below rather than one, and [ADR-166](../decisions/ADR-166.md) is why.** One
heading over three paths reads as one endpoint to anything parsing this document, and the two that follow
`eligible-forecast` are **registered by nothing**: `CompositionReport.registered` lists them on neither
surface, so today they answer 404 on the admin origin as well as on the public one. That is a route
**nobody has built yet**, not a path the contract names in error, and the two failures look identical from
outside the tree.

### GET /admin/eligible-forecast
The eligible-payout forecast, projecting `LiabilityResponse.eligible_next_7d`. **Registered.**

### GET /admin/loss-ratios
Per-plan loss ratios, projecting the `loss_ratio_bp`, `threshold_bp` and `sales_paused` fields of
`LiabilityResponse.per_plan`.

**The response body is deliberately NOT fixed here** ([ADR-166](../decisions/ADR-166.md) clause 3).
`P7-k` builds this endpoint together with the breaker evaluator that produces the numbers, and that slice
writes `sample_size` beside `min_sample` and an `insufficient_data` state that no field on
`LiabilityResponse.per_plan` carries today. A shape written before that evaluator exists would be one
`P7-k` has to break.

### GET /admin/cusum
The per-plan CUSUM, projecting `LiabilityResponse.per_plan[].cusum`. `statistic` and `threshold` are
**neither cents nor basis points**: a CUSUM statistic is a standardised deviation and rounding it to
either is a calibration defect (`FM-M6-07`) rather than a fix.

**The response body is deliberately NOT fixed here** ([ADR-166](../decisions/ADR-166.md) clause 3), and
this endpoint has a second reason the loss-ratio projection does not: **the CUSUM has no storage at all.**
[P7 section 5.3](../plans/P7-risk-and-abuse.md) found `0049`'s `per_plan` disposition checked four of five
fields, leaving the running statistic with no column it fits, and where it lives is `ADR-167`'s open
ruling. A projection cannot be specified over a table nobody has chosen.

### GET /admin/accounts?query=
Search by anything: account id, platform ref, email, identity id, name fragment, coupon, or payout id.
```ts
type AdminAccountSearchItem = {
  account_id: string; identity_id: string; email: string;
  plan_code: string; size_cents: number; phase: string; status: string;
  balance_cents: number; withdrawable_cents: number;
  open_flags: number; payouts_frozen: boolean; recon_blocked: boolean;
};
```

### GET /admin/accounts/:accountId
Full drill-down: account, identity, every mark, every rule state per day with `gate_results`, every event, flags with evidence, payouts with snapshots, admin actions. This is the screen where a payout decision gets explained.

### POST /admin/accounts/:accountId/freeze
```ts
type FreezeRequest = { reason: string; tos_clause: string; flag_ids: string[] };
```
Requires at least one open flag: a freeze without an investigation is not permitted by the contract, which is how the zero-denial policy resists erosion under pressure. Errors: `validation_failed` (no flags cited), `forbidden` (readonly role).

### POST /admin/accounts/:accountId/unfreeze
```ts
type UnfreezeRequest = { resolution_note: string };
```

### POST /admin/accounts/:accountId/close
```ts
type CloseRequest = { reason: string; kind: "enforcement" | "trader_request" | "operational"; tos_clause?: string; evidence_pack_id?: string };
```
`kind: "enforcement"` requires `evidence_pack_id`.

### POST /admin/accounts/:accountId/note
Free-text note attached to the timeline; audited like any other action.

### GET /admin/flags
```ts
type FlagListItem = {
  flag_id: string; identity_id: string; account_id: string | null;
  flag_type: string; severity: 1|2|3|4|5; status: "open"|"investigating"|"dismissed"|"enforced";
  first_detected_on: string; detector: string; evidence_summary: string;
};
```
Sorted by severity then age. Filterable by type, status, severity.

### POST /admin/flags/:flagId/status
```ts
type FlagStatusRequest = { to_status: "investigating" | "dismissed" | "enforced"; note: string; evidence_pack_id?: string };
```
`enforced` requires `evidence_pack_id`. Moving to `investigating` sets `payouts_frozen` on the identity as a side effect, and the response says so explicitly.

### POST /admin/certificates/:id/revoke
Revokes a certificate and sets the class that drives the published sentence ([M11 section 4](../plans/M11-certificates-social-proof.md), **NEW**; `INV-M11-07`, `AS-M11-05`, [ADR-170](../decisions/ADR-170.md)). **The write side of section 6.3's `GET /verify/:code`**, and the only way `certificates.revocation_class`'s `trader_request` member is ever exercised.
```ts
type CertificateRevokeRequest = {
  // `certificates.revocation_class`'s CHECK, in the CHECK's order. No default.
  revocation_class: "fact_untrue" | "account_enforced" | "issued_in_error" | "trader_request";
  // ONE string writes TWO columns, both `NOT NULL` and both INTERNAL:
  // `admin_actions.reason` and `certificates.revoked_reason`.
  reason: string;
};
// The response is the PUBLIC shape, with `result: "revoked"`. Section 6.3.
type CertificateRevokeResponse = VerifyResponse;
```
Roles: `owner` or `ops`. Idempotency: accepts `Idempotency-Key`; not in section 1's required set. Errors: `validation_failed`, `not_found`, `forbidden`.

**`:id` is `certificates.id`, the uuid, and NOT the public code, and a column decides that rather than a convention.** [`admin_actions`](data-model/admin_actions.md)`.subject_id` is `uuid NOT NULL`, so an audit row keyed on the public token could not be written at all; and [`0020`](../../packages/db/migrations/0020_public_surface.sql) keeps `code` rotatable after an incident, so an audit trail keyed on it loses its subject at the moment the subject matters.

**`initiative` IS NOT A REQUEST FIELD. It is derived, because the schema will not let it be supplied.** `admin_actions.initiative` is `NOT NULL` with no default over `('enforcement','trader_request','operational')`, and `admin_actions_on_behalf_matches_initiative` is the biconditional `(on_behalf_of_identity_id IS NOT NULL) = (initiative = 'trader_request')`. The four revocation classes map onto that vocabulary totally:

| `revocation_class` | `admin_actions.initiative` | `on_behalf_of_identity_id` |
|---|---|---|
| `fact_untrue` | `operational` | null. `FM-M11-01` is Merit correcting Merit, not an act against the trader |
| `account_enforced` | `enforcement` | null. The one class that follows an act against the trader |
| `issued_in_error` | `operational` | null. A system fault, reversible |
| `trader_request` | `trader_request` | **`certificates.identity_id`**, which the biconditional then requires |

**An endpoint that took `initiative` would let an operator record an enforcement as something the trader asked for, or a trader's own withdrawal as an enforcement**, and that is the exact misattribution `admin_actions_on_behalf_matches_initiative` was written to prevent, arriving through a request body instead of through a column. The class the operator states is the only thing they state.

**A DEFERRED CERTIFICATE CANNOT BE REVOKED**, and the refusal is `validation_failed`. [M11 section 3.1](../plans/M11-certificates-social-proof.md) draws `issued --> revoked` and `deferred --> withheld` and draws no edge between deferred and revoked; `0020` permits the write, so the refusal is this endpoint's rather than the schema's and is stated here so it is not met as a bug. **Encoding `withheld` as deferred-plus-revoked with class `account_enforced` was checked and fails**: `AS-M11-05` fixes that class as *"the claim stands"*, and a withheld certificate is one Merit never made. **So there is today no endpoint and no column by which an enforcement reaches a deferred certificate**, which is `withheld`'s missing column costing on this surface what it does not cost on the public one, and it is owed to the slice that adds the column. **The reverse edge is owed too**: section 3.1 draws `revoked --> issued` for a corrected `issued_in_error`, `certificates_revocation_is_complete` permits it, and `M11` section 4 lists no route.

**The response is the public shape and that is the control rather than a convenience.** It returns exactly what `GET /verify/:code` will return for that code. **An operator cannot revoke without being shown the sentence they caused**, which is `AS-M11-05`'s concern rendered at the moment of the act rather than discovered afterwards on a public page.

**Re-revocation is permitted and is not a `conflict`.** `certificates_revocation_is_complete` permits overwriting the triple, correcting a misclassified revocation is a real operation, and `admin_actions`' `before` and `after` are what distinguish a correction from a replay. No code is minted for a state the table does not refuse.

### GET /admin/identities/:identityId/graph
```ts
type IdentityGraph = {
  root: { identity_id: string; status: string; accounts: number };
  nodes: Array<{ identity_id: string; status: string; accounts: number; total_withdrawable_cents: number }>;
  edges: Array<{ a: string; b: string; link_kind: string; confidence_bp: number; evidence: Record<string, unknown> }>;
  aggregate: { identities: number; accounts: number; open_liability_cents: number; payouts_lifetime_cents: number };
};
```

### GET /admin/evidence/:accountId
Generates and returns the [evidence pack](../GLOSSARY.md#evidence-pack).
```ts
// The four audiences are `evidence_packs.audience`'s CHECK in `0008_risk.sql`,
// which is merged. This is a transcription of that vocabulary and not a second
// one: a fifth name here would be a row the database refuses to store.
type EvidencePackAudience = "internal" | "trader" | "counsel" | "regulator";

type EvidencePackResponse = {
  evidence_pack_id: string;
  download_url: string;
  content_sha256: string;
  expires_at: string;
  generated_at: string;
  // ECHOED, so the caller can tell from the response what the bytes behind
  // `download_url` were built as. `redaction_profile` is NOT echoed: it is
  // recorded on the pack and its vocabulary is unruled (ADR-166 F3).
  audience: EvidencePackAudience;
};
```
Query `?reason=` **and** `?audience=` are both required ([ADR-166](../decisions/ADR-166.md), `SD-M6-04`,
[M06 section 4](../plans/M06-admin-ops-console.md)). An absent or unrecognised `audience` is
`validation_failed`, and there is **no default**: the audience decides what leaves the building
(`AS-M6-01`), so a generator that supplied one the caller never named would be making the disclosure
decision on the caller's behalf. **The redaction profile follows from the audience and is recorded on the
pack, never chosen per export.**

Generation itself is audited and emits `evidence.pack_exported`.

### POST /admin/plans/:planId/versions
```ts
type CreateVersionRequest = { rules: PlanRules; copy_blocks: Record<string,string>; sizes: Array<{ size_cents: number; price_cents: number; reset_price_cents: number }>; reason: string };
type CreateVersionResponse = { plan_version_id: string; version: number; status: "draft"; computed_sizes: PlanSize[] };
```
Creates a **draft**. Publishing is a separate call, and any edit touching cap, split, or cadence gap requires dual control (a second `owner` approval within a 24 hour window) per D4 and [ADR-010](../decisions/ADR-010.md).

**Launch-scale note, stated so nobody later misreads the control.** Both `owner` credentials are held by the founder on separate hardware keys. At this scale dual control is **compromise resistance, not insider resistance**: it means one phished session or one owned laptop cannot move the cap, the split, the gap, or the payout rail alone. It becomes real separation of duties on the first operations hire, with no code change.

### POST /admin/plans/versions/:versionId/publish
```ts
type PublishRequest = { reason: string; second_approver?: string };
```
Errors: `precondition_failed` (dual control not satisfied for a sensitive field change), `conflict` (already published). Materializes `plan_version_sizes` in the same transaction and emits `plan_version.published`.

### POST /admin/payouts/:id/release
```ts
// SD-M5-08, ADR-040. The FIRST of the two operator paths out of
// `held_pending_review`. It posts the STORED decision unchanged and
// re-evaluates NOTHING (INV-M5-02: the number shown is the number sent).
type PayoutReleaseRequest = { reason: string };
type PayoutReleaseResponse = {
  payout_request_id: string;
  status: "approved";
  // Every money field is the one the hold froze at request time. None is
  // recomputed, and a release that produced a different number would mean the
  // hold cost the trader money, which is what zero denial exists to prevent.
  approved_cents: number; trader_cents: number; firm_cents: number;
  payout_ordinal: number;
  // THE HOLD THIS RELEASE JUST CLEARED, READ BEFORE THE WRITE. It is a separate
  // object from the request because after the write the row cannot carry it:
  // see the paragraph below.
  released_hold: { held_at: string; resolves_by: string; tos_clause: string; flag_id: string };
};
```
Auth: `admin_sso`, roles `owner` and `ops`. `reason` required and audited like every section 8 mutation. Errors: `validation_failed` (empty `reason`), `conflict` (the request is not `held_pending_review`), `forbidden` (`readonly` role), `not_found`.

**The release ERASES the hold from the row, and `released_hold` exists because of that.** `payout_requests_hold_is_complete` ([`0031`](../../packages/db/migrations/0031_payout_hold_and_identity_restriction.sql)) is a biconditional: at any status other than `held_pending_review` **all five** of `held_at`, `hold_flag_id`, `hold_expires_at`, `hold_tos_clause` and `hold_reason` must be `NULL`. So the moment this call succeeds the row stops being able to say it was ever held, and `GET /payouts` correctly returns `hold: null` for it. **The durable record is the [`admin_actions`](data-model/admin_actions.md) row's `before`**, which section 8 already requires of every mutating admin endpoint, and this response is the only place the caller sees it in the same breath as the act.

**There is deliberately no `extend`.** [M05](../plans/M05-payout-system.md) section 4: the hold's clock is the control and an endpoint that moves it is the control's own off switch. **And there is no endpoint for the release that matters**, because the 48 hour auto-release is the hourly sweep rather than an operator action. An auto-release a human had to fire would be a hold with extra steps.

### POST /admin/payouts/:id/enforce
```ts
// SD-M5-08, ADR-040. The SECOND path out, and the one that keeps zero denial
// honest: a hold either pays inside 48 hours or produces a documented
// enforcement action carrying a cited flag, a ToS clause and an evidence pack.
type PayoutEnforceRequest = {
  reason: string;
  tos_clause: string;
  evidence_pack_id: string;           // REQUIRED. An exported pack, not a promise of one
};
type PayoutEnforceResponse = {
  payout_request_id: string;
  status: "failed";
  payout_ordinal: number;
  ordinal_released: true;             // see below. Always true, and stated rather than implied
  enforced_hold: { held_at: string; resolves_by: string; tos_clause: string; flag_id: string };
};
```
Auth: `admin_sso`, roles `owner` and `ops`. Errors: `validation_failed` (empty `reason`, empty `tos_clause`, or missing `evidence_pack_id`), `conflict` (not `held_pending_review`), `forbidden` (`readonly` role), `not_found`.

**`ordinal_released` is `true` because `payout_requests_account_ordinal_uq` is partial on `status <> 'failed'`.** Enforcement sends the request to `failed`, which drops it out of that predicate and frees the rung for a later request (`EC-037`, and [ADR-040](../decisions/ADR-040.md) reads the index as unchanged and correct for exactly this reason). **The field is in the response rather than left to be derived**, because the alternative is an operator believing an enforcement burned a rung off a finite ladder.

`enforced_hold` is read before the write for the same reason `released_hold` is: the same biconditional NULLs all five columns on the way to `failed`.

**The trader-readable failure note is not written by this endpoint and no column holds it.** `GET /payouts` types `failure_note: string | null` and `payout_requests` declares no such column; the note's storage is unresolved and is not this row's to decide.

### POST /admin/wallet/:identityId/correct
```ts
// SD-M20-01. A COMPENSATING ENTRY, NEVER AN UPDATE. There is no update path and
// no delete path, and that is a GRANT rather than a convention: 0026 executes
// `REVOKE UPDATE, DELETE ON ... wallet_entries ... FROM merit_app, PUBLIC`, so
// the application role cannot rewrite or remove a wallet entry at all.
type WalletCorrectionRequest = {
  direction: "credit" | "debit";
  amount_cents: number;               // integer cents, > 0. The magnitude; direction carries the sign
  cause: string;                      // the business event, human readable. NOT NULL in the row
  corrects_entry_id: string;          // the entry being compensated. Becomes `reference_id`
  reason: string;
  second_approver: string;            // dual control, see below
};
type WalletCorrectionResponse = {
  entry_id: string;                   // decimal string, as on GET /wallet/entries
  provenance: "correction";           // the only value this endpoint may write
  direction: "credit" | "debit";
  amount_cents: number;
  balance_after_cents: number;        // >= 0, and see below
  ledger_transaction_id: string;      // every wallet movement is posted
  occurred_at: string;
};
```
Auth: `admin_sso`, role `owner`. `reason` required and audited. Errors: `validation_failed` (non-integer, zero or negative amount, empty `reason`, empty `cause`), `precondition_failed` (dual control not satisfied), `conflict` (`corrects_entry_id` does not belong to this identity), `insufficient_funds` (below), `forbidden`, `not_found`.

**A correcting DEBIT that would take the running balance below zero is refused by the database.** `wallet_entries.balance_after_cents` is `CHECK (balance_after_cents >= 0)`, and because the table is append-only the correction lands at the END of the statement and is computed against the CURRENT balance rather than the balance at the time of the entry it corrects. So an operator correcting an old over-credit that has since been spent gets `insufficient_funds`, and the remedy is a debt rather than a negative wallet.

**`second_approver` is required and it widens a set no ADR has widened.** [M20](../plans/M20-wallet.md) section 4 states this endpoint is **dual controlled**; `C-10` in [SECURITY](SECURITY.md) closes the dual-control set at cap, split, gap and treasury credentials and names one endpoint, and [ADR-010](../decisions/ADR-010.md)'s title closes it the same way. The row is written with dual control because that is the fail-closed direction on an admin write that moves a trader's money, and **reconciling `C-10`'s set with this row is owed to an ADR against [SECURITY](SECURITY.md) rather than settled here.**

### POST /admin/wallet/:identityId/spend-limit
```ts
// SD-M20-02, INV-M20-07, SECURITY C-23. PER IDENTITY RATHER THAN GLOBAL: the
// limit that matters is the one on the compromised session, and a global limit
// is set so high it does nothing.
//
// THIS IS AN APPEND AND NOT AN UPDATE. `wallet_spend_limits` is keyed
// `(identity_id, effective_from)`, so a new limit is a new effective-dated row
// and the previous one survives as the record of what was in force when.
type SpendLimitRequest = {
  daily_cents: number;                // integer cents, >= 0
  rolling_7d_cents: number;           // integer cents, >= daily_cents
  effective_from: string;             // NOT NULL with no default in the row: the caller states it
  reason: string;                     // NOT NULL in the row
};
type SpendLimitResponse = {
  identity_id: string;
  daily_cents: number;
  rolling_7d_cents: number;
  effective_from: string;
  set_by: string;                     // the admin actor, from the session. NEVER from the body
  created_at: string;
};
```
Auth: `admin_sso`, roles `owner` and `ops`. `reason` required and audited. Errors: `validation_failed` (non-integer or negative figures, or `rolling_7d_cents` below `daily_cents`), `conflict` (a row already exists for this identity at this `effective_from`), `forbidden` (`readonly` role), `not_found`.

**`rolling_7d_cents >= daily_cents` is a CHECK and not a nicety.** `wallet_spend_limits_weekly_exceeds_daily`: a rolling weekly limit below the daily limit is a daily limit with a confusing name.

**`daily_cents: 0` is writable and means no wallet spend at all**, not "no limit". The schema admits it (`CHECK (daily_cents >= 0)`), so the contract admits it, and **there is no value that means unlimited**: the absence of any row for an identity is what unlimited looks like. An endpoint that deletes a limit is therefore a different thing from this one and does not exist.

**The velocity limit DELAYS and does not refuse.** `INV-M20-07` and section 3.2 of [M20](../plans/M20-wallet.md): spend above the limit is delayed and the checks re-run when the window elapses, because the blast radius of a compromised session is contained and the cost of a false positive is a legitimate trader unable to buy a reset at the moment they most want one. That behaviour belongs to `POST /checkout` and is stated here so nobody implements this write as a refusal switch.

### GET /admin/wallet/reconciliation
```ts
// INV-M20-10's per-identity assertion, and INV-M20-08's float position for M6.
type WalletReconciliationRow = {
  identity_id: string;
  entries_position_cents: number;     // sum of credits minus sum of debits
  ledger_position_cents: number;      // the same identity's wallet position in the ledger
  divergence_cents: number;           // entries minus ledger. 0 on a healthy identity
  // The SECOND comparison, which INV-M20-10 does not name and 0011 does.
  // `balance_after_cents` is stored so that a divergence between the stored
  // running balance and the recomputed one is a DETECTABLE TAMPER INDICATION
  // rather than an invisible one. An endpoint reporting only the row above
  // leaves that indicator unread.
  stored_balance_cents: number;       // the latest entry's balance_after_cents
  recomputed_balance_cents: number;
  balance_divergence_cents: number;   // stored minus recomputed. 0 on an untampered statement
};
type WalletReconciliationResponse = {
  as_of: string;
  identities_checked: number;
  // FLOAT ENTERS THE DENOMINATOR AS EXPOSURE AND NEVER THE NUMERATOR AS
  // RESERVE. M6 P-M6-07 is the resolution; INV-M20-08 and AS-M20-08 are why.
  // The RCR is computed from reserve alone, and float is reported BESIDE it.
  float: { total_cents: number; identities_with_balance: number };
  divergent: WalletReconciliationRow[];   // only the rows where either divergence is non-zero
};
```
Auth: `admin_sso`, all roles including `readonly`. Read-only, no side effect. Errors: `forbidden` (non-admin origin), `unauthenticated`.

**`float` is rendered as its own figure and is never added into a reserve number by any client of this endpoint.** `AS-M20-08` is exactly the misreading, *"the ratio flatters itself with the same money on both sides"*, and `INV-M20-08` requires wallet balances to be segregated in reporting and in fact. A response that returned a single combined coverage figure would make the alarm unwritable.

**The response carries the divergent rows and not every identity**, because the healthy answer is an empty array and a per-identity dump grows without bound. `identities_checked` is the denominator that makes an empty `divergent` mean *checked and clean* rather than *nothing ran*, which is [`DEP-M4-09`](../plans/M04-trader-portal.md)'s rule applied one surface over: the dangerous failure is not the empty panel, it is the confident one.

## 9. Ops and internal (admin origin only)

| Endpoint | Purpose | Notes |
|---|---|---|
| `POST /internal/batch/run` | Manually trigger or resume the nightly batch | Guarded, idempotent per `(trading_day, run_id)`, requires `reason` |
| `GET /internal/recon/status` | Current mismatches and their ages | |
| `GET /internal/jobs` | Queue depth, failures, dead-man switch state | |
| `GET /health` | Liveness | Public, returns `{ status: "ok" }` and nothing else: no version, no dependency list, no build id |
| `GET /internal/health/deep` | Dependency checks (DB, SFTP, Rise, PSP) | Admin origin only |

## 10. Inbound webhooks

All webhooks: HMAC signature verified **before** parsing, timestamp within a 5 minute window, nonce recorded for replay protection, raw payload stored, processing idempotent on the provider event id, and a `200` returned for duplicates so providers stop retrying.

| Endpoint | Provider | Verification | Idempotency anchor |
|---|---|---|---|
| `POST /webhooks/psp/:provider` | PSP A, PSP B | HMAC per provider secret | `(psp, provider_event_id)` unique index |
| `POST /webhooks/rise` | Rise | HMAC plus timestamp and nonce | `provider_transfer_id` plus event id |
| `POST /webhooks/kyc/:provider` | KYC provider | HMAC | `provider_applicant_id` plus event id |

Unverified signatures return `401` and are logged as security events; they never reach business logic. Out-of-order delivery is deferred and re-evaluated rather than applied (B4 #9).

## 11. Rate limit summary

| Surface | Limit |
|---|---|
| `POST /auth/otp` (`channel: "email"`) | 5/hour/IP, 5/hour/email |
| `POST /auth/otp` (`channel: "sms"`) | **pre-identity, and the limits are data rather than prose.** Per-number, per-IP and per-country velocity plus a global cost breaker, held as `otp_send_budget` rows (`send_limit`, `budget_cents`) so the values are config the way every other plan parameter is. **Never rate-limit exempt**: `notification_kinds.rate_limit_exempt` is generated from `class` and `pre_identity_auth` is not in the exempt set. C-28, `INV-M16-12` |
| `POST /auth/verify` | 10/hour/IP, 5 attempts/challenge |
| `POST /auth/elevate` | 10/hour/session, 5 attempts/challenge |
| `POST /phone/verify` | 10/hour/identity |
| `POST /phone/change` | 3/day/identity; one open request per identity is a schema constraint rather than a limit |
| `POST /sessions/:id/revoke` | 20/day/identity |
| `POST /checkout` | 10/hour/identity, 20/hour/IP |
| `POST /accounts/:id/payout` | 10/day/account, 20/day/identity |
| `POST /accounts/:id/reset` | 10/day/identity |
| `GET /certificates/:code/image.png` | **Public and NOT the catalog class, and the limits are data rather than prose**, on the `POST /auth/otp` sms row's precedent two tables up. Per IP and **per `code`**, because an enumeration campaign and a single hot card look identical when only the IP is counted. `INV-M11-05`, `AS-M11-04`, `FM-M11-04`. Every fetch writes [`certificate_verifications`](data-model/certificate_verifications.md), so the rate is visible to the anomaly detector and not only to the edge. **The catalog's 600/minute/IP is an enumeration budget on a 128-bit token and is deliberately not inherited here** |
| `GET /verify/:code` | **Public, and per IP and per ASN rather than per `code`**, which is where this row and the image row above deliberately differ: one hot card served to many viewers is legitimate, and one code verified by thousands of distinct sources is `AS-M11-04`'s enumeration signature. `AS-M11-04` counter 3 names the ASN dimension for this endpoint specifically. The limits are **data rather than prose**, on the `POST /auth/otp` sms row's precedent. Every lookup writes [`certificate_verifications`](data-model/certificate_verifications.md) including the unknown and malformed ones, so the rate is visible to the anomaly detector and not only to the edge. **The catalog's 600/minute/IP is an enumeration budget on a 128-bit token and is deliberately not inherited here** |
| Authenticated reads | 120/minute/identity |
| Public catalog | 600/minute/IP (cached) |
| Admin | 600/minute/session |
| Webhooks | not rate limited; protected by signature verification |

## 12. Negative-authz test matrix (D5, required in CI)

Every row is a named test that must exist before the endpoint ships ([VG-5](../../research/VIBE_FAILURE_POSTMORTEMS.md)).

**The required-factor column is [ADR-039](../decisions/ADR-039.md) amendment 4 made checkable, and `CI-06k` is what reads it.** C-27 is enforced by a **server-side declaration per endpoint** rather than by discipline, and a declaration that lives only in a handler is one no reviewer can audit. Every row below therefore states the factor the endpoint requires, drawn from a **closed vocabulary**, and the sensitive actions C-27 names carry a `C-27:` tag naming which one.

| Token | Meaning |
|---|---|
| `none` | Unauthenticated surface. No session is required and none is trusted |
| `session` | **Any single factor**, which is every read surface. Email OTP, SMS OTP or passkey, indistinguishable here on purpose |
| `passkey` | A passkey assertion specifically |
| `dual_channel` | A second independent channel specifically |
| `passkey or dual_channel` | C-27's elevation: either, never a single factor, and **never SMS alone**. `sessions.elevated_by_factor` admits exactly these two values |
| `admin_sso` | The operator surface. Hardware-key SSO under C-08, which has **no SMS path, ever** ([SECURITY §2.7](SECURITY.md), rescoped) |

**`session` and `passkey or dual_channel` are the load-bearing pair**, and the gate's second assertion is that no row tagged `C-27:` declares the first. A sensitive endpoint added later with no factor declared fails the first assertion; one added with a single factor declared fails the second.

| Test | Required factor | Expected |
|---|---|---|
| Unauthenticated request to any `/accounts/*`, `/payouts`, `/affiliate/*`, `/admin/*` | `none` | 401 |
| User B reads `GET /accounts/{A}` and every subresource (`/marks`, `/timeline`, `/eligibility`) | `session` | 404 |
| User B posts `POST /accounts/{A}/payout` | `session` | 404 |
| Trader session calls any `/admin/*` | `admin_sso` | 403 |
| Trader session calls `/internal/*` from the public origin | `admin_sso` | 404 |
| Admin session from a non-allowlisted IP | `admin_sso` | 403 at the edge |
| `readonly` role calls any admin mutation | `admin_sso` | 403 |
| Payout body with `amount_cents` greater than cap | `session` | approved amount clamped, never the requested value |
| Payout body omitting `amount_cents` entirely | `session` | approved amount equals `min(cap, withdrawable)`, `amount_supplied` false |
| Payout body with `amount_cents` below `min_payout_cents` | `session` | `payout_not_eligible` with `minimum_amount` failing; no partial payment |
| Checkout with a client-supplied price field | `session` | field ignored; server price used |
| `/docs`, `/openapi.json`, `/swagger` in production | `none` | 404 |
| `POST /auth/otp` with `channel: "sms"` driven past the per-number velocity | `none` | `rate_limited`. The pre-identity class is **not** exempt, and a `202` carrying `deferred` is the degraded path rather than a refusal |
| `POST /auth/elevate` offering an SMS-established factor | `passkey or dual_channel` | `validation_failed`. **There is no such value to send**: the factor union admits `passkey` and `dual_channel` only, which is "never SMS alone" expressed as a type rather than as a check |
| Changing a payout destination from a session whose only factor is SMS OTP | `passkey or dual_channel` (C-27: payout destination change) | 403 `forbidden`, and the response names the factor required so the client can offer it. The read that showed the destination succeeded, which is the boundary working |
| Changing an email or phone contact from a non-elevated session | `passkey or dual_channel` (C-27: contact change) | 403 `forbidden`. **Either kind**, which is why `POST /phone/change` and the email equivalent share one row |
| `POST /sessions/:id/revoke` against another session, non-elevated | `passkey or dual_channel` (C-27: contact change) | 403 `forbidden`. Revocation is a credential-surface change and takes the contact-change factor |
| External withdrawal from a non-elevated session | `passkey or dual_channel` (C-27: external withdrawal) | 403 `forbidden`, on both the payout external leg and the wallet withdrawal, because C-27 names the action and not the endpoint |
| External withdrawal from an **elevated** session while a phone-change hold runs | `passkey or dual_channel` (C-27: external withdrawal) | refused for the duration of `withdrawal_hold_until`. **Elevation is necessary and not sufficient**: (c)'s hold is a separate gate, and a test that only covers the factor would pass a build that dropped the hold |
| `GET /sessions` and `GET /phone/change` from a single-factor session | `session` | 200. **The quiet direction, asserted deliberately**: requiring elevation to *look* would lock a compromised account's real owner out of the one screen that helps them, and a boundary tested only where it refuses is indistinguishable from a boundary that refuses everything |

## 13. Founder rulings (Wave 2 gate, 2026-08-13)

All five items that needed the founder's eyes were walked at the gate and are resolved. Recorded in [DECISIONS.md](../decisions/README.md).

1. **`404` versus `403` on trader surfaces: `404` confirmed.** Existence is not confirmed to a stranger. The support cost is handled by a runbook rather than by weakening the response: support resolves the trader in the admin console by identity and never trusts a trader-supplied account id ([ops/runbooks](../ops/runbooks/README.md), Wave 4).
2. **`POST /accounts/:id/payout` takes an optional amount, defaulting to the maximum eligible** ([ADR-009](../decisions/ADR-009.md)). Omitting the field is the common path and matches the number the eligibility endpoint already showed. A supplied amount is a ceiling and can only reduce the payout.
3. **Freeze requires a cited flag: confirmed as written.** Unchanged. It remains the single most important line in this document for keeping the zero-denial promise honest.
4. **Dual control on cap, split, and gap edits: confirmed, with the launch-scale note** now written into §8 and [ADR-010](../decisions/ADR-010.md). Both keys are founder-held, and the control is documented as compromise resistance rather than insider resistance so it is never mistaken for separation of duties.
5. **`estimated_settlement`: 2 to 3 business days confirmed** as the published figure, stated as a range everywhere it appears (API response, portal timeline, marketing site, certificates).
