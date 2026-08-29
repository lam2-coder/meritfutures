# `InternalOpsSource`, one method at a time: which of the four is a database read, 2026-08-29

**A review record under [ADR-033](../decisions/ADR-033.md), not a plan and not a ruling.** It sits
outside the corpus ([`gates.mjs`](../../scripts/corpus/gates.mjs) excludes `docs/reviews/` from
`isCorpusDocument`), so it carries no frontmatter, appears in no INDEX, and binds nothing by
existing. The ruling it feeds is [ADR-242](../decisions/ADR-242.md).

**Anchored at `6e8891c`**, which was `origin/main` when this session opened and which `HEAD` also
named at that read. Nothing measured below is this branch's work: the branch holds this file, one
new test file, one narrowed `BLOCKED` entry, an ADR, an ALLOCATION row and a session log, and it
touches no shipped source under `apps/` or `packages/` at all.

**WHY IT EXISTS.** `setInternalOpsSource` is one port with four methods and its `BLOCKED` entry
gave it one reason. A reason that covers four methods covers whichever of them it happens to fit,
and the row that dispatched this session asked the right question: *"whether an ops probe is a
database read of state a process WROTE, which `ApiDb` can serve, or a live call to a process, which
it cannot. Those are different systems and the answer may differ per method."* It does differ.

---

## 1. The entry as it stood, and the citation re-derived

The entry ([`wiring.test.ts`](../../apps/api/test/wiring.test.ts), the `setInternalOpsSource` key)
reads:

> an ops plane rather than a database read. `readDependencies`, `readJobs` and `readReconStatus` are
> probes of other processes, and `runBatch` COMMANDS one. None of the four is a shape `ApiDb`
> offers, and `routes/internal.ts:842-845` says a retry against this process will never succeed.

**THE CITATION HOLDS FOR THE CLAUSE IT SITS BESIDE AND NOT FOR THE ONE BEFORE IT.**
[`internal.ts:842-845`](../../apps/api/src/routes/internal.ts) is the message body of `wired()`'s
throw, and it reads *"no retry against this process will ever succeed"* at `:844`. It says nothing
about `ApiDb` and supports only the second half of the sentence. The dispatch row read the sentence
as putting the `ApiDb` claim at those lines; it does not.

**THE PORT'S FOUR METHODS ARE AT [`internal.ts:807-812`](../../apps/api/src/routes/internal.ts)**,
re-derived: `readDependencies`, `readJobs`, `readReconStatus`, `runBatch`.

---

## 2. The partition, one row per method

| Method | Read or command | Is it a shape `ApiDb` offers? | What actually refuses it |
|---|---|---|---|
| `readDependencies` | **COMMAND.** Three live calls and one self-probe | Not applicable: no database serves it | **Three vendor clients that do not exist**, and a renderer that refuses a partial answer |
| `readJobs` | **COMMAND, on the half that decides.** One sub-field of one of twenty rows is a read | No | **A job store with no schema, an interface with no depth reader, and two fields that are not rows at all** |
| `readReconStatus` | **A DATABASE READ. The only one of the four** | **No, and the entry is right for the wrong reason** | **THE DOOR.** `reconciliations` is scope class `derived`, and [ADR-171](../decisions/ADR-171.md) clause 1 refuses the door that would serve it |
| `runBatch` | **A COMMAND, unavoidably** | **YES. The entry's sentence is FALSE here** | **A manifest line, which is an authority and not a shape**, plus a job store and a consumer |

**SO THE ENTRY'S SENTENCE IS TRUE OF TWO METHODS, TRUE-FOR-THE-WRONG-REASON OF A THIRD, AND FALSE
OF THE FOURTH.**

---

## 3. `readDependencies`: a command, and no partial adapter exists

[API_CONTRACT](../architecture/API_CONTRACT.md) section 9 names four dependencies and
[`internal.ts:200`](../../apps/api/src/routes/internal.ts) transcribes them in the contract's order:
`db`, `sftp`, `rise`, `psp`.

**ONE OF THE FOUR IS INSIDE THIS PROCESS AND THREE ARE NOT.** `db` is a pool this deployable holds.
An SFTP server, Rise and a PSP are three other systems, and a probe of each is an outbound network
call rather than a row anybody wrote.

**MEASURED, over every shipped `src` directory of every workspace member (319 `.ts` and `.tsx`
files) and separately over `apps/api/src` (52 files):**

| Question | Answer |
|---|---|
| Files under `apps/api/src` that reach the network outbound | **2**, and they are [`turnstile.ts`](../../apps/api/src/turnstile.ts) and [`otp-delivery.ts`](../../apps/api/src/otp-delivery.ts) |
| Either of those an SFTP, Rise or PSP client | **No.** One is a CAPTCHA verifier and one is an OTP delivery vendor |
| Manifests in this workspace declaring an SSH or SFTP library | **0** |
| Vendor adapters in `packages/psp` | **0.** It ships a port and two fakes ([`checkout.ts:1103`](../../apps/api/src/routes/checkout.ts) states it, and `packages/psp/src/fakes/` holds `psp-a.ts` and `psp-b.ts`) |
| Modules naming Rise as an outbound client | **0.** Every Rise module in `apps/api/src` is an INBOUND webhook receiver |

**AND THE RENDERER FORBIDS THE PARTIAL ADAPTER, WHICH IS WHY THIS IS DECISIVE RATHER THAN MERELY
INCONVENIENT.** `renderDeepHealth` throws on a missing probe with its own stated reason: *"A missing
probe is not a passing one: rendering the response without it would report the estate on the
strength of the checks that happened to run."* An adapter that probed `db` and omitted the other
three cannot render a response. **Executed** in
[`internal-ops-constructibility.test.ts`](../../apps/api/test/internal-ops-constructibility.test.ts),
once for the `db`-only answer and once per dependency in a loop.

---

## 4. `readJobs`: three sub-answers, and only a fragment of one is a read

`JobsSnapshot` carries two arrays. They are four distinct questions and they have four distinct
sources.

| Field | Where the answer lives | Read? |
|---|---|---|
| `queues[].depth`, `queues[].failed` | pg-boss's own tables, in the Postgres schema `pgboss` | **No.** The schema does not exist |
| `deadManSwitches[].expected_by` | **A CELL OF A MARKDOWN TABLE.** Its own docblock: *"CRON_INVENTORY's 'Expected by' cell, verbatim"* | **No.** It is a document |
| `deadManSwitches[].firing` | The alarm, which is in the monitoring stack | **No.** [ADR-240](../decisions/ADR-240.md) met the same fact one endpoint over: the alarm is not in this tree |
| `deadManSwitches[].last_completed_at` | For **one** of the register's rows, `events` filtered to `batch.completed` | **Yes, for one row of twenty** |

**MEASURED:**

- **0** of **67** files under `packages/db/migrations/` names pg-boss's schema, in any spelling.
  [`pg-boss-queue.ts:40`](../../packages/queue/src/pg-boss-queue.ts) says so of itself and says why:
  *"THAT MIGRATION DOES NOT EXIST YET ... `start()` against a database with no pg-boss schema
  therefore FAILS, loudly, which is the right failure."*
- **`JobQueue` declares five methods** and none reads a depth: `declareQueue`, `enqueue`, `consume`,
  `start`, `stop`. It is the only interface in this workspace onto the job store.
- **CRON_INVENTORY's scheduled table carries 20 job rows.** Their dead-man predicates are
  heterogeneous by design: *"`batch.completed` absent"*, *"two consecutive cycles missed"*,
  *"canaries not found"*, *"a plan with no `plan_breaker_state` row for the day"*, *"a
  `report_deliveries` row absent"*. Four of those five are not one lookup and one of them is a
  two-cycle history.
- **The precedent for the fragment that IS a read is already written here.**
  [`liability.ts:1198`](../../apps/api/src/admin-source/liability.ts) does
  `rowsWhere('events', { eventName: 'batch.completed' })`, and its own header calls that read
  *"one row per nightly run"*.

**AND THE RENDERER FORBIDS THE PARTIAL ADAPTER HERE TOO.** `renderJobs` throws on an empty
dead-man list, quoting CRON_INVENTORY: *"a job in this table without a dead-man switch is a job that
does not exist"*, because *"an empty list here says nothing is firing where the true statement is
that nothing is being watched"*. So an adapter that could answer the queue half alone still cannot
render, and one that answered the single `batch.completed` row would publish a page watching one job
out of twenty. **Executed** in the same test file.

---

## 5. `readReconStatus`: a database read, and the door is what refuses it

**IT IS A READ, AND EVERY FIELD IT NEEDS IS A COLUMN OF ONE REGISTERED TABLE.**

- `reconciliations` is declared by [`0014_marks.sql`](../../packages/db/migrations/0014_marks.sql),
  whose `:171` is `status text NOT NULL CHECK (status IN ('match', 'mismatch', 'resolved'))`.
- Every member of `ReconMismatchRow` maps to a column: `account_id`, `trading_day`,
  `our_balance_cents`, `platform_balance_cents`, `our_source`, `source_ingest_file_id`, `created_at`.
- `ReconSnapshot.asOf` is **the port's clock and not a read**, by its own docblock, which is what
  lets the module compute an age without a clock in a handler.
- **A PROCESS WRITES THESE ROWS.** [`apps/worker/src/recon/sweep.ts`](../../apps/worker/src/recon/sweep.ts)
  is the comparison and the producer. Read but not edited: that tree is another session's.
- **THE EXACT FILTER IS ALREADY WRITTEN IN THIS DEPLOYABLE.**
  [`liability.ts:1193`](../../apps/api/src/admin-source/liability.ts) does
  `rowsWhere('reconciliations', { status: 'mismatch' })` over `LiabilityTx`, a handle narrowed AT
  THE PORT. `readReconStatus` is that read plus the port's clock.

**SO WHAT REFUSES IT IS NOT AN OPS PLANE. IT IS THE DOOR, AND THE DOOR IS ALREADY RULED.**

`reconciliations` is scope class **`derived`** through `accounts` on `account_id`
([`scope.ts:1339`](../../packages/db/src/scope.ts)). Consequences, each derived at the declaration:

| Door on `ApiDb` | Why it cannot serve this read |
|---|---|
| `scoped(identityId, fn)` | Needs an identity. The operator surface has none, and the response is firm-wide across every account |
| `firm(fn)` | `FirmTx.rowsWhere<K extends FirmTableKey>`, and a `derived` table is not a `FirmTableKey`. **A COMPILE ERROR**, asserted with a `@ts-expect-error` that `tsc` also checks in the other direction |
| `resolution(fn)` | One table, one address: `users` by `email` |
| `establishment(fn)` | One verb, and it is a write |
| `publicLookup(fn)` | One row of `certificates` by `code` |

The handle that serves it is `SystemTx` at `systemDb('operator-console')`, which
[`packages/db`](../../packages/db/src/scoped-db.ts) exports today and which
[`apps/api/src/db.ts`](../../apps/api/src/db.ts) deliberately does not open. **[ADR-171](../decisions/ADR-171.md)
clause 1 refuses that door**, and its section 9 states the condition that would lift the refusal:

> A slice may declare `operator(fn)` on `ApiDb` when an `AdminSessionSource` a deployment can install
> exists in this tree.

**THE CONDITION IS NOT MET, AND [ADR-237](../decisions/ADR-237.md) IS THE MEASUREMENT.** Session 427
built the operator directory and wired no port: `OperatorAssertionVerifier` has no implementation
here, nothing can write an `operator_sessions` row, and that entry says so in its own terms
(*"NO PORT IS WIRED AND THAT IS RULING 8 RATHER THAN AN OMISSION"*).

**AND THE DOOR IS NOT TAKEABLE HERE FOR A SECOND, INDEPENDENT REASON.** Its only caller would be
`databaseInternalOps`, and that adapter cannot be constructed, because the other three methods
reject (sections 3, 4 and 6). A door whose whole justification is one caller, and which has none, is
the primitive-before-a-caller that ADR-120 clause 3 and ADR-171 clause 2 both refuse.

---

## 6. `runBatch`: a command, and the entry's stated reason is false of it

**IT COMMANDS, AND THAT HALF OF THE ENTRY IS RIGHT.** It enqueues a job for another process to run,
and `BATCH_RUN_ACCEPTED` is 202 for exactly that reason: *"the batch runs on the worker and this
route has accepted a request rather than completed a run."*

**BUT `ApiDb` DOES OFFER THE SHAPE IT NEEDS, AND THAT HALF IS FALSE.** Derived, each at its
declaration:

1. `ApiDb.firm(fn)` hands its callback a `FirmTx` ([`db.ts`](../../apps/api/src/db.ts), `LIVE_DB`).
2. `FirmTx extends TxCommon` ([`scoped-db.ts:2803`](../../packages/db/src/scoped-db.ts)), and
   `TxCommon` carries `sqlExecutor(reason: SqlExecutorReason)`.
3. `SqlExecutorReason` is `'job-enqueue'` and nothing else
   ([`scoped-db.ts:2623`](../../packages/db/src/scoped-db.ts)), and `firmTx` supplies it
   ([`scoped-db.ts:3044`](../../packages/db/src/scoped-db.ts)).
4. `SqlExecutor` declares `executeSql(text, values?)`, and `packages/queue`'s `JobTransaction`
   declares that one member and nothing else. They are structurally the same shape, which
   `packages/db`'s own suite already binds.

So `db.firm((tx) => queue.enqueue(tx.sqlExecutor('job-enqueue'), request))` is the transactional
enqueue ADR-006 requires, and it is expressible with the doors this deployable holds today. **The
module's own header predicted this** and named the real blocker in the same paragraph: *"`apps/api`
DECLARES NO `@merit/queue`. A job enqueue goes through that package and not through raw SQL, and the
manifest is the only place that capability can be acquired."*

**THREE THINGS BLOCK IT AND NONE IS A SHAPE:**

| Blocker | Measured |
|---|---|
| **The manifest.** `apps/api` declares no `@merit/queue` | Asserted in the new test file. This is an AUTHORITY admission in the shape [ADR-120](../decisions/ADR-120.md) gave the database one, on the deployable serving the whole public surface |
| **The job store.** pg-boss's schema has no migration | **0** of **67** migration files name it. `start()` fails loudly by design |
| **The consumer.** Nothing runs the batch a row would enqueue | [`apps/worker/src/index.ts:1268`](../../apps/worker/src/index.ts) declares `export function main(): void` and its docblock says *"there is nothing to enqueue into, and nothing here installs a scheduler."* **THIS ONE IS NOT THIS SESSION'S**, and section 8 says what is owed |

**A WORKSPACE-WIDE COUNT, RECORDED BECAUSE IT IS THE SHARPEST VERSION OF THE FIRST ROW: `@merit/queue`
IS DECLARED AS A DEPENDENCY BY ZERO PACKAGES.** The only manifest naming the string is the package's
own `name` field. The queue is a library nothing in this workspace depends on.

---

## 7. The port verdict, and why one constructible method does not wire it

**THE PORT STAYS BLOCKED, AND THAT IS THE RULING RATHER THAN A SHORTFALL.**

One of four methods is a database read, and even that one's door is refused by a standing ADR whose
condition another session measured as unmet. Three of four are not reads at all.

**A SOURCE WITH ONE LIVE ARM AND THREE THAT REJECT IS REFUSED ON TWO INDEPENDENT GROUNDS:**

1. **`usePayoutBackend`'s stated rule**, carried into this session's dispatch: a port with one live
   arm and one that rejects is not wired.
2. **THE PORT'S OWN DOCBLOCK**, which is the stronger of the two because it is about this port:
   > ONE PORT AND NOT FOUR, because the four rows are one operator surface served by one deployment:
   > a wiring slice that could supply the recon read and not the health probe would be a deployment
   > that has not been finished ... Four setters would buy the ability to half-wire the operator
   > console, which is not an ability anybody has asked for.

**NO RPC CHANNEL WAS BUILT AND NONE IS PROPOSED.** Two methods would need one, and section 8 records
that as a finding rather than smuggling it into a wiring slice.

---

## 8. What is owed, and to whom

- **AN INSTALLABLE `AdminSessionSource`.** It is the condition ADR-171 section 9 wrote, it blocks
  four admin ports already, and `readReconStatus` is now the fifth thing standing behind it.
- **THE JOB STORE'S MIGRATION.** pg-boss's schema, emitted by `getConstructionPlans(schema)` and
  landed as a numbered migration. It blocks `readJobs`' depth half and `runBatch`'s enqueue.
- **A CONSUMER FOR THE BATCH QUEUE.** `runBatch` that enqueues into a queue nothing consumes is the
  trigger-that-reports-success failure `renderBatchRun` refuses, moved one layer out.
  **NOT THIS SESSION'S**, and the boundary was not crossed: nothing under `apps/worker/**` was
  edited, and no assertion in the new test file reads that tree.
- **AN OPS PLANE, FOR THE THREE PROBES AND THE COMMAND.** Two of the four methods need this process
  to call other processes: three vendor probes and one enqueue-then-consume. **That is an entry of
  its own.** It is not a wiring slice, it is a decision about where the operator console's
  liveness surface lives, and this review declines to make it.

---

## 9. What this review is most likely wrong about

**IT HAS RUN NOTHING AGAINST A DATABASE.** Every claim here is derived from source, from a registry
and from four rendering functions executed over fixtures. That `reconciliations` is `derived` is the
registry's word; that a `SystemTx` read would return the rows this response needs is not tested
anywhere and cannot be until a door exists.

**THE `readJobs` PARTITION ASSUMES pg-boss REMAINS THE BACKEND.** ADR-006 chose it and ADR-086
contained it behind `JobQueue`. If the backend moves, the depth half moves with it, and a Redis
backend would make that half unambiguously a live call rather than an unbuilt read.

**THE `last_completed_at` FRAGMENT MAY BE MORE THAN A FRAGMENT.** Section 4 counts it as one row of
twenty because CRON_INVENTORY's predicates are heterogeneous. A reader who thinks the register's
other nineteen rows could each be reduced to an event lookup would reach a different verdict for
`readJobs`, and they would still meet `renderJobs`' refusal and the missing depth reader.
