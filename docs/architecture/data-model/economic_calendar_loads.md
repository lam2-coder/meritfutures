### economic_calendar_loads
**[ADR-066](../../decisions/ADR-066.md) section 2.** The coverage fact for [`economic_calendar`](economic_calendar.md), which is **the staleness clock [M07](../../plans/M07-risk-abuse.md) `FM-M7-08` requires**. Created by [`0039`](../../../packages/db/migrations/0039_economic_calendar.sql). It is [`trading_calendar_loads`](trading_calendar_loads.md) one table over, deliberately: `FM-M7-08` puts this calendar's freshness "on the same footing as `contract_specs` and `trading_calendar`", and that footing is a stored coverage bound.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | internal, never in a URL |
| `source_id` | text | not null, non-blank | Which source publication this load came from. `text` rather than an enum on [`trading_calendar_loads`](trading_calendar_loads.md)'s reasoning: the set of feeds grows on procurement timescales, not on release timescales |
| `coverage_start_day` | date | not null | **Unit: trading day**, inclusive lower bound, the same domain as `economic_calendar.release_trading_day`. Never a UTC calendar date |
| `coverage_end_day` | date | not null, check >= `coverage_start_day` | **Unit: trading day**, inclusive upper bound, the same unit as the row above. **This is the column the staleness alarm reads** |
| `source_digest` | bytea | not null, check `length = 32` | SHA-256 of the source file as ingested. `rule_states`' idiom: a hash is a SHA-256 digest or it is not a hash |
| `actor` | text | not null, non-blank | Who ran the load. `0002_identity`'s `actor` idiom: a loader or an operator, neither of which is a `users` row |
| `created_at` | timestamptz | not null default now() | **The row's creation is the load**, so there is deliberately no second `loaded_at` beside it ([`trading_calendar_loads`](trading_calendar_loads.md)'s stated reason) |

Indexes: unique `economic_calendar_loads_source_digest_uq (source_id, source_digest)`; `economic_calendar_loads_horizon_idx (coverage_end_day desc, coverage_start_day)`, the staleness alarm's read.

Constraints: `economic_calendar_loads_coverage_ordered`; `economic_calendar_loads_source_id_stated`; `economic_calendar_loads_actor_stated`; `economic_calendar_loads_digest_is_sha256`.

Append-only, **by grant** (`0039` revokes `update` and `delete` from `merit_app` and from `PUBLIC`). Not readable by `merit_analytics`. Retention: forever.

**Without this table, an exhausted economic calendar is indistinguishable from a quiet week.** No rows means no releases, which means no windows, which means `D-04` finds nothing and **nothing raises**. That is the single most silent failure available to this dataset and it is the same one [ADR-042](../../decisions/ADR-042.md) F-4 found on the trading calendar. A stored coverage bound makes a day outside coverage a positive **"unknown"**, so a `D-04` run over an uncovered window **declines rather than reports a clean result**.

**That declining behaviour is the whole of `GS-287` and it is a ruling rather than a detail.** `FM-M7-08` says a stale calendar makes `D-04` fire "on the wrong windows or not at all". **Firing on wrong windows is strictly worse than not firing, because it manufactures evidence against a trader**, so the stale case declines and the alarm carries the failure to a human. The dead-man switch is in [CRON_INVENTORY](../../ops/runbooks/CRON_INVENTORY.md).

**Idempotence is a constraint here rather than loader behaviour**, which is [`trading_calendar_loads`](trading_calendar_loads.md)'s argument reproduced: re-running the loader against an unchanged publication writes nothing, and `economic_calendar_loads_source_digest_uq` is the half of that promise the database can keep on its own. The digest determines the coverage bounds because both are read from the same file.
