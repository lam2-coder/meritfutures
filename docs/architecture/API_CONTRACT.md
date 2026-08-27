---
status: approved
depends_on: [MERIT_BUILD_MASTER_PROMPT.md, ../GLOSSARY.md, data-model/README.md, STATE_MACHINES.md, SECURITY.md, ../decisions/ADR-039.md, ../plans/FOLD-01-phone-identity.md, ../../research/SECURITY_LANDSCAPE.md]
last_updated: 2026-08-26
---

# API Contract (Constitution B2)

Every endpoint: auth, request schema, response schema, error shapes, idempotency, and rate limits. The portal, admin console, and site are the first clients of this API and have no privileged back door: **anything the UI can do, it does through these endpoints**, which is what makes the [Enrichlead failure](../../research/VIBE_FAILURE_POSTMORTEMS.md) untestable-by-omission impossible here.

Schemas are written as TypeScript types because they map one to one onto the zod validators that enforce them at runtime. Terms from [GLOSSARY.md](../GLOSSARY.md), tables from [DATA_MODEL.md](data-model/README.md).

## 1. Conventions

**Base path** `/api/v1`. Version is in the path; a breaking change means `/api/v2`, never a silent shape change.

**Content type** `application/json` for requests and successful responses; `application/problem+json` for errors.

**Auth.** Session cookie (httpOnly, Secure, SameSite=Lax) carrying a short-lived access token, with refresh rotation. There are no API keys for traders and no bearer tokens in local storage. Admin endpoints require an admin session **and** the request must arrive on the admin origin from an allowlisted IP.

**Identity scoping.** Every authenticated handler resolves the caller to an [identity](../GLOSSARY.md#trader-identity) and reads through `scopedDb(identity)`. A path parameter naming a resource the caller does not own returns `404` (not `403`) on trader surfaces, so the API does not confirm the existence of other people's resources. Admin surfaces return `403` because existence is not a secret from an authorized operator.

**Idempotency.** Every mutating endpoint accepts `Idempotency-Key` and it is **required** on `POST /checkout`, `POST /accounts/:id/payout`, and `POST /accounts/:id/reset`. Replaying a key with an identical body returns the original response verbatim; replaying with a different body returns `409 idempotency_key_reuse`.

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
  verify_url: string;                 // public verification page
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

### GET /admin/eligible-forecast, /admin/loss-ratios, /admin/cusum
Focused projections of the same underlying data for charting, all cursor-free and cached for 60 seconds.

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
type EvidencePackResponse = { evidence_pack_id: string; download_url: string; content_sha256: string; expires_at: string; generated_at: string };
```
Query `?reason=` is required. Generation itself is audited and emits `evidence.pack_exported`.

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
