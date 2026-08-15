---
status: approved
depends_on: [MERIT_BUILD_MASTER_PROMPT.md, ../GLOSSARY.md, DATA_MODEL.md, STATE_MACHINES.md, ../../research/SECURITY_LANDSCAPE.md]
last_updated: 2026-08-13
---

# API Contract (Constitution B2)

Every endpoint: auth, request schema, response schema, error shapes, idempotency, and rate limits. The portal, admin console, and site are the first clients of this API and have no privileged back door: **anything the UI can do, it does through these endpoints**, which is what makes the [Enrichlead failure](../../research/VIBE_FAILURE_POSTMORTEMS.md) untestable-by-omission impossible here.

Schemas are written as TypeScript types because they map one to one onto the zod validators that enforce them at runtime. Terms from [GLOSSARY.md](../GLOSSARY.md), tables from [DATA_MODEL.md](DATA_MODEL.md).

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
};
```

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
| `rate_limited` | 429 | Too many requests |
| `internal_error` | 500 | Unexpected; correlation id in `instance` |
| `service_unavailable` | 503 | Dependency down (PSP, Rise), safe to retry |

Errors never include stack traces, SQL, vendor payloads, or another identity's data.

## 3. Auth

### POST /auth/otp
Request an email one-time code. Deliberately does not reveal whether the address exists.

```ts
// request
type OtpRequest = { email: string; turnstile_token: string };
// response 202 (always, whether or not the account exists)
type OtpResponse = { sent: true; expires_in_seconds: number };
```
Auth: none. Rate limit: 5 per hour per IP, 5 per hour per normalized email. Errors: `validation_failed`, `rate_limited`.

### POST /auth/verify
```ts
type VerifyRequest = { email: string; code: string };
type VerifyResponse = { identity_id: string; user_id: string; is_new: boolean };
```
Sets the session cookie. Auth: none. Rate limit: 10 per hour per IP; the challenge locks after 5 attempts. Errors: `validation_failed`, `unauthenticated` (bad or expired code, deliberately indistinguishable), `rate_limited`.

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
  accounts_count: number;
  max_accounts: number;
  affiliate: { is_affiliate: boolean; code: string | null };
};
```
Auth: session. Rate limit: 120 per minute.

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
  status: "approved";                 // the only success value that exists
  requested_cents: number;            // echoes the effective request: the supplied amount, or max_payout_cents when omitted
  amount_supplied: boolean;           // false when the caller took the default
  approved_cents: number;
  clamp_reason: "none" | "cap" | "withdrawable" | "requested";
  trader_cents: number; firm_cents: number; split_bp: number;
  basis_trading_day: string;
  payout_ordinal: number;
  estimated_settlement: { min_business_days: number; max_business_days: number };
  eligibility_snapshot_id: string;
};
```
Auth: session, owner. Idempotency: required. Rate limit: 10 per day per account, 20 per day per identity. Anti-bot: Turnstile.
Errors: `payout_not_eligible` (422, body includes the full `gates` object so the client shows exactly what is missing), `payouts_frozen`, `kyc_required`, `validation_failed` (amount non-integer, zero, or negative), `conflict` (a payout is already in flight for this account).

Server behavior, in order: re-evaluate eligibility against the last closed day, resolve the effective request (`amount_cents` when supplied, otherwise `max_payout_cents`), clamp server-side, persist the immutable snapshot, post the ledger transaction, approve, enqueue the transfer. The clamp is `approved_cents = min(effective_request, cap_cents_for_ordinal, withdrawable_cents)` and the result must satisfy `approved_cents >= min_payout_cents`; a supplied amount that clamps below the minimum returns `payout_not_eligible` with `minimum_amount` failing, never a partial payment and never a denial. The client's `amount_cents` can only ever reduce the payout, never increase it.

**One payout in flight per account.** The `conflict` above is a liability control, not a convenience: [win days](../GLOSSARY.md#win-day) and the [consistency period](../GLOSSARY.md#consistency-period) reset on settlement, so allowing a second request before the first settles would let one qualifying stretch fund several capped extractions. The rule is stated here, enforced by a unique partial index in [DATA_MODEL](DATA_MODEL.md#payout_requests), and tested as a named golden scenario.

### GET /payouts
```ts
type PayoutListItem = {
  payout_request_id: string; account_id: string;
  approved_cents: number; trader_cents: number;
  status: "approved" | "transferring" | "settled" | "failed" | "frozen";
  approved_at: string; settled_at: string | null;
  timeline: Array<{ state: string; at: string }>;
  failure_note: string | null;        // honest, trader-readable
};
```

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

### POST /affiliate/links
```ts
type CreateLinkRequest = { landing_path: string; campaign?: string };
type CreateLinkResponse = { url: string; click_token: string };
```

## 8. Admin (RBAC, admin origin only)

Roles: `owner` (all), `ops` (read plus account actions, no config or role changes), `readonly`. Every mutating admin endpoint writes an [`admin_actions`](DATA_MODEL.md#admin_actions) row with actor, reason, before, and after, and requires a non-empty `reason`.

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
Creates a **draft**. Publishing is a separate call, and any edit touching cap, split, or cadence gap requires dual control (a second `owner` approval within a 24 hour window) per D4 and [ADR-010](../DECISIONS.md).

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
| `POST /auth/otp` | 5/hour/IP, 5/hour/email |
| `POST /auth/verify` | 10/hour/IP, 5 attempts/challenge |
| `POST /checkout` | 10/hour/identity, 20/hour/IP |
| `POST /accounts/:id/payout` | 10/day/account, 20/day/identity |
| `POST /accounts/:id/reset` | 10/day/identity |
| Authenticated reads | 120/minute/identity |
| Public catalog | 600/minute/IP (cached) |
| Admin | 600/minute/session |
| Webhooks | not rate limited; protected by signature verification |

## 12. Negative-authz test matrix (D5, required in CI)

Every row is a named test that must exist before the endpoint ships ([VG-5](../../research/VIBE_FAILURE_POSTMORTEMS.md)).

| Test | Expected |
|---|---|
| Unauthenticated request to any `/accounts/*`, `/payouts`, `/affiliate/*`, `/admin/*` | 401 |
| User B reads `GET /accounts/{A}` and every subresource (`/marks`, `/timeline`, `/eligibility`) | 404 |
| User B posts `POST /accounts/{A}/payout` | 404 |
| Trader session calls any `/admin/*` | 403 |
| Trader session calls `/internal/*` from the public origin | 404 |
| Admin session from a non-allowlisted IP | 403 at the edge |
| `readonly` role calls any admin mutation | 403 |
| Payout body with `amount_cents` greater than cap | approved amount clamped, never the requested value |
| Payout body omitting `amount_cents` entirely | approved amount equals `min(cap, withdrawable)`, `amount_supplied` false |
| Payout body with `amount_cents` below `min_payout_cents` | `payout_not_eligible` with `minimum_amount` failing; no partial payment |
| Checkout with a client-supplied price field | field ignored; server price used |
| `/docs`, `/openapi.json`, `/swagger` in production | 404 |

## 13. Founder rulings (Wave 2 gate, 2026-08-13)

All five items that needed the founder's eyes were walked at the gate and are resolved. Recorded in [DECISIONS.md](../DECISIONS.md).

1. **`404` versus `403` on trader surfaces: `404` confirmed.** Existence is not confirmed to a stranger. The support cost is handled by a runbook rather than by weakening the response: support resolves the trader in the admin console by identity and never trusts a trader-supplied account id ([ops/runbooks](../ops/runbooks/README.md), Wave 4).
2. **`POST /accounts/:id/payout` takes an optional amount, defaulting to the maximum eligible** ([ADR-009](../DECISIONS.md)). Omitting the field is the common path and matches the number the eligibility endpoint already showed. A supplied amount is a ceiling and can only reduce the payout.
3. **Freeze requires a cited flag: confirmed as written.** Unchanged. It remains the single most important line in this document for keeping the zero-denial promise honest.
4. **Dual control on cap, split, and gap edits: confirmed, with the launch-scale note** now written into §8 and [ADR-010](../DECISIONS.md). Both keys are founder-held, and the control is documented as compromise resistance rather than insider resistance so it is never mistaken for separation of duties.
5. **`estimated_settlement`: 2 to 3 business days confirmed** as the published figure, stated as a range everywhere it appears (API response, portal timeline, marketing site, certificates).
