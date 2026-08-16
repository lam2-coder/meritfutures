### published_statistics
**`SD-M12-02`**, amended by [ADR-031](../../decisions/ADR-031.md) and [ADR-032](../../decisions/ADR-032.md). Append-only, never updated.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `stat_code` | text | not null | |
| `definition_version` | integer | not null, check > 0 | |
| `window_start_day`, `window_end_day` | date | not null | **Unit: trading day**, both of them. [M12](../../plans/M12-statistic-definitions.md)'s window is "trailing 90 **trading** days", so these are the window's first and last, and **this cell was empty until 2026-08-16** while the unit lived only in M12. It sits one row from `as_of_trading_day`, whose unit is in its name, in the same table: the pair is why the unit is declared rather than inferred. |
| `as_of_trading_day` | date | not null | **Unit: trading day**, the day the figure is stated as of. |
| `measure` | `statistic_measure` | not null | **[ADR-032](../../decisions/ADR-032.md).** Which figure this row carries. Without it ST-04's mean and median, and ST-05's and ST-06's p50 and p95, collide on the window unique index and the second is unwritable |
| `value` | bigint | null | **[ADR-031](../../decisions/ADR-031.md).** Renamed from `value_numeric numeric`, and its no-floats exemption is retired |
| `value_unit` | `statistic_unit` | null | **[ADR-031](../../decisions/ADR-031.md).** 1470 is 14.70 percent or $14.70 depending on a column nobody made mandatory |
| `numerator` | bigint | null | **`SD-M12-02`.** A count, integer cents, or a whole-second duration across the seven definitions |
| `numerator_unit` | `statistic_unit` | null | **`SD-M12-02`**, forced by the type rather than added alongside it |
| `denominator` | bigint | null, check >= 0 when present | **`SD-M12-02`.** A count in all six statistics that have one; ST-03 has none, because it is a total rather than a rate |
| `sample_size` | integer | not null, check >= 0 | |
| `grain_key` | text | null | per plan, per size, or null for global |
| `suppressed_reason` | text | null | a suppressed row **exists**, which is what makes suppression visible rather than a gap in a series |
| `restatement_of` | uuid | fk published_statistics, null, on delete restrict | a correction is a new row pointing at what it restates |
| `computed_at` | timestamptz | not null default now() | |
| `input_digest` | bytea | not null | **`SD-M12-02`.** Makes reproduction verifiable rather than merely possible |
| `created_at` | timestamptz | not null default now() | |

Indexes: `published_statistics_code_idx (stat_code, as_of_trading_day desc)`; `published_statistics_restatement_idx (restatement_of)` where not null; unique **`published_statistics_window_uq (stat_code, definition_version, window_start_day, window_end_day, coalesce(grain_key,''), measure)`** where `restatement_of is null`.
Constraints: `published_statistics_window_ordered`; `published_statistics_value_or_suppression` (a row either publishes a value with its components or states why it did not, never neither; the **denominator is deliberately not required**, because requiring one made ST-03 unpublishable); `published_statistics_numerator_has_unit`; `published_statistics_value_has_unit`; `published_statistics_no_self_restatement`.
Enforced in `0027`: **STAT-C1** (`published_statistics_measures_complete`), a deferred constraint trigger asserting that a publish run emitting one measure emits **every** measure its definition declares, that the measure is declared, and that the definition exists. Scoped to `restatement_of IS NULL`, so correcting one figure of a published pair stays legal.
Why the unique key was not enough: adding `measure` made the second row **writable** and did nothing to make it **required**. A run that emits ST-04's mean and never emits its median satisfies every constraint on this table and publishes exactly what M12 forbids. On an append-only, publicly restated surface a missing median is not a bug you fix, it is a number Merit published and must now restate in public.
The rejected alternative is recorded because it is the one that looks cheaper: separate `stat_code`s per figure need **no schema change at all** and are worse, because they make the pair independently publishable and delete the invariant by making it unstateable.
There is no approval step between computation and publication, on purpose: an approval step is a place where an inconvenient number stops.
