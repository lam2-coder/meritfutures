### economic_calendar
**[ADR-066](../../decisions/ADR-066.md) section 2, closing [M07](../../plans/M07-risk-abuse.md) `DEP-M7-06`.** The maintained Tier-1 economic calendar, as Merit-owned data. Created by [`0039`](../../../packages/db/migrations/0039_economic_calendar.sql). **Non-money, and evidence-bearing**: `D-04` clusters a trader's entries against these instants and produces a risk flag, so a wrong row here does not lose money, it accuses somebody.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | internal, never in a URL |
| `load_id` | bigint | not null, references `economic_calendar_loads(id)` on delete restrict | Every release traces to the transcription that produced it, and the staleness clock is reachable from any row. `restrict` because a release whose provenance could vanish is a release nobody can defend in a dispute |
| `event_key` | text | not null, non-blank | The event, stable across occurrences, for example `US.CPI.MOM`. **`D-04` clusters BY this key**: "as a pattern across many events" ([M07](../../plans/M07-risk-abuse.md):109) is a statement about repeated occurrences of one event, and without a stable key the pattern qualifier that makes `D-04` defensible cannot be expressed |
| `occurrence_key` | text | not null, non-blank | Which release of that event, for example `2026-08`. `text` rather than `date` because occurrences are not all monthly and some are numbered rather than dated |
| `tier` | smallint | not null, check between 1 and 3 | `DEP-M7-06` names Tier-1 and `D-04` reads `tier = 1`. **Stored rather than filtered at import**: a narrow import makes "Tier-1" a property of what was loaded rather than one that can be re-derived, and a feed that re-tiers an event retroactively would change history with no row to show for it |
| `scheduled_release_at` | timestamptz | not null | **The instant, in UTC.** There is deliberately no timezone column: the trader's timezone is a rendering concern, and `GS-285` is the assertion that one row renders in two timezones |
| `release_trading_day` | date | not null | **Unit: trading day**, the exchange CT session day this release falls in, the same domain as `fills.trading_day`. Transcribed by the loader, never derived from `scheduled_release_at`: a release at 23:30 UTC is not on the UTC calendar date the engine counts in (B4 #1) |
| `revision` | integer | not null, check >= 0 | **The load-bearing column.** 0 is the original publication; a revised release time is a NEW ROW at the next number. `DEP-M7-06` is satisfied by a dataset that carries a revision, not by a static import (`GS-286`) |
| `revision_reason` | text | null | Why the time moved. Required on a revision and refused on an original, by the equivalence below. A revision with no reason records that the calendar moved and not that anybody decided it should, which is `trading_calendar_revisions.reason`'s argument one table over |
| `created_at` | timestamptz | not null default now() | |

Indexes: unique `economic_calendar_occurrence_revision_uq (event_key, occurrence_key, revision)`, which is what makes a revision an append rather than a rewrite; `economic_calendar_tier1_day_idx (release_trading_day, scheduled_release_at)` where `tier = 1`, `D-04`'s read; `economic_calendar_release_idx (scheduled_release_at)`, the panel's read.

Constraints: `economic_calendar_event_key_stated`; `economic_calendar_occurrence_key_stated`; `economic_calendar_tier_is_ranked`; `economic_calendar_revision_is_ordinal`; `economic_calendar_revision_states_its_reason`; `economic_calendar_revision_reason_stated`.

Append-only, **by grant** (`0039` revokes `update` and `delete` from `merit_app` and from `PUBLIC`). Not readable by `merit_analytics`. Retention: forever.

**`economic_calendar_revision_states_its_reason` is an equivalence and it has no NULL-passes trap.** It reads `(revision = 0) = (revision_reason IS NULL)`, and both sides are total: `revision` is `NOT NULL` so the left side is always a boolean, and `IS NULL` is a boolean for every input. [ADR-035](../../decisions/ADR-035.md) found the opposite shape seven times in the `array_length` form and [`0032`](../../../packages/db/migrations/0032_trading_calendar_holidays_coverage_revisions.sql) found it again on a widened `NOT NULL`, so this is checked rather than assumed. It closes both directions on purpose: an original may not claim a reason it did not have, and a revision may not omit one.

**The revision is a row, not an update, and that is what makes `GS-286` mechanical.** Both consumers read [`economic_calendar_current`](#economic_calendar_current) rather than this table, so the [M04](../../plans/M04-trader-portal.md) panel and `D-04`'s window move together **because there is no "both" to move separately**. An update-in-place design would leave "did `D-04` re-evaluate against the new instant" as a question about application code; here it is a question about a view.

**The source question is foreclosed rather than open** ([ADR-066](../../decisions/ADR-066.md) section 2). A third-party embed cannot carry a revision, cannot be staleness-monitored and cannot be joined to `fills`, and `D-04` needs all three. An embed rendered beside this table would be a second source of truth for "when was the news", which is the failure `FM-M7-08` already guards.

#### economic_calendar_current

A view, not a table, so it has no design record of its own beyond this note. `DISTINCT ON (event_key, occurrence_key) ... ORDER BY revision DESC`: the current revision of every occurrence, and **the only definition of "current" anywhere**. The panel and `D-04` both read it. A documented convention that each consumer picks the maximum revision is a sentence that has to be re-implemented correctly twice, and the failure when one of them gets it wrong is the panel showing 08:30 while `D-04` clusters against 09:00.
