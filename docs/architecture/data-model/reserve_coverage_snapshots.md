### reserve_coverage_snapshots
**`SD-M6-01` / `OI-01`**, [ADR-128](../../decisions/ADR-128.md), [`0049`](../../../packages/db/migrations/0049_reserve_coverage_snapshots.sql). `P-M6-07`'s reserve coverage ratio: **`reserve / CVaR99 at rho = 0.30`**, the number that pauses **new sales** below 1.0 and never pauses payouts ([GLOSSARY](../../GLOSSARY.md#reserve-coverage-ratio-rcr)).

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | |
| `as_of` | timestamptz | not null, unique | The instant the figure describes. **Its own clock**, which is the second reason this is not a column set on [`liability_snapshots`](liability_snapshots.md): coverage is the rail's clock against ours and one row would force one `as_of` onto two sources that do not move together |
| `reserve_cents` | bigint | not null, `>= 0` | **The numerator.** The rail's reported balance, copied from the row named below and held equal to it by `RESERVE-C1`. A negative balance is an overdraft and a different incident |
| `treasury_account_code` | text | not null, fk | **The anchor, as a reference.** `INV-M5-11`: reported against a **live** rail balance, never one derived from our own ledger, because a coverage ratio computed from the book it covers is a number that agrees with itself |
| `treasury_as_of` | timestamptz | not null, fk | The second half of [`treasury_balances`](treasury_balances.md)'s key. `P-M6-07`'s attestation staleness is then a **join** rather than two more columns that can disagree with their source ([ADR-047](../../decisions/ADR-047.md): a reference beats a copied value) |
| `cvar99_cents` | bigint | not null, `> 0` | **The denominator, and it is the FLOOR rather than the estimate.** `P-M6-07`: "the denominator is CVaR99 at `rho = 0.30`, the reserve floor, never the harness's central estimate". [ADR-019](../../decisions/ADR-019.md) put wallet balances inside it (`GS-130`) |
| `rcr_bp` | integer | **generated always as** `(reserve_cents * 10000) / NULLIF(cvar99_cents, 0)` **stored** | Integer basis points, computed by the database. A ratio the database computes **cannot disagree with the two numbers stored beside it**, which is the direct answer to the third objection in `OI-01`'s recommendation |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `reserve_coverage_snapshots_as_of_uq (as_of)`; `reserve_coverage_snapshots_latest_idx (as_of desc)` for the panel's "what is coverage now".
Constraints: `reserve_coverage_snapshots_cvar99_is_positive`, `reserve_coverage_snapshots_reserve_non_negative`, `reserve_coverage_snapshots_anchor_fk` (`on delete restrict`), and the `RESERVE-C1` trigger.
Retention: forever. **Append-only**, by `REVOKE UPDATE, DELETE` in `0049`. Not readable by `merit_analytics`.

**`NULLIF` is load-bearing and it is not defensive programming.** A `GENERATED` column is computed **before** the row's `CHECK` constraints are evaluated, which was proven by execution against PostgreSQL 16 rather than assumed: with a plain `/ cvar99_cents` a zero denominator raises a bare `division by zero` and `reserve_coverage_snapshots_cvar99_is_positive` never fires at all. A zero CVaR99 is not infinite coverage, it is a floor nobody computed, and the operator has to be told which of those two happened. `REJECTION 1` in [`probe_reserve_coverage.sql`](../../../scripts/db/probe_reserve_coverage.sql) reads `CONSTRAINT_NAME` to hold that.

**Truncation runs toward zero, which is toward arming the breaker.** One cent short of full coverage reads `9999` and one cent over reads `10000`, so an ambiguous book falls to the conservative side, which is where this system's conservatism is already ruled to live (`rho = 0.30`, the CVaR99 floor, the RCR breaker at 1.0). **The bound is stated rather than constrained**: a coverage above 214,748x raises `integer out of range`, and that failure cannot be given a nicer name for the same reason `NULLIF` is needed.

**`breaker_armed` is deliberately not a column.** Armed is `rcr_bp < 10000`, a rendering against a threshold the GLOSSARY fixes at 1.0, and storing it would recreate in one column exactly the drift the generated `rcr_bp` removes from another. Nothing in the corpus gives the RCR breaker an override state; [`plan_breaker_state`](plan_breaker_state.md)'s `manually_overridden` belongs to the per-plan loss-ratio breaker.

**Why a separate table rather than five columns on `liability_snapshots`**, which is `OI-01`'s recommendation and not this record's invention. That table exists for **EC-095**, three named liability numbers that are never collapsed into one, and a coverage **ratio** is a fourth kind of fact that re-collapses the distinction it exists to enforce. The cadences differ. And a ratio stored beside its own numerator invites recomputation drift, which the generated column answers rather than accepts.

**`per_plan` was never orphaned.** `OI-01` listed it among the fields with no home. [API_CONTRACT](../API_CONTRACT.md)'s `GET /admin/liability` renders `per_plan` as loss ratio, threshold, `sales_paused` and CUSUM per plan, and that is [`plan_breaker_state`](plan_breaker_state.md), which [`0016`](../../../packages/db/migrations/0016_treasury_controls.sql) built with `plan_id`, `evaluated_on`, `ratio_bp`, `threshold_bp` and a state whose values include `paused`.
