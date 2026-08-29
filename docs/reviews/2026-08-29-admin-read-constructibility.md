# The seven admin read shapes, measured for constructibility: six are built, one is not, 2026-08-29

**A review record under [ADR-033](../decisions/ADR-033.md), not a plan and not a ruling.** It sits
outside the corpus ([`gates.mjs:165-168`](../../scripts/corpus/gates.mjs) excludes `docs/reviews/`
from `isCorpusDocument`), so it carries no frontmatter, appears in no INDEX, and binds nothing by
existing. The ruling this measurement produced is [ADR-236](../decisions/ADR-236.md).

**Anchored at `b8351af`**, which was `origin/main` and `HEAD` when this session opened. Every count
below was derived from that tree by running the derivation, not by reading a comment.

**THE SCOPE OF EVERY SEARCH IN THIS DOCUMENT** is `apps/api/src/**`, `apps/api/test/**`,
`apps/admin/src/**`, `apps/worker/src/**`, `packages/db/src/**` and `docs/decisions/**`, plus the
migration files named where they are named. Nothing outside those was read, and no claim below
extends past them.

---

## 0. The question, and why the answer is not the one the dispatch expected

The ALLOCATION row for `236` asked how many of **six** read shapes are constructible today, on the
premise that `setAdminReadSource` is blocked by a shape rather than an authority, and that the shape
work is unbuilt.

**Both halves of that premise are false, and the second one is false in the direction that matters.**

1. **The port declares SEVEN methods, not six.** `listEvents` was added by ADR-184 ruling 1.
2. **Six of the seven already have producers**, written over many sessions, and not one of them
   reaches `sqlExecutor`. The shape obstruction is gone.

So the work this row was allocated for was mostly done before the row was written, and what the row
called the obstruction is not the obstruction. **The measurement is therefore the deliverable, and
the code that follows from it is a correction rather than a projection.**

---

## 1. The count, derived

Run against `b8351af`:

| | Derived from | Value |
|---|---|---|
| Methods on `AdminReadSource` | the interface body in `apps/api/src/routes/admin-reads.ts` | **7** |
| `IMPLEMENTED_ADMIN_READS` | the array in the composition | **5** |
| `adminReadSourceParts` keys | the object that function returns | **1** |
| Distinct methods with a producer | the union of the two | **6** |
| Methods with no producer | the difference | **1**, `readLiability` |

**THE SEVEN, EACH WITH ITS OWN VERDICT:**

| # | Method | Producer | Composed | Verdict |
|---|---|---|---|---|
| 1 | `searchAccounts` | `search.ts` | yes | **CONSTRUCTIBLE, BUILT** |
| 2 | `readAccount` | `account.ts` | yes | **CONSTRUCTIBLE, BUILT** |
| 3 | `readIdentityGraph` | `graph.ts` | yes | **CONSTRUCTIBLE, BUILT** |
| 4 | `listFlags` | `flags.ts` | yes | **CONSTRUCTIBLE, BUILT** |
| 5 | `listEvents` | `events.ts` | yes | **CONSTRUCTIBLE, BUILT** |
| 6 | `exportEvidence` | `evidence.ts` | yes, given deps | **SHAPE BUILT, TWO SUPPLIERS SHORT** |
| 7 | `readLiability` | parts only | **no** | **NOT CONSTRUCTIBLE. One term outstanding** |

**THE ANSWER TO THE ROW'S QUESTION IS SIX**, and the row asked for six of six. The correct
statement is **six of seven**, and the seventh is named below with what it waits on.

---

## 2. What retires the shape reason

The port's header carried this, and four later readers quoted it:

> WHAT IS MISSING IS NOT AN AUTHORITY, IT IS A SHAPE. [...] None of the seven bodies above is a
> projection of one table [...] There is no join and no aggregate to reach for, so a live adapter
> written today would have to go through `sqlExecutor`.

**That was true when written and is now false for six of the seven.** The measurement:

- **No producer calls `sqlExecutor`.** Asserted as a call and not as the word, because four of the
  modules name it in prose to explain why they do not reach it.
- **No producer imports `@merit/db`.** So none can open a connection, and `test/db.test.ts`'s pinned
  map of which file may take a handle off the accessor is unmoved.
- **The join happens in TypeScript.** Each module reads through `rows(key)`, `rowsWhere(key, filter)`
  and `rowAt(key, address)` and folds the result in ordinary code, measuring what it read and
  returning the cost. `search.ts` names eleven tables, `account.ts` eight, `graph.ts` five,
  `flags.ts` five, `events.ts` two.

**The claim was never that the accessor could not serve these bodies. It was that a JOIN had to
happen in SQL.** Six modules are the counter-example.

---

## 3. What `exportEvidence` actually waits on, which is not a shape either

Its read half is built: `evidenceReadPort(tx)` supplies `EvidenceReadPort` over one unit of work,
and `createEvidenceExporter` composes the whole method. **It needs three suppliers and this tree
holds one.** The module says so itself, at the declaration of that port:

> **THIS IS TWO OF THE THREE PORTS SHORT OF A COMPOSABLE `exportEvidence` AND THE SECTION HEADER
> SAYS WHICH TWO.** A deployment holding a store and a writer hands this in as
> `EvidenceExporterDeps.reads`; nothing in this tree holds either.

| Supplier | What it is | Held by |
|---|---|---|
| `EvidenceReadPort` | the rows | **built** |
| `EvidencePackStore` | bytes to a `storage_ref`, a `download_url` and an `expires_at` | **nothing. Object storage, unbuilt** |
| `EvidencePackWriter` | the `evidence_packs` row | **nothing. Needs the operator door** |

**So `exportEvidence` splits across the line this session was asked to draw**: the store is
something we have not built, and the writer is behind the same purchase as everything else.

---

## 4. `readLiability`, the one shape that is not constructible

**Its parts exist and its assembly does not.** All three producers are written and exercised:

- `readLiabilityBook(tx, evaluateVelocity)` returns `LiabilityBook`, which the type declares as
  `Omit<LiabilityResponse, 'eligible_next_7d'>`, a mechanical subtraction rather than a hand-copied
  shape.
- `readTradingHorizon(tx, ...)` returns the seven trading day horizon.
- `evaluatePayoutVelocity(tx, asOf)` returns the velocity panel and answers three ways.

**Nothing folds them into one `LiabilityResponse`.** That is the missing code, and it is the only
read-shape code missing on this port.

**THE BLOCKER IS ONE TERM AND IT IS NOT A PURCHASE.** The module states the clearing condition in
three terms, bound by `RI-19` so the module and its case cannot drift apart. Terms 2 and 3 cleared,
by ADR-206 and ADR-208 respectively. **Term 1 stands and holds the group alone:**

> A `writeRuleState` IMPLEMENTATION. `nightly.ts` calls the port and the only things satisfying it
> are test doubles and `scripts/demo/world.ts`, which refuses. `rule_states` therefore holds no
> rows, which session 392 measured on a live database over all 60 migrations: **ZERO**.
> `apps/worker/**` and `packages/**`.

`eligible_next_7d` is a forward-looking per-account forecast, five of the six eligibility gate
groups clear only when a trader trades, and the one forward date lives in `rule_states.engine_gates`
which nothing writes. **EC-074 makes the group whole or nothing.**

**NO AGGREGATE WAS INVENTED FOR IT AND THE SESSION STOPPED HERE**, which is the row's own
instruction and `M06` section 1.2's rule at
[`M06-admin-ops-console.md:35`](../plans/M06-admin-ops-console.md): *"M6 aggregates numbers other
modules computed. It has no arithmetic on a rule"*.

**AND THE ASSEMBLY IS NOT THIS SESSION'S TO WRITE.** It belongs in the composition directory, which
row `236`'s fence does not hold. Registered, not taken.

---

## 5. What actually blocks the port, and it is the purchase

**This is the finding, and it inverts the sentence the port has carried for many sessions.**

To wire `setAdminReadSource` a deployment needs an `AdminSourceBackend`. That interface has one
method and it takes a `SystemTx`. **`systemDb` is the only name in the accessor that yields one**,
and three mechanical controls stand between this deployable and it:

1. **`apps/api/src/db.ts` declares no `operator(fn)`.** Five doors, and the absence of the sixth is
   stated in the file as the point.
2. **`test/db.test.ts` pins that file's import list exactly** at six names, `systemDb` not among
   them, *"and this list is: with case 3 below making this the only file that may import the
   accessor at all, the two together are the mechanical form of 'this deployable cannot open a door
   at the operator reason'"*.
3. **`test/db.test.ts` case 3 pins that no other file under `apps/api/src` may take a handle**
   off the accessor at all.

**So the door has to be opened in `db.ts`, and [ADR-171](../decisions/ADR-171.md) clause 1 refuses
to open it.** Section 9 states the condition:

> A slice may declare `operator(fn)` on `ApiDb` **when an `AdminSessionSource` a deployment can
> install exists in this tree**, because that is the first moment the door has a caller that reaches
> a row rather than a caller that rejects before it opens.

**An installable `AdminSessionSource` is the SSO purchase.** ADR-171 section 11 says the entry that
would build it *"is an integration with an identity provider behind `ADMIN_ORIGIN` under `C-08`'s
hardware-key SSO, and nothing in this repository describes the protocol"*.

**THEREFORE `setAdminReadSource` IS BEHIND THE PURCHASE, one step further along than the backends
that reduce to it through `principal(request)`.** ADR-171 clause 2 refused the door on the
measurement that it *"unblocks ZERO of the five"*, and its row for this port read *"the door
supplies an authority; the port is missing a vocabulary"*. **The vocabulary is supplied now. The
authority is what is missing, which is the inverse.**

**The refusal itself is untouched.** Section 9's condition is unmet, so the door does not open, and
nothing in this session reopens ADR-171. **What moves is the reason, and therefore which side of the
purchase line this port sits on.**

---

## 6. The clean separation the row asked for

| | What | Count |
|---|---|---|
| **BEHIND THE PURCHASE** | `setAdminSessionSource`; `useAdminWriteBackend`, `useAdminPayoutBackend`, `useAdminWalletBackend`, `useCertificateRevokeBackend` through `principal(request)`; `setAdminReadSource` through ADR-171 section 9; and `exportEvidence`'s `EvidencePackWriter` | **6 ports** |
| **SIMPLY NOT BUILT** | `readLiability`'s assembly, waiting on a `writeRuleState` implementation; `EvidencePackStore`, waiting on object storage | **2 things** |
| **BLOCKED BY NOTHING** | the six read shapes, all built, none reaching `sqlExecutor` | **6 shapes** |

**THE PURCHASE BLOCKS SIX PORTS AND NOT FOUR.** ADR-171 counted four because
`useCertificateRevokeBackend` did not exist and because it placed `setAdminReadSource` on the shape
side. `wiring.test.ts`'s session-source entry carried ADR-171's figure and read *"THREE OTHER PORTS
WAIT ON THIS ONE"* against a list that holds four.

---

## 7. Two stale citations found and not repaired

**`apps/api/src/routes/admin-feed.ts:18` cites `admin-reads.ts:1361`** for the flag queue's
*"FILTERABLE, not filtered"* sentence. **At `b8351af` that sentence is at line 2004**, so the
citation was already wrong by 643 lines before this branch existed. It is not one of `RI-15`'s
registered pairs, `admin-feed.ts` is outside row `236`'s fence, and this branch's own edit moves the
target further. **Reported rather than repaired.**

**`apps/api/src/admin-source/index.ts` states the wiring triple as `{ declared: 23, wired: 6,
blocked: 17 }`.** `wiring.test.ts` asserts `{ declared: 24, wired: 7, blocked: 17 }`. Outside this
fence, reported.

---

## 8. What this measurement is now held by

**The whole failure mode here was a true sentence going false with nothing to notice.** The claim
lived in a comment, four readers quoted it across three levels of citation, and every gate in the
repository stayed green while the tree moved underneath it.

`apps/api/test/admin-read-constructibility.test.ts` derives all of it from source on every run: the
seven, the five, the one, the six, the absence of `sqlExecutor` calls, the absence of accessor
imports, the absent door, the uncalled setter, and the six entries behind the purchase. **Each
assertion was falsified by hand before the branch was pushed**, by injecting the condition it
watches and confirming it went red.

**That is the project's own rule applied to its own defect**: prefer a new CI gate over a bigger
model whenever the error is checkable.
