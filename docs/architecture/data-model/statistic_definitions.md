### statistic_definitions
**`SD-M12-01`**, amended by [ADR-032](../../decisions/ADR-032.md).

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `stat_code` | text | not null | |
| `version` | integer | not null, check > 0 | |
| `title` | text | not null | |
| `numerator_spec` | text | not null | **the two specs are the statistic.** Both required, both prose-precise, and the denominator is always on the surface |
| `denominator_spec` | text | not null | |
| `exclusions` | text[] | not null default `'{}'` | |
| `window_spec` | text | not null | trailing window and lifetime forms |
| `grain` | text | not null | |
| `min_sample` | integer | not null, check > 0 | **`SD-M12-01`.** A publication policy, not an implementation detail. Below it the statistic is suppressed rather than published with a wide error bar nobody reads |
| `measures` | `statistic_measure[]` | not null | **[ADR-032](../../decisions/ADR-032.md).** The declared measure set, and what STAT-C1 checks a publish run against. ST-01/02/07 `{rate}`; ST-03 `{total}`; ST-04 `{mean, median}`; ST-05/06 `{p50, p95}` |
| `method_body_mdx` | text | not null | the published methodology page |
| `adr_ref` | text | null | the ruling that fixed this definition |
| `effective_from` | date | not null | **always in the future at write time** (INV-M12-07). A definition that takes effect retroactively is a definition chosen after seeing the number it produces |
| `superseded_by` | uuid | fk statistic_definitions, null, on delete restrict | |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `statistic_definitions_code_version_uq (stat_code, version)`; unique `statistic_definitions_live_uq (stat_code)` where `superseded_by is null`.
Constraints: `statistic_definitions_no_self_supersede`; **`statistic_definitions_measures_nonempty`** (`cardinality(measures) >= 1`); `statistic_definitions_measures_distinct`.
Why `measures` lives on the definition rather than in code: it is part of what the statistic **is**. ST-04 is not "average payout, and median as a nice extra"; it is a definition whose published form is two figures, and a version of it that published one would be a different definition. Changing the set on a live statistic is a new definition **version**, by the same rule that governs the specs.
**Why the nonempty check says `cardinality` and not `array_length`.** Written the obvious way, `array_length(measures, 1) >= 1` evaluates to `NULL` on the empty array, and **a `CHECK` evaluating to `NULL` passes**, so the constraint admitted the single value it existed to reject. An empty declared set makes STAT-C1 vacuous: a statistic could publish nothing at all and satisfy "every measure it declares". It was caught by **executing** the constraint, not by reading it.
