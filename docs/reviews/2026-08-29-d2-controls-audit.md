# The Appendix D2 controls, measured against the tree: eleven rows, 2026-08-29

**A review record under [ADR-033](../decisions/ADR-033.md), not a plan and not a ruling.** It sits
outside the corpus ([`gates.mjs:165`](../../scripts/corpus/gates.mjs) excludes `docs/reviews/` from
`isCorpusDocument`), so it carries no frontmatter, appears in no INDEX, and binds nothing by
existing. **IT FIXES NOTHING.** Not a config, not a header, not a dependency. The honest table is
the whole deliverable.

**Anchored at `cc6a30b`**, which was `origin/main` when this session opened and was still
`origin/main` at the last `git fetch origin main`. `HEAD` and `origin/main` were the same commit at
both reads, so nothing measured below is this branch's work: the branch holds this file, an
ALLOCATION row and a session log, and no file under `apps/`, `packages/`, `.github/`, `scripts/` or
`docs/architecture/` is touched by it.

---

## 0. Why this exists, and what the method has to be

**The CSRF gap was found by accident.** [ADR-219](../decisions/ADR-219.md) found a binding
constitutional control with no implementation only because a transport slice happened to touch it.
The constitution's Appendix `D2` lists eleven controls and, before this file, nobody had checked
them as a set.

**SEARCH WIDE BEFORE CLAIMING ABSENCE, AND NAME THE SCOPE OF EACH SEARCH INSIDE THE CLAIM.** Every
absence below states what was searched. Where a search covers the whole repository, it is written as
`. --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=reviews`, which is every tracked file
plus the lockfile and every dotfile, and it is stated as such rather than as "absent". **The third
exclusion is this file's own directory**, so no count below can be satisfied by the sentence
asserting it; that is `RI-20`'s stated principle applied to a document `RI-20` does not read. Where a control's discharge could
only live in a deployment, the row says so and does not convert an unverifiable into a missing.

**A control may be discharged at the edge.** [`INFRA:27`](../architecture/INFRA.md) puts
*"Cloudflare in front of every origin"* with *"WAF, bot rules, rate limiting, DDoS, and the
admin-origin IP allowlist all land in one place"*, and [`INFRA:142`](../architecture/INFRA.md)
scopes secrets per service in a platform vault. **There is no infrastructure-as-code in this
repository at all**: `find . \( -name "*.tf" -o -name "wrangler.toml" -o -name "vercel.json" -o
-name "railway.json" -o -name "railway.toml" -o -name "fly.toml" -o -name "*.tfvars" -o -name
"Dockerfile" -o -name "docker-compose*" -o -name "nixpacks*" \) -not -path "*/node_modules/*" -not
-path "./.git/*"` returns nothing. **So every edge control in this audit is unverifiable from this
repository by construction, and that is a property of the repository rather than a fact about any
one control.** Four of the eleven rows below carry a deployment half for this reason.

---

## 1. The eleven, and how the list was derived

[`MERIT_BUILD_MASTER_PROMPT.md:282`](../../MERIT_BUILD_MASTER_PROMPT.md) is one sentence under the
heading `### D2. Application controls (binding)` at line 281. It is semicolon-delimited, and the
eleven clauses are the eleven controls. They are numbered here in the order the constitution writes
them, and that numbering is this file's only invention.

| # | The constitutional words, quoted from `MERIT_BUILD_MASTER_PROMPT.md:282` |
|---|---|
| **D2-1** | *"Passwordless only (passkeys + OTP -- no password DB to stuff)"* |
| **D2-2** | *"short-lived httpOnly sessions, refresh rotation"* |
| **D2-3** | *"every query identity-scoped via a shared `scopedDb(identity)` accessor -- raw table access in app code forbidden and lint-enforced"* |
| **D2-4** | *"zod at every boundary"* |
| **D2-5** | *"parameterized queries only"* |
| **D2-6** | *"rate limits per IP+identity on auth/checkout/payout"* |
| **D2-7** | *"Turnstile on auth+checkout"* |
| **D2-8** | *"strict CSP/HSTS/frame-deny"* |
| **D2-9** | *"CSRF on cookie mutations"* |
| **D2-10** | *"semgrep + dependency-audit + secret-scanning as CI merge blockers"* |
| **D2-11** | *"secrets in platform vault, least scope, 90-day rotation calendar"* |

---

## 2. THE TABLE

Four columns, per the dispatch. **The fourth is the one that matters**: a comment leaning on a
control that does not exist is worse than a gap nobody claimed was filled.

| # | Where it is discharged | Evidence, with the scope of the search | **Does anything in the tree CITE it as a live control?** |
|---|---|---|---|
| **D2-1** passwordless | **The negative half YES, the positive half PARTLY.** No password anything; passkeys unwired; the OTP send arm unwired | No password table in 63 migrations; `passkeyRegisterOptions`, `passkeyRegisterVerify`, `passkeyLoginOptions`, `passkeyLoginVerify` and `elevate` are all `blocked(...)` on `NO_WEBAUTHN` at [`auth-backend.ts:1148`](../../apps/api/src/auth-backend.ts) to `:1156`; `requestOtp` is `blocked('requestOtp', NO_DELIVERY)` at [`auth-backend.ts:1142`](../../apps/api/src/auth-backend.ts). `verify` IS wired. Scope: `apps/**`, `packages/**` for the wiring; `packages/db/migrations/` for the schema | **Yes, and honestly.** Seven shipped files cite "no password table anywhere in this schema" and each is TRUE. The passkey citations name their own blocker rather than claiming the ceremony exists |
| **D2-2** short-lived httpOnly, refresh rotation | **httpOnly YES. Short-lived NO. Refresh rotation NO** | `HttpOnly; Secure; SameSite=Lax` at [`auth.ts:613`](../../apps/api/src/routes/auth.ts). `SESSION_LIFETIME_DAYS = 30` at [`auth-backend.ts:716`](../../apps/api/src/auth-backend.ts). No refresh endpoint exists, and the file says so: *"`API_CONTRACT` section 3 declares NO REFRESH ENDPOINT ... so nothing can rotate a session"* ([`auth-backend.ts:701`](../../apps/api/src/auth-backend.ts)). Scope: `apps/**`, `packages/**` | **Yes, and the citation is stale by design rather than by accident.** The `sessions` design record calls `expires_at` *"short-lived access, rotating refresh"* and `refresh_token_hash`'s comment says *"rotation on every refresh"*, both quoted at [`auth-backend.ts:699`](../../apps/api/src/auth-backend.ts); **the column exists, the rotation does not, and the file names the discrepancy rather than hiding it** |
| **D2-3** `scopedDb`, lint-enforced | **YES. FULLY DISCHARGED, and it is the strongest row in the audit** | `export function scopedDb(identityId: IdentityId)` at [`scoped-db.ts:266`](../../packages/db/src/scoped-db.ts). Lint: `merit/no-raw-db-client: 'error'` over `files: ['apps/**/*.ts', 'packages/**/*.ts']` with `ignores: ['packages/db/**']` at [`eslint.config.js:41`](../../eslint.config.js) to `:45`. A second, independent leg in semgrep: rule `merit-sql-from-interpolation` at [`.semgrep/merit.yml:82`](../../.semgrep/merit.yml). Scope: `apps/**`, `packages/**`, `eslint.config.js`, `.semgrep/**` | **Yes, in dozens of places, and every one of them is true.** This is what the other ten rows are being measured against |
| **D2-4** zod at every boundary | **NO, NOT AS ZOD.** Boundary validation exists and is hand-written | **`zod` is in NO `package.json`**: `grep -rn "zod" --include=package.json . --exclude-dir=node_modules` returns nothing across all 20 manifests. **It IS in the lockfile**, `zod@4.4.3` at [`pnpm-lock.yaml:2605`](../../pnpm-lock.yaml), reached ONLY as a transitive of `mutation-server-protocol@0.4.1` (the Stryker toolchain) at [`pnpm-lock.yaml:3981`](../../pnpm-lock.yaml). **No source file imports it**: zero `import` of `zod` across `apps/**` and `packages/**`, and after `pnpm install` no workspace package has a `node_modules/zod`, so an import would not resolve. What DOES validate is hand-written, e.g. `validateOtpRequest` at [`auth.ts:782`](../../apps/api/src/routes/auth.ts) | **YES, FIVE TIMES, AND THIS IS THE MOST DANGEROUS COLUMN IN THE TABLE.** [`events.ts:934`](../../apps/api/src/events.ts) *"Validated against the event's zod schema AT WRITE TIME"*; [`checkout.ts:22`](../../apps/api/src/routes/checkout.ts) *"Zod schema has no price field at all. THE ABSENCE IS THE CONTROL"*; [`amount.ts:20`](../../packages/psp/src/amount.ts) the same sentence again on the money path; [`types.ts:419`](../../apps/portal/src/api/types.ts) *"against a zod validator that lives at the write boundary"*; [`validate.ts:216`](../../packages/rules-engine/src/plan/validate.ts) *"the zod schema and the CV publish validations key off these names"*. **Two of the five are on the money path.** See section 4 for what each one actually rests on |
| **D2-5** parameterized queries only | **YES. FULLY DISCHARGED** | `grep -rIn "sql\.raw\|\.unsafe(\|client\.query(\|pool\.query(\|execute(\`" apps packages --include=*.ts` outside `/test/` returns nothing. The driver is imported in exactly one file, [`scoped-db.ts:51`](../../packages/db/src/scoped-db.ts) to `:61`, and `merit/no-raw-db-client` bans it everywhere else. Third leg: semgrep `merit-sql-from-interpolation`. Scope: `apps/**`, `packages/**` | **Yes, and truthfully.** The `.semgrep` rule's own message cites `scopedDb` and `SECURITY` section 9, and both exist |
| **D2-6** rate limits per IP+identity on auth/checkout/payout | **AUTH: schema only, no reader. CHECKOUT: a different control. PAYOUT: nothing. Sub-minute velocity is ASSIGNED TO THE EDGE and is unverifiable here** | `otp_send_budget` declares `scope_kind IN ('phone','ip','country','global')` at [`0029_phone_identity_and_auth.sql:392`](../../packages/db/migrations/0029_phone_identity_and_auth.sql), which IS "per IP+identity". **Nothing reads it**: every mention across `apps/**` and `packages/**` is a comment, a schema declaration or a test seed, and the one method that would spend the budget is `blocked` ([`auth-backend.ts:1142`](../../apps/api/src/auth-backend.ts)). Checkout's `RATE_LIMITED` at [`checkout.ts:1355`](../../apps/api/src/routes/checkout.ts) is `INV-M20-07`'s **wallet SPEND velocity**, a money control per identity, not a request rate limit per IP. `grep -n -i "rate.limit\|ratelimit\|throttle" apps/api/src/routes/payouts.ts apps/api/src/routes/wallet-withdrawals.ts apps/api/src/routes/wallet.ts` returns nothing. **The migration itself routes the fast half to the edge**: *"Sub-minute velocity belongs at the edge, where it can refuse a send before one is paid for"* ([`0029:382`](../../packages/db/migrations/0029_phone_identity_and_auth.sql)) | **Yes, once, and it is honest about its own scope.** [`auth.ts:53`](../../apps/api/src/routes/auth.ts) *"RATE LIMITS ARE DATA, AND NO NUMBER IN THIS FILE IS ONE"* and points at `otp_send_budget`. The claim is about where the numbers live and it is TRUE; it does not claim a reader exists |
| **D2-7** Turnstile on auth+checkout | **NO on both halves.** Auth carries the FIELD and never verifies it; checkout has no field at all | The token is declared at [`auth.ts:260`](../../apps/api/src/routes/auth.ts) and validated as *"must be a non-empty string"* at [`auth.ts:789`](../../apps/api/src/routes/auth.ts) **and is never used again**. `grep -rIn -i "siteverify\|TURNSTILE_SECRET" apps packages e2e scripts` returns nothing, so **no verification call to Cloudflare exists anywhere in the repository**. `grep -rIln -i "turnstile" apps/api/src/routes/checkout.ts apps/portal/src` returns only [`client.ts:510`](../../apps/portal/src/http/client.ts), a comment: **no checkout field and no browser widget**. Scope for `turnstile`: `. --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=reviews`, **12 files, of which two are shipped source (`auth.ts`, `portal/src/http/client.ts`), two are test files and eight are prose** | **Yes, once, as an established peer control.** [`client.ts:510`](../../apps/portal/src/http/client.ts) lists CSRF *"among the binding application controls, beside Turnstile and the CSP"*. Both of its two named peers are absent from this tree |
| **D2-8** strict CSP / HSTS / frame-deny | **NO. NOT ONE OF THE THREE HEADERS IS SET ANYWHERE IN THIS REPOSITORY.** Whether Cloudflare sets them is unverifiable from here | `grep -rIln "Content-Security-Policy\|contentSecurityPolicy\|content-security-policy" . --exclude-dir=node_modules --exclude-dir=.git` returns **1 file** and it is [`ALLOCATION.md`](../decisions/ALLOCATION.md), the dispatch row that commissioned this audit. `Strict-Transport-Security` over the same scope matches **one file, `ALLOCATION.md`, the same dispatch row**; the abbreviation `HSTS` matches **three, all prose**: the constitution, [`SECURITY.md:259`](../architecture/SECURITY.md) and `research/SECURITY_LANDSCAPE.md`. `X-Frame-Options\|frame-ancestors\|frameguard` over the same scope matches **zero files**; the constitution's own spelling `frame-deny` matches **two**, itself and the research dossier. Mechanically: all three `next.config.mjs` declare only `reactStrictMode` and `NEXT_TELEMETRY_DISABLED`, **none has a `headers()`**; there is **no `middleware.ts` in any app**; the only `reply.header` calls in `apps/api` are `Cache-Control`, `Set-Cookie` and `Retry-After`. **No test anywhere asserts any of the three**: `grep -rIn -i "content-security\|strict-transport\|x-frame" apps/*/test packages/*/test e2e` returns nothing | **YES, IN FIVE PLACES, ONE OF WHICH IS A BINDING MODULE INVARIANT.** [`M06:46`](../plans/M06-admin-ops-console.md) `INV-M6-02`: *"The admin origin shares no cookie, no CORS policy, and no CSP with any public surface"*. [`INFRA:71`](../architecture/INFRA.md): *"Cookie scope, CORS, and the CSP never span the two origins, so an XSS on the portal cannot reach the admin surface even in principle."* [`SECURITY.md:122`](../architecture/SECURITY.md) answers session fixation with *"httpOnly cookies, strict CSP"*. Four shipped `.ts` files restate the invariant: [`origin.ts:14`](../../apps/admin/src/origin.ts) and `:127`, [`client.ts:162`](../../apps/admin/src/http/client.ts), [`admin-reads.ts:237`](../../apps/api/src/routes/admin-reads.ts), [`client.ts:552`](../../apps/portal/src/http/client.ts). **A separation asserted "even in principle" rests on a header nothing in this repository sets** |
| **D2-9** CSRF on cookie mutations | **NO. Already found, already owned.** Session **412** holds it, live now | [ADR-219](../decisions/ADR-219.md) is the finding and this audit re-derived rather than inherited it. ADR-219's own command, re-run at `cc6a30b`: `grep -rn CSRF docs/architecture/SECURITY.md docs/architecture/API_CONTRACT.md` returns nothing, exit 1 -- **the claim HOLDS**. Over `apps/**` and `packages/**` the only adjacent artifact is `SameSite=Lax` at [`auth.ts:613`](../../apps/api/src/routes/auth.ts). **RECORDED AS OWED-AND-ASSIGNED AND NOT TOUCHED HERE** | Yes: [`client.ts:505`](../../apps/portal/src/http/client.ts) onward, and it is the model the other rows should be read against, because it cites the control **in order to refuse to fake it** |
| **D2-10** semgrep + dependency-audit + secret-scanning as CI merge blockers | **ALL THREE RUN. Whether they BLOCK MERGE is a branch-protection setting and is not in this repository** | Stage `CI-05 security static` at [`ci.yml:348`](../../.github/workflows/ci.yml). Secret scanning: `gitleaks git . --redact --no-banner --exit-code 1` at [`ci.yml:439`](../../.github/workflows/ci.yml) and `gitleaks dir .` at `:442`. semgrep: `:458`, over `.semgrep/merit.yml` plus `p/typescript` and `p/secrets` with `--error`. Dependency audit: `pnpm audit --audit-level=moderate` at `:469`, plus a syft SBOM and a grype scan at `--fail-on medium`. **`grep -n "continue-on-error" .github/workflows/*.yml` returns nothing, so no step is advisory.** Scope: `.github/**`, `.semgrep/**` | **Yes, and truthfully.** `.semgrep/merit.yml` cites `CI-05` and each rule cites the document it enforces; all three exist |
| **D2-11** secrets in platform vault, least scope, 90-day rotation calendar | **VAULT AND SCOPE: a deployment property, unverifiable from here. CALENDAR: discharged as a docs artifact. ONE IN-TREE LEG OF `INFRA` SECTION 7 IS FALSE** | [`INFRA:142`](../architecture/INFRA.md) states the vault and the per-service scope; nothing in this repository can confirm or refute it, and there is no IaC to read. The calendar exists: *"Secret rotation \| 90 days \| Vault inventory against the rotation calendar"* at [`CRON_INVENTORY.md:94`](../ops/runbooks/CRON_INVENTORY.md). One rotation mechanism IS in code: `MERIT_OTP_MAC_KEY` and `MERIT_OTP_MAC_KEY_RETIRING`, with the retiring key refused when it equals the live one, at [`auth-backend.ts:430`](../../apps/api/src/auth-backend.ts). **AND: [`INFRA:145`](../architecture/INFRA.md) says *"`.env` files are gitignored and CI verifies it rather than trusting it (VG-1)"*. Both halves are false. `.gitignore` is 59 lines and has no `.env` entry; `git check-ignore -v .env` exits non-zero for `.env` and for `apps/api/.env`; and `grep -rIn "gitignore" scripts packages/tooling .github` finds nothing that reads `.gitignore`.** Scope: `.gitignore` (the only one in the repository), `.github/**`, `scripts/**`, `packages/tooling/**` | **Yes, and one citation is false.** `INFRA:145` cites `VG-1` as verifying a gitignore entry. `VG-1` is gitleaks, which scans content for secrets and reads no `.gitignore`. **Nothing in this repository stops a `.env` from being committed except gitleaks noticing what is inside it** |

---

## 3. The count, stated plainly

**Eleven measured. Seven settled from this repository alone. Four carry a deployment half this
repository cannot see, and for all four the IN-TREE half is settled.**

| Bucket | Rows | Which |
|---|---|---|
| **Settled from the repository alone** | 7 | D2-1, D2-2, D2-3, D2-4, D2-5, D2-7, D2-9 |
| **In-tree half settled, deployment half unverifiable** | 4 | D2-6 (edge velocity), D2-8 (Cloudflare headers), D2-10 (branch protection), D2-11 (vault and scope) |
| **Not measured at all** | 0 | -- |

**Fully discharged: 2 of 11** (D2-3, D2-5). **Absent from the tree with nothing standing in for
them: 3** (D2-7, D2-8, D2-9). **Partial: 6** (D2-1, D2-2, D2-4, D2-6, D2-10, D2-11).

**Cited in the tree as a live control while absent from it: 4** -- D2-2's refresh rotation, D2-4's
zod, D2-7's Turnstile, D2-8's CSP. **That is the column that matters and it is a third of the
appendix.**

---

## 4. The zod row, because a citation is not a finding until you read what it rests on

**The dispatcher's probe was right that `zod` is in no `package.json` and wrong to stop there.** It
is in the lockfile, and it arrives from Stryker. Each of the five citations rests on something
different, and lumping them together would be the error this audit exists to avoid.

| Citation | What it says | What actually stands there |
|---|---|---|
| [`events.ts:934`](../../apps/api/src/events.ts) | *"Validated against the event's zod schema AT WRITE TIME"* | **A quotation of a migration comment, correctly attributed.** The sentence continues *"and `buildEvent` is that validation for the eight rows this tree produces"*, so the file names its OWN validator as the thing discharging the migration's claim. **The comment is honest. The MIGRATION's claim is the one with no zod behind it** |
| [`checkout.ts:22`](../../apps/api/src/routes/checkout.ts) | *"Zod schema has no price field at all. THE ABSENCE IS THE CONTROL."* | **A quotation of `INV-M3-02`'s enforcement column.** What actually enforces it in this tree is structural: `CheckoutRequest` declares five members and no price, so there is no path from the body to a price. **The control holds; the sentence naming it names a schema that does not exist** |
| [`amount.ts:20`](../../packages/psp/src/amount.ts) | the same `INV-M3-02` sentence, on the money path | Same shape, and the file says so: *"WHAT IS HONOURED INSTEAD IS THE RULE'S REASON."* **It explicitly declines to rely on the zod schema and rebuilds the guarantee out of a type with one producer** |
| [`types.ts:419`](../../apps/portal/src/api/types.ts) | *"against a zod validator that lives at the write boundary"* | **This one asserts the validator EXISTS, as the reason the portal declines to declare a second copy of the rule schema.** The refusal is right for other reasons stated in the same comment; the reason given is not true of this tree |
| [`validate.ts:216`](../../packages/rules-engine/src/plan/validate.ts) | *"the zod schema and the CV publish validations key off these names"* | **A quotation of [`0004_catalog.sql`](../../packages/db/migrations/0004_catalog.sql), correctly attributed, and the CV half is what this file IS.** The zod half has no implementation |

**The pattern is one thing and it is not five defects.** Four of the five are faithful quotations of
a corpus document that names zod, and the corpus documents that name it are frozen. **The defect is
upstream of every citation, and it is FOUR corpus documents rather than five source files**:

- [`0004_catalog.sql:63`](../../packages/db/migrations/0004_catalog.sql) -- *"validated by zod at the"* write boundary, on `plan_versions.rules`
- [`0017_events_and_audit.sql:49`](../../packages/db/migrations/0017_events_and_audit.sql) -- *"Validated against the event's zod schema AT WRITE TIME."*
- [`M03:52`](../plans/M03-billing-checkout.md) `INV-M3-02` -- *"Zod schema has no price field at all. The absence is the control"*
- [`API_CONTRACT:11`](../architecture/API_CONTRACT.md) -- *"Schemas are written as TypeScript types because they map one to one onto the zod validators that enforce them at runtime"*, and [`:35`](../architecture/API_CONTRACT.md) *"OpenAPI. Generated from the same zod schemas."*

**Two of those four are migrations, which are never edited (constitution E2), and the other two are
approved corpus documents, which move by ADR.** The shipped files quote them correctly.
`types.ts:419` is the one that asserts rather than quotes.

**Nothing here is repaired.** A migration is never edited (constitution E2) and the corpus moves by
ADR. **What is owed is a decision about D2-4 itself**, and it is not this row's.

---

## 5. The dispatcher's probe: what held and what did not

**Three claims were handed to this session as a probe. Re-derived, two hold with a correction and
one is refuted as stated.**

| The probe's claim | Verdict |
|---|---|
| *"`Content-Security-Policy` and `Strict-Transport-Security`: zero files across the entire repository"* | **HOLDS for the header spellings and is REFUTED as a statement about the controls.** `Content-Security-Policy` matches exactly one file, `ALLOCATION.md`, which is the probe's own row. But `\bCSP\b` over `. --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=reviews` matches **17 files including four shipped `.ts`**, and `HSTS` matches three. **The header is nowhere; the control is cited in five places including a binding invariant. Reporting "zero files" would have missed the entire finding** |
| *"`zod` is not a dependency in any `package.json`"* | **HOLDS**, across all 20 manifests. **Corrected in one respect that matters**: it IS in `pnpm-lock.yaml` as a Stryker transitive, so a search of the lockfile alone would have reported it present. Section 4 above |
| *"a control cited as a reason and never installed ... the most dangerous instance of it yet"* | **The class is real and D2-4 is NOT its most dangerous instance.** D2-8 is. Four of the five zod citations are faithful quotations whose local guarantee holds by other means; **`INV-M6-02` is a binding invariant asserting an origin separation that holds "even in principle" on the strength of a CSP nothing in this repository sets, and no test anywhere asserts any security header** |

**And the dispatch's own count was checkable and was carried forward.** [`DISPATCH_PROTOCOL:49`](../DISPATCH_PROTOCOL.md) says the invariant runner *"was 18 when this row was last repaired"*. Run at `cc6a30b`, `node packages/tooling/checks/repo-invariants.mjs` reports **`19 of 19 invariants hold.`** on its last line. Derived, not carried.

---

## 6. What this audit found that was not in the dispatch

1. **`.env` is not gitignored and nothing verifies that it is**, while [`INFRA:145`](../architecture/INFRA.md) asserts both. Evidence in the D2-11 row. This is an in-tree, checkable, false claim in an approved architecture document, and it sits under the section discharging D2-11.
2. **`INV-M6-02` is the sharpest instance of the cited-and-absent class in the tree**, and it is a module INVARIANT rather than a comment. D2-8's fourth column.
3. **`otp_send_budget` already models "per IP+identity" correctly and has no reader**, because the method that would spend it is blocked on delivery. D2-6. The control's hard part -- deciding the scopes -- is done.
4. **`packages/psp/src/amount.ts:20` is a fifth zod citation** the dispatch did not name, and it is on the money path.
5. **The repository holds no infrastructure-as-code of any kind.** Every edge and platform control in `D2` and `D3` is therefore unverifiable from here, permanently, until that changes. This is worth knowing before the next audit re-discovers it.
6. **No test in the repository asserts any security header**, so none of D2-8 would fail if it were added and later removed.

---

## 7. What is owed, and to whom

**Nothing below is taken by this session. This is a register, not a plan.**

| Owed | Fence it belongs to |
|---|---|
| **D2-9, CSRF on cookie mutations** | **Session 412, live now.** [ADR-219](../decisions/ADR-219.md) is the finding. Not touched here |
| **D2-8, the three headers** | `apps/**` (a `headers()` in three `next.config.mjs`, or a Fastify hook) AND the edge. Whoever takes it must also decide whether `INV-M6-02` is discharged in the tree or at Cloudflare, because today it is discharged nowhere |
| **D2-7, Turnstile verification** | `apps/api` for the siteverify call, `apps/portal` for the widget, `apps/api/src/routes/checkout.ts` for the field that does not exist |
| **D2-4, zod** | A corpus decision, not a code change. Four frozen documents name it. Either the dependency is admitted under `VG-12` or the corpus is amended to name what actually validates |
| **D2-2, refresh rotation** | `API_CONTRACT` first: there is no endpoint to implement against. The 30-day lifetime already carries a founder read owed on the number ([`auth-backend.ts:695`](../../apps/api/src/auth-backend.ts)) |
| **D2-6, a reader for `otp_send_budget`** | Blocked behind `NO_DELIVERY`. It arrives with delivery or not at all |
| **`INFRA:145`, the `.env` claim** | An approved document, so an ADR. The tree-side repair (one `.gitignore` line, one check) is trivial and is **deliberately not taken here**: the fence is `docs/reviews/` |

---

## 8. Why this file takes no ADR number

**`ADR-222` is returned to the pool unspent.** The dispatch reserved it conditionally and said to
take it only if the audit needs a ruling. **It does not.** Every finding above is either a
measurement, which needs no ruling, or a repair owned by a fence this session does not hold. The
constitution already rules all eleven controls binding; nothing in this audit disputes that, and a
table that rules nothing is the correct outcome for a measurement session.

**What a founder read adds.** The ordering in section 7 is a judgement and is the thing worth
disagreeing with. This file treats **D2-8 as more urgent than D2-4**, on the ground that a binding
invariant asserting a separation "even in principle" is a stronger false claim than four correct
quotations of a frozen document. A reader who weighs the money path above the admin origin would
order them the other way, and that position is defensible.

---

## 9. Commands this file quotes, and what they actually returned

Every command below was run at `cc6a30b` from the repository root, after `pnpm install`.

| Command | Result stated |
|---|---|
| `node scripts/corpus/gates.mjs generate` then `check` | last line `33 of 33 gates pass.` |
| `node packages/tooling/checks/repo-invariants.mjs` | last line `19 of 19 invariants hold.` |
| `grep -rn CSRF docs/architecture/SECURITY.md docs/architecture/API_CONTRACT.md` | no output, exit 1 |
| `grep -rIln "Content-Security-Policy" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=reviews` | 1 line, `./docs/decisions/ALLOCATION.md` |
| `grep -rIln "X-Frame-Options\|frame-ancestors\|frameguard" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=reviews` | no output |
| `grep -rn "zod" --include=package.json . --exclude-dir=node_modules` | no output |
| `grep -n "continue-on-error" .github/workflows/ci.yml` | no output |
| `git check-ignore -v .env` | no output, non-zero exit |
