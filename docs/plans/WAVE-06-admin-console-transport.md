---
status: draft
depends_on:
  [
    ../STATE.md,
    ../DELIVERY_PLAN.md,
    ../decisions/ALLOCATION.md,
    ../architecture/INFRA.md,
    ../architecture/API_CONTRACT.md,
    M06-admin-ops-console.md,
    P5-payouts-and-wallet.md,
    P6-live-tier.md,
    P7-risk-and-abuse.md,
    ../decisions/ADR-012.md,
    ../decisions/ADR-083.md,
    ../decisions/ADR-095.md,
    ../decisions/ADR-171.md,
  ]
last_updated: 2026-08-30
---

# WAVE-06: `apps/admin` acquires a transport, and the central question is answered by an approved document rather than by this plan

**A wave plan, not a module plan.** It carries no design of its own and takes no ruling. It is the
partition, the slice table and the collision table for the sessions that give the operator console a
way to be reached, written so a prompt is pasted into a fresh session and a pull request is read.

**Every claim below was measured on `8742c3b`, which is `origin/main`, rather than inherited from the
dispatch that commissioned it.** Where a dispatch claim did not survive, section 6 says so beside the
measurement that refuted it. Two did not survive.

---

## 0. THE NAME, AND WHY THIS IS NOT `P8`

**The dispatch asked for `docs/plans/P8-admin-server.md` and invited an argument for a different name.
This is that argument, and it is a collision rather than a preference.**

**`P8` IS TAKEN, BY A PHASE WITH STATED CONTENTS THAT ARE NOT THESE.**
[DELIVERY_PLAN:132](../DELIVERY_PLAN.md) rows **`P8 Hardening`**, weeks _"15 to 16, plus 3 to 5 days"_,
whose contents are _"Idempotency chaos, load sanity, the security pass and the D0 battery, the runbooks
rehearsed rather than read, the real Rithmic test environment, the CME TPAP prerequisites checklist"_
plus [M15](M15-discord-integration.md)'s partial scope. [P6](P6-live-tier.md) section 6 already cites it
by that name three times, calling `GS-133` _"P8's D0 battery"_, and [M15](M15-discord-integration.md)'s
own surface table rows `RS-M15-01` and `RS-M15-03` at **P8**.

**AND THE `P<n>-` FILENAME SERIES IS THAT TABLE, ONE FILE PER PHASE.**
`P1-monorepo-scaffold`, `P2-rules-engine`, `P3-ledger-billing-identity`, `P4-portal-and-site`,
`P5-payouts-and-wallet`, `P6-live-tier`, `P7-risk-and-abuse`. Seven names against seven rows, in order.
A `P8-admin-server.md` would put a second, different meaning on the eighth row of a table every other
`P<n>-` file transcribes, which is exactly the registry collision [ADR-034](../decisions/ADR-034.md)
exists about, arriving in a filename instead of an identifier.

**AND THIS WORK IS NOT A NEW PHASE. IT IS THE MISSING TRANSPORT UNDER TWO PHASES THAT ALREADY NAME IT.**
[DELIVERY_PLAN:129](../DELIVERY_PLAN.md) makes _"the admin liability dashboard including wallet balances,
the event feed"_ part of **P5's contents**, and [DELIVERY_PLAN:131](../DELIVERY_PLAN.md) makes _"the flags
queue, two-tier evidence packs"_ part of **P7's**. Both bodies of arithmetic exist in `apps/admin` today
and neither can be reached. So this is a cross-phase wave and the corpus has a name for that shape:
[WAVE-01](WAVE-01-post-freeze-parallel-sessions.md), [WAVE-03](WAVE-03-duplicate-registry-keys.md),
[WAVE-04](WAVE-04-fixture-backlog-and-gate-inventory.md) and
[WAVE-05](WAVE-05-tier2-fixture-shapes.md) each open with the same sentence this one opens with.

**`WAVE-06` IS THE NEXT FREE NUMBER AND `WAVE-02` IS SPENT RATHER THAN FREE.** No `WAVE-02` document
exists under `docs/plans/`, and the number is not available: [ALLOCATION](../decisions/ALLOCATION.md)
row `060` names _"WAVE-02 session A2"_, so a wave ran under that number and its plan is missing rather
than never taken. Reusing it would put a second wave on a number the allocation table already reads.

---

## 1. The tree, measured

**Every figure here was produced by a command on `8742c3b` with `pnpm install` run first, and each
command was run separately. `pnpm run verify` was not run.**

| Measurement                            | Command                                                                                         | Result                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Gates                                  | `node scripts/corpus/gates.mjs generate && node scripts/corpus/gates.mjs check`                 | **33 of 33**                                      |
| Invariants                             | `node packages/tooling/checks/repo-invariants.mjs`                                              | **15 of 15**                                      |
| Tests                                  | `pnpm exec vitest run`                                                                          | **212 files, 4,981 passed, 6 skipped**            |
| `apps/admin` source                    | `wc -l apps/admin/src/*.ts`                                                                     | **2,802 lines across 9 files**                    |
| `apps/admin` tests                     | `pnpm exec vitest run --project unit apps/admin`                                                | **8 files, 200 passed**                           |
| Any HTTP primitive in `apps/admin/src` | `grep -rnE "createServer\|\.listen\(\|node:http\|fastify\|express\|Response\|Request\|fetch\("` | **nothing at all**                                |
| `apps/admin` manifest scripts          | `apps/admin/package.json`                                                                       | `typecheck` and `start`. **No `build`, no `dev`** |
| Operator surface routes                | `compose(app, 'operator', await discoverRouteModules())`                                        | **26 modules, 27 registered, 45 withheld**        |
| Public surface routes                  | the same over `'public'`                                                                        | **26 modules, 46 registered, 26 withheld**        |

**`main()` prints and returns.** [`index.ts:131`](../../apps/admin/src/index.ts) is
`export function main(): void` and its body is one `console.log` reading
_"merit admin: liability home read surface, no server yet"_. Its own docstring at
[`index.ts:126`](../../apps/admin/src/index.ts) says _"there is no server here to receive a request
carrying them"_. **The file has been honest the whole time and this plan adds nothing to that finding**;
it sizes the work the finding implies.

---

## 2. What the 2,802 lines ARE, because they are not a shell

**Nine modules with 200 passing tests is real work and the plan is written against what is in them.**
Read module by module rather than counted.

| Module                                                        | Lines | What it is                                                                                                                                                                                                                                                                                                                                              | Reusable behind a transport                                                                           |
| ------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [`liability.ts`](../../apps/admin/src/liability.ts)           | 641   | `AS-M6-04`'s three numbers (`theThreeNumbers`, `:151`), the adversarial order (`inAdversarialOrder`, `:246`), and `P-M6-07`'s reserve coverage with float rendered beside reserve and never inside it (`reserveCoverage`, [`:544`](../../apps/admin/src/liability.ts))                                                                                  | **Yes, in full.** It is a pure fold over a snapshot row                                               |
| [`page.ts`](../../apps/admin/src/page.ts)                     | 649   | The liability home assembled (`buildLiabilityHome`, [`:391`](../../apps/admin/src/page.ts)), its line rendering ([`renderLiabilityHome:630`](../../apps/admin/src/page.ts)), and two invariant assertions: [`assertNamesNoSubject:219`](../../apps/admin/src/page.ts) for `INV-M6-10` and [`assertFloatIsNotReserve:263`](../../apps/admin/src/page.ts) | **The builder yes, the renderer conditionally.** Section 5.2                                          |
| [`feed.ts`](../../apps/admin/src/feed.ts)                     | 507   | `M06` section 1.1's fifth surface. Two modes, operational and subject-named; withholding on the SHAPE of a payload key rather than on a column list ([`buildFeed:306`](../../apps/admin/src/feed.ts)); every withheld value carries the word in the line ([`assertWithheld:498`](../../apps/admin/src/feed.ts))                                         | **Yes, and it is the module with no route, no contract row and no barrel export.** Sections 4 and 5.1 |
| [`figure.ts`](../../apps/admin/src/figure.ts)                 | 284   | `INV-M6-04`'s obligation as a type: a number carries its as-of and its source or it is a stated absence                                                                                                                                                                                                                                                 | **Yes**                                                                                               |
| [`data-trust.ts`](../../apps/admin/src/data-trust.ts)         | 190   | `P-M6-09`, whose verdict every panel below inherits, with a missing signal naming its owner                                                                                                                                                                                                                                                             | **Yes**, and it needs five suppliers no route supplies                                                |
| [`live-liability.ts`](../../apps/admin/src/live-liability.ts) | 172   | Section 3.5's live figure, suppressed on red trust and refused to `authoritative()`                                                                                                                                                                                                                                                                     | **Yes**, and it is [`P6-j`](P6-live-tier.md)'s to give a producer                                     |
| [`origin.ts`](../../apps/admin/src/origin.ts)                 | 147   | [ADR-012](../decisions/ADR-012.md)'s placeholder resolved from the environment ([`resolveAdminOrigin:104`](../../apps/admin/src/origin.ts)), with `INV-M6-02` checked as a cookie-domain containment relation against `SITE_ORIGIN` and `PORTAL_ORIGIN`                                                                                                 | **Yes, and section 5.3 is why it is the piece a separate-origin plan leans hardest on**               |
| [`roles.ts`](../../apps/admin/src/roles.ts)                   | 79    | `API_CONTRACT` section 8's closed set ([`ADMIN_ROLES:52`](../../apps/admin/src/roles.ts)) and a refusal with no default                                                                                                                                                                                                                                 | **Yes**, and it resolves a role STRING. Nothing produces one                                          |
| [`index.ts`](../../apps/admin/src/index.ts)                   | 133   | The barrel, and `main()`                                                                                                                                                                                                                                                                                                                                | **It is a slice's subject rather than an input.** Section 5.1                                         |

**SO THE SPLIT IS NOT "SHELL VERSUS SERVER". IT IS "ARITHMETIC BUILT, EVERY INPUT AND EVERY OUTPUT
MISSING".** Every module above takes values and returns values. What no module has is a way to receive
the values or to emit anything a browser can render: no wire types, no client, no route, no document.
That is the same division [P6](P6-live-tier.md) section 1 found one phase over, where _"every piece that
is ARITHMETIC or a TYPE is built while every piece that is a CONTAINER, a TRANSPORT or a STORE is in no
document a session can build from."_ **`apps/admin` is that finding with the arithmetic denser and the
transport at zero.**

### 2.1 Which of `M06`'s surfaces have console-side code

| `M06` surface                | Console code                                            | Operator route                                                         | Port method                     | Adapter                                                                                                                        |
| ---------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **3.1 liability home**       | `page.ts`, `liability.ts`, `figure.ts`, `data-trust.ts` | `GET /admin/liability` **registered**                                  | `readLiability`                 | **none.** [`P5-l`](P5-payouts-and-wallet.md)'s                                                                                 |
| **3.5 live Open Liability**  | `live-liability.ts`                                     | none                                                                   | none                            | **none.** [`P6-j`](P6-live-tier.md)'s, behind `P6-g`                                                                           |
| **the event feed**           | `feed.ts`                                               | **NO ROUTE**                                                           | **NO PORT METHOD**              | none. Section 4                                                                                                                |
| **3.2 account drill-down**   | **none**                                                | `GET /admin/accounts`, `GET /admin/accounts/:accountId` **registered** | `searchAccounts`, `readAccount` | **none, and no plan claims either.** Section 6 finding 2                                                                       |
| **3.2a identity drill-down** | **none**                                                | `GET /admin/identities/:identityId/graph` **registered**               | `readIdentityGraph`             | **composed** ([`P7-i`](P7-risk-and-abuse.md))                                                                                  |
| **3.3 flags queue**          | **none**                                                | `GET /admin/flags`, `POST /admin/flags/:flagId/status` **registered**  | `listFlags`                     | **composed** ([`P7-i`](P7-risk-and-abuse.md))                                                                                  |
| **the evidence pack**        | **none**                                                | `GET /admin/evidence/:accountId` **registered**                        | `exportEvidence`                | **module written** ([`P7-j`](P7-risk-and-abuse.md), [`admin-source/evidence.ts`](../../apps/api/src/admin-source/evidence.ts)) |

**THE ONE SURFACE WITH BOTH HALVES BUILT HAS NEITHER A SCREEN NOR A SESSION.** The flags queue has a
registered route, a composed adapter and no console code at all; the liability home has 1,764 lines of
console code, a registered route and no adapter. **The two halves of this module were built by different
phases against the same document and they do not meet anywhere.**

---

## 3. THE CENTRAL QUESTION, AND IT IS ANSWERED BY AN APPROVED DOCUMENT

**The dispatch called this the plan's central question and asked for an argued answer rather than a
default. The argument is short, because the answer is already ruled and the work is to cite it rather
than to take it.**

> **`apps/admin` SERVES HTTP, AND IT NEVER SERVES `/api/v1`. THE OPERATOR JSON API IS `apps/api` AT
> `MERIT_API_SURFACE=operator`, AND BOTH RUN ON `ADMIN_ORIGIN`.**

[INFRA section 2.1](../architecture/INFRA.md) rows six services, and two of them are this question:

- [`INFRA:43`](../architecture/INFRA.md): service **`admin`**, codebase `apps/admin`, `MERIT_API_SURFACE`
  **not set**, origin **`ADMIN_ORIGIN`**, serving _"The operator console"_.
- [`INFRA:44`](../architecture/INFRA.md): service **`api-admin`**, codebase `apps/api`,
  `MERIT_API_SURFACE` **`operator`**, origin **`ADMIN_ORIGIN`, under `/api/v1`**, serving
  _"API_CONTRACT sections 8 and 9, selected by the `/admin` and `/internal` path prefixes"_.

[`INFRA:53`](../architecture/INFRA.md) states the routing rule: _"Two services share each public-facing
origin, so Cloudflare routes by path. `/api/v1/*` reaches `api` on `app.meritfutures.com` and `api-admin`
on `ADMIN_ORIGIN`; everything else reaches `portal` and `admin` respectively."_ And
[`INFRA:71`](../architecture/INFRA.md), hard rule 3, says it again from the security side: _"Two services
run on `ADMIN_ORIGIN`, a separate apex domain: the admin console (`admin`) and the operator API
(`api-admin`)."_

**SO `OPERATOR_PREFIXES` IS NOT THE ALTERNATIVE TO THIS PLAN, IT IS THE OTHER HALF OF IT.**
[`surface.ts:69`](../../apps/api/src/surface.ts) holds `/admin` and `/internal`, and the operator surface
already registers **27 routes** over them (section 4). Those routes are the console's data source. What
the console is missing is the half `api-admin` does not serve and must not: a rendered document at
`ADMIN_ORIGIN`.

### 3.1 Three mechanisms already refuse the other shape, and none of them is new

| Mechanism                                                                                                                                                                 | What it refuses                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`RI-04`** ([`repo-invariants.mjs:407`](../../packages/tooling/checks/repo-invariants.mjs), over [`DEPLOYABLES:403`](../../packages/tooling/checks/repo-invariants.mjs)) | `apps/admin` importing `apps/api`. So the console cannot reach the operator handlers in-process and must be a network client of them, which is the property that makes them one API rather than two |
| **`RI-09`** ([`repo-invariants.mjs:1318`](../../packages/tooling/checks/repo-invariants.mjs))                                                                             | A file under any deployable but `apps/api` whose PATH spells a route on the API surface. So `apps/admin/src/app/api/v1/...` fails a merge blocker rather than a review                              |
| **`RI-11`** ([`ui-server-endpoints.mjs:168`](../../packages/tooling/checks/ui-server-endpoints.mjs))                                                                      | A Server Action anywhere, with no exemption, and a framework routing config spelling the API base path or an operator prefix                                                                        |

**AND THE ALTERNATIVE WOULD COST A RULING RATHER THAN A LINE.** Putting the console's HTML on
`apps/api` means one deployable serving both the operator API and the operator UI, which is
[ADR-083](../decisions/ADR-083.md) section 3's _"a surface that CONTAINS the API has a privileged back
door by construction"_ taken deliberately, and it would make [`INFRA:43`](../architecture/INFRA.md)'s
`admin` row false. **That is an amendment to an approved document and this wave does not need one.**

### 3.2 What IS undecided, and it is one ruling rather than the question above

**The framework.** [ADR-095](../decisions/ADR-095.md) ruling 2 admits Next.js App Router for
`apps/portal` and `apps/site` and says in its own words: _"`apps/api` gets none, which is ADR-083's
ruling and not this one's, and **`apps/admin` gets none by this entry**: the admin console is M06's and
is in no P4 slice, so an entry whose fence is P4 `P4-c` may not decide it."_ Its foreclosure `F1` names
the consequence: _"`apps/admin` is not ruled here and in practice is now decided: a second framework
means a second toolchain, a second slop-score harness and a second set of design tokens."_

**So the one ruling this wave needs is which framework `apps/admin` renders in, and the honest reading is
that `ADR-095` has already made every argument for the answer and deliberately withheld the signature.**
[`playwright.config.ts:11`](../../playwright.config.ts) records the same absence from the third side:
_"`apps/admin` is the third UI surface and it has no fixture here: it is in no P4 slice at all, ADR-095
declined to rule its framework for that reason."_ `W6-a` is that ruling and it is the only slice in this
wave that REQUIRES an ADR number.

**IT IS TAKEN. [ADR-182](../decisions/ADR-182.md) LANDED ON 2026-08-28 AND IT RULED TWO THINGS RATHER
THAN ONE.** The framework is Next.js App Router, which is what this section anticipated. **What this
section did NOT do is argue the question underneath it, and the entry did**: it treats _"should
`apps/admin` serve HTTP at all"_ as live, answers YES, and prices the two shapes that lose. **The
strongest thing in it is not in this plan.** [ADR-095](../decisions/ADR-095.md) ruling 3 forbids a UI
serving `/api/v1` or an operator path and **two mechanical checks enforce it**, `RI-09` over PATHS and
`RI-11` over a routing CONFIG and a directive. A hand-rolled `node:http` console has neither: its paths
are string literals inside a handler and it has no config file, and `RI-09`'s own `covers` names that
shape at [`repo-invariants.mjs:1334-1335`](../../packages/tooling/checks/repo-invariants.mjs), _"a
hand-written router table declares nothing this check can find."_ **So the no-framework alternative is
the one shape in which both mechanical halves of ruling 3 go silent in the deployable
[SECURITY](../architecture/SECURITY.md) treats as total loss when owned.**

---

## 4. What the operator surface actually registers, over a real `compose()`

**`CompositionReport.registered` was produced rather than grepped, because a grep over route files has
been wrong twice.** [`registry.ts:250`](../../apps/api/src/registry.ts) declares the report and
[`registry.ts:284`](../../apps/api/src/registry.ts) is `compose`. Run over
`discoverRouteModules()` on `8742c3b`, the `operator` surface registers **27** and withholds **45**:

```
GET  /admin/accounts                       GET  /internal/health/deep
GET  /admin/accounts/:accountId            GET  /internal/jobs
GET  /admin/cusum                          GET  /internal/recon/status
GET  /admin/eligible-forecast              POST /admin/accounts/:accountId/close
GET  /admin/evidence/:accountId            POST /admin/accounts/:accountId/freeze
GET  /admin/flags                          POST /admin/accounts/:accountId/note
GET  /admin/identities/:identityId/graph   POST /admin/accounts/:accountId/unfreeze
GET  /admin/liability                      POST /admin/certificates/:id/revoke
GET  /admin/loss-ratios                    POST /admin/flags/:flagId/status
GET  /admin/wallet/reconciliation          POST /admin/payouts/:id/enforce
GET  /health                               POST /admin/payouts/:id/release
                                           POST /admin/plans/:planId/versions
                                           POST /admin/plans/versions/:versionId/publish
                                           POST /admin/wallet/:identityId/correct
                                           POST /admin/wallet/:identityId/spend-limit
                                           POST /internal/batch/run
```

**THE DISPATCH SAID 24 AND IT IS 27.** The figure is 26 under an operator prefix plus `GET /health`,
which both surfaces serve. The public surface registers 46, and the union is
`46 + 27 - 1 = 72` distinct `METHOD /path`, which agrees with the count [STATE](../STATE.md) records for
2026-08-28. **No number here is quoted from a record; each was produced by the run above.**

### 4.1 What is registered is not what answers

**Every registered operator route answers 401 `unauthenticated` to an anonymous caller, and nothing this
console can reach answers 503 before authenticating** (amended by [ADR-190](../decisions/ADR-190.md), then by
[ADR-192](../decisions/ADR-192.md); section 8.1 below carries ADR-190's measurement in full and it is the
document of what the surface did before that second entry moved it).

**What a caller CARRYING a cookie meets NO LONGER splits by module, and this paragraph is amended in place
rather than replaced** ([ADR-343](../decisions/ADR-343.md), `RI-14`). It read: _"What a caller CARRYING a
cookie meets still splits by module, and that half did not move. The routes served by `admin-reads.ts`'s
shared `adminHandler`, which is the family every screen in this wave reads, answer 500 `internal_error`,
because `AdminReadSource` is a port nothing wires."_ **The measurement was right and the diagnosis named the
wrong port.** What threw on a presented cookie was the SESSION source, one port earlier
([`setAdminSessionSource`](../../apps/api/src/routes/admin-reads.ts)), which is why the 500 arrived on all
ten of those routes whether or not the screen behind them read anything. ADR-343 clause 1 rules that an
unwired session source resolves to `unknown` rather than throwing, so **those ten routes now answer 401
`unauthenticated` to a cookie exactly as they do to an anonymous caller**, and a console rendering this
wave's screens meets one answer instead of two. The port citations are repointed at the same time:
([`AdminReadSource:1096`](../../apps/api/src/routes/admin-reads.ts),
[`setAdminReadSource:1140`](../../apps/api/src/routes/admin-reads.ts)). The routes served by the four write
backends answer **503 `service_unavailable`**, which ADR-192 clause 1 KEPT on the ground that those four
classes carry one fact each: _no backend is installed_. What ADR-192 clause 2 changed is the ORDER, moving
that 503 behind the 401 so an anonymous caller is no longer told which of this deployment's ports are
uncomposed. **NEITHER SIDE OF THE PARTITION IS COUNTED HERE AND THAT IS DELIBERATE**:
[ADR-190](../decisions/ADR-190.md) section 5 holds it and pins no cardinal, on its own ground that a slice
wiring a backend moves a route between the sets, so a figure written down here would go false for the right
thing happening.
[`wiring.test.ts:1749`](../../apps/api/test/wiring.test.ts) pins the triple at
`{ declared: 25, wired: 11, blocked: 14 }`. **Both the citation and the triple are repointed rather than
left** ([ADR-343](../decisions/ADR-343.md), `RI-14`): this line read `wiring.test.ts:457` and
`{ declared: 23, wired: 6, blocked: 17 }`, and then `wiring.test.ts:1554` and
`{ declared: 24, wired: 10, blocked: 14 }`, which was the triple ADR-184 section 8 confirmed unmoved and
which twelve wiring slices have moved since. **ADR-343 installs no port, so it does not move it either**;
the value is re-derived at the assertion rather than carried, which is the whole of `ADR-034`'s remedy.

**AND THE SECOND REPOINT WAS OWED FOR A WAVE BEFORE IT WAS MADE** ([ADR-357](../decisions/ADR-357.md)).
ADR-347 moved the triple to `{ declared: 25, wired: 11, blocked: 14 }` and left this line reading the
previous one, which is the same drift the paragraph above records itself repairing. **`blocked: 14` counts
the ports `start.ts` does not call and not the ports a request finds refusing**; those two figures differ
by one, because `useTurnstileVerifier` holds a working live default. The partition is now asserted at
`wiring.test.ts` rather than described here, so a reader taking `blocked` for fourteen obstructions meets
the number that says otherwise.

**THIS IS NOT A REASON TO WAIT AND THE PLAN SAYS SO PLAINLY.** A console that renders "this deployment
is unfinished" against a 503 is the same honest state `apps/api` already ships, and it is what
`data-trust.ts`'s missing-signal shape and `page.ts`'s `PendingPanel` were written for: a panel `M06`
defines that no supplier fills yet ([`PendingPanel`, `page.ts:91`](../../apps/admin/src/page.ts)),
_"with who owes it"_, carrying a [`blockedBy`](../../apps/admin/src/page.ts) whose own docstring at
[`page.ts:94`](../../apps/admin/src/page.ts) reads _"Named, never 'later'"_. **The console's own design
already anticipates being ahead of its suppliers.**

### 4.2 The one route `M06` names and the contract does not carry

**`M06` section 1.1 lists five surfaces and the fifth is the event feed. `API_CONTRACT` sections 8 and 9
carry no endpoint for it.** Enumerated from the contract: `GET /admin/liability`,
`/admin/eligible-forecast`, `/admin/loss-ratios`, `/admin/cusum`, `/admin/accounts`,
`/admin/accounts/:accountId`, the four account writes, `/admin/flags` and its status write,
`/admin/certificates/:id/revoke`, `/admin/identities/:identityId/graph`, `/admin/evidence/:accountId`,
the two plan writes, the two payout writes, the three wallet rows, and section 9's four `/internal`
rows. **No feed. No events endpoint. The word `feed` appears in that document once, at
[`API_CONTRACT:928`](../architecture/API_CONTRACT.md), and it is about the live figure's data feed.**

So `feed.ts`'s 507 lines and 421 test lines implement a surface with **no contract row, no route, no port
method and no barrel export.** `W6-e` is the row, and it needs an ADR because `API_CONTRACT` is
`approved`.

---

## 5. Three findings this reading produced, each with the measurement that made it

### 5.1 THE BARREL OMITS 23 EXPORTED NAMES AND A WHOLE MODULE, AND `feed.ts` IS THE MODULE

**`apps/admin/package.json`'s `exports` map publishes `.` and nothing else, and
[`index.ts:47`](../../apps/admin/src/index.ts) says why: _"a consumer cannot reach past this file into a
module and rebuild a figure without its definition."_ So a name absent from `index.ts` is a name no
consumer in this workspace can import at all.**

Measured by reading each module's top-level exports and asking whether `index.ts` names them:

| Module                                                                     | Exports | Re-exported by the barrel                  | Missing                                                                                                                                                           |
| -------------------------------------------------------------------------- | ------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feed.ts`                                                                  | 14      | **the module is not in the barrel at all** | **all 14**                                                                                                                                                        |
| `liability.ts`                                                             | 13      | 5                                          | `TreasurySource`, `TREASURY_SOURCES`, `requireTreasurySource`, `ReserveCoverageSnapshot`, `RCR_BREAKER_BP`, `formatRatioBp`, `ReserveCoverage`, `reserveCoverage` |
| `page.ts`                                                                  | 11      | 10                                         | `assertFloatIsNotReserve`                                                                                                                                         |
| `data-trust.ts`, `figure.ts`, `live-liability.ts`, `origin.ts`, `roles.ts` | 36      | 36                                         | none                                                                                                                                                              |

**THIS IS THE DEFECT CLASS [P7](P7-risk-and-abuse.md) SECTION 5.5 NAMES ON THE WORKER'S BARREL, IN THE
FOURTH DEPLOYABLE.** That section records that deleting one of a module's two export blocks left the
module still a specifier, left the barrel assertion green and left `pnpm run typecheck` at zero errors,
and that the 2026-08-28 merge _"deleted both sides of a hunk and one side is the cheaper accident."_
**Here nothing was deleted; the names were never added.** `P5-l` landed `reserveCoverage` and
`assertFloatIsNotReserve` into modules the barrel already re-exports and did not extend the export lists,
and `feed.ts` arrived as a module the barrel never learned.

**THE CONSEQUENCE THAT MATTERS IS NOT TIDINESS.**
[`service.test.ts`](../../apps/admin/test/service.test.ts) asserts _"the public entry point exports
nothing that reads as a mutation"_ by filtering `Object.keys(admin)` against a 21-verb list. **A module
outside the barrel is outside that assertion.** `feed.ts` renders identity and account ids on its
subject-named arm, which is the `INV-M6-10` surface with the highest read-side risk in this package, and
the one control the package has over its own exports cannot see it.

**The repair is green under the existing test and that was read rather than assumed.** The runtime
values the barrel would gain are `FeedError`, `WITHHELD`, `namesASubject`, `buildFeed`, `thread`,
`mayReadEventFeed`, `renderRow`, `renderFeed`, `assertWithheld`, `TREASURY_SOURCES`,
`requireTreasurySource`, `RCR_BREAKER_BP`, `formatRatioBp`, `reserveCoverage` and
`assertFloatIsNotReserve`. **None begins with any of the 21 verbs**, and the type-only names never reach
`Object.keys` at all. `W6-b` is the repair plus the mechanical assertion that makes the next omission a
red suite, on `apps/worker`'s `9.4` shape: read each module's top-level exports and assert the barrel
re-exports every name.

### 5.2 THE TWO `INV-M6-10` ASSERTIONS READ A STRING ARRAY THE RENDERED PAGE WILL NOT USE

[`assertNamesNoSubject:219`](../../apps/admin/src/page.ts) and
[`assertWithheld:498`](../../apps/admin/src/feed.ts) both take `readonly string[]`, produced by
[`renderLiabilityHome:630`](../../apps/admin/src/page.ts) and `renderFeed`. `feed.ts`'s own header states
the ground: _"A redaction that is a CSS class is a redaction a copy-paste undoes, so every withheld value
is the word `withheld` IN THE LINE."_

**A React page renders a DOM, not a line array. If `W6-d` and `W6-f` build the document from the
STRUCTURED value and leave the assertions reading the lines, the two controls stop covering the bytes an
operator sees, and both suites stay green.**

**THAT IS EXACTLY THE MISS [STATE](../STATE.md) RECORDS FOR `projectFlag` ON 2026-08-28**: an assertion
that ran on the port's rows before the projection, so a wrong value reached the operator with the adapter
correct, the ordering correct and the assertion passing. **The remedy there was a case asserting the
SERVED BODY, and it is the remedy here.** Every prompt in section 8 that renders a document carries the
rule in section 11 rather than discovering it.

### 5.3 A SEPARATE-ORIGIN CONSOLE MAKES THE `ADR-012` OBLIGATION EASIER, NOT HARDER, AND THE REASON IS

SAME-ORIGIN

[ADR-012](../decisions/ADR-012.md) is absolute: the admin domain _"is never written into the corpus, the
repository, or any public artifact"_, and every reference is the placeholder `ADMIN_ORIGIN`.
[`origin.ts`](../../apps/admin/src/origin.ts) already discharges it: the value is read from the
environment ([`ADMIN_ORIGIN_VAR:40`](../../apps/admin/src/origin.ts)), never defaulted, and `INV-M6-02`
is checked as a cookie-domain containment relation against `SITE_ORIGIN` and `PORTAL_ORIGIN` rather than
against a pattern.

**AND THE CONSOLE'S API BASE URL IS SAME-ORIGIN, WHICH IS THE PROPERTY THAT KEEPS THE HOSTNAME OUT OF THE
TREE.** [`INFRA:53`](../architecture/INFRA.md) puts `api-admin` on `ADMIN_ORIGIN` under `/api/v1`, so the
console's client calls `/api/v1/admin/...` as a **relative path** and needs no hostname, no
`NEXT_PUBLIC_API_ORIGIN`, and no CORS configuration at all. `INV-M6-02`'s _"shares no CORS policy with
any public surface"_ is satisfied by there being no cross-origin request to have a policy about.

**The one hazard is a build-time inlined absolute URL, and it is stated so a slice does not discover
it.** A framework that bakes an environment value into a client bundle would put the resolved
`ADMIN_ORIGIN` into a build artifact, which is _"any artifact"_ in `ADR-012`'s own words. **A relative
base URL cannot do that**, and `W6-c`'s prompt carries the constraint as a refusal rather than a
preference.

---

## 6. Claims checked against their sources, and two did not survive

| #   | Claim                                                                           | Verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`apps/api` composes an operator surface with 24 registered routes**           | **FALSE, it is 27** on `8742c3b`, over a real `compose()`. Section 4. The number is 26 operator-prefixed plus `GET /health`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2   | **`RI-15` will check this plan's citations**                                    | **FALSE, and it is the finding that raises the bar rather than lowers it.** `RI-15` reads [`CITED_REASON_FILES`](../../packages/tooling/checks/repo-invariants.mjs), six named source files: `apps/api/test/wiring.test.ts`, `apps/api/src/idempotency.ts`, `apps/api/src/routes/wallet-withdrawals.ts`, `apps/api/src/idempotency-store.ts`, `apps/api/src/routes/payouts.ts`, `apps/worker/src/detectors/fills.ts`. **No document under `docs/` is in that list and its own `covers` line records that it reads `docs/decisions` "NOT AT ALL".** So every citation in this file is checked by nothing mechanical, and every one was written from the file rather than from memory |
| 3   | **`apps/admin` is the fourth instance of the no-server class**                  | **TRUE, and the other three have since moved.** `apps/portal/src/app/` now holds **48 files including 11 pages** and `apps/site/src/app/` holds **14 including 10 `page.tsx`**, both counted with `find` on this tree, and `CI-07`'s artifact arrived on 2026-08-27 ([STRATEGY](../testing/STRATEGY.md) section 4.1's row). **`apps/admin` is not one of four equals; it is the one that was never repaired**, and it is the only UI deployable with no framework, no `build`, no `dev`, no `src/app/` and no Playwright project                                                                                                                                                    |
| 4   | **`ADR-171` refused the operator door**                                         | **TRUE and stronger than the dispatch states.** It refused on a measurement: _"THE DOOR IS NOT WHAT THE FIVE PORTS ARE WAITING FOR."_ `setAdminSessionSource`'s blocker is that `admin_actions.actor` is `text NOT NULL` with no foreign key and no table in the registry holds an operator, a role or an operator session                                                                                                                                                                                                                                                                                                                                                          |
| 5   | **`P6-g`'s socket needs a `VG-12` catalog admission**                           | **TRUE.** [P6](P6-live-tier.md) section 8: the `@fastify/websocket` admission is _"a `VG-12` approval on `pnpm-workspace.yaml`'s catalog block"_, and section 9 states _"A `VG-12` ADMISSION, WHICH IS A HUMAN APPROVAL AND NOT A MERGE"_                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 6   | **The `build`-script probe forbids a `build` key in `apps/admin/package.json`** | **NO LONGER TRUE and it was true until 2026-08-24.** [`gates.mjs:7123`](../../scripts/corpus/gates.mjs) records the probe's removal: `CI-07`'s artifact moved to _"a `page`, `layout` or `route` file under `apps/*/src/app/`"_ under [ADR-095](../decisions/ADR-095.md) section 6. A slice reading `apps/api/package.json`'s _"THERE IS NO `build` SCRIPT AND THERE MUST NOT BE ONE"_ would inherit a stale reason, which `ADR-095` section 9 item 3b already rows as owed                                                                                                                                                                                                         |

**And two facts that are neither claims nor findings, recorded because a slice will reach for them:**

**Finding 2 of section 2.1 restated: `searchAccounts` and `readAccount` are claimed by NO PLAN.**
`grep -rn "searchAccounts\|readAccount\b" docs/plans/*.md` returns nothing. Of `AdminReadSource`'s six
methods, [`P7-i`](P7-risk-and-abuse.md) took `listFlags` and `readIdentityGraph`,
[`P7-j`](P7-risk-and-abuse.md) took `exportEvidence`, [`P5-l`](P5-payouts-and-wallet.md) took
`readLiability`, and **two are unowned**. `GET /admin/accounts` and `GET /admin/accounts/:accountId` are
registered against them. **This wave does not claim them either**, because an adapter is an `apps/api`
slice and this wave's subject is `apps/admin`; it is section 10 item 3.

**`P5-l` HOLDS THREE OF THIS PACKAGE'S NINE MODULES AND `P6-j` HOLDS ONE OF THEM.** Section 9 is the
table; the point here is that `apps/admin/src` is a contended directory across three plans, which no
plan currently says.

---

## 7. The registries this wave CANNOT spend

| Registry                                   | Position                                                                                                                                                                 | Rule                                                                                                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADR numbers**                            | **`180` is the highest allocated** ([ALLOCATION](../decisions/ALLOCATION.md), and the tip of `main` is _"wave M allocation, ADR-180 with 0053 conditional and ADR-179"_) | **NO NUMBER IS ALLOCATED TO THIS SESSION AND NONE IS TAKEN.** Two slices need one and section 8 names them `ADR-1NN`. `CI-06w` reads ALLOCATION as a multiset, so **one pre-dispatch commit claims both numbers before any slice runs** |
| **Migration numbers**                      | none needed                                                                                                                                                              | **No slice in this wave writes a migration**, and that is a property rather than a hope: nothing here adds a column, a table or a grant                                                                                                 |
| **`SD-M6-nn`**                             | `SD-M6-11` is the highest, and [M06](M06-admin-ops-console.md) section 2 records that a number between `SD-M6-07` and `SD-M6-09` is deliberately unclaimed               | **This wave claims none and may not even NAME one**, on [ADR-026](../decisions/ADR-026.md)'s completeness gate reading any `SD-` token under `docs/` as a citation                                                                      |
| **`M6-N-nn`**                              | [M06](M06-admin-ops-console.md) section 8.1a: _"`M6-N-09` is the next free identifier. The router enumeration starts there"_                                             | **No slice here writes an `M6-N-nn` test**, because no slice here adds a mutating route. The identifier is named so the write wave finds it rather than restarting at `01`                                                              |
| **`GS-nnn`**                               | `GS-112` to `GS-117` are `M06`'s own                                                                                                                                     | **No new scenario is claimed.** `CI-06d` fails on any `GS-nnn` under `docs/` with no registry definition                                                                                                                                |
| **`VG-12`**                                | a human approval on a diff to `pnpm-workspace.yaml`'s catalog block                                                                                                      | Section 8's `W6-a` note, and section 10 item 1                                                                                                                                                                                          |
| **`API_SURFACES` and `HTTP_METHODS`**      | closed at two and five                                                                                                                                                   | **[P6](P6-live-tier.md) section 7 gives `P6-g` the sole permission to widen either. No slice in this wave touches them**                                                                                                                |
| **`SystemReason` and `SqlExecutorReason`** | closed vocabularies                                                                                                                                                      | Named so no slice takes one silently. **Nothing in this wave opens a database door**; the console is a network client of `api-admin`                                                                                                    |

---

## 8. THE WAVE

**Fences are BY FILE. Section 9 is the per-file collision table and it is the one to read.**
Money column: `apps/admin` performs no arithmetic on a rule ([M06](M06-admin-ops-console.md) section 1.2)
and holds no ledger handle, so no slice here is money **by file**. Where a slice is money **by content**
the cell says which content and why.

### Wave 1: the framework and the seam. Two sessions, and they are SERIAL on one manifest

| #          | Slice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Fence, by file                                                                                                                                                                                                                                                                                                    | ADR                                                | Money                                                                  | Depends on, by file                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **`W6-a`** | **LANDED, session 331, as [ADR-182](../decisions/ADR-182.md), `status: proposed`, approval line UNSIGNED.** **RULING 1: `apps/admin` SERVES HTTP AND NEVER SERVES `/api/v1`**, so section 3's reading is now a ruling rather than a transcription, and section 4 option A is priced rather than assumed away. **RULING 2: Next.js App Router on the catalog versions already admitted**, a THIRD IMPORTER and no sixth catalog entry. The manifest gained `build` and `dev` and its `start` became `next start`. **THE `tsconfig` DID NOT MOVE AND THAT REVERSES THIS ROW AS WRITTEN**: `ADR-095` `F7` places the `jsx` keys and the `dom` lib with the first page, both prior instances did that, and the lockfile-serialization argument that justifies landing the React types early does not reach a file one slice touches. **`apps/admin/tsconfig.json` IS NOW `W6-d`'S**, wave 2 | `apps/admin/package.json`, `pnpm-lock.yaml`, `docs/decisions/ADR-182.md` (new), `ALLOCATION` (its row), `STATE` (append), `sessions/`. **`INDEX` NEEDED NO ROW**: `CI-06c` reads the `decisions/` directory row and the per-entry registry in [`decisions/README.md`](../decisions/README.md) is a generated span | **YES, TAKEN: [ADR-182](../decisions/ADR-182.md)** | **no**. It admits no capability the workspace has not already admitted | **nothing. IT WENT FIRST.** It did not touch `pnpm-workspace.yaml` |
| **`W6-b`** | **The barrel gains the 23 names it omits, and an assertion that makes the next omission a red suite.** Section 5.1. `feed.ts`'s fourteen, `liability.ts`'s eight, `page.ts`'s one, and a case on `apps/worker`'s `9.4` shape reading each module's top-level exports and asserting the barrel re-exports **every name**. **It repairs nothing else in those modules**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `apps/admin/src/index.ts`, `apps/admin/test/service.test.ts`, `STATE` (append), `sessions/`                                                                                                                                                                                                                       | no                                                 | **no**                                                                 | **nothing.** Concurrent with `W6-a`, and it shares no file with it |

**`W6-a` MUST NOT TOUCH `pnpm-workspace.yaml`, AND THE REASON IS A `VG-12` ARGUMENT RATHER THAN A
FENCE.** The five catalog entries `ADR-095` ruling 1 admitted (`next`, `react`, `react-dom`,
`@types/react`, `@types/react-dom`) are already in the block, and that entry states the rule its own
admission established: the version _"is approved once on a diff to that block rather than once per
manifest."_ `apps/api/package.json`'s manifest note states the converse from the other side: a
dependency that is not a catalog one leaves _"`pnpm-workspace.yaml` untouched and VG-12 is asked to admit
nothing."_ **So a new IMPORTER of an already-admitted catalog entry adds no package to the closure and
touches no line a `VG-12` approval reads.** That is this plan's reading and it is a recommendation
rather than a ruling: **section 10 item 1 puts it to the founder**, because `P6` section 9 says a
`VG-12` admission is a human approval and is not a session's to grant, and a plan that answered it by
assumption would be doing exactly that.

### Wave 2: the seam and the first document. Two sessions, SERIAL

| #          | Slice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Fence, by file                                                                                                                                                                                                                                                                                                                                                                                              | ADR                                            | Money                                                                                                                                                         | Depends on, by file                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **`W6-c`** | **The wire types and the ONE `fetch`.** `api/types.ts` transcribed from [API_CONTRACT](../architecture/API_CONTRACT.md) sections 8 and 9, edits limited to `readonly` and comments, on [`apps/portal/src/api/types.ts`](../../apps/portal/src/api/types.ts)'s stated discipline: _"A field that is not in the contract is not in this file."_ `http/client.ts` is the only file in this package permitted to call `fetch(`, on [`apps/portal/src/http/client.ts`](../../apps/portal/src/http/client.ts) and [ADR-162](../decisions/ADR-162.md)'s precedent, and `test/surface.test.ts` asserts exactly one, with `XMLHttpRequest`, `WebSocket` and `EventSource` at zero files. **THE BASE URL IS RELATIVE**, section 5.3, and the suite asserts no absolute origin is constructed anywhere. **[ADR-182](../decisions/ADR-182.md) SECTION 8 ITEM 2 ASSIGNS THIS SLICE TWO ASSERTIONS THAT NOTHING IN THIS REPOSITORY MAKES TODAY**: no absolute origin anywhere in the package, and **no `NEXT_PUBLIC_` identifier anywhere in it**, which is the one mechanism by which a framework writes a resolved `ADMIN_ORIGIN` into a client bundle. The entry states both as rules and names this slice as the one that can make them checks | `apps/admin/src/api/types.ts` (new), `apps/admin/src/http/client.ts` (new), `apps/admin/test/surface.test.ts` (new), `apps/admin/src/index.ts`, `STATE` (append), `sessions/`                                                                                                                                                                                                                               | no. Transcription against an approved contract | **no by file.** Sensitive by what it governs: it is the file that decides whether a hostname can enter a build artifact                                       | **`W6-b`** via `src/index.ts`                                                                                    |
| **`W6-d`** | **The root layout and the liability home document. THIS IS THE FIRST RENDERED PAGE IN `apps/admin` AND IT IS THE DONE-GATE FOR WAVE 2.** `src/app/layout.tsx` and the liability route render [`buildLiabilityHome:391`](../../apps/admin/src/page.ts)'s `LiabilityHomePage` value. **`P-M6-09` renders above every number and the trust verdict is inherited rather than recomputed. `renderLiabilityHome`'s lines are NOT deleted and NOT the page**: section 5.2, and [`assertNamesNoSubject:219`](../../apps/admin/src/page.ts) is re-pointed at the SERVED BYTES in this same slice or it stops covering anything                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `apps/admin/src/app/**` (new), **`apps/admin/tsconfig.json`** ([ADR-182](../decisions/ADR-182.md) section 6: the `jsx: preserve`, `jsxImportSource` and `dom` lib keys land WITH the first page, on `ADR-095` `F7`, and [`apps/portal/tsconfig.json`](../../apps/portal/tsconfig.json) is the shape), `apps/admin/test/render.test.ts` (new), `apps/admin/test/page.test.ts`, `STATE` (append), `sessions/` | no                                             | **YES by content.** `AS-M6-04`: the liability number is the one whose staleness has a named body count, and this is the first slice that shows one to a human | **`W6-a`**, **`W6-c`**. **ORDER AFTER [`P5-l`](P5-payouts-and-wallet.md) if that slice is in flight**, section 9 |

### Wave 3: the surfaces whose data source exists. Three sessions, concurrent

| #          | Slice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Fence, by file                                                                                                                                                                                                                                                                                                                                         | ADR               | Money                                                                                                                      | Depends on, by file                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **`W6-e`** | **The event feed gets a contract row, which is an amendment and therefore an ADR.** Section 4.2: `M06` section 1.1 names the feed a launch surface, `feed.ts` implements it in 507 lines, and `API_CONTRACT` sections 8 and 9 carry no endpoint. The entry adds the row, decides whether `AdminReadSource` gains a seventh method or the feed gets a port of its own, and **carries `INV-M6-10`'s two modes into the request shape** so that "no subject named" is a property of the query rather than of a handler's care                                                                                                                                                                                                                                                                                                                                                                              | `docs/decisions/ADR-1NN.md` (new, **REQUIRED**), `docs/architecture/API_CONTRACT.md`, `apps/api/src/routes/admin-feed.ts` (new), `apps/api/test/admin-feed.test.ts` (new), `apps/api/src/routes/admin-reads.ts` (**the port declaration ONLY, if the ruling puts it there**), `ALLOCATION` (its row), `INDEX` (its row), `STATE` (append), `sessions/` | **YES, REQUIRED** | **no by file.** Sensitive by what it governs: an unfiltered page of `events` is the bulk identity read `INV-M6-10` refuses | **nothing in this wave.** Concurrent with `W6-d`                                |
| **`W6-f`** | **The flags queue screen. THE ONE SURFACE WHOSE BOTH HALVES EXIST.** `GET /admin/flags` is registered and `listFlags` is composed ([`admin-source/index.ts:204`](../../apps/api/src/admin-source/index.ts)), so this screen renders real rows the day a session source lands and, before then, renders the blocked state against the status its own route answers, which is a **401** to an anonymous caller and a **500** to one carrying a cookie and is NOT a 503 ([ADR-190](../decisions/ADR-190.md); `GET /admin/flags` is served by `admin-reads.ts`'s shared `adminHandler`). **The ordering is [ADR-178](../decisions/ADR-178.md)'s and is not recomputed in the console**: corroboration depth first, severity then age within a band, and the console renders `corroboration_depth` beside the severity because an operator shown a severity 3 above a severity 5 needs the reason on the row | `apps/admin/src/app/flags/**` (new), `apps/admin/src/view/flags.ts` (new), `apps/admin/test/flags-render.test.ts` (new), `apps/admin/src/api/types.ts`, `apps/admin/src/index.ts`, `STATE` (append), `sessions/`                                                                                                                                       | no                | **no**                                                                                                                     | **`W6-d`** for the layout, **`W6-c`** for the client                            |
| **`W6-g`** | **The identity drill-down, `M06` section 3.2a.** `GET /admin/identities/:identityId/graph` is registered and `readIdentityGraph` is composed. **It is reachable only by naming a subject and there is no list behind it**, which is `M06` section 3.2a's own sentence and the property that separates it from `FM-M6-10`'s bulk PII surface. **NO RESTRICTION AFFORDANCE**: `INV-M6-14`'s write is behind `ADR-171`, section 8's wave 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `apps/admin/src/app/identities/**` (new), `apps/admin/src/view/identity.ts` (new), `apps/admin/test/identity-render.test.ts` (new), `apps/admin/src/api/types.ts`, `apps/admin/src/index.ts`, `STATE` (append), `sessions/`                                                                                                                            | no                | **no**                                                                                                                     | **`W6-d`**, **`W6-c`**. **SERIAL WITH `W6-f` ON `api/types.ts` AND `index.ts`** |

### Wave 4: the surfaces behind another slice or another plan

| #          | Slice                                                                                                                                                                                                                                                                                                                                                                            | Fence, by file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ADR | Money                                                                                                                                                                                          | Depends on                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **`W6-h`** | **The event feed screen.** `feed.ts` gains a document, both modes, and `assertWithheld` re-pointed at the served bytes per section 5.2                                                                                                                                                                                                                                           | `apps/admin/src/app/feed/**` (new), `apps/admin/src/view/feed.ts` (new), `apps/admin/test/feed-render.test.ts` (new), `apps/admin/src/api/types.ts`, `STATE` (append), `sessions/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | no  | **no**                                                                                                                                                                                         | **`W6-e`** for the route, **`W6-d`** for the layout |
| **`W6-i`** | **The Playwright project and the slop-score pass for `apps/admin`, closing `CI-08` at three of three.** [`playwright.config.ts:11`](../../playwright.config.ts) names the missing project and its reason, and this slice removes the reason. **The `CI-08` row moves in the same commit or the register carries a count that is false in the direction that looks like success** | `playwright.config.ts`, `apps/admin/e2e/**` (new), **[`e2e/tsconfig.json`](../../e2e/tsconfig.json)** ([ADR-182](../decisions/ADR-182.md) section 8 item 4: its `include` at [`:15`](../../e2e/tsconfig.json) names `../apps/site/e2e/**/*.ts` and `../apps/portal/e2e/**/*.ts` by hand, so a third directory is typechecked by the APP's project, whose lib has no DOM, which is the exact failure that file's own comment says the include prevents), `docs/testing/STRATEGY.md` (**section 4.1's `CI-08` row ONLY**), `scripts/corpus/gates.mjs` (**the inventory register ONLY**), `STATE` (append), `sessions/`. **`apps/admin/package.json` NEEDS NO `@playwright/test` LINE AND THIS SLICE MUST NOT ASK FOR ONE**: [`e2e/pass.ts:17`](../../e2e/pass.ts) is the only file in this repository that imports it and no spec under `apps/*/e2e` names it, so the other two UI manifests' declaration is not what makes the pass resolve | no  | **no**                                                                                                                                                                                         | **`W6-d`** for a document to render                 |
| **`W6-j`** | **The account drill-down screen, `M06` section 3.2.** The routes are registered and **neither port method has an adapter or an owning slice** (section 6). This slice writes the SCREEN and does not write the adapter, which is an `apps/api` slice section 10 item 3 assigns to nobody                                                                                         | `apps/admin/src/app/accounts/**` (new), `apps/admin/src/view/account.ts` (new), `apps/admin/test/account-render.test.ts` (new), `apps/admin/src/api/types.ts`, `STATE` (append), `sessions/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | no  | **YES by content.** The drill-down renders `gate_results` per day from the STORED row, and `M06` section 3.2 is explicit that a recomputation is an assertion where the stored row is a record | **`W6-d`**, **`W6-c`**                              |

### Wave 5: NOT DISPATCHED, and each absence is a blocker with a name

| Not dispatched                                                                                                                                                                                                                                                                                            | Blocked on                                                                                                                                 | Which blocker                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The live Open Liability panel on the console**                                                                                                                                                                                                                                                          | [`P6-j`](P6-live-tier.md), which is behind **`P6-g`**, which is behind **a `VG-12` catalog admission for `@fastify/websocket`**            | **BLOCKED ON A HUMAN.** `P6` section 9: _"A `VG-12` ADMISSION, WHICH IS A HUMAN APPROVAL AND NOT A MERGE"_                                                             |
| **The evidence-pack export affordance**                                                                                                                                                                                                                                                                   | `AS-M6-05`'s burst alert, the short-lived single-use signed URL, and the audience parameter reaching a screen                              | **`P7-j`**'s module exists; the export is an audited ACT and therefore behind the actor. `ADR-171`                                                                     |
| **Every mutating surface**: the flag status write, freeze, unfreeze, close, note, the two payout writes, the two plan writes, the three wallet writes, `INV-M6-14`'s restriction and restore, `INV-M6-06`'s suppression, `INV-M6-08`'s dual control, and all eighteen of `M06` section 11's parity routes | **`setAdminSessionSource`**: `admin_actions.actor` is `text NOT NULL` with no foreign key and the operator directory is the SSO provider's | **BLOCKED ON A HUMAN AND ON INFRASTRUCTURE.** [ADR-171](../decisions/ADR-171.md), and it is an admin identity provider and a vendor decision rather than a code change |
| **The `M6-N-nn` negative-authz matrix and `M6-U-01`'s generative audit test**                                                                                                                                                                                                                             | the same                                                                                                                                   | They enumerate _"every mutating route from the router"_ and the router has none. **Starting at `M6-N-09`**, [M06](M06-admin-ops-console.md) section 8.1a               |
| **The identity-graph explorer** (`M06` section 7.9) and **the six standing duplicate-signal views** (section 7.10)                                                                                                                                                                                        | [ADR-022](../decisions/ADR-022.md) tiers the explorer to **v1.x**; the views are sized **SHOULD**                                          | Not a blocker, a tier. Named so a slice does not pull them forward                                                                                                     |

---

## 8.1 THE TWO BLOCKERS, PLACED RATHER THAN ROUTED AROUND

**Neither blocker is worked around anywhere in section 8, and this subsection exists so that a reader can
check that claim in one place.**

### Blocker 1: `ADR-171` refused the operator door, and the admin identity provider is the founder's

**What it blocks:** every write in `M06`, which is `INV-M6-01`'s audit row, `INV-M6-06`'s suppression,
`INV-M6-08`'s dual control, `INV-M6-13` and `INV-M6-14`'s restriction and restore, section 8.1's whole
`M6-N-nn` matrix, section 11's eighteen parity routes, and the evidence-pack export. **It also blocks
every READ from returning a row**, because `adminHandler` resolves the principal through the same source.

**Why no slice can move it:** [ADR-171](../decisions/ADR-171.md) finding 4 measured that
`admin_actions.actor` is `text NOT NULL` with **no foreign key**, that
`grep -rn "admin_sessions\|admin_users\|admin_actors\|operator_sessions" packages/db/migrations/` returns
nothing, and that _"no table in the registry holds an operator, a role or an operator session."_ Its
finding 5 quotes the port itself: _"the mapping from a session to an actor and a role is the admin
identity provider's."_ **That is a vendor selection, an SSO tenant and an IP allowlist. It is
infrastructure the founder buys, not a file a session writes.**

**Where the slices sit relative to it.** Every slice in waves 1 through 4 is **in front of it**, and
every slice blocked by it is in wave 5 under its own name. **No slice in this wave resolves a principal,
stubs one, or renders a screen whose correctness depends on one.** The console names the blocker with its
reason, which is `page.ts`'s `PendingPanel` shape used for what it was built for.

**AMENDED BY [ADR-190](../decisions/ADR-190.md), AND THE SENTENCE THIS REPLACED SAID "RENDERS THE 503".**
Section 4.1's _"every one of the 26 operator routes above answers 503 today"_ was reported false by
session 336, measured false by session 344, and measured across the whole surface by session 350: the
operator deployment registers **28** routes, of which **23** are `/admin/*`, and they answer **two
different things**. The ten served by `admin-reads.ts`'s shared `adminHandler` (its own seven, plus
`admin-breaker.ts`'s two and `admin-feed.ts`'s one) answer **401 `unauthenticated`** to a caller with no
admin session cookie and **500 `internal_error`** to one carrying a cookie. The thirteen served by the
four write backends answer **503 `service_unavailable`** before authenticating at all. **So the plan
generalised from the majority of the surface and the ten routes the console reads are the exception.**

**What this changes for a slice in this wave, and it is a rule rather than a number.** ADR-190 clause 5:
**a screen renders no error kind it did not receive.** An `AdminErrorKind` is derived from a response
(`apps/admin/src/http/client.ts` computes it from `response.status`), so a route that performs no read
names none, states its blockers with their owners, and quotes the measured statuses in prose where an
operator reads them. `W6-f` and `W6-g` shipped that way before it was written down;
`apps/admin/src/app/page.tsx` was corrected to it and `apps/admin/test/render.test.ts`'s `M6-A-60` now
sweeps the whole `src/app/` directory for it. **Section 4.1, the `W6-f` row in section 8, section 10's
item, the two sentences in `apps/admin/src/http/client.ts` and one in `apps/admin/src/index.ts` carried the
old claim**: they were outside ADR-190's fence and were registered in that entry's section 7 item 5 with
their line numbers, and re-registered unchanged at [ADR-192](../decisions/ADR-192.md) section 10 item 5.
**ALL SIX ARE NOW REPAIRED**, as a transcription of those two rulings and not as a third, so nothing in this
plan or in `apps/admin/src/` states the retired sentence any longer. **The repairs carry ADR-192's answer and
not ADR-190's**, because that entry moved the write backends' 503 behind a 401 after ADR-190 measured it in
front: section 4.1 above states the surface as it stands, and the paragraph opening this section stays as
ADR-190 wrote it, because it is the record of what the surface did on the day that entry measured it.

**The condition that changes this** is [ADR-171](../decisions/ADR-171.md) section 9's own: the slice that
lands an `AdminSessionSource` a deployment can install. **This plan does not schedule it, because
scheduling a session against a vendor decision nobody has made is how a wave produces a branch that
cannot end.**

### Blocker 2: `P6-g`'s socket needs a `VG-12` admission, which is a human approval

**What it blocks:** `M06` section 3.5's live Open Liability on the console. `live-liability.ts` computes
the figure today; [`P6-j`](P6-live-tier.md) gives it a producer and a route; `P6-j` depends on `P6-g`;
and `P6-g` depends on admitting `@fastify/websocket` to `pnpm-workspace.yaml`'s catalog block, which
[P6](P6-live-tier.md) section 9 states is _"A `VG-12` ADMISSION, WHICH IS A HUMAN APPROVAL AND NOT A
MERGE."_

**No slice here depends on it, and that is a design choice rather than luck.** `W6-d` renders
`LiabilityHomePage` whose `live` field is a `LiveOpenLiability`, a union that already carries the arm for
_"the stated refusal to compute one"_. **The document renders the refusal with its reason and gains the
figure when `P6-j` lands, with no change to `W6-d`'s slice.** `M06` section 3.5's _"Two numbers, both
labeled, is the entire design"_ is satisfied at one number plus a stated absence, which is what
`figure.ts`'s `absent` shape exists for.

**And `W6-a` is checked against the same gate and comes back clear.** Section 8's `VG-12` note is the
argument; **section 10 item 1 is the question**, because this plan can measure that the catalog block
needs no diff and cannot grant an approval on the founder's behalf.

**THE MEASUREMENT IS NOW TAKEN RATHER THAN PREDICTED.** [ADR-182](../decisions/ADR-182.md) section 7 ran
it: package keys in [`pnpm-lock.yaml`](../../pnpm-lock.yaml)'s `packages:` block, sorted and diffed
before and after `pnpm install`, are **427 and 427 and the two lists are byte-identical**. The lockfile
gained **15 lines and every one of them is inside the `apps/admin` importer block**;
[`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) took no diff at all. **The question in section 10
item 1 is unchanged by that and is still the founder's**, because what it asks is whether a deployable
acquiring a rendering framework is itself the admission, and a closure delta of zero is evidence rather
than an answer.

---

## 9. THE COLLISIONS, BY FILE

| File                                                                                                                                                                                     | Held by                                                                                                                                                                                                                                                                       | Why it collides, and the resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[`apps/admin/src/index.ts`](../../apps/admin/src/index.ts)**                                                                                                                           | **`W6-b`, `W6-c`, `W6-f`, `W6-g`**, and any later screen, **plus one REPORTED line neither of them holds**                                                                                                                                                                    | **THE SAME HAND-MAINTAINED BARREL THAT PRODUCED SECTION 5.1, AND FOUR SLICES NOW APPEND TO IT.** **SERIAL: `W6-b` FIRST**, because it is the slice that makes a dropped leg a red suite, and every slice after it inherits the assertion. A keep-both merge of a re-export list type-checks and drops nothing, which is what makes it easy to miss rather than safe ([P7](P7-risk-and-abuse.md) section 5.5). **AND [ADR-182](../decisions/ADR-182.md) SECTION 8 ITEM 3 LEFT A STALE REASON IN IT RATHER THAN REACHING PAST A FENCE.** `start` is now `next start`, so `main()` is no longer what the deployable runs, while [`index.ts:126`](../../apps/admin/src/index.ts) still reads _"there is no server here to receive a request carrying them"_ and [`:132`](../../apps/admin/src/index.ts) still prints _"no server yet"_. **`W6-d` is the slice that makes those sentences false in FACT and is the right place to correct them**; a session holding this file sooner may take the line |
| **[`apps/admin/src/page.ts`](../../apps/admin/src/page.ts)**, **[`liability.ts`](../../apps/admin/src/liability.ts)**, **[`live-liability.ts`](../../apps/admin/src/live-liability.ts)** | **cross-phase: [`P5-l`](P5-payouts-and-wallet.md) holds all three, [`P6-j`](P6-live-tier.md) holds `live-liability.ts` and `page.ts`**                                                                                                                                        | **THIS WAVE HOLDS NONE OF THEM AND THAT IS THE RESOLUTION.** `W6-d` renders `buildLiabilityHome`'s VALUE and writes only under `src/app/`. **[P6](P6-live-tier.md) section 9 already orders the two it knows about**, `P5-l` then `P6-j`; this wave slots **after both** on this file set and edits neither. **If `W6-d` finds it needs a change in `page.ts`, that is `P5-l`'s slice and not this one's**, and the prompt says so rather than leaving it to judgement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **[`apps/admin/test/service.test.ts`](../../apps/admin/test/service.test.ts)**                                                                                                           | **`W6-b`**, and **every future write slice**                                                                                                                                                                                                                                  | **THE NO-MUTATION ASSERTION IS THE FENCE THE WRITE WAVE MUST MOVE, AND IT MUST NOT BE MOVED HERE.** Its own header says the moment a mutation appears _"the regime changes and the review changes with it"_. `W6-b` extends the barrel and the assertion stays green unchanged (section 5.1); **a slice that has to weaken it is a slice in the wrong wave**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **[`apps/admin/src/api/types.ts`](../../apps/admin/src/index.ts)**                                                                                                                       | **`W6-c`, `W6-f`, `W6-g`, `W6-h`, `W6-j`**                                                                                                                                                                                                                                    | **FIVE SLICES, ONE TRANSCRIPTION.** `W6-c` creates it with the liability and feed shapes; each screen slice adds the shapes its own contract rows carry. **SERIAL by wave and disjoint by contract section within a wave**, which is the same division [P7](P7-risk-and-abuse.md) section 9 draws on `admin-source/index.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **[`docs/architecture/API_CONTRACT.md`](../architecture/API_CONTRACT.md)**                                                                                                               | **`W6-e`** alone in this wave, and **cross-phase it remains the hottest file in the corpus** ([P4](P4-portal-and-site.md) section 10 item 2, [P5](P5-payouts-and-wallet.md) section 9, [P6](P6-live-tier.md) section 9, [P7](P7-risk-and-abuse.md) section 9, all unresolved) | **THIS WAVE DOES NOT RESOLVE IT EITHER.** It holds the file for one slice and takes its row in one commit. **`W6-e`'s row is a NEW endpoint in section 8**, which is a different edit from `P5-c`'s and `P7-b`'s field additions, and the section-12 negative-authz matrix gains a row for it in the same commit ([M06](M06-admin-ops-console.md) section 11.5 finding 3 is the standing debt)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **[`pnpm-lock.yaml`](../../pnpm-lock.yaml)**                                                                                                                                             | **`W6-a`** in this wave, and **cross-phase `P6-g`**                                                                                                                                                                                                                           | **`W6-a` adds one IMPORTER'S lines and `P6-g` adds a PACKAGE.** The two are different edits to one file and both are serial against everything else that touches it. **[P4 wave 1](P4-portal-and-site.md) paid for this serialization once and the lesson stands**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **[`pnpm-workspace.yaml`](../../pnpm-workspace.yaml)**                                                                                                                                   | **NOBODY IN THIS WAVE**, and **`P6-g`** cross-phase                                                                                                                                                                                                                           | **The `VG-12` file, and `W6-a` is fenced OUT of it** rather than merely not needing it. A slice that finds it wants a catalog line has found section 10 item 1 and stops. **`W6-a` HELD THE FENCE AND THE FILE NOW CARRIES A FALSE SENTENCE BECAUSE OF IT**: [`:144`](../../pnpm-workspace.yaml)'s _"in NO other package"_, section 10 item 1. **That is the cost of the fence stated rather than the fence being widened to avoid it**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **[`playwright.config.ts`](../../playwright.config.ts)** and **[`docs/testing/STRATEGY.md`](../testing/STRATEGY.md)**                                                                    | **`W6-i`** alone                                                                                                                                                                                                                                                              | **The `CI-08` row and the projects list move together or the register lies.** `CI-06/gate-inventory` reads the row; the fence is **section 4.1's `CI-08` row only**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **[`docs/decisions/ALLOCATION.md`](../decisions/ALLOCATION.md)**                                                                                                                         | **`W6-a`, `W6-e`**                                                                                                                                                                                                                                                            | **Two of ten.** `CI-06w` reads the table as a multiset, so **one pre-dispatch commit claims both ADR numbers before any slice runs.** An expected collision costs a resolution; a discovered one costs a cycle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **[`docs/INDEX.md`](../INDEX.md)**                                                                                                                                                       | **`W6-e`**, and this plan                                                                                                                                                                                                                                                     | **`W6-a` NEEDED NO ROW AND THE PREDICTION WAS WRONG IN THE CHEAP DIRECTION.** `CI-06c` reads INDEX completeness in **both** directions and it reads the `decisions/` DIRECTORY row; the per-entry registry lives in [`decisions/README.md`](../decisions/README.md) as a generated span, so `node scripts/corpus/gates.mjs generate` writes the ADR's row and `INDEX` is untouched. **`W6-e` should expect the same**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **[`docs/sessions/README.md`](../sessions/README.md)** and **[`docs/STATE.md`](../STATE.md)**                                                                                            | every slice, and every session in the tree                                                                                                                                                                                                                                    | The entry span is generated under [ADR-088](../decisions/ADR-088.md), so the resolution is to re-run `node scripts/corpus/gates.mjs generate` rather than to merge by hand. **STATE is APPEND ONE SECTION AT THE END**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

---

## 10. What this plan could not settle, for the founder

**Four items. Three are the founder's and one is an assignment nobody holds. Each is named rather than
answered by assumption, because this project has been burned five times this week by an assumption that
read like a finding.**

1. **DOES A NEW IMPORTER OF AN ALREADY-ADMITTED CATALOG ENTRY NEED A FRESH `VG-12` APPROVAL?**
   `W6-a` adds `"next": "catalog:"`, `"react": "catalog:"` and `"react-dom": "catalog:"` to
   `apps/admin/package.json`. All three versions are already in `pnpm-workspace.yaml`'s catalog block,
   admitted by [ADR-095](../decisions/ADR-095.md) ruling 1 with the closure delta measured at that time.
   **The catalog block takes no diff and no package enters the closure**, so on `ADR-095`'s own rule
   (_"approved once on a diff to that block rather than once per manifest"_) and on
   `apps/api/package.json`'s converse (a non-catalog dependency leaves the workspace file untouched and
   _"VG-12 is asked to admit nothing"_), **the recommendation is NO NEW ADMISSION**. **But `P6` section 9
   states that a `VG-12` admission is a human approval and is not a session's to grant**, and the
   question of whether a deployable acquiring a rendering framework is itself the admission is the
   founder's rather than this plan's. **`W6-a` is dispatchable either way; what changes is whether its
   pull request waits on a signature.**

   **MEASURED SINCE, BY [ADR-182](../decisions/ADR-182.md) SECTION 7: THE CLOSURE DELTA IS ZERO.** 427
   package keys before and 427 after, sorted and diffed rather than argued, and the lockfile's whole
   change is 15 lines inside one importer block. **AND THE RULING LEAVES A FALSE SENTENCE IN THE ONE
   FILE THE SLICE MAY NOT TOUCH, WHICH IS NAMED HERE RATHER THAN LEFT TO BE FOUND.**
   [`pnpm-workspace.yaml:144`](../../pnpm-workspace.yaml)'s `next:` comment reads _"App Router, in
   `apps/portal` and `apps/site` and in NO other package"_, and that clause is false from the commit
   that carries `ADR-182`. **Nothing mechanical notices it.** The fence is not arbitrary, because that
   block is what a `VG-12` approval reads and a comment edit riding inside it would put a signature
   request on prose, **so the sentence moves in the commit that carries the founder's answer to this
   item.**

2. **`ADR-171`'S CONDITION IS AN INFRASTRUCTURE PURCHASE AND THIS PLAN CANNOT SCHEDULE IT.** The admin
   identity provider decides the SSO vendor, the hardware-key enrolment, the operator directory and what
   an `admin_actions.actor` string IS. Until it exists, `M06`'s entire write half and every read's actual
   rows are unreachable, and **that is roughly two thirds of the module by surface count**. **The
   founder's decision is not "which vendor" for this plan's purposes; it is whether the console's read
   surfaces are worth building against the status those routes actually answer in the meantime, which
   [ADR-190](../decisions/ADR-190.md) measured as a **401** to an anonymous caller and a **500** to one carrying a
   cookie rather than the 503 this item used to name.** This plan's answer is yes, on the ground
   that `page.ts`'s `PendingPanel` and `data-trust.ts`'s missing-signal shape were designed for exactly
   that state, and on the ground that the arithmetic they render has been sitting unreachable for weeks.
   **It is a judgement about sequencing and it is stated as one.**

3. **`AdminReadSource.searchAccounts` AND `readAccount` ARE OWNED BY NO PLAN.** Section 6. Two of the six
   methods, two registered routes (`GET /admin/accounts` and `GET /admin/accounts/:accountId`), and no
   slice in `P5`, `P6`, `P7` or this wave writes their adapter. **`W6-j` writes the screen and states the
   gap rather than closing it**, because an adapter is an `apps/api` slice against
   [`admin-source/`](../../apps/api/src/admin-source/index.ts) and this wave's subject is `apps/admin`.
   **Whoever assigns it should assign it beside `P7-i` and `P7-j`, which is where the other four live.**

4. **WHAT THE CONSOLE'S FIRST SCREEN IS.** `M06` section 10's `OQ-M6-04` recommended _"yes, daily, one
   screen, and it is the first thing built in this module, because the habit is the control"_, and
   [ADR-066](../decisions/ADR-066.md) answered the DELIVERY half by sizing the daily liability digest
   MUST while leaving _"the 'one screen' half and the 'only alarms' alternative to the founder_", with
   `M06` explicitly declining to mark the question ruled. **This wave builds the liability home first
   (`W6-d`) and that is a transcription of `OQ-M6-04`'s recommendation rather than a ruling on it.** If
   the founder's answer is different, the slice that moves is `W6-d` and the wave order is unchanged.

**And one thing this plan states plainly rather than as an open question.** `M06`'s success condition is
_"not that the dashboard exists but that the founder looks at it and believes it."_ **Nothing in this
wave can deliver the second half.** Every slice here delivers a document with real numbers in it and a
stated absence where a number is missing, which is the precondition for belief and not belief itself.

---

## 11. The rules every prompt in this wave carries, written once here

1. **BUILD ONLY THE FENCE.** The fence is by file and it is absolute. A slice that needs a file outside
   its fence has found a finding; it reports it and does not take it.
2. **NO SLICE OPENS A DATABASE DOOR.** `apps/admin` declares no accessor, is not in `DB_ADMITTED`, and is
   a network client of `api-admin`. **No `SystemReason` member, no `SqlExecutorReason` member, no `pg`
   import, no cast past a key type.**
3. **NO HOSTNAME, EVER.** [ADR-012](../decisions/ADR-012.md). Not in a default, not in a comment, not in
   a test fixture, **and not in a build artifact**: the API base URL is relative and section 5.3 is why.
4. **AN ASSERTION THAT CANNOT REACH THE SERVED BYTES IS NOT AN ASSERTION.** Section 5.2. Any slice that
   renders a document re-points `assertNamesNoSubject` or `assertWithheld` at what the browser receives,
   in the same slice, or states in its pull request that the control no longer covers the surface.
5. **A BARREL LEG IS DATA AND NOT A HABIT.** After `W6-b`, a module that is neither a leg nor behind one
   fails a suite. Whoever resolves a conflict in `index.ts` keeps both sides and re-reads the file
   afterwards; **a green typecheck is not evidence there.**
6. **NO NUMBER IS TAKEN THAT THE PRE-DISPATCH COMMIT DID NOT CLAIM.** Two ADR numbers, no migration
   number, no `SD-M6-nn`, no `GS-nnn`, no `M6-N-nn`.
7. **REPRODUCE THE BASELINE BEFORE A LINE CHANGES**, on a branch sitting at `origin/main`: 33 of 33
   gates, 15 of 15 invariants, 212 files, 4,981 passed, 6 skipped. **Never `pnpm run verify`**; run each
   command separately.
8. **REPORT THE COUNT HONESTLY.** A session that runs out of context mid-set says which files landed and
   stops.

---

## 12. Dispatch order

```
Pre-dispatch commit: ALLOCATION claims TWO ADR numbers (W6-a, W6-e). No migration number.

Wave 1, TWO CONCURRENT (no shared file):
  W6-a  the framework is ruled          ADR-182 LANDED (nothing; held the pnpm-workspace.yaml fence)
        RULING 1 apps/admin SERVES HTTP.  RULING 2 Next.js App Router, closure delta ZERO.
        tsconfig did NOT move: it is W6-d's now, on ADR-095 F7.
  W6-b  the barrel and its assertion                   (nothing)

Wave 2, SERIAL:
  W6-c  the wire types and the one fetch               (needs W6-b on src/index.ts)
  W6-d  the layout and the liability home  DONE-GATE   (needs W6-a, W6-c; ORDER AFTER P5-l on page.ts)
        AND IT NOW HOLDS apps/admin/tsconfig.json

Wave 3, W6-e CONCURRENT WITH W6-d; W6-f and W6-g SERIAL on api/types.ts:
  W6-e  the event feed's contract row     ADR REQUIRED (nothing in this wave)
  W6-f  the flags queue screen                         (needs W6-d, W6-c)
  W6-g  the identity drill-down                        (needs W6-d, W6-c; after W6-f on api/types.ts)

Wave 4, THREE CONCURRENT:
  W6-h  the event feed screen                          (needs W6-e, W6-d)
  W6-i  the Playwright project, CI-08 to three of three (needs W6-d)
  W6-j  the account drill-down screen                  (needs W6-d, W6-c; its ADAPTER is nobody's)

Wave 5, NOT DISPATCHED:
  the live Open Liability panel     BLOCKED on P6-j, P6-g, and a VG-12 HUMAN APPROVAL
  the evidence-pack export          BLOCKED on ADR-171
  every mutating surface            BLOCKED on ADR-171, an ADMIN IDENTITY PROVIDER, a FOUNDER decision
  the M6-N-nn matrix, M6-U-01       BLOCKED on the same. Starts at M6-N-09
  the graph explorer, the six views TIERED to v1.x and sized SHOULD. Not blocked, not launch
```

**What is buildable without either blocker: `W6-a` through `W6-j`, ten slices.** They deliver the
framework, the transport seam, four rendered surfaces, the event feed's missing contract row, the barrel
repair and `CI-08`'s third project. **What is not: every write in the module, the live figure, and the
evidence export.** Neither blocker is routed around and neither is scheduled, because one is a purchase
and the other is a signature.
