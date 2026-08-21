### simulation_runs
**[ADR-071](../../decisions/ADR-071.md) section 4.** The persisted record of one simulation run over a plan configuration, created by [`0045`](../../../packages/db/migrations/0045_simulation_runs.sql) (`SD-M21-01`, [M21](../../plans/M21-plan-designer.md) section 2.1). It exists so that a published config can be traced to the calibration its simulation was run against, which is the reservation's own wording in [ALLOCATION](../../decisions/ALLOCATION.md).

**Why a table rather than a field on the form.** [ADR-071](../../decisions/ADR-071.md) section 4 raises four adversarial scenarios. Three of them are answered by showing a reader something, and all three stay defeatable by a reader who does not look. `AS-M21-01`, stale calibration, is not defeatable by attention, because the staleness is invisible at the moment of the decision: **stale numbers are exactly as plausible as fresh ones.** The only remedy that survives an inattentive reader is a record, and a record is a table.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk, default `gen_random_uuid()` | |
| `plan_version_id` | uuid | null, fk `plan_versions` on delete restrict | **Null because the run is over a DRAFT**, which may not yet be a row the run can name. [M21](../../plans/M21-plan-designer.md) section 2: a draft is mutable, so "a run pointing at a row that has since been edited has recorded the wrong thing". That is why the digests sit beside this column and not instead of it |
| `rules_digest` | bytea | not null, length 32 | What was actually simulated, independent of what the row says today. `rule_states.state_hash` ([`0015`](../../../packages/db/migrations/0015_rule_states.sql)) is the convention: a hash is a SHA-256 digest or it is not a hash |
| `sizes_digest` | bytea | not null, length 32 | The same, for `plan_version_sizes`. [M01](../../plans/M01-rules-engine.md) section 2.4 splits structure from every cents value, so one digest cannot answer for both |
| `calibration_id` | text | not null, non-blank | `checkCalibrationSource` ([`provenance.ts`](../../../packages/harness/src/provenance.ts)) refuses a blank id, so the floor is the schema agreeing with its own writer |
| `calibration_digest` | bytea | not null, length 32 | **The producer returns HEX.** `calibrationDigest()` is `createHash('sha256')...digest('hex')`, a 64-character string, and the write path decodes it. bytea is kept because the convention is unbroken and a digest stored as text makes "is this a hash" unanswerable by type. **The probe writes a row through the real decode**, because a comment cannot watch a seam |
| `calibration_observed_at` | date | not null | **Unit: rail clock**, and the token is argued below rather than picked. The day the figures were **observed**, never the day of the run: `observedAt` is validated against `yyyy-mm-dd` in `provenance.ts`, so an observation day carries no time of day and no timezone and inventing either would be a figure Merit made up |
| `harness_version` | text | not null, non-blank | `provenanceFor` refuses a blank one |
| `engine_version` | text | not null, non-blank | `provenanceFor` refuses a blank one |
| `seed` | text | not null, non-blank | **TEXT and not a number, transcribed rather than preferred**: `Provenance.seed` is typed `string`. A seed stored as bigint would round-trip some seeds and not others. [SIMULATION_HARNESS section 7.2](../../testing/SIMULATION_HARNESS.md): "a harness whose failures are not reproducible is a harness whose failures get attributed to noise" |
| `sample_size` | integer | not null, **>= 0** | **`>= 0` and not `> 0`, and the disagreement is the point.** `provenanceFor` throws only on `runSampleSize < 0`, so a provenance record with `runSampleSize: 0` is legal in the harness and a `> 0` CHECK here would make a legal provenance **unstorable**, failing at the write boundary of a run that had already executed. This is the schema agreeing with its own primary source instead of with an instinct. A zero-sample run is what a misconfigured sweep arm produces, and `AS-M21-02` is an argument for **storing** the small number and showing it |
| `sweep_id` | uuid | null | One arm of a sweep, or not part of one |
| `swept_parameter` | text | null | |
| `swept_value_bp` | bigint | null | **The name is not always true and it ships anyway.** [M21](../../plans/M21-plan-designer.md) section 3.4's own worked example sweeps `max_payouts`, a **count of 5 and not a basis point**. The plan's row is the authority `0045` transcribes, so the column keeps the plan's name and the mismatch goes to the founder's read rather than being renamed on a session's own authority |
| `status` | text | not null, check in `queued`, `running`, `complete`, `failed` | [M21](../../plans/M21-plan-designer.md) section 2's row |
| `outputs` | jsonb | not null default `'{}'` | Non-null per the plan's row. An absent outputs blob and an empty one are the same fact and one representation is enough |
| `requested_by` | text | not null, non-blank | `dual_control_approvals.requested_by` ([`0016`](../../../packages/db/migrations/0016_treasury_controls.sql)) is the precedent: who asked is part of the record, and a blank one is an unattributed run |
| `started_at` | timestamptz | not null default now() | |
| `completed_at` | timestamptz | null | Set exactly when the run reaches a terminal status, below |

Indexes: `simulation_runs_plan_version_idx (plan_version_id) WHERE plan_version_id IS NOT NULL`, the traceback read; `simulation_runs_sweep_idx (sweep_id, swept_value_bp) WHERE sweep_id IS NOT NULL`, the sweep read.

Constraints: three sha256 length floors; five non-blank floors; `simulation_runs_sample_size_nonneg`; `simulation_runs_status_known`; `simulation_runs_terminal_has_completion`; `simulation_runs_sweep_arm_is_whole`.

**`simulation_runs_terminal_has_completion` is a BICONDITIONAL, not an implication**, on [`plan_versions_published_has_timestamp`](plan_versions.md)'s precedent. A terminal run without a completion time cannot be aged; a `running` run carrying one is claiming to have finished while saying it has not. Both halves are watched failing in the probe, because an implication passes the first and admits the second.

**`simulation_runs_sweep_arm_is_whole` is `num_nonnulls(...) IN (0, 3)`.** An arm naming a parameter but no sweep is untraceable, which is `AS-M21-02` with the evidence removed: the arm is visible and what it was an arm **of** is not.

**Not append-only, deliberately.** `status` and `completed_at` move as a run executes, so the REVOKE pattern [`0038`](../../../packages/db/migrations/0038_account_adjustments.sql) and `0039` extend does not apply and must not be added. [`0026`](../../../packages/db/migrations/0026_roles_and_grants.sql)'s `ALTER DEFAULT PRIVILEGES` already grants the application its access, which is why `0045` carries no GRANT block.

#### The unit token is argued, because the closed vocabulary has no word for this column

[`CI-06m`](../../testing/STRATEGY.md) requires every `date` column to declare one of exactly three tokens, and [ADR-042](../../decisions/ADR-042.md) closed the set on purpose: an open vocabulary would decay into "some words about time are present".

**`wall clock` is refuted by its own definition.** The gate defines it as *"Merit's own clock, answered only by `now()`"*. This column is **never** `now()`. It is an external source's observation date, and writing `now()` into it would be the exact defect the column exists to prevent: a run recording the day it ran as the day the figures were observed.

**`trading day` is refuted too, and more sharply.** It is *"answered only by TradingCalendar"*. A calibration vendor does not observe on the exchange's CT session boundary, and declaring it would invite a future reader to resolve this date against the calendar, which would silently shift it.

**`rail clock` is declared, and the noun is wrong while the predicate is right.** Its definition is *"the rail's own clock, quoted and never computed by Merit"*, and the operative half of that is **quoted and never computed by Merit**, which is exactly true here. [ADR-042](../../decisions/ADR-042.md)'s structure is what carries the decision: two units Merit computes, and one category for a date that arrives from outside and is merely quoted. A calibration vendor is not a settlement rail, but it is unambiguously **not Merit**, and [`affiliate_commissions.chargeback_window_ends_on`](affiliate_commissions.md) already uses this token for the same reason, that the window "is the card networks' rather than ours".

**The vocabulary is nonetheless too narrow, and that is recorded rather than fixed here.** `rail clock` names a party this column does not have. Widening `UNIT_TOKENS` is a corpus change requiring an ADR and it is **not** made from a money-path session. Recorded as an open item in [DELTA_MANIFEST section 16](../../../packages/db/DELTA_MANIFEST.md) with the candidate ADR named as owed; picking the nearest-looking token quietly is how three rows passed `CI-06m` by accident before the marker was tightened, so this one is picked loudly.
