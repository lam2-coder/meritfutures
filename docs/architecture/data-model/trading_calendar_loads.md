### trading_calendar_loads
**[ADR-042](../../decisions/ADR-042.md) F-4.** The coverage fact, which is what makes "we do not know about this day" an **answer**. Created by [`0032`](../../../packages/db/migrations/0032_trading_calendar_holidays_coverage_revisions.sql).

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | internal, never in a URL |
| `source_id` | text | not null, non-blank | which source publication this load came from, e.g. the CME 2026 calendar. `text` rather than an enum: the set grows about once a year, which is the case section 1 sends to `text` with a check |
| `coverage_start_day` | date | not null | **inclusive lower bound, in exchange CT trading-day space**, the same domain as `trading_calendar.trading_day`. Never a UTC calendar date |
| `coverage_end_day` | date | not null, check >= `coverage_start_day` | **inclusive upper bound, same unit.** The horizon alarm warns when the maximum runs less than six months ahead ([ADR-042](../../decisions/ADR-042.md), OQ-SE-02) |
| `source_digest` | bytea | not null, check `length = 32` | SHA-256 of the source file as committed. The loader re-reads the rows it wrote, re-canonicalizes and asserts the digests match |
| `actor` | text | not null, non-blank | who ran the load |
| `created_at` | timestamptz | not null default now() | **[ADR-042](../../decisions/ADR-042.md)'s "loaded at".** The row's creation **is** the load, so there is deliberately no second timestamp beside it |

Indexes: unique `trading_calendar_loads_source_digest_uq (source_id, source_digest)`; `trading_calendar_loads_horizon_idx (coverage_end_day desc, coverage_start_day)`, the horizon alarm's read.
Constraints: `trading_calendar_loads_coverage_ordered`; `trading_calendar_loads_source_id_stated`; `trading_calendar_loads_actor_stated`; `trading_calendar_loads_digest_is_sha256`.
Append-only, **by grant** (`0032` revokes `update` and `delete` from `merit_app` and from `PUBLIC`). Not readable by `merit_analytics`. Retention: forever.

**A calendar that runs out is the single most silent failure available to that table.** Today an exhausted calendar is **indistinguishable from an unbroken holiday**: no row means not a trading day, so every counter quietly stops advancing, no rule fires, nothing breaches, nothing becomes eligible, and **nothing raises**. A stored coverage bound makes the day outside coverage a positive "unknown", and the batch **refuses rather than guesses**. This is also what F-1 needs: once a holiday is a row rather than an absence, absence has to mean something else, and this table is what it means.

**One fact, three consumers**: the fail-closed batch control, the six-month horizon alarm, and the loader's digest round trip.

**Why there is no separate `loaded_at`.** Section 1 permits exactly three ruled exceptions to every-table-carries-`created_at`, each carrying a **more specific timestamp instead**. Here the row's creation is the load, so a second timestamp would be a second answer to one question rather than a more specific one.

**Idempotence is a constraint here rather than loader behaviour.** Re-running the loader against an unchanged source must write nothing, and `trading_calendar_loads_source_digest_uq` is the half of that promise the database can keep on its own. The digest determines the coverage bounds, because both are read from the same file.
