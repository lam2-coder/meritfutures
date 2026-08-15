---
status: approved
depends_on: [README.md]
last_updated: 2026-08-15
---

# Number allocation

The three allocation registries, kept in one document because each is read AS A
TABLE: `CI-06f` and `CI-06h` call one shared parser over the first cell of every
row. A table split into a file per row is not a table, which is the same reason
`DELTA_MANIFEST` stays single under [ADR-043](ADR-043.md).

## Number allocation, and why this table exists

**An ADR number is claimed here before it is written.** Two branches forking from the same `main` both read the registry, both find the same maximum, and both take the next integer. Neither is wrong locally; the corpus is broken the moment the second merges. **[ADR-034](ADR-034.md) rules the allocation, and [CI-06f](../testing/STRATEGY.md) enforces it.**

| Numbers | Claimed by | State |
|---|---|---|
| 001 to 032 | merged to `main` | **allocated.** 026 to 030 are the schema-delta fold; 031 and 032 are the `published_statistics` rulings. **They landed with PR #4 on 2026-08-14**, and their numbers are now cited inside merged migration comments, `DELTA_MANIFEST` and `DATA_MODEL`, which is why they were the ones that did not move |
| **033** | merged to `main` (PR #5) | **allocated.** The citation-reviewer ADR, renumbered from `031` on that branch under the ruling below |
| **034** | merged to `main` (PR #6) | **allocated.** The allocation ruling itself, and the COUNT GATE |
| **035** | merged to `main` (PR #9) | **allocated.** The `plan_versions` immutability-trigger defect, ruled at the PR #7 / PR #8 reconciliation. **The fix is `0028`, which merged with it, and the structural fix is `CI-06j`.** This row said `reserved, unmerged` until 2026-08-15, four commits after the merge that made it false |
| **036** | merged to `main` (PR #13) | **allocated.** The migration number allocation table below, and `CI-06h`'s allocation half. **This row said `reserved, unmerged` until 2026-08-15**, which is the second time the State column has been found stale after a merge and is why [ADR-036](ADR-036.md) records that the column is prose rather than a checked fact |
| **037** | merged to `main` (PR #15) | **allocated.** A shorthand may not restate a value the config owns. **This row said `reserved, unmerged` until 2026-08-15**, three commits after the merge that falsified it |
| **038** | merged to `main` (PR #15) | **allocated.** A CI stage states, in its own output, what it currently proves. **Stale in exactly the same way and corrected in the same commit**, which makes four |
| **039** | `claude/corpus-workflow-founder-rulings-py70hi`, the [FOLD-01](../plans/FOLD-01-phone-identity.md) fold | **written on the branch, unmerged.** Passwordless auth, and phone as a first-class identity signal |
| **040** | `claude/corpus-workflow-founder-rulings-py70hi`, the [FOLD-02](../plans/FOLD-02-enforcement-window-and-suspension.md) fold | **written on the branch, unmerged.** The payout enforcement window |
| **041** | `claude/corpus-workflow-founder-rulings-py70hi`, the [FOLD-02](../plans/FOLD-02-enforcement-window-and-suspension.md) fold | **written on the branch, unmerged.** Identity-level restriction, and its enforcement surface |
| **042** | `claude/corpus-workflow-founder-rulings-py70hi`, the [S-E](../plans/P1-SE-trading-calendar.md) session | **written on the branch, unmerged.** The trading-calendar source discipline, and the wall-clock unit ruling |
| **043** | `claude/corpus-workflow-founder-rulings-py70hi`, this session | **written on the branch, unmerged.** The append-only registries become directory-per-entry |

**Gaplessness is asserted over allocated plus reserved**, so a branch holding a reserved number shows a hole in this file and passes. A branch inventing an unreserved number fails.

**The State column is the one part of this table no gate can check**, and the `035` row is the proof: a reservation becomes an allocation at merge, and **a runner reading one ref cannot tell the two apart**, because the branch holding a reservation and the `main` that has absorbed it both show the heading present and the row claimed. `CI-06f` reads the Numbers column, which is the load-bearing half. The State column is prose for a reader, it drifts like all prose, and [ADR-036](ADR-036.md) records that rather than implying the whole row is enforced.

**The count is now four, and the correction this session was commissioned to make had already been made.** The session brief named the `036` row as still reading `reserved, unmerged` after the pull request that merged it. It does not: `036` was corrected in the same fold that landed [ADR-037](ADR-037.md) and [ADR-038](ADR-038.md), and the row records its own repair. **The staleness had moved on to `037` and `038`**, which PR #15 merged and which still claimed to be reserved on a branch that no longer exists. That is the third and fourth instance, it was found by reading `git log` against the table rather than by reading the table, and **a brief written against this column was wrong about it inside two days**, which is the same evidence one layer out. The remedy is not more care. It is that **the State column is not a fact and is not read as one**; what a gate can check is the Numbers column, and what a reader should check is the ref.

## Migration number allocation, and why there is more than one table

**A migration number is claimed here before the file is written.** It is the same race as the one above, on the registry where it is least recoverable. **This heading read "why there are two tables" until a third arrived below it**, which is a hand-maintained count in the file that rules against them, one week old. [ADR-034](ADR-034.md) resolved the ADR collision by **renumbering the branch whose number was cited least**, and that remedy does not exist here: a migration is sacred once merged (constitution E2), so a number that has landed cannot be renamed, only superseded. **[ADR-036](ADR-036.md) rules the allocation and [CI-06h](../testing/STRATEGY.md) enforces it**, by the same rule as `CI-06f` and against this table.

| Numbers | Claimed by | State |
|---|---|---|
| 0001 to 0028 | merged to `main` | **allocated.** `0001` to `0027` are the schema-delta fold (PR #4); **`0028` is [ADR-035](ADR-035.md)'s superseding migration and it is written, merged and on `main`** as of PR #9, not reserved. `0025` is the marked reserved sequence, three tables created and unused at launch, which reserves *tables* and is an ordinary allocation of a *number* |
| **0029** | `claude/corpus-workflow-founder-rulings-py70hi`, [FOLD-01](../plans/FOLD-01-phone-identity.md) section 4 | **reserved, unwritten.** `0029_phone_identity_and_auth.sql`, [ADR-039](ADR-039.md)'s nine changes, with an `E2 READ: MONEY PATH` header |
| **0030** | `claude/corpus-workflow-founder-rulings-py70hi`, [FOLD-02](../plans/FOLD-02-enforcement-window-and-suspension.md) section 6 | **reserved, unwritten.** `0030_payout_hold_enum.sql`, the `ALTER TYPE ... ADD VALUE` and nothing else, deliberately without `BEGIN`/`COMMIT`. It is its own file because PostgreSQL refuses to use a new enum value inside the transaction that added it, and every index predicate in `0031` is such a use |
| **0031** | `claude/corpus-workflow-founder-rulings-py70hi`, [FOLD-02](../plans/FOLD-02-enforcement-window-and-suspension.md) section 6 | **reserved, unwritten.** `0031_payout_hold_and_identity_restriction.sql`, [ADR-040](ADR-040.md)'s hold and [ADR-041](ADR-041.md)'s restriction episode |
| **0032** | `claude/corpus-workflow-founder-rulings-py70hi`, [S-E](../plans/P1-SE-trading-calendar.md) section 10 | **reserved, unwritten.** `0032_trading_calendar_holidays_coverage_revisions.sql`, [ADR-042](ADR-042.md)'s F-1 through F-4 |

**The next free number is the one after the last row of this table, and this file no longer says which it is.** It said `0029` while two approved plans stated their reservation rows "are written in the same commit as this fold's". They were not, and the sentence claiming nothing was reserved was **the only thing in the repository asserting it**, in the table that exists to end assertions of that kind. [ADR-034](ADR-034.md)'s remedy applies to it exactly: either generate the number or delete it and point at the source. **Deleted.** A session that needs a number adds its row here in the same commit that creates the file, and the row is what a sibling branch reads.

**The same two-ref limit applies.** This table makes a collision visible to the second branch **that reads `main`**; it cannot stop a branch that never looks. The cross-branch assertion, that a pull request may not claim a number already on `main`, needs a job that can see both refs and belongs with `CI-06f`'s identical gap.

## CI gate identifier allocation, and why there are now three tables

**A `CI-06` letter is claimed here before the gate is written.** It is the third numbered registry in this repository and it had no table until three folds claimed from it in one week: [FOLD-01](../plans/FOLD-01-phone-identity.md) section 7 claims `k`, [FOLD-02](../plans/FOLD-02-enforcement-window-and-suspension.md) section 4.4 claims `l`, and [S-E](../plans/P1-SE-trading-calendar.md) section 7.1 claims `m`. **Each of the three plans states which letters the other two are taking**, which is three documents hand-maintaining one sequence and is precisely the arrangement [ADR-034](ADR-034.md) and [ADR-036](ADR-036.md) were each written to end. **ADR-038 collided this week for exactly this reason**, on the registry that already had a table, so the argument that a third table is premature has a counterexample three rows above it.

| Letter | Claimed by | State |
|---|---|---|
| `a` to `j` | merged to `main` | **allocated.** The ten gates in [`gates.mjs`](../../scripts/corpus/gates.mjs) today, rowed in [STRATEGY section 4.4](../testing/STRATEGY.md) |
| **`k`** | `claude/corpus-workflow-founder-rulings-py70hi`, [FOLD-01](../plans/FOLD-01-phone-identity.md) section 7 | **reserved, unwritten.** `CI-06k`, declared authority: every endpoint in the negative-authz matrix carries a required-factor cell, every sensitive action [ADR-039](ADR-039.md)'s C-27 names declares a non-single factor, and no `notification_kinds` class outside the post-identity security and money classes is `rate_limit_exempt` |
| **`l`** | `claude/corpus-workflow-founder-rulings-py70hi`, [FOLD-02](../plans/FOLD-02-enforcement-window-and-suspension.md) section 4.4 | **reserved, unwritten.** `CI-06l`, every expiry has a sweep: each expiry column in the migration set either names a release job in [CRON_INVENTORY](../ops/runbooks/CRON_INVENTORY.md) or sits on a written exemption list with a reason |
| **`m`** | `claude/corpus-workflow-founder-rulings-py70hi`, [S-E](../plans/P1-SE-trading-calendar.md) section 7.1 | **reserved, unwritten.** `CI-06m`, the calendar's declared counts agree with its own contents, the fixture calendar is regenerated and `git diff --quiet`, and every `date` column in the migration set has a [DATA_MODEL](../architecture/data-model/README.md) row naming its unit |
| **`n`** | `claude/corpus-workflow-founder-rulings-py70hi`, [ADR-043](ADR-043.md) | **reserved, written.** `CI-06n`, the registry-index gate: every entry file in a registry directory has a row in that registry README, and every README row resolves to a file. It is what pays for entry files being exempt from `CI-06c` |

**One letter in this file is already spoken for by something that is not a gate, and it is named here so a reader does not mistake it for a reservation.** [ADR-036](ADR-036.md)'s alternatives list rejects "**`CI-06k`, a sibling of `CI-06f`**" by name. That `CI-06k` was never written and never claimed; the letter is FOLD-01's. **This is the failure mode the shared allocation parser was hardened against on the other two tables**, where a three-digit numeral in prose used to reserve a number silently, and it is why the first cell of a table row is the only thing that claims anything here either.

**No gate reads this table yet, and that is stated rather than implied.** `allocated()` in [`gates.mjs`](../../scripts/corpus/gates.mjs) parses a four-digit or three-digit first cell and is called on the two tables above; a letter does not parse and nothing calls it here. The table binds a reviewer today and its enforcement is an open item, which is the position `CI-06g`'s parameter half shipped in ([ADR-037](ADR-037.md)) and it is stated the same way. **The cheap version of the gate is the one to write**: uniqueness of the letters in the STRATEGY rows, and gaplessness over allocated plus reserved, which is `CI-06f`'s assertion with a different alphabet.

---
