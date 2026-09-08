---
status: approved
depends_on: [README.md, ADR-464.md]
last_updated: 2026-09-08
---

# Price register

**Every labelled price the decision entries set, with its state and who decided
that state.** The corpus prices the work it does not take: an entry that leaves a
repair says, in a clause of its own, what taking it would cost. Until this file
those clauses were load-bearing and invisible. Four rows of the 448s wave were
dispatched against a single one of them, and nothing in `gates.mjs`,
`repo-invariants.mjs` or any lint rule knew the word existed.
[ADR-461](ADR-461.md) section 7 item 2 is the argument and
[ADR-464](ADR-464.md) is the entry that built this.

**This table is READ BY A CHECKER AS A TABLE**, on the same rule that keeps the
four allocation tables in one file: `packages/tooling/checks/price-register.mjs`
parses the first five cells of every row whose second cell is an anchor. A row
shaped otherwise is prose in a table and is skipped, so the legend below is safe
to write here.

## What is derived and what is read

**THE POPULATION IS NEVER TYPED INTO THIS FILE.** The checker enumerates the
idiom out of `docs/decisions/` on every run and compares what it finds against
what is listed here, in both directions. A price with no row and a row with no
price are each a finding. So are a row whose section and item disagree with the
entry, and a path a price cites that is not there.

**THE STATE IS NEVER COMPUTED.** Whether a price is still owed, whether the tree
contradicts it, and whether any state of the tree could settle it are three
readings. [ADR-461](ADR-461.md) reached forty-one of them by reading clauses
against the tree one at a time, over a whole row, and a script that claimed that
work would be inventing it. The checker's job on these two columns is narrower
and it is stated as a rule: **a state outside the vocabulary is a finding, and a
state other than the two defaults with no basis is a finding.** It cannot tell a
correct verdict from a plausible one and it does not try.

**NO TOTAL IS WRITTEN IN THIS FILE.** The tallies are printed by the checker on
every PASS, which is the only place they cannot rot. A count in prose beside a
table is a count that disagrees with the table by the second edit.

## Obligation: is the work still owed

| Value        | Meaning                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPEN`       | The work the price names has not been taken. The default, and it claims nothing, so it needs no basis                                             |
| `DISCHARGED` | A later row took the work. It may have taken it in a shape the price did not describe, which is a matter for the accuracy column and not this one |
| `WITHDRAWN`  | The price was retracted or superseded by a ruling, so there is no longer work to take                                                             |

## Accuracy: does the price describe the tree

| Value         | Meaning                                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNASSESSED`  | Nobody has checked. The default, and it claims nothing, so it needs no basis. **This is the state worth having**: it is how the register shows which load-bearing claims are unread |
| `HOLDS`       | The constraint was checked and the tree supports it                                                                                                                                 |
| `WRONG`       | The tree does not support it. **The clause is NAMED and NOT REPAIRED** where it sits in a dated record, per [ADR-386](ADR-386.md):169                                               |
| `UNCHECKABLE` | There is no tree-side fact that makes it true or false. A ruling about what a type means is not a fact about this tree                                                              |

## How to maintain it

1. **A new price arrives** when an entry opens a clause with the label. Add a row
   with its anchor and where it sits. `OPEN` and `UNASSESSED` are correct on
   arrival and cost no citation.
2. **A row takes the work.** Move the obligation and cite the entry that took it.
3. **A row checks the claim.** Move the accuracy and cite the entry that checked
   it. A verdict with no basis is the thing this register exists to replace.
4. **Never edit a price clause to match this table.** Seven of the wrong prices
   sit in dated records and stay there. The register records their state; it does
   not repair them.

## The register

**`Anchor` is the entry and the line the clause opens on. `Where` is the section,
and the item where the clause opens a numbered one.** Both are derived from the
entry on every run and neither is read from this table. **`Clause opens` is a
mechanical excerpt for a reader scanning the table and is not the price**: the
entry is.

| #   | Anchor        | Where | Obligation | Accuracy    | Basis                         | Clause opens                                                                    |
| --- | ------------- | ----- | ---------- | ----------- | ----------------------------- | ------------------------------------------------------------------------------- |
| 1   | `ADR-445:135` | 8.1   | DISCHARGED | WRONG       | [ADR-461](ADR-461.md) 4       | one guard beside `refuseTenancyColumn` at `:473`, refusing a values key ...     |
| 2   | `ADR-445:137` | 8.2   | OPEN       | WRONG       | [ADR-461](ADR-461.md) 4       | the same guard as item 1, widened, plus one leg in ...                          |
| 3   | `ADR-445:139` | 8.3   | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.3     | a recording handle that answers the proof SELECT with a well-typed row ...      |
| 4   | `ADR-445:141` | 8.4   | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.4     | a row that owns `ci.yml` and can take the citation churn, or a `CI-01` step ... |
| 5   | `ADR-445:143` | 8.5   | DISCHARGED | HOLDS       | [ADR-461](ADR-461.md) 3.5, 5  | one `ignores` entry beside the existing `packages/db/**`, in a file outside ... |
| 6   | `ADR-445:145` | 8.6   | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.6     | a fourth leg reading the same skeleton leg A already builds, with statement ... |
| 7   | `ADR-445:147` | 8.7   | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.7     | an export line in `gates.mjs` and a `generated` flag on its entries, both ...   |
| 8   | `ADR-448:151` | 8.1   | DISCHARGED | HOLDS       | [ADR-461](ADR-461.md) 3.8, 5  | one clause each in `setFor` at `keyed-accessor.test.ts:196` and ...             |
| 9   | `ADR-448:153` | 8.2   | DISCHARGED | HOLDS       | [ADR-461](ADR-461.md) 3.9, 5  | one clause in that guard, one leg change in `generated-column-writes.mjs` ...   |
| 10  | `ADR-448:155` | 8.3   | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.10    | the guard on those builders, plus a change to leg B's probe in ...              |
| 11  | `ADR-448:157` | 8.4   | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.11    | registering the table, which is `ADR-447`'s subject and was ruled against ...   |
| 12  | `ADR-448:159` | 8.5   | DISCHARGED | HOLDS       | [ADR-461](ADR-461.md) 3.12, 5 | an assertion over the builder's body, which is a shape this tree does not ...   |
| 13  | `ADR-448:161` | 8.6   | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.13    | that row's, not this one's.                                                     |
| 14  | `ADR-448:163` | 8.7   | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.14    | a founder ruling, which no row can substitute for.                              |
| 15  | `ADR-451:189` | 11.1  | DISCHARGED | HOLDS       | [ADR-461](ADR-461.md) 3.15, 5 | the one clause at `scoped-db.ts:4690` and the `identityReached` leg change ...  |
| 16  | `ADR-451:191` | 11.2  | OPEN       | WRONG       | [ADR-461](ADR-461.md) 4       | none, unless a founder rules that a dated record's factual error is ...         |
| 17  | `ADR-451:193` | 11.3  | DISCHARGED | HOLDS       | [ADR-461](ADR-461.md) 3.17, 5 | the dispatcher reserving a number in `ALLOCATION` at hand-out time, which ...   |
| 18  | `ADR-451:195` | 11.4  | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.18    | that entry's, unchanged.                                                        |
| 19  | `ADR-451:197` | 11.5  | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.19    | that entry's, unchanged.                                                        |
| 20  | `ADR-451:199` | 11.6  | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.20    | a row holding both files plus a home for a shared test helper, at which ...     |
| 21  | `ADR-451:201` | 11.7  | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.21    | a founder ruling, which no row can substitute for.                              |
| 22  | `ADR-452:204` | 11.1  | DISCHARGED | HOLDS       | [ADR-461](ADR-461.md) 3.22, 5 | one row holding `scoped-db.ts`, the checker and ...                             |
| 23  | `ADR-452:206` | 11.2  | OPEN       | WRONG       | [ADR-461](ADR-461.md) 4       | a founder ruling on whether CI gets a PostgreSQL service, and ...               |
| 24  | `ADR-452:208` | 11.3  | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.24    | that entry's, unchanged, including its warning that leg B's ...                 |
| 25  | `ADR-452:210` | 11.4  | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.25    | that entry's, unchanged.                                                        |
| 26  | `ADR-452:212` | 11.5  | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.26    | a founder ruling, which no row can substitute for.                              |
| 27  | `ADR-452:214` | 11.6  | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.27    | that entry's, unchanged.                                                        |
| 28  | `ADR-452:216` | 11.7  | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.28    | a fixture table outside the registry, or nothing, if a founder rules that ...   |
| 29  | `ADR-454:236` | 8.1   | DISCHARGED | WRONG       | [ADR-461](ADR-461.md) 4       | two lines, both bare substitutions, both line-neutral.                          |
| 30  | `ADR-454:287` | 11.1  | DISCHARGED | WRONG       | [ADR-461](ADR-461.md) 4       | two bare substitutions, both line-neutral, plus a suite run.                    |
| 31  | `ADR-454:288` | 11.2  | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.31    | a founder ruling, which no row can substitute for.                              |
| 32  | `ADR-454:289` | 11.3  | OPEN       | WRONG       | [ADR-461](ADR-461.md) 4       | an environment variable in CI, measured across two sessions that each ...       |
| 33  | `ADR-458:104` | 6     | DISCHARGED | WRONG       | [ADR-461](ADR-461.md) 4       | that variant, its four other call sites left on the void spelling or ...        |
| 34  | `ADR-458:195` | 11.1  | DISCHARGED | WRONG       | [ADR-461](ADR-461.md) 4       | an expression-shaped variant of `refuseTermInValues` returning the values ...   |
| 35  | `ADR-458:196` | 11.2  | DISCHARGED | WRONG       | [ADR-461](ADR-461.md) 4       | a lint rule that no function in `scoped-db.ts` may `throw` outside a ...        |
| 36  | `ADR-458:198` | 11.4  | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.36    | one entry, once PR #741 releases `corpus.yml`. The check already runs ...       |
| 37  | `ADR-459:185` | 9.1   | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.37    | a fifth leg on `write-guard-set.mjs` asserting that every function ...          |
| 38  | `ADR-459:186` | 9.2   | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.38    | one assertion, in the checker, that the rule file contains the literal the ...  |
| 39  | `ADR-459:187` | 9.3   | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.39    | one more leg in this same lint rule, reporting a `refuse[A-Z]` function ...     |
| 40  | `ADR-459:188` | 9.4   | OPEN       | HOLDS       | [ADR-461](ADR-461.md) 3.40    | one line.                                                                       |
| 41  | `ADR-459:189` | 9.5   | OPEN       | UNCHECKABLE | [ADR-461](ADR-461.md) 6       | whoever writes the first one takes the ruling on whether `Promise<void>` is ... |
| 42  | `ADR-461:212` | 10.1  | OPEN       | UNASSESSED  | -                             | none for the six already recorded elsewhere; for the rest, the same founder ... |
| 43  | `ADR-461:214` | 10.2  | OPEN       | UNASSESSED  | -                             | a `services:` block copied from `corpus.yml:164` onto `CI-02 unit and ...       |
| 44  | `ADR-461:216` | 10.3  | OPEN       | UNASSESSED  | -                             | a widening of whatever derives a citation set so that a prose pointer of ...    |
| 45  | `ADR-461:218` | 10.4  | DISCHARGED | UNASSESSED  | [ADR-464](ADR-464.md) 5       | a `CI-06` letter or an `RI-nn` asserting that every labelled price names a ...  |
| 46  | `ADR-461:220` | 10.5  | OPEN       | UNASSESSED  | -                             | that entry's, unchanged.                                                        |
| 47  | `ADR-461:222` | 10.6  | OPEN       | UNASSESSED  | -                             | a row whose subject is turning the forcing-constraint filter into a ...         |
| 48  | `ADR-461:224` | 10.7  | OPEN       | UNASSESSED  | -                             | a founder ruling, which no row can substitute for.                              |

## What this register does not cover, stated as a bound

**IT COVERS ONE IDIOM AND NOT EVERY FORCING CLAIM.** [ADR-461](ADR-461.md)
section 8 measured a second population, a keyword union over sections headed for
work an entry did not take, and refused to call it a population because its
precision was never measured. That row is still owed and section 10 item 6 prices
it. Nothing here claims anything about a claim outside the labelled idiom.

**IT COVERS THE DECISION ENTRIES AND NOTHING ELSE.** A price quoted into
[ALLOCATION](ALLOCATION.md) by a dispatcher, or into a session log by the row that
wrote it, is a quotation of a price set in an entry and is not a second price.
The checker reads `docs/decisions/ADR-*.md` and no other file, which is why this
document can quote the idiom in its own prose without growing the population.

**A QUOTATION IS NOT AN INSTANCE.** The checker blanks code spans and fenced
blocks before it looks, so an entry that writes about pricing does not price
anything by doing so. [ADR-461](ADR-461.md) carries three such quotations on one
line.

**THE PATH LEG SEES A PATH ONLY WHERE THE PRICE LINKS IT.** A clause naming a
file in a bare code span with no link behind it is invisible to it. That is the
same hole [ADR-461](ADR-461.md) section 7 item 1 found in the citation discipline
at large, where a prose pointer of the form "its own `:270`" is enumerable by no
derivation in this corpus. The checker reports the leg's coverage as a fraction of
the population on every PASS so the bound is a number a reader sees rather than a
caveat they have to find.

**A STALE STATE IS INVISIBLE HERE.** A price marked `OPEN` whose work landed
yesterday stays `OPEN` until a reader moves it. This file converts an unwritten
convention into a written one with a tripwire on it, and that is the whole of the
claim.
