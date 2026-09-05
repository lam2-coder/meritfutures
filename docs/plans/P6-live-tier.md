---
status: draft
depends_on:
  [
    ../DELIVERY_PLAN.md,
    M02-rithmic-bridge.md,
    M04-trader-portal.md,
    M06-admin-ops-console.md,
    ../architecture/OVERVIEW.md,
    ../architecture/API_CONTRACT.md,
    ../architecture/EVENTS.md,
    ../architecture/SECURITY.md,
    ../GLOSSARY.md,
    ../ops/runbooks/RB-05-rithmic-sftp-failure.md,
    ../testing/STRATEGY.md,
    ../decisions/ADR-002.md,
    ../decisions/ADR-005.md,
    ../decisions/ADR-020.md,
    ../decisions/ADR-083.md,
    ../decisions/ADR-100.md,
    ../decisions/ADR-125.md,
    ../decisions/ADR-138.md,
    ../decisions/ADR-152.md,
    ../decisions/ADR-154.md,
    P4-portal-and-site.md,
    P5-payouts-and-wallet.md,
  ]
last_updated: 2026-08-27
---

# P6 build: the phase whose subject is a feed, planned against a tree that has the arithmetic and none of the plumbing

**[P3](P3-ledger-billing-identity.md) measured [DELIVERY_PLAN section 4](../DELIVERY_PLAN.md)'s stated
contents against the tree and found none of six existing, on one shared precondition named in no phase's
contents. [P4](P4-portal-and-site.md) ran the identical method and found three artifacts a gate already
probed. [P5](P5-payouts-and-wallet.md) ran it again and found four writes against an accessor that could
not lock. This document runs it on `P6`.**

**Measured at `4b7214e` on 2026-08-27**, with `pnpm install` run first because `pnpm run verify` cannot
typecheck without it. Every figure in section 1 was re-derived by running the command named beside it.

**This document carries ONE ruling of its own**, [ADR-154](../decisions/ADR-154.md), and section 4 is why.
Everything else is cited to the entry or the file that took it, and every ruling this plan needs and may
not take is named for the founder in section 10.

**P6's answer is a third shape and not a repeat of either neighbour.** P4's contents were mostly built and
nobody had said so. P5's contents were mostly absent and blocked behind one file. **P6's contents are
split down the middle by KIND: every piece of tier 2 that is ARITHMETIC or a TYPE already exists and is
tested, and every piece that is a CONTAINER, a TRANSPORT or a STORE exists in no document that can be
built from.** The live Open Liability computes today. The tick type exists today. The socket appears in no
architecture document in this corpus, and the live cache has no medium, no table, no delta and no role.

---

## 1. The tree, measured

| Measurement | Command | Result |
|---|---|---|
| Gates | `node scripts/corpus/gates.mjs check` | **33 of 33 pass** |
| Repository invariants | `node packages/tooling/checks/repo-invariants.mjs` | **11 of 11 hold** |
| Tests | `pnpm vitest run` | **exit 0**, 169 test files, **3,091 passed, 6 skipped** |
| **Routes the API SERVES** | build the server and read `CompositionReport.registered` for each surface | **36 on `public`, 19 on `operator`.** `GET /health` is the one path both register, so the union is **54 distinct `METHOD /path`** over **17 route modules**. Section 5.1 |
| **Routes the API WITHHOLDS** | the same report's `withheld` | **18 on `public`, 35 on `operator`.** That list being non-empty IS the operator 404 ([ADR-083](../decisions/ADR-083.md) section 4), and section 3.2 is why a socket that skips it is a hole rather than a gap |
| **Routes the portal RENDERS** | `pnpm --filter @merit/portal build` | **exit 0**, and Next's own route table prints **12 rows**, one of which is the framework's `/_not-found` |
| **Surfaces** | [`surface.ts:57`](../../apps/api/src/surface.ts) | **`['public', 'operator']`, and the file says why it is closed**: *"a third surface is a ruling, not a value"* |
| **HTTP methods the registry admits** | [`registry.ts:132`](../../apps/api/src/registry.ts) | **`['GET', 'POST', 'PATCH', 'PUT', 'DELETE']`**, and `compose` keys on `METHOD /path`. A socket upgrade is none of them |
| **The adapter's operations** | [`packages/rithmic/src/index.ts`](../../packages/rithmic/src/index.ts) `PlatformAdapter` | **five**: `provision`, `entitle`, `ingestFills`, `ingestEOD`, `reconcile`. **`streamLive` is not among them**, and [`adapter.test.ts`](../../packages/rithmic/test/adapter.test.ts) asserts the key set exactly |
| **The simulator's streaming mode** | [`stream.ts`](../../packages/rithmic/src/simulator/stream.ts) | **BUILT.** `streamRun`, `sampleTicks`, `foldStream`, `LiveAccountTick` with `indicative: true` as a required literal and a per-account-per-day `sequence`. [`stream.test.ts`](../../packages/rithmic/test/stream.test.ts) folds the stream and compares it to the rendered EOD CSV |
| **The live Open Liability** | [`apps/admin/src/live-liability.ts`](../../apps/admin/src/live-liability.ts) | **BUILT, with its suppression and its three tiered terms**, and `authoritative()` refuses the figure by construction. **Its `IndicativeMovement` has no producer** |
| **The tier vocabulary on the portal** | [`view/as-of.ts`](../../apps/portal/src/view/as-of.ts) | **BUILT.** `Tier = 'authoritative' \| 'indicative'` and `Tiered`, and the file states that only `authoritative` is used because *"the indicative layer is ADR-020's socket, which does not exist"* |
| **The word WebSocket under `docs/architecture/`** | `grep -rli websocket docs/architecture/` | **zero files.** Section 3.2 |
| **The live cache in the schema** | `grep -ni 'live\|stream\|tick' packages/db/DELTA_MANIFEST.md` | **no `SD-nn` row, no migration, no table.** Section 3.3 |
| **Database roles** | [`0026_roles_and_grants.sql`](../../packages/db/migrations/0026_roles_and_grants.sql) | **four**, and exactly ONE of them is an application role: `merit_app`, `merit_analytics`, `merit_migrator`, `merit_dispatcher`. Section 3.3 |
| **P6's two named done-gates** | [39-fixture-status-and-blockers](../testing/golden-scenarios/39-fixture-status-and-blockers.md) | `GS-132` and `GS-133`, both `blocked / no-fixture-format`, both reciting that no test file in this tree names them. Section 5.3 |
| **The next free migration number** | `ls packages/db/migrations/*.sql` | `0050`. Section 7 |

---

## 2. P6's six stated contents, against the tree

[DELIVERY_PLAN section 4](../DELIVERY_PLAN.md) gives `P6`, at weeks 11 to 12, *"[ADR-020](../decisions/ADR-020.md)'s
tier 2: streaming ingest through the adapter, the live cache, WebSocket delivery, live portal surfaces,
live Open Liability, degradation and labeling"*, with the done-condition *"GS-132 byte-identical with the
cache poisoned, GS-133 relabeling in the same render as the fallback"*, and the cell ends **"This is the
tradeable phase"**.

| Stated content | State | What exists, and where |
|---|---|---|
| **Streaming ingest through the adapter** | **THE PRODUCER IS BUILT AND THE INTERFACE REFUSES IT** | [`stream.ts`](../../packages/rithmic/src/simulator/stream.ts) emits `LiveAccountTick` and folds byte-identically into the EOD CSV. **`PlatformAdapter` has five operations and `streamLive` is not one**, [GLOSSARY:299](../GLOSSARY.md) enumerates the same five, [OVERVIEW section 3](../architecture/OVERVIEW.md)'s `packages/rithmic` row enumerates the same five, and [`adapter.test.ts`](../../packages/rithmic/test/adapter.test.ts) asserts the key set against OVERVIEW by name. **Adding the method is an edit to two approved documents and is therefore an ADR.** Section 4 |
| **The live cache** | **NOTHING, AND NOT EVEN A MEDIUM** | It is named in [ADR-020](../decisions/ADR-020.md), `INV-M2-14`, [SECURITY](../architecture/SECURITY.md) `C-26`, `INV-M12-01`, `FM-M12-08`, `FM-M13-07`, [RB-05](../ops/runbooks/RB-05-rithmic-sftp-failure.md) and `GS-132`, **always as the object of a GRANT** and never once with a storage medium. There is no `SD-nn`, no migration, no table, no `pgTable`, and no cache service in [OVERVIEW section 3](../architecture/OVERVIEW.md) or [INFRA](../architecture/INFRA.md). Section 3.3 |
| **WebSocket delivery** | **NOTHING, AND IT IS IN NO ARCHITECTURE DOCUMENT AT ALL** | The word occurs in [ADR-020](../decisions/ADR-020.md), [M04](M04-trader-portal.md), [DELIVERY_PLAN](../DELIVERY_PLAN.md) and nowhere under [`docs/architecture/`](../architecture/OVERVIEW.md). **[API_CONTRACT](../architecture/API_CONTRACT.md) specifies HTTP request and response shapes and has no section a socket could be written in.** The registry admits five HTTP methods and keys on `METHOD /path`. Section 3.2 |
| **Live portal surfaces** | **THE LABEL TYPE IS BUILT, THE TRANSPORT IS ASSERTED ABSENT, AND THE SCREEN HAS NO ID** | `Tier` and `Tiered` exist in [`view/as-of.ts`](../../apps/portal/src/view/as-of.ts). **Two live tests fail on the literal string `WebSocket` appearing anywhere under `apps/portal/src`** ([`surface.test.ts:127`](../../apps/portal/test/surface.test.ts), [`payouts-segment.test.ts:75`](../../apps/portal/test/payouts-segment.test.ts)), which is the strongest statement in the tree that the transport is a decision rather than a diff. **And [M04 section 3.1](M04-trader-portal.md)'s screen table has no dashboard row**, while section 3.6 is titled *"The indicative layer on the dashboard"*. Section 10 item 4 |
| **Live Open Liability** | **THE ONLY CONTENT THAT IS BUILT, AND IT IS THE ARITHMETIC AGAIN** | [`live-liability.ts`](../../apps/admin/src/live-liability.ts) computes section 3.5's figure with all three terms tiered separately, suppresses on red data trust with a printed reason, and `authoritative()` throws on the result so a breaker that reaches for it gets a refusal. **What is missing is a producer for `IndicativeMovement`**, which is a feed, a cache and a transport, which is the other five rows of this table |
| **Degradation and labeling** | **THE SHAPE IS RULED AND LANDED ONE PANEL OVER, AND THE LIVE SURFACES CANNOT REACH IT** | [ADR-152](../decisions/ADR-152.md) ruled that a freshness claim is the SERVER's and the client evaluates nothing, and [API_CONTRACT section 6.1](../architecture/API_CONTRACT.md)'s `EconomicCalendarPanelResponse.freshness` is that shape landed. **P6 does not invent the degradation contract; it copies this one.** What is absent is any event, any expectation row and any alarm for a feed that stops. Section 3.4 |

**One content of six is built, one is a type with no transport, and four are absent in a way no module
plan can repair because each is a CONTAINER decision.** That is the inverse of [P4](P4-portal-and-site.md)'s
finding in the same way P5's was, and for a different reason: P4's absences were files, P5's were four
sentences in one file, and **P6's are rows in the architecture.**

### 2.1 Two things the phase cell does not list, and both decide whether P6 is dispatchable at all

| Item | Where it is P6's | State |
|---|---|---|
| **The vendor mechanism, `V-M2-16`** | [ADR-020](../decisions/ADR-020.md) names it in the ruling itself: *"an R\|API+ admin connection, or high-frequency snapshot polling where a stream is unavailable"* | **OPEN, and it is a call output rather than a design decision.** [M02](M02-rithmic-bridge.md) `OQ-M2-05` prices both and recommends *"ship the simulator-backed layer regardless, because the labeling and degradation behavior are the hard parts and neither depends on which mechanism wins"*. **The plan takes that recommendation and section 6 says what it excludes** |
| **[M02](M02-rithmic-bridge.md) is the ONE plan in this corpus that is not `approved`** | Section 3.5 of that document is P6's first stated content in its entirety | **`status: review`, held there by [ADR-005](../decisions/ADR-005.md), which forbids it reaching `approved` while the vendor call is outstanding.** **P6 is the only phase whose first content is specified by an unapproved document**, and section 10 item 5 is what that costs and what it does not |

---

## 3. The precondition, which is that tier 2 has no seam, no container and no store

**P5's precondition was four sentences in one file and a single slice moved it. P6 has no such file.** The
three absences below are in three different registries, they are held by three different owners, and no
one of them unblocks the other two. **That is why P6's wave 1 is four sessions rather than one**, and it
is the honest reading rather than a pessimistic one.

### 3.1 THE SEAM. Tier 1's boundary is an artifact and tier 2 has none

[ADR-020](../decisions/ADR-020.md) rules that tier 2 is *"built against the streaming synthetic
simulator. The real feed plugs in post-agreement, **exactly as the batch pipeline already does**"*, and
[M02 section 3.5](M02-rithmic-bridge.md) rule 4 restates it as *"INV-M2-11's discipline extended to tier
2"*.

**The batch pipeline does it through a FILE, and the corpus says so in three places that agree.**
`INV-M2-11`'s stated enforcement is *"The simulator emits files, not objects ... the simulator writes to
the ingest directory and nothing downstream can tell the difference"*. `GS-084` asserts *"the simulator
writes CSV into the ingest path and no downstream code branches on source"*. And
[`packages/rithmic/src/index.ts`](../../packages/rithmic/src/index.ts) states the consequence in its own
header:

> *"**IT DOES NOT IMPLEMENT `PlatformAdapter`, AND THAT IS THE BOUNDARY RATHER THAN AN OMISSION.**
> `ingestEOD` and `ingestFills` CONSUME files; the simulator PRODUCES them. INV-M2-11 is that simulator
> output and vendor output go through the same parser, which is only true if the simulator stops at the
> file and the adapter starts there. A simulator that satisfied the interface would be a mock at the
> parser boundary, which is the one thing STRATEGY section 2 rejected by name."*

**In streaming mode there is no file, no ingest directory and no parser.** `streamLive` hands its consumer
`LiveAccountTick` objects, and the simulator already produces `LiveAccountTick` objects. **Section 4 is
that contradiction and [ADR-154](../decisions/ADR-154.md) is the ruling.**

### 3.2 THE CONTAINER. The socket has no home, and every place it could go is closed by something landed

| Where it could go | Refused, permitted or undecided | The reason, cited |
|---|---|---|
| **`apps/portal`** | **REFUSED, and by a check that runs** | [`surface.test.ts:127`](../../apps/portal/test/surface.test.ts) walks every `.ts` under `src/` and fails on the literal `WebSocket`, with its own stated reason: *"the fetch layer arrives with the framework. Asserting it now means THE FIRST `fetch` WRITTEN HERE IS A DECISION SOMEBODY MAKES ON PURPOSE rather than one that appears in a diff."* **This plan reads that as an instruction to whoever arrives, not as a wall**, and `P6-h` is the somebody |
| **A rewrite or a middleware on a UI deployable** | **REFUSED TOTALLY** | [ADR-138](../decisions/ADR-138.md) ruling 2 and `RI-11`. `F3` names the cost by hand: *"A portal that wanted to proxy `/api/v1` to the real API for same-origin cookie reasons cannot, and must solve that at the edge instead"* |
| **`apps/api`, through `compose`** | **PERMITTED AND NOT EXPRESSIBLE TODAY** | The registry keys on `METHOD /path` over five HTTP methods. **A socket is not one of them, and the surface split is what produces the operator 404**: [ADR-083](../decisions/ADR-083.md) section 4 makes the 404 the ROUTER's, and a socket registered beside `compose` rather than through it would be served identically by both deployments |
| **A sixth deployable** | **UNDECIDED, and `RI-04` cannot see it** | That check's own `covers` line: *"It also does NOT check that `apps/` holds nothing BEYOND this list, so a sixth application directory added without an entry here is invisible to it, exactly as `apps/api` was"* |
| **A third API surface** | **A RULING, and the file says so** | [`surface.ts:57`](../../apps/api/src/surface.ts): *"Closed, and closed is the point: a third surface is a ruling, not a value"* |

**Nothing here is a deadlock and all of it is a decision somebody has to make in writing.** The plan's
recommendation is in `P6-b`'s row and the slice may refuse it with an argument.

### 3.3 THE STORE. Four documents state a permission over an object with no medium, and one role holds every grant

**Every mention of the live cache in the corpus is a GRANT sentence.**

| Document | The sentence |
|---|---|
| [M02](M02-rithmic-bridge.md) `INV-M2-14` | *"Streaming ingest is **write-only into the live cache** ... it has no grant on `fills`, `raw_ingest_rows`, `daily_marks`, or `rule_states` ... that separation is a permission rather than a convention"* |
| [SECURITY](../architecture/SECURITY.md) `C-26` | *"The indicative realtime layer holds no write grant on any authoritative table"* |
| [M12](M12-transparency-platform.md) `FM-M12-08` | *"The stats worker holds no read grant on the live cache"* |
| [M13](M13-trader-analytics-journal.md) `FM-M13-07` | *"The analytics service holds no read grant on the live cache"* |

**A grant is a Postgres object and [`0026`](../../packages/db/migrations/0026_roles_and_grants.sql) is the
file that creates them.** It creates `merit_app`, `merit_analytics`, `merit_migrator` and
`merit_dispatcher`, and **exactly one of those is an application role**: `merit_app` holds `SELECT,
INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public`, plus a `DEFAULT PRIVILEGES` clause granting the
same on every table any later migration creates.

**So the separation cannot be expressed by adding a table, and it moves in the wrong direction if
somebody tries.** The stats run is [`apps/worker/src/batch/statistics.ts`](../../apps/worker/src/batch/statistics.ts)
and it runs as `merit_app`. A streaming ingest process would run as `merit_app`. **A live-cache table
created tomorrow is readable and writable by the same role that writes `fills`, automatically, by a
default-privileges clause in a merged migration that may never be edited** (constitution E2).

**The repair is a fifth role and it is a migration and a ruling**, which is section 10 item 1. **It is
recorded here rather than designed**, on [ADR-124](../decisions/ADR-124.md)'s precedent one phase over: a
plan names what a mechanism needs and refuses to write the storage.

**And the medium is not settled either.** [OVERVIEW section 3](../architecture/OVERVIEW.md) rejected a
second stateful service once already, in writing, for the queue: *"pg-boss (Postgres-only) rather than
BullMQ plus Redis: one fewer stateful service to back up, restore, and reason about, and the job store
participates in the same transactions and the same PITR as the money data."* **A live cache is a second
stateful service if it is Redis and a table if it is not**, and the argument that rejected Redis for the
queue is not obviously the argument for a cache whose entire content is discardable by design.

### 3.4 THE ABSENCE THAT IS DETECTED BY NOTHING HAPPENING, and the corpus has solved its shape twice

[M02 section 3.5](M02-rithmic-bridge.md) rule 3: *"Feed loss is a first-class state, not an error."*
[RB-05](../ops/runbooks/RB-05-rithmic-sftp-failure.md) step 1 tells an operator to *"Confirm every live
surface fell back and relabeled in the same render"*. **Nothing emits and nothing alarms.**

[EVENTS](../architecture/EVENTS.md) carries an `ingest.*` family including `ingest.file_late`, and no
`feed.*` family at all. **And its universal delivery rule cannot express feed loss as written**: *"Events
are written in the same transaction as the state change that caused them, so an event exists if and only
if the fact does."* **A feed that stops has no state change and opens no transaction.**

**The shape is not new and the corpus has answered it twice.** `report_deliveries.due_at` exists because
*"absence is only detectable against an expectation"*, and `economic_calendar_loads`' coverage bound
exists because an uncovered week and a quiet week produce the same empty list. **The live feed has no
expectation row of either kind**, and `P6-f` is where one is written.

### 3.5 What P6 does NOT need, measured rather than assumed

**Three things a reader would expect to be P6's preconditions are already discharged**, and saying so is
what stops the wave from being longer than the work.

| Expected precondition | Actually |
|---|---|
| **A fixture-format ruling, as P5 needed** | **NO.** [ADR-125](../decisions/ADR-125.md) clause 2 already ruled that `no-fixture-format`'s stated reason is refuted by seven counterexamples and that *"the blocker that survives is the absent code"*. **`GS-132` and `GS-133` are blocked on P6's own code and on nothing else**, which is the exact inverse of [P5 section 10](P5-payouts-and-wallet.md) item 2 |
| **A route registry change, as `ADR-100` was for P5** | **NO for HTTP and YES for the socket.** Every HTTP route P6 adds is a new file under [`apps/api/src/routes/`](../../apps/api/src/routes/health.ts) and merges in any order. **Only the socket needs the registry to learn a shape**, and that is one slice, `P6-g` |
| **The accessor learning a predicate, as `P5-a` was** | **NOT KNOWN UNTIL THE STORE IS RULED, and it is named rather than assumed.** If the live cache is a Postgres table, a read over it is an equality filter on `account_id` and [`scoped-db.ts`](../../packages/db/src/scoped-db.ts) already serves that. **If it needs an expiry sweep it needs `P5-a`'s range term**, and `P5-a` is not landed. Section 9 rows the dependency |

---

## 4. THE CONTRADICTION, and it is ruled in [ADR-154](../decisions/ADR-154.md)

**[ADR-020](../decisions/ADR-020.md) rules that the real feed plugs in *"exactly as the batch pipeline
already does"*. The batch pipeline's mechanism is a FILE, and tier 2 has no file.**

The corpus states both halves correctly and neither is wrong:

- **`INV-M2-11` rests on an artifact.** *"The simulator emits files, not objects."* `GS-084` asserts *"no
  downstream code branches on source"*, and that property is purchasable only because both sources write
  into one directory and one parser reads it.
- **`streamLive` has no artifact.** [M02 section 3.5](M02-rithmic-bridge.md)'s signature is
  `streamLive(handler: (tick: LiveAccountTick) => void)`, and [`stream.ts`](../../packages/rithmic/src/simulator/stream.ts)
  already produces `LiveAccountTick` values. Between the wire and the tick there is the adapter and
  nothing else, because absorbing the mechanism difference IS the adapter's job in tier 2.

**So the two available readings are each refused by a landed document.**

| Reading | Refused by |
|---|---|
| **The simulator implements `streamLive`** | [`packages/rithmic/src/index.ts`](../../packages/rithmic/src/index.ts): *"A simulator that satisfied the interface would be a mock at the parser boundary, which is the one thing STRATEGY section 2 rejected by name."* [STRATEGY section 2](../testing/STRATEGY.md) rejects *"any mock at the parser boundary"* |
| **The simulator does not, and the live consumer is written twice** | `GS-084`'s property, and [M02 section 3.5](M02-rithmic-bridge.md) rule 4's own claim that this is *"INV-M2-11's discipline extended to tier 2"*. Two code paths is what that discipline exists to prevent |

**And the definitional sentence [ADR-020](../decisions/ADR-020.md) itself links to is the one that
breaks.** Its tier 2 clause links the words *"platform adapter"* to [GLOSSARY:298](../GLOSSARY.md), whose
body reads *"The interface (`provision`, `entitle`, `ingestFills`, `ingestEOD`, `reconcile`) that isolates
all platform specifics. v1 ships one implementation (Rithmic)."* **Both clauses of that definition are
edited by the ruling ADR-020 needs**, and the GLOSSARY is `approved`.

[ADR-154](../decisions/ADR-154.md) rules that **the simulator implements `streamLive` and the shared thing
moves from the ARTIFACT to the TYPE**, refuses to extend that to any other operation, and states what
replaces `GS-084`'s property for tier 2, which is a conformance assertion over every implementation rather
than a claim that no consumer branches on source. **It refuses to design the cache, the container and the
socket**, all three of which are section 10's, on the same ground [ADR-124](../decisions/ADR-124.md) used:
a plan names what a mechanism needs and the migration is not a plan's to write.

---

## 5. Four claims checked against their sources, and two did not survive

**The dispatch brief that commissioned this session says outright that a dispatch prompt is not a source
and that six of its own claims were false today.** These four were re-derived.

### 5.1 The route figure is right about the union and wrong about any surface

**The brief says the API *"serves 54 registered routes across a `public` and an `operator` surface"* and
tells this session to build the server rather than grep, because two greps got it wrong.** Built:

| Surface | `registered` | `withheld` |
|---|---|---|
| `public` | **36** | 18 |
| `operator` | **19** | 35 |

**54 is the union and no surface registers it.** 36 plus 19 is 55, and `GET /health` is registered by
both, which [`surface.ts:81`](../../apps/api/src/surface.ts) explains as deliberate: a constant response
*"discloses nothing the origin's own reachability does not already disclose"*. **The correction matters
to P6 specifically**, because the number a live surface has to reason about is not the union: the trader's
socket is served by the deployment that registers 36 and the founder's by the deployment that registers
19, and **the `withheld` list is the whole of `ADR-083`'s 404.** Section 3.2's fourth row.

### 5.2 The portal figure is exactly right and one row of it is the framework's

`pnpm --filter @merit/portal build` exits **0** and prints **12 rows**. One is `/_not-found`, which Next
generates. **The brief's *"12 routes"* is what the build prints and this plan uses the same number**,
with the composition stated so a later reader does not re-derive eleven and think something moved.

### 5.3 P6's done-gates are NOT waiting on a fixture ruling, and P5's were

**The brief calls the two gates *"unusually sharp"* and it is right, and the sharper fact is that they are
already unblocked in the one direction that blocked P5's.** Both rows read `blocked / no-fixture-format`,
and [ADR-125](../decisions/ADR-125.md) clause 2 rules that term's corpus-wide reason FALSE:

> *"the condition `no-fixture-format` names, W2, is not the condition that would still hold if every other
> were cleared ... **The blocker that survives is the absent code**, and the term for it is the one that
> was refused."*

**So `GS-132` and `GS-133` clear when P6 writes them and need no term ruled first.** [P5 section 10](P5-payouts-and-wallet.md)
item 2 could not say that about a single one of its four clauses. **`GS-133` additionally has a second
home**: it is path 9 of [STRATEGY section 3.5](../testing/STRATEGY.md)'s ten unhappy D0 paths, *"Live
dashboard under feed loss"*, and `e2e/` holds no Playwright spec of any kind. **That half is P8's and is
named in section 6 rather than claimed.**

### 5.4 `GS-132` as written asserts something two green invariants already guarantee, and the assertion worth running is one layer out

**`GS-132`'s registry text**: *"The live cache is populated with values that would flip eligibility, a
breach, and a payout clamp. The engine's output is asserted **byte-identical** to the run without the
cache, because it never reads it."*

**The engine cannot read a cache of any kind today, and two checks in `pnpm run verify` say so on every
run.** `RI-01`: *"packages/rules-engine declares no workspace dependencies, in any dependency field"*.
`RI-07`: *"packages/rules-engine's transitive module graph reaches no Node builtin"*. **A pure fold over
values that cannot reach a socket, a file or a client will be byte-identical under any cache state,
including one that does not exist.**

**That does not make the scenario worthless; it makes its subject the CALLER.** The reachable failure is
not the engine reading a tick, it is the nightly batch assembling the engine's INPUTS from one. **So the
assertion that can fail is over `apps/worker`'s input assembly and over the grant boundary section 3.3
says cannot currently be expressed**, and `P6-k`'s row says so rather than leaving whoever writes the
fixture to discover that a green test proves an invariant it never exercised. **This is the "control that
exists and enforces nothing" class this corpus has now found roughly twenty times**, caught before the
control is written rather than after.

---

## 6. What P6 is NOT

| Not P6 | Whose | Why the boundary is here |
|---|---|---|
| **The vendor mechanism, `V-M2-16`** | The Rithmic call, [ADR-005](../decisions/ADR-005.md) | [M02](M02-rithmic-bridge.md) `OQ-M2-05`: *"ship the simulator-backed layer regardless, because the labeling and degradation behavior are the hard parts and neither depends on which mechanism wins."* **P6 ships against the simulator and no slice writes a vendor client** |
| **`GS-133` as a Playwright path** | P8's D0 battery | It is path 9 of [STRATEGY section 3.5](../testing/STRATEGY.md)'s ten, `e2e/` holds no spec, and standing one up is a phase's worth of harness rather than a slice's |
| **Any change to tier 1** | [ADR-002](../decisions/ADR-002.md), P2, landed | **`INV-M2-14` is the whole safety argument and no P6 slice may reconcile a tick into anything the engine reads.** `P6-f`'s prompt forecloses it and every later prompt repeats the foreclosure |
| **The payout centre and the wallet** | P5 | `INV-M4-13`: *"No indicative value is ever an input to a request the portal sends."* [M04 section 3.6](M04-trader-portal.md): *"The socket could be entirely down and the payout path would be unaffected, which is the property that makes shipping tier 2 safe at all"* |
| **`liability_snapshots`** | P5's `P5-l` and session 240's `OI-01` | [M06 section 3.5](M06-admin-ops-console.md): *"No liability snapshot is written from it. `liability_snapshots` remains a daily materialized row from closed data."* `P6-j` reads a live figure and writes nothing |
| **The portal's API client for HTTP** | P4's remaining work and P5's route slices | [`source.ts`](../../apps/portal/src/app/payouts/source.ts) names the five decisions it needs and says *"this segment is not that somebody"*. **`P6-h` writes the SOCKET client and inherits the base URL and session policy from the HTTP client rather than inventing a second one**, which is why the row depends on it |
| **The `events` feed table** | P5's `P5-n` | `P6-f` may need an event NAME in the catalogue and it does not need the feed's producer |

---

## 7. The registries this plan CANNOT spend

**Same rule as [P4 section 7](P4-portal-and-site.md) and [P5 section 7](P5-payouts-and-wallet.md).**

| Registry | State | Why this plan does not claim |
|---|---|---|
| **ADR numbers** | `154` is this session's and is AMENDED IN PLACE, per [ADR-065](../decisions/ADR-065.md) T3. **`155` and `156` are sessions 266 and 267's**, both dispatched beside this one | **The next free number is not derivable from a document that is being written concurrently by two other sessions.** `P6-b`, `P6-c`, `P6-d` and `P6-g` each need one and section 12 requires them allocated in one pre-dispatch commit |
| **Migration numbers** | `0050` is the next free one on this tree and **no session is holding it that this branch can see** | `P6-c` needs one. **A number claimed by a plan is a number claimed twice**, and [ALLOCATION](../decisions/ALLOCATION.md) is the table `CI-06w` reads as a multiset |
| **`SD-nn` schema deltas** | The live cache has none | **A delta identifier is claimed by its [DELTA_MANIFEST](../../packages/db/DELTA_MANIFEST.md) row existing**, and [ADR-026](../decisions/ADR-026.md)'s gate requires that row for every `SD-` identifier appearing under `docs/`. **So this plan may not even NAME one**, which is why section 8 says *"an `SD-nn`"* and no more |
| **`SC-M4-nn` screen ids** | The dashboard has no row in [M04 section 3.1](M04-trader-portal.md) | **There is no allocation table for `SC-M4-nn` and [M04](M04-trader-portal.md) is `approved`**, so adding a row is an ADR. Section 10 item 4 |
| **`SystemReason` and `SqlExecutorReason`** | Closed vocabularies in [`scoped-db.ts`](../../packages/db/src/scoped-db.ts) | **Named here so no P6 slice takes one silently.** A streaming ingest process writing through the accessor needs a system authority and **it must NAME the need rather than add a member**, which is [P5 section 11](P5-payouts-and-wallet.md) rule 10 applied to this phase |
| **`API_SURFACES` and `HTTP_METHODS`** | Closed at two and five | **`P6-g` may widen one of them and must argue for it in an ADR**, on the ground [`surface.ts:57`](../../apps/api/src/surface.ts) states about itself. **No other slice may touch either** |
| **The admin origin** | `ADMIN_ORIGIN`, never written into this repository ([ADR-012](../decisions/ADR-012.md), [INFRA section 13.2](../architecture/INFRA.md)) | `P6-j` serves a live figure to a separate apex domain and **may not write a hostname anywhere.** [`origin.ts`](../../apps/admin/src/origin.ts) resolves it and stays the only place that does |

---

## 8. The wave

**Fences are by file. Section 9 is the per-file collision table and it is the one to read.**

### Wave 1: the four preconditions, and NONE of them is code

**Every one is an edit to an approved or frozen document, so every one is an ADR rather than a commit.
Three of the four are concurrent.**

| # | Slice | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **`P6-a`** | **The adapter learns `streamLive`, and the seam moves from the artifact to the type.** [ADR-154](../decisions/ADR-154.md) is the ruling and this slice IMPLEMENTS it: the method on `PlatformAdapter`, the simulator satisfying it, the GLOSSARY definition and [OVERVIEW section 3](../architecture/OVERVIEW.md)'s `packages/rithmic` row amended to match, and the conformance assertion that replaces `GS-084`'s property for tier 2. **It may NOT implement any other operation** and its ADR already forecloses the argument | `packages/rithmic/src/index.ts`, `packages/rithmic/src/simulator/stream.ts`, `packages/rithmic/test/adapter.test.ts`, `packages/rithmic/test/stream-conformance.test.ts` (new), `docs/GLOSSARY.md` (**the `platform adapter` entry ONLY**), `docs/architecture/OVERVIEW.md` (**section 3's `packages/rithmic` row ONLY**), `STATE` (append), `sessions/` | no by file. **It is the tier boundary and it is worth a founder read anyway** | **[ADR-154](../decisions/ADR-154.md), landed.** Nothing else. **IT GOES FIRST** |
| **`P6-b`** | **The live tier enters the container diagram and the service list, which is where the socket gets an address.** [OVERVIEW section 2](../architecture/OVERVIEW.md)'s diagram gains the streaming arrow and the live tier; section 3's table gains its row or rows; [INFRA](../architecture/INFRA.md) section 2.1 gains its service. **The recommendation is `apps/api` on both surfaces rather than a sixth deployable**, on `ADR-083`'s ground that the 404 is the router's, and **the slice may refuse it with an argument** | `docs/decisions/ADR-1NN.md` (new, **REQUIRED**), `docs/architecture/OVERVIEW.md` (**sections 2 and 3, excluding the `packages/rithmic` row**), `docs/architecture/INFRA.md` (**section 2.1 only**), `ALLOCATION` (its row), `STATE` (append), `sessions/` | no code | **an ADR number.** SERIAL behind `P6-a` on `OVERVIEW`, section 9 |
| **`P6-c`** | **The live cache: its medium, its role, and the grant that makes `INV-M2-14` structural.** Section 3.3. A fifth role, the table or the refusal to make it one, the `SD-nn`, the migration, the design record. **`0026`'s `DEFAULT PRIVILEGES` clause is the thing to read first**, because it grants `merit_app` the whole of any new table by default and the invariant needs the opposite | `packages/db/migrations/00NN_*.sql` (new), `packages/db/DELTA_MANIFEST.md` (its delta row), `docs/architecture/data-model/<table>.md` (new), `packages/db/src/schema.ts`, `packages/db/src/scope.ts`, `docs/decisions/ADR-1NN.md` (new, **REQUIRED**), `ALLOCATION` (its row and its migration row), `INDEX` (the design record's row), `STATE` (append), `sessions/` | **YES. E2 READ.** It changes the grant model, and the grant model is what `C-26` calls *"structurally impossible rather than defended"* | **a migration number and an `SD-nn`**, both in the pre-dispatch commit; **section 10 item 1 answered.** Concurrent with `P6-a`, `P6-b` and `P6-d` |
| **`P6-d`** | **The contract acquires the live surface and its degradation shape.** [API_CONTRACT section 6.1](../architecture/API_CONTRACT.md) gains the trader's live rows and section 8 gains the operator's, **copying `EconomicCalendarPanelResponse.freshness`'s idiom rather than inventing one**: the server states staleness, the client evaluates nothing, per [ADR-152](../decisions/ADR-152.md) clause 1. **It may NOT renumber section 12**, which is 6.1's own stated reason for being a subsection | `docs/decisions/ADR-1NN.md` (new, **REQUIRED**), `docs/architecture/API_CONTRACT.md` (**sections 6.1 and 8 only**), `docs/architecture/EVENTS.md` (**the feed family, section 3.4**), `ALLOCATION` (its row), `STATE` (append), `sessions/` | money by content, **no code** | **an ADR number.** Concurrent |

### Wave 2: the ingest and the transport. Two sessions, disjoint by file

| # | Slice | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **`P6-f`** | **The streaming ingest, write-only into the cache, plus the expectation row feed loss is detected against.** It consumes `P6-a`'s `streamLive`, writes `P6-c`'s cache and nothing else, and **carries `INV-M2-14`'s foreclosure in its own header**: no import of `fills`, `raw_ingest_rows`, `daily_marks` or `rule_states`, and a test that asserts the absence rather than the intention. Section 3.4's expectation row is this slice's, on `report_deliveries.due_at`'s shape | `apps/worker/src/live/ingest.ts` (new), `apps/worker/src/live/ports.ts` (new), `apps/worker/test/live-ingest.test.ts` (new), `apps/worker/src/index.ts`, `docs/ops/runbooks/CRON_INVENTORY.md` (**the feed-health row only**), `STATE` (append), `sessions/` | **YES by content and NO by file.** It writes nothing the engine reads, which is the entire point, and that is the claim its test has to earn | **`P6-a`**, **`P6-c`**, **`P6-d`** for the event names |
| **`P6-g`** | **The socket surface, and the registry learning a shape that is not an HTTP method.** `apps/api` serves it, the surface split withholds the operator socket from the public deployment exactly as `compose` withholds a path, and the `@fastify/websocket` admission is a **`VG-12` approval on `pnpm-workspace.yaml`'s catalog block** rather than a line in a manifest. **It is the one slice permitted to touch `HTTP_METHODS` or `API_SURFACES`, and its ADR states which it moved and why the other was not** | `apps/api/src/registry.ts`, `apps/api/src/surface.ts`, `apps/api/src/live.ts` (new), `apps/api/test/registry.test.ts`, `apps/api/test/surface.test.ts`, `apps/api/test/live.test.ts` (new), `apps/api/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `docs/decisions/ADR-1NN.md` (new, **REQUIRED**), `ALLOCATION` (its row), `STATE` (append), `sessions/` | **YES.** The registry is what produces the operator 404 and a socket that skips it serves the founder's numbers on the public origin | **`P6-b`** for the address, **`P6-d`** for the contract, **an ADR number**. **A `VG-12` admission is a human approval and is not a session's to grant** |

### Wave 3: the surfaces. Four sessions, and three of them are concurrent

| # | Slice | Fence, by file | Money | Depends on, by file |
|---|---|---|---|---|
| **`P6-h`** | **The portal's socket client, and the two assertions that refuse it today.** [`surface.test.ts`](../../apps/portal/test/surface.test.ts) and [`payouts-segment.test.ts`](../../apps/portal/test/payouts-segment.test.ts) both fail on the literal `WebSocket`, and **this slice OWNS converting them from "no transport" into "transport in one named file"** rather than deleting the needle. **It must close the `.ts`-only hole in the same change**: both walkers read `.ts` and skip `.tsx`, [ADR-138](../decisions/ADR-138.md) section 6 item 1 already records that `.tsx` is outside every `merit/*` lint glob and the formatter's, and **P6's live components are the first files in this repository with a real reason to be `.tsx`** | `apps/portal/src/live/client.ts` (new), `apps/portal/src/live/ports.ts` (new), `apps/portal/test/surface.test.ts`, `apps/portal/test/payouts-segment.test.ts`, `apps/portal/test/live-client.test.ts` (new), `apps/portal/src/index.ts`, `STATE` (append), `sessions/` | no by file | **`P6-g`**; the portal's HTTP client, section 6 |
| **`P6-i`** | **The live dashboard elements, `INV-M4-11` and `INV-M4-12`, and `GS-133`.** The tier prop is required and already typed; **what is new is that the fallback and the relabel are ONE render**, which is what the gate says and is the thing a two-render implementation passes a careless test with. The assertion is written **over the rendered bytes**, which is [session 261](../sessions/2026-08-27-session-261.md)'s lesson: a value reaches a page through an `alt`, a `title` or an error string without appearing in a visible field | `apps/portal/src/view/live.ts` (new), `apps/portal/src/view/as-of.ts`, `apps/portal/src/app/<dashboard>/**` (new), `apps/portal/test/live-render.test.ts` (new), `STATE` (append), `sessions/` | **YES by content.** Projected floor distance is [M04 section 3.6](M04-trader-portal.md)'s named hazard: *"a trader who reads it as authoritative and keeps trading has lost an account"* | **`P6-h`**; **section 10 item 4**, which decides what the segment is called |
| **`P6-j`** | **The live Open Liability gains a producer, and the arithmetic is not rewritten.** [`live-liability.ts`](../../apps/admin/src/live-liability.ts) already computes it, suppresses it on red data trust and refuses it to `authoritative()`. **What this slice adds is an `IndicativeMovement` with a real `asOfInstant` and a named `feed`**, and the route that serves it. **`INV-M6-12`'s no-breaker clause is asserted rather than assumed** | `apps/api/src/routes/admin-live-liability.ts` (new), `apps/api/test/admin-live-liability.test.ts` (new), `apps/admin/src/live-liability.ts`, `apps/admin/src/page.ts`, `apps/admin/test/live-liability.test.ts`, `STATE` (append), `sessions/` | **YES by content**, no ledger write | **`P6-c`**, **`P6-d`**, **`P6-g`**. **NOT `P5-l`**: that slice renders the authoritative figure and this one renders the live term beside it |
| **`P6-k`** | **`GS-132`, written where it can fail.** Section 5.4. The engine's byte-identity is guaranteed by `RI-01` and `RI-07` and asserting it again buys nothing; **the assertion that can fail is over the batch's INPUT ASSEMBLY and over `P6-c`'s grant boundary**, and this slice states that in the test body rather than only here | `packages/harness/**` or `apps/worker/test/` (**one of the two, chosen by where the batch's inputs are assembled and stated in the pull request**), `docs/testing/golden-scenarios/39-fixture-status-and-blockers.md` (**the `GS-132` row only**), `STATE` (append), `sessions/` | **YES.** It is the assertion behind the hard rule | **`P6-c`**, **`P6-f`** |

### Wave 4: NOT DISPATCHED, and each absence is a decision

- **`GS-133` as a Playwright path.** Section 6. It is P8's D0 battery and `e2e/` holds no spec.
- **The vendor client.** `V-M2-16` is unanswered and [M02](M02-rithmic-bridge.md) `OQ-M2-05` recommends
  shipping without it. **Fencing a slice against a mechanism nobody has chosen would be
  [WAVE-05](WAVE-05-tier2-fixture-shapes.md)'s defect**: a fence over files a ruling has not made possible.
- **The live win-day and consistency tracking.** [M04 section 3.6](M04-trader-portal.md) rows it as
  indicative, **and what makes it indicative is a projection of a rule the engine owns**, which is a
  design this plan cannot take from any document. Section 10 item 3.

---

## 9. The collisions, BY FILE

**A depends-on column reads per item and collisions are per file.** Every file held by more than one
slice, or by a slice and a session already in flight.

| File | Held by | Why it collides, and the resolution |
|---|---|---|
| **[`docs/architecture/OVERVIEW.md`](../architecture/OVERVIEW.md)** | **`P6-a`** (section 3's `packages/rithmic` row), **`P6-b`** (section 2's diagram and section 3's table) | **SERIAL, `P6-a` then `P6-b`, and it is the collision this plan is most confident a careless split would miss.** Both edit section 3's table; `P6-a` amends one existing row and `P6-b` adds rows. **A keep-both merge produces a container table with two `packages/rithmic` rows**, which is `CI-06u`'s finding and is the table-corruption class that once passed every gate in this repository |
| **[`packages/rithmic/src/simulator/stream.ts`](../../packages/rithmic/src/simulator/stream.ts)** | **`P6-a`** only | One slice. **Rowed anyway because the temptation is `P6-f`'s**: an ingest slice that needs a tick shape it does not have will add it here rather than report it, and `P6-f`'s prompt forecloses that |
| **[`packages/db/src/schema.ts`](../../packages/db/src/schema.ts)** and **[`scope.ts`](../../packages/db/src/scope.ts)** | **`P6-c`**, and every module measurement in the estate | **RULED, by [ADR-092](../decisions/ADR-092.md) section 2**: the owner is the TABLE, the registration is not re-argued and the queue is the TYPE CHECKER. P6 registers one table set and it is disjoint from every other |
| **[`apps/api/src/registry.ts`](../../apps/api/src/registry.ts)** and **[`surface.ts`](../../apps/api/src/surface.ts)** | **`P6-g`** only, **and every route slice in the estate depends on both** | **ONE SLICE HOLDS THEM AND THAT IS THE POINT.** These two files are `ADR-100`'s return: a route module is a directory listing entry and merges in any order **only because nothing else touches the registry**. `P6-g` is the phase's `P5-a`, one file set with everything behind it, and **the risk is not a merge conflict, it is a later slice reaching around it** by registering a socket beside `compose` |
| **[`apps/api/src/routes/`](../../apps/api/src/routes/health.ts)** | **`P6-j`** adds ONE new file, and P5's route slices add several | **NOT A COLLISION**, and that is [ADR-100](../decisions/ADR-100.md)'s whole return. `compose` refuses a duplicate `METHOD /path` across the module set at startup, so the one collision many concurrent route slices actually make is caught rather than merged |
| **[`apps/portal/test/surface.test.ts`](../../apps/portal/test/surface.test.ts)** | **`P6-h`**, and **six concurrent portal sessions** | **THE HOTTEST FILE IN `apps/portal` AND THE ONE `P6-h` MUST EDIT.** [Session 263](../sessions/2026-08-27-session-263.md) recorded it as *"contended by six concurrent portal sessions and was not taken"*. `P6-h` cannot decline it: the transport assertion lives there and this is the slice that changes what it asserts. **`git fetch origin main` immediately before touching it** |
| **[`apps/portal/src/view/as-of.ts`](../../apps/portal/src/view/as-of.ts)** | **`P6-i`**, and every portal screen through the types it exports | **SMALL AND EASY TO GET WRONG.** `Tier` and `Tiered` are declared and unused on the indicative arm. **`P6-i` adds usage and must not restate the type**, because a second `Tier` union in a live view module is the drift `INV-M4-11`'s compile-time enforcement exists to prevent |
| **[`apps/admin/src/live-liability.ts`](../../apps/admin/src/live-liability.ts)** | **`P6-j`**, and **`P5-l`** on `liability.ts` and `page.ts` beside it | **SERIAL WITH `P5-l` ON `page.ts` AND DISJOINT EVERYWHERE ELSE.** `P5-l` gives the authoritative figure a data source; `P6-j` gives the live term one. **[M06 section 3.5](M06-admin-ops-console.md) requires both on the page at once**, *"two numbers, both labeled, is the entire design"*, so the order is `P5-l` then `P6-j` and a keep-both merge on `page.ts` renders one of them twice |
| **[`docs/architecture/API_CONTRACT.md`](../architecture/API_CONTRACT.md)** | **`P6-d`**, and cross-phase **`P5-c`**, **[ADR-153](../decisions/ADR-153.md)** and several module slices | **STILL THE HOTTEST CROSS-PHASE FILE IN THE CORPUS**, and [P4 section 10](P4-portal-and-site.md) item 2 and [P5 section 9](P5-payouts-and-wallet.md) both left it unresolved. **P6 does not resolve it either**; it holds the file for one slice and takes its rows in one commit. **The section-12 renumbering hazard is new and is stated in `P6-d`'s fence**, because 6.1 exists precisely to avoid it |
| **[`docs/ops/runbooks/CRON_INVENTORY.md`](../ops/runbooks/CRON_INVENTORY.md)** | **`P6-f`**, and cross-phase **`P5-j`** and **`P5-k`** | Three slices, one file, no textual overlap and **still serial**, on `CI-06l`'s reading of the release-job table as a whole |
| **[`pnpm-workspace.yaml`](../../pnpm-workspace.yaml)** and **`pnpm-lock.yaml`** | **`P6-g`** | **A `VG-12` ADMISSION, WHICH IS A HUMAN APPROVAL AND NOT A MERGE.** [P4 wave 1](P4-portal-and-site.md) paid for this serialization once and the lesson stands: the lockfile is the file every dependency slice in the estate contends for |
| **[`docs/decisions/ALLOCATION.md`](../decisions/ALLOCATION.md)** | **`P6-b`, `P6-c`, `P6-d`, `P6-g`** | **Four of eleven**, plus the migration number. `CI-06w` reads the table as a multiset, so **one commit claims all four numbers and the migration number before any slice runs.** An expected collision costs a resolution; a discovered one costs a cycle |
| **[`docs/sessions/README.md`](../sessions/README.md)** | every slice, and every session in the tree | The `session_entries` span is generated under [ADR-088](../decisions/ADR-088.md) and merges by re-running `node scripts/corpus/gates.mjs generate`. **The CLAIM table above it is not generated** and every slice strikes one row |

---

## 10. What could not be determined, named rather than guessed

**Five items. The first three go to the founder rather than to a session, and `P6-c` cannot start without
the first.**

1. **What the live cache is stored in, and which role separates it.** Section 3.3. Four documents state a
   grant over an object with no medium, and [`0026`](../../packages/db/migrations/0026_roles_and_grants.sql)
   grants `merit_app` the whole of every future table by default, so **the separation gets further away
   when a table is added rather than closer.** Three readings are available and this plan takes none: a
   Postgres table plus a fifth role; a process-local store in the socket server, which makes `GS-132`'s
   poisoning step untestable from outside; or a second stateful service, which
   [OVERVIEW section 3](../architecture/OVERVIEW.md) rejected in writing for the queue on a reason that may
   or may not reach a discardable cache. **It is a migration and a ruling.**

2. **Where the socket lives, and whether that costs a closed vocabulary.** Section 3.2. Every candidate is
   closed by something landed or invisible to the check that should see it, and the two vocabularies in
   play, `API_SURFACES` and `HTTP_METHODS`, are each closed with a stated reason. **`P6-b` and `P6-g` split
   the question into an address and a mechanism**, and both need a founder's eye because the failing
   direction is that the founder's numbers get served on the public origin by a route
   [ADR-083](../decisions/ADR-083.md)'s 404 never saw.

3. **What "live win-day and consistency tracking" is a projection OF.** [M04 section 3.6](M04-trader-portal.md)
   requires *"on track / not on track today", never "you have 3 win days"*, which is a statement about a
   rule the engine owns evaluated against data the engine may never read. **No document says how the
   projection is computed**, and the two obvious readings differ in a way that matters: re-implementing
   the win-day predicate outside the engine is a second source of truth for a gate, and calling the engine
   with a synthetic day assembled from ticks is `INV-M2-14`'s boundary crossed in the one direction that
   type-checks. **It is a ruling and `P6-i` should not have to invent it.**

4. **What the dashboard IS.** [M04 section 3.1](M04-trader-portal.md) rows eleven screens and none of them
   is a dashboard, while section 3.6 is titled *"The indicative layer on the dashboard"* and section 3.8
   places the economic-calendar panel *"on the dashboard beside section 3.6's indicative layer, **not a
   twelfth screen**, so section 3.1's table does not move"*. **So two sections put panels on a surface the
   screen table does not carry.** The portal's route table has `/accounts`, `/calendar` and no dashboard.
   **This is small, it is cheap, and it decides the path `P6-i` writes files under**, which is why it is
   here rather than left for that session to pick.

5. **Whether P6 may be planned in detail against a document held at `review`.** Section 2.1.
   [M02](M02-rithmic-bridge.md) is the one plan in the corpus that is not `approved`, held there by
   [ADR-005](../decisions/ADR-005.md) *"pending the Rithmic vendor call"*, and **section 3.5 of it is P6's
   first stated content in its entirety.** This is recorded rather than treated as a blocker, on M02's own
   amendment note: *"Nothing about the wire format, the parser, the ingest path or the streaming layer
   moves"* under the provisional legs. **The honest statement is that P6's shape is stable and its tick
   payload is not**, and [`stream.ts`](../../packages/rithmic/src/simulator/stream.ts)'s header already
   says which two things a mechanism decides and that a polled shape is expressible today. **A sentence
   somebody owes, and it is not a session's to write.**

---

## 11. The rules every prompt carries, written once here

These are [P5 section 11](P5-payouts-and-wallet.md)'s, unchanged where they held and amended where P6's
measurement paid for an amendment.

1. **The session-log stub is the first commit.** Write `docs/sessions/<date>-session-<N>.md` with the
   objective and `placeholder` for every other field, strike your row in
   [sessions/README](../sessions/README.md), commit, push. **Then do the work.**
2. **Your log MUST carry an `<!--index: ... -->` line** under its `##` heading, and
   `node scripts/corpus/gates.mjs generate` is part of writing a log rather than an optional tidy-up
   ([ADR-088](../decisions/ADR-088.md)). **Commit the regeneration**: running it is not the control.
3. **`git fetch origin main` immediately before asserting anything about a registry**, and before touching
   [`surface.test.ts`](../../apps/portal/test/surface.test.ts), which six sessions contend for.
4. **Commit and push after each file.** Not at the end.
5. **The fence is absolute.** If the work needs a file outside it, **stop and report it in the pull-request
   body** rather than reaching.
6. **[STATE](../STATE.md): append one `##` section at the END.** Edit no existing line.
7. **Your ADR number, your migration number and your `SD-nn` are allocated in ONE commit before you run**,
   and section 7 is why this plan could not write them for you.
8. **Your ADR states what it FORECLOSES, not only what it chooses.** `P6-g` may widen a vocabulary two
   files declare closed with an argument, and `P6-c` mints a role model this project lives with.
9. **A new document gets its `INDEX.md` row in the same change.** An ADR does not: individual entries live
   in [decisions/README](../decisions/README.md)'s generated registry span.
10. **INDICATIVE DATA NEVER FEEDS AN ELIGIBILITY, BREACH OR MONEY DECISION, AND THIS IS THE PHASE WHERE
    THE REACH-AROUND IS ONE LINE.** No slice imports a tick into `apps/worker/src/batch/`, converts a
    `LiveAccountTick` into anything the engine reads, or writes a live value into `fills`,
    `raw_ingest_rows`, `daily_marks` or `rule_states`. **If your slice seems to need it, report it and
    stop.** `INV-M2-14`, `C-26`, [ADR-020](../decisions/ADR-020.md)'s hard rule.
11. **A LABEL IS ON THE NUMBER OR IT DOES NOT EXIST.** `INV-M4-11`: *"A label in a page footer is not a
    label on a number."* `INV-M4-12`: the fallback and the relabel are **one render**. **Assert over the
    rendered bytes**, on [session 261](../sessions/2026-08-27-session-261.md)'s measurement that a value
    reaches a page through an `alt`, a `title` or an error string without appearing in a visible field.
12. **Verify by running, never by reading.** `node scripts/corpus/gates.mjs check`,
    `node packages/tooling/checks/repo-invariants.mjs` and `pnpm run verify` leave green, and every
    completion claim in the pull-request body ships with its command and its output. **`pnpm install`
    first**, because `verify` cannot typecheck without `node_modules`.
13. **`pnpm run falsify:ci` mutates the working tree.** Never background it and never `git add -A` after it.
14. **Report the count honestly.** *"I am at 3 of 5"* beats five thin files.
15. **Never weaken a gate to pass it and never widen a fence to finish.** They are the same move. **`P6-h`
    is the one slice permitted to change what an assertion asserts**, and it changes it from *"there is no
    transport"* to *"the transport is in one named file"*, which is narrowing rather than deleting.
16. **Money is integer cents in every example you write.** `LiveAccountTick.equityCents` is `bigint` and
    [`stream.ts`](../../packages/rithmic/src/simulator/stream.ts) states why: *"a tick that narrowed to
    `number` would be the one place in the package where a cents value could silently lose precision, on
    the surface a trader watches."*

**Money-path sessions: `P6-c`, `P6-g`, `P6-i`, `P6-j` and `P6-k`. Plan mode, fresh context, one
objective, [ADR-003](../decisions/ADR-003.md) strict.** `P6-c` additionally carries the
[E2](../../MERIT_BUILD_MASTER_PROMPT.md) line-by-line read, **incrementally as each file lands** rather
than at the merge. **`P6-a` is not money path by file and is worth a founder read anyway**, because it is
the tier boundary.

---

## 12. The dispatch order

**Nothing below may be dispatched until section 7's allocation commit exists and section 10 item 1 is
answered.** Item 1 blocks `P6-c` alone, and `P6-c` blocks most of the phase.

```
Wave 1, four preconditions, none of them code. THREE CONCURRENT:
  P6-a  the adapter learns streamLive      (ADR-154, landed. NOTHING ELSE)
  P6-b  the container and the address      (ADR required; SERIAL behind P6-a on OVERVIEW)
  P6-c  the cache, the role, the grant     MONEY E2  (ADR + migration + SD-nn; section 10 item 1 FIRST)
  P6-d  the contract and the catalogue     (ADR required)

Wave 2, after P6-a, P6-c and P6-d. TWO CONCURRENT:
  P6-f  the streaming ingest               (needs P6-a, P6-c, P6-d)
  P6-g  the socket and the registry        MONEY  (needs P6-b, P6-d, an ADR, a VG-12 admission)

Wave 3, THREE CONCURRENT plus one behind P6-h:
  P6-h  the portal's socket client         (needs P6-g and the portal's HTTP client)
  P6-i  the live dashboard and GS-133      MONEY  (needs P6-h, section 10 items 3 and 4)
  P6-j  live Open Liability gains a source MONEY  (needs P6-c, P6-d, P6-g; ORDER AFTER P5-l on page.ts)
  P6-k  GS-132 where it can fail           MONEY  (needs P6-c, P6-f)

Wave 4, NOT DISPATCHED:
  GS-133 as a Playwright path              (P8's D0 battery)
  the vendor client                        (V-M2-16 unanswered, and M02 says ship without it)
  live win-day and consistency tracking    (section 10 item 3 first)
```

**`P6-a` is the one to run first and nothing blocks it**, because this document already took its ruling.
**`P6-c` is the one that decides whether the phase is a phase**, because five of the ten slices behind it
read or write the thing it is still to define.

**The rows in section 8 are the count and it is not restated here.** What is worth restating is the
composition, because it is the finding: **one slice is buildable today, four are documents rather than
code, and the deepest one is waiting on a founder's answer about a store that four approved documents
already describe the permissions of.** The arithmetic of tier 2 is written and tested. The plumbing is in
no document a session can build from. **That is not a reason to wait; it is the reason `P6-a`, `P6-b` and
`P6-d` are three separate sessions that can all start the moment the numbers are allocated.**
