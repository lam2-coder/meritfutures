### round_trips
**`SD-M13-01`**.

| Column | Type | Constraints | Why |
|---|---|---|---|
| `id` | uuid | pk | |
| `account_id` | uuid | fk accounts, not null, on delete restrict | |
| `instrument` | text | not null | |
| `opened_at` | timestamptz | not null | |
| `closed_at` | timestamptz | null | null while the position is open |
| `trading_day` | date | not null | **Unit: trading day**, the day the round trip closed on. |
| `direction` | text | not null, check in (`long`,`short`) | |
| `max_size` | integer | not null, check > 0 | |
| `entry_fills` | bigint[] | not null | arrays rather than a join table because the grouping **is** the finding: which fills belong together is precisely what `derivation_version` pins |
| `exit_fills` | bigint[] | not null default `'{}'` | |
| `gross_result_cents` | bigint | not null | |
| `fee_cents` | bigint | not null default 0, check >= 0 | |
| `net_result_cents` | bigint | not null | **presentational.** Never reconciles the account |
| `derivation_version` | integer | not null, check > 0 | **`SD-M13-01`**, INV-M13-10 |
| `created_at` | timestamptz | not null default now() | |

Indexes: `round_trips_account_day_idx (account_id, trading_day desc)`; `round_trips_open_idx (account_id)` where `closed_at is null`.
Constraints: `round_trips_net_arithmetic`; `round_trips_has_entry`; `round_trips_closed_has_exit`; `round_trips_ordered`.
Why the version column: grouping fills into round trips is genuinely ambiguous once scaling in and out, reversals and overnight positions exist. Doing it at read time means the answer depends on which query ran; doing it once, versioned, means **a trader's trade count is stable** and a change to the grouping rule is a visible, dated event.
