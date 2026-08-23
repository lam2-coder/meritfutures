---
status: draft
depends_on:
  [
    ../DELIVERY_PLAN.md,
    M03-billing-checkout.md,
    M08-affiliate-system.md,
    M19-kyc-identity.md,
    M02-rithmic-bridge.md,
    M05-payout-system.md,
    ../architecture/OVERVIEW.md,
    ../architecture/data-model/README.md,
    ../testing/STRATEGY.md,
    ../decisions/ADR-006.md,
    ../decisions/ADR-008.md,
    ../decisions/ADR-023.md,
    ../decisions/ADR-073.md,
    ../decisions/ADR-080.md,
    P1-monorepo-scaffold.md,
    P2-rules-engine-build.md,
  ]
last_updated: 2026-08-23
---

# P3 build: none of P3's six stated contents exists, and the reason is one precondition in no phase's contents

**[P2's build plan](P2-rules-engine-build.md) was worth having because it measured
[DELIVERY_PLAN section 4](../DELIVERY_PLAN.md)'s stated contents against the tree and found
**six of eight already there**. This document runs the identical method on P3. **The answer
comes back the opposite shape, and that is worth more than a repeat would have been.**

**Measured at `acd65a6` on 2026-08-23.** Every figure here was re-derived by running the
command named beside it, never inherited from a prior entry. Three things the dispatching
brief carried did not survive that, and one item this plan hands the founder turned out to be
sharper than the record says. Both are in section 4.

**This document carries no ruling of its own.** Every decision below is cited to the entry or
the file that took it, and every ruling it needs is proposed as an ADR for the founder.

---

## 1. The tree, measured

| Measurement | Command | Result |
|---|---|---|
| Gates | `node scripts/corpus/gates.mjs check` | **28 of 28 pass** |
| Tests | `pnpm exec vitest run` | 101 files, **1,417 passed, 1 skipped**. **[Session 139](../sessions/2026-08-22-session-139.md)'s entry records 1,410 and 2, and both moved**: sessions 134 and 137 landed between, and this figure is measured here rather than inherited |
| Fixtures | `CI-06/fixture-inventory` | **316 rows, 43 on disk: 43 written, 0 writable, 266 blocked, 7 covered-elsewhere** |
| Identifier series | `CI-06/identifier-series` | **117 series over 1,083 members**, reproducing [ADR-074](../decisions/ADR-074.md) as amended |
| Gate inventory | `CI-06/gate-inventory` | **10 stage rows: 5 implemented, 1 implemented and conditioned, 3 with no implementation leg, 1 discharged outside Actions** |
| **Runtime dependencies, whole workspace** | read every `package.json`'s `dependencies` | **ZERO.** Every block is empty or `workspace:*` |
| **Deployables** | `ls apps` | four: `admin`, `portal`, `site`, `worker` |
| **`build` scripts** | read every `package.json`'s `scripts` | **none**, so `CI-07`'s artifact is still absent |
| **Probes run against a live database in CI** | `grep -c 'probe_' .github/workflows/corpus.yml` | **12**, against 12 files on disk |
| Blocked fixture rows by cause | [section 39](../testing/golden-scenarios/39-fixture-status-and-blockers.md) | **229 `no-fixture-format`, 16 `format-cannot-express`, 14 `vendor-call`, 4 `outside-loader-boundary`, 2 `open-question`, 1 `no-plan-record-value`** |

---

## 2. P3's six stated contents, against the tree

[DELIVERY_PLAN section 4](../DELIVERY_PLAN.md) gives P3 *"Ledger, billing and checkout, coupons
and affiliate attribution, the provisioning saga against the simulator, **M19 KYC with the
composite trigger set**, **[ADR-023](../decisions/ADR-023.md) enrichment in observe mode**"*,
with the done-condition *"Webhook idempotency suite green, saga compensation green, fail-closed
provisioning holding an unconfirmed setpoint out of trading, verification firing at each
configured trigger"*.

| Stated content | State | What exists, and where |
|---|---|---|
| **The ledger** | **Schema only** | [`0009_ledger.sql`](../../packages/db/migrations/0009_ledger.sql), the `LEDGER-C1` and `LEDGER-C2` deferred triggers and the zero-sum trigger in [`0027`](../../packages/db/migrations/0027_triggers_invariants.sql), [`probe_ledger_constraints.sql`](../../scripts/db/probe_ledger_constraints.sql) running in CI. **No posting path, no accessor, zero TypeScript** |
| **Billing and checkout** | **Schema only** | [`0006_commerce.sql`](../../packages/db/migrations/0006_commerce.sql). No `PspAdapter`, no `POST /checkout`, no webhook handler, and **no deployable to host one** |
| **Coupons and affiliate attribution** | **Schema only** | [`0005_affiliate_program.sql`](../../packages/db/migrations/0005_affiliate_program.sql) and coupons in `0006`. Zero TypeScript |
| **The provisioning saga against the simulator** | **HALF, and the half that exists is P2's** | The simulator is complete in **both** modes: [`packages/rithmic`](../../packages/rithmic/src/index.ts) exports `streamRun`, `foldStream` and `sampleTicks`, which [P2's plan section 4.1](P2-rules-engine-build.md) already recorded. **The saga does not exist**: no `provisioning_queue` driver, no `ProvisioningOp` pipeline, no adapter implementation of `provision` or `entitle` |
| **M19 KYC, composite trigger set** | **Schema only, and the set is RULED** | [`0003_kyc.sql`](../../packages/db/migrations/0003_kyc.sql). The trigger set is `{second_distinct_account_purchase, pre_funded}`, earliest fires, ruled at the FREEZE gate ([M19 section 1.2.1](M19-kyc-identity.md)). Zero TypeScript |
| **[ADR-023](../decisions/ADR-023.md) enrichment, observe mode** | **Nothing** | No adapter, no `integration_contracts` row, no vendor selected |

**Zero of six exist as application code, and the one thing the phase asks for that does exist
was P2's.** That is the answer this plan was asked for. It is the inverse of P2's result and
the method is what makes both of them worth having.

### 2.1 Two P3 contents DELIVERY_PLAN section 4 does not list, and both are already ruled onto P3

| Item | Who put it here |
|---|---|
| **`PT-03`, ledger zero-sum in aggregate** | [`OQ-P2-04`](P2-rules-engine.md), **CLOSED 2026-08-16**. It tests ledger transactions in aggregate, pairs with `GS-231`, *"the ledger does not exist until P3, so it moves there whole"*. The `R-44` arithmetic half stayed in P2 under its own name |
| **`OI-29`'s enforcement** | [Session 132](../sessions/2026-08-22-session-132.md) and [P2's plan section 10](P2-rules-engine-build.md): the digest half is `P2-g`'s and *"its enforcement, a trigger or an application publish path, is P3's"* |

**Neither is in section 4's cell**, and a phase whose contents are read only from that cell
drops both. They are section 6's session `P3-e` and section 10's `PT-03` row respectively.

---

## 3. The precondition, which is the finding

**The six gaps in section 2 are not six gaps. They are one, and it is named in no phase's
contents.**

| The measurement | The file that says it |
|---|---|
| **Every `dependencies` block in the workspace is empty or workspace-only** | Read all twelve manifests. No `pg`, no Drizzle, no HTTP framework, no pg-boss, no PSP SDK |
| **`ScopedDb` is an interface with ONE field** | [`packages/db/src/index.ts`](../../packages/db/src/index.ts): *"NEITHER THE CLIENT NOR THE ACCESSOR EXISTS YET, and the scaffold does not invent them. What it fixes is that they will live here and nowhere else."* |
| **The nightly batch is written against ports BECAUSE there is no connection** | [`apps/worker/src/batch/ports.ts`](../../apps/worker/src/batch/ports.ts): *"There is no Drizzle client in this repository, no `pg` dependency in any manifest, and `ScopedDb` carries one field."* |
| **The three surfaces are pure render functions, not servers** | Sessions [110](../sessions/2026-08-21-session-110.md), [111](../sessions/2026-08-21-session-111.md) and [112](../sessions/2026-08-21-session-112.md). *"every public surface a pure function from config to a page model"* |
| **The `API` container is drawn and not rowed** | [OVERVIEW section 2](../architecture/OVERVIEW.md)'s C4 diagram declares `API [/api/v1]` inside the Merit boundary; **section 3's container table rows `apps/site`, `apps/portal`, `apps/admin`, three packages and `worker`, and no API**. [P1 section 3](P1-monorepo-scaffold.md) names four deployables and the workspace holds those four |

**So `POST /checkout`, `POST /webhooks/psp/:provider`, `POST /kyc/session` and every other
endpoint [API_CONTRACT](../architecture/API_CONTRACT.md) specifies have no deployable to live
in, and nothing anywhere can open a database connection.**

**[ADR-008](../decisions/ADR-008.md) is `accepted` and it already ruled this**, in its own
consequences: *"The `scopedDb(identity)` wrapper and the ESLint ban on direct client imports
(VG-4) are part of the acceptance, not a follow-up."* The ban is wired. The wrapper is not.
**[ADR-006](../decisions/ADR-006.md) is `accepted` and chose pg-boss** on the ground that
*"enqueue participates in the same transaction as the state change that caused it, which
removes a whole class of saga bugs"*, and made the job interface's narrowness *"a review
criterion on M2 and M5, not an aspiration"*. **Nothing in this tree enqueues anything**, so
the criterion has never been applied to an artifact.

**This is a [DELIVERY_PLAN](../DELIVERY_PLAN.md) question and not a session's.** P1's contents
are *"Monorepo scaffold, the reconciled schema and migrations, TradingCalendar as data, CI"*;
P2's are the engine and its test stack; P3's are the six above. **None of the three names a
database client, an HTTP surface or a job runner, and all six of P3's contents need all
three.** Section 9 puts it to the founder. It is not rewritten here, on [session
136](../sessions/2026-08-22-session-136.md)'s precedent that *"DELIVERY_PLAN is outside that
session's fence and its definition of done is not a session's to rewrite."*

---

## 4. Four claims checked against their sources, and three did not survive

**This is the section [CLAUDE.md](../../CLAUDE.md) asks for**, on its own statement that the
reconciliation session's worst errors *"were not capability failures. Each was a failure to
check a claim against the primary source."*

### 4.1 `CI-04` is three facts and the record carries one of them

[STATE](../STATE.md), [P2's plan section 9](P2-rules-engine-build.md) and the dispatching brief
all record `CI-04`'s Neon branch as *"ungranted"* and as something **no session can grant**.
That is true and it is one third of the position.

| Fact | Evidence |
|---|---|
| **A PostgreSQL database in CI EXISTS TODAY, under a different name** | [`corpus.yml`](../../.github/workflows/corpus.yml) runs `postgres:16` as an Actions service, applies all 46 migrations forward-only under `ON_ERROR_STOP=1`, and executes **twelve** `psql -f scripts/db/probe_*.sql` steps against it |
| **`CI-04`'s NAMED ARTIFACT does not exist** | [STRATEGY section 4.1](../testing/STRATEGY.md): *"Waiting, 2026-08-20. Artifact: a Neon branch provisioned for CI"* ([ADR-073](../decisions/ADR-073.md) section 4) |
| **`CI-04`'s SUBJECT has never run** | [`vitest.config.ts`](../../vitest.config.ts) declares `test: { name: 'integration' }` and **no workflow selects it**: [`ci.yml`](../../.github/workflows/ci.yml) runs `--project unit --project property`, [`golden.yml`](../../.github/workflows/golden.yml) runs `--project golden`. `RI-03` asserts the project exists; nothing runs it |

**All three belong in front of the founder, because the first alone invites the reading that
`CI-04` is nearly done and it is not.** What is available is a **capability** the tree already
has under a different name; what is missing is the artifact `ADR-073` chose **and** a workflow
that selects the project. `CI-06/gate-inventory` cannot see any of this and says so in its own
note: `CI-04`'s artifact *"is not a fact about this tree"*, so for that row the gate asserts
the **condition** and never probes.

**What the re-ruling would give up, stated rather than glossed: a service container is
empty-and-migrated per run, and a Neon branch is a branch of a real one.** For a suite over
migrations and seeded fixtures the first is what you want and `corpus.yml` proves it daily.
`ADR-073` is `accepted` ([session 126](../sessions/2026-08-21-session-126.md)), so amending
its condition is the founder's. `ADR-085`.

### 4.2 P3 does not wait on the vendor call, and it meets it at exactly one point

**It does not wait, and this is measured rather than assumed.** [M02](M02-rithmic-bridge.md)
declares `platform: 'rithmic' | 'simulator'` on the adapter interface; `INV-M2-11` makes
simulator output and vendor output pass through **the same parser and the same normalizer**;
[`packages/rithmic`](../../packages/rithmic/src/index.ts) exports both modes; and M02 section
3.5 point 4 states that the streaming mode exists so *"the live layer is developable and
testable before any vendor agreement exists"*. [P2's plan section 10](P2-rules-engine-build.md)
already ruled that none of its eight sessions waits on M02. **P3's saga is buildable and
testable end to end against the simulator, and this plan schedules nothing against the vendor
call.**

**It meets the vendor call once, and the point is P3's own definition of done.**
[Section 39](../testing/golden-scenarios/39-fixture-status-and-blockers.md) rows **all fourteen
M2 scenarios** as `blocked` with the blocker `vendor-call`, on the ground that M02 stands at
`status: review` under [ADR-005](../decisions/ADR-005.md). **`GS-138` is one of the fourteen**,
and `GS-138` is the fixture [M02](M02-rithmic-bridge.md)'s `INV-M2-13` cites for fail-closed
provisioning. DELIVERY_PLAN's third done-clause for P3 is *"fail-closed provisioning holding an
unconfirmed setpoint out of trading"*, which is `INV-M2-13` verbatim.

**So P3's third done-clause names an assertion the fixture registry says cannot be written.**
Whether [ADR-076 section 1](../decisions/ADR-076.md)'s governing rule -- *a row is discharged
when its assertion is EXECUTED somewhere a gate can read* -- discharges `GS-138` against the
**simulator**, given that `INV-M2-13`'s exit condition is a fact about the saga rather than
about Rithmic's wire format, is a **ruling** and it is not taken here. Section 9 puts it to the
founder.

### 4.3 `ADR-082` is dispatched and unreserved, and reserving `083` is what makes it visible

The brief states `083` is the next free ADR. **It is right, and `ALLOCATION`'s table ends at
`081`, so nothing in that file says why.** [`docs/sessions/README.md`](../sessions/README.md)
dispatches session 142 as *"`OI-28`, widening [ADR-042](../decisions/ADR-042.md)'s closed
`UNIT_TOKENS` for a calibration vendor's observation date (`ADR-082`)"* and **no ALLOCATION row
was ever written for it**. Every one of the 106 remote refs was read by file and by claim;
none holds `082` or above, and none holds `0047` or above, and none claims session 144 or
above.

**`CI-06f` could not catch it, and the reason is the useful half.** Gaplessness is asserted
over allocated plus reserved, and **an unreserved number at the TOP of the sequence opens no
hole**. Reserving `083` is precisely the event that turns `082` into a **middle** hole, which
is [ADR-055](../decisions/ADR-055.md)'s session exactly: it *"found `CI-06f` reporting `053`
and `054` as holes, could not invent their subjects, and had to stop and ask."* **Here the
subject is not invented**, it is written in the session register, so this plan writes `082`'s
reservation row **on session 142's behalf**, on ALLOCATION's own `044` precedent that a table
recording only what its own branch wrote is the table that let `ADR-031` collide.

**Session 142 will write an `082` row too and that duplicate is EXPECTED rather than
discovered.** `CI-06w` reads the allocation tables as multisets, one key one row, and the merge
keeps one, which should be 142's because it will carry the branch that holds the number. **A
collision that is expected costs a resolution; one that is discovered costs a cycle.**

### 4.4 The dispatching fence would have ended this session red, on the lesson the brief cites

The brief's fence is `docs/plans/P3-*.md`, `docs/decisions/ALLOCATION.md`, `docs/STATE.md` and
`docs/sessions/`. **`CI-06c` asserts INDEX completeness in both directions** -- *"every tracked
document appears in `docs/INDEX.md`, and every INDEX link resolves"* -- and
[`INDEX.md`](../INDEX.md) carries a row for [P2's build plan](P2-rules-engine-build.md). **A
new plan document with no INDEX row is a `CI-06c` finding**, and `docs/INDEX.md` was outside
the fence.

**This is [session 127](../sessions/2026-08-22-session-127.md)'s failure aimed at the session
that was told about it.** The fence is widened by one row in one file, `docs/INDEX.md`, and the
widening is stated here rather than reached for silently. **Where a change has a validating
half, the fence holds both halves**, and that rule is applied to every row of section 6.

---

## 5. The registries this plan spends, allocated before any session starts

**Every number below is claimed in [ALLOCATION](../decisions/ALLOCATION.md) and in
[sessions/README](../sessions/README.md) in this plan's own first commit**, before a line of
anything else was written. No session dispatched from this document reads a register and takes
the next free row. That is what [session 120](../sessions/2026-08-21-session-120.md) did, and
it is how `OI-27` was created.

| Registry | Claimed | For |
|---|---|---|
| ADR | `083`, `084`, `085`, `086`, `087` | `P3-a`, `P3-b`, `P3-c`, `P3-d`, `P3-e`. **`082` is also written here and it is a REPAIR rather than a claim**: it is session 142's, written on its behalf because reserving `083` is what turns its absence into a hole. Section 4.3 |
| Migration | `0047` | `P3-e`, **released if `ADR-087` takes the application path** rather than the trigger |
| Session number | `143` for this planning session, `144` to `148` | one per session below |

**Each of the three foundational rulings must state what it FORECLOSES and not only what it
chooses.** `ADR-083` picks a runtime, `ADR-084` picks a driver and a scoping mechanism, and
`ADR-086` picks a queue's primitives. Each is a decision this project lives with for years, and
an entry recording only the winner leaves the next reader unable to tell whether an alternative
was considered or never seen. `ADR-085` gets this for free: section 4.1's giving-up sentence is
already written.

---

## 6. The wave

**Fences are by file, and every fence below was checked against every other.** Two lessons are
applied literally, both paid for:

- **A session fenced out of the file that validates its change cannot end green** (section 4.4).
- **A depends-on column reads per item and collisions are per file.** If two sessions touch one
  file they are one session or they are ordered.

**Two collisions exist in rows this plan did not dispatch, and neither dispatch names them.**
Session **141** (`OI-27` and the `0015` citation audit) and session **142** (`OI-28`) were both
sent to *"the next session holding `DELTA_MANIFEST`"* in one sentence by [session
132](../sessions/2026-08-22-session-132.md), so **141 and 142 collide on
[`packages/db/DELTA_MANIFEST.md`](../../packages/db/DELTA_MANIFEST.md)**. And **142
additionally holds [`scripts/corpus/gates.mjs`](../../scripts/corpus/gates.mjs)**, where
`UNIT_TOKENS` lives. Both order ahead of the P3 sessions holding those files, and that is why
`146` and `148` carry `142` in their depends-on.

### Wave 1: the runtime. Four sessions, and it is SERIAL

**P2 ran five concurrent and this wave cannot, and the reason is a file rather than a
judgement.** Every session below adds the workspace's first runtime dependencies, and
[`pnpm-lock.yaml`](../../pnpm-lock.yaml) is one file that cannot be appended to per row. **A
plan claiming four concurrent here would produce four branches that each merge cleanly alone
and none of which merge together.** The shared file is named and the wave is ordered.

| # | Session | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **144** | `P3-a` the `API` container is ruled and gets a deployable (`ADR-083`) | `apps/api/**` (new), `docs/architecture/OVERVIEW.md` (section 3's container table only), `docs/decisions/ADR-083.md` (new), `docs/decisions/ALLOCATION.md` (its row only), `pnpm-lock.yaml`, `docs/INDEX.md` (its row only), `docs/STATE.md` (append only), `docs/sessions/` (its log and its row) | no | nothing |
| **145** | `P3-b` the Drizzle client and `scopedDb`'s methods (`ADR-084`) | `packages/db/src/**`, `packages/db/test/scoped-db.test.ts`, `packages/db/package.json`, `pnpm-workspace.yaml` (the `catalog:` block only), `pnpm-lock.yaml`, `docs/decisions/ADR-084.md` (new), `ALLOCATION` (its row only), `INDEX` (its row only), `STATE` (append), `sessions/` | **yes** | **144** via `pnpm-lock.yaml` |
| **146** | `P3-c` `CI-04` acquires an artifact and a selected project, and `VG-3` and `VG-6` expire with it (`ADR-085`) | `docs/decisions/ADR-085.md` (new), `ALLOCATION` (its row only), `docs/testing/STRATEGY.md` (section 4.1's `CI-04` row and section 4.2's `VG-3` and `VG-6` rows only), `.github/workflows/ci.yml`, `vitest.config.ts`, `scripts/corpus/gates.mjs`, `scripts/corpus/falsify.mjs`, `pnpm-lock.yaml`, `INDEX` (its row), `STATE` (append), `sessions/` | no | **145** via `packages/db` and `pnpm-lock.yaml`; **142** via `scripts/corpus/gates.mjs` |
| **147** | `P3-d` the job interface and pg-boss behind it (`ADR-086`) | `packages/queue/**` (new), `packages/queue/package.json`, `pnpm-workspace.yaml` (`catalog:` only), `pnpm-lock.yaml`, `apps/worker/src/index.ts`, `docs/decisions/ADR-086.md` (new), `ALLOCATION` (its row), `INDEX` (its row), `STATE` (append), `sessions/` | **yes** | **146** via `pnpm-lock.yaml`; **145** via `packages/db` |

**Why `146` holds `scripts/corpus/gates.mjs`, which it should not need.** Implementing `CI-04`
changes its `Closure` cell, and `CI-06/gate-inventory` reads that cell, probes the conditions
and holds a **register of unprobeable ones**. The gate's own words are that **an entry naming
no live condition is itself a finding**, so the register entry for `CI-04` must go in the same
change. Session 127 was fenced out of exactly this file for exactly this shape of change.

**Why `146` also holds `STRATEGY` section 4.2, which is a different table.**
[ADR-080](../decisions/ADR-080.md) rules that a chained condition **is available only while the
row it names is NOT implemented**. `VG-3` and `VG-6` are both `Chained, 2026-08-22, on CI-04`.
**The day `CI-04` is implemented, both become findings**, and the session that implements it is
the only one that can re-dispose them.

**`144` must not introduce a `build` script, and if `ADR-083`'s ruling requires one it STOPS
and reports.** `CI-06/gate-inventory` probes `apps/*/package.json` for a `build` script and
requires it **ABSENT**, so a bundler-needing framework makes the gate **fail on good news** the
day the script lands. Closing `CI-07` in the same breath needs `STRATEGY` section 4.1 and
`gates.mjs`, which are `146`'s. The four existing apps run TypeScript directly under
`node --experimental-strip-types` and this fence assumes `apps/api` does the same.

### Wave 2: one session, and it needs no runtime at all

| # | Session | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **148** | `P3-e` `OI-29`'s enforcement: the publish decision becomes SOUND (`ADR-087`, migration `0047`) | `docs/decisions/ADR-087.md` (new), `ALLOCATION` (its two rows only), `packages/db/migrations/0047_*.sql` (new), `packages/db/DELTA_MANIFEST.md`, `scripts/db/probe_*.sql` (new), `.github/workflows/corpus.yml`, `scripts/corpus/gates.mjs` (`CI-06h`'s needle list only), `docs/architecture/data-model/simulation_runs.md`, `docs/architecture/data-model/plan_versions.md`, `INDEX` (its row), `STATE` (append), `sessions/` | **yes, `E2`** | **141** and **142** via `packages/db/DELTA_MANIFEST.md`; **142** and **146** via `scripts/corpus/gates.mjs` |

**Why `148` holds `gates.mjs` and `corpus.yml`.** `CI-06s` requires every `scripts/db/probe_*.sql`
on disk to appear as a step in `corpus.yml` **and** as a needle in `CI-06h`'s required list in
`gates.mjs`. A session adding a probe and fenced out of either ships a gate finding. This is
[`0045`](../../packages/db/migrations/0045_simulation_runs.sql)'s precedent and it is why
`CI-06s` exists at all.

### Wave 3: the six modules, and this plan deliberately does not dispatch it

**Every module session's fence is a path inside a deployable [`ADR-083`](../decisions/ALLOCATION.md)
has not yet named.** Fencing by a path that does not exist is the WAVE-05 defect in its worst
form: a table whose depends-on column reads per item while its collisions are per file, over
files nobody can enumerate. **No number is claimed for wave 3**, because a reservation a later
plan reshapes is a reservation nobody can discharge.

What a second planning session inherits, stated so it does not re-derive it:

| Wave 3 slice | Ordering constraint, already known |
|---|---|
| The ledger posting path, and `PT-03` | First, because `M03`'s `INV-M3-10`, `M05`'s `DEP-M3-06` and `M08`'s commission clock all post through it. **Money path in its entirety** |
| The idempotency layer and the webhook receiver | Needs `144`'s deployable and `145`'s accessor. `idempotency_keys` is DDL today and `INV-M3-03`'s `(psp, provider_event_id)` uniqueness is already a constraint |
| Billing and checkout (`M03`) | After the ledger and the idempotency layer. `INV-M3-13`'s wallet leg commits in one transaction with the purchase, so the wallet's ledger accounts must exist first |
| Coupons and affiliate attribution (`M08`) | Attribution resolves **inside** the checkout transaction (`M08` section 3.1), so it is not separable from `M03`'s checkout session |
| The provisioning saga (`M02` against the simulator) | Needs `147`'s queue. `INV-M2-13`'s fail-closed exit is the saga's, and `GS-138` is section 9's item 3 |
| `M19` KYC, composite trigger set | `G-PLACEMENT-REACHED` fires at checkout under two of the triggers, so it is after `M03` |
| `ADR-023` enrichment, observe mode | Last, and smallest. **Non-blocking by ruling**, so nothing waits on it |

**Every one of these is money path except the enrichment call**, so each is `ADR-003` strict,
fresh context, one objective, with the founder's `E2` read.

---

## 7. The rules every prompt below carries, written once here

1. **The session-log stub is the first commit.** Write `docs/sessions/2026-08-23-session-<N>.md`
   with the objective and `placeholder` for every other field, strike your row in
   [sessions/README](../sessions/README.md), commit, push. **Then do the work.**
2. **Commit and push after each file.** Not at the end.
3. **The fence is absolute.** If the work needs a file outside it, **stop and report it in the
   pull-request body** rather than reaching.
4. **[STATE](../STATE.md): append one `##` section at the END.** Edit no existing line.
5. **Your ADR number and your migration number are allocated in section 5.** Do not read the
   register and take the next one you can see. **Amend your reservation IN PLACE** when the file
   lands ([ADR-065](../decisions/ADR-065.md) T3, enforced by `CI-06f`), and write it unlinked
   until then, because `CI-06a` fails on a link to an absent document.
6. **Your ADR states what it FORECLOSES, not only what it chooses.** Name what becomes expensive
   afterwards and what the choice makes unavailable. An entry recording only the winner leaves
   the next reader unable to tell whether an alternative was considered or never seen.
7. **A new document gets its `INDEX.md` row in the same change.** `CI-06c` reads both directions
   and section 4.4 is what happens when the fence forgets it.
8. **Open the pull request yourself, as ready for review. Do not merge it.**
9. **Verify by running, never by reading.** `node scripts/corpus/gates.mjs check` and
   `pnpm run verify` leave green, and every completion claim in the pull-request body ships with
   its command and its output.
10. **Report the count honestly.** *"I am at 3 of 5"* beats five thin files.
11. **Never weaken a gate to pass it and never widen a fence to finish.** They are the same move.
12. **Authority citations must resolve, and a merged constraint is checked for a superseding
    migration before it is cited.** [P2's plan section 4.2](P2-rules-engine-build.md) is what
    happens when it is not.

**Money-path sessions (`145`, `147`, `148`) additionally: plan mode, fresh context, one
objective, [ADR-003](../decisions/ADR-003.md) strict.**

---

## 8. The prompts

Each block is complete. Paste one into a fresh session and change nothing.

---

### `P3-a`: the `API` container is ruled and gets a deployable (session 144)

```
Branch: claude/p3a-adr083-api-deployable   (create from origin/main)
Fence:  apps/api/** (new), docs/architecture/OVERVIEW.md (SECTION 3's container
        table only), docs/decisions/ADR-083.md (new),
        docs/decisions/ALLOCATION.md (your row only), pnpm-lock.yaml,
        docs/INDEX.md (your row only), docs/STATE.md (append only),
        docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE. In particular: NOT packages/db (session 145 holds it),
        NOT docs/testing/STRATEGY.md and NOT scripts/corpus/ (session 146 holds them).
Regime: non-money. One objective. Your session-log number is 144. Your ADR number
        is 083, already reserved in docs/decisions/ALLOCATION.md. Amend that row
        IN PLACE when the file lands (ADR-065 T3, CI-06f enforces it).

OBJECTIVE
Write ADR-083 and create the deployable that serves /api/v1.

THE FINDING, AND VERIFY IT YOURSELF BEFORE YOU RULE. OVERVIEW section 2's C4
diagram declares SIX containers inside the Merit boundary and one of them is
`API [/api/v1]`. OVERVIEW section 3's container table rows apps/site,
apps/portal, apps/admin, three packages and worker. THE API IS NOT IN IT.
P1-monorepo-scaffold section 3 names four deployables and `ls apps` returns
those four. So every endpoint API_CONTRACT specifies -- POST /checkout,
POST /webhooks/psp/:provider, POST /kyc/session, all of them -- has no
deployable to live in, and P3 cannot start on any of its six stated contents.

WHAT THE RULING DECIDES. Where the API lives, and what runs it. Read
API_CONTRACT and SECURITY before you choose: ADR-012 puts admin on a separate
apex domain, SECURITY treats one owned admin as total loss, and P1 section 2
records that "the tempting scaffold is one application with three route groups.
That choice is invisible for months, is a re-platform to undo, and it silently
converts a security control into a URL convention." Decide whether that argument
reaches the API surface the same way, and say what you decided.

STATE WHAT YOU FORECLOSE, NOT ONLY WHAT YOU CHOOSE. A framework is a decision
this project lives with for years. Name what becomes expensive afterwards and
what the choice makes unavailable. An entry that records only the winner leaves
the next reader unable to tell whether an alternative was considered or never seen.

**DO NOT ADD A `build` SCRIPT, AND IF YOUR RULING REQUIRES ONE, STOP AND REPORT
IT.** CI-06/gate-inventory probes apps/*/package.json for a `build` script and
requires it ABSENT, because CI-07's whole row reads through an artifact that does
not exist. A build script makes that gate FAIL ON GOOD NEWS on the day it lands,
and closing CI-07 in the same breath needs docs/testing/STRATEGY.md and
scripts/corpus/gates.mjs, which are session 146's. The four existing apps run
TypeScript directly under `node --experimental-strip-types` and declare no build.

THIS IS A SHELL AND NOT A MODULE. No route implements a behaviour: the fence
holds no packages/db, so nothing here can open a connection anyway. What lands
is the deployable, its manifest, its tsconfig, its entry point, and the OVERVIEW
row that stops the diagram and the table disagreeing.

YOUR INDEX ROW IS NOT OPTIONAL. CI-06c reads both directions and a new document
with no docs/INDEX.md row is a finding. Same for your session-log row under
CI-06n.

APPROVAL LINE. Unsigned, naming ONE checkable clause and what it costs if wrong.
Candidate: "OVERVIEW section 2's container list and section 3's container table
name the same set, and no package.json in the workspace declares a `build`
script." Cost if wrong: CI-07 reopens on a phase that cannot close it, and the
diagram keeps promising a container nobody owns.

STOP CONDITION
One ADR, one deployable, one OVERVIEW row, 28 of 28 gates,
`node scripts/corpus/falsify.mjs` green, `pnpm run verify` green.
```

---

### `P3-b`: the Drizzle client and `scopedDb` (session 145, MONEY PATH, after 144)

```
Branch: claude/p3b-adr084-scoped-db   (create from origin/main AFTER 144 merges)
Fence:  packages/db/src/**, packages/db/test/scoped-db.test.ts,
        packages/db/package.json, pnpm-workspace.yaml (the `catalog:` block ONLY),
        pnpm-lock.yaml, docs/decisions/ADR-084.md (new),
        docs/decisions/ALLOCATION.md (your row only), docs/INDEX.md (your row only),
        docs/STATE.md (append only), docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE. In particular: NOT packages/db/migrations, NOT
        packages/db/DELTA_MANIFEST.md (sessions 141, 142 and 148 hold it), NOT
        apps/**, NOT scripts/corpus/.
Regime: MONEY PATH. PLAN MODE. Fresh context. One objective. ADR-003 strict.
        Your session-log number is 145. Your ADR number is 084, reserved.
        DEPENDS ON 144 via pnpm-lock.yaml.

OBJECTIVE
Write ADR-084 and build the Drizzle client and `scopedDb(identity)`, which
ADR-008 made part of its own acceptance and which does not exist.

THE CONDITION HAS BEEN OPEN SINCE 2026-08-13 AND ADR-008 IS ACCEPTED. Its
consequences say in terms: "The `scopedDb(identity)` wrapper and the ESLint ban
on direct client imports (VG-4) are part of the acceptance, not a follow-up."
THE BAN IS WIRED: `merit/no-raw-db-client` is attached in the workspace root's
eslint.config.js to apps/** and packages/** with packages/db/** as the single
`ignores` entry. THE WRAPPER IS NOT. packages/db/src/index.ts declares ScopedDb
as an interface carrying ONE FIELD and says so in its own words: "NEITHER THE
CLIENT NOR THE ACCESSOR EXISTS YET, and the scaffold does not invent them."

THIS IS THE SHARED PRECONDITION OF ALL SIX OF P3's STATED CONTENTS and it is
named in no phase's contents in DELIVERY_PLAN section 4. Do not widen past it.

THE RULING IS HOW THE SCOPE IS APPLIED, NOT WHICH ORM. ADR-008 already chose
Drizzle. What is undecided is the shape that makes the BOLA blast radius
reviewable: index.ts's own sentence is "the scope is applied in one place rather
than remembered at each call site". Decide what "one place" means concretely, and
decide what a caller that legitimately needs an unscoped read does instead,
because "there is no such caller" is a claim the admin liability dashboard will
test within one phase.

STATE WHAT YOU FORECLOSE. This introduces the workspace's FIRST runtime
dependency. pnpm-workspace.yaml's `onlyBuiltDependencies: []` and its exact-version
catalog make that a VG-12 human approval decision rather than an install, and the
file says so in its own comment. Name what the driver choice makes expensive later.

MIGRATIONS ARE NOT SOURCE AND YOUR FENCE EXCLUDES THEM. packages/db/src/index.ts:
"migrations/ is plain reviewable SQL, forward only, reviewed on main, never
edited after merge, only superseded (constitution E2). It is excluded from this
package's tsconfig, from ESLint, and from Prettier." Generate no schema from
them and generate none of them.

packages/db/test/scoped-db.test.ts EXISTS AND ASSERTS NOTHING TODAY. It is in
your fence because it is the validating half of your own change.

APPROVAL LINE. Unsigned, one checkable clause. Candidate: "`merit/no-raw-db-client`
reports zero findings across apps/** and packages/** with packages/db/** the only
exemption, and every method on ScopedDb takes its identity from the accessor
rather than from an argument." Cost if wrong: the one place the scope is applied
becomes one of the places it is applied, which is the BOLA blast radius ADR-008
scoped the wrapper to bound.

STOP CONDITION
One ADR, the client, the accessor, its suite, 28 of 28 gates, falsify green,
`pnpm run verify` green. Do NOT merge before the E2 read.
```

---

### `P3-c`: `CI-04` acquires an artifact and a selected project (session 146, after 142 and 145)

```
Branch: claude/p3c-adr085-ci04-artifact   (create from origin/main AFTER 142 and 145 merge)
Fence:  docs/decisions/ADR-085.md (new), docs/decisions/ALLOCATION.md (your row only),
        docs/testing/STRATEGY.md (section 4.1's CI-04 row and section 4.2's VG-3
        and VG-6 rows ONLY), .github/workflows/ci.yml, vitest.config.ts,
        scripts/corpus/gates.mjs, scripts/corpus/falsify.mjs, pnpm-lock.yaml,
        docs/INDEX.md (your row only), docs/STATE.md (append only),
        docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE. In particular: NOT packages/db, NOT apps/**, and NOT
        any other row of STRATEGY section 4.1 or 4.2.
Regime: non-money. One objective. Your session-log number is 146. Your ADR number
        is 085, reserved. DEPENDS ON 145 via packages/db and pnpm-lock.yaml, and
        ON 142 via scripts/corpus/gates.mjs.

OBJECTIVE
Write ADR-085 and give CI-04 a condition it can actually discharge, or implement
it, depending on the founder's answer in the P3 plan section 9 item 2.

THE POSITION IS THREE FACTS AND THE RECORD CARRIES ONE. MEASURE ALL THREE
YOURSELF BEFORE YOU WRITE A LINE:
  a. A PostgreSQL database in CI EXISTS TODAY. .github/workflows/corpus.yml runs
     `postgres:16` as an Actions service, applies all migrations forward-only
     under ON_ERROR_STOP=1, and executes twelve `psql -f scripts/db/probe_*.sql`
     steps against it.
  b. CI-04's NAMED ARTIFACT does not exist. STRATEGY section 4.1: "Waiting,
     2026-08-20. Artifact: a Neon branch provisioned for CI" (ADR-073 section 4).
  c. CI-04's SUBJECT HAS NEVER RUN. vitest.config.ts declares
     `test: { name: 'integration' }` and NO WORKFLOW SELECTS IT: ci.yml runs
     `--project unit --project property` and golden.yml runs `--project golden`.

(a) ALONE INVITES THE READING THAT CI-04 IS NEARLY DONE AND IT IS NOT. Closing
the artifact question does not by itself close the row, because nothing runs the
project. Your entry states all three.

STATE WHAT THE RE-RULING GIVES UP. A service container is empty-and-migrated per
run; a Neon branch is a branch of a real one. That difference is the whole cost
and it belongs in the entry rather than in a pull-request comment.

ADR-073 IS `accepted`. You are amending a signed ruling, so your status is
`proposed` and the signature is the founder's.

**TWO VG ROWS EXPIRE THE DAY CI-04 IS IMPLEMENTED AND THAT IS WHY STRATEGY
SECTION 4.2 IS IN YOUR FENCE.** ADR-080 rules that a chained condition "is
available only while the row it names is NOT implemented". VG-3 and VG-6 both
read "Chained, 2026-08-22, on CI-04". If you implement CI-04 and leave them, you
land two findings. Re-dispose both, in this session, on ADR-080's own rules.

**scripts/corpus/gates.mjs IS IN YOUR FENCE FOR THE SAME REASON.**
CI-06/gate-inventory reads CI-04's Closure cell AND holds a register of
conditions it cannot probe. Its own words: "an entry naming no live condition is
itself a finding". Session 127 was fenced out of exactly this file for exactly
this shape of change and ended red on nine findings through no fault of its own.

DO NOT RELAX A GATE TO MAKE A NUMBER COME OUT, and do not select the integration
project without giving it something to assert: vitest exits non-zero when a
selected project matches no test files, and ci.yml's own comment says that is
deliberate.

APPROVAL LINE. Unsigned, one checkable clause. Candidate: "CI-06/gate-inventory
reports CI-04 with a leg it can read, its register carries no entry naming a
condition that is no longer live, and every VG row chained on CI-04 carries a
disposition ADR-080 admits." Cost if wrong: a merge-blocking row is closed
against a suite that never runs, which is the state ADR-073 exists to end.

STOP CONDITION
One ADR, STRATEGY's three rows amended, 28 of 28 gates, falsify green with the
CI-04 case watched failing in both directions, `pnpm run verify` green.
```

---

### `P3-d`: the job interface and pg-boss (session 147, MONEY PATH, after 146)

```
Branch: claude/p3d-adr086-job-interface   (create from origin/main AFTER 146 merges)
Fence:  packages/queue/** (new), packages/queue/package.json,
        pnpm-workspace.yaml (the `catalog:` block ONLY), pnpm-lock.yaml,
        apps/worker/src/index.ts, docs/decisions/ADR-086.md (new),
        docs/decisions/ALLOCATION.md (your row only), docs/INDEX.md (your row only),
        docs/STATE.md (append only), docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE. In particular: NOT apps/worker/src/batch/** (its
        ports are the nightly batch's boundary and are not yours), NOT
        packages/db/src, NOT apps/api.
Regime: MONEY PATH. PLAN MODE. Fresh context. One objective. ADR-003 strict.
        Your session-log number is 147. Your ADR number is 086, reserved.
        DEPENDS ON 146 via pnpm-lock.yaml and ON 145 via packages/db.

OBJECTIVE
Write ADR-086 and build the job interface ADR-006 made a review criterion, with
pg-boss behind it.

ADR-006 IS `accepted` AND IT ALREADY CHOSE. Read it in full first. The decision
is pg-boss; the reason is that "enqueue participates in the same transaction as
the state change that caused it, which removes a whole class of saga bugs
('committed the purchase, lost the provisioning job')"; and the consequence it
records is the thing you are building: "The job interface stays narrow enough
that a later move to BullMQ is a contained change, and that narrowness is now a
review criterion on M2 and M5, not an aspiration."

NOTHING IN THIS TREE ENQUEUES ANYTHING, so that criterion has never been applied
to an artifact. Verify that yourself before you rely on it.

WHAT THE RULING DECIDES IS THE SURFACE, NOT THE VENDOR. Which primitives the
interface exposes, and what a caller does that pg-boss offers and BullMQ does not
(or the reverse). STATE WHAT YOU FORECLOSE: a primitive admitted here that
Postgres provides and Redis does not is exactly what makes ADR-006's "contained
change" expensive, and naming those at the boundary costs less than discovering
them at the move.

THE TRANSACTIONAL ENQUEUE IS THE POINT AND IT IS WHY THIS IS MONEY PATH.
An enqueue that cannot join the caller's transaction reintroduces the bug ADR-006
was accepted to remove, and P3's "saga compensation green" done-clause rests on
it. Whatever shape you choose must make the non-transactional enqueue the
awkward one to write.

WHY packages/ AND NOT apps/. pnpm-workspace.yaml: "apps/* are DEPLOYABLES and
packages/* are LIBRARIES, and the split is not decoration: VG-4 is a custom
ESLint rule banning raw client imports in app paths". Both apps/api and
apps/worker consume this, so it is a library. If your ruling disagrees, say why
and stop before you move it.

CRON_INVENTORY IS NOT IN YOUR FENCE and the scheduled jobs are not yours. What
lands is the interface and its adapter, not a job.

APPROVAL LINE. Unsigned, one checkable clause. Candidate: "every method on the
job interface is expressible against both pg-boss and a queue with no
transactional enqueue, and the ones that are not are named in the entry as the
foreclosure." Cost if wrong: ADR-006's contained change becomes a rewrite, and
the criterion it made a review item was never applied to the artifact it was
about.

STOP CONDITION
One ADR, the interface, its adapter, its suite, 28 of 28 gates, falsify green,
`pnpm run verify` green. Do NOT merge before the E2 read.
```

---

### `P3-e`: `OI-29`'s enforcement (session 148, MONEY PATH, E2 READ, after 141, 142 and 146)

```
Branch: claude/p3e-adr087-0047-publish-decision   (create from origin/main AFTER 141, 142 and 146 merge)
Fence:  docs/decisions/ADR-087.md (new), docs/decisions/ALLOCATION.md (your TWO
        rows only), packages/db/migrations/0047_*.sql (new),
        packages/db/DELTA_MANIFEST.md, scripts/db/probe_*.sql (new),
        .github/workflows/corpus.yml, scripts/corpus/gates.mjs (CI-06h's needle
        list ONLY), docs/architecture/data-model/simulation_runs.md,
        docs/architecture/data-model/plan_versions.md,
        docs/INDEX.md (your row only), docs/STATE.md (append only),
        docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE. In particular: NOT packages/db/src, NOT
        packages/rules-engine, NOT apps/**.
Regime: MONEY PATH. PLAN MODE. Fresh context. One objective. ADR-003 strict.
        E2: this branch waits on the founder's line-by-line read and must not be
        merged before it. Your session-log number is 148. Your ADR number is 087
        and your migration number is 0047, both reserved.
        DEPENDS ON 141 and 142 via packages/db/DELTA_MANIFEST.md, and ON 142 and
        146 via scripts/corpus/gates.mjs.

OBJECTIVE
Write ADR-087 and close OI-29: make the publish decision SOUND rather than only
present.

THE DEFECT, IN DELTA_MANIFEST's own words. 0004_catalog.sql's
`plan_versions_publish_decision_recorded` makes the link to a simulation run
EXIST. "Nothing makes it SOUND, because a CHECK cannot read another table.
Writable today and satisfying the constraint: a publish decided on a `failed`
run; a publish decided on a run over a draft that has since been edited, so
`rules_digest` no longer matches; a publish decided on a run belonging to a
different plan entirely."

THIS IS THE HALF SESSION 132 SENT TO P3. The digest half was session 138's
(`hash.ts` into the engine); "its enforcement, a trigger or an application
publish path, is P3's". Read session 138's entry and ADR-081 before you start:
whether `rules_digest` is computable at all today is a fact you must check
rather than assume.

THE RULING IS THE CHOICE BETWEEN TWO MECHANISMS AND BOTH ARE REAL. 0004's own
header states the trigger's cost in terms: it "is a weaker control: it can be
disabled, and it fires per row rather than per constraint". An application
publish path is stronger where it runs and absent where it does not. Decide, and
state what the loser gives up rather than only why the winner wins.

**IF YOU RULE THE APPLICATION PATH, 0047 IS RELEASED** and you say so in
ALLOCATION rather than leaving a hole nobody can account for. Do not spend a
migration number to avoid an awkward row.

0004 IS MERGED, SO IT IS NEVER EDITED AND ONLY SUPERSEDED (constitution E2).
0037 and 0046 are your models and your precedent; read both, and note that
ADR-053 REFUSED to reuse a superseded constraint's name because that leaves every
existing reference pointing at a constraint whose meaning changed. Decide the
same question here and say what you decided.

**BEFORE YOU CITE ANY CONSTRAINT BY FILE AND LINE, GREP THE MIGRATION DIRECTORY
FOR A SUPERSEDING ONE.** Session 129 reported a finding against 0015:208 that
0037 had already repaired. Do not reproduce that.

THE PROBE ASSERTS IN EVERY DIRECTION THE CONSTRAINT CAN GO, NOT ONLY THE ONE
THAT MOTIVATED IT. Session 135's entry is the reason this sentence is here: the
row that ADR-079 existed for turned out to be EXEMPT from its own replacement,
so a probe asserting only "the motivating row now inserts clean" would have
shipped a control that refuses nothing, ever. Assert each of DELTA_MANIFEST's
three writable-and-wrong states separately, and assert the legitimate publish
still commits. Run it against a real PostgreSQL 16 in both database states.

**YOUR PROBE MUST BE WIRED AND PINNED, WHICH IS WHY corpus.yml AND gates.mjs ARE
IN YOUR FENCE.** CI-06s requires every scripts/db/probe_*.sql on disk to appear
as a step in corpus.yml AND as a needle in CI-06h's required list. Touch nothing
else in gates.mjs.

APPROVAL LINE. Unsigned, one checkable clause. Candidate: "the probe watches each
of DELTA_MANIFEST's three unsound publish states REFUSED by name at 0047 and
PERMITTED at 0046, and watches a sound publish commit at both." Cost if wrong: a
publish decided on a failed simulation reaches live accounts with a constraint
standing beside it saying it did not.

STOP CONDITION
One ADR, one migration (or a released number with its reason), one probe run in
every direction, DELTA_MANIFEST rows, both data-model pages, 28 of 28 gates, all
migrations applying forward-only into an empty PostgreSQL 16.
DO NOT MERGE. E2 read pending.
```

---

## 9. What this plan hands the founder, none of them a session

| # | Item | What is needed |
|---|---|---|
| **1** | **`OQ-F6-01`, the dual-control threshold in integer cents** | **Recommendation: 10,000 cents, and the arithmetic is the argument.** [M20](M20-wallet.md) `WF-M20-02` sets the external withdrawal minimum at **$100**, so at 10,000c **every adjustment large enough to be withdrawn on its own requires a second key, and no adjustment below it can leave the platform in one movement**. [`0038`](../../packages/db/migrations/0038_account_adjustments.sql) makes `dual_control_threshold_cents` a `bigint NOT NULL CHECK (> 0)` **column per row** rather than a lookup, so the number is what the application writes at the time, and `account_adjustments_dual_control_above_threshold` reads `amount_cents < dual_control_threshold_cents OR dual_control_approval_id IS NOT NULL`. **Until a value exists the `CHECK` is INERT and the dual-control half of [ADR-067](../decisions/ADR-067.md) is specification rather than enforcement.** **`OQ-F6-02`'s sub-threshold aggregation gap is NOT closed by any value here**, and it is named beside it so the answer does not read as covering both: repeated sub-threshold credits by one actor are unconstrained at any threshold, and `account_adjustments_actor_idx` exists so that whoever rules it already has the query. **On P3's path because adjustments post to the ledger**, which is P3's first content |
| **2** | **`CI-04`: two doors, and the second costs a ruling rather than an account** | Section 4.1. **Door one:** grant the Neon branch, and `CI-04`'s condition discharges as `ADR-073` wrote it. **Door two:** accept `ADR-085`'s re-ruling onto the capability the tree already has, at the cost stated there. **Either way a workflow must select the `integration` project**, which no workflow does today, so neither door closes the row on its own |
| **3** | **`GS-138`, and P3's third done-clause** | Section 4.2. All fourteen M2 fixture rows are `blocked / vendor-call`, and `GS-138` is the one [M02](M02-rithmic-bridge.md) `INV-M2-13` cites. DELIVERY_PLAN's *"fail-closed provisioning holding an unconfirmed setpoint out of trading"* is that invariant verbatim. **Whether [ADR-076 section 1](../decisions/ADR-076.md)'s governing rule discharges the row against the SIMULATOR is a ruling and this plan does not take it.** The saga itself needs no ruling and is buildable today |
| **4** | **DELIVERY_PLAN section 4's P3 contents do not name the runtime** | Section 3. P1's contents, P2's and P3's each omit a database client, an HTTP surface and a job runner, and all six of P3's stated contents need all three. **Amend the phase's contents, or accept this plan's reading that the runtime is P3's wave 1.** Not a session's to rewrite ([session 136](../sessions/2026-08-22-session-136.md)'s precedent on the same document) |
| **5** | **The `E2` reads** on `145`, `147` and `148` | Money path. `148` carries a migration and must not merge before the read |

**`ADR-083`, `ADR-084`, `ADR-085`, `ADR-086` and `ADR-087` all arrive `proposed` with unsigned
approval lines, each naming one checkable clause and what it costs if wrong.** Three of them
also owe a **foreclosure** sentence, per section 5.

---

## 10. What this plan does not schedule, and why each absence is a decision

| Item | Disposition |
|---|---|
| **The six module slices themselves** | **Refused on the fence, not on the effort.** Section 6, wave 3. Every module session's fence is a path inside a deployable `ADR-083` has not named, and a fence by a path that does not exist is worse than no fence. **A second planning session dispatches them once `083`, `084` and `085` are signed**, and it inherits wave 3's ordering table rather than re-deriving it |
| **`PT-03`, ledger zero-sum in aggregate** | **P3's by `OQ-P2-04`, closed 2026-08-16, and it belongs to the ledger slice in wave 3.** It is named here so it is not lost between the plan that moved it out of P2 and the plan that will schedule it. Not reopened |
| **`CI-07`** | **P3 does not meet its condition, measured rather than assumed.** No package declares a `build` script and there is no bundler. Sessions 144 to 148 add one deployable, one client, one queue package, one migration and four documents, **and none of them introduces a build**, on the pattern the four existing apps already use. **But it is ONE RULING AWAY**: `ADR-083` picking a bundler-needing framework makes `CI-06/gate-inventory` fail on good news, which section 6 fences against explicitly |
| **`CI-08`** | Waits on `@playwright/test` in the lockfile and on three surfaces that are render functions. P4 |
| **`CI-09`'s replay leg** | Waits on a database, therefore on `CI-04`. **`ADR-085` is the row that unblocks it as a side effect**, and that consequence is named here rather than claimed as this plan's |
| **The TradingCalendar transcription** | Blocked on egress rather than on engineering, and it blocks none of the five sessions. It is P1's last item and it is not P3's |
| **`OI-27` and the `0015` citation audit** | **Session 141's, already dispatched.** Named here only because it collides with 142 and 148 on `DELTA_MANIFEST.md` and nobody's dispatch says so |
| **`OI-28`** | **Session 142's, already dispatched**, and it holds `scripts/corpus/gates.mjs`, which is why 146 and 148 order after it |
| **`M02` leaving `review`** | Holds under [ADR-005](../decisions/ADR-005.md) pending the vendor call. **None of the five sessions waits on it**, and section 4.2 is why |
| **`ADR-023`'s vendor selection** | A procurement decision with a **disqualifying criterion already ruled**: [M03 section 7.9.1](M03-billing-checkout.md) makes portability history *"a condition of acceptance"* rather than a preference. Named so the wave-3 session does not reopen it |
| **Anything signed** | This document is `draft` and rules nothing |

---

## 11. Verification

Per session, each a command with an output rather than a claim.

- `node scripts/corpus/gates.mjs check` reports every gate passing and
  `node scripts/corpus/falsify.mjs` is green, on every branch, before the pull request opens.
- `pnpm run verify` green: typecheck, lint, format, every Vitest project.
- **On `144`:** OVERVIEW section 2's container list and section 3's table name the same set, and
  `grep -l '"build"' apps/*/package.json packages/*/package.json` returns nothing.
- **On `145`:** `merit/no-raw-db-client` reports zero findings with `packages/db/**` the only
  exemption, and `packages/db/test/scoped-db.test.ts` asserts rather than existing.
- **On `146`:** `CI-06/gate-inventory` reports `CI-04` with a readable leg, its register holds no
  entry naming a dead condition, and every `VG` row chained on `CI-04` carries a disposition
  `ADR-080` admits.
- **On `147`:** the transactional enqueue is asserted against a real transaction, and the
  interface's foreclosure list is in the entry.
- **On `148`:** the probe watched refusing each of `DELTA_MANIFEST`'s three unsound publish
  states by name at `0047` and permitting them at `0046`, and permitting a sound publish at both,
  with all migrations applied forward-only into an empty PostgreSQL 16.
