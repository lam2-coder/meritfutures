---
status: draft
depends_on:
  [
    P3-ledger-billing-identity.md,
    P4-portal-and-site.md,
    ../DELIVERY_PLAN.md,
    ../architecture/API_CONTRACT.md,
    ../architecture/OVERVIEW.md,
    ../decisions/ADR-006.md,
    ../decisions/ADR-008.md,
    ../decisions/ADR-023.md,
    ../decisions/ADR-084.md,
    ../decisions/ADR-086.md,
    ../decisions/ADR-092.md,
    ../decisions/ADR-093.md,
    ../decisions/ADR-094.md,
    ../decisions/ADR-096.md,
    M03-billing-checkout.md,
    M08-affiliate-system.md,
    M19-kyc-identity.md,
    M02-rithmic-bridge.md,
  ]
last_updated: 2026-08-25
---

# P3 wave 3: the six modules are fenced, and none of them can open until four preconditions land that no phase's contents name

**[P3's build plan](P3-ledger-billing-identity.md) section 6 deliberately did not dispatch its wave 3, on the
ground that *"every module session's fence is a path inside a deployable `ADR-083` has not yet named"*. That
blocker has expired**: [ADR-083](../decisions/ADR-083.md) is signed, [`apps/api`](../../apps/api/src/index.ts)
exists with a manifest, an entry point and a surface partition, and **session 209 has since MERGED `P4-d` at
`4fd4a8a`**, so the route registry exists too. Section 5.4.

**This document is the second planning session P3 section 10 named.** It inherits wave 3's ordering table as
input rather than re-deriving it, and its output is what [P4 section 8](P4-portal-and-site.md)'s is: a slice
table with a fence of real paths, a money-path column and a dependency column, plus one prompt per slice.

**Measured at `3c44a5d` on 2026-08-25, then RE-DERIVED at `7f8215f` and again at `4fd4a8a`, because
[session 205](../sessions/2026-08-25-session-205.md) and then [session 209](../sessions/2026-08-25-session-209.md)
merged while this branch was open.** Every figure below was re-derived by running the command named beside it,
three times, and **the second and third runs each moved something**: section 1's registry count and `P3-l`'s
fence, then **the whole of section 6.2, which was written as a CONDITIONAL and is now a FACT**. All are corrected
here rather than left as of the first measurement. Sections 5.3 and 5.4 are what moved and why it matters. **Two of the dispatching brief's claims did not survive that**, and both are in section 5.

**This document carries no ruling of its own.** Every decision below is cited to the entry or the file that
took it, and every ruling it needs is scheduled as a slice or handed to the founder.

---

## 1. The tree, measured

| Measurement | Command | Result |
|---|---|---|
| Gates | `node scripts/corpus/gates.mjs check` | **30 of 30 pass** |
| Deployables | `ls apps` | **five**: `admin`, `api`, `portal`, `site`, `worker` |
| Registered tables | `grep -c "pgTable(" packages/db/src/schema.ts` | **87 of 111**, and it was **80** eight minutes earlier. Section 5.3 |
| The accessor's surface | [`scoped-db.ts:131-140`](../../packages/db/src/scoped-db.ts) | `__brand`, `identityId`, **`rows()`**. Nothing else |
| `packages/db`'s exports | [`index.ts:41-71`](../../packages/db/src/index.ts) | `scopedDb`, `systemDb`, `scopePredicate`, `SCOPE_RULES`, `TABLES`, `TABLE_KEYS`, `schema`, `closeClient`. **No write, no transaction** |
| The queue | [`packages/queue/src/job-queue.ts`](../../packages/queue/src/job-queue.ts) | Five methods, `enqueue`'s **first argument is the caller's open transaction** and there is no overload that omits it |
| Routes registered anywhere | `ls apps/api/src apps/api/src/routes` | `index.ts`, `surface.ts`, **`registry.ts`, `server.ts`, `start.ts`, and `routes/health.ts`**. [Session 209](../sessions/2026-08-25-session-209.md) landed all four at `4fd4a8a`. **One route exists and it is the liveness probe** |
| Session 209 | `git log 7f8215f..origin/main` | **MERGED at `4fd4a8a`**, carrying [ADR-100](../decisions/ADR-100.md), Fastify `5.12.1` into the catalog and the route registry. It had pushed nothing when this plan was first written. Section 5.4 |
| Lowest free ADR | [ALLOCATION](../decisions/ALLOCATION.md)'s table, read to its end | **`101`**. It was `100` when this plan was written and **session 209 took `100`**, which is section 8's reason arriving as an outcome rather than as an argument |
| Lowest free session | [sessions/README](../sessions/README.md)'s claim table | **`213`**. `209` to `212` are claimed and dispatched |

---

## 2. P3's stated contents are SEVEN and its own wave-3 table carries six of them

**[DELIVERY_PLAN section 4](../DELIVERY_PLAN.md)'s P3 cell has moved since [P3's plan](P3-ledger-billing-identity.md)
read it, and the plan's section 2 table is stale by one row.** The cell now reads *"Ledger, billing and
checkout, coupons and affiliate attribution, the provisioning saga against the simulator, M19 KYC with the
composite trigger set, **the authentication surface: sessions, the OTP challenge lifecycle, the two passkey
ceremonies and `C-27` elevation** ([ADR-039](../decisions/ADR-039.md), `SD-M4-04`,
[ADR-093](../decisions/ADR-093.md)), [ADR-023](../decisions/ADR-023.md) enrichment in observe mode"*.

**[ADR-093](../decisions/ADR-093.md)'s cell edits have been APPLIED to the tree**, which
[session 180](../sessions/2026-08-24-session-180.md) wrote out verbatim and deliberately did not make. The
done-condition moved with them and now carries a fifth clause: *"[API_CONTRACT section
12](../architecture/API_CONTRACT.md)'s `C-27` rows green in BOTH directions"*.

**So auth is P3's, it is in the phase's contents, it is in the phase's definition of done, and P3 section 6's
wave-3 ordering table does not have a row for it.** That is not a defect in the table; the table was written
on 2026-08-23 and the cell moved on 2026-08-24. It is the first thing this plan adds.

---

## 3. The precondition, which is the finding, and TWO module measurements found it independently

**The six gaps are not six gaps and they are not the runtime either. Every one of P3's seven contents is a
WRITE, and the accessor cannot write.**

| Fact | The file that says it |
|---|---|
| `ScopedDb` is `__brand`, `identityId` and `rows()` | [`scoped-db.ts:131-140`](../../packages/db/src/scoped-db.ts) |
| `SystemDb` is `__brand`, `reason` and `rows()` | [`scoped-db.ts:152-156`](../../packages/db/src/scoped-db.ts) |
| The package exports no writer and no transaction | [`index.ts:41-71`](../../packages/db/src/index.ts). `client()` is **not re-exported** and [ADR-084](../decisions/ADR-084.md) section 9 rules it unexported permanently |
| The ruling that registered 80 tables says so about itself | [ADR-092](../decisions/ADR-092.md) section 9: *"This entry rules NOTHING about the write accessor. `ScopedDb` is `__brand`, `identityId` and `rows()`. Registering a table makes it readable and nothing else"* |
| The drift ruling says it again | [ADR-094](../decisions/ADR-094.md) section 5: *"Nothing about the write accessor"* |
| The queue's required first argument cannot be constructed | [`job-queue.ts`](../../packages/queue/src/job-queue.ts) makes `enqueue` take a `JobTransaction`, *"deliberately small enough that `packages/db` can satisfy it without exporting its client"*. **`packages/db` does not satisfy it.** Nothing in the workspace produces one, so nothing can enqueue |

**TWO module measurements proposed this same slice, from inside two different fences, and neither could see
the other.** [Session 157](../sessions/2026-08-24-session-157.md)'s `M3-a` is *"`schema.ts` and `scope.ts`
learn M03's five commerce tables, **and the accessor learns to WRITE and to run a TRANSACTION**"*.
[Session 168](../sessions/2026-08-24-session-168.md)'s `M19-0` is *"six M19 tables transcribed ... **and
`ScopedDb` / `SystemDb` gain a write path**"*.

**This is exactly the shape [ADR-092](../decisions/ADR-092.md) was written for, one interface over.** Ten of
fourteen measurements proposed one slice on `schema.ts` and `scope.ts`; the ruling made the owner the TABLE,
the winner the first writer and the queue the type checker. **Nobody has ruled the WRITE accessor's
ownership**, and two measurements have already asked for it. Section 9's `P3-f` is that slice and it is a
**barrier**: one file, one interface, and every other slice in this document downstream of it.

### 3.1 A THIRD absence on the same file, which neither measurement named

**`SystemReason` is a closed vocabulary of two members and a request handler is neither of them.**
[`scoped-db.ts:143`](../../packages/db/src/scoped-db.ts) is
`export type SystemReason = 'nightly-batch' | 'operator-console';`. Measured against P3's own tables:

| Table | Class in [`scope.ts`](../../packages/db/src/scope.ts) | Who needs it, and with what identity |
|---|---|---|
| `psp_webhook_events` | **`firm`** | The webhook receiver, which is handed a PSP event and **does not know whose purchase it is until after it has persisted it** |
| `coupons` | **`firm`** | Checkout, which recomputes the discount server side and never trusts the request |
| `integration_contracts` | **`firm`** | The [ADR-023](../decisions/ADR-023.md) enrichment adapter |
| `otp_challenges` | **unregistered** | `POST /auth/otp`, whose required factor [API_CONTRACT](../architecture/API_CONTRACT.md) section 12 gives as `none` and whose class the same row calls **pre-identity** |

**A `firm` table is excluded from `ScopedTableKey` by construction**, so `scopedDb(...).rows('coupons')` is a
compile error; the only reader is `systemDb`, whose vocabulary admits the nightly batch and the operator
console. **Three of P3's seven contents therefore have no legitimate reader today, and one has no table.**

**[ADR-096](../decisions/ADR-096.md) is the precedent and it went the OTHER way**, which is why this is a
ruling rather than an obvious widening: it refused a third `SystemReason` member for `apps/site` and ruled
instead that the marketing site *"is not a reader of this database at all"*, reading over HTTP. **That
remedy is unavailable here**, because under that same ruling `apps/api` is the process the site reads
THROUGH. `P3-f` takes it.

---

## 4. The second precondition, and ADR-094 wrote its specification and did not number it

**`otp_challenges` cannot be registered, the two obvious remedies are foreclosed by a SIGNED entry, and the
remedy that is NOT foreclosed is a session [ADR-094](../decisions/ADR-094.md) itself specifies and prices.**

[`0029:526`](../../packages/db/migrations/0029_phone_identity_and_auth.sql) writes
`ALTER TABLE otp_challenges ALTER COLUMN email_normalized DROP NOT NULL`. ADR-094 closes the drift fold's
vocabulary at **one member with a default of FAIL**, so the table is refused; its consequence names the cost
in terms: *"`otp_challenges` and `trading_calendar` stay refused"*. Foreclosure 1 rules out a per-table
exemption list **permanently**; foreclosure 4 rules out widening the fold by adding a regex.

**Section 3 of that entry names what actually stands in the way and what it would take to move it:**

> *"Column TYPE and NULLABILITY are transcribed into `schema.ts` and asserted nowhere ... Closing it is a
> second comparison against `ddlColumnDefs`, it would turn the suite red on whatever it finds across seven
> already-merged money-path files, and **measuring that is its own session** ... Until it exists,
> `ALTER COLUMN` refusing a table is the only thing standing where that comparison should be, and deleting
> the refusal before writing the comparison would be trading a real control for nothing."*

**That session has never been numbered and it is on P3's critical path**, because `otp_challenges` is the
front door: `POST /auth/otp` is the only endpoint API_CONTRACT gives an identity with no session, and every
passkey ceremony in section 3 runs against an identity that already has one. **Section 9's `P3-g` is that
session, dispatched with ADR-094's own specification as its brief**, and the honest statement of its cost is
ADR-094's own: it turns the suite red on whatever it finds across already-merged money-path transcriptions,
and what it finds is not knowable before it runs.

**The count has moved since ADR-094 wrote "seven"**: `grep -c 'pgTable(' packages/db/src/schema.ts` returns
**87**, so the comparison lands on 87 transcriptions rather than 7. **That number is still moving**: it was 80
when this plan was first written and [session 205](../sessions/2026-08-25-session-205.md) merged seven while the
branch was open, with 206, 207 and 208 still open. That is a fact about the cost and it is recorded here rather
than left for the session to discover.

### 4.1 The third precondition: three tables that belong to two identities, and it is ONE ruling and not three

[`scope.ts:120-152`](../../packages/db/src/scope.ts) records three refusals in its own words, and all three
are the same shape:

| Table | Why it is out |
|---|---|
| `identity_links` | `identity_a` and `identity_b`, both `uuid NOT NULL`, against an `owned` rule that names ONE column. *"Either choice returns a strict subset of a person's own edges, selected by UUID ordering, which is a wrong answer that returns rows rather than an error"* |
| `attributions` | `buyer_identity_id` **and** `affiliate_identity_id`, both stored precisely because they are two different people. *"Naming the buyer hides the referral from the affiliate who earned it; naming the affiliate returns a buyer's own purchase attribution to somebody else"* |
| `affiliate_commissions` | Out **as a consequence**: its only path to an identity is `attribution_id`, and `DerivedRule.via` is `TableKey`, so a rule through an unregistered table cannot be written |

`dedupe_matches` is refused on the same ground by [session 194](../sessions/2026-08-25-session-194.md).
[ADR-092](../decisions/ADR-092.md) section 9 names the class as a **per-table ruling** and takes none, because
*"a transcription rules nothing"*.

**Three per-table rulings are one ruling, and saying so is worth a slice.** `attributions` is the table
[M08 section 3.1](M08-affiliate-system.md) resolves **inside the checkout transaction**, so P3's third and
fourth stated contents both stop at it. Section 9's `P3-h` takes the class once and applies it to all four
tables, which is [ADR-092](../decisions/ADR-092.md)'s own method applied to the residue ADR-092 left.

---

## 5. Two claims checked against their sources, and neither survived as written

### 5.1 The dispatching brief said `P4-d` "is writing the route registry right now". It had written nothing, and it has since merged

`git ls-remote --heads origin | grep -c 's209'` returns **0**, and
`list_pull_requests(state: open)` returns four pull requests, **none of them session 209's**. The four are
sessions 205, 206, 207 and 208, all transcriptions.

**This changes what this plan may fence on and it does not change the fences.** `apps/api/src/routes/index.ts`
is named by path in [P4 section 8](P4-portal-and-site.md)'s `P4-f` fence and again in section 9's collision
table as *"new in `P4-d`"*, and `P4-d` is CLAIMED and dispatched at
[sessions/README](../sessions/README.md)'s row 209. **A path a dispatched slice's own fence names is a path
`P4-d` is demonstrably about to create**, which is the standard P3 section 6 refused to fence below. The
route-bearing slices below therefore named it. **`P4-d` has since merged at `4fd4a8a` and section 5.4 records
what that changed**, so no slice below carries it in a depends-on any more.

**What it DOES change is section 8.** A planning session that claimed ADR numbers over an in-flight session
holding an unclaimed ALLOCATION row would recreate [session 120](../sessions/2026-08-21-session-120.md)'s
defect from the other side.

### 5.2 "All six of P3's stated contents are zero lines of application code" holds, and one of the six is now HALF-blocked rather than absent

Re-derived rather than inherited. `grep -rl 'ledger\|checkout\|webhook\|kyc\|passkey' --include=*.ts apps packages`
outside `packages/rules-engine` and outside the fence assertions returns **no implementation**, exactly as the
brief states. **But the saga's dependency has landed since P3 measured**: `packages/queue` exists, exports a
five-method interface and a pg-boss adapter, and [session 147](../sessions/2026-08-24-session-147.md) recorded
that it **cannot run yet**, because its `enqueue` needs a transaction nothing can produce. **The provisioning
saga is not blocked on a queue. It is blocked on section 3's accessor**, which is the same blocker as the
other six and not a seventh one.

### 5.3 A figure measured in this session moved WHILE THE BRANCH WAS OPEN, and it moved a slice

**[Session 205](../sessions/2026-08-25-session-205.md) merged at `7f8215f` between this plan's first commit and
its merge of `main`, registering M02's seven tables.** Every figure below was re-derived on the merged tree
rather than carried:

| Figure | At `3c44a5d` | At `7f8215f` |
|---|---|---|
| Registered tables | **80 of 111** | **87 of 111** |
| `provisioning_queue` in [`schema.ts`](../../packages/db/src/schema.ts) | **absent** | **present**, `derived` through `account_id` |
| `P3-g`'s comparison lands on | 80 transcriptions | **87**, and 206, 207 and 208 are still open |
| Sessions ahead of `P3-g` and `P3-h` | 205, 206, 207, 208 | **206, 207, 208** |

**`P3-l`'s fence lost three files because of it.** The slice was written holding `schema.ts`, `scope.ts` and
`scoped-db.test.ts` to register `provisioning_queue`; that registration is done, so **`P3-l` now holds no
`packages/db` file at all**, depends on `P3-f` alone, and is the least blocked slice in the wave.

**This is [ADR-092](../decisions/ADR-092.md)'s own stated cost arriving on the plan rather than on a session**:
*"A session cannot know its own slice size before it runs, because a sibling may register a shared table
first."* [P4 section 11](P4-portal-and-site.md) rule 3 records twelve of fourteen measurements hitting the same
thing and each recording it as its own. **It is recorded here as the ordinary consequence of a ruling working**,
not as a defect, and the correction direction is the good one: a slice got smaller.

**`P3-g`'s cost moved in the other direction and that is the half worth watching.** The comparison it writes
lands on every registered transcription, so **every merge between now and its dispatch makes it larger**, and
three transcription branches are open. Section 11 item 1 is why that goes to the founder.

### 5.4 The conditional this plan wrote was answered while the branch was open, and the answer beat the question

**[Session 209](../sessions/2026-08-25-session-209.md) merged at `4fd4a8a` carrying
[ADR-100](../decisions/ADR-100.md), Fastify `5.12.1` into the catalog and the route registry.** Section 6.2 was
written as a conditional with two dispatchable branches. **It resolves to the good branch by a mechanism this
plan did not propose**, and the difference is worth recording rather than quietly absorbing.

| | What section 6.2 asked for | What `ADR-100` landed |
|---|---|---|
| The device | A registry **total over a closed endpoint union**, with a per-endpoint disposition and a count assertion | **No registry file at all.** `discoverRouteModules` reads `apps/api/src/routes/` and imports every `.ts` file in sorted order |
| What a slice edits | Its own route file **plus one line of the shared registry** | **Its own route file. Nothing shared** |
| What catches a lossy merge | A count assertion over the disposition map | **Nothing needs to**, because there is no shared file to merge lossily |
| What catches two slices claiming one endpoint | Not addressed | `compose` **refuses a duplicate `METHOD /path`** across the whole module set, at startup |

**A total registry still has one shared file, and this removes it.** That is strictly stronger, and it is the
same refusal [`repo-invariants.mjs`](../../packages/tooling/checks/repo-invariants.mjs) makes when it seeds
itself from the migration directory rather than from a hand list.

**Two consequences for this plan, both applied above rather than noted.** The `apps/api/src/routes/index.ts`
row in section 6.3 is **struck**, and four slice fences lost the registry edit they carried. **A slice that
creates that file re-creates the collision `ADR-100` removed**, for every slice behind it, so the prompts say
so in terms.

**And the allocation refusal in section 8 is now an outcome rather than an argument.** This plan measured `100`
as the lowest free ADR and deliberately did not take it, because session 209 was dispatched holding
`ALLOCATION`'s row and had claimed nothing. **Session 209 took `100`.** The lowest free number is `101`.

---

## 6. DECISION ONE: how many can run concurrently, and on what axis they collide

**The answer has three parts, and the first is that ROUTES ARE NOT THE AXIS.**

### 6.1 The preconditions do not admit an axis. They are barriers and they serialize

`P3-f` is one interface in one file that every later slice imports. `P3-g` and `P3-h` are both on
[`packages/db/test/scoped-db.test.ts`](../../packages/db/test/scoped-db.test.ts), which
[ADR-092](../decisions/ADR-092.md) section 9 makes *"the pair's third file for fencing purposes"*, and `P3-g`
changes the rule `P3-h`'s registrations are then compared under. **So `P3-g` before `P3-h`**, on
[P4 section 8](P4-portal-and-site.md)'s `P4-a` before `P4-b` reasoning verbatim.

**`P3-f` is CONCURRENT with `P3-g` and `P3-h`, and that is a measurement rather than a preference.** Its fence
is `packages/db/src/scoped-db.ts`, `packages/db/src/index.ts` and a NEW test file; `P3-g` and `P3-h` hold
`schema.ts`, `scope.ts` and `scoped-db.test.ts`. **No file is in both.** The same measurement makes `P3-f`
concurrent with sessions **206, 207 and 208**, which hold the transcription trio and not `scoped-db.ts`, so
**`P3-f` has nothing ahead of it and may open today.**

### 6.2 After the barriers, the axis is the ROUTE FILE for routes and the PACKAGE for libraries, and neither has a shared file at all

**This section was written as a CONDITIONAL on 2026-08-25 and [session 209](../sessions/2026-08-25-session-209.md)
resolved it at `4fd4a8a` while this branch was open. It is a fact now, and the answer is stronger than the
property this plan asked for.** Section 5.4 records what the conditional said, so the ruling can be read against
the question it was asked.

**[ADR-092](../decisions/ADR-092.md)'s ruling has three parts and only the third is mechanical.** The owner is
a unit finer than the module; the first writer wins; **and the queue is the TYPE CHECKER**, because
`SCOPE_RULES` is total over `TableKey` by a `satisfies` clause, so a merge that keeps one side of a per-table
list does not compile. **All three transfer, and the third transfers by a mechanism this plan did not propose:
[ADR-100](../decisions/ADR-100.md) removes the shared file rather than making it total.**

| Part of ADR-092 | How it transfers to routes, as [`registry.ts`](../../apps/api/src/registry.ts) implements it |
|---|---|
| **The owner is a unit finer than the module** | The owner is the **ROUTE MODULE FILE**, one file under `apps/api/src/routes/`, and `defineRoutes` types its whole contribution at the definition site |
| **First writer wins** | `compose` refuses a duplicate `METHOD /path` **across the whole module set**, and a duplicate module name with it. **Two concurrent slices declaring the same endpoint is a startup failure rather than a silent second registration** |
| **The queue is the type checker** | **There is no queue, because there is no shared file.** `discoverRouteModules` reads the directory and imports every `.ts` file in it in sorted order, so *"the module list is the directory listing and is never written down"*. A slice that adds a route **adds ONE NEW FILE and edits nothing any other slice edits** |

**So `P3-j`, `P3-k`, `P3-n` and `P3-o` are FOUR BRANCHES on four disjoint paths, unconditionally**, and the
serialization this plan was written to price does not exist. The registry's own header states the count it was
protecting: thirteen branches, *"each merges cleanly alone and none of them together"*, which is
[P3 wave 1](P3-ledger-billing-identity.md)'s `pnpm-lock.yaml` lesson refused rather than repeated.

**What the directory listing gives away and buys back, because a plan that reports only the win is the one a
later session inherits wrongly.** An array is checked by `tsc` and a directory is not, so `defineRoutes`
validates the shape at run time as well as at the type level, and `discoverRouteModules` **THROWS** on any
`.ts` file under `routes/` that does not default-export a valid module or whose `name` is not its filename
stem. **A half-written route file fails the process at startup rather than quietly not existing**, which is the
failure mode an import list has and a directory cannot.

**[Session 168](../sessions/2026-08-24-session-168.md) stated the consequence from inside M19 and could not act
on it**: *"`M19-1` must create a registry that is per-module rather than one array, or these seven serialize."*
**It is answered**, and the answer reaches further than M19: every route slice in P3, P5 and M06's eighteen
admin endpoints inherits it.

**The library slices never needed the condition.** `P3-i` writes `packages/ledger`, `P3-l` writes
`apps/worker/src/**`, `P3-m` writes `packages/psp`, and `P3-n`'s attribution half writes
`packages/affiliate`. **Four packages, disjoint by construction**, concurrent with each other and with the
route slices, exactly as `packages/queue` was concurrent with everything when session 147 wrote it.

### 6.3 What serializes anyway, named BY FILE

| File | Held by | Resolution |
|---|---|---|
| [`pnpm-lock.yaml`](../../pnpm-lock.yaml) and [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) | `P3-j` (a WebAuthn library), `P3-m` (a PSP SDK, if the port needs one), and **cross-phase `P4-i`** | **SERIAL, and the serialization spans two phases.** [P3 wave 1](P3-ledger-billing-identity.md)'s lesson verbatim: a lockfile cannot be appended to per row. **`P4-d` is out of it: it MERGED at `4fd4a8a` and Fastify `5.12.1` is in the catalog**, so the two P3 slices order against `P4-i` and each other |
| [`docs/architecture/API_CONTRACT.md`](../architecture/API_CONTRACT.md) | `P3-n` (`POST /affiliate/creatives` is in [M08](M08-affiliate-system.md) section 4 and in no contract), `P3-o`, and **cross-phase `P4-f`, `P4-h` and six module measurements** | **[P4 section 9](P4-portal-and-site.md) calls it the hottest cross-phase file in the corpus and leaves it unresolved.** This plan does not resolve it either; section 11 item 2 carries it |
| `packages/db/src/schema.ts`, `scope.ts`, `test/scoped-db.test.ts` | `P3-g`, `P3-h`, and **sessions 206, 207 and 208, all with open pull requests. 205 MERGED at `7f8215f` while this branch was open** | **[ADR-092](../decisions/ADR-092.md) section 2 governs**: the owner is the TABLE and the first writer wins. Within this plan `P3-g` then `P3-h`; both behind 205 to 208 |
| [`docs/decisions/ALLOCATION.md`](../decisions/ALLOCATION.md), [`docs/INDEX.md`](../INDEX.md), [`docs/sessions/README.md`](../sessions/README.md) | every slice that mints a document | Append-only tables where the resolution is **ordering rather than merging**. Section 8 |
| ~~`apps/api/src/routes/index.ts`~~ | **nobody. THE FILE DOES NOT EXIST AND MUST NOT** | **Struck, and the strike is the finding.** [ADR-100](../decisions/ADR-100.md) made the module list a directory listing, so the contention this row was written for was designed away rather than ordered. **A slice that creates this file re-creates the collision for every slice behind it.** Section 6.2 |

---

## 7. DECISION TWO: where auth goes, and it is THIRD rather than first or last

**Auth cannot be first, it cannot be last, and both halves of that are checked at the source.**

**It cannot be LAST**, because three of P3's own stated contents ship endpoints the contract marks
`Auth: session`:

| Endpoint | Where the contract says it |
|---|---|
| `POST /checkout` | [API_CONTRACT:285](../architecture/API_CONTRACT.md): *"Auth: session. Idempotency: **required**"* |
| `POST /accounts/:accountId/reset` | `:296`: *"Auth: session, owner"* |
| `POST /kyc/session` | `:488`: *"Auth: session"* |
| `/affiliate/*` | Section 12 row 1: unauthenticated is **401** |

**[API_CONTRACT section 12](../architecture/API_CONTRACT.md)'s first sentence is the binding one**: *"Every
row is a named test that must exist **before the endpoint ships**"*, and `VG-5` is its subject with `CI-06k`
live in the runner reading the required-factor column. **P3's own definition of done now carries those rows
in both directions.** So checkout, reset and the KYC session endpoint are all downstream of auth, and P3
section 6's ordering table says none of it.

**It cannot be FIRST**, and this is the part nobody had. Section 3.1 and section 4: `otp_challenges` is
unregistered and refused by a signed entry, and the pre-identity writer has no reason in `SystemReason`'s
closed vocabulary. **Auth's front door is the one endpoint in the contract that runs before an identity
exists**, so it needs both preconditions and needs them before any of its seven headings can be written.

**Auth is therefore `P3-j`: after `P3-f`, after `P3-h`, and before `P3-n` and `P3-o`.** It is
money path, `E2`, `ADR-003` strict, and it is the slice whose blocking radius is largest: **three of the six
stated contents wait on it and two preconditions wait in front of it.**

---

## 8. The registries this plan spends, and the one it deliberately does not

| Registry | Spent here | Why |
|---|---|---|
| **Session numbers `213` to `223`** | **Claimed in this plan's own commit**, one per slice, in [sessions/README](../sessions/README.md) | Nothing in flight claims a session number, and a slice with no number is a slice nobody can dispatch |
| **ADR numbers** | **NONE**, and every slice below names its entry **by position** | Section 5.1. **Session 209 was dispatched holding `ALLOCATION` (its row) and had claimed nothing.** A planning session that took `100` would have handed it a collision it could not see from inside its own fence. **It then took `100`**, at `4fd4a8a`, so the refusal is an outcome rather than an argument. **Measured for whoever dispatches: the lowest free number is now `101`.** A session dispatched from this document **allocates first, in one commit, before it runs**, which is [P4 section 7](P4-portal-and-site.md)'s sentence and its reason |
| **Migration numbers** | **NONE.** The lowest free is `0048` | No slice below is dispatched with one. **`P3-n` is the one most likely to need one** ([session 157](../sessions/2026-08-24-session-157.md)'s `M3-e`, `purchases.plan_version_id` write-once), and a migration number spent speculatively on the money path is worse than a slice that stops and asks. **If a slice needs a migration it STOPS and reports it in the pull-request body** |

---

## 9. The wave: eleven slices, four waves

**Fences are by file and every fence was checked against every other and against the five sessions already in
flight.** Section 6.3 is the per-file collision table and it is the one to read.

### Wave 3.0: the preconditions. Three sessions, and `P3-f` is concurrent with the other two

**None of these three is P3's subject and no stated content can start without all three.**

| # | Slice | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **213** | **`P3-f` the accessor learns to WRITE, to run a TRANSACTION, and to say who is asking when nobody is.** Three clauses in one entry: the write path and how it scopes, the transaction primitive and the `JobTransaction` producer [`packages/queue`](../../packages/queue/src/job-queue.ts) has been waiting for, and what a request handler with no identity reads a `firm` table through | `packages/db/src/scoped-db.ts`, `packages/db/src/index.ts`, `packages/db/test/write-accessor.test.ts` (**new, and NOT `scoped-db.test.ts`, which is the whole reason this slice is concurrent**), `docs/decisions/ADR-1NN.md` (new), `ALLOCATION` (its row), `INDEX` (its row), `STATE` (append), `sessions/` | **YES, `E2`** | **nothing. It opens today** |
| **214** | **`P3-g` column TYPE and NULLABILITY are compared, and `ALTER COLUMN` stops being a proxy refusal.** [ADR-094](../decisions/ADR-094.md) section 3 is the specification and this session does not write a new one | `packages/db/test/scoped-db.test.ts`, `packages/db/src/schema.ts` (**only rows the comparison finds wrong**), `docs/decisions/ADR-1NN.md` (new, superseding ADR-094's `ALTER COLUMN` clause), `ALLOCATION` (its row), `INDEX` (its row), `STATE` (append), `sessions/` | **YES, `E2`** | **206, 207, 208** via `schema.ts` and `scoped-db.test.ts`. **205 has merged** |
| **215** | **`P3-h` the four tables the registry cannot hold.** `identity_links`, `attributions`, `dedupe_matches` under ONE two-identity ruling, and `otp_challenges` under `P3-g`'s widened fold. `affiliate_commissions` follows `attributions` with no ruling of its own | `packages/db/src/schema.ts`, `packages/db/src/scope.ts`, `packages/db/test/scoped-db.test.ts`, `docs/decisions/ADR-1NN.md` (new), `ALLOCATION` (its row), `INDEX` (its row), `STATE` (append), `sessions/` | **YES, `E2`** | **`P3-g`** via all three files; **206, 207 and 208** via the same |

### Wave 3.1: the two slices that need no session, no route and no vendor. CONCURRENT

| # | Slice | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **216** | **`P3-i` the ledger posting path, and `PT-03`.** Double-entry posting as a library both `apps/api` and `apps/worker` call. `ledger_halts` enters the registry with it, which closes one of [ADR-092](../decisions/ADR-092.md) section 9's four orphans | `packages/ledger/**` (new), `packages/ledger/package.json`, `packages/db/src/schema.ts` and `scope.ts` (**`ledger_halts` only**), `packages/db/test/scoped-db.test.ts` (its row only), `docs/architecture/OVERVIEW.md` (section 3's container table, its row only), `docs/decisions/ADR-1NN.md` (new), `ALLOCATION`, `INDEX`, `STATE` (append), `sessions/` | **YES, `E2`.** It is P3's first content and every other money content posts through it | **`P3-f`** via `scoped-db.ts`; **`P3-h`** via `schema.ts`, `scope.ts` and `scoped-db.test.ts` |
| **217** | **`P3-m` the `PspAdapter` port and two fakes. No routes, no network, no vendor.** [Session 157](../sessions/2026-08-24-session-157.md)'s `M3-h` verbatim. The contract already closes the provider set at `"psp_a" \| "psp_b"` ([API_CONTRACT:281](../architecture/API_CONTRACT.md)) | `packages/psp/**` (new), `packages/psp/package.json`, `pnpm-workspace.yaml` (`catalog:` only, **only if the port needs a dependency**), `pnpm-lock.yaml` (same condition), `docs/decisions/ADR-1NN.md` (new), `ALLOCATION`, `INDEX`, `STATE` (append), `sessions/` | **YES.** It is the money rail's interface | **nothing**, if it takes no dependency. **If it does, it joins `pnpm-lock.yaml`'s serialization with `P3-j` and `P4-i`; `P4-d` is out of it, having merged** |

### Wave 3.2: the surface. Four sessions, and section 6.2 decides whether they are four branches or one queue

| # | Slice | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **218** | **`P3-j` the authentication surface.** Seven contract headings, `GET /me`, `C-27` elevation, and **section 12's rows written BEFORE the endpoints ship** rather than after | `apps/api/src/routes/auth.ts` (new), `apps/api/src/routes/me.ts` (new), `apps/api/test/auth.test.ts` (new), `apps/api/package.json`, `pnpm-workspace.yaml` (`catalog:` only), `pnpm-lock.yaml`, `STATE` (append), `sessions/`. **It edits NO registry file**: [ADR-100](../decisions/ADR-100.md) discovers the directory | **YES, AUTH, `E2`** | **`P3-f`**; **`P3-h`** for `otp_challenges`. **NOT `P4-d`, which merged at `4fd4a8a`**, and not any sibling route slice: `ADR-100` leaves no shared file |
| **219** | **`P3-k` the idempotency layer and `POST /webhooks/psp/:provider`.** Verify before parsing, persist raw, dedupe on `(psp, provider_event_id)`, `200` for duplicates, defer out-of-order. **`idempotency_keys` and `psp_webhook_events` are both first-writer-wins registrations, neither refused** | `apps/api/src/routes/webhooks-psp.ts` (new), `apps/api/src/idempotency.ts` (new), `apps/api/test/**` (its files only), `packages/db/src/schema.ts` and `scope.ts` (**`idempotency_keys` only**), `packages/db/test/scoped-db.test.ts` (its row only), `STATE` (append), `sessions/` | **YES, `E2`** | **`P3-f`**; **`P3-h`** via the registry trio; **`P3-m`** for the signature verifier. **NOT `P3-j`**: a webhook carries no session. **NOT `P4-d`**, merged |
| **220** | **`P3-n` checkout and attribution, ONE slice.** `POST /checkout` and `POST /accounts/:accountId/reset`, the server-authoritative price, the recomputed coupon, and attribution resolved **inside the same transaction** ([M08](M08-affiliate-system.md) section 3.1), which is why P3's ordering table refuses to separate them | `apps/api/src/routes/checkout.ts` (new), `apps/api/test/checkout.test.ts` (new), `packages/affiliate/**` (new), `packages/affiliate/package.json`, `docs/architecture/API_CONTRACT.md` (**`POST /affiliate/creatives`'s row only**), `docs/decisions/ADR-1NN.md` (new), `ALLOCATION`, `INDEX`, `STATE` (append), `sessions/` | **YES, `E2`** | **`P3-i`**, **`P3-j`**, **`P3-k`**, **`P3-m`**. **NOT `P4-d`**, merged |
| **221** | **`P3-o` M19 KYC, the composite trigger set.** The vendor-agnostic provider port, `POST /kyc/session`, `GET /kyc/status`, `POST /webhooks/kyc/:provider`, and `{second_distinct_account_purchase, pre_funded}` firing on the earliest ([M19](M19-kyc-identity.md) section 1.2.1). **Merit never proxies documents** | `packages/kyc-provider/**` (new), `apps/api/src/routes/kyc.ts` (new), `apps/api/src/routes/webhooks-kyc.ts` (new), `apps/api/test/**` (its files only), `docs/decisions/ADR-1NN.md` (new), `ALLOCATION`, `INDEX`, `STATE` (append), `sessions/` | **YES, `E2`** | **`P3-j`**, **`P3-k`** via the idempotency layer, **`P3-n`** because `G-PLACEMENT-REACHED` fires at checkout under two of the triggers. **NOT `P4-d`**, merged |

### Wave 3.3: the two that need no surface at all. CONCURRENT with wave 3.2

| # | Slice | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **222** | **`P3-l` the provisioning saga against the simulator.** The `provisioning_queue` driver, the `ProvisioningOp` pipeline, `provision` and `entitle` implemented against [`packages/rithmic`](../../packages/rithmic/src/index.ts), compensation, and `INV-M2-13`'s fail-closed exit. **The queue exists and could not run**: its `enqueue` needs the transaction `P3-f` produces | `apps/worker/src/provisioning/**` (new), `apps/worker/src/index.ts`, `apps/worker/test/provisioning.test.ts` (new), `STATE` (append), `sessions/`. **It holds NO `packages/db` file**, because [session 205](../sessions/2026-08-25-session-205.md) registered `provisioning_queue` `derived` while this branch was open | **YES, `E2`** | **`P3-f`** for the transaction. **No `packages/db` file and no route, so NOT `P3-h`, NOT `P4-d`. It is the least blocked slice in the wave** |
| **223** | **`P3-p` [ADR-023](../decisions/ADR-023.md) enrichment, observe mode.** The vendor-agnostic adapter, its `integration_contracts` row, signals recorded and scored and **nothing blocked**. Last and smallest, and **non-blocking by ruling**, so nothing waits on it | `packages/enrichment/**` (new), `packages/enrichment/package.json`, `apps/api/src/routes/checkout.ts` (**its call site only**), `docs/decisions/ADR-1NN.md` (new), `ALLOCATION`, `INDEX`, `STATE` (append), `sessions/` | **YES.** It runs inside checkout's transaction | **`P3-f`** for the `firm` reader; **`P3-n`** via `checkout.ts` |

---

## 10. The count, reported honestly

**Six of P3's six wave-3 ordering-table rows are fenced on real paths, plus the seventh content its table does
not carry, and none of the seven can open until four preconditions land.**

| P3 section 6's row | Slice | Fenced? |
|---|---|---|
| The ledger posting path, and `PT-03` | `P3-i` | **yes** |
| The idempotency layer and the webhook receiver | `P3-k` | **yes** |
| Billing and checkout (`M03`) | `P3-n` | **yes** |
| Coupons and affiliate attribution (`M08`) | `P3-n`, **fused**, on the ordering table's own constraint | **yes** |
| The provisioning saga (`M02` against the simulator) | `P3-l` | **yes** |
| `M19` KYC, composite trigger set | `P3-o` | **yes** |
| `ADR-023` enrichment, observe mode | `P3-p` | **yes** |
| **The authentication surface**, which the table does not carry | `P3-j` | **yes**, and section 7 places it |

**The four preconditions, three of which this plan dispatches and one of which is session 209's:**

| # | Precondition | Slice | State |
|---|---|---|---|
| 1 | The write path, the transaction and the pre-identity reader | `P3-f` | **Dispatchable today. Nothing is ahead of it** |
| 2 | The nullability and type comparison, so `otp_challenges` is registrable | `P3-g` | Dispatchable behind sessions 206, 207 and 208. **Its specification is [ADR-094](../decisions/ADR-094.md) section 3 and its cost is unmeasured by construction** |
| 3 | The two-identity scope class | `P3-h` | Dispatchable behind `P3-g` |
| 4 | The route registry | **`P4-d`, session 209** | **DISCHARGED at `4fd4a8a`**, carrying [ADR-100](../decisions/ADR-100.md). The module list is a DIRECTORY LISTING, so the four route slices are four branches on four disjoint paths and the serialization this plan priced does not exist |

**So the honest form is not "six of six" and it is not "four of six".** It is: **eight slices fenced, eleven
sessions to dispatch, and the phase's first line of application code is three sessions away rather than
one.** A reader who takes only the eight-of-eight row away from this document has taken the wrong half.

---

## 11. What this plan hands the founder, none of them a session

| # | Item | What is needed |
|---|---|---|
| **1** | **`P3-g`'s cost is unmeasured by construction, and it is on the critical path** | Section 4. [ADR-094](../decisions/ADR-094.md) says the comparison *"would turn the suite red on whatever it finds across seven already-merged money-path files"*, and the count is now **80**. **Whether the session repairs what it finds or reports it and stops is a scope decision**, and the difference is one session against several. It cannot be sized before it runs, and auth waits behind it either way |
| **2** | **API_CONTRACT has no gate reconciling a module plan's endpoint table against it** | [P4 section 10](P4-portal-and-site.md) item 2, unresolved and inherited unchanged. **Two P3 slices add rows to it** and `POST /affiliate/creatives` is [M08](M08-affiliate-system.md)'s example: owned by the module, absent from the contract. [Session 187](../sessions/2026-08-24-session-187.md) priced the reconciliation at 96 rows and 24 rulings. **This plan does not write the gate and does not schedule the reconciliation** |
| **3** | **`GS-138`, and P3's third done-clause** | [P3 section 9](P3-ledger-billing-identity.md) item 3, unchanged and still open. All fourteen M2 fixture rows are `blocked / vendor-call`; `GS-138` is `INV-M2-13`'s, and *"fail-closed provisioning holding an unconfirmed setpoint out of trading"* is that invariant verbatim. **Whether [ADR-076](../decisions/ADR-076.md) section 1's rule discharges the row against the SIMULATOR is a ruling and this plan does not take it.** `P3-l` is buildable and testable either way |
| **4** | **Two vendors are unselected and both adapters are vendor-agnostic BY RULING, so neither blocks a slice** | The PSP ([M03](M03-billing-checkout.md) section 7.9.1: portability history is *"a condition of acceptance"*) and the enrichment vendor ([ADR-023](../decisions/ADR-023.md)). **What this plan asserts is only that the PORTS are buildable**, on [M02](M02-rithmic-bridge.md)'s own precedent that the simulator exists so *"the live layer is developable and testable before any vendor agreement exists"*. **Shipping `POST /checkout` to a real customer needs a contract with a PSP, and that is procurement rather than engineering** |
| **5** | **The `E2` reads.** Nine of the eleven slices are money path | Every slice in wave 3.0, 3.1 and 3.2 except `P3-m`'s fakes carries one. **`P3-f` is the one to read hardest**: it decides what every later slice is able to do to this database |
| **6** | **`OQ-F6-01`, the dual-control threshold in integer cents** | [P3 section 9](P3-ledger-billing-identity.md) item 1, unchanged and **still on P3's path because adjustments post to the ledger**, which is `P3-i`. The recommendation there is **10,000 cents** and the arithmetic is the argument. Until a value exists the `CHECK` is inert |

---

## 12. What this plan does not schedule, and why each absence is a decision

| Item | Disposition |
|---|---|
| **`P4-d`'s registry shape** | **Refused on ownership, not on difficulty, and the refusal was right.** Section 6.2 stated the property and did not rule it; [session 209](../sessions/2026-08-25-session-209.md) ruled it at `4fd4a8a` and **took a better mechanism than the one this plan proposed**, removing the shared file rather than making it total. Section 5.4 |
| **M08's settlement, statements and clawback** | [Session 162](../sessions/2026-08-24-session-162.md)'s `M08-4`, `M08-6` and `M08-7`. **P3's content is *"coupons and affiliate attribution"* and attribution is where it stops**; the commission clock and the payout leg are P5's with the rest of the payout rail. `P3-n` writes the attribution and no commission |
| **M19's dedupe, sanctions and reverification slices** | [Session 168](../sessions/2026-08-24-session-168.md)'s `M19-7` to `M19-11`. **P3's content is *"M19 KYC with the composite trigger set"***, which is the verification path and its triggers. `P3-h` makes `dedupe_matches` registrable and no slice here writes to it |
| **`PT-03`'s golden pair `GS-231`** | `blocked / no-fixture-format` in [section 39](../testing/golden-scenarios/39-fixture-status-and-blockers.md), owned to M20. **`PT-03` is a property and not a fixture**, so `P3-i` writes it against generated transactions and the blocked row stays blocked. Named so the two are not confused |
| **A migration for `SD-M9-04` or `INV-M3-01`'s write-once trigger** | [Session 157](../sessions/2026-08-24-session-157.md)'s `M3-d` and `M3-e`, both real and both M03's rather than this phase's stated content. Section 8: **no slice here is dispatched with a migration number** |
| **`CI-07` and `CI-08`** | P4's. **`P3-f` must not introduce a `build` script**, on [P3 section 6](P3-ledger-billing-identity.md)'s reasoning, and `apps/api`'s manifest already carries the comment saying so |
| **Anything signed** | This document is `draft` and rules nothing |

---

## 13. The rules every prompt carries, written once here

These are [P4 section 11](P4-portal-and-site.md)'s, unchanged where they held.

1. **The session-log stub is the first commit.** Write `docs/sessions/2026-08-25-session-<N>.md` with the
   objective and `placeholder` for every other field, strike your row in
   [sessions/README](../sessions/README.md), commit, push. **Then do the work.**
2. **Your log MUST carry an `<!--index: ... -->` line** under its `##` heading, and
   `node scripts/corpus/gates.mjs generate` is part of writing a log rather than an optional tidy-up
   ([ADR-088](../decisions/ADR-088.md)). **The generator throws on a `##` section with no marker.**
3. **`git fetch origin main` immediately before asserting anything about a registry.** Twelve of P4's fourteen
   measurements recorded the same defect: a claim row genuinely absent at the session's base commit that had
   merged by the time the branch committed. **An absence is a fact about a file at a commit.**
4. **Allocate your ADR number in ONE commit before you run.** Section 8 explains why this plan could not write
   it for you. **Do not read the register and take the next number you can see**; that is
   [session 120](../sessions/2026-08-21-session-120.md)'s move and it created `OI-27`. **Amend your
   reservation IN PLACE** when the file lands ([ADR-065](../decisions/ADR-065.md) T3, enforced by `CI-06f`),
   and write it unlinked until then, because `CI-06a` fails on a link to an absent document.
5. **Commit and push after each file.** Not at the end.
6. **The fence is absolute.** If the work needs a file outside it, **stop and report it in the pull-request
   body** rather than reaching.
7. **[STATE](../STATE.md): append one `##` section at the END.** Edit no existing line.
8. **Your ADR states what it FORECLOSES, not only what it chooses.** `P3-f` decides what every later slice can
   do to this database and `P3-h` decides what a row belonging to two people is scoped by. Both are decisions
   this project lives with for years.
9. **A new document gets its `INDEX.md` row in the same change.** `CI-06c` reads both directions.
10. **Money is integer cents and thresholds are basis points or integer cents.** No floats in any financial
    path, including in a doc example or a test fixture.
11. **Verify by running, never by reading.** `node scripts/corpus/gates.mjs check` and `pnpm run verify` leave
    green, and every completion claim in the pull-request body ships with its command and its output.
    **Never background `falsify:ci` and never `git add -A` after it: it mutates the working tree.**
12. **Report the count honestly.** *"I am at 3 of 5"* beats five thin files.
13. **Never weaken a gate to pass it and never widen a fence to finish.** They are the same move.
14. **Authority citations must resolve, and a merged constraint is checked for a superseding migration before
    it is cited.** [Session 129](../sessions/2026-08-22-session-129.md) reported a finding against a `0015`
    constraint `0037` had already repaired.

**Every slice except `P3-m` is money path: plan mode, fresh context, one objective,
[ADR-003](../decisions/ADR-003.md) strict, and the founder's `E2` read before merge.**

---

## 14. The dispatch order

```
Already in flight, and all of them order AHEAD of something here:
  206, 207, 208       schema.ts / scope.ts / scoped-db.test.ts   ->  blocks P3-g, P3-h
                      (205 MERGED at 7f8215f, taking the registry to 87 and provisioning_queue with it)
  209  MERGED at 4fd4a8a: ADR-100, fastify 5.12.1, the route registry
       -> nothing behind it is blocked, and no route slice shares a file with another

Wave 3.0, and the first is concurrent with the other two:
  P3-f  the write accessor        MONEY  <- NOTHING BLOCKS IT. It opens today
  P3-g  nullability comparison    MONEY  ->  P3-h  the four tables    MONEY

Wave 3.1, concurrent with each other and with wave 3.2:
  P3-i  the ledger posting path   MONEY  (needs P3-f, P3-h)
  P3-m  the PspAdapter port       MONEY  (needs nothing, if it takes no dependency)

Wave 3.2, FOUR BRANCHES on four disjoint route files. ADR-100 settled it:
  P3-j  auth                      MONEY  (needs P3-f, P3-h)
  P3-k  idempotency + PSP webhook MONEY  (needs P3-f, P3-h, P3-m)
  P3-n  checkout + attribution    MONEY  (needs P3-i, P3-j, P3-k, P3-m)
  P3-o  M19 KYC                   MONEY  (needs P3-j, P3-k, P3-n)
        ^ the ORDER above is the dependency order, not a serialization: no two
          of these four write the same file

Wave 3.3, no surface, concurrent with wave 3.2:
  P3-l  the provisioning saga     MONEY  (needs P3-f, P3-h)
  P3-p  ADR-023 enrichment        MONEY  (needs P3-f, P3-n)
```

**`P3-f` is the one to run first and nothing blocks it.** It is money path, it takes one entry with three
clauses, and it is the slice two module measurements asked for in two different fences without either being
able to see the other.

---

## 15. The prompts

Each block is complete. Paste one into a fresh session and change nothing but the allocation step.

---

### `P3-f`: the accessor learns to write (session 213, MONEY PATH, `E2`)

```
Branch: claude/p3f-write-accessor   (create from origin/main)
Fence:  packages/db/src/scoped-db.ts, packages/db/src/index.ts,
        packages/db/test/write-accessor.test.ts (NEW),
        docs/decisions/ADR-1NN.md (new), docs/decisions/ALLOCATION.md (your row
        only), docs/INDEX.md (your row only), docs/STATE.md (append only),
        docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE. In particular: NOT packages/db/src/schema.ts, NOT
        scope.ts, NOT packages/db/test/scoped-db.test.ts. Sessions 206, 207, 208
        and 214 and 215 hold those three, and staying off them is the only reason
        this session can run concurrently with five others.
Regime: MONEY PATH. PLAN MODE. Fresh context. One objective. ADR-003 strict.
        E2: this branch waits on the founder's line-by-line read and must not be
        merged before it. Your session-log number is 213.
        ALLOCATE YOUR ADR NUMBER IN YOUR FIRST COMMIT, in ALLOCATION, before you
        write anything else. The lowest free number when this plan was written
        was 100 and session 209 may have taken it; fetch and read the table.

OBJECTIVE
Write one ADR with three clauses and implement it: the write path, the
transaction, and the reader with no identity.

THE FINDING, AND VERIFY EACH LINE YOURSELF BEFORE YOU RULE.
  1. `sed -n '131,156p' packages/db/src/scoped-db.ts` -- both accessors carry
     `rows()` and nothing else.
  2. `packages/db/src/index.ts` exports no writer and no transaction, and
     ADR-084 section 9 rules `client()` unexported PERMANENTLY.
  3. `packages/queue/src/job-queue.ts` makes the caller's open transaction
     `enqueue`'s FIRST argument with no overload that omits it, and says
     `packages/db` "can satisfy it without exporting its client". It does not.
     So NOTHING IN THIS WORKSPACE CAN ENQUEUE A JOB.
  4. `grep -n "SystemReason" packages/db/src/scoped-db.ts` -- the vocabulary is
     'nightly-batch' | 'operator-console'. Now read scope.ts and confirm that
     `psp_webhook_events`, `coupons` and `integration_contracts` are all `firm`,
     therefore excluded from `ScopedTableKey`, therefore readable ONLY through
     `systemDb`. A request handler is neither of those two reasons.

WHAT THE THREE CLAUSES DECIDE.
  (a) THE WRITE PATH AND HOW IT SCOPES. A read scopes with a WHERE clause and
      `scopePredicate` already produces one. AN INSERT HAS NO WHERE CLAUSE: the
      identity must be WRITTEN, and an UPDATE or DELETE that forgets the
      predicate is the BOLA failure ADR-008 scoped this wrapper to bound,
      arriving on the side that destroys data rather than the side that leaks
      it. Decide what `ScopedDb` gains, decide whether `firm` stays excluded on
      the write side as it is on the read side, and say what a caller that needs
      to write a `firm` row does instead.
  (b) THE TRANSACTION. ADR-006's central consequence is that enqueue
      participates in the same transaction as the state change that caused it.
      Decide the primitive, and decide how a `JobTransaction` is produced
      WITHOUT exporting `client()`, which ADR-084 forecloses permanently.
      INV-M3-13's wallet leg and M08 section 3.1's attribution both commit
      inside checkout's transaction, so this is the clause the most later code
      depends on.
  (c) THE READER WITH NO IDENTITY. ADR-096 is the precedent AND IT WENT THE
      OTHER WAY: it refused a third `SystemReason` member for `apps/site` and
      ruled the site is "not a reader of this database at all", reading over
      HTTP instead. READ IT BEFORE YOU WIDEN ANYTHING. That remedy is
      unavailable here because under ADR-096 `apps/api` is the process the site
      reads THROUGH, so if `apps/api` cannot reach a `firm` table then nothing
      can. Decide, and price what you decide the way ADR-096 section 5 priced
      the reading it refused.

STATE WHAT YOU FORECLOSE, NOT ONLY WHAT YOU CHOOSE. Every later slice in P3, P5
and M06 writes through whatever you land. Name what becomes expensive afterwards.

YOUR SUITE IS A NEW FILE AND THERE IS A REASON. `packages/db/test/scoped-db.test.ts`
is held by five other sessions. Write `write-accessor.test.ts` and put nothing in
the old file. ALSO: `ci.yml`'s `integration` job runs on bare ubuntu-latest with
NO services block, so there is no database to write to in CI. Assert the SQL the
accessor BUILDS, the way `scoped-db.test.ts` asserts the predicate, rather than
executing it -- and say in the entry that you did, because a suite that looks
like it exercised a write and did not is worse than one that says it did not.

DO NOT ADD A `build` SCRIPT. CI-06/gate-inventory requires it ABSENT.

APPROVAL LINE. Unsigned, one checkable clause, carrying the direction it fails
in. Candidate: "an UPDATE or DELETE issued through `scopedDb` carries the same
predicate `scopePredicate` produces for the matching read, watched refusing on a
seeded rule that drops it, and a `firm` key is a compile error on the write side
exactly as it is on the read side." Cost if wrong: every later slice writes
through an accessor whose scoping is a convention, which is the control ADR-008
was accepted for, absent in the direction that destroys rows.

STOP CONDITION
One ADR with three clauses and three foreclosure statements, the accessor, the
suite, 30 of 30 gates, `pnpm run verify` exit 0. DO NOT MERGE. E2 read pending.
```

---

### `P3-g`: nullability and type are compared (session 214, MONEY PATH, `E2`, after 206 to 208)

```
Branch: claude/p3g-nullability-comparison   (from origin/main AFTER 206 to 208 merge)
Fence:  packages/db/test/scoped-db.test.ts, packages/db/src/schema.ts (ONLY the
        rows your comparison finds wrong), docs/decisions/ADR-1NN.md (new),
        docs/decisions/ALLOCATION.md (your row), docs/INDEX.md (your row),
        docs/STATE.md (append only), docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE. NOT scope.ts (session 215 holds it), NOT
        packages/db/src/scoped-db.ts (session 213 holds it).
Regime: MONEY PATH. PLAN MODE. Fresh context. One objective. ADR-003 strict. E2.
        Your session-log number is 214. Allocate your ADR number first.

OBJECTIVE
Write the comparison ADR-094 section 3 specified and did not number, so that
`ALTER COLUMN` stops being a proxy refusal.

READ ADR-094 IN FULL BEFORE ANYTHING ELSE. Its section 3 is your specification
and you are not writing a new one:

  "Column TYPE and NULLABILITY are transcribed into schema.ts and asserted
   nowhere; that is true of all seven registered tables today and is not created
   by this entry. Closing it is a second comparison against `ddlColumnDefs`, it
   would turn the suite red on whatever it finds across seven already-merged
   money-path files, and measuring that is its own session ... Until it exists,
   `ALTER COLUMN` refusing a table is the only thing standing where that
   comparison should be, and deleting the refusal before writing the comparison
   would be trading a real control for nothing."

THE COUNT HAS MOVED AND YOUR COST MOVED WITH IT. ADR-094 wrote "seven". Run
`grep -c 'pgTable(' packages/db/src/schema.ts` on the tree you open. It was 80
when this plan was written. The comparison lands on every one of them.

THE ORDER IS: COMPARISON FIRST, REFUSAL SECOND. Write and land the nullability
and type comparison. Watch it fail on a seeded transcription that declares a
column `.notNull()` the DDL made nullable. ONLY THEN may the fold's vocabulary
gain `ALTER COLUMN` as a recognised no-op, and your ADR must supersede ADR-094's
section 3 clause explicitly rather than quietly contradicting it. ADR-099 over
ADR-083 is your precedent for how a signed clause moves.

REPORT WHAT YOU FIND RATHER THAN REPAIRING EVERYTHING YOU FIND. If the
comparison turns up drift across many transcriptions, repairing all of them is a
different session and possibly several. STOP AT THE POINT WHERE THE COUNT STOPS
BEING SMALL, report "the comparison is written and it finds N disagreements
across M tables, here they are", and let the founder decide. That is the honest
outcome and it is better than a session that quietly widened.

DO NOT WEAKEN THE COMPARISON TO MAKE IT GREEN. A comparison that passes because
it compares nothing is ADR-094's seed B, and that entry's signature exists
because a vacuous fold is the failure direction this class has.

APPROVAL LINE. Unsigned, one checkable clause. Candidate: "a transcription
declaring `.notNull()` on a column the migration set leaves nullable is watched
FAILING, and `otp_challenges` registers clean once `ALTER COLUMN` folds."
Cost if wrong: `ALTER COLUMN` stops refusing tables while the axis it moves is
still asserted nowhere, which trades a real control for nothing in ADR-094's own
words.

STOP CONDITION
One ADR superseding one clause, the comparison, the seeded failure watched, an
honest count of what it found, 30 of 30 gates, verify exit 0. DO NOT MERGE.
```

---

### `P3-h`: the four tables the registry cannot hold (session 215, MONEY PATH, `E2`, after `P3-g`)

```
Branch: claude/p3h-two-identity-scope   (from origin/main AFTER 214 merges)
Fence:  packages/db/src/schema.ts, packages/db/src/scope.ts,
        packages/db/test/scoped-db.test.ts, docs/decisions/ADR-1NN.md (new),
        docs/decisions/ALLOCATION.md (your row), docs/INDEX.md (your row),
        docs/STATE.md (append only), docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE. NOT packages/db/src/scoped-db.ts (session 213).
Regime: MONEY PATH. PLAN MODE. Fresh context. One objective. ADR-003 strict. E2.
        Your session-log number is 215. Allocate your ADR number first.

OBJECTIVE
Take ONCE the per-table ruling ADR-092 section 9 named three times, and register
the four tables P3 needs and the registry cannot hold.

THE THREE REFUSALS ARE IN scope.ts's OWN WORDS AND THEY ARE ONE SHAPE. Read
`sed -n '112,160p' packages/db/src/scope.ts` before you rule. `identity_links`
carries `identity_a` and `identity_b`; `attributions` carries
`buyer_identity_id` and `affiliate_identity_id`; `dedupe_matches` was refused by
session 194 on the same ground. An `owned` rule names ONE column, and each
wrong choice RETURNS ROWS rather than erroring, which is the BOLA failure
ADR-008 scoped the accessor to bound. `affiliate_commissions` follows
`attributions` mechanically and needs no ruling of its own.

WHY THIS IS ONE RULING AND NOT THREE. ADR-092 turned fourteen per-module
questions into one ruling and its own section 10 rejected a holder document
because "a second hand-maintained copy" is the defect. Three per-table entries
for one shape is that defect in a different costume. YOUR ENTRY RULES THE CLASS:
what a scope rule is for a row whose subject is a PAIR. Then it applies the class
to each of the three and says, per table, what the application is.

THE FOURTH TABLE IS A DIFFERENT REASON AND IT IS NOT A RULING. `otp_challenges`
is refused by ADR-094's drift fold, and session 214 is the session that moves
that. IF 214 HAS NOT MERGED, STOP AND SAY SO rather than registering it: the
whole point of 214 running first is that the comparison exists before the
refusal is lifted.

THE SCOPE CLASS FOR `otp_challenges` IS ITS OWN SMALL QUESTION. The table is
PRE-IDENTITY -- API_CONTRACT section 12 rows `POST /auth/otp` at required factor
`none` and calls the class pre-identity -- so it reaches no identity at the
moment it is written. Register it under the class that says so and let session
218 read it through whatever session 213 ruled for a reader with no identity.

APPROVAL LINE. Unsigned, one checkable clause. Candidate: "for each of the three
pair tables, a query issued for identity A returns every row naming A in EITHER
column and no row naming neither, watched failing on a seeded rule that names one
column." Cost if wrong: an affiliate cannot see the referral they earned, or a
buyer's attribution is returned to somebody else, and both return rows.

STOP CONDITION
One ADR ruling the class, four registrations, the per-table drift assertions,
30 of 30 gates, verify exit 0. DO NOT MERGE. E2 read pending.
```

---

### `P3-i`: the ledger posting path and `PT-03` (session 216, MONEY PATH, `E2`)

```
Branch: claude/p3i-ledger-posting   (from origin/main AFTER 213 and 215 merge)
Fence:  packages/ledger/** (new), packages/ledger/package.json,
        packages/db/src/schema.ts and scope.ts (`ledger_halts` ONLY),
        packages/db/test/scoped-db.test.ts (its row ONLY),
        docs/architecture/OVERVIEW.md (SECTION 3's container table, your row
        only), docs/decisions/ADR-1NN.md (new), ALLOCATION (your row),
        docs/INDEX.md (your row), docs/STATE.md (append), docs/sessions/.
        TOUCH NOTHING ELSE. NOT apps/**.
Regime: MONEY PATH. PLAN MODE. Fresh context. One objective. ADR-003 strict. E2.
        Your session-log number is 216. Allocate your ADR number first.

OBJECTIVE
Double-entry posting as a library, plus `PT-03`'s aggregate half.

WHY A PACKAGE AND NOT A ROUTE. M03's INV-M3-10, M05's DEP-M3-06 and M08's
commission clock all post through this path, and so does the nightly batch. A
posting path inside `apps/api` is unreachable from `apps/worker` and RI-04
forbids an app depending on an app. So it is a package, and OVERVIEW section 3's
container table gains a row in the same commit, because that table is where a
container is rowed and session 144 already showed what happens when it is not.

THE SCHEMA IS ALREADY THERE AND IT ALREADY ASSERTS MOST OF THIS. Read
`0009_ledger.sql`, `0027`'s LEDGER-C1 and LEDGER-C2 deferred triggers and the
zero-sum trigger, and `scripts/db/probe_ledger_constraints.sql`, which runs in
CI today. YOUR POSTING PATH DOES NOT RE-IMPLEMENT WHAT THE DATABASE ENFORCES; it
posts what the database will accept and it fails loudly when the database
refuses. Say in the entry which invariants are the schema's and which are yours.

`ledger_transactions` IS `derived` BY SEMI-JOIN AND THE REASON IS ARITHMETIC.
scope.ts:374 records it: the table carries no identity column, reaches one only
through its entries, and has MORE THAN ONE, because double-entry means a trader
leg and a firm leg on the same transaction. A plain JOIN returns the transaction
once per matching entry. That is the shape your posting path writes.

`ledger_halts` IS UNREGISTERED AND IT IS ONE OF THE FOUR ADR-092 SECTION 9 SAYS
NO SESSION WOULD REACH. It is `identity_id uuid NOT NULL` at 0016:55, so its rule
is `owned` and needs no ruling. Register it and close one of the four, and say in
your entry that the posting path REFUSES to post while a halt runs, or say why
it does not.

MONEY IS INTEGER CENTS. No floats anywhere, including in a generated test value.

`PT-03` IS A PROPERTY AND NOT A FIXTURE. STRATEGY section 5 rows it as "ledger
zero-sum, per transaction and in aggregate"; per-transaction is the deferred
constraint in the database and the AGGREGATE half is yours. `GS-231` is
`blocked / no-fixture-format` and stays blocked; do not confuse the two and do
not touch section 39.

APPROVAL LINE. Unsigned, one checkable clause. Candidate: "over any generated
sequence of postings the sum of every entry in the ledger is exactly zero, and a
seeded posting that credits without debiting is watched being REFUSED by the
path before the database sees it and by the database if the path is bypassed."
Cost if wrong: money appears on Merit's books with no counterparty and the
control that would say so is the one being written.

STOP CONDITION
One package, one ADR, `PT-03`, one registration, an OVERVIEW row, 30 of 30,
verify exit 0. DO NOT MERGE. E2 read pending.
```

---

### `P3-m`: the `PspAdapter` port and two fakes (session 217, MONEY PATH)

```
Branch: claude/p3m-psp-port   (from origin/main)
Fence:  packages/psp/** (new), packages/psp/package.json,
        pnpm-workspace.yaml (`catalog:` block ONLY, and ONLY if the port needs a
        dependency), pnpm-lock.yaml (same condition),
        docs/decisions/ADR-1NN.md (new), ALLOCATION (your row),
        docs/INDEX.md (your row), docs/STATE.md (append), docs/sessions/.
        TOUCH NOTHING ELSE. NOT apps/**, NOT packages/db.
Regime: MONEY PATH by subject, and it opens no network and writes no row.
        One objective. Your session-log number is 217. Allocate your ADR first.

OBJECTIVE
The interface every PSP is used through, and two fakes. NO ROUTES, NO NETWORK,
NO VENDOR.

THE VENDOR IS UNSELECTED AND THAT DOES NOT BLOCK YOU, AND THE PRECEDENT IS IN
THE TREE. M02 section 3.5 point 4 says the simulator exists so "the live layer is
developable and testable before any vendor agreement exists", and
`packages/rithmic` is the proof. M03 section 7.9.1 makes portability history "a
condition of acceptance" rather than a preference, so the procurement criterion
is already ruled and YOU MUST NOT REOPEN IT.

THE PROVIDER SET IS ALREADY CLOSED. API_CONTRACT's CheckoutResponse types `psp`
as `"psp_a" | "psp_b"`. Two MIDs, and section 5's `service_unavailable` error is
"both MIDs unhealthy", so health and failover are part of the port rather than
of a route.

SECTION 10 OF THE CONTRACT IS THE HALF PEOPLE FORGET. "HMAC signature verified
BEFORE parsing, timestamp within a 5 minute window, nonce recorded for replay
protection, raw payload stored." The verifier belongs to this port, because
session 219 will call it before it has parsed anything, and a verifier that lives
in a route handler is a verifier the next provider re-implements.

IF THE PORT NEEDS NO DEPENDENCY, DO NOT TOUCH THE CATALOG. `pnpm-lock.yaml` is
serial three ways across P4 and this plan, and joining that serialization for
nothing costs a cycle. If it does need one, say in the entry what VG-12 is being
asked to admit and count the closure from the lockfile rather than from the
package's own direct list, which is the error `pnpm-workspace.yaml`'s `pg`
comment records.

APPROVAL LINE. Unsigned, one checkable clause. Candidate: "the signature verifier
refuses a payload whose body was re-serialised before verification, watched
failing, and no method on the port can be called without the raw bytes."
Cost if wrong: a forged webhook is parsed before it is verified, which is the one
ordering API_CONTRACT section 10 states in capitals.

STOP CONDITION
One package, one ADR with its foreclosures, two fakes, its suite, 30 of 30,
verify exit 0.
```

---

### `P3-j`: the authentication surface (session 218, MONEY PATH, AUTH, `E2`)

```
Branch: claude/p3j-auth-surface   (from origin/main AFTER 213 and 215 merge)
Fence:  apps/api/src/routes/auth.ts (new), apps/api/src/routes/me.ts (new),
        apps/api/test/auth.test.ts (new), apps/api/package.json,
        pnpm-workspace.yaml (`catalog:` only), pnpm-lock.yaml,
        docs/STATE.md (append), docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE. NOT packages/db, NOT API_CONTRACT: every endpoint
        you write is ALREADY SPECIFIED and this session adds no contract row.
        DO NOT CREATE apps/api/src/routes/index.ts. ADR-100 made the module list
        a DIRECTORY LISTING; a registry file re-creates the collision it removed
        for every slice behind you.
Regime: MONEY PATH. AUTH. PLAN MODE. Fresh context. One objective. ADR-003
        strict. E2. Your session-log number is 218. NO ADR is expected: the
        contract specifies this surface and sessions 213 and 215 took the two
        rulings it needed. If you find you need one, allocate it first and say
        in the pull-request body why the contract was not enough.

OBJECTIVE
The seven auth headings API_CONTRACT section 3 specifies, `GET /me`, and C-27
elevation.

READ API_CONTRACT SECTION 12 FIRST AND WRITE ITS ROWS FIRST. Its first sentence
is "Every row is a named test that must exist BEFORE the endpoint ships", `VG-5`
is its subject and `CI-06k` is live in the runner reading the required-factor
column. Six of section 12's rows are yours, including the two that assert the
QUIET direction: `GET /sessions` and `GET /phone/change` return 200 from a
single-factor session, because "a boundary tested only where it refuses is
indistinguishable from a boundary that refuses everything".

C-27's FACTOR UNION IS A TYPE AND NOT A CHECK. Section 12: elevation admits
`passkey` and `dual_channel` and NEVER SMS alone, and the matrix's expected
result for an SMS-established factor is `validation_failed` because "there is no
such value to send". Write it as a union. `sessions.elevated_by_factor` at
0029:581 admits exactly those two values, so the database already agrees.

WHY THIS SESSION CANNOT BE FIRST, WHICH YOU SHOULD VERIFY RATHER THAN TRUST.
`POST /auth/otp` writes `otp_challenges`, which was unregistered and refused by
ADR-094 until session 214 landed the nullability comparison and session 215
registered it. Run `grep -c "otpChallenges" packages/db/src/scope.ts` on the tree
you open. IF IT IS ZERO, STOP: your front door has no table and no amount of
route code changes that.

HOW A ROUTE FILE IS WRITTEN, AND IT IS NOT AN IMPORT LIST. ADR-100 and
`apps/api/src/registry.ts`: each file under `apps/api/src/routes/` default-exports
`defineRoutes({ name, routes })`, `name` MUST equal the file's stem, `path` is the
contract path with NO base path, and `discoverRouteModules` THROWS on any file in
that directory that does not comply. `compose` refuses a duplicate METHOD /path
across the whole module set, so a collision with a concurrent slice is a startup
failure rather than a silent second registration. READ `routes/health.ts` FIRST:
it is nine lines and it is the model.

RATE LIMITS ARE DATA AND NOT PROSE. API_CONTRACT section 11 puts the SMS branch's
velocity in `otp_send_budget` rows with `send_limit` and `budget_cents`, "so the
values are config the way every other plan parameter is", and
`notification_kinds.rate_limit_exempt` is GENERATED from `class` with
`pre_identity_auth` NOT in the exempt set. Do not write a number into a handler.

APPROVAL LINE. Unsigned, one checkable clause. Candidate: "every one of
API_CONTRACT section 12's C-27 rows is asserted in BOTH directions -- the refusal
and the 200 -- and a seeded handler that accepts an SMS-established factor for
elevation fails to COMPILE rather than failing a test." Cost if wrong: C-27 is a
constitution-level control and the corpus's own postmortem file is `VG-5`'s
citation.

STOP CONDITION
Seven headings, `GET /me`, section 12's rows in both directions, 30 of 30 gates,
verify exit 0. DO NOT MERGE. E2 read pending.
```

---

### `P3-k`: the idempotency layer and the PSP webhook receiver (session 219, MONEY PATH, `E2`)

```
Branch: claude/p3k-idempotency-webhooks  (from origin/main AFTER 213, 215 and 217)
Fence:  apps/api/src/routes/webhooks-psp.ts (new), apps/api/src/idempotency.ts
        (new), apps/api/test/webhooks-psp.test.ts and apps/api/test/idempotency.test.ts
        (new), packages/db/src/schema.ts and scope.ts (`idempotency_keys` ONLY),
        packages/db/test/scoped-db.test.ts (its row ONLY),
        docs/STATE.md (append), docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE.
Regime: MONEY PATH. PLAN MODE. Fresh context. One objective. ADR-003 strict. E2.
        Your session-log number is 219. No ADR expected; the contract specifies
        this. Allocate one first if you find you need it.

OBJECTIVE
The idempotency layer every mutating endpoint uses, and the PSP webhook receiver.

THIS SLICE DOES NOT DEPEND ON AUTH AND THAT IS DELIBERATE. A PSP webhook carries
no session; it carries an HMAC. API_CONTRACT section 10 is the whole
specification and section 12 has no row for it. So it RUNS CONCURRENTLY with
session 218: ADR-100 made the module list a directory listing, so your route file
and 218's share no file at all.

THE ORDERING IN SECTION 10 IS THE CONTROL AND IT IS STATED IN CAPITALS THERE:
"HMAC signature verified BEFORE parsing". Session 217's port owns the verifier.
Call it on the raw bytes. A framework that has already parsed the body for you
has already lost this, so check what Fastify does with the body BEFORE your
handler runs rather than assuming: session 209 landed fastify 5.12.1, and a
content-type parser is where this is won or lost.

`idempotency_keys` IS UNREGISTERED AND NOT REFUSED, so it is a first-writer-wins
registration under ADR-092 and needs no ruling. `psp_webhook_events` is ALREADY
REGISTERED and it is `firm`, so you reach it through whatever session 213 ruled
for a reader with no identity. INV-M3-03's `(psp, provider_event_id)` uniqueness
is already a constraint in the schema: your dedupe rides on it rather than
re-checking it in application code.

A DUPLICATE RETURNS 200 AND THAT IS NOT AN ERROR PATH. Section 10: "a 200 is
returned for duplicates so providers stop retrying". Assert it. Assert also that
an unverified signature returns 401 and NEVER REACHES BUSINESS LOGIC, and that
out-of-order delivery is DEFERRED AND RE-EVALUATED rather than applied, which is
B4 #9 and is the clause a receiver written in a hurry drops.

APPROVAL LINE. Unsigned, one checkable clause. Candidate: "the same provider
event delivered twice produces exactly one business effect and two 200s, watched
against a seeded receiver whose uniqueness check is removed, and an unverified
signature is watched never reaching the handler." Cost if wrong: a PSP retry
double-credits a purchase, which is P3's first done-clause failing silently.

STOP CONDITION
The layer, the receiver, one registration, both directions asserted, 30 of 30,
verify exit 0. DO NOT MERGE. E2 read pending.
```

---

### `P3-n`: checkout and attribution (session 220, MONEY PATH, `E2`)

```
Branch: claude/p3n-checkout-attribution  (from origin/main AFTER 216, 217, 218 and 219)
Fence:  apps/api/src/routes/checkout.ts (new),
        apps/api/test/checkout.test.ts (new),
        packages/affiliate/** (new), packages/affiliate/package.json,
        docs/architecture/API_CONTRACT.md (`POST /affiliate/creatives`'s ROW
        ONLY), docs/decisions/ADR-1NN.md (new, REQUIRED: API_CONTRACT is
        approved, so a contract row is an ADR and not a commit),
        ALLOCATION (your row), docs/INDEX.md (your row), docs/STATE.md (append),
        docs/sessions/. TOUCH NOTHING ELSE. NO MIGRATION: if you find you need
        one, STOP and report it.
Regime: MONEY PATH. PLAN MODE. Fresh context. One objective. ADR-003 strict. E2.
        Your session-log number is 220. Allocate your ADR number first.

OBJECTIVE
`POST /checkout` and `POST /accounts/:accountId/reset`, with attribution resolved
inside the same transaction.

WHY CHECKOUT AND ATTRIBUTION ARE ONE SESSION AND NOT TWO. M08 section 3.1
resolves attribution INSIDE the checkout transaction. Two sessions writing inside
one transaction are one session. P3's own wave-3 ordering table says so and this
is the row it was written for.

EVERYTHING THE CLIENT SENDS ABOUT MONEY IS IGNORED, AND THE CONTRACT LISTS IT.
API_CONTRACT section 5: "price comes from `plan_version_sizes`, never from the
request; the coupon discount is recomputed server-side; the account cap is
checked against the resolved identity, not the email". Section 12 has a row for
it: "Checkout with a client-supplied price field -> field ignored; server price
used". Assert that row.

INTEGER CENTS EVERYWHERE. `amount_cents`, `discount_cents`, `size_cents`. No
float touches this path, not in a handler, not in a test, not in a comment's
example.

ATTRIBUTION IS A PURE FOLD AND IT BELONGS IN THE PACKAGE, NOT THE HANDLER.
Session 162's `M08-5`: code override, then last touch within 30 days, then none,
with the literal self-deal REFUSED. `attributions_literal_self_deal_is_void`
already exists in `0012` and your fold agrees with it or the database refuses the
row. Session 215 ruled how `attributions` is scoped; read that entry before you
write a query against it.

`POST /affiliate/creatives` IS IN M08 SECTION 4 AND IN NO CONTRACT. Session 162
measured it: `grep -n "creatives" docs/architecture/API_CONTRACT.md` returns
nothing. API_CONTRACT is `approved`, so adding the row is your ADR. THAT IS THE
ONLY ROW YOU MAY ADD, and P4 section 9 calls this file the hottest cross-phase
file in the corpus for a reason.

THE PSP IS A FAKE HERE AND YOU SAY SO. Session 217's port has two fakes and no
vendor. `payment_session` comes from a fake, the suite proves the pipeline, and
the entry states plainly that shipping this to a real customer needs a
procurement decision nobody has taken.

APPROVAL LINE. Unsigned, one checkable clause. Candidate: "a checkout whose
attribution write fails leaves NO purchase row, watched by seeding a failure in
the attribution fold and asserting the purchase absent, and a checkout carrying a
client-supplied price is charged the server's price." Cost if wrong: an
affiliate's referral is lost while the purchase stands, or a customer sets their
own price.

STOP CONDITION
Two endpoints, one package, one contract row with its ADR, section 12's checkout
row, 30 of 30, verify exit 0. DO NOT MERGE. E2 read pending.
```

---

### `P3-o`: M19 KYC, the composite trigger set (session 221, MONEY PATH, `E2`)

```
Branch: claude/p3o-kyc  (from origin/main AFTER 218, 219 and 220 merge)
Fence:  packages/kyc-provider/** (new), apps/api/src/routes/kyc.ts (new),
        apps/api/src/routes/webhooks-kyc.ts (new), apps/api/test/kyc.test.ts and
        apps/api/test/webhooks-kyc.test.ts (new), docs/decisions/ADR-1NN.md
        (new), ALLOCATION (your row), docs/INDEX.md (your row),
        docs/STATE.md (append), docs/sessions/. TOUCH NOTHING ELSE.
        NOT dedupe, NOT sanctions, NOT reverification: section 12 of the plan
        says whose those are and they are not P3's stated content.
Regime: MONEY PATH. PLAN MODE. Fresh context. One objective. ADR-003 strict. E2.
        Your session-log number is 221. Allocate your ADR number first.

OBJECTIVE
The vendor-agnostic provider port, `POST /kyc/session`, `GET /kyc/status`,
`POST /webhooks/kyc/:provider`, and the composite trigger set.

THE TRIGGER SET IS RULED AND YOU IMPLEMENT IT RATHER THAN CHOOSING IT. M19
section 1.2.1, ruled at the FREEZE gate: `{second_distinct_account_purchase,
pre_funded}`, EARLIEST FIRES. `G-PLACEMENT-REACHED` fires at checkout under two
of the triggers, which is why session 220 is ahead of you.

MERIT NEVER PROXIES DOCUMENTS. API_CONTRACT section 7: the response is a
`hosted_url` and the client goes to the provider's flow. `INV-M19-07`. A design
where a document byte passes through Merit is wrong before it is written.

THE PROVIDER IS UNDECIDED AND THE ADAPTER IS VENDOR-AGNOSTIC BY RULING. M19:76,
and "the selected provider is NAMED IN THE PRIVACY POLICY at selection time,
which makes provider choice a disclosure". Build the port and a fake. Do not
select a vendor and do not touch the privacy policy.

THE WEBHOOK IS SESSION 219's LAYER AND NOT A SECOND ONE. API_CONTRACT section
10's third row anchors on `provider_applicant_id` plus event id. Use the
idempotency layer that already exists. A second implementation of the same rule
is the thing this ordering was built to prevent.

`dedupe_matches` IS REGISTRABLE AFTER SESSION 215 AND YOU DO NOT WRITE TO IT.
Session 168's `M19-8` owns dedupe and it is not P3's stated content. If your work
appears to need it, STOP and report rather than widening.

APPROVAL LINE. Unsigned, one checkable clause. Candidate: "verification fires at
each configured trigger and at the EARLIEST of them, watched against a fixture
where both trigger conditions become true in either order, and a second
verification of the same applicant writes a NEW row rather than updating one."
Cost if wrong: P3's fourth done-clause, "verification firing at each configured
trigger", is asserted by nothing.

STOP CONDITION
One port, three endpoints, the trigger set, 30 of 30, verify exit 0.
DO NOT MERGE. E2 read pending.
```

---

### `P3-l`: the provisioning saga against the simulator (session 222, MONEY PATH, `E2`)

```
Branch: claude/p3l-provisioning-saga   (from origin/main AFTER 213 and 215 merge)
Fence:  apps/worker/src/provisioning/** (new), apps/worker/src/index.ts,
        apps/worker/test/provisioning.test.ts (new),
        packages/db/test/scoped-db.test.ts (its row ONLY),
        docs/STATE.md (append), docs/sessions/ (your log + its row).
        TOUCH NOTHING ELSE. NOT apps/api: this slice writes no route, which is
        why it needs nothing from session 209.
Regime: MONEY PATH. PLAN MODE. Fresh context. One objective. ADR-003 strict. E2.
        Your session-log number is 222. No ADR expected.

OBJECTIVE
The `provisioning_queue` driver, the `ProvisioningOp` pipeline, `provision` and
`entitle` against the simulator, compensation, and the fail-closed exit.

THE QUEUE ALREADY EXISTS AND COULD NOT RUN, AND THAT IS THE HALF THAT MOVED.
`packages/queue` exports five methods and a pg-boss adapter, and session 147
recorded that nothing in the workspace could produce the `JobTransaction` its
`enqueue` requires in the FIRST argument position. Session 213 produces one. YOU
ARE THE FIRST CALLER ADR-006's clause has ever been graded against in anger:
"enqueue participates in the same transaction as the state change that caused
it, which removes a whole class of saga bugs (committed the purchase, lost the
provisioning job)". Assert that, against a real transaction, in both directions.

YOU DO NOT WAIT ON THE VENDOR CALL AND P3 SECTION 4.2 IS THE MEASUREMENT.
`packages/rithmic` exports `streamRun`, `foldStream` and `sampleTicks`; M02
declares `platform: 'rithmic' | 'simulator'` on the adapter; INV-M2-11 makes
simulator and vendor output pass through the SAME parser and normalizer.

THE FAIL-CLOSED EXIT IS THE PHASE'S THIRD DONE-CLAUSE AND ITS FIXTURE IS
BLOCKED. `INV-M2-13` is "fail-closed provisioning holding an unconfirmed setpoint
out of trading", DELIVERY_PLAN's clause verbatim, and `GS-138` is
`blocked / vendor-call` with the other thirteen M2 rows. WRITE THE ASSERTION
ANYWAY, against the simulator, and REPORT in the pull-request body that whether
it discharges `GS-138` is a ruling nobody has taken. Do not touch section 39.

`provisioning_queue` WAS UNREGISTERED WHEN THIS PLAN WAS FIRST WRITTEN AND IT IS
REGISTERED NOW. Session 205 landed it `derived` through `account_id` while this
branch was open, so THAT PART OF YOUR SLICE IS ALREADY DONE and your fence holds
no `packages/db` file at all. Verify it on the tree you open rather than trusting
this paragraph: `grep -c "pgTable('provisioning_queue'" packages/db/src/schema.ts`.
This is ADR-092's own stated cost, "a session cannot know its own slice size
before it runs", and reporting "it was already there" is the honest form.

APPROVAL LINE. Unsigned, one checkable clause. Candidate: "a setpoint whose
confirmation has not arrived holds the account OUT of trading, watched by seeding
a confirmation that never lands, and a purchase whose provisioning enqueue fails
leaves NO committed purchase." Cost if wrong: an account trades on a setpoint the
platform never confirmed, which is the failure INV-M2-13 exists for.

STOP CONDITION
The driver, the pipeline, compensation, the fail-closed assertion, one
registration, 30 of 30, verify exit 0. DO NOT MERGE. E2 read pending.
```

---

### `P3-p`: ADR-023 enrichment, observe mode (session 223, MONEY PATH)

```
Branch: claude/p3p-enrichment-observe   (from origin/main AFTER 213 and 220 merge)
Fence:  packages/enrichment/** (new), packages/enrichment/package.json,
        apps/api/src/routes/checkout.ts (YOUR CALL SITE ONLY),
        docs/decisions/ADR-1NN.md (new), ALLOCATION (your row),
        docs/INDEX.md (your row), docs/STATE.md (append), docs/sessions/.
        TOUCH NOTHING ELSE.
Regime: MONEY PATH by position: it runs inside checkout's transaction. One
        objective. ADR-003 strict. Your session-log number is 223. Allocate your
        ADR number first.

OBJECTIVE
The vendor-agnostic enrichment adapter, its `integration_contracts` row, and
observe mode.

NOTHING IS BLOCKED AND THAT IS THE RULING RATHER THAN A CHOICE. ADR-023's
rollout is graduated and its first step is "Observe mode from launch. Signals
recorded, scored, and reported; NOTHING IS BLOCKED. The purpose is to learn the
distribution on Merit's own traffic." A soft decline is step 3 and it is not
yours. An adapter that can refuse a checkout is outside this fence.

THE VENDOR IS UNSELECTED AND THE CRITERION IS ALREADY RULED. M03 section 7.9.1
makes portability history "a condition of acceptance" rather than a preference.
DO NOT REOPEN THE PROCUREMENT and do not name a vendor anywhere.

`integration_contracts` IS REGISTERED AND IT IS `firm`, so you reach it through
whatever session 213 ruled for a reader with no identity, and NOT by widening
anything yourself.

THE ADAPTER IS NON-BLOCKING IN THE OTHER SENSE TOO. It runs inside checkout's
transaction, so an enrichment call that hangs is a checkout that hangs. Say in
the entry what the timeout is and what happens when it fires, and assert that a
failed enrichment leaves the purchase COMMITTED.

APPROVAL LINE. Unsigned, one checkable clause. Candidate: "an enrichment call
that times out, errors or returns a maximal risk score leaves the checkout
COMMITTED and writes the signal, watched in all three directions." Cost if wrong:
observe mode silently becomes enforcement by outage, which is the "silent
decline" ADR-023's step 3 forbids even when enforcement IS enabled.

STOP CONDITION
One package, one ADR, the contract row, three failure directions asserted,
30 of 30, verify exit 0.
```

---

## 16. Verification

Per session, each a command with an output rather than a claim.

- `node scripts/corpus/gates.mjs check` reports **30 of 30** and `pnpm run verify` exits 0, on every branch,
  before the pull request opens.
- **On `P3-f`:** `packages/db/test/scoped-db.test.ts` is byte-identical to `origin/main`'s, which is the
  mechanical proof the concurrency claim in section 6.1 held.
- **On `P3-g`:** the comparison is watched FAILING on a seeded transcription before it is watched passing, and
  the count of disagreements it found is in the pull-request body whether or not they were repaired.
- **On `P3-h`:** for each of the three pair tables a query for identity A returns every row naming A in either
  column, watched failing on a seeded single-column rule.
- **On `P3-i`:** the aggregate zero-sum property is asserted over generated postings in integer cents, and
  `grep -rn '\.5\|toFixed\|parseFloat' packages/ledger/src` returns nothing.
- **On `P3-j`:** every one of API_CONTRACT section 12's `C-27` rows is asserted in both directions, which is
  P3's fifth done-clause.
- **On `P3-k`:** the same provider event delivered twice produces one business effect and two `200`s.
- **On `P3-l`:** the transactional enqueue is asserted against a real transaction in both directions, which is
  the first time [ADR-006](../decisions/ADR-006.md)'s review criterion has been applied to a caller.
- **On `P3-n`:** a checkout carrying a client-supplied price is charged the server's price, and a failed
  attribution leaves no purchase row.
- **On `P3-o`:** verification fires at the earliest of the two configured triggers, watched with both
  conditions becoming true in either order.
- **On `P3-p`:** a timed-out, errored and maximal-score enrichment each leave the checkout committed.
