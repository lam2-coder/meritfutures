### correlation_groups
**`SD-M7-05`**, AS-M7-02. Pairwise correlation is defeated by rotating a third leg.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `trading_day` | date | not null | |
| `member_account_ids` | uuid[] | not null | the group **as a set**. An array rather than a join table because the group is the finding: decomposing it into rows makes "which accounts did this result cover" a query rather than a fact |
| `method` | text | not null | |
| `statistic` | **numeric** | not null | **one of the two ruled no-floats exemptions (§17).** A correlation coefficient is not money and is not a ratio of two integers Merit controls |
| `threshold` | **numeric** | not null | the second exemption, and it must share the type of the statistic it is compared against |
| `detector_run_id` | uuid | fk detector_runs, null, on delete restrict | |
| `evidence` | jsonb | not null | |
| `created_at` | timestamptz | not null default now() | |

Indexes: `correlation_groups_day_idx (trading_day desc)`; `correlation_groups_members_idx` using **gin** on `member_account_ids`.
Constraints: `correlation_groups_is_a_group` (`array_length(member_account_ids, 1) >= 3`: a group of one is a pair detector with extra steps, and a group of two is `identity_links`' job).
Retention: forever.
Why this is a reserve control and not only an abuse control, which is the strongest argument in the corpus for funding it: the risk engine shows mean monthly payouts flat near $45.3K across every correlation level while CVaR99 nearly doubles from $84.8K at `rho = 0.05` to $132.9K at `rho = 0.30`. **The tail is all correlation**, and that is also why these two columns keep their exemption: a plain integer `rho` of `0.30` is `0`.

> **CLOSED 2026-08-15 by [`0028`](../../../packages/db/migrations/0028_supersede_plan_version_immutability.sql).** `correlation_groups_is_a_group` was written `array_length(member_account_ids, 1) >= 3`. An empty array yields `NULL >= 3`, which is `NULL`, and **a `CHECK` evaluating to `NULL` passes**, so the constraint admitted the empty group it existed to reject. Verified by execution: the empty array was **accepted** against `0001` to `0027` and is **rejected** against `0001` to `0028`. `0028` re-adds it as `cardinality(member_account_ids) >= 3` under the same name, so every citation of it still resolves. **`0027` and `0008` are not edited**; a merged migration is superseded, never rewritten. Six other constraints carried the identical trap and are corrected in the same file: see [ADR-035](../../decisions/ADR-035.md) amendment 4 for the line-cited list of all seven.
