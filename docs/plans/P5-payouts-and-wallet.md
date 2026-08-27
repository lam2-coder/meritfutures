---
status: draft
depends_on:
  [
    ../DELIVERY_PLAN.md,
    M05-payout-system.md,
    M20-wallet.md,
    M06-admin-ops-console.md,
    M18-graduation-track.md,
    ../architecture/API_CONTRACT.md,
    ../architecture/EVENTS.md,
    ../architecture/STATE_MACHINES.md,
    ../ops/runbooks/CRON_INVENTORY.md,
    ../ops/runbooks/RB-07-ledger-imbalance.md,
    ../testing/STRATEGY.md,
    ../decisions/ADR-016.md,
    ../decisions/ADR-019.md,
    ../decisions/ADR-040.md,
    ../decisions/ADR-075.md,
    ../decisions/ADR-100.md,
    ../decisions/ADR-112.md,
    ../decisions/ADR-124.md,
    P3-ledger-billing-identity.md,
    P4-portal-and-site.md,
  ]
last_updated: 2026-08-27
---

# P5 build: the phase whose every content is a WRITE, against an accessor that can name a row and cannot hold one

**[P3](P3-ledger-billing-identity.md) measured [DELIVERY_PLAN section 4](../DELIVERY_PLAN.md)'s stated
contents against the tree and found none of six existing, on one shared precondition named in no phase's
contents. [P4](P4-portal-and-site.md) ran the identical method and found three artifacts a gate already
probed. This document runs it on `P5`.**

**Measured at `cce89de` on 2026-08-27**, with `pnpm install` run first because `pnpm run verify` cannot
typecheck without it. Every figure below was re-derived by running the command named beside it.

**This document carries ONE ruling of its own**, [ADR-124](../decisions/ADR-124.md), and section 4 is why.
Everything else is cited to the entry or the file that took it, and every ruling this plan needs and may
not take is named for the founder in section 10.

**The dispatch brief's own central premise did not survive the measurement**, and section 5.1 is where
that is recorded rather than quietly worked around.

---

## 1. The tree, measured

| Measurement | Command | Result |
|---|---|---|
| Gates | `node scripts/corpus/gates.mjs check` | **32 of 32 pass** |
| `pnpm run verify` | run end to end after `pnpm install` | **exit 0**, 150 test files, **2,656 passed, 1 skipped** |
| Migrations | `ls packages/db/migrations/*.sql \| wc -l` | **47.** The next free number is `0048` and [session 240](../sessions/README.md) holds it |
| Tables created | `grep -h '^CREATE TABLE' packages/db/migrations/*.sql \| sort -u \| wc -l` | **111** |
| **Tables transcribed** | unique `pgTable('...')` names in [`schema.ts`](../../packages/db/src/schema.ts) | **91.** P4 measured 7 of 111; twenty remain |
| **Route modules** | `ls apps/api/src/routes/` | **8**: `auth`, `checkout`, `health`, `kyc`, `me`, `public-methods`, `webhooks-kyc`, `webhooks-psp` |
| **What the accessor can do** | read [`scoped-db.ts`](../../packages/db/src/scoped-db.ts) whole | `rows`, **`rowsWhere`**, `rowAt`, `insert`, `updateAt`, `deleteAt`, `sqlExecutor` |
| **What a filter may say** | [`scoped-db.ts:504`](../../packages/db/src/scoped-db.ts) | equality, ANDed. **No `OR`, no `IN`, no range, no `IS NULL`**, each absence deliberate |
| **What raw SQL may be run for** | [`scoped-db.ts:1007`](../../packages/db/src/scoped-db.ts) | **ONE reason**, `'job-enqueue'` |
| **Packages admitted to the database** | [`repo-invariants.mjs:937`](../../packages/tooling/checks/repo-invariants.mjs) | **ONE**, `@merit/api` ([ADR-117](../decisions/ADR-117.md) `RI-08`) |
| **Wallet rows in the contract** | `grep -c wallet docs/architecture/API_CONTRACT.md` | **4 hits and ZERO endpoints.** Section 3.3 |
| **Wallet rows in the event catalogue** | a `grep` for rows whose first cell opens `` `wallet. `` | **2**, both about the halt |
| **P5's golden scenarios** | [39-fixture-status-and-blockers](../testing/golden-scenarios/39-fixture-status-and-blockers.md) | `GS-106` to `GS-111` and `GS-222` to `GS-231`: **16 rows, 16 `blocked / no-fixture-format`** |
| Fixtures overall | `CI-06/fixture-inventory` note | 316 rows, 43 on disk, 43 written, 0 writable, **264 blocked**, 9 covered-elsewhere |

---

## 2. P5's five stated contents, against the tree

[DELIVERY_PLAN section 4](../DELIVERY_PLAN.md) gives `P5`, at weeks 9 to 10, *"M20 wallet and the two-leg
payout, the external rail in sandbox, the freeze path with its expiry sweep, the admin liability dashboard
including wallet balances, the event feed"*, with the done-condition *"Two-leg atomicity green, wallet
concurrency green, a freeze reaching expiry releases, reserve coverage computed with float excluded"*.

| Stated content | State | What exists, and where |
|---|---|---|
| **M20 wallet and the two-leg payout** | **SCHEMA COMPLETE, LEDGER LIBRARY COMPLETE, NO ROUTE AND NO CALLER** | All four `SD-M20-nn` tables and both `SD-M5-06`/`SD-M5-07` deltas are landed. [`packages/ledger`](../../packages/ledger/src/index.ts) posts double entry through the accessor, refuses an imbalance, refuses a live halt and knows all seven account codes including `trader_wallet`. **`grep -rn 'trader_wallet' apps/` returns nothing**: no code has ever posted `LT-01`, `LT-06`, `LT-07` or `LT-08` |
| **The external rail in sandbox** | **NOTHING, AND NOT EVEN A PORT** | [`packages/psp`](../../packages/psp/src/port.ts) is the CARD rail and has an adapter interface plus two fakes. There is no equivalent for the payout rail: `PspId` is closed at `'psp_a' \| 'psp_b'` by a CHECK on `purchases.psp`, so it cannot be borrowed. `payout_transfers` is landed and no code writes one |
| **The freeze path with its expiry sweep** | **THREE CLOCKS, ONE JOB, ZERO CODE** | [CRON_INVENTORY](../ops/runbooks/CRON_INVENTORY.md) rows the hourly sweep with its S1 dead-man switch and names its three columns; `CI-06l` passes because each column points at that row. **`grep -rln 'freeze_expires_at\|hold_expires_at' --include='*.ts'` returns exactly one file and it is [`schema.ts`](../../packages/db/src/schema.ts)**. The sweep exists as a row in a runbook |
| **The admin liability dashboard including wallet balances** | **THE ONLY CONTENT WITH A BUILT HALF, AND IT IS THE ARITHMETIC** | [`apps/admin`](../../apps/admin/src/index.ts) is 1,697 lines over 8 files. [`liability.ts`](../../apps/admin/src/liability.ts) computes `AS-M6-04`'s three numbers together or throws, and renames `open_liability_cents` on arrival so `INV-M6-11` cannot be broken by a field name. **What is missing is a row to read**: nothing writes `liability_snapshots`, and `OI-01` records that the table exists in two shapes |
| **The event feed** | **NOTHING, AND THE TABLE IS NOT EVEN TRANSCRIBED** | `events` is one of the twenty `CREATE TABLE` names with no `pgTable`. `grep -rn 'event_name' --include='*.ts' packages/ apps/` finds no producer. **The feed is [M06](M06-admin-ops-console.md)'s fifth surface and its source table is unreachable from any deployable** |

**Four of the five contents are WRITES and the fifth reads a table nothing writes.** That is the exact
inverse of [P4 section 2.1](P4-portal-and-site.md)'s finding, and it is why P4 could be built against a
read-only accessor and P5 cannot be built against this one. Section 3.

### 2.1 Two P5 contents [DELIVERY_PLAN section 4](../DELIVERY_PLAN.md)'s cell does not list, and both are money path

| Content | Where it is P5's | State |
|---|---|---|
| **[M18](M18-graduation-track.md)'s terminal settlement** | [DELIVERY_PLAN section 5](../DELIVERY_PLAN.md), in the row that defers the review pool: *"the terminal settlement ships in P5 because it is a correctness requirement"* | `SD-M18-01`'s three columns are landed at [`0007:101`](../../packages/db/migrations/0007_accounts.sql). `DEP-M18-02` asks M5 for *"a terminal settlement that is not a payout ordinal and carries no cap"*, and **no document says what row it writes.** Section 10 item 3 |
| **`OI-06`'s destination registry** | `WF-M20-02` names 48 hour destination cooling as one of the external leg's four controls, and `wallet_withdrawals` carries a `cooling` STATUS with nothing to compute it from | **OPEN, deliberately not decided.** [DELTA_MANIFEST](../../packages/db/DELTA_MANIFEST.md): *"`destination_ref` ... is the destination OF A TRANSFER; no table records that a destination changed or when"*. It is a migration and it is `P5-e` |

**Neither is optional and neither is in the phase cell.** The destination registry is the sharper of the
two: `G-DESTINATION-COOLING` is drawn in [STATE_MACHINES section 3.2](../architecture/STATE_MACHINES.md),
the enum value it moves to is in `0001`, the partial index scanning for it is in `0011`, and **the gate's
input has never existed**. That is `INV-M20-12`'s shape exactly, half a mechanism read as done.

---

## 3. The precondition, which is the finding

**P5's shared precondition is not a runtime and not an artifact. It is four sentences in one file, each of
which [ADR-112](../decisions/ADR-112.md) wrote deliberately and each of which P5 is the first caller to
need.** [`scoped-db.ts:504`](../../packages/db/src/scoped-db.ts) states the rule in its own words:

> *"There is no `OR`, no `IN`, no range and no `IS NULL`, and each absence is the same decision: a shape a
> caller can compose freely is a shape a caller can compose wrongly, and every one of them is a diff on
> this file with an argument attached when a caller needs it."*

**This plan is that argument arriving.** P5 is the first phase whose work is jobs and money, and a job is
a range query over a clock.

### 3.1 The four absences, each with the P5 caller that meets it

| Absence | Site | The P5 caller | What happens without it |
|---|---|---|---|
| **A range term** | [`scoped-db.ts:504`](../../packages/db/src/scoped-db.ts) | **`P5-j`**, the hourly expiry sweep. Its whole query is `freeze_expires_at <= now()`, over three columns on two tables | The sweep reads EVERY `payout_requests` and EVERY `wallet_withdrawals` row every hour and filters in memory. `INV-M5-18`'s nightly assertion does it a second time |
| **A null term** | same | **`P5-k`**, the assertions, and **`packages/ledger` today**. `readLiveHalts` cannot say `released_at IS NULL` | [`halts.ts`](../../packages/ledger/src/halts.ts) already pays this and says so: *"released ones are not bounded at all and accumulate forever, which is the direction this read gets slower"*, **on every posting** |
| **A row lock** | nothing declares one; `SqlExecutorReason` is one member at [`scoped-db.ts:1007`](../../packages/db/src/scoped-db.ts) | **`P5-g`, `P5-h`, `P5-i`.** `INV-M20-01` is *"every debit is checked against the live position inside the same transaction ... plus a per-identity advisory lock"*, and `INV-M5-07` names a per-account one shared with the batch | **`GS-230` cannot be written.** *"Exactly one succeeds where the balance covers only one"* is a claim about two concurrent transactions, and nothing in this accessor lets a caller serialize them |
| **An aggregate** | same | the wallet position | **This one is a SHOULD and the plan says so.** A position is the sum of one identity's `wallet_entries`, which `rowsWhere` returns and a caller can sum. It is bounded per identity and it is not the blocker the other three are |

**The third is the one that decides whether P5 has a done-condition.** *"Wallet concurrency green"* is one
of `DELIVERY_PLAN`'s four clauses, `GS-230` is its scenario, and the assertion is that two transactions
race and one loses. **There is no primitive in this tree that makes one lose.**

### 3.2 Why this is P5's `ADR-100` seam, and what it buys

[ADR-100](../decisions/ADR-100.md) turned the route registry into a directory listing and thirteen route
slices stopped being serial. The equivalent question here is: **what single file, changed once, makes the
rest of P5 disjoint?**

**It is [`scoped-db.ts`](../../packages/db/src/scoped-db.ts) and nothing else.** Measured rather than
asserted:

- Every P5 table is **already registered** in [`schema.ts`](../../packages/db/src/schema.ts) and
  [`scope.ts`](../../packages/db/src/scope.ts) with a stated rule, except three (section 8's `P5-b`). So
  P4's largest collision, the transcription, **is not P5's**.
- Every P5 route is **a new file under [`apps/api/src/routes/`](../../apps/api/src/routes/health.ts)**,
  which under [ADR-100](../decisions/ADR-100.md) is a disjoint path per slice with no shared array.
- Every P5 job is **a new file under `apps/worker/src/`**, sharing only
  [`ports.ts`](../../apps/worker/src/batch/ports.ts).

**So after `P5-a` the phase is four concurrent route slices, three concurrent worker slices and a dashboard
slice, and before it every one of them is blocked on the same four sentences.** That is the whole shape of
section 8, and it is why this plan has one serial head and no serial chain.

### 3.3 The contract and the catalogue are the second and third preconditions, and both are ADRs

**Neither is a code file and both are `approved`, so a slice cannot edit either with a commit.**
[P4's `P4-f`](P4-portal-and-site.md) set the precedent that held: `GET /public/methods/:statCode` entered
[API_CONTRACT](../architecture/API_CONTRACT.md) through an ADR and is now section 293's row.

| Precondition | Measured | Size |
|---|---|---|
| **The contract has no wallet surface at all** | `grep -n wallet docs/architecture/API_CONTRACT.md` returns **four hits and none is an endpoint**: an error-code paragraph, a phone-change note, a `payout_requests` union note and a `C-27` row | **EIGHT rows.** `GET /wallet`, `GET /wallet/entries`, `POST /wallet/withdrawals`, `POST /admin/wallet/:identityId/correct`, `POST /admin/wallet/:identityId/spend-limit`, `GET /admin/wallet/reconciliation`, and [ADR-040](../decisions/ADR-040.md)'s `POST /admin/payouts/:id/release` and `/enforce` |
| **The catalogue has two wallet rows and P5 emits eighteen** | [EVENTS](../architecture/EVENTS.md) section 6 carries `wallet.withdrawal_halted` and `wallet.withdrawal_halt_released` and nothing else in the family | `wallet.credited`, `wallet.debited`, the six `wallet.withdrawal_*` lifecycle names [STATE_MACHINES section 3.2](../architecture/STATE_MACHINES.md) draws, [M20](M20-wallet.md) section 5's six, plus `payout.balance_reflection_missing`, `payout.freeze_expiring` and `treasury.coverage_changed` |

**`wallet.credited` is the row whose absence costs most.** [M05](M05-payout-system.md) section 5 calls it
*"the event the trader experiences as being paid ... the one M04 and M16 celebrate rather than
`payout.settled`"*, and it is in no catalogue.

---

## 4. THE CONTRADICTION, and it is ruled in [ADR-124](../decisions/ADR-124.md)

**[EVENTS:263](../architecture/EVENTS.md) says `ledger.invariant_violated` is the one event whose consumer
*"is allowed to change system behavior automatically"* and that what it does is halt payouts. Its payload
carries `scope: "transaction" | "global"`. At `global` there is no row it could write, no code that would
refuse, and [`0016:55`](../../packages/db/migrations/0016_treasury_controls.sql) rules that there never
will be: `ledger_halts.identity_id` is `uuid NOT NULL` because *"a halt with no subject is the global halt
and the global halt is not a row, it is an incident."***

**[`halts.ts:109`](../../packages/ledger/src/halts.ts) says the same thing from the enforcement side**, and
it is the only code in the estate that honours a halt at all: *"A FIRM-ONLY POSTING IS NEVER REFUSED BY
THIS, because a halt names a subject and a posting between two firm accounts names none."* `LT-02` and
`LT-07` are firm-only postings, and they are the two that move cash.

**And [RB-07:31](../ops/runbooks/RB-07-ledger-imbalance.md) branch B step 1 tells an operator to
*"Confirm it"*,** which is an instruction to verify an automatic act. **Nothing performs it.**

**Four documents each state one half correctly and none of them is wrong.** [ADR-016](../decisions/ADR-016.md)
kept the global branch on purpose; `0016` partitioned the table on purpose; `halts.ts` refused to widen its
own check on purpose; RB-07 wrote the step the mechanism implies. **What nobody asked is which branch the
partition left without a home**, and P5 is the phase that builds both the producer and the consumer.

[ADR-124](../decisions/ADR-124.md) rules four clauses and refuses to design the storage: the global halt is
**automatic**, it is **not a `ledger_halts` row**, its subject is the **firm** so the refusal is a second
check rather than a widening of the first, and **it refuses the internal leg too**, which is the clause
that only became load bearing when [ADR-019](../decisions/ADR-019.md) made the internal leg a ledger
posting. The storage, its clock and its authority are `P5-k`'s and are section 10 item 1.

---

## 5. Four claims checked against their sources, and two did not survive

### 5.1 THE DISPATCH'S OWN CENTRAL PREMISE, which was closed six days before this session opened

**The brief states it as a live, unfixed hole**, and reserves this session's ADR number against it:

> *"[M20:62]'s `INV-M20-06` blocks on `identities.status = 'restricted'` while the payout gate after
> `ADR-062` reads `= 'active'`, so a `closed` identity cannot request a payout but can still spend its
> wallet. This was reported by session 95 and named as an open question, never fixed."*

**[M20:62](M20-wallet.md) reads `identities.status = 'active'`.** It has since 2026-08-21, and the cell
carries its own correction note: *"this read `= 'restricted'` until 2026-08-21 and a `closed` identity
therefore passed it"*. [STATE_MACHINES:421](../architecture/STATE_MACHINES.md)'s `G-WITHDRAWAL-CLEARED`
moved in the same change and carries the same note.

**[ADR-075](../decisions/ADR-075.md) is the ruling, it is `status: accepted`, and its founder approval was
GRANTED in session 95, which is the session the brief cites as having reported the problem.** Its decision
line: *"`G-WITHDRAWAL-CLEARED` and `INV-M20-06` are amended to read `identities.status = 'active'`,
matching `G-ELIGIBLE`. `OQ-062-01` and its `OQ-M20-07` restatement are CLOSED."*

**Two things are genuinely left, and neither is the one the brief names.**

1. **[M20](M20-wallet.md)'s own `OQ-M20-07` body is STALE and still describes the closed contradiction as
   live.** At [M20:529](M20-wallet.md) the question is still asked in the present tense, at
   [M20:531](M20-wallet.md) the prose still says *"INV-M20-06 at line 62 of this document enumerates the
   wallet-spend and external-withdrawal set with `identities.status = 'restricted'`"*, and **two cells of
   its own five-row door inventory at [M20:533](M20-wallet.md) still carry the pre-`ADR-075` shape**.
   `ADR-075` amended line 62 and did not amend the section that quotes it. **This plan does not repair it:
   [M20](M20-wallet.md) is approved and a plan is not an amendment.** Section 10 item 4.
2. **`OQ-075-01` is open and it is a policy question, not a hole.** The two COMMERCE doors, [M03](M03-billing-checkout.md)
   `INV-M3-15` and [M08](M08-affiliate-system.md) `INV-M8-12`, keep `restricted`, and `ADR-075` section 3
   refuses to move them on a stated argument: an affiliate statement is money already earned, and moving
   `INV-M8-12` to `= 'active'` would withhold it from a closed identity permanently, *"which is that clause
   arriving through a consistency sweep rather than through a decision"*. **Neither is a hole today because
   neither moves value out**, which is what let the extraction half be ruled without them.

**The dispatch was right that planning `P5` meets a contradiction and wrong about which one.** Section 4 is
the one it meets, and [ADR-124](../decisions/ADR-124.md) section 1 records that the reservation's condition
was met by a different finding, which is what a CONDITIONAL reservation is for.

### 5.2 One transition, two event names, in two approved documents

[STATE_MACHINES:226](../architecture/STATE_MACHINES.md)'s wallet-withdrawal transition table names
`wallet.withdrawal_halt_cleared` on the halt-release edge. [EVENTS:237](../architecture/EVENTS.md)
registers the same edge's event as **`wallet.withdrawal_halt_released`**. `grep` over `docs/` outside
`sessions/` returns exactly those two sites.

**This is NOT a standoff and the drawing says so in its own text.** Three lines below the table:
*"Event names in the last three rows are proposed, not folded. [EVENTS](../architecture/EVENTS.md) is
session 6's file and no name is claimed by appearing here; the drawing needs a column and the registry is
what makes a name real."* **So `EVENTS` wins, the drawing carries a name nothing registers, and `P5-d` is
the slice that reconciles it**, in the same commit that folds the other sixteen. It is one cell.

### 5.3 *"Reserve coverage computed with float excluded"* is ambiguous, and the resolution is cited rather than chosen

**Excluded from WHICH side of the ratio.** The three sources do not read the same way at a glance:

| Source | What it says | Which side |
|---|---|---|
| [M05](M05-payout-system.md) `INV-M5-15` | *"Wallet balances are included in Open Liability **and in the reserve coverage ratio**"* | **unstated**, and it is the sentence that reads wrongly |
| [M06](M06-admin-ops-console.md) `P-M6-07` | *"The **denominator** now includes wallet balances"* | denominator |
| [M20](M20-wallet.md) `INV-M20-08`, `AS-M20-08` counter 1 | wallet balances *"are **never** counted toward reserve"*, and the RCR is *"computed from **reserve alone**"* | numerator |

**They agree and the resolution is `P-M6-07`'s: float enters the DENOMINATOR as exposure and never the
NUMERATOR as reserve.** `AS-M20-08`'s whole scenario is the misreading, *"the ratio flatters itself with
the same money on both sides"*, and the alarm row `Float counted toward reserve in any computed RCR | any |
page` is the assertion that catches it. **`INV-M5-15` is the sentence a slice will read first and it is the
one that does not say which side**, so it is written here rather than left to be discovered inside a
dashboard diff. **`P5-l` carries it in its prompt.**

### 5.4 The accessor gained a capability the brief did not name, and it changes what P5 can assume

The brief summarises [ADR-112](../decisions/ADR-112.md) as *"the accessor names ONE ROW: `rowAt`,
`updateAt`, `deleteAt`. `update` and `delete` are GONE from every handle."* **All of that is true and the
handles carry a fourth method the summary omits: `rowsWhere`**, at
[`scoped-db.ts:1053`](../../packages/db/src/scoped-db.ts), *"Rows matching a filter, ANDed with this
identity's scope. Many rows."*

**It matters because it makes [`chart.ts`](../../packages/ledger/src/chart.ts)'s header stale in the
direction that under-states the tree.** That file reasons at length from *"ADR-102's accessor offers
`rows(key)` and nothing else: there is no read that carries a caller's predicate"*, and calls the remedy
*"named and not built"*. **It is built.** `readChart`'s window argument is still correct design and its
stated reason is no longer the accessor's limit. **`P5-a` owns saying so**, because it is the slice that
touches the file the header is about, and a plan that told a slice to work around a limit that has been
lifted would be P4 section 5.4's error one phase over.

### 5.5 THE PREMISE SECTION 5.1 REFUTED IS NOW LIVE IN A DISPATCHED MONEY-PATH SESSION

**Measured on the merge with `origin/main` at `c947e39`, which landed while this plan was in review.**
[#330](https://github.com/lam2-coder/meritfutures/pull/330) reserved sessions **250 to 264** and `ADR-138`
to `ADR-152`, fifteen application-code sessions. **Three of them intersect this phase and one of them
carries the refuted premise verbatim.**

| Session | What it claims | What it does to this plan |
|---|---|---|
| **252**, `claude/routes-payouts`, `ADR-140` **REQUIRED** | `GET /payouts` and **`POST /accounts/:id/payout`** | **THIS IS `P5-f`.** The slice is claimed and this plan does not hold it. Section 8's row stands as the specification and its OWNER is session 252 |
| **256**, `claude/routes-admin-reads`, `ADR-144` REQUIRED | seven `/admin/*` reads including **`GET /admin/liability`** | **`P5-l`'s API half is claimed.** What is left of `P5-l` is the `apps/admin` rendering half and section 5.3's numerator-versus-denominator reading |
| **258**, `claude/routes-calendar-and-rise`, `ADR-146` | `GET /economic-calendar` and **`POST /webhooks/rise`** | **`P5-m`'s settlement webhook is claimed.** What is left of `P5-m` is the rail PORT and its sandbox adapter, which is the half `packages/psp` shows the shape of |

> **[ALLOCATION](../decisions/ALLOCATION.md)'s row `140` and [sessions/README](../sessions/README.md)'s row
> `252` both restate the contradiction section 5.1 refutes**, in these words: *"the payout gate reads
> `identities.status = 'active'` after `ADR-062` while `M20`'s `INV-M20-06` blocks on `= 'restricted'`, so
> a `closed` identity cannot request a payout but can still spend its wallet."*

**`M20:62` reads `= 'active'` and has since 2026-08-21.** [ADR-075](../decisions/ADR-075.md) is
`status: accepted`, moved that predicate and `G-WITHDRAWAL-CLEARED` together, and closes `OQ-062-01` and
its `OQ-M20-07` restatement. **So session 252 is dispatched MONEY PATH with a REQUIRED ADR against a
contradiction that does not exist**, and `ADR-140`'s stated reason for being required is that premise.

**This plan does not edit either row**, because neither is in its fence and both belong to a merged wave.
**What it does is name the two things session 252 will actually meet**, so the finding is in the document
that session's own dispatch points at rather than discovered at the file:

1. **[M20](M20-wallet.md)'s `OQ-M20-07` body is the stale text**, not `INV-M20-06`. A session that greps
   `M20` for `restricted` finds the open question and two door-inventory cells, reads them as current, and
   re-rules a closed question. **Section 10 item 4 is the repair and it is nobody's yet.**
2. **What `POST /accounts/:id/payout` is genuinely missing is not a predicate.** It is `P5-a`'s lock,
   `P5-c`'s contract rows for the surfaces beside it, and **[ADR-124](../decisions/ADR-124.md)'s answer to
   what the route reads under a global halt.** `ADR-140` is reserved REQUIRED for the wrong reason and
   there is a right one.

**The general lesson is section 5.1's, arriving twice in one day.** A finding recorded four times and owned
by nobody gets treated as handled; **a finding CLOSED once and restated in a reservation gets treated as
open.** Both fail the same way, and the only defence is the grep this session ran.

---

## 6. What P5 is NOT

| Not P5 | Whose | Why the boundary is here |
|---|---|---|
| **Minting a session and resolving a person** | `ADR-126`, session **238**, running now | [ADR-120](../decisions/ADR-120.md) found that `ADR-112` *"unblocked everything a session can DO and nothing that makes one"*. Every authenticated P5 route is behind it and no P5 slice may invent an authority |
| **The fixture format** | `ADR-125`, session **237**, running now | All 16 of P5's golden scenarios are `blocked / no-fixture-format`. **P5 cannot write one and must not invent one** |
| **`liability_snapshots`' two shapes** | `ADR-128`, session **240**, running now, on `OI-01` | `P5-l` reads that table and does not repair it |
| **The M12 statistics run** | [ADR-122](../decisions/ADR-122.md), landed | It writes `published_statistics` and shares no file with any P5 slice |
| **The rules engine** | P2, landed | `evaluatePayout`, `clampPayout` and `applySettlement` all exist in [`packages/rules-engine`](../../packages/rules-engine/src/index.ts). **P5 calls them and contains no gate**, which is `INV-M5-02` |
| **Checkout's card and `mixed` legs** | [M03](M03-billing-checkout.md) | `P5-i` adds the WALLET leg to [`checkout.ts`](../../apps/api/src/routes/checkout.ts) and touches neither other branch, except that [M20](M20-wallet.md) section 3.7 requires the refusal to sit BEFORE the branch |

---

## 7. The registries this plan CANNOT spend

**Same rule as [P4 section 7](P4-portal-and-site.md), and here it binds harder because a migration number
is in play.**

| Registry | State | Why this plan does not claim |
|---|---|---|
| **ADR numbers** | `124` to `137` are spent by this wave, **and `138` to `152` were spent by a FIFTEEN-session wave that merged as [#330](https://github.com/lam2-coder/meritfutures/pull/330) while this plan sat in review. The first free number is `153`**, and section 5.5 is what that wave does to this one | `CI-06w` reads [ALLOCATION](../decisions/ALLOCATION.md) as a multiset and thirteen sessions are running beside this one. **Six P5 slices need one** (`P5-a`, `P5-c`, `P5-d`, `P5-e`, `P5-k`, and `P5-i` conditionally), and they are claimed in ONE commit before any slice runs |
| **Migration numbers** | **`0048` is [session 240](../sessions/README.md)'s**, stated in [STATE](../STATE.md) as *"`0048` stays free"* on the commit before it was reserved | `P5-e` and `P5-k` each need one. **Neither may read the directory and take the next number it can see**, which is [session 120](../sessions/2026-08-21-session-120.md)'s move and produced `OI-27` |
| **`GS-nnn`** | **P5 claims none. All 16 already exist** and are blocked | This is P5's one registry advantage over P4 and it is worth stating: the scenarios were written when the modules were, so no P5 slice pre-claims a fixture number |
| **`OI-nn`** | `OI-30` is the maximum | `P5-e` CLOSES `OI-06 (payout destinations)` and opens none |

---

## 8. The wave

**Fences are by file, and every fence was checked against every other and against the thirteen sessions
running beside this one.** Section 9 is the per-file table and it is the one to read.

### Wave 1: the preconditions. Five sessions, and three of the five are concurrent

**None of these five is P5's subject and no stated content can be reached without four of them.**

| # | Slice | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **`P5-a`** | **The accessor learns a RANGE term, a NULL term and a ROW LOCK**, and each admission carries its own argument. Section 3.1. **`SqlExecutorReason` is NOT widened**, because a lock expressible through the handle is the whole point; widening the raw-SQL vocabulary instead would put every future predicate through the one door [ADR-102](../decisions/ADR-102.md) closed | `packages/db/src/scoped-db.ts`, `packages/db/src/index.ts`, `packages/db/test/scoped-db.test.ts`, `packages/ledger/src/halts.ts` and `packages/ledger/src/chart.ts` (**their stale headers only**, section 5.4), `docs/decisions/ADR-1NN.md` (new, **REQUIRED**), `ALLOCATION` (its row), `INDEX` (its row), `STATE` (append), `sessions/` | **YES.** It is the file `ADR-008`'s BOLA blast radius is bounded by, and a filter vocabulary is where "composed wrongly" lives | **nothing. IT GOES FIRST** |
| **`P5-b`** | **The three P5 tables nothing has registered**: `wallet_spend_limits` (`SD-M20-02`, `INV-M20-07`'s storage), `events` (the feed's own table), `payment_disputes` (`P-3`'s chargeback-window input). **All three are landed DDL and none is in [`schema.ts`](../../packages/db/src/schema.ts)** | `packages/db/src/schema.ts`, `packages/db/src/scope.ts`, `packages/db/test/scoped-db.test.ts`, `STATE` (append), `sessions/` | **YES**, on [ADR-092](../decisions/ADR-092.md)'s ground: a scope rule is where "forgot to scope" stops being available | **`P5-a`** via `packages/db/test/scoped-db.test.ts` ONLY. Under [ADR-092](../decisions/ADR-092.md) section 2 the owner is the TABLE and the queue is the type checker, so it is concurrent with every other transcription slice in the estate |
| **`P5-c`** | **The contract acquires eight rows.** Section 3.3. **[API_CONTRACT](../architecture/API_CONTRACT.md) is `approved`, so this is an ADR and not a commit**, on [P4's `P4-f`](P4-portal-and-site.md) precedent | `docs/decisions/ADR-1NN.md` (new, **REQUIRED**), `docs/architecture/API_CONTRACT.md`, `ALLOCATION` (its row), `INDEX` (its row), `STATE` (append), `sessions/` | money by content, **no code** | **nothing.** Concurrent with `P5-a` and `P5-b` |
| **`P5-d`** | **The event catalogue acquires the wallet and treasury families**, and [STATE_MACHINES:226](../architecture/STATE_MACHINES.md)'s unregistered name is reconciled to the registry's. Section 5.2. Both files are approved, so this is an ADR | `docs/decisions/ADR-1NN.md` (new, **REQUIRED**), `docs/architecture/EVENTS.md`, `docs/architecture/STATE_MACHINES.md` (**section 3.2's last transition row ONLY**), `ALLOCATION` (its row), `INDEX` (its row), `STATE` (append), `sessions/` | money by content, **no code** | **nothing.** Concurrent |
| **`P5-e`** | **`OI-06` closed: the destination registry.** `payout_destinations` keyed on `(identity_id, destination_ref)` with `first_seen_at` and `cooling_until`, read by both payout legs and by the affiliate rail under `C-24`. **The recommendation is DELTA_MANIFEST's own and this slice may refuse it with an argument** | `packages/db/migrations/00NN_payout_destinations.sql` (new), `packages/db/DELTA_MANIFEST.md` (its delta row and the `OI-06 (payout destinations)` row), `docs/architecture/data-model/payout_destinations.md` (new), `packages/db/src/schema.ts`, `packages/db/src/scope.ts`, `docs/decisions/ADR-1NN.md` (new, **REQUIRED**), `ALLOCATION` (its row and its migration row), `INDEX` (its row), `STATE` (append), `sessions/` | **YES. E2 READ.** A new money-path table | a **migration number**, allocated in the pre-dispatch commit and NOT `0048`; **`P5-b`** via `schema.ts` and `scope.ts` |

**Wave 1 is SERIAL only on `packages/db/`.** `P5-a`, `P5-b` and `P5-e` form one chain over
[`schema.ts`](../../packages/db/src/schema.ts), [`scope.ts`](../../packages/db/src/scope.ts) and
[`scoped-db.test.ts`](../../packages/db/test/scoped-db.test.ts); `P5-c` and `P5-d` share no file with them
or with each other and run alongside. **That is a two-lane wave and not a four-way lockfile serialization**,
which is the difference [P4 wave 1](P4-portal-and-site.md) paid for.

### Wave 2: the two legs. Four sessions, and all four are disjoint by file

**Every one is a new route module, which under [ADR-100](../decisions/ADR-100.md) is a disjoint path with
no shared array.** `P5-i` is the exception and it is named as one.

| # | Slice | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **`P5-f`** | **CLAIMED BY SESSION 252 (`ADR-140`) ON THE `c947e39` MERGE, section 5.5. The row stands as the SPECIFICATION and this plan does not hold the slice.** **The internal leg.** `POST /accounts/:accountId/payout`: `evaluatePayout`, `clampPayout`, the immutable snapshot, `G-HOLD-REQUIRED`, then `LT-01` and `applySettlement` **in one transaction**. `INV-M5-23`: the impersonation refusal is an authorization decision and never a gate result, so **no snapshot, no row, no `payout.blocked`** | `apps/api/src/routes/payouts.ts` (new), `apps/api/test/payouts.test.ts` (new), `STATE` (append), `sessions/` | **YES. E2 READ.** The single most audited path in the system | **`P5-a`**; **`P5-c`**, **`P5-d`**; **`ADR-126`** (session 238) for a resolved caller; **[ADR-124](../decisions/ADR-124.md)** for what it reads under a global halt |
| **`P5-g`** | **The wallet reads.** `GET /wallet` and `GET /wallet/entries`: balance, withdrawable-now versus held with the rule that holds it (`P-1`, `P-3`), and the itemized entry list with provenance and running balance, cursor paginated | `apps/api/src/routes/wallet.ts` (new), `apps/api/test/wallet.test.ts` (new), `STATE` (append), `sessions/` | **YES** by content. It renders a balance a trader acts on | **`P5-a`**, **`P5-c`**, **`ADR-126`** |
| **`P5-h`** | **The external leg.** `POST /wallet/withdrawals`: `G-WITHDRAWAL-CLEARED` including `identities.status = 'active'` ([ADR-075](../decisions/ADR-075.md)), `G-DESTINATION-COOLING` against `P5-e`'s registry, the name-match score, the 10,000c minimum, one in flight, FIFO composition into `source_provenance_summary`, then `LT-06`. **`C-27` already refuses it from a non-elevated session and this slice adds NO second refusal**, which [M05](M05-payout-system.md) section 3.6 argues once | `apps/api/src/routes/wallet-withdrawals.ts` (new), `apps/api/test/wallet-withdrawals.test.ts` (new), `STATE` (append), `sessions/` | **YES. E2 READ.** It is where cash leaves | **`P5-a`**, **`P5-c`**, **`P5-e`**, **`ADR-126`**, **[ADR-124](../decisions/ADR-124.md)** |
| **`P5-i`** | **The wallet leg of checkout.** `payment_method = wallet` posts `LT-08` in the purchase transaction: `INV-M20-02` own-accounts-only resolved server side in the debit transaction, `INV-M20-06`'s enumerated gate set, `INV-M20-07`'s velocity limit **delaying rather than refusing**, and `INV-M20-01`'s position check under `P5-a`'s lock. **[M20](M20-wallet.md) section 3.7: the refusal sits BEFORE the payment-method branch and is asserted against all three methods** | `apps/api/src/routes/checkout.ts`, `apps/api/test/checkout.test.ts`, `docs/decisions/ADR-1NN.md` (**only if `mixed` needs a ruling**), `STATE` (append), `sessions/` | **YES. E2 READ** | **`P5-a`**, **`P5-b`** for `wallet_spend_limits`, **`P5-c`**. **The only P5 slice that edits an existing route module** |

### Wave 3: the jobs, the assertions and the surfaces. Five sessions

| # | Slice | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **`P5-j`** | **The hourly expiry sweep. THREE CLOCKS, ONE JOB**, on [CRON_INVENTORY](../ops/runbooks/CRON_INVENTORY.md)'s own rule that a second sweep is a second thing to stall: `payout_requests.freeze_expires_at`, `payout_requests.hold_expires_at` and `wallet_withdrawals.freeze_expires_at`. **Expiry RELEASES and on a hold it PAYS** (`INV-M5-17`), and on a withdrawal it **resumes the rail and never re-pays** (`INV-M20-14`) | `apps/worker/src/sweeps/expiry.ts` (new), `apps/worker/src/sweeps/ports.ts` (new), `apps/worker/test/expiry.test.ts` (new), `apps/worker/src/index.ts`, `docs/ops/runbooks/CRON_INVENTORY.md` (**the sweep's row only**), `STATE` (append), `sessions/` | **YES.** Release posts `LT-01` | **`P5-a`** for the range and null terms; **`P5-d`** for the release events |
| **`P5-k`** | **The three nightly assertions, and the global halt's mechanism.** `INV-M5-18` on the QUERY rather than on the job; `INV-M20-10`'s per-identity wallet reconciliation; the global zero-sum assertion and **[ADR-124](../decisions/ADR-124.md)'s firm-scoped switch**, whose storage, clock and authority that entry section 3 deliberately refuses to design | `apps/worker/src/batch/assertions.ts` (new), `apps/worker/src/batch/ports.ts`, `apps/worker/test/assertions.test.ts` (new), `packages/ledger/src/halts.ts`, `packages/ledger/src/post.ts`, `packages/db/migrations/00NN_*.sql` (new), `packages/db/DELTA_MANIFEST.md`, a `data-model/` record, `packages/db/src/schema.ts`, `packages/db/src/scope.ts`, `docs/decisions/ADR-1NN.md` (new, **REQUIRED**), `docs/ops/runbooks/CRON_INVENTORY.md` (**its two rows only**), `ALLOCATION`, `INDEX`, `STATE` (append), `sessions/` | **YES. E2 READ.** It decides what stops a payout | **`P5-a`**; **[ADR-124](../decisions/ADR-124.md)**; a **migration number**; **`P5-a`** via `halts.ts` |
| **`P5-l`** | **ITS API HALF IS CLAIMED BY SESSION 256 (`ADR-144`), section 5.5; what remains is the rendering half.** **The liability dashboard gains a data source and the float panel.** `GET /admin/liability` serves `P-M6-01` through `P-M6-07` and [`apps/admin`](../../apps/admin/src/liability.ts)'s arithmetic reads a real row. **Float and reserve render as visibly separate figures and the RCR is computed from reserve alone**, section 5.3 | `apps/api/src/routes/admin-liability.ts` (new), `apps/api/test/admin-liability.test.ts` (new), `apps/admin/src/liability.ts`, `apps/admin/src/live-liability.ts`, `apps/admin/src/page.ts`, `apps/admin/test/**`, `STATE` (append), `sessions/` | **YES** by content, no ledger write | **`P5-b`**; **`P5-c`**; **session 240's `OI-01` repair**, and it must NOT repair `liability_snapshots` itself |
| **`P5-m`** | **ITS SETTLEMENT WEBHOOK IS CLAIMED BY SESSION 258 (`ADR-146`), section 5.5; what remains is the PORT and the fake.** **The payout rail's port and its sandbox adapter**, on [`packages/psp`](../../packages/psp/src/port.ts)'s shape and NOT its type: `PspId` is closed at two members by a CHECK on `purchases.psp` and cannot be borrowed. Enqueue with an idempotency key generated at approval, the settlement webhook with signature, timestamp, nonce and replay window, `LT-07`, and the `S-1` to `S-7` step list. **A hand-written fake needs no catalog entry, so this is NOT a `VG-12` admission**, and the slice states that rather than assuming it | `packages/rail/**` (new), `apps/api/src/routes/webhooks-rail.ts` (new), `apps/api/test/webhooks-rail.test.ts` (new), `docs/architecture/OVERVIEW.md` (**section 3's container row only**), `STATE` (append), `sessions/` | **YES. E2 READ** | **`P5-h`** for a withdrawal to settle; **`P5-d`** |
| **`P5-n`** | **The event feed, and the writer underneath it.** `events` gains a producer and [M06](M06-admin-ops-console.md)'s fifth surface renders it. **The producer is the harder half and it is this slice's subject**: every P5 route and job above emits, and `EVENTS`' universal rule admits no transition without an event | `apps/api/src/events.ts` (new), `apps/api/test/events.test.ts` (new), `apps/admin/src/feed.ts` (new), `apps/admin/test/feed.test.ts` (new), `STATE` (append), `sessions/` | no by file. It writes an append-only record of money movements | **`P5-b`** for the `events` table; **`P5-d`** for the names |

### Wave 4: NOT DISPATCHED, and each absence is a decision

**[M18](M18-graduation-track.md)'s terminal settlement, and P5's done-condition.**

- **The terminal settlement has no row.** `DEP-M18-02` asks M5 for *"a terminal settlement that is not a
  payout ordinal and carries no cap"*, `INV-M18-05` makes it required, `accounts.terminal_settlement_id`
  points at `payout_requests`, and `payout_requests_account_ordinal_uq` is partial on `status <> 'failed'`
  and would consume a rung. **Whether a terminal settlement is a `payout_requests` row at all is a ruling
  and it is section 10 item 3.** Fencing a slice against today's tree would be [WAVE-05](WAVE-05-tier2-fixture-shapes.md)'s
  defect: a fence over files a ruling has not yet made possible.
- **The done-condition cannot be evaluated by any slice above.** Section 10 item 2.

---

## 9. The collisions, BY FILE

**A depends-on column reads per item and collisions are per file.** Every file held by more than one slice,
or by a slice and a session already in flight.

| File | Held by | Why it collides, and the resolution |
|---|---|---|
| **[`packages/db/src/scoped-db.ts`](../../packages/db/src/scoped-db.ts)** | **`P5-a`**, and every phase after P5 | **THE HEAD OF THE PHASE AND THE ONLY FILE WITH NOTHING IN FRONT OF IT.** One slice holds it and no other P5 slice touches it. **The risk is not a merge conflict, it is that a wave-2 slice reaches around it** by adding a `SqlExecutorReason` member, which is why `P5-a`'s prompt forecloses that and every wave-2 prompt repeats the foreclosure |
| **[`packages/db/test/scoped-db.test.ts`](../../packages/db/test/scoped-db.test.ts)** | **`P5-a`, `P5-b`** | **SERIAL, and it is the same trap [P4 section 9](P4-portal-and-site.md) rows**: a branch that adds a table here without its rule typechecks, and the merge of two such branches typechecks too. `P5-a` first, because `P5-b`'s new rules are asserted by machinery `P5-a` may move |
| **[`packages/db/src/schema.ts`](../../packages/db/src/schema.ts)** and **[`scope.ts`](../../packages/db/src/scope.ts)** | **`P5-b`, `P5-e`, `P5-k`**, and every module measurement in the estate | **RULED, by [ADR-092](../decisions/ADR-092.md) section 2**: the owner is the TABLE, the registration is not re-argued, and the queue is the TYPE CHECKER. P5's three table sets are disjoint (`wallet_spend_limits`/`events`/`payment_disputes`, `payout_destinations`, `ADR-124`'s switch), **so the three are concurrent with each other and with any other session's disjoint set**. Order only by their other dependencies |
| **[`packages/ledger/src/halts.ts`](../../packages/ledger/src/halts.ts)** | **`P5-a`** (its stale header), **`P5-k`** (the global check) | **SERIAL, `P5-a` then `P5-k`**, and the collision is small and easy to miss: `P5-a` rewrites a paragraph that explains a cost, `P5-k` adds a function beside it. A keep-both merge produces a file whose header explains the old cost of the new code |
| **[`apps/api/src/routes/`](../../apps/api/src/routes/health.ts)** | **`P5-g`, `P5-h`** each add ONE new file; **`P5-i`** edits `checkout.ts`; and **sessions 251 to 258 add fifteen more**, section 5.5 | **NOT A COLLISION, and that is [ADR-100](../decisions/ADR-100.md)'s whole return.** The module list is the directory listing, so every one of those branches adds a disjoint path and they merge in any order. **`compose` refuses a duplicate `METHOD /path` across the whole module set**, so the one collision that many concurrent route slices actually make is caught at startup rather than merged. **With sessions 251 to 258 dispatched beside P5's, this row is now carrying more than twenty concurrent branches and it is the single largest return `ADR-100` has produced** |
| **[`apps/api/src/routes/checkout.ts`](../../apps/api/src/routes/checkout.ts)** | **`P5-i`**, and **[session 235](../sessions/2026-08-27-session-235.md)**, landed | The enrichment call site landed here on 2026-08-27. **No session in the current wave holds it**, so `P5-i` takes it cleanly, and its prompt says which two regions are already spoken for |
| **[`apps/worker/src/batch/ports.ts`](../../apps/worker/src/batch/ports.ts)** | **`P5-k`**, and cross-phase **[M13's `M13-e`](../sessions/2026-08-24-session-164.md)** and **[ADR-122](../decisions/ADR-122.md)'s statistics port** | Three slices add a port to one interface. **`P5-j` deliberately declares its own `sweeps/ports.ts` instead**, because a sweep is not a batch step and folding it in would give the hourly job the nightly job's dependency graph |
| **[`docs/architecture/API_CONTRACT.md`](../architecture/API_CONTRACT.md)** | **`P5-c`**, and cross-phase **[M05's `M5-9`](../sessions/2026-08-24-session-159.md)**, **[M16's three](../sessions/2026-08-24-session-165.md)**, **[M06's ADR-069 eighteen](../sessions/2026-08-24-session-160.md)** | **STILL THE HOTTEST CROSS-PHASE FILE IN THE CORPUS** and [P4 section 10](P4-portal-and-site.md) item 2 left it unresolved. **P5 does not resolve it either**; it holds the file for one slice and takes eight rows in one commit, which is the cheapest shape available to a phase |
| **[`docs/architecture/EVENTS.md`](../architecture/EVENTS.md)** and **[`STATE_MACHINES.md`](../architecture/STATE_MACHINES.md)** | **`P5-d`** | One slice, two files, and the second is held for **one transition row**. Stated as a fence rather than left implicit, because a session that widens onto the drawing will redraw the machine |
| **[`docs/ops/runbooks/CRON_INVENTORY.md`](../ops/runbooks/CRON_INVENTORY.md)** | **`P5-j`** (the sweep row), **`P5-k`** (the two assertion rows) | Two slices, three rows, one file. **Not textually overlapping and still serial**, on [P4](P4-portal-and-site.md)'s `STRATEGY` reasoning: `CI-06l` reads the release-job table as a whole and a keep-both merge produces a plausible table with one leg lost |
| **[`docs/decisions/ALLOCATION.md`](../decisions/ALLOCATION.md)** | **`P5-a`, `P5-c`, `P5-d`, `P5-e`, `P5-k`**, and `P5-i` conditionally | **Six of fourteen.** `CI-06w` reads the table as a multiset, so **one commit claims all six ADR numbers and both migration numbers before any slice runs**. An expected collision costs a resolution; a discovered one costs a cycle |
| **[`docs/INDEX.md`](../INDEX.md)** | the same six | One row each. `CI-06c` reads INDEX completeness in **both** directions |
| **[`docs/sessions/README.md`](../sessions/README.md)** | every slice, and every session in the tree | The `session_entries` span is generated under [ADR-088](../decisions/ADR-088.md) and merges by re-running `node scripts/corpus/gates.mjs generate`. **The CLAIM table above it is not generated** and every slice strikes one row |
| **The migration NUMBER** | **`P5-e`, `P5-k`**, and **[session 240](../sessions/README.md)** | **A collision no file list shows.** 240 holds `0048`. P5 needs two more and they are claimed in the pre-dispatch commit, which means P5's numbers are not contiguous with 47 and that is correct rather than a defect |

---

## 10. What could not be determined, named rather than guessed

**Five items. The first three go to the founder rather than to a session.**

1. **The global halt's storage, its clock and its authority.** [ADR-124](../decisions/ADR-124.md) rules the
   shape and refuses the mechanism, and section 3 of that entry names four decisions inside it. **The one
   to decide deliberately is the clock**: every other hold in this corpus expires and expiry RELEASES
   ([ADR-040](../decisions/ADR-040.md)), and here that reasoning inverts, because a global halt that
   releases itself resumes paying out of a book nobody explained. **`P5-k` cannot start without an answer.**

2. **Whether P5 may ship with a done-condition it cannot evaluate.** All four of `DELIVERY_PLAN`'s clauses
   land on scenarios that are blocked:

   | Clause | Scenario | Row |
   |---|---|---|
   | *"wallet concurrency green"* | `GS-230`, simultaneous withdrawal and checkout spend | `blocked / no-fixture-format` |
   | *"a freeze reaching expiry releases"* | `GS-109` | `blocked / no-fixture-format` |
   | *"reserve coverage computed with float excluded"* | `GS-229` | `blocked / no-fixture-format` |
   | *"two-leg atomicity green"* | **NO named scenario at all.** The nearest are [M20](M20-wallet.md)'s `M20-L-nn` ledger-integration suite and [M05](M05-payout-system.md)'s `M5-H-nn` hold-path suite, neither of which is a fixture | not rowed |

   **`ADR-125` (session 237) is the term's ruling and it is running now.** Three of the four clauses move
   with it and the fourth moves with nothing, because it names a property rather than a scenario.
   **Whether the fourth clause needs a scenario minted, or is satisfied by a suite, is not derivable from
   the tree.**

3. **What a terminal settlement is.** Section 2.1 and wave 4. `INV-M18-05` requires it, `DEP-M18-02`
   describes it as *"not a payout ordinal and carries no cap"*, and `payout_requests_account_ordinal_uq`
   is partial on `status <> 'failed'`, so writing one as a `payout_requests` row **consumes a rung**, which
   is `INV-M5-19`'s named failure one door over. Three readings are available and this plan takes none: it
   is a `payout_requests` row with a new status; it is a `wallet_entries` credit with a new provenance,
   which the closed `provenance` CHECK refuses; or it is a third shape. **It is a migration and a ruling.**

4. **Whether [M20](M20-wallet.md)'s stale `OQ-M20-07` is repaired, and by whom.** Section 5.1 item 1. The
   question is CLOSED by [ADR-075](../decisions/ADR-075.md) and the section that asks it still reads as
   live, with two stale cells in its own door inventory. **[M20](M20-wallet.md) is approved, so this is an
   ADR and not a commit**, and it is exactly the class `ADR-075` section 4 warns about: a finding recorded
   in a document nobody's fence holds. **No P5 slice needs it**, which is why it is here rather than in
   section 8, and that is also why it will keep not happening.

5. **Whether `GS-231`'s scoped halt survives [ADR-016](../decisions/ADR-016.md)'s conservative classifier.**
   `GS-231` pins *"the per-identity assertion fails and pages even though the global sum is zero"*, and
   [ADR-016](../decisions/ADR-016.md)'s founder-accepted condition 1 says an imbalance *"that cannot be
   traced to a transaction at all"* is treated as global. **A per-identity divergence over a globally
   balanced book is traceable to no transaction by construction.** [`0016`](../../packages/db/migrations/0016_treasury_controls.sql)
   appears to have settled it in the schema, since `wallet_balance_divergence` is a first-class
   `ledger_halts.reason_code` on a table whose subject is `NOT NULL`, **so the corpus already answers
   SCOPED.** This is recorded rather than ruled because the answer is inferred from a CHECK constraint's
   vocabulary rather than stated anywhere, and `P5-k` should not have to infer it. **It is small and it is
   a sentence somebody owes.**

---

## 11. The rules every prompt carries, written once here

These are [P4 section 11](P4-portal-and-site.md)'s, unchanged where they held and amended where P5's
measurement paid for an amendment.

1. **The session-log stub is the first commit.** Write `docs/sessions/<date>-session-<N>.md` with the
   objective and `placeholder` for every other field, strike your row in
   [sessions/README](../sessions/README.md), commit, push. **Then do the work.**
2. **Your log MUST carry an `<!--index: ... -->` line** under its `##` heading, and
   `node scripts/corpus/gates.mjs generate` is part of writing a log rather than an optional tidy-up
   ([ADR-088](../decisions/ADR-088.md)).
3. **`git fetch origin main` immediately before asserting anything about a registry.** Twelve of P4's
   fourteen measurements recorded the same defect and each recorded it as its own.
4. **Commit and push after each file.** Not at the end.
5. **The fence is absolute.** If the work needs a file outside it, **stop and report it in the pull-request
   body** rather than reaching.
6. **[STATE](../STATE.md): append one `##` section at the END.** Edit no existing line.
7. **Your ADR number and any migration number are allocated in ONE commit before you run**, and section 7
   is why this plan could not write them for you.
8. **Your ADR states what it FORECLOSES, not only what it chooses.** `P5-a` widens the predicate surface
   `ADR-008` bounds and `P5-e` mints a money-path table; both are decisions this project lives with.
9. **A new document gets its `INDEX.md` row in the same change.**
10. **THE ACCESSOR IS THE ONE DOOR AND `P5-a` IS THE ONLY SLICE THAT MAY MOVE IT.** No wave-2 or wave-3
    slice adds a `SqlExecutorReason` member, imports `pg`, or casts past a key type. **This is P5's own
    rule and it is here because P5 is the first phase where the temptation is a deadline rather than a
    preference**: every money route needs a predicate the accessor does not have, and the reach-around is
    one line. If `P5-a` did not give you what you need, **report it and stop**.
11. **Verify by running, never by reading.** `node scripts/corpus/gates.mjs check` and `pnpm run verify`
    leave green, and every completion claim in the pull-request body ships with its command and its output.
    **`pnpm install` first**, because `verify` cannot typecheck without `node_modules`.
12. **Report the count honestly.** *"I am at 3 of 5"* beats five thin files.
13. **Never weaken a gate to pass it and never widen a fence to finish.** They are the same move.
14. **Money is integer cents in every example you write.** `bigint` in the schema, `bigint` in the code
    ([`post.ts`](../../packages/ledger/src/post.ts)'s own rule), and `0027`'s NO-FLOATS block asserts the
    schema half only. **`P5` is the phase where money leaves the building.**

**Money-path sessions, which is all of them except `P5-n`: plan mode, fresh context, one objective,
[ADR-003](../decisions/ADR-003.md) strict.** `P5-e`, `P5-h`, `P5-i`, `P5-k` and `P5-m` additionally (and session 252 on `P5-f`'s behalf)
carry the [E2](../../MERIT_BUILD_MASTER_PROMPT.md) line-by-line read, **incrementally as each file lands**
rather than at the merge.

---

## 12. The dispatch order

**Nothing below may be dispatched until section 7's allocation commit exists and section 10 items 1 and 2
are answered.** Item 1 blocks `P5-k` alone; item 2 decides whether the phase can be called done.

```
Already in flight, and three of them order AHEAD of P5:
  237  ADR-125, the fixture-format term   ->  P5's whole done-condition
  238  ADR-126, the auth authority        ->  P5-g, P5-h, P5-i
  240  ADR-128, migration 0048            ->  P5-e and P5-k take LATER numbers

CLAIMED ELSEWHERE on the c947e39 merge, section 5.5. Not dispatched by this plan:
  252  ADR-140  POST /accounts/:id/payout ->  IS P5-f. The row above is its specification
  256  ADR-144  GET /admin/liability      ->  P5-l's API half
  258  ADR-146  POST /webhooks/rise       ->  P5-m's settlement webhook

Wave 1, two lanes, the lanes concurrent with each other:
  lane A   P5-a  the accessor  MONEY  ->  P5-b  three tables  MONEY  ->  P5-e  destinations  MONEY E2
  lane B   P5-c  the contract              ||   P5-d  the catalogue

Wave 2, after P5-a, P5-c, P5-d and 238. THREE CONCURRENT, and ADR-100 is why:
  P5-g  the wallet reads      MONEY
  P5-h  the external leg      MONEY E2   (also needs P5-e)
  P5-i  checkout's wallet leg MONEY E2   (also needs P5-b)

Wave 3, THREE CONCURRENT plus two behind wave 2:
  P5-j  the expiry sweep      MONEY      (needs P5-a, P5-d)
  P5-k  the assertions        MONEY E2   (needs P5-a, ADR-124, section 10 item 1)
  P5-l  the liability RENDER  MONEY      (needs P5-b, session 240, and 256's route)
  P5-m  the rail PORT + fake  MONEY E2   (needs P5-h; 258 holds the webhook)
  P5-n  the event feed                   (needs P5-b, P5-d)

Wave 4, NOT DISPATCHED:
  M18's terminal settlement              (section 10 item 3 first)
```

**`P5-a` is the one to run first and nothing blocks it.** It is money path, it takes one ruling, and **every
other slice in the phase is behind it**, which is the sentence this whole document exists to be able to
write.

**Fourteen slices, three of which are claimed elsewhere as of `c947e39` (section 5.5), and the honest count of what is buildable today is zero.** Four of the five stated
contents are writes against an accessor that cannot lock, the fifth reads a table with no producer, and the
done-condition's three named scenarios are blocked on a term another session is ruling this afternoon.
**That is not a reason to wait. It is the reason `P5-a`, `P5-c` and `P5-d` are three separate sessions that
can all start now.**
