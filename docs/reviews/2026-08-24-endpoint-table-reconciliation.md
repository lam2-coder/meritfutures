# The endpoint-table reconciliation gate, priced: 96 rows and 24 disagreements, 2026-08-24

**A review record under [ADR-033](../decisions/ADR-033.md), not a plan and not a ruling.** It
sits outside the corpus ([`gates.mjs:165`](../../scripts/corpus/gates.mjs) excludes
`docs/reviews/` from `isCorpusDocument`), so it carries no frontmatter, appears in no INDEX,
and binds nothing by existing. **It writes no gate and repairs no row**, deliberately and
under instruction, because a measurement taken on a tree the measurer is quietly repairing
is not a measurement.

**Every figure below is anchored to `a0c7916`**, which was `origin/main` when this session
opened. `git diff --stat a0c7916 origin/main -- docs/plans docs/architecture` returns empty,
so the measured files are `main`'s and not this branch's.

**`main` moved once while this session ran, and the figures survive it.** `origin/main` was
`a0c7916` at the start and `a33adef` at the last `git fetch`, the two commits between them
being [`#233`](https://github.com/lam2-coder/meritfutures/pull/233), which changes two lines
of [`decisions/ALLOCATION.md`](../decisions/ALLOCATION.md) and nothing else.
**No measured file moved**, so every count here holds at `a33adef` as well. This is
[P4 section 11 rule 3](../plans/P4-portal-and-site.md) applied rather than recited: twelve of
the fourteen measurement sessions recorded a claim that was true at their base commit and
false by the time they committed, and the only defence is to re-fetch and say which commits
moved.

---

## 0. The question, and why six sessions each answered half of it

[P4 section 10 item 2](../plans/P4-portal-and-site.md) records the item this file discharges.
[Session 165](../sessions/2026-08-24-session-165.md) proposed a gate reconciling each module
plan's endpoint table against [API_CONTRACT](../architecture/API_CONTRACT.md) and declined to
write it, on the ground that *"writing it turns the corpus red on however many other modules
share the defect, and measuring that is its own session."*

Six measurement sessions found `API_CONTRACT` short of rows. **No two of them agree on how
many**, and section 6 below shows that this was never a counting error: they were counting
different objects, and nothing in the corpus says which object is the unit.

The four questions, answered:

| | Question | Answer at `a0c7916` |
|---|---|---|
| **1** | endpoints a plan's own table names that `API_CONTRACT` does not carry | **73** distinct, **76** over the plans that name them |
| **2** | endpoints `API_CONTRACT` carries that no plan names | **23** |
| **3** | the aggregate, both directions | **96** rows a gate turns red on, on arrival |
| **4** | disagreements between the documents about one endpoint | **24**, in five distinct kinds |

**96 and 24 are the price.** They are the reason nobody has written this gate, and they are
what a later session prices its design against.

---

## 1. Method: executed, not read

The extraction is a script. It is quoted in full in appendix A rather than committed, because
this session's fence is one review document plus its session log and `scripts/` is not in it.
Reproduce with the appendix saved to any path outside the tree:

```
node <path>/endpoint-recon.mjs /path/to/meritfutures
```

What it does, and the three decisions it takes, each of which a real gate must also take:

1. **What counts as an endpoint in `API_CONTRACT`.** A `###` or `####` heading whose text
   begins with an HTTP method, plus the table rows in sections 9 (ops and internal) and 10
   (inbound webhooks), which define endpoints in a table rather than under a heading.
   Section 11's rate-limit table is read as **references** rather than definitions, and
   section 12's negative-authz matrix is not read at all, being keyed by behaviour rather
   than by path.
2. **What counts as an endpoint in a plan.** Every backticked code span in the first column
   of a table inside the plan's `## 4. API endpoints ...` section.
3. **When two spellings are one route.** `/:anything` is erased to `/:param` and a query
   string is dropped, so `GET /accounts/:id` and `GET /accounts/:accountId` compare equal
   and their difference is reported as finding 4a rather than as two missing rows. **A gate
   that skips this decision reports 11 phantom absences.**

**The shape of the tree, as the script found it.** `docs/plans/M*.md` matches **22** files:

- **21** carry a `## 4. API endpoints ...` section. [M12-statistic-definitions](../plans/M12-statistic-definitions.md)
  does not, and correctly: it is a founder sign-off artifact for the seven statistic
  definitions, not a module plan, and it has no endpoints to name. **A gate globbing `M*.md`
  will fail this file every run unless it excludes it by name or by shape.**
- **20** carry a table. [M07](../plans/M07-risk-abuse.md) section 4 is **four paragraphs of
  prose with no table at all**, naming `GET /admin/flags`, `POST /admin/flags/:id/status`,
  `GET /admin/identities/:id/graph` and `POST /checkout` in running text
  ([M07:235](../plans/M07-risk-abuse.md)). **So I measured 20 of 22 plans by table, and the
  two that are not tables are named here rather than dropped.**

```
TOTALS  tableRows=125  parsedRows=124  endpointReferences=134  prose=4
A ROW IS NOT AN ENDPOINT: 124 parsed rows carry 134 endpoint references,
and 7 plan(s) have a row that names more than one.
```

---

## 2. Finding 1: 73 endpoints named by a plan and absent from the contract

**73 distinct**, and **76** counted per naming plan, the difference being `GET /wallet`,
`POST /wallet/withdrawals` and `GET /public/stats`, each named by two plans.

Per plan, at `a0c7916`. `absent` is against the contract; the `NEW` split is by whether the
plan's own row is marked `**NEW**`.

**The marker's meaning is stated for events and never for endpoints, and that is itself a
finding.** [M01:801](../plans/M01-rules-engine.md) introduces the events table with *"All
exist in the approved [EVENTS.md] catalogue except the two marked NEW, which are proposed
deltas folded in when this plan is approved"*, and the same sentence appears above most of
the other event tables. **No plan states any such convention above its endpoint table.** The
same two asterisks and the same four letters are used, so a reader imports the events
convention, and nothing in the corpus authorises that. **Every one of these plans is
`approved` and the fold never happened in either catalogue**, which is what
[session 166](../sessions/2026-08-24-session-166.md) found from M17's side when `grep -c` for
`loyalty` and `graduation` over the contract both returned zero.

| Plan | endpoints | absent | absent and `NEW` | absent and NOT `NEW` |
|---|---|---|---|---|
| M01-rules-engine | 4 | **0** | 0 | 0 |
| M02-rithmic-bridge | 4 | 1 | 0 | **1** |
| M03-billing-checkout | 8 | **0** | 0 | 0 |
| M04-trader-portal | 12 | **0** | 0 | 0 |
| M05-payout-system | 9 | 3 | 3 | 0 |
| M06-admin-ops-console | 5 | **0** | 0 | 0 |
| M07-risk-abuse | 0 (no table) | 0 | 0 | 0 |
| M08-affiliate-system | 6 | 1 | 1 | 0 |
| M09-marketing-site | 5 | 3 | 3 | 0 |
| M10-integrations | 6 | 4 | 4 | 0 |
| M11-certificates-social-proof | 7 | 6 | 6 | 0 |
| M12-statistic-definitions | 0 (no section) | 0 | 0 | 0 |
| M12-transparency-platform | 7 | **7** | 7 | 0 |
| M13-trader-analytics-journal | 10 | 8 | 8 | 0 |
| M14-loyalty-retention | 5 | **5** | 3 | **2** |
| M15-discord-integration | 5 | **5** | 5 | 0 |
| M16-notification-center | 6 | **6** | 6 | 0 |
| M17-offers-engine | 7 | 6 | 6 | 0 |
| M18-graduation-track | 5 | 4 | 4 | 0 |
| M19-kyc-identity | 8 | 5 | 5 | 0 |
| M20-wallet | 7 | 6 | 4 | **2** |
| M21-plan-designer | 8 | 6 | 6 | 0 |
| **sum over plans** | **134** | **76** | **71** | **5** |

**Four plans have zero absences**: M01, M03, M04 and M06. Every endpoint they name is in the
contract. **Four plans have nothing but absences**: M12-transparency-platform, M14, M15 and
M16 name 23 endpoints between them and the contract carries none of them.

**The five NOT-`NEW` absences are the sharpest rows in this file**, because a plan marking a
row `**NEW**` is at least telling the reader it is a delta. These five are written as though
they already exist:

| Endpoint | Named by | Marked `NEW`? |
|---|---|---|
| `POST /internal/provisioning/retry/:queueItemId` | M02 | no |
| `POST /offers/redeem` | M14 (`Consumes`, saying M17 owns it) | no |
| `GET /admin/graduation/review-pool` | M14 (`Consumes`, saying M18 owns it) | no |
| `GET /wallet` | M05 (`Owns`, `NEW`), M20 (`Shares with M5`, **not** `NEW`) | **the two plans disagree** |
| `POST /wallet/withdrawals` | M05 (`Owns`, `NEW`), M20 (`Shares with M5`, **not** `NEW`) | **the two plans disagree** |

**M14's two are the interesting pair.** M14 names each as `Consumes` and attributes ownership
to another plan, and **neither M17 nor M18 names it at all**: `grep` over M17 section 4 finds
`POST /internal/offers/authorize` and no `/offers/redeem`, and M18 section 4 has no
`review-pool` row. So two endpoints exist in the corpus **only as a consumer's citation of an
owner who never wrote them down**, and the contract carries neither.

---

## 3. Finding 2: 23 endpoints in the contract that no plan names

| Class | Count | Endpoints |
|---|---|---|
| **auth and credential surface** | **13** | `POST /auth/verify`, `POST /auth/elevate`, `POST /auth/logout`, the four `POST /auth/passkey/*`, `POST /phone/verify`, `POST /phone/change`, `GET /phone/change`, `POST /phone/change/:id/cancel`, `GET /sessions`, `POST /sessions/:id/revoke` |
| **admin console and risk** | **8** | `GET /admin/accounts`, `GET /admin/loss-ratios`, `GET /admin/cusum`, `GET /admin/identities/:identityId/graph`, `POST /admin/accounts/:accountId/unfreeze`, `POST /admin/accounts/:accountId/close`, `POST /admin/accounts/:accountId/note`, `POST /admin/flags/:flagId/status` |
| **ops liveness** | **2** | `GET /health`, `GET /internal/health/deep` |

**The 13 auth rows are [ADR-093](../decisions/ADR-093.md) restated from the other side, and
that is a corroboration rather than a coincidence.** ADR-093 ruled auth is P3's on the ground
that *"no phase's contents name it"*. This measurement says something adjacent and
independent: **no module plan's endpoint table names it either.** The contract specifies
thirteen auth and credential endpoints that no module has ever claimed. `POST /auth/otp` and
`GET /me` are the exceptions and are named by M04, which is exactly the split ADR-093
describes: M04 owns the screens, and the issuer they post to is homeless.

**Three of the eight admin rows close under a wider reading** and five do not. `GET /admin/identities/:identityId/graph`
and `POST /admin/flags/:flagId/status` are named in M07's prose; `POST /admin/accounts/:accountId/unfreeze`
is named in M05's row 328 as the bare fragment `` `and /unfreeze` ``. **All three are invisible to
any gate that reads the first column of a table**, which is section 5's subject.

**The five that survive every reading are M06's.** [M06](../plans/M06-admin-ops-console.md)
is the admin console plan; its section 4 table has **four rows naming five endpoints**; the
contract's section 8 defines sixteen admin endpoints. `GET /admin/accounts`, the account
search an operator uses first, and the three account mutations `close`, `note` and `unfreeze`
are specified in the contract and named by no plan at all.

---

## 4. Finding 3: the aggregate is 96, and it is 96 at both ends of the reading

The script's decisions about what to read change the split and, at the two extremes, not the
sum:

```
ALL FOUR READINGS, orphan + plan-side absence = the rows a gate turns red on:
   A. table rows the script parses, verbatim      23 + 73 = 96
   B. A plus M07's prose                          21 + 73 = 94
   C. A plus the four fragments resolved by hand  22 + 76 = 98
   D. B and C together                            20 + 76 = 96
```

**Report the number honestly: the aggregate is between 94 and 98 depending on decisions
nobody has taken, and it is 96 under both the narrowest and the widest reading.** Do not read
the pair of 96s as a stability property; it is the arithmetic of three rows moving from one
column to the other while four are added to the second.

For scale, at `a0c7916`:

```
API_CONTRACT endpoint DEFINITIONS parsed (with duplicates): 57
API_CONTRACT section 11 rate-limit REFERENCES parsed:        8
distinct endpoints in API_CONTRACT:                         57
distinct endpoints named by plans:                         107
union:                                                     130
agreeing on both sides:                                     34
rows a gate would have to turn red on:                      96
```

**Thirty-four endpoints out of a union of 130 are agreed by both sides. The gate is red on
74% of the surface on the day it is written.** That is the finding session 165 predicted
without a number, and it is why the gate cannot be written as a blocking check and merged in
one session.

---

## 5. Finding 4: 24 disagreements, in five kinds, each of which a gate must pick a side on

A gate does not merely count absences. Where two documents name the same endpoint
differently, the gate has to decide which spelling is canonical, and each decision is a
ruling somebody has to make.

### 5a. Parameter spelling: 11

Eleven routes are spelled two ways. The pattern is uniform and it is not random: **the
contract uses a typed parameter name and the older plans use `:id`.**

| Route | `:id` spelling, and who | typed spelling, and who |
|---|---|---|
| `GET /accounts/:param` | M01, M04 | `:accountId` M18, contract |
| `GET /accounts/:param/eligibility` | M01, M04, M05 | `:accountId` contract |
| `GET /accounts/:param/marks` | M04 | `:accountId` M13, contract |
| `GET /accounts/:param/timeline` | M04 | `:accountId` M13, contract |
| `GET /accounts/:param/certificate` | M04 | `:accountId` M11, contract |
| `POST /accounts/:param/payout` | M01, M04, M05, contract §11 | `:accountId` contract §6 |
| `POST /accounts/:param/reset` | M03, contract §11 | `:accountId` contract §5 |
| `POST /admin/accounts/:param/freeze` | M05 | `:accountId` contract |
| `GET /plans/:param/versions/:param` | `:id`/`:v` M03, M04 | `:planId`/`:version` M09, contract |
| `POST /admin/plans/:param/versions` | M03 | `:planId` M21, contract |
| `POST /admin/plans/versions/:param/publish` | M03, M06 | `:versionId` M21, contract |

**Two of the eleven are the contract disagreeing with itself** and are counted again in 5d
because they are a different defect: the same document spells one route two ways in two of
its own sections.

### 5b. Method: 0

No two documents assign different methods to the same path. **This is the one dimension that
is already clean**, and it is worth saying so: a gate keyed on `METHOD PATH` will not have to
adjudicate a single method conflict.

### 5c. `Auth:` factor: the dimension does not exist

```
distinct API_CONTRACT endpoints carrying an inline "Auth:" line: 15 of 57
occurrences of "Auth:" across all 22 module plans:                0
```

**There is nothing to reconcile, because only one side has the field.** `grep -c 'Auth:'` over
every `docs/plans/M*.md` returns zero on all 22. Even inside the contract the field is present
on 15 of 57 endpoints. A gate reconciling required factors has to be built the other way
round, from section 12's negative-authz matrix, which is what `CI-06k` already reads and
which is keyed by behaviour rather than by path
([session 170](../sessions/2026-08-24-session-170.md) recorded the same shape).

**This is a finding about the dispatch's own framing.** The brief named `Auth:` factor as one
of four axes a gate must pick a side on. On this tree it is not an axis at all, and reporting
zero is the answer rather than an absence of one.

### 5d. Status codes: 2 rows, and the contract disagreeing with itself: 2

**Two** plan endpoint-table rows in the whole corpus name an HTTP status code:
[M03:252](../plans/M03-billing-checkout.md) (`200` on a duplicate webhook, `401` on a bad
signature) and [M10:155](../plans/M10-integrations.md). Neither contradicts the contract.
**Status codes are effectively not stated in plan endpoint tables, so this axis is also nearly
empty.**

What is not empty is the contract against itself:

```
POST /accounts/:param/payout   :accountId at API_CONTRACT:409   :id at API_CONTRACT:651
POST /accounts/:param/reset    :accountId at API_CONTRACT:290   :id at API_CONTRACT:652
```

Both `:id` spellings are in section 11's rate-limit table. **A gate that treats the contract as
the single source of truth has to decide which of the contract's own two spellings wins**, on
the two endpoints where money moves.

### 5e. Ownership, and the `NEW` marker: 11

**Twenty endpoints are named by two or more plans.** For each, a gate has to know which plan
owns it, and the role column is the only place that could say so. It is not a closed
vocabulary:

```
   Owns        86
   (prose)     31
   Consumes    13
   Serves       2
   Supplies     2
role cells opening with a token: 103; role cells that are free prose: 31
```

Of the twenty shared endpoints:

- **11** have exactly one plan declaring `Owns`.
- **0** have two plans declaring `Owns`. **There is no flat ownership contradiction anywhere in
  the corpus**, which is a real and reassuring negative result.
- **9** have **no** plan declaring `Owns`, so a gate cannot attribute them at all:
  `GET /accounts/:param`, `/eligibility`, `/marks`, `/timeline`, `/certificate`,
  `GET /admin/liability`, `GET /internal/recon/status`, `GET /plans`,
  `GET /plans/:param/versions/:param`. In every case the reason is the same: M01, M02 and M04
  write prose in the role column where the later plans write a token.

And **2** endpoints where two plans disagree about whether the endpoint is new:

```
GET /wallet             NEW <- M05     not NEW <- M20
POST /wallet/withdrawals NEW <- M05    not NEW <- M20
```

**This is [session 179](../sessions/2026-08-24-session-179.md)'s M5/M20 collision showing up
on a second axis.** That session found `M5-1` and `M20-a` claiming the same four wallet
tables. Here the same two plans claim the same two endpoints and label them differently.

### The total

```
TOTAL disagreements a gate must pick a side on (4a + 4b + 4e + 4f + 4g): 24
```

**11** spelling + **0** method + **2** contract-self + **2** `NEW`-marker + **9** unattributable
ownership = **24**. Each is a decision, and a gate that does not take it either passes
something it should catch or fails something correct.

---

## 6. Why no two of the six sessions agreed: a row is not an endpoint

This is the part no single measurement session could produce, and it is not a criticism of
any of them.

| Session | Subject | What it reported | Table rows | Endpoint references | Under the widest reading |
|---|---|---|---|---|---|
| [159](../sessions/2026-08-24-session-159.md) | M05 | *"the four unwritten endpoints"* | 9 | 9 | **4 absent** |
| [164](../sessions/2026-08-24-session-164.md) | M13 | *"six NEW endpoints"* | 7 | **10** | **8 absent** |
| [165](../sessions/2026-08-24-session-165.md) | M16 | *"none of M16's six endpoints"* | 6 | 6 | **7 absent** |
| [166](../sessions/2026-08-24-session-166.md) | M17 | *"five NEW endpoints"* | 6 | **7** | **6 absent** |

**Session 159 is right and the script's first pass was wrong.** M05's table has nine rows and
the script parsed nine endpoints, finding three absences. The fourth is
`POST /admin/payouts/:id/enforce`, which is written as `` `POST /admin/payouts/:id/release` and `/enforce` **NEW** ``:
one row, two endpoints, and the second is a bare suffix with no method. A human reading gets
four. **Any gate that reads the first column as a list of endpoints gets three.**

**Sessions 165 and 166 counted rows.** M16 has six rows and seven endpoints
(`` `POST /me/contact-channels` and `DELETE` ``); M17 has six rows and seven endpoints
(`` `GET /admin/offers` and `POST /admin/offers/:id/revoke` ``, five of the six rows being
`NEW`). Both figures are correct about rows and neither is a count of endpoints.

**Session 164's six is a third unit again.** M13 has seven rows carrying ten endpoint
references, five rows marked `NEW`, and eight absences, because `` `GET/POST/PATCH/DELETE /journal` ``
is one row, one path, and four endpoints.

**So the six sessions did not disagree about the tree. They disagreed about the unit, and
nothing in the corpus defines it.** 124 parsed rows carry 134 endpoint references, and seven
of the twenty tables have at least one row that names more than one endpoint. **Any gate that
reports a count has to declare its unit in its own `covers` line, or it will produce a seventh
number that agrees with none of the six.**

---

## 7. What the script could not parse, named rather than dropped

**Five rows**, in four plans, and every one of them is a finding rather than a script defect:

| Site | Cell fragment | Why it does not parse |
|---|---|---|
| [M04:265](../plans/M04-trader-portal.md) | `The sensitive-action endpoints` | An endpoint-table row whose first cell names a **class** of endpoints and holds no code span at all. It is about the required-factor column and `CI-06k`, and it is real content, but it names no route |
| [M05:328](../plans/M05-payout-system.md) | `` `POST /admin/accounts/:id/freeze` and `/unfreeze` `` | The second code span is a path suffix with no method. Resolves by hand to `POST /admin/accounts/:id/unfreeze`, **which the contract does carry**, so this fragment is why one of the 23 orphans is an orphan |
| [M05:329](../plans/M05-payout-system.md) | `` `POST /admin/payouts/:id/release` and `/enforce` `` | Same shape. Resolves to `POST /admin/payouts/:id/enforce`, absent from the contract. **This is session 159's fourth endpoint** |
| [M16:255](../plans/M16-notification-center.md) | `` `POST /me/contact-channels` and `DELETE` `` | A bare **method** with no path. Resolves to `DELETE /me/contact-channels`, absent |
| [M18:233](../plans/M18-graduation-track.md) | `` `POST /me/invitations/:id/accept` and `/decline` `` | Path suffix, no method. Resolves to `POST /me/invitations/:id/decline`, absent |

Resolving all four fragments by hand moves the split from `23 + 73` to `22 + 76`. **They are
resolved in section 6 of the script's output and in this table, and they are NOT repaired in
the plans.** Repairing them is a five-word edit in four frozen documents and it is not this
session's to make.

**Two whole plans are outside the table reading**, restated here so the count is honest:
[M07](../plans/M07-risk-abuse.md) holds four endpoints in prose, and
[M12-statistic-definitions](../plans/M12-statistic-definitions.md) holds none and has no
section 4.

---

## 8. What this prices: the gate's cost, itemised

A later session designing this gate inherits, at `a0c7916`:

| Item | Cost |
|---|---|
| **Rows red on arrival** | **96**, or 94 to 98 depending on the reading. **74% of the union of 130** |
| **Rulings before a line is written** | **24** disagreements, in five kinds, of which 11 are one uniform decision (`:id` versus a typed parameter) and 9 are one uniform decision (the role column gains a closed vocabulary) |
| **Parser decisions** | 3, listed in section 1, each of which changes the count. **Skipping the parameter-erasure decision alone invents 11 phantom absences** |
| **Shape exceptions to declare** | 2 plans (M07 prose, M12-statistic-definitions no section), 5 unparseable rows, and 1 file that is not a module plan at all |
| **The unit** | **Undeclared, and it is the whole reason six sessions disagreed.** Rows and endpoints differ by 10 across the corpus |
| **Directions** | Both, and they are different gates. The plan-to-contract direction is 73 rows of a catalogue never absorbing a delta; the contract-to-plan direction is 23 rows of which **13 are the auth surface [ADR-093](../decisions/ADR-093.md) has already ruled on** |

**Three observations a design session should have before it starts.**

**First, this cannot be one gate.** The 13 auth orphans are not a plan defect; they are the
consequence of a surface that ADR-093 has just assigned to P3 and that no module plan was
ever written for. Failing a module plan for not naming `POST /auth/logout` would be a gate
reporting the wrong module's absence.

**Second, 71 of the 76 plan-side absences are self-declared.** Each is a row the plan itself
marked `**NEW**` and said would be folded into the catalogue on approval. **The plans are
approved and the fold never happened**, on any of them. That is one process failure with 71
instances, not 71 defects, and a gate that reports it as 71 defects will be turned off. The
five NOT-`NEW` rows in section 2's second table are a different and smaller object, and they
are the ones worth failing on first.

**Third, the gate that would have paid for itself already is smaller than the one proposed.**
Sections 5b, 5c and 5d say the method, factor and status-code axes are empty or near empty.
**What is not empty is the parameter spelling, which is a mechanical, uniform, 11-instance
defect on the money path**, and the `**NEW**` marker, where two plans disagree about the same
two wallet endpoints.

---

## 9. Named and deliberately left

Under the instruction not to repair a single row, and P4 section 11 rule 5. **Nothing in this
list was touched.**

1. **The four unparseable fragments** in M05 (two), M16 and M18. Each needs its second code
   span written as a full `METHOD /path`. Frozen documents, so an ADR rather than a commit.
2. **`API_CONTRACT` spells `POST /accounts/:id/payout` and `POST /accounts/:id/reset` two ways
   in its own body**, section 11 against sections 5 and 6. Two lines, at
   [API_CONTRACT:651](../architecture/API_CONTRACT.md) and `:652`.
3. **`POST /offers/redeem` and `GET /admin/graduation/review-pool` are cited by M14 as owned
   by M17 and M18, and neither owner names them.** Not marked `NEW` anywhere.
4. **M05 marks `GET /wallet` and `POST /wallet/withdrawals` `NEW` and M20 does not**, on the
   same two endpoints, which is [session 179](../sessions/2026-08-24-session-179.md)'s M5/M20
   collision on a second axis.
5. **M06's table names five endpoints and the contract defines sixteen under `/admin`.**
   `GET /admin/accounts`, `POST /admin/accounts/:accountId/close` and `/note` are named by no
   plan.
6. **The role column has no vocabulary.** 103 cells open with one of four tokens and 31 are
   free prose, which is why 9 shared endpoints have no attributable owner.
7. **A review document gets no `INDEX.md` row and no frontmatter**, by
   [`gates.mjs:167`](../../scripts/corpus/gates.mjs), and the four review documents already on
   disk have neither. **This session's dispatch said `CI-06c` fails on a new document with no
   INDEX row.** That is true of a corpus document and false of a `docs/reviews/` one; the
   30-gate run in the pull-request body is the evidence. No INDEX row was added, and the
   fence was narrowed rather than widened.

---

## Appendix A: the extraction, in full

Saved outside the tree and run against the repository root. Committing it to `scripts/` is
outside this session's fence, so it is quoted here in full for reproduction.

```js
#!/usr/bin/env node
// Session 187. MEASUREMENT ONLY: reconciles every docs/plans/M*.md endpoint table
// against docs/architecture/API_CONTRACT.md, in both directions, and reports the
// disagreements between plans. It writes nothing and repairs nothing.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] ?? process.cwd();
const CONTRACT = path.join(ROOT, 'docs/architecture/API_CONTRACT.md');
const PLANDIR = path.join(ROOT, 'docs/plans');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const M = METHODS.join('|');

const unparsed = [];   // {source, kind, text, why}
const note = (source, kind, text, why) => unparsed.push({ source, kind, text, why });

// --- normalisation -----------------------------------------------------------
// A path is compared with its parameter NAMES erased, because :id and :accountId
// are the same route and their difference is finding 4 rather than finding 1.
const normPath = (p) =>
  p.replace(/\?.*$/, '')            // query string is not part of the route
   .replace(/\/:[A-Za-z0-9_]+/g, '/:param')
   .replace(/\/+$/, '')
   .trim();
const key = (e) => `${e.method} ${normPath(e.path)}`;

// --- one text run -> endpoint records ----------------------------------------
// Handles: "POST /a", "GET /a, POST /b", "POST /a, /b" (method carries forward),
// "GET/POST/PATCH/DELETE /journal" (method list), and reports anything else.
function parseRun(text, source, kind) {
  const out = [];
  let carried = null;
  for (const rawSeg of text.split(',')) {
    const seg = rawSeg.replace(/\*\*[^*]*\*\*/g, ' ').replace(/\s+and\s+/gi, ' ').trim();
    if (!seg) continue;
    const multi = seg.match(new RegExp(`^((?:${M})(?:/(?:${M}))+)\\s+(/\\S*)$`));
    if (multi) {
      carried = null;
      for (const m of multi[1].split('/')) out.push({ method: m, path: multi[2], source, kind });
      continue;
    }
    const one = seg.match(new RegExp(`^(${M})\\s+(/\\S*)$`));
    if (one) { carried = one[1]; out.push({ method: one[1], path: one[2], source, kind }); continue; }
    if (/^\/\S*$/.test(seg)) {
      if (carried) { out.push({ method: carried, path: seg, source, kind }); continue; }
      note(source, kind, seg, 'a path with no method, and none carried forward from the same run');
      continue;
    }
    if (new RegExp(`^(${M})$`).test(seg)) {
      note(source, kind, seg, 'a bare METHOD with no path: the path is implied by an adjacent code span');
      continue;
    }
    note(source, kind, seg, 'not METHOD PATH and not a path');
  }
  return out;
}

// --- side A: API_CONTRACT ----------------------------------------------------
function readContract() {
  const lines = fs.readFileSync(CONTRACT, 'utf8').split('\n');
  const found = [];
  let pending = [];                 // endpoints of the heading block being read
  let section = 0;
  const flush = () => { pending = []; };
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const s2 = L.match(/^##\s+(\d+)\./);
    if (s2) section = Number(s2[1]);
    const h = L.match(new RegExp(`^#{3,4}\\s+((?:${M})[/\\s].*)$`));
    if (h) {
      flush();
      pending = parseRun(h[1], 'API_CONTRACT', `heading:${i + 1}`);
      for (const e of pending) { e.line = i + 1; e.auth = null; e.section = section; e.reference = false; found.push(e); }
      continue;
    }
    if (/^#{2,4}\s/.test(L)) { flush(); continue; }
    const a = L.match(/Auth:\s*([^.]*)\./);
    if (a && pending.length) for (const e of pending) e.auth = a[1].trim();
    // table rows in the ops and webhook sections: | `POST /x` | ... |
    // Sections 9 and 10 DEFINE endpoints in a table rather than under a heading.
    // Section 11 REFERENCES them (rate limits) and is read only for finding 4c/4e.
    if (section === 9 || section === 10 || section === 11) {
      const row = L.match(/^\|\s*`([^`]+)`\s*\|/);
      if (row && new RegExp(`^(?:${M})\\s+/`).test(row[1])) {
        for (const e of parseRun(row[1], 'API_CONTRACT', `table:${i + 1}`)) {
          e.line = i + 1; e.auth = null; e.section = section;
          e.reference = section === 11;
          found.push(e);
        }
      }
    }
  }
  return found;
}

// --- side B: the module plans ------------------------------------------------
function readPlans() {
  const files = fs.readdirSync(PLANDIR).filter((f) => /^M\d+.*\.md$/.test(f)).sort();
  const per = [];
  for (const f of files) {
    const name = f.replace(/\.md$/, '');
    const lines = fs.readFileSync(path.join(PLANDIR, f), 'utf8').split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^##\s+\d+\.\s+API endpoints/i.test(lines[i])) { start = i; break; }
    }
    if (start < 0) { per.push({ plan: name, section: null, endpoints: [], rows: 0, tableRows: 0, prose: [] }); continue; }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { end = i; break; }
    const body = lines.slice(start, end);
    const endpoints = [];
    let rows = 0, tableRows = 0;
    for (let j = 0; j < body.length; j++) {
      const L = body[j];
      if (!/^\|/.test(L)) continue;
      const cells = L.split('|');
      const first = (cells[1] ?? '').trim();
      if (!first || /^-+$/.test(first.replace(/[: ]/g, '')) || /^Endpoint$/i.test(first)) continue;
      tableRows++;
      const spans = [...first.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      if (!spans.length) {
        note(name, `row:${start + j + 1}`, first, 'an endpoint-table row whose first cell holds no code span');
        continue;
      }
      rows++;
      const isNew = /\*\*NEW/.test(first);
      const role = (cells[2] ?? '').replace(/\*/g, '').trim();
      for (const sp of spans) {
        for (const e of parseRun(sp, name, `row:${start + j + 1}`)) {
          e.line = start + j + 1; e.isNew = isNew; e.role = role; endpoints.push(e);
        }
      }
    }
    // prose mentions inside the section, for plans that have no table at all
    let prose = [];
    if (tableRows === 0) {
      for (let j = 0; j < body.length; j++) {
        for (const m of body[j].matchAll(/`([^`]+)`/g)) {
          if (new RegExp(`^(?:${M})[/ ]`).test(m[1]) || /^\/(?!\/)/.test(m[1])) {
            for (const e of parseRun(m[1], name, `prose:${start + j + 1}`)) { e.line = start + j + 1; e.viaProse = true; prose.push(e); }
          }
        }
      }
    }
    per.push({ plan: name, section: start + 1, endpoints, rows, tableRows, prose });
  }
  return per;
}

// --- run ---------------------------------------------------------------------
const contract = readContract();
const plans = readPlans();

const contractDefs = contract.filter((e) => !e.reference);
const contractRefs = contract.filter((e) => e.reference);
const contractKeys = new Map();
for (const e of contractDefs) if (!contractKeys.has(key(e))) contractKeys.set(key(e), e);

const planEndpoints = plans.flatMap((p) => p.endpoints);
const planKeys = new Map();
for (const e of planEndpoints) {
  if (!planKeys.has(key(e))) planKeys.set(key(e), []);
  planKeys.get(key(e)).push(e);
}

console.log('=== 0. SHAPES ===');
for (const p of plans) {
  console.log(
    `${p.plan}\tsection@${p.section ?? 'ABSENT'}\ttableRows=${p.tableRows ?? 0}\tparsedRows=${p.rows}` +
    `\tendpoints=${p.endpoints.length}\tprose=${(p.prose ?? []).length}`
  );
}

const T = (f) => plans.reduce((a, p) => a + f(p), 0);
console.log(`TOTALS\ttableRows=${T((p) => p.tableRows ?? 0)}\tparsedRows=${T((p) => p.rows)}` +
  `\tendpointReferences=${T((p) => p.endpoints.length)}\tprose=${T((p) => (p.prose ?? []).length)}`);
console.log('A ROW IS NOT AN ENDPOINT: ' +
  `${T((p) => p.rows)} parsed rows carry ${T((p) => p.endpoints.length)} endpoint references, ` +
  `and ${plans.filter((p) => p.endpoints.length !== p.rows).length} plan(s) have a row that names more than one.`);

console.log('\n=== 1. NAMED BY A PLAN, ABSENT FROM API_CONTRACT ===');
const missing = [];
for (const [k, es] of [...planKeys].sort()) {
  if (!contractKeys.has(k)) { missing.push([k, es]); console.log(`${k}\t<- ${[...new Set(es.map((e) => e.source))].join(', ')}`); }
}
console.log(`TOTAL absent from API_CONTRACT: ${missing.length}`);

console.log('\n=== 2. IN API_CONTRACT, NAMED BY NO PLAN ===');
const orphan = [];
for (const [k, e] of [...contractKeys].sort()) {
  if (!planKeys.has(k)) { orphan.push([k, e]); console.log(`${k}\t(API_CONTRACT:${e.line})`); }
}
console.log(`TOTAL named by no plan: ${orphan.length}`);

console.log('\n=== 1b. PER PLAN, AND THE **NEW** SPLIT ===');
console.log('plan\tendpoints\tabsent\tabsent&NEW\tabsent&notNEW\tpresent');
let sumAbs = 0, sumNew = 0, sumNotNew = 0;
for (const p of plans) {
  const seen = new Map();
  for (const e of p.endpoints) if (!seen.has(key(e))) seen.set(key(e), e);
  const abs = [...seen.values()].filter((e) => !contractKeys.has(key(e)));
  const n = abs.filter((e) => e.isNew).length;
  sumAbs += abs.length; sumNew += n; sumNotNew += abs.length - n;
  console.log(`${p.plan}\t${seen.size}\t${abs.length}\t${n}\t${abs.length - n}\t${seen.size - abs.length}`);
}
console.log(`SUM over plans (an endpoint named by two plans counts twice)\t\t${sumAbs}\t${sumNew}\t${sumNotNew}`);
const distinctNew = new Set(), distinctNotNew = new Set();
for (const [k, es] of planKeys) {
  if (contractKeys.has(k)) continue;
  (es.every((e) => e.isNew) ? distinctNew : distinctNotNew).add(k);
}
console.log(`DISTINCT absent, every naming row marked **NEW**: ${distinctNew.size}`);
console.log(`DISTINCT absent, at least one naming row NOT marked NEW: ${distinctNotNew.size}`);
for (const k of [...distinctNotNew].sort()) console.log(`   not-NEW: ${k}\t<- ${[...new Set(planKeys.get(k).map((e) => e.source))].join(', ')}`);

console.log('\n=== 3. AGGREGATE ===');
console.log(`API_CONTRACT endpoint DEFINITIONS parsed (with duplicates): ${contractDefs.length}`);
console.log(`API_CONTRACT section 11 rate-limit REFERENCES parsed: ${contractRefs.length}`);
console.log(`distinct endpoints in API_CONTRACT: ${contractKeys.size}`);
console.log(`distinct endpoints named by plans: ${planKeys.size}`);
console.log(`union: ${new Set([...contractKeys.keys(), ...planKeys.keys()]).size}`);
console.log(`agreeing on both sides: ${[...planKeys.keys()].filter((k) => contractKeys.has(k)).length}`);
console.log(`rows a gate would have to turn red on: ${missing.length + orphan.length}`);

console.log('\n=== 4. DISAGREEMENTS ===');
let dis = 0;

console.log('\n-- 4a. same route, different parameter SPELLING --');
const bySpelling = new Map();
for (const e of [...planEndpoints, ...contract]) {
  const k = key(e);
  if (!bySpelling.has(k)) bySpelling.set(k, new Map());
  const lit = e.method + ' ' + e.path.replace(/\?.*$/, '');
  if (!bySpelling.get(k).has(lit)) bySpelling.get(k).set(lit, []);
  bySpelling.get(k).get(lit).push(e.source);
}
for (const [k, lits] of [...bySpelling].sort()) {
  if (lits.size > 1) {
    dis++;
    console.log(k);
    for (const [lit, srcs] of lits) console.log(`   ${lit}\t<- ${[...new Set(srcs)].join(', ')}`);
  }
}

console.log('\n-- 4b. same PATH, different method sets --');
const byPath = new Map();
for (const e of [...planEndpoints, ...contract]) {
  const p = normPath(e.path);
  if (!byPath.has(p)) byPath.set(p, new Map());
  if (!byPath.get(p).has(e.method)) byPath.get(p).set(e.method, []);
  byPath.get(p).get(e.method).push(e.source);
}
for (const [p, ms] of [...byPath].sort()) {
  if (ms.size < 2) continue;
  const srcSets = [...ms].map(([m, s]) => [m, new Set(s)]);
  // a disagreement is a source that names one method for a path another names differently
  const allSrc = new Set(srcSets.flatMap(([, s]) => [...s]));
  const partial = [...allSrc].filter((s) => srcSets.some(([, set]) => !set.has(s)));
  if (partial.length) {
    dis++;
    console.log(p);
    for (const [m, s] of srcSets) console.log(`   ${m}\t<- ${[...s].join(', ')}`);
  }
}

console.log('\n-- 4c. Auth: factor --');
const withAuth = new Set(contractDefs.filter((e) => e.auth).map((e) => key(e)));
console.log(`distinct API_CONTRACT endpoints carrying an inline "Auth:" line: ${withAuth.size} of ${contractKeys.size}`);
let planAuth = 0;
for (const p of plans) {
  const f = path.join(PLANDIR, p.plan + '.md');
  planAuth += (fs.readFileSync(f, 'utf8').match(/Auth:/g) ?? []).length;
}
console.log(`occurrences of "Auth:" across all 22 module plans: ${planAuth}`);

console.log('\n-- 4d. status codes named in plan endpoint tables --');
let codeRows = 0;
for (const p of plans) {
  const lines = fs.readFileSync(path.join(PLANDIR, p.plan + '.md'), 'utf8').split('\n');
  if (!p.section) continue;
  let end = lines.length;
  for (let i = p.section; i < lines.length; i++) if (/^##\s/.test(lines[i])) { end = i; break; }
  for (const L of lines.slice(p.section - 1, end)) {
    if (/^\|/.test(L) && /\b(200|201|202|400|401|403|404|409|412|422|429|500|503)\b/.test(L)) {
      codeRows++;
      console.log(`${p.plan}: ${L.slice(0, 160)}`);
    }
  }
}
console.log(`plan endpoint-table rows naming an HTTP status code: ${codeRows}`);

console.log('\n-- 4f. two plans disagreeing on whether an endpoint is **NEW** --');
let newDis = 0;
for (const [k, es] of [...planKeys].sort()) {
  const srcs = [...new Set(es.map((e) => e.source))];
  if (srcs.length < 2) continue;
  const marks = new Map();
  for (const e of es) { if (!marks.has(e.isNew ? 'NEW' : 'not NEW')) marks.set(e.isNew ? 'NEW' : 'not NEW', new Set()); marks.get(e.isNew ? 'NEW' : 'not NEW').add(e.source); }
  if (marks.size > 1) {
    newDis++; dis++;
    console.log(k);
    for (const [m, set] of marks) console.log(`   ${m}\t<- ${[...set].join(', ')}`);
  }
}
console.log(`NEW-marker disagreements: ${newDis}`);

console.log('\n-- 4g. the ROLE column: is ownership machine readable? --');
const ROLE_TOKENS = /^(Owns|Serves|Supplies|Consumes)\b/;
let tokenCells = 0, proseCells = 0;
const roleCensus = new Map();
for (const e of planEndpoints) {
  const r = e.role || '(empty)';
  const t = ROLE_TOKENS.test(r) ? r.match(ROLE_TOKENS)[1] : '(prose)';
  roleCensus.set(t, (roleCensus.get(t) ?? 0) + 1);
  if (t === '(prose)') proseCells++; else tokenCells++;
}
for (const [t, n] of [...roleCensus].sort((a, b) => b[1] - a[1])) console.log(`   ${t}\t${n}`);
console.log(`role cells opening with a token: ${tokenCells}; role cells that are free prose: ${proseCells}`);

let shared = 0, oneOwner = 0, manyOwners = 0, noOwner = 0;
const noOwnerList = [];
for (const [k, es] of [...planKeys].sort()) {
  if (new Set(es.map((e) => e.source)).size < 2) continue;
  shared++;
  const owners = [...new Set(es.filter((e) => /^Owns\b/.test(e.role || '')).map((e) => e.source))];
  if (owners.length === 1) oneOwner++;
  else if (owners.length > 1) { manyOwners++; console.log(`   TWO OWNERS: ${k} <- ${owners.join(', ')}`); }
  else { noOwner++; noOwnerList.push([k, [...new Set(es.map((e) => e.source))]]); }
}
console.log(`endpoints named by 2 or more plans: ${shared}`);
console.log(`   exactly one plan declares Owns: ${oneOwner}`);
console.log(`   more than one plan declares Owns (a flat contradiction): ${manyOwners}`);
console.log(`   NO plan declares Owns, so the gate cannot attribute it: ${noOwner}`);
for (const [k, srcs] of noOwnerList) console.log(`      ${k}\t<- ${srcs.join(', ')}`);
dis += manyOwners + noOwner;

console.log('\n-- 4e. API_CONTRACT disagreeing with ITSELF on a parameter spelling --');
let selfDis = 0;
const selfBy = new Map();
for (const e of contract) {
  const k = key(e);
  if (!selfBy.has(k)) selfBy.set(k, new Map());
  const lit = e.method + ' ' + e.path.replace(/\?.*$/, '');
  if (!selfBy.get(k).has(lit)) selfBy.get(k).set(lit, []);
  selfBy.get(k).get(lit).push(`${e.reference ? 'S11' : 'def'}@${e.line}`);
}
for (const [k, lits] of [...selfBy].sort()) {
  if (lits.size > 1) { selfDis++; console.log(k); for (const [lit, at] of lits) console.log(`   ${lit}\t${at.join(', ')}`); }
}
console.log(`API_CONTRACT self-disagreements: ${selfDis}`);

dis += selfDis;
console.log(`\nTOTAL disagreements a gate must pick a side on (4a + 4b + 4e + 4f + 4g): ${dis}`);

console.log('\n=== 5. WHAT THE SCRIPT COULD NOT PARSE ===');
for (const u of unparsed) console.log(`${u.source}\t${u.kind}\t"${u.text}"\t${u.why}`);
console.log(`TOTAL unparsed: ${unparsed.length}`);

console.log('\n=== 6. THE SAME MEASUREMENT UNDER TWO WIDER READINGS ===');

// 6a. M07 has no table at all; its section names endpoints in prose. Read it.
const prose = plans.flatMap((p) => p.prose ?? []);
console.log(`prose endpoints found in plans with no table: ${prose.length}`);
for (const e of prose) console.log(`   ${e.source}:${e.line}\t${e.method} ${e.path}`);
const withProse = new Map(planKeys);
for (const e of prose) { if (!withProse.has(key(e))) withProse.set(key(e), []); withProse.get(key(e)).push(e); }
const orphanWithProse = [...contractKeys.keys()].filter((k) => !withProse.has(k));
const missingWithProse = [...withProse.keys()].filter((k) => !contractKeys.has(k));
console.log(`orphans if a gate reads prose too: ${orphanWithProse.length} (was ${orphan.length})`);
console.log(`plan-side absences if a gate reads prose too: ${missingWithProse.length} (was ${missing.length})`);
let prosDis = 0;
for (const [k, es] of [...withProse].sort()) {
  const lits = new Set([...es, ...(contract.filter((c) => key(c) === k))].map((e) => e.method + ' ' + e.path.replace(/\?.*$/, '')));
  if (lits.size > 1) prosDis++;
}
console.log(`parameter-spelling disagreements if a gate reads prose too: ${prosDis} (table only, 4a: 11)`);

// 6b. the four unresolvable fragments, resolved BY HAND and counted separately.
// Nothing here is written back to any file; this is a second reading of the same tree.
const HAND = [
  ['M05-payout-system', 'POST', '/admin/accounts/:id/unfreeze', 'row 328, `and /unfreeze`'],
  ['M05-payout-system', 'POST', '/admin/payouts/:id/enforce', 'row 329, `and /enforce`'],
  ['M16-notification-center', 'DELETE', '/me/contact-channels', 'row 255, `and DELETE`'],
  ['M18-graduation-track', 'POST', '/me/invitations/:id/decline', 'row 233, `and /decline`'],
];
const handKeys = new Map(planKeys);
for (const [src, method, path_, why] of HAND) {
  const e = { method, path: path_, source: src, byHand: why };
  if (!handKeys.has(key(e))) handKeys.set(key(e), []);
  handKeys.get(key(e)).push(e);
  console.log(`   by hand: ${method} ${path_}\t${src}\t${why}\t${contractKeys.has(key(e)) ? 'IS in API_CONTRACT' : 'absent from API_CONTRACT'}`);
}
console.log(`orphans once the four fragments are resolved by hand: ${[...contractKeys.keys()].filter((k) => !handKeys.has(k)).length} (was ${orphan.length})`);
console.log(`plan-side absences once the four fragments are resolved by hand: ${[...handKeys.keys()].filter((k) => !contractKeys.has(k)).length} (was ${missing.length})`);

// 6c. both widenings at once
const both = new Map(handKeys);
for (const e of prose) { if (!both.has(key(e))) both.set(key(e), []); both.get(key(e)).push(e); }
const bothOrphan = [...contractKeys.keys()].filter((k) => !both.has(k));
const bothMissing = [...both.keys()].filter((k) => !contractKeys.has(k));
const handOrphan = [...contractKeys.keys()].filter((k) => !handKeys.has(k)).length;
const handMissing = [...handKeys.keys()].filter((k) => !contractKeys.has(k)).length;
console.log('\nALL FOUR READINGS, orphan + plan-side absence = the rows a gate turns red on:');
console.log(`   A. table rows the script parses, verbatim      ${orphan.length} + ${missing.length} = ${orphan.length + missing.length}`);
console.log(`   B. A plus M07's prose                          ${orphanWithProse.length} + ${missingWithProse.length} = ${orphanWithProse.length + missingWithProse.length}`);
console.log(`   C. A plus the four fragments resolved by hand  ${handOrphan} + ${handMissing} = ${handOrphan + handMissing}`);
console.log(`   D. B and C together                            ${bothOrphan.length} + ${bothMissing.length} = ${bothOrphan.length + bothMissing.length}`);
```

## Appendix B: the full output at `a0c7916`

```
=== 0. SHAPES ===
M01-rules-engine	section@776	tableRows=4	parsedRows=4	endpoints=4	prose=0
M02-rithmic-bridge	section@228	tableRows=4	parsedRows=4	endpoints=4	prose=0
M03-billing-checkout	section@244	tableRows=6	parsedRows=6	endpoints=8	prose=0
M04-trader-portal	section@248	tableRows=12	parsedRows=11	endpoints=12	prose=0
M05-payout-system	section@318	tableRows=9	parsedRows=9	endpoints=9	prose=0
M06-admin-ops-console	section@242	tableRows=4	parsedRows=4	endpoints=5	prose=0
M07-risk-abuse	section@233	tableRows=0	parsedRows=0	endpoints=0	prose=4
M08-affiliate-system	section@151	tableRows=6	parsedRows=6	endpoints=6	prose=0
M09-marketing-site	section@173	tableRows=5	parsedRows=5	endpoints=5	prose=0
M10-integrations	section@151	tableRows=5	parsedRows=5	endpoints=6	prose=0
M11-certificates-social-proof	section@150	tableRows=7	parsedRows=7	endpoints=7	prose=0
M12-statistic-definitions	section@ABSENT	tableRows=0	parsedRows=0	endpoints=0	prose=0
M12-transparency-platform	section@212	tableRows=7	parsedRows=7	endpoints=7	prose=0
M13-trader-analytics-journal	section@137	tableRows=7	parsedRows=7	endpoints=10	prose=0
M14-loyalty-retention	section@210	tableRows=5	parsedRows=5	endpoints=5	prose=0
M15-discord-integration	section@147	tableRows=5	parsedRows=5	endpoints=5	prose=0
M16-notification-center	section@247	tableRows=6	parsedRows=6	endpoints=6	prose=0
M17-offers-engine	section@142	tableRows=6	parsedRows=6	endpoints=7	prose=0
M18-graduation-track	section@226	tableRows=5	parsedRows=5	endpoints=5	prose=0
M19-kyc-identity	section@241	tableRows=8	parsedRows=8	endpoints=8	prose=0
M20-wallet	section@258	tableRows=7	parsedRows=7	endpoints=7	prose=0
M21-plan-designer	section@210	tableRows=7	parsedRows=7	endpoints=8	prose=0
TOTALS	tableRows=125	parsedRows=124	endpointReferences=134	prose=4
A ROW IS NOT AN ENDPOINT: 124 parsed rows carry 134 endpoint references, and 7 plan(s) have a row that names more than one.

=== 1. NAMED BY A PLAN, ABSENT FROM API_CONTRACT ===
DELETE /journal	<- M13-trader-analytics-journal
DELETE /me/discord/link	<- M15-discord-integration
GET /accounts/:param/analytics	<- M13-trader-analytics-journal
GET /accounts/:param/analytics/definitions	<- M13-trader-analytics-journal
GET /accounts/:param/graduation	<- M18-graduation-track
GET /accounts/:param/round-trips	<- M13-trader-analytics-journal
GET /admin/competitor-models	<- M21-plan-designer
GET /admin/discord/announcements	<- M15-discord-integration
GET /admin/experiments	<- M17-offers-engine
GET /admin/graduation/review-pool	<- M14-loyalty-retention
GET /admin/identities/:param/disclosures	<- M10-integrations
GET /admin/identities/:param/kyc	<- M19-kyc-identity
GET /admin/kyc/funnel	<- M19-kyc-identity
GET /admin/notifications/:param	<- M16-notification-center
GET /admin/offers	<- M17-offers-engine
GET /admin/plans/versions/:param/diff	<- M21-plan-designer
GET /admin/simulations/:param	<- M21-plan-designer
GET /admin/stats/reconciliation	<- M12-transparency-platform
GET /admin/wallet/reconciliation	<- M20-wallet
GET /certificates	<- M11-certificates-social-proof
GET /certificates/:param/image.png	<- M11-certificates-social-proof
GET /internal/integrations/health	<- M10-integrations
GET /journal	<- M13-trader-analytics-journal
GET /me/export	<- M13-trader-analytics-journal
GET /me/loyalty	<- M14-loyalty-retention
GET /me/notification-preferences	<- M16-notification-center
GET /me/offers	<- M17-offers-engine
GET /notifications	<- M16-notification-center
GET /public/content/:param/:param	<- M09-marketing-site
GET /public/graduation	<- M18-graduation-track
GET /public/leaderboard	<- M11-certificates-social-proof
GET /public/loyalty/criteria	<- M14-loyalty-retention
GET /public/methods/:param	<- M12-transparency-platform
GET /public/proof	<- M12-transparency-platform
GET /public/stats	<- M09-marketing-site, M12-transparency-platform
GET /public/stats/:param/history	<- M12-transparency-platform
GET /support/context	<- M10-integrations
GET /verify/:param	<- M11-certificates-social-proof
GET /wallet	<- M05-payout-system, M20-wallet
GET /wallet/entries	<- M20-wallet
PATCH /journal	<- M13-trader-analytics-journal
PATCH /me/discord/roles	<- M15-discord-integration
PATCH /me/leaderboard	<- M11-certificates-social-proof
PATCH /me/notification-preferences	<- M16-notification-center
POST /admin/accounts/:param/graduation-benefit	<- M18-graduation-track
POST /admin/certificates/:param/revoke	<- M11-certificates-social-proof
POST /admin/competitor-models	<- M21-plan-designer
POST /admin/dedupe-matches/:param/disposition	<- M19-kyc-identity
POST /admin/loyalty/recompute	<- M14-loyalty-retention
POST /admin/offers/:param/revoke	<- M17-offers-engine
POST /admin/payouts/:param/release	<- M05-payout-system
POST /admin/plans/versions/:param/validate	<- M21-plan-designer
POST /admin/price-floors	<- M17-offers-engine
POST /admin/sanctions/:param/review	<- M19-kyc-identity
POST /admin/simulations	<- M21-plan-designer
POST /admin/wallet/:param/correct	<- M20-wallet
POST /admin/wallet/:param/spend-limit	<- M20-wallet
POST /affiliate/creatives	<- M08-affiliate-system
POST /internal/integrations/replay	<- M10-integrations
POST /internal/offers/authorize	<- M17-offers-engine
POST /internal/provisioning/retry/:param	<- M02-rithmic-bridge
POST /internal/revalidate	<- M09-marketing-site
POST /internal/stats/run	<- M12-transparency-platform
POST /journal	<- M13-trader-analytics-journal
POST /kyc/reverify	<- M19-kyc-identity
POST /me/contact-channels	<- M16-notification-center
POST /me/discord/link	<- M15-discord-integration
POST /me/invitations/:param/accept	<- M18-graduation-track
POST /me/review-requests/opt-out	<- M12-transparency-platform
POST /notifications/:param/read	<- M16-notification-center
POST /offers/redeem	<- M14-loyalty-retention
POST /wallet/withdrawals	<- M05-payout-system, M20-wallet
POST /webhooks/discord	<- M15-discord-integration
TOTAL absent from API_CONTRACT: 73

=== 2. IN API_CONTRACT, NAMED BY NO PLAN ===
GET /admin/accounts	(API_CONTRACT:535)
GET /admin/cusum	(API_CONTRACT:532)
GET /admin/identities/:param/graph	(API_CONTRACT:585)
GET /admin/loss-ratios	(API_CONTRACT:532)
GET /health	(API_CONTRACT:624)
GET /internal/health/deep	(API_CONTRACT:625)
GET /phone/change	(API_CONTRACT:196)
GET /sessions	(API_CONTRACT:215)
POST /admin/accounts/:param/close	(API_CONTRACT:560)
POST /admin/accounts/:param/note	(API_CONTRACT:566)
POST /admin/accounts/:param/unfreeze	(API_CONTRACT:555)
POST /admin/flags/:param/status	(API_CONTRACT:579)
POST /auth/elevate	(API_CONTRACT:116)
POST /auth/logout	(API_CONTRACT:136)
POST /auth/passkey/login/options	(API_CONTRACT:128)
POST /auth/passkey/login/verify	(API_CONTRACT:128)
POST /auth/passkey/register/options	(API_CONTRACT:127)
POST /auth/passkey/register/verify	(API_CONTRACT:127)
POST /auth/verify	(API_CONTRACT:104)
POST /phone/change	(API_CONTRACT:196)
POST /phone/change/:param/cancel	(API_CONTRACT:196)
POST /phone/verify	(API_CONTRACT:180)
POST /sessions/:param/revoke	(API_CONTRACT:215)
TOTAL named by no plan: 23

=== 1b. PER PLAN, AND THE **NEW** SPLIT ===
plan	endpoints	absent	absent&NEW	absent&notNEW	present
M01-rules-engine	4	0	0	0	4
M02-rithmic-bridge	4	1	0	1	3
M03-billing-checkout	8	0	0	0	8
M04-trader-portal	12	0	0	0	12
M05-payout-system	9	3	3	0	6
M06-admin-ops-console	5	0	0	0	5
M07-risk-abuse	0	0	0	0	0
M08-affiliate-system	6	1	1	0	5
M09-marketing-site	5	3	3	0	2
M10-integrations	6	4	4	0	2
M11-certificates-social-proof	7	6	6	0	1
M12-statistic-definitions	0	0	0	0	0
M12-transparency-platform	7	7	7	0	0
M13-trader-analytics-journal	10	8	8	0	2
M14-loyalty-retention	5	5	3	2	0
M15-discord-integration	5	5	5	0	0
M16-notification-center	6	6	6	0	0
M17-offers-engine	7	6	6	0	1
M18-graduation-track	5	4	4	0	1
M19-kyc-identity	8	5	5	0	3
M20-wallet	7	6	4	2	1
M21-plan-designer	8	6	6	0	2
SUM over plans (an endpoint named by two plans counts twice)		76	71	5
DISTINCT absent, every naming row marked **NEW**: 68
DISTINCT absent, at least one naming row NOT marked NEW: 5
   not-NEW: GET /admin/graduation/review-pool	<- M14-loyalty-retention
   not-NEW: GET /wallet	<- M05-payout-system, M20-wallet
   not-NEW: POST /internal/provisioning/retry/:param	<- M02-rithmic-bridge
   not-NEW: POST /offers/redeem	<- M14-loyalty-retention
   not-NEW: POST /wallet/withdrawals	<- M05-payout-system, M20-wallet

=== 3. AGGREGATE ===
API_CONTRACT endpoint DEFINITIONS parsed (with duplicates): 57
API_CONTRACT section 11 rate-limit REFERENCES parsed: 8
distinct endpoints in API_CONTRACT: 57
distinct endpoints named by plans: 107
union: 130
agreeing on both sides: 34
rows a gate would have to turn red on: 96

=== 4. DISAGREEMENTS ===

-- 4a. same route, different parameter SPELLING --
GET /accounts/:param
   GET /accounts/:id	<- M01-rules-engine, M04-trader-portal
   GET /accounts/:accountId	<- M18-graduation-track, API_CONTRACT
GET /accounts/:param/certificate
   GET /accounts/:id/certificate	<- M04-trader-portal
   GET /accounts/:accountId/certificate	<- M11-certificates-social-proof, API_CONTRACT
GET /accounts/:param/eligibility
   GET /accounts/:id/eligibility	<- M01-rules-engine, M04-trader-portal, M05-payout-system
   GET /accounts/:accountId/eligibility	<- API_CONTRACT
GET /accounts/:param/marks
   GET /accounts/:id/marks	<- M04-trader-portal
   GET /accounts/:accountId/marks	<- M13-trader-analytics-journal, API_CONTRACT
GET /accounts/:param/timeline
   GET /accounts/:id/timeline	<- M04-trader-portal
   GET /accounts/:accountId/timeline	<- M13-trader-analytics-journal, API_CONTRACT
GET /plans/:param/versions/:param
   GET /plans/:id/versions/:v	<- M03-billing-checkout, M04-trader-portal
   GET /plans/:planId/versions/:version	<- M09-marketing-site, API_CONTRACT
POST /accounts/:param/payout
   POST /accounts/:id/payout	<- M01-rules-engine, M04-trader-portal, M05-payout-system, API_CONTRACT
   POST /accounts/:accountId/payout	<- API_CONTRACT
POST /accounts/:param/reset
   POST /accounts/:id/reset	<- M03-billing-checkout, API_CONTRACT
   POST /accounts/:accountId/reset	<- API_CONTRACT
POST /admin/accounts/:param/freeze
   POST /admin/accounts/:id/freeze	<- M05-payout-system
   POST /admin/accounts/:accountId/freeze	<- API_CONTRACT
POST /admin/plans/:param/versions
   POST /admin/plans/:id/versions	<- M03-billing-checkout
   POST /admin/plans/:planId/versions	<- M21-plan-designer, API_CONTRACT
POST /admin/plans/versions/:param/publish
   POST /admin/plans/versions/:id/publish	<- M03-billing-checkout, M06-admin-ops-console
   POST /admin/plans/versions/:versionId/publish	<- M21-plan-designer, API_CONTRACT

-- 4b. same PATH, different method sets --

-- 4c. Auth: factor --
distinct API_CONTRACT endpoints carrying an inline "Auth:" line: 15 of 57
occurrences of "Auth:" across all 22 module plans: 0

-- 4d. status codes named in plan endpoint tables --
M03-billing-checkout: | `POST /webhooks/psp/:provider` | Owns | Verify, persist raw, dedupe, then dispatch. Returns 200 on duplicate (a provider that gets a 500 retries forever) and 
M10-integrations: | `GET /support/context` **NEW** | Owns | Section 3.2. Service credential plus an agent assertion, contact reference only, role-scoped response, audited on ever
plan endpoint-table rows naming an HTTP status code: 2

-- 4f. two plans disagreeing on whether an endpoint is **NEW** --
GET /wallet
   NEW	<- M05-payout-system
   not NEW	<- M20-wallet
POST /wallet/withdrawals
   NEW	<- M05-payout-system
   not NEW	<- M20-wallet
NEW-marker disagreements: 2

-- 4g. the ROLE column: is ownership machine readable? --
   Owns	86
   (prose)	31
   Consumes	13
   Serves	2
   Supplies	2
role cells opening with a token: 103; role cells that are free prose: 31
endpoints named by 2 or more plans: 20
   exactly one plan declares Owns: 11
   more than one plan declares Owns (a flat contradiction): 0
   NO plan declares Owns, so the gate cannot attribute it: 9
      GET /accounts/:param	<- M01-rules-engine, M04-trader-portal, M18-graduation-track
      GET /accounts/:param/certificate	<- M04-trader-portal, M11-certificates-social-proof
      GET /accounts/:param/eligibility	<- M01-rules-engine, M04-trader-portal, M05-payout-system
      GET /accounts/:param/marks	<- M04-trader-portal, M13-trader-analytics-journal
      GET /accounts/:param/timeline	<- M04-trader-portal, M13-trader-analytics-journal
      GET /admin/liability	<- M05-payout-system, M06-admin-ops-console
      GET /internal/recon/status	<- M02-rithmic-bridge, M06-admin-ops-console
      GET /plans	<- M03-billing-checkout, M09-marketing-site
      GET /plans/:param/versions/:param	<- M03-billing-checkout, M04-trader-portal, M09-marketing-site

-- 4e. API_CONTRACT disagreeing with ITSELF on a parameter spelling --
POST /accounts/:param/payout
   POST /accounts/:accountId/payout	def@409
   POST /accounts/:id/payout	S11@651
POST /accounts/:param/reset
   POST /accounts/:accountId/reset	def@290
   POST /accounts/:id/reset	S11@652
API_CONTRACT self-disagreements: 2

TOTAL disagreements a gate must pick a side on (4a + 4b + 4e + 4f + 4g): 24

=== 5. WHAT THE SCRIPT COULD NOT PARSE ===
M04-trader-portal	row:265	"The sensitive-action endpoints"	an endpoint-table row whose first cell holds no code span
M05-payout-system	row:328	"/unfreeze"	a path with no method, and none carried forward from the same run
M05-payout-system	row:329	"/enforce"	a path with no method, and none carried forward from the same run
M16-notification-center	row:255	"DELETE"	a bare METHOD with no path: the path is implied by an adjacent code span
M18-graduation-track	row:233	"/decline"	a path with no method, and none carried forward from the same run
TOTAL unparsed: 5

=== 6. THE SAME MEASUREMENT UNDER TWO WIDER READINGS ===
prose endpoints found in plans with no table: 4
   M07-risk-abuse:235	GET /admin/flags
   M07-risk-abuse:235	POST /admin/flags/:id/status
   M07-risk-abuse:235	GET /admin/identities/:id/graph
   M07-risk-abuse:235	POST /checkout
orphans if a gate reads prose too: 21 (was 23)
plan-side absences if a gate reads prose too: 73 (was 73)
parameter-spelling disagreements if a gate reads prose too: 13 (table only, 4a: 11)
   by hand: POST /admin/accounts/:id/unfreeze	M05-payout-system	row 328, `and /unfreeze`	IS in API_CONTRACT
   by hand: POST /admin/payouts/:id/enforce	M05-payout-system	row 329, `and /enforce`	absent from API_CONTRACT
   by hand: DELETE /me/contact-channels	M16-notification-center	row 255, `and DELETE`	absent from API_CONTRACT
   by hand: POST /me/invitations/:id/decline	M18-graduation-track	row 233, `and /decline`	absent from API_CONTRACT
orphans once the four fragments are resolved by hand: 22 (was 23)
plan-side absences once the four fragments are resolved by hand: 76 (was 73)

ALL FOUR READINGS, orphan + plan-side absence = the rows a gate turns red on:
   A. table rows the script parses, verbatim      23 + 73 = 96
   B. A plus M07's prose                          21 + 73 = 94
   C. A plus the four fragments resolved by hand  22 + 76 = 98
   D. B and C together                            20 + 76 = 96
```
