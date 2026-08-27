---
status: draft
depends_on:
  [
    ../DELIVERY_PLAN.md,
    M07-risk-abuse.md,
    M06-admin-ops-console.md,
    M10-integrations.md,
    M19-kyc-identity.md,
    ../architecture/API_CONTRACT.md,
    ../architecture/STATE_MACHINES.md,
    ../architecture/EVENTS.md,
    ../ops/runbooks/CRON_INVENTORY.md,
    ../ops/runbooks/WEEKLY_RISK_RITUAL.md,
    ../testing/STRATEGY.md,
    ../decisions/ADR-022.md,
    ../decisions/ADR-040.md,
    ../decisions/ADR-041.md,
    ../decisions/ADR-068.md,
    ../decisions/ADR-100.md,
    ../decisions/ADR-112.md,
    ../decisions/ADR-120.md,
    ../decisions/ADR-122.md,
    ../decisions/ADR-144.md,
    ../decisions/ADR-145.md,
    ../decisions/ADR-155.md,
    P5-payouts-and-wallet.md,
  ]
last_updated: 2026-08-27
---

# P7 build: the phase whose three done-gates are each a REFUSAL, against a deployable that is not admitted to the database

**[P3](P3-ledger-billing-identity.md) measured [DELIVERY_PLAN section 4](../DELIVERY_PLAN.md)'s stated
contents against the tree and found none of six existing. [P4](P4-portal-and-site.md) ran the same method
and found three artifacts a gate already probed. [P5](P5-payouts-and-wallet.md) found four of five contents
were writes against an accessor that cannot lock. This document runs it on `P7`.**

**Measured at `4b7214e` on 2026-08-27**, with `pnpm install` run first because `pnpm run verify` cannot
typecheck without it. Every figure below was re-derived by running the command named beside it, and the
route figures were taken from the application rather than from a `grep`, because the dispatch brief warned
that two greps got it wrong the same day.

**This document carries ONE ruling of its own**, [ADR-155](../decisions/ADR-155.md), and section 4 is why.
The reservation's stated condition was the evidence-pack audience; **that condition did not fire, and the
measurement that refutes it is section 5.2.** What fired instead sits inside the other half of the same
`P7` row, `ADR-022`'s v1 tier, and that is what a CONDITIONAL reservation is for
([P5 section 5.1](P5-payouts-and-wallet.md) records the identical shape one phase over).

**`P7`'s three done-gates are each a refusal rather than a feature**, and that is the property that shapes
every slice below. A canary gate fires when a detector finds NOTHING. A redaction gate passes when a
document OMITS something. A breaker gate passes when the breaker DECLINES to fire. **None of the three can
be satisfied by writing more code**, and each of them is watched failing by seeding the thing it refuses.

---

## 1. The tree, measured

| Measurement | Command | Result |
|---|---|---|
| Gates | `node scripts/corpus/gates.mjs check` | **33 of 33 pass** |
| Repository invariants | `node packages/tooling/checks/repo-invariants.mjs` | **11 of 11 hold** |
| `pnpm run verify` | run end to end after `pnpm install` | **exit 0** |
| Test suite | `pnpm vitest run` | **169 files, 3,091 passed, 6 skipped** |
| **Registered routes** | `discoverRouteModules()` then `buildServer({ surface, modules })`, reading `CompositionReport.registered` | **36 on `public`, 19 on `operator`, 54 distinct.** `GET /health` is the one path both surfaces serve |
| **Route modules** | the same call, `modules.length` | **17**, and the list is [`ROUTE_MODULE_DIR`](../../apps/api/src/registry.ts)'s directory listing with no exclusion list |
| **Admin routes** | the same report, `operator` surface | **7 reads** in [`admin-reads.ts`](../../apps/api/src/routes/admin-reads.ts) and **7 writes** in [`admin-writes.ts`](../../apps/api/src/routes/admin-writes.ts). Section 5.1 |
| Migrations | `ls packages/db/migrations/*.sql \| wc -l` | **49.** The next free number is `0050` and this plan does not take it |
| **Tables in `scope.ts`** | `TABLE_KEYS.length` | **104** |
| **Every M07 table** | `TABLE_KEYS` and [`schema.ts`](../../packages/db/src/schema.ts) | `riskFlags`, `detectorRuns`, `detectorDefinitions`, `correlationGroups`, `identityLinks`, `identitySignals`, `identityPhones`, `evidencePacks`, `identityRestrictionEpisodes`, `planBreakerState`, `adminActions`, `alarmSuppressions`: **all twelve registered in both** |
| **`events`** | the same | **absent from both.** It is [`P5-b`](P5-payouts-and-wallet.md)'s and not this plan's |
| **Detector code** | `find apps/worker apps/admin -name '*.ts'` | **zero files name a detector.** `apps/worker/src` holds the nightly batch and the provisioning saga and nothing else |
| **Packages admitted to the database** | `DB_ADMITTED` at [`repo-invariants.mjs:951`](../../packages/tooling/checks/repo-invariants.mjs) | **one**, `@merit/api`. Section 3.2 |
| **What a filter may say** | [`scoped-db.ts:500`](../../packages/db/src/scoped-db.ts) | equality, ANDed. **No `OR`, no `IN`, no range, no `IS NULL`**, unchanged since [P5](P5-payouts-and-wallet.md) measured it |
| **`SystemReason`** | [`scoped-db.ts:177`](../../packages/db/src/scoped-db.ts) | `'nightly-batch' \| 'operator-console'` |
| **`SqlExecutorReason`** | [`scoped-db.ts:1361`](../../packages/db/src/scoped-db.ts) | `'job-enqueue'` |
| **`P7`'s golden scenarios** | [39-fixture-status-and-blockers](../testing/golden-scenarios/39-fixture-status-and-blockers.md) | `GS-112`, `GS-113`, `GS-118` to `GS-122`, `GS-235` to `GS-239`: **twelve rows, twelve `blocked / no-fixture-format`** |

---

## 2. P7's six stated contents, against the tree

[DELIVERY_PLAN section 4](../DELIVERY_PLAN.md) gives `P7`, at weeks 13 to 14, *"Tier-1 detectors including
D-12 to D-14, the flags queue, two-tier evidence packs, CUSUM and circuit breakers, [ADR-022]'s v1 tier
only, Metabase, Chatwoot and Loops wiring"*, with the done-condition *"Detector canaries found on every
run, evidence-pack redaction by audience green, the breaker reporting `insufficient_data` rather than
firing on a small sample"*.

| Stated content | State | What exists, and where |
|---|---|---|
| **Tier-1 detectors including `D-12` to `D-14`** | **SCHEMA COMPLETE, ZERO CODE, AND NO REGISTRY ROW** | All five `SD-M7-nn` deltas landed in [`0008`](../../packages/db/migrations/0008_risk.sql): `detector_runs.synthetic_expected` and `synthetic_found`, `risk_flags.sla_due_at` and `first_touched_at`, `detector_definitions` with `is_sensitive`, `identity_links.disputed_at` and `suppressed`, and `correlation_groups`. **Nothing reads or writes any of them.** `detector_definitions` is the registry `INV-M7-04` makes provenance depend on and it has **no seed**, so a detector run today could not record the parameters it ran under |
| **The flags queue** | **BOTH ROUTES LANDED AND NEITHER HAS A DATA SOURCE** | `GET /admin/flags` ([ADR-144](../decisions/ADR-144.md)) and `POST /admin/flags/:flagId/status` ([ADR-145](../decisions/ADR-145.md)) are registered on the operator surface, validated, role-guarded and ordered. **`AdminReadSource` is a PORT and nothing wires it**, and [`admin-reads.ts:621`](../../apps/api/src/routes/admin-reads.ts) states the reason in its own words: *"WHAT IS MISSING IS NOT AN AUTHORITY, IT IS A SHAPE"*. Section 3.1 |
| **Two-tier evidence packs** | **THE ROUTE LANDED WITHOUT THE COLUMN THE ROW REQUIRES** | `GET /admin/evidence/:accountId` is registered and requires a non-blank `reason`. [`0008:254`](../../packages/db/migrations/0008_risk.sql) makes `audience`, `redaction_profile` and `includes_detector_detail` all `NOT NULL`, and **`EvidenceExportRequest` carries none of the three**. No generator exists. Section 5.2 |
| **CUSUM and circuit breakers** | **THE TABLE LANDED, THE EVALUATOR DID NOT, AND THE TABLE CANNOT HOLD BOTH METRICS** | [`0016:126`](../../packages/db/migrations/0016_treasury_controls.sql) creates `plan_breaker_state` with `insufficient_data` as a first-class state and `plan_breaker_state_respects_min_sample` making the honesty structural. **Its primary key is `(plan_id, evaluated_on)` and `metric` is not in it**, so one plan-day holds one metric. [API_CONTRACT:633](../architecture/API_CONTRACT.md)'s `per_plan` carries the loss ratio **and** a `cusum` object. Section 5.3 |
| **[ADR-022](../decisions/ADR-022.md)'s v1 tier only** | **THE TIER IS TWO THINGS AND WHAT THE SECOND ONE DOES IS THE CONTRADICTION THIS PLAN MET** | v1 is *"Hard links plus KYC dedupe"*. [STATE_MACHINES:301](../architecture/STATE_MACHINES.md) says *"no automatic transition into `enforced`"*; `ADR-022`'s hard row says *"Auto-enforce"*. Section 4 and [ADR-155](../decisions/ADR-155.md) |
| **Metabase, Chatwoot and Loops wiring** | **THREE TABLES LANDED, NO ADAPTER, AND TWO OF THE THREE ARE INFRA RATHER THAN CODE** | `integrationContracts`, `integrationDispatches` and `supportContextViews` are all registered. `IN-M10-02` Metabase needs a column-filtered read replica (`DEP-M10-06`, INFRA), `IN-M10-01` Chatwoot needs a deployed instance, and **only `IN-M10-03` Loops is a code slice this repository can hold** |

**Two of the six exist as ROUTES with no source, three exist as SCHEMA with no code, and one is mostly
infrastructure.** That is a different shape from every prior phase plan: `P4` found artifacts a gate
probed, `P5` found writes against an accessor that cannot lock, and **`P7` finds a surface that is already
served and answers nothing.**

### 2.1 Which detectors are P7's, because the row says "including" and not "all"

`M07` section 3.2 holds eighteen detector rows and `P7` does not build eighteen. **The split is cited
rather than chosen.**

| Detectors | Phase | Cited to |
|---|---|---|
| `D-01` to `D-14` | **P7** | The `P7` row's *"tier-1 detectors including D-12 to D-14"*, and `M07` section 3.2 |
| `D-15` digital-footprint enrichment | **P3** | [DELIVERY_PLAN section 4](../DELIVERY_PLAN.md)'s `P3` row, *"[ADR-023] enrichment in observe mode"* |
| `D-16` link-confidence score | **SPLIT.** Its v1 half is P7 | `ADR-022` tiers the probabilistic scoring and the signal-weight table to **v1.x**, so what P7 builds is the hard-link half and never a weight |
| `D-17` behavioral fingerprint | **NOT P7, and not launch** | `ADR-022`'s post-launch tier, and [DELIVERY_PLAN section 5](../DELIVERY_PLAN.md) rows it out |
| `D-18` registration phone lookup | **SPLIT.** Its capture is P3's | `SD-M19-05` lands the columns in [`0029`](../../packages/db/migrations/0029_phone_identity_and_auth.sql) and P3 builds `M19`. **The detector reading them is P7's**, and its near-miss fixture is the one `M07` section 8 names as the one a reader would build wrong |

---

## 3. The preconditions, and P7 owns only one of the three

### 3.1 The read shape, which is `P5-a`'s file and not this plan's

**Every content in section 2 is a JOIN or an AGGREGATE, and the accessor offers keyed equality.** This is
not a new finding and this plan does not repeat P5's argument; what it adds is that **P7 needs strictly
more than `P5-a` was scoped to give.**

[`admin-reads.ts:621`](../../apps/api/src/routes/admin-reads.ts) already wrote the finding down, one
deployable over, for exactly these reads:

> *"The accessor's whole read vocabulary is `rows(key)`, `rowsWhere(key, filter)` and `rowAt(key,
> address)`, where a filter is a TYPED EQUALITY over declared columns. None of the seven bodies above is a
> projection of one table ... There is no join and no aggregate to reach for, so a live adapter written
> today would have to go through `sqlExecutor`, which would mean widening a one-member vocabulary to
> smuggle in the SQL the accessor deliberately does not offer."*

**The detectors are worse than the reads.** `D-01` is a self-join on `fills` inside a two second window.
`D-02` is a rolling correlation over twenty trading days. `D-03` compares the variance of a summed series
against a sum of variances across a discovered group. `D-14` sums positions across a clique. **Not one of
them is expressible as an equality conjunction over one table**, and none of them is expressible by the
three admissions [`P5-a`](P5-payouts-and-wallet.md) is scoped to make either, which are a range term, a
null term and a row lock.

**This plan does not hold [`scoped-db.ts`](../../packages/db/src/scoped-db.ts) and says so as a fence
rather than as a preference.** [P5 section 11](P5-payouts-and-wallet.md) rule 10 is explicit that `P5-a`
is the only slice that may move it, `P5-a` has not run, and a second phase minting a second slice on the
one door is the reach-around that rule exists to foreclose. **What this plan does instead is state the
argument where `P5-a`'s author will read it**, which is the only useful thing available to it: the
admission P7 needs is an **aggregate and a join**, it is larger than P5's three, and it should be argued
in the entry `P5-a` takes rather than discovered by the first detector slice. Section 10 item 1.

### 3.2 `apps/worker` is not admitted to the database, and this one IS P7's

`DB_ADMITTED` at [`repo-invariants.mjs:951`](../../packages/tooling/checks/repo-invariants.mjs) holds one
name, `@merit/api`, admitted by [ADR-120](../decisions/ADR-120.md) because that entry's subject was the
admission. The list's own header states the discipline it enforces:

> *"`apps/api` IS THE FIRST NAME THAT WILL JOIN, AND IT IS NOT PRE-ADMITTED ... so the day the API needs
> the accessor is the day somebody writes it here with a reason. Admitting it now, against a need nobody
> has yet stated, is the list joining itself."*

**[CRON_INVENTORY:27](../ops/runbooks/CRON_INVENTORY.md) rows detector runs as a scheduled job**, and
scheduled jobs are `apps/worker`'s. So the detector runner reads `fills`, `daily_marks`, `identity_links`
and `identity_signals` from a deployable that cannot declare the accessor at all. **That is `P7-a` and it
is a diff in one file with an argument attached**, which is the shape `RI-08` was written to force.

### 3.3 The fixture format, which is `ADR-125`'s and blocks all three done-gates

**Every one of the twelve golden scenarios in section 1's table is `blocked / no-fixture-format`**, and
three of them are the done-condition itself: `GS-122` is the canary gate, `GS-112` is the redaction gate,
`GS-113` is the breaker gate. **P7 cannot write a fixture format and must not invent one**, on
[P5 section 6](P5-payouts-and-wallet.md)'s precedent for the identical blocker.

---

## 4. THE CONTRADICTION, and it is ruled in [ADR-155](../decisions/ADR-155.md)

**`ADR-022`'s v1 tier is two things and the corpus answers both ways about what the second one does.**

| Source | What it says | Status |
|---|---|---|
| [ADR-022](../decisions/ADR-022.md), the **Hard** link row | *"Biometric dedupe hit, same payout destination, same payment fingerprint ... **Auto-enforce.** These are facts, not inferences"* | accepted, 2026-08-14 |
| [ADR-029](../decisions/ADR-029.md) | a hard link *"bans an account without human review"* | accepted, 2026-08-14 |
| [STATE_MACHINES:301](../architecture/STATE_MACHINES.md) | *"Binding: **no automatic transition into `enforced`.** Detectors only ever produce `open` ... Entering `enforced` requires an exported evidence pack id on the transition"* | **approved, `last_updated: 2026-08-20`** |
| [M19:95](M19-kyc-identity.md) `INV-M19-04` | a biometric dedupe hit *"**raises a flag against both identities and changes no state**"*, enforced by *"[STATE_MACHINES] section on the KYC machine, as approved"* | approved |
| [M07:1.3](M07-risk-abuse.md) `INV-M7-02` | *"No detector transitions a flag past `open`. Enforced by the writer: the detector service has no grant to write `status` values other than `open`. **Not a convention, a permission**"* | approved |
| [ADR-040](../decisions/ADR-040.md) | *"The detector's output is unchanged, still `open` and nothing else (INV-M7-02), and **no detector puts a request on hold**"* | accepted, **2026-08-15** |

**`M07` `OQ-M7-05` names this and deliberately refuses to settle it**, in its own words: *"One ruling's
words are not evidence about another signal, and the whole reason this question exists is that a phrase
was reused without being re-derived."* **This plan does not settle it either**, and it may not: whether
Merit ever bans a human on a face match without review is a decision about a false-match rate `M19`
`AS-M19-05` records as demographically uneven, and it is the founder's.

**What `P7` cannot dispatch a detector slice without is a different question, and it IS rulable.** A
detector's write vocabulary is not a policy about faces; it is which of two documents a slice reads. And
`P7` cannot leave it open, because the slice's first line of code is what it writes to
`risk_flags.status`.

[ADR-155](../decisions/ADR-155.md) rules four clauses: **`ADR-022`'s v1 tier names a LINK CLASS and
"auto-enforce" is the edge being written without review**, never a transition on the `risk_flags` machine;
**no detector writes a `status` other than `open`**, on the frozen state machine and on `ADR-040`'s
reaffirmation of it after `ADR-022` was accepted; **`OQ-M7-05` is NOT answered and is the founder's**; and
**`GS-235`'s subject line would settle it by fixture**, which is a finding this plan reports and does not
repair because the scenario's file is outside its fence.

**The entry also records the half of `INV-M7-02` that is not true today.** Its enforcement column says the
detector service *has no grant*. [`0026`](../../packages/db/migrations/0026_roles_and_grants.sql) creates
three roles, `merit_migrator` owns DDL and `merit_analytics` reads, **so the only role an application can
hold is `merit_app`, which holds full DML on `risk_flags`.** The permission the invariant claims does not
exist, the control today is the code path, and a grant is a migration this plan may not take. Section 10
item 2.

---

## 5. Five claims checked against their sources, and three did not survive

**A DISPATCH PROMPT IS NOT A SOURCE.** Every figure and citation in this session's brief was re-derived.

### 5.1 The route figures, one of which is wrong

| Cited | Verdict |
|---|---|
| *"The API serves 54 registered routes across `public` and `operator`"* | **CORRECT**, and it is a union rather than a sum. `public` registers 36 and `operator` 19; `GET /health` is registered on both, so the distinct count is 54. Taken from `CompositionReport.registered` and not from a `grep` |
| *"`ADR-144`, seven reads"* | **CORRECT.** [`admin-reads.ts`](../../apps/api/src/routes/admin-reads.ts) declares seven `/admin/*` paths and the operator report registers all seven |
| *"`ADR-145`, four writes"* | **WRONG, and the entry itself says so.** [`admin-writes.ts`](../../apps/api/src/routes/admin-writes.ts) declares **seven** `/admin/*` write paths and the operator report registers all seven. [ADR-145](../decisions/ADR-145.md)'s own opening sentence reads *"in all seven admin writes the `admin_actions` INSERT runs BEFORE the mutation"*, and its clause 1 repeats *"In all seven handlers"*. **The direction of the error matters**: a plan sized against four would have left three admin write paths, including `POST /admin/flags/:flagId/status`, out of the flags-queue slice's fence |
| *"`admin_actions.reason` is `NOT NULL` under NO UNEXPLAINED ADMIN ACTION, EVER"* | **CORRECT**, [`0017:82`](../../packages/db/migrations/0017_events_and_audit.sql), and `ADR-145` clause 1 makes the INSERT a precondition of the mutation rather than a log line. **One qualification the flags slice needs**: [ADR-145](../decisions/ADR-145.md) finding 1 measured that `NOT NULL` **admits an empty string**, `''` and `'   '` both inserting cleanly, so the non-blank half is the handler's |
| *"`ADMIN_ORIGIN` is a PLACEHOLDER and the real domain never enters the corpus"* | **CORRECT**, [ADR-012](../decisions/ADR-012.md), and `ADR-145` records a whole-diff grep for a domain-shaped string returning zero. No slice below carries a hostname |

### 5.2 THE RESERVATION'S OWN CONDITION, which does not fire, and the smaller thing that is actually there

**The brief reserves this session's number against the evidence pack**, on the ground that
`OQ-F4-03` left the audience question open *"in its own words: regulator audience vs trader audience are
different decisions"*, and that **an evidence pack is where that open question becomes a table.**

**It does not become a table, because the table was already written and it has three rows collapsed into
one.** [M06:300](M06-admin-ops-console.md) states the profile set in full:

> *"**`internal`, `counsel`, and `regulator`**: full detail including detector internals."*

and the [Wave 3 batch 1 gate closure](../decisions/gates/wave-3-batch-1-gate-closure-2026-08-14.md) says
the same thing from the ruling side: *"The `regulator` audience follows the internal profile."*
[EC-071](../edge-cases/EC-071.md) transcribes it a third time. **So all four audiences have a defined
redaction profile, two of the four are one profile, and `GS-112` is writable as stated.** The premise that
`P7` would have to invent a profile for a regulator is false.

**`OQ-F4-03` is still open and it is a different question from the one the brief framed.** [ADR-068
section 3](../decisions/ADR-068.md) asks whether an **impersonation record** appears in a regulator pack,
not whether a regulator pack carries detector internals. The first is unruled and belongs with counsel by
that entry's own words. **The second is closed.** Two questions about one column, and the resolution of
one is not evidence about the other, which is `OQ-M7-05`'s lesson arriving on a second identifier.

**What IS there is smaller than a ruling and larger than nothing, and it is a contract row.**

| Source | Says | Status |
|---|---|---|
| [API_CONTRACT:706](../architecture/API_CONTRACT.md) | *"Query `?reason=` is required."* No audience parameter, and `EvidencePackResponse` carries no audience either | approved |
| [M06:248](M06-admin-ops-console.md) | *"Requires `reason` **and** now `audience` (SD-M6-04). The redaction profile follows from the audience and is recorded on the pack, not chosen per export"* | approved |
| [`0008:254`](../../packages/db/migrations/0008_risk.sql) | `audience`, `redaction_profile` and `includes_detector_detail` are all `NOT NULL`, and `evidence_packs_trader_gets_no_detector_detail` constrains exactly one of the four | merged |
| [`admin-reads.ts`](../../apps/api/src/routes/admin-reads.ts) | `EvidenceExportRequest` is `{ accountId, reason, actor }` | landed 2026-08-27 |

**Three `NOT NULL` columns with no input**, which means the generator would supply an audience the caller
never named. `M06:248` already forbids that in words. **The repair is a contract row and it is `P7-b`**,
which is an ADR rather than a commit on [P4's `P4-f`](P4-portal-and-site.md) precedent, and it is the
slice's entry rather than this plan's. **`ADR-155` is not spent on it.**

**One further gap in the same DDL is named because a slice will meet it.** The CHECK constrains only the
`trader` row, so `audience = 'regulator'` with `includes_detector_detail = true` is representable, which
is correct under the ruling above. `redaction_profile` carries **no CHECK at all**, so a profile name is
free text and two exports can spell the same profile differently. `INV-M7-10` says the strip list is
`SD-M7-03`'s registry and `is_sensitive` is the column, so **the profile is derivable from data rather
than hand-maintained**, and `P7-j`'s prompt carries that.

### 5.3 The CUSUM has no storage, and a merged migration records that it does

**`plan_breaker_state`'s primary key is `(plan_id, evaluated_on)`** ([`0016:150`](../../packages/db/migrations/0016_treasury_controls.sql)),
**and `metric text NOT NULL` at [`0016:130`](../../packages/db/migrations/0016_treasury_controls.sql) is
not part of it.** One plan-day is one row and one row is one metric.

[API_CONTRACT:633](../architecture/API_CONTRACT.md) asks for two:

```ts
per_plan: Array<{ plan_id: string; code: string; loss_ratio_bp: number; threshold_bp: number;
                  sales_paused: boolean; cusum: { statistic: number; threshold: number; alarm: boolean } }>;
```

[`0049:48`](../../packages/db/migrations/0049_reserve_coverage_snapshots.sql), merged this same day,
dispositions that field:

> *"`per_plan` ALREADY HAS A HOME AND NEEDS NOTHING. API_CONTRACT's `per_plan` is loss ratio, threshold,
> `sales_paused` and CUSUM per plan, and that is `plan_breaker_state`, which `0016` built with `plan_id`,
> `evaluated_on`, `ratio_bp`, `threshold_bp` and a state enum whose values include `'paused'`."*

**Read the columns it names: it checked four of the five fields and the fifth is the `cusum` object.**
`plan_breaker_state` holds one `ratio_bp` and one `threshold_bp`, `P-M6-06`'s statistic is
`S_t = max(0, S_(t-1) + (x_t - mu_0 - 0.5*sigma))` alarming at four to five sigma, and **there is no
column a running `S_t` fits: `numerator_cents` and `denominator_cents` are cents, `ratio_bp` is basis
points, and the pass rate the CUSUM accumulates is neither.**

**So the disposition is right about three fields and false about the fourth**, and this is stated as a
finding rather than an error: `0049`'s subject was reserve coverage, it read the columns its own subject
needed, and nobody has since asked whether the CUSUM fits. **`P7-c` is the repair and it is a migration
plus a ruling.** Three readings are available and this plan takes none: `metric` joins the primary key; a
second table holds the CUSUM; or the CUSUM is **recomputed rather than stored**, which is arithmetically
available because `S_t` is a recurrence over a series the engine already keeps and which nothing about
storing it makes more reproducible. Section 10 item 3.

### 5.4 The breaker's floor is not this plan's to choose, and it is not one number

**The `P7` row's third gate is the breaker reporting `insufficient_data` rather than firing on a small
sample, and the number behind it is `OQ-M6-02`.** [M06:313](M06-admin-ops-console.md) states the proposal
and the discipline together: *"Proposed minimum: **20 purchases and 3 settled payouts on the plan in the
window** (OQ-M6-02). The number is a judgment; having one is not."* [M06:538](M06-admin-ops-console.md)
gives it to the founder: *"This is a judgment about how much evidence is enough to pause revenue."*

**This plan cites the number and does not choose it**, which is [ADR-122 section 6](../decisions/ADR-122.md)'s
posture applied to a second floor: *"A separate k floor with a different number is NOT invented here,
because a number chosen by a session is exactly the kind of publication policy `SD-M12-01` puts on a
versioned row with a founder's signature."* A breaker minimum pauses revenue and it has the same shape.

**One thing about the proposal is a schema question rather than a judgment, and the breaker slice meets
it.** `min_sample` is a single `integer NOT NULL CHECK (min_sample > 0)` at
[`0016:136`](../../packages/db/migrations/0016_treasury_controls.sql), and
`plan_breaker_state_respects_min_sample` is a single scalar comparison against `sample_size`.
**`OQ-M6-02`'s proposal is a conjunction of two counts over two different populations.** Whichever answer
the founder gives, **the row can express one of the two terms**, and the second lives in the evaluator or
it does not exist. **`P7-k`'s prompt carries that and does not resolve it**, because the resolution
depends on which number the founder picks. Section 10 item 4.

### 5.5 `apps/worker` has no route registry, so four detector slices serialize on one barrel

[ADR-100](../decisions/ADR-100.md)'s return is measured every day in `apps/api`: the module list is a
directory listing, every route slice adds a disjoint path, and `compose` refuses a duplicate
`METHOD /path` at startup rather than at merge. **`apps/worker` has none of that.**
[`apps/worker/src/index.ts`](../../apps/worker/src/index.ts) is a hand-maintained barrel of re-exports,
and every worker slice in section 8 edits it.

**This plan does not build a second registry** and it names the cost so a slice does not discover it:
`P7-e` through `P7-h` and `P7-k` and `P7-l` all touch that file, the collision is a keep-both merge that
type-checks, and section 9 rows the resolution.

---

## 6. What P7 is NOT

| Not P7 | Whose | Why the boundary is here |
|---|---|---|
| **[`scoped-db.ts`](../../packages/db/src/scoped-db.ts)** | **[`P5-a`](P5-payouts-and-wallet.md)** | Section 3.1. P5's own rule 10 makes it the one slice that may move the accessor, and a second phase minting a second slice on it is the reach-around that rule forecloses. **P7's argument goes into `P5-a`'s prompt, not into a P7 fence** |
| **The fixture format** | `ADR-125` | All twelve of P7's golden scenarios are `blocked / no-fixture-format`, including all three done-gates. **P7 cannot write one and must not invent one** |
| **`events`, and the event producer** | **[`P5-b`](P5-payouts-and-wallet.md)** and **[`P5-n`](P5-payouts-and-wallet.md)** | `events` is registered in neither `schema.ts` nor `scope.ts`, and naming an unregistered table is a compile error. `detector.run_degraded`, `identity.link_disputed` and `risk.group_detected` are all P7's to EMIT and none of them is P7's to give a table |
| **The payout hold, the freeze and the restriction** | **[M05](M05-payout-system.md), [`P5-j`](P5-payouts-and-wallet.md), [ADR-041](../decisions/ADR-041.md)** | `M07` section 1.2: enforcing is not M7's. A severity 4+ flag is `G-HOLD-REQUIRED`'s **input**, and the hold, its 48 hour clock and its expiry sweep are P5's |
| **`OQ-M7-05`** | the founder | Section 4. `ADR-155` rules which document a slice reads and refuses the policy |
| **`OQ-M6-02`'s number** | the founder | Section 5.4 |
| **A migration number** | the allocation commit | Section 7. `P7-c` needs one and this plan may not take it |
| **[M02](M02-rithmic-bridge.md)** | the Rithmic vendor call | It holds at `review` by [ADR-005](../decisions/ADR-005.md). `DEP-M7-01` makes `D-01`, `D-04` and `D-05` contingent on `V-M2-11`, which is a named residual and not a slice |
| **`D-17`, and `D-16`'s weights** | post-launch and v1.x | `ADR-022`, and the `P7` row says **v1 tier only** twice |

---

## 7. The registries this plan CANNOT spend

| Registry | State | Why this plan does not claim |
|---|---|---|
| **ADR numbers** | **`155` is this session's and it is SPENT**, on section 4. Sessions **265** and **267** hold `154` and `156` concurrently, so **the first free number is `157`** and it was read from [ALLOCATION](../decisions/ALLOCATION.md) rather than counted | `CI-06w` reads the table as a multiset and two sessions are running beside this one. **Five P7 slices need one** (`P7-a`, `P7-b`, `P7-c`, `P7-j` conditionally, and `P7-m` conditionally), and they are claimed in ONE commit before any slice runs |
| **Migration numbers** | **`0050` is free at this commit and this plan does not take it** | **`P7-c` needs one** for the CUSUM's home, and section 5.3 is why the shape is not decided either. A slice that reads the directory and takes the next number it can see is [session 120](../sessions/2026-08-21-session-120.md)'s move and produced `OI-27` |
| **`GS-nnn`** | **P7 claims none. All twelve already exist** and all twelve are blocked | Same advantage `P5` had, and for the same reason: the scenarios were written when the modules were |
| **`OI-nn`** | **P7 opens none and closes one.** `P7-k` closes [CRON_INVENTORY](../ops/runbooks/CRON_INVENTORY.md)'s numbered finding that *"the daily evaluations the last two rows depend on have no row in the scheduled table above"*, which is a finding rather than an `OI` row | Session **267** is closing `OI-28` and `OI-29` concurrently |
| **`RI-nn`** | **`P7-a` amends `RI-08`'s list and mints no new invariant** | The admission is a diff to `DB_ADMITTED`, which is `RI-08`'s subject and not a second check |

---

## 8. The wave

**Fences are by file, and every fence was checked against every other and against the two sessions running
beside this one.** Section 9 is the per-file table and it is the one to read.

### Wave 1: the preconditions. Four sessions, three of them concurrent

| # | Slice | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **`P7-a`** | **`apps/worker` is admitted to the database.** Section 3.2. `DB_ADMITTED` gains one name with a stated reason, and the worker gains the manifest entry and one adapter module. **`SystemReason` is NOT widened**: `'nightly-batch'` already names what a detector run is, and a third member taken for the detector service would be the vocabulary joining itself | `packages/tooling/checks/repo-invariants.mjs` (**the `DB_ADMITTED` array and its comment ONLY**), `apps/worker/package.json`, `apps/worker/src/db.ts` (new), `apps/worker/test/db.test.ts` (new), `docs/decisions/ADR-1NN.md` (new, **REQUIRED**), `ALLOCATION` (its row), `INDEX` (its row), `STATE` (append), `sessions/` | **no by file**, and it is the diff that decides which deployables can reach the trader database | **nothing. IT GOES FIRST**, and it is behind `P5-a` for a usable read shape |
| **`P7-b`** | **The contract gains the audience, and the two unregistered admin reads are reconciled.** Section 5.2. `GET /admin/evidence/:accountId` requires `audience` beside `reason`; `EvidenceExportRequest` gains the field; and `GET /admin/loss-ratios` and `GET /admin/cusum` are either given rows of their own or their shared heading is corrected, because the heading names three endpoints and one is registered. **[API_CONTRACT](../architecture/API_CONTRACT.md) is `approved`, so this is an ADR and not a commit** | `docs/decisions/ADR-1NN.md` (new, **REQUIRED**), `docs/architecture/API_CONTRACT.md`, `apps/api/src/routes/admin-reads.ts`, `apps/api/test/admin-reads.test.ts`, `ALLOCATION` (its row), `INDEX` (its row), `STATE` (append), `sessions/` | **no by file.** Sensitive by what it governs: the audience decides what leaves the building | **nothing.** Concurrent with `P7-a` |
| **`P7-c`** | **The CUSUM's home.** Section 5.3. One of the three readings, argued rather than assumed, and `0049`'s disposition of `per_plan` corrected in `DELTA_MANIFEST` rather than in `0049`, which is merged and sacred | `packages/db/migrations/00NN_*.sql` (new, **only if the reading needs one**), `packages/db/DELTA_MANIFEST.md`, `docs/architecture/data-model/plan_breaker_state.md`, a new `data-model/` record if a table lands, `packages/db/src/schema.ts`, `packages/db/src/scope.ts`, `docs/decisions/ADR-1NN.md` (new, **REQUIRED**), `ALLOCATION` (its row and its migration row), `INDEX` (its row), `STATE` (append), `sessions/` | **YES. E2 READ** if a migration lands. The breaker pauses revenue | a **migration number**, allocated in the pre-dispatch commit and NOT read from the directory |
| **`P7-d`** | **`detector_definitions` is seeded, and the seed IS the registry.** Every threshold in [M07 section 3.2](M07-risk-abuse.md) becomes a row with `version`, `parameters`, `effective_from` and `is_sensitive`, on [`packages/db/src/seed/calendars`](../../packages/db/src/seed/calendars)' shape. **`INV-M7-04` is what makes this a precondition and not a convenience**: a run that cannot record the parameters it ran under cannot answer *"why did this not fire in March"*, and `is_sensitive` is `P7-j`'s strip list | `packages/db/src/seed/detectors/**` (new), `packages/db/test/seed-detectors.test.ts` (new), `STATE` (append), `sessions/` | **no.** It is data, and every value in it is cited to `M07` | **nothing by file.** Its VALUES are `M07`'s and `OQ-M7-02` is the founder's on all of them |

**Wave 1 is CONCURRENT except on `packages/db/`.** `P7-c` and `P7-d` share `packages/db` and share no file
inside it; `P7-a` and `P7-b` share nothing with either or with each other.

### Wave 2: the detectors. Four sessions, disjoint by detector file and serial on one barrel

**Each detector family is its own module under `apps/worker/src/detectors/`, which is
[ADR-100](../decisions/ADR-100.md)'s shape applied one deployable over.** Section 5.5 is why that is a
convention here rather than a registry.

| # | Slice | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **`P7-e`** | **The detector runner and the canaries. THIS IS THE FIRST DONE-GATE.** `detector_runs` gains a producer; every run seeds synthetic subjects, asserts it found them, and a run that finds fewer than expected is `degraded` and emits `detector.run_degraded`. **The two implementation notes are `AS-M7-05`'s and both are assertions rather than prose**: synthetic subjects are **excluded from every aggregate**, enforced by a test over aggregate queries, and they are **regenerated per run** so a detector that memorised them cannot pass while broken. `GS-122` | `apps/worker/src/detectors/runner.ts` (new), `apps/worker/src/detectors/ports.ts` (new), `apps/worker/src/detectors/canary.ts` (new), `apps/worker/test/detector-runner.test.ts` (new), `apps/worker/src/index.ts`, `docs/ops/runbooks/CRON_INVENTORY.md` (**the detector-runs row ONLY**), `STATE` (append), `sessions/` | **no by file.** A flag it raises can hold a payout under [ADR-040](../decisions/ADR-040.md), and severity is the coupling | **`P7-a`**, **`P7-d`**, and `P5-a` for a read shape |
| **`P7-f`** | **The fill detectors: `D-01`, `D-04`, `D-05`.** `D-01` runs **on ingest as well as nightly** (`AS-M7-01` counter 2) and **filters same-identity pairs at the query** rather than dismissing them in the queue, on section 3.4's ruling. `D-04` fires **as a pattern across many events and never on one**. Every one of the three needs a **near-miss fixture as well as a positive** ([M07 section 8](M07-risk-abuse.md)) | `apps/worker/src/detectors/fills.ts` (new), `apps/worker/test/detectors-fills.test.ts` (new), `apps/worker/src/index.ts`, `STATE` (append), `sessions/` | **no by file** | **`P7-e`** for the runner and its ports; **`DEP-M7-01`**, which is `M02`'s `V-M2-11` and is a residual rather than a blocker |
| **`P7-g`** | **The graph detectors: `D-02`, `D-03`, `D-12`, `D-13`, `D-14`**, and `correlation_groups` gains its producer. **`D-02` is labelled a SECOND-CYCLE detector in the code** and `GS-118` asserts it did **not** fire on a five day life, which is the assertion a reader would omit. `D-13`'s three conditions are a conjunction and not a disjunction. `D-14` works on positions rather than realized P&L | `apps/worker/src/detectors/graph.ts` (new), `apps/worker/test/detectors-graph.test.ts` (new), `apps/worker/src/index.ts`, `STATE` (append), `sessions/` | **no by file** | **`P7-e`**; **`P5-a`** more than any other slice, because a variance ratio over a discovered group is the aggregate section 3.1 names |
| **`P7-h`** | **The identity and payment detectors: `D-07`, `D-08`, `D-09`, `D-10`, `D-11`**, plus **`D-16`'s v1 half and `D-18`'s detector**. **`ADR-155` binds here**: the hard link is written at the ceiling and the flag opens at `open`, and no slice writes `enforced`. **`D-18` tests `footprint_present IS FALSE` and never `IS NOT TRUE`**, and its near-miss is a vendor timeout | `apps/worker/src/detectors/identity.ts` (new), `apps/worker/test/detectors-identity.test.ts` (new), `apps/worker/src/index.ts`, `STATE` (append), `sessions/` | **no by file.** `D-09` is the strongest mule detector and its flags are severity 5 | **`P7-e`**; **[ADR-155](../decisions/ADR-155.md)** |

### Wave 3: the surfaces. Five sessions

| # | Slice | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **`P7-i`** | **The flags queue acquires a data source.** `AdminReadSource.listFlags` and `readIdentityGraph` get an adapter, and the queue's ordering is `AS-M7-03`'s: **by the number of INDEPENDENT detector families implicated on an identity, never by raw flag count**, so poisoning one detector does not move an identity up. `GS-120`. **The write side already exists** and this slice adds no second refusal to it | `apps/api/src/admin-source/flags.ts` (new), `apps/api/src/admin-source/graph.ts` (new), `apps/api/src/admin-source/index.ts` (new, **and section 9 is why it is separate**), `apps/api/test/admin-source-flags.test.ts` (new), `STATE` (append), `sessions/` | **no by file** | **`P5-a`**; **`P7-h`** for a flag to list |
| **`P7-j`** | **The evidence-pack generator. THIS IS THE SECOND DONE-GATE.** `AdminReadSource.exportEvidence` writes an `evidence_packs` row with all three `SD-M6-04` columns, and **the `trader` profile's strip list is COMPUTED from `detector_definitions.is_sensitive`** rather than hand-listed (`INV-M7-10`). `GS-112` asserts a `trader` pack carries every fill, mark, rule state, gate result and the plan's rule text plus the fact and ToS clause of a flag, **and no detector parameter, no threshold and no other identity** | `apps/api/src/admin-source/evidence.ts` (new), `apps/api/test/admin-source-evidence.test.ts` (new), `apps/api/src/admin-source/index.ts`, `docs/decisions/ADR-1NN.md` (**only if `redaction_profile`'s vocabulary needs a ruling**), `STATE` (append), `sessions/` | **no by file.** It decides what leaves the building, which is `AS-M6-01` | **`P7-b`** for the audience parameter; **`P7-d`** for the strip list; **`P5-a`** |
| **`P7-k`** | **The breaker and CUSUM evaluator. THIS IS THE THIRD DONE-GATE.** `plan_breaker_state` gains its daily producer, `sample_size` is written beside `min_sample`, **`insufficient_data` is the state below the minimum and sales are NOT paused**, and `breaker.state_changed` carries the sample size into the alert. `GS-113`. **It also closes [CRON_INVENTORY](../ops/runbooks/CRON_INVENTORY.md)'s own finding** that the recomputation both override-expiry rows depend on has no row in the scheduled table. **`INV-M5-12` binds and is repeated in the prompt: the breaker pauses SALES and can never pause payouts** | `apps/worker/src/breaker/evaluate.ts` (new), `apps/worker/src/breaker/ports.ts` (new), `apps/worker/test/breaker.test.ts` (new), `apps/worker/src/index.ts`, `apps/api/src/routes/admin-breaker.ts` (new, `GET /admin/loss-ratios` and `GET /admin/cusum`), `apps/api/test/admin-breaker.test.ts` (new), `docs/ops/runbooks/CRON_INVENTORY.md` (**the new evaluation row ONLY**), `STATE` (append), `sessions/` | **YES by content.** It pauses revenue | **`P7-a`**, **`P7-c`** for the CUSUM's home, **`P7-b`** for the two contract rows, **`P5-a`** |
| **`P7-l`** | **The two MUST digests acquire producers.** `weekly_loss_ratio_cusum` and `weekly_flag_queue` against [`0040`](../../packages/db/migrations/0040_report_schedules.sql)'s `report_schedules` and `report_deliveries`. **The alarm asserts the QUERY and never the job's own report** ([CRON_INVENTORY:35](../ops/runbooks/CRON_INVENTORY.md)): an enabled schedule whose window closed with no `delivered` row is the finding, evaluated independently of whether any run reported success | `apps/worker/src/digests/**` (new), `apps/worker/test/digests.test.ts` (new), `apps/worker/src/index.ts`, `STATE` (append), `sessions/` | **no by file** | **`P7-k`** for the loss-ratio digest's content; **`P7-i`** for the flag-queue digest's |
| **`P7-m`** | **Loops, and the two that are not code.** `IN-M10-03`'s outbound lifecycle events through `integration_contracts`' declared field allowlist, which is the row that makes *"what are we sending Loops"* answerable without reading a repository. **`IN-M10-01` Chatwoot and `IN-M10-02` Metabase are named as INFRA and not built here**: `DEP-M10-06` is a column-filtered replica and a `SELECT`-only role, and `AS-M10-02`'s strong control is a **nightly reconciliation against [M12](M12-transparency-platform.md)'s published definitions**, which is a Metabase question rather than a file in this tree | `apps/worker/src/integrations/loops.ts` (new), `apps/worker/test/integrations-loops.test.ts` (new), `apps/worker/src/index.ts`, `docs/decisions/ADR-1NN.md` (**only if `OQ-M10-02`'s vendor choice must be made to proceed**), `STATE` (append), `sessions/` | **no** | **`P5-b`** for `events`, because a lifecycle dispatch reads the event it is dispatching |

### Wave 4: NOT DISPATCHED, and each absence is a decision

- **`GS-235`'s subject line.** Section 4. *"v1 tier: a hard link auto-enforces"* would settle `OQ-M7-05`
  by being written, and the scenario's file is outside this plan's fence. Section 10 item 5.
- **`INV-M7-02`'s grant.** Section 4. The permission the invariant claims does not exist and the repair is
  a migration. Section 10 item 2.
- **The v1.x tier.** `ADR-022`'s probabilistic scoring, the signal-weight table and
  [M06](M06-admin-ops-console.md)'s graph explorer. **The `P7` row says v1 tier only, twice**, and
  `ADR-022`'s reason is data availability rather than ambition.

---

## 9. The collisions, BY FILE

| File | Held by | Why it collides, and the resolution |
|---|---|---|
| **[`packages/db/src/scoped-db.ts`](../../packages/db/src/scoped-db.ts)** | **[`P5-a`](P5-payouts-and-wallet.md)**, and every P7 slice depends on it | **NOT HELD BY THIS PLAN AT ALL**, section 3.1. The risk is that a detector slice reaches around it by adding a `SqlExecutorReason` member, which is the one line P5's rule 10 forecloses, and every P7 prompt repeats the foreclosure |
| **[`apps/worker/src/index.ts`](../../apps/worker/src/index.ts)** | **`P7-e`, `P7-f`, `P7-g`, `P7-h`, `P7-k`, `P7-l`, `P7-m`** | **SEVEN SLICES ON ONE HAND-MAINTAINED BARREL, and it is the largest collision in this phase.** Section 5.5. **SERIAL by wave**: `P7-e` first, then `P7-f`, `P7-g` and `P7-h` in any order, then wave 3. A keep-both merge of a re-export list type-checks and drops nothing, which is what makes it easy to miss rather than safe |
| **[`apps/api/src/admin-source/index.ts`](../../apps/api/src/routes/admin-reads.ts)** | **`P7-i`, `P7-j`**, and cross-phase **[`P5-l`](P5-payouts-and-wallet.md)** | **The composition file is separated from the per-read modules FOR THIS REASON.** `AdminReadSource` has six methods and three slices in two phases implement different ones; each writes its own module and only the composition is shared. **SERIAL on the index and concurrent on everything else**, which is `ADR-100`'s division reached by hand because the worker has no registry to inherit it from |
| **[`apps/api/src/routes/admin-reads.ts`](../../apps/api/src/routes/admin-reads.ts)** | **`P7-b`** alone | Session 256 landed it and no session in the current wave holds it. **`P7-i` and `P7-j` do NOT edit it**: they implement the port it declares, which is the separation that file's own header asks for |
| **[`packages/db/src/schema.ts`](../../packages/db/src/schema.ts)** and **[`scope.ts`](../../packages/db/src/scope.ts)** | **`P7-c`** only, and only if a table lands | **RULED by [ADR-092](../decisions/ADR-092.md) section 2**: the owner is the TABLE and the queue is the type checker. P7's one candidate table is disjoint from `P5-b`'s three and from `P5-e`'s and `P5-k`'s |
| **[`docs/architecture/API_CONTRACT.md`](../architecture/API_CONTRACT.md)** | **`P7-b`**, and cross-phase **[`P5-c`](P5-payouts-and-wallet.md)**'s eight rows | **STILL THE HOTTEST CROSS-PHASE FILE IN THE CORPUS** and [P4 section 10](P4-portal-and-site.md) item 2 left it unresolved. **P7 does not resolve it either**; it holds the file for one slice and takes its rows in one commit, and `P5-c`'s eight rows and `P7-b`'s are in different sections |
| **[`docs/ops/runbooks/CRON_INVENTORY.md`](../ops/runbooks/CRON_INVENTORY.md)** | **`P7-e`** (the detector-runs row), **`P7-k`** (a new evaluation row), and cross-phase **[`P5-j`](P5-payouts-and-wallet.md)** and **[`P5-k`](P5-payouts-and-wallet.md)** | **Four slices, one table, and SERIAL on [P4](P4-portal-and-site.md)'s `STRATEGY` reasoning**: `CI-06l` reads the release-job table as a whole and a keep-both merge produces a plausible table with one leg lost |
| **[`packages/tooling/checks/repo-invariants.mjs`](../../packages/tooling/checks/repo-invariants.mjs)** | **`P7-a`** alone | One array and its comment. **The fence is the array and not the file**, because eleven checks live in it and a slice that widens onto them is editing the estate's invariant set |
| **[`docs/decisions/ALLOCATION.md`](../decisions/ALLOCATION.md)** | **`P7-a`, `P7-b`, `P7-c`**, and `P7-j` and `P7-m` conditionally | **Five of thirteen.** `CI-06w` reads the table as a multiset, so **one commit claims all five ADR numbers and the migration number before any slice runs.** An expected collision costs a resolution; a discovered one costs a cycle |
| **[`docs/INDEX.md`](../INDEX.md)** | the same five | One row each. `CI-06c` reads INDEX completeness in **both** directions |
| **[`docs/sessions/README.md`](../sessions/README.md)** and **[`docs/STATE.md`](../STATE.md)** | every slice, and every session in the tree | The entry span is generated under [ADR-088](../decisions/ADR-088.md), so the resolution is to re-run `gates.mjs generate` rather than to merge by hand. **STATE is APPEND ONE SECTION AT THE END** |

---

## 10. What this plan cannot rule, for the founder

1. **The read shape P7 needs, which is larger than `P5-a`'s three admissions.** Section 3.1. A detector is
   a join and an aggregate, and `P5-a` is scoped to a range term, a null term and a row lock. **The
   argument belongs in `P5-a`'s entry**, because that is the slice that holds the file, and this plan can
   only put it where its author will read it. **If `P5-a` lands without an aggregate, every wave-2 slice
   is blocked and the reach-around is one line.**

2. **`INV-M7-02`'s grant, which does not exist.** Section 4. The invariant says the detector service *has
   no grant* to write a `status` other than `open`, and
   [`0026`](../../packages/db/migrations/0026_roles_and_grants.sql) creates one role an application can
   hold. **It is a migration and it is nobody's.** The code path is the control until it is written, which
   is a convention wearing the word permission.

3. **Where the CUSUM lives.** Section 5.3. Three readings, this plan takes none, and one of the three
   needs no migration at all. **`0049`'s disposition of `per_plan` is corrected in `DELTA_MANIFEST`
   whichever reading wins**, because a merged migration's comment recording a fit that is not there is the
   next session's false premise.

4. **`OQ-M6-02`'s number, and whether it is one number.** Section 5.4. The judgment is the founder's and
   the schema question is not: `min_sample` is one scalar and the proposal is two counts.

5. **`GS-235`'s subject line.** Section 4. *"v1 tier: a hard link auto-enforces"* is one of two readings
   the corpus carries, and it is the one that would be written into a fixture. **A fixture is a control**,
   which is [ADR-042](../decisions/ADR-042.md)'s ruling read forwards, **so a scenario written against an
   unsettled question settles it silently.** The row is in
   [39-fixture-status-and-blockers](../testing/golden-scenarios/39-fixture-status-and-blockers.md) and in
   [12-gs-112-to-gs-117](../testing/golden-scenarios/12-gs-112-to-gs-117-admin-and-ops-console-m6.md)'s
   sibling file, neither of which is in this fence. **It is small and it is a sentence somebody owes**,
   and today the only thing stopping it is that the row is `blocked`.

6. **`OQ-F4-03`, and it is counsel's rather than the founder's.** Section 5.2. Whether an impersonation
   record appears in a **regulator** pack is unruled; whether a regulator pack carries **detector
   internals** is closed. **The two are different questions about one column** and this plan separates
   them so a slice reading `SD-M6-04` does not treat the closed one as open.

7. **`OQ-M7-02`, the launch thresholds.** Every number in [M07 section 3.2](M07-risk-abuse.md) is from the
   dossier or from judgment, and `P7-d` writes all of them into `detector_definitions`. **The recommended
   posture is `M07`'s own**: tune for recall over precision during beta, everything above severity 3 to
   the digest rather than the queue. **The rows are data with an effective date, so the founder can move
   any of them without a deploy**, which is `SD-M7-03`'s whole reason.

---

## 11. The rules every prompt carries, written once here

These are [P5 section 11](P5-payouts-and-wallet.md)'s, unchanged where they held and amended where P7's
measurement paid for an amendment.

1. **The session-log stub is the first commit.** Objective and `placeholder` for every other field, strike
   your row in [sessions/README](../sessions/README.md), commit, push. **Then do the work.**
2. **Your log MUST carry an `<!--index: ... -->` line**, and `node scripts/corpus/gates.mjs generate` is
   part of writing a log rather than an optional tidy-up ([ADR-088](../decisions/ADR-088.md)).
3. **`git fetch origin main` immediately before asserting anything about a registry.**
4. **Commit and push after each file.** Not at the end.
5. **The fence is absolute.** If the work needs a file outside it, **stop and report it in the
   pull-request body** rather than reaching.
6. **[STATE](../STATE.md): append one `##` section at the END.** Edit no existing line.
7. **Your ADR number and any migration number are allocated in ONE commit before you run.**
8. **Your ADR states what it FORECLOSES, not only what it chooses.**
9. **A new document gets its `INDEX.md` row in the same change.**
10. **THE ACCESSOR IS THE ONE DOOR AND NO P7 SLICE MAY MOVE IT.** No slice adds a `SqlExecutorReason`
    member, adds a `SystemReason` member, imports `pg`, or casts past a key type. **`P5-a` holds that file
    and P7 does not.** If it did not give you what you need, **report it and stop**.
11. **NO DETECTOR WRITES A `risk_flags.status` OTHER THAN `open`**, and no slice adds an automatic path to
    `enforced`. [ADR-155](../decisions/ADR-155.md), and it is P7's own rule because P7 is the phase where
    the temptation is a Behavior column in an accepted entry.
12. **Every detector ships a NEAR-MISS fixture and not only a positive.** [M07 section
    8](M07-risk-abuse.md): a detector tested only against a case that should fire proves nothing about its
    threshold. **`D-18`'s near-miss is a vendor timeout** and the difference between `IS FALSE` and
    `IS NOT TRUE` is the whole reliability of that detector.
13. **A synthetic subject is excluded from every aggregate and regenerated per run.** `AS-M7-05`, and both
    halves are assertions rather than comments.
14. **Verify by running, never by reading.** `node scripts/corpus/gates.mjs check` and `pnpm run verify`
    leave green, and every completion claim in the pull-request body ships with its command and its
    output. **`pnpm install` first.**
15. **Report the count honestly.** *"I am at 3 of 5"* beats five thin files.
16. **Never weaken a gate to pass it and never widen a fence to finish.** They are the same move.
17. **Money is integer cents in every example you write**, doc examples included. `numerator_cents` and
    `denominator_cents` are `bigint` and `ratio_bp` is basis points, and **the CUSUM statistic is neither**,
    which is section 5.3.

**Money-path sessions: `P7-c` and `P7-k`.** Plan mode, fresh context, one objective,
[ADR-003](../decisions/ADR-003.md) strict, and `P7-c` carries the [E2](../../MERIT_BUILD_MASTER_PROMPT.md)
line-by-line read if a migration lands. **The rest are not money by file and every one of them can raise a
flag that holds a payout**, so severity scoring is treated as a money decision wherever a slice writes one
([M07 section 3.3](M07-risk-abuse.md): moving a detector from 3 to 4 changes who gets held).

---

## 12. The dispatch order

**Nothing below may be dispatched until section 7's allocation commit exists and section 10 items 1 and 3
are answered.** Item 1 blocks every slice that reads a row; item 3 blocks `P7-c` and `P7-k`.

```
Ahead of P7, and P7 does not hold either:
  P5-a   the accessor          ->  EVERY P7 slice that reads a row
  ADR-125  the fixture format  ->  all three of P7's done-gates

Wave 1, four sessions, concurrent except inside packages/db:
  P7-a  apps/worker admitted   ADR   ||   P7-b  the contract's audience   ADR
  P7-c  the CUSUM's home       ADR MIGRATION E2   ->   P7-d  the detector registry seed

Wave 2, after P7-a, P7-d and P5-a. SERIAL on the worker barrel:
  P7-e  the runner and the canaries        GATE 1
    then P7-f  fill detectors   ||   P7-g  graph detectors   ||   P7-h  identity detectors
    (concurrent by detector file, serial on apps/worker/src/index.ts)

Wave 3, after wave 2:
  P7-i  the flags queue source
  P7-j  the evidence-pack generator        GATE 2   (needs P7-b, P7-d)
  P7-k  the breaker and CUSUM evaluator    GATE 3   (needs P7-c, P7-b)
  P7-l  the two MUST digests               (needs P7-k, P7-i)
  P7-m  Loops, and two named as infra      (needs P5-b)

Wave 4, NOT DISPATCHED:
  GS-235's subject line, INV-M7-02's grant, the v1.x tier
```

**`P7-b` and `P7-d` are the two to run first and neither blocks on `P5-a`.** `P7-b` is a contract row and
`P7-d` is data cited to `M07`, so both are reachable today against a tree that cannot yet run a detector.
**`P7-a` is reachable today as well** and its value is not the code it lands: it is that the question
*"may a scheduled job read the trader database"* gets answered in the file whose subject it is, before a
detector slice answers it in a manifest diff.

**Thirteen slices, and the honest count of what is buildable today is two.** Every wave-2 and wave-3 slice
reads rows through a shape the accessor does not offer, from a deployable that is not admitted to the
database, against fixtures whose format is another session's ruling. **That is not a reason to wait. It is
the reason `P7-a`, `P7-b` and `P7-d` are three separate sessions that can all start now**, and the reason
`P5-a`'s prompt should carry section 3.1's argument before it runs rather than after.
