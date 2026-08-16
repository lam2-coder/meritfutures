### trading_calendar_revisions
**[ADR-042](../../decisions/ADR-042.md) F-2.** What the database held on the day the engine read it. Created by [`0032`](../../../packages/db/migrations/0032_trading_calendar_holidays_coverage_revisions.sql).

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | bigint | pk, generated always as identity | internal, never in a URL |
| `trading_day` | date | fk [`trading_calendar`](trading_calendar.md), not null, on delete restrict | **the exchange CT trading day** the correction moved. `restrict` because a calendar day with a revision history is a day something already depended on |
| `prior_row` | jsonb | not null | `to_jsonb(OLD)` of the whole `trading_calendar` row. **Derived, not listed**, so a column a future migration adds is captured automatically. A hand-written column list is the same object as a hand-maintained count, and this corpus has now found nine of those wrong |
| `actor` | text | not null, non-blank | who. Free text on `identity_links`' `actor` idiom: this is written by the loader and by an operator, neither of which is a `users` row |
| `reason` | text | not null, non-blank | why. **A prior image with no reason records that the calendar moved and not that anybody decided it should** |
| `source_digest` | bytea | not null, check `length = 32` | SHA-256 of the source file that produced the **new** value, so a revision traces to the transcription that caused it. `rule_states`' idiom: a hash is a SHA-256 digest or it is not a hash |
| `dependent_row_count` | integer | not null, check >= 0 | rows in `fills`, `daily_marks` and `rule_states` depending on this day, counted **before** the write. **The partition, asserted rather than judged** |
| `incident_ref` | text | null; **required and non-blank when `dependent_row_count > 0`** | the incident this correction belongs to |
| `created_at` | timestamptz | not null default now() | the row's creation is the correction |

Indexes: `trading_calendar_revisions_day_idx (trading_day, created_at desc)`, the replay's "what did this table say about day D" read; `trading_calendar_revisions_incident_idx (incident_ref, created_at)` where `incident_ref is not null`, everything one incident moved.
Constraints: `trading_calendar_revisions_prior_row_is_a_row`; `trading_calendar_revisions_actor_stated`; `trading_calendar_revisions_reason_stated`; `trading_calendar_revisions_digest_is_sha256`; `trading_calendar_revisions_dependents_counted`; `trading_calendar_revisions_incident_named_when_dependent`.
Append-only, **by grant** (`0032` revokes `update` and `delete` from `merit_app` and from `PUBLIC`). Not readable by `merit_analytics`. Retention: forever.

**Why the table exists at all.** `INV-04` is "replaying every mark from day one reproduces stored state byte-identically", and it was defined against a value that can move underneath it. `trading_calendar` carries `updated_at` and `notes` and no prior image, so **it cannot answer what the calendar said on the day the engine read it**, and the nightly self-audit would page with no way to distinguish a calendar correction from an engine regression.

**Why git is not this table.** Git is real history and is the wrong history. It records what the **file** said. It cannot prove what the **database** held when the mark was computed, and the mark was computed against the database.

**Why `dependent_row_count` exists, which is one column more than [ADR-042](../../decisions/ADR-042.md) lists.** The ADR names five fields. [P1 S-E section 4](../../plans/P1-SE-trading-calendar.md) partitions a correction by whether anything depends on the day and says the partition is **asserted rather than judged**: zero dependents is an ordinary data change, non-zero is an **incident**, in which every affected account is replayed through the same `advanceDay` fold and B4 #5 governs the outcome, so a settled payout whose eligibility changes retroactively is **never clawed back**, it is flagged for review and absorbed. Without the asserted count stored, `incident_ref` is nullable with nothing saying when it may be null, and "an incident, not a data edit" is a convention. With it, a correction to a day anything depends on cannot be written without naming an incident.

**Nothing forces a `trading_calendar` update to write one of these rows**, and that is a gap rather than a design. The loader does it; the database does not require it. A trigger would make it a control rather than a rule somebody follows, and [ADR-042](../../decisions/ADR-042.md) is silent on it, so `0032` does not add a money-path trigger on its own authority. Carried as `OI-06` in [DELTA_MANIFEST section 8](../../../packages/db/DELTA_MANIFEST.md).

**That `prior_row.trading_day` equals this row's `trading_day` is asserted by the loader and its probe rather than by a `check`.** The comparison needs a jsonb rendering of a date, which is `STABLE` rather than `IMMUTABLE` because it depends on `DateStyle`, and PostgreSQL will not accept a non-immutable expression in a `check`. What the `check` can do is reject a prior image that is not a row image at all: `{}` is the jsonb form of the empty array that passes a length test, so `trading_calendar_revisions_prior_row_is_a_row` requires the four keys a replay needs.
