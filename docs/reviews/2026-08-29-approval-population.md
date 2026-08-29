# The approval population, separated and counted: 108 proposed entries, 42 of them carrying money-path code, 2026-08-29

**A review record under [ADR-033](../decisions/ADR-033.md), not a plan and not a ruling.** It sits
outside the corpus ([`gates.mjs:165`](../../scripts/corpus/gates.mjs) excludes `docs/reviews/` from
`isCorpusDocument`), so it carries no frontmatter, appears in no INDEX, and binds nothing by
existing. **The ruling it feeds is [ADR-227](../decisions/ADR-227.md).** This file is the
measurement and nothing else: every number below is a command and its output, and every command
names the scope it ran over.

**Tree measured:** `origin/main` at `21afc5d8`, working tree clean of source edits.

**ONE THING ABOUT REPRODUCIBILITY, STATED FIRST BECAUSE IT INVALIDATES A NAIVE RE-RUN.** This
session's clone arrived **shallow**: `git rev-parse --is-shallow-repository` returned `true` and
`.git/shallow` held **15** boundary commits. Every git-provenance number in section 3 was derived
**after** `git fetch --unshallow`, which took the log from **243** commits to **3434**. A re-run in a
shallow clone silently collapses section 3: the first-parent search returns a boundary merge for
**89** of the 108 entries rather than each entry's own. That was observed, not theorised, and it is
recorded because the wrong number looked entirely plausible.

---

## 1. Why the number `111` had to be separated before anything could be ruled

The founder's instruction of 2026-08-29 names *"111 adrs or money path e2 reads"* as one population.
It is two, and they are different objects wearing the same signature box:

- an **approval line on a ruling**, which attests that a decision was taken with authority, and
- an **`E2` line-by-line read of a money-path diff**, which the constitution reserves for a human
  at [`MERIT_BUILD_MASTER_PROMPT.md:395`](../../MERIT_BUILD_MASTER_PROMPT.md), inside the
  base-rates bullet of section `E2` at [`:392`](../../MERIT_BUILD_MASTER_PROMPT.md), because a model
  reviewing model-written code is not a control.

A single count over both cannot be acted on, because the two have opposite remedies. Sections 2 and
3 separate them.

## 2. The entry population, derived live

```
$ ls docs/decisions/ADR-*.md | wc -l
212

$ for f in docs/decisions/ADR-*.md; do head -1 "$f" | grep -o 'status: [a-z]*'; done \
    | sort | uniq -c
    104 status: accepted
    108 status: proposed
```

**Scope of that claim: 212 files matching `docs/decisions/ADR-*.md` carry a `status:` token in
their first line; 108 of those tokens read `proposed` and 104 read `accepted`.** The status is read
from the entry's own heading, which is the same source
[ADR-088](../decisions/ADR-088.md)'s generated registry span reads, so this count cannot drift from
[decisions/README.md](../decisions/README.md).

**`111` is therefore three high against the entries today.** No entry was signed by this session and
none was unsigned by it; the difference is that the founder's number was spoken over a tree that has
moved, which is itself the argument against a queue measured by hand.

### 2.1 What the 108 say about their own owed read

```
$ P=$(for f in docs/decisions/ADR-*.md; do head -1 "$f" | grep -q 'status: proposed' && echo "$f"; done)
$ echo "$P" | xargs grep -li 'read is owed' | wc -l
61
```

| Of the 108 `proposed` entries | Count |
| --- | ---: |
| contain the string `read is owed` | **61** |
| do not | **47** |

And within the 61, read at their own sentences:

| Classification, from the entry's own words | Count |
| --- | ---: |
| says explicitly that **no** read is owed (`ADR-167`, `ADR-174`, `ADR-211`, `ADR-224`) | **4** |
| **defers** the read to a diff that does not exist yet (*"owed on the diff that"*, *"on the first caller that"*, *"on the routes these rows produce"*) | **12** |
| asserts a read owed against something already in the tree | **45** |

**The 12 are the finding of this subsection.** An owed read on an unwritten diff is not a queue
item, because nothing exists to read. Counting it as one inflates the backlog by items no session
can ever discharge, and a backlog nobody can drain is the defect this whole exercise exists to
name.

## 3. The money-path population, derived from git rather than from prose

Section 2 reads what entries **say**. This section reads what they **landed**, because an entry's
own declaration is prose and [ADR-042](../decisions/ADR-042.md) already ruled that prose is not a
control.

For each `proposed` entry, the landing merge is the first-parent commit on `origin/main` that added
the entry file, and the diff taken is that merge against its first parent:

```
m=$(git log --first-parent --diff-filter=A --format=%H origin/main -- "$f" | tail -1)
git diff --name-only "$m^1" "$m" | grep -E '^(apps|packages)/' \
  | grep -vE '/(test|tests)/|\.test\.|/fixtures/'
```

**79 of the 108** `proposed` entries landed at least one non-test file under `apps/` or `packages/`.
**29 landed none** and are documentation rulings by construction.

### 3.1 The money-path predicate, written out so it can be argued with

The constitution reserves the read for `rules-engine/`, `payout/`, `ledger/` and auth
([`:358`](../../MERIT_BUILD_MASTER_PROMPT.md), [`:395`](../../MERIT_BUILD_MASTER_PROMPT.md)).
Migrations are added because [CLAUDE.md](../../CLAUDE.md) makes them unamendable once merged.
Transcribed to this tree's layout, the predicate is:

```
^(packages/(rules-engine|ledger|psp|rail)/
 |packages/db/migrations/
 |packages/db/src/(scope|scoped-db)\.ts$
 |apps/api/src/(auth-backend|csrf|turnstile|db)\.ts$
 |apps/api/src/routes/(payouts|admin-payouts|checkout|auth
                      |wallet|wallet-withdrawals|admin-wallet)\.ts$
 |apps/worker/src/(batch|breaker|provisioning)/)
```

**THE THREE WALLET ROUTES WERE ADDED AFTER DISPATCH REVIEW OF THE FIRST DRAFT, ON THE DISPATCHER'S
RULING OF 2026-08-29, AND THE BEFORE AND AFTER ARE BOTH REPORTED IN SECTION 7 RATHER THAN THE OLD
NUMBERS BEING PATCHED.** The ground was checked at source before the widening was taken: **a wallet
spend is money movement.** [`2026-08-29-d2-controls-audit.md:80`](2026-08-29-d2-controls-audit.md)
records checkout's `RATE_LIMITED` as `INV-M20-07`'s *"wallet SPEND velocity, a money control per
identity, not a request rate limit per IP"*, and
[`admin-wallet.ts:111`](../../apps/api/src/routes/admin-wallet.ts) carries the
`dual_control_threshold_cents` constraint. All three files exist on `main` today.

**This predicate is a judgement and it is stated so.** `packages/psp/` and `packages/rail/` are in
because money enters and settles through them; `packages/db/src/scope.ts` and `scoped-db.ts` are in
because they are the identity-scoped accessor Appendix `D2` names, and E2's own cited failure class
is *"access control, authorization bypass, and trust boundaries"*. A reader who disagrees with a
member changes one line and re-runs.

### 3.2 The result

| Over the 108 `proposed` entries | Count |
| --- | ---: |
| landed **at least one money-path file** in their landing merge | **42** |
| landed **no** money-path file | **66** |
| **distinct money-path files** landed under a `proposed` entry | **62** |

**So the founder was told 26 money-path reads and the derived figure is 42 entries over 62 files.**
The queue is larger than the number it was declined at, not smaller. That direction matters: it
removes "just read them" as an option on arithmetic rather than on preference, and it is the reason
[ADR-227](../decisions/ADR-227.md) reaches for an assertion rather than for a reader.

The 42, by entry:

```
ADR-102 ADR-104 ADR-105 ADR-106 ADR-107 ADR-112 ADR-113 ADR-120 ADR-122 ADR-123
ADR-126 ADR-127 ADR-128 ADR-140 ADR-157 ADR-164 ADR-169 ADR-171 ADR-174 ADR-175
ADR-176 ADR-177 ADR-180 ADR-183 ADR-186 ADR-187 ADR-189 ADR-191 ADR-192 ADR-193
ADR-197 ADR-199 ADR-200 ADR-207 ADR-209 ADR-211 ADR-212 ADR-213 ADR-216 ADR-221
ADR-225 ADR-226
```

The money-path files most often landed under an unsigned entry, by number of distinct entries:

| File | Entries |
| --- | ---: |
| [`apps/api/src/routes/payouts.ts`](../../apps/api/src/routes/payouts.ts) | 8 |
| [`packages/db/src/scoped-db.ts`](../../packages/db/src/scoped-db.ts) | 7 |
| [`packages/db/src/scope.ts`](../../packages/db/src/scope.ts) | 7 |
| [`packages/rail/src/settlement.ts`](../../packages/rail/src/settlement.ts) | 4 |
| [`apps/api/src/routes/checkout.ts`](../../apps/api/src/routes/checkout.ts) | 4 |
| [`apps/api/src/routes/auth.ts`](../../apps/api/src/routes/auth.ts) | 4 |
| [`packages/ledger/src/chart.ts`](../../packages/ledger/src/chart.ts) | 3 |
| [`apps/api/src/db.ts`](../../apps/api/src/db.ts) | 3 |
| [`apps/api/src/auth-backend.ts`](../../apps/api/src/auth-backend.ts) | 3 |

**A second, independent count of the same surface**, taken from the migration headers rather than
from git, and already a generated span in [INDEX](../INDEX.md):

```
$ grep -l 'E2 READ: MONEY PATH' packages/db/migrations/*.sql | wc -l
49
$ ls packages/db/migrations/*.sql | wc -l
63
```

**49 of 63 merged migrations declare themselves part of the founder's read set.** **Fifteen of
those 49 landed under an entry that is still `proposed`**, by section 3.2's derivation, and all
fifteen carry the header: `0048`, `0049`, `0050`, `0051`, `0052`, `0053`, `0054`, `0055`, `0056`,
`0057`, `0059`, `0063`, `0065`, `0066`, `0067`. A migration is never edited once merged, so those
fifteen are the part of the backlog that can only ever be discharged by a read or superseded by
another migration.

## 4. The residue: where no mechanical assertion is available

[ADR-227](../decisions/ADR-227.md) rules that a money-path approval is earned by a named mechanical
assertion rather than granted by a reader. The residue is what that leaves: money-path diffs whose
central claim is a **choice** rather than a checkable property.

The set is derived from the entries' own `What a founder read adds` blocks, which
`RI-13` already requires on every unsigned entry, so the classifier is the entry's own words:

```
of the 42 money-path entries, the founder-read block declares an outstanding
judgement in  30  and declares none in  12
```

**Thirty, ranked by how much money moves through the diff.** The rank is a judgement about
consequence, stated so it can be argued with: tier 1 is money leaving the firm, tier 6 is a
money-path file touched by a decision that is not itself about money movement.

### Tier 1: money leaving the firm (9)

Payout request, payout approval, and rail settlement. A wrong decision here moves an account's whole
balance to the wrong party or at the wrong time.

| Entry | The judgement it declares |
| --- | --- |
| [ADR-176](../decisions/ADR-176.md) | the request path records the approval and does not post it, and the key it must store to make that safe |
| [ADR-192](../decisions/ADR-192.md) | the thirteen keep their `503` and stop disclosing it before authenticating |
| [ADR-140](../decisions/ADR-140.md) | the identity-status term of `G-ELIGIBLE` is a named refusal and never a gate result |
| [ADR-199](../decisions/ADR-199.md) | a figure is owed a column when it cannot be derived, never when it is merely not stored |
| [ADR-191](../decisions/ADR-191.md) | a row that reaches an identity two different ways is scoped by both, and the sixth class is `either` |
| [ADR-175](../decisions/ADR-175.md) | an idempotency key names the EVENT and never the DOOR |
| [ADR-174](../decisions/ADR-174.md) | `LT-07` is a posting whose two legs are on the wrong sides, so no code is minted |
| [ADR-177](../decisions/ADR-177.md) | four of seven account kinds are ruled and `firm_treasury` is refused |
| [ADR-212](../decisions/ADR-212.md) | a citation proves the cited line is part of what the sentence names |

### Tier 2: the ledger, the record of what is owed (4)

| Entry | The judgement it declares |
| --- | --- |
| [ADR-104](../decisions/ADR-104.md) | the imbalance is unrepresentable, and a halt is only a halt because this code path honours it |
| [ADR-157](../decisions/ADR-157.md) | a read may narrow by a range and by `IS NULL` and a write may not, and the lock is a row lock |
| [ADR-183](../decisions/ADR-183.md) | an identity's three ledger positions are opened by the database when the identity is created |
| [ADR-186](../decisions/ADR-186.md) | the last two codes are both assets, and shape (iii) becomes unrepresentable rather than refused |

### Tier 3: money entering (4)

| Entry | The judgement it declares |
| --- | --- |
| [ADR-105](../decisions/ADR-105.md) | the PSP port is the ORDER and the vendor is the mechanics |
| [ADR-225](../decisions/ADR-225.md) | `zod at every boundary` names a mechanism this workspace has never had |
| [ADR-123](../decisions/ADR-123.md) | on a genuinely empty production book the nightly self-audit now fails, on day one |
| [ADR-113](../decisions/ADR-113.md) | the creative-submission row is written from the constraints rather than from the plan's sentence |

### Tier 4: the engine that decides whether a payout is owed at all (3)

| Entry | The judgement it declares |
| --- | --- |
| [ADR-207](../decisions/ADR-207.md) | `rule_states` stores `lifetime_settled_cents`, `breached` and `breach_kind`, and the state hash is declined |
| [ADR-122](../decisions/ADR-122.md) | `input_digest` is taken over the computation's own argument and EXCLUDES the answer |
| [ADR-127](../decisions/ADR-127.md) | Stryker is admitted under a delegated `VG-12` grant, with no threshold written at all |

### Tier 5: who is allowed to be the party (6)

E2's own named failure class. A wrong decision here does not move money by itself; it lets the wrong
identity stand where a party should be, and every tier above then behaves correctly for the wrong
person.

| Entry | The judgement it declares |
| --- | --- |
| [ADR-106](../decisions/ADR-106.md) | a row whose subject is a PAIR of identities belongs to both and is scoped to neither |
| [ADR-102](../decisions/ADR-102.md) | the accessor writes inside a transaction it also produces, and a third door serves rows that belong to nobody |
| [ADR-112](../decisions/ADR-112.md) | the accessor learns to name ONE ROW, and six writes are removed rather than documented |
| [ADR-226](../decisions/ADR-226.md) | the Turnstile outage posture is fail closed, and the cost is blocked sign-ins |
| [ADR-120](../decisions/ADR-120.md) | `apps/api` joins the admission list, and the auth surface is wired |
| [ADR-171](../decisions/ADR-171.md) | the third door is REFUSED, on a measurement rather than on the argument it was allocated against |

### Tier 6: append-only guarantees, provisioning, and roles (4)

| Entry | The judgement it declares |
| --- | --- |
| [ADR-169](../decisions/ADR-169.md) | `cooling_until` is `NOT NULL` because a nullable one fails OPEN |
| [ADR-128](../decisions/ADR-128.md) | the audited write, and the table `OI-01` has been waiting on |
| [ADR-164](../decisions/ADR-164.md) | the live cache is reachable only by a fifth role, and the grant is a `REVOKE` against `0026`'s default |
| [ADR-107](../decisions/ADR-107.md) | the provisioning saga admits nobody it cannot produce evidence for, and five of seven operations have no inverse |

### 4.1 What this list is not

**It is not thirty diffs to read line by line.** Each row is a **decision**, one or two sentences
long, already written out by the entry that took it. The entry holds the derivation; the row holds
the question. That is the difference between a queue a founder declines and a list a founder
answers.

**And it is not final.** Every row leaves the residue the moment somebody writes an assertion that
fails when the decision is wrong. Tier 4's `ADR-122` is the clearest candidate: *"`input_digest`
excludes the answer"* is a property a test can hold, and a test that holds it retires the row
without a reading. **No such assertion was written here**, because writing one is code and this
row's fence is documentation. How many of the thirty are reachable that way is not measured and is
deliberately not guessed: the entry that takes each row says whether its own decision is
falsifiable, and a count asserted here would be the exact thing section 5 warns about.

## 5. What this measurement does not establish

- **It does not say the 42 entries are wrong.** It says no human has read them and no named
  assertion currently stands in for one.
- **It reads landing merges, not authorship.** An entry whose landing merge carried a money-path
  file it did not itself cause is counted in the 42. That direction is deliberate: a false positive
  is an argument somebody has, and a false negative is a money-path diff nobody looks at.
- **It does not measure test coverage per file.** A first attempt did, by matching file basenames
  against test bodies, and the result was noise (`packages/psp/src/port.ts` scored 249). The number
  is omitted rather than published wrong.
- **It classifies 30 entries by a regular expression over their own prose.** The block is required
  by `RI-13`, so the block is always there; whether the sentence inside it names a judgement is read
  by pattern, and a rewording moves an entry between tiers with nothing failing.

## 6. Re-derived on the merge with `main` at `dddb3860`, taken after the counts above

**`main` moved to `dddb3860` while this branch was open**, carrying
[ADR-223](../decisions/ADR-223.md) (session 413, the security headers). It was
merged in rather than rebased, per the git workflow. **The counts in sections 2
and 3 are facts about the `21afc5d8` baseline they name and are not rewritten.**
Re-derived on the merged tree:

| Re-derived at `dddb3860` merged | Count |
| --- | ---: |
| files matching `docs/decisions/ADR-*.md` | **214** |
| `status: proposed` (108 at the baseline, plus `ADR-223` and `ADR-227`) | **110** |
| `status: accepted` | **104** |
| of the `proposed` entries, landing at least one money-path file | **42**, unchanged |

**AND THE ARRIVAL FOUND A HOLE IN THE PREDICATE, WHICH IS WORTH MORE THAN THE
COUNT.** `ADR-223` says of itself *"The `E2` read is owed on
[`apps/api/src/security-headers.ts`]"*, and **section 3.1's predicate does not
match that file**: it names `auth-backend.ts`, `csrf.ts`, `turnstile.ts` and
`db.ts` under `apps/api/src/`, and nothing else. So the entry **declares an owed
read that this measurement does not count.**

**The derived 42 is therefore a FLOOR and not a total.** The direction is the
safe one for a count of unread diffs, but it is not the direction the review
claimed in section 5, which said the predicate errs toward false positives.
**Both are true at once**: the predicate over-counts by reading landing merges
rather than authorship, and it under-counts by naming files rather than
properties. **Neither error is repaired here**, because widening it now would be
a session changing the size of its own residue, which is exactly the move
[ADR-227](../decisions/ADR-227.md) section 6 condition 4 forbids elsewhere.
**It is the third question put to the founder**, and this is the first live
evidence that it is a real question rather than a formality.

## 7. Re-derived against `dddb3860` with the predicate widened, and the widening changed no entry

**Both readings are reported rather than the earlier one being patched.** Sections 2 and 3 are facts
about the `21afc5d8` baseline they name, taken with the narrow predicate. This section is the merged
base with the three wallet routes added.

| | narrow, at `21afc5d8` | widened, at `dddb3860` merged |
| --- | ---: | ---: |
| files matching `docs/decisions/ADR-*.md` | 212 | **214** |
| `status: proposed` | 108 | **110** |
| `status: accepted` | 104 | **104** |
| `proposed` entries landing at least one money-path file | 42 | **42** |
| distinct money-path files under a `proposed` entry | 62 | **64** |
| the residue, by the entries' own founder-read blocks | 30 | **30** |

**THE WIDENING ADDED TWO FILES AND NOT ONE ENTRY, AND THAT IS THE RESULT WORTH READING.** The two
are [`wallet-withdrawals.ts`](../../apps/api/src/routes/wallet-withdrawals.ts) under
[ADR-176](../decisions/ADR-176.md) and [`admin-wallet.ts`](../../apps/api/src/routes/admin-wallet.ts)
under [ADR-192](../decisions/ADR-192.md), and **both entries were already in the 42 and already in
tier 1**, because each also landed `payouts.ts` or `admin-payouts.ts`. **The entry set is byte for
byte the same 42 and the residue is the same 30**, so **the tier table does not move.**

**That is evidence about the predicate's shape rather than about its membership.** A definition
whose widening changes which files are named and not which entries are owed is measuring the entry
population robustly, which is what section 3.2's counts are for.

**AND THE HOLE THAT PROMPTED THE QUESTION IS STILL OPEN.** [ADR-223](../decisions/ADR-223.md)
declares *"The `E2` read is owed on [`apps/api/src/security-headers.ts`]"*, and **the widened
predicate still does not match that file.** The widening addressed wallet routes; the miss that
found the question was a security-headers file, and it was not closed by the ruling that answered it.
**So 42 remains a FLOOR and not a total, and the residue of 30 is a floor with it.** Stated here
rather than absorbed, because the second half of a corrected finding is the half that gets dropped.

**`ADR-227` ITSELF IS ONE OF THE 110** and is not yet on `main`, so it has no landing merge and is
counted by its heading alone. It lands no money-path file, is class A by its own section 5, and is
**UNSIGNED**.

## 8. Re-derived against `a86971c6`, with the residue classifier CORRECTED UPWARD

**`main` moved again**, carrying [ADR-228](../decisions/ADR-228.md) (the dual-control threshold) and
[ADR-229](../decisions/ADR-229.md) (OTP delivery). Merged in, not rebased. Four files conflicted and
every one is a shared registry: `STATE`, `ALLOCATION`, `decisions/README`, `sessions/README`. Each
was resolved by taking the side that owns the row, and **the generated header spans in `STATE.md`
were taken from ONE side rather than both**, because a keep-both there duplicates the six sites and
gives 13 where the file holds 7. That was caught by counting the spans, not by a gate.

| | `21afc5d8` | `dddb3860` | **`a86971c6`** |
| --- | ---: | ---: | ---: |
| entry files | 212 | 214 | **216** |
| `status: proposed` | 108 | 110 | **112** |
| `status: accepted` | 104 | 104 | **104** |
| money-path entries | 42 | 42 | **44** |
| money-path files | 62 | 64 | **65** |
| the residue, **first classifier** | 30 | 30 | 30 |
| **the residue, corrected classifier** | (34) | (34) | **36** |

**THE WIDENED PREDICATE EARNED ITS KEEP ON ARRIVAL.** `ADR-228` lands
[`admin-wallet.ts`](../../apps/api/src/routes/admin-wallet.ts), which is one of the three routes
added at section 3.1 and which the narrow predicate would have missed entirely. `ADR-229` lands
`auth.ts` and `auth-backend.ts`, which the narrow predicate already held.

### 8.1 The residue classifier was under-inclusive, and the correction runs against this session's interest

**The first classifier matched the NOUN and missed the VERB.** It tested for *"judgement"*, *"a
choice"*, *"is the founder's"* and their relatives. **It did not test for *"the first thing to
decide"***, which is the form `ADR-228` and `ADR-229` both use while asking three questions each:

> **THE FIRST THING TO DECIDE IS WHETHER `500000` IS STILL YOUR ANSWER NOW THAT YOU KNOW WHAT COLUMN
> IT LANDS ON.**

**That block declares an outstanding judgement in every sense the ruling cares about, and the
classifier scored it as declaring none.** Corrected to match both spellings, and the count moves
**30 to 36** over 44 entries, or 34 over the earlier 42.

**Six entries were missed**: [ADR-211](../decisions/ADR-211.md), [ADR-213](../decisions/ADR-213.md),
[ADR-216](../decisions/ADR-216.md), [ADR-221](../decisions/ADR-221.md), `ADR-228` and `ADR-229`.

**THIS IS THE SAME DEFECT AS THE PREDICATE HOLE, ONE LAYER OUT, AND IT IS THE SECOND TIME TODAY.** A
pattern over prose misses entries that phrase the thing differently, whether the pattern names files
or names words. **Both errors were found by a document arriving rather than by anything in this
repository**, and neither would have been found by re-reading the measurement. The durable repair is
the same in both cases: **read each entry's own declaration rather than pattern-matching around it.**

**The correction is reported because it makes the residue LARGER.** A measurement corrected only when
the correction flatters the measurer is not a measurement.

### 8.2 The residue at `a86971c6`: thirty-six, re-tiered

The six recovered entries take their tier from the same rule as the rest: the highest surface their
landing merge touched.

| Tier | Entries | Count |
| --- | --- | ---: |
| **1** money leaving the firm | `ADR-176` `ADR-192` `ADR-140` `ADR-199` `ADR-191` `ADR-175` `ADR-174` `ADR-177` `ADR-212` **`ADR-211`** **`ADR-228`** | **11** |
| **2** the ledger | `ADR-104` `ADR-157` `ADR-183` `ADR-186` | **4** |
| **3** money entering | `ADR-105` `ADR-225` `ADR-123` `ADR-113` | **4** |
| **4** the engine | `ADR-207` `ADR-122` `ADR-127` **`ADR-213`** **`ADR-216`** | **5** |
| **5** who is allowed to be the party | `ADR-106` `ADR-102` `ADR-112` `ADR-226` `ADR-120` `ADR-171` **`ADR-221`** **`ADR-229`** | **8** |
| **6** append-only, provisioning, roles | `ADR-169` `ADR-128` `ADR-164` `ADR-107` | **4** |

**Two of the six land in tier 1**, which is the part worth reading twice.
[ADR-211](../decisions/ADR-211.md) lands
[`payouts.ts`](../../apps/api/src/routes/payouts.ts) and
[ADR-228](../decisions/ADR-228.md) lands
[`admin-wallet.ts`](../../apps/api/src/routes/admin-wallet.ts) with migration `0068`. **`ADR-228`'s
own block says its number governs how much an admin can credit a trader's wallet without a second
key, and asks whether `500000` is still the answer now that the column is known.** That is a tier 1
decision by any reading, and the first classifier scored it as declaring no judgement at all.

**And `ADR-228` section 5 carries a finding this review did not go looking for**, quoted because it
belongs in front of whoever reads the residue: **no payout path in this tree carries dual control at
any amount.**

## 9. Re-derived against `bfe690fb`

**`main` moved a third time**, carrying [ADR-230](../decisions/ADR-230.md) (the `pair` class write
door) and [ADR-232](../decisions/ADR-232.md) (the withdrawal approval edge). Merged in, not rebased.
**Only `STATE.md` conflicted, and it was resolved by taking MAIN'S side rather than keeping both**:
`main` had deliberately collapsed six duplicate copies of the generated header line into one, under
`RI-12`, and a keep-both would have re-inflated exactly what that repair removed.

**THAT DUPLICATION WAS CAUGHT TWICE TODAY BY TWO DIFFERENT MEANS AND NEITHER WAS A GATE THIS SESSION
RAN.** Section 8 records this session catching its own keep-both by counting spans; `main`'s
`d120098d` records `RI-12` catching twelve copies independently. **The lesson is the same both
times: on a generated block whose two sides hold the same sites, take one side.**

| | `21afc5d8` | `dddb3860` | `a86971c6` | **`bfe690fb`** |
| --- | ---: | ---: | ---: | ---: |
| entry files | 212 | 214 | 216 | **218** |
| `status: proposed` | 108 | 110 | 112 | **114** |
| `status: accepted` | 104 | 104 | 104 | **104** |
| money-path entries | 42 | 42 | 44 | **46** |
| money-path files | 62 | 64 | 65 | **66** |
| the residue, corrected classifier | 34 | 34 | 36 | **38** |

**Both new entries are money path and both are tier 1.** `ADR-230` lands
[`payouts.ts`](../../apps/api/src/routes/payouts.ts) and `ADR-232` lands
[`wallet-withdrawals.ts`](../../apps/api/src/routes/wallet-withdrawals.ts) with migration `0070`. So
**tier 1 becomes 13** and the table is **13 / 4 / 4 / 5 / 8 / 4**.

**AND `ADR-232` ANSWERS THE FINDING SECTION 8.2 RECORDED FROM `ADR-228`.** That finding was *"no
payout path in this tree carries dual control at any amount"*. `ADR-232` builds the approval edge and
dual controls it above `500000` cents on an operator's hand alone. **The finding was recorded here
rather than absorbed, and it was closed by the session that owned it**, which is the intended
behaviour of writing a gap down outside your own fence rather than acting on it.

**THE TREND IS THE POINT OF THIS TABLE.** The money-path queue has grown from 42 to 46 in one
afternoon while nobody read any of it, and **it will keep growing at roughly the rate the build ships**.
That is the argument for [ADR-227](../decisions/ADR-227.md)'s class B stated as a measurement rather
than as a prediction: a queue drained only by reading loses ground to a queue filled by building.

## 10. Re-derived against `6613b8f9`, and every number below was taken at the moment it was written

**`main` moved a fourth time**, carrying [ADR-231](../decisions/ADR-231.md) (`db.publicLookup` and
the verify door). Merged in, not rebased. **`docs/STATE.md` was the only conflict and it was resolved
ADDITIVELY**: this session's merge note and session 421's record are disjoint, neither supersedes the
other, and both were kept. **`RI-12` was checked immediately afterward and passes**: the
`gen:adr_count` line stands at **3** sites, not twelve, and no substantial line under `docs/` repeats
more than eight times.

| | `21afc5d8` | `dddb3860` | `a86971c6` | `bfe690fb` | **`6613b8f9`** |
| --- | ---: | ---: | ---: | ---: | ---: |
| entry files | 212 | 214 | 216 | 218 | **219** |
| `status: proposed` | 108 | 110 | 112 | 114 | **115** |
| `status: accepted` | 104 | 104 | 104 | 104 | **104** |
| money-path entries | 42 | 42 | 44 | 46 | **47** |
| money-path files | 62 | 64 | 65 | 66 | **66** |
| the residue, corrected classifier | 34 | 34 | 36 | 38 | **39** |

Also derived at `6613b8f9`, replacing the earlier figures rather than carrying them:

| | Count |
| --- | ---: |
| `proposed` entries containing `read is owed` | **67** |
| merged migrations carrying `E2 READ: MONEY PATH`, of 65 | **51** |
| migrations landed under an entry still `proposed` | **17** |

**`ADR-231` is tier 1**: it lands [`payouts.ts`](../../apps/api/src/routes/payouts.ts) alongside
`db.ts` and `scoped-db.ts`. So **tier 1 becomes 14** and the table is **14 / 4 / 4 / 5 / 8 / 4**.

**THE TREND HELD FOR A FOURTH READING AND IT IS THE MEASUREMENT THAT MATTERS MOST HERE.** In one
afternoon the money-path queue went **42, 44, 46, 47**, the residue **34, 36, 38, 39**, and the
migrations owed under an unsigned entry **15, then 17**. **Nobody read any of it in that time.** The
queue is not merely undrained; it is filling faster than any reader could drain it, and that is a
fact about this repository rather than an argument about it.
